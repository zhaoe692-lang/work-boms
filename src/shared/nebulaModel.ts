/**
 * Pure data → "nebula" layout model for the 云层 (cloud-layer) graph mode.
 *
 * The mockup groups nodes into named clusters floating over glowing clouds.
 * Our data has no business domains, so we cluster by our own dimensions:
 *   - by `work` (作品/剧集) when the package defines works, else
 *   - by connected components of the resolved edge graph.
 * Node *type* (kind) drives the legend colours; clusters drive the cloud tints.
 *
 * No three.js / DOM here — just geometry + aggregates, so it is easy to test
 * and the renderer stays a thin drawing layer on top.
 */
import type { DisplayEdge } from "./graph";
import { tStatic, type Locale } from "./i18n";
import type { ArtifactView, Identity, Work } from "./types";
import { kindLabel } from "./utils";

export interface NebulaNode {
  id: string;
  label: string;
  kind: string;
  clusterId: string;
  degree: number;
  /** layout position in abstract model space (~ -1000..1000 x, -640..640 y) */
  x: number;
  y: number;
  /** small depth jitter for parallax */
  z: number;
  color: string;
  size: number;
}

export interface NebulaCluster {
  id: string;
  label: string;
  color: string;
  count: number;
  /** cluster centre in model space */
  cx: number;
  cy: number;
  cz: number;
  /** rough radius covering its nodes */
  radius: number;
  shellId: string;
}

export interface NebulaCloudShell {
  id: string;
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
  color: string;
}

export interface NebulaEdge {
  from: string;
  to: string;
}

export interface KindLegendItem {
  kind: string;
  label: string;
  color: string;
  count: number;
}

export interface NebulaHealth {
  strong: number;
  medium: number;
  weak: number;
  strongPct: number;
  mediumPct: number;
  weakPct: number;
  /** headline "health" = share of nodes that are connected at all */
  healthPct: number;
}

export interface NebulaOverview {
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  tagCount: number;
  dataSourceCount: number;
  lastUpdatedAt: string | null;
}

export interface NebulaModel {
  nodes: NebulaNode[];
  nodeById: Map<string, NebulaNode>;
  clusters: NebulaCluster[];
  cloudShells: NebulaCloudShell[];
  edges: NebulaEdge[];
  overview: NebulaOverview;
  health: NebulaHealth;
  kinds: KindLegendItem[];
}

const CLUSTER_PALETTE = [
  "#5b8cff",
  "#8f6bff",
  "#3fb8c0",
  "#e0a35a",
  "#d16b9e",
  "#6bd88f",
  "#c86bff",
  "#5fd6d6",
  "#f2c14e",
  "#7f8cff",
];

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

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** deterministic [0,1) generator seeded by a string */
function rand(seed: string): number {
  const h = hash(seed);
  return (h % 100000) / 100000;
}

