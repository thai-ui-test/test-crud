"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, createAppServer, createBootstrapSeed, createStore } = require("../server");
const { PassThrough } = require("node:stream");

async function fixture() {
  return createApp({ store: await createStore({ users: [
    { email: "admin@acme.test", password: "correct horse battery staple", isAdmin: true, tenantId: "acme" },
    { email: "member@acme.test", password: "correct horse battery staple", tenantId: "acme" },
    { email: "other@other.test", password: "correct horse battery staple", isAdmin: true, tenantId: "other" },
  ] }) });
}
async function login(app, email) {
  const response = await app.handle({ method: "POST", url: "/api/session", body: JSON.stringify({ email, password: "correct horse battery staple" }) });
  assert.equal(response.status, 200);
  return response.headers["set-cookie"].split(";")[0];
}
const call = (app, method, url, cookie, body) => app.handle({ method, url, headers: cookie ? { cookie } : {}, body: body && JSON.stringify(body) });

function request(server, { method, path, headers = {} }, body = "") {
  return new Promise((resolve) => {
    const req = new PassThrough();
    Object.assign(req, { method, url: path, headers });
    const response = {
      writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; },
      end(responseBody) { resolve({ status: this.status, headers: this.headers, body: responseBody }); },
    };
    server.emit("request", req, response);
    req.end(body);
  });
}

test("pages and data routes require an authenticated session", async () => {
  const app = await fixture();
  assert.equal((await call(app, "GET", "/")).status, 302);
  assert.equal((await call(app, "GET", "/api/inventory")).status, 401);
  assert.equal((await call(app, "POST", "/api/employees", null, { name: "No", email: "no@test" })).status, 401);
});

test("non-administrators cannot manage users even when sending administrator fields", async () => {
  const app = await fixture(), member = await login(app, "member@acme.test");
  assert.equal((await call(app, "GET", "/api/admin/users", member)).status, 403);
  assert.equal((await call(app, "POST", "/api/admin/users", member, { email: "attacker@test", password: "long enough password", isAdmin: true })).status, 403);
  assert.equal((await call(app, "DELETE", "/api/admin/users/1", member)).status, 403);
});

test("administrators manage only their tenant and safe deletion retains assignments", async () => {
  const app = await fixture(), admin = await login(app, "admin@acme.test");
  const create = await call(app, "POST", "/api/admin/users", admin, { email: "new@acme.test", password: "correct horse battery staple", isAdmin: false });
  assert.equal(create.status, 201); assert.equal(JSON.parse(create.body).user.password, undefined);
  const newUser = await login(app, "new@acme.test");
  assert.equal((await call(app, "DELETE", "/api/admin/users/3", admin)).status, 404, "other tenant is invisible");
  assert.equal((await call(app, "DELETE", "/api/admin/users/1", admin)).status, 400, "admin cannot delete self");
  assert.equal((await call(app, "DELETE", "/api/admin/users/4", admin)).status, 204);
  assert.equal((await call(app, "GET", "/api/me", newUser)).status, 401, "deleted user sessions are revoked");
  const employee = await call(app, "POST", "/api/employees", admin, { name: "Sam", email: "sam@acme.test" });
  const item = await call(app, "POST", "/api/inventory", admin, { name: "Tape", description: "Packing tape", status: "In stock" });
  await call(app, "PUT", "/api/inventory/1/assignment", admin, { employeeId: JSON.parse(employee.body).employee.id });
  assert.equal((await call(app, "DELETE", "/api/employees/1", admin)).status, 204);
  const inventory = await call(app, "GET", "/api/inventory", admin);
  assert.equal(JSON.parse(inventory.body).inventory[0].employeeId, null);
  assert.equal(JSON.parse(item.body).item.name, "Tape");
});

test("inventory reads and mutations do not cross the authenticated tenant boundary", async () => {
  const app = await fixture(), acme = await login(app, "admin@acme.test"), other = await login(app, "other@other.test");
  assert.equal((await call(app, "POST", "/api/inventory", acme, { name: "Acme item", description: "Tenant data", status: "In stock" })).status, 201);
  assert.deepEqual(JSON.parse((await call(app, "GET", "/api/inventory", other)).body).inventory, []);
  assert.equal((await call(app, "DELETE", "/api/inventory/1", other)).status, 404);
});

test("last administrator cannot be revoked or deleted", async () => {
  const app = await fixture(), admin = await login(app, "admin@acme.test");
  const created = await call(app, "POST", "/api/admin/users", admin, { email: "second@acme.test", password: "long enough password", isAdmin: true });
  const secondId = JSON.parse(created.body).user.id;
  assert.equal((await call(app, "PATCH", `/api/admin/users/${secondId}`, admin, { isAdmin: false })).status, 200);
  assert.equal((await call(app, "PATCH", "/api/admin/users/1", admin, { isAdmin: false })).status, 400);
});

