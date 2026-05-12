import { Link, NavLink, Outlet } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext.jsx";
import { profilePhotoSrc } from "../lib/profilePhoto.js";

export default function UserAppShell() {
  const { user, logout } = useAuth();
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
                <Link to="/">Home</Link>
              </li>
              <li>
                <Link to="/platform">Learning hub</Link>
              </li>
            </ul>
          </nav>
          <div className="top-actions user-app-user">
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
                {user?.fullName || "User"}
                {isEducator ? (
                  <span className="role-pill role-pill--edu">Educator</span>
                ) : (
                  <span className="role-pill">Student</span>
                )}
              </span>
            </span>
            <button type="button" className="link-btn" onClick={() => logout()}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="container app-layout user-app-layout">
        <aside className={`sidebar${isEducator ? " sidebar--educator" : ""}`}>
          {isEducator && (
            <p className="sidebar-badge">
              {user?.verified ? "Verified" : "Pending review"}
            </p>
          )}
          <NavLink
            to="/browse"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            {isEducator ? "Browse catalogue" : "Browse"}
          </NavLink>
          <NavLink
            to="/my-courses"
            className={({ isActive }) =>
              isActive ? "side-item active" : "side-item"
            }
          >
            {isEducator ? "My teaching" : "My courses"}
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

        <section className="content user-app-content">
          <Outlet />
        </section>
      </main>
    </motion.div>
  );
}
