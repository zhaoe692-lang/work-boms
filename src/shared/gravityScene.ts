/**
 * GravityScene — BOM / Identity semantics for the gravity-well graph.
 * See doc/gravity-scene-prd.zh-CN.md
 */
import {
  buildPartOfForest,
  indexIdentities,
  looseArtifactIds,
  resolveHeadArtifactId,
  type BomNode,
} from "./bom";
import type { ArtifactView, Identity, Relation } from "./types";

export type GravitySceneMode = "bom" | "loose";

export type LayoutEdge = {
  id: string;
  from: string;
  to: string;
  kind: string;
  label?: string;
  priority: number;
  defaultVisible: boolean;
};

export type AnchorCandidate = {
  nodeId: string;
  artifactId: string;
  displayName: string;
  subtreeSize: number;
};

export type GravityScene = {
  mode: GravitySceneMode;
  anchorArtifactId: string | null;
  anchorNodeId: string | null;
  depthByArtifactId: Map<string, number>;
  sectorByArtifactId: Map<string, number>;
  versionLaneByArtifactId: Map<string, number>;
  identityIdByArtifactId: Map<string, string>;
  identityLabelByArtifactId: Map<string, string>;
  looseArtifactIds: string[];
  layoutEdges: LayoutEdge[];
  anchorCandidates: AnchorCandidate[];
  /** Artifacts on the BOM path to the anchor (for large-graph visibility). */
  onAnchorPath: Set<string>;
};

const WEAK_RELATION_KINDS = new Set(["references", "derived_from", "uses", "pairs_with"]);

export function buildGravityScene(input: {
  artifacts: ArtifactView[];
  relations: Relation[];
  identities: Identity[];
  centerId?: string | null;
}): GravityScene {
  const { artifacts, relations, identities, centerId = null } = input;
  const artifactIds = new Set(artifacts.map((a) => a.id));
  const identityById = indexIdentities(identities);
  const partOfEdges = relations.filter((r) => r.kind === "part_of");

  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  const bomNodeIds = new Set<string>();

  for (const edge of partOfEdges) {
    bomNodeIds.add(edge.from);
    bomNodeIds.add(edge.to);
    childrenOf.set(edge.to, [...(childrenOf.get(edge.to) ?? []), edge.from]);
    parentsOf.set(edge.from, [...(parentsOf.get(edge.from) ?? []), edge.to]);
  }

  const forest = buildPartOfForest(identities, relations);
  const anchorCandidates = forest.map((root) => ({
    nodeId: root.id,
    artifactId: root.artifactId,
    displayName: root.identity?.displayName ?? root.artifactId,
    subtreeSize: countSubtree(root),
  }));

  const loose = looseArtifactIds(artifacts, identities, relations);
  const mode: GravitySceneMode = partOfEdges.length > 0 ? "bom" : "loose";

  const depthByNodeId = new Map<string, number>();
  const sectorByNodeId = new Map<string, number>();
  const { anchorNodeId, anchorArtifactId } = pickAnchor({
    artifacts,
    anchorCandidates,
    centerId,
    identityById,
    childrenOf,
    artifactIds,
    mode,
  });

  if (anchorNodeId != null) {
    depthByNodeId.set(anchorNodeId, 0);
    assignDepthsFromAnchor(anchorNodeId, childrenOf, depthByNodeId);
    assignSectors(anchorNodeId, childrenOf, sectorByNodeId, 0, Math.PI * 2);
  }

  const depthByArtifactId = projectDepthToArtifacts(depthByNodeId, identityById, artifactIds, identities);
  const sectorByArtifactId = projectSectorToArtifacts(
    sectorByNodeId,
    depthByArtifactId,
    identityById,
    artifactIds,
    identities,
    loose,
    anchorArtifactId,
  );
  const { versionLaneByArtifactId, identityIdByArtifactId, identityLabelByArtifactId } =
    assignVersionLanes(identities, depthByArtifactId);

  const onAnchorPath = buildAnchorPath(anchorNodeId, anchorArtifactId, parentsOf, identityById, artifactIds);

  if (mode === "loose") {
  applyLooseLayout({
    artifacts,
    loose,
    anchorArtifactId,
    depthByArtifactId,
    sectorByArtifactId,
    centerId,
  });
  }

  const layoutEdges = buildLayoutEdges(relations, identities, artifactIds, identityById);

  return {
    mode,
    anchorArtifactId,
    anchorNodeId,
    depthByArtifactId,
    sectorByArtifactId,
    versionLaneByArtifactId,
    identityIdByArtifactId,
    identityLabelByArtifactId,
    looseArtifactIds: loose,
    layoutEdges,
    anchorCandidates,
    onAnchorPath,
  };
}

