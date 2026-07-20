import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, Html, Line, OrbitControls, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { AdditiveBlending, Color, Group, MeshBasicMaterial, Vector3 } from "three";
import type { DisplayEdge } from "../shared/graph";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import { buildStarGrowthScene, type StarGrowthScene } from "../shared/starGrowthScene";
import { useElementSize } from "../shared/useElementSize";
import type { ArtifactView, Identity } from "../shared/types";
import { useVersionRoles } from "./graphStyle";

interface AbyssBloomGraph3DProps {
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  identities: Identity[];
  centerId: string | null;
  appearance: GraphAppearanceSettings;
  onSelect: (id: string) => void;
}

const ABYSS_BG = "#030d15";
const CORE_GLOW = "#96fff0";
const CORE_BODY = "#bffff8";
const COLONY_OUTER = "#1f5d66";
const COLONY_INNER = "#2c7f83";
const TENTACLE_MAIN = "#7af2df";
const TENTACLE_SECONDARY = "#66bbdc";

export function AbyssBloomGraph3D({
  artifacts,
  edges,
  identities,
  centerId,
  appearance,
  onSelect,
}: AbyssBloomGraph3DProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const controlsRef = useRef<any>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [interacting, setInteracting] = useState(false);
  const { headIds, historicalIds } = useVersionRoles(identities);

  const scene = useMemo(
    () => buildStarGrowthScene({ artifacts, edges, identities, centerId }),
    [artifacts, centerId, edges, identities],
  );

  const organism = useMemo(
    () => buildAbyssOrganismLayout({ artifacts, scene, headIds, historicalIds, appearance }),
    [appearance, artifacts, headIds, historicalIds, scene],
  );

  const focusNode = hoveredId ? organism.nodeById.get(hoveredId) ?? null : null;

  return (
    <div ref={ref} className="jarvis-globe-wrap">
      <div className="graph-canvas-toolbar jarvis-toolbar">
        <p className="graph-hint">ABYSS BLOOM · living deep-sea colony · drag pan · shift-drag observe · wheel zoom</p>
        <button type="button" className="tool-btn ghost" onClick={() => controlsRef.current?.reset()}>
          Center canvas
        </button>
      </div>

      <div className="jarvis-globe-stage">
        {size.width > 0 && size.height > 0 && (
          <Canvas dpr={[1, 2]} camera={{ position: [0.15, -0.15, 12], fov: 34 }} gl={{ antialias: true, alpha: true }}>
            <color attach="background" args={[ABYSS_BG]} />
            <fog attach="fog" args={[ABYSS_BG, 10, 24]} />
            <ambientLight intensity={0.08} />
            <pointLight position={[-5, 5, 5]} intensity={7} color="#63d8dd" />
            <pointLight position={[5, -4, 6]} intensity={5} color="#669ee9" />
            <pointLight position={[0, -6, 1]} intensity={12} color="#87ffe8" />

            <AbyssBloomScene
              organism={organism}
              hoveredId={hoveredId}
              focusNode={focusNode}
              interacting={interacting}
              onHover={setHoveredId}
              onSelect={onSelect}
            />

            <OrbitControls
              ref={controlsRef}
              enablePan
              enableDamping
              dampingFactor={0.08}
              rotateSpeed={0.45}
              zoomSpeed={0.9}
              minDistance={6.6}
              maxDistance={18}
              onStart={() => setInteracting(true)}
              onEnd={() => setInteracting(false)}
            />

            <EffectComposer>
              <Bloom luminanceThreshold={0.24} luminanceSmoothing={0.46} intensity={1.05} />
              <Vignette eskil={false} offset={0.18} darkness={0.76} />
            </EffectComposer>
          </Canvas>
        )}

        {focusNode && (
          <div className="jarvis-hover-chip">
            <strong>{focusNode.artifact.displayName}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function AbyssBloomScene(input: {
  organism: OrganismLayout;
  hoveredId: string | null;
  focusNode: NodeRecord | null;
  interacting: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const { organism, hoveredId, focusNode, interacting, onHover, onSelect } = input;
  const rootRef = useRef<Group>(null);
  const coreRef = useRef<Group>(null);
  const coreMatRef = useRef<MeshBasicMaterial>(null);

  useFrame(() => {
    const t = performance.now();
    if (rootRef.current) {
      rootRef.current.position.y = Math.sin(t * 0.00022) * 0.14;
      rootRef.current.rotation.z = Math.sin(t * 0.00011) * 0.035;
      if (!interacting) {
        rootRef.current.rotation.y = Math.sin(t * 0.00015) * 0.08;
        rootRef.current.rotation.x = Math.sin(t * 0.00009) * 0.04;
      }
    }
    if (coreRef.current) {
      const breath = 1 + Math.sin(t * 0.0017) * 0.09;
      coreRef.current.scale.setScalar(breath);
    }
    if (coreMatRef.current) {
      const pulse = 0.9 + Math.sin(t * 0.0023) * 0.13;
      coreMatRef.current.color = new Color(CORE_BODY).multiplyScalar(pulse);
    }
  });

  return (
    <group ref={rootRef}>
      <Sparkles count={120} scale={[14, 10, 8]} size={1.8} speed={0.12} color="#67c6db" />
      <Sparkles count={70} scale={[10, 8, 8]} size={2.8} speed={0.16} color="#8af5e1" />

      {organism.colonies.map((colony) => (
        <group key={colony.id} position={colony.anchor} rotation={[0, colony.rotation, colony.tilt]}>
          <mesh scale={colony.outerScale}>
            <sphereGeometry args={[1, 28, 28]} />
            <meshBasicMaterial color={COLONY_OUTER} transparent opacity={0.18} />
          </mesh>
          <mesh scale={colony.innerScale}>
            <sphereGeometry args={[1, 22, 22]} />
            <meshBasicMaterial color={COLONY_INNER} transparent opacity={0.11} />
          </mesh>
          <mesh scale={colony.nucleusScale} position={colony.nucleusOffset}>
            <sphereGeometry args={[1, 18, 18]} />
            <meshBasicMaterial color={colony.nucleusColor} transparent opacity={0.16} />
          </mesh>
          {colony.eggs.map((egg) => (
            <mesh key={egg.id} position={egg.position} scale={egg.scale}>
              <sphereGeometry args={[1, 14, 14]} />
              <meshBasicMaterial color={egg.color} transparent opacity={egg.opacity} />
            </mesh>
          ))}
        </group>
      ))}

      {organism.primaryTentacles.map((link) => (
        <Line
          key={link.id}
          points={link.points}
          color={link.color}
          transparent
          opacity={link.opacity}
          lineWidth={link.width}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      ))}

      {organism.secondaryFibers.map((link) => (
        <Line
          key={link.id}
          points={link.points}
          color={link.color}
          transparent
          opacity={hoveredId && !link.touchesHover ? link.opacity * 0.3 : link.opacity}
          lineWidth={link.width}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      ))}

      <group ref={coreRef} position={organism.corePosition}>
        <mesh scale={[1.6, 2.4, 1.3]}>
          <sphereGeometry args={[0.92, 30, 30]} />
          <meshBasicMaterial ref={coreMatRef} color={CORE_BODY} />
        </mesh>
        <mesh scale={[2.45, 3.5, 2]}>
          <sphereGeometry args={[1.02, 26, 26]} />
          <meshBasicMaterial color={CORE_GLOW} transparent opacity={0.09} />
        </mesh>
        <mesh scale={[0.82, 2.8, 0.82]} position={[0.12, 1.42, 0]}>
          <sphereGeometry args={[0.82, 18, 18]} />
          <meshBasicMaterial color="#89ffe2" transparent opacity={0.05} />
        </mesh>
        <mesh scale={[0.62, 1.5, 0.62]} position={[-0.55, -0.05, 0.24]}>
          <sphereGeometry args={[0.8, 18, 18]} />
          <meshBasicMaterial color="#7cf2db" transparent opacity={0.1} />
        </mesh>
        <mesh scale={[0.58, 1.35, 0.58]} position={[0.66, -0.08, -0.22]}>
          <sphereGeometry args={[0.8, 18, 18]} />
          <meshBasicMaterial color="#7ce9ff" transparent opacity={0.08} />
        </mesh>
      </group>

      {organism.nodes.map((node) => (
        <group key={node.artifact.id} position={node.position}>
          <mesh scale={node.auraScale}>
            <sphereGeometry args={[node.size * 1.65, 18, 18]} />
            <meshBasicMaterial color={node.auraColor} transparent opacity={node.auraOpacity} />
          </mesh>
          {node.isMajor && (
            <mesh scale={[1.1, 1.5, 1.1]}>
              <sphereGeometry args={[node.size * 1.08, 16, 16]} />
              <meshBasicMaterial color={node.secondaryColor} transparent opacity={0.1} />
            </mesh>
          )}
          {node.pods.map((pod) => (
            <mesh key={pod.id} position={pod.offset} scale={pod.scale}>
              <sphereGeometry args={[node.size * 0.45, 12, 12]} />
              <meshBasicMaterial color={pod.color} transparent opacity={pod.opacity} />
            </mesh>
          ))}
          <mesh
            onPointerOver={(event) => {
              event.stopPropagation();
              onHover(node.artifact.id);
            }}
            onPointerOut={(event) => {
              event.stopPropagation();
              onHover(null);
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(node.artifact.id);
            }}
            scale={[1, 1.22, 1]}
          >
            <sphereGeometry args={[node.size, 20, 20]} />
            <meshBasicMaterial color={node.color} />
          </mesh>
        </group>
      ))}

      {focusNode && (
        <Billboard position={addFocusLabelOffset(focusNode.position)}>
          <Html center distanceFactor={10} transform={false}>
            <div className="jarvis-node-label">{focusNode.artifact.displayName}</div>
          </Html>
        </Billboard>
      )}
    </group>
  );
}

type PodRecord = {
  id: string;
  offset: [number, number, number];
  scale: [number, number, number];
  color: string;
  opacity: number;
};

type NodeRecord = {
  artifact: ArtifactView;
  position: [number, number, number];
  size: number;
  color: string;
  secondaryColor: string;
  auraColor: string;
  auraOpacity: number;
  auraScale: [number, number, number];
  influence: number;
  complexity: number;
  versions: number;
  clusterKey: number;
  stage: number;
  isHero: boolean;
  isFinal: boolean;
  isMajor: boolean;
  isTrunk: boolean;
  colonyIndex: number;
  pods: PodRecord[];
};

type LinkRecord = {
  id: string;
  points: [number, number, number][];
  color: string;
  opacity: number;
  width: number;
  touchesHover?: boolean;
};

type EggRecord = {
  id: string;
  position: [number, number, number];
  scale: [number, number, number];
  color: string;
  opacity: number;
};

type ColonyRecord = {
  id: string;
  anchor: [number, number, number];
  outerScale: [number, number, number];
  innerScale: [number, number, number];
  nucleusScale: [number, number, number];
  nucleusOffset: [number, number, number];
  nucleusColor: string;
  rotation: number;
  tilt: number;
  eggs: EggRecord[];
};

type OrganismLayout = {
  nodes: NodeRecord[];
  nodeById: Map<string, NodeRecord>;
  colonies: ColonyRecord[];
  corePosition: [number, number, number];
  primaryTentacles: LinkRecord[];
  secondaryFibers: LinkRecord[];
};

function buildAbyssOrganismLayout(input: {
  artifacts: ArtifactView[];
  scene: StarGrowthScene;
  headIds: Set<string>;
  historicalIds: Set<string>;
  appearance: GraphAppearanceSettings;
}): OrganismLayout {
  const { artifacts, scene, headIds, historicalIds } = input;
  const maxStage = Math.max(1, ...scene.stageById.values());
  const maxInfluence = Math.max(1, ...scene.influenceScoreById.values());
  const maxComplexity = Math.max(1, ...scene.complexityScoreById.values());
  const maxVersions = Math.max(1, ...scene.versionCountById.values());
  const corePosition: [number, number, number] = [0, -2.25, 0];
  const trunkSet = new Set(scene.trunkIds);

  const clusters = rankColonies(artifacts, scene);
  const colonies = buildColonies(clusters);
  const colonyByKey = new Map(colonies.map((colony) => [colony.clusterKey, colony]));
  const trunkRoutes = buildTrunkRoutes(scene.trunkIds, corePosition, colonies);

  const nodes: NodeRecord[] = artifacts.map((artifact) => {
    const stage = scene.stageById.get(artifact.id) ?? maxStage;
    const influence = (scene.influenceScoreById.get(artifact.id) ?? 0) / maxInfluence;
    const complexity = (scene.complexityScoreById.get(artifact.id) ?? 0) / maxComplexity;
    const versions = (scene.versionCountById.get(artifact.id) ?? 1) / maxVersions;
    const clusterKey = scene.branchGroupById.get(artifact.id) ?? -1;
    const isHero = artifact.id === scene.heroId;
    const isFinal = scene.finalIds.has(artifact.id);
    const isHead = headIds.has(artifact.id);
    const isHistorical = historicalIds.has(artifact.id);
    const isTrunk = trunkSet.has(artifact.id);
    const isMajor = isHero || isFinal || isHead || influence > 0.54 || complexity > 0.48;
    const colony = colonyByKey.get(clusterKey) ?? colonies[hashId(artifact.id) % Math.max(1, colonies.length)];
    const palette = nodePalette(stage, maxStage, isHead, isHistorical, isFinal);
    const size =
      isHero ? 0.24 : isFinal ? 0.17 : isMajor ? 0.105 + influence * 0.06 : isHistorical ? 0.04 : 0.056 + complexity * 0.028;

    let position: [number, number, number];
    if (isHero) {
      position = corePosition;
    } else if (isTrunk) {
      position = placeOnTrunk(trunkRoutes, artifact.id, stage, maxStage, hashId(artifact.id));
    } else {
      position = placeInsideColony(colony, artifact.id, stage, maxStage, complexity, versions, influence);
    }

    const pods = buildNodePods(artifact.id, versions, isMajor, palette.inner);

    return {
      artifact,
      position,
      size,
      color: palette.body,
      secondaryColor: palette.inner,
      auraColor: palette.aura,
      auraOpacity: isHero ? 0.17 : isMajor ? 0.09 : 0.04,
      auraScale: isHero ? [3.1, 4.2, 3.1] : isMajor ? [2.2, 2.9, 2.2] : [1.45, 1.9, 1.45],
      influence,
      complexity,
      versions,
      clusterKey,
      stage,
      isHero,
      isFinal,
      isMajor,
      isTrunk,
      colonyIndex: colony.index,
      pods,
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.artifact.id, node]));
  const primaryTentacles = buildPrimaryTentacles(colonies, corePosition, trunkRoutes);
  const secondaryFibers = buildSecondaryFibers(scene, nodeById, colonies, corePosition);

  return {
    nodes,
    nodeById,
    colonies,
    corePosition,
    primaryTentacles,
    secondaryFibers,
  };
}

type RankedCluster = {
  clusterKey: number;
  members: ArtifactView[];
  score: number;
};

type IndexedColonyRecord = ColonyRecord & { clusterKey: number; index: number };

function rankColonies(artifacts: ArtifactView[], scene: StarGrowthScene): RankedCluster[] {
  const grouped = new Map<number, ArtifactView[]>();
  for (const artifact of artifacts) {
    const key = scene.branchGroupById.get(artifact.id) ?? -1;
    if (key < 0) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), artifact]);
  }

  return [...grouped.entries()]
    .map(([clusterKey, members]) => {
      const score =
        members.length * 1.6 +
        average(members.map((member) => scene.complexityScoreById.get(member.id) ?? 0)) * 1.2 +
        average(members.map((member) => scene.influenceScoreById.get(member.id) ?? 0));
      return { clusterKey, members, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function buildColonies(clusters: RankedCluster[]): IndexedColonyRecord[] {
  const presets = [
    { x: -3.35, y: 0.45, z: 0.85, sx: 1.45, sy: 2.05, sz: 1.2, rot: -0.5, tilt: -0.18 },
    { x: 2.95, y: 1.1, z: -0.55, sx: 1.25, sy: 1.8, sz: 1.05, rot: 0.38, tilt: 0.12 },
    { x: 3.55, y: -0.85, z: 0.8, sx: 1.5, sy: 2.2, sz: 1.15, rot: 0.68, tilt: -0.08 },
    { x: -2.4, y: 2.1, z: -0.85, sx: 1.1, sy: 1.55, sz: 0.94, rot: -0.28, tilt: 0.16 },
    { x: 0.8, y: 2.75, z: 0.45, sx: 0.92, sy: 1.25, sz: 0.82, rot: 0.12, tilt: -0.12 },
  ];

  return clusters.map((cluster, index) => {
    const p = presets[index] ?? presets[presets.length - 1];
    const mass = Math.min(1.4, 0.84 + cluster.members.length * 0.028);
    const seed = hashId(`colony:${cluster.clusterKey}`);
    return {
      clusterKey: cluster.clusterKey,
      index,
      id: `colony:${cluster.clusterKey}`,
      anchor: [p.x, p.y, p.z],
      outerScale: [p.sx * mass, p.sy * mass, p.sz * mass],
      innerScale: [p.sx * 0.68 * mass, p.sy * 0.66 * mass, p.sz * 0.7 * mass],
      nucleusScale: [0.3 + mass * 0.22, 0.42 + mass * 0.18, 0.3 + mass * 0.18],
      nucleusOffset: [Math.sin(seed) * 0.18, -0.2 + Math.cos(seed) * 0.22, Math.sin(seed * 0.3) * 0.18],
      nucleusColor: index % 2 === 0 ? "#8bf8e3" : "#8ec9ff",
      rotation: p.rot,
      tilt: p.tilt,
      eggs: buildColonyEggs(cluster.clusterKey, cluster.members.length),
    };
  });
}

function buildColonyEggs(clusterKey: number, memberCount: number): EggRecord[] {
  const count = Math.max(2, Math.min(5, Math.round(memberCount / 8)));
  return Array.from({ length: count }, (_, index) => {
    const seed = hashId(`egg:${clusterKey}:${index}`);
    return {
      id: `egg:${clusterKey}:${index}`,
      position: [
        Math.cos(seed * 0.01) * (0.85 + index * 0.12),
        -0.4 + index * 0.22 + Math.sin(seed * 0.04) * 0.12,
        Math.sin(seed * 0.01) * (0.52 + index * 0.08),
      ],
      scale: [0.14 + index * 0.03, 0.19 + index * 0.03, 0.14 + index * 0.03],
      color: index % 2 === 0 ? "#7deedb" : "#79c4ff",
      opacity: 0.11,
    };
  });
}

type TrunkRoute = {
  id: string;
  stage: number;
  point: [number, number, number];
};

function buildTrunkRoutes(trunkIds: string[], corePosition: [number, number, number], colonies: IndexedColonyRecord[]) {
  const routes = new Map<string, TrunkRoute>();
  const usableColonies = colonies.length ? colonies : [];
  trunkIds.forEach((id, index) => {
    const t = trunkIds.length === 1 ? 1 : index / Math.max(1, trunkIds.length - 1);
    const colony = usableColonies[Math.min(index, Math.max(0, usableColonies.length - 1))];
    const anchor = colony ? colony.anchor : [0, 2.4, 0];
    const point: [number, number, number] = [
      corePosition[0] + (anchor[0] - corePosition[0]) * (0.28 + t * 0.62),
      corePosition[1] + (anchor[1] - corePosition[1]) * (0.22 + t * 0.7) + Math.sin(index * 0.9) * 0.22,
      corePosition[2] + (anchor[2] - corePosition[2]) * (0.28 + t * 0.62),
    ];
    routes.set(id, { id, stage: index, point });
  });
  return routes;
}

function placeOnTrunk(
  trunkRoutes: Map<string, TrunkRoute>,
  artifactId: string,
  stage: number,
  maxStage: number,
  seed: number,
): [number, number, number] {
  const route = trunkRoutes.get(artifactId);
  if (!route) {
    return [Math.sin(seed) * 0.3, -1.4 + (stage / Math.max(1, maxStage)) * 2.8, Math.cos(seed) * 0.2];
  }
  return [
    route.point[0] + Math.sin(seed * 0.03) * 0.18,
    route.point[1] + Math.cos(seed * 0.02) * 0.12,
    route.point[2] + Math.sin(seed * 0.04) * 0.16,
  ];
}

function placeInsideColony(
  colony: IndexedColonyRecord,
  artifactId: string,
  stage: number,
  maxStage: number,
  complexity: number,
  versions: number,
  influence: number,
): [number, number, number] {
  const seed = hashId(`node:${artifactId}`);
  const t = stage / Math.max(1, maxStage);
  const radial = 0.42 + complexity * 0.9 + versions * 0.28;
  const twist = (seed % 360) * (Math.PI / 180);
  const swirl = 0.26 + influence * 0.36;
  const x = colony.anchor[0] + Math.cos(twist) * radial * colony.outerScale[0] * 0.78;
  const y =
    colony.anchor[1] +
    Math.sin(twist * 1.7) * colony.outerScale[1] * (0.35 + t * 0.22) +
    Math.cos(seed * 0.017) * 0.2;
  const z = colony.anchor[2] + Math.sin(twist) * swirl * colony.outerScale[2] * 0.95;
  return [x, y, z];
}

function buildNodePods(id: string, versions: number, isMajor: boolean, color: string): PodRecord[] {
  const count = Math.min(4, Math.max(isMajor ? 1 : 0, Math.round(versions * 3)));
  return Array.from({ length: count }, (_, index) => {
    const seed = hashId(`pod:${id}:${index}`);
    return {
      id: `pod:${id}:${index}`,
      offset: [
        Math.cos(seed * 0.018) * (0.16 + index * 0.1),
        0.06 + index * 0.09,
        Math.sin(seed * 0.018) * (0.12 + index * 0.06),
      ],
      scale: [0.22 + index * 0.04, 0.28 + index * 0.04, 0.22 + index * 0.04],
      color,
      opacity: 0.14 - index * 0.02,
    };
  });
}

function buildPrimaryTentacles(
  colonies: IndexedColonyRecord[],
  corePosition: [number, number, number],
  trunkRoutes: Map<string, TrunkRoute>,
): LinkRecord[] {
  const links: LinkRecord[] = [];
  colonies.forEach((colony) => {
    links.push({
      id: `tentacle:core:${colony.id}`,
      points: buildTentacleCurve(corePosition, colony.anchor, colony.index, 0.88),
      color: TENTACLE_MAIN,
      opacity: 0.16,
      width: 2.2,
    });
    const children = [...trunkRoutes.values()]
      .filter((route) => route.stage % Math.max(1, colonies.length) === colony.index % Math.max(1, colonies.length))
      .slice(0, 2);
    children.forEach((child, index) => {
      links.push({
        id: `tentacle:${colony.id}:${child.id}`,
        points: buildTentacleCurve(colony.anchor, child.point, colony.index + index + 1, 0.42),
        color: index === 0 ? "#7fe1ff" : "#82e6d6",
        opacity: 0.11,
        width: 1.35,
      });
    });
  });
  return links;
}

function buildSecondaryFibers(
  scene: StarGrowthScene,
  nodeById: Map<string, NodeRecord>,
  colonies: IndexedColonyRecord[],
  corePosition: [number, number, number],
): LinkRecord[] {
  const links: LinkRecord[] = [];
  const heroId = scene.heroId;

  scene.trunkIds.slice(0, Math.max(3, colonies.length)).forEach((id, index) => {
    const node = nodeById.get(id);
    if (!node || !heroId) return;
    links.push({
      id: `nerve:hero:${id}`,
      points: buildTentacleCurve(corePosition, node.position, index + 11, 0.36),
      color: "#8ef9e5",
      opacity: 0.13,
      width: 1.05,
    });
  });

  const byColony = new Map<number, NodeRecord[]>();
  for (const node of nodeById.values()) {
    byColony.set(node.colonyIndex, [...(byColony.get(node.colonyIndex) ?? []), node]);
  }

  for (const colony of colonies) {
    const members = [...(byColony.get(colony.index) ?? [])]
      .filter((node) => !node.isHero)
      .sort((a, b) => b.influence + b.complexity - (a.influence + a.complexity))
      .slice(0, 14);

    if (!members.length) continue;

    const anchorNode = members[0];
    links.push({
      id: `anchor:${colony.id}:${anchorNode.artifact.id}`,
      points: buildTentacleCurve(colony.anchor, anchorNode.position, colony.index + 23, 0.2),
      color: "#66ccda",
      opacity: 0.09,
      width: 0.8,
    });

    for (let i = 1; i < members.length; i += 1) {
      const node = members[i];
      const target = i % 3 === 0 ? colony.anchor : anchorNode.position;
      links.push({
        id: `mesh:${colony.id}:${node.artifact.id}`,
        points: buildTentacleCurve(target, node.position, colony.index * 17 + i, 0.14),
        color: i % 2 === 0 ? TENTACLE_SECONDARY : "#56b5ba",
        opacity: node.isMajor ? 0.1 : 0.055,
        width: node.isMajor ? 0.72 : 0.42,
      });
    }
  }

  return links;
}

function buildTentacleCurve(
  from: [number, number, number],
  to: [number, number, number],
  seed: number,
  arch: number,
): [number, number, number][] {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const drift = new Vector3(
    Math.cos(seed * 0.9) * arch,
    Math.sin(seed * 0.6) * arch * 0.8,
    Math.sin(seed * 0.7) * arch * 0.65,
  );
  const c1 = a.clone().lerp(mid, 0.42).add(drift);
  const c2 = b.clone().lerp(mid, 0.44).add(drift.multiplyScalar(0.72));
  const points: [number, number, number][] = [];
  for (let i = 0; i <= 30; i += 1) {
    const t = i / 30;
    const p = cubicBezier(a, c1, c2, b, t);
    points.push([p.x, p.y, p.z]);
  }
  return points;
}

function cubicBezier(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number) {
  const mt = 1 - t;
  return a
    .clone()
    .multiplyScalar(mt * mt * mt)
    .add(b.clone().multiplyScalar(3 * mt * mt * t))
    .add(c.clone().multiplyScalar(3 * mt * t * t))
    .add(d.clone().multiplyScalar(t * t * t));
}

function nodePalette(stage: number, maxStage: number, isHead: boolean, isHistorical: boolean, isFinal: boolean) {
  if (isFinal) return { body: "#e0fffb", inner: "#a0ffee", aura: "#93ffe6" };
  if (isHistorical) return { body: "#667f8b", inner: "#7a93a0", aura: "#4e6570" };
  if (isHead) return { body: "#92f8e6", inner: "#bcfff7", aura: "#86f5e1" };
  const t = stage / Math.max(1, maxStage);
  if (t < 0.25) return { body: "#8cf8e4", inner: "#5fe7d5", aura: "#62d5c9" };
  if (t < 0.5) return { body: "#6fdde3", inner: "#80ebff", aura: "#5cb8d1" };
  if (t < 0.75) return { body: "#77b8f0", inner: "#95cfff", aura: "#638ec0" };
  return { body: "#557d8e", inner: "#6e9aac", aura: "#476876" };
}

function addFocusLabelOffset(position: [number, number, number]): [number, number, number] {
  const offset = new Vector3(...position).normalize().multiplyScalar(0.34).add(new Vector3(...position));
  return [offset.x, offset.y + 0.2, offset.z];
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hashId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
