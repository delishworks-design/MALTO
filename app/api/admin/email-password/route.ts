import { requireAdmin, readJson } from "@/lib/admin-auth";
import { hasStoredPassword, loadEmailConfig } from "@/lib/email";
import { encryptSecret } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * SMTP password is write-only: it is stored AES-256-GCM encrypted in
 * `email_secret`, which has no RLS policies (service role only), so even a
 * compromised admin session can never read it back.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const hasPassword = await hasStoredPassword();
    const cfg = await loadEmailConfig();
    return Response.json({ hasPassword, host: cfg.host, port: cfg.port, user: cfg.user });
  } catch (err: any) {
    return Response.json({ hasPassword: false, error: String(err?.message ?? err) });
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { password } = readJson(await req.json().catch(() => null));
  const value = String(password ?? "").trim();

  if (value.length < 6) {
    return Response.json(
      { ok: false, error: "The SMTP password must be at least 6 characters." },
      { status: 400 }
    );
  }

  try {
    const encrypted = encryptSecret(value);
    const admin = supabaseAdmin();
    const { error } = await admin
      .from("email_secret")
      .upsert({ id: 1, pass_encrypted: encrypted }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, hasPassword: true });
  } catch (err: any) {
    return Response.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
