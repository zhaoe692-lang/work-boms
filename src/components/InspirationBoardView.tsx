import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Grid3X3,
  Image,
  Lightbulb,
  Link2,
  Move,
  Music2,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { toPng } from "html-to-image";
import type {
  ArtifactView,
  InspirationBoard,
  InspirationBoardItem,
  InspirationBoardLink,
  InspirationBoardSummary,
  PackageDetail,
} from "../shared/types";
import {
  createInspirationBoard,
  deleteInspirationBoard,
  getInspirationBoard,
  listInspirationBoards,
  saveInspirationBoard,
  writeTextFile,
} from "../shared/api";
import { AudioWaveform } from "./AudioWaveform";
import { useI18n, type MessageKey } from "../shared/i18n";

/** Substring of the Rust conflict error — keep matching backend wording. */
const RUST_CONFLICT_MARKER = "灵感板已在其他窗口修改";

function isInspirationConflict(message: string, conflictMarker: string): boolean {
  return (
    message.includes(RUST_CONFLICT_MARKER) ||
    message.includes(conflictMarker) ||
    /modified in another window/i.test(message)
  );
}

function cloneBoard(board: InspirationBoard): InspirationBoard {
  return JSON.parse(JSON.stringify(board)) as InspirationBoard;
}

type PickerKind = "all" | "visual" | "audio" | null;
type PointerMode = "move" | "resize";
type Selection =
  | { type: "item"; id: string }
  | { type: "link"; id: string }
  | null;

const CARD_COLORS = ["yellow", "paper", "white", "violet", "slate"];
const LINK_KIND_IDS = ["association", "sequence", "contrast", "reference"] as const;
const LINK_KIND_KEYS: Record<(typeof LINK_KIND_IDS)[number], MessageKey> = {
  association: "inspiration.linkAssociation",
  sequence: "inspiration.linkSequence",
  contrast: "inspiration.linkContrast",
  reference: "inspiration.linkReference",
};

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function typeLabel(type: string, t: TFn) {
  if (type === "quote") return t("inspiration.typeQuote");
  if (type === "note") return t("inspiration.typeNote");
  if (type === "audio") return t("inspiration.typeAudio");
  if (type === "link") return t("inspiration.typeLink");
  return t("inspiration.typeVisual");
}

function makeItem(kind: string, t: TFn, x = 38, y = 28): InspirationBoardItem {
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const isQuote = kind === "quote";
  return {
    id,
    kind,
    title: isQuote ? t("inspiration.defaultQuoteTitle") : t("inspiration.defaultNoteTitle"),
    note: isQuote ? t("inspiration.defaultQuoteNote") : t("inspiration.defaultNoteNote"),
    x,
    y,
    width: isQuote ? 27 : 24,
    height: isQuote ? 20 : 22,
    rotation: 0,
    zIndex: Date.now(),
    color: isQuote ? "paper" : "yellow",
  };
}

function CardMedia({
  card,
  artifact,
}: {
  card: InspirationBoardItem;
  artifact?: ArtifactView;
}) {
  if (artifact?.reachable && (artifact.kind === "image" || artifact.kind === "video")) {
    const src = convertFileSrc(artifact.absolutePath);
    if (artifact.kind === "video") {
      return (
        <div className="inspiration-image real">
          <video src={src} muted playsInline preload="metadata" />
        </div>
      );
    }
    return (
      <div className="inspiration-image real">
        <img src={src} alt={card.title} />
      </div>
    );
  }
  if (artifact?.reachable && artifact.kind === "audio") {
    return <AudioWaveform src={convertFileSrc(artifact.absolutePath)} />;
  }
  if (card.kind === "image") {
    return (
      <div className="inspiration-image">
        <span /><span /><i />
      </div>
    );
  }
  if (card.kind === "audio") {
    return (
      <div className="inspiration-wave">
        {Array.from({ length: 22 }, (_, index) => (
          <i key={index} style={{ height: `${18 + ((index * 17) % 34)}%` }} />
        ))}
      </div>
    );
  }
  return null;
}

