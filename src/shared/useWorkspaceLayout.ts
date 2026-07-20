import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "workboms-workspace-layout";

const DEFAULTS = { sidebar: 260, inspector: 340 };
const LIMITS = {
  sidebar: { min: 180, max: 480 },
  inspector: { min: 300, max: 560 },
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function loadLayout(): typeof DEFAULTS {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULTS>;
    return {
      sidebar: clamp(parsed.sidebar ?? DEFAULTS.sidebar, LIMITS.sidebar.min, LIMITS.sidebar.max),
      inspector: clamp(parsed.inspector ?? DEFAULTS.inspector, LIMITS.inspector.min, LIMITS.inspector.max),
    };
  } catch {
    return DEFAULTS;
  }
}

export function useWorkspaceLayout() {
  const [sidebarW, setSidebarW] = useState(() => loadLayout().sidebar);
  const [inspectorW, setInspectorW] = useState(() => loadLayout().inspector);
  const sidebarRef = useRef(sidebarW);
  const inspectorRef = useRef(inspectorW);
  const dragRef = useRef<{
    kind: "sidebar" | "inspector";
    startX: number;
    startW: number;
  } | null>(null);

  useEffect(() => {
    sidebarRef.current = sidebarW;
  }, [sidebarW]);
  useEffect(() => {
    inspectorRef.current = inspectorW;
  }, [inspectorW]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      if (drag.kind === "sidebar") {
        setSidebarW(clamp(drag.startW + dx, LIMITS.sidebar.min, LIMITS.sidebar.max));
      } else {
        setInspectorW(clamp(drag.startW - dx, LIMITS.inspector.min, LIMITS.inspector.max));
      }
    }

    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.classList.remove("resizing-panels");
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ sidebar: sidebarRef.current, inspector: inspectorRef.current }),
      );
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const beginResize = useCallback((kind: "sidebar" | "inspector", clientX: number) => {
    dragRef.current = {
      kind,
      startX: clientX,
      startW: kind === "sidebar" ? sidebarRef.current : inspectorRef.current,
    };
    document.body.classList.add("resizing-panels");
  }, []);

  return { sidebarW, inspectorW, beginResize };
}
