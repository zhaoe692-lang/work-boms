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
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { buildGravityScene } from "../shared/gravityScene";
import {
  buildGravityWellSceneModel,
  gravityBarrierPoint,
  hashId,
  orbitPositionAt,
  type GravityWellNode,
  type GravityWellSceneModel,
} from "../shared/gravityWellScene";
import { SCREEN_NODE_PX } from "../shared/gravityWellPlanet";
import { useElementSize } from "../shared/useElementSize";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import { useI18n } from "../shared/i18n";
import type { ArtifactView, Identity, Relation } from "../shared/types";

interface GravityWellGraph3DProps {
  artifacts: ArtifactView[];
  relations: Relation[];
  identities: Identity[];
  centerId: string | null;
  selectedId?: string | null;
  appearance: GraphAppearanceSettings;
  onSelect: (id: string) => void;
}

type FlowParticle = {
  sprite: Sprite;
  curve: CatmullRomCurve3;
  phase: number;
  speed: number;
};

type NodeVisual = {
  node: GravityWellNode;
  orbitGroup: Group;
  spinGroup: Group;
  labelAnchor: Object3D;
  outerHalo: Sprite;
  colorBody: Sprite;
  whiteCore: Sprite;
  rings: Line[];
  hit: Mesh;
  spinAngle: number;
  baseHaloScale: number;
  baseBodyScale: number;
};

type TrailVisual = {
  line: Line;
  sourceId: string;
  targetId: string;
  kind: string;
  flow?: FlowParticle;
};

type LabelCard = {
  el: HTMLDivElement;
  nodeId: string;
};

const textureCache = new Map<string, CanvasTexture>();
const TRAIL_UPDATE_INTERVAL = 2;

