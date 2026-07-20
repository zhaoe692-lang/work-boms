import { describe, expect, it } from "vitest";
import { buildGravityScene } from "./gravityScene";
import { DEFAULT_GRAPH_APPEARANCE } from "./graphAppearance";
import { buildGravityWellSceneModel } from "./gravityWellScene";
import type { ArtifactView, Identity, Relation } from "./types";

function artifact(id: string, status: ArtifactView["status"] = "draft"): ArtifactView {
  return {
    id,
    fileRef: { path: `docs/${id}.md`, pathKind: "relative", fileName: `${id}.md` },
    displayName: id,
    kind: "markdown",
    status,
    absolutePath: `/tmp/${id}.md`,
    reachable: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const gameDemoRelations: Relation[] = [
  { id: "r1", from: "grass", to: "tileset-forest", kind: "part_of" },
  { id: "r2", from: "tree", to: "tileset-forest", kind: "part_of" },
  { id: "r9", from: "tileset-forest", to: "level-01", kind: "part_of" },
  { id: "r18", from: "level-01", to: "game-project", kind: "part_of" },
];

const gameDemoIdentities: Identity[] = [
  {
    id: "level-01",
    displayName: "第一关",
    kind: "composite",
    headVersionId: "level-01-def-v2",
    versionIds: ["level-01-def-v1", "level-01-def-v2"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "game-project",
    displayName: "项目整体",
    kind: "composite",
    headVersionId: "project-code-v2",
    versionIds: ["project-code-v1", "project-code-v2"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const gameDemoArtifacts = [
  "grass",
  "tree",
  "tileset-forest",
  "level-01-def-v1",
  "level-01-def-v2",
  "project-code-v1",
  "project-code-v2",
].map((id) => artifact(id, id.includes("v2") || id === "tileset-forest" ? "final" : "draft"));

describe("buildGravityScene game-demo", () => {
  const scene = buildGravityScene({
    artifacts: gameDemoArtifacts,
    relations: gameDemoRelations,
    identities: gameDemoIdentities,
  });

  it("uses the BOM root as anchor", () => {
    expect(scene.mode).toBe("bom");
    expect(scene.anchorNodeId).toBe("game-project");
    expect(scene.anchorArtifactId).toBe("project-code-v2");
  });

  it("orders depth along part_of from root outward", () => {
    const grass = scene.depthByArtifactId.get("grass");
    const tileset = scene.depthByArtifactId.get("tileset-forest");
    const level = scene.depthByArtifactId.get("level-01-def-v2");
    const project = scene.depthByArtifactId.get("project-code-v2");
    expect(project).toBe(0);
    expect(level).toBeGreaterThan(project!);
    expect(tileset).toBeGreaterThan(level!);
    expect(grass).toBeGreaterThan(tileset!);
  });

  it("keeps version artifacts on the same depth with lanes", () => {
    expect(scene.depthByArtifactId.get("level-01-def-v1")).toBe(
      scene.depthByArtifactId.get("level-01-def-v2"),
    );
    expect(scene.versionLaneByArtifactId.get("level-01-def-v2")).toBe(0);
    expect(scene.versionLaneByArtifactId.get("level-01-def-v1")).not.toBe(0);
  });

  it("exposes part_of layout edges for grass twice when reused", () => {
    const grassEdges = scene.layoutEdges.filter(
      (edge) => edge.kind === "part_of" && edge.from === "grass",
    );
    expect(grassEdges.length).toBeGreaterThanOrEqual(1);
  });
});

describe("buildGravityScene nightbell", () => {
  const relations: Relation[] = [
    { id: "r3", from: "series-bible", to: "episode-01", kind: "part_of" },
    { id: "r4", from: "episode-script", to: "episode-01", kind: "part_of" },
    { id: "r1", from: "episode-script", to: "series-bible", kind: "derived_from" },
  ];
  const identities: Identity[] = [
    {
      id: "series-bible",
      displayName: "系列设定",
      kind: "markdown",
      headVersionId: "series-bible",
      versionIds: ["series-bible-v1", "series-bible"],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "episode-01",
      displayName: "第一集",
      kind: "composite",
      headVersionId: "episode-01-def",
      versionIds: ["episode-01-def"],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];
  const artifacts = [
    artifact("series-bible-v1"),
    artifact("series-bible", "final"),
    artifact("episode-script"),
    artifact("episode-01-def", "final"),
  ];

  const scene = buildGravityScene({ artifacts, relations, identities });

  it("stays in BOM mode with episode root", () => {
    expect(scene.mode).toBe("bom");
    expect(scene.anchorArtifactId).toBe("episode-01-def");
    expect(scene.depthByArtifactId.get("series-bible")!).toBeGreaterThan(
      scene.depthByArtifactId.get("episode-01-def")!,
    );
  });
});

describe("buildGravityWellSceneModel with GravityScene", () => {
  it("places deeper BOM nodes farther from the well center", () => {
    const gravityScene = buildGravityScene({
      artifacts: gameDemoArtifacts,
      relations: gameDemoRelations,
      identities: gameDemoIdentities,
    });
    const model = buildGravityWellSceneModel({
      artifacts: gameDemoArtifacts,
      gravityScene,
      appearance: DEFAULT_GRAPH_APPEARANCE,
    });
    const grass = model.nodeById.get("grass")!;
    const project = model.nodeById.get("project-code-v2")!;
    expect(Math.hypot(grass.position.x, grass.position.z)).toBeGreaterThan(
      Math.hypot(project.position.x, project.position.z),
    );
    expect(model.trails.some((trail) => trail.kind === "part_of")).toBe(true);
    expect(model.trails.some((trail) => trail.kind === "gravity_pull")).toBe(false);
  });
});
