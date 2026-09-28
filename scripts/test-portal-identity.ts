/**
 * Checks for the identity classifier.
 *
 * The redirect loop this file exists to prevent shipped to production and
 * nothing caught it, because the bug was not in either redirect on its own: the
 * portal sent a signed-in user to the login page, the middleware sent them
 * back, and each looked reasonable in isolation. The rule that stops it is
 * that terminal states never redirect, and that rule is only worth anything if
 * it is checked.
 *
 *   node --experimental-strip-types scripts/test-portal-identity.ts
 */
import { classify, isNetworkFailure, isRejected, IDENTITY_COPY } from "../lib/portal-identity.ts";

let failed = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.log(`  FAIL  ${name}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${name}`);
  }
};

// A row that exists. Passing null gives a row whose portal_status is null,
// which is a different thing from having no row at all, so the two are built
// separately on purpose.
const member = (status: string) => ({ portal_status: status, name: "Rosa", email: "r@x.com" });
const rowWithoutStatus = () => ({ portal_status: null, name: "Rosa", email: "r@x.com" } as any);

// --- the loop case, which is the whole reason for this file
eq(
  "staff with no partner row is a terminal state, not a redirect",
  classify({ hasSession: true, member: null, isAdmin: true }).identity,
  "staff"
);
eq(
  "signed in with no partner row and not staff is a terminal state",
  classify({ hasSession: true, member: null, isAdmin: false }).identity,
  "no-profile"
);
eq(
  "staff is refused even when they do have a partner row",
  classify({ hasSession: true, member: member("approved"), isAdmin: true }).identity,
  "staff"
);
eq(
  "no session is the only state that redirects",
  classify({ hasSession: false, member: member("approved"), isAdmin: false }).identity,
  "signed-out"
);

// --- the normal paths
eq("approved partner", classify({ hasSession: true, member: member("approved"), isAdmin: false }).identity, "ok");
eq("pending partner stays in", classify({ hasSession: true, member: member("pending"), isAdmin: false }).identity, "pending");
eq("invited partner is not approved yet", classify({ hasSession: true, member: member("invited"), isAdmin: false }).identity, "pending");
eq("rejected partner is not ok", classify({ hasSession: true, member: member("rejected"), isAdmin: false }).identity, "pending");
eq("a row with no status is not approved", classify({ hasSession: true, member: rowWithoutStatus(), isAdmin: false }).identity, "pending");
eq("no row and no session is signed out", classify({ hasSession: false, member: null, isAdmin: false }).identity, "signed-out");

// --- the email should survive so the screen can address the person
eq("name is carried through", classify({ hasSession: true, member: member("approved"), isAdmin: false }).name, "Rosa");

// --- every terminal state must have words written for it
for (const key of ["staff", "no-profile", "pending"] as const) {
  const copy = IDENTITY_COPY[key];
  const ok = !!copy && copy.title.length > 0 && copy.body.length > 20;
  eq(`${key} has wording`, ok, true);
}
eq("no wordless states exist", Object.keys(IDENTITY_COPY).length, 3);

// --- banned is not offline
// The failure this splits: getUser() throws for both a dropped connection and
// a revoked session, and treating them the same tells someone they have no
// signal while they are standing in a client's house with full bars.
eq("a failed fetch is a network failure", isNetworkFailure(new TypeError("Failed to fetch")), true);
eq("networkerror is a network failure", isNetworkFailure(new TypeError("NetworkError when attempting to fetch")), true);
eq("a 500 is a network failure", isNetworkFailure({ status: 500 }), true);
eq("a 403 from RLS is not a network failure", isNetworkFailure({ status: 403, message: "permission denied" }), false);
eq("an invalid jwt is not a network failure", isNetworkFailure({ message: "Invalid Refresh Token: Refresh Token Not Found" }), false);
eq("a user is banned", isNetworkFailure({ message: "User is banned" }), false);
eq("row level security violation is not offline", isNetworkFailure({ message: "new row violates row-level security policy" }), false);
eq("null is not a network failure", isNetworkFailure(null), false);

// --- rejection
eq("rejected status detected", isRejected("rejected"), true);
eq("pending is not rejected", isRejected("pending"), false);
eq("null is not rejected", isRejected(null), false);

console.log(failed ? `\n  ${failed} failing` : "\n  all passing");
process.exit(failed ? 1 : 0);
