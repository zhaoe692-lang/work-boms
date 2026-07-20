/** WorkBOM plugin package interchange (plugin.json + files). */

export const PLUGIN_SCHEMA_VERSION = "1.0" as const;

export type PluginKind = "agent-skill";

export type PluginTarget = "cursor" | "codex" | "claude" | "workbuddy";

export type PluginSource = "bundled" | "imported" | "catalog";

export interface PluginEntry {
  skill: string;
  validateScript?: string;
  exportScript?: string;
}

/** On-disk plugin.json (camelCase). */
export interface PluginManifest {
  schemaVersion: typeof PLUGIN_SCHEMA_VERSION | string;
  id: string;
  name: string;
  displayName: string;
  /** Optional locale map, e.g. `{ "zh": "...", "en": "..." }`. Falls back to `displayName`. */
  displayNameI18n?: Record<string, string>;
  version: string;
  description: string;
  /** Optional locale map for description. Falls back to `description`. */
  descriptionI18n?: Record<string, string>;
  author: string;
  official?: boolean;
  kind: PluginKind | string;
  targets: PluginTarget[] | string[];
  homepage?: string;
  capabilities?: string[];
  entry: PluginEntry;
  minAppVersion?: string;
  license?: string;
}

/** Runtime view returned by the backend. */
export interface PluginInfo {
  id: string;
  name: string;
  displayName: string;
  displayNameI18n?: Record<string, string>;
  version: string;
  description: string;
  descriptionI18n?: Record<string, string>;
  author: string;
  official: boolean;
  kind: string;
  targets: string[];
  capabilities: string[];
  source: PluginSource;
  enabled: boolean;
  installed: boolean;
  installedAt?: string;
  installPath?: string;
  homepage?: string;
  minAppVersion?: string;
  license?: string;
  /** Validation issues found when reading the installed package. */
  issues: string[];
}

export interface PluginCatalogState {
  installed: PluginInfo[];
  available: PluginInfo[];
}
