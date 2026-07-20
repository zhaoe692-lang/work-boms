import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ArtifactView, PackageDetail } from "../shared/types";
import { readArtifactText, writeArtifactText } from "../shared/api";
import { canRenderMarkdown, isTextArtifact } from "../shared/textArtifact";
import { useI18n } from "../shared/i18n";
import { mediaSrcFor } from "./assetVisual";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Lightweight Markdown → HTML for local preview (no external deps). */
export function renderMarkdownLite(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let listBuf: string[] = [];

  const flushList = () => {
    if (!listBuf.length) return;
    html.push(`<ul>${listBuf.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    listBuf = [];
  };

  const inline = (text: string) =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
      );

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      listBuf.push(inline(line.replace(/^\s*[-*]\s+/, "")));
      continue;
    }
    flushList();
    if (!line.trim()) {
      html.push("<br />");
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      html.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    html.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  if (inCode) html.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  return html.join("");
}

type TextMode = "preview" | "source";

export function ArtifactPreview({
  packageId,
  artifact,
  editable = true,
  onDetailUpdated,
}: {
  packageId: string | null;
  artifact: ArtifactView | null;
  /** When false, text is view-only (still can switch preview/source). */
  editable?: boolean;
  onDetailUpdated?: (detail: PackageDetail) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<TextMode>("preview");

  const textEditable = !!artifact && isTextArtifact(artifact);
  const markdownLike = !!artifact && canRenderMarkdown(artifact);
  const dirty = textEditable && text !== savedText;

  useEffect(() => {
    setMode(markdownLike || artifact?.kind === "html" ? "preview" : "source");
  }, [artifact?.id, markdownLike, artifact?.kind]);

  useEffect(() => {
    if (!packageId || !artifact) {
      setText("");
      setSavedText("");
      setError("");
      return;
    }
    if (!artifact.reachable) {
      setText("");
      setSavedText("");
      setError(t("preview.broken"));
      return;
    }
    if (!isTextArtifact(artifact)) {
      setText("");
      setSavedText("");
      setError("");
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    readArtifactText(packageId, artifact.id)
      .then((value) => {
        if (!alive) return;
        setText(value);
        setSavedText(value);
      })
      .catch((reason) => {
        if (!alive) return;
        setText("");
        setSavedText("");
        setError(String(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [packageId, artifact?.id, artifact?.kind, artifact?.reachable, artifact?.absolutePath, t]);

  const save = async () => {
    if (!packageId || !artifact || !editable || !dirty || saving) return;
    try {
      setSaving(true);
      setError("");
      const detail = await writeArtifactText(packageId, artifact.id, text);
      setSavedText(text);
      onDetailUpdated?.(detail);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  if (!artifact) {
    return <p className="muted">{t("preview.pickAsset")}</p>;
  }
  if (!artifact.reachable) {
    return <p className="error-text">{t("preview.broken")}</p>;
  }

  const src = mediaSrcFor(artifact);

  if (artifact.kind === "image") {
    if (!src) {
      return <p className="error-text">{t("preview.noSrc")}</p>;
    }
    return (
      <div className="artifact-preview media">
        <img
          src={src}
          alt={artifact.displayName}
          className="artifact-preview-image"
          onError={(event) => {
            const el = event.currentTarget;
            el.style.display = "none";
            const sibling = el.nextElementSibling;
            if (sibling instanceof HTMLElement) sibling.hidden = false;
          }}
        />
        <p className="error-text" hidden>
          {t("preview.imageFail", { path: artifact.absolutePath })}
        </p>
      </div>
    );
  }

  if (artifact.kind === "audio") {
    return (
      <div className="artifact-preview media">
        <audio className="artifact-preview-audio" controls src={src} preload="metadata">
          {t("preview.audioUnsupported")}
        </audio>
      </div>
    );
  }

  if (artifact.kind === "video") {
    return (
      <div className="artifact-preview media">
        <video className="artifact-preview-video" controls src={src} preload="metadata">
          {t("preview.videoUnsupported")}
        </video>
      </div>
    );
  }

  if (textEditable) {
    if (loading) return <p className="muted">{t("preview.reading")}</p>;

    const showPreviewToggle = markdownLike || artifact.kind === "html";
    const emptyHtml = `<p class='muted'>${escapeHtml(t("preview.empty"))}</p>`;

    return (
      <div className="artifact-preview text-editor">
        <div className="artifact-preview-toolbar">
          {showPreviewToggle ? (
            <div className="artifact-preview-mode" role="tablist" aria-label={t("preview.modeAria")}>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "preview"}
                className={mode === "preview" ? "active" : undefined}
                onClick={() => setMode("preview")}
              >
                {t("common.preview")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "source"}
                className={mode === "source" ? "active" : undefined}
                onClick={() => setMode("source")}
              >
                {t("common.source")}
              </button>
            </div>
          ) : (
            <span className="artifact-preview-mode-label">{t("common.source")}</span>
          )}
          <div className="artifact-preview-toolbar-actions">
            {dirty && <span className="artifact-preview-dirty">{t("common.unsaved")}</span>}
            {editable && (
              <button
                type="button"
                className="artifact-preview-save"
                disabled={!dirty || saving}
                onClick={() => void save()}
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
            )}
          </div>
        </div>
        {error ? <p className="error-text artifact-preview-banner">{error}</p> : null}
        {mode === "source" || !showPreviewToggle ? (
          <textarea
            className="artifact-preview-source"
            value={text}
            readOnly={!editable}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                void save();
              }
            }}
            aria-label={t("preview.sourceEdit")}
          />
        ) : artifact.kind === "html" ? (
          <iframe
            className="artifact-preview-html"
            title={artifact.displayName}
            sandbox=""
            srcDoc={text}
          />
        ) : (
          <div
            className="artifact-preview markdown"
            dangerouslySetInnerHTML={{
              __html: text ? renderMarkdownLite(text) : emptyHtml,
            }}
          />
        )}
      </div>
    );
  }

  if (artifact.kind === "html") {
    return (
      <div className="artifact-preview media">
        <iframe
          className="artifact-preview-html"
          title={artifact.displayName}
          src={convertFileSrc(artifact.absolutePath)}
          sandbox=""
        />
      </div>
    );
  }

  return <p className="muted">{t("preview.noInApp")}</p>;
}
