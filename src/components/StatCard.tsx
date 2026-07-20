import { SparkAreaChart } from "@tremor/react";
import { Icon, type IconName } from "./icons";

export type SparkColor = "emerald" | "rose" | "blue" | "amber" | "violet";
export type Tone = "up" | "down" | "muted";

export interface StatCardProps {
  /** small leading icon before the label */
  icon?: IconName;
  label: string;
  /** main figure (big number) or a medium text (dates) */
  value: string | number;
  valueKind?: "metric" | "title";
  /** short delta text, e.g. "27%" */
  delta?: string;
  /** color of the delta text / arrow */
  tone?: Tone;
  /** show a leading up arrow before the delta text */
  showArrow?: boolean;
  /** render only a trend arrow (no text) */
  arrowOnly?: boolean;
  /** sparkline series (raw numbers) */
  spark?: number[];
  sparkColor?: SparkColor;
  /** subtext line under the value */
  sub?: string;
  /** fill parent height and pin the subtext to the bottom (for equal-height rows) */
  fill?: boolean;
  /** hover tooltip, e.g. a reliability note */
  title?: string;
  className?: string;
}

function toSpark(series: number[]): { i: number; v: number }[] {
  return series.map((v, i) => ({ i, v }));
}

function toneClass(tone: Tone): string {
  if (tone === "up") return "text-emerald-600";
  if (tone === "down") return "text-rose-500";
  return "text-gray-400";
}

/**
 * The single card standard for the cockpit.
 * Card shell uses plain Tailwind utilities (full pixel control);
 * the sparkline uses Tremor's SparkAreaChart.
 *
 * Sizes are tuned to the prototype: card ~64px tall, number ~15px, label ~11px.
 */
export function StatCard({
  icon,
  label,
  value,
  valueKind = "metric",
  delta,
  tone = "muted",
  showArrow = false,
  arrowOnly = false,
  spark,
  sparkColor = "emerald",
  sub,
  fill = false,
  title,
  className,
}: StatCardProps) {
  const hasSpark = !!spark && spark.length > 1;
  const tCls = toneClass(tone);

  const deltaText = delta ? (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold leading-none ${tCls}`}
    >
      {showArrow && <Icon name="trendup" size={10} />}
      {delta}
    </span>
  ) : null;

  return (
    <div
      title={title}
      className={`flex flex-col rounded-lg bg-white px-2.5 py-2 shadow-sm ring-1 ring-gray-200/70 ${fill ? "h-full" : ""} ${className ?? ""}`}
    >
      <div className="flex items-center gap-1">
        {icon && (
          <span className="shrink-0 text-gray-400">
            <Icon name={icon} size={11} />
          </span>
        )}
        <span className="truncate text-[11px] leading-none text-gray-500">
          {label}
        </span>
        {hasSpark && deltaText && <span className="ml-auto">{deltaText}</span>}
      </div>

      <div className={`mt-1.5 flex justify-between gap-2 ${fill ? "items-center" : "items-baseline"}`}>
        <span
          className={`font-semibold leading-none text-gray-900 ${
            valueKind === "title" ? "text-[13px]" : "text-[15px]"
          }`}
        >
          {value}
        </span>

        {hasSpark ? (
          <div
            className={fill ? "ml-2 h-7 flex-1 max-w-[150px]" : "shrink-0"}
            style={fill ? undefined : { width: 48, height: 20 }}
          >
            <SparkAreaChart
              data={toSpark(spark!)}
              index="i"
              categories={["v"]}
              colors={[sparkColor]}
              curveType="monotone"
              autoMinValue
              className="h-full w-full"
            />
          </div>
        ) : arrowOnly ? (
          <span className={`${tCls} shrink-0`}>
            <Icon name="trendup" size={12} />
          </span>
        ) : (
          deltaText
        )}
      </div>

      {sub && (
        <div
          className={`truncate text-[10px] leading-none text-gray-400 ${
            fill ? "mt-auto pt-1.5" : "mt-1"
          }`}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
