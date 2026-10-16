/**
 * @file THE RING DOOR (P13) — the one place that decides whether a device is
 * allowed to make a noise at somebody.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * Two things ring in this module: a 1:1 call invite, and "join my room". Before
 * P13 the first checked one policy row inside `createCall` and the second did
 * not exist. Three questions have to be answered before either of them writes
 * anything to the callee's outbox, and all three have to be answered in the
 * SAME order every time:
 *
 *  1. **May this member start a ring at all?** — `canStartCalls`, the policy
 *     row (`./policy`). Answering calls is deliberately not gated by it.
 *  2. **May these two interact?** — `canInteract`, the accounts social graph
 *     (`accounts/lib/relations`). This is the one that matters most, and it is
 *     the one this file exists for: **a blocked caller's ring must never reach
 *     the device.** Not "must be hidden in the UI" — must never be written.
 *  3. **May this member be interrupted right now?** — the DND model
 *     (`./dnd` → `./availability`).
 *
 * The order is not arbitrary. Policy first, because it is about the CALLER and
 * costs one read. Relations second, because its refusal is a COVER STORY and
 * must not be distinguishable from a member who does not exist — so it has to
 * be answered before anything that could leak the difference. DND last, because
 * it is the only one that is not a refusal at all: the caller is told the truth
 * ("unavailable"), a missed row is written, and the note lands in the inbox.
 *
 * ---------------------------------------------------------------------------
 * THE COVER STORY HAS TO BE ANSWERED *EARLY*, WHICH IS WHY THERE ARE TWO DOORS
 * ---------------------------------------------------------------------------
 * A cover story is only a cover if nothing ANSWERS BEFORE IT. Both ring routes
 * have cheap checks that would otherwise run first and leak by their wording:
 * "they're offline" and "they're in another call" are both facts a blocked
 * member must not be able to read off a probe, and both were being answered
 * ahead of the guard.
 *
 * So the questions with NO side effects are also exported on their own, as
 * {@link ringVisibility}, and each route asks that the moment it has resolved
 * the callee — before it says anything about presence or busyness. The full
 * {@link openRing} still runs at the record door and re-asks them, which is
 * deliberate: `canInteract` is one synchronous read of one small document, so
 * asking twice is free, and a guard asked twice is strictly better than a guard
 * that one of two call sites forgets.
 *
 * The DND half is NOT in the cheap door, and must not be moved into it. It
 * WRITES (the missed row, the note), so running it twice would file a call
 * twice — and it is deliberately the last question, so a member on
 * do-not-disturb who is also offline or already talking gets the more specific
 * answer rather than a missed row for a ring that could not have landed anyway.
 *
 * ---------------------------------------------------------------------------
 * WHY THE OUTBOX WRITE IS THE LINE
 * ---------------------------------------------------------------------------
 * `notifyUsers` is not a UI hint — it appends to the callee's cross-process
 * outbox, which their browser drains over SSE and turns into a ringing window,
 * a chime and a tray balloon. Once that event exists, the ring has HAPPENED:
 * every process that reads it will ring, and there is no un-ringing it.
 *
 * So the gate is on this side of that write, in a function the routes cannot
 * work around, and the refusal shapes are written here rather than at each
 * route so two rings cannot answer the same question two ways.
 *
 * ---------------------------------------------------------------------------
 * THE BLOCK COVER STORY, KEPT
 * ---------------------------------------------------------------------------
 * `relations.ts` rule 1: a `blocked` verdict renders byte-identical to that
 * surface's own refusal for a subject that does not exist. The calls route
 * already answers `{ error: "no such member" }` with 404 for an account it
 * cannot find, so {@link BLOCKED_COVER} is exactly that, byte for byte. A prober
 * cannot tell "they blocked me" from "no such account" — which is the whole
 * point, and the reason this constant is defined once rather than typed twice.
 *
 * Server-only.
 */

import { canInteract } from "@axs/modules/accounts/lib/relations";
import { recordDndMiss } from "./callHistory";
import { dndVerdict, mayRing } from "./dnd";
import { assertCanStartCalls } from "./policy";
import { mayReach } from "./prefsServer";
import { buddiesOf } from "./social";
import type { CallHistoryKind } from "./types";

/** The buddy test `mayReach` asks with — passed in rather than imported there,
 *  so `./prefsServer` stays a preferences file and does not grow an opinion
 *  about the social graph. */
const isBuddyOf = (subject: string, other: string): boolean =>
  buddiesOf(subject).includes(other.trim().toLowerCase());

/**
 * The refusal a blocked ring gets — the calls route's own "no such member",
 * character for character. Changing one without the other re-opens the probe
 * this exists to close.
 */
