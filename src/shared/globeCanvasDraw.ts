import type { DisplayEdge } from "./graph";
import type { GraphAppearanceSettings } from "./graphAppearance";
import type { ProjectedNode } from "./globeLayout";
import {
  globeAtmosphereCenter,
  globeWireframePolylines,
  globeViewBoxRect,
  projectGlobePoint,
  type Vec3,
} from "./globeLayout";
import type { ZoomTransform } from "./useZoomPan";
import { edgeStrokeStyle, nodeVisualStyle } from "../components/graphStyle";
import type { StarGrowthScene } from "./starGrowthScene";
import type { ArtifactView } from "./types";
import { fitTransform } from "./globeCanvasCoords";

export interface GlobeDrawInput {
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
  localPositions: Map<string, Vec3>;
  edges: DisplayEdge[];
  artifacts: ArtifactView[];
  headIds: Set<string>;
  historicalIds: Set<string>;
  centerId: string | null;
  hoveredId: string | null;
  draggingId: string | null;
  interactionMode?: "idle" | "rotate" | "pan";
  animationPhase?: number;
  scene: StarGrowthScene;
  levelFor: (id: string) => number;
}

function setDash(ctx: CanvasRenderingContext2D, dash?: string) {
  if (!dash) {
    ctx.setLineDash([]);
    return;
  }
  const parts = dash.split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));
  ctx.setLineDash(parts.length ? parts : []);
}

function applySceneTransform(
  ctx: CanvasRenderingContext2D,
  displayW: number,
  displayH: number,
  logicalW: number,
  logicalH: number,
  zoom: ZoomTransform,
) {
  const vb = globeViewBoxRect(logicalW, logicalH);
  const { fit, offsetX, offsetY } = fitTransform(displayW, displayH, vb);
  ctx.translate(offsetX, offsetY);
  ctx.scale(fit, fit);
  ctx.translate(zoom.x, zoom.y);
  ctx.scale(zoom.k, zoom.k);
}

