import type { CSSProperties } from "react";
import type { ArtifactView } from "../shared/types";
import { useI18n } from "../shared/i18n";
import { assetVisual } from "./assetVisual";
import { Icon } from "./icons";

interface AssetThumbProps {
  artifact: ArtifactView;
  size?: number;
  /** small count/number badge pinned to the top-right corner */
  badge?: number | string;
  className?: string;
}

/**
 * The shared asset tile: a real thumbnail when the artifact is a reachable
 * image, otherwise a designed type-tinted tile with a crisp type icon (or an
 * initial for characters). Same visual language as the graph nodes.
 */
export function AssetThumb({ artifact, size = 44, badge, className }: AssetThumbProps) {
  const { locale } = useI18n();
  const v = assetVisual(artifact, locale);
  const style: CSSProperties = {
    width: size,
    height: size,
    ["--asset-accent" as string]: v.accent,
  };
  if (v.previewUrl) {
    style.backgroundImage = `url("${v.previewUrl}")`;
  }
  return (
    <span
      className={`asset-thumb${v.avatar ? " avatar" : ""}${v.previewUrl ? " preview" : ""}${
        className ? ` ${className}` : ""
      }`}
      style={style}
    >
      {v.previewUrl ? null : v.avatar ? (
        <span className="asset-thumb-core">{v.glyph}</span>
      ) : (
        <span className="asset-thumb-core">
          <Icon name={v.icon} size={Math.round(size * 0.44)} />
        </span>
      )}
      {badge != null && <span className="asset-thumb-badge">{badge}</span>}
    </span>
  );
}
