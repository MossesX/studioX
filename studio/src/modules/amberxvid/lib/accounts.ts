/**
 * @file **The AmberX Vid roster** — a READ adapter over the studio accounts
 * store and the permission matrix. It is not a store any more.
 *
 * ## What this file used to be, and why it stopped
 *
 * Until P1 of `axf-amberxvid-social` (2026-08-14) this was a second, parallel
 * account system: its own `accounts.json`, its own scrypt hashes, its own
 * `verifyLogin` / `addUser` / `resetPassword` / `removeUser`, and its own
 * session cookie on top. Two user systems in one product means two places a
 * person exists, two places an administrator has to revoke them, and two
 * answers to "who is this" that can disagree — and they did: `GizmoX` and
 * `Brett` existed in both stores with different password hashes.
 *
 * The owner's directive was one identity system, and the accounts module is
 * it. Every credential operation below was DELETED rather than re-pointed —
 * they now live at `/api/accounts/session` (sign in, change password, choose a
 * screenname) and `/api/accounts/users` (add, disable, reset), which is where
 * the admin suite already administers them. Deleting them is the point: a
 * re-pointed wrapper is a second door people keep walking through.
 *
 * ## What is left, and what it means
 *
 * Exactly the reads the suite's own surfaces need — the roster, one member,
 * and the two validators — projected from `Account` into `AmberXVidAccount`.
 * Five callers were unchanged by the swap (`./admin`, `./albums`,
 * `./messages`, `./presence`, `./profiles`, `./ratings`), because the shape
 * they consume did not move; only what stands behind it did.
 *
 * **"Member" means "holds the `amberxvid` grant", asked of the matrix.** Not a
 * list kept here — see `./membership` for why that distinction is the whole
 * phase. `listAccounts()` therefore returns studio accounts FILTERED by a live
 * matrix read, so an administrator revoking someone removes them from every
 * roster in the suite on the next render, with nothing to invalidate.
 *
 * Server-only (the accounts stores are node-only).
 */

import {
  findAccount as findStudioAccount,
  isValidScreenname as isValidStudioScreenname,
  isValidUsername as isValidStudioUsername,
  listAccounts as listStudioAccounts,
} from "@axs/modules/accounts/lib/accounts";
import type { Account } from "@axs/modules/accounts/lib/types";
import { isMember } from "./membership";
import type { AccountMe, AccountPublic, AmberXVidAccount } from "./types";

/* --------------------------------- projection -------------------------------- */

/**
 * A studio account as this module sees it. The credential is dropped here
 * rather than at the response boundary: a hash that never enters the module
 * cannot leak from it, and `AmberXVidAccount` no longer has a field to put it
 * in (`./types`).
 */
function project(a: Account & { forcePasswordReset?: boolean }): AmberXVidAccount {
  return {
    username: a.username,
    role: a.role,
    mustChangePassword: a.mustChangePassword,
    screenname: a.screenname,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    createdBy: a.createdBy,
    ...(a.disabled === true ? { disabled: true } : {}),
    ...(a.lastLoginAt ? { lastLoginAt: a.lastLoginAt } : {}),
    ...(a.forcePasswordReset === true ? { forcePasswordReset: true } : {}),
  };
}

/* ------------------------------------ reads ----------------------------------- */

/**
 * Every AmberX Vid member — studio accounts that hold the grant.
 *
 * One matrix read per account, uncached by design. The store is a
 * single-machine roster of tens of people, and the alternative (a cached
 * membership set) is the copy of the matrix's answer this phase exists to
 * abolish. If it ever becomes a cost, the fix is a batch read INSIDE the
 * matrix, not a mirror out here.
 */
export async function listAccounts(): Promise<AmberXVidAccount[]> {
  const studio = await listStudioAccounts();
  const verdicts = await Promise.all(studio.map((a) => isMember(a.username)));
  return studio.filter((_, i) => verdicts[i]).map(project);
}

/**
 * One member by username, or null — **null also when the account exists but is
 * not a member.** Every caller of this treats null as "not an AmberX Vid
 * person", which is exactly right: a studio account with the grant revoked
 * must not appear in a buddy list or be messageable, and answering with the
 * account would make each of the six callers re-check membership themselves.
 */
export async function findAccount(username: string): Promise<AmberXVidAccount | null> {
  const account = await findStudioAccount(username);
  if (!account) return null;
  return (await isMember(account.username)) ? project(account) : null;
}

/** The studio's own rules — re-exported so callers keep one import. */
export const isValidUsername = isValidStudioUsername;
export const isValidScreenname = isValidStudioScreenname;

/* --------------------------------- projections -------------------------------- */

/** What any signed-in member may see of any member. */
export function toPublic(a: AmberXVidAccount): AccountPublic {
  return {
    username: a.username,
    role: a.role,
    screenname: a.screenname,
    createdAt: a.createdAt,
    disabled: a.disabled === true,
  };
}

/** The caller's own record, with the flags the entry flow reads. */
export function toMe(a: AmberXVidAccount): AccountMe {
  return {
    ...toPublic(a),
    mustChangePassword: a.mustChangePassword,
    needsScreenname: !a.mustChangePassword && !a.screenname,
    lastLoginAt: a.lastLoginAt ?? null,
  };
}
