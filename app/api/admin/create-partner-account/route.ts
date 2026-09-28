import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/admin-auth";
import { isValidEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An admin creating a partner's account.
 *
 * The team page's "Add partner" has always made a profile row with
 * user_id = null and portal_status 'invited', shown as "No account yet". That
 * partner could never sign in: the admin team page says so itself, "with no
 * user_id can never sign in to see anything", and the only way to finish the job
 * was for the partner to register themselves and match on email. Which meant an
 * admin had no way to onboard someone who cannot use the app, or someone who
 * would rather not be sent a form.
 *
 * This closes that. The admin sets the email and a password, the account is
 * created and linked, and the partner signs in with what they were given.
 *
 * The password is generated here rather than typed by the admin, and returned
 * once. An admin choosing a password for someone else means writing it down,
 * which means it ends up in a chat log; a generated one can be sent once and
 * forgotten. It is not forced to change because the portal has no password
 * change screen, and adding one is a separate piece of work.
 */

const ADJECTIVES = ["calm", "bright", "steady", "kind", "neat", "quick", "clear", "warm"];
const NOUNS = ["spark", "broom", "dawn", "leaf", "cloth", "haze", "shore", "glow"];

function generatePassword(): string {
  // Avoids 0/O and 1/l/I so it can be read aloud over the phone without
  // ambiguity, which is how a cleaner will first hear it.
  const letters = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const pick = (set: string, n: number) =>
    Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join("");
  const words = [
    ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)],
    NOUNS[Math.floor(Math.random() * NOUNS.length)],
  ];
  return `${words[0]}-${words[1]}-${pick(letters, 2)}${pick(digits, 3)}`;
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "Nothing to send." }, { status: 400 });

  const partnerId = String(body.partner_id ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!partnerId) return Response.json({ ok: false, error: "Which partner is this for?" }, { status: 400 });
  if (!isValidEmail(email)) {
    return Response.json({ ok: false, field: "email", error: "Enter a valid email address." }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // The admin passes a partner_id, so ownership is the admin's to prove, not
  // the browser's. Read the row before touching auth so a bad id fails cleanly.
  const { data: member, error: memberErr } = await admin
    .from("team_members")
    .select("id,name,user_id,portal_status,active")
    .eq("id", partnerId)
    .limit(1)
    .maybeSingle();
  if (memberErr) return Response.json({ ok: false, error: memberErr.message }, { status: 500 });
  if (!member) return Response.json({ ok: false, error: "That partner no longer exists." }, { status: 404 });
  if (member.user_id) {
    return Response.json({ ok: false, error: `${member.name} already has an account.` }, { status: 409 });
  }

  // Case-insensitive, so the same person cannot end up as two accounts that
  // differ only in the casing of their address.
  const { data: clash, error: clashErr } = await admin
    .from("team_members")
    .select("id,user_id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (clashErr) return Response.json({ ok: false, error: clashErr.message }, { status: 500 });
  if (clash?.user_id && clash.id !== partnerId) {
    return Response.json(
      { ok: false, error: "That email already belongs to another partner. Use their existing account." },
      { status: 409 }
    );
  }

  const password = generatePassword();

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) {
    if (/already|registered|exists/i.test(createErr.message)) {
      return Response.json(
        { ok: false, error: "There is already an account with that email. Ask them to sign in or reset their password." },
        { status: 409 }
      );
    }
    return Response.json({ ok: false, error: createErr.message }, { status: 500 });
  }

  // Roll back on any failure after this point. An auth user with no profile
  // cannot sign in to anything, and an admin who has already written the
  // password down would be trying to hand out a dead login.
  const { error: linkErr } = await admin
    .from("team_members")
    .update({ user_id: created.user.id, email, portal_status: "approved" })
    .eq("id", partnerId);

  if (linkErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return Response.json({ ok: false, error: linkErr.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    email,
    // Returned once and never stored, so it cannot be read back out of the
    // database later by anyone.
    password,
    name: member.name,
  });
}