export function InspirationBoardView({
  detail,
  onOpenArtifact,
}: {
  detail: PackageDetail | null;
  onOpenArtifact?: (packageId: string, artifactId: string) => void;
}) {
  const { t } = useI18n();
  const [summaries, setSummaries] = useState<InspirationBoardSummary[]>([]);
  const [board, setBoard] = useState<InspirationBoard | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [showLinks, setShowLinks] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [assetPicker, setAssetPicker] = useState<PickerKind>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);
  const hydrated = useRef(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<{ past: InspirationBoard[]; future: InspirationBoard[] }>({
    past: [],
    future: [],
  });
  const skipHistoryRef = useRef(false);

  const syncHistoryFlags = () => {
    setCanUndo(historyRef.current.past.length > 0);
    setCanRedo(historyRef.current.future.length > 0);
  };

  const commitBoard = useCallback((updater: (current: InspirationBoard) => InspirationBoard) => {
    setBoard((current) => {
      if (!current) return current;
      const next = updater(current);
      if (
        hydrated.current &&
        !skipHistoryRef.current &&
        JSON.stringify({
          title: current.title,
          zoom: current.zoom,
          panX: current.panX,
          panY: current.panY,
          items: current.items,
          links: current.links,
        }) !==
          JSON.stringify({
            title: next.title,
            zoom: next.zoom,
            panX: next.panX,
            panY: next.panY,
            items: next.items,
            links: next.links,
          })
      ) {
        historyRef.current.past.push(cloneBoard(current));
        if (historyRef.current.past.length > 40) historyRef.current.past.shift();
        historyRef.current.future = [];
        queueMicrotask(syncHistoryFlags);
      }
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setBoard((current) => {
      if (!current || !historyRef.current.past.length) return current;
      const previous = historyRef.current.past.pop()!;
      historyRef.current.future.push(cloneBoard(current));
      queueMicrotask(syncHistoryFlags);
      skipHistoryRef.current = true;
      queueMicrotask(() => { skipHistoryRef.current = false; });
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setBoard((current) => {
      if (!current || !historyRef.current.future.length) return current;
      const next = historyRef.current.future.pop()!;
      historyRef.current.past.push(cloneBoard(current));
      queueMicrotask(syncHistoryFlags);
      skipHistoryRef.current = true;
      queueMicrotask(() => { skipHistoryRef.current = false; });
      return next;
    });
  }, []);

  const artifactById = useMemo(
    () => new Map((detail?.artifacts ?? []).map((a) => [a.id, a])),
    [detail],
  );

  const refreshSummaries = useCallback(async () => {
    const next = await listInspirationBoards(detail?.package.id);
    setSummaries(next);
    return next;
  }, [detail?.package.id]);

  const openBoard = useCallback(async (boardId: string) => {
    hydrated.current = false;
    setSelection(null);
    setConnectFrom(null);
    historyRef.current = { past: [], future: [] };
    syncHistoryFlags();
    const next = await getInspirationBoard(boardId);
    setBoard(next);
    window.setTimeout(() => { hydrated.current = true; }, 0);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setError("");
        hydrated.current = false;
        let next = await listInspirationBoards(detail?.package.id);
        if (!next.length) {
          const created = await createInspirationBoard(
            detail?.package.id,
            t("asset.unnamedBoard"),
          );
          next = [{ id: created.id, packageId: created.packageId, title: created.title, itemCount: 0, updatedAt: created.updatedAt, version: created.version }];
        }
        if (!active) return;
        setSummaries(next);
        const loaded = await getInspirationBoard(next[0].id);
        if (active) {
          setBoard(loaded);
          setSelection(null);
          window.setTimeout(() => { hydrated.current = true; }, 0);
        }
      } catch (reason) {
        if (active) setError(String(reason));
      }
    })();
    return () => { active = false; };
  }, [detail?.package.id, t]);

  useEffect(() => {
    if (!board || !hydrated.current) return;
    setSaveState("saving");
    const snapshot = board;
    const timer = window.setTimeout(async () => {
      try {
        const saved = await saveInspirationBoard(snapshot, snapshot.version);
        setBoard((current) => current?.id === saved.id ? { ...current, version: saved.version, updatedAt: saved.updatedAt } : current);
        setSummaries((current) => current.map((item) => item.id === saved.id ? { ...item, title: saved.title, itemCount: saved.items.length, updatedAt: saved.updatedAt, version: saved.version } : item));
        setSaveState("saved");
      } catch (reason) {
        const message = String(reason);
        setSaveState("error");
        setError(message);
        if (isInspirationConflict(message, t("inspiration.conflictMarker"))) setConflict(true);
      }
    }, 420);
    return () => window.clearTimeout(timer);
  }, [board?.title, board?.zoom, board?.panX, board?.panY, board?.items, board?.links]);

  const resolveConflict = async (keepLocal: boolean) => {
    if (!board) return;
    try {
      setError("");
      const remote = await getInspirationBoard(board.id);
      if (keepLocal) {
        const merged = { ...board, version: remote.version };
        const saved = await saveInspirationBoard(merged, remote.version);
        setBoard({ ...merged, version: saved.version, updatedAt: saved.updatedAt });
        setSaveState("saved");
      } else {
        hydrated.current = false;
        historyRef.current = { past: [], future: [] };
        syncHistoryFlags();
        setBoard(remote);
        window.setTimeout(() => { hydrated.current = true; }, 0);
        setSaveState("saved");
      }
      setConflict(false);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const removeItem = useCallback((id: string) => {
    commitBoard((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== id),
      links: current.links.filter((link) => link.fromItemId !== id && link.toItemId !== id),
    }));
    setSelection((current) => current?.type === "item" && current.id === id ? null : current);
    setConnectFrom((current) => current === id ? null : current);
  }, [commitBoard]);

  const removeLink = useCallback((id: string) => {
    commitBoard((current) => ({
      ...current,
      links: current.links.filter((link) => link.id !== id),
    }));
    setSelection((current) => current?.type === "link" && current.id === id ? null : current);
  }, [commitBoard]);

  const patchLink = useCallback((id: string, patch: Partial<InspirationBoardLink>) => {
    commitBoard((current) => ({
      ...current,
      links: current.links.map((link) => link.id === id ? { ...link, ...patch } : link),
    }));
  }, [commitBoard]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setSpacePressed(true);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selection && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        if (selection.type === "item") removeItem(selection.id);
        else removeLink(selection.id);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
      if (event.key === "Escape") {
        setConnectMode(false);
        setConnectFrom(null);
        setAssetPicker(null);
        setAddMenuOpen(false);
        setSelection(null);
      }
    };
    const up = (event: KeyboardEvent) => { if (event.code === "Space") setSpacePressed(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [selection, removeItem, removeLink, undo, redo]);

  const selectedItem = selection?.type === "item"
    ? board?.items.find((item) => item.id === selection.id) ?? null
    : null;
  const selectedLink = selection?.type === "link"
    ? board?.links.find((link) => link.id === selection.id) ?? null
    : null;

  const assets = useMemo(() => {
    const all = detail?.artifacts ?? [];
    if (assetPicker === "visual") return all.filter((item) => item.kind === "image" || item.kind === "video");
    if (assetPicker === "audio") return all.filter((item) => item.kind === "audio");
    return all;
  }, [assetPicker, detail]);

  const patchItem = useCallback((id: string, patch: Partial<InspirationBoardItem>) => {
    commitBoard((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }, [commitBoard]);

  const addItem = useCallback((kind: string, x?: number, y?: number) => {
    const item = makeItem(kind, t, x, y);
    commitBoard((current) => ({ ...current, items: [...current.items, item] }));
    setSelection({ type: "item", id: item.id });
    setAddMenuOpen(false);
  }, [commitBoard, t]);

  const startCardPointer = (event: React.PointerEvent, item: InspirationBoardItem, mode: PointerMode) => {
    if (!board || connectMode) return;
    event.preventDefault();
    event.stopPropagation();
    setSelection({ type: "item", id: item.id });
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = { x: item.x, y: item.y, width: item.width, height: item.height };
    const scale = board.zoom;
    const before = cloneBoard(board);
    skipHistoryRef.current = true;
    const move = (pointer: PointerEvent) => {
      const dx = ((pointer.clientX - startX) / (rect.width * scale)) * 100;
      const dy = ((pointer.clientY - startY) / (rect.height * scale)) * 100;
      if (mode === "move") patchItem(item.id, { x: Math.max(-10, Math.min(92, initial.x + dx)), y: Math.max(-10, Math.min(90, initial.y + dy)) });
      else patchItem(item.id, { width: Math.max(12, Math.min(52, initial.width + dx)), height: Math.max(10, Math.min(55, initial.height + dy)) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      skipHistoryRef.current = false;
      historyRef.current.past.push(before);
      if (historyRef.current.past.length > 40) historyRef.current.past.shift();
      historyRef.current.future = [];
      syncHistoryFlags();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const handleCardClick = (item: InspirationBoardItem) => {
    if (!connectMode) { setSelection({ type: "item", id: item.id }); return; }
    if (!connectFrom) { setConnectFrom(item.id); setSelection({ type: "item", id: item.id }); return; }
    if (connectFrom === item.id) { setConnectFrom(null); return; }
    const linkId = `link-${Date.now()}`;
    commitBoard((current) => ({
      ...current,
      links: [...current.links, { id: linkId, fromItemId: connectFrom, toItemId: item.id, kind: "association" }],
    }));
    setConnectFrom(null);
    setConnectMode(false);
    setSelection({ type: "link", id: linkId });
  };

  const startCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!board || (!spacePressed && event.button !== 1)) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialX = board.panX;
    const initialY = board.panY;
    const move = (pointer: PointerEvent) => setBoard((current) => current ? {
      ...current,
      panX: initialX + pointer.clientX - startX,
      panY: initialY + pointer.clientY - startY,
    } : current);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const handleCanvasDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!board || (event.target as HTMLElement).closest(".inspiration-card, .inspiration-editor, .inspiration-asset-picker")) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((event.clientX - rect.left - board.panX) / board.zoom / rect.width) * 100;
    const y = ((event.clientY - rect.top - board.panY) / board.zoom / rect.height) * 100;
    addItem("note", Math.max(0, Math.min(88, x)), Math.max(0, Math.min(82, y)));
  };

  const addArtifact = (artifactId: string) => {
    if (!board || !detail) return;
    const artifact = detail.artifacts.find((item) => item.id === artifactId);
    if (!artifact) return;
    const kind = artifact.kind === "image" || artifact.kind === "video" ? "image" : artifact.kind === "audio" ? "audio" : "link";
    const item: InspirationBoardItem = {
      ...makeItem(kind, t),
      title: artifact.displayName,
      note: artifact.summary ?? artifact.role ?? t("inspiration.fromProject"),
      artifactPackageId: detail.package.id,
      artifactId: artifact.id,
      color: kind === "audio" ? "violet" : kind === "image" ? "slate" : "white",
    };
    commitBoard((current) => ({ ...current, items: [...current.items, item] }));
    setSelection({ type: "item", id: item.id });
    setAssetPicker(null);
  };

  const exportBoard = async () => {
    if (!board) return;
    try {
      const path = await save({
        defaultPath: `${board.title || "inspiration-board"}.json`,
        filters: [{ name: t("inspiration.formatJson"), extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFile(path, JSON.stringify(board, null, 2));
      setSaveState("saved");
    } catch (reason) {
      setError(String(reason));
    }
  };

  const exportBoardPng = async () => {
    if (!board || !worldRef.current) return;
    try {
      setExportingPng(true);
      const dataUrl = await toPng(worldRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#eef0f4",
      });
      const path = await save({
        defaultPath: `${board.title || "inspiration-board"}.png`,
        filters: [{ name: t("inspiration.formatPng"), extensions: ["png"] }],
      });
      if (!path) return;
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      // write via text command is wrong for binary — use write_text_file with latin1? Better add write_bytes.
      // Fallback: write data URL JSON sidecar is bad. Use invoke write_bytes.
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_bytes_file", { path, bytes: Array.from(bytes) });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setExportingPng(false);
    }
  };

  const createBoard = async () => {
    const title = window.prompt(t("inspiration.newBoardPrompt"), t("inspiration.newBoardDefault"))?.trim();
    if (!title) return;
    try {
      const created = await createInspirationBoard(detail?.package.id, title);
      await refreshSummaries();
      hydrated.current = false;
      setBoard(created);
      setSelection(null);
      setBoardMenuOpen(false);
      window.setTimeout(() => { hydrated.current = true; }, 0);
    } catch (reason) { setError(String(reason)); }
  };

  const removeBoard = async () => {
    if (!board || !window.confirm(t("inspiration.deleteConfirm", { title: board.title }))) return;
    try {
      await deleteInspirationBoard(board.id);
      const next = await refreshSummaries();
      if (next[0]) await openBoard(next[0].id);
      else {
        const created = await createInspirationBoard(detail?.package.id, t("asset.unnamedBoard"));
        await refreshSummaries();
        hydrated.current = false;
        setBoard(created);
        window.setTimeout(() => { hydrated.current = true; }, 0);
      }
      setBoardMenuOpen(false);
    } catch (reason) { setError(String(reason)); }
  };

  const openLinkedArtifact = () => {
    if (!selectedItem?.artifactId) return;
    const packageId = selectedItem.artifactPackageId || detail?.package.id;
    if (!packageId || !onOpenArtifact) return;
    onOpenArtifact(packageId, selectedItem.artifactId);
  };

  const zoom = Math.round((board?.zoom || 1) * 100);
  const selectedArtifact = selectedItem?.artifactId
    ? artifactById.get(selectedItem.artifactId)
    : undefined;

  return (
    <div className="inspiration-board-page">
      <header className="inspiration-head">
        <div className="inspiration-title">
          <span className="inspiration-mark"><Lightbulb size={16} /></span>
          <div>
            <small>{t("inspiration.brand")}</small>
            <input
              aria-label={t("inspiration.titleAria")}
              value={board?.title ?? ""}
              placeholder={t("inspiration.titlePlaceholder")}
              disabled={!board}
              onChange={(event) => commitBoard((current) => ({ ...current, title: event.target.value }))}
            />
          </div>
          <div className="inspiration-board-menu-anchor">
            <button type="button" onClick={() => setBoardMenuOpen((value) => !value)}>
              <ChevronDown size={13} />
            </button>
            {boardMenuOpen && (
              <div className="inspiration-board-menu">
                <header>
                  <strong>{t("inspiration.title")}</strong>
                  <button type="button" onClick={() => void createBoard()}><Plus size={12} /> {t("inspiration.new")}</button>
                </header>
                {summaries.map((item) => (
                  <button
                    type="button"
                    className={item.id === board?.id ? "active" : ""}
                    key={item.id}
                    onClick={() => { void openBoard(item.id); setBoardMenuOpen(false); }}
                  >
                    <span>{item.title}</span>
                    <small>{t("inspiration.itemCount", { count: item.itemCount })}</small>
                  </button>
                ))}
                <footer>
                  <button
                    type="button"
                    disabled={!board}
                    title={!board ? t("inspiration.needBoard") : t("inspiration.deleteCurrent")}
                    onClick={() => void removeBoard()}
                  >
                    <Trash2 size={12} /> {t("inspiration.deleteCurrent")}
                  </button>
                </footer>
              </div>
            )}
          </div>
        </div>
        <div className="inspiration-meta">
          <span>{detail?.package.title || t("inspiration.unboundProject")}</span>
          <i />
          {saveState === "saving" ? t("inspiration.saving") : saveState === "error" ? t("inspiration.saveFailed") : saveState === "saved" ? t("inspiration.autoSaved") : t("inspiration.localBoard")}
        </div>
        <div className="inspiration-actions">
          <button type="button" className="tool-btn ghost" title={t("inspiration.undoTitle")} disabled={!canUndo} onClick={undo}><Undo2 size={13} /></button>
          <button type="button" className="tool-btn ghost" title={t("inspiration.redoTitle")} disabled={!canRedo} onClick={redo}><Redo2 size={13} /></button>
          <button type="button" className="tool-btn ghost" title={t("inspiration.exportJson")} disabled={!board} onClick={() => void exportBoard()}><Download size={13} /></button>
          <button type="button" className="tool-btn ghost" title={t("inspiration.exportPng")} disabled={!board || exportingPng} onClick={() => void exportBoardPng()}>{exportingPng ? t("inspiration.exporting") : t("inspiration.exportPngShort")}</button>
          <span className={`inspiration-save-state ${saveState}`}>
            <Save size={12} />
            {saveState === "saving" ? t("inspiration.saveStateSaving") : saveState === "error" ? t("inspiration.saveStateUnsaved") : t("inspiration.saveStateSaved")}
          </span>
          <div className="inspiration-add-anchor">
            <button type="button" className="add" disabled={!board} onClick={() => setAddMenuOpen((value) => !value)}>
              <Plus size={14} /> {t("inspiration.addMaterial")}
            </button>
            {addMenuOpen && (
              <div className="inspiration-add-menu">
                <button type="button" onClick={() => addItem("note")}><FileText size={14} />{t("inspiration.note")}</button>
                <button type="button" onClick={() => addItem("quote")}><Sparkles size={14} />{t("inspiration.quote")}</button>
                <button type="button" onClick={() => { setAssetPicker("all"); setAddMenuOpen(false); }}><Link2 size={14} />{t("inspiration.projectAssets")}</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="inspiration-toolbar">
        <button type="button" title={t("inspiration.toolMove")} className={!connectMode ? "active" : ""} onClick={() => { setConnectMode(false); setConnectFrom(null); }}><Move size={15} /></button>
        <button type="button" title={t("inspiration.toolNote")} onClick={() => addItem("note")}><FileText size={15} /></button>
        <button type="button" title={t("inspiration.toolVisual")} onClick={() => setAssetPicker("visual")}><Image size={15} /></button>
        <button type="button" title={t("inspiration.toolAudio")} onClick={() => setAssetPicker("audio")}><Music2 size={15} /></button>
        <button type="button" title={t("inspiration.toolConnect")} className={connectMode ? "active" : ""} onClick={() => { setConnectMode((value) => !value); setConnectFrom(null); }}><Link2 size={15} /></button>
        <i />
        <button type="button" title={t("inspiration.toolShowLinks")} className={showLinks ? "active" : ""} onClick={() => setShowLinks((value) => !value)}><Sparkles size={15} /></button>
        <span>{connectMode ? connectFrom ? t("inspiration.pickTarget") : t("inspiration.pickSource") : selectedLink ? t("inspiration.linkSelected") : t("inspiration.canvasHint")}</span>
      </div>

      <div
        ref={canvasRef}
        className={`inspiration-canvas ${spacePressed ? "panning" : ""}`}
        onPointerDown={startCanvasPan}
        onDoubleClick={handleCanvasDoubleClick}
        onClick={(event) => { if (event.target === event.currentTarget) setSelection(null); }}
      >
        {error && (
          <div className="inspiration-error">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")}><X size={12} /></button>
          </div>
        )}
        {conflict && (
          <div className="inspiration-conflict" role="alertdialog" aria-label={t("inspiration.conflictAria")}>
            <strong>{t("inspiration.conflictTitle")}</strong>
            <p>{t("inspiration.conflictBody")}</p>
            <div>
              <button type="button" onClick={() => void resolveConflict(false)}>{t("inspiration.loadRemote")}</button>
              <button type="button" className="primary" onClick={() => void resolveConflict(true)}>{t("inspiration.keepLocal")}</button>
              <button type="button" className="ghost" onClick={() => setConflict(false)}>{t("inspiration.later")}</button>
            </div>
          </div>
        )}
        <div className={`inspiration-dots ${showGrid ? "visible" : ""}`} />
        <div ref={worldRef} className="inspiration-world" style={{ transform: `translate(${board?.panX ?? 0}px, ${board?.panY ?? 0}px) scale(${board?.zoom ?? 1})` }}>
          <div className="inspiration-cluster">
            <span>{board?.title || t("inspiration.boardFallback")}</span>
            <i />
            {t("inspiration.materialCount", { count: board?.items.length ?? 0 })}
          </div>
          {showLinks && board && (
            <svg className="inspiration-links" viewBox="0 0 100 100" preserveAspectRatio="none">
              {board.links.map((link) => {
                const from = board.items.find((item) => item.id === link.fromItemId);
                const to = board.items.find((item) => item.id === link.toItemId);
                if (!from || !to) return null;
                const x1 = from.x + from.width / 2;
                const y1 = from.y + from.height / 2;
                const x2 = to.x + to.width / 2;
                const y2 = to.y + to.height / 2;
                const bend = Math.max(4, Math.abs(x2 - x1) * 0.35);
                const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
                const active = selectedLink?.id === link.id;
                return (
                  <g key={link.id} className={active ? "active" : ""}>
                    <path
                      className="inspiration-link-hit"
                      d={d}
                      onClick={(event) => {
                        event.stopPropagation();
                        setConnectMode(false);
                        setSelection({ type: "link", id: link.id });
                      }}
                    />
                    <path className="inspiration-link-stroke" d={d} />
                    {link.label && (
                      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 1.2} textAnchor="middle">
                        {link.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
          {(board?.items || []).map((card) => {
            const artifact = card.artifactId ? artifactById.get(card.artifactId) : undefined;
            return (
              <article
                key={card.id}
                className={`inspiration-card ${card.color || "white"} ${selection?.type === "item" && selection.id === card.id ? "selected" : ""} ${connectFrom === card.id ? "connect-source" : ""}`}
                style={{
                  left: `${card.x}%`,
                  top: `${card.y}%`,
                  width: `${card.width}%`,
                  height: `${card.height}%`,
                  zIndex: card.zIndex,
                  transform: `rotate(${card.rotation}deg)`,
                }}
                onClick={(event) => { event.stopPropagation(); handleCardClick(card); }}
                onPointerDown={(event) => startCardPointer(event, card, "move")}
              >
                <CardMedia card={card} artifact={artifact} />
                <div className="inspiration-card-copy">
                  <small>{typeLabel(card.kind, t)}</small>
                  <h3>{card.title}</h3>
                  <p>{card.note}</p>
                </div>
                <button
                  type="button"
                  className="inspiration-card-delete"
                  title={t("inspiration.deleteCard")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); removeItem(card.id); }}
                >
                  <X size={12} />
                </button>
                <span className="inspiration-resize" onPointerDown={(event) => startCardPointer(event, card, "resize")} />
              </article>
            );
          })}
        </div>

        {!board?.items.length && (
          <div className="inspiration-empty">
            <Lightbulb size={24} />
            <h3>{t("inspiration.emptyTitle")}</h3>
            <p>{t("inspiration.emptyHint")}</p>
            <button type="button" onClick={() => addItem("note")}><Plus size={13} /> {t("inspiration.createNote")}</button>
          </div>
        )}

        {assetPicker && (
          <div className="inspiration-asset-picker">
            <header>
              <div>
                <strong>{t("inspiration.addProjectAssets")}</strong>
                <span>{detail?.package.title || t("inspiration.selectProjectFirst")}</span>
              </div>
              <button type="button" onClick={() => setAssetPicker(null)}><X size={14} /></button>
            </header>
            <label>
              <select value={assetPicker} onChange={(event) => setAssetPicker(event.target.value as PickerKind)}>
                <option value="all">{t("inspiration.allAssets")}</option>
                <option value="visual">{t("inspiration.visualAssets")}</option>
                <option value="audio">{t("inspiration.audioAssets")}</option>
              </select>
            </label>
            <div>
              {assets.map((artifact) => (
                <button type="button" key={artifact.id} onClick={() => addArtifact(artifact.id)}>
                  <span className={artifact.kind}>
                    {artifact.kind === "audio" ? <Music2 size={13} /> : artifact.kind === "image" || artifact.kind === "video" ? <Image size={13} /> : <FileText size={13} />}
                  </span>
                  <div>
                    <strong>{artifact.displayName}</strong>
                    <small>{artifact.summary || artifact.role || artifact.kind}</small>
                  </div>
                  <Plus size={13} />
                </button>
              ))}
              {!assets.length && <p>{t("inspiration.noSuchAssets")}</p>}
            </div>
          </div>
        )}

        {selectedItem && (
          <aside className="inspiration-editor">
            <header>
              <div>
                <small>{t("inspiration.editMaterial")}</small>
                <strong>{typeLabel(selectedItem.kind, t)}</strong>
              </div>
              <button type="button" onClick={() => setSelection(null)}><X size={13} /></button>
            </header>
            <label>
              <span>{t("common.title")}</span>
              <input value={selectedItem.title} onChange={(event) => patchItem(selectedItem.id, { title: event.target.value })} />
            </label>
            <label>
              <span>{t("inspiration.noteField")}</span>
              <textarea rows={4} value={selectedItem.note ?? ""} onChange={(event) => patchItem(selectedItem.id, { note: event.target.value })} />
            </label>
            <label>
              <span>{t("inspiration.color")}</span>
              <div className="inspiration-color-row">
                {CARD_COLORS.map((color) => (
                  <button
                    type="button"
                    aria-label={color}
                    key={color}
                    className={`${color} ${selectedItem.color === color ? "active" : ""}`}
                    onClick={() => patchItem(selectedItem.id, { color })}
                  />
                ))}
              </div>
            </label>
            <label>
              <span>{t("inspiration.rotation", { deg: selectedItem.rotation.toFixed(1) })}</span>
              <input
                type="range"
                min="-5"
                max="5"
                step="0.5"
                value={selectedItem.rotation}
                onChange={(event) => patchItem(selectedItem.id, { rotation: Number(event.target.value) })}
              />
            </label>
            {selectedItem.artifactId && (
              <div className="inspiration-source-row">
                <p className="inspiration-source">
                  {t("inspiration.linked", { name: selectedArtifact?.displayName || selectedItem.artifactId })}
                </p>
                {onOpenArtifact && (
                  <button type="button" className="inspiration-open-artifact" onClick={openLinkedArtifact}>
                    <ExternalLink size={13} /> {t("inspiration.openAssetDetail")}
                  </button>
                )}
              </div>
            )}
            <button type="button" className="danger" onClick={() => removeItem(selectedItem.id)}>
              <Trash2 size={13} /> {t("inspiration.deleteMaterial")}
            </button>
          </aside>
        )}

        {selectedLink && (
          <aside className="inspiration-editor">
            <header>
              <div>
                <small>{t("inspiration.editLink")}</small>
                <strong>{t("inspiration.cardRelation")}</strong>
              </div>
              <button type="button" onClick={() => setSelection(null)}><X size={13} /></button>
            </header>
            <label>
              <span>{t("inspiration.type")}</span>
              <select
                value={selectedLink.kind}
                onChange={(event) => patchLink(selectedLink.id, { kind: event.target.value })}
              >
                {LINK_KIND_IDS.map((id) => (
                  <option key={id} value={id}>{t(LINK_KIND_KEYS[id])}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("inspiration.label")}</span>
              <input
                value={selectedLink.label ?? ""}
                placeholder={t("inspiration.labelPlaceholder")}
                onChange={(event) => patchLink(selectedLink.id, { label: event.target.value || undefined })}
              />
            </label>
            <button type="button" className="danger" onClick={() => removeLink(selectedLink.id)}>
              <Trash2 size={13} /> {t("inspiration.deleteLink")}
            </button>
          </aside>
        )}

        <div className="inspiration-help">{t("inspiration.help")}</div>
        <div className="inspiration-zoom">
          <button type="button" onClick={() => commitBoard((current) => ({ ...current, zoom: Math.max(0.5, Number((current.zoom - 0.1).toFixed(2))) }))}><ZoomOut size={14} /></button>
          <span>{zoom}%</span>
          <button type="button" onClick={() => commitBoard((current) => ({ ...current, zoom: Math.min(1.6, Number((current.zoom + 0.1).toFixed(2))) }))}><ZoomIn size={14} /></button>
          <i />
          <button type="button" className={showGrid ? "active" : ""} onClick={() => setShowGrid((value) => !value)}><Grid3X3 size={14} /></button>
        </div>
      </div>
    </div>
  );
}
