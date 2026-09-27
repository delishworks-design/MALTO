import { readJson } from "@/lib/admin-auth";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/**
 * A member responding to their own assignment.
 *
 * Ownership is not checked here: it is enforced by RLS, which only lets an
 * authenticated user touch assignments whose team_members row carries their
 * user_id. The trigger on the table blocks them from rewriting the columns
 * that are not theirs to change. This route only owns the *rules* — which
 * status may follow which — because "accept then un-accept" or "jump straight
 * to done" would corrupt the admin's view of the job.
 */

const ALLOWED: Record<string, string[]> = {
  pending: ["accepted", "declined"],
  accepted: ["on_the_way", "declined"],
  on_the_way: ["done"],
  done: [],
  declined: [],
  cancelled: [],
};

const LABEL: Record<string, string> = {
  accepted: "accept this job",
  declined: "decline this job",
  on_the_way: "mark it as on the way",
  done: "mark it as done",
};

export async function PATCH(req: Request) {
  let supabase;
  let user;
  try {
    supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return Response.json({ error: "Please sign in again." }, { status: 401 });
    }
    user = data.user;
  } catch {
    return Response.json({ error: "Could not reach the sign-in service." }, { status: 500 });
  }

  const { data: approved } = await supabase.rpc("is_approved_member");
  if (approved !== true) {
    return Response.json(
      { error: "Your account is still waiting for approval from MALTO." },
      { status: 403 }
    );
  }

  const body = readJson(await req.json().catch(() => null));
  const id = String(body.assignment_id ?? "").trim();
  const next = String(body.status ?? "").trim();
  const memberNote = body.member_note === undefined ? undefined : String(body.member_note ?? "").slice(0, 500);

  if (!id || !next) {
    return Response.json({ error: "assignment_id and status are required." }, { status: 400 });
  }

  // RLS limits this to the caller's own assignment; a foreign id returns null.
  const { data: current, error: readErr } = await supabase
    .from("assignments")
    .select("id, status, booking_id, member_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) {
    return Response.json({ error: readErr.message }, { status: 500 });
  }
  if (!current) {
    return Response.json({ error: "That job is not assigned to you." }, { status: 404 });
  }

  const allowed = ALLOWED[current.status] ?? [];
  if (!allowed.includes(next)) {
    const verb = LABEL[next] ?? `change the status to ${next}`;
    return Response.json(
      {
        error: `This job is already "${current.status.replace(/_/g, " ")}", so you cannot ${verb}.`,
        status: current.status,
      },
      { status: 409 }
    );
  }

  const patch: Record<string, unknown> = { status: next };
  if (next === "accepted" || next === "declined") patch.responded_at = new Date().toISOString();
  if (next === "on_the_way") patch.responded_at = new Date().toISOString();
  if (next === "done") patch.done_at = new Date().toISOString();
  if (memberNote !== undefined) patch.member_note = memberNote;

  const { error: updateErr } = await supabase
    .from("assignments")
    .update(patch)
    .eq("id", id);
  if (updateErr) {
    return Response.json({ error: updateErr.message }, { status: 500 });
  }

  return Response.json({ ok: true, status: next, booking_id: current.booking_id, user: user.id });
}
