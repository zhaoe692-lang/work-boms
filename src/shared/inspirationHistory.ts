/** Undo/redo stack helpers for inspiration board snapshots. */

export interface HistoryStack<T> {
  past: T[];
  future: T[];
}

export function emptyHistory<T>(): HistoryStack<T> {
  return { past: [], future: [] };
}

export function pushHistory<T>(
  stack: HistoryStack<T>,
  current: T,
  clone: (value: T) => T,
  limit = 40,
): HistoryStack<T> {
  const past = [...stack.past, clone(current)];
  if (past.length > limit) past.shift();
  return { past, future: [] };
}

export function undoHistory<T>(
  stack: HistoryStack<T>,
  current: T,
  clone: (value: T) => T,
): { stack: HistoryStack<T>; next: T } | null {
  if (!stack.past.length) return null;
  const past = [...stack.past];
  const previous = past.pop()!;
  return {
    next: previous,
    stack: {
      past,
      future: [...stack.future, clone(current)],
    },
  };
}

export function redoHistory<T>(
  stack: HistoryStack<T>,
  current: T,
  clone: (value: T) => T,
): { stack: HistoryStack<T>; next: T } | null {
  if (!stack.future.length) return null;
  const future = [...stack.future];
  const next = future.pop()!;
  return {
    next,
    stack: {
      past: [...stack.past, clone(current)],
      future,
    },
  };
}
