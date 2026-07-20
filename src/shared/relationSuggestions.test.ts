import { describe, expect, it } from "vitest";
import {
  filterDismissedSuggestions,
  isInferredSuggestion,
  suggestionKey,
} from "./relationSuggestions";

describe("relationSuggestions", () => {
  it("builds stable suggestion keys", () => {
    expect(suggestionKey("a", "b")).toBe("a->b");
  });

  it("detects inferred suggestions", () => {
    expect(isInferredSuggestion({ inferred: true })).toBe(true);
    expect(isInferredSuggestion({ inferred: false })).toBe(false);
    expect(isInferredSuggestion({})).toBe(false);
  });

  it("filters dismissed inferred edges but keeps explicit ones", () => {
    const relations = [
      { id: "1", from: "a", to: "b", inferred: true },
      { id: "2", from: "a", to: "c", inferred: true },
      { id: "3", from: "a", to: "d", inferred: false },
    ];
    const kept = filterDismissedSuggestions(relations, ["a->b"]);
    expect(kept.map((r) => r.id)).toEqual(["2", "3"]);
  });
});
