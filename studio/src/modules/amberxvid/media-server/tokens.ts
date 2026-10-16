/**
 * @file Participant-token minting and verification — the media server's door.
 *
 * The shape is `MEDIA_TOKEN` in `../lib/mediaContract`, and that record is the
 * spec this file implements rather than a comment about it:
 *
 *   payload   = "<exp>:<room>:<role>:<sub>"       (user LAST, so it may carry `:`)
 *   token     = payload + "." + base64url(HMAC-SHA256(secret, payload))
 *   signature = everything after the LAST "." (base64url contains no ".")
 *
 * The idiom is deliberately `../lib/turn.ts`'s, so this module keeps ONE
 * secret-handling pattern instead of two: an expiry-first colon-joined payload,
 * an HMAC over a server-only env secret, and that secret read from
 * `process.env` PER CALL — never latched at import. The digest is SHA-256
 * rather than coturn's mandated SHA-1 only because both ends of this pattern
 * are ours.
 *
 * **Verification is an ORDER, not a set** (`MEDIA_TOKEN.verify`): constant-time
 * signature compare first, THEN expiry, THEN claims. A forged token must learn
 * nothing from which check refused it, so every failure returns the same
 * un-granular `token-rejected` on the wire. The `detail` field exists for the
 * server's own log and never reaches a client.
 *
 * Server-only: `node:crypto` is imported here. Nothing in this file may be
 * pulled into a client bundle.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { MEDIA_TIMING, ROLE_RULES } from "../lib/mediaContract";
import type { MediaRole, MediaTokenClaims, RoomId } from "../lib/mediaContract";

/** `MEDIA_TOKEN.secretVar`, read per call per the turn.ts parity rule.
 *  `null` = the media plane is unconfigured, said honestly rather than
 *  defaulted to a guessable secret. */
export function mediaSecret(): string | null {
  return process.env.AMBERXVID_MEDIA_SECRET?.trim() || null;
}

const ROLES = Object.keys(ROLE_RULES) as MediaRole[];

function isRole(v: string): v is MediaRole {
  return (ROLES as readonly string[]).includes(v);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Constant-time string equality for strings that may differ in LENGTH.
 *
 * `timingSafeEqual` throws on unequal buffer lengths, and length-checking first
 * leaks the length — so both sides are run through an HMAC under a per-call
 * random key. That yields two 32-byte digests (always comparable), equal iff
 * the inputs are equal, and the blinding key makes the digests useless to an
 * attacker even as an oracle. Standard construction; the alternative of padding
 * to a fixed width leaks length through the padding.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const key = randomBytes(32);
  const ha = createHmac("sha256", key).update(a).digest();
  const hb = createHmac("sha256", key).update(b).digest();
  return timingSafeEqual(ha, hb);
}

export interface MintTokenInput {
  sub: string;
  room: RoomId;
  role: MediaRole;
  /** Seconds of life. Defaults to `MEDIA_TIMING.tokenTtlS` (300). */
  ttlS?: number;
}

/**
 * Mint a participant token. Lives here rather than in the app server so the
 * two halves of the format can never drift: the code that writes it and the
 * code that reads it are the same forty lines.
 *
 * `sub` is normalised (lowercased + trimmed) exactly as `MediaTokenClaims.sub`
 * documents, so the token a browser presents and the account the app server
 * authenticated compare equal without either side re-normalising.
 */
export function mintMediaToken(input: MintTokenInput, secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + (input.ttlS ?? MEDIA_TIMING.tokenTtlS);
  const sub = input.sub.trim().toLowerCase();
  // Guarded rather than trusted: exp/room/role are colon-free by construction
  // (numbers and server-minted ids), and the parser depends on that being true.
  if (input.room.includes(":")) throw new Error("roomId may not contain ':'");
  const payload = `${exp}:${input.room}:${input.role}:${sub}`;
  return `${payload}.${sign(payload, secret)}`;
}

export type TokenVerdict =
  | { ok: true; claims: MediaTokenClaims }
  /** Always `token-rejected` on the wire; `detail` is for the server log only. */
  | { ok: false; failure: "token-rejected"; detail: string };

const REJECT = (detail: string): TokenVerdict => ({ ok: false, failure: "token-rejected", detail });

/**
 * Verify a participant token in `MEDIA_TOKEN.verify` order.
 *
 * `nowS` is injectable so expiry can be tested without sleeping; it defaults to
 * the real clock and no caller in the server passes it.
 */
export function verifyMediaToken(token: unknown, secret: string, nowS?: number): TokenVerdict {
  if (typeof token !== "string" || token.length === 0) return REJECT("not a string");
  // Reject absurd input before hashing it — a token is ~100 bytes and this is
  // the one check that may short-circuit, because it reveals nothing about the
  // secret (only that the caller sent something no valid token could be).
  if (token.length > 4096) return REJECT("oversized");

  // The signature is everything after the LAST ".", because base64url contains
  // no "." while a username may.
  const cut = token.lastIndexOf(".");
  if (cut <= 0 || cut === token.length - 1) return REJECT("malformed");
  const payload = token.slice(0, cut);
  const signature = token.slice(cut + 1);

  /* 1. signature — first, and in constant time. */
  if (!constantTimeEqual(signature, sign(payload, secret))) return REJECT("bad signature");

  /* Parse only AFTER the signature holds: the payload is now known to be
   * server-minted, so splitting it is reading our own writing. Three splits,
   * remainder verbatim — that is what putting the user last buys. */
  const first = payload.indexOf(":");
  const second = payload.indexOf(":", first + 1);
  const third = payload.indexOf(":", second + 1);
  if (first < 0 || second < 0 || third < 0) return REJECT("malformed payload");
  const expRaw = payload.slice(0, first);
  const room = payload.slice(first + 1, second);
  const roleRaw = payload.slice(second + 1, third);
  const sub = payload.slice(third + 1);

  /* 2. expiry. */
  const exp = Number(expRaw);
  if (!Number.isInteger(exp)) return REJECT("bad expiry");
  const now = nowS ?? Math.floor(Date.now() / 1000);
  if (exp <= now) return REJECT("expired");

  /* 3. claims. Room/role against the room record is the CALLER's job (it holds
   *    the registry); what is checkable here is that the claims are well
   *    formed at all. */
  if (!room) return REJECT("no room");
  if (!isRole(roleRaw)) return REJECT("unknown role");

  // Normalised on the way OUT as well as on the way in. `MediaTokenClaims.sub`
  // documents itself as lowercased-and-trimmed, and a type that documents an
  // invariant should GUARANTEE it rather than assume whoever minted the token
  // did — otherwise the seat, the producer label and the roster carry a value
  // the rest of the module compares against normalised names and misses. In the
  // real path `mintMediaToken` already normalised, so this is idempotent; it
  // costs nothing and closes the case where it did not.
  const normalized = sub.trim().toLowerCase();
  if (!normalized) return REJECT("no subject");

  return { ok: true, claims: { sub: normalized, room, role: roleRaw, exp } };
}
