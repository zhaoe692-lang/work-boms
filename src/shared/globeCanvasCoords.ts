import type { ZoomTransform } from "./useZoomPan";

export interface ViewBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitTransform(
  displayW: number,
  displayH: number,
  viewBox: ViewBoxRect,
): { fit: number; offsetX: number; offsetY: number } {
  const fit = Math.min(displayW / viewBox.width, displayH / viewBox.height);
  return {
    fit,
    offsetX: (displayW - viewBox.width * fit) / 2,
    offsetY: (displayH - viewBox.height * fit) / 2,
  };
}

/** Map pointer position → logical graph coordinates (pre zoom-pan). */
export function clientToLogical(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  viewBox: ViewBoxRect,
  zoom: ZoomTransform,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const { fit, offsetX, offsetY } = fitTransform(rect.width, rect.height, viewBox);
  const ux = (clientX - rect.left - offsetX) / fit;
  const uy = (clientY - rect.top - offsetY) / fit;
  return {
    x: (ux - zoom.x) / zoom.k,
    y: (uy - zoom.y) / zoom.k,
  };
}

/** Map logical graph coordinates → CSS pixel position on the canvas element. */
export function logicalToClient(
  canvas: HTMLCanvasElement,
  lx: number,
  ly: number,
  viewBox: ViewBoxRect,
  zoom: ZoomTransform,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const { fit, offsetX, offsetY } = fitTransform(rect.width, rect.height, viewBox);
  const ux = lx * zoom.k + zoom.x;
  const uy = ly * zoom.k + zoom.y;
  return {
    x: rect.left + offsetX + ux * fit,
    y: rect.top + offsetY + uy * fit,
  };
}
