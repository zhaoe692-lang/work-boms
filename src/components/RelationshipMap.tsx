import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DisplayEdge } from "../shared/graph";
import { useI18n, type MessageKey } from "../shared/i18n";
import type { ArtifactView } from "../shared/types";
import { useElementSize } from "../shared/useElementSize";
import { Icon } from "./icons";
import { assetVisual, type AssetVisual } from "./assetVisual";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface RelationshipMapProps {
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  centerId: string | null;
  onSelect: (id: string) => void;
}

type EdgeClass = "direct" | "indirect" | "version" | "reference" | "broken";

const EDGE_STYLE: Record<
  EdgeClass,
  { color: string; dash?: string; width: number; labelKey: MessageKey; hintKey: MessageKey }
> = {
  direct: {
    color: "#61b6ff",
    width: 2.1,
    labelKey: "graph.direct",
    hintKey: "graph.direct.hint",
  },
  indirect: {
    color: "#7d8aa5",
    dash: "5 4",
    width: 1.35,
    labelKey: "graph.indirect",
    hintKey: "graph.indirect.hint",
  },
  version: {
    color: "#e7b44a",
    dash: "7 4",
    width: 1.5,
    labelKey: "graph.version",
    hintKey: "graph.version.hint",
  },
  reference: {
    color: "#70d0c6",
    dash: "2 5",
    width: 1.35,
    labelKey: "graph.reference",
    hintKey: "graph.reference.hint",
  },
  broken: {
    color: "#ef7e68",
    dash: "4 4",
    width: 1.6,
    labelKey: "graph.broken",
    hintKey: "graph.broken.hint",
  },
};

const LEGEND_ORDER: EdgeClass[] = [
  "direct",
  "indirect",
  "version",
  "reference",
  "broken",
];

function edgeClass(edge: DisplayEdge, brokenSet: Set<string>): EdgeClass {
  if (brokenSet.has(edge.from) || brokenSet.has(edge.to)) return "broken";
  switch (edge.kind) {
    case "uses":
    case "part_of":
      return "direct";
    case "version":
      return "version";
    case "references":
      return "reference";
    default:
      return "indirect";
  }
}

interface PlacedNode {
  artifact: ArtifactView;
  x: number;
  y: number;
  ring: number;
  isCenter: boolean;
  labelSide: "left" | "right" | "bottom";
  style: AssetVisual;
}

interface PlacedEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cls: EdgeClass;
  faded: boolean;
}

