import { useEffect, useMemo, useState } from "react";
import { getPackageMetrics } from "../shared/api";
import type { DisplayEdge } from "../shared/graph";
import { HEADER_CARDS } from "../shared/metricSpec";
import type {
  ArtifactStatus,
  ArtifactView,
  Identity,
  PackageDetail,
  PackageMetrics,
  RelationKind,
} from "../shared/types";
import { useI18n } from "../shared/i18n";
import type { Locale } from "../shared/i18n";
import { translate, type MessageKey } from "../shared/i18n/catalog";
import { AssetOpsPanel } from "./AssetOpsPanel";
import { RelationshipMap } from "./RelationshipMap";
import { StatCard } from "./StatCard";
import { InlineRename } from "./InlineRename";

interface CockpitProps {
  detail: PackageDetail;
  edges: DisplayEdge[];
  selectedArtifact: ArtifactView | null;
  onSelectArtifact: (id: string) => void;
  onStatusChange: (artifact: ArtifactView, status: ArtifactStatus) => void;
  statusUpdating: boolean;
  metaUpdating?: boolean;
  relationUpdating?: boolean;
  onOpenFile: (artifact: ArtifactView) => void;
  onRevealInFinder: (artifact: ArtifactView) => void;
  onRelocate: (artifact: ArtifactView) => void;
  relocating: boolean;
  onSaveMeta?: (
    artifact: ArtifactView,
    meta: { role: string; summary: string; tags: string[] },
  ) => void;
  onAddRelation?: (from: string, to: string, kind: RelationKind) => void;
  onRemoveRelation?: (relationId: string) => void;
  onUpdateRelationKind?: (relationId: string, kind: RelationKind) => void;
  onSetWork?: (workId: string, include: boolean) => void;
  onRename?: (artifact: ArtifactView, displayName: string) => void;
  onRenamePackage?: (title: string) => void;
  onCreateWork?: (title: string) => void;
  onRenameWork?: (workId: string, title: string) => void;
  onDeleteWork?: (workId: string) => void;
  onMergeIdentity?: (keepId: string, absorbId: string) => void;
  onSplitIdentity?: (
    identityId: string,
    artifactIds: string[],
    newDisplayName: string,
  ) => void;
  onSetIdentityHead?: (identityId: string, headVersionId: string) => void;
  onAcceptSuggestion?: (
    from: string,
    to: string,
    kind: RelationKind,
    label?: string | null,
  ) => void;
  onRejectSuggestion?: (from: string, to: string) => void;
  onMoveToTrash?: (artifact: ArtifactView) => void;
  onDetailUpdated?: (detail: PackageDetail) => void;
}

export function Cockpit({
  detail,
  edges,
  selectedArtifact,
  onSelectArtifact,
  onStatusChange,
  statusUpdating,
  metaUpdating,
  relationUpdating,
  onOpenFile,
  onRevealInFinder,
  onRelocate,
  relocating,
  onSaveMeta,
  onAddRelation,
  onRemoveRelation,
  onUpdateRelationKind,
  onSetWork,
  onRename,
  onRenamePackage,
  onCreateWork,
  onRenameWork,
  onDeleteWork,
  onMergeIdentity,
  onSplitIdentity,
  onSetIdentityHead,
  onAcceptSuggestion,
  onRejectSuggestion,
  onMoveToTrash,
  onDetailUpdated,
}: CockpitProps) {
  const { artifacts } = detail;

  // Health metrics are computed by the backend (see src-tauri/src/metrics.rs);
  // the cockpit only renders them. Refetch whenever the detail changes (import,
  // status edit, relocate) so numbers stay in sync.
  const [metrics, setMetrics] = useState<PackageMetrics | null>(null);

  useEffect(() => {
    let alive = true;
    getPackageMetrics(detail.package.id)
      .then((m) => {
        if (alive) setMetrics(m);
      })
      .catch(() => {
        if (alive) setMetrics(null);
      });
    return () => {
      alive = false;
    };
  }, [detail]);

  const centerId =
    selectedArtifact?.id ??
    metrics?.topConnected[0]?.artifactId ??
    null;

  // Default-select the graph's center node so the Focus Console is never empty.
  // Once something is selected this is a no-op, so it won't fight manual clicks.
  useEffect(() => {
    if (!selectedArtifact && centerId) {
      onSelectArtifact(centerId);
    }
  }, [selectedArtifact, centerId, onSelectArtifact]);

  return (
    <div className="cockpit">
      <PulseHeader detail={detail} metrics={metrics} onRenamePackage={onRenamePackage} />

      <div className="cockpit-body">
        <div className="cockpit-main">
          <section className="cockpit-canvas">
            <RelationshipMap
              artifacts={artifacts}
              edges={edges}
              centerId={centerId}
              onSelect={onSelectArtifact}
            />
          </section>
        </div>

        <FocusConsole
          detail={detail}
          edges={edges}
          artifact={selectedArtifact}
          onSelectArtifact={onSelectArtifact}
          onStatusChange={onStatusChange}
          statusUpdating={statusUpdating}
          metaUpdating={metaUpdating}
          relationUpdating={relationUpdating}
          onOpenFile={onOpenFile}
          onRevealInFinder={onRevealInFinder}
          onRelocate={onRelocate}
          relocating={relocating}
          onSaveMeta={onSaveMeta}
          onAddRelation={onAddRelation}
          onRemoveRelation={onRemoveRelation}
          onUpdateRelationKind={onUpdateRelationKind}
          onSetWork={onSetWork}
          onRename={onRename}
          onCreateWork={onCreateWork}
          onRenameWork={onRenameWork}
          onDeleteWork={onDeleteWork}
          onMergeIdentity={onMergeIdentity}
          onSplitIdentity={onSplitIdentity}
          onSetIdentityHead={onSetIdentityHead}
          onAcceptSuggestion={onAcceptSuggestion}
          onRejectSuggestion={onRejectSuggestion}
          onMoveToTrash={onMoveToTrash}
          onDetailUpdated={onDetailUpdated}
        />
      </div>
    </div>
  );
}

