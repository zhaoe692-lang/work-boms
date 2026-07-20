import type { RefObject } from "react";
import type { ViewBoxRect } from "./globeCanvasCoords";
import { fitTransform } from "./globeCanvasCoords";

export type GlobePointerMode =
  | { kind: "none" }
  | { kind: "rotate"; pointerId: number; lastX: number; lastY: number }
  | { kind: "pan"; pointerId: number; lastX: number; lastY: number }
  | { kind: "node-pending"; pointerId: number; id: string; startX: number; startY: number };

export const GLOBE_POINTER_IDLE: GlobePointerMode = { kind: "none" };

export function attachGlobePointerSession(options: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  getViewBox: () => ViewBoxRect;
  getMode: () => GlobePointerMode;
  setMode: (mode: GlobePointerMode) => void;
  panByScreen: (dx: number, dy: number) => void;
  globe: () => {
    rotateBy: (dx: number, dy: number) => void;
    setInteractionActive: (active: boolean) => void;
  } | null;
  onNodeClick: (id: string) => void;
  onRotateStart: () => void;
  onRotateEnd: () => void;
  onPanEnd: () => void;
}) {
  const DRAG_THRESHOLD = 6;

  function releaseCapture(pointerId: number) {
    const canvas = options.canvasRef.current;
    if (!canvas) return;
    try {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  }

  function finish(pointerId: number) {
    const mode = options.getMode();
    if (mode.kind === "none") return;
    if (mode.pointerId !== pointerId) return;

    if (mode.kind === "node-pending") {
      options.onNodeClick(mode.id);
    }

    releaseCapture(pointerId);
    if (mode.kind === "rotate") options.onRotateEnd();
    if (mode.kind === "pan") options.onPanEnd();
    options.setMode(GLOBE_POINTER_IDLE);
    options.globe()?.setInteractionActive(false);
    document.body.classList.remove("globe-pointer-active");
  }

  function onWindowMove(event: PointerEvent) {
    const mode = options.getMode();
    if (mode.kind === "none" || mode.pointerId !== event.pointerId) return;

    const g = options.globe();
    if (!g) return;

    if (mode.kind === "node-pending") {
      const dx = event.clientX - mode.startX;
      const dy = event.clientY - mode.startY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        options.setMode({
          kind: "rotate",
          pointerId: mode.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
        });
        options.onRotateStart();
      }
      return;
    }

    if (mode.kind === "pan") {
      const dx = event.clientX - mode.lastX;
      const dy = event.clientY - mode.lastY;
      options.setMode({ ...mode, lastX: event.clientX, lastY: event.clientY });
      options.panByScreen(dx, dy);
      return;
    }

    if (mode.kind === "rotate") {
      const dx = event.clientX - mode.lastX;
      const dy = event.clientY - mode.lastY;
      options.setMode({ ...mode, lastX: event.clientX, lastY: event.clientY });
      g.rotateBy(dx, dy);
    }
  }

  function onWindowEnd(event: PointerEvent) {
    finish(event.pointerId);
  }

  window.addEventListener("pointermove", onWindowMove);
  window.addEventListener("pointerup", onWindowEnd);
  window.addEventListener("pointercancel", onWindowEnd);

  return () => {
    window.removeEventListener("pointermove", onWindowMove);
    window.removeEventListener("pointerup", onWindowEnd);
    window.removeEventListener("pointercancel", onWindowEnd);
    document.body.classList.remove("globe-pointer-active");
  };
}

/** @deprecated canvas-only — kept for type re-export compatibility */
export function svgPointFromClient() {
  return null;
}

export { fitTransform };
