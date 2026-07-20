/**
 * Gravity: one 3D point-line blob. Uniform nodes, no labels / hover text.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { getGraphLayout, saveGraphLayout } from "../shared/api";
import {
  buildGravityFluidScene,
  type FluidSceneModel,
} from "../shared/gravityFluidScene";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import type { ArtifactView, Identity, Relation } from "../shared/types";
import { useI18n } from "../shared/i18n";
import { kindLabel } from "../shared/utils";
import { useElementSize } from "../shared/useElementSize";

interface GravityFluidGraph3DProps {
  packageId: string;
  artifacts: ArtifactView[];
  relations: Relation[];
  relationKinds: string[];
  identities: Identity[];
  centerId: string | null;
  selectedId?: string | null;
  appearance: GraphAppearanceSettings;
  onSelect: (id: string | null) => void;
  onOpenDetail?: (id: string) => void;
}

type CameraPose = {
  yaw: number;
  pitch: number;
  radius: number;
  tx: number;
  ty: number;
  tz: number;
  focusedPivot: boolean;
};

const GRAVITY_LAYOUT_MODE = "gravity:v1";
const CAM_KEY = "__camera__";
const TGT_KEY = "__target__";
const FOCUS_KEY = "__focus_pivot__";

interface NodeVisual {
  index: number;
  id: string;
  label: string;
  degree: number;
  group: Group;
  halo: Sprite;
  body: Sprite;
  core: Sprite;
  ring: Sprite;
  hit: Sprite;
  phase: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  color: string;
  sizeMul: number;
  role: "idle" | "selected" | "neighbor" | "dim";
}

const textureCache = new Map<string, CanvasTexture>();
const BODY_PX = 8.4;
const HALO_MUL = 2.35;
const EDGE_IDLE = new Color("#6a849e");
const EDGE_DIM = new Color("#101820");

export function GravityFluidGraph3D({
  packageId,
  artifacts,
  relations,
  relationKinds,
  identities,
  centerId,
  selectedId = null,
  appearance,
  onSelect,
  onOpenDetail,
}: GravityFluidGraph3DProps) {
  const { t, locale } = useI18n();
  const { ref, size } = useElementSize<HTMLDivElement>();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  const motionPausedRef = useRef(false);
  const selectionApiRef = useRef<((id: string | null) => void) | null>(null);
  const zoomApiRef = useRef<{
    zoom: (factor: number) => void;
    reset: () => void;
    focusSelected: () => void;
  } | null>(null);
  const onSelectRef = useRef(onSelect);
  const onOpenDetailRef = useRef(onOpenDetail);
  const cameraStateRef = useRef<CameraPose | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);
  const [viewMode, setViewMode] = useState<"global" | "neighborhood">("global");
  const viewModeRef = useRef<"global" | "neighborhood">("global");

  selectedIdRef.current = selectedId;
  onSelectRef.current = onSelect;
  onOpenDetailRef.current = onOpenDetail;

  const fingerprint = useMemo(() => {
    const nodeIds = artifacts.map((a) => a.id).sort().join("|");
    const edgeIds = relations.map((r) => r.id).sort().join("|");
    return `${nodeIds}::${edgeIds}`;
  }, [artifacts, relations]);

  const model = useMemo(
    () =>
      buildGravityFluidScene({
        artifacts,
        relations,
        identities,
        centerId,
        appearance,
        relationKinds,
      }),
    // centerId is unused by the fluid layout; keep it out so clicking a node
    // does not rebuild / reset the 3D scene.
    [artifacts, relations, identities, appearance, relationKinds],
  );

  useEffect(() => {
    let alive = true;
    setLayoutReady(false);
    motionPausedRef.current = false;
    getGraphLayout(packageId, GRAVITY_LAYOUT_MODE, fingerprint)
      .then((doc) => {
        if (!alive) return;
        const cam = doc?.positions?.[CAM_KEY];
        const tgt = doc?.positions?.[TGT_KEY];
        const focus = doc?.positions?.[FOCUS_KEY];
        if (
          cam &&
          tgt &&
          typeof cam.z === "number" &&
          typeof tgt.z === "number"
        ) {
          const targetZ = tgt.z;
          const legacyFocusTolerance = Math.max(12, model.radius * 0.025);
          const legacyTargetMatchesNode = !focus && model.nodes.some((node) =>
            Math.hypot(node.x - tgt.x, node.y - tgt.y, node.z - targetZ) <= legacyFocusTolerance,
          );
          cameraStateRef.current = {
            yaw: cam.x,
            pitch: cam.y,
            radius: cam.z,
            tx: tgt.x,
            ty: tgt.y,
            tz: targetZ,
            focusedPivot: focus?.x === 1 || legacyTargetMatchesNode,
          };
        } else {
          cameraStateRef.current = null;
        }
        setLayoutReady(true);
      })
      .catch(() => {
        if (!alive) return;
        cameraStateRef.current = null;
        setLayoutReady(true);
      });
    return () => {
      alive = false;
    };
  }, [packageId, fingerprint, model]);

  useEffect(() => {
    selectionApiRef.current?.(selectedId);
    if (!selectedId) motionPausedRef.current = false;
  }, [selectedId, model]);

  useEffect(() => {
    const mount = stageRef.current;
    if (!mount || !layoutReady) return;

    const width = Math.max(size.width, 640);
    const height = Math.max(size.height, 480);
    const scene = new Scene();
    const camera = new PerspectiveCamera(40, width / height, 1, 50000);
    const renderer = new WebGLRenderer({
      alpha: false,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.className = "gravity-fluid-canvas";
    mount.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new Vector2(width, height), 0.85, 0.42, 0.22);
    bloom.threshold = 0.28;
    bloom.strength = 0.72;
    bloom.radius = 0.48;
    composer.addPass(bloom);

    const world = new Group();
    const edgeLayer = new Group();
    const nodeLayer = new Group();
    world.add(edgeLayer, nodeLayer);
    scene.add(world);

    const target = new Vector3(model.cx, model.cy, model.cz);
    const fitted = fitRadius(camera, model, width, height);
    let radius = fitted;
    let yaw = 0.5;
    let pitch = -0.14;
    const saved = cameraStateRef.current;
    if (saved) {
      yaw = saved.yaw;
      pitch = saved.pitch;
      target.set(saved.tx, saved.ty, saved.tz);
      // Keep intentional zoom-in; if layout remount left us too far out, snap to default fill.
      radius = saved.radius > fitted * 1.15 ? fitted : saved.radius;
    }
    // Only restore a node pivot when a real selection is still active.
    let focusedPivotId: string | null =
      saved?.focusedPivot && selectedIdRef.current ? selectedIdRef.current : null;
    const nodeBodies: Object3D[] = [];
    const nodeVisuals = new Map<string, NodeVisual>();
    const useTypeColors = relationKinds.length < 6;
    const { segments, fromIdx, toIdx, edgeCount, colorAttr, typeColors } = buildEdgeSegments(
      edgeLayer,
      model,
      useTypeColors,
    );
    const neighbors = buildNeighborMap(fromIdx, toIdx, edgeCount, model.nodes.length);
    const n = model.nodes.length;
    const phases = new Float32Array(n);
    const nodeByIndex: NodeVisual[] = new Array(n);
    buildNodes(nodeLayer, model, nodeBodies, nodeVisuals, nodeByIndex, phases);
    const edgeAttr = segments.geometry.getAttribute("position") as Float32BufferAttribute;
    const edgeMaterial = segments.material as LineBasicMaterial;

    const chip = document.createElement("div");
    chip.className = "gravity-fluid-chip";
    chip.hidden = true;
    mount.appendChild(chip);

    const pin = document.createElement("div");
    pin.className = "gravity-fluid-pin";
    pin.hidden = true;
    mount.appendChild(pin);
    const onPinClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("button")) return;
      const id = selectedIdRef.current;
      if (id) onOpenDetailRef.current?.(id);
    };
    pin.addEventListener("click", onPinClick);
    const pinProjection = new Vector3();
    const directional = new Map<string, { incoming: number; outgoing: number }>();
    for (const edge of model.edges) {
      const from = directional.get(edge.from) ?? { incoming: 0, outgoing: 0 };
      from.outgoing += 1;
      directional.set(edge.from, from);
      const to = directional.get(edge.to) ?? { incoming: 0, outgoing: 0 };
      to.incoming += 1;
      directional.set(edge.to, to);
    }

    const updateSelectionPin = () => {
      const id = selectedIdRef.current;
      const visual = id ? nodeVisuals.get(id) : undefined;
      if (!id || !visual) {
        pin.hidden = true;
        return;
      }
      pinProjection.copy(visual.group.position).project(camera);
      const canvasWidth = renderer.domElement.clientWidth || width;
      const canvasHeight = renderer.domElement.clientHeight || height;
      const rawX = (pinProjection.x * 0.5 + 0.5) * canvasWidth;
      const rawY = (-pinProjection.y * 0.5 + 0.5) * canvasHeight;
      const behind = pinProjection.z < -1 || pinProjection.z > 1;
      const offscreen =
        behind || rawX < 24 || rawX > canvasWidth - 24 || rawY < 24 || rawY > canvasHeight - 24;
      const cardWidth = 292;
      const placeLeft = rawX > canvasWidth - cardWidth - 48;
      const x = clamp(rawX, 30, canvasWidth - 30);
      const y = clamp(rawY, 92, canvasHeight - 92);
      pin.hidden = false;
      pin.dataset.offscreen = offscreen ? "true" : "false";
      pin.dataset.side = placeLeft ? "left" : "right";
      pin.style.transform = `translate(${x}px, ${y}px) translate(${placeLeft ? "calc(-100% - 26px)" : "26px"}, -50%)`;
      if (pin.dataset.nodeId !== id) {
        const node = model.nodeById.get(id);
        const flow = directional.get(id) ?? { incoming: 0, outgoing: 0 };
        pin.dataset.nodeId = id;
        pin.innerHTML = `
          <div class="gravity-card-head">
            <span class="gravity-card-kind">${escapeHtml(assetKindGlyph(node?.kind))}</span>
            <strong>${escapeHtml(visual.label)}</strong>
          </div>
          <div class="gravity-card-type">${escapeHtml(assetKindLabel(node?.kind, locale, t))}</div>
          <div class="gravity-card-stats">
            <span title="${escapeHtml(t("gravity.relations.hint"))}">${escapeHtml(t("gravity.relations", { count: visual.degree }))}</span>
            <span title="${escapeHtml(t("gravity.downstream.hint"))}">${escapeHtml(t("gravity.downstream", { count: flow.outgoing }))}</span>
            <span title="${escapeHtml(t("gravity.upstream.hint"))}">${escapeHtml(t("gravity.upstream", { count: flow.incoming }))}</span>
          </div>
          <button type="button">${escapeHtml(t("gravity.viewDetail"))} <span aria-hidden="true">›</span></button>
        `;
      }
    };

    const schedulePersist = () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => {
        const pose = cameraStateRef.current;
        if (!pose) return;
        void saveGraphLayout(packageId, {
          schemaVersion: "1",
          mode: GRAVITY_LAYOUT_MODE,
          width,
          height,
          fingerprint,
          positions: {
            [CAM_KEY]: { x: pose.yaw, y: pose.pitch, z: pose.radius },
            [TGT_KEY]: { x: pose.tx, y: pose.ty, z: pose.tz },
            [FOCUS_KEY]: { x: focusedPivotId ? 1 : 0, y: 0, z: 0 },
          },
        });
      }, 400);
    };

    const applyView = () => {
      const cosPitch = Math.cos(pitch);
      camera.position.set(
        target.x + Math.sin(yaw) * cosPitch * radius,
        target.y + Math.sin(pitch) * radius,
        target.z + Math.cos(yaw) * cosPitch * radius,
      );
      camera.lookAt(target);
      applyNodeScreenScale(camera, nodeVisuals, renderer.domElement.clientHeight || height);
      updateSelectionPin();
      cameraStateRef.current = {
        yaw,
        pitch,
        radius,
        tx: target.x,
        ty: target.y,
        tz: target.z,
        focusedPivot: Boolean(focusedPivotId),
      };
    };

    const resetView = () => {
      focusedPivotId = null;
      target.set(model.cx, model.cy, model.cz);
      radius = fitRadius(camera, model, width, height);
      yaw = 0.5;
      pitch = -0.14;
      applyView();
    };

    /** Globe pivot: graph centroid, camera pose preserved. */
    const anchorToGraphCentroid = () => {
      const centroid = new Vector3();
      for (const visual of nodeVisuals.values()) centroid.add(visual.group.position);
      if (nodeVisuals.size > 0) centroid.multiplyScalar(1 / nodeVisuals.size);
      else centroid.set(model.cx, model.cy, model.cz);

      const offsetX = camera.position.x - centroid.x;
      const offsetY = camera.position.y - centroid.y;
      const offsetZ = camera.position.z - centroid.z;
      radius = clamp(Math.hypot(offsetX, offsetY, offsetZ), 180, 12000);
      yaw = Math.atan2(offsetX, offsetZ);
      pitch = Math.asin(clamp(offsetY / Math.max(radius, 0.001), -1, 1));
      target.copy(centroid);
      focusedPivotId = null;
      applyView();
    };

    // Tracks only pivots created by node focus. A user pan is not a node anchor
    // and must survive selection changes.
    const releaseFocusedPivot = () => {
      if (!focusedPivotId) return false;
      anchorToGraphCentroid();
      return true;
    };

    const focusSelected = () => {
      const id = selectedIdRef.current;
      const visual = id ? nodeVisuals.get(id) : undefined;
      if (!visual) return;

      // Change orbit pivot without teleporting the camera.
      const offsetX = camera.position.x - visual.group.position.x;
      const offsetY = camera.position.y - visual.group.position.y;
      const offsetZ = camera.position.z - visual.group.position.z;
      const nextRadius = Math.hypot(offsetX, offsetY, offsetZ);
      radius = clamp(nextRadius, 180, 12000);
      yaw = Math.atan2(offsetX, offsetZ);
      pitch = Math.asin(clamp(offsetY / Math.max(radius, 0.001), -1, 1));
      target.copy(visual.group.position);
      focusedPivotId = id;
      applyView();
    };

    const updateChip = (id: string | null, mode: "hover" | "selected" | "switch") => {
      if (!id) {
        chip.hidden = true;
        chip.textContent = "";
        return;
      }
      const visual = nodeVisuals.get(id);
      if (!visual) {
        chip.hidden = true;
        return;
      }
      if (mode === "selected") {
        chip.hidden = true;
        chip.textContent = "";
        return;
      }
      chip.hidden = false;
      chip.dataset.mode = mode;
      const hint = mode === "switch" ? t("gravity.clickSwitch") : t("gravity.connections", { count: visual.degree });
      chip.innerHTML = `<strong>${escapeHtml(visual.label)}</strong><span>${hint}</span>`;
    };

    let hoveredId: string | null = null;

    const paintNodeRole = (visual: NodeVisual, role: NodeVisual["role"]) => {
      visual.role = role;
      const selected = role === "selected";
      visual.group.renderOrder = selected ? 20 : role === "neighbor" ? 5 : 0;
      visual.halo.renderOrder = selected ? 20 : 0;
      visual.body.renderOrder = selected ? 21 : 0;
      visual.core.renderOrder = selected ? 22 : 0;
      visual.ring.renderOrder = selected ? 23 : 0;
      visual.halo.material.depthTest = !selected;
      visual.body.material.depthTest = !selected;
      visual.core.material.depthTest = !selected;
      visual.ring.material.depthTest = !selected;
      if (role === "selected") {
        visual.ring.visible = true;
        visual.halo.visible = true;
        visual.body.material.opacity = 1;
        visual.core.material.opacity = 0.95;
        visual.halo.material.opacity = 0.62;
        visual.body.material.color.set("#ffffff");
        visual.halo.material.color.set("#c5ebff");
        return;
      }
      visual.ring.visible = false;
      if (role === "neighbor") {
        // Focus+context: neighbors stay readable, not competing with focus.
        visual.halo.visible = true;
        visual.body.material.opacity = 0.88;
        visual.core.material.opacity = 0.48;
        visual.halo.material.opacity = 0.18;
        visual.body.material.color.set("#ffffff");
        visual.halo.material.color.set(visual.color);
        return;
      }
      if (role === "dim") {
        // Background context: keep clickable discs, kill bloom/glow so they don't steal focus.
        visual.halo.visible = false;
        visual.body.material.opacity = 0.2;
        visual.core.material.opacity = 0.08;
        visual.halo.material.opacity = 0;
        visual.body.material.color.set("#5b6a7a");
        visual.halo.material.color.set("#2a3340");
        return;
      }
      visual.halo.visible = true;
      visual.body.material.opacity = 0.92;
      visual.core.material.opacity = 0.5;
      visual.halo.material.opacity = 0.26;
      visual.body.material.color.set("#ffffff");
      visual.halo.material.color.set(visual.color);
    };

    const applyHover = (id: string | null) => {
      if (hoveredId === id) return;
      // Restore previous hover target to its selection role.
      if (hoveredId && hoveredId !== selectedIdRef.current) {
        const prev = nodeVisuals.get(hoveredId);
        if (prev) {
          const selectedIndex = selectedIdRef.current
            ? (nodeVisuals.get(selectedIdRef.current)?.index ?? -1)
            : -1;
          const neighborSet =
            selectedIndex >= 0 ? (neighbors.get(selectedIndex) ?? new Set<number>()) : null;
          if (!selectedIdRef.current) paintNodeRole(prev, "idle");
          else if (neighborSet?.has(prev.index)) paintNodeRole(prev, "neighbor");
          else paintNodeRole(prev, viewModeRef.current === "neighborhood" ? "dim" : "idle");
        }
      }
      hoveredId = id;
      if (id && id !== selectedIdRef.current) {
        const visual = nodeVisuals.get(id);
        if (visual) {
          visual.role = "neighbor";
          visual.ring.visible = false;
          visual.halo.visible = true;
          visual.body.material.opacity = 1;
          visual.core.material.opacity = 0.78;
          visual.halo.material.opacity = 0.38;
          visual.body.material.color.set("#ffffff");
          visual.halo.material.color.set("#ffffff");
          applyView();
        }
        updateChip(id, selectedIdRef.current ? "switch" : "hover");
      } else if (selectedIdRef.current) {
        updateChip(selectedIdRef.current, "selected");
        applyView();
      } else {
        updateChip(null, "hover");
        applyView();
      }
    };

    const applyCurrentSelection = (id: string | null) => {
      selectedIdRef.current = id;
      hoveredId = null;
      if (!id) {
        const releasedNodePivot = releaseFocusedPivot();
        for (const visual of nodeVisuals.values()) paintNodeRole(visual, "idle");
        for (let e = 0; e < edgeCount; e += 1) {
          setEdgeColor(colorAttr, e, useTypeColors ? typeColors[e]! : EDGE_IDLE);
        }
        colorAttr.needsUpdate = true;
        edgeMaterial.opacity = 0.28;
        updateChip(null, "hover");
        pin.hidden = true;
        applyView();
        if (releasedNodePivot) schedulePersist();
        return;
      }

      const selectedIndex = nodeVisuals.get(id)?.index ?? -1;
      const neighborSet = neighbors.get(selectedIndex) ?? new Set<number>();
      for (const visual of nodeVisuals.values()) {
        if (visual.id === id) paintNodeRole(visual, "selected");
        else if (neighborSet.has(visual.index)) paintNodeRole(visual, "neighbor");
        else paintNodeRole(visual, viewModeRef.current === "neighborhood" ? "dim" : "idle");
      }

      for (let e = 0; e < edgeCount; e += 1) {
        const a = fromIdx[e]!;
        const b = toIdx[e]!;
        const direct = a === selectedIndex || b === selectedIndex;
        const betweenNeighbors = neighborSet.has(a) && neighborSet.has(b);
        const relationColor = typeColors[e]!;
        const background =
          viewModeRef.current === "neighborhood"
            ? betweenNeighbors
              ? relationColor
              : EDGE_DIM
            : useTypeColors
              ? relationColor
              : EDGE_IDLE;
        setEdgeColor(colorAttr, e, direct ? relationColor : background);
      }
      colorAttr.needsUpdate = true;
      // Keep hot edges readable while background web almost disappears.
      edgeMaterial.opacity = viewModeRef.current === "neighborhood" ? 0.78 : 0.36;
      updateChip(id, "selected");
      updateSelectionPin();
      applyView();
    };
    selectionApiRef.current = applyCurrentSelection;
    applyCurrentSelection(selectedIdRef.current);
    applyView();

    zoomApiRef.current = {
      zoom: (factor) => {
        radius = clamp(radius * factor, 180, 12000);
        applyView();
        schedulePersist();
      },
      reset: () => {
        resetView();
        schedulePersist();
      },
      focusSelected: () => {
        focusSelected();
        schedulePersist();
      },
    };

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let interaction: "orbit" | "pan" | null = null;
    let pressedNodeId: string | null = null;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;

    const pick = (event: PointerEvent): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      raycaster.params.Sprite = { threshold: 0 };
      const hit = raycaster.intersectObjects(nodeBodies, false)[0]?.object;
      return (hit?.userData.id as string) ?? null;
    };

    const onPointerDown = (event: PointerEvent) => {
      pressedNodeId = pick(event);
      moved = false;
      interaction = event.shiftKey || event.button === 1 || event.button === 2 ? "pan" : "orbit";
      // No selection → always spin around the graph center like a globe.
      if (interaction === "orbit" && !selectedIdRef.current) {
        anchorToGraphCentroid();
      }
      lastX = event.clientX;
      lastY = event.clientY;
      downX = event.clientX;
      downY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!interaction) {
        const id = pick(event);
        renderer.domElement.style.cursor = id ? "pointer" : "grab";
        applyHover(id);
        return;
      }
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 5) moved = true;

      if (interaction === "orbit") {
        // Unselected: yaw free 360° around graph centroid (globe).
        // Selected: same math, target pinned to focused node.
        yaw -= dx * 0.0048;
        pitch = clamp(pitch + dy * 0.0038, -1.2, 1.2);
        applyView();
      } else {
        const fov = (camera.fov * Math.PI) / 180;
        const worldPerPx =
          (2 * Math.tan(fov / 2) * radius) / (renderer.domElement.clientHeight || height);
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        target.addScaledVector(right, -dx * worldPerPx);
        target.addScaledVector(up, dy * worldPerPx);
        applyView();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!moved) {
        if (pressedNodeId) {
          motionPausedRef.current = true;
          applyCurrentSelection(pressedNodeId);
          focusSelected();
          onSelectRef.current(pressedNodeId);
        } else if (
          event.button === 0 &&
          !event.shiftKey &&
          viewModeRef.current !== "neighborhood"
        ) {
          // Global: click empty space to clear. Neighborhood must retain its center node.
          motionPausedRef.current = false;
          applyCurrentSelection(null);
          onSelectRef.current(null);
        }
      }
      interaction = null;
      pressedNodeId = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      renderer.domElement.style.cursor = "grab";
      if (moved) schedulePersist();
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      radius = clamp(radius * Math.exp(event.deltaY * 0.00105), 180, 12000);
      applyView();
      schedulePersist();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Leisurely auto-drag: small amplitude, slow frequencies, soft follow.
    const dragAmp = Math.max(18, model.radius * 0.09);
    let lastFrame = performance.now();

    const animate = (time: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (time - lastFrame) * 0.001));
      lastFrame = time;
      const t = reducedMotion ? 0 : time * 0.001;
      // Slow ease toward target — comfortable drift, not jitter.
      const follow = 1 - Math.exp(-dt * 1.05);

      if (!motionPausedRef.current) {
        for (let i = 0; i < n; i += 1) {
          const visual = nodeByIndex[i]!;
          if (reducedMotion) {
            visual.group.position.set(visual.baseX, visual.baseY, visual.baseZ);
            continue;
          }
          const p = phases[i]!;
          const targetX =
            visual.baseX +
            Math.sin(t * 0.13 + p) * dragAmp +
            Math.sin(t * 0.07 + p * 1.9) * dragAmp * 0.32;
          const targetY =
            visual.baseY +
            Math.sin(t * 0.11 + p * 1.4) * dragAmp * 0.78 +
            Math.cos(t * 0.06 + p * 0.8) * dragAmp * 0.28;
          const targetZ =
            visual.baseZ +
            Math.cos(t * 0.12 + p * 1.2) * dragAmp +
            Math.sin(t * 0.08 + p * 2.3) * dragAmp * 0.3;
          const pos = visual.group.position;
          pos.x += (targetX - pos.x) * follow;
          pos.y += (targetY - pos.y) * follow;
          pos.z += (targetZ - pos.z) * follow;
        }
      }

      // Exact Nebula drag path: edge endpoints = current node group positions, every frame.
      for (let e = 0; e < edgeCount; e += 1) {
        const from = nodeByIndex[fromIdx[e]!]!.group.position;
        const to = nodeByIndex[toIdx[e]!]!.group.position;
        edgeAttr.setXYZ(e * 2, from.x, from.y, from.z);
        edgeAttr.setXYZ(e * 2 + 1, to.x, to.y, to.z);
      }
      edgeAttr.needsUpdate = true;

      updateSelectionPin();
      composer.render();
      frameRef.current = window.requestAnimationFrame(animate);
    };
    frameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      zoomApiRef.current = null;
      selectionApiRef.current = null;
      chip.remove();
      pin.removeEventListener("click", onPinClick);
      pin.remove();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      scene.traverse((object) => {
        if (object instanceof LineSegments) {
          object.geometry.dispose();
          object.material.dispose();
        } else if (object instanceof Sprite) {
          object.material.dispose();
        }
      });
      composer.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [model, size.width, size.height, layoutReady, packageId, fingerprint, locale, t]);

  return (
    <div ref={ref} className="gravity-fluid-wrap">
      <div ref={stageRef} className="gravity-fluid-stage">
        <div className="gravity-fluid-zoom" aria-label={t("graph.canvasZoomAria")}>
          <button
            type="button"
            onClick={() => zoomApiRef.current?.zoom(0.82)}
            aria-label={t("graph.zoomIn")}
            title={t("graph.zoomIn")}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomApiRef.current?.zoom(1.22)}
            aria-label={t("graph.zoomOut")}
            title={t("graph.zoomOut")}
          >
            −
          </button>
          <button
            type="button"
            onClick={() => zoomApiRef.current?.reset()}
            aria-label={t("graph.resetView")}
            title={t("graph.resetView")}
          >
            ⟳
          </button>
          <button
            type="button"
            onClick={() => zoomApiRef.current?.focusSelected()}
            disabled={!selectedId}
            aria-label={t("gravity.locateSelected")}
            title={selectedId ? t("gravity.locateSelected") : t("gravity.selectNodeFirst")}
          >
            ◎
          </button>
        </div>
        <div className="gravity-view-mode" role="group" aria-label={t("gravity.viewAria")}>
          <button
            type="button"
            className={viewMode === "global" ? "active" : ""}
            aria-pressed={viewMode === "global"}
            title={t("gravity.globalHint")}
            onClick={() => {
              viewModeRef.current = "global";
              setViewMode("global");
              selectionApiRef.current?.(selectedIdRef.current);
            }}
          >
            {t("graph.global")}
          </button>
          <button
            type="button"
            className={viewMode === "neighborhood" ? "active" : ""}
            aria-pressed={viewMode === "neighborhood"}
            onClick={() => {
              viewModeRef.current = "neighborhood";
              setViewMode("neighborhood");
              selectionApiRef.current?.(selectedIdRef.current);
            }}
            disabled={!selectedId}
            title={selectedId ? t("gravity.neighborhoodHint") : t("gravity.selectNodeFirst")}
          >
            {t("graph.neighborhood")}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildNodes(
  layer: Group,
  model: FluidSceneModel,
  hitObjects: Object3D[],
  visuals: Map<string, NodeVisual>,
  nodeByIndex: NodeVisual[],
  phases: Float32Array,
) {
  model.nodes.forEach((node, index) => {
    const group = new Group();
    group.position.set(node.x, node.y, node.z);
    layer.add(group);

    phases[index] = (hash(node.id) % 6283) / 1000;

    const halo = makeSprite(softAuraTexture(node.color), node.color, 0.26, node.size * HALO_MUL, true);
    const body = makeSprite(knowledgeDiscTexture(node.color), "#ffffff", 0.92, node.size, false);
    const core = makeSprite(knowledgeCoreTexture(node.color), "#ffffff", 0.5, node.size * 0.42, false);
    const ring = makeSprite(selectionRingTexture(), "#9ad4ff", 0.95, node.size * 1.85, true);
    ring.visible = false;
    const hit = makeSprite(knowledgeCoreTexture(node.color), "#ffffff", 0, node.size * 5.2, false);
    body.userData.id = node.id;
    hit.userData.id = node.id;
    halo.userData.baseScale = node.size * HALO_MUL;

    group.add(halo, body, core, ring, hit);
    hitObjects.push(hit);

    const visual: NodeVisual = {
      index,
      id: node.id,
      label: node.label,
      degree: node.degree,
      group,
      halo,
      body,
      core,
      ring,
      hit,
      phase: phases[index]!,
      baseX: node.x,
      baseY: node.y,
      baseZ: node.z,
      color: node.color,
      sizeMul: node.size / 6.5,
      role: "idle",
    };
    visuals.set(node.id, visual);
    nodeByIndex[index] = visual;
  });
}

