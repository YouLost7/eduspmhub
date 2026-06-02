import { getDb, sqlite } from "./sqlite.js";

function parseJsonArray(raw) {
  try {
    const v = JSON.parse(String(raw || "[]"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw) {
  try {
    const v = JSON.parse(String(raw || "{}"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export async function loadUsers() {
  const db = await getDb();
  const rows = await sqlite.all(db, "SELECT data FROM users ORDER BY id ASC");
  return rows.map((r) => {
    try {
      return JSON.parse(r.data);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export async function saveUsers(users) {
  const db = await getDb();
  await sqlite.run(db, "DELETE FROM users");
  for (const u of users) {
    if (!u || typeof u !== "object") continue;
    const id = String(u.id || "").trim();
    const email = String(u.email || "").trim().toLowerCase();
    if (!id || !email) continue;
    await sqlite.run(
      db,
      "INSERT INTO users (id, email, data) VALUES (?, ?, ?)",
      [id, email, JSON.stringify(u)]
    );
  }
}

export async function loadEnrollments() {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    "SELECT user_id, data FROM enrollments ORDER BY user_id ASC"
  );
  const out = {};
  for (const r of rows) {
    out[r.user_id] = parseJsonArray(r.data).map((id) => String(id));
  }
  return out;
}

/** @returns {Promise<Record<string, string[]>>} userId -> courseIds */
export async function saveEnrollments(map) {
  const db = await getDb();
  const payload = parseJsonObject(JSON.stringify(map || {}));
  await sqlite.run(db, "DELETE FROM enrollments");
  for (const [uid, ids] of Object.entries(payload)) {
    const list = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
    await sqlite.run(
      db,
      "INSERT INTO enrollments (user_id, data) VALUES (?, ?)",
      [String(uid), JSON.stringify(list)]
    );
  }
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
    /** Profile face photo — use GET /api/profile/photo/:id with session cookie */
    hasProfilePhoto: Boolean(user.avatarStorageKey),
    avatarUploadedAt: user.avatarUploadedAt || null,
    /** Educator: submitted certified licence file (PDF/JPEG/PNG) pending or on file */
    hasLicenseDocument: Boolean(user.licenseStorageKey),
    licenseUploadedAt: user.licenseUploadedAt || null,
    licenseOriginalName: user.licenseOriginalName || "",
    offersOneToOne: Boolean(user.offersOneToOne),
    hourlyRateCents: Number(user.hourlyRateCents) || 0,
    hourlyRateLabel:
      Number(user.hourlyRateCents) > 0
        ? `RM${(Number(user.hourlyRateCents) / 100).toFixed(2)}/hr`
        : "",
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
    hasProfilePhoto: Boolean(user.avatarStorageKey),
    avatarUploadedAt: user.avatarUploadedAt || null,
    offersOneToOne: Boolean(user.offersOneToOne),
    hourlyRateCents: Number(user.hourlyRateCents) || 0,
    hourlyRateLabel:
      Number(user.hourlyRateCents) > 0
        ? `RM${(Number(user.hourlyRateCents) / 100).toFixed(2)}/hr`
        : "",
  };
}

/** Tutor card with review stats for public listings. */
export function toPublicTutorProfileWithStats(user, stats = {}) {
  const base = toPublicTutorProfile(user);
  if (!base) return null;
  return {
    ...base,
    reviewCount: Number(stats.reviewCount) || 0,
    averageRating: Number(stats.averageRating) || 0,
  };
}