function pickAnchor(input: {
  artifacts: ArtifactView[];
  anchorCandidates: AnchorCandidate[];
  centerId: string | null;
  identityById: Map<string, Identity>;
  childrenOf: Map<string, string[]>;
  artifactIds: Set<string>;
  mode: GravitySceneMode;
}): { anchorNodeId: string | null; anchorArtifactId: string | null } {
  const {
    artifacts,
    anchorCandidates,
    centerId,
    identityById,
    childrenOf,
    artifactIds,
    mode,
  } = input;

  if (mode === "bom" && anchorCandidates.length > 0) {
    if (centerId && artifactIds.has(centerId)) {
      const rootForCenter = anchorCandidates.find((candidate) =>
        subtreeContainsArtifact(candidate.nodeId, centerId, childrenOf, identityById),
      );
      if (rootForCenter) {
        return {
          anchorNodeId: rootForCenter.nodeId,
          anchorArtifactId: resolveAnchorArtifact(
            rootForCenter.nodeId,
            childrenOf,
            identityById,
            artifactIds,
            rootForCenter.artifactId,
          ),
        };
      }
    }
    if (anchorCandidates.length === 1) {
      const only = anchorCandidates[0]!;
      return {
        anchorNodeId: only.nodeId,
        anchorArtifactId: resolveAnchorArtifact(
          only.nodeId,
          childrenOf,
          identityById,
          artifactIds,
          only.artifactId,
        ),
      };
    }
    const sorted = [...anchorCandidates].sort((a, b) => {
      const aFinal = isFinalHead(a.artifactId, artifacts) ? 1 : 0;
      const bFinal = isFinalHead(b.artifactId, artifacts) ? 1 : 0;
      if (bFinal !== aFinal) return bFinal - aFinal;
      return b.subtreeSize - a.subtreeSize;
    });
    const chosen = sorted[0]!;
    return {
      anchorNodeId: chosen.nodeId,
      anchorArtifactId: resolveAnchorArtifact(
        chosen.nodeId,
        childrenOf,
        identityById,
        artifactIds,
        chosen.artifactId,
      ),
    };
  }

  const finals = artifacts.filter((a) => a.status === "final");
  if (centerId && artifactIds.has(centerId)) {
    return { anchorNodeId: centerId, anchorArtifactId: centerId };
  }
  if (finals.length === 1) {
    return { anchorNodeId: finals[0]!.id, anchorArtifactId: finals[0]!.id };
  }
  if (finals.length > 1) {
    const chosen = [...finals].sort((a, b) => a.displayName.localeCompare(b.displayName))[0]!;
    return { anchorNodeId: chosen.id, anchorArtifactId: chosen.id };
  }
  const fallback = artifacts[0];
  return fallback
    ? { anchorNodeId: fallback.id, anchorArtifactId: fallback.id }
    : { anchorNodeId: null, anchorArtifactId: null };
}

function assignDepthsFromAnchor(
  anchorNodeId: string,
  childrenOf: Map<string, string[]>,
  depthByNodeId: Map<string, number>,
) {
  const queue = [anchorNodeId];
  for (let i = 0; i < queue.length; i += 1) {
    const parentId = queue[i]!;
    const parentDepth = depthByNodeId.get(parentId) ?? 0;
    const children = [...(childrenOf.get(parentId) ?? [])].sort();
    for (const childId of children) {
      const nextDepth = parentDepth + 1;
      const prev = depthByNodeId.get(childId);
      if (prev === undefined || nextDepth < prev) {
        depthByNodeId.set(childId, nextDepth);
        queue.push(childId);
      }
    }
  }
}

function assignSectors(
  nodeId: string,
  childrenOf: Map<string, string[]>,
  sectorByNodeId: Map<string, number>,
  center: number,
  span: number,
) {
  sectorByNodeId.set(nodeId, center);
  const children = [...(childrenOf.get(nodeId) ?? [])].sort();
  if (!children.length) return;
  const step = span / children.length;
  children.forEach((childId, index) => {
    const childCenter = center - span / 2 + step * (index + 0.5);
    assignSectors(childId, childrenOf, sectorByNodeId, childCenter, step * 0.92);
  });
}

