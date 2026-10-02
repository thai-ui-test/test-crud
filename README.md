# test-crud

A single-page Inventory Manager built with plain HTML, CSS, and JavaScript — no build step, no framework, no module system. Open `index.html` in a browser to run it.

## Features

- **Inventory** — add, edit, and delete inventory items (name, description, status). Each item can be assigned to an employee and a supplier, or left unassigned.
- **Employees** — add, edit, and delete employee records (name, email). Deleting an employee unassigns their inventory items.
- **Suppliers** — add, edit, and delete supplier records (name, contact email). Deleting a supplier unassigns it from any inventory items; renaming a supplier updates its label everywhere it's referenced.

All forms validate required fields, warn before discarding unsaved edits, and confirm before destructive deletes.

## Project structure

- `index.html` — markup for all three sections (Inventory, Employees, Suppliers).
- `app.js` — shared helpers plus inventory and employee state/behavior.
- `suppliers.js` — supplier state and behavior; loads after `app.js` and reuses its helpers (`$`, `announce`, `textElement`, `requireTrimmed`, `renderInventory`, `renderEmployees`) since there's no module system.
- `styles.css` — shared styling for all sections.

## Data model

```js
// Inventory
{ id, name, description, status, employeeId, supplierId }

// Employee
{ id, name, email }

// Supplier
{ id, name, contactEmail }
```