function PulseHeader({
  detail,
  metrics,
  onRenamePackage,
}: {
  detail: PackageDetail;
  metrics: PackageMetrics | null;
  onRenamePackage?: (title: string) => void;
}) {
  const { t, locale } = useI18n();
  const statusMeta = packageStatusMeta(detail, t);
  const relTime = (ts: number) => relativeTime(ts, locale);

  return (
    <header className="pulse-header">
      <div className="pulse-identity">
        <div className="pulse-title-row">
          {onRenamePackage ? (
            <h1>
              <InlineRename
                value={detail.package.title}
                title={t("app.renameProject")}
                onCommit={(title) => onRenamePackage(title)}
                className="inline-rename-trigger pulse-title-rename"
                inputClassName="inline-rename-input pulse-title-input"
              />
            </h1>
          ) : (
            <h1>{detail.package.title}</h1>
          )}
          <span className={`pulse-status ${statusMeta.tone}`}>
            <i className="pulse-dot" />
            {statusMeta.label}
          </span>
        </div>
        <p className="pulse-summary">
          {detail.package.summary ?? detail.package.domain ?? t("cockpit.defaultSummary")}
        </p>
      </div>

      <div className="pulse-metrics">
        {HEADER_CARDS.map((spec) => {
          const view = metrics
            ? spec.render(metrics, { relativeTime: relTime, t, locale })
            : null;
          const hintKey = (
            {
              total: "cockpit.totalAssets.hint",
              completion: "cockpit.completion.hint",
              relations: "cockpit.relations.hint",
            } as const
          )[spec.id as "total" | "completion" | "relations"];
          const hint = hintKey ? t(hintKey) : "";
          const title = [hint, view?.title].filter(Boolean).join(" · ");
          return (
            <StatCard
              key={spec.id}
              icon={spec.icon}
              label={t(spec.labelKey)}
              value={view?.value ?? "—"}
              valueKind={view?.valueKind}
              sub={view?.sub}
              delta={view?.delta}
              tone={view?.tone}
              spark={view?.spark}
              sparkColor={view?.sparkColor}
              title={title || undefined}
            />
          );
        })}
      </div>
    </header>
  );
}

