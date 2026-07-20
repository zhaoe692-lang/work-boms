import { useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import { Group, Mesh, MeshBasicMaterial, SphereGeometry, Sprite, SpriteMaterial } from "three";
import type { DisplayEdge } from "../shared/graph";
import { edgeKindKey, type GraphAppearanceSettings } from "../shared/graphAppearance";
import { distributedSpherePositions } from "../shared/globeLayout";
import { graphLevelForArtifact } from "../shared/graphLevels";
import { buildStarGrowthScene } from "../shared/starGrowthScene";
import { useElementSize } from "../shared/useElementSize";
import type { ArtifactView, Identity, Relation } from "../shared/types";
import { useVersionRoles } from "./graphStyle";

interface ForceGlobeGraph3DProps {
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  relations: Relation[];
  identities: Identity[];
  centerId: string | null;
  appearance: GraphAppearanceSettings;
  onSelect: (id: string) => void;
}

type GraphNode = {
  id: string;
  artifact: ArtifactView;
  level: number;
  color: string;
  accent: string | null;
  size: number;
  isHero: boolean;
  isFinal: boolean;
  isHistorical: boolean;
  influence: number;
  complexity: number;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
};

type GraphLink = {
  source: string;
  target: string;
  id: string;
  kind: string;
  color: string;
  width: number;
  opacity: number;
};

export function ForceGlobeGraph3D({
  artifacts,
  edges,
  relations,
  identities,
  centerId,
  appearance,
  onSelect,
}: ForceGlobeGraph3DProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const graphRef = useRef<any>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { headIds, historicalIds } = useVersionRoles(identities);

  const depths = useMemo(() => graphDepthsFromRelations(artifacts, relations), [artifacts, relations]);
  const scene = useMemo(
    () => buildStarGrowthScene({ artifacts, edges, identities, centerId }),
    [artifacts, centerId, edges, identities],
  );

  const graph = useMemo(() => {
    const densityScale = graphDensityScale(artifacts.length);
    const positions = distributedSpherePositions(
      artifacts.map((artifact) => artifact.id),
      260,
    );
    const maxInfluence = Math.max(1, ...scene.influenceScoreById.values());
    const maxComplexity = Math.max(1, ...scene.complexityScoreById.values());

    const nodes: GraphNode[] = artifacts.map((artifact) => {
      const p = positions.get(artifact.id) ?? { x: 0, y: 0, z: 0 };
      const level = graphLevelForArtifact(artifact.id, depths);
      const influence = (scene.influenceScoreById.get(artifact.id) ?? 0) / maxInfluence;
      const complexity = (scene.complexityScoreById.get(artifact.id) ?? 0) / maxComplexity;
      const isHero = artifact.id === scene.heroId;
      const isFinal = scene.finalIds.has(artifact.id);
      const isHead = headIds.has(artifact.id);
      const isHistorical = historicalIds.has(artifact.id);
      return {
        id: artifact.id,
        artifact,
        level,
        color: baseLevelColor(level, appearance),
        accent: specialAccentColor(appearance, isHead, isHistorical, isFinal),
        size: nodeSize({
          densityScale,
          isHero,
          isMajor: isHero || isFinal || isHead || influence > 0.55 || complexity > 0.48,
          isHistorical,
          influence,
          complexity,
        }),
        isHero,
        isFinal,
        isHistorical,
        influence,
        complexity,
        x: p.x,
        y: p.y,
        z: p.z,
        fx: p.x,
        fy: p.y,
        fz: p.z,
      };
    });

    const links: GraphLink[] = edges.map((edge) => {
      const kindKey = edgeKindKey(edge.kind);
      return {
        source: edge.from,
        target: edge.to,
        id: edge.id,
        kind: edge.kind,
        color: appearance.edges[kindKey],
        width: edge.kind === "part_of" ? 1.8 : edge.kind === "version" ? 1.2 : 0.7,
        opacity: edge.kind === "part_of" ? 0.62 : edge.kind === "version" ? 0.4 : 0.16,
      };
    });

    const adjacency = new Map<string, Set<string>>();
    for (const node of nodes) adjacency.set(node.id, new Set());
    for (const link of links) {
      adjacency.get(link.source)?.add(link.target);
      adjacency.get(link.target)?.add(link.source);
    }

    return { nodes, links, adjacency };
  }, [appearance, artifacts, depths, edges, headIds, historicalIds, scene]);

  const selectedNeighbors = hoveredId ? graph.adjacency.get(hoveredId) ?? new Set<string>() : null;
  const visibleWidth = Math.max(size.width, 860);
  const visibleHeight = Math.max(size.height, 620);

  return (
    <div ref={ref} className="jarvis-globe-wrap">
      <div className="graph-canvas-toolbar jarvis-toolbar">
        <p className="graph-hint">ORG GLOBE · real relations only · drag orbit · wheel zoom</p>
        <button type="button" className="tool-btn ghost" onClick={() => graphRef.current?.cameraPosition({ x: 0, y: 0, z: 760 }, undefined, 700)}>
          Center canvas
        </button>
      </div>

      <div className="jarvis-globe-stage">
        <ForceGraph3D
          ref={graphRef}
          width={visibleWidth}
          height={visibleHeight}
          backgroundColor={appearance.globe.background}
          graphData={{ nodes: graph.nodes, links: graph.links }}
          showNavInfo={false}
          enableNavigationControls
          controlType="orbit"
          cooldownTicks={0}
          warmupTicks={0}
          nodeLabel={(node) => (node as GraphNode).artifact.displayName}
          onNodeHover={(node) => setHoveredId((node as GraphNode | null)?.id ?? null)}
          onNodeClick={(node) => onSelect((node as GraphNode).id)}
          nodeThreeObject={(nodeObj) => buildNodeObject(nodeObj as GraphNode, hoveredId, selectedNeighbors)}
          nodeThreeObjectExtend={false}
          linkColor={(linkObj: GraphLink) => {
            const link = linkObj as GraphLink;
            const sourceId = linkEndpointId(link.source);
            const targetId = linkEndpointId(link.target);
            if (!hoveredId) return colorWithAlpha(link.color, link.opacity);
            return sourceId === hoveredId || targetId === hoveredId
              ? colorWithAlpha(link.color, Math.min(0.92, link.opacity + 0.18))
              : colorWithAlpha("#31414a", 0.18);
          }}
          linkWidth={(linkObj: GraphLink) => {
            const link = linkObj as GraphLink;
            const sourceId = linkEndpointId(link.source);
            const targetId = linkEndpointId(link.target);
            if (!hoveredId) return link.width;
            return sourceId === hoveredId || targetId === hoveredId ? link.width * 1.4 : 0.25;
          }}
          linkCurvature={(linkObj: GraphLink) => {
            const link = linkObj as GraphLink;
            return link.kind === "part_of" ? 0.18 : link.kind === "version" ? 0.11 : 0.04;
          }}
          linkDirectionalParticles={(linkObj: GraphLink) => {
            const link = linkObj as GraphLink;
            const sourceId = linkEndpointId(link.source);
            const targetId = linkEndpointId(link.target);
            return hoveredId && (sourceId === hoveredId || targetId === hoveredId) ? 3 : 0;
          }}
          linkDirectionalParticleWidth={2.2}
          linkDirectionalParticleSpeed={0.004}
        />
        {hoveredId && (
          <div className="jarvis-hover-chip">
            <strong>{graph.nodes.find((node) => node.id === hoveredId)?.artifact.displayName}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function buildNodeObject(node: GraphNode, hoveredId: string | null, selectedNeighbors: Set<string> | null) {
  const group = new Group();
  const geometry = new SphereGeometry(node.size * 120, 18, 18);
  const material = new MeshBasicMaterial({
    color: node.color,
    transparent: true,
    opacity: hoveredId && hoveredId !== node.id && !selectedNeighbors?.has(node.id) ? 0.32 : 0.96,
  });
  const sphere = new Mesh(geometry, material);
  group.add(sphere);

  if (node.accent) {
    const aura = new Sprite(
      new SpriteMaterial({
        color: node.accent,
        transparent: true,
        opacity: hoveredId && hoveredId !== node.id && !selectedNeighbors?.has(node.id) ? 0.05 : 0.12,
      }),
    );
    aura.scale.set(node.size * 420, node.size * 420, 1);
    group.add(aura);
  }

  return group;
}

function linkEndpointId(endpoint: string | GraphNode) {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

function colorWithAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const normalized = clean.length === 3
    ? clean.split("").map((char) => `${char}${char}`).join("")
    : clean;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function baseLevelColor(level: number, appearance: GraphAppearanceSettings) {
  return appearance.nodeLevels[String(Math.max(0, Math.min(level, 4)))] ?? appearance.nodeSpecial.loose;
}

function specialAccentColor(
  appearance: GraphAppearanceSettings,
  isHead: boolean,
  isHistorical: boolean,
  isFinal: boolean,
) {
  if (isHistorical) return appearance.nodeSpecial.historicalVersion;
  if (isHead || isFinal) return appearance.nodeSpecial.headVersion;
  return null;
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
  const base = isHistorical ? 0.02 : 0.024 + complexity * 0.012 + influence * 0.006;
  const emphasized = isHero ? 0.055 : isMajor ? base + 0.012 : base;
  return emphasized * densityScale;
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
