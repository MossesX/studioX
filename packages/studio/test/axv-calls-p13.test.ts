/**
 * @file P13 — the ring door, do-not-disturb, and the call histories.
 *
 * Staged like `test/axv-streams-p12.test.ts`: the real code over throwaway
 * roots, both stores re-pointed per test, driven in the order the app drives
 * it. Nothing here mocks a store.
 *
 * ## The properties worth the most, in order
 *
 * 1. **A BLOCKED CALLER'S RING IS NEVER WRITTEN, AND THE REFUSAL IS A COVER
 *    STORY.** `openRing` is asked before any record exists and before the
 *    callee's outbox is touched, and a blocked pair gets the calls route's own
 *    "no such member" 404 — byte-identical to a member who does not exist. This
 *    is asserted on the CONSTANT as well as on the verdict, because the whole
 *    guarantee is that the two strings are the same string.
 *
 * 2. **DND IS NOT A DROPPED CALL.** A member on do-not-disturb gets a MISSED
 *    row marked `dnd` and a DM note; the caller gets a placed row and an honest
 *    "unavailable" that does NOT say which of the two DND sources fired. Both
 *    halves matter: silently swallowing the ring would lose the call, and
 *    naming the reason would tell a caller about somebody's evening.
 *
 * 3. **QUIET HOURS WRAP, AND THE DAY IS THE DAY IT STARTED.** 22:00 → 07:00 is
 *    the normal case, so it is the one tested hardest — including the rule that
 *    a Friday-night window covers Saturday morning and that `start === end` is
 *    an EMPTY window rather than a whole day.
 *
 * 4. **A TIMED-OUT RING IS MISSED; A DECLINED ONE IS NOT.** They are different
 *    rows, different words on both sides, and only one of them writes a note.
 *
 * 5. **THE NOTE IS WRITTEN ONCE.** `recordCallState` runs on every signal, so
 *    the idempotency mark is exercised by replaying a terminal signal.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { addUser, changePassword, setScreenname } from "@axs/modules/accounts/lib/accounts";
import { blockUser, setBuddiesOnly } from "@axs/modules/accounts/lib/relations";
import { getThread } from "@axs/modules/accounts/lib/messages";
import { setAmberxvidPolicySource } from "@axs/modules/amberxvid/lib/policy";
import { setDndSource } from "@axs/modules/amberxvid/lib/dnd";
import {
  clock,
  defaultQuietHours,
  dndVerdictFor,
  getAvailability,
  isQuietAt,
  saveAvailability,
} from "@axs/modules/amberxvid/lib/availability";
import { BLOCKED_COVER, openRing, ringVisibility } from "@axs/modules/amberxvid/lib/ring";
import {
  callHistoryFor,
  clearCallHistory,
  deleteCallRow,
  missedCountFor,
  recordCallState,
  recordRoomRingAnswered,
  recordRoomRingPlaced,
} from "@axs/modules/amberxvid/lib/callHistory";
import type { CallSession } from "@axs/modules/amberxvid/lib/types";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];

function freshStores(): void {
  const accounts = fs.mkdtempSync(path.join(os.tmpdir(), "axv-p13-acc-"));
  const module = fs.mkdtempSync(path.join(os.tmpdir(), "axv-p13-mod-"));
  roots.push(accounts, module);
  process.env.ACCOUNTS_DATA_DIR = accounts;
  process.env.AMBERXVID_DATA_DIR = module;
  process.env.AMBERXVID_SILENT_JOURNAL = "1";
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  delete process.env.AMBERXVID_DATA_DIR;
  delete process.env.AMBERXVID_SILENT_JOURNAL;
  setAmberxvidPolicySource(null);
  setDndSource(null);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function ok<T extends { ok: boolean }>(result: T | { ok: false; error: string }, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${(result as { error: string }).error}`);
  return result as T;
}

async function member(username: string): Promise<string> {
  ok(await addUser("admin", username, "temp-pass", "member"), `adding ${username}`);
  ok(await changePassword(username, "temp-pass", `${username}-real-pw`), `${username}'s password`);
  ok(await setScreenname(username, username.toUpperCase()), `${username}'s screenname`);
  return username;
}

async function studio(): Promise<void> {
  freshStores();
  setAmberxvidPolicySource(null);
  setDndSource(null);
  ok(await changePassword("admin", "amberx", "admin-real-pw"), "the admin clearing the seed password");
}

const parties = { fromDisplay: "ANN", toDisplay: "BOB" };

/** A call session in whatever state the test needs — the shape the route hands
 *  the history store after `applySignal` has run. */
