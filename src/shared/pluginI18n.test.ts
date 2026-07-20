import { describe, expect, it } from "vitest";
import {
  localizedPluginDescription,
  localizedPluginDisplayName,
  localizedPluginText,
} from "./pluginI18n";

describe("localizedPluginText", () => {
  const i18n = {
    zh: "中文描述",
    en: "English description",
  };

  it("picks the active locale", () => {
    expect(localizedPluginText("zh", "fallback", i18n)).toBe("中文描述");
    expect(localizedPluginText("en", "fallback", i18n)).toBe("English description");
  });

  it("falls back to the plain string when i18n is missing", () => {
    expect(localizedPluginText("en", "plain only", null)).toBe("plain only");
    expect(localizedPluginText("zh", "plain only", undefined)).toBe("plain only");
  });

  it("falls back across locales when one side is missing", () => {
    expect(localizedPluginText("en", "fallback", { zh: "仅中文" })).toBe("仅中文");
    expect(localizedPluginText("zh", "fallback", { en: "EN only" })).toBe("EN only");
  });

  it("uses official built-in i18n when plugin maps are absent", () => {
    expect(
      localizedPluginDisplayName("en", {
        id: "workbom.export-wbom",
        displayName: "创建项目",
      }),
    ).toBe("Create Project");
    expect(
      localizedPluginDescription("en", {
        id: "workbom.export-wbom",
        description: "中文旧描述",
      }),
    ).toMatch(/Create a WorkBOM project package/);
  });
});
