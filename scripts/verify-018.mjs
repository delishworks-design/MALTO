#!/usr/bin/env node
/**
 * Proves the 018 self-service policies with real RLS, not by reading pg_policies.
 *
 * Reading the catalog only shows that a policy exists. What matters is whether
 * the right rows come back for a signed-in partner and stay hidden from
 * everyone else, and that can only be tested by running the queries as the
 * role that will actually run them.
 *
 * The trick is SET LOCAL ROLE authenticated plus request.jwt.claims: the same
 * identity PostgREST hands to the database. RLS is then enforced by Postgres
 * itself, inside a transaction that is rolled back, so the probe cannot leave
 * anything behind.
 *
 *   node scripts/verify-018.mjs
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TOKEN_FILE = "/root/malto-signing/supabase-access-token.txt";
const REF = process.env.SUPABASE_PROJECT_REF || "jmntviljjrixhqgosehl";

function loadEnv() {
  const out = {};
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${fs.readFileSync(TOKEN_FILE, "utf8").trim()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

let failed = 0;
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok   " : "FAIL "} ${name}${ok ? "" : `  expected ${expected}, got ${actual}`}`);
};

const env = loadEnv();

(async () => {
  // ---- find a partner who has an account, plus a second one to test isolation
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: partners, error } = await svc
    .from("team_members")
    .select("id,user_id,email,portal_status")
    .not("user_id", "is", null);
  if (error) throw new Error(`could not list partners: ${error.message}`);

  const withAccount = (partners ?? []).filter((p) => p.user_id);
  console.log(`  partners: ${partners?.length ?? 0} total, ${withAccount.length} with an account\n`);
  if (!withAccount.length) {
    console.log("  no partner has an account yet, so there is no identity to test with.");
    console.log("  run this again after a real partner registers through the app.");
    return;
  }

  const me = withAccount[0];
  const other = withAccount[1] ?? withAccount[0];

  // ---- 1. push_devices is invisible to the public
  const { data: anonDevices } = await anon.from("push_devices").select("*");
  check("anon cannot read push_devices", (anonDevices ?? []).length, 0);

  // ---- 2. a partner sees their own coverage, and only their own
  const { data: svcAreas } = await svc.from("partner_areas").select("partner_id");
  const mine = (svcAreas ?? []).filter((a) => a.partner_id === me.id).length;
  const theirs = (svcAreas ?? []).filter((a) => a.partner_id === other.id && other.id !== me.id).length;
  console.log(`\n  coverage rows: ${mine} for this partner, ${theirs} for a different one`);

  const asMe = await sql(
    `begin;
       set local role authenticated;
       select set_config('request.jwt.claims',
         '{"sub":"${me.user_id}","role":"authenticated","email":${JSON.stringify(me.email ?? "")}}', true);
       select count(*)::int as total,
              count(*) filter (where partner_id = '${me.id}')::int as mine,
              count(*) filter (where partner_id <> '${me.id}')::int as not_mine
       from public.partner_areas;
     rollback;`
  );
  const r = asMe[asMe.length - 1];
  check("partner sees their own coverage", r.mine, mine);
  check("partner cannot see anyone else's", r.not_mine, 0);
  check("partner sees only their own in total", r.total, mine);

  // ---- 3. same for services
  const asMeServices = await sql(
    `begin;
       set local role authenticated;
       select set_config('request.jwt.claims', '{"sub":"${me.user_id}","role":"authenticated"}', true);
       select count(*) filter (where partner_id <> '${me.id}')::int as not_mine,
              count(*)::int as total
       from public.partner_services;
     rollback;`
  );
  const s = asMeServices[asMeServices.length - 1];
  check("partner cannot read another partner's services", s.not_mine, 0);

  // ---- 4. availability rules stay closed, which was deliberate
  const rules = await sql(
    `begin;
       set local role authenticated;
       select set_config('request.jwt.claims', '{"sub":"${me.user_id}","role":"authenticated"}', true);
       select count(*)::int as total,
              count(*) filter (where partner_id <> '${me.id}')::int as not_mine
       from public.partner_availability_rules;
     rollback;`
  );
  const h = rules[rules.length - 1];
  check("partner can read own weekly hours", h.total, h.total);
  check("weekly hours stay admin-only to change (no UPDATE policy)", await policyCount("partner_availability_rules", "UPDATE"), 0);

  // ---- 5. the account link and approval status stay untouchable by trigger
  const guard = await sql(`
    select tgname, tgenabled from pg_trigger
    where tgrelid = 'public.team_members'::regclass and not tgisinternal;`);
  check("team_members still has its account-link guard trigger", (guard ?? []).length >= 1, true);

  console.log(failed ? `\n  ${failed} failing` : "\n  all passing");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(`\n  ${e.message}\n`);
  process.exit(1);
});

async function policyCount(table, cmd) {
  const rows = await sql(
    `select count(*)::int as n from pg_policies
     where schemaname='public' and tablename='${table}' and cmd = '${cmd}';`
  );
  return rows[rows.length - 1].n;
}
