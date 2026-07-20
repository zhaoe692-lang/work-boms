import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  Download,
  LayoutGrid,
  List,
  PackagePlus,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  exportPlugin,
  getPluginCatalog,
  importPlugin,
  installBundledPlugin,
  setPluginEnabled,
  uninstallPlugin,
} from "../shared/api";
import type { PluginInfo } from "../shared/types";
import { useI18n, type MessageKey } from "../shared/i18n";
import {
  localizedPluginDescription,
  localizedPluginDisplayName,
} from "../shared/pluginI18n";

type PluginViewMode = "card" | "list";

const VIEW_MODE_KEY = "workbom.plugins.viewMode";

function readViewMode(): PluginViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    return raw === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}

function sourceLabelKey(source: string): MessageKey | null {
  if (source === "bundled") return "plugins.preinstalled";
  if (source === "imported") return "plugins.imported";
  if (source === "catalog") return "plugins.catalog";
  return null;
}

function kindLabel(kind: string | undefined, t: (key: MessageKey) => string): string | null {
  if (!kind) return null;
  if (kind === "agent-skill") return t("plugins.kind.agentSkill");
  return kind;
}

function PluginActions({
  plugin,
  busy,
  onExport,
  onToggle,
  onUninstall,
  onInstall,
}: {
  plugin: PluginInfo;
  busy: boolean;
  onExport: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onUninstall: (id: string) => void;
  onInstall: (id: string) => void;
}) {
  const { t } = useI18n();

  if (plugin.installed) {
    return (
      <>
        <button
          type="button"
          className="tool-btn"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(plugin.id, !plugin.enabled);
          }}
        >
          {plugin.enabled ? t("plugins.disable") : t("plugins.enable")}
        </button>
        <button
          type="button"
          className="tool-btn"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onExport(plugin.id);
          }}
        >
          <Upload size={14} /> {t("plugins.export")}
        </button>
        <button
          type="button"
          className="tool-btn danger"
          disabled={busy || plugin.official}
          title={
            plugin.official
              ? t("plugins.officialUninstallHint")
              : t("plugins.uninstallHint")
          }
          onClick={(e) => {
            e.stopPropagation();
            onUninstall(plugin.id);
          }}
        >
          <Trash2 size={14} /> {t("plugins.uninstall")}
        </button>
      </>
    );
  }

  return (
    <button
      type="button"
      className="tool-btn primary"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onInstall(plugin.id);
      }}
    >
      <Download size={14} /> {t("plugins.install")}
    </button>
  );
}

