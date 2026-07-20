export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ProjectedNode {
  x: number;
  y: number;
  scale: number;
  z: number;
}

const GLOBE_RADIUS = 1;
/** Extra vertical headroom so manual X-tilt can expose north/south poles. */
const TILT_EXTENT = 1.18;

/** Symmetric padding around the projected sphere (matches globeViewBox). */
export function globeViewportPadding(width: number, height: number): {
  padX: number;
  padY: number;
} {
  return {
    padX: Math.max(36, width * 0.04),
    padY: Math.max(56, height * 0.12),
  };
}

/** Projected radius — leave margin for rotation + zoom without clipping poles. */
export function globeProjectScale(width: number, height: number): number {
  const { padX, padY } = globeViewportPadding(width, height);
  const usableW = Math.max(0, width - padX * 2);
  const usableH = Math.max(0, height - padY * 2);
  const fit = Math.min(usableW, usableH) / (2 * TILT_EXTENT);
  return Math.max(80, fit * 0.9);
}

export function globeViewBox(width: number, height: number): string {
  const { padX, padY } = globeViewportPadding(width, height);
  return `${-padX} ${-padY} ${width + padX * 2} ${height + padY * 2}`;
}

export function globeViewBoxRect(width: number, height: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const { padX, padY } = globeViewportPadding(width, height);
  return { x: -padX, y: -padY, width: width + padX * 2, height: height + padY * 2 };
}

export function rotateY(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}

export function rotateX(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function scaleVec(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function crossVec(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Place nodes on a sphere: BOM depth → latitude band, index → longitude. */
export function spherePositionsFromLevels(
  nodeIds: string[],
  depths: Map<string, number>,
  radius = GLOBE_RADIUS,
): Map<string, Vec3> {
  const byLevel = new Map<number, string[]>();
  for (const id of nodeIds) {
    const depth = depths.get(id);
    const level = depth === undefined || depth < 0 ? -1 : depth;
    byLevel.set(level, [...(byLevel.get(level) ?? []), id]);
  }

  const positions = new Map<string, Vec3>();
  const structuralLevels = [...byLevel.keys()].filter((l) => l >= 0).sort((a, b) => a - b);
  const maxLevel = structuralLevels.length ? Math.max(...structuralLevels) : 0;

  for (const [level, ids] of byLevel.entries()) {
    const sorted = [...ids].sort();
    const count = sorted.length;
    const latT =
      level < 0 ? 0.2 : maxLevel > 0 ? level / maxLevel : 0.5;
    const y = 1 - latT * 2;
    const ringR = Math.sqrt(Math.max(0, 1 - y * y));

    sorted.forEach((id, i) => {
      const theta = (i / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
      const nx = Math.cos(theta) * ringR;
      const nz = Math.sin(theta) * ringR;
      positions.set(id, scaleVec(normalize({ x: nx, y, z: nz }), radius));
    });
  }

  return positions;
}

/** Balanced shell distribution for ORB GLOBE: the network itself forms the sphere. */
export function distributedSpherePositions(
  nodeIds: string[],
  radius = GLOBE_RADIUS,
): Map<string, Vec3> {
  const ordered = [...nodeIds].sort((a, b) => hashStable(a) - hashStable(b) || a.localeCompare(b));
  const shell = fibonacciSphere(ordered.length, radius);
  const positions = new Map<string, Vec3>();
  ordered.forEach((id, index) => {
    positions.set(id, shell[index] ?? { x: 0, y: radius, z: 0 });
  });
  return positions;
}

export function fibonacciSphere(count: number, radius = GLOBE_RADIUS): Vec3[] {
  if (count === 0) return [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push(
      scaleVec(normalize({ x: Math.cos(theta) * ring, y, z: Math.sin(theta) * ring }), radius),
    );
  }
  return out;
}

export function projectGlobePoint(
  local: Vec3,
  rotY: number,
  rotX: number,
  width: number,
  height: number,
  fov = 2.8,
  projectScale = globeProjectScale(width, height),
): ProjectedNode {
  const tilted = rotateX(rotateY(local, rotY), rotX);
  const perspective = fov / (fov + tilted.z);
  const centerY = height / 2;
  const px = width / 2 + tilted.x * perspective * projectScale;
  const py = centerY + tilted.y * perspective * projectScale;
  return { x: px, y: py, scale: perspective, z: tilted.z };
}

/** Screen coords → nearest point on unit sphere (view space), then inverse-rotate to local. */
export function screenToLocalSphere(
  sx: number,
  sy: number,
  width: number,
  height: number,
  rotY: number,
  rotX: number,
  radius = GLOBE_RADIUS,
  projectScale = globeProjectScale(width, height),
): Vec3 {
  const centerY = height / 2;
  const nx = (sx - width / 2) / projectScale;
  const ny = (sy - centerY) / projectScale;
  const len2 = nx * nx + ny * ny;
  let z = len2 <= 1 ? Math.sqrt(1 - len2) : 0;
  const view = normalize({ x: nx, y: ny, z });
  const unTilt = unrotateX(view, rotX);
  const local = unrotateY(unTilt, rotY);
  return scaleVec(normalize(local), radius);
}

function unrotateY(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}

function unrotateX(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  return { x: p.x, y: p.y * c + p.z * s, z: -p.y * s + p.z * c };
}

export function vec3ToRecord(v: Vec3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}

export function recordToVec3(r: { x: number; y: number; z?: number }): Vec3 {
  return { x: r.x, y: r.y, z: r.z ?? 0 };
}

export function globeCanvasSize(containerWidth: number, containerHeight: number): {
  width: number;
  height: number;
} {
  if (containerWidth > 0 && containerHeight > 0) {
    return { width: containerWidth, height: containerHeight };
  }
  return { width: 900, height: 620 };
}

/** Latitude / longitude wireframe paths for the rotating globe backdrop. */
export function globeWireframePolylines(
  rotY: number,
  rotX: number,
  width: number,
  height: number,
): string[] {
  const paths: string[] = [];
  const r = GLOBE_RADIUS;

  for (let lat = -75; lat <= 75; lat += 15) {
    const y = Math.sin((lat * Math.PI) / 180) * r;
    const ring = Math.cos((lat * Math.PI) / 180) * r;
    const pts: string[] = [];
    for (let lng = 0; lng <= 360; lng += 6) {
      const theta = (lng * Math.PI) / 180;
      const p = projectGlobePoint(
        { x: Math.cos(theta) * ring, y, z: Math.sin(theta) * ring },
        rotY,
        rotX,
        width,
        height,
      );
      pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    paths.push(`M ${pts.join(" L ")}`);
  }

  for (let lng = 0; lng < 360; lng += 30) {
    const theta = (lng * Math.PI) / 180;
    const pts: string[] = [];
    for (let lat = -90; lat <= 90; lat += 6) {
      const y = Math.sin((lat * Math.PI) / 180) * r;
      const ring = Math.cos((lat * Math.PI) / 180) * r;
      const p = projectGlobePoint(
        { x: Math.cos(theta) * ring, y, z: Math.sin(theta) * ring },
        rotY,
        rotX,
        width,
        height,
      );
      pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    paths.push(`M ${pts.join(" L ")}`);
  }

  return paths;
}

export function globeAtmosphereCenter(
  rotY: number,
  rotX: number,
  width: number,
  height: number,
): ProjectedNode {
  return projectGlobePoint({ x: 0, y: 0, z: 0 }, rotY, rotX, width, height);
}

function hashStable(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
