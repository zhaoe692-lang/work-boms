/**
 * App settings modal — Obsidian-style: left nav + content panes.
 * Sections: About (version / check updates) · General (language).
 */
import { useEffect, useState } from "react";
import { Info, Settings2, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n, type LocalePreference } from "../shared/i18n";
import type { MessageKey } from "../shared/i18n";
import {
  checkGitHubUpdate,
  GITHUB_RELEASES_URL,
  type UpdateCheckResult,
  type UpdateCheckStatus,
} from "../shared/updates";
import { cn } from "@/lib/utils";
import appIcon from "@/assets/workbom-app-icon.png";

type SettingsSection = "about" | "general";

const SECTIONS: { id: SettingsSection; labelKey: MessageKey; icon: typeof Info }[] =
  [
    { id: "about", labelKey: "settings.navAbout", icon: Info },
    { id: "general", labelKey: "settings.navGeneral", icon: Settings2 },
  ];

const LANG_OPTIONS: { value: LocalePreference; labelKey: MessageKey }[] = [
  { value: "system", labelKey: "common.langSystem" },
  { value: "zh", labelKey: "common.langZh" },
  { value: "en", labelKey: "common.langEn" },
];

export function SettingsModal({
  open,
  onClose,
  appVersion,
  initialSection = "about",
}: {
  open: boolean;
  onClose: () => void;
  appVersion: string;
  initialSection?: SettingsSection;
}) {
  const { t, preference, setPreference } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [checkStatus, setCheckStatus] = useState<UpdateCheckStatus>("idle");
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setSection(initialSection);
    setCheckStatus("idle");
    setCheckResult(null);
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const runCheck = async () => {
    setCheckStatus("checking");
    setCheckResult(null);
    const result = await checkGitHubUpdate(appVersion);
    setCheckResult(result);
    setCheckStatus(result.status);
  };

  const openLink = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const statusText = (() => {
    if (checkStatus === "checking") return t("settings.updateChecking");
    if (checkStatus === "upToDate") return t("settings.updateUpToDate");
    if (checkStatus === "available" && checkResult?.latest) {
      return t("settings.updateAvailable", {
        version: checkResult.latest.version,
      });
    }
    if (checkStatus === "none") return t("settings.updateNone");
    if (checkStatus === "error") return t("settings.updateError");
    return null;
  })();

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="settings-nav" aria-label={t("settings.title")}>
          <h2 className="settings-nav-title">{t("settings.title")}</h2>
          <nav className="settings-nav-list">
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn("settings-nav-item", active && "active")}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <Icon size={16} />
                  <span>{t(item.labelKey)}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="settings-main">
          <header className="settings-main-head">
            <h3>
              {section === "about"
                ? t("settings.navAbout")
                : t("settings.navGeneral")}
            </h3>
            <button
              type="button"
              className="settings-close"
              aria-label={t("common.close")}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>

          <div className="settings-body">
            {section === "about" && (
              <>
                <section className="settings-card settings-about">
                  <div className="settings-about-hero">
                    <span className="settings-about-logo" aria-hidden>
                      <img src={appIcon} alt="" width={56} height={56} />
                    </span>
                    <div className="settings-about-identity">
                      <div className="settings-about-title-row">
                        <strong>WorkBOM</strong>
                        <span className="settings-about-version">
                          {t("about.version", { version: appVersion })}
                        </span>
                      </div>
                      <p className="settings-about-tagline">{t("about.lead")}</p>
                    </div>
                  </div>

                  <dl className="settings-about-specs">
                    <div>
                      <dt>{t("about.specPlatform")}</dt>
                      <dd>{t("about.platform")}</dd>
                    </div>
                    <div>
                      <dt>{t("about.specData")}</dt>
                      <dd>{t("about.sourceStays")}</dd>
                    </div>
                    <div>
                      <dt>{t("about.specPrivacy")}</dt>
                      <dd>{t("about.privacy")}</dd>
                    </div>
                  </dl>
                </section>

                <section className="settings-card settings-row">
                  <div className="settings-row-text">
                    <strong>{t("settings.updates")}</strong>
                    <p className="settings-muted">
                      {statusText ?? t("settings.updatesHint")}
                    </p>
                  </div>
                  <div className="settings-row-actions">
                    <button
                      type="button"
                      className="settings-btn"
                      disabled={checkStatus === "checking"}
                      onClick={() => void runCheck()}
                    >
                      {checkStatus === "checking"
                        ? t("settings.updateChecking")
                        : t("settings.checkUpdates")}
                    </button>
                    {checkStatus === "available" && checkResult?.latest && (
                      <button
                        type="button"
                        className="settings-btn primary"
                        onClick={() =>
                          void openLink(checkResult.latest!.downloadUrl)
                        }
                      >
                        {t("settings.openDownload")}
                      </button>
                    )}
                  </div>
                </section>

                <section className="settings-card settings-row">
                  <div className="settings-row-text">
                    <strong>{t("settings.changelog")}</strong>
                    <p className="settings-muted">{t("settings.changelogHint")}</p>
                  </div>
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() => void openLink(GITHUB_RELEASES_URL)}
                  >
                    {t("settings.openReleases")}
                  </button>
                </section>
              </>
            )}

            {section === "general" && (
              <section className="settings-card settings-row">
                <div className="settings-row-text">
                  <strong>{t("common.language")}</strong>
                  <p className="settings-muted">{t("settings.languageHint")}</p>
                </div>
                <select
                  className="settings-select"
                  value={preference}
                  aria-label={t("common.language")}
                  onChange={(e) =>
                    setPreference(e.target.value as LocalePreference)
                  }
                >
                  {LANG_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
