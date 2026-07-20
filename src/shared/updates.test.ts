import { describe, expect, it } from "vitest";
import { compareVersions, normalizeVersion } from "./updates";

describe("updates", () => {
  it("normalizes version tags", () => {
    expect(normalizeVersion("v0.1.83")).toBe("0.1.83");
    expect(normalizeVersion("WorkBOM_0.1.83_aarch64")).toBe("0.1.83");
    expect(normalizeVersion("0.1.83")).toBe("0.1.83");
  });

  it("compares versions", () => {
    expect(compareVersions("0.1.84", "0.1.83")).toBeGreaterThan(0);
    expect(compareVersions("0.1.83", "0.1.83")).toBe(0);
    expect(compareVersions("0.1.82", "0.1.83")).toBeLessThan(0);
    expect(compareVersions("v0.2.0", "0.1.99")).toBeGreaterThan(0);
  });
});
