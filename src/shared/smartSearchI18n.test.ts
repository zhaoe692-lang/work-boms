import { describe, expect, it } from "vitest";
import {
  detectSmartSearchLocale,
  searchModeLabel,
  smartSearchMessage,
} from "./smartSearchI18n";

describe("smart search internationalization", () => {
  it("uses Chinese for Chinese locales and English elsewhere", () => {
    expect(detectSmartSearchLocale("zh-CN")).toBe("zh");
    expect(detectSmartSearchLocale("zh-Hant")).toBe("zh");
    expect(detectSmartSearchLocale("en-US")).toBe("en");
    expect(detectSmartSearchLocale("fr-FR")).toBe("en");
  });

  it("provides locale-specific product language", () => {
    expect(smartSearchMessage("zh", "resultsTitle")).toBe("最佳匹配");
    expect(smartSearchMessage("en", "resultsTitle")).toBe("Best match");
    expect(smartSearchMessage("en", "semanticFallback")).toContain("full-text");
    expect(searchModeLabel("hybrid", "zh")).toBe("语义与全文");
    expect(searchModeLabel("fulltext", "en")).toBe("Full text");
  });
});
