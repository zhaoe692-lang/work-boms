import type { DisplayEdge } from "../shared/graph";
import type { GraphAppearanceSettings } from "../shared/graphAppearance";
import { edgeKindKey } from "../shared/graphAppearance";
import type { Identity } from "../shared/types";
import { useMemo } from "react";

export function useVersionRoles(identities: Identity[]) {
  return useMemo(() => {
    const headIds = new Set<string>();
    const historicalIds = new Set<string>();
    for (const identity of identities) {
      headIds.add(identity.headVersionId);
      for (const versionId of identity.versionIds) {
        if (versionId !== identity.headVersionId) historicalIds.add(versionId);
      }
    }
    return { headIds, historicalIds };
  }, [identities]);
}

export function edgeStrokeStyle(
  edge: DisplayEdge,
  appearance: GraphAppearanceSettings,
  depthFade = 1,
): { stroke: string; strokeWidth: number; strokeDasharray?: string; opacity: number } {
  const kind = edgeKindKey(edge.kind);
  const stroke = appearance.edges[kind];
  const sizeScale = Math.sqrt(appearance.nodeSizeScale ?? 1);
  const opacityBase =
    kind === "part_of" ? 0.78 : kind === "version" ? 0.8 : kind === "uses" ? 0.58 : 0.44;
  const base = {
    stroke,
    strokeWidth:
      (kind === "part_of" ? 1.18 : kind === "version" ? 1.02 : kind === "uses" ? 0.84 : 0.72) *
      sizeScale,
    opacity: Math.max(0.18, Math.min(0.92, depthFade * opacityBase)),
  };
  if (kind === "version") return { ...base, strokeDasharray: "6 4" };
  if (kind === "references" || kind === "uses" || kind === "derived_from" || kind === "pairs_with") {
    return { ...base, strokeDasharray: "3 3" };
  }
  if (edge.inferred) return { ...base, strokeDasharray: "2 4", opacity: base.opacity * 0.65 };
  return base;
}

export function nodeVisualStyle(
  appearance: GraphAppearanceSettings,
  opts: {
    level: number;
    isCenter: boolean;
    isHead: boolean;
    isHistorical: boolean;
    isBroken: boolean;
    depthScale: number;
  },
): { fill: string; radius: number; opacity: number; stroke: string; strokeWidth: number } {
  const { level, isCenter, isHead, isHistorical, isBroken, depthScale } = opts;

  let fill =
    level < 0
      ? appearance.nodeSpecial.loose
      : appearance.nodeLevels[String(Math.min(level, 4))] ?? appearance.nodeLevels["4"];

  if (isHistorical) fill = appearance.nodeSpecial.historicalVersion;
  if (isBroken) fill = appearance.nodeSpecial.broken;
  if (isCenter) fill = appearance.nodeSpecial.center;

  let stroke = "rgba(255,255,255,0.72)";
  let strokeWidth = 0.9;
  if (isHead && !isHistorical && !isCenter) {
    stroke = appearance.nodeSpecial.headVersion;
    strokeWidth = 1.4;
  }
  if (isCenter) {
    stroke = "#ffffff";
    strokeWidth = 1.8;
  }

  const baseR = isCenter ? 6.2 : isHistorical ? 1.7 : isHead ? 2.7 : 2.15;
  const sizeScale = appearance.nodeSizeScale ?? 1;
  const radius = baseR * (0.82 + depthScale * 0.34) * sizeScale;
  const opacity = Math.max(0.22, Math.min(1, isHistorical ? 0.28 + depthScale * 0.22 : 0.42 + depthScale * 0.3));

  return { fill, radius, opacity, stroke, strokeWidth };
}
