import { readJson, requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notifyMember } from "@/lib/push";

export const runtime = "nodejs";

/**
 * Admin-side assignment management: who is on which job.
 *
 * Uses the service role rather than the admin's session client so the insert
 * is not entangled with the member RLS policies, but every field is still
 * validated here before it is written.
 */

/** Bookings in these states are not real work yet, so assigning is pointless. */
const ASSIGNABLE = new Set(["New Request", "Confirmed", "In Progress", "Completed"]);

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const bookingId = new URL(req.url).searchParams.get("booking_id") ?? "";
  const service = supabaseAdmin();

  if (bookingId) {
    const { data, error } = await service
      .from("assignments")
      .select("id, booking_id, member_id, status, note, member_note, assigned_at, responded_at, done_at, team_members!inner(id, name, role, phone, email, available, unavailable_note, portal_status)")
      .eq("booking_id", bookingId)
      .order("assigned_at");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, assignments: data ?? [] });
  }

  // Everything a member is currently on, for the load indicator in the picker.
  const { data, error } = await service
    .from("assignments")
    .select("id, booking_id, member_id, status, booking_date:bookings!inner(date)")
    .order("booking_date", { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, assignments: data ?? [] });
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = readJson(await req.json().catch(() => null));
  const bookingId = String(body.booking_id ?? "").trim();
  const memberIds = Array.isArray(body.member_ids) ? body.member_ids.map(String) : [];
  const note = String(body.note ?? "").slice(0, 500);

  if (!bookingId) {
    return Response.json({ error: "booking_id is required." }, { status: 400 });
  }
  if (!memberIds.length) {
    return Response.json({ error: "Pick at least one team member." }, { status: 400 });
  }

  const service = supabaseAdmin();

  const { data: booking, error: bookingErr } = await service
    .from("bookings")
    .select("id, status, booking_ref, date")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingErr) {
    return Response.json({ error: bookingErr.message }, { status: 500 });
  }
  if (!booking) {
    return Response.json({ error: "Booking not found." }, { status: 404 });
  }
  if (!ASSIGNABLE.has(booking.status)) {
    return Response.json(
      { error: `A ${booking.status} booking cannot be assigned.` },
      { status: 400 }
    );
  }

  // Only approved, active members can take work. A pending applicant has no
  // portal access, so sending them a job would be invisible to them.
  const { data: members, error: membersErr } = await service
    .from("team_members")
    .select("id, name, portal_status, active, available")
    .in("id", memberIds);
  if (membersErr) {
    return Response.json({ error: membersErr.message }, { status: 500 });
  }
  const eligible = (members ?? []).filter((m) => m.portal_status === "approved" && m.active);
  if (!eligible.length) {
    return Response.json(
      { error: "None of the selected members are approved yet. Approve them in Team first." },
      { status: 400 }
    );
  }

  const rows = eligible.map((m) => ({
    booking_id: bookingId,
    member_id: m.id,
    status: "pending",
    note,
    assigned_by: guard.user.id,
  }));

  // Ignore conflicts so re-assigning the same person is harmless instead of
  // erroring on the unique (booking_id, member_id).
  const { error: insertErr } = await service
    .from("assignments")
    .upsert(rows, { onConflict: "booking_id,member_id", ignoreDuplicates: true });
  if (insertErr) {
    return Response.json({ error: insertErr.message }, { status: 500 });
  }

  // Best effort and deliberately outside the transaction above: a push that
  // fails must never undo the assignment, because the portal is the record and
  // the push is only the nudge. Failures are logged and reported back.
  let notified = 0;
  let pushNote = "";
  for (const m of eligible) {
    try {
      const res = await notifyMember(m.id, {
        title: "New job assigned",
        body: `${booking.booking_ref ?? "A job"} · ${booking.date ? fmtDate(booking.date) : "date TBC"}`,
        url: "/portal",
        tag: `malto-assignment-${bookingId}`,
      });
      notified += res.sent;
      if (res.skipped !== "ok" && !pushNote) pushNote = res.skipped;
    } catch (err: any) {
      console.error("[assignments] push failed:", err?.message ?? err);
    }
  }

  return Response.json({
    ok: true,
    assigned: eligible.length,
    notified,
    pushNote: pushNote || undefined,
    bookingRef: booking.booking_ref,
  });
}

const fmtDate = (d: string) => {
  const parsed = new Date(`${d.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });
};

export async function DELETE(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) {
    return Response.json({ error: "id is required." }, { status: 400 });
  }

  const { error } = await supabaseAdmin().from("assignments").delete().eq("id", id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
