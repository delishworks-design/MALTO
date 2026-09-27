#!/usr/bin/env node
/**
 * Publish a built partner APK to the public download bucket and record it in
 * site_settings, so /join can offer it without any admin step.
 *
 * Plain .mjs on purpose: a release script should not need a TypeScript runner
 * installed to be usable, and this has to work in CI the same as on a laptop.
 *
 *   node scripts/upload-app-release.mjs [apk] [--version 1.0.0]
 *
 * The object path is content addressed, `partner-app/<version>-<sha8>.apk`.
 * That is deliberate. Browsers and intermediate caches hold on to public bucket
 * objects for a long time, so re-uploading a rebuilt APK over a stable path
 * would leave cleaners downloading the previous binary for days. A path that
 * changes whenever the bytes change makes staleness impossible, and makes it
 * safe to keep old builds around.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { readManifestVersion } from "./lib/apk.mjs";
import crypto from "node:crypto";

const BUCKET = "app-downloads";
const DEFAULT_APK = "android/app/build/outputs/apk/release/app-release.apk";

function loadEnv(file = ".env.local") {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    // Real environment wins, so CI can override a checked out .env.local.
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const apkArg = args.find((a) => !a.startsWith("--"));
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const apkPath = apkArg || DEFAULT_APK;

  if (!fs.existsSync(apkPath)) {
    throw new Error(`No APK at ${apkPath}. Build one first: cd android && ./gradlew assembleRelease`);
  }

  // versionCode is not optional: it is what Android compares against to decide
  // whether an update is really newer, so getting it wrong means cleaners
  // silently keep the build they already have. Read it out of the manifest.
  const fromManifest = readManifestVersion(apkPath);
  const versionName = flag("version", fromManifest.versionName);
  const versionCode = flag("versionCode", String(fromManifest.versionCode));

  if (!versionName || !versionCode) {
    throw new Error(
      "Could not read versionName/versionCode from the APK and none were given.\n" +
        "  Pass them explicitly:  --version 1.0.0 --versionCode 1"
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const bytes = fs.readFileSync(apkPath);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const sizeBytes = bytes.length;
  const sizeMb = (sizeBytes / 1048576).toFixed(2);

  // 1. The bucket. A public bucket needs no select policy written by hand;
  //    Supabase attaches those when the bucket is created public.
  const { data: buckets } = await supabase.storage.listBuckets();
  const existing = (buckets || []).find((b) => b.name === BUCKET);
  if (!existing) {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 50 * 1024 * 1024,
    });
    if (error) throw new Error(`Could not create bucket ${BUCKET}: ${error.message}`);
    console.log(`  bucket ${BUCKET}: created, public`);
  } else if (!existing.public) {
    const { error } = await supabase.storage.updateBucket(BUCKET, { public: true });
    if (error) throw new Error(`Could not make ${BUCKET} public: ${error.message}`);
    console.log(`  bucket ${BUCKET}: made public`);
  } else {
    console.log(`  bucket ${BUCKET}: already public`);
  }

  // 2. The object.
  const objectPath = `partner-app/${versionName}-${sha256.slice(0, 8)}.apk`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(objectPath, bytes, {
    contentType: "application/vnd.android.package-archive",
    cacheControl: "31536000", // a year: the path changes when the bytes change
    upsert: true,
  });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
  console.log(`  uploaded  : ${objectPath} (${sizeMb} MB)`);

  // 3. The settings rows. is_public so /join and /api/app/version can read
  //    them with the anon key, and never with an admin session.
  const { error: setErr } = await supabase.from("site_settings").upsert(
    [
      { key: "partner_app_url", value: publicUrl, is_public: true },
      { key: "partner_app_version", value: versionName, is_public: true },
      { key: "partner_app_min_version", value: flag("minVersion", versionName), is_public: true },
      { key: "partner_app_size_mb", value: sizeMb, is_public: true },
      { key: "partner_app_sha256", value: sha256, is_public: true },
      { key: "partner_app_updated_at", value: new Date().toISOString(), is_public: true },
    ],
    { onConflict: "key" }
  );
  if (setErr) throw new Error(`Could not update site_settings: ${setErr.message}`);

  // 4. Prove the public URL really serves the bytes we just wrote. A download
  //    link that 404s or serves a cached older build is the failure a partner
  //    hits on their own phone, so it is worth catching here.
  const check = await fetch(publicUrl, { cache: "no-store" });
  if (!check.ok) throw new Error(`Public URL returned ${check.status}. The bucket may not be serving.`);
  const served = Buffer.from(await check.arrayBuffer());
  const servedSha = crypto.createHash("sha256").update(served).digest("hex");
  if (servedSha !== sha256) {
    throw new Error(
      `Public URL served a different build.\n  uploaded: ${sha256}\n  served  : ${servedSha}`
    );
  }

  console.log(`  verified  : public URL serves sha256 ${servedSha.slice(0, 16)}...`);
  console.log(`  version   : ${versionName} (code ${versionCode})`);
  console.log(`  min       : ${flag("minVersion", versionName)}`);
  console.log(`  url       : ${publicUrl}`);
}

main().catch((e) => {
  console.error(`\n  ${e.message}\n`);
  process.exit(1);
});
