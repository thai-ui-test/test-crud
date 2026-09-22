const $ = (selector) => document.querySelector(selector);

const liveRegion = $("#live-region");

function announce(message) {
  liveRegion.textContent = "";
  requestAnimationFrame(() => { liveRegion.textContent = message; });
}

function textElement(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function requireTrimmed(input, message) {
  input.setCustomValidity(input.value.trim() ? "" : message);
  return input.checkValidity();
}

/* ---------------------------------------------------------------------- *
 * Authentication (browser-only demo)
 *
 * Accounts and the active session are persisted in this browser's
 * localStorage so a reload keeps you signed in. This is UI-level access
 * gating only: anyone with access to this browser's developer tools can
 * inspect or edit localStorage and bypass it. It must not be treated as
 * server-side security or used to protect real data.
 * ---------------------------------------------------------------------- */

const USERS_STORAGE_KEY = "admin-portal:users";
const SESSION_STORAGE_KEY = "admin-portal:session";
const SEED_USERNAME = "admin";
const SEED_PASSWORD = "admin123";
const UNSUPPORTED_BROWSER_MESSAGE = "This browser does not support the Web Crypto API required for secure password hashing. Please use an updated browser to continue.";

async function hashPassword(password) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error(UNSUPPORTED_BROWSER_MESSAGE);
  }
  const bytes = new TextEncoder().encode(password);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function isValidUserRecord(record) {
  return (
    record !== null &&
    typeof record === "object" &&
    Number.isInteger(record.id) &&
    typeof record.username === "string" &&
    record.username.trim().length > 0 &&
    typeof record.passwordHash === "string" &&
    record.passwordHash.startsWith("sha256:") &&
    typeof record.isAdmin === "boolean" &&
    typeof record.mustChangePassword === "boolean"
  );
}

function isValidUserStore(parsed) {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Number.isInteger(parsed.revision) ||
    parsed.revision < 0 ||
    !Array.isArray(parsed.users) ||
    parsed.users.length === 0 ||
    !parsed.users.every(isValidUserRecord)
  ) {
    return false;
  }
  const ids = new Set(parsed.users.map((user) => user.id));
  return ids.size === parsed.users.length;
}

// Distinguishes "no store yet" (safe to seed) from "store present but
// malformed or empty" (must fail closed, never silently reseed an admin
// over data that may simply have failed to parse or been tampered with).
function loadUserStore() {
  let raw;
  try {
    raw = localStorage.getItem(USERS_STORAGE_KEY);
  } catch {
    return { status: "error" };
  }
  if (raw === null) return { status: "absent" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }
  if (!isValidUserStore(parsed)) return { status: "invalid" };
  return { status: "valid", revision: parsed.revision, users: parsed.users };
}

// Revision-aware compare-and-swap write. Returns { outcome: "ok", revision }
// or { outcome: "conflict" | "invalid" | "error" }. Never writes unless the
// caller's expectedRevision still matches what's on disk, so a stale tab
// cannot clobber account data written more recently by another tab.
function saveUsers(newUsers, expectedRevision) {
  if (!Array.isArray(newUsers) || newUsers.length === 0 || !newUsers.every(isValidUserRecord)) {
    return { outcome: "invalid" };
  }
  const ids = new Set(newUsers.map((user) => user.id));
  if (ids.size !== newUsers.length) return { outcome: "invalid" };

  let raw;
  try {
    raw = localStorage.getItem(USERS_STORAGE_KEY);
  } catch {
    return { outcome: "error" };
  }

  let currentRevision = 0;
  if (raw !== null) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { outcome: "conflict" };
    }
    if (!isValidUserStore(parsed)) return { outcome: "conflict" };
    currentRevision = parsed.revision;
  }

  if (currentRevision !== expectedRevision) {
    return { outcome: "conflict" };
  }

  const nextRevision = currentRevision + 1;
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify({ revision: nextRevision, users: newUsers }));
  } catch {
    return { outcome: "error" };
  }
  return { outcome: "ok", revision: nextRevision };
}

