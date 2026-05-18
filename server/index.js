import express from "express";
import session from "express-session";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import multer from "multer";
import http from "node:http";
import path from "node:path";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  loadUsers,
  saveUsers,
  loadEnrollments,
  saveEnrollments,
  findUserByEmail,
  findUserById,
  toPublicUser,
  toPublicTutorProfile,
} from "./db.js";
import { CATALOG } from "./catalog.js";
import { isLikelySchoolEmail } from "./validation.js";
import { buildFeaturedPayload } from "./featured.js";
import {
  loadEducatorCourses,
  saveEducatorCourses,
  mapPublishedToCatalogShape,
  mapToManagedRow,
  normalizePrice,
  clampLessons,
  normalizeLessonPages,
  parseExternalVideoUrl,
  isSafeLessonPdfKey,
  isSafeLessonVideoKey,
  isValidEmbedObject,
} from "./educatorCourses.js";
import { getEducatorCourseEnrollmentsSummary } from "./enrollmentSummary.js";
import { SqliteSessionStore } from "./sessionStore.js";
import { registerAuthAdminRoutes } from "./routes/authAdminRoutes.js";
import { registerProfileRoutes } from "./routes/profileRoutes.js";
import { registerEducatorRoutes } from "./routes/educatorRoutes.js";
import { registerCourseRoutes } from "./routes/courseRoutes.js";

const PREFERRED_PORT = Number(process.env.PORT) || 3001;
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const LICENSE_DIR = path.join(SERVER_DIR, "uploads", "educator-licenses");
const LESSON_PDF_DIR = path.join(SERVER_DIR, "uploads", "lesson-pdfs");
const LESSON_VIDEO_DIR = path.join(SERVER_DIR, "uploads", "lesson-videos");
const PROFILE_PHOTO_DIR = path.join(SERVER_DIR, "uploads", "profile-photos");
mkdirSync(LICENSE_DIR, { recursive: true });
mkdirSync(LESSON_PDF_DIR, { recursive: true });
mkdirSync(LESSON_VIDEO_DIR, { recursive: true });
mkdirSync(PROFILE_PHOTO_DIR, { recursive: true });

function licenseExtFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m === "application/pdf") return ".pdf";
  if (m === "image/jpeg" || m === "image/jpg" || m === "image/pjpeg") return ".jpg";
  if (m === "image/png") return ".png";
  return "";
}

/** Original filename extension — used when browser sends generic octet-stream. */
function extFromOriginalName(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return "";
  const e = m[1];
  if (e === "pdf") return ".pdf";
  if (e === "jpg" || e === "jpeg" || e === "jfif") return ".jpg";
  if (e === "png") return ".png";
  if (e === "webp") return ".webp";
  if (e === "mp4") return ".mp4";
  if (e === "webm") return ".webm";
  return "";
}

/** Accept common browser quirks (octet-stream PDF, image/jpg, etc.). */
function resolvedLicenseMeta(file) {
  const mime = String(file.mimetype || "").toLowerCase();
  let ext = licenseExtFromMime(mime);
  if (ext) {
    const storedMime =
      mime === "image/jpg" || mime === "image/pjpeg" ? "image/jpeg" : file.mimetype;
    return { ext, mime: storedMime };
  }
  const generic =
    mime === "application/octet-stream" ||
    mime === "" ||
    mime === "binary/octet-stream";
  if (generic) {
    const oe = extFromOriginalName(file.originalname);
    if (oe === ".pdf") return { ext: ".pdf", mime: "application/pdf" };
    if (oe === ".jpg") return { ext: ".jpg", mime: "image/jpeg" };
    if (oe === ".png") return { ext: ".png", mime: "image/png" };
  }
  return null;
}

function isSafeLicenseStorageKey(name) {
  return (
    typeof name === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/i.test(
      name
    )
  );
}

function resolvedAvatarMeta(file) {
  const mime = String(file.mimetype || "").toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg" || mime === "image/pjpeg") {
    return { ext: ".jpg", mime: "image/jpeg" };
  }
  if (mime === "image/png") return { ext: ".png", mime: "image/png" };
  if (mime === "image/webp") return { ext: ".webp", mime: "image/webp" };
  const generic =
    mime === "application/octet-stream" ||
    mime === "" ||
    mime === "binary/octet-stream";
  if (generic) {
    const oe = extFromOriginalName(file.originalname);
    if (oe === ".jpg") return { ext: ".jpg", mime: "image/jpeg" };
    if (oe === ".png") return { ext: ".png", mime: "image/png" };
    if (oe === ".webp") return { ext: ".webp", mime: "image/webp" };
  }
  return null;
}

