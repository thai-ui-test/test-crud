const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "inventory-manager-state";
const STORAGE_VERSION = 1;
const VALID_STATUSES = new Set(["In stock", "Low stock", "Out of stock"]);

const elements = {};
[
  "inventory-form", "inventory-form-heading", "record-id", "name", "description", "status", "submit-button", "cancel-button", "inventory-list", "empty-message",
  "employee-form", "employee-form-heading", "employee-id", "employee-name", "employee-email", "employee-department", "employee-submit-button", "employee-cancel-button",
  "employees-empty-message", "employees-table-wrapper", "employees-table-body", "department-form", "department-form-heading", "department-id", "department-name",
  "department-submit-button", "department-cancel-button", "departments-empty-message", "departments-table-wrapper", "departments-table-body", "app-status"
].forEach((id) => { elements[id] = document.getElementById(id); });

let inventory = [];
let employees = [];
let departments = [];
let nextInventoryId = 1;
let nextEmployeeId = 1;
let nextDepartmentId = 1;
let savingEnabled = true;

function positiveId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER ? value : null;
}

function normalizeRecords(records, makeRecord) {
  if (!Array.isArray(records)) return [];
  const ids = new Set();
  return records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const id = positiveId(record.id);
    if (!id || ids.has(id)) return [];
    const normalized = makeRecord(record, id);
    if (!normalized) return [];
    ids.add(id);
    return [normalized];
  });
}

function safeCounter(value, records) {
  const highest = records.reduce((current, record) => Math.max(current, record.id), 0);
  const minimum = highest < Number.MAX_SAFE_INTEGER ? highest + 1 : null;
  if (minimum === null) return null;
  const counter = positiveId(value);
  if (counter && counter < Number.MAX_SAFE_INTEGER && counter >= minimum) return counter;
  return minimum && minimum < Number.MAX_SAFE_INTEGER ? minimum : null;
}

function loadState() {
  let stored;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    stored = JSON.parse(raw);
  } catch (error) {
    console.warn("Saved inventory data could not be loaded.", error);
    return;
  }
  if (!stored || typeof stored !== "object") return;
  if (Object.prototype.hasOwnProperty.call(stored, "version") && stored.version !== STORAGE_VERSION) {
    savingEnabled = false;
    return;
  }
  const data = stored.state && typeof stored.state === "object" ? stored.state : stored;
  inventory = normalizeRecords(data.inventory, (record, id) => {
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    if (!name || !description) return null;
    return { id, name, description, status: VALID_STATUSES.has(record.status) ? record.status : "In stock", employeeId: positiveId(record.employeeId) };
  });
  departments = normalizeRecords(data.departments, (record, id) => {
    const name = typeof record.name === "string" ? record.name.trim() : "";
    return name ? { id, name } : null;
  });
  employees = normalizeRecords(data.employees, (record, id) => {
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const email = typeof record.email === "string" ? record.email.trim() : "";
    return name && email ? { id, name, email, departmentId: positiveId(record.departmentId) } : null;
  });
  const employeeIds = new Set(employees.map(({ id }) => id));
  const departmentIds = new Set(departments.map(({ id }) => id));
  inventory.forEach((item) => { if (!employeeIds.has(item.employeeId)) item.employeeId = null; });
  employees.forEach((employee) => { if (!departmentIds.has(employee.departmentId)) employee.departmentId = null; });
  const counters = data.counters && typeof data.counters === "object" ? data.counters : data;
  nextInventoryId = safeCounter(counters.nextInventoryId, inventory);
  nextEmployeeId = safeCounter(counters.nextEmployeeId, employees);
  nextDepartmentId = safeCounter(counters.nextDepartmentId, departments);
}

function saveState() {
  if (!savingEnabled) return;
  const state = { version: STORAGE_VERSION, state: { inventory, employees, departments, counters: { nextInventoryId, nextEmployeeId, nextDepartmentId } } };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Inventory data could not be saved.", error);
    announce("Changes were made, but could not be saved in this browser.");
  }
}

