/**
 * The published Android build, and the rules for deciding whether an installed
 * build is still current.
 *
 * Pure on purpose, with no Supabase import. The /join page, the version
 * endpoint and the in-app update check all need the same comparison, and the
 * check itself has to run inside a client component, which cannot import the
 * server client. Keeping the rules in one dependency-free module is what stops
 * the website and the app from disagreeing about what "too old" means.
 */

export type AppRelease = {
  url: string;
  version: string;
  minVersion: string;
  sizeMb: string;
  sha256: string;
  updatedAt: string;
};

export const EMPTY_RELEASE: AppRelease = {
  url: "",
  version: "",
  minVersion: "",
  sizeMb: "",
  sha256: "",
  updatedAt: "",
};

export const APP_SETTING_KEYS = [
  "partner_app_url",
  "partner_app_version",
  "partner_app_min_version",
  "partner_app_size_mb",
  "partner_app_sha256",
  "partner_app_updated_at",
] as const;

/** Turn the site_settings rows into a release, ignoring anything unset. */
export function toAppRelease(rows: { key: string; value: string | null }[] | null | undefined): AppRelease {
  const map: Record<string, string> = {};
  for (const row of rows ?? []) {
    if (row?.key && typeof row.value === "string") map[row.key] = row.value;
  }
  return {
    url: map.partner_app_url ?? "",
    version: map.partner_app_version ?? "",
    // A build with no explicit minimum is its own minimum. Assuming a floor of
    // something else would lock out every install the moment the setting was
    // cleared, which is the one moment an admin is least likely to notice.
    minVersion: map.partner_app_min_version || map.partner_app_version || "",
    sizeMb: map.partner_app_size_mb ?? "",
    sha256: map.partner_app_sha256 ?? "",
    updatedAt: map.partner_app_updated_at ?? "",
  };
}

/**
 * URL that makes the browser save the file instead of trying to display it.
 *
 * The `download` attribute is only honoured same-origin, and the APK lives on
 * supabase.co while the page is on vercel.app, so on its own it would be
 * silently dropped and the browser would navigate to the binary. The storage
 * service sets Content-Disposition: attachment for the download parameter
 * instead, which works across origins.
 */
export function downloadUrl(url: string, filename = "malto-partner.apk"): string {
  if (!url) return "";
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(filename)}`;
}

/**
 * Compare dotted numeric versions. Any pre-release suffix is ignored, so
 * "1.0.0-rc1" and "1.0.0" are treated as equal rather than silently making
 * every release candidate look older than the build it replaces.
 * Returns a negative number when a < b, zero when equal, positive when a > b.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    String(v ?? "")
      .trim()
      .split(/[-+\s]/)[0]
      .split(".")
      .map((p) => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      });

  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type Verdict = {
  /** False means the installed build is too old to keep using. */
  ok: boolean;
  reason: "ok" | "below-minimum" | "unknown";
  current: string;
  latest: string;
  min: string;
  url: string;
};

export function checkVersion(current: string, release: AppRelease): Verdict {
  const base = {
    current: current ?? "",
    latest: release.version,
    min: release.minVersion,
    url: release.url,
  };

  // Nothing published yet, or the app build cannot identify itself. Do not
  // block anyone over missing metadata; the website portal still works.
  if (!release.url || !release.version || !current) {
    return { ...base, ok: true, reason: "unknown" };
  }
  if (release.minVersion && compareVersions(current, release.minVersion) < 0) {
    return { ...base, ok: false, reason: "below-minimum" };
  }
  return { ...base, ok: true, reason: "ok" };
}

/** "1.0.0-cf69b117" style label, for showing which build a link points at. */
export function releaseLabel(release: AppRelease): string {
  if (!release.version) return "";
  const short = release.sha256 ? release.sha256.slice(0, 8) : "";
  return short ? `${release.version} (${short})` : release.version;
}
