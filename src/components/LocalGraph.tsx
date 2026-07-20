import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DisplayEdge } from "../shared/graph";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import {
  clientToLogicalFlat,
  drawForceGraphFrame,
  hitTestForceNode,
  logicalViewBox,
} from "../shared/forceGraphCanvasDraw";
import {
  attachForceGraphPointerSession,
  FORCE_POINTER_IDLE,
  type ForcePointerMode,
} from "../shared/forceGraphPointerSession";
import { useGraphSimulation, type PositionMap } from "../shared/graphSim";
import { bomDepthByArtifactId, graphLevelForArtifact } from "../shared/graphLevels";
import { useI18n } from "../shared/i18n";
import { useElementSize } from "../shared/useElementSize";
import { useZoomPan } from "../shared/useZoomPan";
import { getGraphLayout, saveGraphLayout } from "../shared/api";
import type { ArtifactView, Identity, Relation } from "../shared/types";
import { artifactById, neighborIds } from "../shared/utils";
import { GraphZoomControls } from "./GraphZoomControls";
import { useVersionRoles } from "./graphStyle";

interface LocalGraphProps {
  packageId: string;
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  relations: Relation[];
  identities: Identity[];
  centerId: string | null;
  appearance: GraphAppearanceSettings;
  onSelect: (id: string) => void;
  relationKinds?: string[];
  searchQuery?: string;
}

