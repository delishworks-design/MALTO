/**
 * Generates supabase/010b_cities.sql from the Philippine Statistics Authority's
 * PSGC dataset.
 *
 * Run once, commit the output, and the site never calls the network again:
 *
 *   node --experimental-strip-types scripts/build-city-seed.ts
 *
 * The source is public reference data (PSGC 2025-2Q). The generated file is
 * committed so a deploy is reproducible and the database is not dependent on a
 * third party being up.
 *
 * Cleaning that the raw data needs:
 *   - 139 localities are stored as "City of Cebu", "City of Makati". That reads
 *     badly in a dropdown and is near-impossible to search, so they become
 *     "Cebu City" and "Makati City".
 *   - 10 records have a province code that is not in the province table
 *     (Pateros is 817, an NCR entry, and eight are the PSGC 999 special code).
 *     They get a sensible fallback rather than an empty label.
 *   - 113 names occur in more than one province, "San Jose" seven times. Those
 *     are flagged so the UI can always qualify them.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../supabase/010b_cities.sql");
const BASE = "https://raw.githubusercontent.com/jobuntux/psgc/main/data/2025-2Q";

type Mun = { psgcCode: string; regCode: string; provCode: string; munCityCode: string; munCityName: string };
type Prov = { provCode: string; provName: string };

/** "City of Cebu" -> "Cebu City". Anything else is left alone.
 *
 *  The source has stray whitespace, e.g. "City of Cagayan De Oro " with a
 *  trailing space, which would otherwise become "Cagayan De Oro  City" with a
 *  double space. Normalising here keeps the generated data clean. */
const displayName = (raw: string): string => {
  const clean = String(raw ?? "").replace(/\s+/g, " ").trim();
  const m = /^City of (.+)$/.exec(clean);
  return (m ? `${m[1]} City` : clean).trim();
};

/** Province codes present in the source with no entry in provinces.json.
 *
 *  817 Pateros, the one NCR municipality that is not a city of its own.
 *  901 Isabela City.
 *  999 the PSGC code for a municipality under a special situation, covering
 *      eight places in different provinces with no single correct answer.
 *      Those are left blank rather than guessed; the UI shows the name alone. */
const PROVINCE_OVERRIDES: Record<string, string> = {
  "817": "Metro Manila",
  "901": "Basilan",
  "999": "",
};

/** Escapes a value for a single-quoted SQL literal. */
const sql = (v: string): string => `'${String(v ?? "").replace(/'/g, "''")}'`;

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return (await res.json()) as T;
}

