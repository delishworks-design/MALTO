import { supabaseAdmin } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A partner replacing their own profile photo.
 *
 * Separate from the details endpoint, and deliberately so. photo_path is not in
 * the partner-editable column list on /api/portal/profile, because a path is a
 * location: let the client choose it and it can point the public profile at any
 * object in the bucket, including another partner's file. Here the path is
 * derived from the caller's own id on the server, so there is nothing to choose.
 *
 * The upload goes through the service role rather than the browser. team_photos
 * is a public bucket, and its insert policy happens to allow any authenticated
 * user, which means a client-side upload is technically possible and is exactly
 * the kind of thing that should not be relied on: the bucket id, the policy and
 * the file name all become the client's business the moment they are.
 */

const BUCKET = "team-photos";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Nothing was uploaded." }, { status: 400 });
  }

  const file = form.get("photo");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "Choose a photo first." }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return Response.json({ ok: false, error: "That is not an image. Use a JPG or PNG." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { ok: false, error: `That photo is ${(file.size / 1048576).toFixed(1)}MB. The limit is 5MB.` },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return Response.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  }
  const { data: member } = await supabase.rpc("is_approved_member");
  if (member !== true) {
    return Response.json({ ok: false, error: "Your account is still waiting for approval from MALTO." }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { data: mine, error: lookupErr } = await admin
    .from("team_members")
    .select("id,photo_path")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();
  if (lookupErr) return Response.json({ ok: false, error: lookupErr.message }, { status: 500 });
  if (!mine) return Response.json({ ok: false, error: "No partner profile is linked to this account." }, { status: 404 });

  // Derived, never taken from the request. The extension is reduced to a short
  // allowlisted set so a crafted filename cannot influence the stored path.
  const ext = (() => {
    const raw = (file.name.split(".").pop() || "").toLowerCase();
    if (["jpg", "jpeg"].includes(raw)) return "jpg";
    if (["png", "webp", "heic", "heif"].includes(raw)) return raw;
    return "jpg";
  })();
  const path = `${mine.id}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: true,
  });
  if (upErr) return Response.json({ ok: false, error: `Could not upload: ${upErr.message}` }, { status: 500 });

  const { error: writeErr } = await admin.from("team_members").update({ photo_path: path }).eq("id", mine.id);
  if (writeErr) {
    // The object is already in the bucket but the row still points at the old
    // one. Say so rather than reporting success with a photo that is not there.
    return Response.json({ ok: false, error: "The photo uploaded but could not be attached to your profile." }, { status: 500 });
  }

  // Only clean up once the row points at the new file, and only when the
  // extension changed, so a jpg replaced by a jpg leaves no orphan and a jpg
  // replaced by a png does not accumulate.
  if (mine.photo_path && mine.photo_path !== path) {
    try {
      await admin.storage.from(BUCKET).remove([mine.photo_path]);
    } catch {
      /* an orphaned file is untidy, not broken */
    }
  }

  const { data: publicUrl } = admin.storage.from(BUCKET).getPublicUrl(path);
  return Response.json({ ok: true, photo_path: path, url: publicUrl?.publicUrl ?? null });
}
