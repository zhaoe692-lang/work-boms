export type PlanetVisualTier = "core" | "planet" | "dust" | "loose";

export type Vec3 = { x: number; y: number; z: number };

export type PlanetMotion = {
  orbitRadius: number;
  orbitPhase0: number;
  orbitOmega: number;
  spinTiltX: number;
  spinTiltZ: number;
  spinOmega: number;
};

const ORBIT_K = 0.00011;
const ORBIT_R0 = 95;
const SPIN_S0 = 0.00135;
const CORE_SIZE = 88;
const PLANET_SIZE_MIN = 30;
const PLANET_SIZE_MAX = 40;
const DUST_SIZE_MIN = 11;
const DUST_SIZE_MAX = 15;
const LOOSE_SIZE = 13;

/** Target on-screen diameter (px @ ~1080p canvas) — applied in renderer. */
export const SCREEN_NODE_PX = {
  core: { body: 56, halo: 148, core: 24 },
  planet: { body: 24, halo: 76, core: 10 },
  dust: { body: 10, halo: 30, core: 4 },
  loose: { body: 12, halo: 36, core: 5 },
} as const;

export function resolveVisualTier(input: {
  isCore: boolean;
  isLoose: boolean;
  isParent: boolean;
  depth: number;
}): PlanetVisualTier {
  if (input.isCore) return "core";
  if (input.isLoose) return "loose";
  if (input.isParent) return "planet";
  return "dust";
}

export function planetSizeForTier(tier: PlanetVisualTier, depthFactor: number): number {
  if (tier === "core") return CORE_SIZE;
  if (tier === "planet") return PLANET_SIZE_MIN + depthFactor * (PLANET_SIZE_MAX - PLANET_SIZE_MIN);
  if (tier === "loose") return LOOSE_SIZE;
  return DUST_SIZE_MIN + depthFactor * (DUST_SIZE_MAX - DUST_SIZE_MIN);
}

export function ringCountForTier(tier: PlanetVisualTier): number {
  if (tier === "core") return 2;
  if (tier === "planet") return 1;
  return 0;
}

export function opacityForTier(tier: PlanetVisualTier): { halo: number; body: number } {
  if (tier === "core") return { halo: 0.78, body: 1 };
  if (tier === "planet") return { halo: 0.48, body: 0.96 };
  if (tier === "loose") return { halo: 0.28, body: 0.78 };
  return { halo: 0.2, body: 0.38 };
}

export function buildPlanetMotion(
  id: string,
  basePosition: Vec3,
  tier: PlanetVisualTier,
  size: number,
): PlanetMotion {
  const orbitRadius = Math.hypot(basePosition.x, basePosition.z);
  const orbitPhase0 = Math.atan2(basePosition.z, basePosition.x);
  const orbitOmega =
    tier === "core" || orbitRadius < 6
      ? 0
      : ORBIT_K / Math.sqrt(orbitRadius + ORBIT_R0);

  const seed = hashId(`spin:${id}`);
  const spinTiltX = ((seed % 1000) / 1000 - 0.5) * 0.26;
  const spinTiltZ = (((seed >> 10) % 1000) / 1000 - 0.5) * 0.26;
  const spinScale = tier === "core" ? 0.42 : 1;
  const spinOmega = (SPIN_S0 * spinScale) / Math.pow(Math.max(size, 4), 0.3);

  return { orbitRadius, orbitPhase0, orbitOmega, spinTiltX, spinTiltZ, spinOmega };
}

export function orbitPositionAt(
  basePosition: Vec3,
  motion: PlanetMotion,
  elapsedSec: number,
): Vec3 {
  if (motion.orbitOmega === 0 || motion.orbitRadius < 6) {
    return { ...basePosition };
  }
  const phase = motion.orbitPhase0 - motion.orbitOmega * elapsedSec;
  return {
    x: Math.cos(phase) * motion.orbitRadius,
    y: basePosition.y,
    z: Math.sin(phase) * motion.orbitRadius,
  };
}

export function shouldSampleDustVisible(id: string, largeGraph: boolean, denseGraph: boolean): boolean {
  if (!largeGraph) return true;
  if (!denseGraph) return hashId(id) % 3 !== 0;
  return hashId(id) % 2 === 0;
}

function hashId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
