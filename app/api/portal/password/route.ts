import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A partner changing their own password.
 *
 * This did not exist. That was not a gap so much as a trap: the admin's
 * "Create account" action hands a partner a generated password, and with no way
 * to change it the first person who read that password over the phone in a
 * hallway would still be using it a year later. A credential that cannot be
 * rotated is not a credential.
 *
 * Verifying the current password first is the point of using this route rather
 * than supabase.auth.updateUser from the browser. updateUser takes effect
 * immediately, so anyone who unlocked a phone left unattended on a job could
 * take the account over and change the password before the owner came back.
 * Requiring the old one means only the owner can rotate it.
 */

const MIN = 8;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const current = String(body?.current ?? "");
  const next = String(body?.next ?? "");
  const confirm = String(body?.confirm ?? "");

  if (next.length < MIN) {
    return Response.json(
      { ok: false, field: "next", error: `Your new password needs at least ${MIN} characters.` },
      { status: 400 }
    );
  }
  if (next !== confirm) {
    return Response.json({ ok: false, field: "confirm", error: "The two new passwords do not match." }, { status: 400 });
  }
  if (next === current) {
    return Response.json({ ok: false, field: "next", error: "That is the password you already have." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return Response.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  }
  const user = userData.user;

  // Confirm the current password by signing in as them. The session that does it
  // is discarded immediately: this request must not change who is signed in.
  const { data: probe, error: probeErr } = await supabase.auth.signInWithPassword({
    email: user.email ?? "",
    password: current,
  });
  if (probeErr || !probe.user) {
    return Response.json(
      { ok: false, field: "current", error: "That is not your current password." },
      { status: 400 }
    );
  }

  const { error: updErr } = await supabase.auth.updateUser({ password: next });
  if (updErr) {
    // Supabase signs the session out on a failed credential change in some
    // configurations, so this tells them to sign in again rather than leaving a
    // confusing second failure.
    return Response.json(
      { ok: false, error: `${updErr.message} If that keeps happening, sign in again and retry.` },
      { status: 400 }
    );
  }

  return Response.json({ ok: true });
}
