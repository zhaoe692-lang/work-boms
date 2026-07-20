import type { DisplayEdge } from "./graph";
import { fitTransform } from "./globeCanvasCoords";
import type { ProjectedNode } from "./globeLayout";
import {
  type GravityArc,
  type GravityWellLayout,
  pointOnGravityArc,
} from "./gravityWellLayout";
import { pulseViewBoxRect } from "./pulseLayout";
import type { StarGrowthScene } from "./starGrowthScene";
import type { ZoomTransform } from "./useZoomPan";
import type { ArtifactView } from "./types";

export interface GravityWellDrawInput {
  ctx: CanvasRenderingContext2D;
  displayWidth: number;
  displayHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  zoom: ZoomTransform;
  projectScale: number;
  layout: GravityWellLayout;
  projected: Map<string, ProjectedNode>;
  projectedWell: ProjectedNode;
  projectedArcs: Array<
    GravityArc & {
      samples: Array<{ x: number; y: number }>;
    }
  >;
  edges: DisplayEdge[];
  artifacts: ArtifactView[];
  centerId: string | null;
  hoveredId: string | null;
  animationPhase: number;
  scene: StarGrowthScene;
}

function applyTransform(
  ctx: CanvasRenderingContext2D,
  displayW: number,
  displayH: number,
  logicalW: number,
  logicalH: number,
  zoom: ZoomTransform,
) {
  const vb = pulseViewBoxRect(logicalW, logicalH);
  const { fit, offsetX, offsetY } = fitTransform(displayW, displayH, vb);
  ctx.translate(offsetX, offsetY);
  ctx.scale(fit, fit);
  ctx.translate(zoom.x, zoom.y);
  ctx.scale(zoom.k, zoom.k);
}

