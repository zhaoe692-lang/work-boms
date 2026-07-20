/** Pure helpers for smart-search pagination and saved filters. */

export function pageSlice<T>(items: T[], visibleCount: number): T[] {
  const count = Math.max(0, visibleCount);
  return items.slice(0, count);
}

export function nextVisibleCount(
  current: number,
  pageSize: number,
  total: number,
): number {
  return Math.min(total, current + Math.max(1, pageSize));
}

export function filterSavedOnly<T extends { id: string }>(
  items: T[],
  savedOnly: boolean,
  isFavorite: (id: string) => boolean,
): T[] {
  if (!savedOnly) return items;
  return items.filter((item) => isFavorite(item.id));
}

export { searchModeLabel } from "./smartSearchI18n";
