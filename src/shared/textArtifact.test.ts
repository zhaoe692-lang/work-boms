import { describe, expect, it } from "vitest";
import { canRenderMarkdown, isTextArtifact } from "./textArtifact";
import type { ArtifactView } from "./types";

function artifact(
  partial: Partial<ArtifactView> & Pick<ArtifactView, "kind">,
): ArtifactView {
  return {
    id: "a1",
    displayName: "demo",
    kind: partial.kind,
    status: "draft",
    fileRef: {
      path: "demo.md",
      pathKind: "relative",
      fileName: partial.fileRef?.fileName ?? "demo.md",
    },
    absolutePath: partial.absolutePath ?? "/tmp/demo.md",
    reachable: true,
    createdAt: "0",
    updatedAt: "0",
    ...partial,
  };
}

describe("isTextArtifact", () => {
  it("treats markdown and html as text", () => {
    expect(isTextArtifact(artifact({ kind: "markdown" }))).toBe(true);
    expect(isTextArtifact(artifact({ kind: "html" }))).toBe(true);
  });

  it("rejects media", () => {
    expect(isTextArtifact(artifact({ kind: "image" }))).toBe(false);
    expect(isTextArtifact(artifact({ kind: "audio" }))).toBe(false);
    expect(isTextArtifact(artifact({ kind: "video" }))).toBe(false);
  });

  it("allows other when extension is text-like", () => {
    expect(
      isTextArtifact(
        artifact({
          kind: "other",
          fileRef: { path: "a.txt", pathKind: "relative", fileName: "a.txt" },
          absolutePath: "/tmp/a.txt",
        }),
      ),
    ).toBe(true);
    expect(
      isTextArtifact(
        artifact({
          kind: "other",
          fileRef: { path: "a.bin", pathKind: "relative", fileName: "a.bin" },
          absolutePath: "/tmp/a.bin",
        }),
      ),
    ).toBe(false);
  });
});

describe("canRenderMarkdown", () => {
  it("detects markdown kind and .md files", () => {
    expect(canRenderMarkdown(artifact({ kind: "markdown" }))).toBe(true);
    expect(
      canRenderMarkdown(
        artifact({
          kind: "other",
          fileRef: { path: "n.md", pathKind: "relative", fileName: "n.md" },
        }),
      ),
    ).toBe(true);
    expect(
      canRenderMarkdown(
        artifact({
          kind: "html",
          fileRef: { path: "n.html", pathKind: "relative", fileName: "n.html" },
          absolutePath: "/tmp/n.html",
        }),
      ),
    ).toBe(false);
  });
});
