import { describe, expect, it } from "vitest";
import { confirmsEmptyTrash, confirmsPermanentDelete } from "./trashConfirm";

describe("trashConfirm", () => {
  it("requires exact DELETE token", () => {
    expect(confirmsPermanentDelete("DELETE")).toBe(true);
    expect(confirmsPermanentDelete(" delete ")).toBe(false);
    expect(confirmsPermanentDelete("delete")).toBe(false);
    expect(confirmsPermanentDelete(null)).toBe(false);
  });

  it("requires exact EMPTY token", () => {
    expect(confirmsEmptyTrash("EMPTY")).toBe(true);
    expect(confirmsEmptyTrash("empty")).toBe(false);
    expect(confirmsEmptyTrash("")).toBe(false);
  });
});
