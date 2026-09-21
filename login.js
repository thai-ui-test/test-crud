const form = document.querySelector("#login-form");
const error = document.querySelector("#login-error");
form.addEventListener("submit", async (event) => {
  event.preventDefault(); error.hidden = true;
  const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: document.querySelector("#login-email").value, password: document.querySelector("#login-password").value }) });
  if (response.ok) return window.location.assign("/");
  error.textContent = (await response.json()).error || "Unable to sign in."; error.hidden = false;
});
