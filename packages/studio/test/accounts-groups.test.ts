/**
 * @file Group chats — `lib/messages` generalised from DM pairs to N members
 * (P5 of `axf-amberxvid-social`).
 *
 * Staged exactly as `test/accounts-store.test.ts` and
 * `test/accounts-relations.test.ts` stage the other stores: the real store over
 * a throwaway root, driven in the order the app drives it, with
 * `ACCOUNTS_DATA_DIR` re-pointed per test so nothing leaks between them.
 *
 * The file exists for FOUR claims, and the first is the one that cannot be
 * seen any other way:
 *
 * 1. **"Generalised IN PLACE" is a claim until a pre-existing thread
 *    round-trips.** So the first test writes the literal pre-P5 bytes to disk —
 *    `participants` as a pair, no `members`, no `kind`, no `nextSeq`, no `seq`
 *    on any message — and asserts they read back as a two-member group with the
 *    same messages, the same unread count and the same delivery state, then
 *    survive a write. Nothing migrates anything; if the normaliser ever stops
 *    understanding the old shape, every conversation in every existing studio
 *    goes quiet at once and no other check would notice.
 *
 * 2. **The three-member offline case.** The whole point of separating cursors
 *    from the aggregate stamp is that a message is not "delivered" because ONE
 *    of three people has it. So: send with one member online and one offline,
 *    and watch the stamp stay null until the offline member's own fetch.
 *
 * 3. **The invite side door.** A blocked pair must not end up in a room
 *    together because a THIRD member invited both. The guard is asked between
 *    the newcomer and every member already inside, and a `blocked` verdict is
 *    compared FIELD BY FIELD to the refusal an absent member gets — a test that
 *    matched the wording would still pass on the day the two wordings drift,
 *    and the indistinguishability IS the mechanism (see the header of
 *    `lib/relations`).
 *
 * 4. **The cap comes from the policy seam**, not from a constant this module
 *    hardcodes twice — installed, clamped, and refused at the boundary.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { addUser, changePassword, setScreenname } from "@axs/modules/accounts/lib/accounts";
import { blockUser } from "@axs/modules/accounts/lib/relations";
import {
  createGroup,
  getThread,
  getThreadById,
  inviteToThread,
  leaveThread,
  listThreads,
  markThreadReadById,
  renameThread,
  sendMessage,
  sendToThread,
  setThreadMemberCapSource,
  threadMemberCap,
  threadMemberCapStatus,
} from "@axs/modules/accounts/lib/messages";
import { messagesDir } from "@axs/modules/accounts/lib/paths";
import {
  THREAD_MEMBERS_CEILING,
  THREAD_MEMBERS_MAX,
  threadIdFor,
  type Message,
  type Thread,
} from "@axs/modules/accounts/lib/types";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];

function freshStore(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axs-groups-"));
  roots.push(root);
  process.env.ACCOUNTS_DATA_DIR = root;
  return root;
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  setThreadMemberCapSource(null);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

async function member(username: string, screenname: string): Promise<string> {
  const added = await addUser("admin", username, "temp-pass", "member");
  assert.equal(added.ok, true, `adding ${username}`);
  const changed = await changePassword(username, "temp-pass", `${username}-real-pw`);
  assert.equal(changed.ok, true, `${username} clearing their temp password`);
  const named = await setScreenname(username, screenname);
  assert.equal(named.ok, true, `${username} choosing a screenname`);
  return username;
}

/** The admin through their forced entry flow, so `addUser` gates open. */
async function stagedRoster(...members: Array<[string, string]>): Promise<void> {
  freshStore();
  const changed = await changePassword("admin", "amberx", "gatekeeper");
  assert.equal(changed.ok, true, "the seeded temp password must open the entry flow");
  for (const [username, screenname] of members) await member(username, screenname);
}

/** A group, or the assertion that says why there isn't one. */
async function group(owner: string, title: string, members: string[]): Promise<Thread> {
  const made = await createGroup(owner, title, members);
  assert.equal(made.ok, true, made.ok ? "" : made.error);
  return (made as { ok: true; thread: Thread }).thread;
}

