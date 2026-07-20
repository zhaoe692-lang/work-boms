import { useCallback, useEffect, useRef } from "react";
import {
  globeCanvasSize,
  globeProjectScale,
  projectGlobePoint,
  recordToVec3,
  distributedSpherePositions,
  type ProjectedNode,
  type Vec3,
} from "./globeLayout";

export type GlobePositionMap = Map<string, Vec3>;

/** ~90 seconds per full rotation — calm but clearly visible. */
const ROT_Y_SPEED = 0.00007;
const IDLE_BEFORE_AUTO_MS = 4000;
const ROT_X_MIN = -0.72;
const ROT_X_MAX = 0.72;
const INITIAL_ROT_X = 0.22;

interface UseGlobeGraphOptions {
  nodeIds: string[];
  containerWidth: number;
  containerHeight: number;
  initialLocal?: GlobePositionMap;
  autoRotate?: boolean;
}

/** Imperative globe simulation — never triggers React re-renders on rotation. */
export function useGlobeGraph({
  nodeIds,
  containerWidth,
  containerHeight,
  initialLocal,
  autoRotate = true,
}: UseGlobeGraphOptions) {
  const { width, height } = globeCanvasSize(containerWidth, containerHeight);
  const projectScale = globeProjectScale(width, height);
  const localRef = useRef<GlobePositionMap>(new Map());
  const rotYRef = useRef(0);
  const rotXRef = useRef(INITIAL_ROT_X);
  const rafRef = useRef<number | null>(null);
  const repaintRef = useRef<(() => void) | null>(null);

  const interactionRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);

  const nodeKey = nodeIds.join(",");

  const repaint = useCallback(() => {
    repaintRef.current?.();
  }, []);

  useEffect(() => {
    const next = new Map<string, Vec3>();
    const generated = distributedSpherePositions(nodeIds);
    for (const id of nodeIds) {
      next.set(id, initialLocal?.get(id) ?? generated.get(id) ?? localRef.current.get(id)!);
    }
    localRef.current = next;
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey]);

  useEffect(() => {
    let running = true;
    let last = performance.now();

    function tick(now: number) {
      if (!running) return;
      const dt = now - last;
      last = now;
      if (autoRotate && !interactionRef.current) {
        rotYRef.current += ROT_Y_SPEED * dt;
        repaint();
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [autoRotate, repaint]);

  const getProjected = useCallback((): Map<string, ProjectedNode> => {
    const projected = new Map<string, ProjectedNode>();
    localRef.current.forEach((local, id) => {
      projected.set(
        id,
        projectGlobePoint(local, rotYRef.current, rotXRef.current, width, height, 2.8, projectScale),
      );
    });
    return projected;
  }, [height, projectScale, width]);

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
      rotYRef.current += deltaX * 0.004;
      rotXRef.current = Math.max(
        ROT_X_MIN,
        Math.min(ROT_X_MAX, rotXRef.current + deltaY * 0.004),
      );
      repaint();
    },
    [repaint],
  );

  const snapshot = useCallback((): GlobePositionMap => new Map(localRef.current), []);

  const resetGlobe = useCallback(() => {
    localRef.current = distributedSpherePositions(nodeIds);
    rotYRef.current = 0;
    rotXRef.current = INITIAL_ROT_X;
    repaint();
  }, [nodeIds, repaint]);

  return {
    width,
    height,
    projectScale,
    getProjected,
    getRotation: () => ({ rotY: rotYRef.current, rotX: rotXRef.current }),
    getDraggingId: () => null,
    rotateBy,
    setInteractionActive,
    snapshot,
    resetGlobe,
    repaintRef,
  };
}

export function globePositionsToRecord(
  positions: GlobePositionMap,
): Record<string, { x: number; y: number; z: number }> {
  const out: Record<string, { x: number; y: number; z: number }> = {};
  positions.forEach((v, id) => {
    out[id] = { x: v.x, y: v.y, z: v.z };
  });
  return out;
}

export function globePositionsFromRecord(
  record: Record<string, { x: number; y: number; z?: number }>,
): GlobePositionMap {
  return new Map(Object.entries(record).map(([id, v]) => [id, recordToVec3(v)]));
}
