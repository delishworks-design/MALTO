import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { decryptSecret } from "@/lib/crypto";

/**
 * Web Push (VAPID) for team members.
 *
 * Chosen over SMS because it is free, instant, and works on both iOS and
 * Android. A part-time member will not open the portal on their own, so the
 * nudge is the part that actually matters.
 *
 * Delivery is best effort by design. Unlike the booking email, a push is a
 * reminder, not a record: a failure here is logged and never blocks the
 * assignment that triggered it. The portal remains the system of truth.
 *
 * iOS caveat: Web Push on iPhone only works once the portal has been added to
 * the Home Screen, so the UI says so rather than silently failing.
 */

type Vapid = { publicKey: string; privateKey: string };

let cached: Vapid | null = null;

/** Decrypted once per warm instance. The private key is never sent anywhere. */
async function vapidKeys(): Promise<Vapid> {
  if (cached) return cached;
  const { data, error } = await supabaseAdmin()
    .from("push_config")
    .select("public_key, private_key_encrypted")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Could not read push configuration: ${error.message}`);
  if (!data) {
    throw new Error(
      "Push notifications are not configured. Generate a VAPID pair and store it in public.push_config."
    );
  }
  cached = { publicKey: data.public_key, privateKey: decryptSecret(data.private_key_encrypted) };
  webpush.setVapidDetails(
    "mailto:malto@malto.com",
    cached.publicKey,
    cached.privateKey
  );
  return cached;
}

export async function getVapidPublicKey(): Promise<string | null> {
  try {
    return (await vapidKeys()).publicKey;
  } catch {
    return null;
  }
}

export type PushResult = { sent: number; pruned: number; skipped: string };

/** Notifies every device a member has subscribed from. */
export async function notifyMember(
  memberId: string,
  payload: { title: string; body: string; url?: string; tag?: string }
): Promise<PushResult> {
  const admin = supabaseAdmin();

  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("member_id", memberId);
  if (error) throw new Error(`Could not read push subscriptions: ${error.message}`);
  if (!subs || subs.length === 0) return { sent: 0, pruned: 0, skipped: "no subscriptions" };

  let keys: Vapid;
  try {
    keys = await vapidKeys();
  } catch (err: any) {
    return { sent: 0, pruned: 0, skipped: String(err?.message ?? err).slice(0, 160) };
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/portal",
    tag: payload.tag ?? "malto-assignment",
  });

  let sent = 0;
  let pruned = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        { TTL: 60 * 60, urgency: "high" }
      );
      sent += 1;
      await admin
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString() })
        .eq("id", sub.id);
    } catch (err: any) {
      const status = err?.statusCode;
      // 404 and 410 mean the browser dropped the subscription for good, so the
      // row is removed rather than retried forever.
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
        pruned += 1;
        continue;
      }
      console.error("[push] send failed:", status ?? err?.message);
    }
  }

  return { sent, pruned, skipped: "ok" };
}
