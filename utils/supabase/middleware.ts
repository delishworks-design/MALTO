import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const PUBLIC_ADMIN_PATH = "/admin/login";

  // The portal is a browser page too: a partner may well be checking a job from
  // a laptop, and login stays open there. Only the signed-in pages are gated.
  const PUBLIC_PORTAL_PATHS = ["/portal/login", "/portal/register"];

  const isPublicPortalPath = (path: string) =>
    PUBLIC_PORTAL_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

export async function updateSession(request: NextRequest) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: getUser() revalidates the auth token — do not skip it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && path.startsWith("/admin") && path !== PUBLIC_ADMIN_PATH) {
    const url = request.nextUrl.clone();
    url.pathname = PUBLIC_ADMIN_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // The portal relied on the page redirecting an unauthenticated visitor to
  // /portal/login from the client. That shipped the whole page's HTML to anyone
  // who asked for it, and the redirect only happened once React had booted. No
  // data leaked, because every query is behind RLS and a session, but it was
  // not a private page, and in the app the first thing a partner saw on a cold
  // start was a loading state rather than a sign-in form.
  //
  // This runs before the response, so an unauthenticated request never gets the
  // page at all.
  if (!user && path.startsWith("/portal") && !isPublicPortalPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && path === PUBLIC_ADMIN_PATH) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // An approved partner who lands on the login form has nothing to do there, and
  // in the app the fence would bounce them back anyway.
  if (user && path === "/portal/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/portal";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
