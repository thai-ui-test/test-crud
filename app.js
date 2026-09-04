const form = document.querySelector("#inventory-form");
const recordIdInput = document.querySelector("#record-id");
const nameInput = document.querySelector("#name");
const descriptionInput = document.querySelector("#description");
const statusInput = document.querySelector("#status");
const submitButton = document.querySelector("#submit-button");
const cancelButton = document.querySelector("#cancel-button");
const inventoryList = document.querySelector("#inventory-list");
const emptyMessage = document.querySelector("#empty-message");

let inventory = [];
let nextId = 1;

function resetForm() {
  form.reset();
  recordIdInput.value = "";
  submitButton.textContent = "Add item";
  cancelButton.hidden = true;
}

function createTextElement(tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

function startEditing(item) {
  recordIdInput.value = String(item.id);
  nameInput.value = item.name;
  descriptionInput.value = item.description;
  statusInput.value = item.status;
  submitButton.textContent = "Save changes";
  cancelButton.hidden = false;
  nameInput.focus();
}

function deleteItem(id) {
  inventory = inventory.filter((item) => item.id !== id);
  if (recordIdInput.value === String(id)) {
    resetForm();
  }
  renderInventory();
}

function renderInventory() {
  inventoryList.replaceChildren();
  emptyMessage.hidden = inventory.length > 0;

  inventory.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.className = "inventory-item";
    listItem.append(
      createTextElement("h3", item.name),
      createTextElement("p", item.description),
      createTextElement("p", `Status: ${item.status}`)
    );

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit ${item.name}`);
    editButton.addEventListener("click", () => startEditing(item));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${item.name}`);
    deleteButton.addEventListener("click", () => deleteItem(item.id));

    actions.append(editButton, deleteButton);
    listItem.append(actions);
    inventoryList.append(listItem);
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const values = {
    name: nameInput.value.trim(),
    description: descriptionInput.value.trim(),
    status: statusInput.value
  };

  const editingId = Number(recordIdInput.value);
  if (editingId) {
    const item = inventory.find((record) => record.id === editingId);
    if (item) Object.assign(item, values);
  } else {
    inventory.push({ id: nextId, ...values });
    nextId += 1;
  }

  resetForm();
  renderInventory();
});

cancelButton.addEventListener("click", resetForm);
renderInventory();