function session(over: Partial<CallSession> = {}): CallSession {
  return {
    id: "call-1",
    from: "ann",
    to: "bob",
    state: "ringing",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  };
}

const rowOf = (user: string, callId: string) =>
  callHistoryFor(user).find((c) => c.callId === callId);

/* ================================ the ring door ================================ */

test("a blocked caller's ring is refused with the calls route's OWN no-such-member words", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];
  ok(await blockUser(bob, ann), "bob blocks ann");

  const verdict = await openRing({ from: ann, to: bob, fromDisplay: "ANN", toDisplay: "BOB", kind: "call" });
  assert.equal(verdict.ok, false);
  assert.equal((verdict as { error: string }).error, BLOCKED_COVER.error);
  assert.equal((verdict as { status: number }).status, BLOCKED_COVER.status);
  // The cover story is the point: it must not be distinguishable from an
  // account that does not exist, which is exactly what the route answers.
  assert.equal(BLOCKED_COVER.error, "no such member");
  assert.equal(BLOCKED_COVER.status, 404);
  // And nothing was recorded — a refused ring is not a missed call.
  assert.equal(callHistoryFor(bob).length, 0);
  assert.equal(callHistoryFor(ann).length, 0);
});

test("the block refuses in BOTH directions — the blocker gets no one-way channel", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];
  ok(await blockUser(bob, ann), "bob blocks ann");

  const outward = await openRing({ from: bob, to: ann, fromDisplay: "BOB", toDisplay: "ANN", kind: "call" });
  assert.equal(outward.ok, false);
  assert.equal((outward as { error: string }).error, BLOCKED_COVER.error);
});

test("buddies-only is a STATED policy, so it says so instead of hiding behind the cover", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];
  ok(await setBuddiesOnly(bob, true), "bob restricts to buddies");

  const verdict = await openRing({ from: ann, to: bob, fromDisplay: "ANN", toDisplay: "BOB", kind: "call" });
  assert.equal(verdict.ok, false);
  assert.equal((verdict as { status: number }).status, 403);
  assert.match((verdict as { error: string }).error, /buddies/);
  // Explicitly NOT the cover story — this one is allowed to explain itself.
  assert.notEqual((verdict as { error: string }).error, BLOCKED_COVER.error);
});

test("the caller's canStartCalls row is asked, and only the caller's", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];
  setAmberxvidPolicySource(async () => ({ canStartCalls: false }));

  const outbound = await openRing({ from: ann, to: bob, fromDisplay: "ANN", toDisplay: "BOB", kind: "call" });
  assert.equal(outbound.ok, false);
  assert.match((outbound as { error: string }).error, /cannot start a call/);

  setAmberxvidPolicySource(null);
  const fine = await openRing({ from: ann, to: bob, fromDisplay: "ANN", toDisplay: "BOB", kind: "call" });
  assert.equal(fine.ok, true);
});

