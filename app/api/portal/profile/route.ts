import { supabaseAdmin } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A partner editing their own profile.
 *
 * Why this is a route handler and not a supabase.from(...).update() from the
 * browser
 * ---------------------------------------------------------------------------
 * team_members_own_update has no column restriction. Any signed-in partner can
 * update any column of their own row, and the only thing stopping them is a
 * trigger that protects exactly two: user_id and portal_status. So a direct
 * client update would also let a partner set
 *
 *   active            take themselves off the marketplace, or worse, put
 *                     themselves back on after an admin took them off
 *   verified          award themselves the badge that says MALTO checked their ID
 *   slug              rename their public URL, and quietly take over another
 *                     partner's address
 *   is_accepting_jobs reappear in search while switched off
 *
 * None of those are things a partner should be able to do by editing a form, and
 * none of them are things a client-side allowlist can enforce, because the client
 * is the thing being restricted. So the list of editable columns lives here, on
 * the server, where the browser cannot reach past it. This is the only reason
 * the profile editor is safe to ship.
 *
 * The service role is used deliberately: RLS would let the partner through
 * anyway, and what is actually being relied on here is this file's allowlist
 * plus the ownership check below, not the policy.
 */

/** Columns a partner may change about themselves. Nothing else is reachable. */
const EDITABLE: Record<string, { max: number; min?: number }> = {
  name: { max: 120 },
  phone: { max: 40 },
  headline: { max: 120 },
  tagline: { max: 160 },
  bio: { max: 1200 },
  years_experience: { max: 70, min: 0 },
};

type EditableKey = keyof typeof EDITABLE;

function clean(v: unknown, key: EditableKey): string | number | null {
  const rule = EDITABLE[key];
  if (!rule) return null;
  if (typeof v === "number" || key === "years_experience") {
    const n = Number(v);
    if (!Number.isFinite(n) || n < (rule.min ?? 0) || n > rule.max) return null;
    return Math.round(n);
  }
  return String(v ?? "")
    .trim()
    .slice(0, rule.max);
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Nothing to save." }, { status: 400 });
  }

  // Identify the caller by their own session, then read their own row through
  // the service role. Ownership is established here, from the token, and is
  // never taken from the request body: a partner_id in the payload would let
  // anyone edit anyone.
  const guard = await requirePartner();
  if (!guard.ok) return guard.response;
  const userId = guard.user.id;

  const admin = supabaseAdmin();
  const { data: mine, error: lookupErr } = await admin
    .from("team_members")
    .select("id,portal_status,active,verified")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (lookupErr) return Response.json({ ok: false, error: lookupErr.message }, { status: 500 });
  if (!mine) return Response.json({ ok: false, error: "No partner profile is linked to this account." }, { status: 404 });
  if (mine.portal_status !== "approved") {
    return Response.json({ ok: false, error: "Your account is still waiting for approval." }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(EDITABLE) as EditableKey[]) {
    if (!(key in body)) continue;
    const value = clean(body[key], key);
    if (value !== null) patch[key] = value;
  }

  if (body.phone !== undefined) {
    const phone = String(body.phone ?? "").trim();
    // A phone number is how a cleaner is reached on the way to a job. A
    // malformed one is worse than none, because the client sees it as present
    // and does not ask again.
    if (phone && !/^[+\d][\d\s()+-]{6,}$/.test(phone)) {
      return Response.json({ ok: false, field: "phone", error: "That phone number does not look right." }, { status: 400 });
    }
    patch.phone = phone.slice(0, 40);
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ ok: false, error: "Nothing to save." }, { status: 400 });
  }

  const { error: updErr } = await admin.from("team_members").update(patch).eq("id", mine.id);
  if (updErr) return Response.json({ ok: false, error: updErr.message }, { status: 500 });

  return Response.json({ ok: true, saved: Object.keys(patch) });
}

