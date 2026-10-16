/**
 * @file **Invitations** — single-use links that create an accounts user, grant
 * the module through the matrix, honour a pre-approved buddy request, and put
 * the newcomer down inside the exact room they were invited to (P7 of
 * `axf-amberxvid-social`, 2026-08-15).
 *
 * ## One identity, so an invite creates an ACCOUNT and never a member record
 *
 * P1 abolished this module's second account system. An invitation therefore
 * cannot mint an "AmberX Vid member" — there is no such row any more. What it
 * does is exactly what a person clicking Join does, in one motion and without
 * the person having to know the studio exists:
 *
 *   1. an accounts user, born through `createAccountByInvitation` — the
 *      accounts module's own sponsored door, so identity stays in the file
 *      that owns identity (see its header for why it is not `addUser`);
 *   2. the `amberxvid` grant through **the matrix**, `requestModuleGrant`,
 *      recorded in the accounts audit as invite-sourced. Never a list here.
 *      An administrator who has explicitly revoked amberxvid for that name
 *      still wins — the matrix refuses and the landing says so;
 *   3. the buddy edge, if the inviter pre-approved one, through the ONE guard;
 *   4. arrival, as DATA the module acts on (`./inviteContract`).
 *
 * ## The token
 *
 *   payload = "<exp>:<id>:<inviter>"        (inviter LAST, so it may carry ':')
 *   token   = payload + "." + base64url(HMAC-SHA256(inviteKey, payload))
 *
 * That is `media-server/tokens.ts`'s idiom verbatim — expiry first, subject
 * last, signature after the LAST dot, verified **signature → expiry → claims**
 * so a forged token learns nothing from which check refused it. The key is
 * DERIVED from the module secret under a fixed label
 * (`amberxvid/invite/v1`), the way `accounts/lib/session.ts` derives its own:
 * an invite signature is valid in no other token family, in either direction,
 * whatever the payload says.
 *
 * **The HMAC is not what makes an invite single-use.** A signature is valid
 * until it expires, however many times it is presented. Single use is the
 * STORE's job: the record carries `redeemedAt`, and consumption happens inside
 * `withStoreLock` so two browsers racing the same link produce one account and
 * one refusal rather than two accounts.
 *
 * ## Blocks: two checks, because neither one can do the other's job
 *
 * - **At creation**, when the handle names a member. That is the earliest the
 *   question is answerable, and it stops the invitation being written at all.
 * - **At redemption**, always. A bare link has no handle to check — nobody
 *   knows who will open it — and a block can land in the days between.
 *
 * Both refuse in the wording the surface uses for a subject that is not there:
 * creation answers `no such member` (relations' own {@link COVER} wording,
 * which the inviter already gets from `sendMessage`), redemption answers
 * {@link INVITE_DEAD}, identical to expired, spent, revoked and forged. Rule 1
 * of `accounts/lib/relations.ts`: a probe that can tell "blocked" from "gone"
 * has defeated the silence.
 *
 * ## Delivery invents no infrastructure
 *
 * `internal` is an accounts DM (P5/P6's store, the one messenger). `email` and
 * `sms` are COMPOSED — a `mailto:`/`sms:` URI handed to the app the person
 * already sends mail with — and that compose path is the product, not a
 * fallback, unless `AMBERXVID_SMTP_URL` is configured, in which case
 * `./inviteMail` sends it server-side. Nothing here grows an SMTP dependency
 * to make a feature look finished.
 *
 * Server-only (`node:crypto`, the module store, the accounts stores).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  createAccountByInvitation,
  findAccount as findStudioAccount,
  isValidUsername,
  verifyLogin,
} from "@axs/modules/accounts/lib/accounts";
import { requestModuleGrant } from "@axs/modules/accounts/lib/permissions";
import { isOnline } from "@axs/modules/accounts/lib/presence";
import { acceptBuddy, canInteract, requestBuddy } from "@axs/modules/accounts/lib/relations";
import { getThreadById, inviteToThread, sendMessage } from "@axs/modules/accounts/lib/messages";

import { authSecret } from "./gizmox-bridge";
import { readJson, withStoreLock, writeJsonAtomic } from "./fsCore";
import { invitesFile } from "./paths";
import { assertCanSendInvites } from "./policy";
import { AMBERXVID_MODULE_ID, isMember } from "./membership";
import { listStreams } from "./streams";
import { sendInviteMail, smtpConfigured } from "./inviteMail";
import {
  INVITE_DEAD,
  INVITE_LIMITS,
  NO_TARGET,
  composeInvite,
  inviteUrl,
  mailtoUri,
  smsUri,
  targetPhrase,
  type InviteArrival,
  type InviteChannel,
  type InvitePublic,
  type InviteRow,
  type InviteState,
  type InviteTarget,
} from "./inviteContract";

/* ================================== results ================================== */

