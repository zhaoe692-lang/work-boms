/**
 * Selected-artifact inspector sheet.
 * Header → preview → meta → tabs (详情/上下游/引用/版本) → quick actions.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { DisplayEdge } from "../shared/graph";
import type {
  ArtifactStatus,
  ArtifactView,
  Identity,
  PackageDetail,
  RelationKind,
  Work,
} from "../shared/types";
import { useI18n, type MessageKey } from "../shared/i18n";
import { kindLabel, statusLabel } from "../shared/utils";
import {
  createInspirationBoard,
  getInspirationBoard,
  listInspirationBoards,
  saveInspirationBoard,
} from "../shared/api";
import { ArtifactPreview } from "./ArtifactPreview";
import { assetVisual, mediaSrcFor } from "./assetVisual";
import { Icon } from "./icons";
import { InlineRename } from "./InlineRename";
import { ResizablePreviewFloat } from "./ResizablePreviewFloat";
import { ENABLE_INSPIRATION_BOARD } from "../shared/featureFlags";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STATUS_OPTIONS: ArtifactStatus[] = ["draft", "candidate", "final"];
const RELATION_KIND_KEYS: RelationKind[] = [
  "part_of",
  "uses",
  "references",
  "derived_from",
  "pairs_with",
];

type SheetTab = "detail" | "up" | "down" | "refs" | "versions";

function HintTip({
  label,
  children,
  side = "bottom",
}: {
  label: string;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align="center" className="max-w-[240px] text-left leading-snug">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export interface AssetOpsPanelProps {
  artifact: ArtifactView;
  edges: DisplayEdge[];
  artifacts?: ArtifactView[];
  works?: Work[];
  /** Package title for meta row「所属项目」. */
  packageTitle?: string;
  tone?: "dark" | "light";
  compact?: boolean;
  statusUpdating?: boolean;
  relocating?: boolean;
  metaUpdating?: boolean;
  relationUpdating?: boolean;
  onStatusChange: (artifact: ArtifactView, status: ArtifactStatus) => void;
  onOpenFile: (artifact: ArtifactView) => void;
  onRevealInFinder: (artifact: ArtifactView) => void;
  onRelocate: (artifact: ArtifactView) => void;
  onSelectArtifact?: (id: string) => void;
  onOpenDetail?: (id: string) => void;
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
  onMoveToTrash?: (artifact: ArtifactView) => void;
  onCreateWork?: (title: string) => void;
  onRenameWork?: (workId: string, title: string) => void;
  onDeleteWork?: (workId: string) => void;
  onDetailUpdated?: (detail: PackageDetail) => void;
  identity?: Identity | null;
  identities?: Identity[];
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
  showFavorite?: boolean;
  showRelations?: boolean;
  showCuration?: boolean;
  showPreview?: boolean;
  showTags?: boolean;
  showAdjacency?: boolean;
  packageId?: string | null;
  hideIdentity?: boolean;
  readOnly?: boolean;
}

