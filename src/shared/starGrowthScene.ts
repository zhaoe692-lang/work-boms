import type { DisplayEdge } from "./graph";
import type { ArtifactView, Identity } from "./types";

export interface StarGrowthScene {
  heroId: string | null;
  finalIds: Set<string>;
  trunkIds: string[];
  stageById: Map<string, number>;
  branchGroupById: Map<string, number>;
  versionCountById: Map<string, number>;
  degreeById: Map<string, number>;
  complexityScoreById: Map<string, number>;
  influenceScoreById: Map<string, number>;
  revealRankById: Map<string, number>;
}

export function buildStarGrowthScene(input: {
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  identities: Identity[];
  centerId?: string | null;
}): StarGrowthScene {
  const { artifacts, edges, identities, centerId = null } = input;

  const finalIds = new Set(artifacts.filter((artifact) => artifact.status === "final").map((artifact) => artifact.id));

  const degreeById = new Map<string, number>();
  const outgoingById = new Map<string, string[]>();
  const incomingById = new Map<string, string[]>();
  for (const artifact of artifacts) {
    degreeById.set(artifact.id, 0);
    outgoingById.set(artifact.id, []);
    incomingById.set(artifact.id, []);
  }
  for (const edge of edges) {
    degreeById.set(edge.from, (degreeById.get(edge.from) ?? 0) + 1);
    degreeById.set(edge.to, (degreeById.get(edge.to) ?? 0) + 1);
    outgoingById.set(edge.from, [...(outgoingById.get(edge.from) ?? []), edge.to]);
    incomingById.set(edge.to, [...(incomingById.get(edge.to) ?? []), edge.from]);
  }

  const versionCountById = new Map<string, number>();
  for (const artifact of artifacts) versionCountById.set(artifact.id, 1);
  for (const identity of identities) {
    const count = Math.max(1, identity.versionIds.length);
    for (const artifactId of identity.versionIds) {
      versionCountById.set(artifactId, count);
    }
  }

  const complexityScoreById = new Map<string, number>();
  const influenceScoreById = new Map<string, number>();
  for (const artifact of artifacts) {
    const summaryWeight = artifact.summary?.length ? Math.min(4, Math.ceil(artifact.summary.length / 120)) : 0;
    const tagWeight = Math.min(3, artifact.tags?.length ?? 0);
    const versionWeight = Math.max(0, (versionCountById.get(artifact.id) ?? 1) - 1);
    const degreeWeight = degreeById.get(artifact.id) ?? 0;
    complexityScoreById.set(artifact.id, 1 + degreeWeight * 0.6 + versionWeight * 0.9 + summaryWeight + tagWeight * 0.5);
    influenceScoreById.set(
      artifact.id,
      degreeWeight * 1.2 + (outgoingById.get(artifact.id)?.length ?? 0) * 0.8 + versionWeight * 0.4,
    );
  }

  const heroId = chooseHeroId({
    artifacts,
    centerId,
    finalIds,
    influenceScoreById,
    complexityScoreById,
  });

  const revealRankById = buildRevealRankById(artifacts, outgoingById, incomingById, heroId);
  const stageById = buildStageById(artifacts, revealRankById);
  const trunkIds = buildTrunkIds(artifacts, heroId, stageById, influenceScoreById, revealRankById);
  const branchGroupById = buildBranchGroups(artifacts, heroId, trunkIds, stageById, complexityScoreById);

  return {
    heroId,
    finalIds,
    trunkIds,
    stageById,
    branchGroupById,
    versionCountById,
    degreeById,
    complexityScoreById,
    influenceScoreById,
    revealRankById,
  };
}

