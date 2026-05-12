import express from "express";
import session from "express-session";
import cors from "cors";
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
const SESSION_SECRET =
  process.env.SESSION_SECRET || "eduspmhub-dev-secret-change-in-production";
const ADMIN_KEY = process.env.ADMIN_KEY || "dev-admin-change-me";

/** HMAC secret for short-lived lesson PDF/video URLs (defaults to session secret). */
const LESSON_MEDIA_TOKEN_SECRET =
  process.env.LESSON_MEDIA_TOKEN_SECRET || SESSION_SECRET;
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

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "X-Admin-Key"],
  })
);
app.use(express.json({ limit: "8mb" }));

app.use(
  session({
    name: "eduspmhub.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === "production",
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

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  const users = await loadUsers();
  const u = findUserById(users, req.session.userId);
  if (!u) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  res.json({ user: toPublicUser(u) });
});

/** Public tutor card for signed-in learners — no email; lists published courses only. */
app.get("/api/tutors/:userId", requireAuth, async (req, res) => {
  try {
    const userId =
      typeof req.params.userId === "string" ? req.params.userId.trim() : req.params.userId;
    const users = await loadUsers();
    const u = findUserById(users, userId);
    if (!u || u.role !== "educator") {
      return res.status(404).json({ error: "Tutor not found" });
    }
    const tutor = toPublicTutorProfile(u);
    if (!tutor) {
      return res.status(404).json({ error: "Tutor not found" });
    }
    const ec = await loadEducatorCourses();
    const published = ec.filter((c) => c.educatorId === u.id && c.status === "published");
    const courses = published.map((c) => mapPublishedToCatalogShape(c, u.fullName));
    res.json({ tutor, courses });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load tutor profile" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const {
      email,
      password,
      role,
      fullName,
      schoolName,
      studentForm,
      studentSubject,
      educatorInstitution,
      educatorSubject,
      educatorBio,
    } = req.body;

    if (!email || !password || !fullName || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!["student", "educator"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    if (role === "student") {
      if (!studentSubject) {
        return res.status(400).json({ error: "Subject is required for students" });
      }
      if (!schoolName || !String(schoolName).trim()) {
        return res.status(400).json({ error: "School name is required" });
      }
      if (!isLikelySchoolEmail(String(email))) {
        return res.status(400).json({
          error:
            "Students must register with a school email (not free providers like Gmail).",
        });
      }
    }

    if (role === "educator") {
      if (!educatorSubject) {
        return res.status(400).json({ error: "Subject is required for educators" });
      }
      if (!educatorInstitution || !String(educatorInstitution).trim()) {
        return res.status(400).json({ error: "Institution is required for educators" });
      }
    }

    const users = await loadUsers();
    if (findUserByEmail(users, email)) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: randomUUID(),
      email: String(email).trim().toLowerCase(),
      passwordHash,
      role,
      verified: role === "student",
      fullName: String(fullName).trim(),
      schoolName: role === "student" ? String(schoolName).trim() : "",
      studentForm: role === "student" ? String(studentForm || "") : "",
      studentSubject: role === "student" ? String(studentSubject) : "",
      educatorInstitution:
        role === "educator" ? String(educatorInstitution).trim() : "",
      educatorSubject: role === "educator" ? String(educatorSubject) : "",
      educatorBio: role === "educator" ? String(educatorBio || "").trim() : "",
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    await saveUsers(users);

    req.session.userId = user.id;
    res.status(201).json({ user: toPublicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const users = await loadUsers();
    const user = findUserByEmail(users, email);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    req.session.userId = user.id;
    res.json({ user: toPublicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.clearCookie("eduspmhub.sid");
    res.json({ ok: true });
  });
});

app.patch("/api/profile", requireAuth, async (req, res) => {
  try {
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === req.session.userId);
    if (idx === -1) return res.status(404).json({ error: "User not found" });
    const u = users[idx];
    const { fullName, schoolName, studentForm, educatorInstitution, educatorBio } =
      req.body;

    if (fullName != null) u.fullName = String(fullName).trim();
    if (u.role === "student") {
      if (schoolName != null) u.schoolName = String(schoolName).trim();
      if (studentForm != null) u.studentForm = String(studentForm);
    }
    if (u.role === "educator") {
      if (educatorInstitution != null) {
        u.educatorInstitution = String(educatorInstitution).trim();
      }
      if (educatorBio != null) u.educatorBio = String(educatorBio).trim();
    }

    users[idx] = u;
    await saveUsers(users);
    res.json({ user: toPublicUser(u) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Update failed" });
  }
});

app.get("/api/courses", async (_req, res) => {
  try {
    const users = await loadUsers();
    const courses = await getMergedPublicCourses(users);
    const fromBuiltInCatalog = courses.filter((c) => c.source === "catalog").length;
    const fromEducators = courses.filter((c) => c.source === "educator").length;
    res.json({
      courses,
      stats: { fromBuiltInCatalog, fromEducators },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load courses" });
  }
});

const CATALOG_COURSE_BLURB =
  "Curated SPM module on EduSPM Hub. Enrol to save it under My courses and keep your revision on track.";

app.get("/api/courses/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const built = CATALOG.find((c) => c.id === id);
    if (built) {
      return res.json({
        course: {
          ...built,
          source: "catalog",
          description: CATALOG_COURSE_BLURB,
        },
      });
    }
    const users = await loadUsers();
    const list = await loadEducatorCourses();
    const c = list.find((x) => x.id === id);
    if (!c || c.status !== "published") {
      return res.status(404).json({ error: "Course not found" });
    }
    const owner = findUserById(users, c.educatorId);
    const row = mapPublishedToCatalogShape(c, owner?.fullName);
    res.json({
      course: {
        ...row,
        description:
          c.description?.trim() ||
          "Tutor-published SPM course on EduSPM Hub. Enrol to add it to your study plan.",
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load course" });
  }
});

app.get("/api/my-courses", requireAuth, async (req, res) => {
  try {
    const users = await loadUsers();
    const u = findUserById(users, req.session.userId);
    if (u?.role === "educator") {
      const list = (await loadEducatorCourses()).filter((c) => c.educatorId === u.id);
      list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return res.json({
        courses: list.map((c) => mapToManagedRow(c, u.fullName)),
      });
    }
    const enroll = await loadEnrollments();
    const ids = enroll[req.session.userId] || [];
    const ecList = await loadEducatorCourses();
    const courses = [];
    for (const id of ids) {
      const row = await resolveStudentEnrolledCourseRow(id, users, ecList);
      if (row) courses.push(row);
    }
    res.json({ courses });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load courses" });
  }
});

/** Short-lived signed URL for embedded PDF/video (same session user only; expires after TTL). */
app.get(
  "/api/course-access/:courseId/lesson-stream-url",
  requireAuth,
  async (req, res) => {
    try {
      const courseId =
        typeof req.params.courseId === "string"
          ? req.params.courseId.trim()
          : req.params.courseId;
      const ctx = await courseAccessContext(req.session.userId, courseId);
      if (ctx.err) return res.status(ctx.err).json({ error: ctx.msg });
      const lessonIndex = Number.parseInt(String(req.query.lesson ?? ""), 10);
      const kind = String(req.query.kind || "").toLowerCase();
      if (kind !== "pdf" && kind !== "video") {
        return res.status(400).json({ error: "kind must be pdf or video" });
      }
      const { course } = ctx;
      if (
        !Number.isFinite(lessonIndex) ||
        lessonIndex < 0 ||
        lessonIndex >= course.lessons
      ) {
        return res.status(400).json({ error: "Invalid lesson" });
      }
      const pages = normalizeLessonPages(course.lessonPages, course.lessons);
      const row = pages[lessonIndex];
      const okPdf = kind === "pdf" && row?.pdfKey && isSafeLessonPdfKey(row.pdfKey);
      const okVid = kind === "video" && row?.videoKey && isSafeLessonVideoKey(row.videoKey);
      if (!okPdf && !okVid) {
        return res.status(404).json({
          error: kind === "pdf" ? "No PDF for this lesson" : "No video for this lesson",
        });
      }
      const exp = Math.floor(Date.now() / 1000) + LESSON_MEDIA_TOKEN_TTL_SEC;
      const token = signLessonStreamToken({
        uid: req.session.userId,
        cid: course.id,
        li: lessonIndex,
        kind,
        exp,
      });
      const sub = kind === "pdf" ? "pdf" : "video";
      const path = `/api/course-access/${encodeURIComponent(course.id)}/lessons/${lessonIndex}/${sub}?st=${encodeURIComponent(token)}`;
      res.json({
        url: path,
        expiresInSec: LESSON_MEDIA_TOKEN_TTL_SEC,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not issue stream URL" });
    }
  }
);

/** Inline PDF for a lesson (same auth as course access). */
app.get(
  "/api/course-access/:courseId/lessons/:lessonIndex/pdf",
  requireAuth,
  async (req, res) => {
    try {
      const courseId =
        typeof req.params.courseId === "string"
          ? req.params.courseId.trim()
          : req.params.courseId;
      const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
      const ctx = await lessonStreamAccess(req, courseId, lessonIndex, "pdf");
      if (ctx.err) return res.status(ctx.err).json({ error: ctx.msg });
      const { course } = ctx;
      if (
        !Number.isFinite(lessonIndex) ||
        lessonIndex < 0 ||
        lessonIndex >= course.lessons
      ) {
        return res.status(400).json({ error: "Invalid lesson index" });
      }
      const pages = normalizeLessonPages(course.lessonPages, course.lessons);
      const row = pages[lessonIndex];
      const key = row?.pdfKey;
      if (!key || !isSafeLessonPdfKey(key)) {
        return res.status(404).json({ error: "No PDF for this lesson" });
      }
      const abs = path.join(LESSON_PDF_DIR, key);
      if (!existsSync(abs)) return res.status(404).json({ error: "File missing" });
      const rawName = row.pdfOriginalName || "lesson.pdf";
      const asciiName =
        String(rawName)
          .replace(/[^\w.\- ()]+/g, "_")
          .slice(0, 120) || "lesson.pdf";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${asciiName}"`);
      res.sendFile(path.resolve(abs));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load PDF" });
    }
  }
);

/** Inline lesson video (same auth as course access; Range requests supported for seeking). */
app.get(
  "/api/course-access/:courseId/lessons/:lessonIndex/video",
  requireAuth,
  async (req, res) => {
    try {
      const courseId =
        typeof req.params.courseId === "string"
          ? req.params.courseId.trim()
          : req.params.courseId;
      const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
      const ctx = await lessonStreamAccess(req, courseId, lessonIndex, "video");
      if (!key || !isSafeLessonVideoKey(key)) {
        return res.status(404).json({ error: "No video for this lesson" });
      }
      const abs = path.join(LESSON_VIDEO_DIR, key);
      if (!existsSync(abs)) return res.status(404).json({ error: "File missing" });
      const rawName = row.videoOriginalName || "lesson.mp4";
      const asciiName =
        String(rawName)
          .replace(/[^\w.\- ()]+/g, "_")
          .slice(0, 120) || "lesson.mp4";
      res.setHeader("Content-Type", lessonVideoContentType(key));
      res.setHeader("Content-Disposition", `inline; filename="${asciiName}"`);
      res.sendFile(path.resolve(abs));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load video" });
    }
  }
);

/** Full lesson content: enrolled students (published) or the owning educator (any status). */
app.get("/api/course-access/:courseId", requireAuth, async (req, res) => {
  try {
    const courseId = req.params.courseId;
    const ctx = await courseAccessContext(req.session.userId, courseId);
    if (ctx.err) return res.status(ctx.err).json({ error: ctx.msg });
    const { course } = ctx;
    const users = await loadUsers();
    const owner = findUserById(users, course.educatorId);
    const pages = normalizeLessonPages(course.lessonPages, course.lessons);
    const lessonPages = pages.map((p) => {
      const ev = p.embedVideo;
      const hasExternal = isValidEmbedObject(ev);
      let externalVideoUrl = "";
      if (hasExternal && ev.provider === "youtube") {
        externalVideoUrl = `https://www.youtube.com/watch?v=${ev.id}`;
      } else if (hasExternal && ev.provider === "vimeo") {
        externalVideoUrl = `https://vimeo.com/${ev.id}`;
      }
      return {
        title: p.title,
        body: p.body,
        hasPdf: Boolean(p.pdfKey),
        pdfOriginalName: p.pdfOriginalName || "",
        hasVideo: Boolean(p.videoKey),
        videoOriginalName: p.videoOriginalName || "",
        hasExternalVideo: hasExternal,
        externalVideoProvider: hasExternal ? ev.provider : "",
        externalVideoId: hasExternal ? ev.id : "",
        externalVideoUrl,
      };
    });
    res.json({
      course: {
        id: course.id,
        title: course.title,
        subject: course.subject,
        description: course.description || "",
        lessons: course.lessons,
        price: course.price,
        thumb: course.thumb || "",
        status: course.status,
        educator: owner?.fullName || "Educator",
        educatorId: course.educatorId,
        source: "educator",
      },
      lessonPages,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load course" });
  }
});

app.post("/api/my-courses/enroll", requireAuth, async (req, res) => {
  try {
    const { courseId } = req.body;
    if (!courseId) {
      return res.status(400).json({ error: "courseId required" });
    }
    const users = await loadUsers();
    const u = findUserById(users, req.session.userId);
    if (u?.role !== "student") {
      return res.status(403).json({ error: "Only students can enrol in courses" });
    }
    const ecList = await loadEducatorCourses();
    const row = await resolveStudentEnrolledCourseRow(courseId, users, ecList);
    if (!row) {
      return res.status(400).json({ error: "Invalid or unpublished course" });
    }
    const enroll = await loadEnrollments();
    const list = enroll[req.session.userId] || [];
    if (!list.includes(courseId)) {
      list.push(courseId);
      enroll[req.session.userId] = list;
      await saveEnrollments(enroll);
    }
    const courses = [];
    for (const id of list) {
      const r = await resolveStudentEnrolledCourseRow(id, users, ecList);
      if (r) courses.push(r);
    }
    res.json({ courses });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Enrol failed" });
  }
});

app.get("/api/educator/status", requireAuth, async (req, res) => {
  const users = await loadUsers();
  const u = findUserById(users, req.session.userId);
  if (!u || u.role !== "educator") {
    return res.status(403).json({ error: "Not an educator" });
  }
  res.json({
    verified: Boolean(u.verified),
    canAddCourse: Boolean(u.verified),
    canPublish: Boolean(u.verified),
    hasLicenseDocument: Boolean(u.licenseStorageKey),
  });
});

app.post("/api/educator/courses", requireEducatorVerified, async (req, res) => {
  try {
    const users = await loadUsers();
    const u = findUserById(users, req.session.userId);
    const {
      title,
      description = "",
      subject,
      price,
      lessons = 1,
      thumb = "",
      status = "draft",
    } = req.body || {};
    const t = String(title || "").trim();
    if (!t) return res.status(400).json({ error: "Title is required" });
    const subj = String(subject || "").trim();
    if (!subj) return res.status(400).json({ error: "Subject is required" });
    let st = String(status || "draft").toLowerCase();
    if (st !== "draft" && st !== "published") st = "draft";
    const now = new Date().toISOString();
    const lessonsN = clampLessons(lessons);
    const course = {
      id: randomUUID(),
      educatorId: u.id,
      title: t.slice(0, 200),
      description: String(description || "").slice(0, 8000),
      subject: subj.slice(0, 120),
      price: normalizePrice(price),
      lessons: lessonsN,
      lessonPages: normalizeLessonPages(req.body?.lessonPages, lessonsN),
      thumb: String(thumb || "").slice(0, 24),
      status: st,
      createdAt: now,
      updatedAt: now,
    };
    const list = await loadEducatorCourses();
    list.push(course);
    await saveEducatorCourses(list);
    res.status(201).json({ course: mapToManagedRow(course, u.fullName) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create course" });
  }
});

app.patch(
  "/api/educator/courses/:id",
  requireEducatorVerified,
  loadOwnedEducatorCourse,
  async (req, res) => {
    try {
      const { title, description, subject, price, lessons, thumb, status, lessonPages } =
        req.body || {};
      const list = req.ecList;
      const course = req.ecCourse;
      const idx = list.findIndex((c) => c.id === course.id);
      if (idx === -1) {
        console.error("PATCH educator course: course missing from list", course.id);
        return res.status(500).json({ error: "Server could not update course (store mismatch)" });
      }
      const mergeMediaFrom = [...(course.lessonPages || [])];
      if (title != null) {
        const nt = String(title).trim();
        if (nt) course.title = nt.slice(0, 200);
      }
      if (description != null) course.description = String(description).slice(0, 8000);
      if (subject != null) {
        const ns = String(subject).trim();
        if (ns) course.subject = ns.slice(0, 120);
      }
      if (price != null) course.price = normalizePrice(price);
      if (lessons != null) {
        const newN = clampLessons(lessons);
        const oldPages = mergeMediaFrom;
        if (newN < oldPages.length) {
          for (let j = newN; j < oldPages.length; j++) {
            await unlinkLessonPdfFile(oldPages[j]?.pdfKey);
            await unlinkLessonVideoFile(oldPages[j]?.videoKey);
          }
        }
        course.lessons = newN;
      }
      if (thumb != null) course.thumb = String(thumb).slice(0, 24);
      if (status != null) {
        const s = String(status).toLowerCase();
        if (s === "draft" || s === "published") course.status = s;
      }
      if (lessonPages != null) {
        const lpArr = Array.isArray(lessonPages) ? lessonPages : [];
        for (let i = 0; i < lpArr.length; i++) {
          const cell = lpArr[i];
          if (cell && Object.prototype.hasOwnProperty.call(cell, "externalVideoUrl")) {
            const t = String(cell.externalVideoUrl ?? "").trim();
            if (t && !parseExternalVideoUrl(t)) {
              return res.status(400).json({
                error: `Lesson ${i + 1}: use a full YouTube or Vimeo watch link (that URL was not recognised).`,
              });
            }
          }
        }
        const nextPages = normalizeLessonPages(lessonPages, course.lessons, mergeMediaFrom);
        await unlinkOrphanedLessonFiles(mergeMediaFrom, nextPages);
        course.lessonPages = nextPages;
      } else if (lessons != null) {
        course.lessonPages = normalizeLessonPages(mergeMediaFrom, course.lessons, mergeMediaFrom);
      }
      course.updatedAt = new Date().toISOString();
      list[idx] = course;
      await saveEducatorCourses(list);
      res.json({ course: mapToManagedRow(course, req.ecUser.fullName) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Update failed" });
    }
  }
);

app.post(
  "/api/educator/courses/:id/lessons/:lessonIndex/pdf",
  requireEducatorVerified,
  loadOwnedEducatorCourse,
  runLessonPdfUpload,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'Missing file: use multipart field name "pdf" (PDF only, max 15 MB).',
        });
      }
      const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
      const course = req.ecCourse;
      const list = req.ecList;
      if (
        !Number.isFinite(lessonIndex) ||
        lessonIndex < 0 ||
        lessonIndex >= course.lessons
      ) {
        await unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: "Invalid lesson index" });
      }
      const pages = normalizeLessonPages(course.lessonPages, course.lessons);
      const oldKey = pages[lessonIndex]?.pdfKey;
      if (oldKey) await unlinkLessonPdfFile(oldKey);
      const oldVid = pages[lessonIndex]?.videoKey;
      if (oldVid) await unlinkLessonVideoFile(oldVid);
      const key = req.file.filename;
      if (!isSafeLessonPdfKey(key)) {
        await unlink(req.file.path).catch(() => {});
        return res.status(500).json({ error: "Invalid stored file name" });
      }
      pages[lessonIndex] = {
        ...pages[lessonIndex],
        pdfKey: key,
        pdfOriginalName: String(req.file.originalname || "handout.pdf").slice(0, 200),
      };
      delete pages[lessonIndex].videoKey;
      delete pages[lessonIndex].videoOriginalName;
      delete pages[lessonIndex].embedVideo;
      course.lessonPages = pages;
      course.updatedAt = new Date().toISOString();
      const idx = list.findIndex((c) => c.id === course.id);
      list[idx] = course;
      await saveEducatorCourses(list);
      res.json({
        lessonIndex,
        hasPdf: true,
        pdfOriginalName: pages[lessonIndex].pdfOriginalName,
        course: mapToManagedRow(course, req.ecUser.fullName),
      });
    } catch (e) {
      console.error(e);
      if (req.file?.path) await unlink(req.file.path).catch(() => {});
      res.status(500).json({ error: "Could not save lesson PDF" });
    }
  }
);

app.delete(
  "/api/educator/courses/:id/lessons/:lessonIndex/pdf",
  requireEducatorVerified,
  loadOwnedEducatorCourse,
  async (req, res) => {
    try {
      const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
      const course = req.ecCourse;
      const list = req.ecList;
      if (
        !Number.isFinite(lessonIndex) ||
        lessonIndex < 0 ||
        lessonIndex >= course.lessons
      ) {
        return res.status(400).json({ error: "Invalid lesson index" });
      }
      const pages = normalizeLessonPages(course.lessonPages, course.lessons);
      const oldKey = pages[lessonIndex]?.pdfKey;
      if (oldKey) await unlinkLessonPdfFile(oldKey);
      delete pages[lessonIndex].pdfKey;
      delete pages[lessonIndex].pdfOriginalName;
      course.lessonPages = pages;
      course.updatedAt = new Date().toISOString();
      const idx = list.findIndex((c) => c.id === course.id);
      list[idx] = course;
      await saveEducatorCourses(list);
      res.json({ course: mapToManagedRow(course, req.ecUser.fullName) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not remove PDF" });
    }
  }
);

app.post(
  "/api/educator/courses/:id/lessons/:lessonIndex/video",
  requireEducatorVerified,
  loadOwnedEducatorCourse,
  runLessonVideoUpload,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'Missing file: use multipart field name "video" (MP4 or WebM, max 120 MB).',
        });
      }
      const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
      const course = req.ecCourse;
      const list = req.ecList;
      if (
        !Number.isFinite(lessonIndex) ||
        lessonIndex < 0 ||
        lessonIndex >= course.lessons
      ) {
        await unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: "Invalid lesson index" });
      }
      const pages = normalizeLessonPages(course.lessonPages, course.lessons);
      const oldVid = pages[lessonIndex]?.videoKey;
      if (oldVid) await unlinkLessonVideoFile(oldVid);
      const oldPdf = pages[lessonIndex]?.pdfKey;
      if (oldPdf) await unlinkLessonPdfFile(oldPdf);
      const key = req.file.filename;
      if (!isSafeLessonVideoKey(key)) {
        await unlink(req.file.path).catch(() => {});
        return res.status(500).json({ error: "Invalid stored file name" });
      }
      pages[lessonIndex] = {
        ...pages[lessonIndex],
        videoKey: key,
        videoOriginalName: String(req.file.originalname || "lesson.mp4").slice(0, 200),
      };
      delete pages[lessonIndex].pdfKey;
      delete pages[lessonIndex].pdfOriginalName;
      delete pages[lessonIndex].embedVideo;
      course.lessonPages = pages;
      course.updatedAt = new Date().toISOString();
      const idx = list.findIndex((c) => c.id === course.id);
      list[idx] = course;
      await saveEducatorCourses(list);
      res.json({
        lessonIndex,
        hasVideo: true,
        videoOriginalName: pages[lessonIndex].videoOriginalName,
        course: mapToManagedRow(course, req.ecUser.fullName),
      });
    } catch (e) {
      console.error(e);
      if (req.file?.path) await unlink(req.file.path).catch(() => {});
      res.status(500).json({ error: "Could not save lesson video" });
    }
  }
);

app.delete(
  "/api/educator/courses/:id/lessons/:lessonIndex/video",
  requireEducatorVerified,
  loadOwnedEducatorCourse,
  async (req, res) => {
    try {
      const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
      const course = req.ecCourse;
      const list = req.ecList;
      if (
        !Number.isFinite(lessonIndex) ||
        lessonIndex < 0 ||
        lessonIndex >= course.lessons
      ) {
        return res.status(400).json({ error: "Invalid lesson index" });
      }
      const pages = normalizeLessonPages(course.lessonPages, course.lessons);
      const oldKey = pages[lessonIndex]?.videoKey;
      if (oldKey) await unlinkLessonVideoFile(oldKey);
      delete pages[lessonIndex].videoKey;
      delete pages[lessonIndex].videoOriginalName;
      course.lessonPages = pages;
      course.updatedAt = new Date().toISOString();
      const idx = list.findIndex((c) => c.id === course.id);
      list[idx] = course;
      await saveEducatorCourses(list);
      res.json({ course: mapToManagedRow(course, req.ecUser.fullName) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not remove video" });
    }
  }
);

app.delete(
  "/api/educator/courses/:id",
  requireEducatorVerified,
  loadOwnedEducatorCourse,
  async (req, res) => {
    try {
      const id = req.params.id;
      await unlinkCourseLessonAttachments(req.ecCourse);
      const list = req.ecList.filter((c) => c.id !== id);
      await saveEducatorCourses(list);
      await removeCourseIdFromEnrollments(id);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Delete failed" });
    }
  }
);

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

app.post("/api/educator/license", requireAuth, runLicenseUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Missing file: use multipart field name "license" (PDF, JPEG, or PNG).',
      });
    }
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === req.session.userId);
    if (idx === -1) {
      await unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "User not found" });
    }
    const u = users[idx];
    if (u.role !== "educator") {
      await unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: "Only educator accounts may upload a licence" });
    }
    const oldKey = u.licenseStorageKey;
    u.licenseStorageKey = req.file.filename;
    u.licenseOriginalName = String(req.file.originalname || "document").slice(0, 200);
    const meta = resolvedLicenseMeta(req.file);
    u.licenseMimeType = meta?.mime || req.file.mimetype;
    u.licenseUploadedAt = new Date().toISOString();
    users[idx] = u;
    await saveUsers(users);
    if (oldKey && oldKey !== req.file.filename && isSafeLicenseStorageKey(oldKey)) {
      const oldPath = path.join(LICENSE_DIR, oldKey);
      await unlink(oldPath).catch(() => {});
    }
    res.json({ user: toPublicUser(u) });
  } catch (e) {
    console.error(e);
    if (req.file?.path) await unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: "Could not save licence upload" });
  }
});

