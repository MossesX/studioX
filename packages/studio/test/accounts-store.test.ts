/**
 * @file The accounts module's three stores, through their PUBLIC surface only —
 * `lib/accounts` (seed + credentials), `lib/permissions` (the grants the
 * matrix writes and BootedHost reads) and `lib/messages` (DM threads, unread
 * counts, the per-thread cap).
 *
 * Staged the way `test/pack-persistence.test.ts` stages a store: the real
 * store, over a throwaway root, exercised in the order the app drives it.
 * `lib/paths` reads `ACCOUNTS_DATA_DIR` per call and never latches it at
 * import, which is what lets each test below start from an empty disk without
 * module-cache games — so every test opens with `freshStore()` and the one
 * after it cannot see what the one before it wrote.
 *
 * Two claims here can only be made against the filesystem, and are the reason
 * this file is not a set of unit tests over in-memory objects:
 *
 * - **Nothing is cached.** `effectivePermissions()` re-reads both stores per
 *   call, so a revocation binds on the very next read. It is proved by editing
 *   `permissions.json` on disk BEHIND the store and asking again — a cache
 *   would still answer "allowed", and a session token's role claim is
 *   advisory precisely because of this.
 * - **The cap is asserted on load, not only on the way in.** A hand-edited
 *   over-cap thread is trimmed by the next send and by the admin sweep, which
 *   is the only shape in which `pruneMessages` ever finds work.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  addUser,
  changePassword,
  findAccount,
  listAccounts,
  removeUser,
  setScreenname,
  updateUser,
  verifyLogin,
} from "@axs/modules/accounts/lib/accounts";
import {
  effectivePermissions,
  grantsFor,
  readGrants,
  setCapability,
  setModuleGrant,
} from "@axs/modules/accounts/lib/permissions";
import {
  getThread,
  listThreads,
  pruneMessages,
  sendMessage,
} from "@axs/modules/accounts/lib/messages";
import { permissionsFile, messagesDir } from "@axs/modules/accounts/lib/paths";
import { THREAD_MESSAGES_MAX, threadIdFor } from "@axs/modules/accounts/lib/types";
import type { Message, Thread } from "@axs/modules/accounts/lib/types";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];

/** Point the whole store layout at an empty directory. */
function freshStore(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axs-accounts-"));
  roots.push(root);
  process.env.ACCOUNTS_DATA_DIR = root;
  return root;
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** The seeded administrator, through the entry flow so admin gates open. */
const ADMIN_PASSWORD = "gatekeeper";
async function signedInAdmin(): Promise<string> {
  const changed = await changePassword("admin", "amberx", ADMIN_PASSWORD);
  assert.equal(changed.ok, true, "the seeded temp password must open the entry flow");
  return "admin";
}

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

/* ---------------------------------- seed ------------------------------------- */

test("first read of an empty store seeds exactly one administrator", async () => {
  freshStore();

  const accounts = await listAccounts();

  assert.equal(accounts.length, 1);
  const [admin] = accounts;
  assert.equal(admin.username, "admin");
  assert.equal(admin.role, "administrator");
  assert.equal(admin.screenname, "Administrator");
  assert.equal(admin.createdBy, "seed");
  assert.equal(
    admin.mustChangePassword,
    true,
    "the seed credential is a TEMP password — first login is forced through change-password",
  );
  assert.match(admin.passwordHash, /^scrypt\$n=\d+,r=\d+,p=\d+\$/);
  assert.equal(
    admin.passwordHash.includes("amberx"),
    false,
    "no plaintext password exists anywhere in the store",
  );
});

test("a mangled store re-seeds instead of locking everybody out", async () => {
  const root = freshStore();
  await listAccounts();
  fs.writeFileSync(path.join(root, "accounts.json"), "{ not json at all", "utf8");

  const accounts = await listAccounts();

  assert.equal(accounts.length, 1, "degrade never crash — the honest empty is re-seeded");
  assert.equal(accounts[0].username, "admin");
});

/* ---------------------------------- login ------------------------------------ */

test("login verifies the real credential and refuses everything else", async () => {
  freshStore();

  const good = await verifyLogin("admin", "amberx");
  assert.equal(good.ok, true);
  assert.equal(good.ok && good.account.username, "admin");

  const wrong = await verifyLogin("admin", "not-the-password");
  assert.equal(wrong.ok, false);
  assert.equal(wrong.ok === false && wrong.status, 401);

  const unknown = await verifyLogin("nobody-at-all", "anything");
  assert.equal(unknown.ok, false);
  assert.equal(
    unknown.ok === false && unknown.error,
    "invalid password",
    "an unknown user answers exactly what a wrong password answers — no account probe",
  );

  // Case folding is the store's, not the caller's.
  assert.equal((await verifyLogin("ADMIN", "amberx")).ok, true);
});

test("login stamps lastLoginAt; a disabled account cannot sign in at all", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");

  assert.equal((await findAccount("molly"))?.lastLoginAt, undefined);
  assert.equal((await verifyLogin("molly", "molly-real-pw")).ok, true);
  assert.equal(typeof (await findAccount("molly"))?.lastLoginAt, "string");

  const disabled = await updateUser("admin", "molly", { disabled: true });
  assert.equal(disabled.ok, true);
  const after = await verifyLogin("molly", "molly-real-pw");
  assert.equal(after.ok, false);
  assert.equal(after.ok === false && after.status, 401);
});