export type InviteFailure = { ok: false; error: string; status: number };

const fail = (status: number, error: string): InviteFailure => ({ ok: false, error, status });

/**
 * The refusal a handle that names an unreachable member gets — relations'
 * {@link COVER} wording, verbatim, so a blocked inviter reads exactly what an
 * inviter who typo'd a username reads.
 */
const NO_SUCH_MEMBER = fail(404, "no such member");

/** Every dead-invitation answer, byte-identical. See {@link INVITE_DEAD}. */
const DEAD = fail(404, INVITE_DEAD);

/* =================================== token =================================== */

const norm = (u: string): string => u.trim().toLowerCase();

/** The invite family's own key — derived, never the machine secret itself. */
function inviteKey(): Buffer {
  return createHmac("sha256", authSecret()).update("amberxvid/invite/v1").digest();
}

const sign = (payload: string): string =>
  createHmac("sha256", inviteKey()).update(payload).digest("base64url");

/**
 * Constant-time equality for strings of possibly different LENGTH — the
 * blinded-HMAC construction from `media-server/tokens.ts`, for the same reason
 * (`timingSafeEqual` throws on a length mismatch, and length-checking first
 * leaks the length).
 */
function constantTimeEqual(a: string, b: string): boolean {
  const key = randomBytes(32);
  return timingSafeEqual(
    createHmac("sha256", key).update(a).digest(),
    createHmac("sha256", key).update(b).digest(),
  );
}

interface TokenClaims {
  id: string;
  inviter: string;
  exp: number;
}