const readFile = (id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(messagesDir(), `${id}.json`), "utf8")) as Record<string, unknown>;

/* ================== 1. the pre-P5 thread, read without migration ================= */

/**
 * The document the store wrote before groups existed, byte for byte. Written
 * as its own type rather than as `Thread`, because it deliberately is NOT the
 * current shape — that is the entire point of the test below.
 */
interface LegacyThread {
  version: 1;
  id: string;
  participants: [string, string];
  messages: Array<Omit<Message, "seq">>;
  createdAt: string;
  updatedAt: string;
}

function stageLegacyDm(a: string, b: string): string {
  const id = threadIdFor(a, b);
  const at = (s: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
  const legacy: LegacyThread = {
    version: 1,
    id,
    participants: [a, b].sort() as [string, string],
    messages: [
      // Read: delivered AND read, the settled case.
      { id: "old-1", threadId: id, from: a, to: b, text: "one", sentAt: at(1), deliveredAt: at(2), readAt: at(3) },
      // Delivered, not read — the unread this thread is carrying.
      { id: "old-2", threadId: id, from: a, to: b, text: "two", sentAt: at(4), deliveredAt: at(5), readAt: null },
      // Never delivered — the offline queue, which must survive the read.
      { id: "old-3", threadId: id, from: a, to: b, text: "three", sentAt: at(6), deliveredAt: null, readAt: null },
    ],
    createdAt: at(1),
    updatedAt: at(6),
  };
  fs.mkdirSync(messagesDir(), { recursive: true });
  fs.writeFileSync(path.join(messagesDir(), `${id}.json`), JSON.stringify(legacy), "utf8");
  return id;
}

test("a pre-groups thread reads as a two-member group, with no migration", async () => {
  await stagedRoster(["molly", "Molly"], ["amber", "Amber"]);
  const id = stageLegacyDm("molly", "amber");

  // Read it the way the app reads it — by peer, not by id.
  const opened = await getThread("amber", "molly");
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  assert.equal(opened.thread.kind, "dm", "a two-member thread is a DM, and the ID says so");
  assert.equal(opened.thread.title, null);
  assert.deepEqual(opened.thread.participants.slice().sort(), ["amber", "molly"]);
  assert.deepEqual(
    opened.thread.members.map((m) => m.username).sort(),
    ["amber", "molly"],
    "participants became members without anybody writing a migration",
  );
  assert.deepEqual(
    opened.thread.messages.map((m) => m.text),
    ["one", "two", "three"],
    "every message survives, in order",
  );
  assert.deepEqual(
    opened.thread.messages.map((m) => m.seq),
    [1, 2, 3],
    "seqs are assigned by position for a document that never had them",
  );

  // The one message that was never delivered is delivered by THIS fetch, and
  // the two that were are not re-counted.
  assert.equal(opened.deliveredNow, 1, "only the queued message arrives");

  // And the unread count is the same number the old per-message scan produced:
  // "two" and "three" are unread, "one" is not.
  const listed = await listThreads("amber");
  assert.equal(listed.unread, 2);
  assert.equal(listed.threads.length, 1);
  assert.equal(listed.threads[0].kind, "dm");
  assert.deepEqual(listed.threads[0].members.slice().sort(), ["amber", "molly"]);

  // Now prove the round trip: the file has been rewritten in the NEW shape,
  // and the conversation is unchanged.
  const onDisk = readFile(id);
  assert.ok(Array.isArray(onDisk.members), "the rewritten file carries members");
  assert.equal(onDisk.nextSeq, 4);
  const reread = await getThread("amber", "molly");
  assert.equal(reread.ok, true);
  if (!reread.ok) return;
  assert.deepEqual(
    reread.thread.messages.map((m) => m.text),
    ["one", "two", "three"],
  );
  assert.equal(reread.deliveredNow, 0, "a second fetch delivers nothing twice");

  // The legacy DM still SENDS through the untouched pair signature.
  const sent = await sendMessage("amber", "molly", "four", false);
  assert.equal(sent.ok, true);
  assert.deepEqual(sent.ok && sent.members.slice().sort(), ["amber", "molly"]);
});

/* ===================== 2. three members, one of them offline ==================== */

test("offline delivery in a three-member group is a STAMP, and the aggregate waits", async () => {
  await stagedRoster(["ann", "Ann"], ["bob", "Bob"], ["cal", "Cal"]);
  const thread = await group("ann", "The Garage", ["bob", "cal"]);
  assert.equal(thread.kind, "group");
  assert.equal(thread.members.length, 3);
  assert.deepEqual(
    thread.members.map((m) => m.role),
    ["owner", "member", "member"],
    "the creator owns it; everybody else is a member",
  );

  // Ann sends with Bob online and Cal offline — the checklist's case.
  const sent = await sendToThread("ann", thread.id, "gate went green", ["bob"]);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.message.to, "", "a group message is addressed to the room, not a person");
  assert.equal(
    sent.message.deliveredAt,
    null,
    "one of three having it is not delivered — that is the whole reason the aggregate is not a boolean per recipient",
  );

  // Bob was online: his cursor already moved, so his fetch delivers nothing new.
  const bobs = await getThreadById("bob", thread.id);
  assert.equal(bobs.ok, true);
  assert.equal(bobs.ok && bobs.deliveredNow, 0);
  assert.equal(
    bobs.ok && bobs.thread.messages[0].deliveredAt,
    null,
    "still waiting on Cal",
  );

  // Cal signs in. HIS fetch is the delivery, and it completes the aggregate.
  const cals = await getThreadById("cal", thread.id);
  assert.equal(cals.ok, true);
  if (!cals.ok) return;
  assert.equal(cals.deliveredNow, 1, "the offline queue drains on the next fetch");
  assert.notEqual(cals.thread.messages[0].deliveredAt, null, "now everybody has it");

  // Unread is per member and comes from their own cursor.
  assert.equal((await listThreads("bob")).unread, 1);
  assert.equal((await listThreads("cal")).unread, 1);
  assert.equal((await listThreads("ann")).unread, 0, "you never owe yourself a read");

  assert.equal(await markThreadReadById("bob", thread.id), 1);
  assert.equal((await listThreads("bob")).unread, 0);
  assert.equal((await listThreads("cal")).unread, 1, "one member reading is not another's read");

  // The aggregate readAt is the same rule as delivery: everybody but the sender.
  let state = await getThreadById("ann", thread.id);
  assert.equal(state.ok && state.thread.messages[0].readAt, null);
  await markThreadReadById("cal", thread.id);
  state = await getThreadById("ann", thread.id);
  assert.notEqual(state.ok && state.thread.messages[0].readAt, null);
});