export function AssetOpsPanel({
  artifact,
  edges,
  artifacts = [],
  works = [],
  packageTitle,
  tone = "light",
  compact = false,
  statusUpdating = false,
  relocating = false,
  metaUpdating = false,
  relationUpdating = false,
  onStatusChange,
  onOpenFile,
  onRevealInFinder,
  onRelocate,
  onSelectArtifact,
  onOpenDetail,
  onSaveMeta,
  onAddRelation,
  onRemoveRelation,
  onUpdateRelationKind,
  onRename,
  onMoveToTrash,
  onRenameWork,
  onDetailUpdated,
  identity = null,
  onSetIdentityHead,
  onAcceptSuggestion,
  onRejectSuggestion,
  showPreview = true,
  showTags = true,
  packageId = null,
  readOnly = false,
}: AssetOpsPanelProps) {
  const { t, locale } = useI18n();
  const relationKinds = useMemo(
    () =>
      RELATION_KIND_KEYS.map((kind) => {
        const labelKey = (
          {
            part_of: "relation.part_of",
            uses: "relation.uses",
            references: "relation.references",
            derived_from: "relation.derived_from",
            pairs_with: "relation.pairs_with",
          } as const
        )[kind];
        const hintKey = (
          {
            part_of: "relation.part_of.hint",
            uses: "relation.uses.hint",
            references: "relation.references.hint",
            derived_from: "relation.derived_from.hint",
            pairs_with: "relation.pairs_with.hint",
          } as const
        )[kind];
        return {
          kind,
          label: t(labelKey),
          hint: t(hintKey),
        };
      }),
    [t],
  );
  const [summary, setSummary] = useState(artifact.summary ?? "");
  const [tags, setTags] = useState<string[]>(artifact.tags ?? []);
  const [tab, setTab] = useState<SheetTab>("detail");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [relTo, setRelTo] = useState("");
  const [relKind, setRelKind] = useState<RelationKind>("references");
  const [inspireBusy, setInspireBusy] = useState(false);
  const [inspireHint, setInspireHint] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSummary(artifact.summary ?? "");
    setTags(artifact.tags ?? []);
    setTab("detail");
    setPreviewOpen(false);
    setMoreOpen(false);
    setRelTo("");
    setRelKind("references");
    setInspireHint(null);
  }, [artifact.id, artifact.summary, artifact.tags]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  const nameOf = (id: string) =>
    artifacts.find((a) => a.id === id)?.displayName ?? shortId(id);

  const upstream = useMemo(
    () => edges.filter((r) => r.to === artifact.id),
    [edges, artifact.id],
  );
  const downstream = useMemo(
    () => edges.filter((r) => r.from === artifact.id),
    [edges, artifact.id],
  );
  const references = useMemo(
    () =>
      edges.filter(
        (r) =>
          (r.from === artifact.id || r.to === artifact.id) &&
          r.kind === "references",
      ),
    [edges, artifact.id],
  );

  const versionIds = identity?.versionIds ?? [artifact.id];
  const versionIndex = Math.max(0, versionIds.indexOf(artifact.id));
  const versionLabel = `v${versionIndex + 1}`;

  const work = works.find((w) => w.id === artifact.workId);
  const chapter = work?.title ?? (artifact.workId ? artifact.workId : "—");

  const typeLabel = artifact.role?.trim() || kindLabel(artifact.kind, locale);
  const typeCode = kindCode(artifact);
  const visual = assetVisual(artifact, locale);
  const mediaSrc = mediaSrcFor(artifact);
  const others = artifacts.filter((a) => a.id !== artifact.id);

  const saveMeta = () => {
    onSaveMeta?.(artifact, {
      role: artifact.role ?? "",
      summary: summary.trim(),
      tags: tags.map((t) => t.trim()).filter(Boolean),
    });
  };

  const addTag = () => {
    if (readOnly || !onSaveMeta) return;
    const next = window.prompt(t("asset.addTag"))?.trim();
    if (!next || tags.includes(next)) return;
    const merged = [...tags, next];
    setTags(merged);
    onSaveMeta(artifact, {
      role: artifact.role ?? "",
      summary: summary.trim(),
      tags: merged,
    });
  };

  const removeTag = (tag: string) => {
    if (readOnly || !onSaveMeta) return;
    const merged = tags.filter((t) => t !== tag);
    setTags(merged);
    onSaveMeta(artifact, {
      role: artifact.role ?? "",
      summary: summary.trim(),
      tags: merged,
    });
  };

  const openDetail = () => {
    if (onOpenDetail) onOpenDetail(artifact.id);
    else setPreviewOpen(true);
  };

  const startNewReference = () => {
    setTab("refs");
    setMoreOpen(false);
  };

  const showVersions = () => {
    setTab("versions");
    setMoreOpen(false);
  };

  const addToInspiration = async () => {
    if (!packageId || inspireBusy) return;
    setInspireBusy(true);
    setInspireHint(null);
    try {
      let boards = await listInspirationBoards(packageId);
      let boardId = boards[0]?.id;
      if (!boardId) {
        const created = await createInspirationBoard(packageId, t("asset.unnamedBoard"));
        boardId = created.id;
        boards = await listInspirationBoards(packageId);
      }
      const board = await getInspirationBoard(boardId);
      const kind =
        artifact.kind === "image" || artifact.kind === "video"
          ? "image"
          : artifact.kind === "audio"
            ? "audio"
            : "link";
      const item = {
        id: `item-${Date.now().toString(36)}`,
        kind,
        title: artifact.displayName,
        note: artifact.summary ?? artifact.role ?? t("asset.inspireNote"),
        artifactPackageId: packageId,
        artifactId: artifact.id,
        x: 12 + (board.items.length % 5) * 8,
        y: 10 + Math.floor(board.items.length / 5) * 10,
        width: 22,
        height: 18,
        rotation: 0,
        zIndex: board.items.length + 1,
        color: kind === "audio" ? "violet" : kind === "image" ? "slate" : "white",
      };
      await saveInspirationBoard(
        { ...board, items: [...board.items, item] },
        board.version,
      );
      setInspireHint(
        t("asset.inspireAdded", {
          name:
            boards.find((b) => b.id === boardId)?.title ??
            t("asset.inspireBoardFallback"),
        }),
      );
    } catch (err) {
      setInspireHint(t("asset.inspireFail", { error: String(err) }));
    } finally {
      setInspireBusy(false);
    }
  };

  const onVersionPick = (vid: string) => {
    if (vid === artifact.id) return;
    onSelectArtifact?.(vid);
  };

  return (
    <div
      className={`asset-sheet asset-sheet-${tone}${compact ? " compact" : ""}`}
    >
      {/* 1. Header */}
      <header className="asset-sheet-head">
        <div className="asset-sheet-head-left">
          <span className={`asset-sheet-status status-${artifact.status}`}>
            <i className="asset-sheet-status-dot" />
            {statusLabel(artifact.status, locale)}
          </span>
          <span className="asset-sheet-code">{typeCode}</span>
        </div>
        <div className="asset-sheet-head-right">
          {versionIds.length > 1 ? (
            <label className="asset-sheet-ver">
              <span className="sr-only">{t("asset.version")}</span>
              <select
                value={artifact.id}
                onChange={(e) => onVersionPick(e.target.value)}
                aria-label={t("asset.switchVersion")}
              >
                {versionIds.map((vid, i) => (
                  <option key={vid} value={vid}>
                    v{i + 1}
                    {vid === identity?.headVersionId ? t("asset.headSuffix") : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="asset-sheet-ver-static">{versionLabel}</span>
          )}
          <div className="asset-sheet-more" ref={moreRef}>
            <button
              type="button"
              className="asset-sheet-icon-btn"
              aria-label={t("common.more")}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <Icon name="more" size={16} />
            </button>
            {moreOpen && (
              <div className="asset-sheet-menu" role="menu">
                {!readOnly &&
                  STATUS_OPTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="menuitem"
                      disabled={statusUpdating || artifact.status === s}
                      onClick={() => {
                        onStatusChange(artifact, s);
                        setMoreOpen(false);
                      }}
                    >
                      {t("asset.setAs", { status: statusLabel(s, locale) })}
                    </button>
                  ))}
                {artifact.reachable && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onOpenFile(artifact);
                        setMoreOpen(false);
                      }}
                    >
                      {t("asset.openFile")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onRevealInFinder(artifact);
                        setMoreOpen(false);
                      }}
                    >
                      {t("asset.reveal")}
                    </button>
                  </>
                )}
                {!artifact.reachable && !readOnly && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={relocating}
                    onClick={() => {
                      onRelocate(artifact);
                      setMoreOpen(false);
                    }}
                  >
                    {relocating ? t("asset.binding") : t("asset.fixBroken")}
                  </button>
                )}
                {onRename && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      // Focus the inline title editor on the next tick.
                      window.setTimeout(() => {
                        document
                          .querySelector<HTMLButtonElement>(".asset-sheet-title .inline-rename-trigger")
                          ?.click();
                      }, 0);
                    }}
                  >
                    {t("common.rename")}
                  </button>
                )}
                {!readOnly && onMoveToTrash && (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      onMoveToTrash(artifact);
                      setMoreOpen(false);
                    }}
                  >
                    {t("asset.moveToTrash")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {onRename ? (
        <h2
          className="asset-sheet-title"
          title={t("asset.renameTitle", { name: artifact.displayName })}
        >
          <InlineRename
            value={artifact.displayName}
            disabled={!!metaUpdating}
            onCommit={(next) => onRename(artifact, next)}
            className="inline-rename-trigger asset-sheet-title-rename"
            inputClassName="inline-rename-input asset-sheet-title-input"
          />
        </h2>
      ) : (
        <h2 className="asset-sheet-title" title={artifact.displayName}>
          {artifact.displayName}
        </h2>
      )}

      {/* 2. Preview */}
      {showPreview && (
        <button
          type="button"
          className="asset-sheet-preview"
          onClick={() => setPreviewOpen(true)}
        >
          <div
            className={`asset-sheet-preview-thumb kind-${artifact.kind}`}
            style={{ ["--preview-accent" as string]: visual.accent }}
          >
            {artifact.reachable && artifact.kind === "image" && mediaSrc ? (
              <img src={mediaSrc} alt="" />
            ) : artifact.reachable && artifact.kind === "video" && mediaSrc ? (
              <video src={mediaSrc} muted preload="metadata" />
            ) : (
              <span className="asset-sheet-preview-glyph">{visual.glyph}</span>
            )}
            <span className="asset-sheet-preview-cap">{t("asset.clickPreview")}</span>
          </div>
        </button>
      )}

      {/* 3. Metadata */}
      <dl className="asset-sheet-meta">
        <div>
          <dt>{t("asset.type")}</dt>
          <dd title={typeLabel}>{typeLabel}</dd>
        </div>
        <div>
          <dt>{t("asset.project")}</dt>
          <dd title={packageTitle}>{packageTitle || "—"}</dd>
        </div>
        <div>
          <dt>{t("asset.chapter")}</dt>
          <dd title={chapter}>
            {work && onRenameWork ? (
              <InlineRename
                value={work.title}
                disabled={!!metaUpdating}
                onCommit={(next) => onRenameWork(work.id, next.trim())}
                className="inline-rename-trigger asset-sheet-meta-rename"
                inputClassName="inline-rename-input asset-sheet-meta-input"
                placeholder={t("asset.chapterPlaceholder")}
              />
            ) : (
              chapter
            )}
          </dd>
        </div>
        <div>
          <dt>{t("asset.created")}</dt>
          <dd title={formatStamp(artifact.createdAt)}>
            {formatStamp(artifact.createdAt)}
          </dd>
        </div>
        <div>
          <dt>{t("asset.updated")}</dt>
          <dd title={formatStamp(artifact.updatedAt)}>
            {formatStamp(artifact.updatedAt)}
          </dd>
        </div>
      </dl>

      {/* 4. Tabs */}
      <TooltipProvider delayDuration={200}>
        <div className="asset-sheet-tabs" role="tablist" aria-label={t("asset.sectionsAria")}>
          {(
            [
              ["detail", "asset.tabDetail", "asset.tabDetail.hint", null],
              ["up", "asset.tabUp", "asset.tabUp.hint", upstream.length],
              ["down", "asset.tabDown", "asset.tabDown.hint", downstream.length],
              ["refs", "asset.tabRefs", "asset.tabRefs.hint", references.length],
              [
                "versions",
                "asset.tabVersions",
                "asset.tabVersions.hint",
                versionIds.length,
              ],
            ] as const satisfies ReadonlyArray<
              readonly [SheetTab, MessageKey, MessageKey, number | null]
            >
          ).map(([id, labelKey, hintKey, count]) => {
            const hint =
              count != null
                ? `${t(hintKey)} (${count.toLocaleString()})`
                : t(hintKey);
            return (
              <HintTip key={id} label={hint}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  aria-label={hint}
                  className={tab === id ? "active" : undefined}
                  onClick={() => setTab(id)}
                >
                  <span className="tab-label">{t(labelKey)}</span>
                  {count != null && <em>{count}</em>}
                </button>
              </HintTip>
            );
          })}
        </div>
      </TooltipProvider>

      <div className="asset-sheet-tab-body" role="tabpanel">
        {tab === "detail" && (
          <div className="asset-sheet-detail">
            <section>
              <h4>{t("asset.description")}</h4>
              {readOnly || !onSaveMeta ? (
                <p className="asset-sheet-desc">
                  {artifact.summary?.trim() || t("asset.noDescription")}
                </p>
              ) : (
                <>
                  <textarea
                    className="asset-sheet-textarea"
                    value={summary}
                    rows={compact ? 3 : 4}
                    placeholder={t("asset.summary")}
                    onChange={(e) => setSummary(e.target.value)}
                    onBlur={() => {
                      if ((artifact.summary ?? "") !== summary.trim()) saveMeta();
                    }}
                  />
                </>
              )}
            </section>
            {showTags && (
              <section>
                <h4>{t("asset.tags")}</h4>
                <div className="asset-sheet-tags">
                  {tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="asset-sheet-tag"
                      disabled={readOnly || !onSaveMeta}
                      title={readOnly ? tag : t("asset.clickRemove")}
                      onClick={() => removeTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                  {!readOnly && onSaveMeta && (
                    <button
                      type="button"
                      className="asset-sheet-tag add"
                      onClick={addTag}
                      aria-label={t("asset.addTagAria")}
                    >
                      +
                    </button>
                  )}
                  {tags.length === 0 && (readOnly || !onSaveMeta) && (
                    <span className="asset-sheet-empty">{t("asset.noTags")}</span>
                  )}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === "up" && (
          <RelationList
            edges={upstream}
            artifactId={artifact.id}
            nameOf={nameOf}
            onSelect={onSelectArtifact}
            empty={t("asset.noUpstream")}
            relationKinds={relationKinds}
            onUpdateKind={readOnly ? undefined : onUpdateRelationKind}
            onRemove={readOnly ? undefined : onRemoveRelation}
            onAccept={readOnly ? undefined : onAcceptSuggestion}
            onReject={readOnly ? undefined : onRejectSuggestion}
            busy={relationUpdating}
          />
        )}

        {tab === "down" && (
          <RelationList
            edges={downstream}
            artifactId={artifact.id}
            nameOf={nameOf}
            onSelect={onSelectArtifact}
            empty={t("asset.noDownstream")}
            relationKinds={relationKinds}
            onUpdateKind={readOnly ? undefined : onUpdateRelationKind}
            onRemove={readOnly ? undefined : onRemoveRelation}
            onAccept={readOnly ? undefined : onAcceptSuggestion}
            onReject={readOnly ? undefined : onRejectSuggestion}
            busy={relationUpdating}
          />
        )}

        {tab === "refs" && (
          <div className="asset-sheet-rel-pane">
            <RelationList
              edges={references}
              artifactId={artifact.id}
              nameOf={nameOf}
              onSelect={onSelectArtifact}
              empty={t("asset.noRefs")}
              relationKinds={relationKinds}
              onUpdateKind={readOnly ? undefined : onUpdateRelationKind}
              onRemove={readOnly ? undefined : onRemoveRelation}
              onAccept={readOnly ? undefined : onAcceptSuggestion}
              onReject={readOnly ? undefined : onRejectSuggestion}
              busy={relationUpdating}
            />
            {!readOnly && onAddRelation && others.length > 0 && (
              <div className="asset-sheet-add-rel">
                <select
                  className="asset-sheet-add-rel-target"
                  value={relTo}
                  onChange={(e) => setRelTo(e.target.value)}
                  aria-label={t("asset.refTarget")}
                >
                  <option value="">{t("asset.selectTarget")}</option>
                  {others.slice(0, 80).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}
                    </option>
                  ))}
                </select>
                <select
                  className="asset-sheet-rel-kind"
                  value={relKind}
                  onChange={(e) => setRelKind(e.target.value as RelationKind)}
                  aria-label={t("relation.kindAria")}
                  title={
                    relationKinds.find((k) => k.kind === relKind)?.hint ??
                    t("relation.kindAria")
                  }
                >
                  {relationKinds.map((k) => (
                    <option key={k.kind} value={k.kind} title={k.hint}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="asset-sheet-btn"
                  disabled={!relTo || relationUpdating}
                  onClick={() => {
                    if (!relTo) return;
                    onAddRelation(artifact.id, relTo, relKind);
                    setRelTo("");
                    setRelKind("references");
                  }}
                >
                  {t("asset.newRef")}
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "versions" && (
          <div className="asset-sheet-versions">
            <ul>
              {[...versionIds].reverse().map((vid, idx) => {
                const va = artifacts.find((a) => a.id === vid);
                const isHead = vid === identity?.headVersionId;
                const num = versionIds.length - idx;
                return (
                  <li key={vid}>
                    <button
                      type="button"
                      className={
                        vid === artifact.id
                          ? "asset-sheet-ver-row active"
                          : "asset-sheet-ver-row"
                      }
                      onClick={() => onSelectArtifact?.(vid)}
                    >
                      <span className="asset-sheet-ver-tag">v{num}</span>
                      <span className="asset-sheet-ver-body">
                        <strong>
                          {isHead
                            ? t("asset.currentHead")
                            : (va?.role ?? va?.displayName ?? t("asset.revision"))}
                        </strong>
                        <small>{va ? formatStamp(va.updatedAt) : ""}</small>
                      </span>
                    </button>
                    {!readOnly &&
                      identity &&
                      onSetIdentityHead &&
                      vid !== identity.headVersionId && (
                        <button
                          type="button"
                          className="asset-sheet-link"
                          disabled={metaUpdating}
                          onClick={() => onSetIdentityHead(identity.id, vid)}
                        >
                          {t("asset.setHead")}
                        </button>
                      )}
                  </li>
                );
              })}
            </ul>
            {!identity && (
              <p className="asset-sheet-empty">{t("asset.noIdentity")}</p>
            )}
          </div>
        )}
      </div>

      {inspireHint && <p className="asset-sheet-hint">{inspireHint}</p>}

      {/* 5. Quick actions */}
      <TooltipProvider delayDuration={200}>
        <footer className="asset-sheet-quick">
          <p className="asset-sheet-quick-label">{t("asset.quickActions")}</p>
          <div className="asset-sheet-quick-grid">
            <HintTip
              label={
                onOpenDetail ? t("asset.openDetail.full") : t("asset.previewAsset.full")
              }
            >
              <button type="button" onClick={openDetail}>
                <Icon name="open" size={18} />
                <span>
                  {onOpenDetail ? t("asset.openDetail") : t("asset.previewAsset")}
                </span>
              </button>
            </HintTip>
            <HintTip label={t("asset.newRef.full")}>
              <button
                type="button"
                disabled={readOnly || !onAddRelation}
                onClick={startNewReference}
              >
                <Icon name="plus" size={18} />
                <span>{t("asset.newRef")}</span>
              </button>
            </HintTip>
            <HintTip label={t("asset.viewVersions.full")}>
              <button type="button" onClick={showVersions}>
                <Icon name="layers" size={18} />
                <span>{t("asset.viewVersions")}</span>
              </button>
            </HintTip>
            {ENABLE_INSPIRATION_BOARD && (
              <HintTip
                label={
                  inspireBusy
                    ? t("asset.addingInspiration")
                    : t("asset.addInspiration.full")
                }
              >
                <button
                  type="button"
                  disabled={!packageId || inspireBusy}
                  onClick={() => void addToInspiration()}
                >
                  <Icon name="board" size={18} />
                  <span>
                    {inspireBusy
                      ? t("asset.addingInspiration")
                      : t("asset.addInspiration")}
                  </span>
                </button>
              </HintTip>
            )}
            <HintTip label={t("common.more")}>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-label={t("common.more")}
              >
                <Icon name="more" size={18} />
                <span>{t("common.more")}</span>
              </button>
            </HintTip>
          </div>
        </footer>
      </TooltipProvider>

      {previewOpen && (
        <div
          className="asset-ops-preview-backdrop"
          role="presentation"
          onClick={() => setPreviewOpen(false)}
        >
          <ResizablePreviewFloat
            className="asset-ops-preview-float"
            title={artifact.displayName}
            chip={<span className="chip">{kindLabel(artifact.kind, locale)}</span>}
            onClose={() => setPreviewOpen(false)}
          >
            <ArtifactPreview
              packageId={packageId}
              artifact={artifact}
              onDetailUpdated={onDetailUpdated}
            />
          </ResizablePreviewFloat>
        </div>
      )}
    </div>
  );
}

function RelationList({
  edges,
  artifactId,
  nameOf,
  onSelect,
  empty,
  relationKinds,
  onUpdateKind,
  onRemove,
  onAccept,
  onReject,
  busy,
}: {
  edges: DisplayEdge[];
  artifactId: string;
  nameOf: (id: string) => string;
  onSelect?: (id: string) => void;
  empty: string;
  relationKinds: { kind: RelationKind; label: string; hint: string }[];
  onUpdateKind?: (
    relationId: string,
    kind: RelationKind,
    label?: string | null,
  ) => void;
  onRemove?: (relationId: string) => void;
  onAccept?: (
    from: string,
    to: string,
    kind: RelationKind,
    label?: string | null,
  ) => void;
  onReject?: (from: string, to: string) => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  if (edges.length === 0) {
    return <p className="asset-sheet-empty">{empty}</p>;
  }
  return (
    <ul className="asset-sheet-rel-list">
      {edges.map((rel) => {
        const otherId = rel.from === artifactId ? rel.to : rel.from;
        const direction = rel.from === artifactId ? "→" : "←";
        return (
          <li key={rel.id}>
            <button
              type="button"
              className="asset-sheet-rel"
              onClick={() => onSelect?.(otherId)}
            >
              <span className="dir">{direction}</span>
              <span className="name" title={otherId}>
                {nameOf(otherId)}
              </span>
            </button>
            {onUpdateKind && !rel.inferred ? (
              <select
                className="asset-sheet-rel-kind"
                value={(rel.kind as RelationKind) || "uses"}
                disabled={busy}
                title={
                  relationKinds.find((k) => k.kind === ((rel.kind as RelationKind) || "uses"))
                    ?.hint ?? t("relation.kindAria")
                }
                onChange={(e) =>
                  onUpdateKind(
                    rel.id,
                    e.target.value as RelationKind,
                    rel.label,
                  )
                }
                aria-label={t("relation.kindAria")}
              >
                {relationKinds.map((k) => (
                  <option key={k.kind} value={k.kind} title={k.hint}>
                    {k.label}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className="asset-sheet-rel-kind-label"
                title={
                  rel.inferred
                    ? t("relation.suggested")
                    : (relationKinds.find((k) => k.kind === rel.kind)?.hint ??
                      undefined)
                }
              >
                {rel.inferred
                  ? t("relation.suggested")
                  : (relationKinds.find((k) => k.kind === rel.kind)?.label ??
                    rel.label ??
                    rel.kind)}
              </span>
            )}
            {rel.inferred && (onAccept || onReject) ? (
              <span className="asset-sheet-suggest">
                {onAccept && (
                  <button
                    type="button"
                    className="asset-sheet-link"
                    disabled={busy}
                    onClick={() =>
                      onAccept(
                        rel.from,
                        rel.to,
                        (rel.kind as RelationKind) || "references",
                        rel.label ?? "wikilink",
                      )
                    }
                  >
                    {t("relation.accept")}
                  </button>
                )}
                {onReject && (
                  <button
                    type="button"
                    className="asset-sheet-link"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t("relation.confirmDismiss"))) {
                        onReject(rel.from, rel.to);
                      }
                    }}
                  >
                    {t("relation.dismiss")}
                  </button>
                )}
              </span>
            ) : null}
            {onRemove && !rel.inferred && (
              <button
                type="button"
                className="asset-sheet-rel-del"
                title={t("relation.delete")}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("relation.confirmDelete"))) onRemove(rel.id);
                }}
              >
                ×
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function kindCode(artifact: ArtifactView): string {
  const role = artifact.role?.trim() ?? "";
  if (/场次|场景|场/.test(role)) return "SCN";
  if (/镜头|镜/.test(role)) return "SHT";
  if (/角色|人物/.test(role)) return "CHR";
  if (/道具/.test(role)) return "PRP";
  if (/特效|VFX/i.test(role)) return "VFX";
  if (/音频|配音|配乐|音效/.test(role)) return "AUD";
  if (/剧本|脚本/.test(role)) return "SCR";
  if (role) {
    const ascii = role.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (ascii.length >= 2) return ascii.slice(0, 3);
  }
  switch (artifact.kind) {
    case "video":
      return "VID";
    case "image":
      return "IMG";
    case "audio":
      return "AUD";
    case "markdown":
      return "MD";
    case "html":
      return "HTM";
    default:
      return "AST";
  }
}

function formatStamp(iso: string): string {
  const raw = (iso ?? "").trim();
  if (!raw) return "—";
  let t = Date.parse(raw);
  // Legacy bug: some mutations wrote Unix seconds / millis as plain digits.
  if (!Number.isFinite(t) && /^\d{10}$/.test(raw)) {
    t = Number(raw) * 1000;
  } else if (!Number.isFinite(t) && /^\d{13}$/.test(raw)) {
    t = Number(raw);
  }
  if (!Number.isFinite(t)) return raw;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 16)}…` : id;
}