function chooseHeroId(input: {
  artifacts: ArtifactView[];
  centerId: string | null;
  finalIds: Set<string>;
  influenceScoreById: Map<string, number>;
  complexityScoreById: Map<string, number>;
}): string | null {
  const { artifacts, centerId, finalIds, influenceScoreById, complexityScoreById } = input;
  const candidates =
    artifacts.filter((artifact) => finalIds.has(artifact.id)).length > 0
      ? artifacts.filter((artifact) => finalIds.has(artifact.id))
      : centerId
        ? artifacts.filter((artifact) => artifact.id === centerId)
        : artifacts;

  if (!candidates.length) return null;

  const sorted = [...candidates].sort((a, b) => {
    const scoreA = (influenceScoreById.get(a.id) ?? 0) + (complexityScoreById.get(a.id) ?? 0);
    const scoreB = (influenceScoreById.get(b.id) ?? 0) + (complexityScoreById.get(b.id) ?? 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.displayName.localeCompare(b.displayName);
  });
  return sorted[0]?.id ?? null;
}

function buildStageById(
  artifacts: ArtifactView[],
  revealRankById: Map<string, number>,
): Map<string, number> {
  const stageById = new Map<string, number>();
  const maxRank = Math.max(1, ...revealRankById.values());
  const stageCount = Math.max(4, Math.min(7, maxRank + 1));
  for (const artifact of artifacts) {
    const rank = revealRankById.get(artifact.id) ?? maxRank;
    const stage = Math.max(0, Math.min(stageCount - 1, Math.round((rank / maxRank) * (stageCount - 1))));
    stageById.set(artifact.id, stage);
  }
  return stageById;
}

function buildTrunkIds(
  artifacts: ArtifactView[],
  heroId: string | null,
  stageById: Map<string, number>,
  influenceScoreById: Map<string, number>,
  revealRankById: Map<string, number>,
): string[] {
  if (!artifacts.length) return [];
  const maxStage = Math.max(0, ...stageById.values());
  const trunkIds: string[] = [];
  for (let stage = maxStage; stage >= 0; stage -= 1) {
    const candidates = artifacts.filter((artifact) => {
      if (artifact.id === heroId) return false;
      return stageById.get(artifact.id) === stage;
    });
    if (!candidates.length) continue;
    const chosen = [...candidates].sort((a, b) => {
      const influenceDiff = (influenceScoreById.get(b.id) ?? 0) - (influenceScoreById.get(a.id) ?? 0);
      if (influenceDiff !== 0) return influenceDiff;
      return (revealRankById.get(a.id) ?? 0) - (revealRankById.get(b.id) ?? 0);
    })[0];
    if (chosen) trunkIds.push(chosen.id);
  }
  if (heroId) trunkIds.push(heroId);
  return trunkIds;
}

function buildBranchGroups(
  artifacts: ArtifactView[],
  heroId: string | null,
  trunkIds: string[],
  stageById: Map<string, number>,
  complexityScoreById: Map<string, number>,
): Map<string, number> {
  const branchGroupById = new Map<string, number>();
  const trunkSet = new Set(trunkIds);
  const ids = artifacts.map((artifact) => artifact.id);
  const maxStage = Math.max(0, ...stageById.values());
  for (const id of ids) {
    if (id === heroId || trunkSet.has(id)) {
      branchGroupById.set(id, -1);
      continue;
    }
    const stage = stageById.get(id) ?? maxStage;
    const complexity = complexityScoreById.get(id) ?? 0;
    const seed = hashId(`${id}:${stage}:${Math.round(complexity * 10)}`);
    branchGroupById.set(id, (seed % 6) + stage * 10);
  }
  return branchGroupById;
}

function buildRevealRankById(
  artifacts: ArtifactView[],
  outgoingById: Map<string, string[]>,
  incomingById: Map<string, string[]>,
  heroId: string | null,
): Map<string, number> {
  const rankById = new Map<string, number>();
  if (!artifacts.length) return rankById;

  const seeds = heroId ? [heroId] : [artifacts[0].id];
  const queue = [...seeds];
  for (const seed of seeds) rankById.set(seed, 0);

  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    const baseRank = rankById.get(id) ?? 0;
    const neighbors = [...(outgoingById.get(id) ?? []), ...(incomingById.get(id) ?? [])];
    for (const next of neighbors) {
      if (rankById.has(next)) continue;
      rankById.set(next, baseRank + 1);
      queue.push(next);
    }
  }

  let fallbackRank = Math.max(0, ...rankById.values());
  for (const artifact of artifacts) {
    if (rankById.has(artifact.id)) continue;
    fallbackRank += 1;
    rankById.set(artifact.id, fallbackRank);
  }
  return rankById;
}

function hashId(id: string): number {
  let h = 0;
  for (let index = 0; index < id.length; index += 1) {
    h = (h * 31 + id.charCodeAt(index)) | 0;
  }
  return Math.abs(h);
}
