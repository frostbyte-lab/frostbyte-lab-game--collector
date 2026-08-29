export function announce(message) {
  let region = document.getElementById("a11y-live");
  if (!region) {
    region = document.createElement("div");
    region.id = "a11y-live";
    region.className = "sr-only";
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  region.textContent = String(message);
}

export function makeButton(label, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

export function focusMain() {
  document.querySelector("main")?.focus({ preventScroll: true });
}
