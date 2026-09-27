import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // /portal needs the same session refresh as /admin, otherwise a member's
  // cookie goes stale mid-session and their assignments stop loading.
  matcher: ["/admin/:path*", "/portal/:path*"],
};
