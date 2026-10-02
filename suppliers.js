const supplierForm = $("#supplier-form");
const supplierFormHeading = $("#supplier-form-heading");
const supplierIdInput = $("#supplier-id");
const supplierNameInput = $("#supplier-name");
const supplierEmailInput = $("#supplier-email");
const supplierSubmitButton = $("#supplier-submit-button");
const supplierCancelButton = $("#supplier-cancel-button");
const suppliersEmptyMessage = $("#suppliers-empty-message");
const suppliersTableWrapper = $("#suppliers-table-wrapper");
const suppliersTableBody = $("#suppliers-table-body");

let suppliers = [];
let nextSupplierId = 1;

function resetSupplierForm() {
  supplierForm.reset();
  supplierIdInput.value = "";
  supplierFormHeading.textContent = "Add a supplier";
  supplierSubmitButton.textContent = "Add supplier";
  supplierCancelButton.hidden = true;
  supplierNameInput.setCustomValidity("");
  supplierEmailInput.setCustomValidity("");
  supplierForm.dataset.dirty = "false";
}

function startEditingSupplier(supplier) {
  const hasDraft = supplierForm.dataset.dirty === "true";
  if (hasDraft && !window.confirm("Discard the current supplier draft?")) return;
  supplierIdInput.value = supplier.id;
  supplierNameInput.value = supplier.name;
  supplierEmailInput.value = supplier.contactEmail;
  supplierFormHeading.textContent = "Edit supplier";
  supplierSubmitButton.textContent = "Save changes";
  supplierCancelButton.hidden = false;
  supplierNameInput.setCustomValidity("");
  supplierEmailInput.setCustomValidity("");
  supplierNameInput.focus();
  supplierForm.dataset.dirty = "false";
}

function deleteSupplier(id) {
  const index = suppliers.findIndex((supplier) => supplier.id === id);
  if (index < 0) return;
  const supplier = suppliers[index];
  const returnedCount = inventory.filter((item) => item.supplierId === id).length;
  const assignmentNote = returnedCount ? ` and return ${returnedCount} assigned item${returnedCount === 1 ? "" : "s"} to unassigned` : "";
  if (!window.confirm(`Delete ${supplier.name}${assignmentNote}? This cannot be undone.`)) return;
  const [removed] = suppliers.splice(index, 1);
  inventory.forEach((item) => { if (item.supplierId === id) item.supplierId = null; });
  if (supplierIdInput.value === String(id)) resetSupplierForm();
  const focusId = suppliers[Math.min(index, suppliers.length - 1)]?.id;
  renderSuppliers();
  renderInventory();
  (focusId ? $(`[data-supplier-edit="${focusId}"]`) : supplierNameInput).focus();
  const returned = returnedCount ? ` ${returnedCount} item${returnedCount === 1 ? " was" : "s were"} returned to unassigned.` : "";
  announce(`${removed.name} deleted.${returned}${suppliers.length ? "" : " The supplier list is now empty."}`);
}

function setSupplierAssignment(itemId, supplierId) {
  const item = inventory.find((record) => record.id === itemId);
  if (!item) return;
  item.supplierId = supplierId || null;
  renderInventory();
  $(`[data-supplier-assignment="${itemId}"]`).focus();
  const supplier = suppliers.find((record) => record.id === supplierId);
  announce(supplier ? `${item.name} supplier set to ${supplier.name}.` : `${item.name} supplier returned to unassigned.`);
}

function renderSuppliers() {
  suppliersTableBody.replaceChildren();
  suppliersEmptyMessage.hidden = suppliers.length > 0;
  suppliersTableWrapper.hidden = suppliers.length === 0;
  suppliers.forEach((supplier) => {
    const row = document.createElement("tr");
    row.append(textElement("td", supplier.name), textElement("td", supplier.contactEmail));
    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.dataset.supplierEdit = supplier.id;
    edit.setAttribute("aria-label", `Edit ${supplier.name}`);
    edit.addEventListener("click", () => startEditingSupplier(supplier));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${supplier.name}`);
    remove.addEventListener("click", () => deleteSupplier(supplier.id));
    actions.append(edit, remove);
    row.append(actions);
    suppliersTableBody.append(row);
  });
}

supplierForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const validName = requireTrimmed(supplierNameInput, "Enter a supplier name that is not only spaces.");
  const validEmail = requireTrimmed(supplierEmailInput, "Enter a contact email that is not only spaces.");
  if (!validName || !validEmail || !supplierForm.checkValidity()) return supplierForm.reportValidity();
  const values = { name: supplierNameInput.value.trim(), contactEmail: supplierEmailInput.value.trim() };
  const supplier = suppliers.find((record) => record.id === Number(supplierIdInput.value));
  if (supplier) Object.assign(supplier, values);
  else suppliers.push({ id: nextSupplierId++, ...values });
  resetSupplierForm();
  renderSuppliers();
  renderInventory();
  supplierNameInput.focus();
  announce(`${values.name} ${supplier ? "updated" : "added"}.`);
});

supplierCancelButton.addEventListener("click", () => {
  const id = supplierIdInput.value;
  resetSupplierForm();
  $(`[data-supplier-edit="${id}"]`)?.focus();
  announce("Supplier edit cancelled.");
});
[supplierNameInput, supplierEmailInput].forEach((input) => input.addEventListener("input", () => { input.setCustomValidity(""); supplierForm.dataset.dirty = "true"; }));

renderSupplierStatus = (row, item) => {
  const supplier = suppliers.find((record) => record.id === item.supplierId);
  row.append(textElement("p", `Supplier: ${supplier ? supplier.name : "Unassigned"}`));
};

renderSupplierAssignmentControl = (row, item) => {
  const supplierAssignment = document.createElement("div");
  supplierAssignment.className = "assignment-control";
  const supplierLabel = document.createElement("label");
  supplierLabel.htmlFor = `supplier-assignment-${item.id}`;
  supplierLabel.textContent = `Assign supplier for ${item.name}`;
  const supplierSelect = document.createElement("select");
  supplierSelect.id = `supplier-assignment-${item.id}`;
  supplierSelect.dataset.supplierAssignment = item.id;
  supplierSelect.append(new Option("Unassigned", ""));
  suppliers.forEach((record) => supplierSelect.append(new Option(`${record.name} (${record.contactEmail})`, record.id)));
  supplierSelect.value = item.supplierId || "";
  supplierSelect.addEventListener("change", () => setSupplierAssignment(item.id, Number(supplierSelect.value)));
  supplierAssignment.append(supplierLabel, supplierSelect);
  row.append(supplierAssignment);
};

renderSuppliers();
renderInventory();
renderEmployees();
