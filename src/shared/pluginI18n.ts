import type { Locale } from "./i18n";

/** Built-in copy for official plugins when installed packages predate i18n fields. */
const OFFICIAL_PLUGIN_I18N: Record<
  string,
  {
    displayNameI18n: Record<string, string>;
    descriptionI18n: Record<string, string>;
  }
> = {
  "workbom.export-wbom": {
    displayNameI18n: {
      zh: "创建项目",
      en: "Create Project",
    },
    descriptionI18n: {
      zh: "在 Cursor / Codex / Claude / workBuddy 中创建可导入 WorkBOM 的项目包（.wbom）。仅收录本协作真实写入的文件，创建后强制校验。",
      en: "Create a WorkBOM project package (.wbom) in Cursor / Codex / Claude / workBuddy. Only files written in this collaboration are included, then validated.",
    },
  },
};

/**
 * Resolve a plugin string for the active UI locale.
 * Prefers `i18n[locale]`, then common aliases, then any non-empty map value, then fallback.
 */
export function localizedPluginText(
  locale: Locale,
  fallback: string,
  i18n?: Record<string, string> | null,
): string {
  if (!i18n) return fallback;
  const direct = pick(i18n, locale);
  if (direct) return direct;
  if (locale === "zh") {
    const zh = pick(i18n, "zh-CN") ?? pick(i18n, "zh_CN") ?? pick(i18n, "zh-Hans");
    if (zh) return zh;
  }
  if (locale === "en") {
    const en = pick(i18n, "en-US") ?? pick(i18n, "en_US") ?? pick(i18n, "en-GB");
    if (en) return en;
  }
  const zh = pick(i18n, "zh") ?? pick(i18n, "zh-CN");
  if (zh) return zh;
  const en = pick(i18n, "en") ?? pick(i18n, "en-US");
  if (en) return en;
  for (const value of Object.values(i18n)) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return fallback;
}

/** Localized display name for marketplace cards / notices. */
export function localizedPluginDisplayName(
  locale: Locale,
  plugin: {
    id: string;
    displayName: string;
    displayNameI18n?: Record<string, string> | null;
  },
): string {
  const fromPlugin = plugin.displayNameI18n;
  const fromOfficial = OFFICIAL_PLUGIN_I18N[plugin.id]?.displayNameI18n;
  return localizedPluginText(
    locale,
    plugin.displayName,
    mergeI18n(fromOfficial, fromPlugin),
  );
}

/** Localized description for marketplace cards. */
export function localizedPluginDescription(
  locale: Locale,
  plugin: {
    id: string;
    description: string;
    descriptionI18n?: Record<string, string> | null;
  },
): string {
  const fromPlugin = plugin.descriptionI18n;
  const fromOfficial = OFFICIAL_PLUGIN_I18N[plugin.id]?.descriptionI18n;
  return localizedPluginText(
    locale,
    plugin.description,
    mergeI18n(fromOfficial, fromPlugin),
  );
}

function mergeI18n(
  base?: Record<string, string> | null,
  override?: Record<string, string> | null,
): Record<string, string> | null {
  if (!base && !override) return null;
  return { ...(base ?? {}), ...(override ?? {}) };
}

function pick(map: Record<string, string>, key: string): string | null {
  const value = map[key]?.trim();
  return value ? value : null;
}
