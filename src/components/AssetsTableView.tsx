import { useMemo, useState } from "react";
import {
  CheckSquare,
  FileText,
  Image,
  Music2,
  Search,
  Square,
  Video,
} from "lucide-react";
import { useI18n } from "../shared/i18n";
import type { ArtifactStatus, ArtifactView, PackageDetail } from "../shared/types";
import { kindLabel, statusLabel } from "../shared/utils";

function KindIcon({ kind }: { kind: ArtifactView["kind"] }) {
  if (kind === "image") return <Image size={13} />;
  if (kind === "audio") return <Music2 size={13} />;
  if (kind === "video") return <Video size={13} />;
  return <FileText size={13} />;
}

function folderOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "";
  return normalized.slice(0, idx);
}

export function AssetsTableView({
  detail,
  selectedArtifactId,
  onSelectArtifact,
  onBatchStatus,
  statusUpdating,
  onExportPackage,
  exporting,
  onImportArtifact,
  importing,
}: {
  detail: PackageDetail | null;
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
  onBatchStatus: (ids: string[], status: ArtifactStatus) => void;
  statusUpdating: boolean;
  onExportPackage?: () => void;
  exporting?: boolean;
  onImportArtifact?: () => void;
  importing?: boolean;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ArtifactStatus | "all" | "broken">("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>([]);

  const kinds = useMemo(
    () => [...new Set((detail?.artifacts ?? []).map((a) => a.kind))],
    [detail],
  );

  const rows = useMemo(() => {
    const all = detail?.artifacts ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((artifact) => {
      if (statusFilter === "broken" && artifact.reachable) return false;
      if (statusFilter !== "all" && statusFilter !== "broken" && artifact.status !== statusFilter) {
        return false;
      }
      if (kindFilter !== "all" && artifact.kind !== kindFilter) return false;
      if (!q) return true;
      const hay = `${artifact.displayName} ${artifact.fileRef.path} ${artifact.summary ?? ""} ${artifact.role ?? ""} ${(artifact.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [detail, query, statusFilter, kindFilter]);

  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));

  const toggleAll = () => {
    setSelected(allSelected ? [] : rows.map((row) => row.id));
  };

  const toggleOne = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  if (!detail) {
    return (
      <div className="empty-state">
        <p>{t("assets.pickPackage")}</p>
      </div>
    );
  }

  return (
    <div className="assets-table-page">
      <header className="assets-table-head">
        <div>
          <small>{t("assets.eyebrow")}</small>
          <h1>{t("assets.title")}</h1>
          <p>
            {t("assets.count", {
              title: detail.package.title,
              shown: rows.length,
              total: detail.artifacts.length,
            })}
          </p>
        </div>
        <div className="assets-table-actions">
          {onImportArtifact && (
            <button
              type="button"
              className="tool-btn"
              disabled={importing}
              onClick={onImportArtifact}
            >
              {importing ? t("assets.importing") : t("assets.importAppend")}
            </button>
          )}
          {onExportPackage && (
            <button type="button" className="tool-btn" disabled={exporting} onClick={onExportPackage}>
              {exporting ? t("assets.exporting") : t("assets.exportWbom")}
            </button>
          )}
        </div>
      </header>

      <div className="assets-table-tools">
        <label>
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("assets.searchPlaceholder")}
          />
        </label>
        <select
          aria-label={t("assets.filterStatus")}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
        >
          <option value="all">{t("assets.allStatuses")}</option>
          <option value="draft">{statusLabel("draft", locale)}</option>
          <option value="candidate">{statusLabel("candidate", locale)}</option>
          <option value="final">{statusLabel("final", locale)}</option>
          <option value="broken">{t("assets.broken")}</option>
        </select>
        <select
          aria-label={t("assets.filterKind")}
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value)}
        >
          <option value="all">{t("assets.allKinds")}</option>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>{kindLabel(kind, locale)}</option>
          ))}
        </select>
        {selected.length > 0 && (
          <>
            <em>{t("assets.selected", { count: selected.length })}</em>
            <button type="button" className="tool-btn" disabled={statusUpdating} onClick={() => onBatchStatus(selected, "final")}>{t("assets.batchFinal")}</button>
            <button type="button" className="tool-btn" disabled={statusUpdating} onClick={() => onBatchStatus(selected, "candidate")}>{t("assets.batchCandidate")}</button>
            <button type="button" className="tool-btn" disabled={statusUpdating} onClick={() => onBatchStatus(selected, "draft")}>{t("assets.batchDraft")}</button>
            <button type="button" className="tool-btn ghost" onClick={() => setSelected([])}>{t("assets.clearSelection")}</button>
          </>
        )}
      </div>

      <div className="assets-table-shell">
        <table className="assets-table">
          <thead>
            <tr>
              <th>
                <button type="button" className="assets-check" onClick={toggleAll} aria-label={t("assets.selectAll")}>
                  {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>
              </th>
              <th>{t("assets.colName")}</th>
              <th>{t("assets.colKind")}</th>
              <th>{t("assets.colStatus")}</th>
              <th>{t("assets.colRole")}</th>
              <th>{t("assets.colUpdated")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((artifact) => {
              const active = selectedArtifactId === artifact.id;
              const checked = selected.includes(artifact.id);
              return (
                <tr
                  key={artifact.id}
                  className={`${active ? "active" : ""} ${checked ? "selected" : ""}`}
                  onClick={() => onSelectArtifact(artifact.id)}
                >
                  <td onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="assets-check"
                      onClick={() => toggleOne(artifact.id)}
                      aria-label={t("assets.selectOne", { name: artifact.displayName })}
                    >
                      {checked ? <CheckSquare size={14} /> : <Square size={14} />}
                    </button>
                  </td>
                  <td>
                    <div className="assets-name">
                      <span className={artifact.kind}><KindIcon kind={artifact.kind} /></span>
                      <div>
                        <strong>{artifact.displayName}</strong>
                        <small>{artifact.fileRef.path || artifact.summary || artifact.id}</small>
                      </div>
                    </div>
                  </td>
                  <td><span className="chip">{kindLabel(artifact.kind, locale)}</span></td>
                  <td>
                    <span className={`chip status-${artifact.status}`}>{statusLabel(artifact.status, locale)}</span>
                    {!artifact.reachable && <span className="chip status-broken">{t("assets.broken")}</span>}
                  </td>
                  <td title={artifact.fileRef.path}>
                    {folderOf(artifact.fileRef.path) || artifact.role || "—"}
                  </td>
                  <td>{new Date(artifact.updatedAt).toLocaleDateString(locale === "zh" ? "zh-CN" : undefined)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="trash-empty">
            <h3>{t("assets.noMatch")}</h3>
            <p>{t("assets.noMatchHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
