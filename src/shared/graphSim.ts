import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useCallback, useEffect, useMemo, useRef } from "react";

export interface SimNode extends SimulationNodeDatum {
  id: string;
}

export interface SimEdgeInput {
  id: string;
  from: string;
  to: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string;
}

export type PositionMap = Map<string, { x: number; y: number }>;

/** Size the canvas so nodes have real room to spread out instead of piling up. */
export function canvasSizeFor(nodeCount: number): { width: number; height: number } {
  const side = Math.max(760, Math.ceil(Math.sqrt(Math.max(nodeCount, 1)) * 150));
  return { width: side, height: Math.round(side * 0.68) };
}

const COLLIDE_RADIUS = 30;

/**
 * Live force-directed layout: nodes repel, edges pull like springs, a collide
 * force keeps them from ever overlapping. Pinned nodes (dragged/persisted)
 * keep fx/fy; everything else keeps drifting to equilibrium, which is what
 * gives the graph its "alive" canvas feel instead of a frozen diagram.
 */
export function useGraphSimulation(
  nodeIds: string[],
  edges: SimEdgeInput[],
  width: number,
  height: number,
  initialPositions?: PositionMap,
) {
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<Map<string, SimNode>>(new Map());
  const rafRef = useRef<number | null>(null);
  const repaintRef = useRef<(() => void) | null>(null);

  const nodeKey = nodeIds.join(",");
  const edgeKey = useMemo(
    () => edges.map((e) => `${e.from}>${e.to}`).join(","),
    [edges],
  );

  useEffect(() => {
    const prevNodes = nodesRef.current;
    const cx = width / 2;
    const cy = height / 2;

    const nodes: SimNode[] = nodeIds.map((id, i) => {
      const existing = prevNodes.get(id);
      if (existing) return existing;
      const cached = initialPositions?.get(id);
      const angle = (i / Math.max(nodeIds.length, 1)) * Math.PI * 2;
      const r = Math.min(width, height) * 0.32;
      return {
        id,
        x: cached?.x ?? cx + Math.cos(angle) * r,
        y: cached?.y ?? cy + Math.sin(angle) * r,
      };
    });
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    nodesRef.current = nodeMap;

    const links: SimLink[] = edges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({ id: e.id, source: e.from, target: e.to }));

    const sim = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(90)
          .strength(0.35),
      )
      .force(
        "charge",
        forceManyBody().strength(-Math.max(220, Math.min(520, nodes.length * 6))),
      )
      .force("collide", forceCollide<SimNode>(COLLIDE_RADIUS).strength(0.9))
      .force("center", forceCenter(cx, cy).strength(0.04))
      .alpha(initialPositions && initialPositions.size > 0 ? 0.35 : 1)
      .alphaDecay(0.028)
      .on("tick", () => {
        if (rafRef.current != null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          repaintRef.current?.();
        });
      });

    simRef.current = sim;

    return () => {
      sim.stop();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, edgeKey, width, height]);

  const getPositions = useCallback((): PositionMap => {
    const map = new Map<string, { x: number; y: number }>();
    nodesRef.current.forEach((n, id) => {
      map.set(id, { x: n.x ?? width / 2, y: n.y ?? height / 2 });
    });
    return map;
  }, [width, height]);

  function reheat(strength = 0.3) {
    simRef.current?.alphaTarget(strength).restart();
  }

  function cool() {
    simRef.current?.alphaTarget(0);
  }

  function pin(id: string, x: number, y: number) {
    const node = nodesRef.current.get(id);
    if (!node) return;
    node.fx = x;
    node.fy = y;
  }

  function release(id: string) {
    const node = nodesRef.current.get(id);
    if (!node) return;
    node.fx = null;
    node.fy = null;
  }

  function snapshot(): PositionMap {
    const map = new Map<string, { x: number; y: number }>();
    nodesRef.current.forEach((n, id) => {
      map.set(id, { x: n.x ?? 0, y: n.y ?? 0 });
    });
    return map;
  }

  function reset() {
    nodesRef.current.forEach((n) => {
      n.fx = null;
      n.fy = null;
    });
    simRef.current?.alpha(1).restart();
  }

  return { getPositions, repaintRef, reheat, cool, pin, release, snapshot, reset };
}