test("sending is not receiving — a send never stamps the SENDER's own backlog", async () => {
  await stagedRoster(["ann", "Ann"], ["bob", "Bob"]);
  const thread = await group("ann", "Crossfire", ["bob"]);

  // Bob says two things while Ann is offline and never opens the room.
  await sendToThread("bob", thread.id, "you around?", []);
  await sendToThread("bob", thread.id, "still there?", []);

  // Ann now sends — from a composer, WITHOUT having fetched. A send must not
  // claim she received the two she has never been handed: a cursor says
  // "carried up to", and moving hers here would mark Bob's messages delivered
  // to somebody who has not seen them. (The route passes `isOnline` as a
  // predicate for exactly this reason — reading the room to build a presence
  // list would have been the same bug wearing a different hat.)
  const sent = await sendToThread("ann", thread.id, "just got in", (u) => u === "bob");
  assert.equal(sent.ok, true);

  // Read her cursor OFF DISK rather than through a reader: every read in this
  // store is a delivery, so asking the store would answer the question by
  // changing it — which is how the first draft of this test fooled itself.
  const onDisk = readFile(thread.id) as unknown as {
    members: Array<{ username: string; deliveredThrough: number }>;
  };
  assert.equal(
    onDisk.members.find((m) => m.username === "ann")?.deliveredThrough,
    0,
    "she has been handed nothing — she only spoke",
  );

  const bobs = await getThreadById("bob", thread.id);
  assert.equal(bobs.ok, true);
  if (!bobs.ok) return;
  assert.equal(
    bobs.thread.messages[0].deliveredAt,
    null,
    "Bob's first message is still queued — Ann sending is not Ann receiving",
  );
  assert.notEqual(bobs.thread.messages[2].deliveredAt, null, "…but the one she just sent IS");

  // Her own fetch is what delivers them, and it is counted as such.
  const anns = await getThreadById("ann", thread.id);
  assert.equal(anns.ok && anns.deliveredNow, 2, "her own fetch is the delivery");
  assert.equal((await listThreads("ann")).unread, 2, "delivered is not read");
});

