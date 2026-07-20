import type { StarGrowthScene } from "./starGrowthScene";
import type { ArtifactView } from "./types";

export interface GravityPoint {
  x: number;
  y: number;
}

export interface GravityArc {
  index: number;
  from: GravityPoint;
  control: GravityPoint;
  to: GravityPoint;
}

export interface GravityNodePlacement {
  x: number;
  y: number;
  z: number;
  t: number;
  arcIndex: number;
}

export interface GravityWellLayout {
  well: GravityPoint;
  arcs: GravityArc[];
  positions: Map<string, GravityNodePlacement>;
  heroId: string | null;
}

const WELL_Y = 0.38;
const ARC_COUNT = 36;
const ARC_REACH = 0.92;

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function pointOnGravityArc(arc: GravityArc, t: number): GravityPoint {
  const u = 1 - t;
  return {
    x: u * u * arc.from.x + 2 * u * t * arc.control.x + t * t * arc.to.x,
    y: u * u * arc.from.y + 2 * u * t * arc.control.y + t * t * arc.to.y,
  };
}

function buildArcs(): GravityArc[] {
  const from: GravityPoint = { x: 0, y: WELL_Y };
  const arcs: GravityArc[] = [];

  for (let i = 0; i < ARC_COUNT; i += 1) {
    const t = i / (ARC_COUNT - 1);
    const angle = -Math.PI * 0.62 + t * Math.PI * 1.24;
    const spread = 0.92 + Math.sin(t * Math.PI) * 0.08;
    const reach = ARC_REACH * spread;
    const endX = Math.sin(angle) * reach;
    const endY = WELL_Y - Math.cos(angle) * reach * 1.05;
    const ctrlX = Math.sin(angle) * reach * 0.48;
    const ctrlY = WELL_Y - Math.cos(angle) * reach * 0.62;

    arcs.push({
      index: i,
      from,
      control: { x: ctrlX, y: ctrlY },
      to: { x: endX, y: endY },
    });
  }

  return arcs;
}

export function buildGravityWellLayout(input: {
  artifacts: ArtifactView[];
  scene: StarGrowthScene;
}): GravityWellLayout {
  const { artifacts, scene } = input;
  const arcs = buildArcs();
  const positions = new Map<string, GravityNodePlacement>();
  const heroId = scene.heroId;
  const well: GravityPoint = { x: 0, y: WELL_Y };

  if (!artifacts.length) {
    return { well, arcs, positions, heroId };
  }

  const maxInfluence = Math.max(1, ...scene.influenceScoreById.values());
  const sorted = [...artifacts].sort((a, b) => {
    const ia = scene.influenceScoreById.get(a.id) ?? 0;
    const ib = scene.influenceScoreById.get(b.id) ?? 0;
    if (ib !== ia) return ib - ia;
    return a.displayName.localeCompare(b.displayName);
  });

  sorted.forEach((artifact, rank) => {
    const influence = scene.influenceScoreById.get(artifact.id) ?? 0;
    const norm = influence / maxInfluence;
    const arcIndex = hashId(artifact.id) % arcs.length;
    const arc = arcs[arcIndex]!;
    const baseT = 0.12 + (rank / Math.max(1, sorted.length - 1)) * 0.78;
    const pull = norm * 0.22;
    const t = clamp(baseT - pull, 0.08, 0.96);
    const jitter = ((hashId(artifact.id) % 200) / 200 - 0.5) * 0.012;
    const pt = pointOnGravityArc(arc, t);

    positions.set(artifact.id, {
      x: pt.x + jitter,
      y: pt.y + jitter * 0.6,
      z: 0.25 + norm * 0.45 + (1 - t) * 0.2,
      t,
      arcIndex,
    });
  });

  if (heroId) {
    positions.set(heroId, { x: well.x, y: well.y, z: 0.95, t: 0, arcIndex: -1 });
  }

  return { well, arcs, positions, heroId };
}
