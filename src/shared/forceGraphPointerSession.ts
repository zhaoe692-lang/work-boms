import type { RefObject } from "react";

export type ForcePointerMode =
  | { kind: "none" }
  | { kind: "pan"; pointerId: number; lastX: number; lastY: number }
  | { kind: "node-pending"; pointerId: number; id: string; startX: number; startY: number }
  | { kind: "node-drag"; pointerId: number; id: string };

export const FORCE_POINTER_IDLE: ForcePointerMode = { kind: "none" };

export function attachForceGraphPointerSession(options: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  getMode: () => ForcePointerMode;
  setMode: (mode: ForcePointerMode) => void;
  clientToLogical: (clientX: number, clientY: number) => { x: number; y: number } | null;
  panByScreen: (dx: number, dy: number) => void;
  onNodeClick: (id: string) => void;
  onNodeDragMove: (id: string, x: number, y: number) => void;
  onNodeDragEnd: (id: string) => void;
  onPanEnd: () => void;
  canDragNode?: (id: string) => boolean;
}) {
  const DRAG_THRESHOLD = 6;

  function releaseCapture(pointerId: number) {
    const canvas = options.canvasRef.current;
    if (!canvas) return;
    try {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  }

  function finish(pointerId: number) {
    const mode = options.getMode();
    if (mode.kind === "none" || mode.pointerId !== pointerId) return;

    if (mode.kind === "node-pending") {
      options.onNodeClick(mode.id);
    }
    if (mode.kind === "node-drag") {
      options.onNodeDragEnd(mode.id);
    }

    releaseCapture(pointerId);
    if (mode.kind === "pan") options.onPanEnd();
    options.setMode(FORCE_POINTER_IDLE);
    document.body.classList.remove("globe-pointer-active");
  }

  function onWindowMove(event: PointerEvent) {
    const mode = options.getMode();
    if (mode.kind === "none" || mode.pointerId !== event.pointerId) return;

    if (mode.kind === "node-pending") {
      const dx = event.clientX - mode.startX;
      const dy = event.clientY - mode.startY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        if (options.canDragNode?.(mode.id) === false) {
          options.setMode({
            kind: "pan",
            pointerId: mode.pointerId,
            lastX: event.clientX,
            lastY: event.clientY,
          });
          return;
        }
        options.setMode({ kind: "node-drag", pointerId: mode.pointerId, id: mode.id });
      }
      return;
    }

    if (mode.kind === "node-drag") {
      const pt = options.clientToLogical(event.clientX, event.clientY);
      if (pt) options.onNodeDragMove(mode.id, pt.x, pt.y);
      return;
    }

    if (mode.kind === "pan") {
      const dx = event.clientX - mode.lastX;
      const dy = event.clientY - mode.lastY;
      options.setMode({ ...mode, lastX: event.clientX, lastY: event.clientY });
      options.panByScreen(dx, dy);
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
