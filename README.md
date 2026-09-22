# test-crud

A static, dependency-free HTML/CSS/JavaScript admin portal with inventory and employee CRUD, gated behind a browser-only login.

## Running locally

No build step or dependencies. Serve the folder with any static file server and open it in a browser, for example:

```sh
npx serve .
# or
python3 -m http.server 8000
```

Then visit the printed URL (e.g. `http://localhost:8000`).

## Signing in

A seeded administrator account is created automatically the first time the app loads:

- Username: `admin`
- Temporary password: `admin123`

You'll be required to set a new password immediately after the first successful sign-in with this account.

## Security limitations

Authentication here is **browser-only UI gating**, not server-side security:

- Accounts and the active session are stored in this browser's `localStorage`.
- Anyone with access to this browser (or its developer tools) can read or edit that storage and bypass the login screen.
- There is no backend, so nothing here should be used to protect real data or credentials.

Inventory and employee records are kept in memory only and reset on reload; they are not persisted to `localStorage`.
