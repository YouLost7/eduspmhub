import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let loaded = false;

function stripQuotes(value) {
  const v = String(value || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

export function loadEnvOnce() {
  if (loaded) return;
  loaded = true;
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, "..", ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx <= 0) continue;
    const key = t.slice(0, idx).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    const val = stripQuotes(t.slice(idx + 1));
    process.env[key] = val;
  }
}
