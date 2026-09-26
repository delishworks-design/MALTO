import { timingSafeEqual } from "node:crypto";
import { sendAdminAlert, type NewBooking } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase Database Webhook target — fires when a row is INSERTed into
 * `bookings` and sends the "new booking" alert to the admin inbox.
 *
 * Configure in Supabase:
 *   Table   : bookings
 *   Events  : INSERT
 *   Type    : HTTP Request (edge function / https URL)
 *   URL     : https://<site>/api/webhooks/booking-created
 *   Secret  : <BOOKING_WEBHOOK_SECRET>  (sent as `Authorization: Bearer …`)
 *
 * The secret is compared in constant time and the payload is only used when it
 * really is a `bookings` INSERT, so the endpoint cannot be used to mail-bomb.
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

type HookBody = {
  type?: string;
  table?: string;
  record?: Record<string, any>;
  records?: Record<string, any>[];
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

  let body: HookBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const table = body.table ?? (body.record ? "bookings" : "");
  const type = body.type ?? "INSERT";
  const record = (body.record ?? body.records?.[0]) as NewBooking | undefined;

  if (type !== "INSERT" || table !== "bookings" || !record) {
    return Response.json({ ok: true, skipped: true, reason: "Not a bookings INSERT." });
  }

  try {
    const { to } = await sendAdminAlert(record);
    return Response.json({ ok: true, to });
  } catch (err: any) {
    // Acknowledge anyway: retrying would send duplicate alerts while SMTP is
    // misconfigured. The error is returned for the webhook log.
    console.error("[webhook:booking-created]", err?.message ?? err);
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 200 });
  }
}
