/**
 * Single source of truth for how the fixed backend metrics render as cards.
 *
 * The backend (src-tauri/src/metrics.rs) owns *computation*; this table owns
 * *presentation* — one record per card describing its label/icon, how to
 * derive the StatCard view from the metrics payload, and a reliability tag so
 * the UI can explain how trustworthy each number is. The cockpit just maps
 * over these specs, so adding/tuning a card happens in exactly one place.
 */
import type { IconName } from "../components/icons";
import type { MessageKey } from "./i18n";
import type { Locale } from "./i18n";
import type { KindCount, PackageMetrics } from "./types";
import { kindLabel } from "./utils";

export type Tone = "up" | "down" | "muted";
export type SparkColor = "emerald" | "rose" | "blue" | "amber" | "violet";

/**
 * - `measured`: read straight from stored fields / disk checks (exact).
 * - `derived`: computed from the resolved relation graph (depends on how
 *   complete the relations are).
 */
export type Reliability = "measured" | "derived";

/** The StatCard-facing view a spec produces from the metrics payload. */
export interface MetricCardView {
  value: string | number;
  valueKind?: "metric" | "title";
  sub?: string;
  delta?: string;
  tone?: Tone;
  spark?: number[];
  sparkColor?: SparkColor;
  /** reliability tooltip, resolved from the spec's `reliability` */
  title: string;
}

export type MetricTFn = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

export interface MetricRenderCtx {
  /** format an epoch-ms timestamp into a relative label */
  relativeTime: (ts: number) => string;
  t: MetricTFn;
  locale?: Locale;
}

export interface MetricCardSpec {
  id: string;
  labelKey: MessageKey;
  icon: IconName;
  reliability: Reliability;
  render: (m: PackageMetrics, ctx: MetricRenderCtx) => MetricCardView;
}

export function formatBreakdown(items: KindCount[], locale?: Locale): string {
  return items.map((k) => `${kindLabel(k.kind, locale)}${k.count}`).join(" · ");
}

function withNote(
  reliability: Reliability,
  view: Omit<MetricCardView, "title">,
  t: MetricTFn,
): MetricCardView {
  return {
    ...view,
    title: t(reliability === "measured" ? "metric.measured" : "metric.derived"),
  };
}

/** The five cards in the pulse header, left → right. */
export const HEADER_CARDS: MetricCardSpec[] = [
  {
    id: "total",
    labelKey: "cockpit.totalAssets",
    icon: "layers",
    reliability: "measured",
    render: (m, ctx) =>
      withNote(
        "measured",
        {
          value: m.total.toLocaleString(),
          spark: m.growth,
          sparkColor: "blue",
          sub: formatBreakdown(m.kindBreakdown, ctx.locale) || ctx.t("metric.noAssets"),
        },
        ctx.t,
      ),
  },
  {
    id: "completion",
    labelKey: "cockpit.completion",
    icon: "check",
    reliability: "measured",
    render: (m, ctx) =>
      withNote(
        "measured",
        {
          value: `${m.completion}%`,
          sub: ctx.t("metric.finalsOf", { finals: m.finals, total: m.total }),
        },
        ctx.t,
      ),
  },
  {
    id: "relations",
    labelKey: "cockpit.relations",
    icon: "graph",
    reliability: "derived",
    render: (m, ctx) =>
      withNote(
        "derived",
        {
          value: m.relations.toLocaleString(),
          sub: ctx.t("metric.avgDegree", { value: m.avgDegree.toFixed(1) }),
        },
        ctx.t,
      ),
  },
];

/** The two stat-style hook cards below the graph (the third is a custom strip). */
export const HOOK_CARDS: MetricCardSpec[] = [
  {
    id: "pending",
    labelKey: "metric.pending",
    icon: "alert",
    reliability: "measured",
    render: (m, ctx) => {
      const { pendingCount, pendingBreakdown: b } = m.hooks;
      return withNote(
        "measured",
        {
          value: pendingCount,
          tone: pendingCount > 0 ? "down" : "muted",
          sub:
            pendingCount > 0
              ? ctx.t("metric.pendingBreakdown", {
                  broken: b.broken,
                  draft: b.draft,
                  candidate: b.candidate,
                })
              : ctx.t("metric.allClear"),
        },
        ctx.t,
      );
    },
  },
  {
    id: "orphan",
    labelKey: "metric.orphans",
    icon: "diamond",
    reliability: "derived",
    render: (m, ctx) => {
      const { orphanCount, orphanBreakdown } = m.hooks;
      return withNote(
        "derived",
        {
          value: orphanCount,
          tone: orphanCount > 0 ? "muted" : "up",
          sub:
            orphanCount > 0
              ? formatBreakdown(orphanBreakdown, ctx.locale)
              : ctx.t("metric.coverageComplete"),
        },
        ctx.t,
      );
    },
  },
];
