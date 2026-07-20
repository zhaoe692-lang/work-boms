import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGraphLayout } from "../shared/api";
import { clientToLogical } from "../shared/globeCanvasCoords";
import {
  attachGlobePointerSession,
  GLOBE_POINTER_IDLE,
  type GlobePointerMode,
} from "../shared/globePointerSession";
import type { DisplayEdge } from "../shared/graph";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import { drawMyceliumFrame, hitTestMyceliumNode } from "../shared/myceliumCanvasDraw";
import { pulseViewBoxRect } from "../shared/pulseLayout";
import { buildStarGrowthScene } from "../shared/starGrowthScene";
import { useElementSize } from "../shared/useElementSize";
import { pulsePositionsFromRecord, usePulseGraph } from "../shared/usePulseGraph";
import { useZoomPan } from "../shared/useZoomPan";
import type { ArtifactView, Identity, Relation } from "../shared/types";
import { graphFingerprint } from "../shared/utils";
import { GraphZoomControls } from "./GraphZoomControls";

const REVEAL_MS = 4200;

function revealStorageKey(packageId: string, fingerprint: string, layoutEpoch: number): string {
  return `workboms-pulse-revealed:${packageId}:${fingerprint}:${layoutEpoch}`;
}

interface PulseGraphProps {
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

export function PulseGraph({
  packageId,
  artifacts,
  edges: displayEdges,
  relations,
  identities,
  centerId,
  layoutEpoch,
  appearance,
  onSelect,
}: PulseGraphProps) {
  const fingerprint = useMemo(
    () => graphFingerprint(artifacts, displayEdges),
    [artifacts, displayEdges],
  );
  const stats = useMemo(
    () => ({
      total: artifacts.length,
      finals: artifacts.filter((a) => a.status === "final").length,
      edges: displayEdges.length,
    }),
    [artifacts, displayEdges.length],
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

  const [cachedLocal, setCachedLocal] = useState<ReturnType<typeof pulsePositionsFromRecord> | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { ref: canvasHostRef, size: canvasSize } = useElementSize<HTMLDivElement>();
  const pointerModeRef = useRef<GlobePointerMode>(GLOBE_POINTER_IDLE);
  const hoveredIdRef = useRef<string | null>(null);
  const pulseRef = useRef<ReturnType<typeof usePulseGraph> | null>(null);
  const appearanceRef = useRef(appearance);
  const centerIdRef = useRef(centerId);
  const artifactsRef = useRef(artifacts);
  const edgesRef = useRef(displayEdges);
  const [panningView, setPanningView] = useState(false);
  const [rotatingSphere, setRotatingSphere] = useState(false);
  const revealStartRef = useRef(performance.now());
  const revealDoneRef = useRef(false);

  appearanceRef.current = appearance;
  centerIdRef.current = centerId;
  artifactsRef.current = artifacts;
  edgesRef.current = displayEdges;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    getGraphLayout(packageId, "mycelium:v1", fingerprint)
      .then((cached) => {
        if (cancelled) return;
        if (cached?.positions && Object.keys(cached.positions).length > 0) {
          setCachedLocal(pulsePositionsFromRecord(cached.positions));
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

  useEffect(() => {
    const key = revealStorageKey(packageId, fingerprint, layoutEpoch);
    if (localStorage.getItem(key) === "1") {
      revealStartRef.current = performance.now() - REVEAL_MS;
      revealDoneRef.current = true;
    } else {
      revealStartRef.current = performance.now();
      revealDoneRef.current = false;
    }
  }, [packageId, fingerprint, layoutEpoch]);

  const pulse = usePulseGraph({
    artifacts: ready ? artifacts : [],
    relations,
    identities,
    scene,
    containerWidth: canvasSize.width,
    containerHeight: canvasSize.height,
    initialLocal: cachedLocal ?? undefined,
  });
  pulseRef.current = pulse;

  const viewBoxRect = useMemo(
    () => pulseViewBoxRect(pulse.width, pulse.height),
    [pulse.width, pulse.height],
  );
  const viewBoxRef = useRef(viewBoxRect);
  viewBoxRef.current = viewBoxRect;

  const requestPaint = useCallback(() => undefined, []);

  const zoomEnabled = ready && canvasSize.width > 0 && canvasSize.height > 0;
  const { transform, transformRef, resetView, zoomIn, zoomOut, panByScreen } = useZoomPan(
    canvasRef,
    {
      enabled: zoomEnabled,
      focal: { x: pulse.width / 2, y: pulse.height / 2 },
      getViewBox: () => viewBoxRef.current,
      clampBounds: { width: viewBoxRect.width, height: viewBoxRect.height },
      onChange: requestPaint,
    },
  );

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const p = pulseRef.current;
    if (!canvas || !p || canvasSize.width <= 0 || canvasSize.height <= 0) return;

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

    const now = performance.now();
    const revealProgress = Math.min(1, (now - revealStartRef.current) / REVEAL_MS);
    if (revealProgress >= 1 && !revealDoneRef.current) {
      revealDoneRef.current = true;
      localStorage.setItem(revealStorageKey(packageId, fingerprint, layoutEpoch), "1");
    }

    const projection = p.getMyceliumProjection();
    const layout = p.getLayout();
    if (!projection || !layout) return;

    drawMyceliumFrame({
      ctx,
      displayWidth: w,
      displayHeight: h,
      logicalWidth: p.width,
      logicalHeight: p.height,
      zoom: transformRef.current,
      appearance: appearanceRef.current,
      projectScale: p.projectScale,
      projected: projection.projected,
      projectedRoot: projection.projectedRoot,
      layout,
      projectedBranches: projection.projectedBranches,
      projectedClusters: projection.projectedClusters,
      localDistById: p.getLocalDistances(),
      edges: edgesRef.current,
      artifacts: artifactsRef.current,
      centerId: centerIdRef.current,
      hoveredId: hoveredIdRef.current,
      animationPhase: now,
      revealProgress,
      scene,
    });
  }, [
    canvasSize.width,
    canvasSize.height,
    fingerprint,
    layoutEpoch,
    packageId,
    scene,
    stats,
    transformRef,
  ]);

  useEffect(() => {
    pulse.repaintRef.current = () => undefined;
    return () => {
      pulse.repaintRef.current = null;
    };
  }, [pulse]);

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
      globe: () => pulseRef.current,
      onNodeClick: onSelect,
      onRotateStart: () => setRotatingSphere(true),
      onRotateEnd: () => setRotatingSphere(false),
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

    const p = pulseRef.current;
    if (!p) return;

    const pt = clientToLogicalPt(event.clientX, event.clientY);
    if (!pt) return;

    p.setInteractionActive(true);
    const proj = p.getMyceliumProjection();
    const hit = proj
      ? hitTestMyceliumNode(proj.projected, proj.projectedClusters, pt.x, pt.y)
      : null;

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

    if (event.shiftKey) {
      pointerModeRef.current = {
        kind: "rotate",
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      setRotatingSphere(true);
    } else {
      pointerModeRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      setPanningView(true);
    }
    beginPointerSession(event.pointerId);
  }

  function onCanvasPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (pointerModeRef.current.kind !== "none") return;
    const p = pulseRef.current;
    if (!p) return;
    const pt = clientToLogicalPt(event.clientX, event.clientY);
    if (!pt) return;
    const proj = p.getMyceliumProjection();
    const hit = proj
      ? hitTestMyceliumNode(proj.projected, proj.projectedClusters, pt.x, pt.y)
      : null;
    if (hit !== hoveredIdRef.current) {
      hoveredIdRef.current = hit;
      p.setInteractionActive(true);
    }
  }

  function onCanvasPointerLeave() {
    if (pointerModeRef.current.kind !== "none") return;
    hoveredIdRef.current = null;
    pulseRef.current?.setInteractionActive(false);
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
      <div className="local-graph-wrap global pulse pulse-loading">
        <p className="muted">Mycelium graph loading…</p>
      </div>
    );
  }

  return (
    <div className="local-graph-wrap global pulse">
      <div className="graph-canvas-toolbar">
        <p className="muted small graph-hint">
          {stats.total} nodes · {stats.edges} connections · organic growth
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
            className={`pulse-canvas-element ${rotatingSphere ? "rotating" : ""} ${
              panningView ? "panning" : ""
            }`}
            width={canvasSize.width}
            height={canvasSize.height}
            aria-label="Mycelium growth knowledge graph"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerLeave={onCanvasPointerLeave}
            onPointerEnter={() => pulse.setInteractionActive(true)}
          />
        )}
      </div>
    </div>
  );
}
