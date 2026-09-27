/**
 * Seeds sample partners so the public directory can be designed and reviewed
 * before the real crew has registered.
 *
 * Safety, because this goes on a live marketplace:
 *   - is_sample = true, so public_partners excludes them. They cannot be booked
 *     and can never appear in a partner picker.
 *   - They render with a SAMPLE badge in the UI, not just a name convention.
 *   - Avatars are generated initials, never a photograph. A realistic headshot
 *     on a marketplace could be mistaken for a real cleaner.
 *   - No auth account is created, so a sample cannot sign in or be reviewed.
 *
 *   node --experimental-strip-types scripts/seed-sample-partners.ts
 *   node --experimental-strip-types scripts/seed-sample-partners.ts --clean
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/** Reads .env.local without a dotenv dependency. */
function loadEnv() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* rely on the ambient environment */
  }
}

const BUCKET = "team-photos";

type Sample = {
  name: string;
  slug: string;
  headline: string;
  tagline: string;
  bio: string;
  years_experience: number;
  cities: string[];
  services: string[];
  colour: string;
};

const SAMPLES: Sample[] = [
  {
    name: "Ana Reyes",
    slug: "sample-ana-reyes",
    headline: "Deep cleaning specialist",
    tagline: "Detail-first deep cleans for lived-in homes.",
    bio: "Sample profile. Ana focuses on kitchens, bathrooms and the build-up that accumulates in a busy household. She brings her own equipment and works through a written checklist so nothing is missed.",
    years_experience: 6,
    cities: ["80300", "81300"],
    services: ["Deep Cleaning"],
    colour: "#526B5D",
  },
  {
    name: "Jomar Santos",
    slug: "sample-jomar-santos",
    headline: "Move-in and move-out",
    tagline: "Turnover cleans that pass inspection first time.",
    bio: "Sample profile. Jomar handles turnovers for landlords and small developers, including inside-the-cabinet work and a photo checklist of the finished unit.",
    years_experience: 8,
    cities: ["81500", "81200"],
    services: ["Move-In / Move-Out"],
    colour: "#3F6B4F",
  },
  {
    name: "Grace Lim",
    slug: "sample-grace-lim",
    headline: "Recurring home cleaning",
    tagline: "A regular cleaner who learns how your home is used.",
    bio: "Sample profile. Grace looks after a small number of recurring homes so she can keep the same approach every visit. Fixed days, same cleaner each time.",
    years_experience: 4,
    cities: ["80300", "81200", "81701"],
    services: ["Home Cleaning"],
    colour: "#6B7F5A",
  },
  {
    name: "Marco Dela Cruz",
    slug: "sample-marco-dela-cruz",
    headline: "Small business and offices",
    tagline: "After-hours cleaning for shops, studios and offices.",
    bio: "Sample profile. Marco works around opening hours so the space is ready before the first customer arrives. Includes desks, glass partitions and the kitchen area.",
    years_experience: 5,
    cities: ["60100", "80300"],
    services: ["Small Business"],
    colour: "#5A6B7A",
  },
];

/** Initials on a flat brand colour. Obviously a placeholder, never a face. */
function avatarSvg(initials: string, colour: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" role="img" aria-label="Sample partner">
  <rect width="600" height="600" fill="${colour}"/>
  <text x="300" y="300" fill="#F7F5F0" font-family="Georgia, serif" font-size="240"
        text-anchor="middle" dominant-baseline="central">${initials}</text>
</svg>
`;
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const clean = process.argv.includes("--clean");

  const existing = await admin.from("team_members").select("id, photo_path, slug").eq("is_sample", true);
  if (existing.error) throw existing.error;

  if (clean) {
    for (const row of existing.data ?? []) {
      if (row.photo_path) {
        await admin.storage.from(BUCKET).remove([row.photo_path]);
      }
    }
    const { error } = await admin.from("team_members").delete().eq("is_sample", true);
    if (error) throw error;
    console.log(`Removed ${(existing.data ?? []).length} sample partner(s).`);
    return;
  }

  const { data: services } = await admin.from("services").select("id, name");
  const byName = new Map((services ?? []).map((s) => [s.name, s.id]));

  for (const s of SAMPLES) {
    const photo_path = `${s.slug}.svg`;

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(photo_path, new Blob([avatarSvg(initialsOf(s.name), s.colour)], { type: "image/svg+xml" }), {
        contentType: "image/svg+xml",
        upsert: true,
      });
    if (upErr) throw new Error(`avatar upload for ${s.slug}: ${upErr.message}`);

    // The unique index on slug is partial (it excludes samples), so it cannot be
    // used as an ON CONFLICT target. Look it up instead and update or insert.
    const payload: Record<string, unknown> = {
      name: s.name,
      slug: s.slug,
      headline: s.headline,
      tagline: s.tagline,
      bio: s.bio,
      years_experience: s.years_experience,
      role: s.headline,
      email: "",
      phone: "",
      photo_path,
      // Approved so they pass the view's filter, but is_sample excludes them
      // from it. Both must be true for a sample to show at all, which keeps the
      // flag honest if the view is ever changed.
      portal_status: "approved",
      active: true,
      is_accepting_jobs: true,
      verified: false,
      is_sample: true,
      sort_order: 0,
    };

    const { data: found, error: findErr } = await admin
      .from("team_members")
      .select("id")
      .eq("slug", s.slug)
      .maybeSingle();
    if (findErr) throw new Error(`${s.slug}: ${findErr.message}`);

    let memberId: string;
    if (found) {
      const { error: updErr } = await admin
        .from("team_members")
        .update(payload)
        .eq("id", found.id);
      if (updErr) throw new Error(`${s.slug}: ${updErr.message}`);
      memberId = found.id;
    } else {
      const { data: created, error: insErr } = await admin
        .from("team_members")
        .insert(payload)
        .select("id")
        .single();
      if (insErr) throw new Error(`${s.slug}: ${insErr.message}`);
      memberId = created.id;
    }

    const serviceIds = s.services.map((n) => byName.get(n)).filter((x): x is string => Boolean(x));
    if (serviceIds.length !== s.services.length) {
      throw new Error(`${s.slug}: unknown service in ${JSON.stringify(s.services)}`);
    }
    await admin.from("partner_services").delete().eq("partner_id", memberId);
    await admin.from("partner_services").insert(
      serviceIds.map((service_id) => ({ partner_id: memberId, service_id }))
    );

    await admin.from("partner_areas").delete().eq("partner_id", memberId);
    await admin
      .from("partner_areas")
      .insert(s.cities.map((city_code) => ({ partner_id: memberId, city_code })));

    // A plausible weekly week, so "available this week" has something to show.
    await admin.from("partner_availability_rules").delete().eq("partner_id", memberId);
    await admin.from("partner_availability_rules").insert(
      [1, 2, 3, 4, 5].map((weekday) => ({
        partner_id: memberId,
        weekday,
        start_time: "08:00",
        end_time: "18:00",
      }))
    );

    console.log(`  seeded ${s.name} (${s.slug})`);
  }

  console.log(`\n${SAMPLES.length} sample partner(s) ready. They are excluded from booking by design.`);
  console.log("Remove them with: node --experimental-strip-types scripts/seed-sample-partners.ts --clean");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
