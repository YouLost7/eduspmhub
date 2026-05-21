import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { apiJson, messageForFailedApiResponse } from "../api.js";
import { AppToast } from "./AppToast.jsx";
import { parseExternalVideoUrl } from "../lib/lessonEmbed.js";

const SUBJECTS = [
  "Bahasa Melayu",
  "English",
  "Mathematics",
  "Science",
  "Sejarah",
  "Physics",
  "Chemistry",
  "Biology",
  "Additional Mathematics",
  "Pendidikan Moral",
];

const THUMBS = ["", "warm", "cool", "mint", "rose", "slate", "alt", "dark", "light"];

function clampLessonCount(raw) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(200, Math.max(1, n));
}

function isPdfLikeFile(file) {
  if (!file) return false;
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.type || "").toLowerCase();
  if (name.endsWith(".pdf")) return true;
  if (mime === "application/pdf" || mime === "application/x-pdf") return true;
  if (mime.includes("pdf")) return true;
  if (mime === "application/octet-stream" && name.endsWith(".pdf")) return true;
  return false;
}

function isVideoLikeFile(file) {
  if (!file) return false;
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.type || "").toLowerCase();
  if (name.endsWith(".mp4") || name.endsWith(".webm")) return true;
  if (mime === "video/mp4" || mime === "video/webm" || mime === "video/x-m4v") return true;
  if (mime.includes("mp4")) return true;
  if (mime.includes("webm")) return true;
  if (mime === "application/octet-stream" && (name.endsWith(".mp4") || name.endsWith(".webm"))) {
    return true;
  }
  return false;
}

function newLessonPageSlot(titleFallback) {
  return {
    title: titleFallback,
    body: "",
    hasPdf: false,
    pdfOriginalName: "",
    hasVideo: false,
    videoOriginalName: "",
    hasExternalVideo: false,
    externalVideoUrl: "",
    embedUrl: "",
  };
}

function lessonSlotsFromCourse(c) {
  return Math.min(200, Math.max(1, Number.parseInt(String(c?.lessons ?? 1), 10) || 1));
}

function lessonPagesToEditState(c) {
  const n = lessonSlotsFromCourse(c);
  return Array.from({ length: n }, (_, i) => {
    const src = Array.isArray(c.lessonPages) ? c.lessonPages[i] : null;
    return {
      title: String(src?.title || `Lesson ${i + 1}`).slice(0, 240),
      body: String(src?.body || ""),
      hasPdf: Boolean(src?.hasPdf),
      pdfOriginalName: String(src?.pdfOriginalName || ""),
      hasVideo: Boolean(src?.hasVideo),
      videoOriginalName: String(src?.videoOriginalName || ""),
      hasExternalVideo: Boolean(src?.hasExternalVideo),
      externalVideoUrl: String(src?.externalVideoUrl || ""),
      embedUrl: String(src?.externalVideoUrl || ""),
    };
  });
}