/**
 * Coverage and services.
 *
 * These are join tables with a composite key, so an edit is a delete followed by
 * an insert: there is no way to say "remove this one city" against
 * (partner_id, city_code) other than deleting the row. Both tables now have
 * self-scoped policies from 018_partner_self_service.sql, so the browser could
 * do this itself, but it goes through here for the same reason as above: one
 * place that resolves the caller's own partner_id, and one place that can check
 * the change against booked jobs before it happens.
 */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "Nothing to save." }, { status: 400 });

  const guard = await requirePartner();
  if (!guard.ok) return guard.response;
  const userId = guard.user.id;

  const admin = supabaseAdmin();
  const { data: mine, error: lookupErr } = await admin
    .from("team_members")
    .select("id,portal_status")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (lookupErr) return Response.json({ ok: false, error: lookupErr.message }, { status: 500 });
  if (!mine) return Response.json({ ok: false, error: "No partner profile is linked to this account." }, { status: 404 });
  if (mine.portal_status !== "approved") {
    return Response.json({ ok: false, error: "Your account is still waiting for approval." }, { status: 403 });
  }

  const cityCodes = Array.isArray(body.city_codes)
    ? body.city_codes.map((c) => String(c).trim().slice(0, 12)).filter(Boolean).slice(0, 20)
    : null;
  const serviceIds = Array.isArray(body.service_ids)
    ? body.service_ids.map((s) => String(s).trim().slice(0, 12)).filter(Boolean).slice(0, 20)
    : null;

  if (cityCodes) {
    if (cityCodes.length === 0) {
      return Response.json({ ok: false, field: "city_codes", error: "Keep at least one city, or ask MALTO to take you off the marketplace." }, { status: 400 });
    }
    // Verified against the table so a service area can never be a typo that
    // silently matches nothing.
    const { data: cities } = await admin.from("cities").select("code").in("code", cityCodes);
    const valid = (cities ?? []).map((c) => c.code);
    if (valid.length !== cityCodes.length) {
      return Response.json({ ok: false, field: "city_codes", error: "One of those places is not recognised." }, { status: 400 });
    }
  }

  if (serviceIds) {
    if (serviceIds.length === 0) {
      return Response.json({ ok: false, field: "service_ids", error: "Keep at least one service, or ask MALTO to take you off the marketplace." }, { status: 400 });
    }
    const { data: services } = await admin.from("services").select("id,active").in("id", serviceIds);
    const valid = (services ?? []).filter((s) => s.active !== false).map((s) => s.id);
    if (valid.length !== serviceIds.length) {
      return Response.json({ ok: false, field: "service_ids", error: "One of those services is not available." }, { status: 400 });
    }
  }

  if (cityCodes) {
    const { error: delErr } = await admin.from("partner_areas").delete().eq("partner_id", mine.id);
    if (delErr) return Response.json({ ok: false, error: delErr.message }, { status: 500 });
    const { error: insErr } = await admin
      .from("partner_areas")
      .insert(cityCodes.map((city_code) => ({ partner_id: mine.id, city_code })));
    if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  if (serviceIds) {
    const { error: delErr } = await admin.from("partner_services").delete().eq("partner_id", mine.id);
    if (delErr) return Response.json({ ok: false, error: delErr.message }, { status: 500 });
    const { error: insErr } = await admin
      .from("partner_services")
      .insert(serviceIds.map((service_id) => ({ partner_id: mine.id, service_id })));
    if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  return Response.json({ ok: true, cityCodes, serviceIds });
}

/** The caller's own row, or a ready-to-return failure. */
async function requirePartner() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return { ok: false as const, response: Response.json({ error: "Please sign in again." }, { status: 401 }) };
    }
    const { data: member, error: mErr } = await supabase.rpc("is_approved_member");
    if (mErr) {
      return { ok: false as const, response: Response.json({ error: "Could not confirm your account." }, { status: 500 }) };
    }
    if (member !== true) {
      return {
        ok: false as const,
        response: Response.json({ error: "Your account is still waiting for approval from MALTO." }, { status: 403 }),
      };
    }
    return { ok: true as const, supabase, user: data.user };
  } catch {
    return { ok: false as const, response: Response.json({ error: "Could not reach the sign-in service." }, { status: 500 }) };
  }
}
