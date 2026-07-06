import { timingSafeEqual } from "node:crypto";
import {
  isValidMalaysiaSchool,
  isValidStudentFormLevel,
} from "../shared/studentOptions.js";

/**
 * Constant-time secret comparison (e.g. admin keys). Plain `!==` leaks how
 * many leading characters matched via response timing, which a remote
 * attacker can exploit to recover the secret byte-by-byte over many
 * requests. Different-length inputs are rejected outright without calling
 * `timingSafeEqual` (which requires equal-length buffers).
 */
export function secretEquals(provided, expected) {
  const a = Buffer.from(String(provided ?? ""), "utf8");
  const b = Buffer.from(String(expected ?? ""), "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

const FREE = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "aol.com",
  "icloud.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
]);

export function getDomain(email) {
  const i = email.indexOf("@");
  if (i === -1) return "";
  return email.slice(i + 1).toLowerCase();
}

export function isLikelySchoolEmail(email) {
  const domain = getDomain(email);
  if (!domain || FREE.has(domain)) return false;
  return domain.includes("edu") || domain.includes("school");
}

export { isValidMalaysiaSchool, isValidStudentFormLevel };

export { normalizePersonName } from "../shared/personName.js";
