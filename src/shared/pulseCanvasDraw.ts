import { nodeVisualStyle } from "../components/graphStyle";
import type { DisplayEdge } from "./graph";
import { edgeKindKey } from "./graphAppearance";
import type { GraphAppearanceSettings } from "./graphAppearance";
import { type ProjectedNode } from "./globeLayout";
import { pulseNodePhase, pulseViewBoxRect } from "./pulseLayout";
import type { StarGrowthScene } from "./starGrowthScene";
import type { ZoomTransform } from "./useZoomPan";
import type { ArtifactView } from "./types";
import { fitTransform } from "./globeCanvasCoords";

export interface PulseDrawInput {
  ctx: CanvasRenderingContext2D;
  displayWidth: number;
  displayHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  zoom: ZoomTransform;
  appearance: GraphAppearanceSettings;
  rotY: number;
  rotX: number;
  projectScale: number;
  projected: Map<string, ProjectedNode>;
  localDistById: Map<string, number>;
  edges: DisplayEdge[];
  artifacts: ArtifactView[];
  headIds: Set<string>;
  historicalIds: Set<string>;
  centerId: string | null;
  hoveredId: string | null;
  animationPhase: number;
  revealProgress: number;
  stats: { total: number; finals: number; edges: number };
  scene: StarGrowthScene;
  levelFor: (id: string) => number;
}

const NEIGHBOR_RADIUS = 110;

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

function edgeHash(from: string, to: string): number {
  const a = from < to ? from : to;
  const b = from < to ? to : from;
  let h = 0;
  const s = `${a}:${b}`;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function drawAbyssBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.max(w, h) * 0.85;

  const abyss = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  abyss.addColorStop(0, "#08141d");
  abyss.addColorStop(0.36, "#07101a");
  abyss.addColorStop(0.72, "#040811");
  abyss.addColorStop(1, "#010206");
  ctx.fillStyle = abyss;
  ctx.fillRect(0, 0, w, h);
}

