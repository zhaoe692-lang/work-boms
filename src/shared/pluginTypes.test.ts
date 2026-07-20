import { describe, expect, it } from "vitest";
import { PLUGIN_SCHEMA_VERSION, type PluginManifest } from "./pluginTypes";

describe("pluginTypes", () => {
  it("defines schema 1.0 for official export plugin shape", () => {
    const manifest: PluginManifest = {
      schemaVersion: PLUGIN_SCHEMA_VERSION,
      id: "workbom.export-wbom",
      name: "export-wbom",
      displayName: "创建项目",
      version: "1.1.0",
      description: "test",
      author: "WorkBOM",
      official: true,
      kind: "agent-skill",
      targets: ["cursor", "codex", "claude", "workbuddy"],
      capabilities: ["export-session-wbom"],
      entry: {
        skill: "SKILL.md",
        validateScript: "scripts/validate_wbom.py",
        exportScript: "scripts/export-session-wbom.py",
      },
    };
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.targets).toContain("cursor");
    expect(manifest.entry.skill).toBe("SKILL.md");
  });

  it("allows optional displayNameI18n / descriptionI18n maps", () => {
    const manifest: PluginManifest = {
      schemaVersion: PLUGIN_SCHEMA_VERSION,
      id: "workbom.export-wbom",
      name: "export-wbom",
      displayName: "创建项目",
      displayNameI18n: {
        zh: "创建项目",
        en: "Create Project",
      },
      version: "1.1.4",
      description: "zh fallback",
      descriptionI18n: {
        zh: "中文说明",
        en: "English description",
      },
      author: "WorkBOM",
      kind: "agent-skill",
      targets: ["cursor"],
      entry: { skill: "SKILL.md" },
    };
    expect(manifest.displayNameI18n?.en).toBe("Create Project");
    expect(manifest.descriptionI18n?.en).toBe("English description");
  });
});
