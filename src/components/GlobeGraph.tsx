import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGraphLayout } from "../shared/api";
import { clientToLogical } from "../shared/globeCanvasCoords";
import { drawGlobeFrame, hitTestGlobeNode } from "../shared/globeCanvasDraw";
import type { DisplayEdge } from "../shared/graph";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import { globeViewBoxRect } from "../shared/globeLayout";
import { bomDepthByArtifactId, graphLevelForArtifact } from "../shared/graphLevels";
import {
  attachGlobePointerSession,
  GLOBE_POINTER_IDLE,
  type GlobePointerMode,
} from "../shared/globePointerSession";
import { useElementSize } from "../shared/useElementSize";
import { globePositionsFromRecord, useGlobeGraph } from "../shared/useGlobeGraph";
import { buildStarGrowthScene } from "../shared/starGrowthScene";
import { useZoomPan } from "../shared/useZoomPan";
import type { ArtifactView, Identity, Relation } from "../shared/types";
import { graphFingerprint } from "../shared/utils";
import { GraphZoomControls } from "./GraphZoomControls";
import { useVersionRoles } from "./graphStyle";

interface GlobeGraphProps {
  packageId: string;
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  relations: Relation[];
  identities: Identity[];
  centerId: string | null;
  layoutEpoch: number;
  appearance: GraphAppearanceSettings;
  onSelect: (id: string) => void;
}

