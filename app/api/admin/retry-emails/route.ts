import { requireAdmin } from "@/lib/admin-auth";
import { drainOutbox } from "@/lib/email-outbox";

export const runtime = "nodejs";

/**
 * Manual "retry now" for the Action Needed banner and the Settings → Email
 * panel. Goes through the same claim/complete path as the trigger and the cron
 * job, so a hand retry can neither double-send nor bypass the backoff.
 */
export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const result = await drainOutbox(25);
    return Response.json({ ok: true, ...result });
  } catch (err: any) {
    return Response.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
