import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { RESOURCES } from "../data/resources.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function PlatformPage() {
  const [filter, setFilter] = useState("all");
  const [waitMsg, setWaitMsg] = useState("");
  const { user, logout } = useAuth();

  const filtered = useMemo(() => {
    if (filter === "all") return RESOURCES;
    return RESOURCES.filter((r) => r.subject === filter);
  }, [filter]);

  const isEducator = user?.role === "educator";
  const canAddCourse = isEducator && user?.verified;

  let educatorStatusText =
    "Teaching tools are for verified educators only.";
  let educatorLocked = true;
  if (isEducator && !user?.verified) {
    educatorStatusText =
      !user?.hasLicenseDocument
        ? "Upload your certified educator licence on Profile — we unlock teaching tools only after staff verify that document."
        : "Your licence is on file and pending review. Teaching tools unlock after approval.";
    educatorLocked = true;
  } else if (canAddCourse) {
    educatorStatusText =
      "Welcome, verified educator. Add and publish courses from My teaching — they appear in Browse for students.";
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
                <a href="#features">Features</a>
              </li>
              <li>
                <a href="#resources">Resources</a>
              </li>
              <li>
                <a href="#cta">Get Started</a>
              </li>
              <li>
                <Link to="/browse">My hub</Link>
              </li>
              {user ? (
                <>
                  <li>
                    <Link to="/profile">Profile</Link>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="nav-logout"
                      onClick={() => logout()}
                    >
                      Log out
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <Link to="/login">Login</Link>
                  </li>
                  <li>
                    <Link to="/register">Register</Link>
                  </li>
                </>
              )}
              <li>
                <Link to="/">Dashboard</Link>
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
              <p className="badge">Objective 1 Focus</p>
              <h2>One integrated SPM learning platform for students</h2>
              <p className="hero-text">
                Access notes, learning videos, and tuition services in one place.
                The platform is structured, simple to use, and built for Sijil
                Pelajaran Malaysia (SPM) learners.
              </p>
              <div className="hero-actions">
                <a className="btn" href="#resources">
                  Explore Learning Content
                </a>
                <a className="btn ghost" href="#features">
                  View Platform Features
                </a>
              </div>
              <div className="stats">
                <article className="stat">
                  <strong>Catalogue</strong>
                  <span>Published by verified educators from My teaching</span>
                </article>
                <article className="stat">
                  <strong>Resources</strong>
                  <span>Optional learning tiles you can add to this hub later</span>
                </article>
                <article className="stat">
                  <strong>Community</strong>
                  <span>Grows as tutors list courses and students enrol</span>
                </article>
              </div>
            </motion.div>
            <motion.div
              className="hero-card"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: 0.08 }}
            >
              <p className="card-label">Inside One Ecosystem</p>
              <h3>Everything SPM students need in a single dashboard</h3>
              <ul>
                <li>Notes by subject, chapter, and exam priority</li>
                <li>Video lessons sorted by beginner to advanced levels</li>
                <li>Tuition booking with verified tutor profiles</li>
              </ul>
              <div className="hero-card-footer">
                Built to be simple, fast, and structured.
              </div>
            </motion.div>
          </div>
        </section>

        <section id="features" className="section">
          <div className="container">
            <h2>Core Features For Objective 1</h2>
            <p className="section-subtext">
              These are the first features needed to satisfy your first objective.
            </p>
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
              {[
                {
                  n: "01",
                  t: "SPM Notes Library",
                  d: "Organized notes for core subjects so students can revise faster.",
                },
                {
                  n: "02",
                  t: "Video Learning Center",
                  d: "Curated video lessons that help students understand difficult chapters visually.",
                },
                {
                  n: "03",
                  t: "Tuition Services",
                  d: "Match students with tutors for one-to-one or small group sessions.",
                },
              ].map((c) => (
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
                  <h3>{c.t}</h3>
                  <p>{c.d}</p>
                </motion.article>
              ))}
            </motion.div>
          </div>
        </section>

        <section id="resources" className="section alt">
          <div className="container">
            <div className="resource-heading">
              <h2>Learning hub resources</h2>
              <label htmlFor="subjectFilter">Filter by subject:</label>
              <select
                id="subjectFilter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All Subjects</option>
                <option value="Bahasa Melayu">Bahasa Melayu</option>
                <option value="English">English</option>
                <option value="Mathematics">Mathematics</option>
                <option value="Science">Science</option>
              </select>
            </div>

            <motion.div layout className="resource-list">
              {filtered.length === 0 ? (
                <p className="field-hint" style={{ padding: "1rem 0" }}>
                  No resource tiles are configured yet. Paid SPM modules live under{" "}
                  <Link to="/browse">Browse</Link> — verified educators add them from{" "}
                  <Link to="/my-courses">My teaching</Link>.
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
            <h2>Ready to build the full platform?</h2>
            <p>
              This version covers Objective 1. Next, we can add Objective 2 (DRM +
              paywall) and Objective 3 (educator marketplace) in phases.
            </p>
            <motion.button
              type="button"
              className="btn secondary"
              onClick={() =>
                setWaitMsg(
                  "Thanks! You are added to the Objective 1 early-access waitlist."
                )
              }
              whileTap={{ scale: 0.98 }}
              whileHover={{ scale: 1.02 }}
            >
              Join Early Waitlist
            </motion.button>
            <p className="demo-message">{waitMsg}</p>
          </div>
        </section>

        {isEducator && (
          <section id="educatorTools" className="section alt">
            <div className="container educator-tools">
              <h2>Educator tools</h2>
              <p className="section-subtext">
                Only <strong>verified</strong> educators can publish courses and use
                full teaching features. This mirrors the restrictions on My teaching.
              </p>
              <div className="tools-row">
                {educatorLocked ? (
                  <motion.button
                    type="button"
                    className="btn secondary"
                    disabled
                  >
                    Add Course (Locked)
                  </motion.button>
                ) : (
                  <Link to="/my-courses" className="btn secondary">
                    Add course
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
          <p>&copy; 2026 EduSPM Hub. Built for SPM learners in Malaysia.</p>
        </div>
      </footer>
    </motion.div>
  );
}
