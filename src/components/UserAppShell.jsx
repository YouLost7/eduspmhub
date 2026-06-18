import { Link, NavLink, Outlet } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";
import { profilePhotoSrc } from "../lib/profilePhoto.js";
import LanguageSwitcher from "./LanguageSwitcher.jsx";

export default function UserAppShell() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const isEducator = user?.role === "educator";

  return (
    <motion.div
      className={`user-app-root${isEducator ? " user-app-root--educator" : ""}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <header className="topbar user-app-topbar">
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
                <Link to="/platform">{t("common.learningHub")}</Link>
              </li>
            </ul>
          </nav>
          <div className="top-actions user-app-user">
            <LanguageSwitcher />
            <span className="user-chip" title={user?.email}>
              {user?.hasProfilePhoto ? (
                <img
                  className="user-chip-photo"
                  src={profilePhotoSrc(user.id, user.avatarUploadedAt)}
                  alt=""
                  width={36}
                  height={36}
                />
              ) : null}
              <span className="user-chip-label">
                {user?.fullName || t("common.profile")}
                {isEducator ? (
                  <span className="role-pill role-pill--edu">{t("common.educator")}</span>
                ) : (
                  <span className="role-pill">{t("common.student")}</span>
                )}
              </span>
            </span>
            <button type="button" className="link-btn" onClick={() => logout()}>
              {t("common.logOut")}
            </button>
          </div>
        </div>
      </header>

      <main className="container app-layout user-app-layout">
        <aside className={`sidebar${isEducator ? " sidebar--educator" : ""}`}>
          {isEducator && (
            <p className="sidebar-badge">
              {user?.verified ? t("common.verified") : t("common.pendingReview")}
            </p>
          )}
          <NavLink
            to="/browse"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            {isEducator ? t("nav.browseCatalogue") : t("common.browse")}
          </NavLink>
          <NavLink
            to="/my-courses"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            {isEducator ? t("nav.myTeaching") : t("nav.myCourses")}
          </NavLink>
          <NavLink
            to="/marketplace"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            {t("nav.studyMarketplace")}
          </NavLink>
          <NavLink
            to="/tutoring"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            {isEducator ? t("nav.oneOnOneListing") : t("nav.hireTutor")}
          </NavLink>
          <NavLink
            to="/bookings"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            {isEducator ? t("nav.oneOnOneBookings") : t("nav.myBookings")}
          </NavLink>
          {!isEducator && (
            <NavLink
              to="/transactions"
              className={({ isActive }) =>
                isActive ? "side-item active" : "side-item"
              }
            >
              {t("nav.transactions")}
            </NavLink>
          )}
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            {t("common.profile")}
          </NavLink>
        </aside>

        <section className="content user-app-content">
          <Outlet />
        </section>
      </main>
    </motion.div>
  );
}
