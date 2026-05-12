import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function TutorProfilePage() {
  const { tutorId } = useParams();
  const { user } = useAuth();
  const [tutor, setTutor] = useState(null);
  const [courses, setCourses] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tutorId) return;
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson(`/api/tutors/${encodeURIComponent(tutorId)}`);
      setTutor(data.tutor || null);
      setCourses(Array.isArray(data.courses) ? data.courses : []);
    } catch (e) {
      setTutor(null);
      setCourses([]);
      setErr(e.message || "Could not load this tutor.");
    } finally {
      setLoading(false);
    }
  }, [tutorId]);

  useEffect(() => {
    load();
  }, [load]);

  const isSelf = user?.id && tutor?.id && user.id === tutor.id;

  return (
    <div>
      <div className="user-page-intro">
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
          <Link to="/browse">← Browse</Link>
        </p>
        <h1>Tutor profile</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          How this tutor appears to students on EduSPM Hub. Contact details stay private.
        </p>
      </div>

      {loading && <p className="field-hint">Loading…</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      {!loading && !err && tutor && (
        <motion.article
          className="tutor-profile-card section-block"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="tutor-profile-head">
            <div className="tutor-profile-avatar" aria-hidden="true">
              {String(tutor.fullName || "?")
                .trim()
                .charAt(0)
                .toUpperCase()}
            </div>
            <div className="tutor-profile-head-text">
              <h2 className="tutor-profile-name">{tutor.fullName}</h2>
              <p className="tutor-profile-line">
                {(tutor.educatorSubject || "SPM").trim()}
                {tutor.educatorInstitution ? ` · ${tutor.educatorInstitution}` : ""}
              </p>
              <p className="tutor-profile-badges">
                {tutor.verified ? (
                  <span className="role-pill role-pill--edu">Verified on EduSPM Hub</span>
                ) : (
                  <span className="role-pill">Verification pending</span>
                )}
                {isSelf ? (
                  <span className="role-pill" style={{ marginLeft: "0.35rem" }}>
                    This is you
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          {tutor.educatorBio?.trim() ? (
            <div className="tutor-profile-bio">
              <h3>About</h3>
              <div className="learn-body learn-body--pre">{tutor.educatorBio.trim()}</div>
            </div>
          ) : (
            <p className="field-hint">This tutor has not added a public bio yet.</p>
          )}

          <section className="tutor-profile-courses">
            <h3>Published courses ({courses.length})</h3>
            {courses.length === 0 ? (
              <p className="field-hint">No published listings yet.</p>
            ) : (
              <ul className="tutor-profile-course-list">
                {courses.map((c) => (
                  <li key={c.id}>
                    <Link to={`/browse?course=${encodeURIComponent(c.id)}`}>
                      <strong>{c.title}</strong>
                      <span className="field-hint" style={{ display: "block", marginTop: "0.15rem" }}>
                        {c.subject} · {c.lessons} lesson{c.lessons === 1 ? "" : "s"} · {c.price}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isSelf ? (
            <p className="field-hint" style={{ marginTop: "1rem" }}>
              To change what appears here, edit your{" "}
              <Link to="/profile">Profile</Link> and your courses under{" "}
              <Link to="/my-courses">My teaching</Link>.
            </p>
          ) : null}
        </motion.article>
      )}
    </div>
  );
}
