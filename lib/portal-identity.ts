/**
 * Who is this person, as far as the portal is concerned?
 *
 * Six places used to answer this independently: the jobs screen, the profile
 * screen and the hours screen each checked for a missing session and for a
 * missing profile, and the middleware separately redirected signed-in users
 * away from the login page. That arrangement produced a redirect loop, because
 * the middleware sent you to /portal and the portal sent you back to
 * /portal/login, and the loop ran at full speed for anyone signed in with no
 * team_members row. An admin, on every visit.
 *
 * One function, one set of answers. The rule the loop broke is now structural:
 * only signed-out and staff are allowed to redirect, and staff is a terminal
 * state rather than a hop.
 */

export type Identity =
  /** No usable session. */
  | "signed-out"
  /** Signed in, but staff rather than a partner. */
  | "staff"
  /** Signed in, not staff, and no partner profile is linked to the account. */
  | "no-profile"
  /** Signed in with a profile that has not been approved yet. */
  | "pending"
  /** Signed in, approved, has a profile. */
  | "ok";

export type IdentityResult = {
  identity: Identity;
  userId: string | null;
  name: string | null;
  email: string | null;
  portalStatus: string | null;
};

/**
 * Split "no network" from "not allowed in".
 *
 * These look identical to a caller that only checks whether the query threw,
 * and conflating them is how a banned partner ends up being told they have no
 * signal while standing in a client's hallway with full bars. A failed fetch is
 * a network problem and the cache is the right answer; anything else means the
 * session is gone or the account is closed, and the only honest response is to
 * stop pretending and send them to the sign-in page, where the reason is
 * explained.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (!error) return false;
  const e = error as { message?: string; name?: string; status?: number; code?: string };
  if (typeof e.status === "number") return e.status >= 500;
  if (typeof e.code === "string" && /ECONN|ENOTFOUND|ETIMEDOUT|ENETUNREACH/i.test(e.code)) return true;
  const message = String(e.message ?? "");
  return (
    /failed to fetch|networkerror|network request failed|load failed/i.test(message) ||
    e.name === "TypeError"
  );
}

const APPROVED = "approved";
const REJECTED = "rejected";

/**
 * Work out the identity from a session, the caller's own row, and their staff
 * flag. Pure, so it can be tested without a browser.
 */
export function classify(input: {
  hasSession: boolean;
  member: { portal_status?: string | null; name?: string | null; email?: string | null } | null;
  isAdmin: boolean;
}): IdentityResult {
  const email = input.member?.email ?? null;

  if (!input.hasSession) {
    return { identity: "signed-out", userId: null, name: null, email: null, portalStatus: null };
  }

  // Staff are refused here as well as at the login page. The login check is
  // friendlier, but this is the one that has to be right: a staff account that
  // reaches the portal should see an explanation, not a loop.
  if (input.isAdmin) {
    return { identity: "staff", userId: null, name: input.member?.name ?? null, email, portalStatus: null };
  }

  if (!input.member) {
    return { identity: "no-profile", userId: null, name: null, email, portalStatus: null };
  }

  const status = input.member.portal_status ?? null;
  const identity: Identity = status === APPROVED ? "ok" : "pending";
  return {
    identity,
    userId: null,
    name: input.member.name ?? null,
    email,
    portalStatus: status,
  };
}

export function isRejected(status: string | null | undefined): boolean {
  return status === REJECTED;
}

/**
 * Wording for each terminal state. Kept next to the classifier so a new state
 * cannot be added without someone deciding what it says.
 */
export const IDENTITY_COPY: Record<"staff" | "no-profile" | "pending", { title: string; body: string }> = {
  staff: {
    title: "This is the partner app",
    body: "You are signed in with a staff account. Staff sign in on the admin site instead.",
  },
  "no-profile": {
    title: "No partner profile",
    body: "This account is not linked to a partner profile. If you registered as a cleaner, contact MALTO and we will sort it out.",
  },
  pending: {
    title: "Waiting for approval",
    body: "MALTO still needs to approve your account before any job shows up here. You do not need to do anything else.",
  },
};
