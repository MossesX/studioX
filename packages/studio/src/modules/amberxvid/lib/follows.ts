/**
 * @file THE FOLLOW GRAPH (P12) — who subscribes to whose broadcasts.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE BUDDY GRAPH
 * ---------------------------------------------------------------------------
 * The module already has a social graph — the accounts one, in
 * `@axs/modules/accounts/lib/relations`: buddies (mutual, requested, accepted),
 * pending in both directions, blocks. Adding "follow" to it was the first thing
 * considered and the wrong thing, because the two graphs answer different
 * questions and have opposite consent models:
 *
 *   - a BUDDY relation is MUTUAL and CONSENTED. It is what gates DMs and
 *     `buddies`-visibility material, so it must be, and both sides agreed to it;
 *   - a FOLLOW is ONE-DIRECTIONAL and needs no consent, because it grants
 *     NOTHING. It orders somebody's room to the top of your list and rings you
 *     when they go live. That is the whole of its power.
 *
 * Folding a consent-free edge into the graph that gates private material is how
 * a visibility bug gets built. Kept apart, the worst a follow can do is put a
 * public room on your list twice.
 *
 * ---------------------------------------------------------------------------
 * BLOCKS STILL WIN, IN BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * `canInteract` is the module's ONE guard on who may touch whom
 * (`./social.ts`'s rule 1), and it is asked here too — a member who has been
 * blocked cannot follow, and {@link followersOf} filters the guard again on
 * READ rather than trusting the stored list. Trusting the list would mean a
 * block landing after a follow leaves a live edge behind: the blocker's rooms
 * would keep ringing somebody they blocked, which is precisely the thing a
 * block is for. Filtering on read makes the block effective at the instant it
 * is set, without a sweep and without a hook in the relations store.
 *
 * A refusal is still SILENT in the relations sense: a follow refused by a block
 * answers exactly what a follow of a member who does not exist answers.
 *
 * ---------------------------------------------------------------------------
 * TWO DOCUMENTS PER EDGE, AND WHY THAT IS SAFE
 * ---------------------------------------------------------------------------
 * `follows/<user>.json` holds BOTH halves for that member: `following` and
 * `followers`. An edge therefore touches two documents, each under its own
 * lock — which is a denormalisation, and the honest question is what happens if
 * the second write fails.
 *
 * The answer is that nothing is lost and nothing needs repairing, because both
 * writes are SET OPERATIONS and therefore idempotent: re-running the same
 * follow (or its unfollow) converges. {@link followsFor} reconciles what it
 * reads — a `followers` entry whose owner does not list you back is dropped
 * from the count, and the follower's own document is the authority for whether
 * the edge exists. So a half-write is invisible rather than wrong, and the next
 * touch of that pair heals it.
 *
 * The alternative — one global edge file — was rejected for the reason the
 * invites store is keyed by inviter: every operation here is per-member (list
 * mine, who follows me, fan an alert out to my followers), and a global file
 * would make each of them a read of everybody's.
 *
 * Server-only.
 */

import { canInteract } from "@axs/modules/accounts/lib/relations";
import { findAccount } from "./accounts";
import { readJson, withStoreLock, writeJsonAtomic } from "./fsCore";
import { followsFile } from "./paths";
import type { FollowGraph } from "./types";

const norm = (u: string): string => u.trim().toLowerCase();

/** One member may follow this many — a bound on the fan-out an alert can
 *  cause, not a product feature. A suite this size never reaches it. */
export const FOLLOW_MAX = 500;

interface FollowDoc {
  version: 1;
  user: string;
  following: string[];
  followers: string[];
}

export type FollowResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

const fail = (error: string, status: number): { ok: false; error: string; status: number } => ({
  ok: false,
  error,
  status,
});

/* ---------------------------------- the store ----------------------------------- */

const lockName = (user: string): string => `follows-${norm(user)}`;

const names = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const key = norm(v);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
};

/** Read one member's document, repaired. A junk or missing file is an empty
 *  graph — degrade, never crash (house posture). */
function readDoc(user: string): FollowDoc {
  const key = norm(user);
  const raw = readJson<Partial<FollowDoc> | null>(followsFile(key), null);
  return {
    version: 1,
    user: key,
    following: names(raw?.following).filter((u) => u !== key),
    followers: names(raw?.followers).filter((u) => u !== key),
  };
}

/** Read-modify-write one member's document under its own lock. */
function mutateDoc(user: string, fn: (doc: FollowDoc) => void): FollowDoc {
  return withStoreLock(lockName(user), () => {
    const doc = readDoc(user);
    fn(doc);
    writeJsonAtomic(followsFile(doc.user), doc);
    return doc;
  });
}

