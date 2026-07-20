/** @deprecated Prefer `useI18n` / `translate` from `./i18n`. Kept for Smart Search compatibility. */
import { translate, type MessageKey } from "./i18n/catalog";
import { detectSystemLocale, type Locale } from "./i18n/types";

export type SmartSearchLocale = Locale;

const KEY_MAP = {
  productTitle: "search.productTitle",
  tagline: "search.tagline",
  history: "search.history",
  recentSearches: "search.recentSearches",
  clear: "search.clear",
  noHistory: "search.noHistory",
  inputAria: "search.inputAria",
  placeholder: "search.placeholder",
  sort: "search.sort",
  relevance: "search.relevance",
  updated: "search.updated",
  scope: "search.scope",
  allProjects: "search.allProjects",
  currentProject: "search.currentProject",
  tune: "search.tune",
  assetStatus: "search.assetStatus",
  allStatuses: "search.allStatuses",
  draft: "status.draft",
  candidate: "status.candidate",
  final: "status.final",
  reset: "search.reset",
  searchTitle: "search.searchTitle",
  resultsTitle: "search.resultsTitle",
  searchingTitle: "search.searchingTitle",
  noResultsTitle: "search.noResultsTitle",
  searching: "search.searching",
  found: "search.found",
  all: "search.all",
  visual: "search.visual",
  documents: "search.documents",
  audio: "search.audio",
  filter: "search.filter",
  visualAsset: "search.visualAsset",
  audioAsset: "search.audioAsset",
  documentAsset: "search.documentAsset",
  bestMatch: "search.bestMatch",
  matchEvidence: "search.matchEvidence",
  modeHybrid: "search.modeHybrid",
  modeFulltext: "search.modeFulltext",
  semanticFallback: "search.semanticFallback",
  noRelations: "search.noRelations",
  openForRelations: "search.openForRelations",
  relatedAssets: "search.relatedAssets",
  collapse: "search.collapse",
  expandRelations: "search.expandRelations",
  openDetails: "search.openDetails",
  noMatch: "search.noMatch",
  noMatchHint: "search.noMatchHint",
  emptyTitle: "search.emptyTitle",
  emptyHint: "search.emptyHint",
  moreResults: "search.moreResults",
  showing: "search.showing",
  loadMore: "search.loadMore",
  loadingMore: "search.loadingMore",
  remaining: "search.remaining",
  items: "search.items",
  summaryFallback: "search.summaryFallback",
  collected: "search.collected",
} as const satisfies Record<string, MessageKey>;

export type SmartSearchMessageKey = keyof typeof KEY_MAP;

export function detectSmartSearchLocale(language?: string): SmartSearchLocale {
  return detectSystemLocale(language);
}

export function smartSearchMessage(
  locale: SmartSearchLocale,
  key: SmartSearchMessageKey,
): string {
  return translate(locale, KEY_MAP[key]);
}

export function searchModeLabel(
  mode: string,
  locale: SmartSearchLocale = "zh",
): string {
  return mode === "hybrid"
    ? smartSearchMessage(locale, "modeHybrid")
    : smartSearchMessage(locale, "modeFulltext");
}
