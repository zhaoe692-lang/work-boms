import { describe, expect, it } from "vitest";
import {
  buildPlanetMotion,
  orbitPositionAt,
  planetSizeForTier,
  resolveVisualTier,
} from "./gravityWellPlanet";

describe("resolveVisualTier", () => {
  it("classifies anchor, planet, dust, and loose", () => {
    expect(resolveVisualTier({ isCore: true, isLoose: false, isParent: true, depth: 0 })).toBe(
      "core",
    );
    expect(resolveVisualTier({ isCore: false, isLoose: false, isParent: true, depth: 1 })).toBe(
      "planet",
    );
    expect(resolveVisualTier({ isCore: false, isLoose: false, isParent: true, depth: 4 })).toBe(
      "planet",
    );
    expect(resolveVisualTier({ isCore: false, isLoose: true, isParent: false, depth: 2 })).toBe(
      "loose",
    );
  });
});

describe("planet motion", () => {
  it("keeps anchor at the well center without orbital drift", () => {
    const motion = buildPlanetMotion("hero", { x: 0, y: -300, z: 0 }, "core", 36);
    expect(motion.orbitOmega).toBe(0);
    const pos = orbitPositionAt({ x: 0, y: -300, z: 0 }, motion, 120);
    expect(pos.x).toBe(0);
    expect(pos.z).toBe(0);
  });

  it("moves outer nodes slower than inner nodes", () => {
    const inner = buildPlanetMotion("a", { x: 120, y: 0, z: 0 }, "planet", 14);
    const outer = buildPlanetMotion("b", { x: 400, y: 0, z: 0 }, "planet", 14);
    expect(outer.orbitOmega).toBeLessThan(inner.orbitOmega);
  });

  it("scales sizes by tier", () => {
    expect(planetSizeForTier("core", 0)).toBeGreaterThan(planetSizeForTier("planet", 1));
    expect(planetSizeForTier("planet", 1)).toBeGreaterThan(planetSizeForTier("dust", 1));
  });
});