function handleUsersSaveFailure(result, fallbackMessage) {
  if (result.outcome === "conflict") {
    if (refreshUsersFromStorage()) syncCurrentUserFromUsers();
    return "Someone else updated account data first. Please try again.";
  }
  if (result.outcome === "invalid") {
    return "Could not save: account data is invalid.";
  }
  return fallbackMessage;
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Number.isInteger(parsed.userId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

// Only clears the persisted session if it still belongs to this tab's
// currentUser, so a stale tab signing out (or being force-invalidated)
// can never erase a session another user established more recently.
function clearOwnedSession() {
  if (!currentUser) return saveSession(null);
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (raw === null) return true;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return true;
    }
    if (parsed && typeof parsed === "object" && parsed.userId === currentUser.id) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

function findUser(username) {
  const target = username.trim().toLowerCase();
  return users.find((user) => user.username.toLowerCase() === target) || null;
}

function findUserById(id) {
  return users.find((user) => user.id === id) || null;
}

function refreshUsersFromStorage() {
  const store = loadUserStore();
  if (store.status !== "valid") return false;
  users = store.users;
  usersRevision = store.revision;
  return true;
}

// Reconciles currentUser against the freshest users array by immutable id
// (never by username), so deleting a user and recreating a different
// account under the same username cannot inherit the old session or role.
function syncCurrentUserFromUsers() {
  if (!currentUser) return false;
  const match = findUserById(currentUser.id);
  if (!match) return false;
  currentUser = match;
  return true;
}

function isSessionValid() {
  if (!currentUser) return false;
  const session = loadSession();
  return !!session && session.userId === currentUser.id;
}

function requireValidSession() {
  if (isSessionValid()) return true;
  invalidateSessionAndSignOut("Your session is no longer valid. Please sign in again.");
  return false;
}

function refreshAndValidateAdmin() {
  if (!isSessionValid()) return false;
  if (!refreshUsersFromStorage()) return false;
  if (!syncCurrentUserFromUsers()) return false;
  return currentUser.isAdmin === true;
}

let users = [];
let usersRevision = 0;
let currentUser = null;
let activePanel = "inventory";

const loginView = $("#login-view");
const loginForm = $("#login-form");
const loginUsernameInput = $("#login-username");
const loginPasswordInput = $("#login-password");
const loginSubmitButton = $("#login-submit");
const loginError = $("#login-error");

const passwordChangeView = $("#password-change-view");
const passwordChangeHeading = $("#password-change-heading");
const passwordChangeForm = $("#password-change-form");
const newPasswordInput = $("#new-password");
const confirmPasswordInput = $("#confirm-password");
const passwordChangeError = $("#password-change-error");

const appView = $("#app-view");
const currentUserLabel = $("#current-user-label");
const signOutButton = $("#sign-out-button");
const navButtons = Array.from(document.querySelectorAll(".nav-link"));
const navUsersButton = $("#nav-users");

function showFieldError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

function showView(view) {
  loginView.hidden = view !== "login";
  passwordChangeView.hidden = view !== "password-change";
  appView.hidden = view !== "app";
}

function disableLoginForm() {
  loginUsernameInput.disabled = true;
  loginPasswordInput.disabled = true;
  loginSubmitButton.disabled = true;
}

function resetLoginForm() {
  loginForm.reset();
  showFieldError(loginError, "");
}

function enterLogin() {
  currentUser = null;
  showView("login");
  resetLoginForm();
  loginUsernameInput.focus();
}

function enterPasswordChange() {
  passwordChangeForm.reset();
  showFieldError(passwordChangeError, "");
  showView("password-change");
  passwordChangeHeading.focus();
}

function enterApp() {
  showView("app");
  currentUserLabel.textContent = `Signed in as ${currentUser.username}${currentUser.isAdmin ? " (administrator)" : ""}`;
  navUsersButton.hidden = !currentUser.isAdmin;
  if (activePanel === "users" && !currentUser.isAdmin) activePanel = "inventory";
  switchPanel(activePanel, { focus: false });
  renderInventory();
  renderEmployees();
  renderUsers();
}

function switchPanel(panel, { focus = true } = {}) {
  if (!currentUser) return;
  if (panel === "users" && !currentUser?.isAdmin) panel = "inventory";
  activePanel = panel;
  navButtons.forEach((button) => {
    const isActive = button.dataset.panel === panel;
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".panel").forEach((section) => {
    section.hidden = section.id !== `panel-${panel}`;
  });
  if (focus) {
    const heading = document.querySelector(`#panel-${panel} h2`);
    heading?.focus();
  }
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => switchPanel(button.dataset.panel));
});

async function establishSessionFor(user, { forcePasswordChange }) {
  const previousUser = currentUser;
  currentUser = user;
  if (!saveSession({ userId: user.id })) {
    currentUser = previousUser;
    showFieldError(loginError, "Could not start your session. Please try again.");
    return;
  }
  if (forcePasswordChange) enterPasswordChange();
  else enterApp();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showFieldError(loginError, "");
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;
  if (!username || !password) {
    showFieldError(loginError, "Enter a username and password.");
    (username ? loginPasswordInput : loginUsernameInput).focus();
    return;
  }
  const user = findUser(username);
  let hashed;
  try {
    hashed = await hashPassword(password);
  } catch {
    showFieldError(loginError, UNSUPPORTED_BROWSER_MESSAGE);
    return;
  }
  if (!user || user.passwordHash !== hashed) {
    showFieldError(loginError, "Invalid username or password.");
    loginPasswordInput.value = "";
    loginPasswordInput.focus();
    return;
  }
  await establishSessionFor(user, { forcePasswordChange: user.mustChangePassword });
});

passwordChangeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showFieldError(passwordChangeError, "");
  if (!requireValidSession()) return;

  const next = newPasswordInput.value;
  const confirm = confirmPasswordInput.value;
  if (next.length < 8) {
    showFieldError(passwordChangeError, "New password must be at least 8 characters.");
    newPasswordInput.focus();
    return;
  }
  if (next !== confirm) {
    showFieldError(passwordChangeError, "Passwords do not match.");
    confirmPasswordInput.value = "";
    confirmPasswordInput.focus();
    return;
  }

  let nextHash;
  try {
    nextHash = await hashPassword(next);
  } catch {
    showFieldError(passwordChangeError, UNSUPPORTED_BROWSER_MESSAGE);
    return;
  }

  if (!isSessionValid() || !refreshUsersFromStorage() || !syncCurrentUserFromUsers()) {
    invalidateSessionAndSignOut("Your session is no longer valid. Please sign in again.");
    return;
  }

  if (nextHash === currentUser.passwordHash) {
    showFieldError(passwordChangeError, "New password must be different from your current temporary password.");
    newPasswordInput.value = "";
    confirmPasswordInput.value = "";
    newPasswordInput.focus();
    return;
  }

  const nextUsers = users.map((record) =>
    record.id === currentUser.id ? { ...record, passwordHash: nextHash, mustChangePassword: false } : record
  );
  const result = saveUsers(nextUsers, usersRevision);
  if (result.outcome !== "ok") {
    showFieldError(passwordChangeError, handleUsersSaveFailure(result, "Could not save your new password. Please try again."));
    return;
  }
  users = nextUsers;
  usersRevision = result.revision;
  currentUser = findUserById(currentUser.id);
  announce("Password updated.");
  enterApp();
});

signOutButton.addEventListener("click", () => {
  const cleared = clearOwnedSession();
  currentUser = null;
  if (cleared) announce("Signed out.");
  else announce("Signed out, but the session could not be cleared from browser storage.");
  enterLogin();
});

function invalidateSessionAndSignOut(message) {
  clearOwnedSession();
  currentUser = null;
  enterLogin();
  announce(message);
}

window.addEventListener("storage", (event) => {
  if (!currentUser) return;
  const isUsersKey = event.key === USERS_STORAGE_KEY || event.key === null;
  const isSessionKey = event.key === SESSION_STORAGE_KEY || event.key === null;
  if (!isUsersKey && !isSessionKey) return;

  if (isSessionKey) {
    const session = loadSession();
    if (!session || session.userId !== currentUser.id) {
      invalidateSessionAndSignOut("You were signed out because your session changed in another tab.");
      return;
    }
  }

  if (isUsersKey) {
    if (!refreshUsersFromStorage()) {
      invalidateSessionAndSignOut("You were signed out because account data could not be verified.");
      return;
    }
  }

  const previousIsAdmin = currentUser.isAdmin;
  if (!syncCurrentUserFromUsers()) {
    invalidateSessionAndSignOut("You were signed out because your account no longer exists.");
    return;
  }
  const lostAdmin = previousIsAdmin && !currentUser.isAdmin;
  if (lostAdmin) {
    invalidateSessionAndSignOut("You were signed out because your administrator access was revoked in another tab.");
    return;
  }
  navUsersButton.hidden = !currentUser.isAdmin;
  if (activePanel === "users" && !currentUser.isAdmin) switchPanel("inventory");
  if (!appView.hidden) renderUsers();
});

