import { useI18n } from "../i18n/I18nContext.jsx";

export default function LanguageSwitcher({ className = "" }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      className={`lang-switcher${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={t("common.language")}
    >
      <button
        type="button"
        className={`lang-switcher-btn${locale === "en" ? " lang-switcher-btn--active" : ""}`}
        onClick={() => setLocale("en")}
        aria-pressed={locale === "en"}
      >
        EN
      </button>
      <button
        type="button"
        className={`lang-switcher-btn${locale === "ms" ? " lang-switcher-btn--active" : ""}`}
        onClick={() => setLocale("ms")}
        aria-pressed={locale === "ms"}
      >
        BM
      </button>
    </div>
  );
}
