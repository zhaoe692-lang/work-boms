import type { DisplayEdge } from "./graph";
import type { GraphAppearanceSettings } from "./graphAppearance";
import { fitTransform } from "./globeCanvasCoords";
import type { ProjectedNode } from "./globeLayout";
import type { MyceliumBranch, MyceliumCluster, MyceliumLayout, MyceliumPoint } from "./myceliumLayout";
import { pulseNodePhase, pulseViewBoxRect } from "./pulseLayout";
import type { StarGrowthScene } from "./starGrowthScene";
import type { ZoomTransform } from "./useZoomPan";
import type { ArtifactView } from "./types";

export interface MyceliumDrawInput {
  ctx: CanvasRenderingContext2D;
  displayWidth: number;
  displayHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  zoom: ZoomTransform;
  appearance: GraphAppearanceSettings;
  projectScale: number;
  projected: Map<string, ProjectedNode>;
  projectedRoot: ProjectedNode;
  layout: MyceliumLayout;
  projectedBranches: Array<MyceliumBranch & { projFrom: ProjectedNode; projTo: ProjectedNode; projCtrl: ProjectedNode }>;
  projectedClusters: Array<MyceliumCluster & { projCx: number; projCy: number; projRadius: number }>;
  localDistById: Map<string, number>;
  edges: DisplayEdge[];
  artifacts: ArtifactView[];
  centerId: string | null;
  hoveredId: string | null;
  animationPhase: number;
  revealProgress: number;
  scene: StarGrowthScene;
}

const NEIGHBOR_RADIUS = 120;

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
  p: MyceliumPoint,
  width: number,
  height: number,
  projectScale: number,
): { x: number; y: number } {
  return {
    x: width / 2 + p.x * projectScale,
    y: height / 2 + p.y * projectScale,
  };
}

function branchPath(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  control: { x: number; y: number },
  to: { x: number; y: number },
) {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
}

function drawNebulaBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  phase: number,
  reveal: number,
) {
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, "#060d18");
  base.addColorStop(0.45, "#08121c");
  base.addColorStop(1, "#03060c");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const drift = Math.sin(phase * 0.00008) * w * 0.02;
  const patches = [
    { cx: w * 0.22 + drift, cy: h * 0.18, rx: w * 0.42, ry: h * 0.28, hue: "teal" },
    { cx: w * 0.78 - drift, cy: h * 0.22, rx: w * 0.38, ry: h * 0.24, hue: "teal" },
    { cx: w * 0.5, cy: h * 0.42, rx: w * 0.55, ry: h * 0.35, hue: "gold" },
    { cx: w * 0.5, cy: h * 0.88, rx: w * 0.3, ry: h * 0.18, hue: "root" },
  ];

  for (const patch of patches) {
    const g = ctx.createRadialGradient(patch.cx, patch.cy, 0, patch.cx, patch.cy, Math.max(patch.rx, patch.ry));
    if (patch.hue === "teal") {
      g.addColorStop(0, `rgba(28, 118, 128, ${0.22 * reveal})`);
      g.addColorStop(0.45, `rgba(12, 52, 62, ${0.14 * reveal})`);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
    } else if (patch.hue === "gold") {
      g.addColorStop(0, `rgba(72, 58, 28, ${0.12 * reveal})`);
      g.addColorStop(0.5, `rgba(24, 40, 36, ${0.08 * reveal})`);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
    } else {
      g.addColorStop(0, `rgba(255, 196, 96, ${0.1 * reveal})`);
      g.addColorStop(0.55, `rgba(80, 60, 24, ${0.06 * reveal})`);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(patch.cx, patch.cy, patch.rx, patch.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  for (let i = 0; i < 80; i += 1) {
    const x = ((i * 137) % 1000) / 1000 * w;
    const y = ((i * 89) % 1000) / 1000 * h;
    const twinkle = 0.35 + 0.65 * Math.sin(phase * 0.0012 + i * 1.7);
    ctx.globalAlpha = 0.04 * twinkle * reveal;
    ctx.fillStyle = i % 11 === 0 ? "rgba(255, 220, 150, 0.9)" : "rgba(180, 230, 255, 0.8)";
    ctx.beginPath();
    ctx.arc(x, y, 0.4 + (i % 3) * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRootFlare(
  ctx: CanvasRenderingContext2D,
  root: ProjectedNode,
  layout: MyceliumLayout,
  projectScale: number,
  reveal: number,
  phase: number,
) {
  const breath = 0.5 + 0.5 * Math.sin(phase * 0.0025);

  for (const filament of layout.rootFilaments) {
    const len = filament.length * projectScale * (0.85 + breath * 0.15);
    const ex = root.x + Math.cos(filament.angle) * len;
    const ey = root.y + Math.sin(filament.angle) * len * 0.55;
    const cx = root.x + Math.cos(filament.angle + 0.3 * filament.curl) * len * 0.45;
    const cy = root.y + Math.sin(filament.angle) * len * 0.28;

    ctx.save();
    ctx.strokeStyle = `rgba(255, 210, 120, ${0.22 * reveal})`;
    ctx.lineWidth = 0.6 + (filament.curl % 1) * 0.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
    ctx.restore();
  }

  const layers = [
    { r: projectScale * 0.34, a: 0.14 },
    { r: projectScale * 0.2, a: 0.28 },
    { r: projectScale * 0.1, a: 0.5 },
    { r: projectScale * 0.045, a: 0.95 },
  ];

  for (const layer of layers) {
    const g = ctx.createRadialGradient(root.x, root.y, 0, root.x, root.y, layer.r * (1 + breath * 0.08));
    g.addColorStop(0, `rgba(255, 248, 220, ${layer.a * reveal})`);
    g.addColorStop(0.35, `rgba(255, 210, 120, ${layer.a * 0.55 * reveal})`);
    g.addColorStop(0.7, `rgba(120, 220, 180, ${layer.a * 0.2 * reveal})`);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(root.x, root.y, layer.r * (1 + breath * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.fillStyle = `rgba(255, 252, 240, ${0.98 * reveal})`;
  ctx.beginPath();
  ctx.arc(root.x, root.y, Math.max(2.5, projectScale * 0.012), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function branchReveal(branch: MyceliumBranch, progress: number): number {
  const order = branch.revealOrder;
  const maxOrder = 24;
  const t = progress * (maxOrder + 4) - order;
  return Math.max(0, Math.min(1, t / 2.2));
}

function drawGlowingBranch(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  control: { x: number; y: number },
  to: { x: number; y: number },
  weight: number,
  alpha: number,
) {
  const passes = [
    { width: weight * 34 + 8, color: `rgba(255, 140, 40, ${0.05 * alpha})`, blur: 0 },
    { width: weight * 18 + 4, color: `rgba(255, 185, 80, ${0.14 * alpha})`, blur: 6 },
    { width: weight * 8 + 2, color: `rgba(255, 215, 120, ${0.38 * alpha})`, blur: 10 },
    { width: weight * 3 + 0.8, color: `rgba(255, 240, 190, ${0.82 * alpha})`, blur: 14 },
    { width: weight * 1.1 + 0.35, color: `rgba(255, 252, 230, ${0.95 * alpha})`, blur: 6 },
  ];

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const pass of passes) {
    ctx.save();
    ctx.strokeStyle = pass.color;
    ctx.lineWidth = pass.width;
    if (pass.blur > 0) {
      ctx.shadowColor = pass.color;
      ctx.shadowBlur = pass.blur;
    }
    branchPath(ctx, from, control, to);
    ctx.stroke();
    ctx.restore();
  }
}

function drawTealCluster(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  weight: number,
  seed: number,
  count: number,
  phase: number,
  reveal: number,
) {
  const pulse = 0.88 + 0.12 * Math.sin(phase * 0.0015 + seed * 0.01);
  const fogR = radius * (2.8 + weight * 0.8) * pulse;

  const fog = ctx.createRadialGradient(cx, cy, fogR * 0.05, cx, cy, fogR);
  fog.addColorStop(0, `rgba(140, 255, 220, ${0.22 * reveal * weight})`);
  fog.addColorStop(0.35, `rgba(60, 190, 170, ${0.16 * reveal})`);
  fog.addColorStop(0.7, `rgba(18, 70, 72, ${0.1 * reveal})`);
  fog.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = fog;
  ctx.beginPath();
  ctx.arc(cx, cy, fogR, 0, Math.PI * 2);
  ctx.fill();

  const particleCount = Math.min(140, Math.max(28, count * 3 + 20));
  for (let i = 0; i < particleCount; i += 1) {
    const h = (seed + i * 97) % 1000;
    const angle = (h / 1000) * Math.PI * 2;
    const dist = Math.sqrt((h % 500) / 500) * radius * (1.6 + weight);
    const px = cx + Math.cos(angle) * dist;
    const py = cy + Math.sin(angle) * dist * 0.82;
    const twinkle = 0.45 + 0.55 * Math.sin(phase * 0.002 + i * 0.8 + seed);
    const pr = 0.5 + (i % 4) * 0.35 + weight * 0.4;

    ctx.globalAlpha = reveal * twinkle * (0.25 + weight * 0.35);
    if (i % 5 === 0) {
      ctx.fillStyle = "rgba(255, 220, 140, 0.85)";
    } else if (i % 3 === 0) {
      ctx.fillStyle = "rgba(180, 255, 230, 0.9)";
    } else {
      ctx.fillStyle = "rgba(80, 210, 190, 0.85)";
    }
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawJunctionNodes(
  ctx: CanvasRenderingContext2D,
  branches: MyceliumDrawInput["projectedBranches"],
  reveal: number,
  phase: number,
) {
  const seen = new Set<string>();
  for (const branch of branches) {
    const key = `${branch.projTo.x.toFixed(1)}:${branch.projTo.y.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const br = branchReveal(branch, reveal);
    if (br < 0.2) continue;

    const breath = 0.5 + 0.5 * Math.sin(phase * 0.003 + branch.depth);
    const r = (1.8 + branch.weight * 3.2) * (0.85 + breath * 0.15);

    ctx.save();
    ctx.globalAlpha = br * 0.75;
    const glow = ctx.createRadialGradient(
      branch.projTo.x,
      branch.projTo.y,
      0,
      branch.projTo.x,
      branch.projTo.y,
      r * 4,
    );
    glow.addColorStop(0, "rgba(255, 230, 160, 0.55)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(branch.projTo.x, branch.projTo.y, r * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 245, 210, 0.92)";
    ctx.beginPath();
    ctx.arc(branch.projTo.x, branch.projTo.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawCrossLinks(
  ctx: CanvasRenderingContext2D,
  edges: DisplayEdge[],
  projected: Map<string, ProjectedNode>,
  reveal: number,
) {
  if (reveal < 0.5) return;
  ctx.lineCap = "round";
  for (const edge of edges) {
    if (edge.kind === "part_of" || edge.kind === "version") continue;
    const from = projected.get(edge.from);
    const to = projected.get(edge.to);
    if (!from || !to) continue;

    ctx.strokeStyle = "rgba(255, 200, 110, 0.07)";
    ctx.lineWidth = 0.45;
    ctx.globalAlpha = reveal * 0.55;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function revealFactor(localDist: number, progress: number): number {
  if (progress >= 1) return 1;
  const wave = progress * 1.5 - localDist * 0.7;
  return Math.max(0, Math.min(1, wave));
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
  return 1 + (1 - d / NEIGHBOR_RADIUS) * 0.6;
}

export function projectMyceliumLayout(
  layout: MyceliumLayout,
  width: number,
  height: number,
  projectScale: number,
  driftX: number,
  driftY: number,
): {
  projected: Map<string, ProjectedNode>;
  projectedRoot: ProjectedNode;
  projectedBranches: MyceliumDrawInput["projectedBranches"];
  projectedClusters: MyceliumDrawInput["projectedClusters"];
} {
  const projected = new Map<string, ProjectedNode>();

  layout.positions.forEach((local, id) => {
    const parallax = 1 + local.z * 0.16;
    projected.set(id, {
      x: width / 2 + (local.x + driftX * 0.12) * projectScale * parallax,
      y: height / 2 + (local.y + driftY * 0.08) * projectScale,
      scale: 0.82 + local.z * 0.3,
      z: local.z,
    });
  });

  const rootScreen = toScreen(layout.root, width, height, projectScale);
  const projectedRoot: ProjectedNode = {
    x: rootScreen.x + driftX * projectScale * 0.08,
    y: rootScreen.y + driftY * projectScale * 0.05,
    scale: 1.1,
    z: 0.9,
  };

  const projectedBranches = layout.branches.map((branch) => {
    const from = toScreen(branch.from, width, height, projectScale);
    const to = toScreen(branch.to, width, height, projectScale);
    const control = toScreen(branch.control, width, height, projectScale);
    return {
      ...branch,
      projFrom: {
        x: from.x + driftX * projectScale * 0.06,
        y: from.y + driftY * projectScale * 0.04,
        scale: 1,
        z: 0.5,
      },
      projTo: {
        x: to.x + driftX * projectScale * 0.08,
        y: to.y + driftY * projectScale * 0.05,
        scale: 1,
        z: 0.6,
      },
      projCtrl: {
        x: control.x + driftX * projectScale * 0.07,
        y: control.y + driftY * projectScale * 0.045,
        scale: 1,
        z: 0.55,
      },
    };
  });

  const projectedClusters = layout.clusters.map((cluster) => {
    const pt = toScreen({ x: cluster.cx, y: cluster.cy }, width, height, projectScale);
    return {
      ...cluster,
      projCx: pt.x + driftX * projectScale * 0.08,
      projCy: pt.y + driftY * projectScale * 0.05,
      projRadius: cluster.radius * projectScale,
    };
  });

  return { projected, projectedRoot, projectedBranches, projectedClusters };
}

export function drawMyceliumFrame(input: MyceliumDrawInput) {
  const {
    ctx,
    displayWidth,
    displayHeight,
    logicalWidth,
    logicalHeight,
    zoom,
    projectScale,
    projected,
    projectedRoot,
    projectedBranches,
    projectedClusters,
    localDistById,
    edges,
    artifacts,
    centerId,
    hoveredId,
    animationPhase,
    revealProgress,
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

  drawNebulaBackground(ctx, logicalWidth, logicalHeight, animationPhase, revealProgress);

  for (const branch of projectedBranches) {
    const br = branchReveal(branch, revealProgress);
    if (br <= 0) continue;
    drawGlowingBranch(
      ctx,
      branch.projFrom,
      branch.projCtrl,
      branch.projTo,
      branch.weight,
      br,
    );
  }

  drawRootFlare(ctx, projectedRoot, input.layout, projectScale, revealProgress, animationPhase);
  drawJunctionNodes(ctx, projectedBranches, revealProgress, animationPhase);

  for (const cluster of projectedClusters) {
    const clusterReveal = Math.max(
      0,
      Math.min(1, (revealProgress - 0.35) * 1.8),
    );
    if (clusterReveal <= 0) continue;
    drawTealCluster(
      ctx,
      cluster.projCx,
      cluster.projCy,
      cluster.projRadius,
      cluster.weight,
      cluster.seed,
      cluster.artifactIds.length,
      animationPhase,
      clusterReveal,
    );
  }

  drawCrossLinks(ctx, edges, projected, revealProgress);

  const sorted = [...artifacts].sort((a, b) => {
    const za = projected.get(a.id)?.z ?? 0;
    const zb = projected.get(b.id)?.z ?? 0;
    return za - zb;
  });

  for (const artifact of sorted) {
    const pos = projected.get(artifact.id);
    if (!pos) continue;

    const isHero = artifact.id === heroId;
    const isFocus = artifact.id === focusId;
    const dist = localDistById.get(artifact.id) ?? 0.5;
    const reveal = revealFactor(dist, revealProgress);
    const neighbor = neighborBoost(artifact.id, focusId, projected);
    const phase = pulseNodePhase(artifact.id);
    const breath = 0.5 + 0.5 * Math.sin(animationPhase * 0.004 + phase);

    if (reveal <= 0.02 && !isFocus) continue;

    const radius =
      (isHero ? 3.2 : isFocus ? 2.4 : 1.1) *
      (0.85 + breath * 0.15) *
      neighbor *
      reveal *
      pos.scale;

    if (isFocus) {
      const glowR = radius * 6;
      const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowR);
      glow.addColorStop(0, "rgba(120, 220, 255, 0.4)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = reveal * (isFocus ? 1 : 0.55);
    ctx.fillStyle = isHero ? "rgba(255, 250, 220, 0.98)" : "rgba(255, 220, 150, 0.75)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (isFocus) {
      ctx.globalAlpha = reveal;
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

export function hitTestMyceliumNode(
  projected: Map<string, ProjectedNode>,
  clusters: MyceliumDrawInput["projectedClusters"],
  lx: number,
  ly: number,
): string | null {
  let best: string | null = null;
  let bestZ = -Infinity;

  for (const [id, pos] of projected) {
    const d = Math.hypot(pos.x - lx, pos.y - ly);
    const hitR = 10 * (0.7 + pos.scale * 0.35);
    if (d <= hitR && pos.z >= bestZ) {
      bestZ = pos.z;
      best = id;
    }
  }

  if (best) return best;

  for (const cluster of clusters) {
    const d = Math.hypot(cluster.projCx - lx, cluster.projCy - ly);
    if (d <= cluster.projRadius * 2.2 && cluster.artifactIds.length) {
      let nearest = cluster.artifactIds[0];
      let nearestD = Infinity;
      for (const id of cluster.artifactIds) {
        const pos = projected.get(id);
        if (!pos) continue;
        const dd = Math.hypot(pos.x - lx, pos.y - ly);
        if (dd < nearestD) {
          nearestD = dd;
          nearest = id;
        }
      }
      return nearest;
    }
  }

  return null;
}
