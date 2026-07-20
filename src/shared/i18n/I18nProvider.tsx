import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translate, type MessageKey } from "./catalog";
import {
  readLocalePreference,
  resolveLocale,
  writeLocalePreference,
  type Locale,
  type LocalePreference,
} from "./types";

type TFunction = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

interface I18nContextValue {
  locale: Locale;
  preference: LocalePreference;
  setPreference: (pref: LocalePreference) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>(() =>
    readLocalePreference(),
  );
  const locale = useMemo(() => resolveLocale(preference), [preference]);

  const setPreference = useCallback((pref: LocalePreference) => {
    writeLocalePreference(pref);
    setPreferenceState(pref);
  }, []);

  useEffect(() => {
    if (preference !== "system") return;
    const onLang = () => setPreferenceState(readLocalePreference());
    window.addEventListener("languagechange", onLang);
    return () => window.removeEventListener("languagechange", onLang);
  }, [preference]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const t = useCallback<TFunction>(
    (key, vars) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, preference, setPreference, t }),
    [locale, preference, setPreference, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

/** Safe outside React (defaults to system locale). */
export function tStatic(
  key: MessageKey,
  vars?: Record<string, string | number>,
  locale?: Locale,
): string {
  const loc = locale ?? resolveLocale(readLocalePreference());
  return translate(loc, key, vars);
}
