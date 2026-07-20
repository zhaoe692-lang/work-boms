import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useI18n } from "@/shared/i18n";

const STORAGE_KEY = "workbom.previewFloat.size";
const MIN_W = 480;
const MIN_H = 320;
const DEFAULT_W = 920;
const DEFAULT_H = 720;

type Size = { w: number; h: number };

function clampSize(w: number, h: number): Size {
  const maxW = Math.max(MIN_W, Math.floor(window.innerWidth * 0.96));
  const maxH = Math.max(MIN_H, Math.floor(window.innerHeight * 0.92));
  return {
    w: Math.min(maxW, Math.max(MIN_W, Math.round(w))),
    h: Math.min(maxH, Math.max(MIN_H, Math.round(h))),
  };
}

function loadSize(): Size {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Size>;
      if (typeof parsed.w === "number" && typeof parsed.h === "number") {
        return clampSize(parsed.w, parsed.h);
      }
    }
  } catch {
    /* ignore */
  }
  return clampSize(DEFAULT_W, DEFAULT_H);
}

function saveSize(size: Size) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(size));
  } catch {
    /* ignore */
  }
}

export function ResizablePreviewFloat({
  title,
  chip,
  toolbar,
  onClose,
  children,
  className = "",
  headClassName = "",
  bodyClassName = "",
}: {
  title: string;
  chip?: ReactNode;
  toolbar?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  headClassName?: string;
  bodyClassName?: string;
}) {
  const { t } = useI18n();
  const [size, setSize] = useState<Size>(() => loadSize());
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  useEffect(() => {
    const onResize = () => setSize((s) => clampSize(s.w, s.h));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const el = event.currentTarget;
      el.setPointerCapture(event.pointerId);
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startW: size.w,
        startH: size.h,
      };
    },
    [size.h, size.w],
  );

  const onResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = clampSize(
        drag.startW + (event.clientX - drag.startX),
        drag.startH + (event.clientY - drag.startY),
      );
      setSize(next);
    },
    [],
  );

  const onResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      setSize((s) => {
        const next = clampSize(s.w, s.h);
        saveSize(next);
        return next;
      });
    },
    [],
  );

  return (
    <div
      className={`preview-float ${className}`.trim()}
      role="dialog"
      aria-label={t("preview.aria")}
      style={{ width: size.w, height: size.h }}
      onClick={(e) => e.stopPropagation()}
    >
      <header className={`preview-float-head ${headClassName}`.trim()}>
        <h3>{title}</h3>
        {chip}
        {toolbar}
        <button type="button" className="preview-float-close" onClick={onClose}>
          {t("common.close")}
        </button>
      </header>
      <div className={`preview-float-body ${bodyClassName}`.trim()}>{children}</div>
      <div
        className="preview-float-resize"
        role="separator"
        aria-label={t("preview.resize")}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      />
    </div>
  );
}