/* ---------------------------------------------------------------------- *
 * User management (administrators only)
 *
 * Every action re-checks currentUser.isAdmin before touching data, so
 * revealing this panel's markup through devtools is not enough to act on
 * it without an authenticated administrator session.
 * ---------------------------------------------------------------------- */

const userCreateForm = $("#user-create-form");
const newUsernameInput = $("#new-username");
const newUserPasswordInput = $("#new-user-password");
const newUserConfirmPasswordInput = $("#new-user-confirm-password");
const newUserIsAdminInput = $("#new-user-is-admin");
const userCreateSubmitButton = $("#user-create-submit");
const userCreateError = $("#user-create-error");
const usersEmptyMessage = $("#users-empty-message");
const usersTableWrapper = $("#users-table-wrapper");
const usersTableBody = $("#users-table-body");

function nextUserId() {
  return users.reduce((max, user) => Math.max(max, user.id), 0) + 1;
}

function adminCount() {
  return users.filter((user) => user.isAdmin).length;
}

function renderUsers() {
  usersTableBody.replaceChildren();
  if (!currentUser?.isAdmin) {
    usersEmptyMessage.hidden = true;
    usersTableWrapper.hidden = true;
    return;
  }
  usersEmptyMessage.hidden = users.length > 0;
  usersTableWrapper.hidden = users.length === 0;
  users.forEach((user) => {
    const row = document.createElement("tr");
    row.append(textElement("td", user.username), textElement("td", user.isAdmin ? "Administrator" : "User"));

    const actions = document.createElement("td");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-ghost";
    toggle.textContent = user.isAdmin ? "Revoke admin" : "Make admin";
    toggle.setAttribute("aria-label", `${user.isAdmin ? "Revoke administrator access from" : "Grant administrator access to"} ${user.username}`);
    toggle.dataset.userToggle = user.id;
    toggle.addEventListener("click", () => toggleAdmin(user.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-danger";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${user.username}`);
    remove.dataset.userDelete = user.id;
    remove.addEventListener("click", () => deleteUser(user.id));
    if (currentUser && user.id === currentUser.id) remove.disabled = true;

    actions.append(toggle, remove);
    row.append(actions);
    usersTableBody.append(row);
  });
}

function toggleAdmin(id) {
  if (!currentUser) return;
  if (!refreshAndValidateAdmin()) {
    announce("Your administrator session is no longer valid.");
    renderUsers();
    return;
  }
  const user = findUserById(id);
  if (!user) {
    renderUsers();
    return;
  }
  if (user.isAdmin && adminCount() <= 1) {
    announce(`Cannot revoke administrator access: ${user.username} is the last remaining administrator.`);
    return;
  }
  const nextUsers = users.map((record) => (record.id === id ? { ...record, isAdmin: !record.isAdmin } : record));
  const result = saveUsers(nextUsers, usersRevision);
  if (result.outcome !== "ok") {
    announce(handleUsersSaveFailure(result, "Could not save the role change. Please try again."));
    renderUsers();
    return;
  }
  users = nextUsers;
  usersRevision = result.revision;
  const updated = findUserById(id);
  if (currentUser.id === id) currentUser = { ...currentUser, isAdmin: updated.isAdmin };
  announce(`${updated.username} is ${updated.isAdmin ? "now an administrator" : "no longer an administrator"}.`);
  if (!currentUser.isAdmin) {
    navUsersButton.hidden = true;
    switchPanel("inventory");
    renderUsers();
  } else {
    renderUsers();
    $(`[data-user-toggle="${id}"]`)?.focus();
  }
}

function deleteUser(id) {
  if (!currentUser) return;
  if (!refreshAndValidateAdmin()) {
    announce("Your administrator session is no longer valid.");
    renderUsers();
    return;
  }
  const user = findUserById(id);
  if (!user) {
    renderUsers();
    return;
  }
  if (currentUser.id === user.id) {
    announce("You cannot delete the account you are currently signed in with.");
    return;
  }
  if (!window.confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;

  // Storage may have changed while the confirm() dialog was open, so
  // revalidate the session/role and re-locate the target by id before
  // committing the delete.
  if (!refreshAndValidateAdmin()) {
    announce("Your administrator session is no longer valid.");
    renderUsers();
    return;
  }
  const target = findUserById(id);
  if (!target) {
    announce("That user no longer exists.");
    renderUsers();
    return;
  }
  if (currentUser.id === target.id) {
    announce("You cannot delete the account you are currently signed in with.");
    return;
  }

  const index = users.findIndex((record) => record.id === target.id);
  const nextUsers = users.slice();
  nextUsers.splice(index, 1);
  const result = saveUsers(nextUsers, usersRevision);
  if (result.outcome !== "ok") {
    announce(handleUsersSaveFailure(result, "Could not delete the user. Please try again."));
    renderUsers();
    return;
  }
  users = nextUsers;
  usersRevision = result.revision;
  const focusId = users[Math.min(index, users.length - 1)]?.id;
  renderUsers();
  (focusId ? $(`[data-user-toggle="${focusId}"]`) : newUsernameInput).focus();
  announce(`${target.username} deleted.${users.length ? "" : " No user accounts remain."}`);
}

userCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showFieldError(userCreateError, "");
  if (!currentUser?.isAdmin) return;

  const username = newUsernameInput.value.trim();
  const password = newUserPasswordInput.value;
  const confirmPassword = newUserConfirmPasswordInput.value;
  const isAdmin = newUserIsAdminInput.checked;

  if (!username) {
    showFieldError(userCreateError, "Enter a username.");
    newUsernameInput.focus();
    return;
  }
  if (findUser(username)) {
    showFieldError(userCreateError, `The username "${username}" is already in use.`);
    newUsernameInput.focus();
    return;
  }
  if (password.length < 8) {
    showFieldError(userCreateError, "Password must be at least 8 characters.");
    newUserPasswordInput.focus();
    return;
  }
  if (password !== confirmPassword) {
    showFieldError(userCreateError, "Passwords do not match.");
    newUserConfirmPasswordInput.value = "";
    newUserConfirmPasswordInput.focus();
    return;
  }

  userCreateSubmitButton.disabled = true;
  let passwordHash;
  try {
    passwordHash = await hashPassword(password);
  } catch {
    showFieldError(userCreateError, UNSUPPORTED_BROWSER_MESSAGE);
    userCreateSubmitButton.disabled = false;
    return;
  }

  if (!refreshAndValidateAdmin()) {
    showFieldError(userCreateError, "Your administrator session is no longer valid.");
    userCreateSubmitButton.disabled = false;
    renderUsers();
    return;
  }
  if (findUser(username)) {
    showFieldError(userCreateError, `The username "${username}" is already in use.`);
    newUsernameInput.focus();
    userCreateSubmitButton.disabled = false;
    return;
  }

  const newUser = {
    id: nextUserId(),
    username,
    passwordHash,
    isAdmin,
    mustChangePassword: false,
  };
  const nextUsers = [...users, newUser];
  const result = saveUsers(nextUsers, usersRevision);
  if (result.outcome !== "ok") {
    showFieldError(userCreateError, handleUsersSaveFailure(result, "Could not save the new user. Please try again."));
    userCreateSubmitButton.disabled = false;
    renderUsers();
    return;
  }
  users = nextUsers;
  usersRevision = result.revision;
  userCreateForm.reset();
  userCreateSubmitButton.disabled = false;
  renderUsers();
  newUsernameInput.focus();
  announce(`${newUser.username} added${newUser.isAdmin ? " as an administrator" : ""}.`);
});

/* ---------------------------------------------------------------------- *
 * Inventory & employee CRUD (kept in memory only, as before)
 * ---------------------------------------------------------------------- */

const inventoryForm = $("#inventory-form");
const inventoryFormHeading = $("#inventory-form-heading");
const recordIdInput = $("#record-id");
const nameInput = $("#name");
const descriptionInput = $("#description");
const statusInput = $("#status");
const submitButton = $("#submit-button");
const cancelButton = $("#cancel-button");
const inventoryList = $("#inventory-list");
const emptyMessage = $("#empty-message");
const employeeForm = $("#employee-form");
const employeeFormHeading = $("#employee-form-heading");
const employeeIdInput = $("#employee-id");
const employeeNameInput = $("#employee-name");
const employeeEmailInput = $("#employee-email");
const employeeSubmitButton = $("#employee-submit-button");
const employeeCancelButton = $("#employee-cancel-button");
const employeesEmptyMessage = $("#employees-empty-message");
const employeesTableWrapper = $("#employees-table-wrapper");
const employeesTableBody = $("#employees-table-body");

let inventory = [];
let employees = [];
let nextInventoryId = 1;
let nextEmployeeId = 1;

function resetInventoryForm() {
  inventoryForm.reset();
  recordIdInput.value = "";
  inventoryFormHeading.textContent = "Add an inventory item";
  submitButton.textContent = "Add item";
  cancelButton.hidden = true;
  nameInput.setCustomValidity("");
  descriptionInput.setCustomValidity("");
  inventoryForm.dataset.dirty = "false";
}

function startEditingItem(item) {
  if (!requireValidSession()) return;
  const hasDraft = inventoryForm.dataset.dirty === "true";
  if (hasDraft && !window.confirm("Discard the current inventory draft?")) return;
  recordIdInput.value = item.id;
  nameInput.value = item.name;
  descriptionInput.value = item.description;
  statusInput.value = item.status;
  inventoryFormHeading.textContent = "Edit inventory item";
  submitButton.textContent = "Save changes";
  cancelButton.hidden = false;
  nameInput.setCustomValidity("");
  descriptionInput.setCustomValidity("");
  nameInput.focus();
  inventoryForm.dataset.dirty = "false";
}

function deleteItem(id) {
  if (!requireValidSession()) return;
  const index = inventory.findIndex((item) => item.id === id);
  if (index < 0) return;
  const item = inventory[index];
  if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return;
  const [removed] = inventory.splice(index, 1);
  if (recordIdInput.value === String(id)) resetInventoryForm();
  const focusId = inventory[Math.min(index, inventory.length - 1)]?.id;
  renderInventory();
  (focusId ? $(`[data-item-edit="${focusId}"]`) : nameInput).focus();
  announce(`${removed.name} deleted.${inventory.length ? "" : " Inventory is now empty."}`);
}

function setAssignment(itemId, employeeId) {
  if (!requireValidSession()) return;
  const item = inventory.find((record) => record.id === itemId);
  if (!item) return;
  item.employeeId = employeeId || null;
  renderInventory();
  $(`[data-assignment="${itemId}"]`).focus();
  const employee = employees.find((record) => record.id === employeeId);
  announce(employee ? `${item.name} assigned to ${employee.name}.` : `${item.name} returned to unassigned.`);
}

function renderInventory() {
  inventoryList.replaceChildren();
  emptyMessage.hidden = inventory.length > 0;
  inventory.forEach((item) => {
    const employee = employees.find((record) => record.id === item.employeeId);
    const row = document.createElement("li");
    row.className = "inventory-item";
    const heading = textElement("h3", item.name);
    const statusLine = document.createElement("p");
    const statusBadge = document.createElement("span");
    statusBadge.className = `status-badge status-${item.status.toLowerCase().replace(/\s+/g, "-")}`;
    statusBadge.textContent = item.status;
    statusLine.append("Status: ", statusBadge);
    row.append(heading, textElement("p", item.description), statusLine, textElement("p", `Assigned to: ${employee ? employee.name : "Unassigned"}`));

    const assignment = document.createElement("div");
    assignment.className = "assignment-control";
    const label = document.createElement("label");
    label.htmlFor = `assignment-${item.id}`;
    label.textContent = `Assign ${item.name}`;
    const select = document.createElement("select");
    select.id = `assignment-${item.id}`;
    select.dataset.assignment = item.id;
    select.append(new Option("Unassigned", ""));
    employees.forEach((record) => select.append(new Option(`${record.name} (${record.email})`, record.id)));
    select.value = item.employeeId || "";
    select.addEventListener("change", () => setAssignment(item.id, Number(select.value)));
    assignment.append(label, select);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-ghost";
    edit.textContent = "Edit";
    edit.dataset.itemEdit = item.id;
    edit.setAttribute("aria-label", `Edit ${item.name}`);
    edit.addEventListener("click", () => startEditingItem(item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-danger";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${item.name}`);
    remove.addEventListener("click", () => deleteItem(item.id));
    actions.append(edit, remove);
    row.append(assignment, actions);
    inventoryList.append(row);
  });
}

function resetEmployeeForm() {
  employeeForm.reset();
  employeeIdInput.value = "";
  employeeFormHeading.textContent = "Add an employee";
  employeeSubmitButton.textContent = "Add employee";
  employeeCancelButton.hidden = true;
  employeeNameInput.setCustomValidity("");
  employeeEmailInput.setCustomValidity("");
  employeeForm.dataset.dirty = "false";
}

function startEditingEmployee(employee) {
  if (!requireValidSession()) return;
  const hasDraft = employeeForm.dataset.dirty === "true";
  if (hasDraft && !window.confirm("Discard the current employee draft?")) return;
  employeeIdInput.value = employee.id;
  employeeNameInput.value = employee.name;
  employeeEmailInput.value = employee.email;
  employeeFormHeading.textContent = "Edit employee";
  employeeSubmitButton.textContent = "Save changes";
  employeeCancelButton.hidden = false;
  employeeNameInput.setCustomValidity("");
  employeeEmailInput.setCustomValidity("");
  employeeNameInput.focus();
  employeeForm.dataset.dirty = "false";
}

function deleteEmployee(id) {
  if (!requireValidSession()) return;
  const index = employees.findIndex((employee) => employee.id === id);
  if (index < 0) return;
  const employee = employees[index];
  const returnedCount = inventory.filter((item) => item.employeeId === id).length;
  const assignmentNote = returnedCount ? ` and return ${returnedCount} assigned item${returnedCount === 1 ? "" : "s"} to unassigned` : "";
  if (!window.confirm(`Delete ${employee.name}${assignmentNote}? This cannot be undone.`)) return;
  const [removed] = employees.splice(index, 1);
  inventory.forEach((item) => { if (item.employeeId === id) item.employeeId = null; });
  if (employeeIdInput.value === String(id)) resetEmployeeForm();
  const focusId = employees[Math.min(index, employees.length - 1)]?.id;
  renderEmployees();
  renderInventory();
  (focusId ? $(`[data-employee-edit="${focusId}"]`) : employeeNameInput).focus();
  const returned = returnedCount ? ` ${returnedCount} item${returnedCount === 1 ? " was" : "s were"} returned to unassigned.` : "";
  announce(`${removed.name} deleted.${returned}${employees.length ? "" : " The employee list is now empty."}`);
}

function renderEmployees() {
  employeesTableBody.replaceChildren();
  employeesEmptyMessage.hidden = employees.length > 0;
  employeesTableWrapper.hidden = employees.length === 0;
  employees.forEach((employee) => {
    const row = document.createElement("tr");
    row.append(textElement("td", employee.name), textElement("td", employee.email));
    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-ghost";
    edit.textContent = "Edit";
    edit.dataset.employeeEdit = employee.id;
    edit.setAttribute("aria-label", `Edit ${employee.name}`);
    edit.addEventListener("click", () => startEditingEmployee(employee));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-danger";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${employee.name}`);
    remove.addEventListener("click", () => deleteEmployee(employee.id));
    actions.append(edit, remove);
    row.append(actions);
    employeesTableBody.append(row);
  });
}

inventoryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireValidSession()) return;
  const validName = requireTrimmed(nameInput, "Enter an item name that is not only spaces.");
  const validDescription = requireTrimmed(descriptionInput, "Enter a description that is not only spaces.");
  if (!validName || !validDescription || !inventoryForm.checkValidity()) return inventoryForm.reportValidity();
  const values = { name: nameInput.value.trim(), description: descriptionInput.value.trim(), status: statusInput.value };
  const item = inventory.find((record) => record.id === Number(recordIdInput.value));
  if (item) Object.assign(item, values);
  else inventory.push({ id: nextInventoryId++, employeeId: null, ...values });
  resetInventoryForm();
  renderInventory();
  nameInput.focus();
  announce(`${values.name} ${item ? "updated" : "added"}.`);
});

employeeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireValidSession()) return;
  const validName = requireTrimmed(employeeNameInput, "Enter an employee name that is not only spaces.");
  const validEmail = requireTrimmed(employeeEmailInput, "Enter an email address that is not only spaces.");
  if (!validName || !validEmail || !employeeForm.checkValidity()) return employeeForm.reportValidity();
  const values = { name: employeeNameInput.value.trim(), email: employeeEmailInput.value.trim() };
  const employee = employees.find((record) => record.id === Number(employeeIdInput.value));
  if (employee) Object.assign(employee, values);
  else employees.push({ id: nextEmployeeId++, ...values });
  resetEmployeeForm();
  renderEmployees();
  renderInventory();
  employeeNameInput.focus();
  announce(`${values.name} ${employee ? "updated" : "added"}.`);
});

cancelButton.addEventListener("click", () => {
  const id = recordIdInput.value;
  resetInventoryForm();
  $(`[data-item-edit="${id}"]`)?.focus();
  announce("Inventory edit cancelled.");
});
employeeCancelButton.addEventListener("click", () => {
  const id = employeeIdInput.value;
  resetEmployeeForm();
  $(`[data-employee-edit="${id}"]`)?.focus();
  announce("Employee edit cancelled.");
});
[nameInput, descriptionInput].forEach((input) => input.addEventListener("input", () => { input.setCustomValidity(""); inventoryForm.dataset.dirty = "true"; }));
statusInput.addEventListener("change", () => { inventoryForm.dataset.dirty = "true"; });
[employeeNameInput, employeeEmailInput].forEach((input) => input.addEventListener("input", () => { input.setCustomValidity(""); employeeForm.dataset.dirty = "true"; }));