export function LocalGraph({
  packageId,
  artifacts,
  edges: allEdges,
  relations,
  identities,
  centerId,
  appearance,
  onSelect,
  relationKinds,
  searchQuery = "",
}: LocalGraphProps) {
  const { t } = useI18n();
  const { headIds, historicalIds } = useVersionRoles(identities);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { ref: hostRef, size: canvasSize } = useElementSize<HTMLDivElement>();
  const pointerModeRef = useRef<ForcePointerMode>(FORCE_POINTER_IDLE);
  const hoveredIdRef = useRef<string | null>(null);
  const simRef = useRef<ReturnType<typeof useGraphSimulation> | null>(null);
  const appearanceRef = useRef(appearance);
  const headIdsRef = useRef(headIds);
  const historicalIdsRef = useRef(historicalIds);
  const centerIdRef = useRef(centerId);
  const artifactsRef = useRef<ArtifactView[]>([]);
  const edgesRef = useRef<DisplayEdge[]>([]);
  const depthsRef = useRef(new Map<string, number>());
  const [panning, setPanning] = useState(false);

  appearanceRef.current = appearance;
  headIdsRef.current = headIds;
  historicalIdsRef.current = historicalIds;
  centerIdRef.current = centerId;

  const depths = useMemo(
    () => bomDepthByArtifactId(artifacts, relations),
    [artifacts, relations],
  );
  depthsRef.current = depths;

  const kindSet = useMemo(
    () => (relationKinds && relationKinds.length ? new Set(relationKinds) : null),
    [relationKinds],
  );

  const filteredEdges = useMemo(
    () => (kindSet ? allEdges.filter((edge) => kindSet.has(edge.kind)) : allEdges),
    [allEdges, kindSet],
  );

  const neighbors = useMemo(
    () => (centerId ? [...neighborIds(centerId, filteredEdges)] : []),
    [centerId, filteredEdges],
  );
  const nodeIds = useMemo(
    () => (centerId ? [centerId, ...neighbors] : []),
    [centerId, neighbors],
  );
  const edges = useMemo(
    () =>
      centerId
        ? filteredEdges.filter(
            (r) =>
              (r.from === centerId && neighbors.includes(r.to)) ||
              (r.to === centerId && neighbors.includes(r.from)) ||
              (neighbors.includes(r.from) && neighbors.includes(r.to)),
          )
        : [],
    [filteredEdges, centerId, neighbors],
  );
  edgesRef.current = edges;

  const visibleArtifacts = useMemo(
    () => artifacts.filter((a) => nodeIds.includes(a.id)),
    [artifacts, nodeIds],
  );
  artifactsRef.current = visibleArtifacts;

  const simEdges = useMemo(
    () => edges.map((r) => ({ id: r.id, from: r.from, to: r.to })),
    [edges],
  );

  const fingerprint = useMemo(
    () => `${nodeIds.slice().sort().join("|")}::${simEdges.map((e) => e.id).sort().join("|")}`,
    [nodeIds, simEdges],
  );

  const [seedPositions, setSeedPositions] = useState<PositionMap | undefined>(undefined);
  const [layoutReady, setLayoutReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setLayoutReady(false);
    getGraphLayout(packageId, "local:v1", fingerprint)
      .then((doc) => {
        if (!alive) return;
        if (doc?.positions) {
          const map: PositionMap = new Map();
          for (const [id, pos] of Object.entries(doc.positions)) {
            map.set(id, { x: pos.x, y: pos.y });
          }
          setSeedPositions(map);
        } else {
          setSeedPositions(undefined);
        }
        setLayoutReady(true);
      })
      .catch(() => {
        if (!alive) return;
        setSeedPositions(undefined);
        setLayoutReady(true);
      });
    return () => {
      alive = false;
    };
  }, [packageId, fingerprint]);

  const logicalW = Math.max(640, canvasSize.width || 640);
  const logicalH = Math.max(480, canvasSize.height || 480);

  const sim = useGraphSimulation(
    layoutReady ? nodeIds : [],
    layoutReady ? simEdges : [],
    logicalW,
    logicalH,
    seedPositions,
  );
  simRef.current = sim;

  const persistLayout = useCallback(() => {
    const positions = simRef.current?.snapshot();
    if (!positions || !positions.size) return;
    const payload: Record<string, { x: number; y: number }> = {};
    positions.forEach((pos, id) => {
      payload[id] = pos;
    });
    void saveGraphLayout(packageId, {
      schemaVersion: "1",
      mode: "local:v1",
      width: logicalW,
      height: logicalH,
      fingerprint,
      positions: payload,
    });
  }, [packageId, logicalW, logicalH, fingerprint]);

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    const hit = visibleArtifacts.find((artifact) =>
      artifact.displayName.toLowerCase().includes(q),
    );
    if (hit) onSelect(hit.id);
  }, [searchQuery, visibleArtifacts, onSelect]);

  const viewBox = useMemo(() => logicalViewBox(logicalW, logicalH), [logicalW, logicalH]);
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;

  const { transform, transformRef, resetView, zoomIn, zoomOut, panByScreen } = useZoomPan(
    canvasRef,
    {
      enabled: canvasSize.width > 0 && canvasSize.height > 0,
      focal: { x: logicalW / 2, y: logicalH / 2 },
      getViewBox: () => viewBoxRef.current,
      onChange: () => sim.repaintRef.current?.(),
    },
  );

  useEffect(() => {
    if (!centerId) return;
    simRef.current?.pin(centerId, logicalW / 2, logicalH / 2);
  }, [centerId, logicalW, logicalH, nodeIds.join(",")]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const s = simRef.current;
    if (!canvas || !s || canvasSize.width <= 0 || canvasSize.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvasSize.width;
    const h = canvasSize.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mode = pointerModeRef.current;
    const draggingId = mode.kind === "node-drag" ? mode.id : null;

    drawForceGraphFrame({
      ctx,
      displayWidth: w,
      displayHeight: h,
      logicalWidth: logicalW,
      logicalHeight: logicalH,
      zoom: transformRef.current,
      background: "#fbfbfd",
      appearance: appearanceRef.current,
      positions: s.getPositions(),
      edges: edgesRef.current,
      artifacts: artifactsRef.current,
      centerId: centerIdRef.current,
      hoveredId: hoveredIdRef.current,
      draggingId,
      headIds: headIdsRef.current,
      historicalIds: historicalIdsRef.current,
      levelFor: (id) => graphLevelForArtifact(id, depthsRef.current),
      showAllLabels: true,
    });
  }, [canvasSize.width, canvasSize.height, logicalW, logicalH, transformRef]);

  useEffect(() => {
    sim.repaintRef.current = paint;
    return () => {
      sim.repaintRef.current = null;
    };
  }, [sim, paint]);

  useEffect(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return;
    let running = true;
    function loop() {
      if (!running) return;
      paint();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    return () => {
      running = false;
    };
  }, [canvasSize.width, canvasSize.height, paint]);

  useEffect(() => {
    return attachForceGraphPointerSession({
      canvasRef,
      getMode: () => pointerModeRef.current,
      setMode: (mode) => {
        pointerModeRef.current = mode;
      },
      clientToLogical: (clientX, clientY) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        return clientToLogicalFlat(
          canvas,
          clientX,
          clientY,
          logicalW,
          logicalH,
          transformRef.current,
        );
      },
      panByScreen,
      onNodeClick: onSelect,
      onNodeDragMove: (id, x, y) => {
        simRef.current?.pin(id, clamp(x, 20, logicalW - 20), clamp(y, 20, logicalH - 20));
        simRef.current?.reheat(0.35);
      },
      onNodeDragEnd: (id) => {
        simRef.current?.release(id);
        simRef.current?.cool();
        persistLayout();
      },
      onPanEnd: () => setPanning(false),
      canDragNode: (id) => id !== centerIdRef.current,
    });
  }, [onSelect, panByScreen, logicalW, logicalH, persistLayout]);

  function beginSession(pointerId: number) {
    document.body.classList.add("globe-pointer-active");
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  }

  function onCanvasPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    if (pointerModeRef.current.kind !== "none") return;
    const s = simRef.current;
    const canvas = canvasRef.current;
    if (!s || !canvas) return;

    const pt = clientToLogicalFlat(
      canvas,
      event.clientX,
      event.clientY,
      logicalW,
      logicalH,
      transformRef.current,
    );
    if (!pt) return;

    const hit = hitTestForceNode(s.getPositions(), pt.x, pt.y);
    if (hit) {
      pointerModeRef.current = {
        kind: "node-pending",
        pointerId: event.pointerId,
        id: hit,
        startX: event.clientX,
        startY: event.clientY,
      };
      beginSession(event.pointerId);
      return;
    }

    pointerModeRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    setPanning(true);
    beginSession(event.pointerId);
  }

  function onCanvasPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (pointerModeRef.current.kind !== "none") return;
    const s = simRef.current;
    const canvas = canvasRef.current;
    if (!s || !canvas) return;
    const pt = clientToLogicalFlat(
      canvas,
      event.clientX,
      event.clientY,
      logicalW,
      logicalH,
      transformRef.current,
    );
    if (!pt) return;
    const hit = hitTestForceNode(s.getPositions(), pt.x, pt.y);
    if (hit !== hoveredIdRef.current) {
      hoveredIdRef.current = hit;
    }
  }

  function onCanvasPointerLeave() {
    if (pointerModeRef.current.kind !== "none") return;
    hoveredIdRef.current = null;
  }

  if (!centerId) {
    return (
      <div className="graph-empty">
        <p>{t("graph.pickForLocal")}</p>
      </div>
    );
  }

  const center = artifactById(artifacts, centerId);
  if (!center) {
    return (
      <div className="graph-empty">
        <p>{t("graph.centerMissing")}</p>
      </div>
    );
  }

  return (
    <div className="local-graph-wrap local-graph-host">
      <div className="graph-canvas-toolbar local-toolbar">
        <p className="muted small graph-hint">
          {t("graph.localHint")}
        </p>
      </div>
      <div ref={hostRef} className="local-canvas-host">
        <GraphZoomControls
          scale={transform.k}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={resetView}
        />
        {canvasSize.width > 0 && canvasSize.height > 0 && (
          <canvas
            ref={canvasRef}
            className={`force-canvas-element ${panning ? "panning" : ""}`}
            aria-label={t("graph.localAria")}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerLeave={onCanvasPointerLeave}
          />
        )}
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