test("the cheap door answers the same refusals as the full one, with no side effects", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];
  ok(await blockUser(bob, ann), "bob blocks ann");

  // `ringVisibility` is what each route asks the MOMENT it has resolved the
  // callee — before it can say "they're offline" or "they're in another call",
  // either of which would let a blocked prober tell a block from a missing
  // account. It must give the same answer the full door does.
  const cheap = await ringVisibility({ from: ann, to: bob, toDisplay: "BOB" });
  const full = await openRing({ from: ann, to: bob, fromDisplay: "ANN", toDisplay: "BOB", kind: "call" });
  assert.equal(cheap.ok, false);
  assert.equal((cheap as { error: string }).error, (full as { error: string }).error);
  assert.equal((cheap as { status: number }).status, (full as { status: number }).status);

  // And it must NOT write: it is asked before the route knows whether the ring
  // could have landed at all, so a row here would file calls that never were.
  await saveAvailability(bob, { dnd: true });
  await ringVisibility({ from: ann, to: bob, toDisplay: "BOB" });
  assert.equal(callHistoryFor(bob).length, 0);
});

test("a clean ring passes the door and records nothing by itself", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];
  const verdict = await openRing({ from: ann, to: bob, fromDisplay: "ANN", toDisplay: "BOB", kind: "call" });
  assert.equal(verdict.ok, true);
  // The door licenses a ring; the ROUTE writes the rows. A door that also
  // recorded would double-write every call.
  assert.equal(callHistoryFor(ann).length, 0);
});

/* ============================== do not disturb ================================= */

test("the explicit switch turns a ring into a missed call with a note, not into nothing", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];
  await saveAvailability(bob, { dnd: true });

  const verdict = await openRing({ from: ann, to: bob, fromDisplay: "ANN", toDisplay: "BOB", kind: "call" });
  assert.equal(verdict.ok, false);
  assert.equal((verdict as { unavailable?: boolean }).unavailable, true);
  assert.match((verdict as { error: string }).error, /unavailable/);
  // The caller is NOT told which source silenced them.
  assert.doesNotMatch((verdict as { error: string }).error, /quiet|do not disturb/i);

  const missed = callHistoryFor(bob)[0];
  assert.equal(missed?.direction, "missed");
  assert.equal(missed?.missedReason, "dnd");
  assert.equal(missed?.peer, ann);

  const placed = callHistoryFor(ann)[0];
  assert.equal(placed?.direction, "placed");
  assert.equal(placed?.missedReason, "dnd");

  // The messenger is the one inbox: the note is in the thread with the caller.
  const thread = await getThread(bob, ann, { markRead: false });
  assert.equal(thread.ok, true);
  const texts = (thread as { thread: { messages: { text: string; from: string }[] } }).thread.messages;
  assert.equal(texts.length, 1);
  assert.match(texts[0].text, /^Missed call, \d\d:\d\d$/);
  assert.equal(texts[0].from.toLowerCase(), ann);
});

test("quiet hours silence a ring on their own, and the toggle is reported over the schedule", async () => {
  await studio();
  const bob = await member("bob");

  // A window that certainly contains "now": the whole day but the current
  // minute's own boundary is avoided by using a full-day span.
  const now = new Date();
  const start = (now.getHours() * 60 + now.getMinutes() + 1439) % 1440;
  await saveAvailability(bob, { quietHours: { enabled: true, startMinute: start, endMinute: (start + 120) % 1440 } });
  const quiet = dndVerdictFor(bob, now);
  assert.equal(quiet.dnd, true);
  assert.equal(quiet.source, "quiet-hours");

  // The switch wins the REPORT, because it is what the member would say
  // themselves — even when the schedule happens to agree.
  await saveAvailability(bob, { dnd: true });
  assert.equal(dndVerdictFor(bob, now).source, "toggle");
});

test("a wrapping window belongs to the day it STARTED, and start === end is empty", () => {
  const overnight = { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60, days: [5] }; // Fri
  // Friday 23:00 — inside.
  const friNight = new Date(2026, 7, 14, 23, 0); // 2026-08-14 is a Friday
  assert.equal(friNight.getDay(), 5);
  assert.equal(isQuietAt(overnight, friNight), true);
  // Saturday 03:00 — still inside, because the window is Friday's.
  const satMorning = new Date(2026, 7, 15, 3, 0);
  assert.equal(satMorning.getDay(), 6);
  assert.equal(isQuietAt(overnight, satMorning), true);
  // Saturday 23:00 — a NEW night, and Saturday is not ticked.
  assert.equal(isQuietAt(overnight, new Date(2026, 7, 15, 23, 0)), false);

  // An empty day list means every day.
  const everyDay = { ...overnight, days: [] };
  assert.equal(isQuietAt(everyDay, new Date(2026, 7, 15, 23, 0)), true);

  // Same minute both ends is an EMPTY window, never a whole day.
  assert.equal(isQuietAt({ enabled: true, startMinute: 600, endMinute: 600, days: [] }, new Date(2026, 7, 15, 10, 0)), false);
  // And a disabled window silences nothing at all.
  assert.equal(isQuietAt({ ...everyDay, enabled: false }, friNight), false);
});

