import { describe, expect, it } from "vitest";
import { catalog, translate } from "./catalog";
import { detectSystemLocale, interpolate, resolveLocale } from "./types";

describe("i18n", () => {
  it("keeps zh and en key parity", () => {
    const zhKeys = Object.keys(catalog.zh).sort();
    const enKeys = Object.keys(catalog.en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("detects Chinese vs English system locales", () => {
    expect(detectSystemLocale("zh-CN")).toBe("zh");
    expect(detectSystemLocale("en-US")).toBe("en");
    expect(resolveLocale("system")).toMatch(/^(zh|en)$/);
  });

  it("interpolates variables", () => {
    expect(interpolate("Hello {name}", { name: "Ada" })).toBe("Hello Ada");
    expect(translate("en", "about.version", { version: "1.0" })).toBe(
      "Version 1.0",
    );
    expect(translate("zh", "nav.home")).toBe("驾驶舱");
    expect(translate("en", "nav.home")).toBe("Cockpit");
  });
});
