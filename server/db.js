import { getDb, sqlite } from "./sqlite.js";

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

/**
 * Single-row lookup by id. Prefer this over `loadUsers()` + `findUserById`
 * wherever only one specific user is needed (e.g. resolving the signed-in
 * session user) — `loadUsers()` scans and JSON-parses every row in the
 * table, which is wasteful on hot, single-user paths like `/api/auth/me` or
 * per-image profile photo requests.
 */
export async function getUserById(id) {
  if (!id) return null;
  const db = await getDb();
  const row = await sqlite.get(db, "SELECT data FROM users WHERE id = ?", [String(id)]);
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

/**
 * Inserts a brand-new user row. Throws a Postgres error with
 * `.code === "23505"` (unique_violation) if the id or email is already
 * taken, so callers can turn that into a friendly "already exists" response
 * even if two registrations for the same email race each other.
 */
export async function insertUser(user) {
  const db = await getDb();
  const id = String(user?.id || "").trim();
  const email = String(user?.email || "").trim().toLowerCase();
  await sqlite.run(
    db,
    "INSERT INTO users (id, email, data) VALUES (?, ?, ?)",
    [id, email, JSON.stringify(user)]
  );
}

/**
 * Updates a single user's row atomically by id. Callers load the user,
 * mutate the in-memory object, then call this instead of re-saving every
 * user in the table: rewriting the whole table let concurrent writers
 * clobber each other's changes, and a crash mid-rewrite could leave the
 * table empty for every user, not just the one being edited.
 */
export async function updateUser(user) {
  const db = await getDb();
  const id = String(user?.id || "").trim();
  const email = String(user?.email || "").trim().toLowerCase();
  await sqlite.run(
    db,
    "UPDATE users SET email = ?, data = ? WHERE id = ?",
    [email, JSON.stringify(user), id]
  );
}

/** @returns {Promise<Record<string, string[]>>} userId -> courseIds */
export async function loadEnrollments() {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    "SELECT user_id, course_id FROM course_enrollments ORDER BY user_id ASC, course_id ASC"
  );
  const out = {};
  for (const r of rows) {
    const uid = String(r.user_id);
    if (!out[uid]) out[uid] = [];
    out[uid].push(String(r.course_id));
  }
  return out;
}

/**
 * Single-row existence check. Prefer this over `loadEnrollments()` (which
 * loads every enrollment row for every user) wherever only one user/course
 * pair needs checking, e.g. course access authorization on every lesson
 * view and progress update.
 */
export async function isUserEnrolledInCourse(userId, courseId) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    "SELECT 1 FROM course_enrollments WHERE user_id = ? AND course_id = ? LIMIT 1",
    [String(userId), String(courseId)]
  );
  return Boolean(row);
}

/** Atomically enrols a student in a course; a no-op if already enrolled. */
export async function addCourseEnrollment(userId, courseId) {
  const db = await getDb();
  await sqlite.run(
    db,
    `INSERT INTO course_enrollments (user_id, course_id, enrolled_at)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [String(userId), String(courseId), new Date().toISOString()]
  );
}

/** Removes a course from every student's enrolments (e.g. on course deletion). */
export async function removeCourseFromAllEnrollments(courseId) {
  const db = await getDb();
  await sqlite.run(db, "DELETE FROM course_enrollments WHERE course_id = ?", [
    String(courseId),
  ]);
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
    hasPayoutBankDetails: Boolean(
      user.payoutBankName && user.payoutAccountHolder && user.payoutAccountNumber
    ),
    payoutBankName: user.payoutBankName || "",
    payoutAccountHolder: user.payoutAccountHolder || "",
    payoutAccountNumberLast4: user.payoutAccountNumber
      ? String(user.payoutAccountNumber).slice(-4)
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
