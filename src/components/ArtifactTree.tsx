import { useState } from "react";
import type { BomNode } from "../shared/bom";
import { useI18n } from "../shared/i18n";
import type { ArtifactView } from "../shared/types";
import { kindLabel, statusLabel } from "../shared/utils";

interface ArtifactTreeProps {
  nodes: BomNode[];
  artifactById: Map<string, ArtifactView>;
  selectedArtifactId: string | null;
  onSelectArtifact: (artifact: ArtifactView) => void;
}

/** Renders the part_of composition forest — composite products at the top,
 * their parts nested below, with per-Identity version history on demand. */
export function ArtifactTree({
  nodes,
  artifactById,
  selectedArtifactId,
  onSelectArtifact,
}: ArtifactTreeProps) {
  if (!nodes.length) return null;
  return (
    <ul className="bom-tree" role="tree">
      {nodes.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          artifactById={artifactById}
          selectedArtifactId={selectedArtifactId}
          onSelectArtifact={onSelectArtifact}
        />
      ))}
    </ul>
  );
}

function TreeItem({
  node,
  depth,
  artifactById,
  selectedArtifactId,
  onSelectArtifact,
}: {
  node: BomNode;
  depth: number;
  artifactById: Map<string, ArtifactView>;
  selectedArtifactId: string | null;
  onSelectArtifact: (artifact: ArtifactView) => void;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const artifact = artifactById.get(node.artifactId);
  const hasChildren = node.children.length > 0;
  const history = node.identity
    ? node.identity.versionIds.filter((id) => id !== node.identity!.headVersionId)
    : [];

  if (!artifact) return null;

  return (
    <li
      className="bom-node"
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
    >
      <div className="bom-row" style={{ paddingLeft: depth * 16 }}>
        {hasChildren ? (
          <button
            type="button"
            className="bom-twist"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t("nav.collapse") : t("nav.expand")}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="bom-twist-spacer" aria-hidden />
        )}
        <button
          type="button"
          className={
            selectedArtifactId === artifact.id
              ? "artifact-row active"
              : "artifact-row"
          }
          onClick={() => onSelectArtifact(artifact)}
        >
          <div className="artifact-main">
            <strong>{artifact.displayName}</strong>
            <span className="muted small mono">{artifact.id}</span>
          </div>
          <div className="artifact-meta">
            {node.identity && (
              <span className="chip chip-identity">
                {node.identity.kind === "composite"
                  ? t("tree.composite")
                  : t("tree.versions")}{" "}
                · {node.identity.versionIds.length}
              </span>
            )}
            <span className={`chip status-${artifact.status}`}>
              {statusLabel(artifact.status, locale)}
            </span>
            <span className="chip">{kindLabel(artifact.kind, locale)}</span>
            {!artifact.reachable && (
              <span className="chip status-broken">{t("tree.broken")}</span>
            )}
          </div>
        </button>
        {history.length > 0 && (
          <button
            type="button"
            className={showHistory ? "bom-history-toggle active" : "bom-history-toggle"}
            onClick={() => setShowHistory((v) => !v)}
          >
            {t("tree.history", { count: history.length })}
          </button>
        )}
      </div>

      {showHistory && history.length > 0 && (
        <ul
          className="bom-history-list"
          style={{ paddingLeft: (depth + 1) * 16 + 20 }}
        >
          {[...history].reverse().map((versionId) => {
            const versionArtifact = artifactById.get(versionId);
            if (!versionArtifact) return null;
            return (
              <li key={versionId}>
                <button
                  type="button"
                  className={
                    selectedArtifactId === versionArtifact.id
                      ? "artifact-row history active"
                      : "artifact-row history"
                  }
                  onClick={() => onSelectArtifact(versionArtifact)}
                >
                  <div className="artifact-main">
                    <span>{versionArtifact.displayName}</span>
                    <span className="muted small mono">{versionArtifact.id}</span>
                  </div>
                  <span className={`chip status-${versionArtifact.status}`}>
                    {statusLabel(versionArtifact.status, locale)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hasChildren && expanded && (
        <ul className="bom-children">
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              artifactById={artifactById}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={onSelectArtifact}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
