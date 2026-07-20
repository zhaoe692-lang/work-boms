import { useCallback, useEffect, useRef } from "react";
import { recordToVec3, type Vec3 } from "./globeLayout";
import { buildMyceliumLayout, type MyceliumLayout } from "./myceliumLayout";
import {
  projectPulsePoint,
  pulseCanvasSize,
  pulseProjectScale,
} from "./pulseLayout";
import type { ProjectedNode } from "./globeLayout";
import { projectMyceliumLayout } from "./myceliumCanvasDraw";
import type { StarGrowthScene } from "./starGrowthScene";
import type { ArtifactView, Identity, Relation } from "./types";

export type PulsePositionMap = Map<string, Vec3>;

const DRIFT_X_SPEED = 0.000012;
const IDLE_BEFORE_AUTO_MS = 4000;
const DRIFT_X_MIN = -0.06;
const DRIFT_X_MAX = 0.06;
const DRIFT_Y_MIN = -0.04;
const DRIFT_Y_MAX = 0.04;
const INITIAL_DRIFT_X = 0;
const INITIAL_DRIFT_Y = 0;

interface UsePulseGraphOptions {
  artifacts: ArtifactView[];
  relations: Relation[];
  identities: Identity[];
  scene: StarGrowthScene;
  containerWidth: number;
  containerHeight: number;
  initialLocal?: PulsePositionMap;
}

/** Mycelium growth tree layout with subtle camera drift. */
export function usePulseGraph({
  artifacts,
  relations,
  identities,
  scene,
  containerWidth,
  containerHeight,
  initialLocal,
}: UsePulseGraphOptions) {
  const { width, height } = pulseCanvasSize(containerWidth, containerHeight);
  const projectScale = pulseProjectScale(width, height);
  const layoutRef = useRef<MyceliumLayout | null>(null);
  const localRef = useRef<PulsePositionMap>(new Map());
  const driftXRef = useRef(INITIAL_DRIFT_X);
  const driftYRef = useRef(INITIAL_DRIFT_Y);
  const repaintRef = useRef<(() => void) | null>(null);
  const interactionRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);

  const dataKey = `${artifacts.map((a) => a.id).join(",")}:${relations.length}:${identities.length}:${scene.heroId ?? "none"}`;

  const repaint = useCallback(() => {
    repaintRef.current?.();
  }, []);

  useEffect(() => {
    const layout = buildMyceliumLayout({ artifacts, relations, identities, scene });
    layoutRef.current = layout;
    const next = new Map<string, Vec3>();
    for (const [id, pos] of layout.positions.entries()) {
      next.set(id, initialLocal?.get(id) ?? pos);
    }
    localRef.current = next;
    driftXRef.current = INITIAL_DRIFT_X;
    driftYRef.current = INITIAL_DRIFT_Y;
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  useEffect(() => {
    let running = true;
    let last = performance.now();

    function tick(now: number) {
      if (!running) return;
      const dt = now - last;
      last = now;
      if (!interactionRef.current) {
        driftXRef.current += DRIFT_X_SPEED * dt;
        if (driftXRef.current > DRIFT_X_MAX) driftXRef.current = DRIFT_X_MIN;
        repaint();
      }
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
    return () => {
      running = false;
    };
  }, [repaint]);

  const getLayout = useCallback(() => layoutRef.current, []);

  const getProjected = useCallback((): Map<string, ProjectedNode> => {
    const layout = layoutRef.current;
    if (!layout) return new Map();

    const merged = new Map<string, Vec3>(layout.positions);
    localRef.current.forEach((pos, id) => merged.set(id, pos));
    const mergedLayout = { ...layout, positions: merged };

    return projectMyceliumLayout(
      mergedLayout,
      width,
      height,
      projectScale,
      driftXRef.current,
      driftYRef.current,
    ).projected;
  }, [height, projectScale, width]);

  const getMyceliumProjection = useCallback(() => {
    const layout = layoutRef.current;
    if (!layout) return null;

    const merged = new Map<string, Vec3>(layout.positions);
    localRef.current.forEach((pos, id) => merged.set(id, pos));
    return projectMyceliumLayout(
      { ...layout, positions: merged },
      width,
      height,
      projectScale,
      driftXRef.current,
      driftYRef.current,
    );
  }, [height, projectScale, width]);

  const getRotation = useCallback(
    () => ({ rotY: driftXRef.current, rotX: driftYRef.current }),
    [],
  );

  const setInteractionActive = useCallback((active: boolean) => {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (active) {
      interactionRef.current = true;
      return;
    }
    idleTimerRef.current = window.setTimeout(() => {
      interactionRef.current = false;
      idleTimerRef.current = null;
    }, IDLE_BEFORE_AUTO_MS);
  }, []);

  useEffect(
    () => () => {
      if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current);
    },
    [],
  );

  const rotateBy = useCallback(
    (deltaX: number, deltaY: number) => {
      driftXRef.current = Math.max(
        DRIFT_X_MIN,
        Math.min(DRIFT_X_MAX, driftXRef.current + deltaX * 0.0015),
      );
      driftYRef.current = Math.max(
        DRIFT_Y_MIN,
        Math.min(DRIFT_Y_MAX, driftYRef.current + deltaY * 0.0015),
      );
      repaint();
    },
    [repaint],
  );

  const snapshot = useCallback((): PulsePositionMap => new Map(localRef.current), []);

  const resetLayout = useCallback(() => {
    const layout = buildMyceliumLayout({ artifacts, relations, identities, scene });
    layoutRef.current = layout;
    localRef.current = new Map(layout.positions);
    driftXRef.current = INITIAL_DRIFT_X;
    driftYRef.current = INITIAL_DRIFT_Y;
    repaint();
  }, [artifacts, identities, relations, repaint, scene]);

  const getLocalDistances = useCallback((): Map<string, number> => {
    const layout = layoutRef.current;
    const rootY = layout?.root.y ?? 0.97;
    const out = new Map<string, number>();
    localRef.current.forEach((p, id) => {
      const distFromRoot = rootY - p.y;
      out.set(id, Math.max(0, Math.min(1, distFromRoot / 1.35)));
    });
    return out;
  }, []);

  return {
    width,
    height,
    projectScale,
    getLayout,
    getProjected,
    getMyceliumProjection,
    getLocalDistances,
    getRotation,
    rotateBy,
    setInteractionActive,
    snapshot,
    resetLayout,
    repaintRef,
  };
}

export function pulsePositionsToRecord(
  positions: PulsePositionMap,
): Record<string, { x: number; y: number; z: number }> {
  const out: Record<string, { x: number; y: number; z: number }> = {};
  positions.forEach((v, id) => {
    out[id] = { x: v.x, y: v.y, z: v.z };
  });
  return out;
}

export function pulsePositionsFromRecord(
  record: Record<string, { x: number; y: number; z?: number }>,
): PulsePositionMap {
  return new Map(Object.entries(record).map(([id, v]) => [id, recordToVec3(v)]));
}

// Legacy helper kept for any imports — delegates to mycelium projection.
export function projectPulsePointLegacy(
  local: Vec3,
  driftX: number,
  driftY: number,
  width: number,
  height: number,
  projectScale?: number,
): ProjectedNode {
  return projectPulsePoint(local, driftX, driftY, width, height, projectScale);
}
