/** Live typing helper — uppercase; keeps a trailing space while the next word is typed. */
export function formatPersonNameInput(raw) {
  return String(raw || "")
    .replace(/^\s+/, "")
    .replace(/\s{2,}/g, " ")
    .toUpperCase();
}

/** Final name for storage: trim, collapse spaces, UPPERCASE. */
export function normalizePersonName(raw) {
  const name = formatPersonNameInput(raw).trim();
  if (!name) return "";
  return name;
}
