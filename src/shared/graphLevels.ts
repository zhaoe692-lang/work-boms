import type { ArtifactView, Relation } from "./types";

/** BOM depth from part_of roots (0 = top assembly, larger = deeper leaf). */
export function bomDepthByArtifactId(
  artifacts: ArtifactView[],
  relations: Relation[],
): Map<string, number> {
  const partOf = relations.filter((r) => r.kind === "part_of");
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  const artifactIds = new Set(artifacts.map((a) => a.id));

  for (const edge of partOf) {
    if (!artifactIds.has(edge.from) || !artifactIds.has(edge.to)) continue;
    childrenOf.set(edge.to, [...(childrenOf.get(edge.to) ?? []), edge.from]);
    hasParent.add(edge.from);
  }

  const roots = [...artifactIds].filter((id) => partOf.some((e) => e.to === id) && !hasParent.has(id));
  const depths = new Map<string, number>();

  function walk(parentId: string, depth: number) {
    depths.set(parentId, Math.min(depths.get(parentId) ?? depth, depth));
    for (const childId of childrenOf.get(parentId) ?? []) {
      walk(childId, depth + 1);
    }
  }

  for (const rootId of roots) walk(rootId, 0);

  for (const artifact of artifacts) {
    if (!depths.has(artifact.id)) depths.set(artifact.id, -1);
  }

  return depths;
}

export function graphLevelForArtifact(
  artifactId: string,
  depths: Map<string, number>,
): number {
  const d = depths.get(artifactId);
  if (d === undefined || d < 0) return -1;
  return Math.min(d, 4);
}
