import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { apiJson } from "../api.js";
import { youtubeEmbedSrc, vimeoEmbedSrc } from "../lib/lessonEmbed.js";
import { useAuth } from "../context/AuthContext.jsx";
import CourseProgressBar from "../components/CourseProgressBar.jsx";

export default function CoursePlayerPage() {
  const { user } = useAuth();
  const { courseId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [signedPdfUrl, setSignedPdfUrl] = useState("");

  const load = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson(`/api/course-access/${encodeURIComponent(courseId)}`);
      setPayload(data);
      setProgress(data.progress || null);
    } catch (e) {
      setPayload(null);
      setErr(e.message || "Could not load this course.");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = payload?.lessonPages || [];
  const activeIdx = useMemo(() => {
    if (!pages.length) return 0;
    let i = Number.parseInt(searchParams.get("lesson") || "0", 10);
    if (!Number.isFinite(i)) i = 0;
    return Math.min(Math.max(0, i), pages.length - 1);
  }, [pages.length, searchParams]);

  function selectLesson(i) {
    const next = new URLSearchParams(searchParams);
    next.set("lesson", String(i));
    setSearchParams(next, { replace: true });
  }

  const page = pages[activeIdx];
  const hasPage = Boolean(page);
  const hasPdf = Boolean(page?.hasPdf);
  const course = payload?.course;
  const hasLessonMedia = Boolean(page?.hasPdf || page?.hasVideo || page?.hasExternalVideo);
  const embedSrc = useMemo(() => {
    if (!page?.hasExternalVideo) return "";
    const prov = String(page.externalVideoProvider || "").trim().toLowerCase();
    const id = String(page.externalVideoId || "").trim();
    if (!id) return "";
    if (prov === "youtube") return youtubeEmbedSrc(id);
    if (prov === "vimeo") return vimeoEmbedSrc(id);
    return "";
  }, [page?.hasExternalVideo, page?.externalVideoProvider, page?.externalVideoId]);
  const pdfFallback =
    courseId && page?.hasPdf
      ? `/api/course-access/${encodeURIComponent(courseId)}/lessons/${activeIdx}/pdf`
      : "";
  const videoFallback =
    courseId && page?.hasVideo
      ? `/api/course-access/${encodeURIComponent(courseId)}/lessons/${activeIdx}/video`
      : "";
  const pdfSrc = signedPdfUrl || pdfFallback;
  /** Session cookie auth only — no `?st=` token. Video players issue many Range requests; long signed URLs through the Vite dev proxy often break playback. */
  const videoSrc = videoFallback;

  useEffect(() => {
    if (!courseId || !hasPage) {
      setSignedPdfUrl("");
      return;
    }
    let cancelled = false;
    (async () => {
      if (hasPdf) {
        try {
          const d = await apiJson(
            `/api/course-access/${encodeURIComponent(courseId)}/lesson-stream-url?lesson=${activeIdx}&kind=pdf`
          );
          if (!cancelled && d.url) setSignedPdfUrl(d.url);
        } catch {
          if (!cancelled) setSignedPdfUrl("");
        }
      } else if (!cancelled) {
        setSignedPdfUrl("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, activeIdx, hasPage, hasPdf]);

  useEffect(() => {
    if (!courseId || user?.role !== "student" || !pages.length) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson(
          `/api/course-access/${encodeURIComponent(courseId)}/progress`,
          { method: "POST", body: { lessonIndex: activeIdx } }
        );
        if (!cancelled && data.progress) setProgress(data.progress);
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, activeIdx, pages.length, user?.role]);

  const completedSet = useMemo(
    () => new Set(progress?.completedLessons || []),
    [progress?.completedLessons]
  );

  const watermarkText = useMemo(() => {
    const name = String(user?.fullName || "").trim();
    const email = String(user?.email || "").trim();
    const bit = name || email.split("@")[0] || email || "Learner";
    return `${bit} · EduSPM Hub`.slice(0, 72);
  }, [user?.fullName, user?.email]);

  return (
    <div>
      <div className="user-page-intro">
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
          <Link to="/my-courses">← My courses</Link>
        </p>
        <h1>{course?.title || "Course"}</h1>
        {course && (
          <p style={{ margin: 0, color: "#475569" }}>
            {course.educatorId ? (
              <Link to={`/tutor/${encodeURIComponent(course.educatorId)}`}>{course.educator}</Link>
            ) : (
              course.educator
            )}{" "}
            · {course.subject}             · {course.lessons} lesson
            {course.lessons === 1 ? "" : "s"}
          </p>
        )}
        {progress && progress.totalLessons > 0 ? (
          <div style={{ marginTop: "0.85rem", maxWidth: "28rem" }}>
            <CourseProgressBar
              percent={progress.percent}
              completedCount={progress.completedCount}
              totalLessons={progress.totalLessons}
            />
          </div>
        ) : null}
      </div>

      {loading && <p className="field-hint">Loading…</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      {!loading && !err && course && (
        <motion.div
          className="learn-layout"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <nav className="learn-side" aria-label="Lessons">
            <h2 className="learn-side-title">Lessons</h2>
            <ol className="learn-lesson-list">
              {pages.map((p, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={
                      i === activeIdx ? "learn-lesson-btn learn-lesson-btn--active" : "learn-lesson-btn"
                    }
                    onClick={() => selectLesson(i)}
                  >
                    <span
                      className={
                        completedSet.has(i) && i !== activeIdx
                          ? "learn-lesson-idx learn-lesson-idx--done"
                          : "learn-lesson-idx"
                      }
                    >
                      {completedSet.has(i) ? "✓" : i + 1}
                    </span>
                    <span className="learn-lesson-title">{p.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <article className="learn-main">
            {page ? (
              <>
                <h2 className="learn-main-title">{page.title}</h2>
                <div className="learn-body learn-body--pre">
                  {page.body.trim() ? (
                    page.body
                  ) : hasLessonMedia ? null : (
                    <span className="field-hint">
                      No lesson text has been added for this slot yet. If you are the tutor,
                      edit the course under My teaching and paste notes or instructions here.
                    </span>
                  )}
                </div>
                {page.hasPdf && pdfSrc ? (
                  <div className="learn-pdf-block">
                    <p className="learn-pdf-label">
                      {page.pdfOriginalName
                        ? `Handout: ${page.pdfOriginalName}`
                        : "Lesson handout (PDF)"}
                    </p>
                    <div className="learn-pdf-frame-wrap learn-pdf-frame-wrap--wm">
                      <iframe
                        title={`${page.title} — PDF`}
                        className="learn-pdf-frame"
                        src={pdfSrc}
                      />
                      {watermarkText ? (
                        <div className="learn-media-watermark" aria-hidden="true">
                          <span className="learn-media-watermark-line">{watermarkText}</span>
                        </div>
                      ) : null}
                    </div>
                    <p className="field-hint learn-pdf-fallback">
                      If the document does not appear, your browser may be blocking embedded PDFs.
                      You can still open this lesson while signed in; try another browser or PDF
                      viewer if needed.
                    </p>
                  </div>
                ) : page.hasVideo && videoSrc ? (
                  <div className="learn-video-block">
                    <p className="learn-video-label">
                      {page.videoOriginalName
                        ? `Video: ${page.videoOriginalName}`
                        : "Lesson video"}
                    </p>
                    <div className="learn-video-frame-wrap learn-video-frame-wrap--wm">
                      <video
                        key={activeIdx}
                        className="learn-video-el"
                        controls
                        controlsList="nodownload"
                        playsInline
                        preload="metadata"
                        src={videoSrc}
                        title={`${page.title} — video`}
                        onContextMenu={(e) => e.preventDefault()}
                      >
                        Your browser does not support embedded video.
                      </video>
                      {watermarkText ? (
                        <div className="learn-media-watermark" aria-hidden="true">
                          <span className="learn-media-watermark-line">{watermarkText}</span>
                        </div>
                      ) : null}
                    </div>
                    <p className="field-hint learn-video-note">
                      Stream links expire after a while and are tied to your login. This deters casual
                      link sharing; screen capture is still possible. Studio-grade DRM needs a
                      dedicated video host.
                    </p>
                  </div>
                ) : page.hasExternalVideo && embedSrc ? (
                  <div className="learn-embed-block">
                    <p className="learn-embed-label">
                      {String(page.externalVideoProvider || "").toLowerCase() === "youtube"
                        ? "Lesson video (YouTube)"
                        : String(page.externalVideoProvider || "").toLowerCase() === "vimeo"
                          ? "Lesson video (Vimeo)"
                          : "Lesson video"}
                    </p>
                    <div className="learn-embed-frame-wrap">
                      <iframe
                        key={`${activeIdx}-${embedSrc}`}
                        title={`${page.title} — embedded video`}
                        className="learn-embed-frame"
                        src={embedSrc}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        loading="eager"
                        referrerPolicy="no-referrer-when-downgrade"
                      />
                    </div>
                    <p className="field-hint learn-embed-note">
                      Playback uses the host's embedded player. The clip must allow embedding with the
                      link your tutor saved. Anyone can still screen-record; true DRM needs a paid video
                      platform.
                    </p>
                  </div>
                ) : page.hasExternalVideo && page.externalVideoUrl ? (
                  <div className="learn-embed-block">
                    <p className="learn-embed-label">Lesson video</p>
                    <p className="form-error" role="alert">
                      This lesson has a saved link, but the player could not be built (unsupported host
                      or missing video id).{" "}
                      <a href={page.externalVideoUrl} target="_blank" rel="noopener noreferrer">
                        Open the link in a new tab
                      </a>
                      .
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="field-hint">This course has no lesson slots.</p>
            )}
          </article>
        </motion.div>
      )}
    </div>
  );
}
