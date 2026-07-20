import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import { useI18n, type MessageKey } from "../shared/i18n";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const RELATIONS: {
  kind: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
}[] = [
  {
    kind: "part_of",
    labelKey: "relation.part_of",
    hintKey: "relation.part_of.hint",
  },
  { kind: "uses", labelKey: "relation.uses", hintKey: "relation.uses.hint" },
  {
    kind: "version",
    labelKey: "relation.version",
    hintKey: "relation.version.hint",
  },
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

interface GraphRelationBarProps {
  activeKinds: string[];
  counts: Record<string, number>;
  colors: GraphAppearanceSettings["edges"];
  onChange: (next: string[]) => void;
}

export function GraphRelationBar({
  activeKinds,
  counts,
  colors,
  onChange,
}: GraphRelationBarProps) {
  const { t } = useI18n();
  const allKinds = RELATIONS.map(({ kind }) => kind);
  const allActive = allKinds.every((kind) => activeKinds.includes(kind));
  const total = RELATIONS.reduce((sum, { kind }) => sum + (counts[kind] ?? 0), 0);

  const toggle = (kind: string) => {
    const active = activeKinds.includes(kind);
    if (allActive) {
      onChange([kind]);
      return;
    }
    if (active && activeKinds.length === 1) {
      onChange(allKinds);
      return;
    }
    onChange(
      active
        ? activeKinds.filter((item) => item !== kind)
        : [...activeKinds, kind],
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="graph-relation-bar"
        role="toolbar"
        aria-label={t("graph.relationFilter")}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={`graph-relation-all${allActive ? " active" : ""}`}
              aria-pressed={allActive}
              aria-label={t("graph.allRelations.hint")}
              onClick={() => onChange(allKinds)}
            >
              <span>{t("graph.allRelations")}</span>
              <strong>{total.toLocaleString()}</strong>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[240px] text-left leading-snug">
            {t("relation.countHint", {
              label: t("graph.allRelations.hint"),
              count: total.toLocaleString(),
            })}
          </TooltipContent>
        </Tooltip>
        {RELATIONS.map(({ kind, labelKey, hintKey }) => {
          const active = !allActive && activeKinds.includes(kind);
          const count = counts[kind] ?? 0;
          const hint = t("relation.countHint", {
            label: t(hintKey),
            count: count.toLocaleString(),
          });
          return (
            <Tooltip key={kind}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={`graph-relation-chip${active ? " active" : ""}`}
                  aria-pressed={active}
                  aria-label={hint}
                  onClick={() => toggle(kind)}
                >
                  <i style={{ background: colors[kind as keyof typeof colors] }} />
                  <span>{t(labelKey)}</span>
                  <em>{count.toLocaleString()}</em>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[240px] text-left leading-snug">
                {hint}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
