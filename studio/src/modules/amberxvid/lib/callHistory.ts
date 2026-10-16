/**
 * @file CALL HISTORY (P13) — placed, received and missed, per member, with the
 * missed-call DM note attached to the same write that decides a call was
 * missed.
 *
 * ---------------------------------------------------------------------------
 * WHY BOTH SIDES KEEP THEIR OWN ROW
 * ---------------------------------------------------------------------------
 * A call is one event and two experiences. The caller's row says "placed, no
 * answer"; the callee's says "missed" and carries the note that was written to
 * them about it. One shared record would have had to hold both viewpoints
 * anyway — and would have made every signal a contended write on a document
 * two processes want at once, for a list nobody reads while the call is live.
 *
 * So: one document per member, upserted by call id. The upsert is what makes
 * {@link recordCallState} safe to call on EVERY signal — invite, accept,
 * reject, hangup — which is the property that keeps the route free of a state
 * machine of its own. The route reports what the session now says; this file
 * works out what changed.
 *
 * ---------------------------------------------------------------------------
 * THE NOTE IS WRITTEN HERE, NOT BY THE CALLER
 * ---------------------------------------------------------------------------
 * "A missed call writes a DM note into the thread with the caller" is a duty,
 * and a duty that lives at a call site is a duty somebody forgets on the second
 * call site. It lives here instead, guarded by the `noteSent` flag on the row
 * it belongs to, so:
 *
 *  - a hangup arriving twice (the caller's timeout racing their cancel) writes
 *    one note, because the flag is on the row the second write reads;
 *  - a note can never exist without a row to explain it;
 *  - and the messenger stays the one inbox, which is the whole point — a member
 *    who missed a call finds out where they find out about everything else.
 *
 * The note is sent FROM THE CALLER, into their DM thread with the callee. It is
 * an ordinary message, subject to the ordinary block guard in the accounts
 * store — which is correct rather than incidental: a caller who was blocked
 * between the ring and the miss does not get to leave a note behind, and
 * `sendMessage` refusing is not an error here.
 *
 * ---------------------------------------------------------------------------
 * WHAT "MISSED" MEANS, EXACTLY
 * ---------------------------------------------------------------------------
 * `direction: "missed"` is only ever written on the CALLEE's row, and it
 * replaces `received` rather than sitting beside it. A DECLINED call is not
 * missed — they saw it and said no — so it stays `received` with
 * `missedReason: "declined"`. Everything else that ended before an answer is
 * missed: the ring timing out, the caller giving up, the callee being busy, the
 * media plane failing, and do-not-disturb.
 *
 * The caller's row is always `placed`; it carries the same `missedReason` so
 * both sides agree on WHY, while disagreeing about whose experience it was.
 *
 * House store posture (`./fsCore`): junk reads as an empty history, atomic
 * writes under the member's own lock, the cap applied on write. Server-only.
 */

import crypto from "node:crypto";

import { sendMessage } from "@axs/modules/accounts/lib/messages";
import { readJson, withStoreLock, writeJsonAtomic } from "./fsCore";
import { callHistoryFile } from "./paths";
import { isOnline } from "./presence";
import {
  CALL_HISTORY_KEEP,
  type CallHistoryEntry,
  type CallHistoryKind,
  type CallSession,
  type MissedReason,
} from "./types";

const norm = (u: string): string => u.trim().toLowerCase();

interface HistoryDoc {
  version: 1;
  user: string;
  calls: CallHistoryEntry[];
}

const lockName = (user: string): string => `call-history-${norm(user)}`;

const secondsBetween = (fromIso: string, toIso: string): number => {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
};

function readDoc(user: string): HistoryDoc {
  const key = norm(user);
  const raw = readJson<{ calls?: unknown } | null>(callHistoryFile(key), null);
  return {
    version: 1,
    user: key,
    calls: Array.isArray(raw?.calls) ? (raw.calls as CallHistoryEntry[]) : [],
  };
}

/**
 * Read-modify-write one member's document under their own lock. `fn` returns
 * whatever the caller needs to know about what it changed — the note decision
 * is made INSIDE the lock and acted on outside it, so two racing hangups cannot
 * both come away believing they are the one that has to write the note.
 */
function mutate<T>(user: string, fn: (doc: HistoryDoc) => T): T {
  return withStoreLock(lockName(user), () => {
    const doc = readDoc(user);
    const out = fn(doc);
    doc.calls = doc.calls.slice(0, CALL_HISTORY_KEEP);
    writeJsonAtomic(callHistoryFile(doc.user), doc);
    return out;
  });
}

/* ----------------------------------- reading ------------------------------------ */

/** This member's history, newest first. */
export function callHistoryFor(user: string): CallHistoryEntry[] {
  return readDoc(user).calls;
}

/**
 * How many of this member's rows are missed calls.
 *
 * There is deliberately NO per-row "seen" flag to subtract here. The missed
 * calls already announced themselves in the one inbox — the note is in the
 * thread with the caller, where it can be read, replied to and left unread by
 * the messenger's own unread machinery. A second unread state, owned by this
 * store and cleared by opening a different surface, would be two counters for
 * one fact, and they would disagree.
 */
