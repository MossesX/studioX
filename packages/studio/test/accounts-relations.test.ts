/**
 * @file The social graph and THE guard — `lib/relations` through its public
 * surface, plus the two consumers P4 wired (`lib/messages` → `sendMessage`,
 * `lib/profiles` → `getProfile`/`listProfiles`).
 *
 * Staged exactly as `test/accounts-store.test.ts` stages the other three
 * stores: the real store over a throwaway root, driven in the order the app
 * drives it, with `ACCOUNTS_DATA_DIR` re-pointed per test so nothing leaks
 * between them.
 *
 * Most of this file exists for ONE property, and it is the property no other
 * check can see:
 *
 * **A block is silent, and silence has no error message to grep for.** Every
 * other rule here fails loudly when it breaks — a buddy edge that does not
 * mirror shows up on a buddy list immediately. But if a future consumer
 * renders `blocked` as its own distinct refusal ("you have been blocked",
 * or merely a 403 where an absent member gets a 404), nothing goes red, no
 * screen looks wrong, and the feature is quietly defeated: a blocked member
 * probes the endpoint and learns exactly what the block existed to withhold.
 * So the assertions below compare the blocked refusal to the nonexistent-member
 * refusal FIELD BY FIELD rather than pattern-matching either one — a test that
 * asserted the wording would still pass on the day the two wordings drift.
 *
 * The other claim worth stating: `canInteract` is synchronous and re-reads the
 * document per call, so a block binds on the very NEXT interaction. That is
 * proved by blocking between two sends rather than by inspecting the store.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { addUser, changePassword, setScreenname } from "@axs/modules/accounts/lib/accounts";
import {
  acceptBuddy,
  blockUser,
  canInteract,
  forgetRelations,
  listRelations,
  relationsFor,
  removeRelation,
  requestBuddy,
  setBuddiesOnly,
  unblockUser,
} from "@axs/modules/accounts/lib/relations";
import { sendMessage } from "@axs/modules/accounts/lib/messages";
import { getProfile, listProfiles } from "@axs/modules/accounts/lib/profiles";
import { presenceSnapshot } from "@axs/modules/accounts/lib/presence";
import { relationsFile } from "@axs/modules/accounts/lib/paths";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];

function freshStore(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axs-relations-"));
  roots.push(root);
  process.env.ACCOUNTS_DATA_DIR = root;
  return root;
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** An admin-created member, through their own entry flow. */
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
async function stagedRoster(): Promise<void> {
  freshStore();
  const changed = await changePassword("admin", "amberx", "gatekeeper");
  assert.equal(changed.ok, true, "the seeded temp password must open the entry flow");
}

/** Names on a buddy-list row set, for order-independent comparison. */
const names = (rows: { username: string }[]): string[] => rows.map((r) => r.username).sort();

/* --------------------------------- buddies ----------------------------------- */

test("a buddy edge is mutual, and it takes both people to make one", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");

  const asked = await requestBuddy("ann", "bob");
  assert.equal(asked.ok, true);

  // Pending is one-directional in APPEARANCE and one edge in fact.
  assert.deepEqual(names((await listRelations("ann")).outgoing), ["bob"]);
  assert.deepEqual(names((await listRelations("bob")).incoming), ["ann"]);
  assert.deepEqual(names((await listRelations("ann")).buddies), [], "a request is not a buddy");
  assert.deepEqual(names((await listRelations("bob")).buddies), []);

  const accepted = await acceptBuddy("bob", "ann");
  assert.equal(accepted.ok, true);

  // Mutual, in ONE write — neither side can be a buddy alone.
  assert.deepEqual(names((await listRelations("ann")).buddies), ["bob"]);
  assert.deepEqual(names((await listRelations("bob")).buddies), ["ann"]);
  assert.deepEqual(names((await listRelations("ann")).outgoing), [], "the pending edge is consumed");
  assert.deepEqual(names((await listRelations("bob")).incoming), []);
});

test("two people who ask each other are buddies — the second request IS the accept", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");

  await requestBuddy("ann", "bob");
  const crossed = await requestBuddy("bob", "ann");
  assert.equal(crossed.ok, true);

  assert.deepEqual(names((await listRelations("ann")).buddies), ["bob"]);
  assert.deepEqual(names((await listRelations("bob")).buddies), ["ann"]);
  assert.deepEqual(
    names((await listRelations("bob")).outgoing),
    [],
    "asking somebody who already asked you must not leave a request hanging",
  );
});

