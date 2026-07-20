import type { DisplayEdge } from "../shared/graph";
import type {
  ArtifactStatus,
  ArtifactView,
  PackageDetail,
  RelationKind,
} from "../shared/types";
import { useI18n } from "../shared/i18n";
import { kindLabel, statusLabel } from "../shared/utils";
import { AssetOpsPanel } from "./AssetOpsPanel";

const STATUS_OPTIONS: ArtifactStatus[] = ["draft", "candidate", "final"];

interface InspectorProps {
  detail: PackageDetail | null;
  artifact: ArtifactView | null;
  edges: DisplayEdge[];
  onRelocate?: (artifact: ArtifactView) => void;
  relocating?: boolean;
  onStatusChange?: (artifact: ArtifactView, status: ArtifactStatus) => void;
  statusUpdating?: boolean;
  metaUpdating?: boolean;
  relationUpdating?: boolean;
  onOpenFile?: (artifact: ArtifactView) => void;
  onRevealInFinder?: (artifact: ArtifactView) => void;
  onSelectArtifact?: (id: string) => void;
  onSaveMeta?: (
    artifact: ArtifactView,
    meta: { role: string; summary: string; tags: string[] },
  ) => void;
  onAddRelation?: (from: string, to: string, kind: RelationKind) => void;
  onRemoveRelation?: (relationId: string) => void;
  onUpdateRelationKind?: (
    relationId: string,
    kind: RelationKind,
    label?: string | null,
  ) => void;
  onSetWork?: (workId: string, include: boolean) => void;
  onRename?: (artifact: ArtifactView, displayName: string) => void;
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
  readOnly?: boolean;
}

export function Inspector({
  detail,
  artifact,
  edges,
  onRelocate,
  relocating,
  onStatusChange,
  statusUpdating,
  metaUpdating,
  relationUpdating,
  onOpenFile,
  onRevealInFinder,
  onSelectArtifact,
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
  readOnly = false,
}: InspectorProps) {
  const { t, locale } = useI18n();

  if (!detail) {
    return (
      <aside className="inspector empty">
        <p>{t("inspector.emptyPick")}</p>
      </aside>
    );
  }

  if (!artifact) {
    return (
      <aside className="inspector empty">
        <h3>{detail.package.title}</h3>
        <p className="muted">{detail.package.summary ?? t("inspector.noSummary")}</p>
        <dl className="meta-grid">
          <dt>{t("inspector.artifacts")}</dt>
          <dd>{detail.package.stats.artifactCount}</dd>
          <dt>{t("inspector.finals")}</dt>
          <dd>{detail.package.stats.finalCount}</dd>
          <dt>{t("inspector.broken")}</dt>
          <dd>{detail.package.stats.brokenLinkCount}</dd>
          <dt>{t("inspector.relations")}</dt>
          <dd>
            {edges.length}
            {edges.some((r) => r.inferred) && (
              <span className="muted small">{t("inspector.inferred")}</span>
            )}
          </dd>
        </dl>
      </aside>
    );
  }

  const canOps =
    !!onStatusChange && !!onOpenFile && !!onRevealInFinder && !!onRelocate;
  const identity =
    detail.identities.find((item) => item.versionIds.includes(artifact.id)) ??
    null;

  return (
    <aside className="inspector">
      {canOps ? (
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
          readOnly={readOnly}
        />
      ) : (
        <>
          <header className="inspector-header">
            <h3>{artifact.displayName}</h3>
            <div className="chip-row">
              <span className={`chip status-${artifact.status}`}>
                {statusLabel(artifact.status, locale)}
              </span>
              <span className="chip">{kindLabel(artifact.kind, locale)}</span>
            </div>
          </header>
          <section className="inspector-section">
            <h4>{t("inspector.finalStatus")}</h4>
            <div className="status-row">
              {STATUS_OPTIONS.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={
                    artifact.status === status
                      ? `status-btn active status-${status}`
                      : "status-btn"
                  }
                  disabled={statusUpdating || artifact.status === status}
                  onClick={() => onStatusChange?.(artifact, status)}
                >
                  {statusLabel(status, locale)}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {artifact.provenance && (
        <section className="inspector-section">
          <h4>{t("inspector.source")}</h4>
          <dl className="meta-grid">
            {artifact.provenance.tool && (
              <>
                <dt>{t("inspector.tool")}</dt>
                <dd>{artifact.provenance.tool}</dd>
              </>
            )}
            {artifact.provenance.sessionLabel && (
              <>
                <dt>{t("inspector.session")}</dt>
                <dd>{artifact.provenance.sessionLabel}</dd>
              </>
            )}
          </dl>
        </section>
      )}
    </aside>
  );
}
