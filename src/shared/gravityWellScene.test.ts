import { describe, expect, it } from "vitest";
import { buildGravityScene } from "./gravityScene";
import { DEFAULT_GRAPH_APPEARANCE } from "./graphAppearance";
import {
  buildGravityWellSceneModel,
  gravityBarrierPoint,
  pickStaticLabelIds,
  surfaceLiftDelta,
} from "./gravityWellScene";
import type { ArtifactView } from "./types";

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

describe("gravityBarrierPoint", () => {
  it("dips lowest at the center", () => {
    const center = gravityBarrierPoint(0, 0);
    const edge = gravityBarrierPoint(500, 0);
    expect(center.y).toBeLessThan(edge.y);
  });
});

describe("buildGravityWellSceneModel", () => {
  const artifacts = [artifact("hero", "final"), artifact("child-a"), artifact("child-b")];
  const gravityScene = buildGravityScene({
    artifacts,
    relations: [
      { id: "e1", from: "child-a", to: "hero", kind: "part_of" },
      { id: "e2", from: "child-b", to: "hero", kind: "part_of" },
    ],
    identities: [],
  });

  const model = buildGravityWellSceneModel({
    artifacts,
    gravityScene,
    appearance: DEFAULT_GRAPH_APPEARANCE,
  });

  it("creates one node per artifact", () => {
    expect(model.nodes).toHaveLength(3);
    expect(model.nodeById.size).toBe(3);
  });

  it("anchors hero near the well bottom", () => {
    const hero = model.nodeById.get("hero");
    expect(hero).toBeDefined();
    expect(Math.hypot(hero!.position.x, hero!.position.z)).toBeLessThan(8);
    expect(surfaceLiftDelta(hero!.position)).toBeLessThan(24);
  });

  it("keeps non-hero nodes close to the barrier surface", () => {
    for (const node of model.nodes.filter((item) => !item.isCore)) {
      expect(surfaceLiftDelta(node.position)).toBeLessThan(28);
    }
  });

  it("prioritizes part_of edges within the trail cap", () => {
    expect(model.trails.some((trail) => trail.kind === "part_of")).toBe(true);
    expect(model.trails.length).toBeLessThanOrEqual(150);
  });

  it("labels parent nodes but not leaves", () => {
    const hero = model.nodeById.get("hero")!;
    const child = model.nodeById.get("child-a")!;
    expect(hero.showLabel).toBe(true);
    expect(child.showLabel).toBe(false);
  });

  it("caps permanent labels to a small set", () => {
    const labeled = model.nodes.filter((node) => node.showLabel);
    expect(labeled.length).toBeLessThanOrEqual(8);
  });

  it("uses planet tier sizes for anchor", () => {
    const hero = model.nodeById.get("hero")!;
    expect(hero.visualTier).toBe("core");
    expect(hero.size).toBeGreaterThanOrEqual(88);
    expect(hero.ringCount).toBe(2);
  });
});

describe("buildGravityWellSceneModel loose mode", () => {
  const artifacts = [artifact("only", "final")];
  const gravityScene = buildGravityScene({
    artifacts,
    relations: [],
    identities: [],
  });

  const model = buildGravityWellSceneModel({
    artifacts,
    gravityScene,
    appearance: DEFAULT_GRAPH_APPEARANCE,
  });

  it("uses loose mode without synthetic pulls when alone", () => {
    expect(gravityScene.mode).toBe("loose");
    expect(model.trails.some((trail) => trail.kind === "gravity_pull")).toBe(false);
  });
});
