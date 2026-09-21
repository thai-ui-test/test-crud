"use strict";

// Dependency-free application boundary. Data lives in this process, matching the
// prototype's previous in-memory behaviour, but is now always tenant scoped.
const { createServer } = require("node:http");
const { randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { promisify } = require("node:util");

const MAX_REQUEST_BODY_SIZE = 64 * 1024;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const scryptAsync = promisify(scrypt);
const DUMMY_PASSWORD = "not-a-valid-user-password";
const DUMMY_PASSWORD_SALT = "00000000000000000000000000000000";

const publicFiles = new Map([
  ["/login", ["login.html", "text/html; charset=utf-8"]],
  ["/login.js", ["login.js", "application/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);
const protectedFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "application/javascript; charset=utf-8"]],
]);

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${(await scryptAsync(password, salt, 64)).toString("hex")}`;
}

async function passwordMatches(password, stored) {
  const [salt, expected] = String(stored).split(":");
  if (!salt || !expected) return false;
  const actual = (await scryptAsync(password, salt, 64)).toString("hex");
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function canonicalEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

async function createStore(seed = {}) {
  const users = new Map();
  const usersByEmail = new Map();
  const pendingEmails = new Set();
  const tenants = new Map();
  let nextUserId = 1;
  const addUser = async ({ email, password, isAdmin = false, tenantId = "default" }) => {
    const canonical = canonicalEmail(email);
    if (!canonical) throw new Error("User email must be non-empty.");
    if (usersByEmail.has(canonical) || pendingEmails.has(canonical)) throw new Error("User email must be globally unique.");
    pendingEmails.add(canonical);
    let passwordHash;
    try {
      passwordHash = await hashPassword(password);
    } finally {
      pendingEmails.delete(canonical);
    }
    const user = { id: nextUserId++, email: canonical, passwordHash, isAdmin, tenantId };
    users.set(user.id, user);
    usersByEmail.set(canonical, user);
    if (!tenants.has(tenantId)) tenants.set(tenantId, { inventory: [], employees: [], nextInventoryId: 1, nextEmployeeId: 1 });
    return user;
  };
  for (const user of seed.users || []) await addUser(user);
  return { users, usersByEmail, tenants, addUser, hasEmail: (email) => usersByEmail.has(canonicalEmail(email)) || pendingEmails.has(canonicalEmail(email)), dummyPasswordHash: await hashPassword(DUMMY_PASSWORD, DUMMY_PASSWORD_SALT) };
}

function json(status, body, headers = {}) {
  return { status, headers: { "content-type": "application/json; charset=utf-8", ...headers }, body: JSON.stringify(body) };
}
function error(status, message) { return json(status, { error: message }); }
function cookieValue(header, name) {
  return String(header || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
function userView(user) { return { id: user.id, email: user.email, isAdmin: user.isAdmin }; }
function validText(value) { return typeof value === "string" && value.trim(); }

async function createApp(options = {}) {
  const { sessionTtlMs = SESSION_TTL_MS, now = Date.now } = options;
  const store = options.store || await createStore();
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0) throw new Error("sessionTtlMs must be a positive, finite number.");
  const sessions = new Map();
  const currentUser = (headers) => {
    const token = cookieValue(headers.cookie, "session");
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(token);
      return null;
    }
    const user = store.users.get(session.userId);
    if (!user) sessions.delete(token);
    return user || null;
  };
  const requireUser = (headers) => currentUser(headers) || null;
  const requireAdmin = (headers) => {
    const user = requireUser(headers);
    return user?.isAdmin ? user : null;
  };
  const tenant = (user) => store.tenants.get(user.tenantId);
  const parseBody = (body) => {
    try { return body ? JSON.parse(body) : {}; } catch { return null; }
  };

  async function handle({ method = "GET", url = "/", headers = {}, body = "" }) {
    let pathname;
    try {
      pathname = new URL(url, "http://local").pathname;
    } catch {
      return error(400, "Malformed request target.");
    }
    if (Buffer.byteLength(String(body), "utf8") > MAX_REQUEST_BODY_SIZE) return error(413, "Request body too large.");
    if (method === "GET" && publicFiles.has(pathname)) {
      const [file, type] = publicFiles.get(pathname);
      return { status: 200, headers: { "content-type": type }, body: readFileSync(join(__dirname, file), "utf8") };
    }
    if (method === "GET" && protectedFiles.has(pathname)) {
      if (!requireUser(headers)) return { status: 302, headers: { location: "/login" }, body: "" };
      const [file, type] = protectedFiles.get(pathname);
      return { status: 200, headers: { "content-type": type }, body: readFileSync(join(__dirname, file), "utf8") };
    }
    if (pathname === "/api/session" && method === "POST") {
      const values = parseBody(body);
      if (!values || !validText(values.email) || !validText(values.password)) return error(400, "Email and password are required.");
      const user = store.usersByEmail.get(canonicalEmail(values.email));
      if (!await passwordMatches(values.password, user?.passwordHash || store.dummyPasswordHash)) return error(401, "Invalid email or password.");
      if (!user) return error(401, "Invalid email or password.");
      for (const [token, session] of sessions) if (session.expiresAt <= now()) sessions.delete(token);
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, { userId: user.id, expiresAt: now() + sessionTtlMs });
      return json(200, { user: userView(user) }, { "set-cookie": `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/` });
    }
    if (pathname === "/api/session" && method === "DELETE") {
      const token = cookieValue(headers.cookie, "session");
      if (token) sessions.delete(token);
      return { status: 204, headers: { "set-cookie": "session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0" }, body: "" };
    }
    if (pathname === "/api/me" && method === "GET") {
      const user = requireUser(headers); return user ? json(200, { user: userView(user) }) : error(401, "Authentication required.");
    }
    const user = requireUser(headers);
    if (!user) return error(401, "Authentication required.");
    const data = parseBody(body);
    const scoped = tenant(user);
    if (pathname === "/api/inventory" && method === "GET") return json(200, { inventory: scoped.inventory });
    if (pathname === "/api/inventory" && method === "POST") {
      if (!data || !validText(data.name) || !validText(data.description) || !["In stock", "Low stock", "Out of stock"].includes(data.status)) return error(400, "Invalid inventory item.");
      const item = { id: scoped.nextInventoryId++, name: data.name.trim(), description: data.description.trim(), status: data.status, employeeId: null };
      scoped.inventory.push(item); return json(201, { item });
    }
    const inventoryMatch = pathname.match(/^\/api\/inventory\/(\d+)$/);
    if (inventoryMatch && method === "PUT") {
      const item = scoped.inventory.find((entry) => entry.id === Number(inventoryMatch[1]));
      if (!item || !data || !validText(data.name) || !validText(data.description) || !["In stock", "Low stock", "Out of stock"].includes(data.status)) return error(item ? 400 : 404, item ? "Invalid inventory item." : "Not found.");
      Object.assign(item, { name: data.name.trim(), description: data.description.trim(), status: data.status, employeeId: data.employeeId === null ? null : item.employeeId }); return json(200, { item });
    }
    if (inventoryMatch && method === "DELETE") {
      const index = scoped.inventory.findIndex((entry) => entry.id === Number(inventoryMatch[1])); if (index < 0) return error(404, "Not found.");
      scoped.inventory.splice(index, 1); return { status: 204, headers: {}, body: "" };
    }
    const assignmentMatch = pathname.match(/^\/api\/inventory\/(\d+)\/assignment$/);
    if (assignmentMatch && method === "PUT") {
      const item = scoped.inventory.find((entry) => entry.id === Number(assignmentMatch[1])); if (!item) return error(404, "Not found.");
      if (!data || !(data.employeeId === null || scoped.employees.some((entry) => entry.id === data.employeeId))) return error(400, "Invalid employee assignment.");
      item.employeeId = data.employeeId; return json(200, { item });
    }
    if (pathname === "/api/employees" && method === "GET") return json(200, { employees: scoped.employees });
    if (pathname === "/api/employees" && method === "POST") {
      if (!data || !validText(data.name) || !validText(data.email)) return error(400, "Invalid employee.");
      const employee = { id: scoped.nextEmployeeId++, name: data.name.trim(), email: data.email.trim() }; scoped.employees.push(employee); return json(201, { employee });
    }
    const employeeMatch = pathname.match(/^\/api\/employees\/(\d+)$/);
    if (employeeMatch && method === "PUT") {
      const employee = scoped.employees.find((entry) => entry.id === Number(employeeMatch[1])); if (!employee || !data || !validText(data.name) || !validText(data.email)) return error(employee ? 400 : 404, employee ? "Invalid employee." : "Not found.");
      Object.assign(employee, { name: data.name.trim(), email: data.email.trim() }); return json(200, { employee });
    }
    if (employeeMatch && method === "DELETE") {
      const index = scoped.employees.findIndex((entry) => entry.id === Number(employeeMatch[1])); if (index < 0) return error(404, "Not found.");
      const [removed] = scoped.employees.splice(index, 1); scoped.inventory.forEach((item) => { if (item.employeeId === removed.id) item.employeeId = null; }); return { status: 204, headers: {}, body: "" };
    }
    if (pathname === "/api/admin/users" && method === "GET") {
      if (!requireAdmin(headers)) return error(403, "Administrator access required.");
      return json(200, { users: [...store.users.values()].filter((entry) => entry.tenantId === user.tenantId).map(userView) });
    }
    if (pathname === "/api/admin/users" && method === "POST") {
      if (!requireAdmin(headers)) return error(403, "Administrator access required.");
      if (!data || !validText(data.email) || !validText(data.password) || data.password.length < 12 || typeof data.isAdmin !== "boolean") return error(400, "Use an email, a password of at least 12 characters, and an administrator setting.");
      if (store.hasEmail(data.email)) return error(409, "That email is already in use.");
      try {
        return json(201, { user: userView(await store.addUser({ email: data.email, password: data.password, isAdmin: data.isAdmin, tenantId: user.tenantId })) });
      } catch (reason) {
        if (reason?.message === "User email must be globally unique.") return error(409, "That email is already in use.");
        throw reason;
      }
    }
    const managedUser = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (managedUser && method === "PATCH") {
      const admin = requireAdmin(headers); if (!admin) return error(403, "Administrator access required.");
      const target = store.users.get(Number(managedUser[1])); if (!target || target.tenantId !== admin.tenantId) return error(404, "Not found.");
      if (!data || typeof data.isAdmin !== "boolean") return error(400, "Invalid administrator setting.");
      if (target.id === admin.id) return error(400, "Administrators cannot change their own role.");
      if (!data.isAdmin && target.isAdmin && [...store.users.values()].filter((entry) => entry.tenantId === admin.tenantId && entry.isAdmin).length === 1) return error(400, "Keep at least one administrator.");
      target.isAdmin = data.isAdmin; return json(200, { user: userView(target) });
    }
    if (managedUser && method === "DELETE") {
      const admin = requireAdmin(headers); if (!admin) return error(403, "Administrator access required.");
      const target = store.users.get(Number(managedUser[1])); if (!target || target.tenantId !== admin.tenantId) return error(404, "Not found.");
      if (target.id === admin.id) return error(400, "Administrators cannot delete themselves.");
      if (target.isAdmin && [...store.users.values()].filter((entry) => entry.tenantId === admin.tenantId && entry.isAdmin).length === 1) return error(400, "Keep at least one administrator.");
      store.users.delete(target.id); store.usersByEmail.delete(target.email); for (const [token, session] of sessions) if (session.userId === target.id) sessions.delete(token);
      return { status: 204, headers: {}, body: "" };
    }
    return error(404, "Not found.");
  }
  return { handle, store, sessions };
}

function createBootstrapSeed(env = process.env) {
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = env;
  if (email === undefined && password === undefined) return {};
  if (!validText(email) || !validText(password)) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must both be non-empty to create the bootstrap administrator.");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters long.");
  return { users: [{ email, password, isAdmin: true }] };
}

function createAppServer(app, { maxRequestBodySize = MAX_REQUEST_BODY_SIZE } = {}) {
  return createServer((req, res) => {
    let bytes = 0;
    let finished = false;
    const chunks = [];
    const send = (response) => {
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    };
    req.on("data", (chunk) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > maxRequestBodySize) {
        finished = true;
        req.resume();
        send(error(413, "Request body too large."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (finished) return;
      finished = true;
      try {
        send(await app.handle({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") }));
      } catch {
        send(error(500, "Internal server error."));
      }
    });
  });
}

async function start() {
  const seed = createBootstrapSeed();
  const app = await createApp({ store: await createStore(seed) });
  return createAppServer(app).listen(process.env.PORT || 3000);
}
if (require.main === module) start().catch((reason) => { process.nextTick(() => { throw reason; }); });
module.exports = { createApp, createAppServer, createBootstrapSeed, createStore, hashPassword, passwordMatches, canonicalEmail };
