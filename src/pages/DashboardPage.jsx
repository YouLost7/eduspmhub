import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { StudyTipBanner } from "../components/StudyTipBanner.jsx";
import { AppToast } from "../components/AppToast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { apiJson } from "../api.js";
import { profilePhotoSrc } from "../lib/profilePhoto.js";
import { useI18n } from "../i18n/I18nContext.jsx";
import LanguageSwitcher from "../components/LanguageSwitcher.jsx";

const listVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
  },
};

const REASON_ICONS = {
  peer_school: "👥",
  subject_strong: "🎯",
  subject_related: "📚",
  educator_affinity: "👩‍🏫",
  trending: "🔥",
  explore: "🧭",
  activity: "✨",
};

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [featured, setFeatured] = useState({
    recommended: [],
    popular: [],
    topEducators: [],
  });
  const [loadErr, setLoadErr] = useState("");
  const [toast, setToast] = useState(null);
  const [enrolBusyId, setEnrolBusyId] = useState("");
  const requestIdRef = useRef(0);

  const loadFeatured = useCallback(async () => {
    // Guards against a slow response overwriting results from a newer
    // request (e.g. triggered again right after enrolling).
    const requestId = ++requestIdRef.current;
    try {
      const data = await apiJson("/api/dashboard/featured");
      if (requestIdRef.current !== requestId) return;
      setFeatured({
        recommended: data.recommended || [],
        popular: data.popular || [],
        topEducators: data.topEducators || [],
      });
      setLoadErr("");
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setLoadErr(e.message || t("dashboard.loadError"));
    }
  }, [t]);

  useEffect(() => {
    loadFeatured();
  }, [loadFeatured, user?.id, user?.studentSubject]);

  async function enrolFromDashboard(courseId) {
    if (enrolBusyId) return;
    setEnrolBusyId(courseId);
    setToast(null);
    try {
      await apiJson("/api/my-courses/enroll", {
        method: "POST",
        body: { courseId },
      });
      setToast({ text: t("dashboard.addedToCourses"), kind: "success" });
      loadFeatured();
    } catch (e) {
      if (e.status === 401) {
        navigate(`/login?next=${encodeURIComponent("/browse")}&enroll=${encodeURIComponent(courseId)}`);
      } else {
        setToast({ text: e.message || t("dashboard.enrolFailed"), kind: "error" });
      }
    } finally {
      setEnrolBusyId("");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <div className="malaysia-strip" aria-hidden="true" />
      <motion.header
        className="topbar"
        initial={{ y: -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="container nav">
          <div className="brand-wrap">
            <span className="brand-icon">▶</span>
            <Link to="/" className="brand-name">
              EduSPM<span>Hub</span>
            </Link>
          </div>
          <nav>
            <ul className="menu">
              <li>
                <Link to="/">{t("common.home")}</Link>
              </li>
              <li>
                <Link to="/browse">{t("common.browse")}</Link>
              </li>
              <li>
                <a href="#about">{t("common.about")}</a>
              </li>
              <li>
                <a href="#contact">{t("common.contact")}</a>
              </li>
            </ul>
          </nav>
          <div className="top-actions">
            <LanguageSwitcher />
            <span className="search" aria-hidden="true">
              ⌕
            </span>
            {loading ? (
              <span className="link-btn">…</span>
            ) : user ? (
              <>
                <span className="user-chip" title={user.email}>
                  {user.fullName}
                  {user.role === "educator" ? (
                    <span className="role-pill role-pill--edu">{t("common.educator")}</span>
                  ) : (
                    <span className="role-pill">{t("common.student")}</span>
                  )}
                </span>
                <Link className="link-btn" to="/browse">
                  {t("common.myHub")}
                </Link>
                <Link className="link-btn" to="/profile">
                  {t("common.profile")}
                </Link>
                <button type="button" className="link-btn" onClick={() => logout()}>
                  {t("common.logOut")}
                </button>
              </>
            ) : (
              <>
                <Link className="link-btn" to="/login">
                  {t("common.logIn")}
                </Link>
                <Link className="solid-btn" to="/register">
                  {t("common.signUp")}
                </Link>
              </>
            )}
            <Link className="solid-btn" to="/platform">
              {t("common.learningHub")}
            </Link>
          </div>
        </div>
      </motion.header>

      <div style={{ padding: "0.65rem 0 0" }}>
        <StudyTipBanner />
      </div>

      <main className="container app-layout" id="about">
        <aside className="sidebar">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            Home
          </NavLink>
          <NavLink
            to="/browse"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            Browse
          </NavLink>
          <NavLink
            to="/my-courses"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            My courses
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            Profile
          </NavLink>
        </aside>

        <section className="content">
          <div className="hero-panel">
            <div className="hero-copy">
              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.45 }}
              >
                Welcome to <span>EduSPM Hub!</span>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18, duration: 0.45 }}
              >
                Explore verified educational videos and resources to ace your SPM
                exams — built for Malaysian students, with educators you can trust.
              </motion.p>
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.26, duration: 0.4 }}
              >
                <Link className="solid-btn large" to="/browse">
                  Browse courses
                </Link>
              </motion.div>
            </div>
            <div className="hero-illustration" aria-hidden="true">
              <motion.div
                className="screen hero-float"
                animate={{
                  boxShadow: [
                    "0 12px 28px rgba(46, 118, 207, 0.18)",
                    "0 16px 36px rgba(46, 118, 207, 0.26)",
                    "0 12px 28px rgba(46, 118, 207, 0.18)",
                  ],
                }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
                <div className="screen-top" />
                <div className="video" />
                <div className="bar" />
              </motion.div>
            </div>
          </div>

          {loadErr && (
            <p className="form-error" style={{ margin: "0 0 0.5rem" }}>
              {loadErr} {t("dashboard.apiStartHint")} <code>npm run dev:all</code>.
            </p>
          )}
          <AppToast
            message={toast?.text || ""}
            variant={toast?.kind === "error" ? "error" : "success"}
            onDismiss={() => setToast(null)}
          />

          <div className="main-grid">
            <div className="left-content">
              <section className="section-block">
                <div className="section-head">
                  <h2>{t("dashboard.recommended")}</h2>
                  <Link to="/browse" style={{ fontSize: "0.86rem", fontWeight: 600 }}>
                    {t("dashboard.viewCatalogue")}
                  </Link>
                </div>
                <motion.div
                  className="cards-grid"
                  variants={listVariants}
                  initial="hidden"
                  animate="show"
                >
                  {featured.recommended.length === 0 ? (
                    <p className="field-hint" style={{ gridColumn: "1 / -1" }}>
                      {t("dashboard.noRecommendations")}
                      {user?.role === "educator" ? (
                        <>
                          {" "}
                          {t("dashboard.addFromTeaching")}{" "}
                          <Link to="/my-courses">{t("nav.myTeaching")}</Link>.
                        </>
                      ) : (
                        <>
                          {" "}
                          <Link to="/browse">{t("common.browse")}</Link>{" "}
                          {t("dashboard.browseWhenLive")}
                        </>
                      )}
                    </p>
                  ) : (
                    featured.recommended.map((c) => (
                    <motion.article
                      key={c.id}
                      className="course-card"
                      variants={cardVariants}
                      whileHover={{ y: -4, transition: { duration: 0.2 } }}
                    >
                      <Link
                        to={`/browse?course=${encodeURIComponent(c.id)}`}
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <div className={`thumb ${c.thumb || ""}`.trim()} />
                        <h3>{c.title}</h3>
                        <p>{c.meta}</p>
                        {c.recommendationReason ? (
                          <p className="field-hint" style={{ marginTop: "0.2rem", marginBottom: "0.35rem" }}>
                            {t("dashboard.whyThisPick")} {REASON_ICONS[c.recommendationReasonKey] || "✨"}{" "}
                            {c.recommendationReason}
                          </p>
                        ) : null}
                        <span>{c.price}</span>
                      </Link>
                      <div className="course-card-actions">
                        <Link
                          className="outline-btn"
                          to={`/browse?course=${encodeURIComponent(c.id)}`}
                        >
                          {t("dashboard.viewCourse")}
                        </Link>
                        {!user && (
                          <Link
                            className="solid-btn"
                            to={`/login?next=${encodeURIComponent("/browse")}&enroll=${encodeURIComponent(c.id)}`}
                          >
                            {t("dashboard.signInToEnrol")}
                          </Link>
                        )}
                        {user?.role === "student" && (
                          <button
                            type="button"
                            className="solid-btn"
                            disabled={Boolean(enrolBusyId)}
                            onClick={() => enrolFromDashboard(c.id)}
                          >
                            {enrolBusyId === c.id ? t("common.saving") : t("dashboard.enrol")}
                          </button>
                        )}
                        {user?.role === "educator" && (
                          <Link className="outline-btn" to="/browse">
                            {t("dashboard.catalogue")}
                          </Link>
                        )}
                      </div>
                    </motion.article>
                  ))
                  )}
                </motion.div>
              </section>

              <section className="section-block">
                <div className="section-head">
                  <h2>{t("dashboard.tutorsOnHub")}</h2>
                  <Link to="/browse" style={{ fontSize: "0.86rem", fontWeight: 600 }}>
                    {t("dashboard.findBySubject")}
                  </Link>
                </div>
                <motion.div
                  className="educators"
                  variants={listVariants}
                  initial="hidden"
                  animate="show"
                >
                  {featured.topEducators.length === 0 ? (
                    <p className="field-hint" style={{ gridColumn: "1 / -1" }}>
                      {t("dashboard.noEducatorsYet")}{" "}
                      <Link to="/my-courses">{t("nav.myTeaching")}</Link>.
                    </p>
                  ) : (
                    featured.topEducators.map((e) => (
                    <motion.article
                      key={e.id}
                      className="educator"
                      variants={cardVariants}
                      whileHover={{ scale: 1.03 }}
                    >
                      <Link
                        to={`/tutor/${encodeURIComponent(e.id)}`}
                        className="educator-link"
                      >
                        {e.hasProfilePhoto ? (
                          <img
                            className="educator-photo-thumb"
                            src={profilePhotoSrc(e.id, e.avatarUploadedAt)}
                            alt=""
                            loading="lazy"
                            width={66}
                            height={66}
                          />
                        ) : (
                          <div className={`avatar ${e.avatarClass || ""}`.trim()} />
                        )}
                        <h4>{e.name}</h4>
                        <p className="educator-sub">
                          {e.subject}
                          {e.institution ? ` · ${e.institution}` : ""}
                        </p>
                        <p className="dashboard-educator-meta">
                          {e.publishedCourses === 0
                            ? t("dashboard.noPublishedYet")
                            : e.publishedCourses === 1
                              ? t("dashboard.publishedCourses", { count: e.publishedCourses })
                              : t("dashboard.publishedCoursesPlural", { count: e.publishedCourses })}
                        </p>
                        <p
                          className={
                            e.source === "platform_pending"
                              ? "educator-badge educator-badge--pending"
                              : "educator-badge"
                          }
                        >
                          {e.badge}
                        </p>
                      </Link>
                    </motion.article>
                  ))
                  )}
                </motion.div>
              </section>
            </div>

            <aside className="popular">
              <div className="section-head">
                <h2>{t("dashboard.popular")}</h2>
                <Link to="/browse">{t("dashboard.viewAll")}</Link>
              </div>
              <motion.ul
                className="popular-list"
                variants={listVariants}
                initial="hidden"
                animate="show"
              >
                {featured.popular.length === 0 ? (
                  <li className="field-hint" style={{ listStyle: "none", padding: "0.5rem 0" }}>
                    {t("dashboard.noPopularYet")}
                  </li>
                ) : (
                  featured.popular.map((c) => (
                  <motion.li key={c.id} variants={cardVariants}>
                    <Link to={`/browse?course=${encodeURIComponent(c.id)}`}>
                      <span>
                        <strong>{c.title}</strong>
                        <span className="pop-pop-meta">
                          {c.enrollments === 1
                            ? t("dashboard.learnerCount", { count: c.enrollments })
                            : t("dashboard.learnersCount", { count: c.enrollments })}{" "}
                          · {c.subject}
                        </span>
                      </span>
                      <span className="popular-price">{c.price}</span>
                    </Link>
                  </motion.li>
                  ))
                )}
              </motion.ul>
            </aside>
          </div>
        </section>
      </main>

      <footer className="footer" id="contact">
        <p>&copy; 2026 EduSPM Hub. Contact: support@eduspmhub.my</p>
      </footer>
    </motion.div>
  );
}
