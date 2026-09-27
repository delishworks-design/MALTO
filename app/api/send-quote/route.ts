import { requireAdmin, readJson } from "@/lib/admin-auth";
import { loadEmailConfig } from "@/lib/email";
import { enqueueEmail, drainOutbox } from "@/lib/email-outbox";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * Final price + confirmation email.
 *
 * Auth: admin session cookie (Settings → Account is the only other way in).
 *
 * The price and the Confirmed status are written by complete_email_outbox()
 * inside the database, and only once the quote email has actually been sent.
 * That is the whole point of this route: previously it wrote both first and
 * emailed second, so an SMTP failure left a booking marked Confirmed that the
 * customer had never heard about. Now a failure leaves the booking untouched
 * and the queued row is retried automatically.
 */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = readJson(await req.json().catch(() => null));
  const bookingId = String(body.booking_id ?? "").trim();
  const price = Number(body.price);
  const override = body.override === true;

  if (!bookingId) {
    return Response.json({ ok: false, error: "booking_id is required." }, { status: 400 });
  }
  if (!Number.isFinite(price) || price <= 0) {
    return Response.json({ ok: false, error: "Enter a final price greater than zero." }, { status: 400 });
  }

  const { data: booking, error: readErr } = await guard.supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();
  if (readErr) {
    return Response.json({ ok: false, error: readErr.message }, { status: 500 });
  }
  if (!booking) {
    return Response.json({ ok: false, error: "Booking not found." }, { status: 404 });
  }
  if (!booking.email) {
    return Response.json(
      { ok: false, error: "This booking has no email address, so the quote cannot be sent." },
      { status: 400 }
    );
  }

  // Fail fast on a missing or unreadable SMTP config: better a clear error now
  // than a row that silently burns its five attempts.
  try {
    await loadEmailConfig();
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 502 });
  }

  const admin = supabaseAdmin();

  // One quote on its way: pending, actively sending, or failed but still within
  // its automatic retry budget. Queueing another would put two copies of the
  // same price in front of the customer once SMTP recovers.
  const { data: open } = await admin
    .from("email_outbox")
    .select("id, status, attempts")
    .eq("booking_id", bookingId)
    .eq("kind", "quote")
    .or("status.in.(pending,sending),and(status.eq.failed,attempts.lt.5))")
    .limit(1)
    .maybeSingle();
  if (open) {
    const retrying = open.status === "failed";
    return Response.json(
      {
        ok: false,
        inFlight: true,
        error: retrying
          ? `A quote for this booking failed and is still being retried automatically (attempt ${open.attempts} of 5). Use RETRY ALL NOW under Settings → Email to send it immediately, or wait for the next retry.`
          : "A quote for this booking is already queued and waiting to send. Give it a moment before sending another.",
      },
      { status: 409 }
    );
  }

  // Already delivered. Clicking again is usually panic after a missing email,
  // not a real second quote, so it has to be asked for explicitly.
  if (!override) {
    const { data: delivered } = await admin
      .from("email_outbox")
      .select("id, sent_at, to_email")
      .eq("booking_id", bookingId)
      .eq("kind", "quote")
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (delivered) {
      const when = delivered.sent_at
        ? new Date(delivered.sent_at).toLocaleString("en-PH")
        : "earlier";
      return Response.json(
        {
          ok: false,
          alreadySent: true,
          sentAt: delivered.sent_at,
          error: `A quote was already sent to ${delivered.to_email} on ${when}. Use SEND AGAIN if you really want a second copy.`,
        },
        { status: 409 }
      );
    }
  }

  // One row per click, so each attempt is auditable on its own.
  let rowId: string | null;
  try {
    rowId = await enqueueEmail({
      bookingId,
      kind: "quote",
      toEmail: booking.email,
      price,
      payload: {
        booking_ref: booking.booking_ref,
        names: booking.names,
        services: booking.services,
        date: booking.date,
        notes: booking.admin_notes,
      },
    });
  } catch (err: any) {
    return Response.json(
      { ok: false, error: `Could not queue the quote email: ${String(err?.message ?? err)}` },
      { status: 500 }
    );
  }

  // Try immediately rather than making the admin wait for the next cron tick.
  const result = await drainOutbox(25);
  const sent = result.sent > 0 && !result.errors.some((e) => e.id === rowId);

  if (sent) {
    return Response.json({
      ok: true,
      to: booking.email,
      price,
      status: booking.status === "Cancelled" ? booking.status : "Confirmed",
      queued: result.claimed,
    });
  }

  const failure = result.errors.find((e) => e.id === rowId);
  return Response.json(
    {
      ok: false,
      queued: true,
      willRetry: true,
      error: `The quote is queued and will be retried automatically, but it could not be sent yet: ${
        failure?.error ?? "unknown error"
      }. The booking is not marked Confirmed.`,
    },
    { status: 202 }
  );
}
