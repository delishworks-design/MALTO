import { readJson } from "@/lib/admin-auth";
import { isValidEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

export const runtime = "nodejs";

/**
 * Partner self-registration.
 *
 * Public on purpose, and the reason is the same as before: the partner sets
 * their own password, so there is no invite email and no dependency on
 * Supabase's own SMTP, which is rate limited and would drop signups silently.
 * The account is created already confirmed and lands as portal_status 'pending',
 * which grants nothing until an admin approves it.
 *
 * The agreement is recorded here rather than trusted from the client. The
 * browser sends the version it displayed; this re-reads the current text from
 * the database, hashes it, and stores the hash with the acceptance. If someone
 * edits the agreement afterwards the stored hash no longer matches what is on
 * screen, which is exactly the point of storing it.
 */

type Terms = { title: string; version: string; intro: string; body: string };

async function currentTerms(): Promise<Terms> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("site_settings")
    .select("key,value")
    .in("key", [
      "partner_agreement_title",
      "partner_agreement_version",
      "partner_agreement_intro",
      "partner_agreement_body",
    ]);
  if (error) throw new Error(`Could not read the partner agreement: ${error.message}`);

  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(String(row.key), String(row.value ?? ""));

  const version = map.get("partner_agreement_version") ?? "";
  const body = map.get("partner_agreement_body") ?? "";
  if (!version || !body) {
    throw new Error(
      "The partner agreement has not been published yet. An administrator needs to set it under Settings before anyone can register."
    );
  }
  return {
    title: map.get("partner_agreement_title") ?? "Partner agreement",
    version,
    intro: map.get("partner_agreement_intro") ?? "",
    body,
  };
}

/** SHA-256 of the exact text shown on screen. */
const termsHash = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");

/** GET returns the agreement so the client can display it before submitting. */
export async function GET() {
  try {
    const t = await currentTerms();
    return Response.json({ ok: true, ...t, hash: termsHash(t.body) });
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 503 });
  }
}

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

