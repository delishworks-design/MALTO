import { readJson, requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * Inspect and steer a client's recurring schedule.
 *
 * The plan is created automatically by a trigger when the booking form inserts
 * a booking with a frequency, so there is nothing to create here. What the
 * admin needs is visibility and the two levers that matter: pause it, or end
 * it. Deleting a single visit is a normal booking cancellation and does not
 * touch the plan, because each occurrence is its own booking row.
 */

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const bookingId = new URL(req.url).searchParams.get("booking_id") ?? "";
  if (!bookingId) {
    return Response.json({ error: "booking_id is required." }, { status: 400 });
  }

  const service = supabaseAdmin();

  const { data: plan, error } = await service
    .from("recurring_plans")
    .select("id, frequency, discount_pct, next_date, status, occurrences_remaining, created_at")
    .eq("anchor_booking_id", bookingId)
    .maybeSingle();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!plan) {
    return Response.json({ ok: true, plan: null });
  }

  // The visits already produced, so the admin can see what the client is booked
  // for without leaving the booking page.
  const { data: occurrences, error: occErr } = await service
    .from("recurring_occurrences")
    .select("occurrence_date, booking_id")
    .eq("plan_id", plan.id)
    .order("occurrence_date");
  if (occErr) {
    return Response.json({ error: occErr.message }, { status: 500 });
  }

  const dates = (occurrences ?? []).map((o) => o.occurrence_date);

  return Response.json({
    ok: true,
    plan: {
      ...plan,
      occurrences: dates,
      nextVisit: dates.find((d) => d >= new Date().toISOString().slice(0, 10)) ?? plan.next_date,
    },
  });
}

export async function PATCH(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = readJson(await req.json().catch(() => null));
  const bookingId = String(body.booking_id ?? "").trim();
  const status = String(body.status ?? "").trim();

  if (!bookingId) {
    return Response.json({ error: "booking_id is required." }, { status: 400 });
  }
  if (!["active", "paused", "cancelled"].includes(status)) {
    return Response.json({ error: "Unsupported schedule status." }, { status: 400 });
  }

  const service = supabaseAdmin();

  // Pause and resume are reversals, so the next date is preserved. Cancelling
  // stops generation for good; the visits already booked stay on the calendar
  // because each one is its own booking row.
  const { data: plan, error: findErr } = await service
    .from("recurring_plans")
    .select("id, status")
    .eq("anchor_booking_id", bookingId)
    .maybeSingle();
  if (findErr) {
    return Response.json({ error: findErr.message }, { status: 500 });
  }
  if (!plan) {
    return Response.json({ error: "This booking has no recurring schedule." }, { status: 404 });
  }
  if (plan.status === status) {
    return Response.json({ ok: true, plan, message: "No change needed." });
  }

  const { error } = await service
    .from("recurring_plans")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", plan.id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const message =
    status === "paused"
      ? "Schedule paused. No further visits will be created."
      : status === "active"
        ? "Schedule resumed."
        : "Schedule ended. Visits already booked are unaffected.";

  return Response.json({ ok: true, status, message });
}