function projectDepthToArtifacts(
  depthByNodeId: Map<string, number>,
  identityById: Map<string, Identity>,
  artifactIds: Set<string>,
  identities: Identity[],
): Map<string, number> {
  const depthByArtifactId = new Map<string, number>();

  for (const [nodeId, depth] of depthByNodeId) {
    const artifactId = resolveHeadArtifactId(nodeId, identityById);
    if (!artifactIds.has(artifactId)) continue;
    const prev = depthByArtifactId.get(artifactId);
    if (prev === undefined || depth < prev) depthByArtifactId.set(artifactId, depth);
  }

  for (const identity of identities) {
    const headDepth = depthByArtifactId.get(identity.headVersionId);
    if (headDepth === undefined) continue;
    for (const versionId of identity.versionIds) {
      if (!artifactIds.has(versionId)) continue;
      const prev = depthByArtifactId.get(versionId);
      if (prev === undefined || headDepth < prev) depthByArtifactId.set(versionId, headDepth);
    }
    const identityDepth = depthByNodeId.get(identity.id);
    if (identityDepth !== undefined && artifactIds.has(identity.headVersionId)) {
      const prev = depthByArtifactId.get(identity.headVersionId);
      if (prev === undefined || identityDepth < prev) {
        depthByArtifactId.set(identity.headVersionId, identityDepth);
      }
    }
  }

  for (const artifactId of artifactIds) {
    if (!depthByArtifactId.has(artifactId)) {
      const depth = depthByNodeId.get(artifactId);
      if (depth !== undefined) depthByArtifactId.set(artifactId, depth);
    }
  }

  return depthByArtifactId;
}

function projectSectorToArtifacts(
  sectorByNodeId: Map<string, number>,
  _depthByArtifactId: Map<string, number>,
  identityById: Map<string, Identity>,
  artifactIds: Set<string>,
  identities: Identity[],
  loose: string[],
  anchorArtifactId: string | null,
): Map<string, number> {
  const sectorByArtifactId = new Map<string, number>();

  for (const [nodeId, sector] of sectorByNodeId) {
    const artifactId = resolveHeadArtifactId(nodeId, identityById);
    if (!artifactIds.has(artifactId)) continue;
    if (!sectorByArtifactId.has(artifactId)) sectorByArtifactId.set(artifactId, sector);
  }

  for (const identity of identities) {
    const headSector = sectorByArtifactId.get(identity.headVersionId) ?? sectorByNodeId.get(identity.id);
    if (headSector === undefined) continue;
    for (const versionId of identity.versionIds) {
      if (artifactIds.has(versionId)) sectorByArtifactId.set(versionId, headSector);
    }
  }

  for (const artifactId of artifactIds) {
    if (sectorByArtifactId.has(artifactId)) continue;
    const nodeSector = sectorByNodeId.get(artifactId);
    if (nodeSector !== undefined) sectorByArtifactId.set(artifactId, nodeSector);
  }

  const looseBandStart = Math.PI * 1.5;
  const looseBandSpan = Math.PI * 0.5;
  loose.forEach((artifactId, index) => {
    if (artifactId === anchorArtifactId) return;
    const t = loose.length <= 1 ? 0.5 : index / (loose.length - 1);
    sectorByArtifactId.set(artifactId, looseBandStart + t * looseBandSpan);
  });

  return sectorByArtifactId;
}

function assignVersionLanes(
  identities: Identity[],
  depthByArtifactId: Map<string, number>,
): {
  versionLaneByArtifactId: Map<string, number>;
  identityIdByArtifactId: Map<string, string>;
  identityLabelByArtifactId: Map<string, string>;
} {
  const versionLaneByArtifactId = new Map<string, number>();
  const identityIdByArtifactId = new Map<string, string>();
  const identityLabelByArtifactId = new Map<string, string>();

  for (const identity of identities) {
    const headIndex = identity.versionIds.indexOf(identity.headVersionId);
    const count = identity.versionIds.length;
    identity.versionIds.forEach((versionId, index) => {
      identityIdByArtifactId.set(versionId, identity.id);
      identityLabelByArtifactId.set(versionId, identity.displayName);
      if (count <= 1) {
        versionLaneByArtifactId.set(versionId, 0);
        return;
      }
      const lane = (index - headIndex) / Math.max(1, count - 1);
      versionLaneByArtifactId.set(versionId, Math.max(-1, Math.min(1, lane)));
      const headDepth = depthByArtifactId.get(identity.headVersionId);
      if (headDepth !== undefined) depthByArtifactId.set(versionId, headDepth);
    });
  }

  return { versionLaneByArtifactId, identityIdByArtifactId, identityLabelByArtifactId };
}