function isSafeAvatarStorageKey(name) {
  return (
    typeof name === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(
      name
    )
  );
}

async function unlinkAvatarFile(key) {
  if (!isSafeAvatarStorageKey(key)) return;
  const abs = path.join(PROFILE_PHOTO_DIR, key);
  await unlink(abs).catch(() => {});
}

const licenseUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, LICENSE_DIR);
    },
    filename: (_req, file, cb) => {
      const meta = resolvedLicenseMeta(file);
      if (!meta) {
        cb(new Error("Only PDF, JPEG, or PNG files are allowed"));
        return;
      }
      cb(null, `${randomUUID()}${meta.ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (resolvedLicenseMeta(file)) cb(null, true);
    else
      cb(
        new Error(
          "Only PDF, JPEG, or PNG uploads are allowed (use a .pdf, .jpg, or .png file)."
        )
      );
  },
});

function resolvedLessonPdfMeta(file) {
  const mime = String(file.mimetype || "").toLowerCase();
  if (
    mime === "application/pdf" ||
    mime === "application/x-pdf" ||
    mime === "application/acrobat" ||
    mime === "text/pdf"
  ) {
    return { ext: ".pdf", mime: "application/pdf" };
  }
  const generic =
    mime === "application/octet-stream" ||
    mime === "" ||
    mime === "binary/octet-stream";
  if (generic && extFromOriginalName(file.originalname) === ".pdf") {
    return { ext: ".pdf", mime: "application/pdf" };
  }
  return null;
}

const lessonPdfUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, LESSON_PDF_DIR);
    },
    filename: (_req, _file, cb) => {
      cb(null, `${randomUUID()}.pdf`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (resolvedLessonPdfMeta(file)) {
      cb(null, true);
      return;
    }
    const name = String(file.originalname || "").toLowerCase();
    if (name.endsWith(".pdf")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only PDF files are allowed for lesson handouts (use a .pdf file)."));
  },
});

function resolvedLessonVideoMeta(file) {
  const mime = String(file.mimetype || "").toLowerCase();
  if (mime === "video/mp4" || mime === "video/x-m4v") {
    return { ext: ".mp4", mime: "video/mp4" };
  }
  if (mime === "video/webm") {
    return { ext: ".webm", mime: "video/webm" };
  }
  const generic =
    mime === "application/octet-stream" ||
    mime === "" ||
    mime === "binary/octet-stream";
  if (generic) {
    const oe = extFromOriginalName(file.originalname);
    if (oe === ".mp4") return { ext: ".mp4", mime: "video/mp4" };
    if (oe === ".webm") return { ext: ".webm", mime: "video/webm" };
  }
  return null;
}

function lessonVideoContentType(storageFileName) {
  const lower = String(storageFileName || "").toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  return "video/mp4";
}

const lessonVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, LESSON_VIDEO_DIR);
    },
    filename: (_req, file, cb) => {
      const meta = resolvedLessonVideoMeta(file);
      if (meta?.ext === ".webm") {
        cb(null, `${randomUUID()}.webm`);
        return;
      }
      if (meta?.ext === ".mp4") {
        cb(null, `${randomUUID()}.mp4`);
        return;
      }
      const name = String(file.originalname || "").toLowerCase();
      if (name.endsWith(".webm")) {
        cb(null, `${randomUUID()}.webm`);
        return;
      }
      cb(null, `${randomUUID()}.mp4`);
    },
  }),
  limits: { fileSize: 120 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (resolvedLessonVideoMeta(file)) {
      cb(null, true);
      return;
    }
    const name = String(file.originalname || "").toLowerCase();
    if (name.endsWith(".mp4") || name.endsWith(".webm")) {
      cb(null, true);
      return;
    }
    cb(
      new Error(
        "Only MP4 or WebM lesson videos are allowed (use a .mp4 or .webm file)."
      )
    );
  },
});
/** Written by `npm run dev:all` when Vite prints its Local URL (gitignored). */
const FRONTEND_DEV_HINT_FILE = path.join(SERVER_DIR, "..", ".frontend-dev-url");
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

function requiredEnv(name) {
  const val = String(process.env[name] || "").trim();
  if (val) return val;
  throw new Error(`Missing required environment variable: ${name}`);
}

function parseCsvEnv(v) {
  return String(v || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

const SESSION_SECRET = IS_PROD
  ? requiredEnv("SESSION_SECRET")
  : process.env.SESSION_SECRET || "eduspmhub-dev-secret-change-in-production";
const ADMIN_KEY = IS_PROD
  ? requiredEnv("ADMIN_KEY")
  : process.env.ADMIN_KEY || "dev-admin-change-me";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** HMAC secret for short-lived lesson PDF/video URLs (defaults to session secret). */
const LESSON_MEDIA_TOKEN_SECRET =
  process.env.LESSON_MEDIA_TOKEN_SECRET || SESSION_SECRET;
const ALLOWED_CORS_ORIGINS = new Set(parseCsvEnv(process.env.CORS_ORIGINS));
if (IS_PROD && ALLOWED_CORS_ORIGINS.size === 0) {
  throw new Error(
    "Missing required environment variable: CORS_ORIGINS (comma-separated allowed origins)"
  );
}

function corsOrigin(origin, cb) {
  if (!origin) {
    cb(null, true);
    return;
  }
  if (!IS_PROD) {
    cb(null, true);
    return;
  }
  if (ALLOWED_CORS_ORIGINS.has(origin)) {
    cb(null, true);
    return;
  }
  cb(new Error("CORS origin not allowed"));
}

const LESSON_MEDIA_TOKEN_TTL_SEC = (() => {
  const raw = Number.parseInt(process.env.LESSON_MEDIA_TOKEN_TTL_SEC || "", 10);
  if (Number.isFinite(raw) && raw >= 300 && raw <= 86400) return raw;
  return 5400;
})();

function signLessonStreamToken(payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", LESSON_MEDIA_TOKEN_SECRET);
  mac.update(payloadB64);
  const sig = mac.digest("base64url");
  return `${payloadB64}.${sig}`;
}

function verifyLessonStreamToken(tokenStr) {
  if (!tokenStr || typeof tokenStr !== "string") return null;
  const dot = tokenStr.indexOf(".");
  if (dot === -1) return null;
  const payloadB64 = tokenStr.slice(0, dot);
  const sig = tokenStr.slice(dot + 1);
  const mac = createHmac("sha256", LESSON_MEDIA_TOKEN_SECRET);
  mac.update(payloadB64);
  const expected = mac.digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    const data = JSON.parse(json);
    if (!data || typeof data.uid !== "string" || typeof data.cid !== "string") return null;
    if (data.kind !== "pdf" && data.kind !== "video") return null;
    if (typeof data.exp !== "number" || Date.now() / 1000 > data.exp) return null;
    const li = Number.parseInt(String(data.li), 10);
    if (!Number.isFinite(li)) return null;
    data.li = li;
    return data;
  } catch {
    return null;
  }
}

function streamTokenMatchesLesson(data, courseId, lessonIndex, kind) {
  const cid = typeof courseId === "string" ? courseId.trim() : String(courseId ?? "");
  if (data.cid !== cid) return false;
  if (data.li !== lessonIndex) return false;
  if (data.kind !== kind) return false;
  return true;
}

/** Optional ?st=… token must match session user and route; always re-checks course access. */
async function lessonStreamAccess(req, courseId, lessonIndex, kind) {
  const uid = req.session.userId;
  if (!uid) return { err: 401, msg: "Not signed in" };
  const cid = typeof courseId === "string" ? courseId.trim() : courseId;
  const li = Number.parseInt(String(lessonIndex), 10);
  const st = typeof req.query.st === "string" ? req.query.st.trim() : "";
  if (st) {
    const data = verifyLessonStreamToken(st);
    if (!data || data.uid !== uid || !streamTokenMatchesLesson(data, cid, li, kind)) {
      return { err: 403, msg: "Invalid or expired stream link" };
    }
  }
  return courseAccessContext(uid, cid);
}

const app = express();
const sessionStore = new SqliteSessionStore({ ttlMs: SESSION_MAX_AGE_MS });

function makeLimiter({ windowMs, max, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    message: { error: message },
  });
}

const registerLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: "Too many registration attempts. Please try again later.",
});
const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  message: "Too many login attempts. Please try again in a few minutes.",
});
const adminLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many admin requests. Please slow down and try again shortly.",
});

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    allowedHeaders: ["Content-Type", "X-Admin-Key"],
  })
);
app.use(express.json({ limit: "8mb" }));

app.use(
  session({
    name: "eduspmhub.sid",
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_MS,
      secure: IS_PROD,
    },
  })
);

app.get("/", (_req, res) => {
  let viteUrl = "";
  try {
    if (existsSync(FRONTEND_DEV_HINT_FILE)) {
      viteUrl = readFileSync(FRONTEND_DEV_HINT_FILE, "utf8").trim().replace(/\/$/, "");
    }
  } catch {
    /* ignore */
  }
  const port = _req.socket?.localPort ?? "";
  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EduSPM Hub — API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2.5rem auto; padding: 0 1rem; line-height: 1.5; color: #1a1a1a; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #444; }
    .box { background: #f4f7fb; border: 1px solid #c5d4e8; border-radius: 10px; padding: 1rem 1.25rem; margin: 1.25rem 0; }
    a.btn { display: inline-block; background: #2563eb; color: #fff !important; text-decoration: none; padding: 0.55rem 1.1rem; border-radius: 8px; font-weight: 500; margin-top: 0.5rem; }
    a.btn:hover { background: #1d4ed8; }
    code { background: #eef2f7; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
    ul { color: #555; }
  </style>
</head>
<body>
  <h1>This address is the API server</h1>
  <p>You opened <strong>http://localhost:${esc(port)}</strong> — that port serves JSON under <code>/api/…</code> only. The React app runs on a <em>different</em> port (Vite, usually <code>5173</code>).</p>
  ${
    viteUrl
      ? `<div class="box"><p><strong>Open the app:</strong></p><p><a class="btn" href="${esc(viteUrl)}">Go to EduSPM Hub →</a></p><p style="margin-bottom:0;font-size:0.9rem">${esc(viteUrl)}</p></div>`
      : `<div class="box"><p><strong>What to do:</strong> run <code>npm run dev:all</code>, then in the terminal find the line <code>Local: http://localhost:…</code> and open that URL in your browser.</p></div>`
  }
  <p>Quick checks:</p>
  <ul>
    <li><a href="/api/health"><code>/api/health</code></a></li>
  </ul>
</body>
</html>`);
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not signed in" });
  }
  next();
}

async function requireEducatorVerified(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not signed in" });
  }
  try {
    const users = await loadUsers();
    const u = findUserById(users, req.session.userId);
    if (!u || u.role !== "educator") {
      return res.status(403).json({ error: "Educator access only" });
    }
    if (!u.verified) {
      return res.status(403).json({
        error:
          "Only verified educators can use this action. Upload your certified licence on Profile and wait for staff approval.",
        code: "EDUCATOR_PENDING",
      });
    }
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
}

async function getMergedPublicCourses(users) {
  const custom = await loadEducatorCourses();
  const published = custom.filter((c) => c.status === "published");
  const extra = published.map((c) => {
    const owner = findUserById(users, c.educatorId);
    return mapPublishedToCatalogShape(c, owner?.fullName);
  });
  return [...CATALOG.map((c) => ({ ...c, source: "catalog" })), ...extra];
}

async function resolveStudentEnrolledCourseRow(courseId, users, ecList) {
  const built = CATALOG.find((c) => c.id === courseId);
  if (built) return { ...built, source: "catalog" };
  const c = ecList.find((x) => x.id === courseId);
  if (!c || c.status !== "published") return null;
  const owner = findUserById(users, c.educatorId);
  return mapPublishedToCatalogShape(c, owner?.fullName);
}

async function removeCourseIdFromEnrollments(courseId) {
  const enroll = await loadEnrollments();
  let changed = false;
  for (const uid of Object.keys(enroll)) {
    const list = enroll[uid];
    if (!Array.isArray(list)) continue;
    const next = list.filter((id) => id !== courseId);
    if (next.length !== list.length) {
      enroll[uid] = next;
      changed = true;
    }
  }
  if (changed) await saveEnrollments(enroll);
}

async function unlinkLessonPdfFile(key) {
  if (!isSafeLessonPdfKey(key)) return;
  const abs = path.join(LESSON_PDF_DIR, key);
  await unlink(abs).catch(() => {});
}

async function unlinkLessonVideoFile(key) {
  if (!isSafeLessonVideoKey(key)) return;
  const abs = path.join(LESSON_VIDEO_DIR, key);
  await unlink(abs).catch(() => {});
}

async function unlinkCourseLessonAttachments(course) {
  const pages = course?.lessonPages || [];
  for (const p of pages) {
    await unlinkLessonPdfFile(p?.pdfKey);
    await unlinkLessonVideoFile(p?.videoKey);
  }
}

/** When lesson rows change (e.g. embed replaces upload), remove old files from disk. */
async function unlinkOrphanedLessonFiles(prevPages, nextPages) {
  const len = Math.max(
    Array.isArray(prevPages) ? prevPages.length : 0,
    Array.isArray(nextPages) ? nextPages.length : 0
  );
  for (let i = 0; i < len; i++) {
    const o = prevPages && prevPages[i];
    const n = nextPages && nextPages[i];
    if (o?.pdfKey && (!n || o.pdfKey !== n.pdfKey)) await unlinkLessonPdfFile(o.pdfKey);
    if (o?.videoKey && (!n || o.videoKey !== n.videoKey)) await unlinkLessonVideoFile(o.videoKey);
  }
}

/** Student (enrolled + published) or owning educator — same rules as lesson viewer. */
async function courseAccessContext(userId, courseId) {
  const id = typeof courseId === "string" ? courseId.trim() : courseId;
  const users = await loadUsers();
  const u = findUserById(users, userId);
  if (!u) return { err: 401, msg: "Unauthorized" };
  const list = await loadEducatorCourses();
  const c = list.find((x) => x.id === id);
  if (!c) return { err: 404, msg: "Course not found" };
  const owner = u.role === "educator" && c.educatorId === u.id;
  let ok = false;
  if (owner) ok = true;
  else if (u.role === "student") {
    const enroll = await loadEnrollments();
    const ids = enroll[u.id] || [];
    if (ids.includes(id) && c.status === "published") ok = true;
  }
  if (!ok) {
    return {
      err: 403,
      msg:
        "You cannot open this course. Enrol from Browse while signed in as a student, or sign in as the educator who owns it.",
    };
  }
  return { user: u, course: c, list };
}

async function loadOwnedEducatorCourse(req, res, next) {
  try {
    const users = await loadUsers();
    const u = findUserById(users, req.session.userId);
    if (!u || u.role !== "educator") {
      return res.status(403).json({ error: "Educator access only" });
    }
    const id = typeof req.params.id === "string" ? req.params.id.trim() : req.params.id;
    const list = await loadEducatorCourses();
    const course = list.find((c) => c.id === id);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (course.educatorId !== u.id) {
      return res.status(403).json({ error: "Not your course" });
    }
    req.ecCourse = course;
    req.ecList = list;
    req.ecUser = u;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, catalogSeedRows: CATALOG.length });
});

app.get("/api/dashboard/featured", async (req, res) => {
  try {
    const data = await buildFeaturedPayload(req.session?.userId);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load featured content" });
  }
});

const authAdminDeps = {
  registerLimiter,
  loginLimiter,
  adminLimiter,
  ADMIN_KEY,
  LICENSE_DIR,
  isSafeLicenseStorageKey,
  loadUsers,
  saveUsers,
  findUserByEmail,
  findUserById,
  toPublicUser,
  isLikelySchoolEmail,
  bcrypt,
  randomUUID,
  existsSync,
  path,
};

const profileDeps = {
  requireAuth,
  runLicenseUpload,
  runProfilePhotoUpload,
  loadUsers,
  saveUsers,
  findUserById,
  toPublicUser,
  unlink,
  resolvedLicenseMeta,
  isSafeLicenseStorageKey,
  LICENSE_DIR,
  path,
  resolvedAvatarMeta,
  isSafeAvatarStorageKey,
  unlinkAvatarFile,
  PROFILE_PHOTO_DIR,
  existsSync,
};

const educatorDeps = {
  requireAuth,
  requireEducatorVerified,
  loadOwnedEducatorCourse,
  runLessonPdfUpload,
  runLessonVideoUpload,
  loadUsers,
  loadEnrollments,
  loadEducatorCourses,
  saveEducatorCourses,
  findUserById,
  getEducatorCourseEnrollmentsSummary,
  mapToManagedRow,
  normalizePrice,
  clampLessons,
  normalizeLessonPages,
  parseExternalVideoUrl,
  isSafeLessonPdfKey,
  isSafeLessonVideoKey,
  unlinkLessonPdfFile,
  unlinkLessonVideoFile,
  unlinkOrphanedLessonFiles,
  unlinkCourseLessonAttachments,
  removeCourseIdFromEnrollments,
  randomUUID,
  unlink,
};

const courseDeps = {
  requireAuth,
  CATALOG,
  loadUsers,
  loadEnrollments,
  saveEnrollments,
  loadEducatorCourses,
  findUserById,
  toPublicTutorProfile,
  mapPublishedToCatalogShape,
  getMergedPublicCourses,
  resolveStudentEnrolledCourseRow,
  getEducatorCourseEnrollmentsSummary,
  mapToManagedRow,
  courseAccessContext,
  lessonStreamAccess,
  normalizeLessonPages,
  isSafeLessonPdfKey,
  isSafeLessonVideoKey,
  LESSON_PDF_DIR,
  LESSON_VIDEO_DIR,
  existsSync,
  path,
  lessonVideoContentType,
  isValidEmbedObject,
  LESSON_MEDIA_TOKEN_TTL_SEC,
  signLessonStreamToken,
};

registerAuthAdminRoutes(app, authAdminDeps);
registerProfileRoutes(app, profileDeps);
registerEducatorRoutes(app, educatorDeps);
registerCourseRoutes(app, courseDeps);

function runLicenseUpload(req, res, next) {
  licenseUpload.single("license")(req, res, (err) => {
    if (err) {
      let msg = err.message || "Upload failed";
      if (err.code === "LIMIT_FILE_SIZE") msg = "File too large (max 8 MB)";
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

function runLessonPdfUpload(req, res, next) {
  lessonPdfUpload.single("pdf")(req, res, (err) => {
    if (err) {
      let msg = err.message || "Upload failed";
      if (err.code === "LIMIT_FILE_SIZE") msg = "PDF too large (max 15 MB)";
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

function runLessonVideoUpload(req, res, next) {
  lessonVideoUpload.single("video")(req, res, (err) => {
    if (err) {
      let msg = err.message || "Upload failed";
      if (err.code === "LIMIT_FILE_SIZE") msg = "Video too large (max 120 MB)";
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

const profilePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, PROFILE_PHOTO_DIR);
    },
    filename: (_req, file, cb) => {
      const meta = resolvedAvatarMeta(file);
      if (!meta) {
        cb(new Error("Only JPEG, PNG, or WebP images are allowed"));
        return;
      }
      cb(null, `${randomUUID()}${meta.ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (resolvedAvatarMeta(file)) cb(null, true);
    else
      cb(
        new Error(
          "Only JPEG, PNG, or WebP uploads are allowed (use .jpg, .png, or .webp)."
        )
      );
  },
});

