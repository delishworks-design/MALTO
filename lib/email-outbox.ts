import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAdminAlert, sendBookingReceived, sendQuoteEmail, type NewBooking } from "@/lib/email";

/**
 * Transactional email outbox.
 *
 * Every send is recorded in `email_outbox` before it is attempted, so a booking
 * insert and its notification survive the same failure. A row is claimed,
 * attempted, and then either marked sent or left claimable for the next drain.
 *
 * Draining is driven by three callers, all going through the same functions:
 *   - the `trg_booking_enqueued` trigger, via pg_net, for immediacy
 *   - pg_cron every 5 minutes, for retries and for anything the trigger missed
 *   - /api/admin/retry-emails, when the admin asks for it by hand
 *
 * Server-only: uses the service-role client because the trigger and the cron
 * job arrive with no admin session, and because the claim/complete functions
 * are restricted to service_role. Never import this from a Client Component.
 */

export type OutboxKind = "admin_alert" | "booking_received" | "quote";

type OutboxRow = {
  id: string;
  booking_id: string | null;
  kind: OutboxKind;
  to_email: string;
  payload: Record<string, any> | null;
  price: number | null;
  attempts: number;
};

export type EnqueueInput = {
  bookingId: string | null;
  kind: OutboxKind;
  toEmail: string;
  payload?: Record<string, any>;
  price?: number | null;
};

/** Records the intent to send. Returns the row id, or null if it could not be
 *  queued — callers decide whether that is fatal (for a quote it is not: the
 *  booking stays unconfirmed and the admin can send again). */
export async function enqueueEmail(input: EnqueueInput): Promise<string | null> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("email_outbox")
    .insert({
      booking_id: input.bookingId,
      kind: input.kind,
      to_email: input.toEmail,
      payload: input.payload ?? {},
      price: input.price ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function sendOne(row: OutboxRow): Promise<string> {
  const booking = (row.payload ?? {}) as NewBooking;
  switch (row.kind) {
    case "admin_alert":
      // Recipient is resolved from the SMTP settings, so to_email is empty.
      return (await sendAdminAlert(booking)).response;
    case "booking_received":
      return (await sendBookingReceived(booking)).response;
    case "quote":
      return (await sendQuoteEmail({
        to: row.to_email,
        name: booking.names ?? "",
        bookingRef: booking.booking_ref ?? "",
        serviceName: booking.services ?? "",
        date: booking.date ?? "",
        price: Number(row.price ?? 0),
      })).response;
  }
}

export type DrainResult = {
  claimed: number;
  sent: number;
  failed: number;
  errors: { id: string; kind: string; error: string }[];
};

/**
 * Attempts up to `limit` due rows.
 *
 * Each row is claimed and completed one at a time so the caller learns the
 * outcome for a specific id — the quote route needs to know whether *its* row
 * went out before it reports success to the admin. Never throws for a send
 * failure: a bad SMTP host must not turn into a 500 that hides the rest.
 */
export async function drainOutbox(limit = 10): Promise<DrainResult> {
  const supabase = supabaseAdmin();
  const result: DrainResult = { claimed: 0, sent: 0, failed: 0, errors: [] };

  const { data, error } = await supabase.rpc("claim_email_outbox", { p_limit: limit });
  if (error) throw error;
  const rows = (data ?? []) as OutboxRow[];
  result.claimed = rows.length;
  if (!rows.length) return result;

  for (const row of rows) {
    try {
      const response = await sendOne(row);
      const { error: doneErr } = await supabase.rpc("complete_email_outbox", {
        p_id: row.id,
        p_ok: true,
        p_response: response,
      });
      if (doneErr) throw doneErr;
      result.sent += 1;
    } catch (err: any) {
      // Marked failed, not deleted: the row is the evidence that something went
      // wrong and the source of the retry.
      const message = String(err?.message ?? err);
      await supabase.rpc("complete_email_outbox", {
        p_id: row.id,
        p_ok: false,
        p_error: message,
      });
      result.failed += 1;
      result.errors.push({ id: row.id, kind: row.kind, error: message });
      console.error(`[email-outbox] ${row.kind} to ${row.to_email || "admin"} failed:`, message);
    }
  }

  return result;
}