export function missedCountFor(user: string): number {
  return readDoc(user).calls.filter((c) => c.direction === "missed").length;
}

/* ----------------------------------- writing ------------------------------------ */

/** Everything a new row needs that the session cannot supply. */
export interface RingParties {
  /** Screenname of `session.from` at ring time. */
  fromDisplay: string;
  /** Screenname of `session.to` at ring time. */
  toDisplay: string;
}

function blankRow(input: {
  callId: string;
  kind: CallHistoryKind;
  direction: CallHistoryEntry["direction"];
  peer: string;
  peerDisplay: string;
  at: string;
  roomId?: string | null;
  roomTitle?: string | null;
}): CallHistoryEntry {
  return {
    id: crypto.randomUUID(),
    callId: input.callId,
    kind: input.kind,
    direction: input.direction,
    peer: norm(input.peer),
    peerDisplay: input.peerDisplay,
    roomId: input.roomId ?? null,
    roomTitle: input.roomTitle ?? null,
    at: input.at,
    answeredAt: null,
    endedAt: null,
    durationS: 0,
    missedReason: null,
    noteSent: false,
  };
}

/** Find (or create, newest-first) this member's row for a call. */
function rowFor(
  doc: HistoryDoc,
  seed: Parameters<typeof blankRow>[0],
): CallHistoryEntry {
  const existing = doc.calls.find((c) => c.callId === seed.callId);
  if (existing) return existing;
  const fresh = blankRow(seed);
  doc.calls.unshift(fresh);
  return fresh;
}

/**
 * Map a session's END to the reason both rows carry. `hangup` before an answer
 * is the caller giving up, which is a no-answer from the callee's side — the
 * same thing the ring deadline produces, and it must not read differently.
 */
function missedReasonFrom(session: CallSession): MissedReason | null {
  if (session.answeredAt) return null;
  switch (session.endReason) {
    case "declined":
      return "declined";
    case "busy":
      return "busy";
    case "failed":
      return "failed";
    case "timeout":
    case "hangup":
      return "no-answer";
    default:
      return session.endedAt ? "no-answer" : null;
  }
}

/**
 * Bring both members' rows in line with the session as it now stands, and write
 * the missed-call note if this is the write that decided the call was missed.
 *
 * Safe to call on every signal: it is an upsert plus a terminal-state guard, so
 * the second hangup of a racing pair changes nothing and sends nothing.
 */
export async function recordCallState(session: CallSession, parties: RingParties): Promise<void> {
  const caller = norm(session.from);
  const callee = norm(session.to);
  const missedReason = missedReasonFrom(session);
  const over = session.endedAt != null;
  // The callee MISSED it unless they answered or declined it — see the header.
  const calleeMissed = over && !session.answeredAt && missedReason !== "declined";

  // The caller's row: always `placed`, never `missed`.
  mutate(caller, (doc) => {
    const row = rowFor(doc, {
      callId: session.id,
      kind: "call",
      direction: "placed",
      peer: callee,
      peerDisplay: parties.toDisplay,
      at: session.createdAt,
    });
    applyState(row, session, missedReason);
  });

  // The callee's row, and the note decision — both inside their lock.
  const note = mutate(callee, (doc) => {
    const row = rowFor(doc, {
      callId: session.id,
      kind: "call",
      direction: "received",
      peer: caller,
      peerDisplay: parties.fromDisplay,
      at: session.createdAt,
    });
    applyState(row, session, missedReason);
    if (calleeMissed) row.direction = "missed";
    if (!calleeMissed || row.noteSent) return null;
    // Claimed here, under the lock: whoever sets the flag owns the send.
    row.noteSent = true;
    return { at: session.endedAt ?? new Date().toISOString() };
  });

  if (note) {
    await postMissedNote({
      from: session.from,
      to: session.to,
      at: note.at,
      what: "Missed call",
    });
  }
}

/** Copy the session's timestamps onto a row. Terminal rows are frozen: a row
 *  that already ended keeps the end it had, so a late duplicate signal cannot
 *  extend a call that is over. */
function applyState(row: CallHistoryEntry, session: CallSession, missedReason: MissedReason | null): void {
  if (row.endedAt) return;
  if (session.answeredAt) row.answeredAt = session.answeredAt;
  if (session.endedAt) {
    row.endedAt = session.endedAt;
    row.durationS = row.answeredAt ? secondsBetween(row.answeredAt, session.endedAt) : 0;
    row.missedReason = missedReason;
  }
}

/* ------------------------------ the room ring ---------------------------------- */

/** Open both rows for a "join my room" ring (P13). The room's own record is
 *  untouched — a ring is an invitation, not a seat. */
