import { useMemo } from "react";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import type {
  GraphInfoDistribution,
  GraphInfoHealth,
  GraphInfoModel,
} from "../shared/graphInfoModel";
import { useI18n, type MessageKey } from "../shared/i18n";
import type { ArtifactView } from "../shared/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface GraphInfoPanelProps {
  model: GraphInfoModel;
  artifacts: ArtifactView[];
  relationCounts: Record<string, number>;
  relationColors: GraphAppearanceSettings["edges"];
  onSelectArtifact: (id: string) => void;
}

const HEALTH_SEGMENTS = [
  { key: "high", labelKey: "graph.healthHigh" as const, color: "#61d9c2", pctKey: "highPct" as const },
  { key: "mid", labelKey: "graph.healthMid" as const, color: "#61b7ff", pctKey: "midPct" as const },
  { key: "low", labelKey: "graph.healthLow" as const, color: "#8f6bff", pctKey: "lowPct" as const },
] as const;

const RELATION_KEYS: { kind: string; labelKey: MessageKey; hintKey: MessageKey }[] = [
  { kind: "part_of", labelKey: "relation.part_of", hintKey: "relation.part_of.hint" },
  { kind: "uses", labelKey: "relation.uses", hintKey: "relation.uses.hint" },
  { kind: "version", labelKey: "relation.version", hintKey: "relation.version.hint" },
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

export function GraphInfoPanel({
  model,
  artifacts,
  relationCounts,
  relationColors,
  onSelectArtifact,
}: GraphInfoPanelProps) {
  const { t } = useI18n();
  const { overview, health, kindDistribution } = model;
  const donut = useMemo(
    () => buildDonut(health.highPct, health.midPct, health.lowPct),
    [health],
  );
  const hotNodes = useMemo(
    () =>
      artifacts
        .map((artifact) => ({
          artifact,
          degree: model.degreeById.get(artifact.id) ?? 0,
        }))
        .sort((a, b) => b.degree - a.degree || a.artifact.displayName.localeCompare(b.artifact.displayName))
        .slice(0, 3),
    [artifacts, model.degreeById],
  );

  return (
    <aside className="graph-insight-panel">
      <header className="graph-insight-head">
        <span>{t("graph.insight")}</span>
        <em>{t("graph.readonly")}</em>
      </header>

      <section className="graph-insight-metrics" aria-label={t("graph.overviewAria")}>
        <Metric value={overview.nodeCount} label={t("graph.nodes")} />
        <Metric value={overview.edgeCount} label={t("graph.edges")} />
        <Metric value={overview.kindCount} label={t("graph.kinds")} />
      </section>

      <section className="graph-insight-card">
        <h3>{t("graph.health")}</h3>
        <HealthBlock health={health} donut={donut} />
      </section>

      <section className="graph-insight-card">
        <h3>{t("graph.hotNodes")}</h3>
        <ol className="graph-hot-list">
          {hotNodes.map(({ artifact, degree }, index) => (
            <li key={artifact.id}>
              <button type="button" onClick={() => onSelectArtifact(artifact.id)}>
                <b>{index + 1}</b>
                <span className={`graph-hot-kind kind-${artifact.kind}`} aria-hidden>
                  {kindGlyph(artifact.kind)}
                </span>
                <span className="graph-hot-name" title={artifact.displayName}>
                  {artifact.displayName}
                </span>
                <em>{degree}</em>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <DistributionBlock dist={kindDistribution} />

      <section className="graph-insight-card graph-relation-legend">
        <h3>{t("graph.relationLegend")}</h3>
        <TooltipProvider delayDuration={200}>
          <div>
            {RELATION_KEYS.map(({ kind, labelKey, hintKey }) => {
              const count = relationCounts[kind] ?? 0;
              const hint = t("relation.countHint", {
                label: t(hintKey),
                count: count.toLocaleString(),
              });
              return (
                <Tooltip key={kind}>
                  <TooltipTrigger asChild>
                    <span title={hint}>
                      <i
                        style={{
                          background:
                            relationColors[kind as keyof typeof relationColors],
                        }}
                      />
                      <span className="legend-label">{t(labelKey)}</span>
                      <em>{count}</em>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="left"
                    className="max-w-[240px] text-left leading-snug"
                  >
                    {hint}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </section>
    </aside>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

function HealthBlock({ health, donut }: { health: GraphInfoHealth; donut: DonutSeg[] }) {
  const { t } = useI18n();
  return (
    <div className="graph-health-layout">
      <svg viewBox="0 0 42 42" className="graph-health-donut" role="img" aria-label={t("graph.health")}>
        <circle className="track" cx="21" cy="21" r="15.9" />
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
        <text x="21" y="20.5" className="value">{health.healthPct}%</text>
        <text x="21" y="26" className="label">{t("graph.connected")}</text>
      </svg>
      <ul className="graph-health-levels">
        {HEALTH_SEGMENTS.map((seg) => (
          <li key={seg.key}>
            <i style={{ background: seg.color }} />
            <span>{t(seg.labelKey)}</span>
            <strong>{health[seg.pctKey]}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DistributionBlock({ dist }: { dist: GraphInfoDistribution }) {
  const { t } = useI18n();
  const max = Math.max(1, ...dist.buckets.map((bucket) => bucket.count));
  return (
    <section className="graph-insight-card">
      <h3>
        {t("graph.distribution")}
        <span>Top {dist.buckets.length}</span>
      </h3>
      <div className="graph-distribution">
        {dist.buckets.map((bucket) => (
          <div key={bucket.id}>
            <span title={bucket.label}>{bucket.label}</span>
            <i><b style={{ width: `${Math.max(8, (bucket.count / max) * 100)}%`, background: bucket.color }} /></i>
            <strong>{bucket.count}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function kindGlyph(kind: string): string {
  if (kind === "markdown") return "M";
  if (kind === "image") return "▧";
  if (kind === "video") return "▶";
  if (kind === "audio") return "♪";
  if (kind === "html") return "‹›";
  return "◆";
}

interface DonutSeg {
  key: string;
  color: string;
  length: number;
  offset: number;
}

function buildDonut(high: number, mid: number, low: number): DonutSeg[] {
  const segs: DonutSeg[] = [];
  let cursor = 25;
  const push = (key: string, color: string, value: number) => {
    if (value <= 0) return;
    segs.push({ key, color, length: value, offset: (100 - cursor) % 100 });
    cursor = (cursor + value) % 100;
  };
  push("high", "#61d9c2", high);
  push("mid", "#61b7ff", mid);
  push("low", "#8f6bff", low);
  return segs;
}
