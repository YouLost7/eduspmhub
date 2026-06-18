import { useState } from "react";
import { Link, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";
import LanguageSwitcher from "../components/LanguageSwitcher.jsx";

function safeAppPath(target) {
  const t = String(target || "").trim();
  if (!t.startsWith("/")) return "/browse";
  if (t.startsWith("//")) return "/browse";
  if (t.startsWith("/\\")) return "/browse";
  return t;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const { t } = useI18n();
  const [status, setStatus] = useState({ text: "", color: "" });
  const [busy, setBusy] = useState(false);

  const qNext = searchParams.get("next");
  const enroll = searchParams.get("enroll");
  const fromState = location.state && location.state.from;
  const baseTarget = safeAppPath(fromState || qNext || "/browse");

  async function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "").trim();

    if (!email || !password) {
      setStatus({ text: t("auth.fillLoginFields"), color: "#b91c1c" });
      return;
    }

    setBusy(true);
    setStatus({ text: "", color: "" });
    try {
      await login(email, password);
      setStatus({ text: t("auth.signedInRedirect"), color: "#15803d" });
      let to = baseTarget;
      if (enroll) {
        const sep = to.includes("?") ? "&" : "?";
        to = `${to}${sep}enroll=${encodeURIComponent(enroll)}`;
      }
      navigate(to, { replace: true });
    } catch (err) {
      setStatus({ text: err.message || t("auth.loginFailed"), color: "#b91c1c" });
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
          <div className="auth-card-top">
            <Link className="brand" to="/">
              EduSPM Hub
            </Link>
            <LanguageSwitcher />
          </div>
          <h1>{t("auth.welcomeBack")}</h1>
          <p className="subtext">{t("auth.signInHint")}</p>

          <form id="loginForm" onSubmit={onSubmit}>
            <div>
              <label htmlFor="email">{t("auth.email")}</label>
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
              <label htmlFor="password">{t("auth.password")}</label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder={t("auth.passwordPlaceholder")}
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
              {busy ? t("auth.signingIn") : t("auth.login")}
            </motion.button>
            <p className="status" style={{ color: status.color || undefined }}>
              {status.text}
            </p>
          </form>

          <p className="helper">
            {t("auth.noAccount")}{" "}
            <Link to="/register">{t("auth.createAccount")}</Link>
          </p>
        </motion.section>
      </main>
    </motion.div>
  );
}