export function GravityWellGraph3D({
  artifacts,
  relations,
  identities,
  centerId,
  selectedId = null,
  appearance,
  onSelect,
}: GravityWellGraph3DProps) {
  const { t } = useI18n();
  const { ref, size } = useElementSize<HTMLDivElement>();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const hitObjectsRef = useRef<Object3D[]>([]);
  const nodeVisualsRef = useRef<Map<string, NodeVisual>>(new Map());
  const labelCardsRef = useRef<LabelCard[]>([]);
  const hoveredIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  const modelRef = useRef<GravityWellSceneModel | null>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  selectedIdRef.current = selectedId;

  const model = useMemo(() => {
    const gravityScene = buildGravityScene({
      artifacts,
      relations,
      identities,
      centerId,
    });
    return buildGravityWellSceneModel({
      artifacts,
      gravityScene,
      focusId: gravityScene.anchorArtifactId,
      appearance,
    });
  }, [appearance, artifacts, centerId, identities, relations]);

  modelRef.current = model;

  useEffect(() => {
    applyNodeSelection(nodeVisualsRef.current, selectedId);
  }, [selectedId, model]);

  useEffect(() => {
    const mount = stageRef.current;
    const labelLayer = labelLayerRef.current;
    if (!mount || !labelLayer) return;

    const width = Math.max(size.width, 920);
    const height = Math.max(size.height, 620);
    const scene = new Scene();
    const camera = new PerspectiveCamera(34, width / height, 1, 5600);
    camera.position.set(0, 280, 1180);
    camera.lookAt(new Vector3(0, -30, 0));

    const renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.className = "gravity-well-canvas";
    mount.appendChild(renderer.domElement);

    const world = new Group();
    world.rotation.set(-0.58, 0.06, 0);
    scene.add(world);

    const orbitTarget = new Vector3(0, -30, 0);
    const cameraOffset = new Vector3().subVectors(camera.position, orbitTarget);
    const spherical = new Spherical().setFromVector3(cameraOffset);
    const panScratch = new Vector3();
    const panRight = new Vector3();
    const panUp = new Vector3();

    const updateCameraFromOrbit = () => {
      panScratch.setFromSpherical(spherical);
      camera.position.copy(orbitTarget).add(panScratch);
      camera.lookAt(orbitTarget);
    };
    updateCameraFromOrbit();

    const defaultOrbitTarget = orbitTarget.clone();
    const defaultSpherical = spherical.clone();

    const gridLayer = new Group();
    const linkLayer = new Group();
    const nodeLayer = new Group();
    const glowLayer = new Group();
    const dustLayer = new Group();
    world.add(gridLayer, linkLayer, nodeLayer, glowLayer, dustLayer);

    const gridCurves = addGravityBarrierGrid(gridLayer);
    addBarrierCore(glowLayer, Boolean(modelRef.current?.heroId));
    addSparseStarfield(dustLayer);

    let trailVisuals: TrailVisual[] = [];
    let linkFlowParticles: FlowParticle[] = [];

    const syncScene = (nextModel: GravityWellSceneModel) => {
      clearGroup(linkLayer);
      clearGroup(nodeLayer);
      clearLabelCards(labelLayer, labelCardsRef.current);
      labelCardsRef.current = [];
      hitObjectsRef.current = [];
      nodeVisualsRef.current = new Map();

      const links = addGraphLinks(linkLayer, nextModel);
      trailVisuals = links.trails;
      linkFlowParticles = links.flowParticles;

      const { hitObjects, visuals, labels } = addGraphNodes(nodeLayer, nextModel);
      hitObjectsRef.current = hitObjects;
      nodeVisualsRef.current = visuals;
      labelCardsRef.current = labels;
      labels.forEach((card) => labelLayer.appendChild(card.el));
      applyNodeSelection(visuals, selectedIdRef.current);
    };

    const flowParticles: FlowParticle[] = [];
    gridCurves.filter((_, index) => index % 5 === 0).forEach((curve, index) => {
      const sprite = createSprite({
        texture: glowTexture(index % 3 === 0 ? "#ffd487" : "#b489ff"),
        color: index % 3 === 0 ? "#ffd487" : "#b489ff",
        opacity: 0.3,
        scale: 2.8,
      });
      gridLayer.add(sprite);
      flowParticles.push({
        sprite,
        curve,
        phase: (index * 0.137) % 1,
        speed: 0.00042 + (index % 5) * 0.00007,
      });
    });

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const worldPos = new Vector3();
    const screenPos = new Vector3();
    let dragging = false;
    let dragMode: "orbit" | "pan" | null = null;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let pointerDownX = 0;
    let pointerDownY = 0;

    const MIN_RADIUS = 140;
    const MAX_RADIUS = 4800;

    const applyScreenScales = () => {
      const canvasH = renderer.domElement.clientHeight || height;
      for (const visual of nodeVisualsRef.current.values()) {
        const pos = visual.orbitGroup.position;
        const px = SCREEN_NODE_PX[visual.node.visualTier];
        const bodyScale = worldScaleForPixels(camera, pos, px.body, canvasH);
        const haloScale = worldScaleForPixels(camera, pos, px.halo, canvasH);
        const coreScale = worldScaleForPixels(camera, pos, px.core, canvasH);
        const selected = visual.node.id === selectedIdRef.current;
        const bodyMul = selected ? 1.18 : 1;
        const haloMul = selected ? 1.22 : 1;
        visual.colorBody.scale.set(bodyScale * bodyMul, bodyScale * bodyMul, 1);
        visual.outerHalo.scale.set(haloScale * haloMul, haloScale * haloMul, 1);
        visual.whiteCore.scale.set(coreScale * bodyMul, coreScale * bodyMul, 1);
        if (visual.rings.length > 0) {
          const ringS = bodyScale / Math.max(visual.node.size, 1);
          for (const ring of visual.rings) {
            ring.scale.set(ringS, ringS, ringS);
          }
        }
        visual.baseHaloScale = haloScale;
        visual.baseBodyScale = bodyScale;
      }
    };
    const getNodePosition = (nodeId: string, elapsedSec: number): Vector3 => {
      const visual = nodeVisualsRef.current.get(nodeId);
      if (!visual) return new Vector3();
      const pos = orbitPositionAt(visual.node.basePosition, visual.node.motion, elapsedSec);
      return new Vector3(pos.x, pos.y, pos.z);
    };

    syncScene(model);
    applyScreenScales();

    resetViewRef.current = () => {
      orbitTarget.copy(defaultOrbitTarget);
      spherical.copy(defaultSpherical);
      updateCameraFromOrbit();
      applyScreenScales();
    };

    const startTime = performance.now();
    let frameCount = 0;

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(hitObjectsRef.current, true)[0]?.object;
      const id = hit?.userData.id ?? null;
      hoveredIdRef.current = id;
      setHoveredId(id);
      renderer.domElement.style.cursor = dragging
        ? dragMode === "pan"
          ? "grabbing"
          : "grabbing"
        : id
          ? "pointer"
          : "grab";
    };

    const onPointerDown = (event: PointerEvent) => {
      const panGesture = event.button === 1 || event.button === 2 || event.shiftKey;
      dragMode = panGesture ? "pan" : "orbit";
      dragging = true;
      moved = false;
      pointerDownX = event.clientX;
      pointerDownY = event.clientY;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    };
    const onPointerMove = (event: PointerEvent) => {
      if (dragging) {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > 6) {
          moved = true;
        }
        if (dragMode === "orbit") {
          spherical.theta -= dx * 0.005;
          spherical.phi = Math.max(0.06, Math.min(Math.PI - 0.06, spherical.phi + dy * 0.005));
          updateCameraFromOrbit();
        } else if (dragMode === "pan") {
          const panFactor = spherical.radius * 0.0018;
          camera.updateMatrixWorld();
          panRight.setFromMatrixColumn(camera.matrixWorld, 0);
          panUp.setFromMatrixColumn(camera.matrixWorld, 1);
          orbitTarget.addScaledVector(panRight, -dx * panFactor);
          orbitTarget.addScaledVector(panUp, dy * panFactor);
          updateCameraFromOrbit();
        }
        applyScreenScales();
      }
      updatePointer(event);
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      dragMode = null;
      renderer.domElement.releasePointerCapture(event.pointerId);
      renderer.domElement.style.cursor = hoveredIdRef.current ? "pointer" : "grab";
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const zoomFactor = Math.exp(event.deltaY * 0.0011);
      spherical.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, spherical.radius * zoomFactor));
      updateCameraFromOrbit();
      applyScreenScales();
    };
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    const onClick = () => {
      if (moved || !hoveredIdRef.current) return;
      selectedIdRef.current = hoveredIdRef.current;
      applyNodeSelection(nodeVisualsRef.current, selectedIdRef.current);
      applyScreenScales();
      onSelect(hoveredIdRef.current);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    renderer.domElement.addEventListener("click", onClick);

    let lastTime = performance.now();
    const animate = (time: number) => {
      const delta = Math.min(34, time - lastTime);
      lastTime = time;
      frameCount += 1;
      const t = time * 0.001;
      const elapsedSec = (time - startTime) * 0.001;

      world.rotation.x = -0.58;
      world.rotation.y = 0.06 + Math.sin(t * 0.16) * 0.008;
      world.rotation.z = Math.sin(t * 0.22) * 0.004;
      gridLayer.rotation.y += delta * 0.000045;
      glowLayer.rotation.y -= delta * 0.00002;
      dustLayer.rotation.y -= delta * 0.000018;
      dustLayer.children.forEach((child, index) => {
        child.position.y -= delta * (0.018 + (index % 5) * 0.006);
        child.position.x += Math.sin(t + index) * 0.006 * delta;
        if (child.position.y < -470) child.position.y = 470 + (index % 30);
      });

      for (const visual of nodeVisualsRef.current.values()) {
        const pos = orbitPositionAt(visual.node.basePosition, visual.node.motion, elapsedSec);
        visual.orbitGroup.position.set(pos.x, pos.y, pos.z);
        visual.node.position = pos;

        visual.spinAngle += visual.node.motion.spinOmega * delta;
        visual.spinGroup.rotation.set(
          visual.node.motion.spinTiltX,
          visual.spinAngle,
          visual.node.motion.spinTiltZ,
        );
      }

      if (frameCount % TRAIL_UPDATE_INTERVAL === 0) {
        updateTrailVisuals(trailVisuals, (id) => getNodePosition(id, elapsedSec));
      }

      for (const flow of flowParticles) {
        flow.phase = (flow.phase + flow.speed * delta) % 1;
        flow.sprite.position.copy(flow.curve.getPoint(flow.phase));
      }
      for (const flow of linkFlowParticles) {
        flow.phase = (flow.phase + flow.speed * delta) % 1;
        flow.sprite.position.copy(flow.curve.getPoint(flow.phase));
      }

      const rect = renderer.domElement.getBoundingClientRect();
      for (const card of labelCardsRef.current) {
        const visual = nodeVisualsRef.current.get(card.nodeId);
        if (!visual) continue;
        visual.labelAnchor.getWorldPosition(worldPos);
        screenPos.copy(worldPos).project(camera);
        const visible = screenPos.z < 1 && screenPos.z > -1;
        if (!visible) {
          card.el.style.opacity = "0";
          continue;
        }
        const x = (screenPos.x * 0.5 + 0.5) * rect.width;
        const y = (-screenPos.y * 0.5 + 0.5) * rect.height;
        card.el.style.opacity = "1";
        card.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }

      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(animate);
    };
    frameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      resetViewRef.current = null;
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.domElement.removeEventListener("click", onClick);
      clearLabelCards(labelLayer, labelCardsRef.current);
      labelCardsRef.current = [];
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      scene.traverse((object) => {
        if (object instanceof Mesh || object instanceof Line) {
          object.geometry?.dispose?.();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material?.dispose?.();
        } else if (object instanceof Sprite) {
          object.material.dispose();
        }
      });
      renderer.dispose();
      hitObjectsRef.current = [];
      nodeVisualsRef.current = new Map();
    };
  }, [model, onSelect, size.height, size.width]);

  const hoveredNode = hoveredId ? model.nodeById.get(hoveredId) : null;

  return (
    <div ref={ref} className="jarvis-globe-wrap gravity-well-wrap">
      <div className="graph-canvas-toolbar jarvis-toolbar gravity-toolbar">
        <p className="graph-hint">
          GRAVITY BARRIER ·{" "}
          {model.mode === "loose" ? t("gravity.modeLoose") : t("gravity.modeBom")}{" "}
          · {model.nodes.filter((node) => node.visible).length} nodes ·{" "}
          {t("gravity.hintDrag")}
        </p>
        <button
          type="button"
          className="tool-btn ghost"
          onClick={() => {
            setHoveredId(null);
            resetViewRef.current?.();
          }}
        >
          Reset view
        </button>
      </div>
      <div ref={stageRef} className="jarvis-globe-stage gravity-well-stage">
        <div className="gravity-field gravity-field-funnel" />
        <div className="gravity-field gravity-field-core" />
        <div ref={labelLayerRef} className="gravity-planet-labels" aria-hidden />
        {hoveredNode && !hoveredNode.showLabel && (
          <div className="jarvis-hover-chip gravity-hover-chip">
            <strong>{hoveredNode.artifact.displayName}</strong>
            {hoveredNode.identityLabel && hoveredNode.identityLabel !== hoveredNode.label && (
              <span className="gravity-hover-meta"> · {hoveredNode.identityLabel}</span>
            )}
            <span className="gravity-hover-meta"> · L{Math.min(hoveredNode.depth, 4)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function clearLabelCards(layer: HTMLDivElement, cards: LabelCard[]) {
  for (const card of cards) {
    if (card.el.parentElement === layer) layer.removeChild(card.el);
  }
}

function createLabelCard(node: GravityWellNode): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `gravity-planet-label${node.visualTier === "core" ? " core" : ""}`;
  const title = document.createElement("div");
  title.className = "gravity-planet-label-title";
  title.textContent = node.label;
  el.appendChild(title);
  const meta = document.createElement("div");
  meta.className = "gravity-planet-label-meta";
  meta.textContent = `L${Math.min(node.depth, 4)}`;
  el.appendChild(meta);
  return el;
}

function clearGroup(layer: Group) {
  while (layer.children.length > 0) {
    const child = layer.children[0]!;
    layer.remove(child);
    child.traverse((object) => {
      if (object instanceof Mesh || object instanceof Line) {
        object.geometry?.dispose?.();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose?.();
      } else if (object instanceof Sprite) {
        object.material.dispose();
      }
    });
  }
}

function applyNodeSelection(visuals: Map<string, NodeVisual>, selectedId: string | null) {
  for (const [id, visual] of visuals) {
    const selected = id === selectedId;
    visual.outerHalo.material.opacity = selected
      ? Math.min(0.98, visual.node.haloOpacity * 2.1)
      : visual.node.haloOpacity;
    visual.colorBody.material.opacity = selected
      ? Math.min(1, visual.node.bodyOpacity * 1.08)
      : visual.node.bodyOpacity;
  }
}

/** Convert desired screen pixels to world sprite scale at a given depth. */
function worldScaleForPixels(
  camera: PerspectiveCamera,
  worldPos: Vector3,
  pixels: number,
  canvasHeight: number,
): number {
  const dist = Math.max(camera.position.distanceTo(worldPos), 120);
  const fovRad = (camera.fov * Math.PI) / 180;
  const visibleHeight = 2 * Math.tan(fovRad / 2) * dist;
  return (pixels / canvasHeight) * visibleHeight;
}

function updateTrailVisuals(
  trails: TrailVisual[],
  getPosition: (id: string) => Vector3,
) {
  for (const trail of trails) {
    const source = getPosition(trail.sourceId);
    const target = getPosition(trail.targetId);
    const curve = gravityLinkCurve(source, target, trail.kind);
    trail.line.geometry.dispose();
    trail.line.geometry = new BufferGeometry().setFromPoints(curve.getPoints(42));
    if (trail.flow) {
      trail.flow.curve = curve;
      const midR = Math.hypot(
        (source.x + target.x) * 0.5,
        (source.z + target.z) * 0.5,
      );
      trail.flow.speed =
        trail.kind === "part_of"
          ? 0.0012 / Math.sqrt(midR + 80)
          : 0.00075 / Math.sqrt(midR + 120);
    }
  }
}

function addGraphLinks(
  layer: Group,
  model: GravityWellSceneModel,
): { trails: TrailVisual[]; flowParticles: FlowParticle[] } {
  const trails: TrailVisual[] = [];
  const flowParticles: FlowParticle[] = [];

  for (const trail of model.trails) {
    const source = model.nodeById.get(trail.source);
    const target = model.nodeById.get(trail.target);
    if (!source || !target) continue;
    const sourceVec = vecToThree(source.position);
    const targetVec = vecToThree(target.position);
    const curve = gravityLinkCurve(sourceVec, targetVec, trail.kind);
    const line = new Line(
      new BufferGeometry().setFromPoints(curve.getPoints(42)),
      new LineBasicMaterial({
        color: new Color(trail.color),
        transparent: true,
        opacity: trail.opacity,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    layer.add(line);
    const tv: TrailVisual = {
      line,
      sourceId: trail.source,
      targetId: trail.target,
      kind: trail.kind,
    };
    trails.push(tv);

    if (trail.kind === "part_of" || trail.kind === "version" || hashId(trail.id) % 3 === 0) {
      const sprite = createSprite({
        texture: glowTexture(trail.color),
        color: trail.color,
        opacity: trail.kind === "part_of" ? 0.52 : 0.24,
        scale: trail.kind === "part_of" ? 7.2 : 4.8,
      });
      layer.add(sprite);
      const midR = Math.hypot(
        (sourceVec.x + targetVec.x) * 0.5,
        (sourceVec.z + targetVec.z) * 0.5,
      );
      const flow: FlowParticle = {
        sprite,
        curve,
        phase: (hashId(trail.id) % 1000) / 1000,
        speed:
          trail.kind === "part_of"
            ? 0.0012 / Math.sqrt(midR + 80)
            : 0.00075 / Math.sqrt(midR + 120),
      };
      tv.flow = flow;
      flowParticles.push(flow);
    }
  }

  return { trails, flowParticles };
}

function addGraphNodes(
  layer: Group,
  model: GravityWellSceneModel,
): {
  hitObjects: Object3D[];
  visuals: Map<string, NodeVisual>;
  labels: LabelCard[];
} {
  const hitObjects: Object3D[] = [];
  const visuals = new Map<string, NodeVisual>();
  const labels: LabelCard[] = [];

  for (const node of model.nodes) {
    if (!node.visible) continue;

    const orbitGroup = new Group();
    orbitGroup.position.copy(vecToThree(node.position));
    layer.add(orbitGroup);

    const spinGroup = new Group();
    orbitGroup.add(spinGroup);

    const labelAnchor = new Group();
    const radial = new Vector2(node.basePosition.x, node.basePosition.z);
    const lift = node.size * (node.visualTier === "core" ? 2.6 : 2.1);
    if (radial.lengthSq() > 4) {
      radial.normalize();
      labelAnchor.position.set(radial.x * 14, lift, radial.y * 14);
    } else {
      labelAnchor.position.set(0, lift + 8, 0);
    }
    orbitGroup.add(labelAnchor);

    const baseHaloScale = node.size * (node.visualTier === "core" ? 7.2 : node.visualTier === "planet" ? 5.4 : 4.2);
    const outerHalo = createSprite({
      texture: glowTexture(node.glow),
      color: node.glow,
      opacity: node.haloOpacity,
      scale: baseHaloScale,
    });
    spinGroup.add(outerHalo);

    const colorBody = createSprite({
      texture: starTexture(node.color),
      color: node.color,
      opacity: node.bodyOpacity,
      scale: node.size,
    });
    spinGroup.add(colorBody);

    const whiteCore = createSprite({
      texture: whiteCoreTexture(),
      color: "#ffffff",
      opacity: node.visualTier === "core" ? 1 : 0.92,
      scale: node.size * 0.38,
    });
    spinGroup.add(whiteCore);

    const rings: Line[] = [];
    for (let ringIndex = 0; ringIndex < node.ringCount; ringIndex += 1) {
      const ring = createPlanetRing(
        node.size * (1.55 + ringIndex * 0.38),
        node.color,
        node.visualTier === "core" ? 0.42 - ringIndex * 0.12 : 0.28,
      );
      spinGroup.add(ring);
      rings.push(ring);
    }

    if (node.showLabel) {
      labels.push({ el: createLabelCard(node), nodeId: node.id });
    }

    const hit = new Mesh(
      new SphereGeometry(node.hitSize, 10, 10),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hit.userData.id = node.id;
    orbitGroup.add(hit);
    hitObjects.push(hit);

    visuals.set(node.id, {
      node,
      orbitGroup,
      spinGroup,
      labelAnchor,
      outerHalo,
      colorBody,
      whiteCore,
      rings,
      hit,
      spinAngle: (hashId(node.id) % 628) / 100,
      baseHaloScale,
      baseBodyScale: node.size,
    });
  }

  return { hitObjects, visuals, labels };
}

function createPlanetRing(radius: number, color: string, opacity: number): Line {
  const points: Vector3[] = [];
  const steps = 96;
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    points.push(new Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius * 0.88));
  }
  const ring = new Line(
    new BufferGeometry().setFromPoints(points),
    new LineBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  ring.rotation.x = 0.42;
  return ring;
}

function gravityLinkCurve(source: Vector3, target: Vector3, kind: string) {
  const mid = source.clone().lerp(target, 0.5);
  const distance = source.distanceTo(target);
  const well = gravityBarrierPoint(0, 0);
  const sag = Math.min(source.y, target.y, well.y + 40) - distance * (kind === "part_of" ? 0.1 : 0.06);
  mid.y = Math.min(mid.y, sag);
  if (kind === "gravity_pull") {
    const pull = new Vector3(0, well.y + 24, 0);
    return new CatmullRomCurve3([source, mid.clone().lerp(pull, 0.42), target]);
  }
  mid.x *= 0.9;
  mid.z *= 0.9;
  return new CatmullRomCurve3([source, mid, target]);
}

function vecToThree(position: { x: number; y: number; z: number }) {
  return new Vector3(position.x, position.y, position.z);
}

function addGravityBarrierGrid(layer: Group) {
  const curves: CatmullRomCurve3[] = [];
  const gridSize = 980;
  const lineCount = 35;
  const steps = 150;
  const gridColor = new Color("#6b52d8");
  const rimColor = new Color("#c86bff");
  const ringColorFor = (r: number) =>
    new Color("#c060ff").lerp(new Color("#2f4bd0"), Math.min(r / (gridSize * 0.75), 1));

  for (let i = 0; i < lineCount; i += 1) {
    const offset = -gridSize + (i / (lineCount - 1)) * gridSize * 2;
    const emphasis = i === 0 || i === lineCount - 1 || i === Math.floor(lineCount / 2);
    const pointsX: Vector3[] = [];
    const pointsZ: Vector3[] = [];

    for (let step = 0; step <= steps; step += 1) {
      const v = -gridSize + (step / steps) * gridSize * 2;
      pointsX.push(vecToThree(gravityBarrierPoint(v, offset)));
      pointsZ.push(vecToThree(gravityBarrierPoint(offset, v)));
    }

    const curveX = new CatmullRomCurve3(pointsX);
    const curveZ = new CatmullRomCurve3(pointsZ);
    curves.push(curveX, curveZ);
    layer.add(createGridLine(curveX, emphasis ? rimColor : gridColor, emphasis ? 0.34 : 0.16));
    layer.add(createGridLine(curveZ, emphasis ? rimColor : gridColor, emphasis ? 0.34 : 0.16));
  }

  for (let ring = 0; ring < 18; ring += 1) {
    const radius = 110 + ring * 34;
    const points: Vector3[] = [];
    for (let step = 0; step <= 220; step += 1) {
      const t = (step / 220) * Math.PI * 2;
      points.push(vecToThree(gravityBarrierPoint(Math.cos(t) * radius, Math.sin(t) * radius)));
    }
    const curve = new CatmullRomCurve3(points, true);
    curves.push(curve);
    layer.add(createGridLine(curve, ringColorFor(radius), ring < 4 ? 0.42 : 0.16));
  }

  return curves;
}

function createGridLine(curve: CatmullRomCurve3, color: Color, opacity: number) {
  return new Line(
    new BufferGeometry().setFromPoints(curve.getPoints(180)),
    new LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
}

function addBarrierCore(layer: Group, hasHero: boolean) {
  const coreOpacity = hasHero ? 0.38 : 0.9;
  const hotOpacity = hasHero ? 0.34 : 0.86;
  const core = createSprite({
    texture: glowTexture("#ffcf7a"),
    color: "#ffcf7a",
    opacity: coreOpacity,
    scale: hasHero ? 120 : 170,
  });
  core.position.set(0, -352, 0);
  layer.add(core);

  const hot = createSprite({
    texture: coreTexture(),
    color: "#fff2d6",
    opacity: hotOpacity,
    scale: hasHero ? 42 : 58,
  });
  hot.position.set(0, -344, 0);
  layer.add(hot);

  for (let index = 0; index < 7; index += 1) {
    const points: Vector3[] = [];
    const radius = 72 + index * 34;
    for (let step = 0; step <= 180; step += 1) {
      const t = (step / 180) * Math.PI * 2;
      points.push(vecToThree(gravityBarrierPoint(Math.cos(t) * radius, Math.sin(t) * radius)));
    }
    const ring = createGridLine(
      new CatmullRomCurve3(points, true),
      new Color(index % 2 === 0 ? "#ffe6ad" : "#c78bff"),
      (hasHero ? 0.16 : 0.24) - index * 0.018,
    );
    layer.add(ring);
  }
}

function addSparseStarfield(layer: Group) {
  for (let index = 0; index < 180; index += 1) {
    const seed = hashId(`barrier-star:${index}`);
    const sprite = createSprite({
      texture: glowTexture(index % 7 === 0 ? "#e7ddff" : "#8f9cff"),
      color: index % 7 === 0 ? "#e7ddff" : "#8f9cff",
      opacity: index % 7 === 0 ? 0.16 : 0.08,
      scale: 1.3 + (seed % 7) * 0.5,
    });
    sprite.position.set(
      ((seed % 2000) / 1000 - 1) * 1180,
      260 + ((seed >> 5) % 520),
      (((seed >> 10) % 2000) / 1000 - 1) * 760,
    );
    layer.add(sprite);
  }
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
      color: new Color(input.color),
      transparent: true,
      opacity: input.opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  sprite.scale.set(input.scale, input.scale, 1);
  return sprite;
}

function glowTexture(color: string) {
  const key = `glow:${color}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.22, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  textureCache.set(key, texture);
  return texture;
}

function starTexture(color: string) {
  const key = `star:${color}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.35, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  textureCache.set(key, texture);
  return texture;
}

function whiteCoreTexture() {
  const key = "white-core";
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new CanvasTexture(canvas);
  textureCache.set(key, texture);
  return texture;
}

function coreTexture() {
  const key = "gravity-core";
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const ctx = canvas.getContext("2d")!;
  const glow = ctx.createRadialGradient(96, 96, 0, 96, 96, 92);
  glow.addColorStop(0, "#ffffff");
  glow.addColorStop(0.16, "#fff3da");
  glow.addColorStop(0.34, "rgba(255, 206, 122, 0.75)");
  glow.addColorStop(1, "rgba(255, 206, 122, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 192, 192);
  ctx.strokeStyle = "rgba(255, 224, 170, 0.85)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(96, 96, 44, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new CanvasTexture(canvas);
  textureCache.set(key, texture);
  return texture;
}
