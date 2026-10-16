/**
 * @file **The AmberX Vid door** — one identity system, and it is the accounts
 * module's (P1 of `axf-amberxvid-social`, 2026-08-14).
 *
 * This file replaces `./session`, which is deleted. There is no `axv_session`
 * any more, no module password store and no second login: a person signs in
 * once, to the studio, and AmberX Vid asks the two questions it is entitled to
 * ask about that one session.
 *
 * ## The two questions, and why they are separate
 *
 *   1. **Who is this?** → `axsUser(req)` from
 *      `@axs/modules/accounts/lib/session`. A server-side import of another
 *      module's lib is the seam this codebase already uses — `kvUser()` in
 *      `src/server/axfKv.ts` reaches for `axsUserFromCookieHeader` exactly the
 *      same way. Nothing is re-derived here: the cookie name, the key
 *      derivation and the expiry all stay in the file that owns them.
 *
 *   2. **May they open amberxvid?** → the permission matrix, asked through
 *      `effectivePermissions()`. **Never a copy of its answer.** The matrix
 *      caches nothing and re-reads both stores per call, which is the whole
 *      reason a revocation binds on the member's very next request instead of
 *      at their next login. A membership list mirrored into this module would
 *      throw that property away and would drift the first time an
 *      administrator used the admin suite.
 *
 * Answering them separately is what lets a route say **401** (nobody is signed
 * in — show the login card) and **403** (signed in, but not a member — show
 * the join card) instead of collapsing both into "unauthorized", which is what
 * the old single-cookie check could only ever do.
 *
 * ## Membership is default-allow, because the matrix is
 *
 * `permissions.json` is sparse and an ABSENT key means allowed
 * (`accounts/lib/permissions.ts`), so a fresh studio account is an AmberX Vid
 * member without anybody deciding anything. That is the framework's contract
 * and this module consumes it rather than inverting it for itself — an
 * inversion would be precisely the private copy of the answer forbidden above.
 * What an administrator revokes, this refuses, immediately.
 *
 * Server-only (`next/server`, and the accounts module's node stores).
 */

import { NextResponse, type NextRequest } from "next/server";
import { axsUser } from "@axs/modules/accounts/lib/session";
import { effectivePermissions } from "@axs/modules/accounts/lib/permissions";

/** The id this module is known by in the permission matrix and the registry. */
export const AMBERXVID_MODULE_ID = "amberxvid";

/**
 * Is self-serve membership open? Server-read, `AMBERXVID_OPEN_MEMBERSHIP`,
 * default ON — a studio that installs the suite means people to use it.
 *
 * Deliberately an env var rather than a module setting: this module's settings
 * adapter is `useModuleSettings` (a CLIENT hook over the core store), and no
 * route can read it. A setting a route cannot see is not a gate, and half a
 * gate is worse than none. When P17 builds the moderation wing this becomes a
 * row it owns, read the same way the rest of that wing's policy is.
 *
 * Read per call, never latched at import, so a deployment and a test both take
 * effect without ordering games.
 */
export function openMembership(): boolean {
  const raw = process.env.AMBERXVID_OPEN_MEMBERSHIP?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return raw !== "0" && raw !== "off" && raw !== "false" && raw !== "no";
}

/**
 * Does this account hold the amberxvid grant, right now? One matrix read; the
 * verdict is not stored anywhere.
 */
export async function isMember(username: string): Promise<boolean> {
  const permissions = await effectivePermissions(username);
  return !permissions.deniedModules.includes(AMBERXVID_MODULE_ID);
}

/**
 * THE identity function for every `/api/amberxvid/*` route — the signed-in
 * member's username, or null.
 *
 * Null collapses "signed out" and "not a member" on purpose, for the call
 * sites that only ever wanted a name. A route that shows the user a different
 * screen for the two cases wants {@link requireMember} instead.
 */
export async function memberUser(req: NextRequest): Promise<string | null> {
  const user = axsUser(req);
  if (!user) return null;
  return (await isMember(user)) ? user : null;
}

export type MemberGate = { user: string } | { deny: NextResponse };

/**
 * The gate with its refusal already shaped: `{user}` or the response to
 * return. 401 means sign in; 403 means this account is not an AmberX Vid
 * member and names that fact, because "forbidden" with no reason is how a
 * revoked member ends up filing a bug about a broken page.
 */
export async function requireMember(req: NextRequest): Promise<MemberGate> {
  const user = axsUser(req);
  if (!user) {
    return { deny: NextResponse.json({ ok: false, error: "sign in first" }, { status: 401 }) };
  }
  if (!(await isMember(user))) {
    return {
      deny: NextResponse.json(
        { ok: false, error: "this account is not an AmberX Vid member", notMember: true },
        { status: 403 },
      ),
    };
  }
  return { user };
}

/**
 * The acting AmberX Vid administrator, or the refusal. Administration of the
 * suite is administration of the studio: the role is the ACCOUNTS role, and it
 * is re-read from the account store per request by `effectivePermissions`, so
 * a demotion binds immediately and a 24 h token cannot outlive it.
 */
export async function requireMemberAdmin(req: NextRequest): Promise<MemberGate> {
  const gate = await requireMember(req);
  if ("deny" in gate) return gate;
  const permissions = await effectivePermissions(gate.user);
  if (!permissions.administrator) {
    return {
      deny: NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 }),
    };
  }
  return { user: permissions.username };
}