export function buildNebulaModel(
  artifacts: ArtifactView[],
  edges: DisplayEdge[],
  works: Work[],
  _identities: Identity[],
  locale?: Locale,
): NebulaModel {
  const artifactById = new Map(artifacts.map((a) => [a.id, a]));

  // degree from resolved edges
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const degreeOf = (id: string) => degree.get(id) ?? 0;

  const clustering = assignClusters(artifacts, edges, works, locale);

  // ---- overlapping ellipsoid lobes: real nodes + real edges form one cloud
  const clusterIds = [...clustering.order];
  const clusterCount = Math.max(clusterIds.length, 1);
  const cloudLobes = [
    { x: -340, y: -36, z: -28, rx: 285, ry: 145, rz: 190 },
    { x: -165, y: 82, z: 52, rx: 310, ry: 190, rz: 225 },
    { x: 24, y: 30, z: -34, rx: 355, ry: 220, rz: 255 },
    { x: 238, y: 86, z: 64, rx: 305, ry: 185, rz: 220 },
    { x: 392, y: -30, z: -24, rx: 250, ry: 140, rz: 185 },
  ];

  const members = new Map<string, string[]>();
  for (const a of artifacts) {
    const cid = clustering.byArtifact.get(a.id)!;
    const list = members.get(cid) ?? [];
    list.push(a.id);
    members.set(cid, list);
  }

  const nodes: NebulaNode[] = [];
  const clusters: NebulaCluster[] = [];
  const activeLobes = new Map<number, NebulaCloudShell>();

  clusterIds.forEach((cid, index) => {
    const memberIds = members.get(cid) ?? [];
    const span = Math.min(4, Math.max(1, clusterCount - 1));
    const start = (4 - span) / 2;
    const lobeIndex = clusterCount <= 1
      ? 2
      : Math.round(start + (index / Math.max(clusterCount - 1, 1)) * span);
    const lobe = cloudLobes[Math.max(0, Math.min(4, lobeIndex))];
    const color = CLUSTER_PALETTE[index % CLUSTER_PALETTE.length];
    const clusterR = Math.max(lobe.rx, lobe.ry) * 0.68;
    const shellId = `cloud-lobe:${lobeIndex}`;
    if (!activeLobes.has(lobeIndex)) {
      activeLobes.set(lobeIndex, {
        id: shellId,
        cx: lobe.x,
        cy: lobe.y,
        cz: lobe.z,
        rx: lobe.rx,
        ry: lobe.ry,
        rz: lobe.rz,
        color,
      });
    }

    memberIds.forEach((id) => {
      const artifact = artifactById.get(id)!;
      const deg = degreeOf(id);
      // high-degree nodes sit nearer the cluster core
      const pull = 1 - Math.min(deg, 8) / 14;
      const rr = Math.cbrt(rand(`r:${id}`)) * pull;
      const theta = rand(`a:${id}`) * Math.PI * 2;
      const phi = Math.acos(rand(`p:${id}`) * 2 - 1);
      nodes.push({
        id,
        label: artifact.displayName,
        kind: artifact.kind,
        clusterId: cid,
        degree: deg,
        x: lobe.x + Math.sin(phi) * Math.cos(theta) * rr * lobe.rx,
        y: lobe.y + Math.cos(phi) * rr * lobe.ry,
        z: lobe.z + Math.sin(phi) * Math.sin(theta) * rr * lobe.rz,
        color: kindColor(artifact.kind),
        size: 9 + Math.min(deg, 12) * 1.7,
      });
    });

    clusters.push({
      id: cid,
      label: clustering.labels.get(cid) ?? cid,
      color,
      count: memberIds.length,
      cx: lobe.x,
      cy: lobe.y,
      cz: lobe.z,
      radius: clusterR,
      shellId,
    });
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const validEdges: NebulaEdge[] = edges
    .filter((e) => nodeById.has(e.from) && nodeById.has(e.to))
    .map((e) => ({ from: e.from, to: e.to }));

  // ---- aggregates for the info panel
  const tags = new Set<string>();
  const sources = new Set<string>();
  let lastTs = -Infinity;
  let lastUpdatedAt: string | null = null;
  for (const a of artifacts) {
    for (const t of a.tags ?? []) tags.add(t);
    const src = a.provenance?.tool ?? a.provenance?.sessionLabel;
    if (src) sources.add(src);
    const raw = (a.updatedAt ?? "").trim();
    let ts = Date.parse(raw);
    if (!Number.isFinite(ts) && /^\d{10}$/.test(raw)) ts = Number(raw) * 1000;
    else if (!Number.isFinite(ts) && /^\d{13}$/.test(raw)) ts = Number(raw);
    if (Number.isFinite(ts) && ts > lastTs) {
      lastTs = ts;
      lastUpdatedAt = a.updatedAt;
    }
  }

  const total = nodes.length || 1;
  let strong = 0;
  let medium = 0;
  let weak = 0;
  let connected = 0;
  for (const n of nodes) {
    if (n.degree >= 5) strong += 1;
    else if (n.degree >= 2) medium += 1;
    else weak += 1;
    if (n.degree > 0) connected += 1;
  }

  const kindCounts = new Map<string, number>();
  for (const n of nodes) kindCounts.set(n.kind, (kindCounts.get(n.kind) ?? 0) + 1);
  const kinds: KindLegendItem[] = [...kindCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => ({ kind, label: kindLabel(kind, locale), color: kindColor(kind), count }));

  return {
    nodes,
    nodeById,
    clusters: clusters.sort((a, b) => b.count - a.count),
    cloudShells: [...activeLobes.values()],
    edges: validEdges,
    overview: {
      nodeCount: nodes.length,
      edgeCount: validEdges.length,
      clusterCount: clusters.length,
      tagCount: tags.size,
      dataSourceCount: sources.size,
      lastUpdatedAt,
    },
    health: {
      strong,
      medium,
      weak,
      strongPct: Math.round((strong / total) * 100),
      mediumPct: Math.round((medium / total) * 100),
      weakPct: Math.round((weak / total) * 100),
      healthPct: Math.round((connected / total) * 100),
    },
    kinds,
  };
}

interface Clustering {
  byArtifact: Map<string, string>;
  labels: Map<string, string>;
  order: string[];
}

/** Cluster by works when present, otherwise by connected components. */
function assignClusters(
  artifacts: ArtifactView[],
  edges: DisplayEdge[],
  works: Work[],
  locale?: Locale,
): Clustering {
  const byArtifact = new Map<string, string>();
  const labels = new Map<string, string>();
  const order: string[] = [];
  const ensure = (id: string, label: string) => {
    if (!labels.has(id)) {
      labels.set(id, label);
      order.push(id);
    }
  };

  if (works.length > 0) {
    const workOf = new Map<string, string>();
    for (const w of works) {
      for (const aid of w.artifactIds) workOf.set(aid, w.id);
    }
    for (const a of artifacts) {
      const wid = a.workId ?? workOf.get(a.id);
      if (wid) {
        const work = works.find((w) => w.id === wid);
        ensure(`work:${wid}`, work?.title ?? wid);
        byArtifact.set(a.id, `work:${wid}`);
      } else {
        ensure("misc", tStatic("graph.unclassified", undefined, locale));
        byArtifact.set(a.id, "misc");
      }
    }
    return { byArtifact, labels, order };
  }

  // union-find over edges → connected components
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  for (const a of artifacts) parent.set(a.id, a.id);
  for (const e of edges) {
    if (parent.has(e.from) && parent.has(e.to)) union(e.from, e.to);
  }

  // map each root to a stable cluster id + count for labelling
  let clusterIndex = 0;
  const rootToId = new Map<string, string>();
  for (const a of artifacts) {
    const root = find(a.id);
    let cid = rootToId.get(root);
    if (!cid) {
      clusterIndex += 1;
      cid = `c${clusterIndex}`;
      rootToId.set(root, cid);
      ensure(cid, tStatic("graph.cluster", { n: clusterIndex }, locale));
    }
    byArtifact.set(a.id, cid);
  }
  return { byArtifact, labels, order };
}