function buildEdgeSegments(
  layer: Group,
  model: FluidSceneModel,
  useTypeColors: boolean,
): {
  segments: LineSegments;
  fromIdx: Uint16Array;
  toIdx: Uint16Array;
  edgeCount: number;
  colorAttr: Float32BufferAttribute;
  typeColors: Color[];
} {
  const idToIndex = new Map(model.nodes.map((n, i) => [n.id, i]));
  const fromList: number[] = [];
  const toList: number[] = [];
  const positions: number[] = [];
  const colors: number[] = [];
  const typeColors: Color[] = [];

  for (const edge of model.edges) {
    const from = model.nodeById.get(edge.from);
    const to = model.nodeById.get(edge.to);
    if (!from || !to) continue;
    const fi = idToIndex.get(edge.from);
    const ti = idToIndex.get(edge.to);
    if (fi === undefined || ti === undefined) continue;
    fromList.push(fi);
    toList.push(ti);
    const typeColor = new Color(edge.color);
    typeColors.push(typeColor);
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    const initialColor = useTypeColors ? typeColor : EDGE_IDLE;
    colors.push(
      initialColor.r,
      initialColor.g,
      initialColor.b,
      initialColor.r,
      initialColor.g,
      initialColor.b,
    );
  }

  const edgeCount = fromList.length;
  const fromIdx = Uint16Array.from(fromList);
  const toIdx = Uint16Array.from(toList);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(new Float32Array(positions), 3));
  const colorAttr = new Float32BufferAttribute(new Float32Array(colors), 3);
  geo.setAttribute("color", colorAttr);

  const segments = new LineSegments(
    geo,
    new LineBasicMaterial({
      color: new Color("#ffffff"),
      vertexColors: true,
      transparent: true,
      opacity: 0.28,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  segments.frustumCulled = false;
  layer.add(segments);

  return { segments, fromIdx, toIdx, edgeCount, colorAttr, typeColors };
}

function buildNeighborMap(
  fromIdx: Uint16Array,
  toIdx: Uint16Array,
  edgeCount: number,
  nodeCount: number,
) {
  const neighbors = new Map<number, Set<number>>();
  for (let i = 0; i < nodeCount; i += 1) neighbors.set(i, new Set());
  for (let e = 0; e < edgeCount; e += 1) {
    const a = fromIdx[e]!;
    const b = toIdx[e]!;
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  }
  return neighbors;
}

function setEdgeColor(attr: Float32BufferAttribute, edgeIndex: number, color: Color) {
  attr.setXYZ(edgeIndex * 2, color.r, color.g, color.b);
  attr.setXYZ(edgeIndex * 2 + 1, color.r, color.g, color.b);
}

function applyNodeScreenScale(
  camera: PerspectiveCamera,
  visuals: Map<string, NodeVisual>,
  canvasHeight: number,
) {
  const fovRad = (camera.fov * Math.PI) / 180;
  for (const visual of visuals.values()) {
    const pos = visual.group.position;
    const dist = Math.max(camera.position.distanceTo(pos), 60);
    const visibleH = 2 * Math.tan(fovRad / 2) * dist;
    const roleMul =
      visual.role === "selected" ? 1.34 : visual.role === "neighbor" ? 1.06 : visual.role === "dim" ? 0.86 : 1;
    const body = ((BODY_PX * visual.sizeMul * roleMul) / canvasHeight) * visibleH;
    visual.body.scale.set(body, body, 1);
    visual.core.scale.set(body * 0.42, body * 0.42, 1);
    const halo = body * HALO_MUL;
    visual.halo.scale.set(halo, halo, 1);
    visual.halo.userData.baseScale = halo;
    visual.ring.scale.set(body * 1.85, body * 1.85, 1);
    visual.hit.scale.set(body * 4.2, body * 4.2, 1);
  }
}

/** Default framing: blob diameter fills ~86% of the shorter viewport edge. */
const DEFAULT_VIEW_FILL = 0.86;

function fitRadius(
  camera: PerspectiveCamera,
  model: FluidSceneModel,
  width: number,
  height: number,
) {
  const fov = (camera.fov * Math.PI) / 180;
  const pad = model.radius / DEFAULT_VIEW_FILL;
  const rH = pad / Math.tan(fov / 2);
  const rW = pad / (Math.tan(fov / 2) * (width / height));
  return Math.max(rH, rW, 220);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeSprite(
  texture: CanvasTexture,
  color: string,
  opacity: number,
  scale: number,
  additive: boolean,
) {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: texture,
      color: new Color(color),
      transparent: true,
      opacity,
      blending: additive ? AdditiveBlending : undefined,
      depthWrite: false,
    }),
  );
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

/** Soft outer aura — keeps depth without turning nodes into stars. */
function softAuraTexture(color: string) {
  return cachedTexture(`aura:${color}`, 160, (ctx) => {
    const g = ctx.createRadialGradient(80, 80, 8, 80, 80, 78);
    g.addColorStop(0, withAlpha(color, 0.45));
    g.addColorStop(0.45, withAlpha(color, 0.16));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 160, 160);
  });
}

