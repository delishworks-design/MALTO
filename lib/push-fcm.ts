import { createSign } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Sends push notifications to the partner app through FCM HTTP v1.
 *
 * The browser portal already has web push working over VAPID (public/portal/sw.js),
 * so this exists only for the Android app. The two are separate systems that
 * happen to share a purpose: a browser cannot send a push, only a server can,
 * and the mobile SDK cannot send one for itself either. Both the app and the
 * website need a server in the middle.
 *
 * Credentials
 * -----------
 * The service account lives in site_settings under push_fcm_secret with
 * is_public = false. It is deliberately NOT exposed in the admin Settings UI:
 * saveWebsite() upserts every field in its GROUPS as is_public = true, so adding
 * it there would publish the private key to the whole website. The same mistake
 * already flattened the partner_app_* values once, which is why this one is
 * reached only through the service role.
 *
 * Fails visible
 * -------------
 * Every reason this cannot work - key missing, key malformed, IAM role missing,
 * API not enabled - ends in the same place: a PushResult with a reason. A send
 * returns that instead of throwing, because a booking must not fail to save just
 * because a notification could not be sent. And the reason is written to the
 * log, because a push that silently never arrives is indistinguishable from a
 * push nobody wanted.
 */

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/**
 * The channel the app creates on first launch.
 *
 * Versioned on purpose. Android fixes a channel's sound the moment it is
 * created and the app cannot change it afterwards - only the user can, in
 * system settings. So when the notification sound needs to change, the fix is a
 * new channel id, not an edit to this one. Without the suffix every future
 * sound change would cost every cleaner an uninstall.
 *
 * Must match MALTO_CHANNEL_ID in components/PushRegistration.tsx and the
 * android:name string in the manifest.
 */
export const CHANNEL_ID = "malto_jobs_v1";

export type PushFailure =
  | "no_key"
  | "bad_key"
  | "no_token"
  | "not_enabled"
  | "auth_failed"
  | "unregistered"
  | "network"
  | "http_error";

export type PushResult = { ok: true; messageId?: string } | { ok: false; reason: PushFailure; detail?: string };

export type JobNotification = {
  /** Where tapping the notification should land. */
  url?: string;
  /** Groups repeat notifications for the same job on the lock screen. */
  tag?: string;
};

type ServiceAccount = {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri?: string;
};

type CachedToken = { token: string; expiresAt: number };

/**
 * Process-wide token cache.
 *
 * Minting a token means an RSA signature and a round trip to Google, and FCM
 * tokens are only good for an hour. Without this every single assignment would
 * pay that cost. module scope rather than a database row because a serverless
 * instance is its own process anyway, and this avoids a write to the database
 * just to hold a token that a warm instance can keep in memory.
 */
let cached: CachedToken | null = null;
let cachedFor: string | null = null;

/** Read the service account. Never throws: a missing key is a PushFailure. */
async function loadServiceAccount(): Promise<{ account: ServiceAccount | null; reason?: PushFailure; detail?: string }> {
  const { data, error } = await supabaseAdmin()
    .from("site_settings")
    .select("key,value")
    .in("key", ["push_fcm_secret", "push_fcm_project"]);

  if (error) return { account: null, reason: "network", detail: error.message };

  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(String(row.key), String(row.value ?? ""));

  const raw = map.get("push_fcm_secret");
  if (!raw) return { account: null, reason: "no_key" };

  let account: ServiceAccount;
  try {
    // The private key contains real newlines, but a value that has been through
    // a JSON column, a copy and a paste can arrive with literal backslash-n.
    // Both forms appear in practice and signing fails on the second.
    const parsed = JSON.parse(raw) as ServiceAccount;
    parsed.private_key = (parsed.private_key ?? "").replace(/\\n/g, "\n");
    if (parsed.type !== "service_account" || !parsed.private_key || !parsed.client_email) {
      return { account: null, reason: "bad_key", detail: "missing type, private_key or client_email" };
    }
    account = parsed;
  } catch (e) {
    return { account: null, reason: "bad_key", detail: String((e as Error)?.message ?? e) };
  }

  // A key for a different Firebase project mints a valid token that is then
  // rejected by FCM with a confusing error, so it is caught here instead.
  const expected = map.get("push_fcm_project");
  if (expected && account.project_id !== expected) {
    return {
      account: null,
      reason: "bad_key",
      detail: `project_id is ${account.project_id} but the app is registered against ${expected}`,
    };
  }
  return { account };
}

/** Mint an OAuth access token, reusing the cached one while it is still good. */
async function accessToken(account: ServiceAccount): Promise<{ token: string } | { reason: PushFailure; detail?: string }> {
  if (cached && cachedFor === account.client_email && cached.expiresAt > Date.now() + 60_000) {
    return { token: cached.token };
  }

  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || TOKEN_URI;

  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: account.client_email,
    scope: FCM_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;

  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    signature = signer.sign(account.private_key, "base64url");
  } catch (e) {
    return { reason: "bad_key", detail: `could not sign: ${String((e as Error)?.message ?? e)}` };
  }

  try {
    const res = await fetch(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: GRANT, assertion: `${unsigned}.${signature}` }),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };

    if (!res.ok || !json.access_token) {
      return {
        reason: "auth_failed",
        detail: `HTTP ${res.status} ${json.error_description ?? ""}`.trim(),
      };
    }

    cached = {
      token: json.access_token,
      // Five minutes of slack, so a token is never handed out moments before it
      // expires and fails a send that was already in flight.
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 5 * 60_000,
    };
    cachedFor = account.client_email;
    return { token: json.access_token };
  } catch (e) {
    return { reason: "network", detail: String((e as Error)?.message ?? e) };
  }
}

