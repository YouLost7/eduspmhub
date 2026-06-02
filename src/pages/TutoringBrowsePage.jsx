import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { apiJson } from "../api.js";
import { profilePhotoSrc } from "../lib/profilePhoto.js";

export default function TutoringBrowsePage() {
  const [tutors, setTutors] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson("/api/tutoring/tutors");
      setTutors(Array.isArray(data.tutors) ? data.tutors : []);
    } catch (e) {
      setTutors([]);
      setErr(e.message || "Could not load tutors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="user-page-intro">
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
          <Link to="/browse">← Browse</Link>
        </p>
        <h1>Hire a tutor (1-on-1)</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          Verified educators offering live homeschool-style sessions. Pay by the hour with Stripe.
        </p>
      </div>

      {loading && <p className="field-hint">Loading…</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      {!loading && tutors.length === 0 && (
        <p className="field-hint">No tutors are offering 1-on-1 sessions yet.</p>
      )}

      <div className="tutoring-grid">
        {tutors.map((t) => (
          <motion.article
            key={t.id}
            className="tutoring-card section-block"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Link to={`/tutor/${encodeURIComponent(t.id)}`} className="tutoring-card-link">
              {t.hasProfilePhoto ? (
                <img
                  className="tutoring-card-photo"
                  src={profilePhotoSrc(t.id, t.avatarUploadedAt)}
                  alt=""
                  width={48}
                  height={48}
                />
              ) : (
                <div className="tutoring-card-avatar" aria-hidden="true">
                  {String(t.fullName || "?").charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h2 className="tutoring-card-name">{t.fullName}</h2>
                <p className="field-hint" style={{ margin: 0 }}>
                  {t.educatorSubject || "SPM"}
                  {t.educatorInstitution ? ` · ${t.educatorInstitution}` : ""}
                </p>
                <p className="tutoring-card-rate">{t.hourlyRateLabel || "Rate on profile"}</p>
                {t.reviewCount > 0 ? (
                  <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                    ★ {t.averageRating} ({t.reviewCount} review{t.reviewCount === 1 ? "" : "s"})
                  </p>
                ) : (
                  <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                    No reviews yet
                  </p>
                )}
              </div>
            </Link>
          </motion.article>
        ))}
      </div>
    </div>
  );
}
