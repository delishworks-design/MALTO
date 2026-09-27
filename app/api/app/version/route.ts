import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { APP_SETTING_KEYS, checkVersion, toAppRelease } from "@/lib/app-release";

/**
 * What the installed app asks on launch and on resume, to find out whether it
 * is still allowed to run.
 *
 * There is no store to push an update through, and a sideloaded app has nothing
 * that will ever nag it to update on its own, so the only way a cleaner ends up
 * on a fixed build is if the app is told. This is that mechanism, which is why
 * the minimum version is a setting rather than a constant.
 *
 * Deliberately unauthenticated. The caller is a WebView that may be running an
 * older build than the one that introduced its session, and a request that can
 * fail on a stale token is a request that fails exactly when it is needed. None
 * of this is sensitive: the APK and its version are already public.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { data } = await supabase
    .from("site_settings")
    .select("key,value")
    .in("key", [...APP_SETTING_KEYS]);

  const release = toAppRelease(data);
  const current = new URL(request.url).searchParams.get("version") ?? "";
  const verdict = checkVersion(current, release);

  return NextResponse.json(
    {
      ok: verdict.ok,
      reason: verdict.reason,
      current: verdict.current,
      latest: release.version,
      min: release.minVersion,
      url: release.url,
      sizeMb: release.sizeMb,
      sha256: release.sha256,
    },
    // A cleaner on an old build should not be pinned to a stale answer by a
    // cache it cannot clear.
    { headers: { "cache-control": "no-store" } }
  );
}
