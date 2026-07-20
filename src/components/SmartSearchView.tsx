import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  Command,
  FileText,
  Image,
  Link2,
  Music2,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { ArtifactKind, ArtifactStatus, PackageDetail, SearchHit } from "../shared/types";
import { searchAssets } from "../shared/api";
import {
  clearSearchHistory,
  readSearchHistory,
  rememberSearch,
  type SearchHistoryEntry,
} from "../shared/searchPreferences";
import {
  searchModeLabel,
  smartSearchMessage,
} from "../shared/smartSearchI18n";
import { useI18n } from "../shared/i18n";
import { mediaSrcFor } from "./assetVisual";

type SearchAsset = {
  id: string;
  name: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  project: string;
  summary: string;
  updated: string;
  tone: "indigo" | "blue" | "violet" | "cyan";
  packageId: string;
  artifactId: string;
  hit: SearchHit;
};

type Category = "all" | "visual" | "text" | "audio";
type Scope = "project" | "all";
type SortMode = "relevance" | "updated";
type PopoverId = "history" | "sort" | "scope" | "filters";

function toneForKind(kind: ArtifactKind): SearchAsset["tone"] {
  if (kind === "image") return "cyan";
  if (kind === "video") return "blue";
  if (kind === "audio") return "violet";
  return "indigo";
}

function cleanSnippet(value?: string): string {
  return (value ?? "")
    .replace(/<\/?b>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function assetsFromHits(
  hits: SearchHit[],
  summaryFallback: string,
  locale: "zh" | "en",
): SearchAsset[] {
  return hits.map((hit) => ({
    id: `${hit.packageId}:${hit.artifactId}`,
    packageId: hit.packageId,
    artifactId: hit.artifactId,
    name: hit.displayName,
    kind: hit.kind,
    status: hit.status,
    project: hit.packageTitle,
    summary: hit.summary || cleanSnippet(hit.snippet) || summaryFallback,
    updated: formatUpdated(hit.updatedAt, locale),
    tone: toneForKind(hit.kind),
    hit,
  }));
}

function formatUpdated(value: string, locale: "zh" | "en") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value || smartSearchMessage(locale, "collected");
  }
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : undefined, {
    month: "short",
    day: "numeric",
  });
}

function KindIcon({ kind }: { kind: ArtifactKind }) {
  if (kind === "image" || kind === "video") return <Image size={17} />;
  if (kind === "audio") return <Music2 size={17} />;
  return <FileText size={17} />;
}

function kindGroup(kind: ArtifactKind): Category {
  if (kind === "image" || kind === "video") return "visual";
  if (kind === "audio") return "audio";
  return "text";
}

function categoryKinds(category: Category): string[] {
  if (category === "visual") return ["image", "video"];
  if (category === "text") return ["markdown", "html", "other"];
  if (category === "audio") return ["audio"];
  return [];
}

function SmartFloatingMenu({
  open,
  anchorRef,
  onClose,
  align = "end",
  width,
  className,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: "start" | "end";
  width?: number;
  className?: string;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuWidth = width ?? menuRef.current?.offsetWidth ?? 200;
      const left =
        align === "end"
          ? Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))
          : Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
      setPos({ top: rect.bottom + 7, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, align, width]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      style={{ position: "fixed", top: pos.top, left: pos.left, width: width ?? undefined }}
      role="menu"
    >
      {children}
    </div>,
    document.body,
  );
}

