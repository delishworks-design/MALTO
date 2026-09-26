import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AdminGuard =
  | { ok: true; supabase: SupabaseClient; user: User }
  | { ok: false; response: Response };

/**
 * Cookie-based session guard for admin API routes.
 * Returns a 401 Response the caller should return as-is when nobody is signed in.
 */
export async function requireAdmin(): Promise<AdminGuard> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return { ok: false, response: Response.json({ error: "Not signed in." }, { status: 401 }) };
    }
    return { ok: true, supabase, user: data.user };
  } catch {
    return { ok: false, response: Response.json({ error: "Auth unavailable." }, { status: 500 }) };
  }
}

export function readJson(body: unknown): Record<string, any> {
  return body && typeof body === "object" ? (body as Record<string, any>) : {};
}