function applyLooseLayout(input: {
  artifacts: ArtifactView[];
  loose: string[];
  anchorArtifactId: string | null;
  depthByArtifactId: Map<string, number>;
  sectorByArtifactId: Map<string, number>;
  centerId: string | null;
}) {
  const { artifacts, loose, anchorArtifactId, depthByArtifactId, centerId } = input;
  if (anchorArtifactId) depthByArtifactId.set(anchorArtifactId, 0);
  const outerDepth = 2;
  for (const artifact of artifacts) {
    if (artifact.id === anchorArtifactId) continue;
    if (!depthByArtifactId.has(artifact.id)) depthByArtifactId.set(artifact.id, outerDepth);
  }
  loose.forEach((id, index) => {
    if (id === anchorArtifactId) return;
    depthByArtifactId.set(id, outerDepth + (index % 2));
  });
  if (centerId && centerId !== anchorArtifactId) {
    depthByArtifactId.set(centerId, 1);
  }
}

function buildLayoutEdges(
  relations: Relation[],
  identities: Identity[],
  artifactIds: Set<string>,
  identityById: Map<string, Identity>,
): LayoutEdge[] {
  const edges: LayoutEdge[] = [];

  for (const rel of relations) {
    const from = resolveHeadArtifactId(rel.from, identityById);
    const to = resolveHeadArtifactId(rel.to, identityById);
    if (from === to || !artifactIds.has(from) || !artifactIds.has(to)) continue;
    const weak = WEAK_RELATION_KINDS.has(rel.kind);
    edges.push({
      id: rel.id,
      from,
      to,
      kind: rel.kind,
      label: rel.label,
      priority: rel.kind === "part_of" ? 0 : weak ? 3 : 2,
      defaultVisible: rel.kind === "part_of" ? true : !weak,
    });
  }

  for (const identity of identities) {
    for (let i = 1; i < identity.versionIds.length; i += 1) {
      const from = identity.versionIds[i - 1]!;
      const to = identity.versionIds[i]!;
      if (!artifactIds.has(from) || !artifactIds.has(to)) continue;
      edges.push({
        id: `version:${identity.id}:${i}`,
        from,
        to,
        kind: "version",
        label: undefined,
        priority: 1,
        defaultVisible: true,
      });
    }
  }

  return edges;
}

function buildAnchorPath(
  anchorNodeId: string | null,
  anchorArtifactId: string | null,
  parentsOf: Map<string, string[]>,
  identityById: Map<string, Identity>,
  artifactIds: Set<string>,
): Set<string> {
  const onPath = new Set<string>();
  if (!anchorArtifactId) return onPath;

  onPath.add(anchorArtifactId);
  const seeds = new Set<string>([anchorNodeId ?? anchorArtifactId]);
  for (const [identityId, identity] of identityById) {
    if (identity.headVersionId === anchorArtifactId) seeds.add(identityId);
  }

  const queue = [...seeds].filter(Boolean) as string[];
  const visited = new Set<string>();

  while (queue.length) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const artifactId = resolveHeadArtifactId(nodeId, identityById);
    if (artifactIds.has(artifactId)) onPath.add(artifactId);

    for (const parentId of parentsOf.get(nodeId) ?? []) {
      queue.push(parentId);
      const parentArtifact = resolveHeadArtifactId(parentId, identityById);
      if (artifactIds.has(parentArtifact)) onPath.add(parentArtifact);
    }
  }

  return onPath;
}

