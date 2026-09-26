import { timingSafeEqual } from "node:crypto";
import { drainOutbox } from "@/lib/email-outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Outbox drain, called by pg_net (on booking insert) and by pg_cron (every 5
 * minutes for retries). Authorised with the same shared secret as the old
 * booking webhook, read from BOOKING_WEBHOOK_SECRET and stored in
 * public.webhook_config — no new environment variable.
 *
 * Always answers 200. A non-2xx would only make the caller log harder, since
 * the retry path is the cron job, not the HTTP response.
 */
const authed = (secret: string, req: Request): boolean => {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^bearer\s+/i, "").trim();
  const alt = (req.headers.get("x-webhook-secret") ?? "").trim();
  const expected = Buffer.from(secret);
  const candidates = [token, alt].filter(Boolean).map((c) => Buffer.from(c));
  if (!candidates.length) return false;
  return candidates.some((c) => c.length === expected.length && timingSafeEqual(c, expected));
};

export async function POST(req: Request) {
  const secret = process.env.BOOKING_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "BOOKING_WEBHOOK_SECRET is not set on this deployment." },
      { status: 500 }
    );
  }
  if (!authed(secret, req)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await drainOutbox(10);
    return Response.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[email-outbox:drain]", err?.message ?? err);
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 200 });
  }
}