export const BLOCKED_COVER = { error: "no such member", status: 404 } as const;

export interface RingRequest {
  /** Authenticated caller, in the case the account store holds. */
  from: string;
  fromDisplay: string;
  /** Callee, in the case the account store holds. */
  to: string;
  toDisplay: string;
  /** What is being offered — a 1:1 call, or a room invitation. */
  kind: CallHistoryKind;
  /** For `kind: "room"`, so the missed row can offer a rejoin. */
  roomId?: string | null;
  roomTitle?: string | null;
}

export type RingVerdict =
  | { ok: true }
  | {
      ok: false;
      error: string;
      status: number;
      /**
       * True for the DND path only. The caller is being told something HONEST
       * rather than being refused — the ring was recorded on both sides and the
       * note is in the inbox; there is simply nobody to hear it right now.
       */
      unavailable?: boolean;
    };

/**
 * Questions (1) and (2) — the ones with NO side effects.
 *
 * A route asks this the MOMENT it has resolved the callee, before it says
 * anything about presence or busyness, so a blocked prober cannot read those
 * facts off the wording of an earlier answer. See the header.
 */
export async function ringVisibility(req: {
  from: string;
  to: string;
  toDisplay: string;
}): Promise<RingVerdict> {
  // (1) The caller's own policy row. Only the caller's — a member who may not
  // START calls can still answer one, which is the asymmetry the row states.
  const policy = await assertCanStartCalls(req.from);
  if (!policy.ok) return { ok: false, error: policy.error, status: policy.status };

  // (2) The social graph. Blocked in either direction, or a buddies-only member
  // this caller is not a buddy of.
  const interaction = canInteract(req.from, req.to);
  if (!interaction.ok) {
    if (interaction.reason === "blocked") {
      return { ok: false, ...BLOCKED_COVER };
    }
    // `not-buddy-required` is a STATED policy and may say so (rule 2) — it
    // comes from the subject's own `buddiesOnly` switch and nothing else.
    return {
      ok: false,
      error: `${req.toDisplay} only takes calls from buddies`,
      status: 403,
    };
  }

  return { ok: true };
}

/**
 * Ask all three questions, in order, and take the DND bookkeeping if the answer
 * is "they are unavailable".
 *
 * Call this BEFORE minting any record and before any `notifyUsers`. A `{ ok:
 * true }` here is the only thing that licenses a ring.
 */
export async function openRing(req: RingRequest): Promise<RingVerdict> {
  const visible = await ringVisibility(req);
  if (!visible.ok) return visible;

  // (2b) The callee's own AUDIENCE row for this door (P16 — the settings tree's
  // PRIVACY DEFAULTS group). Deliberately NARROWER than the accounts-wide
  // `buddiesOnly` switch question (2) just asked: a member may be perfectly
  // happy taking messages from anybody while only taking CALLS from buddies,
  // and the two doors are separate rows precisely because being invited into a
  // room is not the same imposition as being rung.
  //
  // Worded like the `buddiesOnly` refusal above and for the same reason: this
  // is the subject's own STATED policy, so it may say so rather than hiding
  // behind the blocked cover.
  const door = req.kind === "room" ? "whoMayInvite" : "whoMayCall";
  if (!(await mayReach(req.to, req.from, door, isBuddyOf))) {
    return {
      ok: false,
      error:
        door === "whoMayInvite"
          ? `${req.toDisplay} only takes room invitations from buddies`
          : `${req.toDisplay} only takes calls from buddies`,
      status: 403,
    };
  }

  // (3) Do not disturb. Not a refusal — a fact, recorded on both sides.
  if (!(await mayRing(req.to))) {
    await recordDndMiss({
      from: req.from,
      fromDisplay: req.fromDisplay,
      to: req.to,
      toDisplay: req.toDisplay,
      kind: req.kind,
      roomId: req.roomId ?? null,
      roomTitle: req.roomTitle ?? null,
    });
    return {
      ok: false,
      unavailable: true,
      // Honest, and deliberately WITHOUT the reason: which of the two DND
      // sources fired is the callee's business, and "they are in their quiet
      // hours" tells a caller more about somebody's evening than they asked
      // for. The callee sees `verdict.why` on their own surface.
      error: `${req.toDisplay} is unavailable right now — they'll see the missed call`,
      status: 409,
    };
  }

  return { ok: true };
}

/**
 * The DND verdict as a member's OWN surface renders it. Re-exported here so a
 * consumer that already imports the ring door does not also have to know that
 * the model lives two files away.
 */
export { dndVerdict };