test("an administrator cannot strand the store by demoting or removing themselves", async () => {
  freshStore();
  await signedInAdmin();

  const demote = await updateUser("admin", "admin", { role: "member" });
  assert.equal(demote.ok, false);
  assert.equal(demote.ok === false && demote.status, 409);

  const remove = await removeUser("admin", "admin");
  assert.equal(remove.ok, false);
  assert.equal(remove.ok === false && remove.status, 409);

  assert.equal((await findAccount("admin"))?.role, "administrator");
});

/* ------------------------------- permissions --------------------------------- */

test("an unlisted user default-ALLOWS — a single-operator studio stays open", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");

  assert.deepEqual(readGrants(), {}, "nothing is recorded until an administrator decides something");

  const verdict = await effectivePermissions("molly");
  assert.equal(verdict.administrator, false);
  assert.deepEqual(verdict.deniedModules, []);
  assert.equal(verdict.canMessage, true);
  assert.equal(verdict.canEditProfile, true);
});

test("revoking a module binds on the very next read, and allowing forgets the key", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");

  const revoked = await setModuleGrant("admin", "molly", "taskman", false);
  assert.equal(revoked.ok, true);
  assert.deepEqual((await effectivePermissions("molly")).deniedModules, ["taskman"]);

  await setModuleGrant("admin", "molly", "expenses", false);
  assert.deepEqual(
    (await effectivePermissions("molly")).deniedModules,
    ["expenses", "taskman"],
    "the verdict is sorted, so a UI diff of it is stable",
  );

  await setModuleGrant("admin", "molly", "taskman", true);
  assert.deepEqual((await effectivePermissions("molly")).deniedModules, ["expenses"]);
  assert.equal(
    "taskman" in grantsFor("molly").modules,
    false,
    "allowing DELETES the key — absent-means-allowed is the contract, and the file stays a record of DECISIONS",
  );
});

test("administrators pass every check regardless of what the file says", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");

  await setModuleGrant("admin", "molly", "taskman", false);
  await setCapability("admin", "molly", "canMessage", false);

  // Same recorded grants, but the role changes the verdict.
  const before = await effectivePermissions("molly");
  assert.deepEqual(before.deniedModules, ["taskman"]);
  assert.equal(before.canMessage, false);

  assert.equal((await updateUser("admin", "molly", { role: "administrator" })).ok, true);

  const after = await effectivePermissions("molly");
  assert.equal(after.administrator, true);
  assert.deepEqual(after.deniedModules, [], "a promotion is not a permissions edit, and does not need to be");
  assert.equal(after.canMessage, true);
  assert.deepEqual(
    grantsFor("molly").modules,
    { taskman: false },
    "the stored decision survives the promotion — a demotion re-imposes it",
  );
});

test("nothing is cached: a grants file edited behind the store binds immediately", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");

  assert.deepEqual((await effectivePermissions("molly")).deniedModules, []);

  // Behind the store's back, on purpose — this is what a cache would miss.
  fs.writeFileSync(
    permissionsFile(),
    JSON.stringify({
      version: 1,
      grants: { molly: { modules: { amberart: false }, capabilities: { canMessage: false, canEditProfile: true } } },
    }),
    "utf8",
  );

  const verdict = await effectivePermissions("molly");
  assert.deepEqual(verdict.deniedModules, ["amberart"]);
  assert.equal(verdict.canMessage, false);
});

test("a junk grants file reads as 'nothing recorded', which is a fully open studio", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");
  await setModuleGrant("admin", "molly", "taskman", false);

  fs.writeFileSync(permissionsFile(), "}{ garbage", "utf8");

  assert.deepEqual(readGrants(), {});
  assert.deepEqual(
    (await effectivePermissions("molly")).deniedModules,
    [],
    "the degrade verdict is the same one a fresh studio gives — never a lock-out",
  );
});