async function main() {
  console.log("Fetching PSGC 2025-2Q…");
  const [mun, prov] = await Promise.all([
    getJSON<Mun[]>(`${BASE}/muncities.json`),
    getJSON<Prov[]>(`${BASE}/provinces.json`),
  ]);

  // provinces.json has the same "City of X" shape for independent cities, so a
  // raw copy would read "Makati City, City of Makati". Normalised the same way.
  const provinceName = new Map<string, string>();
  for (const p of prov) provinceName.set(String(p.provCode), displayName(String(p.provName ?? "")));

  const rows = mun.map((m) => {
    const code = String(m.munCityCode);
    const name = String(m.munCityName ?? "").trim();
    const display = displayName(name);
    const provCode = String(m.provCode ?? "");
    const pName = provCode in PROVINCE_OVERRIDES
      ? PROVINCE_OVERRIDES[provCode]
      : provinceName.get(provCode) ?? "";
    return {
      code,
      name,
      display,
      provinceCode: provCode,
      province: pName,
      region: String(m.regCode ?? ""),
    };
  });

  // A display name that is ambiguous on its own needs the province to
  // disambiguate it, otherwise the filter shows seven identical "San Jose".
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.display, (counts.get(r.display) ?? 0) + 1);

  // --- validation before anything is written -------------------------------
  const problems: string[] = [];

  const codes = new Set<string>();
  for (const r of rows) {
    if (codes.has(r.code)) problems.push(`duplicate code ${r.code} (${r.display})`);
    codes.add(r.code);
  }

  // These are the markets the whole feature was designed around. If any of them
  // is missing the dropdown is broken where it matters most, so fail loudly.
  const mustResolve = [
    "Makati City", "Taguig City", "Pasig City", "Pateros",
    "Quezon City", "Cebu City", "Davao City", "Puerto Princesa City",
    "Bacolod City", "Cagayan de Oro City", "Iloilo City", "Baguio City",
  ];
  const present = new Set(rows.map((r) => r.display.toLowerCase()));
  for (const need of mustResolve) {
    if (!present.has(need.toLowerCase())) problems.push(`expected locality missing: ${need}`);
  }

  // Only the eight PSGC-999 municipalities may lack a province, and Pateros is
  // resolved above, so the expected number of unnamed rows is fixed.
  const withoutProvince = rows.filter((r) => r.province.length === 0);
  if (withoutProvince.length !== 8) {
    problems.push(
      `expected exactly 8 localities without a province, got ${withoutProvince.length} (${withoutProvince
        .map((r) => r.display)
        .join(", ")})`
    );
  }

  if (problems.length) {
    console.error("\nValidation failed:");
    for (const p of problems) console.error("  -", p);
    process.exit(1);
  }

  const ambiguous = Array.from(counts.entries()).filter(([, n]) => n > 1);

  const lines: string[] = [];
  lines.push("-- 010b_cities.sql");
  lines.push("-- GENERATED FILE — do not edit by hand.");
  lines.push("-- Regenerate with: node --experimental-strip-types scripts/build-city-seed.ts");
  lines.push("--");
  lines.push(`-- Source : PSGC 2025-2Q, Philippine Statistics Authority (public reference data)`);
  lines.push(`-- Records: ${rows.length} cities and municipalities`);
  lines.push(`-- Names  : ${counts.size} distinct, ${ambiguous.length} of which are shared across`);
  lines.push(`--          provinces and therefore always displayed with their province.`);
  lines.push("--");
  lines.push("-- Committed so a deploy is reproducible and no request ever leaves the");
  lines.push("-- server. The application never calls the PSGC at runtime.");
  lines.push("");
  lines.push("begin;");
  lines.push("");
  lines.push("insert into public.cities (code, name, display_name, province_code, province_name, region_code, disambiguated)");
  lines.push("values");
  rows
    .slice()
    .sort((a, b) => a.display.localeCompare(b.display) || a.province.localeCompare(b.province))
    .forEach((r, i) => {
      const tail = i === rows.length - 1 ? ";" : ",";
      lines.push(
        `  (${sql(r.code)}, ${sql(r.name)}, ${sql(r.display)}, ${sql(r.provinceCode)}, ${sql(r.province)}, ${sql(r.region)}, ${(counts.get(r.display) ?? 0) > 1})${tail}`
      );
    });
  lines.push("");
  lines.push("commit;");
  lines.push("");
  lines.push("-- Verification");
  lines.push("do $$");
  lines.push("declare v_total int; v_named int; v_dupes int;");
  lines.push("begin");
  lines.push("  select count(*) into v_total from public.cities;");
  lines.push("  select count(*) into v_named from public.cities where display_name <> '' and province_name <> '';");
  lines.push("  select count(*) into v_dupes from (");
  lines.push("    select code from public.cities group by code having count(*) > 1");
  lines.push("  ) d;");
  lines.push(`  raise notice 'V-O cities=% (expect ${rows.length}), with name+province=% (expect ${rows.length - 8}), duplicate codes=% (expect 0)', v_total, v_named, v_dupes;`);
  lines.push(`  if v_total <> ${rows.length} or v_dupes <> 0 or v_named <> ${rows.length - 8} then`);
  lines.push("    raise exception 'V-O FAILED';");
  lines.push("  end if;");
  lines.push("end $$;");
  lines.push("");

  writeFileSync(OUT, lines.join("\n"), "utf8");

  console.log(`\nWrote ${OUT}`);
  console.log(`  records      : ${rows.length}`);
  console.log(`  distinct     : ${counts.size}`);
  console.log(`  ambiguous    : ${ambiguous.length} (flagged for province disambiguation)`);
  console.log(`  validated    : ${mustResolve.length} key markets all resolve, no duplicate codes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