function announce(message) {
  elements["app-status"].textContent = "";
  requestAnimationFrame(() => { elements["app-status"].textContent = message; });
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

function resetInventoryForm() {
  elements["inventory-form"].reset();
  elements["record-id"].value = "";
  elements["inventory-form-heading"].textContent = "Add an inventory item";
  elements["submit-button"].textContent = "Add item";
  elements["cancel-button"].hidden = true;
  elements.name.setCustomValidity("");
  elements.description.setCustomValidity("");
  elements["inventory-form"].dataset.dirty = "false";
}

function startEditingItem(item) {
  if (elements["inventory-form"].dataset.dirty === "true" && !confirm("Discard the current inventory draft?")) return;
  elements["record-id"].value = item.id;
  elements.name.value = item.name;
  elements.description.value = item.description;
  elements.status.value = item.status;
  elements["inventory-form-heading"].textContent = "Edit inventory item";
  elements["submit-button"].textContent = "Save changes";
  elements["cancel-button"].hidden = false;
  elements.name.setCustomValidity("");
  elements.description.setCustomValidity("");
  elements.name.focus();
  elements["inventory-form"].dataset.dirty = "false";
}

function deleteItem(id) {
  const index = inventory.findIndex((item) => item.id === id);
  if (index < 0 || !confirm(`Delete ${inventory[index].name}? This cannot be undone.`)) return;
  const [item] = inventory.splice(index, 1);
  if (elements["record-id"].value === String(id)) resetInventoryForm();
  const focusId = inventory[Math.min(index, inventory.length - 1)]?.id;
  saveState();
  renderInventory();
  (focusId ? $(`[data-item-edit="${focusId}"]`) : elements.name).focus();
  announce(`${item.name} deleted.${inventory.length ? "" : " Inventory is now empty."}`);
}

function setAssignment(itemId, employeeId) {
  const item = inventory.find(({ id }) => id === itemId);
  if (!item) return;
  item.employeeId = employees.some(({ id }) => id === employeeId) ? employeeId : null;
  saveState();
  renderInventory();
  $(`[data-assignment="${itemId}"]`).focus();
  const employee = employees.find(({ id }) => id === item.employeeId);
  announce(employee ? `${item.name} assigned to ${employee.name}.` : `${item.name} returned to unassigned.`);
}

function renderInventory() {
  elements["inventory-list"].replaceChildren();
  elements["empty-message"].hidden = inventory.length > 0;
  inventory.forEach((item) => {
    const employee = employees.find(({ id }) => id === item.employeeId);
    const row = document.createElement("li");
    row.className = "inventory-item";
    row.append(textElement("h3", item.name), textElement("p", item.description), textElement("p", `Status: ${item.status}`), textElement("p", `Assigned to: ${employee ? employee.name : "Unassigned"}`));
    const assignment = document.createElement("div");
    assignment.className = "assignment-control";
    const label = textElement("label", `Assign ${item.name}`);
    label.htmlFor = `assignment-${item.id}`;
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
    const edit = textElement("button", "Edit");
    edit.type = "button";
    edit.dataset.itemEdit = item.id;
    edit.setAttribute("aria-label", `Edit ${item.name}`);
    edit.addEventListener("click", () => startEditingItem(item));
    const remove = textElement("button", "Delete");
    remove.type = "button";
    remove.setAttribute("aria-label", `Delete ${item.name}`);
    remove.addEventListener("click", () => deleteItem(item.id));
    actions.append(edit, remove);
    row.append(assignment, actions);
    elements["inventory-list"].append(row);
  });
}

function populateDepartmentSelect(selectedId) {
  const selection = selectedId === undefined ? elements["employee-department"].value : selectedId;
  elements["employee-department"].replaceChildren(new Option("No department", ""));
  departments.forEach((department) => elements["employee-department"].append(new Option(department.name, department.id)));
  elements["employee-department"].value = departments.some(({ id }) => String(id) === String(selection)) ? selection : "";
}

function resetEmployeeForm() {
  elements["employee-form"].reset();
  elements["employee-id"].value = "";
  populateDepartmentSelect("");
  elements["employee-form-heading"].textContent = "Add an employee";
  elements["employee-submit-button"].textContent = "Add employee";
  elements["employee-cancel-button"].hidden = true;
  elements["employee-name"].setCustomValidity("");
  elements["employee-email"].setCustomValidity("");
  elements["employee-form"].dataset.dirty = "false";
}

function startEditingEmployee(employee) {
  if (elements["employee-form"].dataset.dirty === "true" && !confirm("Discard the current employee draft?")) return;
  elements["employee-id"].value = employee.id;
  elements["employee-name"].value = employee.name;
  elements["employee-email"].value = employee.email;
  populateDepartmentSelect(employee.departmentId);
  elements["employee-form-heading"].textContent = "Edit employee";
  elements["employee-submit-button"].textContent = "Save changes";
  elements["employee-cancel-button"].hidden = false;
  elements["employee-name"].setCustomValidity("");
  elements["employee-email"].setCustomValidity("");
  elements["employee-name"].focus();
  elements["employee-form"].dataset.dirty = "false";
}

function deleteEmployee(id) {
  const index = employees.findIndex((employee) => employee.id === id);
  if (index < 0) return;
  const employee = employees[index];
  const returnedCount = inventory.filter((item) => item.employeeId === id).length;
  const note = returnedCount ? ` and return ${returnedCount} assigned item${returnedCount === 1 ? "" : "s"} to unassigned` : "";
  if (!confirm(`Delete ${employee.name}${note}? This cannot be undone.`)) return;
  employees.splice(index, 1);
  inventory.forEach((item) => { if (item.employeeId === id) item.employeeId = null; });
  if (elements["employee-id"].value === String(id)) resetEmployeeForm();
  const focusId = employees[Math.min(index, employees.length - 1)]?.id;
  saveState();
  renderEmployees();
  renderInventory();
  renderDepartments();
  (focusId ? $(`[data-employee-edit="${focusId}"]`) : elements["employee-name"]).focus();
  const returned = returnedCount ? ` ${returnedCount} item${returnedCount === 1 ? " was" : "s were"} returned to unassigned.` : "";
  announce(`${employee.name} deleted.${returned}${employees.length ? "" : " The employee list is now empty."}`);
}

function renderEmployees() {
  elements["employees-table-body"].replaceChildren();
  elements["employees-empty-message"].hidden = employees.length > 0;
  elements["employees-table-wrapper"].hidden = employees.length === 0;
  employees.forEach((employee) => {
    const department = departments.find(({ id }) => id === employee.departmentId);
    const row = document.createElement("tr");
    row.append(textElement("td", employee.name), textElement("td", employee.email), textElement("td", department ? department.name : "No department"));
    const actions = document.createElement("td");
    const edit = textElement("button", "Edit");
    edit.type = "button";
    edit.dataset.employeeEdit = employee.id;
    edit.setAttribute("aria-label", `Edit ${employee.name}`);
    edit.addEventListener("click", () => startEditingEmployee(employee));
    const remove = textElement("button", "Delete");
    remove.type = "button";
    remove.setAttribute("aria-label", `Delete ${employee.name}`);
    remove.addEventListener("click", () => deleteEmployee(employee.id));
    actions.append(edit, remove);
    row.append(actions);
    elements["employees-table-body"].append(row);
  });
}

function resetDepartmentForm() {
  elements["department-form"].reset();
  elements["department-id"].value = "";
  elements["department-form-heading"].textContent = "Add a department";
  elements["department-submit-button"].textContent = "Add department";
  elements["department-cancel-button"].hidden = true;
  elements["department-name"].setCustomValidity("");
  elements["department-form"].dataset.dirty = "false";
}

function startEditingDepartment(department) {
  if (elements["department-form"].dataset.dirty === "true" && !confirm("Discard the current department draft?")) return;
  elements["department-id"].value = department.id;
  elements["department-name"].value = department.name;
  elements["department-form-heading"].textContent = "Edit department";
  elements["department-submit-button"].textContent = "Save changes";
  elements["department-cancel-button"].hidden = false;
  elements["department-name"].setCustomValidity("");
  elements["department-name"].focus();
  elements["department-form"].dataset.dirty = "false";
}

function deleteDepartment(id) {
  const index = departments.findIndex((department) => department.id === id);
  if (index < 0) return;
  const department = departments[index];
  const affectedCount = employees.filter((employee) => employee.departmentId === id).length;
  const note = affectedCount ? ` This will clear the department for ${affectedCount} employee${affectedCount === 1 ? "" : "s"}.` : "";
  if (!confirm(`Delete ${department.name}?${note} This cannot be undone.`)) return;
  departments.splice(index, 1);
  employees.forEach((employee) => { if (employee.departmentId === id) employee.departmentId = null; });
  if (elements["department-id"].value === String(id)) resetDepartmentForm();
  const focusId = departments[Math.min(index, departments.length - 1)]?.id;
  saveState();
  populateDepartmentSelect();
  renderDepartments();
  renderEmployees();
  (focusId ? $(`[data-department-edit="${focusId}"]`) : elements["department-name"]).focus();
  const cleared = affectedCount ? ` ${affectedCount} employee assignment${affectedCount === 1 ? " was" : "s were"} cleared.` : "";
  announce(`${department.name} deleted.${cleared}${departments.length ? "" : " The department list is now empty."}`);
}

function renderDepartments() {
  elements["departments-table-body"].replaceChildren();
  elements["departments-empty-message"].hidden = departments.length > 0;
  elements["departments-table-wrapper"].hidden = departments.length === 0;
  departments.forEach((department) => {
    const count = employees.filter(({ departmentId }) => departmentId === department.id).length;
    const row = document.createElement("tr");
    row.append(textElement("td", department.name), textElement("td", String(count)));
    const actions = document.createElement("td");
    const edit = textElement("button", "Edit");
    edit.type = "button";
    edit.dataset.departmentEdit = department.id;
    edit.setAttribute("aria-label", `Edit ${department.name}`);
    edit.addEventListener("click", () => startEditingDepartment(department));
    const remove = textElement("button", "Delete");
    remove.type = "button";
    remove.setAttribute("aria-label", `Delete ${department.name}`);
    remove.addEventListener("click", () => deleteDepartment(department.id));
    actions.append(edit, remove);
    row.append(actions);
    elements["departments-table-body"].append(row);
  });
}

elements["inventory-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  const validName = requireTrimmed(elements.name, "Enter an item name that is not only spaces.");
  const validDescription = requireTrimmed(elements.description, "Enter a description that is not only spaces.");
  if (!validName || !validDescription || !event.currentTarget.checkValidity()) return event.currentTarget.reportValidity();
  const values = { name: elements.name.value.trim(), description: elements.description.value.trim(), status: elements.status.value };
  const item = inventory.find(({ id }) => id === Number(elements["record-id"].value));
  if (item) Object.assign(item, values);
  else {
    const id = positiveId(nextInventoryId);
    if (!id || id >= Number.MAX_SAFE_INTEGER) return announce("The item could not be added because no safe ID is available.");
    inventory.push({ id, employeeId: null, ...values });
    nextInventoryId = id + 1;
  }
  saveState();
  resetInventoryForm();
  renderInventory();
  elements.name.focus();
  announce(`${values.name} ${item ? "updated" : "added"}.`);
});