export function GlobeGraph({
  packageId,
  artifacts,
  edges: displayEdges,
  relations,
  identities,
  centerId,
  layoutEpoch,
  appearance,
  onSelect,
}: GlobeGraphProps) {
  const { headIds, historicalIds } = useVersionRoles(identities);
  const fingerprint = useMemo(
    () => graphFingerprint(artifacts, displayEdges),
    [artifacts, displayEdges],
  );
  const nodeIds = useMemo(() => artifacts.map((a) => a.id), [artifacts]);
  const depths = useMemo(
    () => bomDepthByArtifactId(artifacts, relations),
    [artifacts, relations],
  );

  const [cachedLocal, setCachedLocal] = useState<ReturnType<typeof globePositionsFromRecord> | null>(
    null,
  );
  const scene = useMemo(
    () =>
      buildStarGrowthScene({
        artifacts,
        edges: displayEdges,
        identities,
        centerId,
      }),
    [artifacts, centerId, displayEdges, identities],
  );
  const [ready, setReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { ref: canvasHostRef, size: canvasSize } = useElementSize<HTMLDivElement>();
  const pointerModeRef = useRef<GlobePointerMode>(GLOBE_POINTER_IDLE);
  const hoveredIdRef = useRef<string | null>(null);
  const globeRef = useRef<ReturnType<typeof useGlobeGraph> | null>(null);
  const appearanceRef = useRef(appearance);
  const headIdsRef = useRef(headIds);
  const historicalIdsRef = useRef(historicalIds);
  const centerIdRef = useRef(centerId);
  const artifactsRef = useRef(artifacts);
  const edgesRef = useRef(displayEdges);
  const depthsRef = useRef(depths);
  const [rotatingGlobe, setRotatingGlobe] = useState(false);
  const [panningView, setPanningView] = useState(false);

  appearanceRef.current = appearance;
  headIdsRef.current = headIds;
  historicalIdsRef.current = historicalIds;
  centerIdRef.current = centerId;
  artifactsRef.current = artifacts;
  edgesRef.current = displayEdges;
  depthsRef.current = depths;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    getGraphLayout(packageId, "orb-globe:v2", fingerprint)
      .then((cached) => {
        if (cancelled) return;
        if (cached?.positions && Object.keys(cached.positions).length > 0) {
          setCachedLocal(globePositionsFromRecord(cached.positions));
        } else {
          setCachedLocal(null);
        }
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCachedLocal(null);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [packageId, fingerprint]);

  useEffect(() => {
    if (layoutEpoch === 0) return;
    setCachedLocal(null);
  }, [layoutEpoch]);

  const globe = useGlobeGraph({
    nodeIds: ready ? nodeIds : [],
    containerWidth: canvasSize.width,
    containerHeight: canvasSize.height,
    initialLocal: cachedLocal ?? undefined,
    autoRotate: true,
  });
  globeRef.current = globe;

  const viewBoxRect = useMemo(
    () => globeViewBoxRect(globe.width, globe.height),
    [globe.width, globe.height],
  );
  const viewBoxRef = useRef(viewBoxRect);
  viewBoxRef.current = viewBoxRect;

  const requestPaint = useCallback(() => undefined, []);

  const zoomEnabled = ready && canvasSize.width > 0 && canvasSize.height > 0;
  const { transform, transformRef, resetView, zoomIn, zoomOut, panByScreen } = useZoomPan(
    canvasRef,
    {
      enabled: zoomEnabled,
      focal: { x: globe.width / 2, y: globe.height / 2 },
      getViewBox: () => viewBoxRef.current,
      clampBounds: { width: viewBoxRect.width, height: viewBoxRect.height },
      onChange: requestPaint,
    },
  );

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const g = globeRef.current;
    if (!canvas || !g || canvasSize.width <= 0 || canvasSize.height <= 0) return;

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

    const projected = g.getProjected();
    const localPositions = g.snapshot();
    const { rotY, rotX } = g.getRotation();

    drawGlobeFrame({
      ctx,
      displayWidth: w,
      displayHeight: h,
      logicalWidth: g.width,
      logicalHeight: g.height,
      zoom: transformRef.current,
      appearance: appearanceRef.current,
      rotY,
      rotX,
      projectScale: g.projectScale,
      projected,
      localPositions,
      edges: edgesRef.current,
      artifacts: artifactsRef.current,
      headIds: headIdsRef.current,
      historicalIds: historicalIdsRef.current,
      hoveredId: hoveredIdRef.current,
      draggingId: g.getDraggingId(),
      interactionMode: rotatingGlobe ? "rotate" : panningView ? "pan" : "idle",
      centerId: centerIdRef.current,
      animationPhase: performance.now(),
      scene,
      levelFor: (id) => graphLevelForArtifact(id, depthsRef.current),
    });
  }, [canvasSize.width, canvasSize.height, panningView, rotatingGlobe, scene, transformRef]);

  useEffect(() => {
    globe.repaintRef.current = () => undefined;
    return () => {
      globe.repaintRef.current = null;
    };
  }, [globe]);

  useEffect(() => {
    if (!ready || canvasSize.width <= 0 || canvasSize.height <= 0) return;
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
  }, [ready, canvasSize.width, canvasSize.height, paint]);

  useEffect(() => {
    return attachGlobePointerSession({
      canvasRef,
      getViewBox: () => viewBoxRef.current,
      getMode: () => pointerModeRef.current,
      setMode: (mode) => {
        pointerModeRef.current = mode;
      },
      panByScreen,
      globe: () => globeRef.current,
      onNodeClick: onSelect,
      onRotateStart: () => setRotatingGlobe(true),
      onRotateEnd: () => setRotatingGlobe(false),
      onPanEnd: () => setPanningView(false),
    });
  }, [onSelect, panByScreen]);

  function beginPointerSession(pointerId: number) {
    document.body.classList.add("globe-pointer-active");
    try {
      canvasRef.current?.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  }

  function onCanvasPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    if (pointerModeRef.current.kind !== "none") return;

    const g = globeRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return;

    const pt = clientToLogical(canvas, event.clientX, event.clientY, viewBoxRef.current, transformRef.current);
    if (!pt) return;

    g.setInteractionActive(true);
    const hit = hitTestGlobeNode(g.getProjected(), pt.x, pt.y);

    if (hit) {
      pointerModeRef.current = {
        kind: "node-pending",
        pointerId: event.pointerId,
        id: hit,
        startX: event.clientX,
        startY: event.clientY,
      };
      beginPointerSession(event.pointerId);
      return;
    }

    const shouldPanView = !event.shiftKey;

    if (shouldPanView) {
      pointerModeRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      setPanningView(true);
    } else {
      pointerModeRef.current = {
        kind: "rotate",
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      setRotatingGlobe(true);
    }
    beginPointerSession(event.pointerId);
  }

  function onCanvasPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (pointerModeRef.current.kind !== "none") return;
    const g = globeRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return;
    const pt = clientToLogical(canvas, event.clientX, event.clientY, viewBoxRef.current, transformRef.current);
    if (!pt) return;
    const hit = hitTestGlobeNode(g.getProjected(), pt.x, pt.y);
    if (hit !== hoveredIdRef.current) {
      hoveredIdRef.current = hit;
    }
  }

  function onCanvasPointerLeave() {
    if (pointerModeRef.current.kind !== "none") return;
    hoveredIdRef.current = null;
    globeRef.current?.setInteractionActive(false);
  }

  if (!artifacts.length) {
    return (
      <div className="graph-empty">
        <p>当前成果包没有可显示节点</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="local-graph-wrap global globe globe-loading">
        <p className="muted">Globe loading…</p>
      </div>
    );
  }

  const globeStyle = {
    "--globe-bg": appearance.globe.background,
    "--globe-wire": appearance.globe.wireframe,
    "--globe-glow": appearance.globe.atmosphere,
  } as React.CSSProperties;

  return (
    <div className="local-graph-wrap global globe" style={globeStyle}>
      <div className="graph-canvas-toolbar">
        <p className="muted small graph-hint">
          ORB GLOBE · global shell network · drag to pan · Shift+drag to rotate · scroll to zoom
        </p>
        <button type="button" className="tool-btn ghost" onClick={resetView}>
          Center canvas
        </button>
      </div>
      <div ref={canvasHostRef} className="globe-canvas-host">
        <GraphZoomControls
          scale={transform.k}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={resetView}
          variant="dark"
        />
        {canvasSize.width > 0 && canvasSize.height > 0 && (
          <canvas
            ref={canvasRef}
            className={`globe-canvas-element ${rotatingGlobe ? "rotating" : ""} ${
              panningView ? "panning" : ""
            }`}
            width={canvasSize.width}
            height={canvasSize.height}
            aria-label="ORB GLOBE graph"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerLeave={onCanvasPointerLeave}
            onPointerEnter={() => globe.setInteractionActive(true)}
          />
        )}
      </div>
    </div>
  );
}
