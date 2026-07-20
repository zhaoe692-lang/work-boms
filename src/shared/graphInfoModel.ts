/**
 * Graph-info model for the knowledge-graph side panel.
 * Structural only: degree health + file/media kind distribution.
 * No Work / 分组 / component clustering.
 */
import type { DisplayEdge } from "./graph";
import { tStatic, type Locale } from "./i18n";
import type { ArtifactStatus, ArtifactView } from "./types";
import { kindLabel, statusLabel } from "./utils";

export interface GraphInfoBucket {
  id: string;
  label: string;
  color: string;
  count: number;
}

export interface GraphInfoOverview {
  nodeCount: number;
  edgeCount: number;
  kindCount: number;
  orphanCount: number;
}

export interface GraphInfoHealth {
  high: number;
  mid: number;
  low: number;
  highPct: number;
  midPct: number;
  lowPct: number;
  /** Share of nodes with at least one edge. */
  healthPct: number;
}

export interface GraphInfoDistribution {
  dim: "kind";
  title: string;
  hint: string;
  buckets: GraphInfoBucket[];
  totalBuckets: number;
}

export interface GraphInfoSelected {
  id: string;
  label: string;
  kind: string;
  kindLabel: string;
  status: ArtifactStatus;
  statusLabel: string;
  degree: number;
  tags: string[];
  role?: string;
  reachable: boolean;
}

export interface GraphInfoModel {
  overview: GraphInfoOverview;
  health: GraphInfoHealth;
  kindDistribution: GraphInfoDistribution;
  degreeById: Map<string, number>;
}

const KIND_COLORS: Record<string, string> = {
  markdown: "#8f9bff",
  image: "#5fd6b8",
  video: "#69b8ff",
  audio: "#7cde80",
  html: "#55b9ff",
  other: "#8ea1c6",
};

function kindColor(kind: string): string {
  return KIND_COLORS[kind] ?? KIND_COLORS.other;
}

function toBuckets(
  counts: Map<string, { label: string; count: number; color?: string }>,
): GraphInfoBucket[] {
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([id, v]) => ({
      id,
      label: v.label,
      count: v.count,
      color: v.color ?? KIND_COLORS.other,
    }));
}

function buildDegreeMap(
  artifacts: ArtifactView[],
  edges: DisplayEdge[],
): Map<string, number> {
  const degree = new Map<string, number>();
  for (const a of artifacts) degree.set(a.id, 0);
  for (const e of edges) {
    if (degree.has(e.from)) degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    if (degree.has(e.to)) degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  return degree;
}

export function buildGraphInfoModel(
  artifacts: ArtifactView[],
  edges: DisplayEdge[],
  locale?: Locale,
): GraphInfoModel {
  const degreeById = buildDegreeMap(artifacts, edges);

  let orphanCount = 0;
  const kindCounts = new Map<string, { label: string; count: number; color?: string }>();

  for (const a of artifacts) {
    const deg = degreeById.get(a.id) ?? 0;
    if (deg === 0) orphanCount += 1;

    kindCounts.set(a.kind, {
      label: kindLabel(a.kind, locale),
      count: (kindCounts.get(a.kind)?.count ?? 0) + 1,
      color: kindColor(a.kind),
    });
  }

  const kindBuckets = toBuckets(kindCounts);
  const total = artifacts.length || 1;
  let high = 0;
  let mid = 0;
  let low = 0;
  let connected = 0;
  for (const a of artifacts) {
    const d = degreeById.get(a.id) ?? 0;
    if (d >= 5) high += 1;
    else if (d >= 2) mid += 1;
    else low += 1;
    if (d > 0) connected += 1;
  }

  return {
    overview: {
      nodeCount: artifacts.length,
      edgeCount: edges.length,
      kindCount: kindBuckets.length,
      orphanCount,
    },
    health: {
      high,
      mid,
      low,
      highPct: Math.round((high / total) * 100),
      midPct: Math.round((mid / total) * 100),
      lowPct: Math.round((low / total) * 100),
      healthPct: Math.round((connected / total) * 100),
    },
    kindDistribution: {
      dim: "kind",
      title: tStatic("graph.kindDistribution", undefined, locale),
      hint: tStatic("graph.kindDistributionHint", undefined, locale),
      buckets: kindBuckets.slice(0, 6),
      totalBuckets: kindBuckets.length,
    },
    degreeById,
  };
}

export function resolveSelectedInfo(
  model: GraphInfoModel,
  artifact: ArtifactView | null,
  locale?: Locale,
): GraphInfoSelected | null {
  if (!artifact) return null;
  return {
    id: artifact.id,
    label: artifact.displayName,
    kind: artifact.kind,
    kindLabel: kindLabel(artifact.kind, locale),
    status: artifact.status,
    statusLabel: statusLabel(artifact.status, locale),
    degree: model.degreeById.get(artifact.id) ?? 0,
    tags: artifact.tags ?? [],
    role: artifact.role,
    reachable: artifact.reachable,
  };
}