function subtreeContainsArtifact(
  rootNodeId: string,
  artifactId: string,
  childrenOf: Map<string, string[]>,
  identityById: Map<string, Identity>,
): boolean {
  const queue = [rootNodeId];
  const visited = new Set<string>();
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    if (resolveHeadArtifactId(nodeId, identityById) === artifactId) return true;
    for (const child of childrenOf.get(nodeId) ?? []) queue.push(child);
  }
  return false;
}

function countSubtree(root: BomNode): number {
  let count = 1;
  for (const child of root.children) count += countSubtree(child);
  return count;
}

function resolveAnchorArtifact(
  anchorNodeId: string,
  childrenOf: Map<string, string[]>,
  identityById: Map<string, Identity>,
  artifactIds: Set<string>,
  preferredArtifactId: string,
): string | null {
  if (artifactIds.has(preferredArtifactId)) return preferredArtifactId;
  const resolved = resolveHeadArtifactId(anchorNodeId, identityById);
  if (artifactIds.has(resolved)) return resolved;

  const queue = [anchorNodeId];
  const visited = new Set<string>();
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const artifactId = resolveHeadArtifactId(nodeId, identityById);
    if (artifactIds.has(artifactId)) return artifactId;
    for (const childId of childrenOf.get(nodeId) ?? []) queue.push(childId);
  }
  return null;
}

function isFinalHead(artifactId: string, artifacts: ArtifactView[]): boolean {
  return artifacts.some((a) => a.id === artifactId && a.status === "final");
}

/** Edges to highlight when a node is focused (part_of ancestors + descendants). */
export function partOfFocusEdgeIds(
  focusArtifactId: string,
  layoutEdges: LayoutEdge[],
): Set<string> {
  const partEdges = layoutEdges.filter((e) => e.kind === "part_of");
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const edge of partEdges) {
    childrenOf.set(edge.to, [...(childrenOf.get(edge.to) ?? []), edge.from]);
    parentsOf.set(edge.from, [...(parentsOf.get(edge.from) ?? []), edge.to]);
  }

  const related = new Set<string>([focusArtifactId]);
  const up = [focusArtifactId];
  for (let i = 0; i < up.length; i += 1) {
    for (const parent of parentsOf.get(up[i]!) ?? []) {
      if (!related.has(parent)) {
        related.add(parent);
        up.push(parent);
      }
    }
  }
  const down = [focusArtifactId];
  for (let i = 0; i < down.length; i += 1) {
    for (const child of childrenOf.get(down[i]!) ?? []) {
      if (!related.has(child)) {
        related.add(child);
        down.push(child);
      }
    }
  }

  const ids = new Set<string>();
  for (const edge of layoutEdges) {
    if (edge.kind === "part_of" && related.has(edge.from) && related.has(edge.to)) {
      ids.add(edge.id);
    }
    if (
      edge.kind === "version" &&
      (edge.from === focusArtifactId || edge.to === focusArtifactId)
    ) {
      ids.add(edge.id);
    }
  }
  return ids;
}

export function edgesForGravityTrails(input: {
  layoutEdges: LayoutEdge[];
  focusArtifactId: string | null;
  mode: GravitySceneMode;
  anchorArtifactId: string | null;
  looseArtifactIds: string[];
  maxTrails?: number;
}): LayoutEdge[] {
  const {
    layoutEdges,
    focusArtifactId,
    mode,
    anchorArtifactId,
    looseArtifactIds,
    maxTrails = 150,
  } = input;

  const focusIds = focusArtifactId
    ? partOfFocusEdgeIds(focusArtifactId, layoutEdges)
    : new Set<string>();

  const visible = layoutEdges.filter((edge) => {
    if (focusArtifactId) {
      return focusIds.has(edge.id) || (edge.defaultVisible && edge.kind !== "references");
    }
    return edge.defaultVisible;
  });

  const sorted = [...visible].sort((a, b) => a.priority - b.priority);
  const chosen = sorted.slice(0, maxTrails);

  if (mode === "loose" && anchorArtifactId) {
    const pullCap = 48;
    let added = 0;
    for (const artifactId of looseArtifactIds) {
      if (artifactId === anchorArtifactId || added >= pullCap) break;
      chosen.push({
        id: `gravity:pull:${artifactId}`,
        from: artifactId,
        to: anchorArtifactId,
        kind: "gravity_pull",
        priority: 4,
        defaultVisible: true,
      });
      added += 1;
    }
  }

  return chosen.slice(0, maxTrails);
}
