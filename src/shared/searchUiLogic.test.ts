import { describe, expect, it } from "vitest";
import {
  filterSavedOnly,
  nextVisibleCount,
  pageSlice,
  searchModeLabel,
} from "./searchUiLogic";

describe("searchUiLogic", () => {
  it("pages results for load-more", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(pageSlice(items, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(nextVisibleCount(8, 8, 9)).toBe(9);
    expect(nextVisibleCount(8, 8, 8)).toBe(8);
  });

  it("filters favorites when savedOnly", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(filterSavedOnly(items, false, () => false)).toHaveLength(3);
    expect(
      filterSavedOnly(items, true, (id) => id === "b").map((i) => i.id),
    ).toEqual(["b"]);
  });

  it("labels hybrid vs fulltext modes", () => {
    expect(searchModeLabel("hybrid")).toBe("语义与全文");
    expect(searchModeLabel("fulltext")).toBe("全文匹配");
    expect(searchModeLabel("hybrid", "en")).toBe("Semantic + full text");
    expect(searchModeLabel("fulltext", "en")).toBe("Full text");
  });
});
