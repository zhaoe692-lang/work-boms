import type { ArtifactStatus, ArtifactView } from "../shared/types";
import { tStatic, type Locale } from "./i18n";

interface EdgeLike {
  from: string;
  to: string;
  kind: string;
}

export function graphFingerprint(
  artifacts: ArtifactView[],
  edges: EdgeLike[],
): string {
  const ids = artifacts
    .map((a) => a.id)
    .sort()
    .join(",");
  const rels = edges
    .map((r) => `${r.from}->${r.to}:${r.kind}`)
    .sort()
    .join(",");
  return `${ids}|${rels}`;
}

export function statusLabel(
  status: ArtifactStatus,
  locale?: Locale,
): string {
  switch (status) {
    case "final":
      return tStatic("status.final", undefined, locale);
    case "candidate":
      return tStatic("status.candidate", undefined, locale);
    default:
      return tStatic("status.draft", undefined, locale);
  }
}

export function kindLabel(kind: string, locale?: Locale): string {
  switch (kind) {
    case "markdown":
      return tStatic("kind.markdown", undefined, locale);
    case "image":
      return tStatic("kind.image", undefined, locale);
    case "audio":
      return tStatic("kind.audio", undefined, locale);
    case "video":
      return tStatic("kind.video", undefined, locale);
    case "html":
      return tStatic("kind.html", undefined, locale);
    default:
      return tStatic("kind.other", undefined, locale);
  }
}

export function neighborIds(
  artifactId: string,
  edges: EdgeLike[],
): Set<string> {
  const ids = new Set<string>();
  for (const rel of edges) {
    if (rel.from === artifactId) ids.add(rel.to);
    if (rel.to === artifactId) ids.add(rel.from);
  }
  return ids;
}

export function artifactById(
  artifacts: ArtifactView[],
  id: string,
): ArtifactView | undefined {
  return artifacts.find((a) => a.id === id);
}

export function ringPositions(
  centerId: string,
  neighborIds: string[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.32;
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(centerId, { x: cx, y: cy });

  if (neighborIds.length === 0) return positions;

  neighborIds.forEach((id, index) => {
    const angle = (index / neighborIds.length) * Math.PI * 2 - Math.PI / 2;
    positions.set(id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  });

  return positions;
}

interface ForceNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Lightweight force layout for global graph (no external deps). */
export function forceLayout(
  nodeIds: string[],
  edges: { from: string; to: string }[],
  width: number,
  height: number,
  iterations = 100,
): Map<string, { x: number; y: number }> {
  const cx = width / 2;
  const cy = height / 2;
  const nodes: ForceNode[] = nodeIds.map((id, i) => {
    const angle = (i / Math.max(nodeIds.length, 1)) * Math.PI * 2;
    const r = Math.min(width, height) * 0.28;
    return {
      id,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
    };
  });

  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));

  for (let step = 0; step < iterations; step += 1) {
    for (const node of nodes) {
      node.vx += (cx - node.x) * 0.002;
      node.vy += (cy - node.y) * 0.002;
    }

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.hypot(dx, dy), 0.01);
        const repel = 8000 / (dist * dist);
        const fx = (dx / dist) * repel;
        const fy = (dy / dist) * repel;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const edge of edges) {
      const ai = nodeIndex.get(edge.from);
      const bi = nodeIndex.get(edge.to);
      if (ai === undefined || bi === undefined) continue;
      const a = nodes[ai];
      const b = nodes[bi];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const spring = (dist - 90) * 0.04;
      const fx = (dx / dist) * spring;
      const fy = (dy / dist) * spring;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of nodes) {
      node.vx *= 0.85;
      node.vy *= 0.85;
      node.x += node.vx;
      node.y += node.vy;
      node.x = Math.max(40, Math.min(width - 40, node.x));
      node.y = Math.max(40, Math.min(height - 40, node.y));
    }
  }

  return new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}
