export function safe(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}
