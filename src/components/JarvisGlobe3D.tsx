import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, Html, Line, OrbitControls, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { AdditiveBlending, Color, Group, MeshBasicMaterial, Vector3 } from "three";
import type { DisplayEdge } from "../shared/graph";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import { distributedSpherePositions } from "../shared/globeLayout";
import { graphLevelForArtifact } from "../shared/graphLevels";
import { buildStarGrowthScene, type StarGrowthScene } from "../shared/starGrowthScene";
import { useElementSize } from "../shared/useElementSize";
import type { ArtifactView, Identity, Relation } from "../shared/types";
import { useVersionRoles } from "./graphStyle";

interface JarvisGlobe3DProps {
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  relations: Relation[];
  identities: Identity[];
  centerId: string | null;
  appearance: GraphAppearanceSettings;
  onSelect: (id: string) => void;
}

const GLOBE_RADIUS = 4.2;

export function JarvisGlobe3D({
  artifacts,
  edges,
  relations,
  identities,
  centerId,
  appearance,
  onSelect,
}: JarvisGlobe3DProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const controlsRef = useRef<any>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [interacting, setInteracting] = useState(false);
  const { headIds, historicalIds } = useVersionRoles(identities);

  const scene = useMemo(
    () => buildStarGrowthScene({ artifacts, edges, identities, centerId }),
    [artifacts, centerId, edges, identities],
  );

  const depths = useMemo(() => graphDepthsFromRelations(artifacts, relations), [artifacts, relations]);

  const shellPositions = useMemo(() => {
    const ids = artifacts.map((artifact) => artifact.id);
    return distributedSpherePositions(ids, GLOBE_RADIUS);
  }, [artifacts]);

  const nodeRecords = useMemo(() => {
    const densityScale = graphDensityScale(artifacts.length);
    const maxInfluence = Math.max(1, ...scene.influenceScoreById.values());
    const maxComplexity = Math.max(1, ...scene.complexityScoreById.values());
    const maxVersions = Math.max(1, ...scene.versionCountById.values());

    return artifacts.map((artifact) => {
      const p = shellPositions.get(artifact.id) ?? { x: 0, y: 0, z: 0 };
      const level = graphLevelForArtifact(artifact.id, depths);
      const influence = (scene.influenceScoreById.get(artifact.id) ?? 0) / maxInfluence;
      const complexity = (scene.complexityScoreById.get(artifact.id) ?? 0) / maxComplexity;
      const versions = (scene.versionCountById.get(artifact.id) ?? 1) / maxVersions;
      const isHero = artifact.id === scene.heroId;
      const isFinal = scene.finalIds.has(artifact.id);
      const isHead = headIds.has(artifact.id);
      const isHistorical = historicalIds.has(artifact.id);
      const isMajor = isHero || isFinal || isHead || influence > 0.55 || complexity > 0.48;
      const color = levelColor(level, appearance, isHead, isHistorical, isFinal);
      const size = nodeSize({
        densityScale,
        isHero,
        isMajor,
        isHistorical,
        influence,
        complexity,
      });
      return {
        artifact,
        position: [p.x, p.y, p.z] as [number, number, number],
        color,
        size,
        influence,
        complexity,
        versions,
        isHero,
        isFinal,
        isMajor,
      };
    });
  }, [appearance, artifacts, centerId, depths, headIds, historicalIds, scene, shellPositions]);

  const shellLinks = useMemo(() => buildShellLinks(nodeRecords), [nodeRecords]);
  const graphLinks = useMemo(() => buildGraphLinks(edges, nodeRecords, scene, centerId), [centerId, edges, nodeRecords, scene]);
  const focusNode = hoveredId ? nodeRecords.find((node) => node.artifact.id === hoveredId) ?? null : null;

  return (
    <div ref={ref} className="jarvis-globe-wrap">
      <div className="graph-canvas-toolbar jarvis-toolbar">
        <p className="graph-hint">ORG GLOBE · abyss bloom · drag orbit · wheel zoom</p>
        <button
          type="button"
          className="tool-btn ghost"
          onClick={() => controlsRef.current?.reset()}
        >
          Center canvas
        </button>
      </div>

      <div className="jarvis-globe-stage">
        {size.width > 0 && size.height > 0 && (
          <Canvas
            dpr={[1, 2]}
            camera={{ position: [0, 0.6, 11.5], fov: 34 }}
            gl={{ antialias: true, alpha: true }}
          >
            <color attach="background" args={[appearance.globe.background]} />
            <fog attach="fog" args={[appearance.globe.background, 9, 18]} />
            <ambientLight intensity={0.1} />
            <pointLight position={[-4, 5, 7]} intensity={8} color={appearance.globe.atmosphere} />
            <pointLight position={[5, -3, 4]} intensity={6} color="#89bbff" />
            <pointLight position={[0, -6, 2]} intensity={14} color="#7af6d4" />

            <JarvisScene
              nodes={nodeRecords}
              shellLinks={shellLinks}
              graphLinks={graphLinks}
              appearance={appearance}
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
              rotateSpeed={0.7}
              zoomSpeed={0.9}
              minDistance={7}
              maxDistance={18}
              onStart={() => setInteracting(true)}
              onEnd={() => setInteracting(false)}
            />
            <EffectComposer>
              <Bloom luminanceThreshold={0.24} luminanceSmoothing={0.42} intensity={1.1} />
              <Vignette eskil={false} offset={0.2} darkness={0.7} />
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

function JarvisScene(input: {
  nodes: NodeRecord[];
  shellLinks: LinkRecord[];
  graphLinks: LinkRecord[];
  appearance: GraphAppearanceSettings;
  hoveredId: string | null;
  focusNode: NodeRecord | null;
  interacting: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const { nodes, shellLinks, graphLinks, appearance, hoveredId, focusNode, interacting, onHover, onSelect } = input;
  const rootRef = useRef<Group>(null);
  const ringRef = useRef<Group>(null);
  const coreMatRef = useRef<MeshBasicMaterial>(null);

  useFrame((_, delta) => {
    if (!interacting && rootRef.current) {
      rootRef.current.rotation.y += delta * 0.07;
      rootRef.current.rotation.x = Math.sin(performance.now() * 0.00012) * 0.05;
      rootRef.current.position.y = Math.sin(performance.now() * 0.00045) * 0.08;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 0.1;
      ringRef.current.rotation.x -= delta * 0.03;
      ringRef.current.position.y = Math.sin(performance.now() * 0.0008) * 0.12;
    }
    if (coreMatRef.current) {
      const pulse = 0.9 + Math.sin(performance.now() * 0.0024) * 0.12;
      coreMatRef.current.color = new Color(appearance.nodeSpecial.headVersion).multiplyScalar(pulse);
    }
  });

  return (
    <group>
      <Sparkles count={180} scale={[11, 11, 11]} size={2} speed={0.16} color="#6bc9e6" />
      <Sparkles count={90} scale={[7.8, 7.8, 7.8]} size={3.2} speed={0.26} color="#8df4dd" />

      <group ref={rootRef} rotation={[0.35, 0.38, 0]}>
        <mesh>
          <sphereGeometry args={[GLOBE_RADIUS * 0.99, 64, 64]} />
          <meshBasicMaterial transparent opacity={0} depthWrite colorWrite={false} />
        </mesh>

        <mesh>
          <sphereGeometry args={[GLOBE_RADIUS * 0.985, 64, 64]} />
          <meshBasicMaterial transparent opacity={0.12} color={appearance.globe.atmosphere} />
        </mesh>

        <mesh>
          <sphereGeometry args={[GLOBE_RADIUS * 1.006, 64, 64]} />
          <meshBasicMaterial wireframe transparent opacity={0.1} color={appearance.globe.wireframe} />
        </mesh>

        <mesh rotation={[0.2, 0, Math.PI / 8]}>
          <torusGeometry args={[GLOBE_RADIUS * 1.008, 0.018, 16, 220]} />
          <meshBasicMaterial color={appearance.globe.wireframe} transparent opacity={0.18} />
        </mesh>

        <mesh rotation={[-0.5, Math.PI / 5, 0.15]}>
          <torusGeometry args={[GLOBE_RADIUS * 0.86, 0.014, 12, 170]} />
          <meshBasicMaterial color={appearance.globe.atmosphere} transparent opacity={0.11} />
        </mesh>

        {shellLinks.map((link) => (
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

        {graphLinks.map((link) => (
          <Line
            key={link.id}
            points={link.points}
            color={link.color}
            transparent
            opacity={hoveredId && !link.touchesHover ? link.opacity * 0.35 : link.opacity}
            lineWidth={link.width}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        ))}

        {nodes.map((node) => (
          <group key={node.artifact.id} position={node.position}>
            {node.isMajor && (
              <mesh>
                <sphereGeometry args={[node.size * 2.15, 20, 20]} />
                <meshBasicMaterial
                  color={node.isHero ? appearance.nodeSpecial.headVersion : node.color}
                  transparent
                  opacity={node.isHero ? 0.11 : 0.04}
                />
              </mesh>
            )}
            <mesh>
              <sphereGeometry args={[node.size * 1.35, 18, 18]} />
              <meshBasicMaterial
                color={node.isHero ? appearance.nodeSpecial.headVersion : node.color}
                transparent
                opacity={node.isHero ? 0.12 : 0.06}
              />
            </mesh>
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
            >
              <sphereGeometry args={[node.size, 20, 20]} />
              <meshBasicMaterial color={node.color} />
            </mesh>
            {(node.isHero || node.isFinal) && (
              <mesh>
                <sphereGeometry args={[node.size * 1.32, 20, 20]} />
                <meshBasicMaterial color={appearance.nodeSpecial.headVersion} transparent opacity={0.08} />
              </mesh>
            )}
          </group>
        ))}
      </group>

      <group ref={ringRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.35, 0.03, 16, 180]} />
          <meshBasicMaterial color={appearance.nodeSpecial.headVersion} transparent opacity={0.72} />
        </mesh>
        <mesh rotation={[Math.PI / 2, Math.PI / 5, 0]}>
          <torusGeometry args={[2.05, 0.018, 16, 160]} />
          <meshBasicMaterial color={appearance.globe.atmosphere} transparent opacity={0.24} />
        </mesh>
        <mesh scale={[1, 1.25, 1]}>
          <sphereGeometry args={[0.58, 28, 28]} />
          <meshBasicMaterial ref={coreMatRef} color={appearance.nodeSpecial.headVersion} />
        </mesh>
        <mesh>
          <sphereGeometry args={[1.05, 24, 24]} />
          <meshBasicMaterial color={appearance.nodeSpecial.headVersion} transparent opacity={0.06} />
        </mesh>
        <mesh scale={[1.35, 1.8, 1.35]}>
          <sphereGeometry args={[0.88, 24, 24]} />
          <meshBasicMaterial color={appearance.globe.atmosphere} transparent opacity={0.04} />
        </mesh>
      </group>

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

type NodeRecord = {
  artifact: ArtifactView;
  position: [number, number, number];
  color: string;
  size: number;
  influence: number;
  complexity: number;
  versions: number;
  isHero: boolean;
  isFinal: boolean;
  isMajor: boolean;
};

type LinkRecord = {
  id: string;
  points: [number, number, number][];
  color: string;
  opacity: number;
  width: number;
  touchesHover?: boolean;
};

function buildShellLinks(nodes: NodeRecord[]): LinkRecord[] {
  const links: LinkRecord[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    const neighbors = nodes
      .filter((_, index) => index !== i)
      .map((b) => ({
        node: b,
        dot: dot3(a.position, b.position) / (GLOBE_RADIUS * GLOBE_RADIUS),
      }))
      .sort((left, right) => right.dot - left.dot)
      .slice(0, 4);
    for (const { node: b, dot } of neighbors) {
      const key = a.artifact.id < b.artifact.id ? `${a.artifact.id}|${b.artifact.id}` : `${b.artifact.id}|${a.artifact.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        id: `shell:${key}`,
        points: [a.position, b.position],
        color: "#e6b860",
        opacity: 0.08 + Math.max(0, dot) * 0.12,
        width: 0.6,
      });
    }
  }
  return links;
}

function buildGraphLinks(
  edges: DisplayEdge[],
  nodes: NodeRecord[],
  scene: StarGrowthScene,
  centerId: string | null,
): LinkRecord[] {
  const nodeById = new Map(nodes.map((node) => [node.artifact.id, node]));
  const ranked = [...edges]
    .map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return null;
      const score =
        (scene.influenceScoreById.get(edge.from) ?? 0) +
        (scene.influenceScoreById.get(edge.to) ?? 0) +
        (from.isMajor ? 4 : 0) +
        (to.isMajor ? 4 : 0) +
        (edge.kind === "part_of" ? 3 : edge.kind === "version" ? 2 : 0) +
        (edge.from === centerId || edge.to === centerId ? 6 : 0);
      return { edge, from, to, score };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => right.score - left.score)
    .slice(0, 96);

  return ranked.map(({ edge, from, to }) => ({
    id: edge.id,
    points: buildArcPoints(from.position, to.position, edge.kind === "part_of" ? 0.82 : 0.58),
    color: edge.kind === "part_of" ? "#7ae9dc" : edge.kind === "version" ? "#86c8ff" : "#4db5c7",
    opacity: edge.kind === "part_of" ? 0.2 : edge.kind === "version" ? 0.14 : 0.09,
    width: edge.kind === "part_of" ? 1.15 : edge.kind === "version" ? 0.92 : 0.56,
    touchesHover: false,
  }));
}

function buildArcPoints(
  from: [number, number, number],
  to: [number, number, number],
  lift = 0.7,
): [number, number, number][] {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const normal = mid.clone().normalize().multiplyScalar(GLOBE_RADIUS * lift);
  const control = mid.clone().add(normal);
  const points: [number, number, number][] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const p0 = a.clone().multiplyScalar((1 - t) * (1 - t));
    const p1 = control.clone().multiplyScalar(2 * (1 - t) * t);
    const p2 = b.clone().multiplyScalar(t * t);
    const p = p0.add(p1).add(p2);
    points.push([p.x, p.y, p.z]);
  }
  return points;
}

function graphDepthsFromRelations(artifacts: ArtifactView[], relations: Relation[]): Map<string, number> {
  const depths = new Map<string, number>();
  for (const artifact of artifacts) depths.set(artifact.id, -1);
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const relation of relations) {
    if (relation.kind !== "part_of") continue;
    childrenOf.set(relation.to, [...(childrenOf.get(relation.to) ?? []), relation.from]);
    hasParent.add(relation.from);
  }
  const roots = artifacts
    .map((artifact) => artifact.id)
    .filter((id) => childrenOf.has(id) && !hasParent.has(id));
  const walk = (id: string, depth: number) => {
    depths.set(id, Math.min(depths.get(id) ?? depth, depth));
    for (const child of childrenOf.get(id) ?? []) walk(child, depth + 1);
  };
  roots.forEach((root) => walk(root, 0));
  return depths;
}

function levelColor(
  level: number,
  appearance: GraphAppearanceSettings,
  isHead: boolean,
  isHistorical: boolean,
  isFinal: boolean,
) {
  if (isFinal) return appearance.nodeSpecial.headVersion;
  if (isHistorical) return appearance.nodeSpecial.historicalVersion;
  if (isHead) return appearance.nodeSpecial.headVersion;
  return appearance.nodeLevels[String(Math.max(0, Math.min(level, 4)))] ?? appearance.nodeSpecial.loose;
}

function graphDensityScale(nodeCount: number) {
  if (nodeCount <= 40) return 1;
  if (nodeCount <= 80) return 0.88;
  if (nodeCount <= 140) return 0.76;
  return 0.64;
}

function nodeSize(input: {
  densityScale: number;
  isHero: boolean;
  isMajor: boolean;
  isHistorical: boolean;
  influence: number;
  complexity: number;
}) {
  const { densityScale, isHero, isMajor, isHistorical, influence, complexity } = input;
  const base = isHistorical ? 0.032 : 0.044 + complexity * 0.022 + influence * 0.01;
  const emphasized = isHero ? 0.13 : isMajor ? base + 0.025 : base;
  return emphasized * densityScale;
}

function addFocusLabelOffset(position: [number, number, number]): [number, number, number] {
  const offset = new Vector3(...position).normalize().multiplyScalar(0.52).add(new Vector3(...position));
  return [offset.x, offset.y + 0.15, offset.z];
}

function dot3(a: [number, number, number], b: [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
