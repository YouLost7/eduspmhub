import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { RESOURCES } from "../data/resources.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";
import LanguageSwitcher from "../components/LanguageSwitcher.jsx";

export default function PlatformPage() {
  const [filter, setFilter] = useState("all");
  const [waitMsg, setWaitMsg] = useState("");
  const { user, logout } = useAuth();
  const { t } = useI18n();

  const filtered = useMemo(() => {
    if (filter === "all") return RESOURCES;
    return RESOURCES.filter((r) => r.subject === filter);
  }, [filter]);

  const isEducator = user?.role === "educator";
  const canAddCourse = isEducator && user?.verified;

  const featureCards = useMemo(
    () => [
      { n: "01", title: t("platform.feature1Title"), desc: t("platform.feature1Desc") },
      { n: "02", title: t("platform.feature2Title"), desc: t("platform.feature2Desc") },
      { n: "03", title: t("platform.feature3Title"), desc: t("platform.feature3Desc") },
    ],
    [t]
  );

  let educatorStatusText = t("platform.educatorLockedDefault");
  let educatorLocked = true;
  if (isEducator && !user?.verified) {
    educatorStatusText = !user?.hasLicenseDocument
      ? t("platform.educatorUploadLicence")
      : t("platform.educatorLicencePending");
    educatorLocked = true;
  } else if (canAddCourse) {
    educatorStatusText = t("platform.educatorVerified");
    educatorLocked = false;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <header className="site-header">
        <div className="container">
          <nav className="nav">
            <h1 className="logo">EduSPM Hub</h1>
            <ul className="nav-links">
              <li>
                <a href="#features">{t("platform.features")}</a>
              </li>
              <li>
                <a href="#resources">{t("platform.resources")}</a>
              </li>
              <li>
                <a href="#cta">{t("platform.getStarted")}</a>
              </li>
              <li>
                <Link to="/browse">{t("common.myHub")}</Link>
              </li>
              {user ? (
                <>
                  <li>
                    <Link to="/profile">{t("common.profile")}</Link>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="nav-logout"
                      onClick={() => logout()}
                    >
                      {t("common.logOut")}
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <Link to="/login">{t("platform.login")}</Link>
                  </li>
                  <li>
                    <Link to="/register">{t("platform.register")}</Link>
                  </li>
                </>
              )}
              <li>
                <Link to="/">{t("platform.dashboard")}</Link>
              </li>
              <li>
                <LanguageSwitcher />
              </li>
            </ul>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container hero-grid">
            <motion.div
              className="hero-content"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45 }}
            >
              <p className="badge">{t("platform.badge")}</p>
              <h2>{t("platform.heroTitle")}</h2>
              <p className="hero-text">{t("platform.heroText")}</p>
              <div className="hero-actions">
                <a className="btn" href="#resources">
                  {t("platform.exploreContent")}
                </a>
                <a className="btn ghost" href="#features">
                  {t("platform.viewFeatures")}
                </a>
              </div>
              <div className="stats">
                <article className="stat">
                  <strong>{t("platform.statCatalogue")}</strong>
                  <span>{t("platform.statCatalogueDesc")}</span>
                </article>
                <article className="stat">
                  <strong>{t("platform.statResources")}</strong>
                  <span>{t("platform.statResourcesDesc")}</span>
                </article>
                <article className="stat">
                  <strong>{t("platform.statCommunity")}</strong>
                  <span>{t("platform.statCommunityDesc")}</span>
                </article>
              </div>
            </motion.div>
            <motion.div
              className="hero-card"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: 0.08 }}
            >
              <p className="card-label">{t("platform.cardLabel")}</p>
              <h3>{t("platform.cardTitle")}</h3>
              <ul>
                <li>{t("platform.cardItem1")}</li>
                <li>{t("platform.cardItem2")}</li>
                <li>{t("platform.cardItem3")}</li>
              </ul>
              <div className="hero-card-footer">{t("platform.cardFooter")}</div>
            </motion.div>
          </div>
        </section>

        <section id="features" className="section">
          <div className="container">
            <h2>{t("platform.featuresTitle")}</h2>
            <p className="section-subtext">{t("platform.featuresSubtext")}</p>
            <motion.div
              className="cards"
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-60px" }}
              variants={{
                hidden: {},
                show: {
                  transition: { staggerChildren: 0.1 },
                },
              }}
            >
              {featureCards.map((c) => (
                <motion.article
                  key={c.n}
                  className="card"
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
                  }}
                  whileHover={{ y: -4 }}
                >
                  <p className="card-icon">{c.n}</p>
                  <h3>{c.title}</h3>
                  <p>{c.desc}</p>
                </motion.article>
              ))}
            </motion.div>
          </div>
        </section>

        <section id="resources" className="section alt">
          <div className="container">
            <div className="resource-heading">
              <h2>{t("platform.resourcesTitle")}</h2>
              <label htmlFor="subjectFilter">{t("platform.filterBySubject")}</label>
              <select
                id="subjectFilter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">{t("platform.allSubjects")}</option>
                <option value="Bahasa Melayu">Bahasa Melayu</option>
                <option value="English">English</option>
                <option value="Mathematics">Mathematics</option>
                <option value="Science">Science</option>
              </select>
            </div>

            <motion.div layout className="resource-list">
              {filtered.length === 0 ? (
                <p className="field-hint" style={{ padding: "1rem 0" }}>
                  {t("platform.noResourcesPrefix")}{" "}
                  <Link to="/browse">{t("common.browse")}</Link>{" "}
                  {t("platform.noResourcesMiddle")}{" "}
                  <Link to="/my-courses">{t("nav.myTeaching")}</Link>.
                </p>
              ) : (
                <AnimatePresence mode="popLayout">
                  {filtered.map((item) => (
                    <motion.article
                      layout
                      key={item.title}
                      className="resource-item"
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.22 }}
                      whileHover={{ y: -2 }}
                    >
                      <h3>{item.title}</h3>
                      <p className="resource-meta">
                        {item.type} • {item.subject}
                      </p>
                      <p>{item.level}</p>
                    </motion.article>
                  ))}
                </AnimatePresence>
              )}
            </motion.div>
          </div>
        </section>

        <section id="cta" className="section">
          <div className="container cta">
            <h2>{t("platform.ctaTitle")}</h2>
            <p>{t("platform.ctaText")}</p>
            <motion.button
              type="button"
              className="btn secondary"
              onClick={() => setWaitMsg(t("platform.waitlistThanks"))}
              whileTap={{ scale: 0.98 }}
              whileHover={{ scale: 1.02 }}
            >
              {t("platform.joinWaitlist")}
            </motion.button>
            <p className="demo-message">{waitMsg}</p>
          </div>
        </section>

        {isEducator && (
          <section id="educatorTools" className="section alt">
            <div className="container educator-tools">
              <h2>{t("platform.educatorTools")}</h2>
              <p className="section-subtext">{t("platform.educatorToolsSubtext")}</p>
              <div className="tools-row">
                {educatorLocked ? (
                  <motion.button
                    type="button"
                    className="btn secondary"
                    disabled
                  >
                    {t("platform.addCourseLocked")}
                  </motion.button>
                ) : (
                  <Link to="/my-courses" className="btn secondary">
                    {t("platform.addCourse")}
                  </Link>
                )}
                <div
                  className={`educator-status${educatorLocked ? " locked" : ""}`}
                >
                  {educatorStatusText}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>&copy; 2026 EduSPM Hub. {t("platform.footer")}</p>
        </div>
      </footer>
    </motion.div>
  );
}
