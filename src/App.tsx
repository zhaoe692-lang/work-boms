import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getLibrary,
  getPackageDetail,
  importPackage,
  relocateArtifactFile,
  syncLibraryWatchers,
  updateArtifactStatus,
  updateArtifactMeta,
  batchUpdateArtifactStatus,
  addRelation,
  removeRelation,
  updateRelationKind,
  setWorkMembership,
  updatePackageMeta,
  removePackage,
  moveArtifactsToTrash,
  restoreTrashItems,
  exportPackage,
  renameArtifact,
  importArtifactFile,
  createWork,
  renameWork,
  deleteWork,
  mergeIdentities,
  splitIdentity,
  setIdentityHead,
  acceptSuggestedRelation,
  rejectSuggestedRelation,
} from "./shared/api";
import { openFileWithDefaultApp, revealFileInFinder } from "./shared/files";
import { buildPartOfForest, looseArtifactIds } from "./shared/bom";
import { buildDisplayEdges } from "./shared/graph";
import type {
  AppView,
  ArtifactStatus,
  ArtifactView,
  LibraryState,
  PackageDetail,
  PackageSummary,
  RelationKind,
  SearchHit,
} from "./shared/types";
import { Cockpit } from "./components/Cockpit";
import { GravityFluidGraph3D } from "./components/GravityFluidGraph3D";
import { useGraphAppearanceState, GraphAppearancePanel } from "./components/GraphAppearancePanel";
import { GraphInfoPanel } from "./components/GraphInfoPanel";
import { Inspector } from "./components/Inspector";
import { AppSidebar } from "./components/AppSidebar";
import { SmartSearchView } from "./components/SmartSearchView";
import { AssetsTableView } from "./components/AssetsTableView";
import { InspirationBoardView } from "./components/InspirationBoardView";
import { TrashView } from "./components/TrashView";
import { PluginMarketplaceView } from "./components/PluginMarketplaceView";
import { ENABLE_INSPIRATION_BOARD } from "./shared/featureFlags";
import {
  buildGraphInfoModel,
} from "./shared/graphInfoModel";
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "./components/ui/sidebar";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceLayout } from "./shared/useWorkspaceLayout";
import { InlineRename } from "./components/InlineRename";
import { useI18n } from "./shared/i18n";
import { formatInvokeError } from "./shared/invokeError";
import "./App.css";