test("removeRelation is ONE verb for decline, cancel and unfriend", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");

  // decline — the asked party severs
  await requestBuddy("ann", "bob");
  assert.equal((await removeRelation("bob", "ann")).ok, true);
  assert.deepEqual(names((await listRelations("ann")).outgoing), [], "declining clears the asker too");

  // cancel — the asker severs their own request
  await requestBuddy("ann", "bob");
  assert.equal((await removeRelation("ann", "bob")).ok, true);
  assert.deepEqual(names((await listRelations("bob")).incoming), []);

  // unfriend — a full buddy edge, severed from one side, gone from both
  await requestBuddy("ann", "bob");
  await acceptBuddy("bob", "ann");
  assert.equal((await removeRelation("ann", "bob")).ok, true);
  assert.deepEqual(names((await listRelations("ann")).buddies), []);
  assert.deepEqual(names((await listRelations("bob")).buddies), [], "unfriending is mutual");

  // idempotent — severing nothing is a success, not a 404 that tells you the
  // edge was already gone.
  assert.equal((await removeRelation("ann", "bob")).ok, true);
});

/* ---------------------------------- the guard --------------------------------- */

test("canInteract answers ok / blocked / not-buddy-required, and blocks refuse BOTH ways", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");

  assert.deepEqual(canInteract("ann", "bob"), { ok: true }, "a studio is open by default");

  await blockUser("ann", "bob");

  assert.deepEqual(canInteract("bob", "ann"), { ok: false, reason: "blocked" }, "the blocked cannot reach the blocker");
  assert.deepEqual(
    canInteract("ann", "bob"),
    { ok: false, reason: "blocked" },
    "and the blocker gets no one-way channel into somebody they refused",
  );

  await unblockUser("ann", "bob");
  await setBuddiesOnly("bob", true);

  assert.deepEqual(canInteract("ann", "bob"), { ok: false, reason: "not-buddy-required" });
  assert.deepEqual(canInteract("bob", "ann"), { ok: true }, "buddiesOnly is the SUBJECT's switch, not a mutual wall");

  await requestBuddy("ann", "bob");
  await acceptBuddy("bob", "ann");
  assert.deepEqual(canInteract("ann", "bob"), { ok: true }, "a buddy satisfies buddies-only");
});

test("a block severs every edge in the same write, and unblocking restores none of them", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");
  await requestBuddy("ann", "bob");
  await acceptBuddy("bob", "ann");

  await blockUser("ann", "bob");

  assert.deepEqual(names((await listRelations("ann")).buddies), [], "the blocked cannot linger on the blocker's list");
  assert.deepEqual(names((await listRelations("bob")).buddies), []);
  assert.deepEqual(names((await listRelations("ann")).blocked), ["bob"]);

  await unblockUser("ann", "bob");

  assert.deepEqual(canInteract("ann", "bob"), { ok: true }, "the pair can interact again");
  assert.deepEqual(
    names((await listRelations("ann")).buddies),
    [],
    "consent is re-given by asking, never by the absence of a refusal",
  );
});

test("being blocked does not stop you blocking back", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");

  await blockUser("ann", "bob");
  const back = await blockUser("bob", "ann");

  assert.equal(back.ok, true, "the guard is not consulted here, or a mutual block is unreachable from side two");
  assert.deepEqual(names((await listRelations("bob")).blocked), ["ann"]);
});

/* ------------------------------- the silence ----------------------------------- */

test("a block NEVER announces itself: the blocked party is not in any notify list", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");
  await requestBuddy("ann", "bob");
  await acceptBuddy("bob", "ann");

  const blocked = await blockUser("ann", "bob");
  assert.equal(blocked.ok, true);
  assert.deepEqual(
    blocked.ok ? blocked.notify : null,
    ["ann"],
    "the blocked member's client learns nothing in the moment — a nudge to bob IS the announcement",
  );

  const unblocked = await unblockUser("ann", "bob");
  assert.deepEqual(
    unblocked.ok ? unblocked.notify : null,
    ["ann"],
    "telling somebody they were unblocked tells them they were blocked",
  );

  // An ordinary unfriending, by contrast, is not a secret — and it is what a
  // block is disguised as, so it MUST tell the other side.
  await requestBuddy("ann", "bob");
  await acceptBuddy("bob", "ann");
  const removed = await removeRelation("ann", "bob");
  assert.deepEqual((removed.ok ? removed.notify : []).sort(), ["ann", "bob"]);
});

test("a blocked sender gets the refusal of a member who does not exist, field for field", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");

  await blockUser("ann", "bob");

  const toBlocker = await sendMessage("bob", "ann", "hello?", false);
  const toGhost = await sendMessage("bob", "nobody-at-all", "hello?", false);

  assert.equal(toBlocker.ok, false);
  assert.equal(toGhost.ok, false);
  // Compared as whole objects on purpose: asserting the wording would pass on
  // the day the two wordings drift, which is the day the block starts leaking.
  assert.deepEqual(
    toBlocker,
    toGhost,
    "a probe that can tell 'blocked' from 'never existed' has defeated the silence",
  );

  // ...and the same refusal reaches the BLOCKER, who also may not send.
  assert.deepEqual(await sendMessage("ann", "bob", "still there?", false), toGhost);
});

