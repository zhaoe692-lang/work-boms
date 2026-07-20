/**
 * Graph-only selected-node inspector.
 * Deliberately separate from cockpit AssetOpsPanel — dark, read-only, narrative.
 */
import { useEffect, useMemo, useState } from "react";
import type { DisplayEdge } from "../shared/graph";
import { useI18n, type MessageKey } from "../shared/i18n";
import type { ArtifactView, PackageDetail } from "../shared/types";
import { kindLabel, statusLabel } from "../shared/utils";
import { ArtifactPreview } from "./ArtifactPreview";
import { assetVisual, mediaSrcFor } from "./assetVisual";
import { ResizablePreviewFloat } from "./ResizablePreviewFloat";

const RELATION_KIND_KEYS: Record<string, MessageKey> = {
  part_of: "relation.part_of",
  uses: "relation.uses",
  references: "relation.references",
  derived_from: "relation.derived_from",
  pairs_with: "relation.pairs_with",
  version: "relation.version",
};

export interface GraphNodeDetailProps {
  artifact: ArtifactView;
  edges: DisplayEdge[];
  artifacts: ArtifactView[];
  packageId?: string | null;
  onSelectArtifact: (id: string) => void;
  onOpenFile: (artifact: ArtifactView) => void;
  onRevealInFinder: (artifact: ArtifactView) => void;
  onOpenDetail?: (id: string) => void;
  onDetailUpdated?: (detail: PackageDetail) => void;
}

export function GraphNodeDetail({
  artifact,
  edges,
  artifacts,
  packageId = null,
  onSelectArtifact,
  onOpenFile,
  onRevealInFinder,
  onOpenDetail,
  onDetailUpdated,
}: GraphNodeDetailProps) {
  const { t, locale } = useI18n();
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    setRelationsOpen(false);
    setPreviewOpen(false);
  }, [artifact.id]);

  const visual = assetVisual(artifact, locale);
  const mediaSrc = mediaSrcFor(artifact);

  const nameOf = (id: string) =>
    artifacts.find((a) => a.id === id)?.displayName ?? shortId(id);

  const relations = useMemo(
    () => edges.filter((e) => e.from === artifact.id || e.to === artifact.id),
    [edges, artifact.id],
  );
  const downstream = useMemo(
    () => edges.filter((e) => e.from === artifact.id).length,
    [edges, artifact.id],
  );

  return (
    <div className="graph-node-detail">
      <section className="gnd-hero">
        <div className="gnd-eyebrow">{t("graph.selectedAsset")}</div>
        <h2 className="gnd-title">{artifact.displayName}</h2>
        <div className="gnd-meta">
          <span className={`gnd-pill status-${artifact.status}`}>
            {statusLabel(artifact.status, locale)}
          </span>
          <span className="gnd-pill">{kindLabel(artifact.kind, locale)}</span>
          {!artifact.reachable && (
            <span className="gnd-pill warn">{t("graph.broken")}</span>
          )}
        </div>
        {artifact.summary ? (
          <p className="gnd-summary">{artifact.summary}</p>
        ) : null}
      </section>

      <button
        type="button"
        className="gnd-preview"
        onClick={() => setPreviewOpen(true)}
        style={{ ["--gnd-accent" as string]: visual.accent }}
      >
        <div className="gnd-preview-media">
          {artifact.reachable && artifact.kind === "image" && mediaSrc ? (
            <img src={mediaSrc} alt="" />
          ) : artifact.reachable && artifact.kind === "video" && mediaSrc ? (
            <video src={mediaSrc} muted preload="metadata" />
          ) : (
            <span className="gnd-preview-glyph">{visual.glyph}</span>
          )}
          <span className="gnd-preview-veil" aria-hidden />
          <span className="gnd-preview-caption">
            {!artifact.reachable ? t("asset.brokenLink") : t("asset.clickPreview")}
          </span>
        </div>
      </button>

      <section className="gnd-block">
        <h3>{t("graph.adjacency")}</h3>
        <div className="gnd-down" title={t("graph.downstreamHint")}>
          <span className="gnd-down-label">{t("graph.downstream")}</span>
          <strong className="gnd-down-value">{downstream}</strong>
          <span className="gnd-down-hint">{t("graph.downstreamHint")}</span>
        </div>
      </section>

      <section className="gnd-block">
        <h3>{t("graph.file")}</h3>
        <div className="gnd-actions">
          {artifact.reachable ? (
            <>
              <button type="button" onClick={() => onOpenFile(artifact)}>
                {t("common.open")}
              </button>
              <button type="button" onClick={() => onRevealInFinder(artifact)}>
                {t("graph.locate")}
              </button>
            </>
          ) : (
            <p className="gnd-empty">{t("asset.brokenLink")}</p>
          )}
          {onOpenDetail && (
            <button
              type="button"
              className="primary"
              onClick={() => onOpenDetail(artifact.id)}
            >
              {t("graph.editInCockpit")}
            </button>
          )}
        </div>
      </section>

      <section className="gnd-block">
        <button
          type="button"
          className="gnd-fold"
          aria-expanded={relationsOpen}
          onClick={() => setRelationsOpen((v) => !v)}
        >
          <h3>
            {t("graph.relationsCount", { count: relations.length })}
          </h3>
          <span aria-hidden>{relationsOpen ? "▾" : "▸"}</span>
        </button>
        {relationsOpen && (
          <ul className="gnd-rel-list">
            {relations.length === 0 ? (
              <li className="gnd-empty-row">{t("graph.noDirectRelations")}</li>
            ) : (
              relations.slice(0, 16).map((rel) => {
                const otherId = rel.from === artifact.id ? rel.to : rel.from;
                const dir = rel.from === artifact.id ? "→" : "←";
                const kindKey = RELATION_KIND_KEYS[rel.kind];
                const kind =
                  (kindKey ? t(kindKey) : undefined) ??
                  rel.label ??
                  (rel.inferred ? t("relation.suggested") : rel.kind);
                return (
                  <li key={rel.id}>
                    <button
                      type="button"
                      className="gnd-rel"
                      onClick={() => onSelectArtifact(otherId)}
                    >
                      <span className="gnd-rel-dir">{dir}</span>
                      <span className="gnd-rel-name" title={otherId}>
                        {nameOf(otherId)}
                      </span>
                      <span className="gnd-rel-kind">{kind}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </section>

      {artifact.tags && artifact.tags.length > 0 && (
        <section className="gnd-block">
          <h3>{t("asset.tags")}</h3>
          <div className="gnd-tags">
            {artifact.tags.map((tag) => (
              <span key={tag} className="gnd-tag">
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {previewOpen && (
        <div
          className="gnd-preview-backdrop"
          role="presentation"
          onClick={() => setPreviewOpen(false)}
        >
          <ResizablePreviewFloat
            className="gnd-preview-float"
            headClassName="gnd-preview-float-head"
            bodyClassName="gnd-preview-float-body"
            title={artifact.displayName}
            chip={<span className="gnd-pill">{kindLabel(artifact.kind, locale)}</span>}
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

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 16)}…` : id;
}
