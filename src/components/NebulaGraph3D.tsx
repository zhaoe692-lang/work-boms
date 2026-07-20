import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  NormalBlending,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import type { DisplayEdge } from "../shared/graph";
import {
  buildNebulaModel,
  type NebulaModel,
  type NebulaNode,
} from "../shared/nebulaModel";
import type { ArtifactView, Identity, Work } from "../shared/types";
import { useI18n } from "../shared/i18n";
import { useElementSize } from "../shared/useElementSize";
import { NebulaPanel } from "./NebulaPanel";

interface NebulaGraph3DProps {
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  works: Work[];
  identities: Identity[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface NodeVisual {
  node: NebulaNode;
  group: Group;
  halo: Sprite;
  body: Sprite;
  core: Sprite;
}

interface EdgeVisual {
  from: NebulaNode;
  to: NebulaNode;
  line: Line<BufferGeometry, LineBasicMaterial>;
  ambient: boolean;
}

interface PulseVisual {
  sprite: Sprite;
  from: NebulaNode;
  to: NebulaNode;
  phase: number;
  speed: number;
}

interface ClusterLabel {
  el: HTMLDivElement;
  cx: number;
  cy: number;
  cz: number;
  shellId: string;
}

interface NodeLabel {
  el: HTMLDivElement;
  node: NebulaNode;
  visual: NodeVisual;
}

const textureCache = new Map<string, CanvasTexture>();
const ION_WHITE = "#eaf8ff";
const ELECTRIC_BLUE = "#68dfff";
const SELECTED_GOLD = "#ffd36a";

export function NebulaGraph3D({
  artifacts,
  edges,
  works,
  identities,
  selectedId,
  onSelect,
}: NebulaGraph3DProps) {
  const { locale, t } = useI18n();
  const { ref, size } = useElementSize<HTMLDivElement>();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  const selectionApiRef = useRef<((id: string | null) => void) | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const zoomApiRef = useRef<{ zoom: (factor: number) => void; reset: () => void } | null>(null);

  selectedIdRef.current = selectedId;

  const model = useMemo(
    () => buildNebulaModel(artifacts, edges, works, identities, locale),
    [artifacts, edges, works, identities, locale],
  );

  useEffect(() => {
    selectionApiRef.current?.(selectedId);
  }, [selectedId, model]);

  useEffect(() => {
    const mount = stageRef.current;
    const labelLayer = labelLayerRef.current;
    if (!mount || !labelLayer) return;

    const width = Math.max(size.width, 640);
    const height = Math.max(size.height, 480);
    const scene = new Scene();
    const camera = new PerspectiveCamera(44, width / height, 1, 40000);
    const renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.className = "nebula-canvas";
    mount.appendChild(renderer.domElement);

    const world = new Group();
    const edgeLayer = new Group();
    const pulseLayer = new Group();
    const nodeLayer = new Group();
    world.add(edgeLayer, pulseLayer, nodeLayer);
    scene.add(world);

    const target = new Vector3();
    const bounds = computeBounds(model);
    let radius = 2400;
    let yaw = 0.13;
    let pitch = -0.08;
    const nodeBodies: Object3D[] = [];
    const nodeVisuals = new Map<string, NodeVisual>();
    const clusterLabels: ClusterLabel[] = [];
    const nodeLabels: NodeLabel[] = [];

    const fitRadius = () => {
      const fov = (camera.fov * Math.PI) / 180;
      const halfH = Math.max(bounds.h * 0.68, 240);
      const halfW = Math.max(bounds.w * 0.68, 320);
      return Math.max(
        halfH / Math.tan(fov / 2),
        halfW / (Math.tan(fov / 2) * (width / height)),
      );
    };

    const applyView = () => {
      const cosPitch = Math.cos(pitch);
      camera.position.set(
        target.x + Math.sin(yaw) * cosPitch * radius,
        target.y + Math.sin(pitch) * radius,
        target.z + Math.cos(yaw) * cosPitch * radius,
      );
      camera.lookAt(target);
      applyNodeScreenScale(camera, nodeVisuals, renderer.domElement.clientHeight || height, selectedIdRef.current);
    };

    const resetView = () => {
      target.set(bounds.cx, bounds.cy, 0);
      radius = fitRadius();
      yaw = 0.13;
      pitch = -0.08;
      applyView();
    };

    const shellIdByCluster = new Map(model.clusters.map((cluster) => [cluster.id, cluster.shellId]));
    const shellOffsets = new Map(model.cloudShells.map((shell) => [shell.id, new Vector3()]));
    const edgeVisuals = buildEdges(edgeLayer, model);
    buildNodes(nodeLayer, model, nodeBodies, nodeVisuals);
    const pulses = buildPulses(pulseLayer, edgeVisuals);
    buildClusterLabels(labelLayer, model, clusterLabels);
    buildNodeLabels(labelLayer, model, nodeVisuals, nodeLabels);

    const applyCurrentSelection = (id: string | null) => {
      applySelection(nodeVisuals, edgeVisuals, id, model);
      applyNodeLabelSelection(nodeLabels, id, model);
    };
    selectionApiRef.current = applyCurrentSelection;
    applyCurrentSelection(selectedIdRef.current);
    resetView();

    zoomApiRef.current = {
      zoom: (factor) => {
        radius = clamp(radius * factor, 320, 16000);
        applyView();
      },
      reset: resetView,
    };

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const dragPlane = new Plane();
    const planeHit = new Vector3();
    const dragOffset = new Vector3();
    const dragWorldPos = new Vector3();
    const cameraNormal = new Vector3();
    let interaction: "node" | "orbit" | "pan" | null = null;
    let draggedNodeId: string | null = null;
    let pressedNodeId: string | null = null;
    let hovered: string | null = null;
    let lastX = 0;
    let lastY = 0;

    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
    };

    const pick = (event: PointerEvent): string | null => {
      setPointer(event);
      raycaster.params.Sprite = { threshold: 0 };
      const hit = raycaster.intersectObjects(nodeBodies, false)[0]?.object;
      return (hit?.userData.id as string) ?? null;
    };

    const onPointerDown = (event: PointerEvent) => {
      const id = pick(event);
      pressedNodeId = id;
      draggedNodeId = id;
      interaction = id ? "node" : event.shiftKey ? "pan" : "orbit";
      lastX = event.clientX;
      lastY = event.clientY;
      if (id) {
        const visual = nodeVisuals.get(id);
        if (visual) {
          camera.getWorldDirection(cameraNormal);
          visual.group.getWorldPosition(dragWorldPos);
          dragPlane.setFromNormalAndCoplanarPoint(cameraNormal, dragWorldPos);
          raycaster.ray.intersectPlane(dragPlane, planeHit);
          dragOffset.copy(planeHit).sub(dragWorldPos);
        }
      }
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = id ? "grabbing" : event.shiftKey ? "move" : "grabbing";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!interaction) {
        const id = pick(event);
        hovered = id;
        setHoveredId(id);
        renderer.domElement.style.cursor = id ? "grab" : "crosshair";
        return;
      }

      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;

      if (interaction === "node" && draggedNodeId) {
        setPointer(event);
        const visual = nodeVisuals.get(draggedNodeId);
        if (visual && raycaster.ray.intersectPlane(dragPlane, planeHit)) {
          planeHit.sub(dragOffset);
          visual.group.position.copy(nodeLayer.worldToLocal(planeHit));
          const shellId = shellIdByCluster.get(visual.node.clusterId);
          const offset = shellId ? shellOffsets.get(shellId) : undefined;
          visual.node.x = visual.group.position.x - (offset?.x ?? 0);
          visual.node.y = visual.group.position.y - (offset?.y ?? 0);
          visual.node.z = visual.group.position.z - (offset?.z ?? 0);
          updateEdgePositions(edgeVisuals, shellOffsets, shellIdByCluster);
        }
      } else if (interaction === "orbit") {
        yaw -= dx * 0.0052;
        pitch = clamp(pitch + dy * 0.0042, -1.05, 1.05);
        applyView();
      } else if (interaction === "pan") {
        const fov = (camera.fov * Math.PI) / 180;
        const worldPerPx = (2 * Math.tan(fov / 2) * radius) / (renderer.domElement.clientHeight || height);
        target.x -= dx * worldPerPx;
        target.y += dy * worldPerPx;
        applyView();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pressedNodeId) {
        selectedIdRef.current = pressedNodeId;
        applyCurrentSelection(pressedNodeId);
        onSelect(pressedNodeId);
      }
      interaction = null;
      draggedNodeId = null;
      pressedNodeId = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      renderer.domElement.style.cursor = hovered ? "grab" : "crosshair";
    };

    const onPointerLeave = () => {
      if (!interaction) {
        hovered = null;
        setHoveredId(null);
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      radius = clamp(radius * Math.exp(event.deltaY * 0.0011), 320, 16000);
      applyView();
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const worldPos = new Vector3();
    const screenPos = new Vector3();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const animate = (time: number) => {
      frame += 1;
      const t = reducedMotion ? 0 : time * 0.001;

      if (reducedMotion) {
        world.position.set(0, 0, 0);
        world.rotation.set(0, 0, 0);
        world.scale.set(1, 1, 1);
      } else {
        const driftX = Math.sin(t * 0.19 + 0.8) * 12 + Math.sin(t * 0.071) * 7;
        const driftY = Math.sin(t * 0.143 + 2.1) * 8 + Math.cos(t * 0.053) * 5;
        const driftZ = Math.cos(t * 0.113 + 1.4) * 9;
        const breathe = Math.sin(t * 0.227) * 0.009 + Math.sin(t * 0.097 + 1.8) * 0.005;
        world.position.set(driftX, driftY, driftZ);
        world.rotation.set(
          Math.sin(t * 0.083 + 0.4) * 0.006,
          Math.sin(t * 0.067 + 1.2) * 0.012,
          Math.cos(t * 0.059) * 0.004,
        );
        world.scale.set(1 + breathe, 1 - breathe * 0.55, 1 + breathe * 0.72);
      }
      for (let index = 0; index < model.cloudShells.length; index += 1) {
        const shell = model.cloudShells[index];
        const phase = index * 1.713 + 0.37;
        const offset = shellOffsets.get(shell.id)!;
        if (reducedMotion) {
          offset.set(0, 0, 0);
        } else {
          offset.set(
            Math.sin(t * (0.17 + index * 0.009) + phase) * (7 + index % 3 * 2),
            Math.sin(t * (0.13 + index * 0.007) + phase * 1.7) * (5 + index % 2 * 2),
            Math.cos(t * (0.11 + index * 0.011) + phase * 0.8) * 7,
          );
        }
      }
      for (const visual of nodeVisuals.values()) {
        const shellId = shellIdByCluster.get(visual.node.clusterId);
        const offset = shellId ? shellOffsets.get(shellId) : undefined;
        visual.group.position.set(
          visual.node.x + (offset?.x ?? 0),
          visual.node.y + (offset?.y ?? 0),
          visual.node.z + (offset?.z ?? 0),
        );
      }
      updateEdgePositions(edgeVisuals, shellOffsets, shellIdByCluster);
      animatePulses(pulses, selectedIdRef.current, t, shellOffsets, shellIdByCluster);

      for (const [id, visual] of nodeVisuals) {
        const selected = id === selectedIdRef.current;
        const hot = selected || id === hovered;
        const pulse = hot ? 1 + Math.sin(t * 4.2) * 0.14 : 1;
        visual.halo.scale.setScalar(visual.halo.userData.baseScale * pulse);
      }

      const rect = renderer.domElement.getBoundingClientRect();
      positionNodeLabels(nodeLabels, camera, rect, radius, fitRadius(), selectedIdRef.current, hovered, worldPos, screenPos);
      for (const label of clusterLabels) {
        const offset = shellOffsets.get(label.shellId);
        worldPos.set(
          label.cx + (offset?.x ?? 0),
          label.cy + (offset?.y ?? 0),
          label.cz + (offset?.z ?? 0),
        );
        world.localToWorld(worldPos);
        screenPos.copy(worldPos).project(camera);
        label.el.style.transform = `translate(${(screenPos.x * 0.5 + 0.5) * rect.width}px, ${(-screenPos.y * 0.5 + 0.5) * rect.height}px) translate(-50%, -50%)`;
        label.el.style.opacity = screenPos.z < 1 ? "1" : "0";
      }

      if (frame % 8 === 0) {
        drawMinimap(minimapRef.current, model, camera, target, radius, width / height);
      }
      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(animate);
    };
    frameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      zoomApiRef.current = null;
      selectionApiRef.current = null;
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("wheel", onWheel);
      for (const label of clusterLabels) label.el.remove();
      for (const label of nodeLabels) label.el.remove();
      scene.traverse((object) => {
        if (object instanceof Line) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        } else if (object instanceof Sprite) {
          object.material.dispose();
        }
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [model, onSelect, size.width, size.height]);

  const hoveredNode = hoveredId ? model.nodeById.get(hoveredId) : null;

  return (
    <div ref={ref} className="nebula-wrap">
      <div ref={stageRef} className="nebula-stage nebula-electric-stage">
        <div ref={labelLayerRef} className="nebula-cluster-labels" aria-hidden />
        <div className="nebula-mode-caption">
          <strong>AI VAULT / WORLD TREE</strong>
          <span>
            {t("nebula.statsLine", {
              nodes: model.overview.nodeCount,
              edges: model.overview.edgeCount,
            })}
          </span>
        </div>
        {hoveredNode && (
          <div className="nebula-hover-chip">
            <strong>{hoveredNode.label}</strong>
            <span className="nebula-hover-meta">
              {" "}
              · {t("nebula.links", { count: hoveredNode.degree })}
            </span>
          </div>
        )}
        <div className="nebula-zoom">
          <button type="button" onClick={() => zoomApiRef.current?.zoom(0.82)} title={t("graph.zoomIn")}>+</button>
          <button type="button" onClick={() => zoomApiRef.current?.zoom(1.22)} title={t("graph.zoomOut")}>−</button>
          <button type="button" onClick={() => zoomApiRef.current?.reset()} title={t("graph.fit")}>⤢</button>
        </div>
        <div className="nebula-legend">
          <div className="nebula-legend-title">{t("nebula.legendTitle")}</div>
          {model.kinds.map((kind) => (
            <div key={kind.kind} className="nebula-legend-row">
              <span className="nebula-legend-dot" style={{ background: kind.color }} />
              <span className="nebula-legend-label">{kind.label}</span>
              <span className="nebula-legend-count">{kind.count}</span>
            </div>
          ))}
        </div>
        <canvas ref={minimapRef} className="nebula-minimap" width={168} height={104} />
      </div>
      <NebulaPanel
        model={model}
        selectedNode={selectedId ? model.nodeById.get(selectedId) ?? null : null}
        onSelect={onSelect}
      />
    </div>
  );
}

function buildEdges(layer: Group, model: NebulaModel): EdgeVisual[] {
  const visuals: EdgeVisual[] = [];
  const realKeys = new Set<string>();
  for (const edge of model.edges) {
    const from = model.nodeById.get(edge.from);
    const to = model.nodeById.get(edge.to);
    if (!from || !to) continue;
    realKeys.add(edgeKey(from.id, to.id));
    visuals.push(addEdgeVisual(layer, from, to, false));
  }

  const ambientKeys = new Set<string>();
  for (const from of model.nodes) {
    const nearby = model.nodes
      .filter((to) => to.id !== from.id)
      .map((to) => ({ to, distance: nodeDistance(from, to) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
    for (const { to, distance } of nearby) {
      const key = edgeKey(from.id, to.id);
      const maxDistance = from.clusterId === to.clusterId ? 290 : 175;
      if (distance > maxDistance || realKeys.has(key) || ambientKeys.has(key)) continue;
      ambientKeys.add(key);
      visuals.push(addEdgeVisual(layer, from, to, true));
    }
  }
  return visuals;
}

function addEdgeVisual(layer: Group, from: NebulaNode, to: NebulaNode, ambient: boolean): EdgeVisual {
  const color = ambient
    ? new Color(from.color).lerp(new Color(to.color), 0.5)
    : new Color("#76c9dc");
  const line = new Line(
    new BufferGeometry().setFromPoints([new Vector3(from.x, from.y, from.z), new Vector3(to.x, to.y, to.z)]),
    new LineBasicMaterial({
      color,
      transparent: true,
      opacity: ambient ? 0.16 : from.clusterId === to.clusterId ? 0.62 : 0.42,
      blending: NormalBlending,
      depthWrite: false,
    }),
  );
  line.frustumCulled = false;
  layer.add(line);
  return { from, to, line, ambient };
}

function edgeKey(a: string, b: string) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function nodeDistance(a: NebulaNode, b: NebulaNode) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function updateEdgePositions(
  edges: EdgeVisual[],
  shellOffsets: Map<string, Vector3>,
  shellIdByCluster: Map<string, string>,
) {
  for (const edge of edges) {
    const fromOffset = shellOffsets.get(shellIdByCluster.get(edge.from.clusterId) ?? "");
    const toOffset = shellOffsets.get(shellIdByCluster.get(edge.to.clusterId) ?? "");
    const position = edge.line.geometry.getAttribute("position") as Float32BufferAttribute;
    position.setXYZ(
      0,
      edge.from.x + (fromOffset?.x ?? 0),
      edge.from.y + (fromOffset?.y ?? 0),
      edge.from.z + (fromOffset?.z ?? 0),
    );
    position.setXYZ(
      1,
      edge.to.x + (toOffset?.x ?? 0),
      edge.to.y + (toOffset?.y ?? 0),
      edge.to.z + (toOffset?.z ?? 0),
    );
    position.needsUpdate = true;
  }
}

function buildNodes(
  layer: Group,
  model: NebulaModel,
  hitObjects: Object3D[],
  visuals: Map<string, NodeVisual>,
) {
  for (const node of model.nodes) {
    const group = new Group();
    group.position.set(node.x, node.y, node.z);
    layer.add(group);
    const halo = makeSprite(glowTexture(node.color), node.color, 0.34, node.size * 4.6);
    const body = makeSprite(nodeDotTexture(), node.color, 0.98, node.size * 1.2);
    const core = makeSprite(coreTexture(), ION_WHITE, 0.95, node.size * 0.5);
    const hit = makeSprite(particleTexture(), ION_WHITE, 0, node.size * 3.4);
    body.userData.id = node.id;
    hit.userData.id = node.id;
    halo.userData.baseScale = node.size * 4.6;
    group.add(halo, body, core, hit);
    hitObjects.push(hit);
    visuals.set(node.id, { node, group, halo, body, core });
  }
}

function buildPulses(layer: Group, edges: EdgeVisual[]): PulseVisual[] {
  return edges.filter((edge) => !edge.ambient).slice(0, 72).map((edge, index) => {
    const sprite = makeSprite(particleTexture(), ELECTRIC_BLUE, 0.7, 7);
    layer.add(sprite);
    return {
      sprite,
      from: edge.from,
      to: edge.to,
      phase: seededUnit(index * 181 + 17),
      speed: 0.055 + seededUnit(index * 211 + 31) * 0.075,
    };
  });
}

function animatePulses(
  pulses: PulseVisual[],
  selectedId: string | null,
  time: number,
  shellOffsets: Map<string, Vector3>,
  shellIdByCluster: Map<string, string>,
) {
  for (const pulse of pulses) {
    const progress = (pulse.phase + time * pulse.speed) % 1;
    const fromOffset = shellOffsets.get(shellIdByCluster.get(pulse.from.clusterId) ?? "");
    const toOffset = shellOffsets.get(shellIdByCluster.get(pulse.to.clusterId) ?? "");
    const fromX = pulse.from.x + (fromOffset?.x ?? 0);
    const fromY = pulse.from.y + (fromOffset?.y ?? 0);
    const fromZ = pulse.from.z + (fromOffset?.z ?? 0);
    const toX = pulse.to.x + (toOffset?.x ?? 0);
    const toY = pulse.to.y + (toOffset?.y ?? 0);
    const toZ = pulse.to.z + (toOffset?.z ?? 0);
    pulse.sprite.position.set(
      fromX + (toX - fromX) * progress,
      fromY + (toY - fromY) * progress,
      fromZ + (toZ - fromZ) * progress,
    );
    const active = !!selectedId && (pulse.from.id === selectedId || pulse.to.id === selectedId);
    pulse.sprite.material.opacity = active ? 1 : 0;
    pulse.sprite.material.color.set(active ? SELECTED_GOLD : ELECTRIC_BLUE);
    pulse.sprite.scale.setScalar(active ? 10 : 5.5);
  }
}

function applySelection(
  nodes: Map<string, NodeVisual>,
  edges: EdgeVisual[],
  selectedId: string | null,
  model: NebulaModel,
) {
  const neighbors = new Set<string>();
  if (selectedId) {
    for (const edge of model.edges) {
      if (edge.from === selectedId) neighbors.add(edge.to);
      if (edge.to === selectedId) neighbors.add(edge.from);
    }
  }

  for (const [id, visual] of nodes) {
    const selected = id === selectedId;
    const neighbor = neighbors.has(id);
    const dimmed = !!selectedId && !selected && !neighbor;
    visual.body.material.color.set(selected ? SELECTED_GOLD : neighbor ? ION_WHITE : visual.node.color);
    visual.halo.material.color.set(selected ? SELECTED_GOLD : neighbor ? ELECTRIC_BLUE : visual.node.color);
    visual.body.material.opacity = dimmed ? 0.28 : selected ? 1 : 0.92;
    visual.core.material.opacity = dimmed ? 0.22 : selected ? 1 : 0.8;
    visual.halo.material.opacity = dimmed ? 0.06 : selected ? 0.94 : neighbor ? 0.48 : 0.24;
  }

  for (const edge of edges) {
    const direct = !!selectedId && (edge.from.id === selectedId || edge.to.id === selectedId);
    const nearby = neighbors.has(edge.from.id) && neighbors.has(edge.to.id);
    edge.line.material.color.set(direct ? SELECTED_GOLD : edge.ambient ? "#557fc7" : ELECTRIC_BLUE);
    edge.line.material.opacity = edge.ambient
      ? !selectedId ? 0.16 : direct ? 0.62 : nearby ? 0.24 : 0.025
      : !selectedId
        ? edge.from.clusterId === edge.to.clusterId ? 0.62 : 0.42
        : direct ? 1 : nearby ? 0.58 : 0.12;
  }
}

function buildNodeLabels(
  layer: HTMLDivElement,
  model: NebulaModel,
  visuals: Map<string, NodeVisual>,
  out: NodeLabel[],
) {
  const nodes = [...model.nodes]
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
    .slice(0, 360);
  for (const node of nodes) {
    const visual = visuals.get(node.id);
    if (!visual) continue;
    const el = document.createElement("div");
    el.className = "nebula-node-label";
    el.textContent = node.label;
    el.dataset.nodeId = node.id;
    layer.appendChild(el);
    out.push({ el, node, visual });
  }
}

function applyNodeLabelSelection(labels: NodeLabel[], selectedId: string | null, model: NebulaModel) {
  const neighbors = new Set<string>();
  if (selectedId) {
    for (const edge of model.edges) {
      if (edge.from === selectedId) neighbors.add(edge.to);
      if (edge.to === selectedId) neighbors.add(edge.from);
    }
  }
  for (const label of labels) {
    const selected = label.node.id === selectedId;
    const neighbor = neighbors.has(label.node.id);
    label.el.classList.toggle("is-selected", selected);
    label.el.classList.toggle("is-neighbor", neighbor);
    label.el.dataset.relevance = selected ? "selected" : neighbor ? "neighbor" : selectedId ? "dimmed" : "normal";
  }
}

function positionNodeLabels(
  labels: NodeLabel[],
  camera: PerspectiveCamera,
  rect: DOMRect,
  radius: number,
  fittedRadius: number,
  selectedId: string | null,
  hoveredId: string | null,
  worldPos: Vector3,
  screenPos: Vector3,
) {
  const occupied = new Set<string>();
  const zoomRatio = fittedRadius / Math.max(radius, 1);
  const budget = labels.length <= 160 ? labels.length : Math.round(clamp(72 * zoomRatio, 48, 220));
  const sorted = [...labels].sort((a, b) => {
    const aImportant = a.node.id === selectedId || a.node.id === hoveredId ? 1000 : a.el.dataset.relevance === "neighbor" ? 500 : 0;
    const bImportant = b.node.id === selectedId || b.node.id === hoveredId ? 1000 : b.el.dataset.relevance === "neighbor" ? 500 : 0;
    return bImportant + b.node.degree - (aImportant + a.node.degree);
  });
  let shown = 0;
  for (const label of sorted) {
    label.visual.group.getWorldPosition(worldPos);
    screenPos.copy(worldPos).project(camera);
    const x = (screenPos.x * 0.5 + 0.5) * rect.width;
    const y = (-screenPos.y * 0.5 + 0.5) * rect.height;
    const important = label.node.id === selectedId || label.node.id === hoveredId || label.el.dataset.relevance === "neighbor";
    const dimmed = label.el.dataset.relevance === "dimmed";
    const inside = screenPos.z < 1 && x > 12 && x < rect.width - 12 && y > 28 && y < rect.height - 20;
    const cellX = Math.floor((x + 8) / 118);
    const cellY = Math.floor((y - 9) / 24);
    const keys = [`${cellX}:${cellY}`, `${cellX + 1}:${cellY}`];
    const collision = keys.some((key) => occupied.has(key));
    const visible = inside && !dimmed && (important || (shown < budget && !collision));
    label.el.style.opacity = visible ? important ? "1" : screenPos.z > 0.82 ? "0.68" : "0.94" : "0";
    label.el.style.transform = `translate(${x + 8}px, ${y - 9}px)`;
    if (visible) {
      shown += 1;
      if (!important) keys.forEach((key) => occupied.add(key));
    }
  }
}

function buildClusterLabels(layer: HTMLDivElement, model: NebulaModel, out: ClusterLabel[]) {
  for (const cluster of model.clusters) {
    const el = document.createElement("div");
    el.className = "nebula-cluster-label";
    el.style.setProperty("--cluster-color", cluster.color);
    const dot = document.createElement("span");
    dot.className = "nebula-cluster-dot";
    const text = document.createElement("span");
    text.textContent = cluster.label;
    el.append(dot, text);
    layer.appendChild(el);
    out.push({
      el,
      cx: cluster.cx,
      cy: cluster.cy - cluster.radius * 0.66 - 26,
      cz: cluster.cz,
      shellId: cluster.shellId,
    });
  }
}

function applyNodeScreenScale(
  camera: PerspectiveCamera,
  visuals: Map<string, NodeVisual>,
  canvasHeight: number,
  selectedId: string | null,
) {
  const fovRad = (camera.fov * Math.PI) / 180;
  for (const [id, visual] of visuals) {
    const dist = Math.max(camera.position.distanceTo(visual.group.position), 60);
    const perPx = (2 * Math.tan(fovRad / 2) * dist) / canvasHeight;
    const selectedScale = id === selectedId ? 1.36 : 1;
    const body = (7 + Math.min(visual.node.degree, 12) * 1.35) * selectedScale * perPx;
    visual.body.scale.set(body, body, 1);
    visual.core.scale.set(body * 0.42, body * 0.42, 1);
    visual.halo.userData.baseScale = body * 4.1;
    visual.halo.scale.set(body * 4.1, body * 4.1, 1);
  }
}

function computeBounds(model: NebulaModel) {
  if (model.nodes.length === 0) return { cx: 0, cy: 0, w: 800, h: 600 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of model.nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: Math.max(maxX - minX, 400),
    h: Math.max(maxY - minY, 300),
  };
}

function drawMinimap(
  canvas: HTMLCanvasElement | null,
  model: NebulaModel,
  camera: PerspectiveCamera,
  target: Vector3,
  radius: number,
  aspect: number,
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(2, 8, 15, 0.82)";
  ctx.fillRect(0, 0, W, H);
  const bounds = computeBounds(model);
  const pad = 8;
  const scale = Math.min((W - pad * 2) / bounds.w, (H - pad * 2) / bounds.h);
  const toX = (x: number) => pad + (x - (bounds.cx - bounds.w / 2)) * scale;
  const toY = (y: number) => H - pad - (y - (bounds.cy - bounds.h / 2)) * scale;
  for (const node of model.nodes) {
    ctx.fillStyle = node.color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(toX(node.x), toY(node.y), 1.8, 1.8);
  }
  ctx.globalAlpha = 1;
  const fov = (camera.fov * Math.PI) / 180;
  const halfH = Math.tan(fov / 2) * radius;
  const halfW = halfH * aspect;
  ctx.strokeStyle = "rgba(104, 223, 255, 0.9)";
  ctx.strokeRect(toX(target.x - halfW), toY(target.y + halfH), halfW * 2 * scale, halfH * 2 * scale);
}

function makeSprite(texture: CanvasTexture, color: string, opacity: number, scale: number) {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: texture,
      color: new Color(color),
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

function particleTexture() {
  return cachedTexture("electric-particle", 64, (ctx) => {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.3, "rgba(234,248,255,0.96)");
    gradient.addColorStop(0.62, "rgba(104,223,255,0.44)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  });
}

function nodeDotTexture() {
  return cachedTexture("knowledge-node-dot", 64, (ctx) => {
    const glow = ctx.createRadialGradient(32, 32, 8, 32, 32, 29);
    glow.addColorStop(0, "rgba(255,255,255,0)");
    glow.addColorStop(0.62, "rgba(255,255,255,0.2)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);
    ctx.beginPath();
    ctx.arc(32, 32, 14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.stroke();
  });
}

function glowTexture(color: string) {
  return cachedTexture(`glow:${color}`, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.2, color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
}

function coreTexture() {
  return cachedTexture("electric-core", 32, (ctx) => {
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.52, "rgba(255,255,255,0.94)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
  });
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
  const ctx = canvas.getContext("2d")!;
  draw(ctx);
  const texture = new CanvasTexture(canvas);
  textureCache.set(key, texture);
  return texture;
}

function seededUnit(seed: number) {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 2246822507);
  value = Math.imul(value ^ (value >>> 13), 3266489909);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
