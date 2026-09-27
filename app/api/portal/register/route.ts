import { readJson } from "@/lib/admin-auth";
import { isValidEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * Self-registration for a team member.
 *
 * Public on purpose: the applicant creates their own password, so the flow
 * needs no invite email and no dependency on Supabase's own SMTP, which is
 * rate limited and would silently drop signups. The account is created with
 * email_confirm: true and lands as portal_status 'pending', which grants
 * nothing at all until an admin approves it.
 *
 * If the admin already added the person to the team with the same email, the
 * existing row is linked instead of creating a duplicate.
 */
export async function POST(req: Request) {
  const body = readJson(await req.json().catch(() => null));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();

  if (!isValidEmail(email)) {
    return Response.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json(
      { ok: false, error: "Your password needs at least 8 characters." },
      { status: 400 }
    );
  }
  if (!name) {
    return Response.json({ ok: false, error: "Please enter your full name." }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // Match case-insensitively: people type their address in whatever case they
  // have on file, and ilike avoids "linked but pending forever" on a near miss.
  const { data: existing, error: lookupErr } = await admin
    .from("team_members")
    .select("id, user_id, portal_status, active")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (lookupErr) {
    return Response.json({ ok: false, error: lookupErr.message }, { status: 500 });
  }

  if (existing?.user_id) {
    return Response.json(
      { ok: false, error: "This email is already registered. Please sign in instead." },
      { status: 409 }
    );
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    // Supabase reports an existing user here. That is a sign-in situation, not
    // a failure, so it must not look like a bug to the applicant.
    if (/already|registered|exists/i.test(createErr.message)) {
      return Response.json(
        { ok: false, error: "This email is already registered. Please sign in instead." },
        { status: 409 }
      );
    }
    return Response.json({ ok: false, error: createErr.message }, { status: 500 });
  }

  if (existing) {
    const { error: linkErr } = await admin
      .from("team_members")
      .update({ user_id: created.user.id, portal_status: "pending" })
      .eq("id", existing.id);
    if (linkErr) {
      // Do not leave a usable account with no team record behind it.
      await admin.auth.admin.deleteUser(created.user.id);
      return Response.json({ ok: false, error: linkErr.message }, { status: 500 });
    }
  } else {
    const { error: insertErr } = await admin.from("team_members").insert({
      name,
      email,
      phone,
      role: "",
      user_id: created.user.id,
      portal_status: "pending",
      active: true,
    });
    if (insertErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return Response.json({ ok: false, error: insertErr.message }, { status: 500 });
    }
  }

  return Response.json({ ok: true, email });
}