test("a junk availability document reads as AVAILABLE, never as silenced", async () => {
  await studio();
  const bob = await member("bob");
  await saveAvailability(bob, { dnd: true });
  assert.equal(dndVerdictFor(bob).dnd, true);

  // Corrupt it the way a hand-edit or a half-written file would.
  const file = path.join(process.env.AMBERXVID_DATA_DIR!, "availability", "bob.json");
  fs.writeFileSync(file, "{ not json at all", "utf8");
  assert.equal(dndVerdictFor(bob).dnd, false);
  assert.equal(getAvailability(bob).quietHours.enabled, defaultQuietHours().enabled);
});

test("a patch merges field-wise — flipping the switch never resets the window", async () => {
  await studio();
  const bob = await member("bob");
  await saveAvailability(bob, { quietHours: { enabled: true, startMinute: 90, endMinute: 450 } });
  await saveAvailability(bob, { dnd: true });
  const doc = getAvailability(bob);
  assert.equal(doc.dnd, true);
  assert.equal(doc.quietHours.enabled, true);
  assert.equal(clock(doc.quietHours.startMinute), "01:30");
  assert.equal(clock(doc.quietHours.endMinute), "07:30");
});

/* ================================ call history ================================= */

test("an answered call lands as placed + received with a real duration", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];

  const started = session();
  await recordCallState(started, parties);
  assert.equal(rowOf(ann, "call-1")?.direction, "placed");
  assert.equal(rowOf(bob, "call-1")?.direction, "received");

  const answeredAt = new Date(Date.parse(started.createdAt) + 5_000).toISOString();
  const endedAt = new Date(Date.parse(answeredAt) + 90_000).toISOString();
  await recordCallState({ ...started, state: "ended", answeredAt, endedAt, endReason: "hangup" }, parties);

  const mine = rowOf(ann, "call-1");
  assert.equal(mine?.durationS, 90);
  assert.equal(mine?.missedReason, null);
  assert.equal(rowOf(bob, "call-1")?.direction, "received");
  assert.equal(missedCountFor(bob), 0);
  // An answered call leaves no note behind.
  const thread = await getThread(bob, ann, { markRead: false });
  assert.equal((thread as { thread: { messages: unknown[] } }).thread.messages.length, 0);
});

test("a timed-out ring is MISSED and writes exactly one note, however often it is replayed", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];

  const started = session();
  await recordCallState(started, parties);
  const ended = {
    ...started,
    state: "ended" as const,
    endedAt: new Date().toISOString(),
    endReason: "timeout",
  };
  await recordCallState(ended, parties);
  // Replayed — two processes hanging up at once is routine.
  await recordCallState(ended, parties);
  await recordCallState({ ...ended, endReason: "hangup" }, parties);

  assert.equal(rowOf(bob, "call-1")?.direction, "missed");
  assert.equal(rowOf(bob, "call-1")?.missedReason, "no-answer");
  assert.equal(rowOf(ann, "call-1")?.direction, "placed"); // never "missed"
  assert.equal(missedCountFor(bob), 1);
  assert.equal(callHistoryFor(bob).length, 1);

  const thread = await getThread(bob, ann, { markRead: false });
  const messages = (thread as { thread: { messages: unknown[] } }).thread.messages;
  assert.equal(messages.length, 1);
});

