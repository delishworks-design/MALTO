/**
 * Reads the signed-in user id out of the stored Supabase session.
 *
 * Needed offline, and only offline. supabase.auth.getUser() calls the auth
 * server, so with no connection it rejects, and code that treats a rejection as
 * "signed out" bounces a partner to the login page on the first thing they do in
 * a basement. The session is kept in local storage by the Supabase client, so
 * the id is readable without a network call.
 *
 * The key is derived from the project ref rather than read off the client
 * object, because supabaseUrl is protected on SupabaseClient and TypeScript
 * will not let it be touched.
 */
export function storedUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ref =
      process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "").split(".")[0] ??
      "jmntviljjrixhqgosehl";
    const raw = window.localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const id = parsed?.user?.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}
