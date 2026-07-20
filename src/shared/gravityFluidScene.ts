/**
 * Standard 3D blob force layout: points + lines only.
 * One irregular volume — no special hubs, no degree-weighted centering.
 */
import type { DisplayEdge } from "./graph";
import { buildDisplayEdges } from "./graph";
import { edgeKindKey, type GraphAppearanceSettings } from "./graphAppearance";
import type { ArtifactView, Identity, Relation } from "./types";

export interface FluidNode {
  id: string;
  label: string;
  kind: string;
  status: string;
  degree: number;
  depth: number;
  x: number;
  y: number;
  z: number;
  color: string;
  size: number;
  reachable: boolean;
}

export interface FluidEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  color: string;
}

export interface FluidSceneModel {
  nodes: FluidNode[];
  nodeById: Map<string, FluidNode>;
  edges: FluidEdge[];
  cx: number;
  cy: number;
  cz: number;
  radius: number;
}

const NODE_CYAN = "#6ecfff";
const NODE_MAGENTA = "#c874ff";

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed: string): number {
  return (hash(seed) % 100000) / 100000;
}

/** Uniform soft blob: seed in ellipsoid, repel + spring, weak leash. */
function simulate(
  ids: string[],
  edges: DisplayEdge[],
): Map<string, { x: number; y: number; z: number }> {
  const pos = new Map<string, { x: number; y: number; z: number }>();
  const n = Math.max(ids.length, 1);
  const spread = 90 + Math.sqrt(n) * 42;

  for (const id of ids) {
    const theta = rand(`t:${id}`) * Math.PI * 2;
    const phi = Math.acos(rand(`p:${id}`) * 2 - 1);
    const r = spread * Math.cbrt(0.15 + rand(`r:${id}`) * 0.85);
    pos.set(id, {
      x: Math.sin(phi) * Math.cos(theta) * r * 1.2,
      y: Math.cos(phi) * r * 0.82,
      z: Math.sin(phi) * Math.sin(theta) * r * 1.1,
    });
  }

  const iterations = n <= 80 ? Math.min(200, 90 + n * 2) : n <= 250 ? 85 : 60;
  const linkRest = 46 + Math.min(n, 80) * 0.4;
  const repulseStep = n <= 120 ? 1 : n <= 300 ? 2 : 3;

  for (let iter = 0; iter < iterations; iter += 1) {
    const cooling = 1 - iter / iterations;
    const alpha = 0.6 * cooling + 0.1;

    for (let i = 0; i < ids.length; i += 1) {
      const a = pos.get(ids[i]!)!;
      for (let j = i + 1 + ((iter + i) % repulseStep); j < ids.length; j += repulseStep) {
        const b = pos.get(ids[j]!)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = a.z - b.z;
        let dist2 = dx * dx + dy * dy + dz * dz;
        if (dist2 < 1) {
          dx = (rand(`rx:${ids[i]}:${ids[j]}`) - 0.5) * 2;
          dy = (rand(`ry:${ids[i]}:${ids[j]}`) - 0.5) * 2;
          dz = (rand(`rz:${ids[i]}:${ids[j]}`) - 0.5) * 2;
          dist2 = dx * dx + dy * dy + dz * dz + 0.01;
        }
        const dist = Math.sqrt(dist2);
        const force = (2200 / dist2) * alpha * repulseStep;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;
        a.x += fx;
        a.y += fy;
        a.z += fz;
        b.x -= fx;
        b.y -= fy;
        b.z -= fz;
      }
    }

    for (const e of edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const force = ((dist - linkRest) / dist) * 0.045 * alpha;
      a.x += dx * force;
      a.y += dy * force;
      a.z += dz * force;
      b.x -= dx * force;
      b.y -= dy * force;
      b.z -= dz * force;
    }

    // Soft leash only — keep one blob volume, no center-weighted pull.
    const leash = spread * 1.85;
    for (const id of ids) {
      const p = pos.get(id)!;
      const d = Math.hypot(p.x, p.y, p.z);
      if (d > leash) {
        const pull = ((d - leash) / d) * 0.025 * alpha;
        p.x -= p.x * pull;
        p.y -= p.y * pull;
        p.z -= p.z * pull;
      }
    }
  }

  return pos;
}

export function buildGravityFluidScene(input: {
  artifacts: ArtifactView[];
  relations: Relation[];
  identities: Identity[];
  centerId: string | null;
  appearance: GraphAppearanceSettings;
  relationKinds?: string[];
}): FluidSceneModel {
  const { artifacts, relations, identities } = input;
  const sizeScale = input.appearance?.nodeSizeScale ?? 1;
  void input.centerId;

  const allEdges = buildDisplayEdges(artifacts, relations, identities);
  const allowedKinds = new Set(input.relationKinds ?? []);
  const edges = allEdges.filter(
    (edge) => allowedKinds.size === 0 || allowedKinds.has(edge.kind),
  );
  const degree = new Map<string, number>();
  for (const e of allEdges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  const ids = artifacts.map((a) => a.id);
  const positions = simulate(ids, allEdges);
  const baseSize = 6.5 * sizeScale;
  const maxDegree = Math.max(1, ...degree.values());

  const nodes: FluidNode[] = artifacts.map((a) => {
    const p = positions.get(a.id) ?? { x: 0, y: 0, z: 0 };
    const nodeDegree = degree.get(a.id) ?? 0;
    // Obsidian-like sizing: leaves stay uniform; connected hubs grow at most 30%.
    const degreeScale =
      nodeDegree <= 1 || maxDegree <= 1
        ? 1
        : 1 + 0.3 * (Math.log(nodeDegree) / Math.log(maxDegree));
    // Soft cyan/magenta tint by position axis only — not by depth/status.
    const tint = (p.x + p.z) * 0.5 >= 0 ? NODE_CYAN : NODE_MAGENTA;
    return {
      id: a.id,
      label: a.displayName,
      kind: a.kind,
      status: a.status,
      degree: nodeDegree,
      depth: 1,
      x: p.x,
      y: p.y,
      z: p.z,
      color: tint,
      size: baseSize * degreeScale,
      reachable: a.reachable,
    };
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const fluidEdges: FluidEdge[] = edges
    .filter((e) => nodeById.has(e.from) && nodeById.has(e.to))
    .map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      kind: e.kind,
      color: input.appearance.edges[edgeKindKey(e.kind)],
    }));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
    minZ = Math.min(minZ, n.z);
    maxZ = Math.max(maxZ, n.z);
  }
  if (!nodes.length) {
    minX = maxX = minY = maxY = minZ = maxZ = 0;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  let radius = 120;
  for (const n of nodes) {
    radius = Math.max(radius, Math.hypot(n.x - cx, n.y - cy, n.z - cz));
  }

  return { nodes, nodeById, edges: fluidEdges, cx, cy, cz, radius };
}
