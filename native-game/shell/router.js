import { setState } from "./state-store.js";
import { focusMain } from "./accessibility.js";

const routes = new Set(["dashboard", "validation", "history", "help"]);

export function currentRoute() {
  const route = location.hash.replace(/^#\/?/, "") || "dashboard";
  return routes.has(route) ? route : "dashboard";
}

export function navigate(route) {
  const next = routes.has(route) ? route : "dashboard";
  if (currentRoute() !== next) location.hash = `#/${next}`;
  setState({ route: next });
  document.querySelectorAll("[data-route]").forEach((element) => {
    const active = element.dataset.route === next;
    element.classList.toggle("active", active);
    element.setAttribute("aria-current", active ? "page" : "false");
  });
  document.querySelectorAll("[data-view]").forEach((element) => {
    element.hidden = element.dataset.view !== next;
  });
  focusMain();
}

export function installRouter() {
  globalThis.addEventListener("hashchange", () => navigate(currentRoute()));
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-route]");
    if (target) { event.preventDefault(); navigate(target.dataset.route); }
  });
  navigate(currentRoute());
}
