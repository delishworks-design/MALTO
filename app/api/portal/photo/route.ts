import { readJson } from "@/lib/admin-auth";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

const PHOTO_BUCKET = "booking-photos";

/**
 * Short-lived signed URL for a customer's booking photo.
 *
 * A member is only entitled to the photo of a job assigned to them, which the
 * outbox has already established. The bucket itself stays private, so this
 * hands out a URL for one object rather than any list access.
 */
export async function POST(req: Request) {
  const bookingId = String(readJson(await req.json().catch(() => null)).booking_id ?? "").trim();
  if (!bookingId) {
    return Response.json({ error: "booking_id is required." }, { status: 400 });
  }

  // An admin is always allowed; anyone else has to be an approved member with
  // an assignment on this booking.
  const admin = await requireAdmin();
  if (!admin.ok) {
    let allowed = false;
    let photoPath: string | null = null;

    try {
      const supabase = await createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        const { data: approved } = await supabase.rpc("is_approved_member");
        if (approved === true) {
          const service = supabaseAdmin();
          const { data: rows } = await service
            .from("assignments")
            .select("id, bookings!inner(photo_path)")
            .eq("booking_id", bookingId);
          // Only rows the member's own RLS policy allowed through count.
          if (rows && rows.length > 0) {
            allowed = true;
            const joined = rows[0].bookings as unknown as { photo_path?: string | null };
            photoPath = joined?.photo_path ?? null;
          }
        }
      }
    } catch {
      allowed = false;
    }

    if (!allowed) {
      return Response.json({ error: "You do not have access to that booking." }, { status: 403 });
    }

    if (!photoPath) {
      const { data: row } = await supabaseAdmin()
        .from("bookings")
        .select("photo_path")
        .eq("id", bookingId)
        .maybeSingle();
      photoPath = row?.photo_path ?? null;
    }

    if (!photoPath) {
      return Response.json({ error: "No photo was uploaded for this booking." }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin()
      .storage.from(PHOTO_BUCKET)
      .createSignedUrl(photoPath, 3600);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ ok: true, url: data.signedUrl });
  }

  // Admin path: keep the existing behaviour, short-lived signed URL.
  const { data: booking } = await supabaseAdmin()
    .from("bookings")
    .select("photo_path")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking?.photo_path) {
    return Response.json({ error: "No photo was uploaded for this booking." }, { status: 404 });
  }
  const { data, error } = await supabaseAdmin()
    .storage.from(PHOTO_BUCKET)
    .createSignedUrl(booking.photo_path, 3600);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true, url: data.signedUrl });
}