/**
 * Obsidian-like knowledge disc: opaque soft circle + thin rim.
 * Reads as a note/node, not a particle spark.
 */
function knowledgeDiscTexture(color: string) {
  return cachedTexture(`disc:${color}`, 96, (ctx) => {
    const cx = 48;
    const cy = 48;
    const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, 36);
    fill.addColorStop(0, lighten(color, 0.35));
    fill.addColorStop(0.55, color);
    fill.addColorStop(0.82, darken(color, 0.12));
    fill.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, cy, 36, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = withAlpha("#ffffff", 0.35);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function knowledgeCoreTexture(color: string) {
  return cachedTexture(`kcore:${color}`, 48, (ctx) => {
    const g = ctx.createRadialGradient(24, 24, 0, 24, 24, 18);
    g.addColorStop(0, withAlpha("#ffffff", 0.85));
    g.addColorStop(0.4, withAlpha(lighten(color, 0.25), 0.55));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(24, 24, 18, 0, Math.PI * 2);
    ctx.fill();
  });
}

function selectionRingTexture() {
  return cachedTexture("select-ring", 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = "rgba(154, 212, 255, 0.95)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(64, 64, 46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(64, 64, 38, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function assetKindLabel(
  kind: string | undefined,
  locale: import("../shared/i18n").Locale,
  t: (key: import("../shared/i18n").MessageKey, vars?: Record<string, string | number>) => string,
): string {
  return t("gravity.assetKind", { kind: kindLabel(kind ?? "other", locale) });
}

function assetKindGlyph(kind?: string): string {
  if (kind === "markdown") return "M";
  if (kind === "image") return "▧";
  if (kind === "video") return "▶";
  if (kind === "audio") return "♪";
  if (kind === "html") return "‹›";
  return "◆";
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function withAlpha(hex: string, alpha: number) {
  const c = new Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
}

function lighten(hex: string, amount: number) {
  const c = new Color(hex);
  c.r = Math.min(1, c.r + amount);
  c.g = Math.min(1, c.g + amount);
  c.b = Math.min(1, c.b + amount);
  return `#${c.getHexString()}`;
}

function darken(hex: string, amount: number) {
  const c = new Color(hex);
  c.r = Math.max(0, c.r - amount);
  c.g = Math.max(0, c.g - amount);
  c.b = Math.max(0, c.b - amount);
  return `#${c.getHexString()}`;
}

function cachedTexture(
  key: string,
  dim: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): CanvasTexture {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = dim;
  canvas.height = dim;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  textureCache.set(key, texture);
  return texture;
}