test("only an administrator who finished their own entry flow may edit grants", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");

  const byMember = await setModuleGrant("molly", "molly", "taskman", false);
  assert.equal(byMember.ok, false);
  assert.equal(byMember.ok === false && byMember.status, 403);

  const noSuchTarget = await setModuleGrant("admin", "ghost", "taskman", false);
  assert.equal(noSuchTarget.ok, false);
  assert.equal(noSuchTarget.ok === false && noSuchTarget.status, 404);

  const notAModuleId = await setModuleGrant("admin", "molly", "../etc", false);
  assert.equal(notAModuleId.ok, false);
  assert.equal(notAModuleId.ok === false && notAModuleId.status, 400);

  assert.deepEqual(readGrants(), {}, "not one refused call wrote anything");
});

/* --------------------------------- messaging ---------------------------------- */

test("a DM round-trip: queue offline, deliver on the next fetch, then read", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");
  await member("amber", "Amber");

  // Amber is signed out — the offline queue IS the thread file.
  const sent = await sendMessage("molly", "amber", "yo, the gate went green", false);
  assert.equal(sent.ok, true);
  assert.equal(sent.ok && sent.created, true);
  assert.equal(sent.ok && sent.message.deliveredAt, null, "queued, not delivered");

  // Molly sees her own outgoing line, and owes herself nothing.
  const mollySide = await listThreads("molly");
  assert.equal(mollySide.threads.length, 1);
  assert.equal(mollySide.threads[0].with, "amber");
  assert.equal(mollySide.unread, 0, "your own message is never your unread");

  // Amber's first fetch after login is the delivery moment.
  const amberFirst = await listThreads("amber");
  assert.equal(amberFirst.deliveredNow, 1, "the offline queue lands on the first fetch");
  assert.equal(amberFirst.unread, 1, "delivered is not read");
  assert.equal(amberFirst.threads[0].unread, 1);
  assert.notEqual(amberFirst.threads[0].lastMessage?.deliveredAt, null);

  // ...and it is a one-time stamp, persisted.
  assert.equal((await listThreads("amber")).deliveredNow, 0);

  // Opening the conversation is what marks it read.
  const opened = await getThread("amber", "molly", { markRead: true });
  assert.equal(opened.ok, true);
  assert.equal(opened.ok && opened.thread.messages.length, 1);
  assert.notEqual(opened.ok && opened.thread.messages[0].readAt, null);
  assert.equal((await listThreads("amber")).unread, 0);

  // A live recipient is delivered in the same moment — no queue at all.
  const reply = await sendMessage("amber", "molly", "448 of 448, nice", true);
  assert.equal(reply.ok, true);
  assert.equal(reply.ok && reply.created, false, "same pair, same thread");
  assert.notEqual(reply.ok && reply.message.deliveredAt, null);
  assert.equal((await listThreads("molly")).unread, 1);

  // Order-independent id: one file for the pair, whoever spoke first.
  assert.equal(threadIdFor("amber", "molly"), threadIdFor("molly", "amber"));
  assert.deepEqual(fs.readdirSync(messagesDir()), [`${threadIdFor("molly", "amber")}.json`]);
});

test("a conversation is readable only by its participants", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");
  await member("amber", "Amber");
  await member("lenny", "Lenny");
  await sendMessage("molly", "amber", "between us", false);

  assert.equal((await listThreads("lenny")).threads.length, 0);
  const asOutsider = await getThread("lenny", "amber");
  assert.equal(asOutsider.ok, true, "an outsider gets their OWN empty thread with amber");
  assert.equal(asOutsider.ok && asOutsider.thread.messages.length, 0);
});

test("revoking canMessage refuses the very next send", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");
  await member("amber", "Amber");

  assert.equal((await sendMessage("molly", "amber", "first", false)).ok, true);

  assert.equal((await setCapability("admin", "molly", "canMessage", false)).ok, true);

  const refused = await sendMessage("molly", "amber", "second", false);
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.status, 403);

  // The other direction is untouched — the capability is per-user, not per-thread.
  assert.equal((await sendMessage("amber", "molly", "still fine", false)).ok, true);
});