function FocusConsole({
  detail,
  edges,
  artifact,
  onSelectArtifact,
  onStatusChange,
  statusUpdating,
  metaUpdating,
  relationUpdating,
  onOpenFile,
  onRevealInFinder,
  onRelocate,
  relocating,
  onSaveMeta,
  onAddRelation,
  onRemoveRelation,
  onUpdateRelationKind,
  onSetWork,
  onRename,
  onCreateWork,
  onRenameWork,
  onDeleteWork,
  onMergeIdentity,
  onSplitIdentity,
  onSetIdentityHead,
  onAcceptSuggestion,
  onRejectSuggestion,
  onMoveToTrash,
  onDetailUpdated,
}: {
  detail: PackageDetail;
  edges: DisplayEdge[];
  artifact: ArtifactView | null;
  onSelectArtifact: (id: string) => void;
  onStatusChange: (artifact: ArtifactView, status: ArtifactStatus) => void;
  statusUpdating: boolean;
  metaUpdating?: boolean;
  relationUpdating?: boolean;
  onOpenFile: (artifact: ArtifactView) => void;
  onRevealInFinder: (artifact: ArtifactView) => void;
  onRelocate: (artifact: ArtifactView) => void;
  relocating: boolean;
  onSaveMeta?: (
    artifact: ArtifactView,
    meta: { role: string; summary: string; tags: string[] },
  ) => void;
  onAddRelation?: (from: string, to: string, kind: RelationKind) => void;
  onRemoveRelation?: (relationId: string) => void;
  onUpdateRelationKind?: (relationId: string, kind: RelationKind) => void;
  onSetWork?: (workId: string, include: boolean) => void;
  onRename?: (artifact: ArtifactView, displayName: string) => void;
  onCreateWork?: (name: string) => void;
  onRenameWork?: (workId: string, name: string) => void;
  onDeleteWork?: (workId: string) => void;
  onMergeIdentity?: (keepId: string, absorbId: string) => void;
  onSplitIdentity?: (
    identityId: string,
    artifactIds: string[],
    newDisplayName: string,
  ) => void;
  onSetIdentityHead?: (identityId: string, headVersionId: string) => void;
  onAcceptSuggestion?: (
    from: string,
    to: string,
    kind: RelationKind,
    label?: string | null,
  ) => void;
  onRejectSuggestion?: (from: string, to: string) => void;
  onMoveToTrash?: (artifact: ArtifactView) => void;
  onDetailUpdated?: (detail: PackageDetail) => void;
}) {
  const { t } = useI18n();
  const identity = useMemo<Identity | null>(
    () =>
      artifact
        ? detail.identities.find((i) => i.versionIds.includes(artifact.id)) ?? null
        : null,
    [detail.identities, artifact],
  );

  if (!artifact) {
    return (
      <aside className="focus-console empty">
        <p className="focus-empty-hint">{t("cockpit.emptyHint")}</p>
      </aside>
    );
  }

  return (
    <aside className="focus-console">
      <div className="focus-console-body">
        <AssetOpsPanel
          artifact={artifact}
          edges={edges}
          artifacts={detail.artifacts}
          works={detail.works}
          packageTitle={detail.package.title}
          tone="light"
          packageId={detail.package.id}
          statusUpdating={statusUpdating}
          relocating={relocating}
          metaUpdating={metaUpdating}
          relationUpdating={relationUpdating}
          onStatusChange={onStatusChange}
          onOpenFile={onOpenFile}
          onRevealInFinder={onRevealInFinder}
          onRelocate={onRelocate}
          onSelectArtifact={onSelectArtifact}
          onSaveMeta={onSaveMeta}
          onAddRelation={onAddRelation}
          onRemoveRelation={onRemoveRelation}
          onUpdateRelationKind={onUpdateRelationKind}
          onSetWork={onSetWork}
          onRename={onRename}
          onCreateWork={onCreateWork}
          onRenameWork={onRenameWork}
          onDeleteWork={onDeleteWork}
          identity={identity}
          identities={detail.identities}
          onMergeIdentity={onMergeIdentity}
          onSplitIdentity={onSplitIdentity}
          onSetIdentityHead={onSetIdentityHead}
          onAcceptSuggestion={onAcceptSuggestion}
          onRejectSuggestion={onRejectSuggestion}
          onMoveToTrash={onMoveToTrash}
          onDetailUpdated={onDetailUpdated}
          showPreview
          showTags={false}
        />
      </div>
    </aside>
  );
}

function packageStatusMeta(
  detail: PackageDetail,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): { label: string; tone: string } {
  const total = detail.artifacts.length;
  const finals = detail.artifacts.filter((a) => a.status === "final").length;
  if (total > 0 && finals === total) return { label: t("cockpit.delivered"), tone: "green" };
  if (finals > 0) return { label: t("cockpit.inProgress"), tone: "blue" };
  return { label: t("cockpit.needsWork"), tone: "amber" };
}

function relativeTime(ts: number, locale: Locale): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return translate(locale, "cockpit.justNow");
  if (min < 60) return translate(locale, "cockpit.minutesAgo", { count: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) {
    const time = `${new Date(ts).getHours()}:${String(new Date(ts).getMinutes()).padStart(2, "0")}`;
    return translate(locale, "cockpit.todayAt", { time });
  }
  const days = Math.floor(hours / 24);
  if (days < 30) return translate(locale, "cockpit.daysAgo", { count: days });
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")}`;
}