test("a member who leaves stops holding a delivery open", async () => {
  await stagedRoster(["ann", "Ann"], ["bob", "Bob"], ["cal", "Cal"]);
  const thread = await group("ann", "Standup", ["bob", "cal"]);

  await sendToThread("ann", thread.id, "morning", ["bob"]);
  const before = await getThreadById("bob", thread.id);
  assert.equal(before.ok && before.thread.messages[0].deliveredAt, null, "Cal has not read it");

  const left = await leaveThread("cal", thread.id);
  assert.equal(left.ok, true);
  assert.equal(left.ok && left.deleted, false);
  assert.deepEqual(left.ok && left.members.slice().sort(), ["ann", "bob", "cal"], "the room BEFORE the departure");

  const after = await getThreadById("bob", thread.id);
  assert.equal(after.ok && after.thread.members.length, 2);
  assert.notEqual(
    after.ok && after.thread.messages[0].deliveredAt,
    null,
    "the only member who had not received it is no longer in the room",
  );

  // Cal is out: the room is not his to read any more, and it is not a room he
  // is told still exists.
  const asOutsider = await getThreadById("cal", thread.id);
  assert.equal(asOutsider.ok, false);
  assert.equal(asOutsider.ok === false && asOutsider.status, 404);
  assert.equal((await listThreads("cal")).threads.length, 0);
});

test("the owner leaving hands the group on; the last member out deletes it", async () => {
  await stagedRoster(["ann", "Ann"], ["bob", "Bob"]);
  const thread = await group("ann", "Two of us", ["bob"]);

  assert.equal((await leaveThread("ann", thread.id)).ok, true);
  const bobs = await getThreadById("bob", thread.id);
  assert.equal(bobs.ok, true);
  assert.deepEqual(
    bobs.ok && bobs.thread.members.map((m) => [m.username, m.role]),
    [["bob", "owner"]],
    "a group with no owner could never be renamed again",
  );
  // Which is not theoretical: Bob can now rename it, and could not before.
  assert.equal((await renameThread("bob", thread.id, "Just me")).ok, true);

  assert.equal((await leaveThread("bob", thread.id)).ok, true);
  assert.equal(
    fs.existsSync(path.join(messagesDir(), `${thread.id}.json`)),
    false,
    "an empty room is a file nobody could ever open again",
  );
});

/* ========================= 3. the door, and the side door ======================= */

test("a block shuts the group door — including the one a third member holds open", async () => {
  await stagedRoster(["ann", "Ann"], ["bob", "Bob"], ["cal", "Cal"]);
  assert.equal((await blockUser("ann", "bob")).ok, true);

  // Direct: Ann cannot open a group with the member she blocked, and the
  // refusal is the one an absent member gets — FIELD BY FIELD, because a probe
  // that can tell "blocked" from "gone" has defeated the silence.
  const blocked = await createGroup("ann", "Nope", ["bob"]);
  const ghost = await createGroup("ann", "Nope", ["nobody-at-all"]);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked, ghost);

  // THE SIDE DOOR: Cal has blocked nobody and is on speaking terms with both,
  // so a guard that only asked about the INVITER would let this through.
  const sideDoor = await createGroup("cal", "Everyone", ["ann", "bob"]);
  assert.equal(sideDoor.ok, false, "Cal cannot put Ann in a room with the member she blocked");
  assert.deepEqual(sideDoor, ghost);

  // Same door, reached by invitation instead of by creation.
  const room = await group("cal", "Just us", ["ann"]);
  const invited = await inviteToThread("cal", room.id, "bob");
  assert.equal(invited.ok, false);
  assert.deepEqual(invited, ghost);

  // And it is only that pair: Cal may still add anybody else.
  await member("dee", "Dee");
  assert.equal((await inviteToThread("cal", room.id, "dee")).ok, true);
});