test("empty, oversized, self-addressed and disabled-recipient sends all refuse", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");
  await member("amber", "Amber");

  assert.equal((await sendMessage("molly", "amber", "   ", false)).ok, false);
  assert.equal((await sendMessage("molly", "amber", "x".repeat(4001), false)).ok, false);
  assert.equal((await sendMessage("molly", "molly", "hi me", false)).ok, false);

  await updateUser("admin", "amber", { disabled: true });
  const toDisabled = await sendMessage("molly", "amber", "you there?", false);
  assert.equal(toDisabled.ok, false);
  assert.equal(toDisabled.ok === false && toDisabled.status, 404);

  assert.equal(fs.existsSync(messagesDir()) && fs.readdirSync(messagesDir()).length, 0);
});

/* ----------------------------------- the cap ------------------------------------ */

/**
 * The PRE-GROUPS thread document, exactly as the store wrote it before P5 —
 * `participants` as a pair, no `members`, no `kind`, no `nextSeq`, and no `seq`
 * on a message. Written out here rather than annotated as `Thread` because it
 * is deliberately NOT the current shape: this is a legacy file on disk, and
 * typing it as today's would hide the day it stops being readable.
 */
interface LegacyThread {
  version: 1;
  id: string;
  participants: [string, string];
  messages: Array<Omit<Message, "seq">>;
  createdAt: string;
  updatedAt: string;
}

/** Write a thread straight to disk with `count` messages from `from` to `to` —
 *  the hand-edited (or post-cap-change) store `pruneMessages` exists for. */
function stageOverCapThread(from: string, to: string, count: number): string {
  const id = threadIdFor(from, to);
  const messages: Array<Omit<Message, "seq">> = Array.from({ length: count }, (_, i) => ({
    id: `staged-${i}`,
    threadId: id,
    from,
    to,
    text: `line ${i}`,
    sentAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    deliveredAt: null,
    readAt: null,
  }));
  const thread: LegacyThread = {
    version: 1,
    id,
    participants: [from, to].sort() as [string, string],
    messages,
    createdAt: messages[0].sentAt,
    updatedAt: messages[messages.length - 1].sentAt,
  };
  fs.mkdirSync(messagesDir(), { recursive: true });
  fs.writeFileSync(path.join(messagesDir(), `${id}.json`), JSON.stringify(thread), "utf8");
  return id;
}

function readStagedThread(id: string): Thread {
  return JSON.parse(fs.readFileSync(path.join(messagesDir(), `${id}.json`), "utf8")) as Thread;
}

test("a send trims the thread back to the cap inline, oldest first", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");
  await member("amber", "Amber");
  const id = stageOverCapThread("molly", "amber", THREAD_MESSAGES_MAX + 5);

  const sent = await sendMessage("amber", "molly", "one more", false);
  assert.equal(sent.ok, true);

  const thread = readStagedThread(id);
  assert.equal(thread.messages.length, THREAD_MESSAGES_MAX);
  assert.equal(
    thread.messages[0].text,
    "line 6",
    "six rolled off the FRONT — the five over the cap plus the one the new message displaced",
  );
  assert.equal(thread.messages[thread.messages.length - 1].text, "one more", "the newest always survives");
});

test("the admin sweep re-asserts the cap, and finds nothing to do on a healthy store", async () => {
  freshStore();
  const admin = await signedInAdmin();
  await member("molly", "Molly");
  await member("amber", "Amber");
  await member("lenny", "Lenny");
  const over = stageOverCapThread("molly", "amber", THREAD_MESSAGES_MAX + 12);
  const healthy = stageOverCapThread("molly", "lenny", 3);

  const swept = await pruneMessages(admin);
  assert.equal(swept.ok, true);
  assert.equal(swept.ok && swept.threadsTouched, 1, "only the over-cap thread is work");
  assert.equal(swept.ok && swept.messagesRemoved, 12);

  assert.equal(readStagedThread(over).messages.length, THREAD_MESSAGES_MAX);
  assert.equal(readStagedThread(over).messages[0].text, "line 12");
  assert.equal(readStagedThread(healthy).messages.length, 3, "a thread under the cap is never touched");

  const again = await pruneMessages(admin);
  assert.equal(again.ok && again.threadsTouched, 0, "the sweep is idempotent");
  assert.equal(again.ok && again.messagesRemoved, 0);
});

test("only an administrator may sweep", async () => {
  freshStore();
  await signedInAdmin();
  await member("molly", "Molly");
  await member("amber", "Amber");
  stageOverCapThread("molly", "amber", THREAD_MESSAGES_MAX + 4);

  const refused = await pruneMessages("molly");
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.status, 403);
  assert.equal(
    readStagedThread(threadIdFor("molly", "amber")).messages.length,
    THREAD_MESSAGES_MAX + 4,
    "a refused sweep is a sweep that did not run",
  );
});
