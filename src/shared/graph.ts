/**
 * Resolves raw relations + Identity version chains into a graph that's safe
 * to render — every edge endpoint is guaranteed to be a real Artifact id.
 *
 * Two problems this fixes vs. rendering `relations` directly:
 * 1. `part_of` edges may point at an Identity id (e.g. "heroine-rig"), which
 *    is not an Artifact and has no position on screen — those edges were
 *    silently dropped, leaving every non-head version artifact as an
 *    isolated dot.
 * 2. Version history (`Identity.versionIds`) was never expressed as an edge
 *    at all, so v1 → v2 → v3 chains had no visual connection.
 */
import { indexIdentities, resolveHeadArtifactId } from "./bom";
import type { ArtifactView, Identity, Relation } from "./types";

export interface DisplayEdge {
  id: string;
  from: string;
  to: string;
  /** RelationKind, or "version" for a synthetic Identity lineage edge. */
  kind: string;
  label?: string;
  inferred?: boolean;
}

export function buildDisplayEdges(
  artifacts: ArtifactView[],
  relations: Relation[],
  identities: Identity[],
): DisplayEdge[] {
  const identityById = indexIdentities(identities);
  const artifactIds = new Set(artifacts.map((a) => a.id));
  const resolve = (id: string) => resolveHeadArtifactId(id, identityById);

  const edges: DisplayEdge[] = [];

  for (const rel of relations) {
    const from = resolve(rel.from);
    const to = resolve(rel.to);
    if (from === to) continue;
    if (!artifactIds.has(from) || !artifactIds.has(to)) continue;
    edges.push({
      id: rel.id,
      from,
      to,
      kind: rel.kind,
      label: rel.label,
      inferred: rel.inferred,
    });
  }

  for (const identity of identities) {
    for (let i = 1; i < identity.versionIds.length; i += 1) {
      const from = identity.versionIds[i - 1];
      const to = identity.versionIds[i];
      if (!artifactIds.has(from) || !artifactIds.has(to)) continue;
      edges.push({
        id: `version:${identity.id}:${i}`,
        from,
        to,
        kind: "version",
        label: undefined,
      });
    }
  }

  return edges;
}
