import { tStatic, type Locale } from "./i18n";

export type EdgeKindKey =
  | "part_of"
  | "version"
  | "references"
  | "derived_from"
  | "uses"
  | "pairs_with"
  | "other";

export interface GraphAppearanceSettings {
  /** Global node size multiplier. Colors stay automatic (not user-editable). */
  nodeSizeScale: number;
  nodeLevels: Record<string, string>;
  /** Internal fallbacks for legacy graph renderers — not exposed in the UI. */
  nodeSpecial: {
    center: string;
    headVersion: string;
    historicalVersion: string;
    broken: string;
    loose: string;
  };
  edges: Record<EdgeKindKey, string>;
  globe: {
    wireframe: string;
    atmosphere: string;
    background: string;
  };
}

/**
 * Default palette — depth-cool nodes + relation-hue edges.
 * Works on dark (Gravity) and light (Local) canvases.
 * Node/edge colors are fixed; only nodeSizeScale is user-tunable.
 */
export const DEFAULT_GRAPH_APPEARANCE: GraphAppearanceSettings = {
  nodeSizeScale: 1,
  nodeLevels: {
    "0": "#FFD98A",
    "1": "#C6A6FF",
    "2": "#A981FF",
    "3": "#8A82F0",
    "4": "#5F6BD8",
  },
  nodeSpecial: {
    center: "#0F172A",
    headVersion: "#F0F4FF",
    historicalVersion: "#94A3B8",
    broken: "#F87171",
    loose: "#64748B",
  },
  edges: {
    part_of: "#FBBF24",
    version: "#A78BFA",
    references: "#CBD5E1",
    derived_from: "#F9A8D4",
    uses: "#6EE7B7",
    pairs_with: "#93C5FD",
    other: "#94A3B8",
  },
  globe: {
    wireframe: "#38BDF8",
    atmosphere: "#0E7490",
    background: "#020617",
  },
};

const STORAGE_KEY = "workboms-graph-appearance-v3";
const MIN_NODE_SIZE_SCALE = 0.6;
const MAX_NODE_SIZE_SCALE = 1.8;

export function clampNodeSizeScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_NODE_SIZE_SCALE, Math.min(MAX_NODE_SIZE_SCALE, value));
}

export function loadGraphAppearance(): GraphAppearanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GRAPH_APPEARANCE };
    const parsed = JSON.parse(raw) as Partial<GraphAppearanceSettings>;
    // Colors always come from defaults; only size scale is persisted.
    return {
      ...DEFAULT_GRAPH_APPEARANCE,
      nodeSizeScale: clampNodeSizeScale(parsed.nodeSizeScale ?? 1),
    };
  } catch {
    return { ...DEFAULT_GRAPH_APPEARANCE };
  }
}

export function saveGraphAppearance(settings: GraphAppearanceSettings): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ nodeSizeScale: clampNodeSizeScale(settings.nodeSizeScale) }),
  );
}

export function resetGraphAppearance(): GraphAppearanceSettings {
  localStorage.removeItem(STORAGE_KEY);
  return { ...DEFAULT_GRAPH_APPEARANCE };
}

export function edgeKindKey(kind: string): EdgeKindKey {
  if (kind in DEFAULT_GRAPH_APPEARANCE.edges) return kind as EdgeKindKey;
  return "other";
}

/** Labels for the toolbar legend (read-only). */
export function nodeLevelLabel(level: string, locale?: Locale): string {
  switch (level) {
    case "0":
      return tStatic("graph.level0", undefined, locale);
    case "1":
      return tStatic("graph.level1", undefined, locale);
    case "2":
      return tStatic("graph.level2", undefined, locale);
    case "3":
      return tStatic("graph.level3", undefined, locale);
    case "4":
      return tStatic("graph.level4", undefined, locale);
    default:
      return `L${level}`;
  }
}

export function edgeKindLabel(kind: string, locale?: Locale): string {
  switch (kind) {
    case "part_of":
      return `${tStatic("relation.part_of", undefined, locale)} part_of`;
    case "version":
      return `${tStatic("relation.version", undefined, locale)} version`;
    case "references":
      return `${tStatic("relation.references", undefined, locale)} references`;
    case "derived_from":
      return `${tStatic("relation.derivedShort", undefined, locale)} derived_from`;
    case "uses":
      return `${tStatic("relation.uses", undefined, locale)} uses`;
    case "pairs_with":
      return `${tStatic("relation.pairs_with", undefined, locale)} pairs_with`;
    default:
      return kind;
  }
}

/** @deprecated use nodeLevelLabel */
export const NODE_LEVEL_LABELS: Record<string, string> = {
  "0": "L0",
  "1": "L1",
  "2": "L2",
  "3": "L3",
  "4": "L4",
};

/** @deprecated use edgeKindLabel */
export const EDGE_KIND_LABELS: Record<string, string> = {
  part_of: "part_of",
  version: "version",
  references: "references",
  derived_from: "derived_from",
  uses: "uses",
  pairs_with: "pairs_with",
};

export { MIN_NODE_SIZE_SCALE, MAX_NODE_SIZE_SCALE };
