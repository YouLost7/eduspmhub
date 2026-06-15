/** Normalize a person's display name: trim, collapse spaces, UPPERCASE. */
export function normalizePersonName(raw) {
  const name = String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name) return "";
  return name.toUpperCase();
}
