import { readJson, requireAdmin } from "@/lib/admin-auth";
import { getVapidPublicKey } from "@/lib/push";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/**
 * Register or remove a push subscription for the signed-in member.
 *
 * member_id is resolved from the session, never from the request body, so a
 * member cannot attach a subscription to somebody else's record. The browser
 * therefore needs no write access to push_subscriptions at all.
 */

/** Resolves the caller's team member row, or null if they are not approved. */
async function callerMemberId(): Promise<{ id: string | null; error: Response | null }> {
  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return { id: null, error: Response.json({ error: "Please sign in again." }, { status: 401 }) };
    }
    const { data: approved } = await supabase.rpc("is_approved_member");
    if (approved !== true) {
      return {
        id: null,
        error: Response.json(
          { error: "Your account is still waiting for approval from MALTO." },
          { status: 403 }
        ),
      };
    }
    const { data: row } = await supabase
      .from("team_members")
      .select("id")
      .eq("user_id", userData.user.id)
      .limit(1)
      .maybeSingle();
    if (!row) {
      return {
        id: null,
        error: Response.json({ error: "No team profile is linked to this account." }, { status: 403 }),
      };
    }
    return { id: row.id, error: null };
  } catch {
    return {
      id: null,
      error: Response.json({ error: "Could not reach the sign-in service." }, { status: 500 }),
    };
  }
}

export async function GET() {
  const publicKey = await getVapidPublicKey();
  if (!publicKey) {
    return Response.json(
      { ok: false, error: "Push notifications are not set up on this deployment." },
      { status: 503 }
    );
  }
  return Response.json({ ok: true, publicKey });
}

export async function POST(req: Request) {
  const { id: memberId, error: authError } = await callerMemberId();
  if (authError) return authError;

  const body = readJson(await req.json().catch(() => null));
  const endpoint = String(body.endpoint ?? "").trim();
  const keys = (body.keys ?? {}) as { p256dh?: string; auth?: string };
  const p256dh = String(keys.p256dh ?? "").trim();
  const auth = String(keys.auth ?? "").trim();
  const userAgent = String(body.user_agent ?? "").slice(0, 300);

  if (!endpoint || !p256dh || !auth) {
    return Response.json({ error: "Incomplete push subscription." }, { status: 400 });
  }
  if (!/^https:\/\//i.test(endpoint)) {
    // Only accept the push service's own endpoint, not an arbitrary URL, so
    // this cannot be turned into a server-side request gadget.
    return Response.json({ error: "Unrecognised push endpoint." }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // endpoint is unique, so a re-subscribe from the same phone updates in place
  // and a member switching phones does not accumulate rows.
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      member_id: memberId,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent,
      last_success_at: null,
    },
    { onConflict: "endpoint" }
  );
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { id: memberId, error: authError } = await callerMemberId();
  if (authError) return authError;

  const body = readJson(await req.json().catch(() => null));
  const endpoint = String(body.endpoint ?? "").trim();
  if (!endpoint) {
    return Response.json({ error: "endpoint is required." }, { status: 400 });
  }

  // Scoped to the caller's own member_id so one member cannot remove another's
  // subscription.
  const { error } = await supabaseAdmin()
    .from("push_subscriptions")
    .delete()
    .eq("member_id", memberId)
    .eq("endpoint", endpoint);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}

/** Admin view: how many members actually have notifications switched on. */
export async function PUT() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { data, error } = await supabaseAdmin()
    .from("push_subscriptions")
    .select("member_id, last_success_at, created_at, team_members!inner(name, portal_status)");
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const byMember: Record<string, { name: string; devices: number; lastSuccess: string | null }> = {};
  for (const row of (data ?? []) as any[]) {
    const m = row.team_members as { name?: string } | null;
    const entry = (byMember[row.member_id] ??= { name: m?.name ?? "Member", devices: 0, lastSuccess: null });
    entry.devices += 1;
    if (row.last_success_at && (!entry.lastSuccess || row.last_success_at > entry.lastSuccess)) {
      entry.lastSuccess = row.last_success_at;
    }
  }
  return Response.json({ ok: true, byMember: Object.values(byMember) });
}
