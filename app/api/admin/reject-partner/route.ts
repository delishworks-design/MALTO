import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An admin rejecting a partner's registration.
 *
 * The login is banned, not deleted, and that is the whole design of this
 * endpoint. Deleting it would cascade: team_members.user_id has ON DELETE SET
 * NULL, so the row would immediately look unclaimed again, and
 * register/route.ts treats a null user_id as "nobody has claimed this profile
 * yet". The applicant would register again that evening and be back in the
 * approval queue, which is not a rejection, it is a suggestion. Banning keeps
 * the row claimed, the email stays taken, and the person cannot get back in.
 *
 * The profile row and the agreement are left completely alone. partner_agreements
 * is append-only by trigger, and that is the right shape here: someone who read
 * and accepted the agreement is a matter of record, and a rejection is not a
 * retraction of it.
 *
 * Nothing is destroyed, so this is reversible: approving again unbans.
 */

// A hundred years. Supabase takes a duration string, and "forever" is clearer
// than a number that would have to be chosen.
const BAN_DURATION = "876000h";

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const partnerId = String(body?.partner_id ?? "").trim();
  if (!partnerId) {
    return Response.json({ ok: false, error: "Which partner is this?" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: member, error: lookupErr } = await admin
    .from("team_members")
    .select("id,name,email,user_id,portal_status")
    .eq("id", partnerId)
    .limit(1)
    .maybeSingle();

  if (lookupErr) return Response.json({ ok: false, error: lookupErr.message }, { status: 500 });
  if (!member) return Response.json({ ok: false, error: "That partner no longer exists." }, { status: 404 });

  if (member.portal_status === "approved") {
    return Response.json(
      { ok: false, error: `${member.name} is already approved. Set them to unavailable or off the marketplace instead.` },
      { status: 409 }
    );
  }

  const { error: statusErr } = await admin
    .from("team_members")
    .update({ portal_status: "rejected", available: false })
    .eq("id", partnerId);
  if (statusErr) return Response.json({ ok: false, error: statusErr.message }, { status: 500 });

  // No login means there is nothing to ban: an "Add partner" record that has
  // never been claimed. The status change is still the important part, because
  // it is what the approval queue and the lookup both read.
  if (!member.user_id) {
    return Response.json({ ok: true, banned: false, name: member.name });
  }

  const { error: banErr } = await admin.auth.admin.updateUserById(member.user_id, {
    ban_duration: BAN_DURATION,
  });
  if (banErr) {
    // The status says rejected but the login still works, which is the one
    // combination that is quietly wrong: the person is shut out of the portal
    // but can still sign in and be told they are waiting for approval. Report
    // it rather than letting the two disagree.
    return Response.json(
      {
        ok: false,
        error: `Marked as rejected, but their sign-in could not be closed: ${banErr.message}`,
        partial: true,
      },
      { status: 500 }
    );
  }

  return Response.json({ ok: true, banned: true, name: member.name });
}
