import { useI18n } from "../shared/i18n";

interface GraphZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  variant?: "light" | "dark";
}

export function GraphZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
  variant = "light",
}: GraphZoomControlsProps) {
  const { t } = useI18n();
  const pct = Math.round(scale * 100);

  return (
    <div className={`graph-zoom-controls ${variant}`} role="group" aria-label={t("graph.canvasZoomAria")}>
      <button
        type="button"
        className="zoom-btn"
        onClick={(e) => {
          e.stopPropagation();
          onZoomOut();
        }}
        aria-label={t("graph.zoomOut")}
      >
        −
      </button>
      <button
        type="button"
        className="zoom-level"
        onClick={(e) => {
          e.stopPropagation();
          onReset();
        }}
        title={t("graph.resetZoom")}
      >
        {pct}%
      </button>
      <button
        type="button"
        className="zoom-btn"
        onClick={(e) => {
          e.stopPropagation();
          onZoomIn();
        }}
        aria-label={t("graph.zoomIn")}
      >
        +
      </button>
    </div>
  );
}