/* ---------------------------------------------------------------------- *
 * Startup: seed accounts, restore any existing session
 * ---------------------------------------------------------------------- */

async function init() {
  const store = loadUserStore();
  if (store.status === "valid") {
    users = store.users;
    usersRevision = store.revision;
  } else if (store.status === "absent") {
    // Clear any prior persisted session before seeding so a stale session
    // referencing an old userId (e.g. 1) can't auto-authenticate into the
    // newly seeded default account.
    saveSession(null);
    let seedHash;
    try {
      seedHash = await hashPassword(SEED_PASSWORD);
    } catch {
      showFieldError(loginError, UNSUPPORTED_BROWSER_MESSAGE);
      disableLoginForm();
      showView("login");
      return;
    }
    const seedUser = {
      id: 1,
      username: SEED_USERNAME,
      passwordHash: seedHash,
      isAdmin: true,
      mustChangePassword: true,
    };
    const result = saveUsers([seedUser], 0);
    if (result.outcome === "ok") {
      users = [seedUser];
      usersRevision = result.revision;
    } else if (result.outcome === "conflict") {
      // Another tab seeded concurrently: adopt whatever it wrote instead
      // of overwriting it.
      const latest = loadUserStore();
      if (latest.status === "valid") {
        users = latest.users;
        usersRevision = latest.revision;
      } else {
        showFieldError(loginError, "Account data could not be loaded. Please reload the page.");
        disableLoginForm();
        showView("login");
        return;
      }
    } else {
      showFieldError(loginError, "Account data in browser storage is invalid or unavailable. Sign-in is disabled until this is resolved.");
      disableLoginForm();
      showView("login");
      return;
    }
    // Re-clear the session after the seeding awaits: another tab may have
    // written a stale or forged session while this tab was hashing the seed
    // password or resolving a concurrent seed conflict, and that session
    // could now resolve to a real (newly seeded/adopted) user.
    if (!saveSession(null)) {
      showFieldError(loginError, "Account data in browser storage is invalid or unavailable. Sign-in is disabled until this is resolved.");
      disableLoginForm();
      showView("login");
      return;
    }
  } else {
    // status === "invalid" or "error": storage exists but is malformed,
    // empty, or unreadable. Fail closed rather than silently reseeding a
    // default admin over data that might have been tampered with.
    showFieldError(loginError, "Account data in browser storage is invalid or unavailable. Sign-in is disabled until this is resolved.");
    disableLoginForm();
    showView("login");
    return;
  }

  const session = loadSession();
  const sessionUser = session ? findUserById(session.userId) : null;
  if (sessionUser) {
    currentUser = sessionUser;
    if (sessionUser.mustChangePassword) enterPasswordChange();
    else enterApp();
  } else {
    if (session) saveSession(null);
    enterLogin();
  }
}

init();
