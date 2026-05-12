import { useState } from "react";
import { Link, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const [status, setStatus] = useState({ text: "", color: "" });
  const [busy, setBusy] = useState(false);

  const qNext = searchParams.get("next");
  const enroll = searchParams.get("enroll");
  const fromState = location.state && location.state.from;
  const baseTarget = fromState || qNext || "/browse";

  async function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "").trim();

    if (!email || !password) {
      setStatus({ text: "Please fill in all login fields.", color: "#b91c1c" });
      return;
    }

    setBusy(true);
    setStatus({ text: "", color: "" });
    try {
      await login(email, password);
      setStatus({ text: "Signed in. Redirecting…", color: "#15803d" });
      let to = baseTarget;
      if (enroll) {
        const sep = to.includes("?") ? "&" : "?";
        to = `${to}${sep}enroll=${encodeURIComponent(enroll)}`;
      }
      navigate(to, { replace: true });
    } catch (err) {
      setStatus({ text: err.message || "Login failed", color: "#b91c1c" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <main className="auth-shell">
        <motion.section
          className="auth-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <Link className="brand" to="/">
            EduSPM Hub
          </Link>
          <h1>Welcome Back</h1>
          <p className="subtext">Sign in with the email and password you registered.</p>

          <form id="loginForm" onSubmit={onSubmit}>
            <div>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </div>

            <motion.button
              className="btn"
              type="submit"
              disabled={busy}
              whileHover={{ scale: busy ? 1 : 1.02 }}
              whileTap={{ scale: busy ? 1 : 0.98 }}
            >
              {busy ? "Signing in…" : "Login"}
            </motion.button>
            <p className="status" style={{ color: status.color || undefined }}>
              {status.text}
            </p>
          </form>

          <p className="helper">
            No account yet? <Link to="/register">Create one here</Link>
          </p>
        </motion.section>
      </main>
    </motion.div>
  );
}
