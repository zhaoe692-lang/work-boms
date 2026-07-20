import { globeCanvasSize, type ProjectedNode, type Vec3 } from "./globeLayout";
import type { StarGrowthScene } from "./starGrowthScene";

const VIEWBOX_PAD_X = 148;
const VIEWBOX_PAD_Y = 124;
const CANOPY_GROUP_COUNT = 9;

export const pulseCanvasSize = globeCanvasSize;

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

function sortByScore(ids: string[], scene: StarGrowthScene): string[] {
  return [...ids].sort((a, b) => {
    const influenceDiff = (scene.influenceScoreById.get(b) ?? 0) - (scene.influenceScoreById.get(a) ?? 0);
    if (influenceDiff !== 0) return influenceDiff;
    const complexityDiff = (scene.complexityScoreById.get(b) ?? 0) - (scene.complexityScoreById.get(a) ?? 0);
    if (complexityDiff !== 0) return complexityDiff;
    return (scene.revealRankById.get(a) ?? 0) - (scene.revealRankById.get(b) ?? 0);
  });
}

export function pulseProjectScale(width: number, height: number): number {
  const usableW = Math.max(320, width - VIEWBOX_PAD_X * 2);
  const usableH = Math.max(220, height - VIEWBOX_PAD_Y * 2);
  return Math.max(205, Math.min(usableW, usableH) * 0.6);
}

export function pulseViewBoxRect(width: number, height: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: -VIEWBOX_PAD_X,
    y: -VIEWBOX_PAD_Y,
    width: width + VIEWBOX_PAD_X * 2,
    height: height + VIEWBOX_PAD_Y * 2,
  };
}

export function pulseNodePhase(id: string): number {
  return (hashId(id) % 628) / 100;
}

export function growthPositionsFromScene(
  nodeIds: string[],
  depths: Map<string, number>,
  scene: StarGrowthScene,
): Map<string, Vec3> {
  const positions = new Map<string, Vec3>();
  if (!nodeIds.length) return positions;

  const heroId = scene.heroId ?? nodeIds[0];
  const maxStage = Math.max(0, ...scene.stageById.values());
  const maxComplexity = Math.max(1, ...scene.complexityScoreById.values());
  const maxInfluence = Math.max(1, ...scene.influenceScoreById.values());
  const trunkIds = scene.trunkIds.length ? scene.trunkIds : [heroId];
  const trunkSet = new Set(trunkIds);

  const root = { x: 0, y: 1.06, z: 0.84 };
  const canopyAnchors = buildCanopyAnchors();
  const anchorByGroup = new Map<number, Vec3>();

  for (const id of nodeIds) {
    if (trunkSet.has(id)) continue;
    const group = scene.branchGroupById.get(id) ?? 0;
    if (anchorByGroup.has(group)) continue;
    const anchorIndex = ((group % CANOPY_GROUP_COUNT) + CANOPY_GROUP_COUNT) % CANOPY_GROUP_COUNT;
    anchorByGroup.set(group, canopyAnchors[anchorIndex]);
  }

  const trunkStages = new Map<number, string>();
  trunkIds.forEach((id) => {
    const stage = scene.stageById.get(id) ?? maxStage;
    trunkStages.set(stage, id);
  });

  trunkIds.forEach((id, index) => {
    const stage = scene.stageById.get(id) ?? maxStage;
    const t = stage / Math.max(1, maxStage);
    const influence = normalizedScore(scene.influenceScoreById.get(id) ?? 0, 0, maxInfluence);
    const complexity = normalizedScore(scene.complexityScoreById.get(id) ?? 1, 1, maxComplexity);
    const sway = Math.sin(index * 0.9 + hashId(id) * 0.0003) * 0.04;

    if (id === heroId) {
      positions.set(id, root);
      return;
    }

    positions.set(id, {
      x: sway * (1 - t * 0.42),
      y: 0.84 - t * 1.28,
      z: 0.22 + influence * 0.24 + complexity * 0.14,
    });
  });

  const idsByGroup = new Map<number, string[]>();
  for (const id of nodeIds) {
    if (trunkSet.has(id)) continue;
    const group = scene.branchGroupById.get(id) ?? 0;
    idsByGroup.set(group, [...(idsByGroup.get(group) ?? []), id]);
  }

  for (const [group, ids] of idsByGroup.entries()) {
    const anchor = anchorByGroup.get(group) ?? canopyAnchors[Math.abs(group) % canopyAnchors.length];
    const sorted = sortByScore(ids, scene);
    const count = sorted.length;

    sorted.forEach((id, index) => {
      const stage = scene.stageById.get(id) ?? maxStage;
      const trunkId = trunkStages.get(stage) ?? heroId;
      const trunk = positions.get(trunkId) ?? root;
      const influence = normalizedScore(scene.influenceScoreById.get(id) ?? 0, 0, maxInfluence);
      const complexity = normalizedScore(scene.complexityScoreById.get(id) ?? 1, 1, maxComplexity);
      const depth = Math.max(0, depths.get(id) ?? 0);
      const depthBias = Math.min(1, depth / 4);
      const versionBias = Math.min(1, ((scene.versionCountById.get(id) ?? 1) - 1) / 5);
      const phyllo = index * 2.399963229728653;
      const orbit = Math.sqrt((index + 0.7) / Math.max(1, count)) * (0.16 + Math.min(0.12, count * 0.0035));
      const jitter = ((hashId(id) % 1000) / 1000 - 0.5) * 0.03;
      const branchPull = 0.42 + influence * 0.2 + complexity * 0.12;

      const clusterX = anchor.x + Math.cos(phyllo) * orbit * (1.12 + depthBias * 0.2) + jitter;
      const clusterY = anchor.y + Math.sin(phyllo) * orbit * 0.9 - depthBias * 0.02;
      const clusterZ = anchor.z + influence * 0.14 + complexity * 0.1 - versionBias * 0.04;

      positions.set(id, {
        x: trunk.x * (1 - branchPull) + clusterX * branchPull,
        y: trunk.y * (1 - branchPull) + clusterY * branchPull,
        z: trunk.z * (1 - branchPull) + clusterZ * branchPull,
      });
    });
  }

  return positions;
}

function buildCanopyAnchors(): Vec3[] {
  const anchors: Vec3[] = [];
  for (let index = 0; index < CANOPY_GROUP_COUNT; index += 1) {
    const t = index / (CANOPY_GROUP_COUNT - 1);
    const arc = -Math.PI * 0.88 + t * Math.PI * 0.76;
    const rx = 0.7;
    const ry = 0.32;
    anchors.push({
      x: Math.cos(arc) * rx,
      y: -0.04 + Math.sin(arc) * ry - t * 0.18,
      z: 0.36 + Math.sin(t * Math.PI) * 0.22,
    });
  }
  return anchors;
}

export function projectPulsePoint(
  local: Vec3,
  driftX: number,
  driftY: number,
  width: number,
  height: number,
  projectScale = pulseProjectScale(width, height),
): ProjectedNode {
  const parallax = 1 + local.z * 0.18;
  return {
    x: width / 2 + (local.x + driftX * (0.18 + local.z * 0.06)) * projectScale * parallax,
    y: height / 2 + (local.y + driftY * (0.1 + local.z * 0.03) - local.z * 0.025) * projectScale,
    scale: 0.84 + local.z * 0.28,
    z: local.z,
  };
}
