import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import en from "./en.js";
import ms from "./ms.js";

const STORAGE_KEY = "eduspmhub-locale";
const LOCALES = {
  en: { label: "English", dict: en },
  ms: { label: "Bahasa Melayu", dict: ms },
};

const I18nContext = createContext(null);

function getNested(obj, key) {
  return String(key || "")
    .split(".")
    .reduce((acc, part) => (acc && acc[part] != null ? acc[part] : undefined), obj);
}

function interpolate(template, vars) {
  if (!vars || typeof template !== "string") return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
    vars[name] != null ? String(vars[name]) : ""
  );
}

function readStoredLocale() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "ms" || v === "en") return v;
  } catch {
    /* ignore */
  }
  return "en";
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(readStoredLocale);

  const setLocale = useCallback((next) => {
    const code = next === "ms" ? "ms" : "en";
    setLocaleState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "ms" ? "ms" : "en";
  }, [locale]);

  const t = useCallback(
    (key, vars) => {
      const dict = LOCALES[locale]?.dict || en;
      const fallback = getNested(en, key);
      const value = getNested(dict, key) ?? fallback ?? key;
      return interpolate(value, vars);
    },
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      locales: [
        { code: "en", label: en.common.english },
        { code: "ms", label: ms.common.malay },
      ],
    }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