export function recordRoomRingPlaced(input: {
  ringId: string;
  roomId: string;
  roomTitle: string;
  from: string;
  fromDisplay: string;
  to: string;
  toDisplay: string;
  at: string;
}): void {
  const seed = {
    callId: input.ringId,
    kind: "room" as const,
    roomId: input.roomId,
    roomTitle: input.roomTitle,
    at: input.at,
  };
  mutate(input.from, (doc) => {
    rowFor(doc, { ...seed, direction: "placed", peer: input.to, peerDisplay: input.toDisplay });
  });
  mutate(input.to, (doc) => {
    rowFor(doc, { ...seed, direction: "received", peer: input.from, peerDisplay: input.fromDisplay });
  });
}

/**
 * Close a room ring. `accept` answers it, `decline` leaves it received, and
 * `timeout` makes it missed — the same three outcomes a call has, so the two
 * kinds sit in one list without the reader having to learn a second vocabulary.
 */
export async function recordRoomRingAnswered(input: {
  ringId: string;
  from: string;
  to: string;
  answer: "accept" | "decline" | "timeout";
  at: string;
}): Promise<void> {
  const missedReason: MissedReason | null =
    input.answer === "accept" ? null : input.answer === "decline" ? "declined" : "no-answer";
  const close = (row: CallHistoryEntry): void => {
    if (row.endedAt) return;
    if (input.answer === "accept") row.answeredAt = input.at;
    row.endedAt = input.at;
    row.missedReason = missedReason;
  };

  mutate(input.from, (doc) => {
    const row = doc.calls.find((c) => c.callId === input.ringId);
    if (row) close(row);
  });

  const note = mutate(input.to, (doc) => {
    const row = doc.calls.find((c) => c.callId === input.ringId);
    if (!row) return null;
    close(row);
    if (input.answer !== "timeout") return null;
    if (row.noteSent) return null;
    row.direction = "missed";
    row.noteSent = true;
    return { title: row.roomTitle ?? "a room" };
  });

  if (note) {
    await postMissedNote({
      from: input.from,
      to: input.to,
      at: input.at,
      what: `Missed room invite (${note.title})`,
    });
  }
}

/* ------------------------------ the DND refusal --------------------------------- */

/**
 * The ring never reached the device because the member is on do-not-disturb:
 * the callee gets a MISSED row marked `dnd` and the note, and the caller gets a
 * placed row that ended the moment it started.
 *
 * There is no call id, because there is no call — a room record minted for a
 * ring nobody was allowed to hear would be a record the sweeper has to clean up
 * for nothing. The row's own id stands in, and is what the surface calls back
 * with.
 */
export async function recordDndMiss(input: {
  from: string;
  fromDisplay: string;
  to: string;
  toDisplay: string;
  kind: CallHistoryKind;
  roomId?: string | null;
  roomTitle?: string | null;
}): Promise<string> {
  const ringId = crypto.randomUUID();
  const at = new Date().toISOString();
  const seed = {
    callId: ringId,
    kind: input.kind,
    at,
    roomId: input.roomId ?? null,
    roomTitle: input.roomTitle ?? null,
  };

  mutate(input.from, (doc) => {
    const row = rowFor(doc, {
      ...seed,
      direction: "placed",
      peer: input.to,
      peerDisplay: input.toDisplay,
    });
    row.endedAt = at;
    row.missedReason = "dnd";
  });

  const send = mutate(input.to, (doc) => {
    const row = rowFor(doc, {
      ...seed,
      direction: "missed",
      peer: input.from,
      peerDisplay: input.fromDisplay,
    });
    row.endedAt = at;
    row.missedReason = "dnd";
    if (row.noteSent) return false;
    row.noteSent = true;
    return true;
  });

  if (send) {
    await postMissedNote({
      from: input.from,
      to: input.to,
      at,
      what: input.kind === "room" ? `Missed room invite (${input.roomTitle ?? "a room"})` : "Missed call",
    });
  }
  return ringId;
}

/* --------------------------------- the DM note ---------------------------------- */

/** `"14:02"` in server-local time — the same clock the quiet-hours window is
 *  written in, so a member reading both is not comparing two timezones. */
function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "just now";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Write the note into the caller ⇄ callee DM thread. Failure is swallowed on
 * purpose: the note is a courtesy, and a messages store that refuses (a block
 * landing between the ring and the miss) or hiccups must not take the call
 * history down with it. The row is already written either way.
 */
async function postMissedNote(input: {
  from: string;
  to: string;
  at: string;
  what: string;
}): Promise<void> {
  try {
    await sendMessage(input.from, input.to, `${input.what}, ${hhmm(input.at)}`, isOnline(input.to));
  } catch {
    /* the messenger is the one inbox, not the source of truth for history */
  }
}

/* ---------------------------------- housekeeping -------------------------------- */

/** Drop this member's whole history. Their own surface offers it; nothing else
 *  calls it, and it never touches the other party's rows — they are that
 *  member's record of their own calls. */
export function clearCallHistory(user: string): void {
  mutate(user, (doc) => {
    doc.calls = [];
  });
}

/** Forget one row. Same ownership rule as {@link clearCallHistory}. */
export function deleteCallRow(user: string, rowId: string): boolean {
  return mutate(user, (doc) => {
    const before = doc.calls.length;
    doc.calls = doc.calls.filter((c) => c.id !== rowId);
    return doc.calls.length !== before;
  });
}
