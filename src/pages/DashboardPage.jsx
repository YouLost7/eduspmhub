import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { StudyTipBanner } from "../components/StudyTipBanner.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { apiJson } from "../api.js";
import { profilePhotoSrc } from "../lib/profilePhoto.js";

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

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [featured, setFeatured] = useState({
    recommended: [],
    popular: [],
    topEducators: [],
  });
  const [loadErr, setLoadErr] = useState("");
  const [toast, setToast] = useState("");

  const loadFeatured = useCallback(async () => {
    try {
      const data = await apiJson("/api/dashboard/featured");
      setFeatured({
        recommended: data.recommended || [],
        popular: data.popular || [],
        topEducators: data.topEducators || [],
      });
      setLoadErr("");
    } catch (e) {
      setLoadErr(e.message || "Could not load recommendations.");
    }
  }, []);

  useEffect(() => {
    loadFeatured();
  }, [loadFeatured, user?.id, user?.studentSubject]);

  async function enrolFromDashboard(courseId) {
    setToast("");
    try {
      await apiJson("/api/my-courses/enroll", {
        method: "POST",
        body: { courseId },
      });
      setToast("Added to My courses.");
      loadFeatured();
    } catch (e) {
      if (e.status === 401) {
        navigate(`/login?next=${encodeURIComponent("/browse")}&enroll=${encodeURIComponent(courseId)}`);
      } else {
        setToast(e.message || "Could not enrol.");
      }
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
                <Link to="/">Home</Link>
              </li>
              <li>
                <Link to="/browse">Browse</Link>
              </li>
              <li>
                <a href="#about">About</a>
              </li>
              <li>
                <a href="#contact">Contact</a>
              </li>
            </ul>
          </nav>
          <div className="top-actions">
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
                    <span className="role-pill role-pill--edu">Educator</span>
                  ) : (
                    <span className="role-pill">Student</span>
                  )}
                </span>
                <Link className="link-btn" to="/browse">
                  My hub
                </Link>
                <Link className="link-btn" to="/profile">
                  Profile
                </Link>
                <button type="button" className="link-btn" onClick={() => logout()}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link className="link-btn" to="/login">
                  Log In
                </Link>
                <Link className="solid-btn" to="/register">
                  Sign Up
                </Link>
              </>
            )}
            <Link className="solid-btn" to="/platform">
              Learning hub
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
              {loadErr} Start the API with <code>npm run dev:all</code>.
            </p>
          )}
          {toast && (
            <p className="form-success" style={{ margin: "0 0 0.5rem" }}>
              {toast}
            </p>
          )}

          <div className="main-grid">
            <div className="left-content">
              <section className="section-block">
                <div className="section-head">
                  <h2>Recommended for You</h2>
                  <Link to="/browse" style={{ fontSize: "0.86rem", fontWeight: 600 }}>
                    View catalogue
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
                      No courses to recommend yet. When tutors publish modules, they will
                      appear here.
                      {user?.role === "educator" ? (
                        <>
                          {" "}
                          Add yours from <Link to="/my-courses">My teaching</Link>.
                        </>
                      ) : (
                        <>
                          {" "}
                          <Link to="/browse">Browse</Link> when new listings go live.
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
                        <span>{c.price}</span>
                      </Link>
                      <div className="course-card-actions">
                        <Link
                          className="outline-btn"
                          to={`/browse?course=${encodeURIComponent(c.id)}`}
                        >
                          View course
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
                            className="solid-btn"
                            onClick={() => enrolFromDashboard(c.id)}
                          >
                            Enrol
                          </button>
                        )}
                        {user?.role === "educator" && (
                          <Link className="outline-btn" to="/browse">
                            Catalogue
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
                  <h2>Tutors on the hub</h2>
                  <Link to="/browse" style={{ fontSize: "0.86rem", fontWeight: 600 }}>
                    Find by subject
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
                      No educators to highlight yet. When tutors register and verify, they
                      appear here — publish courses from <Link to="/my-courses">My teaching</Link>.
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
                            ? "No published courses yet"
                            : `${e.publishedCourses} published course${
                                e.publishedCourses === 1 ? "" : "s"
                              } on the hub`}
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
                <h2>Popular Courses</h2>
                <Link to="/browse">View All</Link>
              </div>
              <motion.ul
                className="popular-list"
                variants={listVariants}
                initial="hidden"
                animate="show"
              >
                {featured.popular.length === 0 ? (
                  <li className="field-hint" style={{ listStyle: "none", padding: "0.5rem 0" }}>
                    No enrolment data yet — popular picks appear as learners join courses.
                  </li>
                ) : (
                  featured.popular.map((c) => (
                  <motion.li key={c.id} variants={cardVariants}>
                    <Link to={`/browse?course=${encodeURIComponent(c.id)}`}>
                      <span>
                        <strong>{c.title}</strong>
                        <span className="pop-pop-meta">
                          {c.enrollments} learner{c.enrollments === 1 ? "" : "s"} ·{" "}
                          {c.subject}
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
