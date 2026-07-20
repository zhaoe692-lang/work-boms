import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import type { DisplayEdge } from "../shared/graph";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import { buildStarGrowthScene } from "../shared/starGrowthScene";
import { useElementSize } from "../shared/useElementSize";
import type { ArtifactView, Identity, Relation } from "../shared/types";
import { useVersionRoles } from "./graphStyle";

interface CometGraph3DProps {
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  relations: Relation[];
  identities: Identity[];
  centerId: string | null;
  appearance?: GraphAppearanceSettings;
  onSelect: (id: string) => void;
}

type CometNode = {
  id: string;
  artifact: ArtifactView;
  position: Vector3;
  color: string;
  glow: string;
  visualSize: number;
  hitSize: number;
  isHero: boolean;
  isMajor: boolean;
};

type CometLink = {
  id: string;
  source: string;
  target: string;
  kind: string;
  color: string;
  opacity: number;
  width: number;
};

type FlowParticle = {
  sprite: Sprite;
  curve: CatmullRomCurve3;
  phase: number;
  speed: number;
};

const textureCache = new Map<string, CanvasTexture>();

export function CometGraph3D({
  artifacts,
  edges,
  identities,
  centerId,
  onSelect,
}: CometGraph3DProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const frameRef = useRef<number | null>(null);
  const hitObjectsRef = useRef<Object3D[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { headIds, historicalIds } = useVersionRoles(identities);

  const sceneModel = useMemo(() => {
    const growth = buildStarGrowthScene({ artifacts, edges, identities, centerId });
    return buildCometModel({
      artifacts,
      edges,
      headIds,
      historicalIds,
      heroId: growth.heroId,
      finalIds: growth.finalIds,
      trunkIds: growth.trunkIds,
      revealRankById: growth.revealRankById,
      branchGroupById: growth.branchGroupById,
      influenceScoreById: growth.influenceScoreById,
      complexityScoreById: growth.complexityScoreById,
    });
  }, [artifacts, centerId, edges, headIds, historicalIds, identities]);

  useEffect(() => {
    const mount = stageRef.current;
    if (!mount) return;

    const width = Math.max(size.width, 920);
    const height = Math.max(size.height, 620);
    const scene = new Scene();
    const camera = new PerspectiveCamera(34, width / height, 1, 4200);
    camera.position.set(-80, 130, 1520);
    camera.lookAt(new Vector3(-120, 4, 0));

    const renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.className = "comet-canvas";
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const world = new Group();
    world.rotation.set(-0.15, -0.08, 0.018);
    scene.add(world);

    const haloLayer = new Group();
    const linkLayer = new Group();
    const dustLayer = new Group();
    const nodeLayer = new Group();
    world.add(haloLayer, linkLayer, dustLayer, nodeLayer);

    addCometAtmosphere(haloLayer, sceneModel.heroPosition);
    addHeadRings(haloLayer, sceneModel.heroPosition);
    addDustField(dustLayer, sceneModel.nodes, sceneModel.heroPosition);
    addTailStreams(linkLayer, sceneModel.heroPosition);

    const curves = new Map<string, CatmullRomCurve3>();
    for (const link of sceneModel.links) {
      const source = sceneModel.nodeById.get(link.source);
      const target = sceneModel.nodeById.get(link.target);
      if (!source || !target) continue;
      const curve = cometCurve(source.position, target.position, link.kind);
      curves.set(link.id, curve);
      const material = new LineBasicMaterial({
        color: new Color(link.color),
        transparent: true,
        opacity: link.opacity,
        linewidth: link.width,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const line = new Line(new BufferGeometry().setFromPoints(curve.getPoints(42)), material);
      linkLayer.add(line);
    }

    const flowParticles: FlowParticle[] = [];
    sceneModel.links.forEach((link, index) => {
      if (index % 3 !== 0 && link.kind !== "version" && link.kind !== "part_of") return;
      const curve = curves.get(link.id);
      if (!curve) return;
      const sprite = createSprite({
        texture: glowTexture(link.kind === "part_of" ? "#ffd780" : "#dff5e6"),
        color: link.kind === "part_of" ? "#ffd780" : "#dff5e6",
        opacity: link.kind === "part_of" ? 0.5 : 0.32,
        scale: link.kind === "part_of" ? 8 : 5.5,
      });
      linkLayer.add(sprite);
      flowParticles.push({
        sprite,
        curve,
        phase: (hashId(link.id) % 1000) / 1000,
        speed: link.kind === "part_of" ? 0.0019 : 0.0012,
      });
    });

    const hitObjects: Object3D[] = [];
    for (const node of sceneModel.nodes) {
      const nodeGroup = new Group();
      nodeGroup.position.copy(node.position);
      nodeLayer.add(nodeGroup);

      const halo = createSprite({
        texture: glowTexture(node.glow),
        color: node.glow,
        opacity: node.isHero ? 0.62 : node.isMajor ? 0.2 : 0.1,
        scale: node.visualSize * (node.isHero ? 6.8 : 4.2),
      });
      nodeGroup.add(halo);

      const star = createSprite({
        texture: starTexture(node.color),
        color: node.color,
        opacity: 1,
        scale: node.visualSize,
      });
      nodeGroup.add(star);

      if (node.isHero) {
        const core = createSprite({
          texture: coreTexture(),
          color: "#fff3ba",
          opacity: 0.94,
          scale: node.visualSize * 3.2,
        });
        nodeGroup.add(core);
      }

      const hit = new Mesh(
        new SphereGeometry(node.hitSize, 10, 10),
        new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.userData.id = node.id;
      nodeGroup.add(hit);
      hitObjects.push(hit);
    }
    hitObjectsRef.current = hitObjects;

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(hitObjectsRef.current, true)[0]?.object;
      const id = hit?.userData.id ?? null;
      renderer.domElement.style.cursor = id ? "pointer" : "grab";
      selectedIdRef.current = id;
      setHoveredId(id);
    };
    const clickNode = () => {
      if (selectedIdRef.current) onSelect(selectedIdRef.current);
    };
    renderer.domElement.addEventListener("pointermove", updatePointer);
    renderer.domElement.addEventListener("click", clickNode);

    let lastTime = performance.now();
    const animate = (time: number) => {
      const delta = Math.min(34, time - lastTime);
      lastTime = time;
      const drift = time * 0.00008;
      world.rotation.y = -0.08 + Math.sin(drift) * 0.038;
      world.rotation.x = -0.15 + Math.sin(drift * 0.7) * 0.022;
      world.rotation.z = 0.018 + Math.sin(drift * 0.55) * 0.01;
      dustLayer.children.forEach((child, index) => {
        child.position.x += 0.008 * delta * (0.3 + (index % 7) / 10);
        if (child.position.x > 540) child.position.x -= 1260;
      });
      for (const flow of flowParticles) {
        flow.phase = (flow.phase + flow.speed * delta) % 1;
        flow.sprite.position.copy(flow.curve.getPoint(flow.phase));
      }
      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(animate);
    };
    frameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      renderer.domElement.removeEventListener("pointermove", updatePointer);
      renderer.domElement.removeEventListener("click", clickNode);
      mount.removeChild(renderer.domElement);
      scene.traverse((object) => {
        if (object instanceof Mesh || object instanceof Sprite || object instanceof Line) {
          object.geometry?.dispose?.();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material?.dispose?.();
        }
      });
      renderer.dispose();
      rendererRef.current = null;
      hitObjectsRef.current = [];
    };
  }, [onSelect, sceneModel, size.height, size.width]);

  const hoveredNode = hoveredId ? sceneModel.nodeById.get(hoveredId) : null;

  return (
    <div ref={ref} className="jarvis-globe-wrap comet-wrap">
      <div className="graph-canvas-toolbar jarvis-toolbar">
        <p className="graph-hint">COMET · custom Three.js field · star nodes · relation light trails</p>
        <button type="button" className="tool-btn ghost" onClick={() => setHoveredId(null)}>
          Center canvas
        </button>
      </div>

      <div ref={stageRef} className="jarvis-globe-stage comet-stage">
        <div className="comet-aura comet-aura-head" />
        <div className="comet-aura comet-aura-tail" />
        {hoveredNode && (
          <div className="jarvis-hover-chip">
            <strong>{hoveredNode.artifact.displayName}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function buildCometModel(input: {
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  headIds: Set<string>;
  historicalIds: Set<string>;
  heroId: string | null;
  finalIds: Set<string>;
  trunkIds: string[];
  revealRankById: Map<string, number>;
  branchGroupById: Map<string, number>;
  influenceScoreById: Map<string, number>;
  complexityScoreById: Map<string, number>;
}) {
  const {
    artifacts,
    edges,
    headIds,
    historicalIds,
    heroId,
    finalIds,
    trunkIds,
    revealRankById,
    branchGroupById,
    influenceScoreById,
    complexityScoreById,
  } = input;
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const maxInfluence = Math.max(1, ...influenceScoreById.values(), 1);
  const maxComplexity = Math.max(1, ...complexityScoreById.values(), 1);
  const heroPosition = new Vector3(500, 4, 48);
  const positions = new Map<string, Vector3>();
  const orderedTrunk = [
    ...(heroId ? [heroId] : []),
    ...trunkIds.filter((id) => id !== heroId && artifactIds.has(id)),
  ];

  orderedTrunk.forEach((id, index) => {
    const progress = orderedTrunk.length <= 1 ? 0 : index / (orderedTrunk.length - 1);
    const seed = hashId(id);
    positions.set(
      id,
      new Vector3(
        500 - progress * 990,
        4 + Math.sin(progress * Math.PI * 1.08) * (18 + progress * 24),
        40 + Math.cos(progress * Math.PI * 1.35 + seed * 0.001) * (28 + progress * 110),
      ),
    );
  });

  const featherNodes = artifacts
    .filter((artifact) => !positions.has(artifact.id))
    .sort((a, b) => {
      const rankA = revealRankById.get(a.id) ?? 0;
      const rankB = revealRankById.get(b.id) ?? 0;
      if (rankA !== rankB) return rankA - rankB;
      return (influenceScoreById.get(b.id) ?? 0) - (influenceScoreById.get(a.id) ?? 0);
    });
  const laneCount = Math.min(17, Math.max(11, Math.ceil(Math.sqrt(Math.max(1, featherNodes.length)) + 2)));
  const laneSlots = Array.from({ length: laneCount }, () => 0);
  featherNodes.forEach((artifact, index) => {
    const seed = hashId(artifact.id);
    const branchGroup = branchGroupById.get(artifact.id) ?? 0;
    const lane = chooseCometLane(laneSlots, branchGroup, seed);
    const laneOffset = lane - (laneCount - 1) / 2;
    const slot = laneSlots[lane] - Math.floor(featherNodes.length / laneCount) / 2;
    laneSlots[lane] += 1;
    const progress = featherNodes.length <= 1 ? 0 : index / (featherNodes.length - 1);
    const plumeWidth = 28 + progress * 330;
    const x = 420 - progress * 1170 - slot * (8 + progress * 4);
    const y =
      laneOffset * (plumeWidth / ((laneCount - 1) / 2)) +
      slot * (10 + progress * 5) +
      Math.sin(progress * Math.PI * 1.08) * 26 +
      Math.sin(seed * 0.0013) * 7;
    const z = 20 + laneOffset * (24 + progress * 52) + Math.cos(seed * 0.0017) * (22 + progress * 130);
    positions.set(artifact.id, new Vector3(x, y, z));
  });

  const nodes: CometNode[] = artifacts.map((artifact) => {
    const influence = (influenceScoreById.get(artifact.id) ?? 0) / maxInfluence;
    const complexity = (complexityScoreById.get(artifact.id) ?? 0) / maxComplexity;
    const isHero = artifact.id === heroId;
    const isFinal = finalIds.has(artifact.id);
    const isHead = headIds.has(artifact.id);
    const isHistorical = historicalIds.has(artifact.id);
    const isMajor = isHero || isFinal || isHead || influence > 0.52 || complexity > 0.55;
    const level = revealRankById.get(artifact.id) ?? 0;
    const visualSize = isHero
      ? 38
      : isFinal || isHead
        ? 18 + influence * 5
        : isMajor
          ? 12 + complexity * 4
          : 6.5 + influence * 2.6;
    return {
      id: artifact.id,
      artifact,
      position: positions.get(artifact.id) ?? heroPosition.clone(),
      color: cometNodeColor({ isHero, isFinal, isHead, isHistorical, level }),
      glow: isHero ? "#fff2b7" : isFinal || isHead ? "#ffd98a" : level <= 1 ? "#bdf8f4" : "#f1df75",
      visualSize,
      hitSize: Math.max(14, visualSize * 0.88),
      isHero,
      isMajor,
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links: CometLink[] = edges
    .filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to))
    .map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      kind: edge.kind,
      color: cometLinkColor(edge.kind),
      opacity: edge.kind === "part_of" ? 0.28 : edge.kind === "version" ? 0.18 : 0.065,
      width: edge.kind === "part_of" ? 1.1 : edge.kind === "version" ? 0.8 : 0.5,
    }));

  return { nodes, links, nodeById, heroPosition };
}

function addCometAtmosphere(layer: Group, heroPosition: Vector3) {
  const coreGlow = createSprite({
    texture: glowTexture("#ffe5a1"),
    color: "#ffe5a1",
    opacity: 0.42,
    scale: 300,
  });
  coreGlow.position.copy(heroPosition);
  layer.add(coreGlow);

  const outerGlow = createSprite({
    texture: glowTexture("#d2f7f1"),
    color: "#d2f7f1",
    opacity: 0.075,
    scale: 560,
  });
  outerGlow.position.set(heroPosition.x - 190, heroPosition.y + 8, heroPosition.z - 110);
  layer.add(outerGlow);

  for (let index = 0; index < 24; index += 1) {
    const seed = index * 971;
    const streak = createSprite({
      texture: glowTexture(index % 2 === 0 ? "#f6d99a" : "#9ce6df"),
      color: index % 2 === 0 ? "#f6d99a" : "#9ce6df",
      opacity: 0.018,
      scale: 90 + (seed % 7) * 18,
    });
    streak.position.set(heroPosition.x - 160 - index * 48, Math.sin(index * 1.7) * 74, -90 + (index % 7) * 36);
    layer.add(streak);
  }
}

function addHeadRings(layer: Group, heroPosition: Vector3) {
  for (let index = 0; index < 5; index += 1) {
    const points: Vector3[] = [];
    const radiusX = 72 + index * 31;
    const radiusY = 26 + index * 13;
    for (let step = 0; step <= 96; step += 1) {
      const t = (step / 96) * Math.PI * 2;
      points.push(
        new Vector3(
          heroPosition.x + Math.cos(t) * radiusX,
          heroPosition.y + Math.sin(t) * radiusY,
          heroPosition.z + Math.sin(t + index * 0.8) * (18 + index * 8),
        ),
      );
    }
    const line = new Line(
      new BufferGeometry().setFromPoints(points),
      new LineBasicMaterial({
        color: new Color(index % 2 === 0 ? "#ffe6a3" : "#d7fff8"),
        transparent: true,
        opacity: 0.14 - index * 0.018,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    line.rotation.y = 0.18 + index * 0.035;
    layer.add(line);
  }
}

function addTailStreams(layer: Group, heroPosition: Vector3) {
  for (let index = 0; index < 42; index += 1) {
    const seed = hashId(`stream:${index}`);
    const lane = index - 20.5;
    const start = new Vector3(
      heroPosition.x - 1080 - (seed % 180),
      lane * 9 + Math.sin(seed * 0.002) * 42,
      -150 + (seed % 300),
    );
    const mid = new Vector3(
      heroPosition.x - 540 - (seed % 110),
      lane * 5 + Math.cos(seed * 0.002) * 30,
      -60 + (seed % 190),
    );
    const end = new Vector3(
      heroPosition.x - 34 - (seed % 150),
      Math.sin(seed * 0.003) * 42,
      heroPosition.z + Math.cos(seed * 0.002) * 120,
    );
    const curve = new CatmullRomCurve3([start, mid, end]);
    const line = new Line(
      new BufferGeometry().setFromPoints(curve.getPoints(64)),
      new LineBasicMaterial({
        color: new Color(index % 3 === 0 ? "#f4d089" : "#8ce5dd"),
        transparent: true,
        opacity: index % 3 === 0 ? 0.075 : 0.045,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    layer.add(line);
  }
}

function addDustField(layer: Group, nodes: CometNode[], heroPosition: Vector3) {
  for (let index = 0; index < 420; index += 1) {
    const seed = hashId(`dust:${index}`);
    const progress = (seed % 1000) / 1000;
    const angle = ((seed >> 3) % 1000) / 1000 * Math.PI * 2;
    const width = 46 + progress * 410;
    const sprite = createSprite({
      texture: glowTexture(index % 4 === 0 ? "#ffe0a0" : "#9ee8e1"),
      color: index % 4 === 0 ? "#ffe0a0" : "#9ee8e1",
      opacity: 0.035 + ((seed % 7) / 7) * 0.025,
      scale: 2.5 + (seed % 7),
    });
    sprite.position.set(
      heroPosition.x - 60 - progress * 1230 + Math.cos(angle) * 28,
      Math.sin(angle) * width * 0.46 + Math.sin(progress * Math.PI) * 18,
      Math.cos(angle * 0.7) * width * 0.38,
    );
    layer.add(sprite);
  }

  for (const node of nodes.filter((item) => item.isMajor)) {
    const spark = createSprite({
      texture: glowTexture(node.glow),
      color: node.glow,
      opacity: node.isHero ? 0.18 : 0.055,
      scale: node.visualSize * (node.isHero ? 4.8 : 2.7),
    });
    spark.position.copy(node.position);
    layer.add(spark);
  }
}

function cometCurve(source: Vector3, target: Vector3, kind: string) {
  const mid = source.clone().lerp(target, 0.5);
  const distance = source.distanceTo(target);
  const towardHead = Math.max(source.x, target.x) > 250 ? 1 : -1;
  mid.x -= Math.min(90, distance * 0.06);
  mid.y += Math.sin((source.x + target.x) * 0.003) * Math.min(70, distance * 0.1);
  mid.z += towardHead * Math.min(220, distance * (kind === "part_of" ? 0.22 : 0.14));
  return new CatmullRomCurve3([source, mid, target]);
}

function createSprite(input: {
  texture: CanvasTexture;
  color: string;
  opacity: number;
  scale: number;
}) {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: input.texture,
      color: input.color,
      transparent: true,
      opacity: input.opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  sprite.scale.set(input.scale, input.scale, 1);
  return sprite;
}

function cometNodeColor(input: {
  isHero: boolean;
  isFinal: boolean;
  isHead: boolean;
  isHistorical: boolean;
  level: number;
}) {
  const { isHero, isFinal, isHead, isHistorical, level } = input;
  if (isHero) return "#fff6bf";
  if (isFinal || isHead) return "#ffd277";
  if (isHistorical) return "#b7bcba";
  if (level <= 1) return "#79f0ef";
  if (level === 2) return "#f1ec7d";
  return "#f5b24e";
}

function cometLinkColor(kind: string) {
  if (kind === "part_of") return "#f4d089";
  if (kind === "version") return "#dfe8d6";
  if (kind === "uses") return "#88ded8";
  if (kind === "references") return "#8e9aa1";
  return "#c2a878";
}

function chooseCometLane(laneSlots: number[], branchGroup: number, seed: number) {
  const preferred = Math.abs((branchGroup + seed) % laneSlots.length);
  let best = preferred;
  for (let offset = 0; offset < laneSlots.length; offset += 1) {
    const left = preferred - offset;
    const right = preferred + offset;
    if (left >= 0 && laneSlots[left] < laneSlots[best]) best = left;
    if (right < laneSlots.length && laneSlots[right] < laneSlots[best]) best = right;
  }
  return best;
}

function glowTexture(color: string) {
  const cacheKey = `glow:${color}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new CanvasTexture(canvas);
    textureCache.set(cacheKey, fallback);
    return fallback;
  }
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, colorWithAlpha(color, 0.95));
  gradient.addColorStop(0.22, colorWithAlpha(color, 0.6));
  gradient.addColorStop(0.55, colorWithAlpha(color, 0.16));
  gradient.addColorStop(1, colorWithAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  textureCache.set(cacheKey, texture);
  return texture;
}

function starTexture(color: string) {
  const cacheKey = `star:${color}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new CanvasTexture(canvas);
    textureCache.set(cacheKey, fallback);
    return fallback;
  }
  const glow = ctx.createRadialGradient(48, 48, 0, 48, 48, 42);
  glow.addColorStop(0, colorWithAlpha(color, 1));
  glow.addColorStop(0.28, colorWithAlpha(color, 0.48));
  glow.addColorStop(0.64, colorWithAlpha(color, 0.08));
  glow.addColorStop(1, colorWithAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 96, 96);
  ctx.strokeStyle = colorWithAlpha("#ffffff", 0.58);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 48);
  ctx.lineTo(76, 48);
  ctx.moveTo(48, 20);
  ctx.lineTo(48, 76);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(48, 48, 6.8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(48, 48, 2.8, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  textureCache.set(cacheKey, texture);
  return texture;
}

function coreTexture() {
  const cached = textureCache.get("core");
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new CanvasTexture(canvas);
    textureCache.set("core", fallback);
    return fallback;
  }
  const gradient = ctx.createRadialGradient(80, 80, 4, 80, 80, 78);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.22, "rgba(255,225,128,0.94)");
  gradient.addColorStop(0.38, "rgba(255,170,60,0.42)");
  gradient.addColorStop(0.62, "rgba(255,210,105,0.16)");
  gradient.addColorStop(1, "rgba(255,210,105,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 160, 160);
  ctx.strokeStyle = "rgba(255,229,160,0.72)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(80, 80, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(80, 80, 50, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new CanvasTexture(canvas);
  textureCache.set("core", texture);
  return texture;
}

function colorWithAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const normalized = clean.length === 3
    ? clean.split("").map((char) => `${char}${char}`).join("")
    : clean;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function hashId(id: string) {
  let h = 0;
  for (let index = 0; index < id.length; index += 1) {
    h = (h * 33 + id.charCodeAt(index)) | 0;
  }
  return Math.abs(h);
}
