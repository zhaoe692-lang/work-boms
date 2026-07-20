export type { Locale, LocalePreference } from "./types";
export {
  detectSystemLocale,
  readLocalePreference,
  resolveLocale,
  writeLocalePreference,
  LOCALE_STORAGE_KEY,
} from "./types";
export { catalog, translate, type MessageKey } from "./catalog";
export { I18nProvider, useI18n, tStatic } from "./I18nProvider";
