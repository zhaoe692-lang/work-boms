import { buildPartOfForest, type BomNode } from "./bom";
import type { Vec3 } from "./globeLayout";
import type { StarGrowthScene } from "./starGrowthScene";
import type { ArtifactView, Identity, Relation } from "./types";

export interface MyceliumPoint {
  x: number;
  y: number;
}

export interface MyceliumBranch {
  from: MyceliumPoint;
  to: MyceliumPoint;
  control: MyceliumPoint;
  weight: number;
  depth: number;
  revealOrder: number;
  fromId?: string;
  toId?: string;
}

export interface MyceliumCluster {
  cx: number;
  cy: number;
  radius: number;
  artifactIds: string[];
  weight: number;
  seed: number;
}

export interface MyceliumLayout {
  root: MyceliumPoint;
  rootFilaments: Array<{ angle: number; length: number; curl: number }>;
  branches: MyceliumBranch[];
  clusters: MyceliumCluster[];
  positions: Map<string, Vec3>;
  heroId: string | null;
}

const ROOT_Y = 0.97;
const MIN_SEGMENT = 0.11;
const MAX_DEPTH = 8;

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizedScore(value: number, floor: number, ceiling: number): number {
  if (!Number.isFinite(value)) return 0;
  if (ceiling <= floor) return 0;
  return clamp((value - floor) / (ceiling - floor), 0, 1);
}

function organicControl(from: MyceliumPoint, to: MyceliumPoint, seed: number): MyceliumPoint {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bend = ((seed % 100) / 100 - 0.5) * len * 0.28;
  const lift = len * 0.06;
  return { x: mx + nx * bend, y: my + ny * bend - lift };
}

function branchWeight(
  scene: StarGrowthScene,
  artifactId: string | undefined,
  childCount: number,
  depth: number,
): number {
  const influence = artifactId ? (scene.influenceScoreById.get(artifactId) ?? 0) : 0;
  const complexity = artifactId ? (scene.complexityScoreById.get(artifactId) ?? 1) : 1;
  const maxInfluence = Math.max(1, ...scene.influenceScoreById.values());
  const maxComplexity = Math.max(1, ...scene.complexityScoreById.values());
  const depthFalloff = Math.pow(0.72, depth);
  const childBoost = Math.min(1, childCount / 6);
  return clamp(
    (0.35 + normalizedScore(influence, 0, maxInfluence) * 0.35 +
      normalizedScore(complexity, 1, maxComplexity) * 0.2 +
      childBoost * 0.25) *
      depthFalloff,
    0.12,
    1,
  );
}

function layoutBomSubtree(
  node: BomNode,
  parent: MyceliumPoint | null,
  depth: number,
  angle: number,
  siblingIndex: number,
  siblingCount: number,
  rootX: number,
  scene: StarGrowthScene,
  branches: MyceliumBranch[],
  positions: Map<string, Vec3>,
  leafBuckets: Map<string, string[]>,
  revealOrder: { value: number },
): MyceliumPoint {
  const seed = hashId(node.id);
  const segmentLen = Math.max(MIN_SEGMENT, 0.24 - depth * 0.018);
  const jitter = ((seed % 1000) / 1000 - 0.5) * 0.035;

  let pos: MyceliumPoint;
  if (parent == null) {
    pos = { x: rootX + jitter * 0.3, y: ROOT_Y };
  } else {
    const spread =
      siblingCount > 1 ? (siblingIndex - (siblingCount - 1) / 2) * 0.14 : 0;
    const a = angle + spread + jitter * 0.4;
    pos = {
      x: parent.x + Math.sin(a) * segmentLen * (1 + depth * 0.1),
      y: parent.y - Math.cos(a) * segmentLen * 0.92,
    };
  }

  const childCount = node.children.length;
  const weight = branchWeight(scene, node.artifactId, childCount, depth);
  const z = 0.18 + (1 - depth / MAX_DEPTH) * 0.55 + weight * 0.2;

  if (parent) {
    const control = organicControl(parent, pos, seed);
    branches.push({
      from: parent,
      to: pos,
      control,
      weight,
      depth,
      revealOrder: revealOrder.value,
      fromId: undefined,
      toId: node.artifactId,
    });
    revealOrder.value += 1;
  }

  positions.set(node.artifactId, { x: pos.x, y: pos.y, z });

  if (childCount === 0) {
    const bucketKey = parent ? `${parent.x.toFixed(2)}:${parent.y.toFixed(2)}` : "root";
    leafBuckets.set(bucketKey, [...(leafBuckets.get(bucketKey) ?? []), node.artifactId]);
    return pos;
  }

  const baseAngle = Math.PI / 2;
  const spread = clamp(0.55 + childCount * 0.12, 0.45, 1.35);
  node.children.forEach((child, index) => {
    const childAngle =
      baseAngle + ((index - (childCount - 1) / 2) * spread) / Math.max(childCount - 1, 1);
    layoutBomSubtree(
      child,
      pos,
      depth + 1,
      childAngle,
      index,
      childCount,
      rootX,
      scene,
      branches,
      positions,
      leafBuckets,
      revealOrder,
    );
  });

  return pos;
}