export default function App() {
  const { t, locale } = useI18n();
  const [view, setView] = useState<AppView>("home");
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
    null,
  );
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [relocating, setRelocating] = useState(false);
  const { settings: graphAppearance, setSettings: setGraphAppearance } =
    useGraphAppearanceState();
  const { inspectorW, beginResize } = useWorkspaceLayout();
  /** When true, right panel switches from 图谱信息 → Inspector detail */
  const [graphShowInspector, setGraphShowInspector] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [metaUpdating, setMetaUpdating] = useState(false);
  const [relationUpdating, setRelationUpdating] = useState(false);
  const [undoHint, setUndoHint] = useState<string | null>(null);
  const undoRef = useRef<null | (() => Promise<void>)>(null);
  const [exporting, setExporting] = useState(false);
  const [graphRelationKinds, setGraphRelationKinds] = useState<string[]>([
    "part_of",
    "uses",
    "references",
    "derived_from",
    "pairs_with",
    "version",
  ]);
  const refreshLibrary = useCallback(async () => {
    const state = await getLibrary();
    setLibrary(state);
    void syncLibraryWatchers().catch(() => {});
    return state;
  }, []);

  const loadDetail = useCallback(async (packageId: string) => {
    const data = await getPackageDetail(packageId);
    setDetail(data);
    return data;
  }, []);

  useEffect(() => {
    refreshLibrary().catch((e) => setError(String(e)));
  }, [refreshLibrary]);

  useEffect(() => {
    if (!selectedPackageId) {
      setDetail(null);
      return;
    }
    setGraphShowInspector(false);
    loadDetail(selectedPackageId).catch((e) => setError(String(e)));
  }, [selectedPackageId, loadDetail]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ packageId: string }>("package-reindexed", (event) => {
      const packageId = event.payload?.packageId;
      if (!packageId) return;
      if (packageId === selectedPackageId) {
        void loadDetail(packageId).catch((e) => setError(String(e)));
      }
      void refreshLibrary().catch(() => {});
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [selectedPackageId, loadDetail, refreshLibrary]);

  const selectedArtifact = useMemo(
    () => detail?.artifacts.find((a) => a.id === selectedArtifactId) ?? null,
    [detail, selectedArtifactId],
  );

  const artifactById = useMemo(() => {
    return new Map((detail?.artifacts ?? []).map((a) => [a.id, a]));
  }, [detail]);

  const bomForest = useMemo(() => {
    if (!detail) return [];
    return buildPartOfForest(detail.identities, detail.relations);
  }, [detail]);

  const looseArtifacts = useMemo(() => {
    if (!detail) return [];
    const looseIds = new Set(
      looseArtifactIds(detail.artifacts, detail.identities, detail.relations),
    );
    return detail.artifacts.filter((a) => looseIds.has(a.id));
  }, [detail]);

  const displayEdges = useMemo(() => {
    if (!detail) return [];
    return buildDisplayEdges(detail.artifacts, detail.relations, detail.identities);
  }, [detail]);

  const graphRelationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const edge of displayEdges) counts[edge.kind] = (counts[edge.kind] ?? 0) + 1;
    return counts;
  }, [displayEdges]);

  const graphInfoModel = useMemo(() => {
    if (!detail) return null;
    return buildGraphInfoModel(detail.artifacts, displayEdges, locale);
  }, [detail, displayEdges, locale]);

  async function handleImport() {
    try {
      setBusy(true);
      setError("");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("app.pickWbomDir"),
      });
      if (!selected) return;
      const path = typeof selected === "string" ? selected : selected;
      const summary = await importPackage(path);
      const state = await refreshLibrary();
      setSelectedPackageId(summary.id);
      setSelectedArtifactId(null);
      setView("artifacts");
      if (!state.packages.find((p) => p.id === summary.id)) {
        await loadDetail(summary.id);
      }
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setBusy(false);
    }
  }

  function selectPackage(pkg: PackageSummary) {
    // Keep current view (graph / assets / …); never bounce back to cockpit.
    if (pkg.id === selectedPackageId) return;
    setSelectedPackageId(pkg.id);
    setSelectedArtifactId(null);
  }

  function selectArtifact(artifact: ArtifactView, packageId?: string) {
    if (packageId && packageId !== selectedPackageId) {
      setSelectedPackageId(packageId);
    }
    setSelectedArtifactId(artifact.id);
  }

  function selectSearchHit(hit: SearchHit) {
    setSelectedPackageId(hit.packageId);
    setSelectedArtifactId(hit.artifactId);
    // Stay in the current workspace; only leave trash (no package context).
    if (view === "trash" || view === "plugins") setView("home");
  }

  async function handleMoveToTrash(artifact: ArtifactView) {
    if (!selectedPackageId) return;
    if (
      !window.confirm(
        t("app.confirmTrashArtifact", { name: artifact.displayName }),
      )
    )
      return;
    const packageId = selectedPackageId;
    try {
      setMetaUpdating(true);
      setError("");
      await moveArtifactsToTrash(packageId, [artifact.id], t("common.you"));
      setSelectedArtifactId(null);
      await loadDetail(packageId);
      await refreshLibrary();
      undoRef.current = async () => {
        await restoreTrashItems([{ packageId, artifactId: artifact.id }]);
        await loadDetail(packageId);
        await refreshLibrary();
        setSelectedArtifactId(artifact.id);
      };
      setUndoHint(t("app.undoTrash"));
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setMetaUpdating(false);
    }
  }

  async function handleRelocate(artifact: ArtifactView) {
    if (!selectedPackageId) return;
    try {
      setRelocating(true);
      setError("");
      const selected = await open({
        multiple: false,
        title: t("app.pickFileLocation"),
      });
      if (!selected) return;
      const path = typeof selected === "string" ? selected : selected;
      const updated = await relocateArtifactFile(
        selectedPackageId,
        artifact.id,
        path,
      );
      setDetail(updated);
      await refreshLibrary();
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setRelocating(false);
    }
  }

  async function handleStatusChange(
    artifact: ArtifactView,
    status: ArtifactStatus,
  ) {
    if (!selectedPackageId) return;
    const prev = artifact.status;
    if (prev === status) return;

    // Optimistic UI — don't wait on IPC for the visible status flip.
    setDetail((current) => {
      if (!current) return current;
      const artifacts = current.artifacts.map((item) =>
        item.id === artifact.id ? { ...item, status } : item,
      );
      const finalCount = artifacts.filter((item) => item.status === "final").length;
      return {
        ...current,
        artifacts,
        package: {
          ...current.package,
          stats: { ...current.package.stats, finalCount },
        },
      };
    });
    setStatusUpdating(true);
    setError("");
    setUndoHint(null);
    undoRef.current = null;

    try {
      const updated = await updateArtifactStatus(
        selectedPackageId,
        artifact.id,
        status,
      );
      setDetail(updated);
      setLibrary((current) => {
        if (!current) return current;
        return {
          ...current,
          packages: current.packages.map((pkg) =>
            pkg.id === updated.package.id ? updated.package : pkg,
          ),
        };
      });
    } catch (e) {
      setDetail((current) => {
        if (!current) return current;
        const artifacts = current.artifacts.map((item) =>
          item.id === artifact.id ? { ...item, status: prev } : item,
        );
        const finalCount = artifacts.filter((item) => item.status === "final").length;
        return {
          ...current,
          artifacts,
          package: {
            ...current.package,
            stats: { ...current.package.stats, finalCount },
          },
        };
      });
      setError(formatInvokeError(e, t));
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleSaveMeta(
    artifact: ArtifactView,
    meta: { role: string; summary: string; tags: string[] },
  ) {
    if (!selectedPackageId) return;
    try {
      setMetaUpdating(true);
      setError("");
      const updated = await updateArtifactMeta(selectedPackageId, artifact.id, {
        role: meta.role || null,
        summary: meta.summary || null,
        tags: meta.tags,
      });
      setDetail(updated);
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setMetaUpdating(false);
    }
  }

  async function handleAddRelation(
    from: string,
    to: string,
    kind: RelationKind,
  ) {
    if (!selectedPackageId) return;
    try {
      setRelationUpdating(true);
      setError("");
      const updated = await addRelation(selectedPackageId, from, to, kind);
      setDetail(updated);
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setRelationUpdating(false);
    }
  }

  async function handleRemoveRelation(relationId: string) {
    if (!selectedPackageId) return;
    try {
      setRelationUpdating(true);
      setError("");
      const updated = await removeRelation(selectedPackageId, relationId);
      setDetail(updated);
      setUndoHint(t("app.undoRelationRemoved"));
      undoRef.current = null;
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setRelationUpdating(false);
    }
  }

  async function handleUpdateRelationKind(
    relationId: string,
    kind: RelationKind,
    label?: string | null,
  ) {
    if (!selectedPackageId) return;
    try {
      setRelationUpdating(true);
      setError("");
      const updated = await updateRelationKind(
        selectedPackageId,
        relationId,
        kind,
        label,
      );
      setDetail(updated);
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setRelationUpdating(false);
    }
  }

  async function handleRenameArtifact(artifact: ArtifactView, displayName: string) {
    if (!selectedPackageId) return;
    try {
      setMetaUpdating(true);
      setError("");
      const updated = await renameArtifact(
        selectedPackageId,
        artifact.id,
        displayName,
      );
      setDetail(updated);
      await refreshLibrary();
    } catch (e) {
      setError(formatInvokeError(e, t));
      throw e;
    } finally {
      setMetaUpdating(false);
    }
  }

  async function handleImportArtifact() {
    if (!selectedPackageId) return;
    try {
      setBusy(true);
      setError("");
      const selected = await open({
        multiple: false,
        title: t("app.pickImportFiles"),
      });
      if (!selected) return;
      const path = typeof selected === "string" ? selected : selected;
      const updated = await importArtifactFile(selectedPackageId, path);
      setDetail(updated);
      await refreshLibrary();
      setUndoHint(t("app.undoImported"));
      setView("assets");
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateWork(title: string) {
    if (!selectedPackageId) return;
    try {
      setMetaUpdating(true);
      const updated = await createWork(selectedPackageId, title);
      const created =
        updated.works.find((work) => work.title === title) ??
        updated.works[updated.works.length - 1];
      if (selectedArtifactId && created) {
        setDetail(
          await setWorkMembership(
            selectedPackageId,
            created.id,
            selectedArtifactId,
            true,
          ),
        );
      } else {
        setDetail(updated);
      }
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setMetaUpdating(false);
    }
  }

  async function handleRenameWork(workId: string, title: string) {
    if (!selectedPackageId) return;
    try {
      setMetaUpdating(true);
      const updated = await renameWork(selectedPackageId, workId, title);
      setDetail(updated);
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setMetaUpdating(false);
    }
  }

  async function handleDeleteWork(workId: string) {
    if (!selectedPackageId) return;
    try {
      setMetaUpdating(true);
      const updated = await deleteWork(selectedPackageId, workId);
      setDetail(updated);
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setMetaUpdating(false);
    }
  }

  async function handleMergeIdentity(keepId: string, absorbId: string) {
    if (!selectedPackageId) return;
    try {
      setMetaUpdating(true);
      setError("");
      const updated = await mergeIdentities(selectedPackageId, keepId, absorbId);
      setDetail(updated);
      setUndoHint(t("app.undoMerged"));
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setMetaUpdating(false);
    }
  }

  async function handleSplitIdentity(
    identityId: string,
    artifactIds: string[],
    newDisplayName: string,
  ) {
    if (!selectedPackageId) return;
    try {
      setMetaUpdating(true);
      setError("");
      const updated = await splitIdentity(
        selectedPackageId,
        identityId,
        artifactIds,
        newDisplayName,
      );
      setDetail(updated);
      setUndoHint(t("app.undoSplit"));
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setMetaUpdating(false);
    }
  }

  async function handleSetIdentityHead(identityId: string, headVersionId: string) {
    if (!selectedPackageId) return;
    try {
      setMetaUpdating(true);
      const updated = await setIdentityHead(
        selectedPackageId,
        identityId,
        headVersionId,
      );
      setDetail(updated);
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setMetaUpdating(false);
    }
  }

  async function handleAcceptSuggestion(
    from: string,
    to: string,
    kind: RelationKind,
    label?: string | null,
  ) {
    if (!selectedPackageId) return;
    try {
      setRelationUpdating(true);
      setError("");
      const updated = await acceptSuggestedRelation(
        selectedPackageId,
        from,
        to,
        kind,
        label,
      );
      setDetail(updated);
      setUndoHint(t("app.undoAccepted"));
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setRelationUpdating(false);
    }
  }

  async function handleRejectSuggestion(from: string, to: string) {
    if (!selectedPackageId) return;
    try {
      setRelationUpdating(true);
      setError("");
      const updated = await rejectSuggestedRelation(selectedPackageId, from, to);
      setDetail(updated);
      setUndoHint(t("app.undoRejected"));
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setRelationUpdating(false);
    }
  }

  async function handleSetWork(workId: string, include: boolean) {
    if (!selectedPackageId || !selectedArtifactId) return;
    try {
      setMetaUpdating(true);
      setError("");
      const updated = await setWorkMembership(
        selectedPackageId,
        workId,
        selectedArtifactId,
        include,
      );
      setDetail(updated);
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setMetaUpdating(false);
    }
  }

  async function handleUpdatePackageMeta(title: string, summary: string) {
    if (!selectedPackageId) return;
    try {
      setError("");
      const updated = await updatePackageMeta(
        selectedPackageId,
        title,
        summary || null,
      );
      setDetail(updated);
      await refreshLibrary();
    } catch (e) {
      setError(formatInvokeError(e, t));
      throw e;
    }
  }

  async function handleRemovePackage(packageId?: string) {
    const id = packageId ?? selectedPackageId;
    if (!id) return;
    const title =
      (id === selectedPackageId ? detail?.package.title : null) ??
      library?.packages.find((p) => p.id === id)?.title ??
      id;
    if (!window.confirm(t("app.confirmRemovePackage", { name: title }))) {
      return;
    }
    try {
      setError("");
      await removePackage(id);
      if (selectedPackageId === id) {
        setSelectedPackageId(null);
        setDetail(null);
        setSelectedArtifactId(null);
        setView("home");
      }
      await refreshLibrary();
    } catch (e) {
      setError(formatInvokeError(e, t));
    }
  }

  async function handleMovePackageToTrash(packageId?: string) {
    const id = packageId ?? selectedPackageId;
    if (!id) return;
    try {
      setBusy(true);
      setError("");
      const pkgDetail =
        id === selectedPackageId && detail
          ? detail
          : await getPackageDetail(id);
      if (!pkgDetail.artifacts.length) return;
      if (
        !window.confirm(
          t("app.confirmTrashPackage", {
            name: pkgDetail.package.title,
            count: pkgDetail.artifacts.length,
          }),
        )
      )
        return;
      const artifactIds = pkgDetail.artifacts.map((artifact) => artifact.id);
      await moveArtifactsToTrash(id, artifactIds, t("common.you"));
      if (selectedPackageId === id) {
        setSelectedArtifactId(null);
        setSelectedPackageId(null);
        setDetail(null);
      }
      await refreshLibrary();
      undoRef.current = async () => {
        await restoreTrashItems(
          artifactIds.map((artifactId) => ({ packageId: id, artifactId })),
        );
        setSelectedPackageId(id);
        await refreshLibrary();
      };
      setUndoHint(t("app.undoTrashPackage"));
      setView("trash");
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function handleExportPackage() {
    if (!selectedPackageId || !detail) return;
    try {
      setExporting(true);
      setError("");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("app.pickExportDir"),
      });
      if (!selected) return;
      const parent = typeof selected === "string" ? selected : selected;
      const folderName = `${detail.package.slug || detail.package.title || "package"}.wbom`;
      const target = `${parent.replace(/\/$/, "")}/${folderName}`;
      const path = await exportPackage(selectedPackageId, target);
      setUndoHint(t("app.undoExported", { path }));
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setExporting(false);
    }
  }

  async function handleBatchStatus(ids: string[], status: ArtifactStatus) {
    if (!selectedPackageId || !ids.length) return;
    try {
      setStatusUpdating(true);
      setError("");
      const next = await batchUpdateArtifactStatus(selectedPackageId, ids, status);
      setDetail(next);
      setLibrary((current) => {
        if (!current) return current;
        return {
          ...current,
          packages: current.packages.map((pkg) =>
            pkg.id === next.package.id ? next.package : pkg,
          ),
        };
      });
    } catch (e) {
      setError(formatInvokeError(e, t));
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleUndo() {
    const fn = undoRef.current;
    if (!fn) return;
    try {
      await fn();
      undoRef.current = null;
      setUndoHint(null);
    } catch (e) {
      setError(formatInvokeError(e, t));
    }
  }

  async function handleOpenFile(artifact: ArtifactView) {
    if (!artifact.reachable) return;
    try {
      await openFileWithDefaultApp(artifact.absolutePath);
    } catch (e) {
      setError(formatInvokeError(e, t));
    }
  }

  async function handleRevealInFinder(artifact: ArtifactView) {
    if (!artifact.reachable) return;
    try {
      await revealFileInFinder(artifact.absolutePath);
    } catch (e) {
      setError(formatInvokeError(e, t));
    }
  }

  const graphCenterId =
    selectedArtifactId ?? detail?.artifacts[0]?.id ?? null;

  const isCockpit = view === "home" && !!detail;
  const hideInspector =
    isCockpit ||
    view === "artifacts" ||
    view === "assets" ||
    view === "finals" ||
    view === "trash" ||
    view === "plugins";
  const showGraphInfo =
    view === "graph" && !graphShowInspector && !!graphInfoModel;

  /** Project drawer width (activity bar is fixed 48px). */
  const [projectPanelWidth, setProjectPanelWidth] = useState(220);
  const sidebarDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const ACTIVITY_BAR_W = 48;

  const onSidebarResizeDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    sidebarDragRef.current = { startX: e.clientX, startW: projectPanelWidth };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.classList.add("resizing-panels");
  };
  const onSidebarResizeMove = (e: ReactPointerEvent) => {
    const drag = sidebarDragRef.current;
    if (!drag) return;
    const next = Math.min(360, Math.max(180, drag.startW + (e.clientX - drag.startX)));
    setProjectPanelWidth(next);
  };
  const onSidebarResizeUp = () => {
    sidebarDragRef.current = null;
    document.body.classList.remove("resizing-panels");
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${ACTIVITY_BAR_W + projectPanelWidth}px`,
          "--sidebar-width-icon": `${ACTIVITY_BAR_W}px`,
          "--app-top-band": "38px",
        } as CSSProperties
      }
    >
      {/* One continuous top rule across sidebar + main (under traffic lights). */}
      <div className="app-top-rule" aria-hidden />
      <AppSidebar
        library={library}
        detail={detail}
        view={view}
        onViewChange={setView}
        selectedPackageId={selectedPackageId}
        onSelectPackage={selectPackage}
        bomForest={bomForest}
        looseArtifacts={looseArtifacts}
        artifactById={artifactById}
        selectedArtifactId={selectedArtifactId}
        onSelectArtifact={selectArtifact}
        onSelectSearchHit={selectSearchHit}
        onImport={handleImport}
        importing={busy}
        onUpdatePackageMeta={handleUpdatePackageMeta}
        onRemovePackage={handleRemovePackage}
        onMovePackageToTrash={handleMovePackageToTrash}
      />
      <SidebarInset className="app-shell-inset">
        <SidebarEdgeResizer
          onPointerDown={onSidebarResizeDown}
          onPointerMove={onSidebarResizeMove}
          onPointerUp={onSidebarResizeUp}
          onPointerCancel={onSidebarResizeUp}
        />
        <header className="titlebar" data-tauri-drag-region>
          <div className="title-left" data-tauri-drag-region aria-hidden />
          <div className="title">
            {detail ? (
              <InlineRename
                value={detail.package.title}
                title={t("app.renameProject")}
                placeholder={t("app.projectName")}
                onCommit={async (title) => {
                  await handleUpdatePackageMeta(title, detail.package.summary ?? "");
                }}
                className="inline-rename-trigger titlebar-rename"
                inputClassName="inline-rename-input titlebar-rename-input"
              />
            ) : (
              <span className="titlebar-static">WorkBOM</span>
            )}
          </div>
          <div className="title-right" data-tauri-drag-region aria-hidden />
        </header>

        <div
          className={`app-main ${view === "graph" ? "graph-view" : ""} ${
            isCockpit ? "cockpit-view" : ""
          }`}
        >
          <main
            className={`main-panel app-col ${view === "graph" ? "graph-view" : ""} ${
              isCockpit ? "cockpit-view" : ""
            }`}
          >
            {error && <div className="banner error">{error}</div>}
            {undoHint && (
              <div className="banner undo">
                <span>{undoHint}</span>
                {undoRef.current && (
                  <button type="button" className="tool-btn ghost" onClick={() => void handleUndo()}>
                    {t("common.undo")}
                  </button>
                )}
                <button
                  type="button"
                  className="tool-btn ghost"
                  onClick={() => {
                    setUndoHint(null);
                    undoRef.current = null;
                  }}
                >
                  {t("common.close")}
                </button>
              </div>
            )}

          {view === "home" &&
            (detail ? (
              <Cockpit
                detail={detail}
                edges={displayEdges}
                selectedArtifact={selectedArtifact}
                onSelectArtifact={(id) => setSelectedArtifactId(id)}
                onStatusChange={handleStatusChange}
                statusUpdating={statusUpdating}
                metaUpdating={metaUpdating}
                relationUpdating={relationUpdating}
                onOpenFile={handleOpenFile}
                onRevealInFinder={handleRevealInFinder}
                onRelocate={handleRelocate}
                relocating={relocating}
                onSaveMeta={handleSaveMeta}
                onAddRelation={handleAddRelation}
                onRemoveRelation={handleRemoveRelation}
                onUpdateRelationKind={handleUpdateRelationKind}
                onSetWork={handleSetWork}
                onRename={handleRenameArtifact}
                onRenamePackage={(title) =>
                  void handleUpdatePackageMeta(title, detail.package.summary ?? "")
                }
                onCreateWork={handleCreateWork}
                onRenameWork={handleRenameWork}
                onDeleteWork={handleDeleteWork}
                onMergeIdentity={handleMergeIdentity}
                onSplitIdentity={handleSplitIdentity}
                onSetIdentityHead={handleSetIdentityHead}
                onAcceptSuggestion={handleAcceptSuggestion}
                onRejectSuggestion={handleRejectSuggestion}
                onMoveToTrash={handleMoveToTrash}
                onDetailUpdated={setDetail}
              />
            ) : (
              <HomeView
                library={library}
                onImport={handleImport}
                onSelectPackage={selectPackage}
              />
            ))}

          {view === "artifacts" && (
            <SmartSearchView
              detail={detail}
              query={search}
              onQueryChange={setSearch}
              onOpenArtifact={selectSearchHit}
            />
          )}

          {view === "assets" && (
            <AssetsTableView
              detail={detail}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={(id) => {
                setSelectedArtifactId(id);
              }}
              onBatchStatus={handleBatchStatus}
              statusUpdating={statusUpdating}
              onExportPackage={() => void handleExportPackage()}
              exporting={exporting}
              onImportArtifact={() => void handleImportArtifact()}
              importing={busy}
            />
          )}

          {ENABLE_INSPIRATION_BOARD && view === "finals" && (
            <InspirationBoardView
              detail={detail}
              onOpenArtifact={(packageId, artifactId) => {
                setSelectedPackageId(packageId);
                setSelectedArtifactId(artifactId);
                setGraphShowInspector(true);
                setView("graph");
              }}
            />
          )}

          {view === "trash" && <TrashView library={library} onLibraryChanged={refreshLibrary} />}

          {view === "plugins" && <PluginMarketplaceView />}

          {view === "graph" && detail && (
            <div className="graph-panel">
              <div className="graph-stage">
                <div className="graph-stage-header">
                  <div
                    className="graph-stage-filter-status"
                    title={
                      graphRelationKinds.length >= 6
                        ? t("graph.allRelations.hint")
                        : t("graph.filterPartial.hint")
                    }
                  >
                    <span>
                      {graphRelationKinds.length >= 6
                        ? t("graph.allRelations")
                        : t("graph.filterPartial", {
                            active: graphRelationKinds.length,
                            total: 6,
                          })}
                    </span>
                    <strong>
                      {(graphRelationKinds.length >= 6
                        ? Object.values(graphRelationCounts).reduce((a, b) => a + b, 0)
                        : graphRelationKinds.reduce(
                            (sum, kind) => sum + (graphRelationCounts[kind] ?? 0),
                            0,
                          )
                      ).toLocaleString()}
                    </strong>
                  </div>
                  <p className="graph-stage-hint">{t("gravity.hintDrag")}</p>
                  <div className="graph-stage-header-end">
                    <GraphAppearancePanel
                      settings={graphAppearance}
                      onChange={setGraphAppearance}
                      relationKinds={graphRelationKinds}
                      onRelationKindsChange={setGraphRelationKinds}
                      counts={graphRelationCounts}
                    />
                  </div>
                </div>
                <GravityFluidGraph3D
                  packageId={detail.package.id}
                  artifacts={detail.artifacts}
                  relations={detail.relations}
                  relationKinds={graphRelationKinds}
                  identities={detail.identities}
                  centerId={graphCenterId}
                  selectedId={selectedArtifactId}
                  appearance={graphAppearance}
                  onSelect={(id) => setSelectedArtifactId(id)}
                  onOpenDetail={(id) => {
                    setSelectedArtifactId(id);
                    setGraphShowInspector(true);
                  }}
                />
              </div>
            </div>
          )}

          {view === "graph" && !detail && (
            <div className="empty-state">
              <p>{t("app.selectPackage")}</p>
            </div>
          )}
          </main>

          {!hideInspector && (
            <>
              <div
                className="panel-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label={t("app.resizeInspector")}
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  beginResize("inspector", e.clientX);
                }}
              />

              <div className="inspector-host" style={{ width: inspectorW }}>
                {showGraphInfo && graphInfoModel && detail ? (
                  <GraphInfoPanel
                    model={graphInfoModel}
                    artifacts={detail.artifacts}
                    relationCounts={graphRelationCounts}
                    relationColors={graphAppearance.edges}
                    onSelectArtifact={(id) => setSelectedArtifactId(id)}
                  />
                ) : (
                  <>
                    {view === "graph" && graphShowInspector && (
                      <div className="graph-info-back">
                        <button
                          type="button"
                          className="tool-btn ghost"
                          onClick={() => setGraphShowInspector(false)}
                        >
                          ← {t("app.graphInfo")}
                        </button>
                      </div>
                    )}
                    <Inspector
                      detail={detail}
                      artifact={selectedArtifact}
                      edges={displayEdges}
                      onRelocate={handleRelocate}
                      relocating={relocating}
                      onStatusChange={handleStatusChange}
                      statusUpdating={statusUpdating}
                      metaUpdating={metaUpdating}
                      relationUpdating={relationUpdating}
                      onOpenFile={handleOpenFile}
                      onRevealInFinder={handleRevealInFinder}
                      onSelectArtifact={(id) => setSelectedArtifactId(id)}
                      onSaveMeta={handleSaveMeta}
                      onAddRelation={handleAddRelation}
                      onRemoveRelation={handleRemoveRelation}
                      onUpdateRelationKind={handleUpdateRelationKind}
                      onSetWork={handleSetWork}
                      onRename={handleRenameArtifact}
                      onCreateWork={handleCreateWork}
                      onRenameWork={handleRenameWork}
                      onDeleteWork={handleDeleteWork}
                      onMergeIdentity={handleMergeIdentity}
                      onSplitIdentity={handleSplitIdentity}
                      onSetIdentityHead={handleSetIdentityHead}
                      onAcceptSuggestion={handleAcceptSuggestion}
                      onRejectSuggestion={handleRejectSuggestion}
                      onMoveToTrash={handleMoveToTrash}
                      onDetailUpdated={setDetail}
                      readOnly={view === "graph"}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="statusbar">
          <span>
            {t("app.statusbarPackages", {
              count: library?.packages.length ?? 0,
            })}
          </span>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}

function SidebarEdgeResizer({
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}) {
  const { t } = useI18n();
  const { state } = useSidebar();
  if (state === "collapsed") return null;
  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("app.resizeSidebar")}
      title={t("app.dragResize")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span className="sidebar-resizer-line" aria-hidden />
      <span className="sidebar-resizer-grip" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function HomeView({
  library,
  onImport,
  onSelectPackage,
}: {
  library: LibraryState | null;
  onImport: () => void;
  onSelectPackage: (pkg: PackageSummary) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="home-view">
      <section className="hero">
        <h1>{t("app.homeTitle")}</h1>
        <p>
          {t("app.homeLeadPrefix")} <code>.wbom</code> {t("app.homeLeadSuffix")}
        </p>
        <button type="button" className="tool-btn primary" onClick={onImport}>
          {t("app.importFirst")}
        </button>
      </section>

      {!!library?.packages.length && (
        <section>
          <h2>{t("app.recentPackages")}</h2>
          <div className="card-grid">
            {library.packages.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                className="summary-card"
                onClick={() => onSelectPackage(pkg)}
              >
                <h3>{pkg.title}</h3>
                <p className="muted">{pkg.summary ?? pkg.domain ?? pkg.slug}</p>
                <div className="stats-row">
                  <span>
                    {t("app.statArtifacts", { count: pkg.stats.artifactCount })}
                  </span>
                  <span>
                    {t("app.statFinals", { count: pkg.stats.finalCount })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
