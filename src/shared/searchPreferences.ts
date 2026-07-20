const HISTORY_KEY = "workboms.searchHistory.v1";

export interface SearchHistoryEntry {
  query: string;
  searchedAt: number;
}

export function readSearchHistory(): SearchHistoryEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is SearchHistoryEntry =>
          !!entry &&
          typeof entry === "object" &&
          typeof (entry as SearchHistoryEntry).query === "string" &&
          typeof (entry as SearchHistoryEntry).searchedAt === "number",
      )
      .slice(0, 12);
  } catch {
    return [];
  }
}

export function rememberSearch(query: string): SearchHistoryEntry[] {
  const normalized = query.trim();
  if (!normalized) return readSearchHistory();
  const next = [
    { query: normalized, searchedAt: Date.now() },
    ...readSearchHistory().filter((entry) => entry.query !== normalized),
  ].slice(0, 12);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function clearSearchHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}
