import type { MessageKey } from "./i18n";

/** Stable backend error codes → catalog keys. */
const ERROR_CODE_KEYS: Record<string, MessageKey> = {
  "error.import.not_directory": "error.import.notDirectory",
  "error.import.missing_manifest": "error.import.missingManifest",
  "error.import.obsidian_vault": "error.import.obsidianVault",
  "error.import.obsidian_empty": "error.import.obsidianEmpty",
};

/** Legacy Chinese strings still returned by older backends / unmigrated paths. */
const LEGACY_ERROR_KEYS: Record<string, MessageKey> = {
  "请选择 .wbom 成果包目录": "error.import.notDirectory",
  "目录中缺少 manifest.json": "error.import.missingManifest",
  "灵感板已在其他窗口修改，请刷新后重试": "inspiration.conflictRetry",
};

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * Map Tauri/backend errors to localized UI copy.
 * Unknown messages pass through unchanged.
 */
export function formatInvokeError(
  reason: unknown,
  t: TFn,
): string {
  const raw = String(reason ?? "").trim();
  if (!raw) return t("error.unknown");

  // Tauri sometimes wraps: "…: error.import.missing_manifest"
  const codeMatch = raw.match(/\b(error\.[a-z0-9._-]+)\b/i);
  const code = codeMatch?.[1] ?? raw;
  const fromCode = ERROR_CODE_KEYS[code];
  if (fromCode) return t(fromCode);

  const fromLegacy = LEGACY_ERROR_KEYS[raw];
  if (fromLegacy) return t(fromLegacy);

  for (const [legacy, key] of Object.entries(LEGACY_ERROR_KEYS)) {
    if (raw.includes(legacy)) return t(key);
  }

  return raw;
}