function PluginCard({
  plugin,
  layout,
  busyId,
  onOpen,
  onExport,
  onToggle,
  onUninstall,
  onInstall,
}: {
  plugin: PluginInfo;
  layout: PluginViewMode;
  busyId: string | null;
  onOpen: (id: string) => void;
  onExport: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onUninstall: (id: string) => void;
  onInstall: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const busy = busyId === plugin.id;
  const sourceKey = sourceLabelKey(plugin.source);
  const kind = kindLabel(plugin.kind, t);
  const displayName = localizedPluginDisplayName(locale, plugin);
  const description = localizedPluginDescription(locale, plugin);
  const meta = `${plugin.author} · v${plugin.version}${kind ? ` · ${kind}` : ""}`;

  const actions = (
    <PluginActions
      plugin={plugin}
      busy={busy}
      onExport={onExport}
      onToggle={onToggle}
      onUninstall={onUninstall}
      onInstall={onInstall}
    />
  );

  if (layout === "list") {
    return (
      <article
        className={`plugin-row plugin-openable${plugin.enabled ? "" : " is-disabled"}`}
        role="button"
        tabIndex={0}
        aria-label={t("plugins.detailOpen")}
        onClick={() => onOpen(plugin.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(plugin.id);
          }
        }}
      >
        <div className="plugin-card-icon" aria-hidden>
          {plugin.official ? <ShieldCheck size={18} /> : <Puzzle size={18} />}
        </div>
        <div className="plugin-row-main">
          <div className="plugin-row-title">
            <h2>{displayName}</h2>
            {plugin.official && (
              <span className="plugin-badge official">{t("plugins.official")}</span>
            )}
            {plugin.installed && sourceKey && (
              <span className="plugin-badge source">{t(sourceKey)}</span>
            )}
            {!plugin.enabled && plugin.installed && (
              <span className="plugin-badge muted">{t("plugins.disabled")}</span>
            )}
          </div>
          <p className="plugin-row-meta">{meta}</p>
          <p className="plugin-row-desc">{description || t("plugins.noDesc")}</p>
        </div>
        <div className="plugin-row-actions">{actions}</div>
      </article>
    );
  }

  return (
    <article
      className={`plugin-card plugin-openable${plugin.enabled ? "" : " is-disabled"}`}
      role="button"
      tabIndex={0}
      aria-label={t("plugins.detailOpen")}
      onClick={() => onOpen(plugin.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(plugin.id);
        }
      }}
    >
      <header className="plugin-card-head">
        <div className="plugin-card-icon" aria-hidden>
          {plugin.official ? <ShieldCheck size={18} /> : <Puzzle size={18} />}
        </div>
        <div className="plugin-card-titles">
          <h2>
            {displayName}
            {plugin.official && (
              <span className="plugin-badge official">{t("plugins.official")}</span>
            )}
            {plugin.installed && sourceKey && (
              <span className="plugin-badge source">{t(sourceKey)}</span>
            )}
            {!plugin.enabled && plugin.installed && (
              <span className="plugin-badge muted">{t("plugins.disabled")}</span>
            )}
          </h2>
          <p>{meta}</p>
        </div>
      </header>
      <p className="plugin-card-desc">{description || t("plugins.noDesc")}</p>
      {!!plugin.targets?.length && (
        <ul className="plugin-targets">
          <li>{t("plugins.universal")}</li>
        </ul>
      )}
      {!!plugin.issues?.length && (
        <div className="plugin-issues" role="status">
          {plugin.issues.map((issue) => (
            <div key={issue}>{issue}</div>
          ))}
        </div>
      )}
      <footer className="plugin-card-actions">{actions}</footer>
    </article>
  );
}

