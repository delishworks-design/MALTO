/**
 * Checks for the version comparison the partner app relies on.
 *
 * These rules decide whether a cleaner is allowed to keep using an installed
 * build, so a mistake here either locks people out of their own bookings or
 * lets a broken build run forever. Nothing about it is visible in the UI when
 * it is wrong, which is why it gets its own checks.
 *
 *   node --experimental-strip-types scripts/test-app-release.ts
 */
import {
  checkVersion,
  compareVersions,
  downloadUrl,
  releaseLabel,
  toAppRelease,
  EMPTY_RELEASE,
} from "../lib/app-release.ts";

let failed = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.log(`  FAIL  ${name}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${name}`);
  }
};

// --- compareVersions -------------------------------------------------------
eq("equal versions", compareVersions("1.0.0", "1.0.0"), 0);
eq("different patch", compareVersions("1.0.1", "1.0.0") > 0, true);
eq("different minor", compareVersions("1.1.0", "1.10.0") < 0, true);
eq("numeric, not lexical, patch", compareVersions("1.0.9", "1.0.10") < 0, true);
eq("more segments wins", compareVersions("1.0.0.1", "1.0.0") > 0, true);
eq("missing segments are zero", compareVersions("1.0", "1.0.0"), 0);
eq("leading zeros", compareVersions("1.02.0", "1.2.0"), 0);
eq("pre-release suffix ignored", compareVersions("1.0.0-rc1", "1.0.0"), 0);
eq("build metadata ignored", compareVersions("1.0.0+7", "1.0.0"), 0);
eq("two digit minor", compareVersions("1.10.0", "1.9.0") > 0, true);
// A single digit vs two digit segment is exactly the case a string compare
// gets wrong: "1.0.9" is older than "1.0.10".
eq("1.0.9 older than 1.0.10", compareVersions("1.0.9", "1.0.10") < 0, true);
eq("empty is treated as zero", compareVersions("", "0.0.1") < 0, true);
eq("garbage does not throw", compareVersions("banana", "1.0.0") < 0, true);

// --- toAppRelease ----------------------------------------------------------
const rows = [
  { key: "partner_app_url", value: "https://example.supabase.co/storage/v1/object/public/app-downloads/a.apk" },
  { key: "partner_app_version", value: "1.0.0" },
  { key: "partner_app_min_version", value: "1.0.0" },
  { key: "partner_app_size_mb", value: "2.72" },
  { key: "partner_app_sha256", value: "cf69b117155af83d7f525670c51c5c6447c22422fbb7458baebaf8d61cf7f7b3" },
  { key: "partner_app_updated_at", value: "2026-09-27T00:00:00.000Z" },
];
const release = toAppRelease(rows);
eq("version", release.version, "1.0.0");
eq("size", release.sizeMb, "2.72");

// The important default: a cleared minimum must not lock everyone out.
const noMin = toAppRelease([
  { key: "partner_app_url", value: "https://x/a.apk" },
  { key: "partner_app_version", value: "1.0.0" },
  { key: "partner_app_min_version", value: "" },
]);
eq("cleared minimum falls back to version", noMin.minVersion, "1.0.0");

eq("empty rows", toAppRelease([]), EMPTY_RELEASE);
eq("null rows", toAppRelease(null), EMPTY_RELEASE);
eq("null value tolerated", toAppRelease([{ key: "partner_app_url", value: null }]).url, "");

// --- downloadUrl -----------------------------------------------------------
eq("plain url", downloadUrl("https://x/a.apk"), "https://x/a.apk?download=malto-partner.apk");
eq("url with query", downloadUrl("https://x/a.apk?v=1"), "https://x/a.apk?v=1&download=malto-partner.apk");
eq("empty url stays empty", downloadUrl(""), "");

// --- checkVersion ----------------------------------------------------------
const pub = { ...release, minVersion: "1.2.0" };
eq("current build accepted", checkVersion("1.2.0", pub).ok, true);
eq("newer than minimum accepted", checkVersion("2.0.0", pub).ok, true);
eq("older than minimum blocked", checkVersion("1.1.9", pub).ok, false);
eq("blocked reason", checkVersion("1.0.0", pub).reason, "below-minimum");
eq("ok reason", checkVersion("1.2.0", pub).reason, "ok");

// Nothing published must not block: /join degrades until a build is uploaded.
eq("nothing published does not block", checkVersion("1.0.0", EMPTY_RELEASE).ok, true);
eq("nothing published reason", checkVersion("1.0.0", EMPTY_RELEASE).reason, "unknown");
// A build that cannot report its own version must not lock its owner out.
eq("unknown build version does not block", checkVersion("", release).ok, true);
eq("unknown build reason", checkVersion("", release).reason, "unknown");

// --- releaseLabel ----------------------------------------------------------
eq("label with hash", releaseLabel(release), "1.0.0 (cf69b117)");
eq("label without hash", releaseLabel({ ...release, sha256: "" }), "1.0.0");
eq("label when unpublished", releaseLabel(EMPTY_RELEASE), "");

console.log(failed ? `\n  ${failed} failing` : "\n  all passing");
process.exit(failed ? 1 : 0);