export function SmartSearchView({
  detail,
  query,
  onQueryChange,
  onOpenArtifact,
}: {
  detail: PackageDetail | null;
  query: string;
  onQueryChange: (value: string) => void;
  onOpenArtifact: (hit: SearchHit) => void;
}) {
  const { locale } = useI18n();
  const t = (key: Parameters<typeof smartSearchMessage>[1]) =>
    smartSearchMessage(locale, key);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const scopeBtnRef = useRef<HTMLButtonElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const requestVersionRef = useRef(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [semanticError, setSemanticError] = useState("");
  const [searchMode, setSearchMode] = useState<"fulltext" | "hybrid">("fulltext");
  const [category, setCategory] = useState<Category>("all");
  const [scope, setScope] = useState<Scope>("project");
  const [status, setStatus] = useState<ArtifactStatus | "all">("all");
  const [sort, setSort] = useState<SortMode>("relevance");
  const [runToken, setRunToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() => readSearchHistory());
  const [openPopover, setOpenPopover] = useState<PopoverId | null>(null);
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [totalHits, setTotalHits] = useState(0);

  const effectiveScope: Scope = scope === "project" && detail ? "project" : "all";
  const PAGE = 20;

  const togglePopover = (id: PopoverId) => {
    setOpenPopover((current) => (current === id ? null : id));
  };
  const closePopover = () => setOpenPopover(null);

  const submitSearch = () => {
    if (!query.trim()) return;
    setHistory(rememberSearch(query));
    setRunToken((value) => value + 1);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      requestVersionRef.current += 1;
      setHits([]);
      setTotalHits(0);
      setLoading(false);
      setLoadingMore(false);
      setSemanticError("");
      return;
    }
    let active = true;
    const requestVersion = ++requestVersionRef.current;
    setHits([]);
    setTotalHits(0);
    setSemanticError("");
    setError("");
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await searchAssets({
          query,
          packageIds: effectiveScope === "project" && detail ? [detail.package.id] : [],
          kinds: categoryKinds(category),
          statuses: status === "all" ? [] : [status],
          sort,
          limit: PAGE,
          offset: 0,
        });
        if (active && requestVersion === requestVersionRef.current) {
          setHits(result.items);
          setTotalHits(result.total);
          setSearchMode(result.mode);
          setSemanticError(result.semanticError ?? "");
        }
      } catch (reason) {
        if (active && requestVersion === requestVersionRef.current) {
          setError(String(reason));
          setHits([]);
          setTotalHits(0);
        }
      } finally {
        if (active && requestVersion === requestVersionRef.current) setLoading(false);
      }
    }, runToken ? 20 : 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, category, status, effectiveScope, detail?.package.id, sort, runToken]);

  const assets = useMemo(
    () => assetsFromHits(hits, t("summaryFallback"), locale),
    [hits, locale],
  );
  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0];
  const secondaryAssets = selected
    ? assets.filter((asset) => asset.id !== selected.id)
    : assets;

  useEffect(() => {
    setSelectedId(null);
    setRelationsOpen(false);
  }, [query, category, status, effectiveScope, sort]);

  const canLoadMore = hits.length < totalHits;

  const loadMore = async () => {
    if (!query.trim() || loading || loadingMore || !canLoadMore) return;
    const requestVersion = requestVersionRef.current;
    setLoadingMore(true);
    try {
      const result = await searchAssets({
        query,
        packageIds: effectiveScope === "project" && detail ? [detail.package.id] : [],
        kinds: categoryKinds(category),
        statuses: status === "all" ? [] : [status],
        sort,
        limit: PAGE,
        offset: hits.length,
      });
      if (requestVersion !== requestVersionRef.current) return;
      setHits((current) => {
        const seen = new Set(current.map((hit) => `${hit.packageId}:${hit.artifactId}`));
        return [
          ...current,
          ...result.items.filter((hit) => !seen.has(`${hit.packageId}:${hit.artifactId}`)),
        ];
      });
      setTotalHits(result.total);
      setSearchMode(result.mode);
      setSemanticError(result.semanticError ?? "");
    } catch (reason) {
      if (requestVersion === requestVersionRef.current) setError(String(reason));
    } finally {
      if (requestVersion === requestVersionRef.current) setLoadingMore(false);
    }
  };

  const related = useMemo(() => {
    if (!selected || detail?.package.id !== selected.packageId) return [];
    const ids = new Set<string>();
    for (const relation of detail.relations) {
      if (relation.from === selected.artifactId) ids.add(relation.to);
      if (relation.to === selected.artifactId) ids.add(relation.from);
    }
    return [...ids]
      .map((id) => detail.artifacts.find((artifact) => artifact.id === id))
      .filter((artifact) => !!artifact)
      .slice(0, 8);
  }, [detail, selected]);

  const selectedArtifact = useMemo(() => {
    if (!selected || detail?.package.id !== selected.packageId) return null;
    return detail.artifacts.find((artifact) => artifact.id === selected.artifactId) ?? null;
  }, [detail, selected]);
  const selectedPreviewUrl =
    selectedArtifact?.kind === "image" ? mediaSrcFor(selectedArtifact) : undefined;
  const selectedEvidence = selected
    ? cleanSnippet(selected.hit.snippet) || selected.hit.summary || selected.summary
    : "";

  const chooseHistory = (entry: SearchHistoryEntry) => {
    onQueryChange(entry.query);
    setRunToken((value) => value + 1);
    closePopover();
  };

  const number = (value: number) =>
    new Intl.NumberFormat(locale === "zh" ? "zh-CN" : undefined).format(value);
  const assetTypeLabel = (kind: ArtifactKind) =>
    kindGroup(kind) === "visual"
      ? t("visualAsset")
      : kindGroup(kind) === "audio"
        ? t("audioAsset")
        : t("documentAsset");
  const resultTitle = !query.trim()
    ? t("searchTitle")
    : loading
      ? t("searchingTitle")
      : selected
        ? t("resultsTitle")
        : t("noResultsTitle");
  const isApplePlatform =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="smart-search-page" lang={locale === "zh" ? "zh-CN" : "en"}>
      <section className="smart-search-stage">
        <header className="smart-search-stage-head">
          <div className="smart-search-brand">
            <Sparkles size={15} />
            <strong>{t("productTitle")}</strong>
            <span>{t("tagline")}</span>
          </div>
          <button
            ref={historyBtnRef}
            type="button"
            className={`smart-history-btn${openPopover === "history" ? " active" : ""}`}
            onClick={() => togglePopover("history")}
          >
            <Clock3 size={14} /> {t("history")}
          </button>
          <SmartFloatingMenu
            open={openPopover === "history"}
            anchorRef={historyBtnRef}
            onClose={closePopover}
            align="end"
            width={280}
            className="smart-menu smart-menu-portal"
          >
            <header>
              <strong>{t("recentSearches")}</strong>
              <button
                type="button"
                onClick={() => {
                  clearSearchHistory();
                  setHistory([]);
                }}
              >
                {t("clear")}
              </button>
            </header>
            {history.length ? (
              history.map((entry) => (
                <button
                  type="button"
                  key={`${entry.query}-${entry.searchedAt}`}
                  onClick={() => chooseHistory(entry)}
                >
                  <Clock3 size={12} />
                  <span>{entry.query}</span>
                  <small>
                    {new Date(entry.searchedAt).toLocaleDateString(
                      locale === "zh" ? "zh-CN" : undefined,
                      { month: "short", day: "numeric" },
                    )}
                  </small>
                </button>
              ))
            ) : (
              <p>{t("noHistory")}</p>
            )}
          </SmartFloatingMenu>
        </header>

        <div className="smart-search-command">
          <Search size={22} />
          <input
            ref={inputRef}
            aria-label={t("inputAria")}
            value={query}
            placeholder={t("placeholder")}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitSearch();
            }}
          />
          {!!query && (
            <button type="button" className="smart-search-clear" onClick={() => onQueryChange("")}>
              <X size={15} />
            </button>
          )}
          <kbd>
            {isApplePlatform ? <Command size={11} /> : "Ctrl"} K
          </kbd>
          <button
            type="button"
            className="smart-search-submit"
            aria-label={t("inputAria")}
            disabled={!query.trim() || loading}
            onClick={submitSearch}
          >
            <ArrowUpRight size={17} />
          </button>
        </div>

        <div className="smart-tools-rail">
          <button
            ref={sortBtnRef}
            type="button"
            className={openPopover === "sort" ? "active" : ""}
            onClick={() => togglePopover("sort")}
          >
            <small>{t("sort")}</small>
            <strong>{sort === "relevance" ? t("relevance") : t("updated")}</strong>
            <ChevronDown size={11} />
          </button>
          <SmartFloatingMenu
            open={openPopover === "sort"}
            anchorRef={sortBtnRef}
            onClose={closePopover}
            align="start"
            width={150}
            className="smart-menu smart-menu-portal compact"
          >
            <button
              type="button"
              onClick={() => {
                setSort("relevance");
                closePopover();
              }}
            >
              <Check size={12} className={sort === "relevance" ? "visible" : "hidden"} />
              {t("relevance")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSort("updated");
                closePopover();
              }}
            >
              <Check size={12} className={sort === "updated" ? "visible" : "hidden"} />
              {t("updated")}
            </button>
          </SmartFloatingMenu>

          <button
            ref={scopeBtnRef}
            type="button"
            className={`smart-scope${openPopover === "scope" ? " active" : ""}`}
            onClick={() => togglePopover("scope")}
          >
            <small>{t("scope")}</small>
            <strong>
              {effectiveScope === "project" ? detail?.package.title : t("allProjects")}
            </strong>
            <ChevronDown size={11} />
          </button>
          <SmartFloatingMenu
            open={openPopover === "scope"}
            anchorRef={scopeBtnRef}
            onClose={closePopover}
            align="end"
            width={160}
            className="smart-menu smart-menu-portal compact"
          >
            <button
              type="button"
              disabled={!detail}
              onClick={() => {
                setScope("project");
                closePopover();
              }}
            >
              <Check size={12} className={effectiveScope === "project" ? "visible" : "hidden"} />
              {t("currentProject")}
            </button>
            <button
              type="button"
              onClick={() => {
                setScope("all");
                closePopover();
              }}
            >
              <Check size={12} className={effectiveScope === "all" ? "visible" : "hidden"} />
              {t("allProjects")}
            </button>
          </SmartFloatingMenu>

          <button
            ref={filterBtnRef}
            type="button"
            className={`smart-tune${openPopover === "filters" ? " active" : ""}`}
            aria-label={t("tune")}
            onClick={() => togglePopover("filters")}
          >
            <SlidersHorizontal size={13} />
            {status !== "all" && <i className="smart-tune-dot" />}
          </button>
          <SmartFloatingMenu
            open={openPopover === "filters"}
            anchorRef={filterBtnRef}
            onClose={closePopover}
            align="end"
            width={230}
            className="smart-filter-panel smart-menu-portal"
          >
            <label>
              <span>{t("assetStatus")}</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as ArtifactStatus | "all")}
              >
                <option value="all">{t("allStatuses")}</option>
                <option value="draft">{t("draft")}</option>
                <option value="candidate">{t("candidate")}</option>
                <option value="final">{t("final")}</option>
              </select>
            </label>
            <button type="button" onClick={() => setStatus("all")}>
              {t("reset")}
            </button>
          </SmartFloatingMenu>

          {semanticError && (
            <span className="smart-semantic-warning" title={semanticError}>
              <AlertTriangle size={12} />
              {t("semanticFallback")}
            </span>
          )}
        </div>
      </section>

      <section className="smart-results">
        <header className="smart-results-head">
          <div>
            <h2>{resultTitle}</h2>
            <p>
              {loading
                ? t("searching")
                : query.trim()
                  ? `${number(totalHits)}${t("found")}`
                  : t("emptyHint")}
            </p>
          </div>
          <nav className="smart-category-nav" aria-label={t("filter")}>
            {(
              [
                ["all", t("all")],
                ["visual", t("visual")],
                ["text", t("documents")],
                ["audio", t("audio")],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={category === value ? "active" : ""}
                onClick={() => setCategory(value)}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        {selected && (
          <article className="smart-feature">
            <div className={`smart-feature-preview ${selected.tone}`}>
              {selectedPreviewUrl ? (
                <img src={selectedPreviewUrl} alt={selected.name} />
              ) : (
                <div className="smart-feature-file">
                  <KindIcon kind={selected.kind} />
                  <strong>{selected.name}</strong>
                  <span>{assetTypeLabel(selected.kind)}</span>
                </div>
              )}
              <span className="smart-kind">
                <KindIcon kind={selected.kind} />
                {assetTypeLabel(selected.kind)}
              </span>
              <span className="smart-result-rank">{t("bestMatch")}</span>
            </div>
            <div className="smart-feature-copy">
              <div className="smart-origin">
                <span>{selected.project}</span>
                <i />
                {selected.updated}
              </div>
              <h3>{selected.name}</h3>
              <p>{selected.summary}</p>
              <div className="smart-evidence">
                <span>{t("matchEvidence")}</span>
                <p>{selectedEvidence}</p>
                <b>{searchModeLabel(searchMode, locale)}</b>
              </div>
              <div className={`smart-relations${relationsOpen ? " open" : ""}`}>
                <Link2 size={13} />
                <span>
                  {related.length
                    ? `${number(related.length)}${t("relatedAssets")}${related
                        .slice(0, 3)
                        .map((item) => item.displayName)
                        .join(locale === "zh" ? "、" : ", ")}`
                    : detail?.package.id === selected.packageId
                      ? t("noRelations")
                      : t("openForRelations")}
                </span>
                {related.length > 0 && (
                  <button type="button" onClick={() => setRelationsOpen((value) => !value)}>
                    {relationsOpen ? t("collapse") : t("expandRelations")}
                  </button>
                )}
                {relationsOpen && (
                  <ul>
                    {related.map((item) => (
                      <li key={item.id}>{item.displayName}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                className="smart-open"
                onClick={() => onOpenArtifact(selected.hit)}
              >
                {t("openDetails")} <ArrowUpRight size={14} />
              </button>
            </div>
          </article>
        )}

        {!loading && query.trim() && !selected && (
          <div className="smart-search-empty smart-search-empty-miss">
            <h3>{t("noMatch")}</h3>
            <p>{error || t("noMatchHint")}</p>
          </div>
        )}
        {!query.trim() && (
          <div className="smart-search-empty">
            <Search size={20} />
            <h3>{t("emptyTitle")}</h3>
            <p>{t("emptyHint")}</p>
          </div>
        )}

        {(!!secondaryAssets.length || canLoadMore) && (
          <>
            <div className="smart-more-head">
              <strong>{t("moreResults")}</strong>
              <span className="muted small">
                {t("showing")} {number(hits.length)}/{number(totalHits)}
              </span>
            </div>
            <div className="smart-more-results">
              {secondaryAssets.map((asset) => (
                <button
                  type="button"
                  key={asset.id}
                  className={selected?.id === asset.id ? "selected" : ""}
                  onClick={() => setSelectedId(asset.id)}
                >
                  <span className={`smart-mini ${asset.tone}`}>
                    <KindIcon kind={asset.kind} />
                  </span>
                  <span className="smart-mini-copy">
                    <small>{asset.project}</small>
                    <strong>{asset.name}</strong>
                    <em>{asset.summary}</em>
                  </span>
                  <span className="smart-mini-meta">
                    <small>{asset.updated}</small>
                  </span>
                  <ArrowUpRight className="smart-mini-arrow" size={15} />
                </button>
              ))}
            </div>
            {canLoadMore && (
              <button
                type="button"
                className="smart-load-more"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore
                  ? t("loadingMore")
                  : `${t("loadMore")} · ${t("remaining")} ${number(totalHits - hits.length)} ${t("items")}`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
