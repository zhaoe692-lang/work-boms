import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  FileText,
  Image,
  Music2,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { emptyTrash, listTrash, permanentlyDeleteTrashItems, restoreTrashItems } from "../shared/api";
import { useI18n } from "../shared/i18n";
import { confirmsEmptyTrash, confirmsPermanentDelete } from "../shared/trashConfirm";
import type { ArtifactKey, LibraryState, TrashItem } from "../shared/types";
import { kindLabel } from "../shared/utils";

function keyOf(item: ArtifactKey) { return `${item.packageId}\u0000${item.artifactId}`; }
function ItemIcon({ kind }: { kind: string }) {
  if (kind === "audio") return <Music2 size={15} />;
  if (kind === "image" || kind === "video") return <Image size={15} />;
  return <FileText size={15} />;
}
function formatSize(value?: number) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function TrashView({
  library,
  onLibraryChanged,
}: {
  library: LibraryState | null;
  onLibraryChanged?: () => Promise<LibraryState>;
}) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [packageId, setPackageId] = useState("");
  const [age, setAge] = useState<"all" | "7" | "30">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dateLocale = locale === "zh" ? "zh-CN" : undefined;
  const formatTime = (value: number) =>
    new Date(value * 1000).toLocaleString(dateLocale, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const expiry = (value: number) =>
    t("trash.daysLeft", {
      days: Math.max(0, Math.ceil((value * 1000 - Date.now()) / 86400000)),
    });

  const load = useCallback(async () => {
    try {
      setError("");
      setItems(await listTrash({ packageId: packageId || undefined, text: query || undefined, limit: 500 }));
    } catch (reason) {
      setError(String(reason));
    }
  }, [packageId, query]);

  useEffect(() => {
    const timer = window.setTimeout(load, 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visibleItems = useMemo(() => {
    if (age === "all") return items;
    const cutoff = Date.now() / 1000 - Number(age) * 86400;
    return items.filter((item) => item.deletedAt >= cutoff);
  }, [age, items]);
  const totalBytes = useMemo(() => visibleItems.reduce((sum, item) => sum + (item.sizeBytes || 0), 0), [visibleItems]);
  const selectedItems = visibleItems.filter((item) => selected.includes(keyOf(item)));

  useEffect(() => {
    setSelected([]);
  }, [packageId, age, query]);

  const mutate = async (action: "restore" | "delete" | "empty", targets = selectedItems) => {
    if (!targets.length && action !== "empty") return;
    if (action === "delete") {
      const names = targets.slice(0, 3).map((item) => item.displayName).join(locale === "zh" ? "、" : ", ");
      const more = targets.length > 3 ? t("trash.andMore", { count: targets.length }) : "";
      const ok = window.confirm(
        t("trash.confirmPermanentBody", { names: `${names}${more}` }),
      );
      if (!ok) return;
      const again = window.prompt(t("trash.confirmDelete", { count: targets.length }));
      if (!confirmsPermanentDelete(again)) return;
    }
    if (action === "empty" && items.length) {
      const ok = window.confirm(t("trash.confirmEmptyBody", { count: items.length }));
      if (!ok) return;
      const again = window.prompt(t("trash.confirmEmpty"));
      if (!confirmsEmptyTrash(again)) return;
    }
    try {
      setBusy(true);
      setError("");
      if (action === "restore") await restoreTrashItems(targets);
      else if (action === "delete") await permanentlyDeleteTrashItems(targets);
      else await emptyTrash();
      setSelected([]);
      await load();
      await onLibraryChanged?.();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="trash-page">
      <header className="trash-page-head">
        <div>
          <small><Trash2 size={12} /> RECOVERY</small>
          <h1>{t("trash.title")}</h1>
          <p>{t("trash.lead")}</p>
        </div>
        <button
          type="button"
          disabled={busy || !items.length}
          title={!items.length ? t("trash.empty") : busy ? t("trash.processing") : t("trash.emptyForever")}
          onClick={() => void mutate("empty")}
        >
          <Trash2 size={14} /> {t("trash.emptyTrash")}
        </button>
      </header>
      <section className="trash-summary-card">
        <div className="trash-dial"><strong>{visibleItems.length}</strong><span>{t("trash.pending")}</span></div>
        <div>
          <strong>
            {items.length
              ? t("trash.earliestClear", {
                  when: expiry(Math.min(...items.map((item) => item.expiresAt))),
                })
              : t("trash.noPending")}
          </strong>
          <p>{t("trash.filterUsage", { size: formatSize(totalBytes) })}</p>
        </div>
        <div className="trash-time-rail">
          <span /><i /><i /><i /><i />
          <em>{t("trash.today")}</em>
          <em>{t("trash.day10")}</em>
          <em>{t("trash.day20")}</em>
          <em>{t("trash.day30")}</em>
        </div>
      </section>
      <section className="trash-table-shell">
        <div className="trash-table-tools">
          <label>
            <Search size={14} />
            <input
              placeholder={t("trash.searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label={t("trash.filterPackageAria")}
            value={packageId}
            onChange={(event) => setPackageId(event.target.value)}
          >
            <option value="">{t("trash.allProjects")}</option>
            {library?.packages.map((item) => (
              <option value={item.id} key={item.id}>{item.title}</option>
            ))}
          </select>
          <select
            aria-label={t("trash.filterAgeAria")}
            value={age}
            onChange={(event) => setAge(event.target.value as typeof age)}
          >
            <option value="all">{t("trash.allTime")}</option>
            <option value="7">{t("trash.last7")}</option>
            <option value="30">{t("trash.last30")}</option>
          </select>
          <span />
          {selected.length > 0 && (
            <>
              <em>{t("trash.selected", { count: selected.length })}</em>
              <button disabled={busy} type="button" className="restore" onClick={() => void mutate("restore")}>
                <RotateCcw size={13} /> {t("trash.restore")}
              </button>
              <button disabled={busy} type="button" className="forever" onClick={() => void mutate("delete")}>
                {t("trash.deleteForever")}
              </button>
            </>
          )}
        </div>
        {error && <div className="trash-empty"><p>{error}</p></div>}
        <table className="trash-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selected.length === visibleItems.length && visibleItems.length > 0}
                  onChange={() =>
                    setSelected(
                      selected.length === visibleItems.length ? [] : visibleItems.map(keyOf),
                    )
                  }
                />
              </th>
              <th>{t("trash.colName")}</th>
              <th>{t("trash.colPackage")}</th>
              <th>{t("trash.colKind")}</th>
              <th>{t("trash.colSize")}</th>
              <th>{t("trash.colDeleted")}</th>
              <th>{t("trash.colExpiry")}</th>
              <th>{t("trash.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => {
              const key = keyOf(item);
              return (
                <tr key={key} className={selected.includes(key) ? "selected" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(key)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(key)
                            ? current.filter((id) => id !== key)
                            : [...current, key],
                        )
                      }
                    />
                  </td>
                  <td>
                    <div className="trash-item-name">
                      <span className={item.kind}><ItemIcon kind={item.kind} /></span>
                      <div>
                        <strong>{item.displayName}</strong>
                        <small>
                          {t("trash.deletedBy", {
                            name: item.deletedBy || t("common.you"),
                          })}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{item.packageTitle}</td>
                  <td><span className="trash-kind">{kindLabel(item.kind, locale)}</span></td>
                  <td>{formatSize(item.sizeBytes)}</td>
                  <td>{formatTime(item.deletedAt)}</td>
                  <td><span className="trash-expiry"><i />{expiry(item.expiresAt)}</span></td>
                  <td>
                    <div className="trash-row-actions">
                      <button
                        type="button"
                        title={t("trash.restore")}
                        disabled={busy}
                        onClick={() => void mutate("restore", [item])}
                      >
                        <RotateCcw size={13} />
                      </button>
                      <button
                        type="button"
                        title={t("trash.deleteForever")}
                        disabled={busy}
                        onClick={() => void mutate("delete", [item])}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!error && visibleItems.length === 0 && (
          <div className="trash-empty">
            <span><Check size={22} /></span>
            <h3>{items.length ? t("trash.noFilterMatch") : t("trash.emptyTitle")}</h3>
            <p>{items.length ? t("trash.noFilterHint") : t("trash.emptyHint")}</p>
          </div>
        )}
        <footer>
          <span>{t("trash.totalItems", { count: visibleItems.length })}</span>
          <span>{t("trash.footerNote")}</span>
        </footer>
      </section>
    </div>
  );
}