export default function EducatorMyTeaching() {
  const [courses, setCourses] = useState([]);
  const [loadErr, setLoadErr] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState("");

  const [nTitle, setNTitle] = useState("");
  const [nSubject, setNSubject] = useState("Mathematics");
  const [nPrice, setNPrice] = useState("");
  const [nLessons, setNLessons] = useState(4);
  const [nDesc, setNDesc] = useState("");
  const [nThumb, setNThumb] = useState("");
  const [nPublish, setNPublish] = useState(false);

  const [editId, setEditId] = useState(null);
  const [eTitle, setETitle] = useState("");
  const [eSubject, setESubject] = useState("");
  const [ePrice, setEPrice] = useState("");
  const [eLessons, setELessons] = useState(1);
  const [eDesc, setEDesc] = useState("");
  const [eThumb, setEThumb] = useState("");
  const [eLessonPages, setELessonPages] = useState([]);
  const [openLessonIndex, setOpenLessonIndex] = useState(0);
  const [mediaBusy, setMediaBusy] = useState("");

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const courseData = await apiJson("/api/my-courses");
      setCourses(courseData.courses || []);
    } catch (e) {
      setCourses([]);
      setLoadErr(e.message || "Could not load your courses.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const maxIdx = Math.max(0, clampLessonCount(eLessons) - 1);
    if (openLessonIndex > maxIdx) {
      setOpenLessonIndex(maxIdx);
    }
  }, [eLessons, openLessonIndex]);

  function openEdit(c) {
    setEditId(c.id);
    setETitle(c.title);
    setESubject(c.subject);
    setEPrice(c.price?.replace(/^RM/i, "") || "");
    setELessons(c.lessons || 1);
    setEDesc(c.description || "");
    setEThumb(c.thumb || "");
    setELessonPages(lessonPagesToEditState(c));
    setOpenLessonIndex(0);
    setErr("");
    setMsg("");
  }

  function closeEdit() {
    setEditId(null);
    setELessonPages([]);
    setOpenLessonIndex(0);
  }

  async function createCourse(e) {
    e.preventDefault();
    setMsg("");
    setErr("");
    const title = nTitle.trim();
    if (!title) {
      setErr("Enter a course title.");
      return;
    }
    try {
      await apiJson("/api/educator/courses", {
        method: "POST",
        body: {
          title,
          subject: nSubject,
          price: nPrice,
          lessons: nLessons,
          description: nDesc,
          thumb: nThumb,
          status: nPublish ? "published" : "draft",
        },
      });
      setMsg(nPublish ? "Course created and published to Browse." : "Draft saved.");
      setNTitle("");
      setNDesc("");
      setNPrice("");
      setNLessons(4);
      setNThumb("");
      setNPublish(false);
      await load();
    } catch (ex) {
      setErr(ex.message || "Could not create course.");
    }
  }

  async function uploadLessonPdf(courseId, lessonIndex, file) {
    if (!file) {
      setErr("Please choose a file.");
      return;
    }
    if (!isPdfLikeFile(file)) {
      setErr(
        "That file does not look like a PDF. Pick a file whose name ends in .pdf. Some devices send an odd file type — renaming to handout.pdf usually fixes it."
      );
      return;
    }
    const key = `${courseId}:${lessonIndex}`;
    setMediaBusy(key);
    setErr("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch(
        `/api/educator/courses/${encodeURIComponent(courseId)}/lessons/${lessonIndex}/pdf`,
        { method: "POST", credentials: "include", body: fd }
      );
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        let msg = messageForFailedApiResponse(res, raw, data);
        if (res.status === 403 && data.code === "EDUCATOR_PENDING") {
          msg =
            "Your educator account is not verified yet. Upload your certified licence on Profile and wait for staff approval — then you can attach lesson files.";
        }
        if (res.status === 401) {
          msg = "You are not signed in (or your session expired). Log in again, then retry the upload.";
        }
        throw new Error(msg);
      }
      setELessonPages((prev) => {
        const next = [...prev];
        while (next.length <= lessonIndex) {
          next.push(newLessonPageSlot(`Lesson ${next.length + 1}`));
        }
        next[lessonIndex] = {
          ...next[lessonIndex],
          hasPdf: true,
          pdfOriginalName: data.pdfOriginalName || "handout.pdf",
          hasVideo: false,
          videoOriginalName: "",
          hasExternalVideo: false,
          externalVideoUrl: "",
          embedUrl: "",
        };
        return next;
      });
      setMsg("PDF attached to this lesson.");
      await load();
    } catch (ex) {
      setErr(ex.message || "PDF upload failed.");
    } finally {
      setMediaBusy("");
    }
  }

  async function removeLessonPdf(courseId, lessonIndex) {
    const key = `${courseId}:${lessonIndex}`;
    setMediaBusy(key);
    setErr("");
    setMsg("");
    try {
      await apiJson(
        `/api/educator/courses/${encodeURIComponent(courseId)}/lessons/${lessonIndex}/pdf`,
        { method: "DELETE" }
      );
      setELessonPages((prev) => {
        const next = [...prev];
        if (next[lessonIndex]) {
          next[lessonIndex] = {
            ...next[lessonIndex],
            hasPdf: false,
            pdfOriginalName: "",
          };
        }
        return next;
      });
      setMsg("PDF removed from this lesson.");
      await load();
    } catch (ex) {
      setErr(ex.message || "Could not remove PDF.");
    } finally {
      setMediaBusy("");
    }
  }

  async function uploadLessonVideo(courseId, lessonIndex, file) {
    if (!file) {
      setErr("Please choose a file.");
      return;
    }
    if (!isVideoLikeFile(file)) {
      setErr(
        "That file does not look like MP4 or WebM. Use a .mp4 or .webm file (common export from phone or screen recorders)."
      );
      return;
    }
    const key = `${courseId}:${lessonIndex}`;
    setMediaBusy(key);
    setErr("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("video", file);
      const res = await fetch(
        `/api/educator/courses/${encodeURIComponent(courseId)}/lessons/${lessonIndex}/video`,
        { method: "POST", credentials: "include", body: fd }
      );
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        let msg = messageForFailedApiResponse(res, raw, data);
        if (res.status === 403 && data.code === "EDUCATOR_PENDING") {
          msg =
            "Your educator account is not verified yet. Upload your certified licence on Profile and wait for staff approval — then you can attach lesson files.";
        }
        if (res.status === 401) {
          msg = "You are not signed in (or your session expired). Log in again, then retry the upload.";
        }
        throw new Error(msg);
      }
      setELessonPages((prev) => {
        const next = [...prev];
        while (next.length <= lessonIndex) {
          next.push(newLessonPageSlot(`Lesson ${next.length + 1}`));
        }
        next[lessonIndex] = {
          ...next[lessonIndex],
          hasVideo: true,
          videoOriginalName: data.videoOriginalName || "lesson.mp4",
          hasPdf: false,
          pdfOriginalName: "",
          hasExternalVideo: false,
          externalVideoUrl: "",
          embedUrl: "",
        };
        return next;
      });
      setMsg("Video attached to this lesson.");
      await load();
    } catch (ex) {
      setErr(ex.message || "Video upload failed.");
    } finally {
      setMediaBusy("");
    }
  }

  async function removeLessonVideo(courseId, lessonIndex) {
    const key = `${courseId}:${lessonIndex}`;
    setMediaBusy(key);
    setErr("");
    setMsg("");
    try {
      await apiJson(
        `/api/educator/courses/${encodeURIComponent(courseId)}/lessons/${lessonIndex}/video`,
        { method: "DELETE" }
      );
      setELessonPages((prev) => {
        const next = [...prev];
        if (next[lessonIndex]) {
          next[lessonIndex] = {
            ...next[lessonIndex],
            hasVideo: false,
            videoOriginalName: "",
          };
        }
        return next;
      });
      setMsg("Video removed from this lesson.");
      await load();
    } catch (ex) {
      setErr(ex.message || "Could not remove video.");
    } finally {
      setMediaBusy("");
    }
  }

  async function saveEdit() {
    if (!editId) return;
    const titleTrim = eTitle.trim();
    if (!titleTrim) {
      setErr("Title is required — fill in the course title before saving.");
      return;
    }
    const lessonSlots = clampLessonCount(eLessons);
    for (let i = 0; i < lessonSlots; i++) {
      const raw = String(eLessonPages[i]?.embedUrl ?? "").trim();
      if (raw && !parseExternalVideoUrl(raw)) {
        setErr(
          `Lesson ${i + 1}: paste a full YouTube or Vimeo page link (we could not read that URL).`
        );
        return;
      }
    }
    setBusyId(editId);
    setErr("");
    setMsg("");
    try {
      const data = await apiJson(`/api/educator/courses/${encodeURIComponent(editId)}`, {
        method: "PATCH",
        body: {
          title: titleTrim,
          subject: eSubject,
          price: ePrice,
          lessons: lessonSlots,
          description: eDesc,
          thumb: eThumb,
          lessonPages: Array.from({ length: lessonSlots }, (_, i) => {
            const rawEmbed = String(eLessonPages[i]?.embedUrl ?? "").trim();
            return {
              title: (eLessonPages[i]?.title || `Lesson ${i + 1}`).trim() || `Lesson ${i + 1}`,
              body: eLessonPages[i]?.body ?? "",
              externalVideoUrl: rawEmbed,
            };
          }),
        },
      });
      const saved = data?.course;
      if (saved && saved.id === editId) {
        setELessons(lessonSlotsFromCourse(saved));
        setELessonPages(lessonPagesToEditState(saved));
      } else {
        setELessons(lessonSlots);
      }
      setMsg("Changes saved. Use Preview lessons to check what students see.");
      await load();
    } catch (ex) {
      setErr(ex.message || "Save failed.");
    } finally {
      setBusyId("");
    }
  }

  async function setStatus(id, status) {
    setBusyId(id);
    setErr("");
    setMsg("");
    try {
      await apiJson(`/api/educator/courses/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { status },
      });
      setMsg(status === "published" ? "Course is live on Browse." : "Course moved to draft.");
      closeEdit();
      await load();
    } catch (ex) {
      setErr(ex.message || "Update failed.");
    } finally {
      setBusyId("");
    }
  }

  async function removeCourse(id) {
    if (!window.confirm("Delete this course permanently? Students enrolled will lose it from their list.")) {
      return;
    }
    setBusyId(id);
    setErr("");
    setMsg("");
    try {
      await apiJson(`/api/educator/courses/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setMsg("Course deleted.");
      closeEdit();
      await load();
    } catch (ex) {
      setErr(ex.message || "Delete failed.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="educator-teaching">
      <div className="user-page-intro user-page-intro--educator">
        <h1>My teaching</h1>
        <p>
          Create and publish your own SPM courses. Published courses appear in{" "}
          <Link to="/browse">Browse</Link> for students to enrol. Drafts stay private until
          you publish. After you create a course, tap <strong>Edit</strong>, set how many
          <strong>Lessons</strong> you want, then fill each lesson&apos;s <strong>Title</strong> and{" "}
          <strong>Content</strong>. Each lesson may include <strong>either</strong> a PDF handout{" "}
          <strong>or</strong> an embedded video (MP4/WebM) — not both. Media plays inside the lesson
          page for signed-in learners. Press <strong>Save changes</strong> for text; files save on
          upload. Use <strong>Preview lessons</strong> to review. Open <strong>Who enrolled</strong> on each
          course to see how many students joined and their account details.
        </p>
        <Link className="outline-btn" to="/browse">
          View public catalogue
        </Link>
      </div>

      {loadErr && (
        <p className="form-error" role="alert">
          {loadErr}
        </p>
      )}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      <section className="section-block educator-create">
        <h2>Add a new course</h2>
        <form className="profile-form" onSubmit={createCourse}>
          <div className="field">
            <label htmlFor="ec-title">Title</label>
            <input
              id="ec-title"
              value={nTitle}
              onChange={(e) => setNTitle(e.target.value)}
              placeholder="e.g. Form 5 Physics — Electricity"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="ec-subject">Subject</label>
            <select
              id="ec-subject"
              value={nSubject}
              onChange={(e) => setNSubject(e.target.value)}
            >
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="ec-price">Price (RM)</label>
              <input
                id="ec-price"
                type="text"
                inputMode="decimal"
                value={nPrice}
                onChange={(e) => setNPrice(e.target.value)}
                placeholder="e.g. 35 or 35.00"
              />
              <p className="field-hint">Minimum paid price is RM2.00. Lower values are saved as free.</p>
            </div>
            <div className="field">
              <label htmlFor="ec-lessons">Lessons</label>
              <input
                id="ec-lessons"
                type="number"
                min={1}
                max={200}
                value={nLessons}
                onChange={(e) => setNLessons(clampLessonCount(e.target.value))}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ec-thumb">Card style (optional)</label>
            <select id="ec-thumb" value={nThumb} onChange={(e) => setNThumb(e.target.value)}>
              <option value="">Default</option>
              {THUMBS.filter(Boolean).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ec-desc">Description</label>
            <textarea
              id="ec-desc"
              rows={4}
              value={nDesc}
              onChange={(e) => setNDesc(e.target.value)}
              placeholder="What students will learn, prerequisites, schedule notes…"
            />
          </div>
          <label className="checkbox-label" style={{ marginBottom: "0.75rem" }}>
            <input
              type="checkbox"
              checked={nPublish}
              onChange={(e) => setNPublish(e.target.checked)}
            />
            <span>Publish immediately (visible in Browse)</span>
          </label>
          <button type="submit" className="solid-btn">
            Save course
          </button>
        </form>
      </section>

      <section className="section-block my-list">
        <h2>Your courses ({courses.length})</h2>
        {courses.length === 0 ? (
          <p className="empty-list">No courses yet — add one above.</p>
        ) : (
          <ul className="enrol-list educator-course-list">
            {courses.map((c) => {
              const n = c.enrollmentStudentCount ?? 0;
              const students = c.enrollmentStudents ?? [];
              return (
              <motion.li
                key={c.id}
                className="educator-course-item"
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="educator-course-head">
                  <div>
                    <strong>{c.title}</strong>
                    <span className="educator-course-meta">
                      {c.subject} · {c.lessons} lessons · {c.price}
                    </span>
                    <span
                      className={
                        c.status === "published"
                          ? "role-pill role-pill--edu"
                          : "role-pill"
                      }
                      style={{ marginLeft: "0.5rem" }}
                    >
                      {c.status === "published" ? "Published" : "Draft"}
                    </span>
                  </div>
                  <div className="educator-course-actions">
                    <Link className="outline-btn" to={`/learn/${encodeURIComponent(c.id)}`}>
                      Preview lessons
                    </Link>
                    {editId !== c.id ? (
                      <button type="button" className="outline-btn" onClick={() => openEdit(c)}>
                        Edit
                      </button>
                    ) : null}
                    {c.status === "draft" ? (
                      <button
                        type="button"
                        className="solid-btn"
                        disabled={busyId === c.id}
                        onClick={() => setStatus(c.id, "published")}
                      >
                        Publish
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="outline-btn"
                        disabled={busyId === c.id}
                        onClick={() => setStatus(c.id, "draft")}
                      >
                        Unpublish
                      </button>
                    )}
                    <button
                      type="button"
                      className="outline-btn"
                      style={{ color: "#b91c1c", borderColor: "#fecaca" }}
                      disabled={busyId === c.id}
                      onClick={() => removeCourse(c.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {c.description ? (
                  <p className="field-hint" style={{ marginTop: "0.35rem" }}>
                    {c.description.slice(0, 220)}
                    {c.description.length > 220 ? "…" : ""}
                  </p>
                ) : null}

                <div className="educator-enroll-block">
                  <p className="educator-enroll-count">
                    {n === 0
                      ? "No students enrolled yet."
                      : n === 1
                        ? "1 student enrolled."
                        : `${n} students enrolled.`}
                  </p>
                  <details className="educator-enroll-details">
                    <summary>
                      {n === 0 ? "Enrolment list" : `Who enrolled (${n})`}
                    </summary>
                    {n === 0 ? (
                      <p className="field-hint" style={{ margin: "0.35rem 0 0" }}>
                        When students add this course from Browse, they appear here with the name
                        and email on their account.
                      </p>
                    ) : (
                      <ul className="educator-enroll-list">
                        {students.map((s) => (
                          <li key={s.id}>
                            <div className="educator-enroll-row-head">
                              <strong>{s.fullName || "Student"}</strong>
                              {s.email ? (
                                <a href={`mailto:${s.email}`} className="educator-enroll-email">
                                  {s.email}
                                </a>
                              ) : null}
                            </div>
                            {(s.schoolName || s.studentForm || s.studentSubject) && (
                              <div className="educator-enroll-tags">
                                {[s.schoolName, s.studentForm, s.studentSubject]
                                  .filter(Boolean)
                                  .map((part) => (
                                    <span key={`${s.id}-${part}`} className="educator-enroll-tag">
                                      {part}
                                    </span>
                                  ))}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </div>

                {editId === c.id ? (
                  <div className="educator-edit-panel educator-edit-panel--wide profile-form">
                    <div className="field">
                      <label>Title</label>
                      <input value={eTitle} onChange={(e) => setETitle(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Subject</label>
                      <select value={eSubject} onChange={(e) => setESubject(e.target.value)}>
                        {SUBJECTS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>Price (RM)</label>
                        <input
                          value={ePrice}
                          onChange={(e) => setEPrice(e.target.value)}
                        />
                        <p className="field-hint">
                          Minimum paid price is RM2.00. Lower values are saved as free.
                        </p>
                      </div>
                      <div className="field">
                        <label>Lessons</label>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={eLessons}
                          onChange={(e) => setELessons(clampLessonCount(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label>Card style</label>
                      <select value={eThumb} onChange={(e) => setEThumb(e.target.value)}>
                        <option value="">Default</option>
                        {THUMBS.filter(Boolean).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Description</label>
                      <textarea
                        rows={4}
                        value={eDesc}
                        onChange={(e) => setEDesc(e.target.value)}
                      />
                    </div>
                    <p className="field-hint" style={{ marginBottom: "0.65rem" }}>
                      Lesson text is plain (line breaks kept). For video, paste a YouTube or Vimeo link in
                      the <strong>Or paste YouTube / Vimeo URL</strong> field below (not only in the
                      lesson text) and press <strong>Save changes</strong>. You can add{" "}
                      <strong>either</strong> one PDF, <strong>or</strong> one MP4/WebM upload,{" "}
                      <strong>or</strong> one embed link per lesson. Uploads save immediately; the link
                      saves with <strong>Save changes</strong>. Media is served only to signed-in students
                      or to you; that limits casual copying but cannot stop a determined screen recorder.
                    </p>
                    {Array.from({ length: clampLessonCount(eLessons) }, (_, i) => {
                      const p = {
                        ...newLessonPageSlot(`Lesson ${i + 1}`),
                        ...(eLessonPages[i] || {}),
                      };
                      const mediaKeyBusy = `${c.id}:${i}`;
                      const hasAnyMedia = p.hasPdf || p.hasVideo || p.hasExternalVideo;
                      const lessonLabel = (p.title || `Lesson ${i + 1}`).trim() || `Lesson ${i + 1}`;
                      return (
                        <details
                          key={i}
                          className="lesson-edit-fieldset"
                          open={openLessonIndex === i}
                          onToggle={(e) => {
                            if (e.currentTarget.open) setOpenLessonIndex(i);
                            else if (openLessonIndex === i) setOpenLessonIndex(-1);
                          }}
                        >
                          <summary className="lesson-edit-summary">
                            <span className="lesson-edit-summary-title">
                              Lesson {i + 1}: {lessonLabel}
                            </span>
                            <span className="lesson-edit-summary-meta">
                              {hasAnyMedia ? "Media attached" : "No media"}
                            </span>
                          </summary>
                          <div className="field lesson-edit-content">
                            <label htmlFor={`ec-lesson-title-${i}`}>Title</label>
                            <input
                              id={`ec-lesson-title-${i}`}
                              value={p.title}
                              onChange={(e) => {
                                const v = e.target.value;
                                setELessonPages((prev) => {
                                  const next = [...prev];
                                  while (next.length <= i) {
                                    next.push(newLessonPageSlot(`Lesson ${next.length + 1}`));
                                  }
                                  next[i] = { ...next[i], title: v };
                                  return next;
                                });
                              }}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`ec-lesson-body-${i}`}>Content</label>
                            <textarea
                              id={`ec-lesson-body-${i}`}
                              rows={6}
                              value={p.body}
                              onChange={(e) => {
                                const v = e.target.value;
                                setELessonPages((prev) => {
                                  const next = [...prev];
                                  while (next.length <= i) {
                                    next.push(newLessonPageSlot(`Lesson ${next.length + 1}`));
                                  }
                                  next[i] = { ...next[i], body: v };
                                  return next;
                                });
                              }}
                              placeholder="Notes, links, instructions…"
                            />
                          </div>
                          <div className="field">
                            <span className="lesson-attach-heading" id={`ec-lesson-media-h-${i}`}>
                              Lesson media (one option: PDF, uploaded video, or YouTube / Vimeo link)
                            </span>
                            <p className="field-hint" style={{ marginTop: "0.25rem" }}>
                              Max 15 MB PDF or 120 MB MP4/WebM. Uploads save immediately. YouTube and Vimeo
                              links are free (no API key); saving the course stores a validated embed. Only
                              verified educator accounts can attach files.
                            </p>
                            {p.hasPdf ? (
                              <>
                                <p style={{ margin: "0.35rem 0", fontSize: "0.92rem" }}>
                                  <strong>PDF:</strong> {p.pdfOriginalName || "handout.pdf"}
                                </p>
                                <button
                                  type="button"
                                  className="outline-btn"
                                  style={{ marginTop: "0.35rem", color: "#b91c1c", borderColor: "#fecaca" }}
                                  disabled={mediaBusy === mediaKeyBusy || busyId === c.id}
                                  onClick={() => removeLessonPdf(c.id, i)}
                                >
                                  Remove PDF
                                </button>
                              </>
                            ) : p.hasVideo ? (
                              <>
                                <p style={{ margin: "0.35rem 0", fontSize: "0.92rem" }}>
                                  <strong>Video:</strong> {p.videoOriginalName || "lesson.mp4"}
                                </p>
                                <button
                                  type="button"
                                  className="outline-btn"
                                  style={{ marginTop: "0.35rem", color: "#b91c1c", borderColor: "#fecaca" }}
                                  disabled={mediaBusy === mediaKeyBusy || busyId === c.id}
                                  onClick={() => removeLessonVideo(c.id, i)}
                                >
                                  Remove video
                                </button>
                              </>
                            ) : p.hasExternalVideo ? (
                              <>
                                <p style={{ margin: "0.35rem 0", fontSize: "0.92rem" }}>
                                  <strong>Embedded video:</strong> {p.externalVideoProvider || "link"}
                                  {p.embedUrl || p.externalVideoUrl
                                    ? ` — ${p.embedUrl || p.externalVideoUrl}`
                                    : ""}
                                </p>
                                <button
                                  type="button"
                                  className="outline-btn"
                                  style={{ marginTop: "0.35rem", color: "#b91c1c", borderColor: "#fecaca" }}
                                  disabled={mediaBusy === mediaKeyBusy || busyId === c.id}
                                  onClick={() => {
                                    setELessonPages((prev) => {
                                      const next = [...prev];
                                      while (next.length <= i) {
                                        next.push(newLessonPageSlot(`Lesson ${next.length + 1}`));
                                      }
                                      next[i] = {
                                        ...next[i],
                                        hasExternalVideo: false,
                                        externalVideoUrl: "",
                                        embedUrl: "",
                                      };
                                      return next;
                                    });
                                  }}
                                >
                                  Remove embed
                                </button>
                                <p className="field-hint" style={{ marginTop: "0.35rem" }}>
                                  Press <strong>Save changes</strong> below to clear the embed on the server.
                                </p>
                              </>
                            ) : (
                              <div
                                className="lesson-media-upload-row"
                                role="group"
                                aria-labelledby={`ec-lesson-media-h-${i}`}
                              >
                                <div className="lesson-media-upload-col">
                                  <label htmlFor={`ec-lesson-pdf-${i}`} className="lesson-media-sublabel">
                                    PDF handout
                                  </label>
                                  <input
                                    id={`ec-lesson-pdf-${i}`}
                                    type="file"
                                    accept="application/pdf,.pdf,application/octet-stream"
                                    disabled={mediaBusy === mediaKeyBusy || busyId === c.id}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      e.target.value = "";
                                      if (f) uploadLessonPdf(c.id, i, f);
                                    }}
                                  />
                                </div>
                                <div className="lesson-media-upload-col">
                                  <label htmlFor={`ec-lesson-video-${i}`} className="lesson-media-sublabel">
                                    Video (MP4 / WebM)
                                  </label>
                                  <input
                                    id={`ec-lesson-video-${i}`}
                                    type="file"
                                    accept="video/mp4,video/webm,.mp4,.webm,application/octet-stream"
                                    disabled={mediaBusy === mediaKeyBusy || busyId === c.id}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      e.target.value = "";
                                      if (f) uploadLessonVideo(c.id, i, f);
                                    }}
                                  />
                                </div>
                                <div className="lesson-media-upload-col lesson-media-upload-col--full">
                                  <label htmlFor={`ec-lesson-embed-${i}`} className="lesson-media-sublabel">
                                    Or paste YouTube / Vimeo URL
                                  </label>
                                  <input
                                    id={`ec-lesson-embed-${i}`}
                                    type="url"
                                    inputMode="url"
                                    placeholder="https://www.youtube.com/watch?v=… or https://vimeo.com/…"
                                    value={p.embedUrl ?? ""}
                                    autoComplete="off"
                                    disabled={mediaBusy === mediaKeyBusy || busyId === c.id}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setELessonPages((prev) => {
                                        const next = [...prev];
                                        while (next.length <= i) {
                                          next.push(newLessonPageSlot(`Lesson ${next.length + 1}`));
                                        }
                                        next[i] = { ...next[i], embedUrl: v };
                                        return next;
                                      });
                                    }}
                                  />
                                  <p className="field-hint" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
                                    Stored when you press <strong>Save changes</strong>. Replaces any file for
                                    this lesson.
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </details>
                      );
                    })}
                    <div className="educator-edit-actions">
                      <button
                        type="button"
                        className="solid-btn"
                        disabled={busyId === c.id}
                        onClick={saveEdit}
                      >
                        Save changes
                      </button>
                      <button type="button" className="outline-btn" onClick={closeEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </motion.li>
              );
            })}
          </ul>
        )}
      </section>
      <AppToast
        message={msg}
        variant="success"
        durationMs={7800}
        onDismiss={() => setMsg("")}
      />
    </div>
  );
}
