import {
  edgesForGravityTrails,
  type GravityScene,
} from "./gravityScene";
import { edgeKindKey, type GraphAppearanceSettings } from "./graphAppearance";
import {
  buildPlanetMotion,
  opacityForTier,
  planetSizeForTier,
  resolveVisualTier,
  ringCountForTier,
  shouldSampleDustVisible,
  type PlanetMotion,
  type PlanetVisualTier,
} from "./gravityWellPlanet";
import type { ArtifactView } from "./types";

export type { PlanetMotion, PlanetVisualTier } from "./gravityWellPlanet";
export { orbitPositionAt } from "./gravityWellPlanet";

export type Vec3 = { x: number; y: number; z: number };

export type GravityWellNode = {
  id: string;
  artifact: ArtifactView;
  basePosition: Vec3;
  position: Vec3;
  size: number;
  color: string;
  glow: string;
  hitSize: number;
  isCore: boolean;
  isParent: boolean;
  visible: boolean;
  depth: number;
  identityLabel: string | null;
  showLabel: boolean;
  label: string;
  visualTier: PlanetVisualTier;
  ringCount: number;
  haloOpacity: number;
  bodyOpacity: number;
  motion: PlanetMotion;
};

export type GravityWellTrail = {
  id: string;
  source: string;
  target: string;
  kind: string;
  color: string;
  opacity: number;
};

export type GravityWellSceneModel = {
  nodes: GravityWellNode[];
  trails: GravityWellTrail[];
  nodeById: Map<string, GravityWellNode>;
  heroId: string | null;
  mode: GravityScene["mode"];
};

const LARGE_GRAPH_NODE_THRESHOLD = 150;
const DENSE_GRAPH_NODE_THRESHOLD = 80;
const MAX_STATIC_LABELS = 8;
const R_MIN = 88;
const R_STEP = 58;
const LANE_SPREAD = 0.22;

const DEPTH_PALETTE = [
  { color: "#ffe0a3", glow: "#ffd07a" },
  { color: "#d8c2ff", glow: "#b98cff" },
  { color: "#c0a4ff", glow: "#a981ff" },
  { color: "#9a92ee", glow: "#7e7bf0" },
  { color: "#7a86dc", glow: "#5f6bd8" },
] as const;

const CORE_PALETTE = { color: "#fff1cf", glow: "#ffd77a" };

export function gravityBarrierPoint(x: number, z: number): Vec3 {
  const radius = Math.hypot(x, z);
  const well = -360 * Math.exp(-(radius * radius) / (2 * 255 * 255));
  const rimLift = 115 * Math.exp(-Math.pow(radius - 390, 2) / (2 * 95 * 95));
  const outerTension = 28 * Math.exp(-Math.pow(radius - 710, 2) / (2 * 180 * 180));
  const y = well + rimLift + outerTension;
  return { x, y, z: z * 0.72 };
}

export function buildGravityWellSceneModel(input: {
  artifacts: ArtifactView[];
  gravityScene: GravityScene;
  focusId?: string | null;
  appearance?: GraphAppearanceSettings;
}): GravityWellSceneModel {
  const { artifacts, gravityScene, focusId = null, appearance } = input;

  const heroId = gravityScene.anchorArtifactId;
  const trailFocusId = focusId ?? heroId;
  const maxDepth = Math.max(0, ...gravityScene.depthByArtifactId.values(), 1);
  const largeGraph = artifacts.length > LARGE_GRAPH_NODE_THRESHOLD;
  const denseGraph = artifacts.length > DENSE_GRAPH_NODE_THRESHOLD;
  const looseIds = new Set(gravityScene.looseArtifactIds);

  const partOfChildren = new Map<string, number>();
  for (const edge of gravityScene.layoutEdges) {
    if (edge.kind !== "part_of") continue;
    partOfChildren.set(edge.to, (partOfChildren.get(edge.to) ?? 0) + 1);
  }

  const positions = new Map<string, Vec3>();
  for (const artifact of artifacts) {
    positions.set(artifact.id, buildNodePosition(artifact.id, gravityScene, heroId, maxDepth));
  }

  const nodes: GravityWellNode[] = artifacts.map((artifact) => {
    const depth = gravityScene.depthByArtifactId.get(artifact.id) ?? maxDepth + 1;
    const isCore = artifact.id === heroId;
    const childCount = partOfChildren.get(artifact.id) ?? 0;
    const isParent = childCount > 0;
    const isLoose = looseIds.has(artifact.id);
    const onPath = gravityScene.onAnchorPath.has(artifact.id);
    const visualTier = resolveVisualTier({ isCore, isLoose, isParent, depth });
    const depthFactor = 1 - depth / (maxDepth + 1);
    const palette = nodePalette(appearance, depth, isCore, isLoose);
    const size = planetSizeForTier(visualTier, depthFactor);
    const { halo: haloOpacity, body: bodyOpacity } = opacityForTier(visualTier);
    const ringCount = ringCountForTier(visualTier);
    const basePosition = positions.get(artifact.id) ?? gravityBarrierPoint(0, 0);
    const motion = buildPlanetMotion(artifact.id, basePosition, visualTier, size);
    const identityLabel = gravityScene.identityLabelByArtifactId.get(artifact.id) ?? null;
    const label = identityLabel ?? artifact.displayName;

    const isMajor =
      visualTier === "core" ||
      visualTier === "planet" ||
      onPath ||
      depth <= 2;
    let visible = true;
    if (largeGraph) {
      visible =
        visualTier === "core" ||
        visualTier === "planet" ||
        onPath ||
        (visualTier === "dust" && shouldSampleDustVisible(artifact.id, true, denseGraph)) ||
        (visualTier === "loose" && depth <= maxDepth);
    } else if (denseGraph && visualTier === "dust") {
      visible = shouldSampleDustVisible(artifact.id, false, true) || onPath;
    }

    void isMajor;

    return {
      id: artifact.id,
      artifact,
      basePosition,
      position: { ...basePosition },
      size,
      color: palette.color,
      glow: palette.glow,
      hitSize: Math.max(22, size * 1.35),
      isCore,
      isParent,
      visible,
      depth,
      identityLabel,
      showLabel: false,
      label,
      visualTier,
      ringCount,
      haloOpacity,
      bodyOpacity,
      motion,
    };
  });

  const labelIds = pickStaticLabelIds(nodes, heroId, partOfChildren);
  for (const node of nodes) {
    node.showLabel = labelIds.has(node.id);
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const layoutChosen = edgesForGravityTrails({
    layoutEdges: gravityScene.layoutEdges,
    focusArtifactId: trailFocusId,
    mode: gravityScene.mode,
    anchorArtifactId: heroId,
    looseArtifactIds: gravityScene.looseArtifactIds,
  });

  const trails: GravityWellTrail[] = layoutChosen
    .filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to))
    .map((edge) => {
      const focused = Boolean(
        trailFocusId && (edge.from === trailFocusId || edge.to === trailFocusId),
      );
      const baseOpacity =
        edge.kind === "part_of"
          ? 0.44
          : edge.kind === "version"
            ? 0.16
            : edge.kind === "gravity_pull"
              ? 0.12
              : 0.08;
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        kind: edge.kind,
        color: trailColor(edge.kind, appearance),
        opacity: focused ? Math.min(0.5, baseOpacity * 2.2) : baseOpacity,
      };
    });

  return { nodes, trails, nodeById, heroId, mode: gravityScene.mode };
}

