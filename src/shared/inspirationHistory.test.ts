import { describe, expect, it } from "vitest";
import {
  emptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./inspirationHistory";

describe("inspirationHistory", () => {
  const clone = (value: { n: number }) => ({ ...value });

  it("supports undo and redo", () => {
    let stack = emptyHistory<{ n: number }>();
    let current = { n: 1 };
    stack = pushHistory(stack, current, clone);
    current = { n: 2 };
    stack = pushHistory(stack, current, clone);
    current = { n: 3 };

    const undone = undoHistory(stack, current, clone);
    expect(undone).not.toBeNull();
    expect(undone!.next).toEqual({ n: 2 });
    stack = undone!.stack;
    current = undone!.next;

    const redone = redoHistory(stack, current, clone);
    expect(redone).not.toBeNull();
    expect(redone!.next).toEqual({ n: 3 });
  });

  it("caps past length", () => {
    let stack = emptyHistory<{ n: number }>();
    for (let i = 0; i < 5; i += 1) {
      stack = pushHistory(stack, { n: i }, clone, 3);
    }
    expect(stack.past).toHaveLength(3);
    expect(stack.past[0]).toEqual({ n: 2 });
  });
});
