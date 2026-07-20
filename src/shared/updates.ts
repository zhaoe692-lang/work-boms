/** Check GitHub Releases for a newer WorkBOM version. */

export const GITHUB_OWNER = "zhaoe692-lang";
export const GITHUB_REPO = "work-boms";
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
export const GITHUB_LATEST_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

export type UpdateCheckStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "none"
  | "error";

export interface ReleaseInfo {
  tagName: string;
  version: string;
  htmlUrl: string;
  name: string;
  publishedAt?: string;
  /** Prefer .dmg asset when present. */
  downloadUrl: string;
}

export interface UpdateCheckResult {
  status: Exclude<UpdateCheckStatus, "idle" | "checking">;
  currentVersion: string;
  latest?: ReleaseInfo;
  message?: string;
}

/** Normalize `v0.1.83` / `WorkBOM_0.1.83` → `0.1.83`. */
export function normalizeVersion(raw: string): string {
  let v = raw.trim();
  v = v.replace(/^v/i, "");
  const m = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(v);
  return m ? m[1] : v;
}

/** Compare semver-ish strings. Returns >0 if a>b, <0 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
  const pb = normalizeVersion(b).split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function pickDownloadUrl(release: {
  html_url: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}): string {
  const assets = release.assets ?? [];
  const dmg =
    assets.find((a) => /\.dmg$/i.test(a.name ?? "")) ??
    assets.find((a) => /aarch64|arm64|mac/i.test(a.name ?? ""));
  return dmg?.browser_download_url || release.html_url;
}

export async function checkGitHubUpdate(
  currentVersion: string,
): Promise<UpdateCheckResult> {
  const current = normalizeVersion(currentVersion);
  try {
    const res = await fetch(GITHUB_LATEST_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 404) {
      return {
        status: "none",
        currentVersion: current,
        message: "no_releases",
      };
    }
    if (!res.ok) {
      return {
        status: "error",
        currentVersion: current,
        message: `http_${res.status}`,
      };
    }
    const data = (await res.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      published_at?: string;
      draft?: boolean;
      prerelease?: boolean;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    if (!data.tag_name || data.draft) {
      return { status: "none", currentVersion: current, message: "no_releases" };
    }
    const latest: ReleaseInfo = {
      tagName: data.tag_name,
      version: normalizeVersion(data.tag_name),
      htmlUrl: data.html_url || GITHUB_RELEASES_URL,
      name: data.name || data.tag_name,
      publishedAt: data.published_at,
      downloadUrl: pickDownloadUrl({
        html_url: data.html_url || GITHUB_RELEASES_URL,
        assets: data.assets,
      }),
    };
    if (compareVersions(latest.version, current) > 0) {
      return { status: "available", currentVersion: current, latest };
    }
    return { status: "upToDate", currentVersion: current, latest };
  } catch (err) {
    return {
      status: "error",
      currentVersion: current,
      message: String(err),
    };
  }
}