app.post("/api/profile/photo", requireAuth, runProfilePhotoUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Missing file: use multipart field name "photo" (JPEG, PNG, or WebP, max 3 MB).',
      });
    }
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === req.session.userId);
    if (idx === -1) {
      await unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "User not found" });
    }
    const u = users[idx];
    if (u.role !== "student" && u.role !== "educator") {
      await unlink(req.file.path).catch(() => {});
      return res.status(403).json({
        error: "Profile photo is only for student or educator accounts.",
      });
    }
    const meta = resolvedAvatarMeta(req.file);
    const oldKey = u.avatarStorageKey;
    u.avatarStorageKey = req.file.filename;
    u.avatarMimeType = meta?.mime || req.file.mimetype || "image/jpeg";
    u.avatarUploadedAt = new Date().toISOString();
    users[idx] = u;
    await saveUsers(users);
    if (oldKey && oldKey !== req.file.filename && isSafeAvatarStorageKey(oldKey)) {
      await unlinkAvatarFile(oldKey);
    }
    res.json({ user: toPublicUser(u) });
  } catch (e) {
    console.error(e);
    if (req.file?.path) await unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: "Could not save profile photo" });
  }
});

app.delete("/api/profile/photo", requireAuth, async (req, res) => {
  try {
    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === req.session.userId);
    if (idx === -1) return res.status(404).json({ error: "User not found" });
    const u = users[idx];
    const oldKey = u.avatarStorageKey;
    delete u.avatarStorageKey;
    delete u.avatarMimeType;
    delete u.avatarUploadedAt;
    users[idx] = u;
    await saveUsers(users);
    if (oldKey && isSafeAvatarStorageKey(oldKey)) await unlinkAvatarFile(oldKey);
    res.json({ user: toPublicUser(u) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not remove photo" });
  }
});

app.get("/api/profile/photo/:userId", requireAuth, async (req, res) => {
  try {
    const userId =
      typeof req.params.userId === "string" ? req.params.userId.trim() : req.params.userId;
    const users = await loadUsers();
    const target = findUserById(users, userId);
    if (!target?.avatarStorageKey || !isSafeAvatarStorageKey(target.avatarStorageKey)) {
      return res.status(404).end();
    }
    const abs = path.join(PROFILE_PHOTO_DIR, target.avatarStorageKey);
    if (!existsSync(abs)) {
      return res.status(404).end();
    }
    const mime = target.avatarMimeType || "image/jpeg";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(abs, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).end();
  }
});

/** Admin: educators awaiting verification (for staff review queue). */
app.get("/api/admin/educators-pending", async (req, res) => {
  const key = req.get("x-admin-key");
  if (!key || key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const users = await loadUsers();
  const educators = users
    .filter((u) => u.role === "educator" && !u.verified)
    .map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      educatorSubject: u.educatorSubject || "",
      educatorInstitution: u.educatorInstitution || "",
      hasLicenseDocument: Boolean(u.licenseStorageKey),
      licenseUploadedAt: u.licenseUploadedAt || null,
    }));
  res.json({ educators });
});

