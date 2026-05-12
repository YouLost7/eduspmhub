import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const USERS_PATH = join(DATA_DIR, "users.json");
const ENROLLMENTS_PATH = join(DATA_DIR, "enrollments.json");

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readJson(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  await ensureDataDir();
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

export async function loadUsers() {
  return readJson(USERS_PATH, []);
}

export async function saveUsers(users) {
  await writeJson(USERS_PATH, users);
}

export async function loadEnrollments() {
  return readJson(ENROLLMENTS_PATH, {});
}

/** @returns {Promise<Record<string, string[]>>} userId -> courseIds */
export async function saveEnrollments(map) {
  await writeJson(ENROLLMENTS_PATH, map);
}

export function findUserByEmail(users, email) {
  const e = email.trim().toLowerCase();
  return users.find((u) => u.email === e) || null;
}

export function findUserById(users, id) {
  return users.find((u) => u.id === id) || null;
}

export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    verified: Boolean(user.verified),
    fullName: user.fullName,
    schoolName: user.schoolName || "",
    studentForm: user.studentForm || "",
    studentSubject: user.studentSubject || "",
    educatorInstitution: user.educatorInstitution || "",
    educatorSubject: user.educatorSubject || "",
    educatorBio: user.educatorBio || "",
    createdAt: user.createdAt,
    /** Educator: submitted certified licence file (PDF/JPEG/PNG) pending or on file */
    hasLicenseDocument: Boolean(user.licenseStorageKey),
    licenseUploadedAt: user.licenseUploadedAt || null,
    licenseOriginalName: user.licenseOriginalName || "",
  };
}

/** Signed-in students (and staff) see tutor public info — no email. */
export function toPublicTutorProfile(user) {
  if (!user || user.role !== "educator") return null;
  return {
    id: user.id,
    fullName: user.fullName,
    verified: Boolean(user.verified),
    educatorSubject: user.educatorSubject || "",
    educatorInstitution: user.educatorInstitution || "",
    educatorBio: user.educatorBio || "",
    createdAt: user.createdAt || null,
  };
}
