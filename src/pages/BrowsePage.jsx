import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function BrowsePage() {
  const { user } = useAuth();
  const [courses, setCourses] = useState([]);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const processedAutoEnroll = useRef(new Set());

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [staleApiHint, setStaleApiHint] = useState("");

  const subjectParam = searchParams.get("subject");
  const courseFocus = searchParams.get("course");

  const closeDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("course");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const subjectDecoded = useMemo(() => {
    if (!subjectParam) return "";
    try {
      return decodeURIComponent(subjectParam);
    } catch {
      return subjectParam;
    }
  }, [subjectParam]);

  const load = useCallback(async () => {
    try {
      const data = await apiJson("/api/courses");
      setCourses(data.courses || []);
      setErr("");
      if (import.meta.env.DEV && data.stats?.fromBuiltInCatalog > 0) {
        setStaleApiHint(
          "This response still includes built-in catalogue rows — the browser is probably talking to an old API (often still on port 3001). Stop other dev servers using that port and open the Vite URL printed in the terminal where you started npm run dev:all, then hard-refresh."
        );
      } else {
        setStaleApiHint("");
      }
    } catch (e) {
      setErr(e.message);
      setStaleApiHint("");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!courseFocus) {
      setDetail(null);
      setDetailErr("");
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailErr("");
    (async () => {
      try {
        const data = await apiJson(
          `/api/courses/${encodeURIComponent(courseFocus)}`
        );
        if (!cancelled) {
          setDetail(data.course);
          setDetailErr("");
        }
      } catch (e) {
        if (!cancelled) {
          setDetail(null);
          setDetailErr(e.message || "Could not load this course.");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseFocus]);

  useEffect(() => {
    if (!courseFocus) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [courseFocus, closeDetail]);

  const visibleCourses = useMemo(() => {
    if (!subjectDecoded) return courses;
    return courses.filter((c) => c.subject === subjectDecoded);
  }, [courses, subjectDecoded]);

  async function enroll(courseId) {
    try {
      await apiJson("/api/my-courses/enroll", {
        method: "POST",
        body: { courseId },
      });
      setErr("");
      setOkMsg("Added to My courses.");
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    }
  }

  useEffect(() => {
    const en = searchParams.get("enroll");
    if (!en) return;
    if (!user || user.role !== "student") return;
    if (processedAutoEnroll.current.has(en)) return;
    processedAutoEnroll.current.add(en);
    (async () => {
      try {
        await apiJson("/api/my-courses/enroll", {
          method: "POST",
          body: { courseId: en },
        });
        setOkMsg("Added to My courses.");
        const next = new URLSearchParams(searchParams);
        next.delete("enroll");
        setSearchParams(next, { replace: true });
      } catch {
        processedAutoEnroll.current.delete(en);
      }
    })();
  }, [user, searchParams, setSearchParams]);

  const isEducator = user?.role === "educator";

  return (
    <div>
      {isEducator ? (
        <div className="user-page-intro user-page-intro--educator">
          <h1>Educator catalogue</h1>
          <p>
            SPM courses listed here are published by verified educators (no built-in demo catalogue).
            {user?.verified
              ? " Your account is verified — use My teaching to create and manage listings."
              : " Teaching tools (publish, pricing, analytics) unlock after we verify your certified licence on file."}
          </p>
          {!user?.verified && (
            <p className="verify-banner">
              {!user?.hasLicenseDocument ? (
                <>
                  Status: <strong>Action needed</strong> — upload your certified
                  educator licence on Profile (PDF or image). Students only see you as
                  verified after staff approve that document.
                </>
              ) : (
                <>
                  Status: <strong>Licence submitted</strong> — you can browse and
                  update your profile while we review your document. Publishing stays
                  disabled until approval.
                </>
              )}
            </p>
          )}
        </div>
      ) : (
        <div className="user-page-intro">
          <h1>Browse for SPM</h1>
          <p>
            Discover courses aligned with your subjects. Enrol with one tap — your
            enrolments are saved to <strong>My courses</strong>.
          </p>
        </div>
      )}

      {subjectDecoded && (
        <p className="field-hint" style={{ marginBottom: "0.75rem" }}>
          Filtered by subject: <strong>{subjectDecoded}</strong>{" "}
          <Link to="/browse" style={{ marginLeft: "0.5rem", fontWeight: 600 }}>
            Clear filter
          </Link>
        </p>
      )}

      {courseFocus && (
        <p className="field-hint" style={{ marginBottom: "0.75rem" }}>
          Course details are open in the panel below.{" "}
          <button type="button" className="outline-btn" onClick={closeDetail}>
            Close details
          </button>
        </p>
      )}

      {okMsg && (
        <p className="form-success" role="status">
          {okMsg}
        </p>
      )}
      {staleApiHint && (
        <p className="verify-banner" role="status">
          {staleApiHint}
        </p>
      )}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      <div className="cards-grid browse-grid">
        {visibleCourses.length === 0 ? (
          <p className="field-hint" style={{ gridColumn: "1 / -1" }}>
            {subjectDecoded
              ? "No courses match this subject filter."
              : "The catalogue is empty for now."}{" "}
            {user?.role === "educator" ? (
              <>
                Publish modules from <Link to="/my-courses">My teaching</Link> once your
                account is verified.
              </>
            ) : (
              <>Check back soon — tutors are adding real SPM listings.</>
            )}
            {subjectDecoded && (
              <>
                {" "}
                <Link to="/browse">Show all courses</Link>
              </>
            )}
          </p>
        ) : (
          visibleCourses.map((c, i) => (
          <motion.article
            key={c.id}
            className={`course-card${courseFocus === c.id ? " course-card--focus" : ""}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.3 }}
            whileHover={{ y: -3 }}
          >
            <Link
              to={`/browse?course=${encodeURIComponent(c.id)}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className={`thumb ${c.thumb || ""}`.trim()} />
              <h3>{c.title}</h3>
              <p>
                {c.source === "educator" && c.educatorId ? (
                  <Link to={`/tutor/${encodeURIComponent(c.educatorId)}`}>{c.educator}</Link>
                ) : (
                  c.educator
                )}{" "}
                • {c.lessons} lessons • {c.subject}
              </p>
              <span>{c.price}</span>
            </Link>
            <div className="course-card-actions">
              <Link
                className="outline-btn"
                to={`/browse?course=${encodeURIComponent(c.id)}`}
              >
                Details
              </Link>
              {!user && (
                <Link
                  className="solid-btn"
                  to={`/login?next=${encodeURIComponent("/browse")}&enroll=${encodeURIComponent(c.id)}`}
                >
                  Sign in to enrol
                </Link>
              )}
              {user?.role === "student" && (
                <button
                  type="button"
                  className="solid-btn browse-enrol"
                  onClick={() => enroll(c.id)}
                >
                  Enrol
                </button>
              )}
            </div>
            {isEducator && (
              <p className="educator-browse-note">
                {!user?.verified
                  ? "Publishing and paid listings stay disabled until your educator account is verified."
                  : c.source === "educator" && c.educatorId === user?.id
                    ? "Your listing — edit or publish from My teaching."
                    : "You are verified — add your own courses from My teaching."}
              </p>
            )}
          </motion.article>
          ))
        )}
      </div>

      <p className="browse-footer-link">
        <Link to="/platform">Open full learning hub (notes &amp; videos)</Link>
      </p>

      {courseFocus && (detailLoading || detail || detailErr) ? (
        <div
          className="course-detail-backdrop"
          role="presentation"
          onClick={closeDetail}
        >
          <div
            className="course-detail-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="course-detail-close"
              aria-label="Close"
              onClick={closeDetail}
            >
              ×
            </button>
            {detailLoading ? (
              <p className="field-hint">Loading course…</p>
            ) : detailErr ? (
              <p className="form-error" role="alert">
                {detailErr}
              </p>
            ) : detail ? (
              <>
                <p className="course-detail-source">
                  {detail.source === "educator" ? "Tutor listing" : "Curated catalogue"}
                </p>
                <h2 id="course-detail-title">{detail.title}</h2>
                <p className="course-detail-meta">
                  {detail.source === "educator" && detail.educatorId ? (
                    <>
                      <Link to={`/tutor/${encodeURIComponent(detail.educatorId)}`}>
                        {detail.educator}
                      </Link>
                      {" · "}
                      {detail.lessons} lessons · {detail.subject}
                    </>
                  ) : (
                    <>
                      {detail.educator} · {detail.lessons} lessons · {detail.subject}
                    </>
                  )}
                </p>
                <p className="course-detail-price">{detail.price}</p>
                <div className="course-detail-body">
                  {String(detail.description || "")
                    .split("\n")
                    .map((para, i) =>
                      para.trim() ? (
                        <p key={i}>{para.trim()}</p>
                      ) : null
                    )}
                </div>
                <div className="course-detail-actions">
                  {detail.source === "educator" && detail.educatorId ? (
                    <Link
                      className="outline-btn"
                      to={`/tutor/${encodeURIComponent(detail.educatorId)}`}
                    >
                      Tutor profile
                    </Link>
                  ) : null}
                  {!user && (
                    <Link
                      className="solid-btn"
                      to={`/login?next=${encodeURIComponent("/browse")}&enroll=${encodeURIComponent(detail.id)}`}
                    >
                      Sign in to enrol
                    </Link>
                  )}
                  {user?.role === "student" && (
                    <button
                      type="button"
                      className="solid-btn"
                      onClick={async () => {
                        if (await enroll(detail.id)) closeDetail();
                      }}
                    >
                      Enrol in this course
                    </button>
                  )}
                  <button type="button" className="outline-btn" onClick={closeDetail}>
                    Close
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
