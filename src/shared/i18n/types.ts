/** App-wide locale + i18n helpers. */

export type Locale = "zh" | "en";
export type LocalePreference = Locale | "system";

export const LOCALE_STORAGE_KEY = "workbom.locale";

export function detectSystemLocale(language?: string): Locale {
  const value =
    language ??
    (typeof navigator === "undefined" ? "zh" : navigator.language);
  return value.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function readLocalePreference(): LocalePreference {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === "zh" || raw === "en" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

export function writeLocalePreference(pref: LocalePreference) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
}

export function resolveLocale(pref: LocalePreference): Locale {
  return pref === "system" ? detectSystemLocale() : pref;
}

export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`,
  );
}
