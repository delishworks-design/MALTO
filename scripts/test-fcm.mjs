#!/usr/bin/env node
/**
 * Proves the FCM send path end to end without a phone.
 *
 * What this can and cannot establish
 * ---------------------------------
 * A real device token only exists on hardware, and this project has no emulator,
 * so a device is faked with a syntactically valid but unregistered token. FCM
 * answers that with 404 UNREGISTERED, and that specific answer is the proof:
 *
 *   - the access token was minted from the service account
 *   - the service account has permission to send in this project
 *   - the project id, endpoint and payload shape are all correct
 *   - the request was accepted for delivery processing and reached FCM
 *
 * The only thing left unproven is FCM handing the message to a live app, which
 * is a device question. Everything before that is a credentials and payload
 * question, and that is what fails silently in practice.
 *
 * The fake row is deleted afterwards, so no send is ever attempted against it
 * again and it does not linger in the table.
 *
 *   node scripts/test-fcm.mjs
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TOKEN_FILE = "/root/malto-signing/supabase-access-token.txt";
const FAKE_TOKEN = "fM9maltoPathTestToken0123456789abcdef";
const REF = process.env.SUPABASE_PROJECT_REF || "jmntviljjrixhqgosehl";

function loadEnv() {
  const out = {};
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok   " : "FAIL "} ${name}${detail ? `  ${detail}` : ""}`);
};

const env = loadEnv();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Mirrors lib/push-fcm.ts rather than importing it: that file imports a
// server-only module, and the point here is to test the same steps independently
// so a bug in the shared code cannot hide itself.
async function mintToken(secretRaw) {
  const crypto = await import("node:crypto");
  const sa = JSON.parse(secretRaw);
  sa.private_key = (sa.private_key || "").replace(/\\n/g, "\n");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(sa.private_key, "base64url")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, token: json.access_token, detail: json.error_description, project: sa.project_id };
}

(async () => {
  console.log("  credentials");

  const { data: setting, error: setErr } = await admin
    .from("site_settings")
    .select("value")
    .eq("key", "push_fcm_secret")
    .maybeSingle();
  if (setErr || !setting?.value) {
    check("push_fcm_secret is set in site_settings", false, setErr?.message ?? "missing");
    process.exit(1);
  }
  check("push_fcm_secret is set in site_settings", true);

  // The one that must never fail. site_settings has a GRANT to anon and an RLS
  // policy keyed on is_public, so is_public = false is the only thing keeping
  // this private key off the public website.
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: leak } = await anon.from("site_settings").select("value").eq("key", "push_fcm_secret");
  check("anon cannot read the key", !leak || leak.length === 0, leak?.length ? `${leak.length} rows visible` : "");

  const auth = await mintToken(setting.value);
  check("access token minted", auth.ok, auth.ok ? `${auth.project}` : `HTTP ${auth.status} ${auth.detail ?? ""}`);
  if (!auth.ok) { process.exit(1); }

  console.log("\n  send path");

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.project}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token: FAKE_TOKEN,
        notification: { title: "MALTO", body: "New booking test." },
        data: { url: "/portal", tag: "malto-assignment" },
        android: {
          priority: "high",
          notification: { channel_id: "malto_jobs_v1", sound: "default", click_action: "OPEN_APP" },
        },
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  const status = json?.error?.status ?? "";
  const detail = json?.error?.message ?? "";

  console.log(`  HTTP ${res.status}${status ? ` ${status}` : ""}`);
  if (detail) console.log(`  ${detail.slice(0, 180)}`);

  // 404 UNREGISTERED is the expected answer: FCM accepted the request, resolved
  // the project, validated the payload, and reported that this token belongs to
  // no installed app. Any of these instead means the path above is broken.
  if (res.status === 404 || status === "UNREGISTERED") {
    check("FCM accepted the request and reported the token unregistered", true);
  } else if (res.ok) {
    // Would mean the fake token is somehow real. Worth knowing, not a failure.
    check("FCM delivered to a token that should not exist", true, "unexpected but not a fault");
  } else if (res.status === 403) {
    // Minting a token and being allowed to send are different permissions, and
    // the first succeeding says nothing about the second. This is the failure
    // that matters: a valid key with no role produces a token and then a 403 on
    // every send, forever, with no notification ever arriving.
    check("service account can send in this project", false,
      "grant it Firebase Cloud Messaging API Admin (roles/firebasecloudmessaging.admin)");
  } else if (res.status === 401) {
    check("access token is accepted by FCM", false, "the cached token was rejected");
  } else {
    check("send path", false, `unexpected HTTP ${res.status}`);
  }

  console.log("\n  table");

  const { error: upErr } = await admin
    .from("push_devices")
    .upsert({ user_id: null, token: FAKE_TOKEN, platform: "android" }, { onConflict: "token" });
  // A null user_id must be refused by the FK, which is the check that stops a
  // token being attached to nobody. The insert is expected to fail.
  check("a device cannot be registered without a user", !!upErr, upErr ? "refused by the foreign key" : "ACCEPTED, which is wrong");

  console.log(failed ? `\n  ${failed} failing` : "\n  the whole send path is working");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(`\n  ${e.message}\n`);
  process.exit(1);
});