test("an invitee joins with the history and a clean slate, and inviting twice is a no-op", async () => {
  await stagedRoster(["ann", "Ann"], ["bob", "Bob"], ["cal", "Cal"]);
  const thread = await group("ann", "Backlog", ["bob"]);
  for (let i = 0; i < 5; i += 1) await sendToThread("ann", thread.id, `line ${i}`, []);

  assert.equal((await inviteToThread("ann", thread.id, "cal")).ok, true);
  const cals = await getThreadById("cal", thread.id);
  assert.equal(cals.ok, true);
  if (!cals.ok) return;
  assert.equal(cals.thread.messages.length, 5, "a newcomer can read what the room already said");
  assert.equal(
    (await listThreads("cal")).unread,
    0,
    "…and owes nobody a backlog — a badge of 400 on arrival is a badge nobody reads",
  );

  // Idempotent, and it does not reset the member who is already there.
  await sendToThread("ann", thread.id, "after cal", []);
  assert.equal((await listThreads("cal")).unread, 1);
  assert.equal((await inviteToThread("ann", thread.id, "cal")).ok, true);
  assert.equal((await listThreads("cal")).unread, 1, "a re-invite is not a re-join");

  // An outsider cannot invite into a room they are not in.
  await member("dee", "Dee");
  const outsider = await inviteToThread("dee", thread.id, "dee");
  assert.equal(outsider.ok, false);
  assert.equal(outsider.ok === false && outsider.status, 404);
});

test("only the owner renames, and a DM has no group verbs at all", async () => {
  await stagedRoster(["ann", "Ann"], ["bob", "Bob"]);
  const thread = await group("ann", "First name", ["bob"]);

  const byMember = await renameThread("bob", thread.id, "Second name");
  assert.equal(byMember.ok, false);
  assert.equal(byMember.ok === false && byMember.status, 403);

  assert.equal((await renameThread("ann", thread.id, "  Second name  ")).ok, true);
  const named = await getThreadById("bob", thread.id);
  assert.equal(named.ok && named.thread.title, "Second name", "titles are trimmed");
  assert.equal((await renameThread("ann", thread.id, "   ")).ok, true);
  const cleared = await getThreadById("bob", thread.id);
  assert.equal(cleared.ok && cleared.thread.title, null, "an empty name clears it rather than storing blanks");

  // A DM is the two-member case of the same model — which is exactly why it is
  // not a group you can grow, rename or walk out of.
  await sendMessage("ann", "bob", "hey", false);
  const dm = threadIdFor("ann", "bob");
  const grown = await inviteToThread("ann", dm, "admin");
  assert.equal(grown.ok, false);
  assert.equal(grown.ok === false && grown.status, 400);
  assert.equal((await renameThread("ann", dm, "nope")).ok, false);
  assert.equal((await leaveThread("ann", dm)).ok, false);
});

/* ============================== 4. the member cap =============================== */