export function drawGlobeFrame(input: GlobeDrawInput) {
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
    localPositions,
    edges,
    artifacts,
    headIds,
    historicalIds,
    centerId,
    hoveredId,
    draggingId,
    interactionMode = "idle",
    scene,
    levelFor,
  } = input;
  const isInteracting = interactionMode !== "idle";
  const heroId = scene.heroId;
  const maxVersionCount = Math.max(1, ...scene.versionCountById.values());
  const maxInfluence = Math.max(1, ...scene.influenceScoreById.values());
  const maxComplexity = Math.max(1, ...scene.complexityScoreById.values());
  const majorNodeIds = pickMajorNodeIds(scene, artifacts, heroId);

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  const sceneBg = ctx.createLinearGradient(0, 0, 0, displayHeight);
  sceneBg.addColorStop(0, "#081018");
  sceneBg.addColorStop(0.45, appearance.globe.background);
  sceneBg.addColorStop(1, "#04070c");
  ctx.fillStyle = sceneBg;
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  ctx.save();
  applySceneTransform(ctx, displayWidth, displayHeight, logicalWidth, logicalHeight, zoom);

  const atmosphere = globeAtmosphereCenter(rotY, rotX, logicalWidth, logicalHeight);
  const glowR = projectScale * 1.08 * atmosphere.scale;
  drawCosmicDust(ctx, atmosphere.x, atmosphere.y, glowR, scene.heroId);
  drawNebulaField(ctx, atmosphere.x, atmosphere.y, glowR);
  const grad = ctx.createRadialGradient(
    atmosphere.x,
    atmosphere.y,
    glowR * 0.1,
    atmosphere.x,
    atmosphere.y,
    glowR,
  );
  grad.addColorStop(0, hexWithAlpha(appearance.globe.atmosphere, 0.18));
  grad.addColorStop(0.7, hexWithAlpha(appearance.globe.atmosphere, isInteracting ? 0.01 : 0.04));
  grad.addColorStop(1, hexWithAlpha(appearance.globe.background, 0));
  ctx.fillStyle = grad;
  if (!isInteracting) {
    ctx.beginPath();
    ctx.arc(atmosphere.x, atmosphere.y, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  const coreGlow = ctx.createRadialGradient(atmosphere.x, atmosphere.y, 0, atmosphere.x, atmosphere.y, glowR * 0.72);
  coreGlow.addColorStop(0, "rgba(255, 219, 140, 0.045)");
  coreGlow.addColorStop(0.55, "rgba(87, 193, 157, 0.035)");
  coreGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = coreGlow;
  ctx.beginPath();
  ctx.arc(atmosphere.x, atmosphere.y, glowR * 0.72, 0, Math.PI * 2);
  ctx.fill();
  drawOrbitalBands(ctx, atmosphere.x, atmosphere.y, glowR);

  drawShellMesh(ctx, localPositions, projected, isInteracting, "back");
  drawGraphEdges(ctx, {
    edges,
    projected,
    majorNodeIds,
    centerId,
    hoveredId,
    appearance,
    isInteracting,
    cx: atmosphere.x,
    cy: atmosphere.y,
    layer: "back",
  });
  drawSphereVolume(ctx, atmosphere.x, atmosphere.y, glowR, isInteracting);
  drawGlobeShell(ctx, rotY, rotX, logicalWidth, logicalHeight, appearance.globe.wireframe, isInteracting, atmosphere.x, atmosphere.y, glowR);
  drawShellMesh(ctx, localPositions, projected, isInteracting, "front");
  drawGraphEdges(ctx, {
    edges,
    projected,
    majorNodeIds,
    centerId,
    hoveredId,
    appearance,
    isInteracting,
    cx: atmosphere.x,
    cy: atmosphere.y,
    layer: "front",
  });
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

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
    const isHistorical = historicalIds.has(artifact.id);
    const isMajor = majorNodeIds.has(artifact.id);
    const isFocus = isCenter || isHovered || isMajor;
    if (isInteracting && !isFocus && pos.z < 0.08) continue;

    const level = levelFor(artifact.id);
    const visual = nodeVisualStyle(input.appearance, {
      level,
      isCenter,
      isHead: headIds.has(artifact.id),
      isHistorical: historicalIds.has(artifact.id),
      isBroken: !artifact.reachable,
      depthScale: pos.scale,
    });

    const depthOpacity = pos.z < 0 ? 0.18 + (pos.z + 1) * 0.34 : 0.9 + pos.z * 0.22;
    const nodeOpacity = isInteracting
      ? isFocus
        ? Math.min(0.92, visual.opacity)
        : Math.min(0.2, visual.opacity * 0.3)
      : visual.opacity * depthOpacity;

    const versionCount = scene.versionCountById.get(artifact.id) ?? 1;
    const influence = scene.influenceScoreById.get(artifact.id) ?? 0;
    const complexity = scene.complexityScoreById.get(artifact.id) ?? 0;
    const versionBoost = Math.max(0, (versionCount - 1) / maxVersionCount);
    const influenceBoost = Math.max(0, influence / maxInfluence);
    const complexityBoost = Math.max(0, complexity / maxComplexity);

    const perspectiveBoost = pos.z < 0 ? 0.78 + (pos.z + 1) * 0.2 : 1 + pos.z * 0.28;
    const nodeRadius =
      (isInteracting && !isFocus ? visual.radius * 0.82 : visual.radius) *
      perspectiveBoost *
      (1 + versionBoost * 0.04 + influenceBoost * 0.05 + complexityBoost * 0.05 + (isMajor ? 0.2 : 0) + (isHero ? 0.16 : 0));
    const strokeColor =
      isInteracting && !isFocus ? colorWithAlpha(visual.stroke, 0.28) : visual.stroke;
    const strokeWidth =
      isInteracting && !isFocus
        ? Math.max(0.8, visual.strokeWidth * 0.55)
        : visual.strokeWidth;

    if (isHero) {
      drawHeroAura(ctx, pos.x, pos.y, nodeRadius, nodeOpacity);
    }
    if (isFinal || isMajor) {
      drawFinalFlare(ctx, pos.x, pos.y, nodeRadius, nodeOpacity);
    }
    if (isMajor || isHero) {
      drawComplexityHalo(ctx, pos.x, pos.y, nodeRadius, complexityBoost, nodeOpacity, isFocus || isHero);
    }

    ctx.globalAlpha = nodeOpacity;
    ctx.fillStyle = isHistorical && !isMajor ? colorWithAlpha(visual.fill, 0.55) : visual.fill;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.shadowBlur = pos.z > 0 ? 10 + pos.z * 8 : 0;
    ctx.shadowColor = pos.z > 0 ? "rgba(244, 214, 148, 0.22)" : "rgba(0,0,0,0)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);
    ctx.fill();
    if (isHovered || isCenter || draggingId === artifact.id) {
      ctx.lineWidth = strokeWidth + 1;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    drawNodeCore(ctx, pos.x, pos.y, nodeRadius, {
      fill: visual.fill,
      alpha: nodeOpacity,
      isHead: headIds.has(artifact.id),
      isHistorical,
      isFinal,
      isBroken: !artifact.reachable,
      isMajor,
    });

    if (isMajor || isHero) {
      drawVersionRings(ctx, pos.x, pos.y, nodeRadius, versionCount - 1, nodeOpacity, isHero);
      drawIterationSatellites(ctx, pos.x, pos.y, nodeRadius, versionCount, influenceBoost, nodeOpacity);
      drawResourceTicks(ctx, pos.x, pos.y, nodeRadius, complexityBoost, versionBoost, nodeOpacity);
      drawStarburst(ctx, pos.x, pos.y, nodeRadius, nodeOpacity, isHero ? 10 : 6);
    }

    const showLabel =
      (isCenter || isHovered || draggingId === artifact.id) && pos.z > -0.05;
    if (showLabel) {
      ctx.globalAlpha = 1;
      ctx.font = "500 11px Georgia, Times, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(11, 16, 32, 0.92)";
      ctx.fillStyle = "#f1f5f9";
      const ty = pos.y - nodeRadius - 8;
      ctx.strokeText(artifact.displayName, pos.x, ty);
      ctx.fillText(artifact.displayName, pos.x, ty);
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawOrbitalBands(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(96, 168, 147, 0.08)";
  ctx.lineWidth = 0.85;
  for (let i = 0; i < 3; i += 1) {
    const rx = radius * (0.56 + i * 0.12);
    const ry = radius * (0.16 + i * 0.035);
    ctx.globalAlpha = 0.14 - i * 0.03;
    ctx.beginPath();
    ctx.ellipse(x, y + radius * (0.03 - i * 0.015), rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNebulaField(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) {
  const haze = ctx.createRadialGradient(x, y, radius * 0.12, x, y, radius * 1.08);
  haze.addColorStop(0, "rgba(41, 83, 77, 0.18)");
  haze.addColorStop(0.45, "rgba(24, 60, 60, 0.1)");
  haze.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.save();
  ctx.fillStyle = haze;
  ctx.beginPath();
  ctx.ellipse(x, y, radius * 1.08, radius * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSphereVolume(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  isInteracting: boolean,
) {
  ctx.save();
  const body = ctx.createRadialGradient(
    x - radius * 0.34,
    y - radius * 0.36,
    radius * 0.05,
    x,
    y,
    radius,
  );
  body.addColorStop(0, "rgba(165, 211, 182, 0.26)");
  body.addColorStop(0.2, "rgba(98, 146, 130, 0.22)");
  body.addColorStop(0.55, "rgba(40, 75, 73, 0.2)");
  body.addColorStop(0.82, "rgba(11, 24, 33, 0.3)");
  body.addColorStop(1, "rgba(2, 7, 13, 0.45)");
  ctx.fillStyle = body;
  ctx.beginPath();
    ctx.arc(x, y, radius * 0.94, 0, Math.PI * 2);
  ctx.fill();

  const terminator = ctx.createLinearGradient(
    x - radius * 0.9,
    y - radius * 0.65,
    x + radius * 0.95,
    y + radius * 0.75,
  );
  terminator.addColorStop(0, "rgba(255, 245, 214, 0)");
  terminator.addColorStop(0.38, "rgba(255, 240, 196, 0.04)");
  terminator.addColorStop(0.54, "rgba(11, 18, 27, 0.02)");
  terminator.addColorStop(0.72, "rgba(6, 12, 20, 0.18)");
  terminator.addColorStop(1, "rgba(2, 5, 10, 0.34)");
  ctx.fillStyle = terminator;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.94, 0, Math.PI * 2);
  ctx.fill();

  const shadow = ctx.createRadialGradient(
    x + radius * 0.22,
    y + radius * 0.18,
    radius * 0.1,
    x + radius * 0.18,
    y + radius * 0.18,
    radius * 0.88,
  );
  shadow.addColorStop(0, "rgba(0,0,0,0)");
  shadow.addColorStop(0.62, "rgba(0,0,0,0.06)");
  shadow.addColorStop(1, isInteracting ? "rgba(0,0,0,0.16)" : "rgba(0,0,0,0.28)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.94, 0, Math.PI * 2);
  ctx.fill();

  const frontHighlight = ctx.createRadialGradient(
    x - radius * 0.28,
    y - radius * 0.3,
    radius * 0.01,
    x - radius * 0.28,
    y - radius * 0.3,
    radius * 0.3,
  );
  frontHighlight.addColorStop(0, "rgba(255, 238, 197, 0.18)");
  frontHighlight.addColorStop(1, "rgba(255, 238, 197, 0)");
  ctx.fillStyle = frontHighlight;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.94, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCosmicDust(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  seed: string | null,
) {
  const seedValue = hashString(seed ?? "org-globe");
  ctx.save();
  for (let i = 0; i < 84; i += 1) {
    const t = i / 64;
    const angle = ((seedValue * 0.0007) + t) * Math.PI * 9.4;
    const dist = radius * (0.28 + ((seedValue + i * 73) % 1000) / 1000 * 0.72);
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle * 1.13) * dist * 0.55;
    const starR = 0.35 + (((seedValue >> (i % 8)) + i) % 3) * 0.45;
    ctx.globalAlpha = 0.04 + ((i % 5) / 5) * 0.1;
    ctx.fillStyle = i % 7 === 0 ? "rgba(255, 211, 126, 1)" : "rgba(146, 205, 188, 1)";
    ctx.beginPath();
    ctx.arc(x, y, starR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGlobeShell(
  ctx: CanvasRenderingContext2D,
  rotY: number,
  rotX: number,
  logicalWidth: number,
  logicalHeight: number,
  wireColor: string,
  isInteracting: boolean,
  cx: number,
  cy: number,
  radius: number,
) {
  const paths = globeWireframePolylines(rotY, rotX, logicalWidth, logicalHeight);
  ctx.save();
  const rimGlow = ctx.createRadialGradient(cx, cy, radius * 0.72, cx, cy, radius * 1.02);
  rimGlow.addColorStop(0, "rgba(0,0,0,0)");
  rimGlow.addColorStop(0.8, "rgba(188, 165, 107, 0.05)");
  rimGlow.addColorStop(1, "rgba(222, 195, 126, 0.2)");
  ctx.strokeStyle = rimGlow;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.94, 0, Math.PI * 2);
  ctx.stroke();

  const silhouette = ctx.createLinearGradient(
    cx - radius,
    cy - radius * 0.75,
    cx + radius,
    cy + radius * 0.75,
  );
  silhouette.addColorStop(0, "rgba(250, 227, 171, 0.42)");
  silhouette.addColorStop(0.4, "rgba(214, 187, 122, 0.22)");
  silhouette.addColorStop(0.72, "rgba(133, 118, 86, 0.14)");
  silhouette.addColorStop(1, "rgba(78, 74, 64, 0.1)");
  ctx.strokeStyle = silhouette;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.94, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 232, 183, 0.15)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(cx - radius * 0.02, cy - radius * 0.02, radius * 0.905, -Math.PI * 0.88, Math.PI * 0.15);
  ctx.stroke();

  ctx.strokeStyle = wireColor;
  ctx.lineCap = "round";
  ctx.globalAlpha = isInteracting ? 0.004 : 0.018;
  ctx.lineWidth = 0.55;
  for (const d of paths) {
    strokeSvgPath(ctx, d);
  }
  ctx.globalAlpha = isInteracting ? 0.01 : 0.05;
  ctx.lineWidth = 0.22;
  for (const d of paths) {
    strokeSvgPath(ctx, d);
  }
  ctx.restore();
}

function drawShellMesh(
  ctx: CanvasRenderingContext2D,
  localPositions: Map<string, Vec3>,
  projected: Map<string, ProjectedNode>,
  isInteracting: boolean,
  layer: "back" | "front",
) {
  const ids = [...localPositions.keys()];
  if (ids.length < 2) return;
  const seen = new Set<string>();
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < ids.length; i += 1) {
    const fromId = ids[i];
    const fromLocal = localPositions.get(fromId);
    const from = projected.get(fromId);
    if (!fromLocal || !from || from.z < -0.42) continue;
    const neighbors: Array<{ id: string; score: number }> = [];
    for (let j = 0; j < ids.length; j += 1) {
      if (i === j) continue;
      const toId = ids[j];
      const toLocal = localPositions.get(toId);
      const to = projected.get(toId);
      if (!toLocal || !to || to.z < -0.42) continue;
      const dot = fromLocal.x * toLocal.x + fromLocal.y * toLocal.y + fromLocal.z * toLocal.z;
      neighbors.push({ id: toId, score: dot });
    }
    neighbors.sort((a, b) => b.score - a.score);
    const nearest = neighbors.slice(0, 4);
    for (const neighbor of nearest) {
      const key = fromId < neighbor.id ? `${fromId}|${neighbor.id}` : `${neighbor.id}|${fromId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const to = projected.get(neighbor.id);
      if (!to) continue;
      const depth = (from.z + to.z) / 2;
      const isFront = depth >= 0;
      if ((layer === "front" && !isFront) || (layer === "back" && isFront)) continue;
      const frontness = Math.max(0, (from.z + to.z + 2) / 4);
      const alpha = layer === "front"
        ? (isInteracting ? 0.03 : 0.1 + frontness * 0.14)
        : (isInteracting ? 0.01 : 0.025 + frontness * 0.03);
      ctx.strokeStyle = `rgba(237, 200, 122, ${alpha})`;
      ctx.lineWidth = layer === "front" ? 0.42 + frontness * 0.36 : 0.24 + frontness * 0.16;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawGraphEdges(
  ctx: CanvasRenderingContext2D,
  input: {
    edges: DisplayEdge[];
    projected: Map<string, ProjectedNode>;
    majorNodeIds: Set<string>;
    centerId: string | null;
    hoveredId: string | null;
    appearance: GraphAppearanceSettings;
    isInteracting: boolean;
    cx: number;
    cy: number;
    layer: "back" | "front";
  },
) {
  const { edges, projected, majorNodeIds, centerId, hoveredId, appearance, isInteracting, cx, cy, layer } = input;
  for (const rel of edges) {
    const from = projected.get(rel.from);
    const to = projected.get(rel.to);
    if (!from || !to) continue;
    if (isInteracting && !shouldDrawDuringInteraction(rel, from.z, to.z, centerId, hoveredId)) continue;
    if (!majorNodeIds.has(rel.from) && !majorNodeIds.has(rel.to) && !hoveredId && !centerId) continue;
    const depth = (from.z + to.z) / 2;
    const isFront = depth >= 0;
    if ((layer === "front" && !isFront) || (layer === "back" && isFront)) continue;
    const depthFade = (from.scale + to.scale) / 2;
    const style = edgeStrokeStyle(rel, appearance, depthFade);
    drawOrbitalEdge(
      ctx,
      rel,
      from,
      to,
      style,
      isInteracting,
      cx,
      cy,
      layer === "back" ? 0.32 : 1,
    );
  }
}

function drawOrbitalEdge(
  ctx: CanvasRenderingContext2D,
  rel: DisplayEdge,
  from: ProjectedNode,
  to: ProjectedNode,
  style: ReturnType<typeof edgeStrokeStyle>,
  isInteracting: boolean,
  cx: number,
  cy: number,
  layerAlpha = 1,
) {
  const alpha = (isInteracting ? Math.min(style.opacity * 0.45, 0.28) : style.opacity) * layerAlpha;
  const frontness = Math.max(0, (from.z + to.z + 2) / 4);
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const edgeSeed = hashString(`${rel.from}:${rel.to}:${rel.kind}`);
  const nx = -dy / length;
  const ny = dx / length;
  const bendSign = edgeSeed % 2 === 0 ? 1 : -1;
  const bend = Math.min(48, length * (0.06 + ((edgeSeed % 17) / 17) * 0.18)) * bendSign;
  const centerPull = 0.08 + ((edgeSeed % 11) / 11) * 0.12;
  const cpx = mx + nx * bend + (cx - mx) * centerPull;
  const cpy = my + ny * bend + (cy - my) * centerPull;

  ctx.save();
  setDash(ctx, style.strokeDasharray);

  if (!isInteracting && (rel.kind === "part_of" || rel.kind === "version")) {
    ctx.strokeStyle = colorWithAlpha(style.stroke, 0.18 * frontness);
    ctx.lineWidth = style.strokeWidth * 1.25;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(cpx, cpy, to.x, to.y);
    ctx.stroke();
  }

  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.strokeWidth * (0.62 + frontness * 0.14);
  ctx.globalAlpha = alpha * (0.3 + frontness * 0.14);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(cpx, cpy, to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawHeroAura(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 5.2);
  glow.addColorStop(0, `rgba(255, 228, 157, ${0.26 * alpha})`);
  glow.addColorStop(0.5, `rgba(98, 202, 171, ${0.14 * alpha})`);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius * 5.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFinalFlare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
) {
  ctx.save();
  ctx.strokeStyle = `rgba(255, 231, 173, ${Math.min(0.46, alpha * 0.6)})`;
  ctx.lineWidth = 1.25;
  ctx.lineCap = "round";
  for (let i = 0; i < 4; i += 1) {
    const angle = (Math.PI / 4) * i;
    const rx = Math.cos(angle) * radius * 2.8;
    const ry = Math.sin(angle) * radius * 2.8;
    ctx.globalAlpha = alpha * (0.75 - i * 0.12);
    ctx.beginPath();
    ctx.moveTo(x - rx, y - ry);
    ctx.lineTo(x + rx, y + ry);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVersionRings(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  extraRings: number,
  alpha: number,
  isHero: boolean,
) {
  const ringCount = Math.min(isHero ? 4 : 3, Math.max(0, extraRings));
  if (ringCount <= 0) return;
  ctx.save();
  ctx.strokeStyle = `rgba(228, 182, 92, ${Math.min(0.38, alpha * 0.42)})`;
  ctx.lineWidth = 0.9;
  for (let i = 0; i < ringCount; i += 1) {
    ctx.globalAlpha = alpha * (1 - i / (ringCount + 1));
    ctx.beginPath();
    ctx.arc(x, y, radius + 4 + i * 3.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawIterationSatellites(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  versionCount: number,
  influenceBoost: number,
  alpha: number,
) {
  const satelliteCount = Math.min(4, Math.max(0, versionCount - 2));
  if (satelliteCount <= 0) return;
  ctx.save();
  for (let i = 0; i < satelliteCount; i += 1) {
    const angle = -Math.PI * 0.45 + i * (Math.PI / Math.max(2, satelliteCount));
    const orbitR = radius + 7 + i * 3.6;
    const sx = x + Math.cos(angle) * orbitR * (1.1 + influenceBoost * 0.35);
    const sy = y + Math.sin(angle) * orbitR * 0.72;
    ctx.globalAlpha = Math.min(0.58, alpha * 0.45);
    ctx.fillStyle = "rgba(249, 210, 122, 1)";
    ctx.beginPath();
    ctx.arc(sx, sy, 1.2 + i * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawComplexityHalo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  complexityBoost: number,
  alpha: number,
  emphasize: boolean,
) {
  if (complexityBoost < 0.08) return;
  const shardCount = Math.min(10, 3 + Math.round(complexityBoost * 8));
  ctx.save();
  ctx.strokeStyle = `rgba(131, 223, 188, ${Math.min(0.34, alpha * (emphasize ? 0.42 : 0.24))})`;
  ctx.lineWidth = emphasize ? 1.1 : 0.8;
  for (let i = 0; i < shardCount; i += 1) {
    const angle = (Math.PI * 2 * i) / shardCount;
    const inner = radius + 2.5;
    const outer = radius + 4.5 + complexityBoost * 10 + (i % 2) * 2.8;
    ctx.globalAlpha = alpha * (0.35 + (i % 3) * 0.12);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNodeCore(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  opts: {
    fill: string;
    alpha: number;
    isHead: boolean;
    isHistorical: boolean;
    isFinal: boolean;
    isBroken: boolean;
    isMajor: boolean;
  },
) {
  const { fill, alpha, isHead, isHistorical, isFinal, isBroken, isMajor } = opts;
  const coreR = radius * (isHistorical ? 0.4 : isMajor ? 0.5 : 0.46);
  const glow = ctx.createRadialGradient(x - radius * 0.16, y - radius * 0.18, 0, x, y, radius);
  glow.addColorStop(0, `rgba(255,255,255,${Math.min(0.56, alpha * 0.7)})`);
  glow.addColorStop(0.45, colorWithAlpha(fill, Math.min(0.45, alpha * 0.48)));
  glow.addColorStop(1, colorWithAlpha(fill, 0));
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius * (isFinal || isMajor ? 1.16 : 0.9), 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = alpha * (isHistorical ? 0.64 : 0.86);
  ctx.fillStyle = isBroken ? "rgba(58, 17, 10, 0.92)" : isFinal ? "rgba(255, 233, 179, 0.95)" : "rgba(249, 229, 178, 0.88)";
  ctx.beginPath();
  ctx.arc(x, y, coreR, 0, Math.PI * 2);
  ctx.fill();

  if (isHead || isFinal || isMajor) {
    ctx.strokeStyle = isFinal ? "rgba(255, 224, 140, 0.92)" : "rgba(253, 226, 168, 0.72)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.62, -Math.PI * 0.1, Math.PI * 1.1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawResourceTicks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  complexityBoost: number,
  versionBoost: number,
  alpha: number,
) {
  const tickCount = Math.min(6, Math.max(0, Math.round(complexityBoost * 5 + versionBoost * 2)));
  if (tickCount <= 1) return;
  ctx.save();
  ctx.strokeStyle = `rgba(255, 208, 116, ${Math.min(0.34, alpha * 0.34)})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < tickCount; i += 1) {
    const angle = Math.PI * 0.2 + i * ((Math.PI * 0.6) / Math.max(1, tickCount - 1));
    const inner = radius + 6.5;
    const outer = inner + 4;
    ctx.globalAlpha = alpha * (0.3 + (i % 2) * 0.12);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * inner, y - Math.sin(angle) * inner * 0.62);
    ctx.lineTo(x + Math.cos(angle) * outer, y - Math.sin(angle) * outer * 0.62);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStarburst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  rays: number,
) {
  ctx.save();
  ctx.strokeStyle = `rgba(255, 210, 132, ${Math.min(0.24, alpha * 0.22)})`;
  ctx.lineWidth = 0.7;
  for (let i = 0; i < rays; i += 1) {
    const angle = (Math.PI * 2 * i) / rays;
    const inner = radius + 0.8;
    const outer = radius + 4 + (i % 2) * 2.2;
    ctx.globalAlpha = alpha * (0.18 + (i % 3) * 0.05);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

function strokeSvgPath(ctx: CanvasRenderingContext2D, d: string) {
  const tokens = d.match(/[ML][^ML]+/g);
  if (!tokens?.length) return;
  ctx.beginPath();
  for (const token of tokens) {
    const cmd = token[0];
    const [x, y] = token.slice(1).trim().split(",").map(Number);
    if (cmd === "M") ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (h.length >= 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hex;
}

function colorWithAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) return hexWithAlpha(color, alpha);
  const rgba = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(",").map((part) => part.trim());
    if (parts.length >= 3) {
      return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
    }
  }
  return color;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pickMajorNodeIds(
  scene: StarGrowthScene,
  artifacts: ArtifactView[],
  heroId: string | null,
): Set<string> {
  const scored = [...artifacts].map((artifact) => ({
    id: artifact.id,
    score:
      (scene.influenceScoreById.get(artifact.id) ?? 0) * 1.2 +
      (scene.complexityScoreById.get(artifact.id) ?? 0) +
      (scene.versionCountById.get(artifact.id) ?? 1) * 0.8 +
      (scene.finalIds.has(artifact.id) ? 8 : 0) +
      (artifact.id === heroId ? 10 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return new Set(scored.slice(0, Math.min(18, Math.max(8, Math.round(artifacts.length * 0.12)))).map((item) => item.id));
}

/** Hit-test in logical coordinates. */
export function hitTestGlobeNode(
  projected: Map<string, ProjectedNode>,
  lx: number,
  ly: number,
  radius = 18,
): string | null {
  let best: string | null = null;
  let bestZ = -Infinity;
  for (const [id, pos] of projected) {
    if (pos.z < -0.35) continue;
    const d = Math.hypot(pos.x - lx, pos.y - ly);
    if (d <= radius && pos.z >= bestZ) {
      bestZ = pos.z;
      best = id;
    }
  }
  return best;
}

export function buildProjectedMap(
  local: Map<string, Vec3>,
  rotY: number,
  rotX: number,
  width: number,
  height: number,
  projectScale: number,
): Map<string, ProjectedNode> {
  const out = new Map<string, ProjectedNode>();
  local.forEach((v, id) => {
    out.set(id, projectGlobePoint(v, rotY, rotX, width, height, 2.8, projectScale));
  });
  return out;
}

function shouldDrawDuringInteraction(
  rel: DisplayEdge,
  fromZ: number,
  toZ: number,
  centerId: string | null,
  hoveredId: string | null,
): boolean {
  const touchesFocus =
    (centerId != null && (rel.from === centerId || rel.to === centerId)) ||
    (hoveredId != null && (rel.from === hoveredId || rel.to === hoveredId));
  if (touchesFocus) return true;
  if (rel.kind === "part_of" || rel.kind === "version") return fromZ > -0.18 && toZ > -0.18;
  return false;
}
