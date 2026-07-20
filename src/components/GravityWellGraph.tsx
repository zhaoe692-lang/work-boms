import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clientToLogical } from "../shared/globeCanvasCoords";
import {
  attachGlobePointerSession,
  GLOBE_POINTER_IDLE,
  type GlobePointerMode,
} from "../shared/globePointerSession";
import type { DisplayEdge } from "../shared/graph";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import {
  drawGravityWellFrame,
  hitTestGravityWellNode,
  projectGravityWellLayout,
} from "../shared/gravityWellCanvasDraw";
import { buildGravityWellLayout } from "../shared/gravityWellLayout";
import { pulseProjectScale, pulseViewBoxRect } from "../shared/pulseLayout";
import { buildStarGrowthScene } from "../shared/starGrowthScene";
import { useElementSize } from "../shared/useElementSize";
import { useZoomPan } from "../shared/useZoomPan";
import type { ArtifactView, Identity } from "../shared/types";
import { GraphZoomControls } from "./GraphZoomControls";

interface GravityWellGraphProps {
  artifacts: ArtifactView[];
  edges: DisplayEdge[];
  identities: Identity[];
  centerId: string | null;
  appearance: GraphAppearanceSettings;
  onSelect: (id: string) => void;
}

export function GravityWellGraph({
  artifacts,
  edges: displayEdges,
  identities,
  centerId,
  appearance,
  onSelect,
}: GravityWellGraphProps) {
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

  const layout = useMemo(
    () => buildGravityWellLayout({ artifacts, scene }),
    [artifacts, scene],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { ref: canvasHostRef, size: canvasSize } = useElementSize<HTMLDivElement>();
  const pointerModeRef = useRef<GlobePointerMode>(GLOBE_POINTER_IDLE);
  const hoveredIdRef = useRef<string | null>(null);
  const appearanceRef = useRef(appearance);
  const centerIdRef = useRef(centerId);
  const artifactsRef = useRef(artifacts);
  const edgesRef = useRef(displayEdges);
  const layoutRef = useRef(layout);
  const sceneRef = useRef(scene);
  const [panningView, setPanningView] = useState(false);

  appearanceRef.current = appearance;
  centerIdRef.current = centerId;
  artifactsRef.current = artifacts;
  edgesRef.current = displayEdges;
  layoutRef.current = layout;
  sceneRef.current = scene;

  const logicalWidth = canvasSize.width > 0 ? canvasSize.width : 900;
  const logicalHeight = canvasSize.height > 0 ? canvasSize.height : 620;
  const projectScale = pulseProjectScale(logicalWidth, logicalHeight);
  const viewBoxRect = useMemo(
    () => pulseViewBoxRect(logicalWidth, logicalHeight),
    [logicalWidth, logicalHeight],
  );
  const viewBoxRef = useRef(viewBoxRect);
  viewBoxRef.current = viewBoxRect;

  const requestPaint = useCallback(() => undefined, []);

  const zoomEnabled = canvasSize.width > 0 && canvasSize.height > 0;
  const { transform, transformRef, resetView, zoomIn, zoomOut, panByScreen } = useZoomPan(
    canvasRef,
    {
      enabled: zoomEnabled,
      focal: { x: logicalWidth / 2, y: logicalHeight / 2 },
      getViewBox: () => viewBoxRef.current,
      clampBounds: { width: viewBoxRect.width, height: viewBoxRect.height },
      onChange: requestPaint,
    },
  );

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width <= 0 || canvasSize.height <= 0) return;

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

    const projection = projectGravityWellLayout(layoutRef.current, w, h, projectScale);

    drawGravityWellFrame({
      ctx,
      displayWidth: w,
      displayHeight: h,
      logicalWidth: w,
      logicalHeight: h,
      zoom: transformRef.current,
      projectScale,
      layout: layoutRef.current,
      projected: projection.projected,
      projectedWell: projection.projectedWell,
      projectedArcs: projection.projectedArcs,
      edges: edgesRef.current,
      artifacts: artifactsRef.current,
      centerId: centerIdRef.current,
      hoveredId: hoveredIdRef.current,
      animationPhase: performance.now(),
      scene: sceneRef.current,
    });
  }, [canvasSize.width, canvasSize.height, projectScale, transformRef]);

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

  const clientToLogicalPt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      return clientToLogical(canvas, clientX, clientY, viewBoxRef.current, transformRef.current);
    },
    [transformRef],
  );

  useEffect(() => {
    return attachGlobePointerSession({
      canvasRef,
      getViewBox: () => viewBoxRef.current,
      getMode: () => pointerModeRef.current,
      setMode: (mode) => {
        pointerModeRef.current = mode;
      },
      panByScreen,
      globe: () => null,
      onNodeClick: onSelect,
      onRotateStart: () => undefined,
      onRotateEnd: () => undefined,
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

    const pt = clientToLogicalPt(event.clientX, event.clientY);
    if (!pt) return;

    const projection = projectGravityWellLayout(
      layoutRef.current,
      canvasSize.width,
      canvasSize.height,
      projectScale,
    );
    const hit = hitTestGravityWellNode(projection.projected, pt.x, pt.y);

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

    pointerModeRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    setPanningView(true);
    beginPointerSession(event.pointerId);
  }

  function onCanvasPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (pointerModeRef.current.kind !== "none") return;
    const pt = clientToLogicalPt(event.clientX, event.clientY);
    if (!pt) return;
    const projection = projectGravityWellLayout(
      layoutRef.current,
      canvasSize.width,
      canvasSize.height,
      projectScale,
    );
    const hit = hitTestGravityWellNode(projection.projected, pt.x, pt.y);
    if (hit !== hoveredIdRef.current) hoveredIdRef.current = hit;
  }

  function onCanvasPointerLeave() {
    if (pointerModeRef.current.kind !== "none") return;
    hoveredIdRef.current = null;
  }

  if (!artifacts.length) {
    return (
      <div className="graph-empty">
        <p>当前成果包没有可显示节点</p>
      </div>
    );
  }

  return (
    <div className="local-graph-wrap global pulse">
      <div className="graph-canvas-toolbar">
        <p className="muted small graph-hint">
          {artifacts.length} nodes · gravity well · drag pan · wheel zoom
        </p>
        <button type="button" className="tool-btn ghost" onClick={resetView}>
          Center canvas
        </button>
      </div>
      <div ref={canvasHostRef} className="pulse-canvas-host">
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
            className={`pulse-canvas-element ${panningView ? "panning" : ""}`}
            width={canvasSize.width}
            height={canvasSize.height}
            aria-label="Gravity well knowledge graph"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerLeave={onCanvasPointerLeave}
          />
        )}
      </div>
    </div>
  );
}