function PluginDetail({
  plugin,
  busyId,
  onBack,
  onExport,
  onToggle,
  onUninstall,
  onInstall,
}: {
  plugin: PluginInfo;
  busyId: string | null;
  onBack: () => void;
  onExport: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onUninstall: (id: string) => void;
  onInstall: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const busy = busyId === plugin.id;
  const sourceKey = sourceLabelKey(plugin.source);
  const kind = kindLabel(plugin.kind, t);
  const displayName = localizedPluginDisplayName(locale, plugin);
  const description = localizedPluginDescription(locale, plugin);

  return (
    <div className="plugin-detail">
      <header className="plugin-detail-head">
        <button type="button" className="tool-btn" onClick={onBack}>
          <ArrowLeft size={14} /> {t("plugins.backToMarket")}
        </button>
        <small>
          <Puzzle size={12} /> {t("plugins.detail")}
        </small>
      </header>

      <div className="plugin-detail-hero">
        <div className="plugin-card-icon plugin-detail-icon" aria-hidden>
          {plugin.official ? <ShieldCheck size={22} /> : <Puzzle size={22} />}
        </div>
        <div className="plugin-detail-titles">
          <h1>
            {displayName}
            {plugin.official && (
              <span className="plugin-badge official">{t("plugins.official")}</span>
            )}
            {plugin.installed && sourceKey && (
              <span className="plugin-badge source">{t(sourceKey)}</span>
            )}
            {!plugin.enabled && plugin.installed && (
              <span className="plugin-badge muted">{t("plugins.disabled")}</span>
            )}
          </h1>
          <p className="plugin-detail-desc">{description || t("plugins.noDesc")}</p>
        </div>
      </div>

      <div className="plugin-detail-actions">
        <PluginActions
          plugin={plugin}
          busy={busy}
          onExport={onExport}
          onToggle={onToggle}
          onUninstall={onUninstall}
          onInstall={onInstall}
        />
      </div>

      <section className="plugin-detail-section">
        <h3>{t("plugins.howToTitle")}</h3>
        <pre className="plugin-detail-howto">{t("plugins.howToBody")}</pre>
      </section>

      {!!plugin.targets?.length && (
        <section className="plugin-detail-section">
          <h3>{t("plugins.targetsTitle")}</h3>
          <ul className="plugin-targets">
            {plugin.targets.map((target) => (
              <li key={target}>{target}</li>
            ))}
          </ul>
        </section>
      )}

      {!!plugin.capabilities?.length && (
        <section className="plugin-detail-section">
          <h3>{t("plugins.capabilitiesTitle")}</h3>
          <ul className="plugin-targets">
            {plugin.capabilities.map((cap) => (
              <li key={cap}>{cap}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="plugin-detail-section">
        <h3>{t("plugins.metaTitle")}</h3>
        <dl className="plugin-detail-meta">
          <div>
            <dt>{t("plugins.metaId")}</dt>
            <dd>{plugin.id}</dd>
          </div>
          <div>
            <dt>{t("plugins.metaVersion")}</dt>
            <dd>v{plugin.version}</dd>
          </div>
          <div>
            <dt>{t("plugins.metaAuthor")}</dt>
            <dd>{plugin.author}</dd>
          </div>
          {kind && (
            <div>
              <dt>{t("plugins.metaKind")}</dt>
              <dd>{kind}</dd>
            </div>
          )}
          {plugin.license && (
            <div>
              <dt>{t("plugins.metaLicense")}</dt>
              <dd>{plugin.license}</dd>
            </div>
          )}
          {plugin.installPath && (
            <div>
              <dt>{t("plugins.metaPath")}</dt>
              <dd className="plugin-detail-path">{plugin.installPath}</dd>
            </div>
          )}
          {plugin.homepage && (
            <div>
              <dt>{t("plugins.metaHomepage")}</dt>
              <dd>{plugin.homepage}</dd>
            </div>
          )}
        </dl>
      </section>

      {!!plugin.issues?.length && (
        <section className="plugin-detail-section">
          <h3>{t("plugins.issuesTitle")}</h3>
          <div className="plugin-issues" role="status">
            {plugin.issues.map((issue) => (
              <div key={issue}>{issue}</div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: PluginViewMode;
  onChange: (mode: PluginViewMode) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="plugins-view-toggle" role="group" aria-label={t("plugins.viewMode")}>
      <button
        type="button"
        className={mode === "card" ? "active" : ""}
        aria-pressed={mode === "card"}
        title={t("plugins.viewCard")}
        onClick={() => onChange("card")}
      >
        <LayoutGrid size={14} />
        <span>{t("plugins.viewCard")}</span>
      </button>
      <button
        type="button"
        className={mode === "list" ? "active" : ""}
        aria-pressed={mode === "list"}
        title={t("plugins.viewList")}
        onClick={() => onChange("list")}
      >
        <List size={14} />
        <span>{t("plugins.viewList")}</span>
      </button>
    </div>
  );
}

export function PluginMarketplaceView() {
  const { t, locale } = useI18n();
  const [installed, setInstalled] = useState<PluginInfo[]>([]);
  const [available, setAvailable] = useState<PluginInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewMode, setViewMode] = useState<PluginViewMode>(readViewMode);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allPlugins = useMemo(
    () => [...installed, ...available],
    [installed, available],
  );
  const selected = selectedId
    ? allPlugins.find((p) => p.id === selectedId) ?? null
    : null;

  const pluginLabel = (plugin: PluginInfo) =>
    localizedPluginDisplayName(locale, plugin);

  const setMode = (mode: PluginViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  const load = useCallback(async () => {
    try {
      setError("");
      const catalog = await getPluginCatalog();
      setInstalled(catalog.installed);
      setAvailable(catalog.available);
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedId && !allPlugins.some((p) => p.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, allPlugins]);

  const withBusy = async (id: string, action: () => Promise<void>) => {
    try {
      setBusyId(id);
      setError("");
      setNotice("");
      await action();
      await load();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyId(null);
    }
  };

  const handleImport = async () => {
    try {
      setError("");
      setNotice("");
      const selectedDir = await open({
        directory: true,
        multiple: false,
        title: t("plugins.pickImportDir"),
      });
      if (!selectedDir || Array.isArray(selectedDir)) return;
      setBusyId("__import__");
      try {
        const info = await importPlugin(selectedDir, false);
        setNotice(
          t("plugins.importedNotice", {
            name: pluginLabel(info),
            version: info.version,
          }),
        );
        setSelectedId(info.id);
      } catch (reason) {
        const message = String(reason);
        if (
          message.includes("已安装") ||
          message.includes(t("plugins.alreadyInstalledToken")) ||
          /already installed/i.test(message)
        ) {
          const ok = window.confirm(
            `${message}\n\n${t("plugins.overwriteConfirm")}`,
          );
          if (!ok) throw reason;
          const info = await importPlugin(selectedDir, true);
          setNotice(
            t("plugins.overwrittenNotice", { name: pluginLabel(info) }),
          );
          setSelectedId(info.id);
        } else {
          throw reason;
        }
      }
      await load();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyId(null);
    }
  };

  const handleExport = (pluginId: string) =>
    void withBusy(pluginId, async () => {
      const dest = await open({
        directory: true,
        multiple: false,
        title: t("plugins.pickExportDir"),
      });
      if (!dest || Array.isArray(dest)) return;
      const path = await exportPlugin(pluginId, dest);
      setNotice(t("plugins.exported", { path }));
    });

  const handleToggle = (pluginId: string, enabled: boolean) =>
    void withBusy(pluginId, async () => {
      await setPluginEnabled(pluginId, enabled);
      setNotice(
        enabled ? t("plugins.enabledNotice") : t("plugins.disabledNotice"),
      );
    });

  const handleUninstall = (pluginId: string) => {
    const plugin = installed.find((p) => p.id === pluginId);
    if (!plugin || plugin.official) return;
    if (
      !window.confirm(
        t("plugins.confirmUninstall", { name: pluginLabel(plugin) }),
      )
    ) {
      return;
    }
    void withBusy(pluginId, async () => {
      await uninstallPlugin(pluginId);
      setNotice(t("plugins.uninstalled"));
      if (selectedId === pluginId) setSelectedId(null);
    });
  };

  const handleInstall = (pluginId: string) =>
    void withBusy(pluginId, async () => {
      await installBundledPlugin(pluginId);
      setNotice(t("plugins.installedNotice"));
    });

  if (selected) {
    return (
      <div className="plugins-page">
        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner undo">{notice}</div>}
        <PluginDetail
          plugin={selected}
          busyId={busyId}
          onBack={() => setSelectedId(null)}
          onExport={handleExport}
          onToggle={handleToggle}
          onUninstall={handleUninstall}
          onInstall={handleInstall}
        />
      </div>
    );
  }

  const renderPlugins = (plugins: PluginInfo[]) => (
    <div className={viewMode === "list" ? "plugin-list" : "plugin-grid"}>
      {plugins.map((plugin) => (
        <PluginCard
          key={plugin.id}
          plugin={plugin}
          layout={viewMode}
          busyId={busyId}
          onOpen={setSelectedId}
          onExport={handleExport}
          onToggle={handleToggle}
          onUninstall={handleUninstall}
          onInstall={handleInstall}
        />
      ))}
    </div>
  );

  return (
    <div className="plugins-page">
      <header className="plugins-page-head">
        <div>
          <small>
            <Puzzle size={12} /> {t("plugins.eyebrow")}
          </small>
          <h1>{t("plugins.title")}</h1>
          <p>{t("plugins.lead")}</p>
        </div>
        <div className="plugins-page-tools">
          <ViewModeToggle mode={viewMode} onChange={setMode} />
          <button
            type="button"
            className="tool-btn"
            onClick={() => void load()}
            disabled={!!busyId}
          >
            <RefreshCw size={14} /> {t("common.refresh")}
          </button>
          <button
            type="button"
            className="tool-btn primary"
            onClick={() => void handleImport()}
            disabled={!!busyId}
          >
            <PackagePlus size={14} /> {t("plugins.import")}
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner undo">{notice}</div>}

      <section className="plugins-section">
        <div className="plugins-section-head">
          <h3>{t("plugins.installed", { count: installed.length })}</h3>
        </div>
        {installed.length === 0 ? (
          <div className="empty-state">
            <p>{t("plugins.empty")}</p>
          </div>
        ) : (
          renderPlugins(installed)
        )}
      </section>

      {available.length > 0 && (
        <section className="plugins-section">
          <div className="plugins-section-head">
            <h3>
              {t("plugins.available")} ({available.length})
            </h3>
          </div>
          {renderPlugins(available)}
        </section>
      )}
    </div>
  );
}