function toScreen(
  p: { x: number; y: number },
  width: number,
  height: number,
  scale: number,
): { x: number; y: number } {
  return { x: width / 2 + p.x * scale, y: height / 2 + p.y * scale };
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, phase: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#050a14");
  bg.addColorStop(0.5, "#071018");
  bg.addColorStop(1, "#030508");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const wellGlow = ctx.createRadialGradient(w * 0.5, h * 0.72, 0, w * 0.5, h * 0.72, w * 0.45);
  wellGlow.addColorStop(0, "rgba(255, 190, 80, 0.08)");
  wellGlow.addColorStop(0.4, "rgba(40, 100, 90, 0.05)");
  wellGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = wellGlow;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 60; i += 1) {
    const x = ((i * 173) % 997) / 997 * w;
    const y = ((i * 89) % 997) / 997 * h;
    const tw = 0.4 + 0.6 * Math.sin(phase * 0.001 + i);
    ctx.globalAlpha = 0.05 * tw;
    ctx.fillStyle = i % 9 === 0 ? "rgba(255, 210, 120, 0.9)" : "rgba(160, 220, 255, 0.8)";
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + (i % 2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawArcStrand(
  ctx: CanvasRenderingContext2D,
  samples: Array<{ x: number; y: number }>,
  well: { x: number; y: number },
  phase: number,
  index: number,
) {
  if (samples.length < 2) return;

  const pulse = 0.85 + 0.15 * Math.sin(phase * 0.0018 + index * 0.4);
  const end = samples[samples.length - 1]!;
  const start = samples[0]!;

  const grad = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  grad.addColorStop(0, `rgba(255, 220, 140, ${0.75 * pulse})`);
  grad.addColorStop(0.35, `rgba(180, 240, 200, ${0.55 * pulse})`);
  grad.addColorStop(1, `rgba(60, 200, 185, ${0.45 * pulse})`);

  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(samples[0]!.x, samples[0]!.y);
  for (let i = 1; i < samples.length; i += 1) {
    ctx.lineTo(samples[i]!.x, samples[i]!.y);
  }

  const passes = [
    { w: 3.2, color: `rgba(40, 180, 160, ${0.06 * pulse})`, blur: 14 },
    { w: 1.4, color: `rgba(80, 220, 200, ${0.18 * pulse})`, blur: 8 },
    { w: 0.65, color: grad, blur: 4 },
  ];

  for (const pass of passes) {
    ctx.save();
    ctx.strokeStyle = pass.color;
    ctx.lineWidth = pass.w;
    if (pass.blur > 0) {
      ctx.shadowColor = "rgba(80, 220, 200, 0.5)";
      ctx.shadowBlur = pass.blur;
    }
    ctx.stroke();
    ctx.restore();
  }

  void well;
}

function drawWell(
  ctx: CanvasRenderingContext2D,
  well: ProjectedNode,
  phase: number,
  scale: number,
) {
  const breath = 0.5 + 0.5 * Math.sin(phase * 0.0022);
  const layers = [
    scale * 0.28,
    scale * 0.14,
    scale * 0.06,
    scale * 0.022,
  ];

  for (let i = 0; i < layers.length; i += 1) {
    const r = layers[i]! * (1 + breath * 0.06);
    const g = ctx.createRadialGradient(well.x, well.y, 0, well.x, well.y, r);
    const a = 0.12 + (layers.length - i) * 0.12;
    g.addColorStop(0, `rgba(255, 240, 200, ${a})`);
    g.addColorStop(0.4, `rgba(255, 200, 100, ${a * 0.5})`);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(well.x, well.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255, 252, 235, 0.98)";
  ctx.beginPath();
  ctx.arc(well.x, well.y, Math.max(3, scale * 0.014), 0, Math.PI * 2);
  ctx.fill();
}

export function projectGravityWellLayout(
  layout: GravityWellLayout,
  width: number,
  height: number,
  projectScale: number,
): {
  projected: Map<string, ProjectedNode>;
  projectedWell: ProjectedNode;
  projectedArcs: GravityWellDrawInput["projectedArcs"];
} {
  const projected = new Map<string, ProjectedNode>();
  layout.positions.forEach((local, id) => {
    const parallax = 1 + local.z * 0.12;
    projected.set(id, {
      x: width / 2 + local.x * projectScale * parallax,
      y: height / 2 + local.y * projectScale,
      scale: 0.8 + local.z * 0.35,
      z: local.z,
    });
  });

  const wellPt = toScreen(layout.well, width, height, projectScale);
  const projectedWell: ProjectedNode = {
    x: wellPt.x,
    y: wellPt.y,
    scale: 1.2,
    z: 1,
  };

  const projectedArcs = layout.arcs.map((arc) => {
    const samples: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      const p = pointOnGravityArc(arc, t);
      samples.push(toScreen(p, width, height, projectScale));
    }
    return { ...arc, samples };
  });

  return { projected, projectedWell, projectedArcs };
}

export function drawGravityWellFrame(input: GravityWellDrawInput) {
  const {
    ctx,
    displayWidth,
    displayHeight,
    logicalWidth,
    logicalHeight,
    zoom,
    projectScale,
    projected,
    projectedWell,
    projectedArcs,
    artifacts,
    centerId,
    hoveredId,
    animationPhase,
    scene,
  } = input;

  const focusId = centerId ?? hoveredId;
  const heroId = scene.heroId;
  const dpr = window.devicePixelRatio || 1;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.fillStyle = "#030508";
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  ctx.save();
  applyTransform(ctx, displayWidth, displayHeight, logicalWidth, logicalHeight, zoom);

  drawBackground(ctx, logicalWidth, logicalHeight, animationPhase);

  projectedArcs.forEach((arc, index) => {
    drawArcStrand(ctx, arc.samples, projectedWell, animationPhase, index);
  });

  drawWell(ctx, projectedWell, animationPhase, projectScale);

  const sorted = [...artifacts].sort(
    (a, b) => (projected.get(a.id)?.z ?? 0) - (projected.get(b.id)?.z ?? 0),
  );

  for (const artifact of sorted) {
    const pos = projected.get(artifact.id);
    if (!pos) continue;

    const isHero = artifact.id === heroId;
    const isFocus = artifact.id === focusId;
    const influence = scene.influenceScoreById.get(artifact.id) ?? 0;
    const maxInf = Math.max(1, ...scene.influenceScoreById.values());
    const boost = influence / maxInf;
    const breath = 0.5 + 0.5 * Math.sin(animationPhase * 0.004 + pos.x * 0.02);
    const radius = (isHero ? 0 : isFocus ? 4.5 : 2.2 + boost * 2) * (0.9 + breath * 0.1) * pos.scale;

    if (isHero) continue;

    if (isFocus) {
      const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius * 5);
      g.addColorStop(0, "rgba(120, 220, 255, 0.45)");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius * 2.5);
    glow.addColorStop(0, `rgba(255, 245, 210, ${isFocus ? 0.95 : 0.75})`);
    glow.addColorStop(0.5, `rgba(255, 200, 100, ${isFocus ? 0.5 : 0.3})`);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius * 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isFocus ? "rgba(255, 252, 240, 1)" : "rgba(255, 230, 160, 0.9)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (isFocus) {
      ctx.font = "500 11px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0, 4, 12, 0.92)";
      ctx.fillStyle = "#dff8ff";
      const ty = pos.y - radius - 6;
      ctx.strokeText(artifact.displayName, pos.x, ty);
      ctx.fillText(artifact.displayName, pos.x, ty);
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

export function hitTestGravityWellNode(
  projected: Map<string, ProjectedNode>,
  lx: number,
  ly: number,
): string | null {
  let best: string | null = null;
  let bestZ = -Infinity;
  for (const [id, pos] of projected) {
    const d = Math.hypot(pos.x - lx, pos.y - ly);
    const hitR = 12 * (0.7 + pos.scale * 0.4);
    if (d <= hitR && pos.z >= bestZ) {
      bestZ = pos.z;
      best = id;
    }
  }
  return best;
}
