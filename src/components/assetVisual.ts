import { convertFileSrc } from "@tauri-apps/api/core";
import type { ArtifactView } from "../shared/types";
import { tStatic, type Locale } from "../shared/i18n";
import type { IconName } from "./icons";

/**
 * Single source of truth for how an artifact is visually represented
 * (accent colour, type eyebrow, icon, avatar shape, and — when the file is a
 * reachable image — a real thumbnail). Used by both the relationship graph
 * nodes and the cockpit "high-connection" strip so the two stay in sync.
 *
 * Note: only `image` artifacts can carry a real picture — the data model has
 * no poster/thumbnail field for video/audio/character/doc, so those fall back
 * to a designed type tile rather than a photo.
 */
export interface AssetVisual {
  accent: string;
  eyebrow: string;
  icon: IconName;
  glyph: string;
  avatar: boolean;
  previewUrl?: string;
}

/** Asset-protocol URL for reachable image / audio / video / html files. */
export function mediaSrcFor(artifact: ArtifactView): string | undefined {
  if (!artifact.reachable) return undefined;
  if (
    artifact.kind === "image" ||
    artifact.kind === "audio" ||
    artifact.kind === "video" ||
    artifact.kind === "html"
  ) {
    return convertFileSrc(artifact.absolutePath);
  }
  return undefined;
}

export function assetVisual(
  artifact: ArtifactView,
  locale?: Locale,
): AssetVisual {
  const previewUrl =
    artifact.reachable && artifact.kind === "image"
      ? convertFileSrc(artifact.absolutePath)
      : undefined;
  const role = `${artifact.role ?? ""} ${artifact.displayName}`.toLowerCase();
  if (/角色|人物|character/.test(role)) {
    return {
      accent: "#8f9bff",
      eyebrow: tStatic("asset.eyebrow.character", undefined, locale),
      icon: "character",
      glyph: initials(artifact.displayName),
      avatar: true,
      previewUrl,
    };
  }
  if (/场景|scene/.test(role)) {
    return {
      accent: "#68d0ff",
      eyebrow: tStatic("asset.eyebrow.scene", undefined, locale),
      icon: "scene",
      glyph: "景",
      avatar: false,
      previewUrl,
    };
  }
  if (/道具|prop/.test(role)) {
    return {
      accent: "#e6bc67",
      eyebrow: tStatic("asset.eyebrow.prop", undefined, locale),
      icon: "prop",
      glyph: "具",
      avatar: false,
      previewUrl,
    };
  }
  if (/特效|vfx/.test(role)) {
    return {
      accent: "#d88cff",
      eyebrow: tStatic("asset.eyebrow.vfx", undefined, locale),
      icon: "vfx",
      glyph: "效",
      avatar: false,
      previewUrl,
    };
  }
  switch (artifact.kind) {
    case "video":
      return {
        accent: "#69b8ff",
        eyebrow: tStatic("asset.eyebrow.shot", undefined, locale),
        icon: "video",
        glyph: "影",
        avatar: false,
        previewUrl,
      };
    case "image":
      return {
        accent: "#5fd6b8",
        eyebrow: tStatic("asset.eyebrow.footage", undefined, locale),
        icon: "image",
        glyph: "图",
        avatar: false,
        previewUrl,
      };
    case "audio":
      return {
        accent: "#7cde80",
        eyebrow: tStatic("asset.eyebrow.audio", undefined, locale),
        icon: "audio",
        glyph: "音",
        avatar: false,
        previewUrl,
      };
    case "markdown":
      return {
        accent: "#8f9bff",
        eyebrow: tStatic("asset.eyebrow.script", undefined, locale),
        icon: "doc",
        glyph: "文",
        avatar: false,
        previewUrl,
      };
    case "html":
      return {
        accent: "#55b9ff",
        eyebrow: tStatic("asset.eyebrow.page", undefined, locale),
        icon: "doc",
        glyph: "页",
        avatar: false,
        previewUrl,
      };
    default:
      return {
        accent: "#8ea1c6",
        eyebrow: tStatic("asset.eyebrow.asset", undefined, locale),
        icon: "diamond",
        glyph: "资",
        avatar: false,
        previewUrl,
      };
  }
}

export function initials(name: string): string {
  const plain = name.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!plain) return "A";
  const parts = plain.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}
