import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";
import EducatorMyTeaching from "../components/EducatorMyTeaching.jsx";
import CourseProgressBar from "../components/CourseProgressBar.jsx";

function priceToCents(priceLike) {
  const raw = String(priceLike ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/^RM\s*/i, "").replace(/,/g, "");
  const num = Number.parseFloat(cleaned.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return 0;
  const cents = Math.round(num * 100);
  return cents < 200 ? 0 : cents;
}

export default function MyCoursesPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [courses, setCourses] = useState([]);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);
  const isEducator = user?.role === "educator";

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson("/api/my-courses");
      if (requestIdRef.current !== requestId) return;
      setCourses(data.courses || []);
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setErr(e.message);
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isEducator) load();
  }, [isEducator, load]);

  useEffect(() => {
    const paymentStatus = searchParams.get("payment");
    const sessionId = searchParams.get("session_id");
    if (isEducator || !user || user.role !== "student") return;
    if (paymentStatus !== "success" || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        await apiJson("/api/payments/confirm-session", {
          method: "POST",
          body: { sessionId },
        });
        if (!cancelled) {
          await load();
          setOkMsg("Payment confirmed and course added to My courses.");
          const next = new URLSearchParams(searchParams);
          next.delete("payment");
          next.delete("session_id");
          setSearchParams(next, { replace: true });
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e.message || "Could not confirm your payment yet.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEducator, load, searchParams, setSearchParams, user]);

  if (isEducator) {
    return (
      <div>
        {!user?.verified ? (
          <div className="user-page-intro user-page-intro--educator">
            <h1>My teaching</h1>
            <p>
              Manage courses you publish to SPM students. This view is tailored for
              educators — different from the student &quot;My courses&quot; list.
            </p>
            <div className="locked-panel">
              <p>
                <strong>Locked:</strong>{" "}
                {!user?.hasLicenseDocument
                  ? "Upload your certified educator licence on Profile first. We verify tutors only after reviewing that document."
                  : "Your licence is under review. Teaching tools unlock after our team approves your document."}
              </p>
              <Link to="/profile">Profile — licence upload</Link>
            </div>
          </div>
        ) : (
          <EducatorMyTeaching />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="user-page-intro">
        <h1>{t("myCourses.title")}</h1>
        <p>{t("myCourses.intro")}</p>
        <Link className="solid-btn" to="/browse">
          {t("myCourses.browseCourses")}
        </Link>
      </div>

      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}
      {okMsg && (
        <p className="verify-banner" role="status">
          {okMsg}
        </p>
      )}

      <section className="section-block my-list">
        <h2>{t("myCourses.yourEnrolments")}</h2>
        {loading ? (
          <p className="field-hint">{t("common.loading")}</p>
        ) : courses.length === 0 ? (
          <p className="empty-list">{t("myCourses.empty")}</p>
        ) : (
          <ul className="enrol-list">
            {courses.map((c) => {
              const progress = c.progress || {};
              const resumeLesson = Number(progress.lastLessonIndex) || 0;
              const learnHref =
                progress.percent > 0 && progress.percent < 100
                  ? `/learn/${encodeURIComponent(c.id)}?lesson=${resumeLesson}`
                  : `/learn/${encodeURIComponent(c.id)}`;
              return (
                <motion.li
                  key={c.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <span className="enrol-course-block">
                    <strong>{c.title}</strong>
                    <span className="field-hint" style={{ display: "block", marginTop: "0.2rem" }}>
                      {c.source === "educator" && c.educatorId ? (
                        <>
                          {t("myCourses.tutor")}:{" "}
                          <Link to={`/tutor/${encodeURIComponent(c.educatorId)}`}>{c.educator}</Link>
                        </>
                      ) : (
                        <>{t("myCourses.tutor")}: {c.educator}</>
                      )}{" "}
                      · {c.price}
                      {" · "}
                      <strong>{priceToCents(c.price) > 0 ? t("myCourses.paid") : t("myCourses.free")}</strong>
                    </span>
                    <CourseProgressBar
                      compact
                      percent={progress.percent}
                      completedCount={progress.completedCount}
                      totalLessons={progress.totalLessons ?? c.lessons}
                    />
                  </span>
                  <Link className="solid-btn" style={{ fontSize: "0.86rem" }} to={learnHref}>
                    {progress.percent >= 100
                      ? t("myCourses.review")
                      : progress.percent > 0
                        ? t("myCourses.continue")
                        : t("myCourses.openLessons")}
                  </Link>
                </motion.li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
