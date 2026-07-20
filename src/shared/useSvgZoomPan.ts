import { useCallback, useEffect, useRef, useState } from "react";
import type { ZoomTransform } from "./useZoomPan";

const IDENTITY: ZoomTransform = { x: 0, y: 0, k: 1 };
const MIN_K = 0.2;
const MAX_K = 3.5;

function clampK(k: number): number {
  return Math.max(MIN_K, Math.min(MAX_K, k));
}

function zoomTransformAt(t: ZoomTransform, cx: number, cy: number, nextK: number): ZoomTransform {
  const k = clampK(nextK);
  if (k === t.k) return t;
  return {
    x: cx - (cx - t.x) * (k / t.k),
    y: cy - (cy - t.y) * (k / t.k),
    k,
  };
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const vb = svg.viewBox.baseVal;
  return {
    x: vb.x + ((clientX - rect.left) / rect.width) * vb.width,
    y: vb.y + ((clientY - rect.top) / rect.height) * vb.height,
  };
}

/** Pan/zoom for local SVG graph. */
export function useSvgZoomPan(svgRef: React.RefObject<SVGSVGElement | null>) {
  const [transform, setTransform] = useState<ZoomTransform>(IDENTITY);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const panRef = useRef<{ px: number; py: number; tx: number; ty: number; k: number } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const el = svg;

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const pt = clientToSvg(el, event.clientX, event.clientY);
      if (!pt) return;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setTransform((t) => zoomTransformAt(t, pt.x, pt.y, t.k * factor));
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const target = event.target as Element;
      if (target.closest?.("[data-no-pan]")) return;
      const t = transformRef.current;
      panRef.current = { px: event.clientX, py: event.clientY, tx: t.x, ty: t.y, k: t.k };
      el.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      const pan = panRef.current;
      if (!pan) return;
      const rect = el.getBoundingClientRect();
      const vb = el.viewBox.baseVal;
      if (rect.width <= 0 || rect.height <= 0) return;
      const dx = ((event.clientX - pan.px) / rect.width) * vb.width;
      const dy = ((event.clientY - pan.py) / rect.height) * vb.height;
      setTransform({ x: pan.tx + dx, y: pan.ty + dy, k: pan.k });
    }

    function endPan(event: PointerEvent) {
      if (!panRef.current) return;
      panRef.current = null;
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endPan);
    el.addEventListener("pointercancel", endPan);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPan);
      el.removeEventListener("pointercancel", endPan);
    };
  }, [svgRef]);

  const resetView = useCallback(() => setTransform(IDENTITY), []);
  const zoomIn = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const c = { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 };
    setTransform((t) => zoomTransformAt(t, c.x, c.y, t.k * 1.25));
  }, [svgRef]);
  const zoomOut = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const c = { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 };
    setTransform((t) => zoomTransformAt(t, c.x, c.y, t.k / 1.25));
  }, [svgRef]);

  return { transform, resetView, zoomIn, zoomOut };
}
