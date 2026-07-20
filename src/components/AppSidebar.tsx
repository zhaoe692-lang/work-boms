import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  Network,
  Search,
  Sparkles,
  Trash2,
  Puzzle,
  Settings,
  ChevronRight,
  ChevronDown,
  FileText,
  Package,
  Image as ImageIcon,
  Music,
  FolderTree,
  X,
  ChevronsUpDown,
  ChevronsDownUp,
  Crosshair,
  MoreVertical,
  Minus,
  Plus,
} from "lucide-react";
import {
  buildPartOfForest,
  looseArtifactIds,
  type BomNode,
} from "@/shared/bom";
import { getPackageDetail, searchArtifacts } from "@/shared/api";
import type {
  AppView,
  ArtifactKind,
  ArtifactView,
  LibraryState,
  PackageDetail,
  PackageSummary,
  SearchHit,
} from "@/shared/types";
import { kindLabel } from "@/shared/utils";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ENABLE_INSPIRATION_BOARD } from "@/shared/featureFlags";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { SettingsModal } from "@/components/SettingsModal";
import appIcon from "@/assets/workbom-app-icon.png";

interface AppSidebarProps {
  library: LibraryState | null;
  detail: PackageDetail | null;
  view: AppView;
  onViewChange: (v: AppView) => void;
  selectedPackageId: string | null;
  onSelectPackage: (pkg: PackageSummary) => void;
  bomForest: BomNode[];
  looseArtifacts: ArtifactView[];
  artifactById: Map<string, ArtifactView>;
  selectedArtifactId: string | null;
  onSelectArtifact: (a: ArtifactView, packageId?: string) => void;
  onSelectSearchHit?: (hit: SearchHit) => void;
  onImport: () => void;
  importing?: boolean;
  onUpdatePackageMeta?: (title: string, summary: string) => void;
  onRemovePackage?: (packageId?: string) => void;
  onMovePackageToTrash?: (packageId?: string) => void;
}

/** Workspace views (middle rail). Labels resolved via t() inside the component. */
const NAV_ITEMS: { id: AppView; labelKey: MessageKey; icon: typeof LayoutDashboard }[] = [
  { id: "home", labelKey: "nav.home", icon: LayoutDashboard },
  { id: "graph", labelKey: "nav.graph", icon: Network },
  { id: "artifacts", labelKey: "nav.search", icon: Search },
  { id: "assets", labelKey: "nav.assets", icon: Package },
  ...(ENABLE_INSPIRATION_BOARD
    ? [{ id: "finals" as AppView, labelKey: "nav.finals" as MessageKey, icon: Sparkles }]
    : []),
];

function kindIcon(kind: ArtifactKind) {
  switch (kind) {
    case "markdown":
      return FileText;
    case "image":
      return ImageIcon;
    case "audio":
      return Music;
    default:
      return Package;
  }
}

function RailTip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" align="center">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Cursor-style left chrome:
 * - activity bar (icons) always visible
 * - project drawer independently open / stowed
 */