test("a DECLINED call is not a missed one — they saw it and said no", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];

  await recordCallState(session(), parties);
  await recordCallState(
    { ...session(), state: "rejected", endedAt: new Date().toISOString(), endReason: "declined" },
    parties,
  );

  assert.equal(rowOf(bob, "call-1")?.direction, "received");
  assert.equal(rowOf(bob, "call-1")?.missedReason, "declined");
  assert.equal(missedCountFor(bob), 0);
  const thread = await getThread(bob, ann, { markRead: false });
  assert.equal((thread as { thread: { messages: unknown[] } }).thread.messages.length, 0);
});

test("a terminal row is frozen — a late duplicate cannot extend a call that is over", async () => {
  await studio();
  const [ann] = [await member("ann"), await member("bob")];

  const started = session();
  const answeredAt = new Date(Date.parse(started.createdAt) + 1_000).toISOString();
  const endedAt = new Date(Date.parse(answeredAt) + 10_000).toISOString();
  await recordCallState({ ...started, answeredAt, endedAt, state: "ended", endReason: "hangup" }, parties);
  assert.equal(rowOf(ann, "call-1")?.durationS, 10);

  const muchLater = new Date(Date.parse(answeredAt) + 999_000).toISOString();
  await recordCallState({ ...started, answeredAt, endedAt: muchLater, state: "ended", endReason: "hangup" }, parties);
  assert.equal(rowOf(ann, "call-1")?.durationS, 10);
});

/* ============================== the room ring ================================== */

test("a room ring opens both rows, and accepting closes them as answered", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];
  const at = new Date().toISOString();

  recordRoomRingPlaced({
    ringId: "ring-1",
    roomId: "room-9",
    roomTitle: "Standup",
    from: ann,
    fromDisplay: "ANN",
    to: bob,
    toDisplay: "BOB",
    at,
  });
  assert.equal(rowOf(bob, "ring-1")?.kind, "room");
  assert.equal(rowOf(bob, "ring-1")?.roomId, "room-9");
  assert.equal(rowOf(bob, "ring-1")?.roomTitle, "Standup");

  await recordRoomRingAnswered({ ringId: "ring-1", from: ann, to: bob, answer: "accept", at });
  assert.equal(rowOf(bob, "ring-1")?.direction, "received");
  assert.notEqual(rowOf(bob, "ring-1")?.answeredAt, null);
  assert.equal(missedCountFor(bob), 0);
});

test("a room ring that times out is missed, with a note that names the room", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];
  const at = new Date().toISOString();

  recordRoomRingPlaced({
    ringId: "ring-2",
    roomId: "room-9",
    roomTitle: "Standup",
    from: ann,
    fromDisplay: "ANN",
    to: bob,
    toDisplay: "BOB",
    at,
  });
  await recordRoomRingAnswered({ ringId: "ring-2", from: ann, to: bob, answer: "timeout", at });
  await recordRoomRingAnswered({ ringId: "ring-2", from: ann, to: bob, answer: "timeout", at });

  assert.equal(rowOf(bob, "ring-2")?.direction, "missed");
  assert.equal(missedCountFor(bob), 1);
  const thread = await getThread(bob, ann, { markRead: false });
  const messages = (thread as { thread: { messages: { text: string }[] } }).thread.messages;
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /Missed room invite \(Standup\), \d\d:\d\d/);
});

/* ================================ housekeeping ================================= */

test("a member forgets their own rows and nobody else's", async () => {
  await studio();
  const [ann, bob] = [await member("ann"), await member("bob")];
  await recordCallState(session(), parties);

  const bobsRow = rowOf(bob, "call-1");
  assert.ok(bobsRow);
  assert.equal(deleteCallRow(bob, bobsRow.id), true);
  assert.equal(callHistoryFor(bob).length, 0);
  // Ann's own record of the same call is untouched — it is hers.
  assert.equal(callHistoryFor(ann).length, 1);

  clearCallHistory(ann);
  assert.equal(callHistoryFor(ann).length, 0);
});
