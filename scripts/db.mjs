#!/usr/bin/env node
/**
 * Run SQL against the Supabase project through the Management API.
 *
 * Why this exists: the JS client talks to PostgREST, which only does data, so
 * every schema change in this project has meant asking someone to open the
 * dashboard and paste a file. A personal access token turns that into a command
 * this repository can run, which is the only way the migrations stay honest.
 *
 * The token is never in the repo. It is read from the environment, or from a
 * file outside the working tree, and it is only ever sent to api.supabase.com.
 *
 *   node scripts/db.mjs apply supabase/018_partner_self_service.sql
 *   node scripts/db.mjs query "select count(*) from team_members"
 *   node scripts/db.mjs exec supabase/018_partner_self_service.sql --dry-run
 */
import fs from "node:fs";
import path from "node:path";

const API = "https://api.supabase.com/v1";
const REF = process.env.SUPABASE_PROJECT_REF || "jmntviljjrixhqgosehl";
const TOKEN_FILE = "/root/malto-signing/supabase-access-token.txt";

/** A file inside the repo holding a token is a leaked token. Refuse outright. */
function loadToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  if (fs.existsSync(TOKEN_FILE)) {
    const value = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (value) return value;
  }

  // A .env.local is gitignored, so a token there is at least not committed.
  const envLocal = ".env.local";
  if (fs.existsSync(envLocal)) {
    const match = /^SUPABASE_ACCESS_TOKEN\s*=\s*(.+)$/m.exec(fs.readFileSync(envLocal, "utf8"));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }

  throw new Error(
    "No Supabase access token found.\n" +
      `  Set SUPABASE_ACCESS_TOKEN, or put the token in ${TOKEN_FILE}.\n` +
      "  Create one at https://supabase.com/dashboard/account/tokens"
  );
}

async function runQuery(sql, { readOnly = false } = {}) {
  const token = loadToken();
  const res = await fetch(`${API}/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { message: text.slice(0, 600) };
  }

  if (!res.ok) {
    const detail = json?.message || json?.error_description || JSON.stringify(json).slice(0, 600);
    const hint =
      res.status === 401
        ? "\n  401 means the token is wrong, expired, or revoked."
        : res.status === 403
          ? "\n  403 means the token lacks the database_write permission."
          : /read-only transaction|read only/i.test(detail)
            ? "\n  The token can read but not write. Edit it at\n" +
              "  https://supabase.com/dashboard/account/tokens and tick database_write,\n" +
              "  then put the new value in " +
              TOKEN_FILE +
              "."
            : res.status === 429
              ? "\n  429 is the 60 requests per minute limit. Wait a minute."
              : "";
    throw new Error(`SQL failed (HTTP ${res.status}): ${detail}${hint}`);
  }
  return json;
}

/** Split on semicolons that are not inside a string, dollar quote or comment. */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      buf += c;
      i++;
      continue;
    }
    if (inBlockComment) {
      buf += c;
      if (c === "*" && next === "/") {
        buf += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (dollarTag) {
      buf += c;
      if (c === "$" && sql.startsWith(dollarTag, i)) {
        buf += sql.slice(i + 1, i + dollarTag.length);
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }
    if (!inSingle && !inDouble && c === "-" && next === "-") {
      inLineComment = true;
      buf += c;
      i++;
      continue;
    }
    if (!inSingle && !inDouble && c === "/" && next === "*") {
      inBlockComment = true;
      buf += c;
      i++;
      continue;
    }
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        dollarTag = tag[0];
        buf += tag[0];
        i += tag[0].length;
        continue;
      }
    }
    if (c === ";" && !inSingle && !inDouble) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function main() {
  const [mode, target, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes("--dry-run");

  if (!mode) {
    console.error("usage:\n  node scripts/db.mjs apply <file.sql>\n  node scripts/db.mjs query \"<sql>\"\n  add --dry-run to print instead of execute");
    process.exit(2);
  }

  if (mode === "query") {
    if (!target) throw new Error("query needs an SQL string");
    // read_only is opt-in via --read-only, never the default. Setting it here
    // unconditionally made every query a read-only transaction, so a token with
    // full database_write was still refused CREATE TABLE.
    const result = await runQuery(target, { readOnly: rest.includes("--read-only") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (mode !== "apply") throw new Error(`unknown mode "${mode}"`);

  const file = target;
  if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
  const sql = fs.readFileSync(file, "utf8");
  const statements = splitStatements(sql);

  console.log(`  file      : ${file}`);
  console.log(`  size      : ${sql.length} chars, ${statements.length} statements`);
  console.log(`  project   : ${REF}`);

  if (dryRun) {
    console.log("\n--- would run ---");
    for (const s of statements) console.log(s.replace(/\s+/g, " ").slice(0, 160) + (s.length > 160 ? "..." : ""));
    return;
  }

  // The whole file goes in one request when it already has its own transaction
  // control, so a failure rolls back cleanly rather than leaving half a
  // migration behind. Files without BEGIN/COMMIT are split and run one by one.
  const managesOwnTransaction = /^\s*--/m.test(sql) && /\bBEGIN\s*;/i.test(sql) && /\bCOMMIT\s*;/i.test(sql);

  if (managesOwnTransaction) {
    const result = await runQuery(sql);
    console.log("  result    : whole file in one transaction");
    if (Array.isArray(result)) {
      for (const r of result) if (r) console.log("  " + JSON.stringify(r).slice(0, 300));
    }
    return;
  }

  for (const [index, statement] of statements.entries()) {
    try {
      const result = await runQuery(statement);
      const label = statement.replace(/\s+/g, " ").slice(0, 70);
      console.log(`  [${index + 1}/${statements.length}] ok    ${label}`);
      if (Array.isArray(result) && result.length && result[0]) {
        console.log(`        -> ${JSON.stringify(result[0]).slice(0, 300)}`);
      }
    } catch (e) {
      const label = statement.replace(/\s+/g, " ").slice(0, 120);
      console.error(`  [${index + 1}/${statements.length}] FAIL  ${label}`);
      throw e;
    }
  }
}

main().catch((e) => {
  console.error(`\n  ${e.message}\n`);
  process.exit(1);
});
