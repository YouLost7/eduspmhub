import {
  parseExternalVideoUrl,
  isValidEmbedObject,
} from "../src/lib/lessonEmbed.js";
import { getDb, sqlite } from "./sqlite.js";

export { parseExternalVideoUrl, isValidEmbedObject };

export async function loadEducatorCourses() {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    "SELECT data FROM educator_courses ORDER BY id ASC"
  );
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.data);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Single-row lookup by id. Prefer this over `loadEducatorCourses()` +
 * `.find(...)` wherever only one specific course is needed — e.g. resolving
 * course access for a single lesson view or progress update, which happens
 * on every lesson navigation and shouldn't scan every educator's course.
 */
export async function getEducatorCourseById(id) {
  if (!id) return null;
  const db = await getDb();
  const row = await sqlite.get(db, "SELECT data FROM educator_courses WHERE id = ?", [
    String(id),
  ]);
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

/**
 * Atomically creates or replaces a single course row, keyed by id. Callers
 * used to mutate one course in a JS array then re-save the whole table,
 * which let concurrent educators clobber each other's courses (or, on a
 * crash mid-rewrite, delete every educator's courses at once).
 */
export async function upsertEducatorCourse(course) {
  const db = await getDb();
  const id = String(course?.id || "").trim();
  await sqlite.run(
    db,
    `INSERT INTO educator_courses (id, educator_id, status, updated_at, data)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       educator_id = excluded.educator_id,
       status = excluded.status,
       updated_at = excluded.updated_at,
       data = excluded.data`,
    [
      id,
      String(course?.educatorId || ""),
      String(course?.status || ""),
      String(course?.updatedAt || course?.createdAt || ""),
      JSON.stringify(course),
    ]
  );
}

export async function deleteEducatorCourseById(id) {
  const db = await getDb();
  await sqlite.run(db, "DELETE FROM educator_courses WHERE id = ?", [String(id)]);
}

/** Same shape as CATALOG rows for browse / enrolment lists */
export function mapPublishedToCatalogShape(course, educatorFullName) {
  return {
    id: course.id,
    title: course.title,
    educator: educatorFullName || "Educator",
    lessons: course.lessons,
    price: course.price,
    subject: course.subject,
    thumb: course.thumb || "",
    source: "educator",
    educatorId: course.educatorId,
  };
}

export function clampLessons(n) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return 1;
  return Math.min(200, Math.max(1, x));
}

const MAX_LESSON_TITLE = 240;
const MAX_LESSON_BODY = 60_000;

export function isSafeLessonPdfKey(name) {
  return (
    typeof name === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(name)
  );
}

export function isSafeLessonVideoKey(name) {
  return (
    typeof name === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm)$/i.test(name)
  );
}

/**
 * @param {unknown} input
 * @param {number} lessonCount
 * @param {unknown[] | null} mergeMediaFrom prior rows to keep pdfKey / videoKey / embedVideo when input omits them (e.g. PATCH title/body only). At most one of: PDF, self-hosted video, or external embed (YouTube/Vimeo).
 */
export function normalizeLessonPages(input, lessonCount, mergeMediaFrom = null) {
  const n = clampLessons(lessonCount);
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const src = arr[i] || {};
    const prevRow = mergeMediaFrom && mergeMediaFrom[i] ? mergeMediaFrom[i] : null;
    const rawTitle = String(src.title ?? "").trim();
    const title =
      rawTitle.slice(0, MAX_LESSON_TITLE) || `Lesson ${i + 1}`;
    const body = String(src.body ?? "").slice(0, MAX_LESSON_BODY);

    let embedVideo = null;
    if (Object.prototype.hasOwnProperty.call(src, "externalVideoUrl")) {
      const trimmed = String(src.externalVideoUrl ?? "").trim();
      if (trimmed === "") {
        embedVideo = null;
      } else {
        const parsed = parseExternalVideoUrl(trimmed);
        embedVideo = isValidEmbedObject(parsed) ? parsed : null;
      }
    } else if (isValidEmbedObject(src.embedVideo)) {
      /** Persisted rows on disk are { title, body, embedVideo } — no externalVideoUrl key. */
      embedVideo = src.embedVideo;
    } else if (isValidEmbedObject(prevRow?.embedVideo)) {
      embedVideo = prevRow.embedVideo;
    }

    let pdfKey;
    let pdfOriginalName;
    let videoKey;
    let videoOriginalName;

    if (!embedVideo) {
      if (typeof src.pdfKey === "string" && isSafeLessonPdfKey(src.pdfKey)) {
        pdfKey = src.pdfKey;
        pdfOriginalName =
          String(src.pdfOriginalName || "").trim().slice(0, 200) || "handout.pdf";
      } else if (prevRow && isSafeLessonPdfKey(prevRow.pdfKey)) {
        pdfKey = prevRow.pdfKey;
        pdfOriginalName =
          String(prevRow.pdfOriginalName || "").trim().slice(0, 200) || "handout.pdf";
      }

      if (typeof src.videoKey === "string" && isSafeLessonVideoKey(src.videoKey)) {
        videoKey = src.videoKey;
        videoOriginalName =
          String(src.videoOriginalName || "").trim().slice(0, 200) || "lesson.mp4";
      } else if (prevRow && isSafeLessonVideoKey(prevRow.videoKey)) {
        videoKey = prevRow.videoKey;
        videoOriginalName =
          String(prevRow.videoOriginalName || "").trim().slice(0, 200) || "lesson.mp4";
      }

      if (pdfKey && videoKey) {
        videoKey = undefined;
        videoOriginalName = undefined;
      }
    }

    const row = { title, body };
    if (embedVideo) {
      row.embedVideo = embedVideo;
    } else if (pdfKey) {
      row.pdfKey = pdfKey;
      row.pdfOriginalName = pdfOriginalName;
    } else if (videoKey) {
      row.videoKey = videoKey;
      row.videoOriginalName = videoOriginalName;
    }
    out.push(row);
  }
  return out;
}

/** Managed API row — never expose storage keys to the browser. */
export function mapToManagedRow(course, educatorFullName) {
  const internal = normalizeLessonPages(course.lessonPages, course.lessons);
  const lessonPages = internal.map((p) => {
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
  return {
    ...mapPublishedToCatalogShape(course, educatorFullName),
    status: course.status,
    description: course.description || "",
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    lessonPages,
  };
}

export function normalizePrice(input) {
  const s = String(input ?? "").trim();
  if (!s) return "RM0.00";
  const MIN_PAID_PRICE = 2;
  if (/^RM\s*/i.test(s)) {
    const n = s.replace(/^RM\s*/i, "").trim();
    const num = Number.parseFloat(n);
    if (!Number.isFinite(num) || num < MIN_PAID_PRICE) return "RM0.00";
    return `RM${num.toFixed(2)}`;
  }
  const num = Number.parseFloat(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num) || num < MIN_PAID_PRICE) return "RM0.00";
  return `RM${num.toFixed(2)}`;
}