test("the member cap comes from the policy seam, and says so when nothing installed one", async () => {
  await stagedRoster(["ann", "Ann"], ["bob", "Bob"], ["cal", "Cal"]);

  const absent = threadMemberCapStatus();
  assert.equal(absent.installed, false, "an uninstalled cascade is a STATED fact, not a pass");
  assert.match(absent.installed === false ? absent.why : "", /site default/);
  assert.equal(await threadMemberCap("ann"), THREAD_MEMBERS_MAX);

  try {
    setThreadMemberCapSource(() => 2);
    assert.equal(threadMemberCapStatus().installed, true);
    assert.equal(await threadMemberCap("ann"), 2);

    // Two members is a DM-sized room: Ann + Bob fits, Ann + Bob + Cal does not.
    assert.equal((await createGroup("ann", "Pair", ["bob"])).ok, true);
    const overfull = await createGroup("ann", "Trio", ["bob", "cal"]);
    assert.equal(overfull.ok, false);
    assert.equal(overfull.ok === false && overfull.status, 409);
    assert.match(overfull.ok === false ? overfull.error : "", /at most 2 members/);

    // The same cap bites on the way in, not only at creation.
    const pair = await group("ann", "Pair two", ["bob"]);
    const third = await inviteToThread("ann", pair.id, "cal");
    assert.equal(third.ok, false);
    assert.equal(third.ok === false && third.status, 409);

    // A cascade's answer is CLAMPED, never trusted as a policy: below the floor
    // is not a group, above the ceiling is not a document you can rewrite per
    // send, and junk is not a number.
    setThreadMemberCapSource(() => 0);
    assert.equal(await threadMemberCap("ann"), 2);
    setThreadMemberCapSource(() => 10_000);
    assert.equal(await threadMemberCap("ann"), THREAD_MEMBERS_CEILING);
    setThreadMemberCapSource(() => Number.NaN);
    assert.equal(await threadMemberCap("ann"), THREAD_MEMBERS_MAX);

    // A cascade that throws must not take group chat down with it.
    setThreadMemberCapSource(() => {
      throw new Error("policy store is on fire");
    });
    assert.equal(await threadMemberCap("ann"), THREAD_MEMBERS_MAX);
    assert.equal((await createGroup("ann", "Still works", ["bob", "cal"])).ok, true);
  } finally {
    setThreadMemberCapSource(null);
  }
});

/* ================================ 5. paged history ============================== */

test("history is paged by cursor, and the page is sought rather than walked", async () => {
  await stagedRoster(["ann", "Ann"], ["bob", "Bob"]);
  const thread = await group("ann", "Long one", ["bob"]);
  for (let i = 1; i <= 25; i += 1) await sendToThread("ann", thread.id, `m${i}`, []);

  // No limit → the whole thread, exactly as the pre-groups wire returned it.
  const whole = await getThreadById("bob", thread.id);
  assert.equal(whole.ok && whole.thread.messages.length, 25);
  assert.equal(whole.ok && whole.page.total, 25);
  assert.equal(whole.ok && whole.page.nextCursor, null);

  const first = await getThreadById("bob", thread.id, { limit: 10 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(
    first.page.messages.map((m) => m.text),
    ["m16", "m17", "m18", "m19", "m20", "m21", "m22", "m23", "m24", "m25"],
    "newest-first paging: the page you open on is the END of the conversation",
  );
  assert.equal(first.page.total, 25);
  assert.equal(first.thread.messages.length, 10, "the thread carries the page it was asked for");

  const second = await getThreadById("bob", thread.id, { limit: 10, cursor: first.page.nextCursor });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepEqual(
    second.page.messages.map((m) => m.text),
    ["m6", "m7", "m8", "m9", "m10", "m11", "m12", "m13", "m14", "m15"],
  );

  const third = await getThreadById("bob", thread.id, { limit: 10, cursor: second.page.nextCursor });
  assert.equal(third.ok, true);
  if (!third.ok) return;
  assert.deepEqual(
    third.page.messages.map((m) => m.text),
    ["m1", "m2", "m3", "m4", "m5"],
  );
  assert.equal(third.page.nextCursor, null, "null is the beginning of the conversation");

  // Paging is a READ of history and nothing more: it must not decide that a
  // member has received a message they were never shown.
  assert.equal(third.deliveredNow, 0, "the first page already delivered everything");
});

test("a thread id is not a directory of which rooms exist", async () => {
  await stagedRoster(["ann", "Ann"], ["bob", "Bob"], ["cal", "Cal"]);
  const thread = await group("ann", "Private", ["bob"]);

  const outsider = await getThreadById("cal", thread.id);
  const absent = await getThreadById("cal", "g-00000000000000000000000000000000");
  assert.equal(outsider.ok, false);
  assert.deepEqual(outsider, absent, "a room you are not in and a room that is not there answer alike");

  const wrote = await sendToThread("cal", thread.id, "let me in", []);
  assert.equal(wrote.ok, false);
  assert.equal(wrote.ok === false && wrote.status, 404);
});
