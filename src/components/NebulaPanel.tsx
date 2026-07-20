import { useMemo } from "react";
import type { NebulaModel, NebulaNode } from "../shared/nebulaModel";
import { useI18n, type MessageKey } from "../shared/i18n";
import { kindLabel } from "../shared/utils";

interface NebulaPanelProps {
  model: NebulaModel;
  selectedNode: NebulaNode | null;
  onSelect: (id: string) => void;
}

const HEALTH_SEGMENTS: {
  key: "strong" | "medium" | "weak";
  labelKey: MessageKey;
  color: string;
}[] = [
  { key: "strong", labelKey: "nebula.strong", color: "#5fd6b8" },
  { key: "medium", labelKey: "nebula.medium", color: "#69b8ff" },
  { key: "weak", labelKey: "nebula.weak", color: "#8f6bff" },
];

export function NebulaPanel({ model, selectedNode, onSelect }: NebulaPanelProps) {
  const { t, locale } = useI18n();
  const { overview, health, clusters } = model;
  const topClusters = clusters.slice(0, 6);

  const selectedCluster = selectedNode
    ? clusters.find((c) => c.id === selectedNode.clusterId) ?? null
    : null;

  const donut = useMemo(() => buildDonut(health.strongPct, health.mediumPct, health.weakPct), [health]);

  return (
    <aside className="nebula-panel">
      <header className="nebula-panel-head">
        <span>{t("nebula.info")}</span>
      </header>

      <section className="nebula-panel-section">
        <h4>{t("nebula.overview")}</h4>
        <dl className="nebula-overview">
          <div><dt>{t("nebula.nodes")}</dt><dd>{overview.nodeCount.toLocaleString()}</dd></div>
          <div><dt>{t("nebula.edges")}</dt><dd>{overview.edgeCount.toLocaleString()}</dd></div>
          <div><dt>{t("nebula.clusters")}</dt><dd>{overview.clusterCount}</dd></div>
          <div><dt>{t("nebula.tags")}</dt><dd>{overview.tagCount}</dd></div>
          <div><dt>{t("nebula.dataSources")}</dt><dd>{overview.dataSourceCount}</dd></div>
          <div><dt>{t("nebula.updatedAt")}</dt><dd>{formatDate(overview.lastUpdatedAt)}</dd></div>
        </dl>
      </section>

      <section className="nebula-panel-section">
        <h4>{t("nebula.health")}</h4>
        <div className="nebula-health">
          <svg viewBox="0 0 42 42" className="nebula-donut" role="img" aria-label={t("nebula.healthAria")}>
            <circle className="nebula-donut-track" cx="21" cy="21" r="15.9" />
            {donut.map((seg) => (
              <circle
                key={seg.key}
                cx="21"
                cy="21"
                r="15.9"
                stroke={seg.color}
                strokeDasharray={`${seg.length} ${100 - seg.length}`}
                strokeDashoffset={seg.offset}
              />
            ))}
            <text x="21" y="20.5" className="nebula-donut-value">{health.healthPct}%</text>
            <text x="21" y="26" className="nebula-donut-label">{t("nebula.healthy")}</text>
          </svg>
          <ul className="nebula-health-legend">
            {HEALTH_SEGMENTS.map((seg) => (
              <li key={seg.key}>
                <span className="nebula-legend-dot" style={{ background: seg.color }} />
                <span>{t(seg.labelKey)}</span>
                <span className="nebula-health-pct">{health[`${seg.key}Pct` as const]}%</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="nebula-panel-section">
        <h4>
          {t("nebula.clusterDist")}{" "}
          <span className="nebula-panel-sub">Top {topClusters.length}</span>
        </h4>
        <ul className="nebula-cluster-list">
          {topClusters.map((c) => (
            <li key={c.id}>
              <span className="nebula-legend-dot" style={{ background: c.color }} />
              <span className="nebula-cluster-name">{c.label}</span>
              <span className="nebula-cluster-count">{c.count}</span>
            </li>
          ))}
          {clusters.length > topClusters.length && (
            <li className="nebula-cluster-more">
              {t("nebula.viewAll", { count: clusters.length })}
            </li>
          )}
        </ul>
      </section>

      <section className="nebula-panel-section nebula-selected">
        <h4>{t("nebula.selected")}</h4>
        {selectedNode ? (
          <div className="nebula-selected-body">
            <div className="nebula-selected-name">{selectedNode.label}</div>
            <dl className="nebula-overview">
              <div>
                <dt>{t("nebula.nodeType")}</dt>
                <dd>{kindLabel(selectedNode.kind, locale)}</dd>
              </div>
              <div><dt>{t("nebula.nodeId")}</dt><dd className="mono">{shortId(selectedNode.id)}</dd></div>
              <div><dt>{t("nebula.degree")}</dt><dd>{selectedNode.degree}</dd></div>
              <div>
                <dt>{t("nebula.clusterOf")}</dt>
                <dd>{selectedCluster?.label ?? "—"}</dd>
              </div>
            </dl>
            <button type="button" className="nebula-detail-btn" onClick={() => onSelect(selectedNode.id)}>
              {t("nebula.viewDetail")}
            </button>
          </div>
        ) : (
          <p className="nebula-selected-empty">{t("nebula.clickNode")}</p>
        )}
      </section>
    </aside>
  );
}

interface DonutSeg {
  key: string;
  color: string;
  length: number;
  offset: number;
}

/** stroke-dasharray donut over a circumference of 100 units. */
function buildDonut(strong: number, medium: number, weak: number): DonutSeg[] {
  const segs: DonutSeg[] = [];
  let cursor = 25; // start at top (12 o'clock)
  const push = (key: string, color: string, value: number) => {
    if (value <= 0) return;
    segs.push({ key, color, length: value, offset: (100 - cursor) % 100 });
    cursor = (cursor + value) % 100;
  };
  push("strong", "#5fd6b8", strong);
  push("medium", "#69b8ff", medium);
  push("weak", "#8f6bff", weak);
  return segs;
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