function buildClustersFromLeaves(
  leafBuckets: Map<string, string[]>,
  positions: Map<string, Vec3>,
  scene: StarGrowthScene,
): MyceliumCluster[] {
  const clusters: MyceliumCluster[] = [];
  const maxInfluence = Math.max(1, ...scene.influenceScoreById.values());

  for (const [key, ids] of leafBuckets.entries()) {
    if (!ids.length) continue;
    const pts = ids
      .map((id) => positions.get(id))
      .filter((p): p is Vec3 => p != null);
    if (!pts.length) continue;

    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const spread = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
    const influence =
      ids.reduce((s, id) => s + (scene.influenceScoreById.get(id) ?? 0), 0) / ids.length;
    const weight = clamp(0.35 + normalizedScore(influence, 0, maxInfluence) * 0.65, 0.3, 1);

    clusters.push({
      cx,
      cy,
      radius: clamp(0.08 + spread * 1.8 + ids.length * 0.004, 0.07, 0.22),
      artifactIds: ids,
      weight,
      seed: hashId(key),
    });

    ids.forEach((id, index) => {
      const phyllo = index * 2.399963229728653;
      const orbit = Math.sqrt((index + 0.6) / Math.max(1, ids.length)) * clusters[clusters.length - 1].radius;
      const jitter = ((hashId(id) % 500) / 500 - 0.5) * 0.012;
      positions.set(id, {
        x: cx + Math.cos(phyllo) * orbit + jitter,
        y: cy + Math.sin(phyllo) * orbit * 0.82 + jitter,
        z: 0.42 + weight * 0.18,
      });
    });
  }

  return clusters;
}

/** Procedural silhouette tuned to the 02 MYCELIUM GROWTH reference frame. */
function buildProceduralSkeleton(
  heroId: string | null,
  branches: MyceliumBranch[],
  positions: Map<string, Vec3>,
  revealOrder: { value: number },
): MyceliumPoint {
  const root: MyceliumPoint = { x: 0, y: ROOT_Y };
  const skeleton: Array<{ from: MyceliumPoint; to: MyceliumPoint; weight: number; depth: number }> =
    [
      { from: root, to: { x: 0, y: 0.62 }, weight: 1, depth: 0 },
      { from: { x: 0, y: 0.62 }, to: { x: -0.22, y: 0.38 }, weight: 0.82, depth: 1 },
      { from: { x: 0, y: 0.62 }, to: { x: 0.04, y: 0.34 }, weight: 0.88, depth: 1 },
      { from: { x: 0, y: 0.62 }, to: { x: 0.26, y: 0.4 }, weight: 0.78, depth: 1 },
      { from: { x: -0.22, y: 0.38 }, to: { x: -0.48, y: 0.12 }, weight: 0.62, depth: 2 },
      { from: { x: -0.22, y: 0.38 }, to: { x: -0.18, y: 0.08 }, weight: 0.55, depth: 2 },
      { from: { x: 0.04, y: 0.34 }, to: { x: -0.08, y: 0.02 }, weight: 0.58, depth: 2 },
      { from: { x: 0.04, y: 0.34 }, to: { x: 0.16, y: -0.02 }, weight: 0.6, depth: 2 },
      { from: { x: 0.26, y: 0.4 }, to: { x: 0.42, y: 0.1 }, weight: 0.56, depth: 2 },
      { from: { x: 0.26, y: 0.4 }, to: { x: 0.38, y: 0.22 }, weight: 0.5, depth: 2 },
      { from: { x: -0.48, y: 0.12 }, to: { x: -0.58, y: -0.12 }, weight: 0.38, depth: 3 },
      { from: { x: 0.16, y: -0.02 }, to: { x: 0.22, y: -0.28 }, weight: 0.36, depth: 3 },
      { from: { x: 0.42, y: 0.1 }, to: { x: 0.52, y: -0.1 }, weight: 0.34, depth: 3 },
    ];

  skeleton.forEach((seg, index) => {
    const control = organicControl(seg.from, seg.to, hashId(`skel-${index}`));
    branches.push({
      ...seg,
      control,
      revealOrder: revealOrder.value,
    });
    revealOrder.value += 1;
  });

  if (heroId) {
    positions.set(heroId, { x: root.x, y: root.y, z: 0.88 });
  }

  return root;
}

