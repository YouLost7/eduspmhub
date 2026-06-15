import {
  isValidMalaysiaSchool,
  isValidStudentFormLevel,
} from "../shared/studentOptions.js";

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