test("a buddies-only refusal, unlike a block, is a stated policy and may name itself", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");
  await setBuddiesOnly("bob", true);

  const refused = await sendMessage("ann", "bob", "hi", false);

  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.status, 403, "403 — stated policy, not the 404 cover story");
  assert.match(
    refused.ok === false ? refused.error : "",
    /buddies/i,
    "the member chose this publicly, so the refusal explains itself",
  );
});

test("the guard binds on the very NEXT send — nothing is cached", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");

  const before = await sendMessage("ann", "bob", "first", false);
  assert.equal(before.ok, true, "an open studio delivers");

  await blockUser("bob", "ann");

  const after = await sendMessage("ann", "bob", "second", false);
  assert.equal(after.ok, false, "a cached verdict would still be sending messages into a blocked thread");
});

/* ------------------------------ profile visibility ------------------------------ */

test("a blocked viewer sees the profile of a member who does not exist: null", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");

  assert.notEqual(await getProfile("bob", "ann"), null, "an open studio shows the face");

  await blockUser("ann", "bob");

  assert.equal(await getProfile("bob", "ann"), null, "blocked reads as gone");
  assert.equal(await getProfile("bob", "nobody-at-all"), null, "...which is what gone reads as");
  assert.equal(
    (await listProfiles("bob")).some((p) => p.username === "ann"),
    false,
    "and blocked is simply absent from the list, exactly as a disabled account is",
  );
  assert.notEqual(
    await getProfile("ann", "ann"),
    null,
    "the blocker still sees their own profile — a block is not a self-mute",
  );
});

test("buddies-only hides nothing: a profile is the public face of an account", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");
  await setBuddiesOnly("ann", true);

  assert.notEqual(
    await getProfile("bob", "ann"),
    null,
    "only `blocked` hides — a buddies-only member still HAS a profile",
  );
});

test("the presence roster is deliberately NOT filtered by blocks", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");
  await blockUser("ann", "bob");

  const roster = await presenceSnapshot();

  assert.equal(
    roster.some((p) => p.username === "ann"),
    true,
    "the roster is a membership list — the same thing /api/accounts/users already gives every member. " +
      "Blocks hide the PROFILE and refuse every interaction; they do not claim the account was never created",
  );
});

/* --------------------------------- housekeeping --------------------------------- */

test("a junk relations file reads as an empty graph rather than locking everybody out", async () => {
  const root = await stagedRoster().then(() => process.env.ACCOUNTS_DATA_DIR as string);
  await member("ann", "Ann");
  await member("bob", "Bob");
  await blockUser("ann", "bob");

  fs.writeFileSync(relationsFile(), "{ not json at all", "utf8");

  assert.deepEqual(
    canInteract("ann", "bob"),
    { ok: true },
    "degrade never crash — an unreadable graph must refuse nothing, not refuse everything",
  );
  assert.deepEqual(relationsFor("ann").blocked, []);
  assert.equal(typeof root, "string");
});

test("a hand-edited graph is normalized on read, not trusted", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");

  fs.writeFileSync(
    relationsFile(),
    JSON.stringify({
      version: 1,
      users: {
        // Mixed case, self-reference, duplicates and a number in the list.
        ANN: { buddies: ["BOB", "bob", "ann", 42], outgoing: null, incoming: [], blocked: [], buddiesOnly: "yes" },
      },
      updatedAt: new Date().toISOString(),
    }),
    "utf8",
  );

  const rec = relationsFor("ann");
  assert.deepEqual(rec.buddies, ["bob"], "lowercased, de-duplicated, non-strings dropped, self removed");
  assert.deepEqual(rec.outgoing, [], "a null list is an empty list, not a crash");
  assert.equal(rec.buddiesOnly, false, "only a literal true turns the switch on");
});

test("forgetting a member drops every edge pointing AT them — usernames are re-usable", async () => {
  await stagedRoster();
  await member("ann", "Ann");
  await member("bob", "Bob");
  await member("cat", "Cat");
  await requestBuddy("ann", "bob");
  await acceptBuddy("bob", "ann");
  await blockUser("cat", "bob");

  const touched = await forgetRelations("bob");
  assert.ok(touched > 0);

  assert.deepEqual(names((await listRelations("ann")).buddies), [], "a new 'bob' must not inherit the old one's buddies");
  assert.deepEqual(
    relationsFor("cat").blocked,
    [],
    "...nor the old one's blocks, silently refusing people they never met",
  );
  assert.deepEqual(relationsFor("bob"), {
    buddies: [],
    outgoing: [],
    incoming: [],
    blocked: [],
    buddiesOnly: false,
  });
});