elements["employee-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  const validName = requireTrimmed(elements["employee-name"], "Enter an employee name that is not only spaces.");
  const validEmail = requireTrimmed(elements["employee-email"], "Enter an email address that is not only spaces.");
  if (!validName || !validEmail || !event.currentTarget.checkValidity()) return event.currentTarget.reportValidity();
  const selectedId = positiveId(Number(elements["employee-department"].value));
  const values = { name: elements["employee-name"].value.trim(), email: elements["employee-email"].value.trim(), departmentId: departments.some(({ id }) => id === selectedId) ? selectedId : null };
  const employee = employees.find(({ id }) => id === Number(elements["employee-id"].value));
  if (employee) Object.assign(employee, values);
  else {
    const id = positiveId(nextEmployeeId);
    if (!id || id >= Number.MAX_SAFE_INTEGER) return announce("The employee could not be added because no safe ID is available.");
    employees.push({ id, ...values });
    nextEmployeeId = id + 1;
  }
  saveState();
  resetEmployeeForm();
  renderEmployees();
  renderInventory();
  renderDepartments();
  elements["employee-name"].focus();
  announce(`${values.name} ${employee ? "updated" : "added"}.`);
});

elements["department-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  const validName = requireTrimmed(elements["department-name"], "Enter a department name that is not only spaces.");
  if (!validName || !event.currentTarget.checkValidity()) return event.currentTarget.reportValidity();
  const values = { name: elements["department-name"].value.trim() };
  const department = departments.find(({ id }) => id === Number(elements["department-id"].value));
  if (department) Object.assign(department, values);
  else {
    const id = positiveId(nextDepartmentId);
    if (!id || id >= Number.MAX_SAFE_INTEGER) return announce("The department could not be added because no safe ID is available.");
    departments.push({ id, ...values });
    nextDepartmentId = id + 1;
  }
  saveState();
  resetDepartmentForm();
  populateDepartmentSelect();
  renderDepartments();
  renderEmployees();
  elements["department-name"].focus();
  announce(`${values.name} ${department ? "updated" : "added"}.`);
});

