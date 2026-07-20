/**
 * BOM (part_of composition) + Identity resolution helpers.
 * Pure functions over already-loaded PackageDetail data — no I/O here.
 * See doc/data-model-v0.2.zh-CN.md §1-2.
 */
import type { ArtifactView, Identity, Relation } from "./types";

export function indexIdentities(identities: Identity[]): Map<string, Identity> {
  return new Map(identities.map((i) => [i.id, i]));
}

/**
 * Resolve any id (Artifact id or Identity id) to the Artifact id it should
 * currently display. Identity ids resolve to `headVersionId`; anything else
 * is assumed to already be a real Artifact id and is returned unchanged.
 */
export function resolveHeadArtifactId(
  id: string,
  identityById: Map<string, Identity>,
): string {
  return identityById.get(id)?.headVersionId ?? id;
}

export interface BomNode {
  /** Stable key for React lists — the raw id as it appears in part_of edges
   * (an Identity id or an Artifact id), never ambiguous within one tree. */
  id: string;
  /** Resolved Artifact id this node displays right now (always a real file). */
  artifactId: string;
  /** Present when this node has version history. */
  identity?: Identity;
  children: BomNode[];
}

/**
 * Build the part_of forest: roots are nodes that are never the `from` side
 * of a part_of edge (i.e. nothing "contains" them further up), children are
 * everything that is `part_of` a given node.
 */
export function buildPartOfForest(
  identities: Identity[],
  relations: Relation[],
): BomNode[] {
  const identityById = indexIdentities(identities);
  const partOfEdges = relations.filter((r) => r.kind === "part_of");

  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  const allNodeIds = new Set<string>();

  for (const edge of partOfEdges) {
    childrenOf.set(edge.to, [...(childrenOf.get(edge.to) ?? []), edge.from]);
    hasParent.add(edge.from);
    allNodeIds.add(edge.from);
    allNodeIds.add(edge.to);
  }

  function buildNode(id: string, ancestors: ReadonlySet<string>): BomNode {
    const identity = identityById.get(id);
    const artifactId = resolveHeadArtifactId(id, identityById);
    if (ancestors.has(id)) {
      // Defensive only: backend already rejects cycles on import.
      return { id, artifactId, identity, children: [] };
    }
    const nextAncestors = new Set(ancestors).add(id);
    const childIds = childrenOf.get(id) ?? [];
    return {
      id,
      artifactId,
      identity,
      children: childIds.map((childId) => buildNode(childId, nextAncestors)),
    };
  }

  const rootIds = [...allNodeIds].filter((id) => !hasParent.has(id));
  return rootIds.map((id) => buildNode(id, new Set()));
}

/**
 * Artifacts that appear nowhere in the part_of graph and are not a
 * non-head version of some Identity — i.e. items with no BOM/version
 * context. UI should still show these (flat fallback), nothing is hidden.
 */
export function looseArtifactIds(
  artifacts: ArtifactView[],
  identities: Identity[],
  relations: Relation[],
): string[] {
  const partOfEdges = relations.filter((r) => r.kind === "part_of");
  const covered = new Set<string>();
  for (const edge of partOfEdges) {
    covered.add(edge.from);
    covered.add(edge.to);
  }
  const identityVersionIds = new Set(identities.flatMap((i) => i.versionIds));

  return artifacts
    .map((a) => a.id)
    .filter((id) => !covered.has(id) && !identityVersionIds.has(id));
}

/** All non-head versions of every Identity, oldest → newest, excluding head. */
export function historyVersions(identity: Identity): string[] {
  return identity.versionIds.filter((id) => id !== identity.headVersionId);
}