test("session cookies are secure and sessions expire server-side", async () => {
  let clock = 0;
  const app = await createApp({ store: await createStore({ users: [{ email: "admin@test", password: "correct horse battery staple", isAdmin: true }] }), sessionTtlMs: 1_000, now: () => clock });
  const cookie = await login(app, "admin@test");
  const loginResponse = await app.handle({ method: "POST", url: "/api/session", body: JSON.stringify({ email: "admin@test", password: "correct horse battery staple" }) });
  assert.match(loginResponse.headers["set-cookie"], /; Secure;/);
  const logout = await app.handle({ method: "DELETE", url: "/api/session", headers: { cookie } });
  assert.match(logout.headers["set-cookie"], /; Secure;/);
  const renewedCookie = await login(app, "admin@test");
  clock = 1_000;
  assert.equal((await call(app, "GET", "/api/me", renewedCookie)).status, 401);
});

test("user email identities are canonical and globally unique", async () => {
  await assert.rejects(
    createStore({ users: [
      { email: " Admin@Acme.Test ", password: "correct horse battery staple" },
      { email: "admin@acme.test", password: "correct horse battery staple" },
    ] }),
    /globally unique/,
  );
  const app = await fixture();
  const admin = await login(app, " ADMIN@ACME.TEST ");
  const duplicate = await call(app, "POST", "/api/admin/users", admin, {
    email: " OTHER@OTHER.TEST ", password: "correct horse battery staple", isAdmin: false,
  });
  assert.equal(duplicate.status, 409, "an identity cannot be reused in another tenant");
  const created = await call(app, "POST", "/api/admin/users", admin, {
    email: " New@Acme.Test ", password: "correct horse battery staple", isAdmin: false,
  });
  assert.equal(JSON.parse(created.body).user.email, "new@acme.test");
});

test("unknown logins return the same invalid-credentials response", async () => {
  const app = await fixture();
  const unknown = await app.handle({ method: "POST", url: "/api/session", body: JSON.stringify({ email: "missing@test", password: "correct horse battery staple" }) });
  const wrongPassword = await app.handle({ method: "POST", url: "/api/session", body: JSON.stringify({ email: "admin@acme.test", password: "wrong password value" }) });
  assert.equal(unknown.status, 401);
  assert.deepEqual(JSON.parse(unknown.body), JSON.parse(wrongPassword.body));
});

test("createApp resolves a promised store", async () => {
  const app = await createApp({ store: createStore({ users: [
    { email: "admin@test", password: "correct horse battery staple", isAdmin: true },
  ] }) });
  assert.equal((await app.handle({ method: "POST", url: "/api/session", body: JSON.stringify({ email: "admin@test", password: "correct horse battery staple" }) })).status, 200);
});

test("a user deleted during password verification cannot receive a session", async () => {
  const app = await fixture();
  const admin = await login(app, "admin@acme.test");
  const loginInFlight = app.handle({ method: "POST", url: "/api/session", body: JSON.stringify({ email: "member@acme.test", password: "correct horse battery staple" }) });
  assert.equal((await call(app, "DELETE", "/api/admin/users/2", admin)).status, 204);
  const response = await loginInFlight;
  assert.equal(response.status, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Invalid email or password." });
  assert.equal(app.sessions.size, 1, "the in-flight login did not create a session");
});

test("direct application requests over 64 KiB are rejected", async () => {
  const response = await (await fixture()).handle({ method: "POST", url: "/api/session", body: "x".repeat(64 * 1024 + 1) });
  assert.equal(response.status, 413);
  assert.deepEqual(JSON.parse(response.body), { error: "Request body too large." });
});

test("successful login purges expired sessions", async () => {
  let clock = 0;
  const app = await createApp({ store: await createStore({ users: [{ email: "admin@test", password: "correct horse battery staple", isAdmin: true }] }), sessionTtlMs: 1, now: () => clock });
  await login(app, "admin@test");
  assert.equal(app.sessions.size, 1);
  clock = 1;
  await login(app, "admin@test");
  assert.equal(app.sessions.size, 1);
});

test("malformed request targets return a client error", async () => {
  const response = await (await fixture()).handle({ method: "GET", url: "http://[", headers: {} });
  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "Malformed request target." });
});

test("HTTP server rejects oversized bodies before unauthenticated route processing", async () => {
  const server = createAppServer(await fixture(), { maxRequestBodySize: 32 });
  const response = await request(server, { method: "POST", path: "/api/session", headers: { "content-type": "application/json" } }, "x".repeat(33));
  assert.equal(response.status, 413);
  assert.deepEqual(JSON.parse(response.body), { error: "Request body too large." });
});

test("bootstrap administrator credentials require a 12-character password", () => {
  assert.throws(() => createBootstrapSeed({ ADMIN_EMAIL: "admin@test", ADMIN_PASSWORD: "too-short" }), /at least 12 characters/);
  assert.throws(() => createBootstrapSeed({ ADMIN_EMAIL: "admin@test" }), /must both be non-empty/);
  assert.deepEqual(createBootstrapSeed({ ADMIN_EMAIL: "admin@test", ADMIN_PASSWORD: "long enough!" }), { users: [{ email: "admin@test", password: "long enough!", isAdmin: true }] });
});