export function AppSidebar({
  library,
  detail,
  view,
  onViewChange,
  selectedPackageId,
  onSelectPackage,
  bomForest,
  looseArtifacts,
  artifactById,
  selectedArtifactId,
  onSelectArtifact,
  onSelectSearchHit,
  onImport,
  importing,
  onUpdatePackageMeta,
  onRemovePackage,
  onMovePackageToTrash,
}: AppSidebarProps) {
  const { t } = useI18n();
  const { open: projectsOpen, setOpen, toggleSidebar } = useSidebar();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [appVersion, setAppVersion] = useState("0.1.83");
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [drawerQuery, setDrawerQuery] = useState("");
  const [assetHits, setAssetHits] = useState<SearchHit[]>([]);
  const [collapseToken, setCollapseToken] = useState(0);
  const [expandToken, setExpandToken] = useState(0);
  /** One-shot Reveal in Explorer (VS Code style). */
  const [revealSignal, setRevealSignal] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  /** Autoscroll from source — follow selection changes continuously. */
  const [followOpenFile, setFollowOpenFile] = useState(() => {
    try {
      return localStorage.getItem("workboms.followOpenFile") === "1";
    } catch {
      return false;
    }
  });
  const moreRef = useRef<HTMLDivElement>(null);

  const navItems = useMemo(
    () => NAV_ITEMS.map((item) => ({ ...item, label: t(item.labelKey) })),
    [t],
  );

  useEffect(() => {
    let alive = true;
    void import("@tauri-apps/api/app")
      .then((mod) => mod.getVersion())
      .then((v) => {
        if (alive && v) setAppVersion(v);
      })
      .catch(() => {
        /* browser / non-tauri preview keeps fallback */
      });
    return () => {
      alive = false;
    };
  }, []);

  const openSettings = () => {
    if (!detail) return;
    setEditTitle(detail.package.title);
    setEditSummary(detail.package.summary ?? "");
    setSettingsOpen(true);
    setMoreOpen(false);
    setOpen(true);
  };

  const toggleFollowOpenFile = () => {
    setFollowOpenFile((on) => {
      const next = !on;
      try {
        localStorage.setItem("workboms.followOpenFile", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  /** Reveal selected artifact once: expand only its path, scroll vertically into view. */
  const revealSelectedInTree = () => {
    if (!selectedArtifactId) return;
    setOpen(true);
    setRevealSignal((n) => n + 1);
  };

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  // Scroll into view (vertical only) on follow or one-shot reveal.
  // Preserve scrollLeft so the bottom bar stays for manual pan only.
  useEffect(() => {
    if (!selectedArtifactId || !projectsOpen) return;
    if (!followOpenFile && revealSignal === 0) {
      preserveProjectDrawerScrollX();
      return;
    }
    const timer = window.setTimeout(() => {
      scrollArtifactIntoTreeView(selectedArtifactId);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [followOpenFile, selectedArtifactId, selectedPackageId, projectsOpen, revealSignal]);

  const q = drawerQuery.trim().toLowerCase();

  useEffect(() => {
    if (!q) {
      setAssetHits([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      searchArtifacts(drawerQuery.trim(), 24)
        .then((hits) => {
          if (alive) setAssetHits(hits);
        })
        .catch(() => {
          if (alive) setAssetHits([]);
        });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q, drawerQuery]);

  const hitPackageIds = useMemo(
    () => new Set(assetHits.map((h) => h.packageId)),
    [assetHits],
  );

  const visiblePackages = useMemo(() => {
    const packages = library?.packages ?? [];
    if (!q) return packages;
    return packages.filter(
      (pkg) =>
        pkg.title.toLowerCase().includes(q) ||
        (pkg.summary ?? "").toLowerCase().includes(q) ||
        hitPackageIds.has(pkg.id),
    );
  }, [library?.packages, q, hitPackageIds]);

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={projectsOpen ? "expanded" : "collapsed"}
      data-collapsible={projectsOpen ? "" : "icon"}
      data-variant="sidebar"
      data-side="left"
    >
      {/* Layout spacer — drives SidebarInset offset */}
      <div
        className={cn(
          "relative bg-transparent transition-[width] duration-200 ease-linear",
          projectsOpen ? "w-[--sidebar-width]" : "w-[--sidebar-width-icon]",
        )}
      />

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-10 hidden h-svh md:flex",
          "bg-sidebar",
          "transition-[width] duration-200 ease-linear",
          projectsOpen ? "w-[--sidebar-width]" : "w-[--sidebar-width-icon]",
        )}
      >
        <div className="app-left-chrome">
          <nav className="activity-bar" aria-label={t("nav.main")}>
            <div className="activity-brand" data-tauri-drag-region>
              <span className="brand-logo" data-tauri-drag-region>
                <img
                  src={appIcon}
                  alt=""
                  width={22}
                  height={22}
                  draggable={false}
                />
              </span>
            </div>

            {/* 项目在驾驶舱之上（对齐 Cursor：Explorer 置顶） */}
            <div className="activity-nav">
              <RailTip
                label={
                  projectsOpen ? t("nav.collapseProjects") : t("nav.openProjects")
                }
              >
                <button
                  type="button"
                  className={cn("activity-btn", projectsOpen && "active")}
                  aria-label={
                    projectsOpen ? t("nav.collapseProjects") : t("nav.openProjects")
                  }
                  aria-pressed={projectsOpen}
                  onClick={() => toggleSidebar()}
                >
                  <FolderTree size={18} />
                </button>
              </RailTip>
              <RailTip label={t("nav.importWbom")}>
                <button
                  type="button"
                  className="activity-btn"
                  aria-label={t("nav.importWbom")}
                  disabled={importing}
                  onClick={onImport}
                >
                  <Plus size={18} />
                </button>
              </RailTip>
            </div>

            <div className="activity-sep" />

            <div className="activity-nav">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = item.id === view;
                return (
                  <RailTip key={item.id} label={item.label}>
                    <button
                      type="button"
                      className={cn("activity-btn", active && "active")}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      onClick={() => onViewChange(item.id)}
                    >
                      <Icon size={18} />
                    </button>
                  </RailTip>
                );
              })}
            </div>

            <div className="activity-foot">
              <RailTip label={t("nav.plugins")}>
                <button
                  type="button"
                  className={cn("activity-btn", view === "plugins" && "active")}
                  aria-label={t("nav.plugins")}
                  aria-current={view === "plugins" ? "page" : undefined}
                  onClick={() => onViewChange("plugins")}
                >
                  <Puzzle size={18} />
                </button>
              </RailTip>
              <RailTip label={t("nav.trash")}>
                <button
                  type="button"
                  className={cn("activity-btn", view === "trash" && "active")}
                  aria-label={t("nav.trash")}
                  aria-current={view === "trash" ? "page" : undefined}
                  onClick={() => onViewChange("trash")}
                >
                  <Trash2 size={18} />
                </button>
              </RailTip>
              <div className="activity-about">
                <RailTip label={t("nav.settings")}>
                  <button
                    type="button"
                    className={cn("activity-btn", appSettingsOpen && "active")}
                    aria-label={t("nav.settings")}
                    aria-expanded={appSettingsOpen}
                    onClick={() => setAppSettingsOpen(true)}
                  >
                    <Settings size={18} />
                  </button>
                </RailTip>
              </div>
            </div>
          </nav>

          {appSettingsOpen &&
            createPortal(
              <SettingsModal
                open={appSettingsOpen}
                onClose={() => setAppSettingsOpen(false)}
                appVersion={appVersion}
              />,
              document.body,
            )}

          {projectsOpen && (
            <aside className="project-drawer" aria-label={t("nav.projects")}>
              <header className="project-drawer-head">
                <strong>{t("nav.projects")}</strong>
                <div className="project-drawer-actions">
                  <button
                    type="button"
                    className="project-drawer-ico"
                    title={t("nav.revealInSidebar")}
                    aria-label={t("nav.revealInSidebar")}
                    disabled={!selectedArtifactId}
                    onClick={revealSelectedInTree}
                  >
                    <Crosshair size={18} strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    className="project-drawer-ico"
                    title={t("nav.expandAll")}
                    aria-label={t("nav.expandAll")}
                    onClick={() => setExpandToken((n) => n + 1)}
                  >
                    <ChevronsUpDown size={18} strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    className="project-drawer-ico"
                    title={t("nav.collapseAll")}
                    aria-label={t("nav.collapseAll")}
                    onClick={() => setCollapseToken((n) => n + 1)}
                  >
                    <ChevronsDownUp size={18} strokeWidth={1.5} />
                  </button>
                  <div className="project-drawer-more" ref={moreRef}>
                    <button
                      type="button"
                      className="project-drawer-ico"
                      title={t("common.more")}
                      aria-label={t("common.more")}
                      aria-expanded={moreOpen}
                      onClick={() => setMoreOpen((v) => !v)}
                    >
                      <MoreVertical size={18} strokeWidth={1.5} />
                    </button>
                    {moreOpen && (
                      <div className="project-drawer-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={importing}
                          onClick={() => {
                            setMoreOpen(false);
                            onImport();
                          }}
                        >
                          {t("nav.importWbom")}…
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!detail}
                          onClick={openSettings}
                        >
                          {t("nav.projectSettings")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            toggleFollowOpenFile();
                            setMoreOpen(false);
                          }}
                        >
                          {followOpenFile ? "✓ " : ""}
                          {t("nav.followSelection")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!detail}
                          onClick={() => {
                            setMoreOpen(false);
                            onMovePackageToTrash?.(detail?.package.id);
                          }}
                        >
                          {t("nav.moveAllToTrash")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!detail}
                          className="is-danger"
                          onClick={() => {
                            setMoreOpen(false);
                            onRemovePackage?.(detail?.package.id);
                          }}
                        >
                          {t("nav.removeProjectKeepFiles")}
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="project-drawer-ico"
                    title={t("nav.collapseDrawer")}
                    aria-label={t("nav.collapseDrawer")}
                    onClick={() => setOpen(false)}
                  >
                    <Minus size={18} strokeWidth={1.5} />
                  </button>
                </div>
              </header>

              <label className="project-drawer-search">
                <Search size={14} aria-hidden />
                <input
                  type="search"
                  value={drawerQuery}
                  onChange={(e) => setDrawerQuery(e.target.value)}
                  placeholder={t("nav.searchProjects")}
                  aria-label={t("nav.searchProjects")}
                />
                {drawerQuery && (
                  <button
                    type="button"
                    className="project-drawer-search-clear"
                    aria-label={t("nav.clearSearch")}
                    onClick={() => setDrawerQuery("")}
                  >
                    <X size={12} />
                  </button>
                )}
              </label>

              <div className="project-drawer-body">
                {!library?.packages.length ? (
                  <div className="project-drawer-empty">
                    <p>{t("nav.emptyImportHint")}</p>
                    <button
                      type="button"
                      className="tool-btn primary"
                      disabled={importing}
                      onClick={onImport}
                    >
                      {t("nav.importWbom")}
                    </button>
                  </div>
                ) : !visiblePackages.length && !assetHits.length ? (
                  <p className="project-drawer-empty">{t("nav.noMatches")}</p>
                ) : (
                  <>
                    <div className="rail-pkg-list">
                      {visiblePackages.map((pkg) => (
                        <ProjectItem
                          key={pkg.id}
                          pkg={pkg}
                          active={pkg.id === selectedPackageId}
                          detail={pkg.id === selectedPackageId ? detail : null}
                          bomForest={bomForest}
                          looseArtifacts={looseArtifacts}
                          artifactById={artifactById}
                          selectedArtifactId={selectedArtifactId}
                          onSelectPackage={onSelectPackage}
                          onSelectArtifact={onSelectArtifact}
                          onRemovePackage={onRemovePackage}
                          onMovePackageToTrash={onMovePackageToTrash}
                          onOpenSettings={
                            pkg.id === selectedPackageId
                              ? openSettings
                              : () => {
                                  onSelectPackage(pkg);
                                  // Open settings after selection settles.
                                  window.setTimeout(() => setSettingsOpen(true), 0);
                                }
                          }
                          forceExpand={Boolean(q && hitPackageIds.has(pkg.id))}
                          artifactFilter={q}
                          collapseToken={collapseToken}
                          expandToken={expandToken}
                          followOpenFile={followOpenFile}
                          revealSignal={revealSignal}
                        />
                      ))}
                    </div>
                    {q && assetHits.length > 0 && (
                      <div className="project-drawer-hits">
                        <div className="project-drawer-hits-label">
                          {t("nav.hitAssets")}
                        </div>
                        <ul>
                          {assetHits.slice(0, 12).map((hit) => (
                            <li key={`${hit.packageId}:${hit.artifactId}`}>
                              <button
                                type="button"
                                onClick={() => onSelectSearchHit?.(hit)}
                              >
                                <span className="project-drawer-hit-name">
                                  {hit.displayName}
                                </span>
                                <span className="project-drawer-hit-pkg">
                                  {hit.packageTitle}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>

              {settingsOpen && detail && (
                <div className="pkg-settings-popover">
                  <h4>{t("nav.packageSettings")}</h4>
                  <label>
                    <span>{t("common.title")}</span>
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>{t("asset.summary")}</span>
                    <textarea
                      rows={3}
                      value={editSummary}
                      onChange={(e) => setEditSummary(e.target.value)}
                    />
                  </label>
                  <div className="pkg-settings-actions">
                    <button
                      type="button"
                      className="tool-btn primary"
                      onClick={() => {
                        onUpdatePackageMeta?.(editTitle, editSummary);
                        setSettingsOpen(false);
                      }}
                    >
                      {t("common.save")}
                    </button>
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={() => setSettingsOpen(false)}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className="tool-btn danger"
                      title={t("nav.movePackageToTrash")}
                      onClick={() => {
                        setSettingsOpen(false);
                        onMovePackageToTrash?.();
                      }}
                    >
                      {t("nav.moveAllToTrash")}
                    </button>
                    <button
                      type="button"
                      className="tool-btn"
                      title={t("nav.removePackage")}
                      onClick={() => {
                        setSettingsOpen(false);
                        onRemovePackage?.();
                      }}
                    >
                      {t("nav.removeProjectKeepFiles")}
                    </button>
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function scrollArtifactIntoTreeView(artifactId: string) {
  const safe =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(artifactId)
      : artifactId.replace(/"/g, '\\"');
  const el = document.querySelector<HTMLElement>(`[data-artifact-id="${safe}"]`);
  if (!el) return;
  const scroller = el.closest<HTMLElement>(".project-drawer-body");
  if (!scroller) return;
  const keepX = scroller.scrollLeft;
  const scrollerRect = scroller.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  if (elRect.top < scrollerRect.top) {
    scroller.scrollTop -= scrollerRect.top - elRect.top;
  } else if (elRect.bottom > scrollerRect.bottom) {
    scroller.scrollTop += elRect.bottom - scrollerRect.bottom;
  }
  // Vertical reveal only — restore X so selection does not drag the bottom bar.
  scroller.scrollLeft = keepX;
  requestAnimationFrame(() => {
    scroller.scrollLeft = keepX;
  });
}

/** Undo browser scroll-into-view that nudges the drawer sideways on selection. */
function preserveProjectDrawerScrollX() {
  const scroller = document.querySelector<HTMLElement>(".project-drawer-body");
  if (!scroller) return;
  const keepX = scroller.scrollLeft;
  requestAnimationFrame(() => {
    if (scroller.scrollLeft !== keepX) scroller.scrollLeft = keepX;
    requestAnimationFrame(() => {
      if (scroller.scrollLeft !== keepX) scroller.scrollLeft = keepX;
    });
  });
}

function ProjectItem({
  pkg,
  active,
  detail,
  bomForest,
  looseArtifacts,
  artifactById,
  selectedArtifactId,
  onSelectPackage,
  onSelectArtifact,
  onRemovePackage,
  onMovePackageToTrash,
  onOpenSettings,
  forceExpand = false,
  artifactFilter = "",
  collapseToken = 0,
  expandToken = 0,
  followOpenFile = false,
  revealSignal = 0,
}: {
  pkg: PackageSummary;
  active: boolean;
  detail: PackageDetail | null;
  bomForest: BomNode[];
  looseArtifacts: ArtifactView[];
  artifactById: Map<string, ArtifactView>;
  selectedArtifactId: string | null;
  onSelectPackage: (pkg: PackageSummary) => void;
  onSelectArtifact: (a: ArtifactView, packageId?: string) => void;
  onRemovePackage?: (packageId?: string) => void;
  onMovePackageToTrash?: (packageId?: string) => void;
  onOpenSettings?: () => void;
  forceExpand?: boolean;
  artifactFilter?: string;
  collapseToken?: number;
  expandToken?: number;
  followOpenFile?: boolean;
  revealSignal?: number;
}) {
  const { t } = useI18n();
  // Expand is independent of which project is selected in the cockpit.
  const [expanded, setExpanded] = useState(active);
  const [preview, setPreview] = useState<PackageDetail | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (!ctxRef.current?.contains(e.target as Node)) setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (collapseToken > 0) setExpanded(false);
  }, [collapseToken]);

  useEffect(() => {
    if (expandToken > 0) setExpanded(true);
  }, [expandToken]);

  useEffect(() => {
    if (forceExpand) setExpanded(true);
  }, [forceExpand]);

  useEffect(() => {
    if (followOpenFile && active && selectedArtifactId) setExpanded(true);
  }, [followOpenFile, active, selectedArtifactId]);

  useEffect(() => {
    if (revealSignal > 0 && active && selectedArtifactId) setExpanded(true);
  }, [revealSignal, active, selectedArtifactId]);

  useEffect(() => {
    if (!expanded || active) {
      if (active) {
        setPreview(null);
        setTreeError("");
      }
      return;
    }
    let alive = true;
    setLoadingTree(true);
    setTreeError("");
    getPackageDetail(pkg.id)
      .then((data) => {
        if (alive) setPreview(data);
      })
      .catch((err) => {
        if (alive) {
          setPreview(null);
          setTreeError(String(err));
        }
      })
      .finally(() => {
        if (alive) setLoadingTree(false);
      });
    return () => {
      alive = false;
    };
  }, [expanded, active, pkg.id]);

  const treeDetail = active ? detail : preview;
  const treeForest = useMemo(() => {
    if (active) return bomForest;
    if (!preview) return [];
    return buildPartOfForest(preview.identities, preview.relations);
  }, [active, bomForest, preview]);
  const treeLoose = useMemo(() => {
    if (active) return looseArtifacts;
    if (!preview) return [];
    const looseIds = new Set(
      looseArtifactIds(preview.artifacts, preview.identities, preview.relations),
    );
    return preview.artifacts.filter((a) => looseIds.has(a.id));
  }, [active, looseArtifacts, preview]);
  const treeArtifactById = useMemo(() => {
    if (active) return artifactById;
    return new Map((preview?.artifacts ?? []).map((a) => [a.id, a]));
  }, [active, artifactById, preview]);
  const kindGroups = useMemo(() => {
    const groups = groupByKind(treeLoose);
    if (!artifactFilter) return groups;
    return groups
      .map(([kind, items]) => {
        const filtered = items.filter((a) =>
          a.displayName.toLowerCase().includes(artifactFilter),
        );
        return [kind, filtered] as const;
      })
      .filter(([, items]) => items.length > 0);
  }, [treeLoose, artifactFilter]);

  const folderTree = useMemo(() => {
    const filtered = artifactFilter
      ? treeLoose.filter((a) =>
          `${a.displayName} ${a.fileRef.path}`.toLowerCase().includes(artifactFilter),
        )
      : treeLoose;
    return buildFolderTree(filtered);
  }, [treeLoose, artifactFilter]);

  const useFolderGrouping = folderTreeHasStructure(folderTree);

  const pickArtifact = (artifact: ArtifactView) => {
    onSelectArtifact(artifact, active ? undefined : pkg.id);
  };

  return (
    <div>
      <div
        className="rail-pkg-row"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <button
          type="button"
          className="rail-pkg-twist"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t("nav.collapse") : t("nav.expand")}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button
          type="button"
          className={active ? "rail-pkg active" : "rail-pkg"}
          onClick={() => onSelectPackage(pkg)}
        >
          <span className="rail-pkg-dot" />
          <span className="rail-pkg-name">{pkg.title}</span>
          <span className="rail-pkg-count">{pkg.stats.artifactCount}</span>
        </button>
      </div>

      {ctxMenu &&
        createPortal(
          <div
            ref={ctxRef}
            className="project-ctx-menu"
            role="menu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCtxMenu(null);
                onSelectPackage(pkg);
                onOpenSettings?.();
              }}
            >
              {t("nav.projectSettings")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCtxMenu(null);
                onMovePackageToTrash?.(pkg.id);
              }}
            >
              {t("nav.moveAllToTrash")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => {
                setCtxMenu(null);
                onRemovePackage?.(pkg.id);
              }}
            >
              {t("nav.removeProjectKeepFiles")}
            </button>
          </div>,
          document.body,
        )}

      {expanded && (
        <div className="rail-tree">
          {loadingTree && !treeDetail && (
            <p className="project-drawer-empty">{t("common.loading")}</p>
          )}
          {treeError && !treeDetail && (
            <p className="project-drawer-empty">{treeError}</p>
          )}
          {treeDetail && (
            <ul className="bom-tree" role="tree">
              {treeForest.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  artifactById={treeArtifactById}
                  selectedArtifactId={active ? selectedArtifactId : null}
                  onSelectArtifact={pickArtifact}
                  collapseToken={collapseToken}
                  expandToken={expandToken}
                  followOpenFile={followOpenFile}
                  revealSignal={revealSignal}
                />
              ))}
              {useFolderGrouping
                ? folderTree.children.map((folder) => (
                    <FolderGroup
                      key={folder.path}
                      node={folder}
                      selectedArtifactId={active ? selectedArtifactId : null}
                      onSelectArtifact={pickArtifact}
                      collapseToken={collapseToken}
                      expandToken={expandToken}
                      followOpenFile={followOpenFile}
                      revealSignal={revealSignal}
                    />
                  ))
                : null}
              {useFolderGrouping
                ? folderTree.files.map((artifact) => (
                    <ArtifactLeaf
                      key={artifact.id}
                      artifact={artifact}
                      selectedArtifactId={active ? selectedArtifactId : null}
                      onSelectArtifact={pickArtifact}
                    />
                  ))
                : kindGroups.map(([kind, items]) => (
                    <KindGroup
                      key={kind}
                      kind={kind}
                      items={items}
                      selectedArtifactId={active ? selectedArtifactId : null}
                      onSelectArtifact={pickArtifact}
                      collapseToken={collapseToken}
                      expandToken={expandToken}
                      followOpenFile={followOpenFile}
                      revealSignal={revealSignal}
                    />
                  ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function bomContainsArtifact(
  node: BomNode,
  artifactId: string,
): boolean {
  if (node.artifactId === artifactId) return true;
  return node.children.some((child) => bomContainsArtifact(child, artifactId));
}

function TreeNode({
  node,
  depth,
  artifactById,
  selectedArtifactId,
  onSelectArtifact,
  collapseToken = 0,
  expandToken = 0,
  followOpenFile = false,
  revealSignal = 0,
}: {
  node: BomNode;
  depth: number;
  artifactById: Map<string, ArtifactView>;
  selectedArtifactId: string | null;
  onSelectArtifact: (a: ArtifactView) => void;
  collapseToken?: number;
  expandToken?: number;
  followOpenFile?: boolean;
  revealSignal?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const artifact = artifactById.get(node.artifactId);

  useEffect(() => {
    if (collapseToken > 0) setExpanded(false);
  }, [collapseToken]);

  useEffect(() => {
    if (expandToken > 0) setExpanded(true);
  }, [expandToken]);

  // Autoscroll from source: keep only the path to the current selection.
  useEffect(() => {
    if (!followOpenFile || !selectedArtifactId) return;
    setExpanded(bomContainsArtifact(node, selectedArtifactId));
  }, [followOpenFile, selectedArtifactId, node]);

  // One-shot Reveal in Explorer.
  useEffect(() => {
    if (revealSignal === 0 || !selectedArtifactId) return;
    setExpanded(bomContainsArtifact(node, selectedArtifactId));
  }, [revealSignal, selectedArtifactId, node]);

  if (!artifact) return null;
  const hasChildren = node.children.length > 0;
  const rowActive = selectedArtifactId === artifact.id;
  const Icon = kindIcon(artifact.kind);

  return (
    <li className="tree-node" role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className={`tree-row ${hasChildren ? "parent" : ""} ${rowActive ? "active" : ""}`}
        role="button"
        tabIndex={0}
        data-artifact-id={artifact.id}
        onClick={() => (hasChildren ? setExpanded((v) => !v) : onSelectArtifact(artifact))}
      >
        <span className="tree-lead">
          {hasChildren ? (
            <span className="tree-caret">{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
          ) : (
            <Icon size={14} />
          )}
        </span>
        <span className="tree-name">{artifact.displayName}</span>
        <span className="tree-side">
          {!hasChildren && (
            <span
              className={`tree-dot ${artifact.status === "final" ? "final" : ""} ${
                !artifact.reachable ? "broken" : ""
              }`}
            />
          )}
          {hasChildren && <span className="tree-count">{node.children.length}</span>}
        </span>
      </div>
      {hasChildren && expanded && (
        <ul className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              artifactById={artifactById}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={onSelectArtifact}
              collapseToken={collapseToken}
              expandToken={expandToken}
              followOpenFile={followOpenFile}
              revealSignal={revealSignal}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function KindGroup({
  kind,
  items,
  selectedArtifactId,
  onSelectArtifact,
  collapseToken = 0,
  expandToken = 0,
  followOpenFile = false,
  revealSignal = 0,
}: {
  kind: ArtifactKind;
  items: ArtifactView[];
  selectedArtifactId: string | null;
  onSelectArtifact: (a: ArtifactView) => void;
  collapseToken?: number;
  expandToken?: number;
  followOpenFile?: boolean;
  revealSignal?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (collapseToken > 0) setExpanded(false);
  }, [collapseToken]);

  useEffect(() => {
    if (expandToken > 0) setExpanded(true);
  }, [expandToken]);

  useEffect(() => {
    if (!followOpenFile || !selectedArtifactId) return;
    setExpanded(items.some((item) => item.id === selectedArtifactId));
  }, [followOpenFile, selectedArtifactId, items]);

  useEffect(() => {
    if (revealSignal === 0 || !selectedArtifactId) return;
    setExpanded(items.some((item) => item.id === selectedArtifactId));
  }, [revealSignal, selectedArtifactId, items]);

  return (
    <li className="tree-node" role="treeitem" aria-expanded={expanded}>
      <div
        className="tree-row parent"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="tree-lead">
          <span className="tree-caret">{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
        </span>
        <span className="tree-name">{kindLabel(kind)}</span>
        <span className="tree-side">
          <span className="tree-count">{items.length}</span>
        </span>
      </div>
      {expanded && (
        <ul className="tree-children">
          {items.map((artifact) => (
            <ArtifactLeaf
              key={artifact.id}
              artifact={artifact}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={onSelectArtifact}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

type FolderNode = {
  name: string;
  path: string;
  children: FolderNode[];
  files: ArtifactView[];
};

function buildFolderTree(artifacts: ArtifactView[]): FolderNode {
  const root: FolderNode = { name: "", path: "", children: [], files: [] };
  for (const artifact of artifacts) {
    // Only relative package paths form a project folder tree.
    if (artifact.fileRef.pathKind !== "relative") {
      root.files.push(artifact);
      continue;
    }
    const parts = artifact.fileRef.path
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean);
    if (parts.length <= 1) {
      root.files.push(artifact);
      continue;
    }
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i]!;
      acc = acc ? `${acc}/${part}` : part;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: acc, children: [], files: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.files.push(artifact);
  }
  sortFolderNode(root);
  return root;
}

function sortFolderNode(node: FolderNode) {
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.displayName.localeCompare(b.displayName));
  for (const child of node.children) sortFolderNode(child);
}

function folderTreeHasStructure(node: FolderNode): boolean {
  return node.children.length > 0;
}

function folderContainsArtifact(node: FolderNode, artifactId: string): boolean {
  if (node.files.some((f) => f.id === artifactId)) return true;
  return node.children.some((child) => folderContainsArtifact(child, artifactId));
}

function folderFileCount(node: FolderNode): number {
  return (
    node.files.length +
    node.children.reduce((sum, child) => sum + folderFileCount(child), 0)
  );
}

function FolderGroup({
  node,
  selectedArtifactId,
  onSelectArtifact,
  collapseToken = 0,
  expandToken = 0,
  followOpenFile = false,
  revealSignal = 0,
}: {
  node: FolderNode;
  selectedArtifactId: string | null;
  onSelectArtifact: (a: ArtifactView) => void;
  collapseToken?: number;
  expandToken?: number;
  followOpenFile?: boolean;
  revealSignal?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (collapseToken > 0) setExpanded(false);
  }, [collapseToken]);

  useEffect(() => {
    if (expandToken > 0) setExpanded(true);
  }, [expandToken]);

  useEffect(() => {
    if (!followOpenFile || !selectedArtifactId) return;
    setExpanded(folderContainsArtifact(node, selectedArtifactId));
  }, [followOpenFile, selectedArtifactId, node]);

  useEffect(() => {
    if (revealSignal === 0 || !selectedArtifactId) return;
    setExpanded(folderContainsArtifact(node, selectedArtifactId));
  }, [revealSignal, selectedArtifactId, node]);

  return (
    <li className="tree-node" role="treeitem" aria-expanded={expanded}>
      <div
        className="tree-row parent"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="tree-lead">
          <span className="tree-caret">{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
        </span>
        <span className="tree-name">{node.name}</span>
        <span className="tree-side">
          <span className="tree-count">{folderFileCount(node)}</span>
        </span>
      </div>
      {expanded && (
        <ul className="tree-children">
          {node.children.map((child) => (
            <FolderGroup
              key={child.path}
              node={child}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={onSelectArtifact}
              collapseToken={collapseToken}
              expandToken={expandToken}
              followOpenFile={followOpenFile}
              revealSignal={revealSignal}
            />
          ))}
          {node.files.map((artifact) => (
            <ArtifactLeaf
              key={artifact.id}
              artifact={artifact}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={onSelectArtifact}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ArtifactLeaf({
  artifact,
  selectedArtifactId,
  onSelectArtifact,
}: {
  artifact: ArtifactView;
  selectedArtifactId: string | null;
  onSelectArtifact: (a: ArtifactView) => void;
}) {
  const active = selectedArtifactId === artifact.id;
  const Icon = kindIcon(artifact.kind);
  return (
    <li className="tree-node">
      <div
        className={`tree-row ${active ? "active" : ""}`}
        role="button"
        tabIndex={0}
        data-artifact-id={artifact.id}
        onClick={() => onSelectArtifact(artifact)}
      >
        <span className="tree-lead">
          <Icon size={14} />
        </span>
        <span className="tree-name">{artifact.displayName}</span>
        <span className="tree-side">
          <span
            className={`tree-dot ${artifact.status === "final" ? "final" : ""} ${
              !artifact.reachable ? "broken" : ""
            }`}
          />
        </span>
      </div>
    </li>
  );
}

function groupByKind(artifacts: ArtifactView[]): [ArtifactKind, ArtifactView[]][] {
  const map = new Map<ArtifactKind, ArtifactView[]>();
  for (const artifact of artifacts) {
    const list = map.get(artifact.kind) ?? [];
    list.push(artifact);
    map.set(artifact.kind, list);
  }
  return [...map.entries()];
}