function scatterArtifactsOnSkeleton(
  artifactIds: string[],
  branches: MyceliumBranch[],
  positions: Map<string, Vec3>,
  scene: StarGrowthScene,
): MyceliumCluster[] {
  const tips = branches
    .filter((b) => !branches.some((other) => other.from.x === b.to.x && other.from.y === b.to.y))
    .sort((a, b) => a.depth - b.depth);

  const clusterCount = Math.max(4, Math.min(tips.length, Math.ceil(artifactIds.length / 8)));
  const chosenTips = tips.slice(0, clusterCount);
  const clusters: MyceliumCluster[] = [];
  const maxInfluence = Math.max(1, ...scene.influenceScoreById.values());

  chosenTips.forEach((tip, tipIndex) => {
    const ids = artifactIds.filter((_, i) => i % clusterCount === tipIndex);
    if (!ids.length) return;
    const influence =
      ids.reduce((s, id) => s + (scene.influenceScoreById.get(id) ?? 0), 0) / ids.length;
    const weight = clamp(0.4 + normalizedScore(influence, 0, maxInfluence) * 0.6, 0.35, 1);
    const seed = hashId(`${tip.to.x}:${tip.to.y}`);

    clusters.push({
      cx: tip.to.x,
      cy: tip.to.y,
      radius: clamp(0.09 + ids.length * 0.005, 0.08, 0.2),
      artifactIds: ids,
      weight,
      seed,
    });

    ids.forEach((id, index) => {
      const phyllo = index * 2.399963229728653;
      const orbit = Math.sqrt((index + 0.5) / Math.max(1, ids.length)) * clusters[clusters.length - 1].radius;
      positions.set(id, {
        x: tip.to.x + Math.cos(phyllo) * orbit,
        y: tip.to.y + Math.sin(phyllo) * orbit * 0.85,
        z: 0.4 + weight * 0.2,
      });
    });
  });

  const placed = new Set(clusters.flatMap((c) => c.artifactIds));
  const remaining = artifactIds.filter((id) => !placed.has(id));
  remaining.forEach((id, index) => {
    const tip = chosenTips[index % Math.max(1, chosenTips.length)]?.to ?? { x: 0, y: 0.2 };
    const jitter = ((hashId(id) % 1000) / 1000 - 0.5) * 0.08;
    positions.set(id, { x: tip.x + jitter, y: tip.y + jitter * 0.6, z: 0.35 });
  });

  return clusters;
}

function buildRootFilaments(): Array<{ angle: number; length: number; curl: number }> {
  const filaments: Array<{ angle: number; length: number; curl: number }> = [];
  for (let i = 0; i < 14; i += 1) {
    const t = i / 13;
    filaments.push({
      angle: Math.PI * 0.55 + t * Math.PI * 0.9,
      length: 0.06 + (i % 4) * 0.018,
      curl: ((i * 47) % 100) / 100,
    });
  }
  return filaments;
}

export function buildMyceliumLayout(input: {
  artifacts: ArtifactView[];
  relations: Relation[];
  identities: Identity[];
  scene: StarGrowthScene;
}): MyceliumLayout {
  const { artifacts, relations, identities, scene } = input;
  const heroId = scene.heroId;
  const branches: MyceliumBranch[] = [];
  const positions = new Map<string, Vec3>();
  const revealOrder = { value: 0 };
  const leafBuckets = new Map<string, string[]>();

  const forest = buildPartOfForest(identities, relations);
  let root: MyceliumPoint = { x: 0, y: ROOT_Y };

  if (forest.length > 0) {
    const rootCount = forest.length;
    forest.forEach((tree, index) => {
      const rootX = rootCount === 1 ? 0 : -0.28 + (index / Math.max(rootCount - 1, 1)) * 0.56;
      const treeRoot = layoutBomSubtree(
        tree,
        null,
        0,
        Math.PI / 2,
        index,
        rootCount,
        rootX,
        scene,
        branches,
        positions,
        leafBuckets,
        revealOrder,
      );
      if (index === 0) root = treeRoot;
    });
  } else {
    root = buildProceduralSkeleton(heroId, branches, positions, revealOrder);
  }

  let clusters =
    leafBuckets.size > 0
      ? buildClustersFromLeaves(leafBuckets, positions, scene)
      : scatterArtifactsOnSkeleton(
          artifacts.map((a) => a.id),
          branches,
          positions,
          scene,
        );

  if (!clusters.length && artifacts.length) {
    clusters = scatterArtifactsOnSkeleton(
      artifacts.map((a) => a.id),
      branches,
      positions,
      scene,
    );
  }

  for (const artifact of artifacts) {
    if (positions.has(artifact.id)) continue;
    const seed = hashId(artifact.id);
    const angle = (seed % 360) * (Math.PI / 180);
    const r = 0.12 + (seed % 80) / 400;
    positions.set(artifact.id, {
      x: Math.cos(angle) * r,
      y: -0.1 + (seed % 60) / 300,
      z: 0.3,
    });
  }

  if (heroId && !positions.has(heroId)) {
    positions.set(heroId, { x: root.x, y: root.y, z: 0.88 });
  } else if (heroId) {
    positions.set(heroId, { x: root.x, y: root.y, z: 0.88 });
  }

  branches.sort((a, b) => a.depth - b.depth || a.revealOrder - b.revealOrder);

  return {
    root,
    rootFilaments: buildRootFilaments(),
    branches,
    clusters,
    positions,
    heroId,
  };
}
