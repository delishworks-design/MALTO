import { requireAdmin, readJson } from "@/lib/admin-auth";
import { loadEmailConfig, sendTestEmail } from "@/lib/email";

export const runtime = "nodejs";

/** Sends a smoke-test message so the admin can confirm SMTP before go-live. */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = readJson(await req.json().catch(() => null));
  let to = String(body.to ?? "").trim();

  try {
    if (!to) {
      const cfg = await loadEmailConfig();
      to = cfg.replyTo || cfg.fromEmail || cfg.user;
    }
    if (!to) {
      return Response.json(
        { ok: false, error: "No recipient. Set Reply-To in Settings → Email, or pass {\"to\"}." },
        { status: 400 }
      );
    }
    await sendTestEmail(to);
    return Response.json({ ok: true, to });
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 502 });
  }
}