/** Admin: download submitted licence file for review (not exposed to students). */
app.get("/api/admin/educator/:id/license", async (req, res) => {
  const key = req.get("x-admin-key");
  if (!key || key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const users = await loadUsers();
  const u = findUserById(users, req.params.id);
  if (!u || u.role !== "educator") {
    return res.status(404).json({ error: "Educator not found" });
  }
  if (!u.licenseStorageKey || !isSafeLicenseStorageKey(u.licenseStorageKey)) {
    return res.status(404).json({ error: "No licence file on record" });
  }
  const abs = path.join(LICENSE_DIR, u.licenseStorageKey);
  if (!existsSync(abs)) {
    return res.status(404).json({ error: "File missing on server" });
  }
  const mime = u.licenseMimeType || "application/octet-stream";
  res.setHeader("Content-Type", mime);
  const safeName = String(u.licenseOriginalName || "educator-licence").replace(
    /[^\w.\- ()]+/g,
    "_"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.sendFile(path.resolve(abs));
});

/** Dev / ops: verify an educator by email. Send header X-Admin-Key */
app.post("/api/admin/verify-educator", async (req, res) => {
  const key = req.get("x-admin-key");
  if (!key || key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });
  const users = await loadUsers();
  const u = findUserByEmail(users, email);
  if (!u || u.role !== "educator") {
    return res.status(404).json({ error: "Educator not found" });
  }
  if (!u.verified && !u.licenseStorageKey) {
    return res.status(400).json({
      error:
        "Cannot verify: this educator has not uploaded a certified licence document yet. Ask them to upload on Profile first.",
    });
  }
  u.verified = true;
  await saveUsers(users);
  res.json({ ok: true, user: toPublicUser(u) });
});

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
      `Built-in catalogue seed rows: ${CATALOG.length} (tutor listings are in server/data/educator-courses.json)`
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