export async function POST(req: Request) {
  const body = readJson(await req.json().catch(() => null));

  const name = str(body.name, 120);
  const email = str(body.email, 200).toLowerCase();
  const password = String(body.password ?? "");
  const phone = str(body.phone, 40);
  const headline = str(body.headline, 120);
  const tagline = str(body.tagline, 160);
  const bio = str(body.bio, 1200);
  const yearsRaw = Number(body.years_experience);
  const years = Number.isFinite(yearsRaw) && yearsRaw > 0 ? Math.min(Math.round(yearsRaw), 70) : 0;

  const cityCodes = (Array.isArray(body.city_codes) ? body.city_codes : [])
    .map((c) => str(c, 12))
    .filter(Boolean)
    .slice(0, 12);
  const serviceIds = (Array.isArray(body.service_ids) ? body.service_ids : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 12);

  const agreed = body.agreement_accepted === true;
  const agreedVersion = str(body.agreement_version, 60);
  const nameTyped = str(body.name_typed, 120);
  const agreedHash = str(body.agreement_hash, 64);

  if (!isValidEmail(email)) {
    return Response.json({ ok: false, field: "email", error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json(
      { ok: false, field: "password", error: "Your password needs at least 8 characters." },
      { status: 400 }
    );
  }
  if (!name) {
    return Response.json({ ok: false, field: "name", error: "Enter your full name." }, { status: 400 });
  }
  if (!headline) {
    return Response.json(
      { ok: false, field: "headline", error: "Add a headline, e.g. Deep cleaning specialist." },
      { status: 400 }
    );
  }
  if (!cityCodes.length) {
    return Response.json(
      { ok: false, field: "city_codes", error: "Choose at least one city or municipality you can work in." },
      { status: 400 }
    );
  }
  if (!serviceIds.length) {
    return Response.json(
      { ok: false, field: "service_ids", error: "Choose at least one service you take." },
      { status: 400 }
    );
  }

  // The agreement is a gate, not a checkbox we take on trust.
  let terms: Terms;
  try {
    terms = await currentTerms();
  } catch (err: any) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 503 });
  }
  const realHash = termsHash(terms.body);

  if (!agreed) {
    return Response.json(
      { ok: false, field: "agreement_accepted", error: "You need to accept the partner agreement to continue." },
      { status: 400 }
    );
  }
  if (agreedVersion !== terms.version) {
    // The page was loaded before the text changed, so what they agreed to is not
    // what is on the server. Make them read the current one.
    return Response.json(
      {
        ok: false,
        field: "agreement_version",
        error: "The partner agreement has changed since this page loaded. Please read the current version and accept it again.",
        version: terms.version,
        hash: realHash,
      },
      { status: 409 }
    );
  }
  if (agreedHash !== realHash) {
    return Response.json(
      { ok: false, field: "agreement_hash", error: "The agreement could not be verified. Please reload the page." },
      { status: 409 }
    );
  }
  if (nameTyped.toLowerCase() !== name.toLowerCase()) {
    return Response.json(
      { ok: false, field: "name_typed", error: "Type your full name exactly as it appears above." },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  // Case-insensitive match, so someone typing their address differently from
  // what we already hold does not end up as a second, permanently pending row.
  const { data: existing, error: lookupErr } = await admin
    .from("team_members")
    .select("id, user_id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (lookupErr) {
    return Response.json({ ok: false, error: lookupErr.message }, { status: 500 });
  }
  if (existing?.user_id) {
    return Response.json(
      { ok: false, error: "This email is already registered. Please sign in instead." },
      { status: 409 }
    );
  }

  // Only cities that actually exist, so a service area can never be a typo.
  const { data: cities } = await admin
    .from("cities")
    .select("code")
    .in("code", cityCodes);
  const validCityCodes = (cities ?? []).map((c) => c.code);
  if (!validCityCodes.length) {
    return Response.json(
      { ok: false, field: "city_codes", error: "None of the cities you chose are recognised." },
      { status: 400 }
    );
  }
  const { data: services } = await admin
    .from("services")
    .select("id, active")
    .in("id", serviceIds);
  const validServiceIds = (services ?? [])
    .filter((s) => s.active !== false)
    .map((s) => s.id);
  if (!validServiceIds.length) {
    return Response.json(
      { ok: false, field: "service_ids", error: "None of the services you chose are available." },
      { status: 400 }
    );
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) {
    if (/already|registered|exists/i.test(createErr.message)) {
      return Response.json(
        { ok: false, error: "This email is already registered. Please sign in instead." },
        { status: 409 }
      );
    }
    return Response.json({ ok: false, error: createErr.message }, { status: 500 });
  }

  // A readable slug from the name, kept unique by the index.
  const baseSlug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "partner";
  const slug = `${baseSlug}-${created.user.id.slice(0, 4)}`;

  const profile: Record<string, unknown> = {
    name,
    email,
    phone,
    role: headline,
    headline,
    tagline,
    bio,
    years_experience: years,
    slug,
    user_id: created.user.id,
    portal_status: "pending",
    active: true,
    is_accepting_jobs: true,
  };

  const rollback = async () => {
    // Never leave a usable account with no profile behind it.
    await admin.auth.admin.deleteUser(created.user.id);
  };

  let partnerId = existing?.id;
  if (partnerId) {
    const { error: linkErr } = await admin.from("team_members").update(profile).eq("id", partnerId);
    if (linkErr) {
      await rollback();
      return Response.json({ ok: false, error: linkErr.message }, { status: 500 });
    }
  } else {
    const { data: inserted, error: insErr } = await admin
      .from("team_members")
      .insert(profile)
      .select("id")
      .single();
    if (insErr) {
      await rollback();
      return Response.json({ ok: false, error: insErr.message }, { status: 500 });
    }
    partnerId = inserted.id;
  }

  const { error: svcErr } = await admin.from("partner_services").upsert(
    validServiceIds.map((service_id) => ({ partner_id: partnerId, service_id })),
    { onConflict: "partner_id,service_id", ignoreDuplicates: true }
  );
  if (svcErr) {
    await rollback();
    return Response.json({ ok: false, error: svcErr.message }, { status: 500 });
  }

  const { error: areaErr } = await admin.from("partner_areas").upsert(
    validCityCodes.map((city_code) => ({ partner_id: partnerId, city_code })),
    { onConflict: "partner_id,city_code", ignoreDuplicates: true }
  );
  if (areaErr) {
    await rollback();
    return Response.json({ ok: false, error: areaErr.message }, { status: 500 });
  }

  // The acceptance record. Immutable once written.
  const h = await headers();
  const { error: agreeErr } = await admin.from("partner_agreements").insert({
    partner_id: partnerId,
    version: terms.version,
    terms_hash: realHash,
    name_typed: nameTyped,
    ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 60),
    user_agent: str(h.get("user-agent"), 300),
  });
  if (agreeErr) {
    // A partner with no recorded agreement is not acceptable, so undo the whole
    // registration rather than leaving a half-built account.
    await admin.from("partner_areas").delete().eq("partner_id", partnerId);
    await admin.from("partner_services").delete().eq("partner_id", partnerId);
    await rollback();
    return Response.json({ ok: false, error: agreeErr.message }, { status: 500 });
  }

  // A default working week, so they are bookable once approved instead of
  // invisible until they think to configure hours.
  await admin.from("partner_availability_rules").insert(
    [1, 2, 3, 4, 5, 6].map((weekday) => ({
      partner_id: partnerId,
      weekday,
      start_time: weekday === 6 ? "09:00" : "08:00",
      end_time: "18:00",
    }))
  );

  return Response.json({ ok: true, email, pending: true });
}