function truncateLabel(name: string, max = 18): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function RelationshipMap({
  artifacts,
  edges,
  centerId,
  onSelect,
}: RelationshipMapProps) {
  const { t, locale } = useI18n();
  const { ref, size } = useElementSize<HTMLDivElement>();
  /** Default ~60% so nodes read at a usable size without manual zoom-out. */
  const [scale, setScale] = useState(0.6);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );

  const artifactById = useMemo(
    () => new Map(artifacts.map((a) => [a.id, a])),
    [artifacts],
  );
  const brokenSet = useMemo(
    () => new Set(artifacts.filter((a) => !a.reachable).map((a) => a.id)),
    [artifacts],
  );
  const degreeById = useMemo(() => {
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    }
    return degree;
  }, [edges]);

  const { nodes, placedEdges, optionsCount } = useMemo(() => {
    const fallbackCenter =
      centerId && artifactById.has(centerId)
        ? centerId
        : [...artifacts]
          .sort((a, b) => (degreeById.get(b.id) ?? 0) - (degreeById.get(a.id) ?? 0))[0]?.id;

    if (!fallbackCenter) {
      return {
        nodes: [] as PlacedNode[],
        placedEdges: [] as PlacedEdge[],
        optionsCount: 0,
      };
    }

    const primaryNeighbors: string[] = [];
    const secondaryNeighbors: string[] = [];
    const selected = new Set<string>([fallbackCenter]);

    const primaryEdges = edges.filter(
      (edge) => edge.from === fallbackCenter || edge.to === fallbackCenter,
    );
    primaryEdges
      .map((edge) => (edge.from === fallbackCenter ? edge.to : edge.from))
      .filter((id, idx, arr) => arr.indexOf(id) === idx && artifactById.has(id))
      .sort((a, b) => (degreeById.get(b) ?? 0) - (degreeById.get(a) ?? 0))
      .slice(0, 8)
      .forEach((id) => {
        selected.add(id);
        primaryNeighbors.push(id);
      });

    const secondaryPool = new Set<string>();
    for (const id of primaryNeighbors) {
      for (const edge of edges) {
        if (edge.from !== id && edge.to !== id) continue;
        const other = edge.from === id ? edge.to : edge.from;
        if (!selected.has(other) && artifactById.has(other)) {
          secondaryPool.add(other);
        }
      }
    }

    [...secondaryPool]
      .sort((a, b) => (degreeById.get(b) ?? 0) - (degreeById.get(a) ?? 0))
      .slice(0, 10)
      .forEach((id) => {
        selected.add(id);
        secondaryNeighbors.push(id);
      });

    if (selected.size < 7) {
      [...artifacts]
        .filter((artifact) => !selected.has(artifact.id))
        .sort((a, b) => (degreeById.get(b.id) ?? 0) - (degreeById.get(a.id) ?? 0))
        .slice(0, 4)
        .forEach((artifact) => {
          selected.add(artifact.id);
          secondaryNeighbors.push(artifact.id);
        });
    }

    const positions = new Map<string, { x: number; y: number; ring: number }>();
    positions.set(fallbackCenter, { x: 0, y: 0, ring: 0 });

    const ring1Radius = Math.min(360, Math.max(240, 205 + primaryNeighbors.length * 14));
    primaryNeighbors.forEach((id, index) => {
      const angle =
        (index / Math.max(primaryNeighbors.length, 1)) * Math.PI * 2 - Math.PI / 2;
      positions.set(id, {
        x: Math.cos(angle) * ring1Radius,
        y: Math.sin(angle) * ring1Radius * 0.9,
        ring: 1,
      });
    });

    const ring2Radius = ring1Radius + 168;
    secondaryNeighbors.forEach((id, index) => {
      const angle =
        (index / Math.max(secondaryNeighbors.length, 1)) * Math.PI * 2 - Math.PI / 2.4;
      positions.set(id, {
        x: Math.cos(angle) * ring2Radius,
        y: Math.sin(angle) * ring2Radius * 0.82,
        ring: 2,
      });
    });

    const placedNodes = [...selected]
      .map((id) => {
        const artifact = artifactById.get(id);
        const pos = positions.get(id);
        if (!artifact || !pos) return null;
        const labelSide: PlacedNode["labelSide"] =
          id === fallbackCenter
            ? "bottom"
            : pos.x < -24
              ? "left"
              : pos.x > 24
                ? "right"
                : "bottom";
        return {
          artifact,
          x: pos.x,
          y: pos.y,
          ring: pos.ring,
          isCenter: id === fallbackCenter,
          labelSide,
          style: assetVisual(artifact, locale),
        };
      })
      .filter((node): node is PlacedNode => node !== null);

    const placedEdges = edges
      .filter((edge) => selected.has(edge.from) && selected.has(edge.to))
      .slice(0, 32)
      .map((edge) => {
        const a = positions.get(edge.from);
        const b = positions.get(edge.to);
        if (!a || !b) return null;
        const touchesCenter = edge.from === fallbackCenter || edge.to === fallbackCenter;
        return {
          id: edge.id,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          cls: edgeClass(edge, brokenSet),
          faded: !touchesCenter,
        };
      })
      .filter((edge): edge is PlacedEdge => edge !== null);

    return {
      nodes: placedNodes,
      placedEdges,
      optionsCount: selected.size,
    };
  }, [artifactById, artifacts, brokenSet, centerId, degreeById, edges, locale]);

  const cx = size.width / 2 + pan.x;
  const cy = size.height / 2 + pan.y;
  const worldTransform = `translate(${cx}px, ${cy}px) scale(${scale})`;
  const svgGroupTransform = `translate(${cx} ${cy}) scale(${scale})`;

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.min(2.4, Math.max(0.42, s * Math.exp(-e.deltaY * 0.0012))));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".relmap-node")) return;
    dragRef.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.x + (e.clientX - drag.px), y: drag.y + (e.clientY - drag.py) });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const resetView = () => {
    setScale(0.6);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="relmap">
      <header className="relmap-bar">
        <h2 className="relmap-title">{t("graph.relmapTitle")}</h2>
        <div className="relmap-bar-actions">
          <button
            type="button"
            className="relmap-icon-btn"
            title={t("graph.resetView")}
            onClick={resetView}
          >
            ⤢
          </button>
        </div>
      </header>

      <div
        className="relmap-stage"
        ref={ref}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="relmap-stars" aria-hidden />
        <div className="relmap-halo relmap-halo-1" aria-hidden />
        <div className="relmap-halo relmap-halo-2" aria-hidden />

        {nodes.length === 0 ? (
          <div className="relmap-empty">{t("graph.relmapEmpty")}</div>
        ) : (
          <>
            <svg className="relmap-edges" width={size.width} height={size.height}>
              <g transform={svgGroupTransform}>
                {placedEdges.map((edge, i) => {
                  const style = EDGE_STYLE[edge.cls];
                  const mx = (edge.x1 + edge.x2) / 2;
                  const my = (edge.y1 + edge.y2) / 2;
                  const dx = edge.x2 - edge.x1;
                  const dy = edge.y2 - edge.y1;
                  const nx = -dy;
                  const ny = dx;
                  const len = Math.hypot(nx, ny) || 1;
                  const dist = Math.hypot(dx, dy) || 1;
                  const bow = Math.min(70, dist * (edge.faded ? 0.1 : 0.17));
                  const cpx = mx + (nx / len) * bow;
                  const cpy = my + (ny / len) * bow;
                  const d = `M ${edge.x1} ${edge.y1} Q ${cpx} ${cpy} ${edge.x2} ${edge.y2}`;
                  return (
                    <g key={edge.id}>
                      <path
                        d={d}
                        fill="none"
                        stroke={style.color}
                        strokeWidth={style.width}
                        strokeDasharray={style.dash}
                        opacity={edge.faded ? 0.3 : 0.55}
                      />
                      <path
                        className="relmap-flow"
                        d={d}
                        fill="none"
                        stroke={style.color}
                        strokeWidth={style.width + 0.6}
                        strokeLinecap="round"
                        opacity={edge.faded ? 0.5 : 0.95}
                        style={{ animationDelay: `${(i % 6) * -0.5}s` }}
                      />
                    </g>
                  );
                })}
              </g>
            </svg>

            <div className="relmap-world" style={{ transform: worldTransform }}>
              {nodes.map((node) => (
                <button
                  key={node.artifact.id}
                  type="button"
                  className={`relmap-node relmap-ring-${node.ring} side-${node.labelSide}${node.isCenter ? " center" : ""}`}
                  style={{ left: node.x, top: node.y, ["--node-accent" as string]: node.style.accent }}
                  onClick={() => onSelect(node.artifact.id)}
                >
                  <span
                    className={`relmap-glyph${node.style.avatar ? " avatar" : ""}${node.style.previewUrl ? " preview" : ""
                      }`}
                    style={
                      node.style.previewUrl
                        ? ({ ["--node-preview" as string]: `url("${node.style.previewUrl}")` } as CSSProperties)
                        : undefined
                    }
                  >
                    {node.style.previewUrl ? null : node.style.avatar ? (
                      <span className="relmap-glyph-core">{node.style.glyph}</span>
                    ) : (
                      <span className="relmap-glyph-core">
                        <Icon name={node.style.icon} size={node.isCenter ? 18 : 14} />
                      </span>
                    )}
                  </span>
                  <span className="relmap-label">
                    <span className="relmap-type">{node.style.eyebrow}</span>
                    <span className="relmap-name">{truncateLabel(node.artifact.displayName)}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <TooltipProvider delayDuration={200}>
          <div className="relmap-legend">
            {LEGEND_ORDER.map((cls) => {
              const style = EDGE_STYLE[cls];
              return (
                <Tooltip key={cls}>
                  <TooltipTrigger asChild>
                    <span className="relmap-legend-item">
                      <span
                        className="relmap-legend-line"
                        style={{
                          borderTopColor: style.color,
                          borderTopStyle: style.dash ? "dashed" : "solid",
                        }}
                      />
                      {t(style.labelKey)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-[240px] text-left leading-snug"
                  >
                    {t(style.hintKey)}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>

        <div className="relmap-zoom" aria-label={t("graph.canvasZoomAria")}>
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.42, s - 0.1))}
            aria-label={t("graph.zoomOut")}
            title={t("graph.zoomOut")}
          >
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(2.4, s + 0.1))}
            aria-label={t("graph.zoomIn")}
            title={t("graph.zoomIn")}
          >
            +
          </button>
          <button
            type="button"
            className="relmap-zoom-lock"
            onClick={resetView}
            aria-label={t("graph.reset")}
            title={t("graph.reset")}
          >
            ⌂
          </button>
        </div>

        <div className="relmap-caption">
          {t("graph.relmapExpanded", { count: optionsCount })}
        </div>
      </div>
    </div>
  );
}