elements["cancel-button"].addEventListener("click", () => {
  const id = elements["record-id"].value;
  resetInventoryForm();
  $(`[data-item-edit="${id}"]`)?.focus();
  announce("Inventory edit cancelled.");
});
elements["employee-cancel-button"].addEventListener("click", () => {
  const id = elements["employee-id"].value;
  resetEmployeeForm();
  $(`[data-employee-edit="${id}"]`)?.focus();
  announce("Employee edit cancelled.");
});
elements["department-cancel-button"].addEventListener("click", () => {
  const id = elements["department-id"].value;
  resetDepartmentForm();
  $(`[data-department-edit="${id}"]`)?.focus();
  announce("Department edit cancelled.");
});
[elements.name, elements.description].forEach((input) => input.addEventListener("input", () => { input.setCustomValidity(""); elements["inventory-form"].dataset.dirty = "true"; }));
elements.status.addEventListener("change", () => { elements["inventory-form"].dataset.dirty = "true"; });
[elements["employee-name"], elements["employee-email"]].forEach((input) => input.addEventListener("input", () => { input.setCustomValidity(""); elements["employee-form"].dataset.dirty = "true"; }));
elements["employee-department"].addEventListener("change", () => { elements["employee-form"].dataset.dirty = "true"; });
elements["department-name"].addEventListener("input", () => { elements["department-name"].setCustomValidity(""); elements["department-form"].dataset.dirty = "true"; });

loadState();
populateDepartmentSelect();
renderInventory();
renderEmployees();
renderDepartments();
