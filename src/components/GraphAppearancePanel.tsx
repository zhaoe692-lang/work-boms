import { useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import {
  clampNodeSizeScale,
  loadGraphAppearance,
  MAX_NODE_SIZE_SCALE,
  MIN_NODE_SIZE_SCALE,
  resetGraphAppearance,
  saveGraphAppearance,
  type EdgeKindKey,
  type GraphAppearanceSettings,
} from "../shared/graphAppearance";
import { useI18n, type MessageKey } from "../shared/i18n";

function persistAppearance(next: GraphAppearanceSettings) {
  saveGraphAppearance(next);
}

const EDGE_LEGEND: {
  kind: EdgeKindKey;
  labelKey: MessageKey;
  hintKey: MessageKey;
}[] = [
  { kind: "part_of", labelKey: "relation.part_of", hintKey: "relation.part_of.hint" },
  { kind: "version", labelKey: "relation.version", hintKey: "relation.version.hint" },
  { kind: "uses", labelKey: "relation.uses", hintKey: "relation.uses.hint" },
  {
    kind: "references",
    labelKey: "relation.references",
    hintKey: "relation.references.hint",
  },
  {
    kind: "derived_from",
    labelKey: "relation.derived_from",
    hintKey: "relation.derived_from.hint",
  },
  {
    kind: "pairs_with",
    labelKey: "relation.pairs_with",
    hintKey: "relation.pairs_with.hint",
  },
];

const ALL_KINDS = EDGE_LEGEND.map(({ kind }) => kind);

interface GraphAppearancePanelProps {
  settings: GraphAppearanceSettings;
  onChange: (next: GraphAppearanceSettings) => void;
  relationKinds: string[];
  onRelationKindsChange: (next: string[]) => void;
  counts?: Record<string, number>;
  graphFocus?: boolean;
  onToggleGraphFocus?: () => void;
  onExportGraphJson?: () => void;
  onResetLayout?: () => void;
  canResetLayout?: boolean;
}

export function GraphAppearancePanel({
  settings,
  onChange,
  relationKinds,
  onRelationKindsChange,
  counts = {},
  graphFocus = false,
  onToggleGraphFocus,
  onExportGraphJson,
  onResetLayout,
  canResetLayout,
}: GraphAppearancePanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scalePct = Math.round(clampNodeSizeScale(settings.nodeSizeScale) * 100);
  const allActive = ALL_KINDS.every((kind) => relationKinds.includes(kind));
  const total = ALL_KINDS.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0);
  const showActions = !!(onExportGraphJson || onToggleGraphFocus || onResetLayout);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function patchSizeScale(value: number) {
    const next = {
      ...settings,
      nodeSizeScale: clampNodeSizeScale(value),
    };
    onChange(next);
    persistAppearance(next);
  }

  function handleReset() {
    const defaults = resetGraphAppearance();
    onChange(defaults);
  }

  function toggleKind(kind: EdgeKindKey) {
    if (allActive) {
      onRelationKindsChange([kind]);
      return;
    }
    const active = relationKinds.includes(kind);
    if (active && relationKinds.length === 1) {
      onRelationKindsChange(ALL_KINDS);
      return;
    }
    onRelationKindsChange(
      active
        ? relationKinds.filter((item) => item !== kind)
        : [...relationKinds, kind],
    );
  }

  return (
    <div
      className={`graph-style-menu graph-config-anchor${open ? " open" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={`graph-config-icon${open ? " active" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("graph.config")}
        title={t("graph.config")}
        onClick={() => setOpen((v) => !v)}
      >
        <Settings2 size={16} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="graph-style-dropdown" role="dialog" aria-label={t("graph.configAria")}>
          <section className="graph-style-section">
            <header>
              <h4>{t("graph.nodeSize")}</h4>
              <strong>{scalePct}%</strong>
            </header>
            <input
              type="range"
              min={MIN_NODE_SIZE_SCALE}
              max={MAX_NODE_SIZE_SCALE}
              step={0.05}
              value={clampNodeSizeScale(settings.nodeSizeScale)}
              onChange={(e) => patchSizeScale(Number(e.target.value))}
              aria-label={t("graph.nodeSize")}
            />
          </section>

          <section className="graph-style-section">
            <header>
              <h4>{t("graph.relationFilter")}</h4>
              <span className="graph-style-muted">{t("graph.toggleVisibility")}</span>
            </header>
            <div
              className="graph-style-kind-filters"
              role="group"
              aria-label={t("graph.relationFilter")}
            >
              <button
                type="button"
                className={`graph-style-kind-chip${allActive ? " active" : ""}`}
                aria-pressed={allActive}
                title={t("graph.allRelations.hint")}
                onClick={() => onRelationKindsChange(ALL_KINDS)}
              >
                {t("graph.allRelations")}
                <em>{total.toLocaleString()}</em>
              </button>
              {EDGE_LEGEND.map(({ kind, labelKey, hintKey }) => {
                const active = !allActive && relationKinds.includes(kind);
                const count = counts[kind] ?? 0;
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`graph-style-kind-chip${active ? " active" : ""}`}
                    aria-pressed={active}
                    title={t("relation.countHint", {
                      label: t(hintKey),
                      count: count.toLocaleString(),
                    })}
                    onClick={() => toggleKind(kind)}
                  >
                    <span
                      className="edge-line"
                      style={{ background: settings.edges[kind] }}
                    />
                    <span className="graph-style-kind-label">{t(labelKey)}</span>
                    <em>{count.toLocaleString()}</em>
                  </button>
                );
              })}
            </div>
          </section>

          {showActions && (
            <section className="graph-style-section">
              <header>
                <h4>{t("graph.actions")}</h4>
              </header>
              <div className="graph-style-actions">
                {onExportGraphJson && (
                  <button
                    type="button"
                    className="tool-btn ghost"
                    title={t("graph.exportJsonTitle")}
                    onClick={() => {
                      onExportGraphJson();
                      setOpen(false);
                    }}
                  >
                    {t("graph.exportJson")}
                  </button>
                )}
                {onToggleGraphFocus && (
                  <button
                    type="button"
                    className={`tool-btn ghost${graphFocus ? " active" : ""}`}
                    onClick={() => {
                      onToggleGraphFocus();
                      setOpen(false);
                    }}
                  >
                    {graphFocus ? t("graph.showToolbar") : t("graph.focusMode")}
                  </button>
                )}
                {canResetLayout && onResetLayout && (
                  <button
                    type="button"
                    className="tool-btn ghost"
                    title={t("graph.resetLayoutTitle")}
                    onClick={() => {
                      onResetLayout();
                      setOpen(false);
                    }}
                  >
                    {t("graph.resetLayout")}
                  </button>
                )}
              </div>
            </section>
          )}

          <footer className="graph-style-footer">
            <button type="button" className="tool-btn ghost" onClick={handleReset}>
              {t("graph.resetStyle")}
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}

export function useGraphAppearanceState() {
  const [settings, setSettings] = useState<GraphAppearanceSettings>(() =>
    loadGraphAppearance(),
  );
  return { settings, setSettings };
}
