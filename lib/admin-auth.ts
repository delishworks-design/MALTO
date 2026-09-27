import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AdminGuard =
  | { ok: true; supabase: SupabaseClient; user: User }
  | { ok: false; response: Response };

/**
 * Cookie-based session guard for admin API routes.
 *
 * Signing in is not enough: since the member portal launched, a team member is
 * also an authenticated Supabase user. The admin check therefore asks the
 * database, via is_admin(), rather than just checking that a session exists.
 * Returns a 401 Response the caller should return as-is when the caller is
 * signed out, or a 403 when they are signed in but not an admin.
 */
export async function requireAdmin(): Promise<AdminGuard> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return { ok: false, response: Response.json({ error: "Not signed in." }, { status: 401 }) };
    }
    const { data: admin, error: adminErr } = await supabase.rpc("is_admin");
    if (adminErr) {
      return { ok: false, response: Response.json({ error: "Auth unavailable." }, { status: 500 }) };
    }
    if (admin !== true) {
      return {
        ok: false,
        response: Response.json(
          { error: "This action is for MALTO administrators only." },
          { status: 403 }
        ),
      };
    }
    return { ok: true, supabase, user: data.user };
  } catch {
    return { ok: false, response: Response.json({ error: "Auth unavailable." }, { status: 500 }) };
  }
}

export function readJson(body: unknown): Record<string, any> {
  return body && typeof body === "object" ? (body as Record<string, any>) : {};
}
