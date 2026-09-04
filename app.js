const $ = (selector) => document.querySelector(selector);
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
const appStatus = $("#app-status");

let inventory = [];
let employees = [];
let nextInventoryId = 1;
let nextEmployeeId = 1;

function announce(message) {
  appStatus.textContent = "";
  requestAnimationFrame(() => { appStatus.textContent = message; });
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
  inventoryForm.reset();
  recordIdInput.value = "";
  inventoryFormHeading.textContent = "Add an inventory item";
  submitButton.textContent = "Add item";
  cancelButton.hidden = true;
  nameInput.setCustomValidity("");
  descriptionInput.setCustomValidity("");
}

function startEditingItem(item) {
  recordIdInput.value = item.id;
  nameInput.value = item.name;
  descriptionInput.value = item.description;
  statusInput.value = item.status;
  inventoryFormHeading.textContent = "Edit inventory item";
  submitButton.textContent = "Save changes";
  cancelButton.hidden = false;
  nameInput.focus();
}

function deleteItem(id) {
  const index = inventory.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = inventory.splice(index, 1);
  if (recordIdInput.value === String(id)) resetInventoryForm();
  const focusId = inventory[Math.min(index, inventory.length - 1)]?.id;
  renderInventory();
  (focusId ? $(`[data-item-edit="${focusId}"]`) : nameInput).focus();
  announce(`${removed.name} deleted.${inventory.length ? "" : " Inventory is now empty."}`);
}

function setAssignment(itemId, employeeId) {
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
    row.append(textElement("h3", item.name), textElement("p", item.description), textElement("p", `Status: ${item.status}`), textElement("p", `Assigned to: ${employee ? employee.name : "Unassigned"}`));

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
    edit.textContent = "Edit";
    edit.dataset.itemEdit = item.id;
    edit.setAttribute("aria-label", `Edit ${item.name}`);
    edit.addEventListener("click", () => startEditingItem(item));
    const remove = document.createElement("button");
    remove.type = "button";
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
}

function startEditingEmployee(employee) {
  employeeIdInput.value = employee.id;
  employeeNameInput.value = employee.name;
  employeeEmailInput.value = employee.email;
  employeeFormHeading.textContent = "Edit employee";
  employeeSubmitButton.textContent = "Save changes";
  employeeCancelButton.hidden = false;
  employeeNameInput.focus();
}

function deleteEmployee(id) {
  const index = employees.findIndex((employee) => employee.id === id);
  if (index < 0) return;
  const [removed] = employees.splice(index, 1);
  const returnedCount = inventory.filter((item) => item.employeeId === id).length;
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
    edit.textContent = "Edit";
    edit.dataset.employeeEdit = employee.id;
    edit.setAttribute("aria-label", `Edit ${employee.name}`);
    edit.addEventListener("click", () => startEditingEmployee(employee));
    const remove = document.createElement("button");
    remove.type = "button";
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
[nameInput, descriptionInput, employeeNameInput, employeeEmailInput].forEach((input) => input.addEventListener("input", () => input.setCustomValidity("")));

renderInventory();
renderEmployees();
