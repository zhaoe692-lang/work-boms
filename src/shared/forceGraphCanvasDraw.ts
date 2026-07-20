import type { DisplayEdge } from "./graph";
import type { GraphAppearanceSettings } from "./graphAppearance";
import type { ZoomTransform } from "./useZoomPan";
import { edgeStrokeStyle, nodeVisualStyle } from "../components/graphStyle";
import type { ArtifactView } from "./types";
import { fitTransform } from "./globeCanvasCoords";

export interface ForceDrawInput {
  ctx: CanvasRenderingContext2D;
  displayWidth: number;
  displayHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  zoom: ZoomTransform;
  background: string;
  appearance: GraphAppearanceSettings;
  positions: Map<string, { x: number; y: number }>;
  edges: DisplayEdge[];
  artifacts: ArtifactView[];
  centerId: string | null;
  hoveredId: string | null;
  draggingId: string | null;
  headIds: Set<string>;
  historicalIds: Set<string>;
  levelFor: (id: string) => number;
  showAllLabels?: boolean;
}

function applySceneTransform(
  ctx: CanvasRenderingContext2D,
  displayW: number,
  displayH: number,
  logicalW: number,
  logicalH: number,
  zoom: ZoomTransform,
) {
  const viewBox = { x: 0, y: 0, width: logicalW, height: logicalH };
  const { fit, offsetX, offsetY } = fitTransform(displayW, displayH, viewBox);
  ctx.translate(offsetX, offsetY);
  ctx.scale(fit, fit);
  ctx.translate(zoom.x, zoom.y);
  ctx.scale(zoom.k, zoom.k);
}

function setDash(ctx: CanvasRenderingContext2D, dash?: string) {
  if (!dash) {
    ctx.setLineDash([]);
    return;
  }
  const parts = dash.split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));
  ctx.setLineDash(parts.length ? parts : []);
}

export function drawForceGraphFrame(input: ForceDrawInput) {
  const {
    ctx,
    displayWidth,
    displayHeight,
    logicalWidth,
    logicalHeight,
    zoom,
    background,
    appearance,
    positions,
    edges,
    artifacts,
    centerId,
    hoveredId,
    draggingId,
    headIds,
    historicalIds,
    levelFor,
    showAllLabels = true,
  } = input;

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  ctx.save();
  applySceneTransform(ctx, displayWidth, displayHeight, logicalWidth, logicalHeight, zoom);

  for (const rel of edges) {
    const from = positions.get(rel.from);
    const to = positions.get(rel.to);
    if (!from || !to) continue;
    const style = edgeStrokeStyle(rel, appearance);
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.strokeWidth;
    ctx.globalAlpha = style.opacity;
    setDash(ctx, style.strokeDasharray);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  for (const artifact of artifacts) {
    const pos = positions.get(artifact.id);
    if (!pos) continue;
    const isCenter = artifact.id === centerId;
    const isHovered = artifact.id === hoveredId;
    const level = levelFor(artifact.id);
    const visual = nodeVisualStyle(appearance, {
      level,
      isCenter,
      isHead: headIds.has(artifact.id),
      isHistorical: historicalIds.has(artifact.id),
      isBroken: !artifact.reachable,
      depthScale: 1,
    });

    ctx.globalAlpha = 1;
    ctx.fillStyle = visual.fill;
    ctx.strokeStyle = visual.stroke;
    ctx.lineWidth = isHovered || isCenter ? visual.strokeWidth + 1 : visual.strokeWidth;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, visual.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const showLabel =
      showAllLabels || isCenter || isHovered || draggingId === artifact.id;
    if (showLabel) {
      ctx.font = "500 11px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.fillStyle = "#334155";
      const ty = pos.y + visual.radius + 6;
      ctx.strokeText(artifact.displayName, pos.x, ty);
      ctx.fillText(artifact.displayName, pos.x, ty);
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

export function hitTestForceNode(
  positions: Map<string, { x: number; y: number }>,
  lx: number,
  ly: number,
  radius = 18,
): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const [id, pos] of positions) {
    const d = Math.hypot(pos.x - lx, pos.y - ly);
    if (d <= radius && d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export function logicalViewBox(width: number, height: number) {
  return { x: 0, y: 0, width, height };
}

export function clientToLogicalFlat(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  logicalW: number,
  logicalH: number,
  zoom: ZoomTransform,
) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const viewBox = logicalViewBox(logicalW, logicalH);
  const { fit, offsetX, offsetY } = fitTransform(rect.width, rect.height, viewBox);
  const ux = (clientX - rect.left - offsetX) / fit;
  const uy = (clientY - rect.top - offsetY) / fit;
  return {
    x: (ux - zoom.x) / zoom.k,
    y: (uy - zoom.y) / zoom.k,
  };
}
