import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { apiJson } from "../api.js";
import { profilePhotoSrc } from "../lib/profilePhoto.js";
import { useI18n } from "../i18n/I18nContext.jsx";

export default function TutoringBrowsePage() {
  const { t } = useI18n();
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
      setErr(e.message || t("tutoring.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="user-page-intro">
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
          <Link to="/browse">{t("tutoring.backToBrowse")}</Link>
        </p>
        <h1>{t("tutoring.title")}</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          {t("tutoring.intro")}
        </p>
      </div>

      {loading && <p className="field-hint">{t("common.loading")}</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      {!loading && tutors.length === 0 && (
        <p className="field-hint">{t("tutoring.empty")}</p>
      )}

      <div className="tutoring-grid">
        {tutors.map((tutor) => (
          <motion.article
            key={tutor.id}
            className="tutoring-card section-block"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Link to={`/tutor/${encodeURIComponent(tutor.id)}`} className="tutoring-card-link">
              {tutor.hasProfilePhoto ? (
                <img
                  className="tutoring-card-photo"
                  src={profilePhotoSrc(tutor.id, tutor.avatarUploadedAt)}
                  alt=""
                  width={48}
                  height={48}
                />
              ) : (
                <div className="tutoring-card-avatar" aria-hidden="true">
                  {String(tutor.fullName || "?").charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h2 className="tutoring-card-name">{tutor.fullName}</h2>
                <p className="field-hint" style={{ margin: 0 }}>
                  {tutor.educatorSubject || "SPM"}
                  {tutor.educatorInstitution ? ` · ${tutor.educatorInstitution}` : ""}
                </p>
                <p className="tutoring-card-rate">
                  {tutor.hourlyRateLabel || t("tutoring.rateOnProfile")}
                </p>
                {tutor.reviewCount > 0 ? (
                  <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                    ★ {tutor.averageRating}{" "}
                    {tutor.reviewCount === 1
                      ? t("tutoring.reviewCount", { count: tutor.reviewCount })
                      : t("tutoring.reviewsCount", { count: tutor.reviewCount })}
                  </p>
                ) : (
                  <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                    {t("tutoring.noReviewsYet")}
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