function mintToken(id: string, inviter: string, expS: number): string {
  const payload = `${expS}:${id}:${norm(inviter)}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify, in `MEDIA_TOKEN.verify` order: signature (constant time) → expiry →
 * claims. Null on every failure, without saying which — the caller answers
 * {@link INVITE_DEAD} either way.
 */
export function readToken(token: unknown, nowS?: number): TokenClaims | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
  const cut = token.lastIndexOf(".");
  if (cut <= 0 || cut === token.length - 1) return null;
  const payload = token.slice(0, cut);
  const signature = token.slice(cut + 1);

  if (!constantTimeEqual(signature, sign(payload))) return null;

  // Parsed only after the signature holds: this is now known to be our own
  // writing, so two splits with the remainder verbatim is safe.
  const first = payload.indexOf(":");
  const second = payload.indexOf(":", first + 1);
  if (first < 0 || second < 0) return null;
  const exp = Number(payload.slice(0, first));
  const id = payload.slice(first + 1, second);
  const inviter = payload.slice(second + 1);
  if (!Number.isInteger(exp)) return null;
  if (exp <= (nowS ?? Math.floor(Date.now() / 1000))) return null;
  if (!id || !inviter) return null;
  return { id, inviter, exp };
}

/* =================================== store =================================== */

/** One stored invitation. The token is NOT stored: it is re-mintable from the
 *  id, the inviter and the expiry, and a store of live credentials is a store
 *  worth stealing. */
interface StoredInvite {
  id: string;
  inviter: string;
  channel: InviteChannel;
  handle: string | null;
  target: InviteTarget;
  buddy: boolean;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
  revokedAt: string | null;
}

interface InvitesFile {
  version: 1;
  invites: StoredInvite[];
}

const EMPTY: InvitesFile = { version: 1, invites: [] };

/** Junk or absent reads as "this member has never invited anybody" — the house
 *  degrade-never-crash posture, and the safe direction: an unreadable file
 *  refuses redemptions rather than granting them. */
function readInvites(user: string): StoredInvite[] {
  const doc = readJson<InvitesFile>(invitesFile(user), EMPTY);
  if (doc?.version !== 1 || !Array.isArray(doc.invites)) return [];
  return doc.invites.filter((r): r is StoredInvite => typeof r?.id === "string" && !!r.id);
}

function writeInvites(user: string, invites: StoredInvite[]): void {
  // Keep the newest `historyMax`, but never drop an OPEN one to make room for
  // a spent one: a live link vanishing from the store would silently become
  // un-redeemable while its holder still has a valid signature.
  const sorted = [...invites].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = sorted.filter((r) => stateOf(r) === "open");
  const rest = sorted.filter((r) => stateOf(r) !== "open");
  const kept = [...open, ...rest.slice(0, Math.max(0, INVITE_LIMITS.historyMax - open.length))];
  kept.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  writeJsonAtomic(invitesFile(user), { version: 1, invites: kept } satisfies InvitesFile);
}

/** The lock name is per-inviter, so two members inviting at once never wait on
 *  each other — the file they are racing for is not the same file. */
const lockName = (user: string): string => `invites-${norm(user)}`;

function stateOf(rec: StoredInvite, now = Date.now()): InviteState {
  if (rec.redeemedAt) return "spent";
  if (rec.revokedAt) return "revoked";
  return Date.parse(rec.expiresAt) <= now ? "expired" : "open";
}

const rowOf = (rec: StoredInvite): InviteRow => ({
  id: rec.id,
  token: mintToken(rec.id, rec.inviter, Math.floor(Date.parse(rec.expiresAt) / 1000)),
  inviter: rec.inviter,
  channel: rec.channel,
  handle: rec.handle,
  target: rec.target,
  buddy: rec.buddy,
  note: rec.note,
  createdAt: rec.createdAt,
  expiresAt: rec.expiresAt,
  state: stateOf(rec),
  redeemedAt: rec.redeemedAt,
  redeemedBy: rec.redeemedBy,
  revokedAt: rec.revokedAt,
});

/* ================================= handles =================================== */

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s().-]{5,24}$/;

export type HandleKind = "username" | "email" | "phone";

/**
 * What KIND of handle is this? The distinction is load-bearing, not cosmetic:
 * a username handle is addressed at a member and therefore goes through the
 * social guard at creation, while an email or a phone number belongs to
 * somebody the studio has never heard of and cannot be checked against
 * anything (accounts have no email column, on purpose — see the accounts
 * store; inventing one here would be a second identity field).
 */
export function handleKind(handle: string): HandleKind {
  const v = handle.trim();
  if (EMAIL_RE.test(v)) return "email";
  if (PHONE_RE.test(v) && !isValidUsername(v)) return "phone";
  return "username";
}

/* ================================== targets ================================== */

/**
 * Resolve a requested target against the world, AS the inviter.
 *
 * A target nobody can reach is refused at creation rather than at redemption:
 * an invitation into a room the inviter is not in is a broken promise the
 * newcomer discovers after handing over a password, which is the worst
 * possible moment to discover it.
 */
async function resolveTarget(
  inviter: string,
  kind: string,
  id: string,
): Promise<{ ok: true; target: InviteTarget } | InviteFailure> {
  if (!kind || kind === "none") return { ok: true, target: NO_TARGET };

  if (kind === "call") {
    return { ok: true, target: { kind: "call", label: inviter } };
  }

  if (kind === "stream") {
    const room = listStreams().find((s) => s.id === id);
    if (!room) return fail(404, "that stream is not live any more");
    if (norm(room.host) !== norm(inviter)) {
      // Inviting people into somebody ELSE's broadcast is a decision that
      // belongs to its host. The link would work; the courtesy would not.
      return fail(403, "you can only invite people into a stream you are hosting");
    }
    return { ok: true, target: { kind: "stream", id: room.id, label: room.title } };
  }

  if (kind === "chat") {
    const read = await getThreadById(inviter, id, { limit: 1 });
    if (!read.ok) return fail(read.status, read.error);
    if (read.thread.kind !== "group") {
      return fail(400, "a direct conversation cannot take a third member — open a group instead");
    }
    return { ok: true, target: { kind: "chat", id: read.thread.id, label: read.thread.title ?? "Group" } };
  }

  return fail(400, `unknown invite target "${kind}"`);
}

/** Refresh a snapshot label where the thing still exists — a live stream shows
 *  its live title, an ended one keeps the words it had. */
function refreshTarget(target: InviteTarget): InviteTarget {
  if (target.kind !== "stream") return target;
  const live = listStreams().find((s) => s.id === target.id);
  return live ? { ...target, label: live.title } : target;
}

/* ================================== creation ================================= */

export interface CreateInviteInput {
  channel: InviteChannel;
  /** Where it is being sent — a username, an email, a phone number, or null
   *  for a bare link the inviter will paste somewhere themselves. */
  handle?: string | null;
  targetKind?: string;
  targetId?: string;
  /** Pre-approve a buddy request, honoured at redemption through the guard. */
  buddy?: boolean;
  note?: string | null;
}

export interface CreatedInvite {
  ok: true;
  invite: InviteRow;
  url: string;
  /** What actually happened on the way out — see {@link deliver}. */
  delivery: InviteDelivery;
}

/**
 * What the inviter is told about delivery. `handed-over` is the compose path
 * saying so out loud: the message was NOT sent, the URI is, and the dialog
 * opens it. Reporting a compose as a send is the false-green this field exists
 * to make impossible.
 */
export type InviteDelivery =
  | { kind: "none" }
  | { kind: "dm"; to: string }
  | { kind: "sent"; to: string }
  | { kind: "handed-over"; uri: string; why: string };

/**
 * Write one invitation. Order matters and is the order of what it protects:
 * policy (may this member invite at all) → rate (may they invite again now) →
 * the social guard (may they reach this handle) → the target (is there
 * anywhere to land) → the write.
 */
export async function createInvite(
  inviter: string,
  origin: string,
  input: CreateInviteInput,
): Promise<CreatedInvite | InviteFailure> {
  const me = await findStudioAccount(inviter);
  if (!me || me.disabled === true) return fail(404, "no account for this session");

  const policy = await assertCanSendInvites(me.username);
  if (!policy.ok) return fail(policy.status, policy.error);

  const channel: InviteChannel =
    input.channel === "internal" || input.channel === "email" || input.channel === "sms"
      ? input.channel
      : "link";

  const handle = (input.handle ?? "").trim() || null;
  if (channel === "internal" && !handle) return fail(400, "who is the invitation for?");
  if (channel === "email" && (!handle || handleKind(handle) !== "email")) {
    return fail(400, "that is not an email address");
  }

  /* The social guard, at the earliest moment it is answerable. Unknown,
   * disabled and blocked all answer NO_SUCH_MEMBER — identical wording, so
   * the refusal cannot be read as a block. */
  let handleAccount: string | null = null;
  if (handle && handleKind(handle) === "username") {
    const account = await findStudioAccount(handle);
    if (!account || account.disabled === true) return NO_SUCH_MEMBER;
    if (!canInteract(me.username, account.username).ok) return NO_SUCH_MEMBER;
    handleAccount = account.username;
  } else if (channel === "internal") {
    return fail(400, "an internal invitation goes to a member — that is not a username");
  }

  const target = await resolveTarget(me.username, input.targetKind ?? "none", (input.targetId ?? "").trim());
  if (!target.ok) return target;

  const note = (input.note ?? "").trim().slice(0, INVITE_LIMITS.noteMax) || null;
  const now = Date.now();
  const expiresAt = new Date(now + INVITE_LIMITS.ttlHours * 3600_000).toISOString();

  const written = withStoreLock(lockName(me.username), (): StoredInvite | InviteFailure => {
    const invites = readInvites(me.username);
    const recent = invites.filter((r) => Date.parse(r.createdAt) > now - INVITE_LIMITS.windowMs);
    if (recent.length >= INVITE_LIMITS.perWindow) {
      return fail(
        429,
        `that is ${recent.length} invitations in the last hour — the limit is ` +
          `${INVITE_LIMITS.perWindow}. Try again shortly.`,
      );
    }
    const open = invites.filter((r) => stateOf(r, now) === "open");
    if (open.length >= INVITE_LIMITS.openMax) {
      return fail(
        429,
        `you are holding ${open.length} unredeemed invitations — the limit is ` +
          `${INVITE_LIMITS.openMax}. Revoke some first.`,
      );
    }
    const rec: StoredInvite = {
      id: randomBytes(8).toString("hex"),
      inviter: norm(me.username),
      channel,
      handle,
      target: target.target,
      buddy: input.buddy === true,
      note,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      redeemedAt: null,
      redeemedBy: null,
      revokedAt: null,
    };
    writeInvites(me.username, [rec, ...invites]);
    return rec;
  });
  if ("ok" in written) return written;

  const row = rowOf(written);
  const url = inviteUrl(origin, row.token);
  const delivery = await deliver(me.username, handleAccount, row, url);
  return { ok: true, invite: row, url, delivery };
}

/* ================================== delivery ================================= */

/**
 * Hand the invitation over on whichever channel it was written for.
 *
 * Delivery never fails the CREATION. The invitation exists and its link is in
 * the reply whatever happens here — a member whose mail server is down still
 * has a link they can paste, and losing the invite because the send failed
 * would be the worse of the two outcomes by a distance.
 */
async function deliver(
  inviter: string,
  handleAccount: string | null,
  row: InviteRow,
  url: string,
): Promise<InviteDelivery> {
  const composed = composeInvite({ inviter, target: row.target, note: row.note, url });

  if (row.channel === "internal" && handleAccount) {
    const sent = await sendMessage(inviter, handleAccount, composed.body, isOnline(handleAccount));
    return sent.ok
      ? { kind: "dm", to: handleAccount }
      : // The guard could have closed between the check above and here. The
        // invitation stands; the inviter is told the message did not go.
        { kind: "handed-over", uri: url, why: sent.error };
  }

  if (row.channel === "email") {
    if (!smtpConfigured()) {
      return {
        kind: "handed-over",
        uri: mailtoUri(row.handle, composed.subject, composed.body),
        why: "no mail server is configured (AMBERXVID_SMTP_URL), so the invitation opens in your own mail app instead of being sent from here",
      };
    }
    const sent = await sendInviteMail(row.handle ?? "", composed.subject, composed.body);
    return sent.ok
      ? { kind: "sent", to: row.handle ?? "" }
      : {
          kind: "handed-over",
          uri: mailtoUri(row.handle, composed.subject, composed.body),
          why: `the mail server refused it (${sent.error}) — the invitation opens in your own mail app instead`,
        };
  }

  if (row.channel === "sms") {
    return {
      kind: "handed-over",
      uri: smsUri(row.handle, composed.body),
      why: "text messages are composed in your own messaging app — this deployment has no SMS gateway and does not pretend to",
    };
  }

  return { kind: "none" };
}

/* ================================ list / revoke ============================== */

/** One member's invitations, newest first. Their own only — there is no
 *  parameter for anybody else's, which is the cheapest way to be sure. */
export function listInvites(user: string): InviteRow[] {
  return readInvites(user)
    .map((rec) => rowOf({ ...rec, target: refreshTarget(rec.target) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Revoke — the whole reason an invite is a stored record and not merely a
 * signature. Idempotent, and a spent one cannot be revoked: it already did
 * what it was going to do, and saying otherwise would misreport the history.
 */
export function revokeInvite(user: string, id: string): { ok: true; invite: InviteRow } | InviteFailure {
  return withStoreLock(lockName(user), () => {
    const invites = readInvites(user);
    const rec = invites.find((r) => r.id === id);
    if (!rec) return fail(404, "no such invitation");
    if (rec.redeemedAt) return fail(409, "that invitation has already been used");
    if (!rec.revokedAt) {
      rec.revokedAt = new Date().toISOString();
      writeInvites(user, invites);
    }
    return { ok: true as const, invite: rowOf(rec) };
  });
}

/* ================================== describe ================================= */

/**
 * The PUBLIC face of a token — the one thing an unauthenticated caller may
 * ask. Thin by construction: who invited (screenname), what it opens onto,
 * whether a buddy edge rides along, and when it dies.
 *
 * Every failure is {@link DEAD}, so this cannot be used to probe which ids
 * exist, which have been used, or who has blocked whom.
 */
export async function describeInvite(
  token: unknown,
): Promise<{ ok: true; invite: InvitePublic } | InviteFailure> {
  const claims = readToken(token);
  if (!claims) return DEAD;
  const rec = readInvites(claims.inviter).find((r) => r.id === claims.id);
  if (!rec || stateOf(rec) !== "open") return DEAD;

  const account = await findStudioAccount(rec.inviter);
  if (!account || account.disabled === true) return DEAD;
  // An inviter who has since lost the module cannot let anybody into it.
  if (!(await isMember(account.username))) return DEAD;

  return {
    ok: true,
    invite: {
      inviter: account.screenname ?? account.username,
      target: refreshTarget(rec.target),
      buddy: rec.buddy,
      note: rec.note,
      expiresAt: rec.expiresAt,
    },
  };
}

/* ================================== redemption =============================== */

export interface RedeemInput {
  token: unknown;
  /** `signup` mints an account; `signin` attaches the invitation to one that
   *  already exists. Both prove the password HERE — see the note on
   *  {@link redeemInvite}. */
  mode: "signup" | "signin";
  username: string;
  /** The account's password: chosen now on `signup`, proven on `signin`. */
  password?: string;
}

export interface RedeemedInvite {
  ok: true;
  /** The account that redeemed it, in its stored casing. */
  username: string;
  /** True when this call created the account. */
  created: boolean;
  arrival: InviteArrival;
  /** Plain sentences for the landing: what happened, including the parts that
   *  did not. A target that has ended is reported, not hidden. */
  notes: string[];
}

/**
 * Walk the whole path — and it is deliberately ONE function, because the four
 * steps are one motion from the newcomer's side and a partial success has to
 * be reported as such rather than left for a second request that may never
 * come.
 *
 * The single-use consumption happens FIRST, under the lock, before the account
 * is created. Two browsers racing the same link therefore make one account and
 * one {@link INVITE_DEAD}. The cost of that ordering is the one failure mode
 * worth naming: if account creation then fails (a taken username), the
 * invitation is already spent. So creation's cheap refusals are checked BEFORE
 * consumption, and the expensive one that remains — a username taken in the
 * milliseconds between — un-spends the record rather than eating it.
 *
 * **`signin` proves the password HERE, not in the caller.** An earlier draft
 * documented that the route had already authenticated, which is the shape
 * `.claude/rules/asset-types.md` calls a habit rather than a guarantee: it
 * holds until the second caller, and the second caller of a function that
 * attaches an invitation to a NAMED account is the one that hands somebody
 * else's account to a token holder. `verifyLogin` is the accounts module's own
 * door — same scrypt compare, same dummy-hash burn for an unknown name — and
 * it runs before consumption, so a wrong password costs nobody their link.
 */
export async function redeemInvite(input: RedeemInput): Promise<RedeemedInvite | InviteFailure> {
  const claims = readToken(input.token);
  if (!claims) return DEAD;

  const inviterAccount = await findStudioAccount(claims.inviter);
  if (!inviterAccount || inviterAccount.disabled === true) return DEAD;
  if (!(await isMember(inviterAccount.username))) return DEAD;
  const inviter = inviterAccount.username;

  const wanted = (input.username ?? "").trim();
  if (!isValidUsername(wanted)) {
    return fail(400, "username must be 2–32 characters: letters, digits, . _ -");
  }
  const existing = await findStudioAccount(wanted);

  if (input.mode === "signup") {
    if (existing) return fail(409, "that username already has an account — sign in instead");
  } else {
    if (!existing || existing.disabled === true) return fail(404, "no account for this session");
    const login = await verifyLogin(existing.username, input.password ?? "");
    if (!login.ok) return fail(login.status, login.error);
  }

  /* THE SECOND BLOCK CHECK, and the one that always runs. A bare link had no
   * handle to check at creation, and a block can land in the days between.
   * Refused as INVITE_DEAD — identical to expired, spent and forged. */
  const redeemer = existing?.username ?? wanted;
  if (!canInteract(inviter, redeemer).ok) return DEAD;

  /* Consume. Everything after this point has an account or reverses this. */
  const consumed = withStoreLock(lockName(inviter), () => {
    const invites = readInvites(inviter);
    const rec = invites.find((r) => r.id === claims.id);
    if (!rec || stateOf(rec) !== "open") return null;
    rec.redeemedAt = new Date().toISOString();
    rec.redeemedBy = norm(redeemer);
    writeInvites(inviter, invites);
    return { ...rec };
  });
  if (!consumed) return DEAD;

  /** Put the invitation back — the only caller is the race below. */
  const unspend = (): void => {
    withStoreLock(lockName(inviter), () => {
      const invites = readInvites(inviter);
      const rec = invites.find((r) => r.id === claims.id);
      if (rec) {
        rec.redeemedAt = null;
        rec.redeemedBy = null;
        writeInvites(inviter, invites);
      }
    });
  };

  const notes: string[] = [];
  let created = false;
  let username = redeemer;

  if (input.mode === "signup") {
    const made = await createAccountByInvitation(inviter, wanted, input.password ?? "");
    if (!made.ok) {
      unspend();
      return fail(made.status, made.error);
    }
    created = true;
    username = made.account.username;
    notes.push(`Account created — welcome, ${username}.`);
  }

  /* THE GRANT, through the matrix, recorded as invite-sourced. Never a list
   * here, and an administrator's explicit revocation still wins. */
  const grant = await requestModuleGrant(
    username,
    AMBERXVID_MODULE_ID,
    `an invitation from ${inviter}`,
  );
  if (!grant.ok) {
    // The account exists and the invitation is spent; both are true and both
    // stay true. What failed is membership, and only an administrator can
    // undo it — so it is reported by name rather than swallowed.
    return fail(grant.status, grant.error);
  }
  notes.push(created ? `You are an AmberX Vid member.` : `AmberX Vid added to your account.`);

  /* The pre-approved buddy request, honoured through the ONE guard: the
   * inviter asks (they pre-approved it by writing the invitation), the
   * newcomer accepts (they accepted by redeeming it). Both calls consult
   * `canInteract` themselves, so a block landing in between refuses here too. */
  if (consumed.buddy) {
    const asked = await requestBuddy(inviter, username);
    const accepted = asked.ok ? await acceptBuddy(username, inviter) : asked;
    notes.push(
      accepted.ok
        ? `You and ${inviter} are buddies.`
        : `The buddy request could not be completed — you can send one from the buddy list.`,
    );
  }

  const arrival = await land(consumed.target, inviter, username, notes);
  return { ok: true, username, created, arrival, notes };
}

/**
 * Turn the stored target into a place to stand, doing whatever the arrival
 * needs first (a group chat needs the newcomer actually added to it).
 *
 * **A dead target never fails the redemption.** The account is real, the
 * membership is real, and refusing the whole thing because a stream ended
 * would be the least useful possible response to "the party moved on". The
 * newcomer lands in the suite and is told why.
 */
async function land(
  target: InviteTarget,
  inviter: string,
  username: string,
  notes: string[],
): Promise<InviteArrival> {
  if (target.kind === "stream") {
    const live = listStreams().find((s) => s.id === target.id);
    if (!live) {
      notes.push(`The stream "${target.label}" has ended — you are in the suite instead.`);
      return { kind: "suite" };
    }
    return { kind: "stream", id: live.id };
  }

  if (target.kind === "chat") {
    const added = await inviteToThread(inviter, target.id, username);
    if (!added.ok) {
      notes.push(`The group "${target.label}" could not take you: ${added.error}`);
      return { kind: "suite" };
    }
    return { kind: "chat", id: target.id };
  }

  if (target.kind === "call") {
    return { kind: "call", with: inviter };
  }

  return { kind: "suite" };
}

/* ================================ introspection ============================== */

/**
 * Where invite delivery stands, as a stated fact rather than a silent pass —
 * the shape `amberxvidPolicyStatus()` established. The dialog renders this so
 * a member reads "your mail app" or "sent from the server" and never has to
 * guess which one happened.
 */
export function inviteDeliveryStatus(): { smtp: boolean; why: string } {
  return smtpConfigured()
    ? { smtp: true, why: "AMBERXVID_SMTP_URL is configured — email invitations are sent by the server." }
    : {
        smtp: false,
        why:
          "no AMBERXVID_SMTP_URL is configured, so email and text invitations are COMPOSED in your " +
          "own mail or messaging app. That is the product here, not a degraded mode: it needs no " +
          "credential, no daemon and no delivery report, and the message goes from you.",
      };
}

/** Re-exported so a caller holding a row does not need a second import to say
 *  what it opens onto. */
export { targetPhrase };
