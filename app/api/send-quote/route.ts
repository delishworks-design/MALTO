import { requireAdmin, readJson } from "@/lib/admin-auth";
import { loadEmailConfig, sendQuoteEmail } from "@/lib/email";

export const runtime = "nodejs";

/**
 * Final price + confirmation email.
 *
 * Auth: admin session cookie (Settings → Account is the only other way in).
 * Effect: saves `price`, optionally flips the status to `Confirmed`, then
 * emails the customer their quote.
 */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = readJson(await req.json().catch(() => null));
  const bookingId = String(body.booking_id ?? "").trim();
  const price = Number(body.price);
  const confirm = body.confirm !== false;

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

  // Fail fast on SMTP problems before anything is written.
  try {
    await loadEmailConfig();
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 502 });
  }

  const patch: Record<string, any> = { price };
  if (confirm && booking.status !== "Cancelled") patch.status = "Confirmed";

  const { error: writeErr } = await guard.supabase
    .from("bookings")
    .update(patch)
    .eq("id", bookingId);
  if (writeErr) {
    return Response.json({ ok: false, error: writeErr.message }, { status: 500 });
  }

  try {
    const { to } = await sendQuoteEmail({
      to: booking.email,
      name: booking.names ?? "",
      bookingRef: booking.booking_ref ?? "",
      serviceName: booking.services ?? "",
      date: booking.date ?? "",
      price,
    });
    return Response.json({
      ok: true,
      to,
      price,
      status: patch.status ?? booking.status ?? "New Request",
    });
  } catch (err: any) {
    console.error("[send-quote] email failed:", err?.message ?? err);
    return Response.json(
      { ok: false, error: `Price saved, but the email could not be sent: ${String(err?.message ?? err)}` },
      { status: 502 }
    );
  }
}
