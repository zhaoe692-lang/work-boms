import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewBoxRect } from "./globeCanvasCoords";
import { clientToLogical, fitTransform } from "./globeCanvasCoords";

export interface ZoomTransform {
  x: number;
  y: number;
  k: number;
}

const IDENTITY: ZoomTransform = { x: 0, y: 0, k: 1 };
const MIN_K = 0.2;
const MAX_K = 3.5;

function clampK(k: number): number {
  return Math.max(MIN_K, Math.min(MAX_K, k));
}

function zoomTransformAt(
  t: ZoomTransform,
  cx: number,
  cy: number,
  nextK: number,
): ZoomTransform {
  const k = clampK(nextK);
  if (k === t.k) return t;
  return {
    x: cx - (cx - t.x) * (k / t.k),
    y: cy - (cy - t.y) * (k / t.k),
    k,
  };
}

function clampTranslate(t: ZoomTransform, bounds: { width: number; height: number }): ZoomTransform {
  const maxX = bounds.width * 0.45 * t.k;
  const maxY = bounds.height * 0.45 * t.k;
  return {
    k: t.k,
    x: Math.max(-maxX, Math.min(maxX, t.x)),
    y: Math.max(-maxY, Math.min(maxY, t.y)),
  };
}

/** Pan/zoom for HTML Canvas graph viewports. */
export function useZoomPan(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: {
    enabled?: boolean;
    focal?: { x: number; y: number };
    getViewBox: () => ViewBoxRect;
    clampBounds?: { width: number; height: number };
    onChange?: () => void;
  },
) {
  const enabled = options.enabled ?? true;
  const focal = options.focal;
  const getViewBox = options.getViewBox;
  const clampBounds = options.clampBounds;
  const onChange = options.onChange;

  const [transform, setTransformState] = useState<ZoomTransform>(IDENTITY);
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const applyTransform = useCallback(
    (next: ZoomTransform | ((prev: ZoomTransform) => ZoomTransform)) => {
      setTransformState((prev) => {
        const raw = typeof next === "function" ? next(prev) : next;
        const clamped = clampBounds ? clampTranslate(raw, clampBounds) : raw;
        transformRef.current = clamped;
        onChange?.();
        return clamped;
      });
    },
    [clampBounds?.width, clampBounds?.height, onChange],
  );

  const getFocal = useCallback(() => {
    if (focal) return focal;
    const vb = getViewBox();
    return { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 };
  }, [focal?.x, focal?.y, getViewBox]);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const el = canvas;

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      event.stopPropagation();
      const vb = getViewBox();
      const pt = clientToLogical(el, event.clientX, event.clientY, vb, transformRef.current);
      if (!pt) return;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      applyTransform((t) => zoomTransformAt(t, pt.x, pt.y, t.k * factor));
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enabled, canvasRef, getViewBox, applyTransform]);

  function resetView() {
    applyTransform(IDENTITY);
  }

  function zoomIn() {
    const c = getFocal();
    applyTransform((t) => zoomTransformAt(t, c.x, c.y, t.k * 1.25));
  }

  function zoomOut() {
    const c = getFocal();
    applyTransform((t) => zoomTransformAt(t, c.x, c.y, t.k / 1.25));
  }

  function panBy(dx: number, dy: number) {
    applyTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  }

  /** Pan in screen pixels (used during shift+drag). */
  function panByScreen(dx: number, dy: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const vb = getViewBox();
    const rect = canvas.getBoundingClientRect();
    const { fit } = fitTransform(rect.width, rect.height, vb);
    if (fit <= 0) return;
    panBy(dx / fit, dy / fit);
  }

  return { transform, transformRef, resetView, zoomIn, zoomOut, panBy, panByScreen };
}
