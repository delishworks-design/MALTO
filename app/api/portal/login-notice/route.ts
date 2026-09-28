import { supabaseAdmin } from "@/lib/supabase-admin";
import { isValidEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Was this address a registration that MALTO rejected?
 *
 * A rejected partner's login is banned rather than deleted, which is what makes
 * the rejection hold: deleting it would clear team_members.user_id through the
 * foreign key's ON DELETE SET NULL, and they would be free to register again the
 * same evening. Banned, the row stays, the sign-in is refused, and
 * register/route.ts answers "already registered" so the door stays shut.
 *
 * The problem a ban creates is that Supabase reports it as an ordinary wrong
 * password, so the sign-in form cannot tell this person from somebody who
 * mistyped. This is how the form finds out. It is deliberately a boolean and
 * nothing else: no name, no status, no date, and no way to ask about an address
 * that was not rejected.
 *
 * It is asked only after a failed attempt, but the endpoint is public and
 * unauthenticated, because it has to be: the person asking has no session. That
 * means anyone who knows an address can learn whether it was rejected. For a
 * closed partner system that is a small exposure, and the alternative is a form
 * that never explains itself. The rate limit below is the mitigation, and it is
 * the reason the limit lives here rather than in the client.
 */

// Fixed window per address and per client, both deliberately modest: a person
// who mistypes twice is not the case this is built for.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_ADDRESS = 3;
const MAX_PER_CLIENT = 20;

const hits = new Map<string, { count: number; resetAt: number }>();

function throttled(key: string, max: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!isValidEmail(email)) {
    // Same answer either way, so a malformed address reveals nothing and gains
    // the caller nothing.
    return Response.json({ rejected: false });
  }

  const headers = req.headers;
  const client = (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

  if (throttled(`addr:${email}`, MAX_PER_ADDRESS) || throttled(`ip:${client}`, MAX_PER_CLIENT)) {
    // 429 rather than a plain false: this is a rate limit, and a caller that
    // cares can back off. The client does not, which is fine, it just gets no
    // message this time.
    return Response.json({ rejected: false }, { status: 429, headers: { "cache-control": "no-store" } });
  }

  try {
    const { data, error } = await supabaseAdmin()
      .from("team_members")
      .select("portal_status")
      .ilike("email", email)
      .eq("portal_status", "rejected")
      .limit(1);
    if (error) {
      // A failure must not become a false "rejected", which would tell somebody
      // their application was closed when it was not.
      return Response.json({ rejected: false }, { headers: { "cache-control": "no-store" } });
    }
    return Response.json(
      { rejected: (data ?? []).length > 0 },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return Response.json({ rejected: false }, { headers: { "cache-control": "no-store" } });
  }
}