/** Drop the cached token. Only needed after the key is rotated. */
export function resetTokenCache(): void {
  cached = null;
  cachedFor = null;
}

/**
 * Send one notification to one device.
 *
 * `channelId` is set explicitly rather than relying on the manifest default, so
 * the sound is never at the mercy of which default channel Firebase happened to
 * create first. `sound: "default"` is not a mistake: on Android 8+ the sound
 * comes from the channel, and naming a file here does nothing.
 */
export async function sendToDevice(
  token: string,
  title: string,
  body: string,
  extra: JobNotification = {}
): Promise<PushResult> {
  if (!token) return { ok: false, reason: "no_token" };

  const loaded = await loadServiceAccount();
  if (!loaded.account) {
    return { ok: false, reason: loaded.reason!, detail: loaded.detail };
  }
  const account = loaded.account!;

  const auth = await accessToken(account);
  if ("reason" in auth) return { ok: false, reason: auth.reason, detail: auth.detail };

  const message = {
    message: {
      token,
      notification: { title, body },
      data: {
        // FCM requires every data value to be a string.
        url: extra.url ?? "/portal",
        tag: extra.tag ?? "malto-assignment",
      },
      android: {
        priority: "high",
        notification: {
          channel_id: CHANNEL_ID,
          sound: "default",
          // Tapping the notification should open the app, not a browser tab.
          click_action: "OPEN_APP",
        },
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
      body: JSON.stringify(message),
    });
  } catch (e) {
    return { ok: false, reason: "network", detail: String((e as Error)?.message ?? e) };
  }

  if (res.ok) {
    const json = (await res.json().catch(() => ({}))) as { name?: string };
    return { ok: true, messageId: json.name };
  }

  const err = (await res.json().catch(() => ({}))) as {
    error?: { code?: number; message?: string; status?: string; details?: { errorCode?: string }[] };
  };
  const status = err?.error?.status ?? "";
  const detail = err?.error?.message ?? `HTTP ${res.status}`;

  // 404/UNREGISTERED means the token is dead: the app was uninstalled, or
  // cleared its data. The caller should delete the row rather than keep trying,
  // because FCM charges quota for tokens that will never deliver.
  if (res.status === 404 || status === "UNREGISTERED" || err?.error?.details?.[0]?.errorCode === "UNREGISTERED") {
    return { ok: false, reason: "unregistered", detail };
  }
  // 403 is the one that bites in practice: the key works, but the role is
  // wrong or the Cloud Messaging API is disabled for the project. It never
  // reaches the phone, so it has to be loud here.
  if (res.status === 403) {
    return { ok: false, reason: "not_enabled", detail };
  }
  if (res.status === 401) {
    // A token that was rejected as unauthorised is cached in a dead instance.
    resetTokenCache();
    return { ok: false, reason: "auth_failed", detail };
  }
  return { ok: false, reason: "http_error", detail: `${res.status} ${status}: ${detail}` };
}

/**
 * Send to every device a member has registered.
 *
 * Loops one request per device because FCM HTTP v1 has no multicast: the
 * Admin SDK does the fan out, and this project talks to the API directly to
 * avoid pulling in a dependency that bundles its own credentials handling.
 *
 * Never throws. A booking is saved whether or not the notification went out.
 */
export async function notifyMember(
  userId: string,
  title: string,
  body: string,
  extra: JobNotification = {}
): Promise<{ sent: number; failed: number; reasons: PushFailure[] }> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("push_devices")
      .select("token")
      .eq("user_id", userId);

    if (error) {
      console.error(`[push] could not read devices for ${userId}: ${error.message}`);
      return { sent: 0, failed: 0, reasons: ["network"] };
    }

    // Array.from rather than a spread: the spread of a Set needs
    // downlevelIteration, and this file runs under a target that does not have it.
    const tokens = Array.from(new Set((data ?? []).map((r: { token: string }) => r.token).filter(Boolean)));
    if (!tokens.length) return { sent: 0, failed: 0, reasons: [] };

    const reasons: PushFailure[] = [];
    let sent = 0;
    let failed = 0;
    const dead: string[] = [];

    for (const token of tokens) {
      const result = await sendToDevice(token, title, body, extra);
      if (result.ok) {
        sent++;
      } else {
        failed++;
        if (!reasons.includes(result.reason)) reasons.push(result.reason);
        if (result.reason === "unregistered") dead.push(token);
      }
    }

    if (dead.length) {
      // Tidy up after ourselves: a dead token will never deliver, and every
      // future send would keep paying for it.
      await supabaseAdmin()
        .from("push_devices")
        .delete()
        .in("token", dead);
    }

    if (reasons.length) {
      console.error(
        `[push] ${userId}: ${sent} sent, ${failed} failed (${reasons.join(", ")}). ` +
          "no_key means push_fcm_secret is unset; not_enabled means the service " +
          "account lacks the FCM role or the API is disabled."
      );
    }
    return { sent, failed, reasons };
  } catch (e) {
    console.error(`[push] notifyMember failed for ${userId}:`, (e as Error)?.message);
    return { sent: 0, failed: 0, reasons: ["network"] };
  }
}