/* ----------------------------------- reading ------------------------------------ */

/**
 * One member's graph as the wire describes it, with both halves filtered
 * through the relations guard (see the header) and `followers` reconciled
 * against each follower's OWN document, which is the authority for the edge.
 */
export function followsFor(user: string): FollowGraph {
  const key = norm(user);
  if (!key) return { following: [], followers: [] };
  const doc = readDoc(key);
  return {
    following: doc.following.filter((u) => canInteract(key, u).ok),
    followers: doc.followers.filter(
      (u) => canInteract(u, key).ok && readDoc(u).following.includes(key),
    ),
  };
}

/** Does `follower` follow `target`? Read from the FOLLOWER's document — the
 *  side that owns the edge. */
export function isFollowing(follower: string, target: string): boolean {
  const a = norm(follower);
  const b = norm(target);
  if (!a || !b || a === b) return false;
  return canInteract(a, b).ok && readDoc(a).following.includes(b);
}

/**
 * Everybody who follows `user` and may still be reached by them — the alert
 * audience. Guard-filtered and reconciled, exactly like {@link followsFor},
 * because this is the list that actually rings phones.
 */
export function followersOf(user: string): string[] {
  return followsFor(user).followers;
}

/** How many people follow each of these members — one number per input, in
 *  order. What a hub or a profile header renders beside a name. */
export function followerCounts(users: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of users.slice(0, 200)) {
    const key = norm(u);
    if (key && !(key in out)) out[key] = followsFor(key).followers.length;
  }
  return out;
}

/* ----------------------------------- writing ------------------------------------ */

/**
 * Follow or unfollow, in one verb because the UI is one toggle and a toggle
 * split across two verbs is a toggle that can be double-applied.
 *
 * The guards, in the order they bite:
 *   - you cannot follow yourself (a self-edge would put your own room at the
 *     top of your own list and ring you for your own broadcast);
 *   - the target must be an entered member — `findAccount` plus the entry-flow
 *     condition every other surface uses, so a follow cannot name an account
 *     that has never finished signing up;
 *   - `canInteract`, and a block is rendered AS "no such member" — the silence
 *     rule (`./social.ts`, rule 1). An UNfollow is deliberately exempt: letting
 *     somebody undo an edge they already have costs nothing and refusing it
 *     would strand a follow the blocked member can neither see nor remove;
 *   - the fan-out bound.
 */
export async function setFollow(
  follower: string,
  target: string,
  on: boolean,
): Promise<FollowResult<FollowGraph>> {
  const a = norm(follower);
  const b = norm(target);
  if (!a) return fail("sign in first", 401);
  if (!b) return fail("no such member", 404);
  if (a === b) return fail("you cannot follow yourself", 400);

  const account = await findAccount(b);
  if (!account || account.disabled === true || account.screenname === null) {
    return fail("no such member", 404);
  }
  if (on && !canInteract(a, b).ok) return fail("no such member", 404);

  if (on && readDoc(a).following.length >= FOLLOW_MAX && !readDoc(a).following.includes(b)) {
    return fail(`you can follow at most ${FOLLOW_MAX} members`, 409);
  }

  // The follower's document first: it is the authority for the edge, so a
  // failure of the second write leaves the edge correct-but-uncounted rather
  // than counted-but-absent.
  mutateDoc(a, (doc) => {
    doc.following = on
      ? doc.following.includes(b)
        ? doc.following
        : [...doc.following, b]
      : doc.following.filter((u) => u !== b);
  });
  mutateDoc(b, (doc) => {
    doc.followers = on
      ? doc.followers.includes(a)
        ? doc.followers
        : [...doc.followers, a]
      : doc.followers.filter((u) => u !== a);
  });

  return { ok: true, value: followsFor(a) };
}

/**
 * Drop every edge between two members, both directions — the hook a block
 * SHOULD call, and which nothing calls yet.
 *
 * It exists because the read-side filter (see the header) makes a block
 * effective immediately but leaves the dead edges on disk. That is harmless and
 * deliberately not swept on a timer; this is the deterministic way to clean a
 * pair when there is a caller for it. Exported rather than private so the
 * relations wiring can use it without this file growing a dependency on the
 * relations store's internals.
 */
export function severFollows(a: string, b: string): void {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y || x === y) return;
  mutateDoc(x, (doc) => {
    doc.following = doc.following.filter((u) => u !== y);
    doc.followers = doc.followers.filter((u) => u !== y);
  });
  mutateDoc(y, (doc) => {
    doc.following = doc.following.filter((u) => u !== x);
    doc.followers = doc.followers.filter((u) => u !== x);
  });
}
