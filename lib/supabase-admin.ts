import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for server-only code (API route handlers, webhooks).
 *
 * It bypasses RLS — NEVER import this from a Client Component or from any
 * module that can run in the browser. Only route handlers under app/api
 * may use it, because they run exclusively on the server.
 */
export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment."
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