export function pickStaticLabelIds(
  nodes: GravityWellNode[],
  heroId: string | null,
  partOfChildren: Map<string, number>,
): Set<string> {
  const chosen = new Set<string>();
  if (heroId) chosen.add(heroId);

  const candidates = nodes
    .filter(
      (node) =>
        node.visible &&
        node.id !== heroId &&
        (node.visualTier === "planet" || node.visualTier === "core") &&
        node.depth <= 2,
    )
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return (partOfChildren.get(b.id) ?? 0) - (partOfChildren.get(a.id) ?? 0);
    });

  for (const node of candidates) {
    if (chosen.size >= MAX_STATIC_LABELS) break;
    chosen.add(node.id);
  }

  return chosen;
}

function buildNodePosition(
  artifactId: string,
  gravityScene: GravityScene,
  heroId: string | null,
  maxDepth: number,
): Vec3 {
  if (artifactId === heroId) {
    const well = gravityBarrierPoint(0, 0);
    return { x: 0, y: well.y + 14, z: 0 };
  }

  const depth = gravityScene.depthByArtifactId.get(artifactId) ?? maxDepth + 1;
  const sector = gravityScene.sectorByArtifactId.get(artifactId) ?? 0;
  const lane = gravityScene.versionLaneByArtifactId.get(artifactId) ?? 0;
  const radius = R_MIN + depth * R_STEP;
  const theta = sector + lane * LANE_SPREAD;
  const x = Math.cos(theta) * radius;
  const z = Math.sin(theta) * radius;
  const surface = gravityBarrierPoint(x, z);
  const lift = depth <= 1 ? 12 : depth <= 3 ? 9 : 6;
  return { x, y: surface.y + lift, z: surface.z };
}

function nodePalette(
  appearance: GraphAppearanceSettings | undefined,
  depth: number,
  isCore: boolean,
  isLoose: boolean,
): { color: string; glow: string } {
  if (!appearance) {
    return isCore
      ? CORE_PALETTE
      : DEPTH_PALETTE[Math.min(Math.max(depth, 0), DEPTH_PALETTE.length - 1)]!;
  }
  if (isLoose) {
    const loose = appearance.nodeSpecial.loose ?? "#64748B";
    return { color: loose, glow: loose };
  }
  const level = String(Math.min(Math.max(depth, 0), 4));
  const color =
    appearance.nodeLevels[level] ??
    appearance.nodeLevels["4"] ??
    CORE_PALETTE.color;
  if (isCore) {
    const coreColor = appearance.nodeLevels["0"] ?? color;
    return { color: coreColor, glow: coreColor };
  }
  return { color, glow: color };
}

function trailColor(kind: string, appearance?: GraphAppearanceSettings): string {
  if (appearance) return appearance.edges[edgeKindKey(kind)];
  if (kind === "part_of") return "#8ed4ff";
  if (kind === "version") return "#a8c8e8";
  if (kind === "gravity_pull") return "#7ec8e8";
  if (kind === "uses") return "#88c8d8";
  if (kind === "derived_from" || kind === "references") return "#98b0c0";
  return "#a8b8c8";
}

export function hashId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function surfaceLiftDelta(position: Vec3): number {
  const surface = gravityBarrierPoint(position.x, position.z / 0.72);
  return Math.abs(position.y - surface.y);
}