function drawTreeBackdrop(
  ctx: CanvasRenderingContext2D,
  driftX: number,
  driftY: number,
  logicalWidth: number,
  logicalHeight: number,
  projectScale: number,
  reveal: number,
) {
  const cx = logicalWidth * 0.5 + driftX * projectScale * 0.22;
  const trunkTopY = logicalHeight * 0.3 + driftY * projectScale * 0.06;
  const trunkBottomY = logicalHeight * 0.82 + driftY * projectScale * 0.04;
  const canopyRx = projectScale * 0.8;
  const canopyRy = projectScale * 0.52;

  const cloud = ctx.createRadialGradient(cx, trunkTopY, canopyRx * 0.08, cx, trunkTopY, canopyRx);
  cloud.addColorStop(0, `rgba(194, 255, 218, ${0.16 * reveal})`);
  cloud.addColorStop(0.24, `rgba(79, 174, 150, ${0.14 * reveal})`);
  cloud.addColorStop(0.54, `rgba(18, 58, 58, ${0.12 * reveal})`);
  cloud.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.save();
  ctx.fillStyle = cloud;
  ctx.beginPath();
  ctx.ellipse(cx, trunkTopY, canopyRx, canopyRy, 0, 0, Math.PI * 2);
  ctx.fill();

  const rootGlow = ctx.createRadialGradient(cx, trunkBottomY + 8, 0, cx, trunkBottomY + 8, projectScale * 0.26);
  rootGlow.addColorStop(0, `rgba(255, 232, 171, ${0.34 * reveal})`);
  rootGlow.addColorStop(0.35, `rgba(255, 211, 132, ${0.18 * reveal})`);
  rootGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = rootGlow;
  ctx.beginPath();
  ctx.arc(cx, trunkBottomY + 8, projectScale * 0.26, 0, Math.PI * 2);
  ctx.fill();

  const trunkGlow = ctx.createLinearGradient(cx, trunkBottomY, cx, trunkTopY);
  trunkGlow.addColorStop(0, "rgba(0, 0, 0, 0)");
  trunkGlow.addColorStop(0.3, `rgba(84, 238, 179, ${0.12 * reveal})`);
  trunkGlow.addColorStop(0.84, `rgba(255, 223, 151, ${0.18 * reveal})`);
  trunkGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.strokeStyle = trunkGlow;
  ctx.lineWidth = Math.max(18, projectScale * 0.035);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, trunkBottomY);
  ctx.lineTo(cx, trunkTopY + canopyRy * 0.24);
  ctx.stroke();

  ctx.globalAlpha = 0.14 * reveal;
  ctx.lineWidth = 1;
  for (let index = 0; index < 5; index += 1) {
    const branchY = trunkTopY + (index - 1.5) * canopyRy * 0.22;
    const armRx = canopyRx * (0.42 + index * 0.12);
    const armLine = ctx.createLinearGradient(cx - armRx, branchY, cx + armRx, branchY);
    armLine.addColorStop(0, "rgba(0, 0, 0, 0)");
    armLine.addColorStop(0.32, "rgba(108, 226, 189, 0.16)");
    armLine.addColorStop(0.68, "rgba(255, 208, 120, 0.14)");
    armLine.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.strokeStyle = armLine;
    ctx.beginPath();
    ctx.ellipse(cx, branchY, armRx, canopyRy * (0.12 + index * 0.03), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCanopyClusters(
  ctx: CanvasRenderingContext2D,
  projected: Map<string, ProjectedNode>,
  scene: StarGrowthScene,
  reveal: number,
  phase: number,
) {
  const trunkSet = new Set(scene.trunkIds);
  const clusterNodes = new Map<number, ProjectedNode[]>();

  for (const [id, pos] of projected.entries()) {
    if (trunkSet.has(id) || pos.z < -0.2) continue;
    const group = scene.branchGroupById.get(id);
    if (group == null || group < 0) continue;
    clusterNodes.set(group, [...(clusterNodes.get(group) ?? []), pos]);
  }

  for (const nodes of clusterNodes.values()) {
    if (nodes.length < 3) continue;
    const cx = nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
    const cy = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
    const spread = nodes.reduce((sum, node) => sum + Math.hypot(node.x - cx, node.y - cy), 0) / nodes.length;
    const radius = Math.max(24, spread * 1.5);
    const pulse = 0.9 + 0.1 * Math.sin(phase * 0.001 + cx * 0.02);
    const fog = ctx.createRadialGradient(cx, cy, radius * 0.12, cx, cy, radius);
    fog.addColorStop(0, `rgba(156, 255, 217, ${0.1 * reveal * pulse})`);
    fog.addColorStop(0.4, `rgba(87, 166, 150, ${0.1 * reveal})`);
    fog.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.save();
    ctx.fillStyle = fog;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawStarDust(ctx: CanvasRenderingContext2D, logicalWidth: number, logicalHeight: number, phase: number) {
  ctx.save();
  for (let index = 0; index < 42; index += 1) {
    const t = index / 42;
    const x =
      logicalWidth * (0.08 + t * 0.84) +
      Math.sin(phase * 0.00014 + index * 2.7) * logicalWidth * 0.015;
    const y =
      logicalHeight * (0.18 + ((index * 37) % 100) / 100 * 0.64) +
      Math.cos(phase * 0.0001 + index * 1.9) * logicalHeight * 0.012;
    const radius = 0.6 + (index % 3) * 0.55;
    ctx.globalAlpha = 0.12 + (index % 5) * 0.03;
    ctx.fillStyle = index % 7 === 0 ? "rgba(255, 220, 164, 0.85)" : "rgba(201, 245, 255, 0.8)";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRevealWave(ctx: CanvasRenderingContext2D, w: number, h: number, progress: number) {
  if (progress >= 1) return;
  const cx = w * 0.5;
  const cy = h * 0.82;
  const maxR = Math.min(w, h) * 0.58;

  ctx.globalAlpha = (1 - progress) * 0.2;
  ctx.strokeStyle = "rgba(126, 236, 198, 0.42)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, progress * maxR * 0.38, progress * maxR, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = (1 - progress) * 0.35;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(210, 245, 236, 0.88)";
  ctx.font = "500 12px system-ui, -apple-system, sans-serif";
  ctx.fillText("mycelium growth", cx, cy + 8);
  ctx.globalAlpha = 1;
}

function curveControl(
  from: ProjectedNode,
  to: ProjectedNode,
  eh: number,
): { cx: number; cy: number } {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const verticalBias = Math.abs(dy) > Math.abs(dx) ? 0.08 : 0.18;
  const bend = ((eh % 100) / 100 - 0.5) * verticalBias * len;
  return { cx: mx + nx * bend, cy: my + ny * bend };
}

function isStructuralEdge(kind: string): boolean {
  return kind === "part_of" || kind === "version";
}

function drawStructuralFilaments(
  ctx: CanvasRenderingContext2D,
  edges: DisplayEdge[],
  projected: Map<string, ProjectedNode>,
  appearance: GraphAppearanceSettings,
  phase: number,
  reveal: number,
) {
  if (reveal < 0.12) return;

  const sorted = [...edges]
    .filter((e) => isStructuralEdge(e.kind))
    .sort((a, b) => {
      const za = ((projected.get(a.from)?.z ?? 0) + (projected.get(a.to)?.z ?? 0)) / 2;
      const zb = ((projected.get(b.from)?.z ?? 0) + (projected.get(b.to)?.z ?? 0)) / 2;
      return za - zb;
    });

  ctx.lineCap = "round";
  for (const rel of sorted) {
    const from = projected.get(rel.from);
    const to = projected.get(rel.to);
    if (!from || !to) continue;
    if (from.z < -0.2 && to.z < -0.2) continue;

    const avgZ = (from.z + to.z) / 2;
    const depthFade = (from.scale + to.scale) / 2;
    const kind = edgeKindKey(rel.kind);
    const stroke = appearance.edges[kind];
    const eh = edgeHash(rel.from, rel.to);
    const pulse = 0.5 + 0.5 * Math.sin(phase * 0.003 + (eh % 80) * 0.08);
    const offset = -(phase * 0.04 + eh * 0.05) % 24;
    const ctrl = curveControl(from, to, eh);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(ctrl.cx, ctrl.cy, to.x, to.y);

    ctx.strokeStyle = stroke;
    ctx.lineWidth = rel.kind === "part_of" ? 1.15 : 0.82;
    ctx.globalAlpha = reveal * depthFade * (0.14 + pulse * 0.08) * (0.48 + avgZ * 0.38);
    ctx.setLineDash(rel.kind === "version" ? [4, 8] : []);
    ctx.lineDashOffset = offset;
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawFocusFilaments(
  ctx: CanvasRenderingContext2D,
  edges: DisplayEdge[],
  projected: Map<string, ProjectedNode>,
  focusId: string,
  phase: number,
) {
  ctx.lineCap = "round";
  for (const rel of edges) {
    if (rel.from !== focusId && rel.to !== focusId) continue;
    const from = projected.get(rel.from);
    const to = projected.get(rel.to);
    if (!from || !to) continue;

    const eh = edgeHash(rel.from, rel.to);
    const offset = -(phase * 0.12 + eh * 0.05) % 20;
    const ctrl = curveControl(from, to, eh);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(ctrl.cx, ctrl.cy, to.x, to.y);

    ctx.strokeStyle = "rgba(120, 220, 255, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.82;
    ctx.shadowColor = "rgba(80, 200, 255, 0.85)";
    ctx.shadowBlur = 12;
    ctx.setLineDash([8, 10]);
    ctx.lineDashOffset = offset;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawHoverRipple(ctx: CanvasRenderingContext2D, pos: ProjectedNode, phase: number) {
  const cycle = (phase * 0.0025) % (Math.PI * 2);
  for (let i = 0; i < 2; i += 1) {
    const t = (cycle + i * Math.PI) / (Math.PI * 2);
    const r = 14 + t * 52;
    ctx.globalAlpha = (1 - t) * 0.28;
    ctx.strokeStyle = "rgba(100, 200, 255, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function neighborBoost(
  artifactId: string,
  focusId: string | null,
  projected: Map<string, ProjectedNode>,
): number {
  if (!focusId || artifactId === focusId) return 1;
  const a = projected.get(artifactId);
  const b = projected.get(focusId);
  if (!a || !b) return 1;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (d >= NEIGHBOR_RADIUS) return 1;
  return 1 + (1 - d / NEIGHBOR_RADIUS) * 0.5;
}

function revealFactor(localDist: number, progress: number): number {
  if (progress >= 1) return 1;
  const wave = progress * 1.4 - localDist * 0.65;
  return Math.max(0, Math.min(1, wave));
}

function normalizedScore(value: number, floor: number, ceiling: number): number {
  if (!Number.isFinite(value)) return 0;
  if (ceiling <= floor) return 0;
  return Math.max(0, Math.min(1, (value - floor) / (ceiling - floor)));
}

function drawVersionHalo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  ringCount: number,
  alpha: number,
) {
  if (ringCount <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.strokeStyle = `rgba(255, 212, 118, ${Math.min(0.34, alpha)})`;
  ctx.lineWidth = 0.9;
  for (let index = 0; index < ringCount; index += 1) {
    const ringRadius = radius + 5 + index * 3.5;
    ctx.globalAlpha = alpha * (1 - index / (ringCount + 1));
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHeroGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  breath: number,
  alpha: number,
) {
  if (alpha <= 0) return;
  const glowRadius = radius * (4.4 + breath * 0.8);
  const glow = ctx.createRadialGradient(x, y, radius * 0.2, x, y, glowRadius);
  glow.addColorStop(0, `rgba(255, 224, 146, ${0.28 * alpha})`);
  glow.addColorStop(0.45, `rgba(125, 247, 198, ${0.18 * alpha})`);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawPulseFrame(input: PulseDrawInput) {
  const {
    ctx,
    displayWidth,
    displayHeight,
    logicalWidth,
    logicalHeight,
    zoom,
    appearance,
    rotY,
    rotX,
    projectScale,
    projected,
    localDistById,
    edges,
    artifacts,
    headIds,
    historicalIds,
    centerId,
    hoveredId,
    animationPhase,
    revealProgress,
    scene,
    levelFor,
  } = input;

  const focusId = centerId ?? hoveredId;
  const heroId = scene.heroId;
  const maxComplexity = Math.max(1, ...scene.complexityScoreById.values());
  const maxInfluence = Math.max(1, ...scene.influenceScoreById.values());
  const maxVersionCount = Math.max(1, ...scene.versionCountById.values());

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.fillStyle = "#000205";
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  ctx.save();
  applyTransform(ctx, displayWidth, displayHeight, logicalWidth, logicalHeight, zoom);

  drawAbyssBackground(ctx, logicalWidth, logicalHeight);
  drawTreeBackdrop(ctx, rotY, rotX, logicalWidth, logicalHeight, projectScale, revealProgress);
  drawStarDust(ctx, logicalWidth, logicalHeight, animationPhase);
  drawCanopyClusters(ctx, projected, scene, revealProgress, animationPhase);
  drawRevealWave(ctx, logicalWidth, logicalHeight, revealProgress);
  drawStructuralFilaments(ctx, edges, projected, appearance, animationPhase, revealProgress);

  if (focusId) {
    drawFocusFilaments(ctx, edges, projected, focusId, animationPhase);
  }

  const hoverPos = hoveredId ? projected.get(hoveredId) : null;
  if (hoverPos) {
    drawHoverRipple(ctx, hoverPos, animationPhase);
  }

  const sorted = [...artifacts].sort((a, b) => {
    const za = projected.get(a.id)?.z ?? 0;
    const zb = projected.get(b.id)?.z ?? 0;
    return za - zb;
  });

  for (const artifact of sorted) {
    const pos = projected.get(artifact.id);
    if (!pos || pos.z < -0.35) continue;

    const isHero = artifact.id === heroId;
    const isFinal = scene.finalIds.has(artifact.id);
    const isCenter = artifact.id === centerId;
    const isHovered = artifact.id === hoveredId;
    const isFocus = isCenter || isHovered;
    const level = levelFor(artifact.id);
    const phase = pulseNodePhase(artifact.id);
    const breath = 0.5 + 0.5 * Math.sin(animationPhase * 0.004 + phase);
    const dist = localDistById.get(artifact.id) ?? 0.5;
    const reveal = revealFactor(dist, revealProgress);
    const neighbor = neighborBoost(artifact.id, focusId, projected);
    const complexity = scene.complexityScoreById.get(artifact.id) ?? 1;
    const influence = scene.influenceScoreById.get(artifact.id) ?? 0;
    const versionCount = scene.versionCountById.get(artifact.id) ?? 1;
    const complexityBoost = normalizedScore(complexity, 1, maxComplexity);
    const influenceBoost = normalizedScore(influence, 0, maxInfluence);
    const versionBoost = normalizedScore(versionCount, 1, maxVersionCount);

    if (reveal <= 0.01) continue;

    const visual = nodeVisualStyle(appearance, {
      level,
      isCenter,
      isHead: headIds.has(artifact.id),
      isHistorical: historicalIds.has(artifact.id),
      isBroken: !artifact.reachable,
      depthScale: pos.scale,
    });

    const semanticScale =
      1 +
      complexityBoost * 0.28 +
      influenceBoost * 0.14 +
      versionBoost * 0.08 +
      (isFinal ? 0.12 : 0) +
      (isHero ? 0.4 : 0);
    const radius =
      visual.radius * 0.42 * semanticScale * (0.82 + breath * 0.18) * neighbor * reveal;
    const nodeAlpha =
      reveal * visual.opacity * Math.min(neighbor, 1.35) * (1 + influenceBoost * 0.14);

    if (isHero) {
      drawHeroGlow(ctx, pos.x, pos.y, radius, breath, reveal * (0.8 + influenceBoost * 0.25));
    }

    if (isFocus) {
      const glowR = radius * 4.5;
      const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowR);
      glow.addColorStop(0, "rgba(120, 210, 255, 0.35)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = nodeAlpha;
    ctx.fillStyle = visual.fill;
    ctx.strokeStyle = visual.stroke;
    ctx.lineWidth = isFocus ? visual.strokeWidth : Math.max(0.6, visual.strokeWidth * 0.65);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    drawVersionHalo(
      ctx,
      pos.x,
      pos.y,
      radius,
      Math.min(4, Math.max(0, versionCount - 1)),
      reveal * (0.28 + versionBoost * 0.26),
    );

    if (isHero) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.9, reveal * 0.92);
      ctx.fillStyle = "rgba(255, 243, 205, 0.95)";
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(2.2, radius * 0.34), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (isFocus) {
      ctx.globalAlpha = reveal;
      ctx.font = "500 11px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0, 4, 12, 0.92)";
      ctx.fillStyle = "#e8f4ff";
      const ty = pos.y - radius - 6;
      ctx.strokeText(artifact.displayName, pos.x, ty);
      ctx.fillText(artifact.displayName, pos.x, ty);
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

export function hitTestPulseNode(
  projected: Map<string, ProjectedNode>,
  lx: number,
  ly: number,
  radius = 14,
): string | null {
  let best: string | null = null;
  let bestZ = -Infinity;
  for (const [id, pos] of projected) {
    if (pos.z < -0.35) continue;
    const d = Math.hypot(pos.x - lx, pos.y - ly);
    const hitR = radius * (0.75 + pos.scale * 0.35);
    if (d <= hitR && pos.z >= bestZ) {
      bestZ = pos.z;
      best = id;
    }
  }
  return best;
}
