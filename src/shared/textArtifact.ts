import type { ArtifactView } from "./types";

const TEXT_EXTS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".json",
  ".csv",
  ".tsv",
  ".log",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".svg",
  ".rst",
  ".org",
  ".ini",
  ".cfg",
  ".conf",
]);

function fileExt(pathOrName: string): string {
  const base = pathOrName.split(/[/\\]/).pop() ?? pathOrName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

/** Text kinds editable in-app; media stays preview-only. */
export function isTextArtifact(artifact: ArtifactView): boolean {
  if (
    artifact.kind === "image" ||
    artifact.kind === "audio" ||
    artifact.kind === "video"
  ) {
    return false;
  }
  if (artifact.kind === "markdown" || artifact.kind === "html") {
    return true;
  }
  const name = artifact.fileRef?.fileName ?? artifact.absolutePath ?? "";
  return TEXT_EXTS.has(fileExt(name));
}

export function canRenderMarkdown(artifact: ArtifactView): boolean {
  if (artifact.kind === "markdown") return true;
  const name = artifact.fileRef?.fileName ?? artifact.absolutePath ?? "";
  const ext = fileExt(name);
  return ext === ".md" || ext === ".markdown";
}