function runProfilePhotoUpload(req, res, next) {
  profilePhotoUpload.single("photo")(req, res, (err) => {
    if (err) {
      let msg = err.message || "Upload failed";
      if (err.code === "LIMIT_FILE_SIZE") msg = "Photo too large (max 3 MB)";
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

/** Try successive ports when the preferred one is already in use (e.g. a previous dev server). */
function listenWithFallback(app, startPort, maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryOnce = () => {
      if (port >= startPort + maxAttempts) {
        reject(
          new Error(
            `No free API port in range ${startPort}–${startPort + maxAttempts - 1}`
          )
        );
        return;
      }
      const server = http.createServer(app);
      const onError = (err) => {
        server.removeListener("listening", onListening);
        if (err.code === "EADDRINUSE") {
          console.warn(
            `EduSPM Hub API: port ${port} in use, trying ${port + 1}…`
          );
          port += 1;
          tryOnce();
        } else {
          reject(err);
        }
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve({ server, port });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port);
    };
    tryOnce();
  });
}

listenWithFallback(app, PREFERRED_PORT)
  .then(({ port }) => {
    // Machine-readable line for `npm run dev:all` so Vite can proxy to the real port.
    console.log(`EduSPM_API_PORT=${port}`);
    console.log(`EduSPM Hub API http://localhost:${port}`);
    console.log(
      `Built-in catalogue seed rows: ${CATALOG.length} (tutor listings are stored in SQLite at server/data/eduspmhub.sqlite by default)`
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
