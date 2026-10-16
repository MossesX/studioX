/**
 * @file The P6 message migration — amberxvid's retired conversation store
 * drained into the accounts one, and the accounts store READING BACK what
 * landed.
 *
 * Everything happens under fresh temp roots via `AMBERXVID_DATA_DIR` and
 * `ACCOUNTS_DATA_DIR`, which both `lib/paths` read per call rather than
 * latching at import; nothing here can reach the real stores.
 *
 * The properties worth the most, in order:
 *
 * 1. **What lands is readable BY THE ACCOUNTS STORE, with the right cursors.**
 *    The migration deliberately writes the pre-groups document shape and lets
 *    the accounts normaliser adopt it (see `lib/migrate-messages.ts`'s header) —
 *    which is a claim until the store is asked. So this test does not inspect
 *    the file it wrote: it calls `listThreads` and `getThreadById` and checks
 *    the UNREAD COUNT, because unread is what the reconstructed per-member
 *    cursors decide, and a cursor rebuilt wrong is invisible in the bytes.
 * 2. **Identities are mapped, and the thread id is REDERIVED from them.** A
 *    migration that copied the id across would file a renamed member's
 *    conversation under a pair that no longer exists.
 * 3. **It never merges.** A source thread whose accounts counterpart already
 *    exists is skipped with a reason and left in place — merging renumbers
 *    seqs, and a renumbered seq moves everybody's unread cursor.
 * 4. **It is idempotent and refuses to run before P1.** Both are ordering
 *    guarantees, and an ordering guarantee nobody has watched fail is one
 *    nobody has tested — so the refusal is triggered on purpose.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** The two roots, plus the accounts the store needs to answer at all. */
function roots(): { vid: string; accounts: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "axv-msgmig-"));
  const vid = path.join(base, "amberxvid");
  const accounts = path.join(base, "accounts");
  fs.mkdirSync(vid, { recursive: true });
  fs.mkdirSync(accounts, { recursive: true });
  const now = "2026-08-15T00:00:00.000Z";
  const account = (username: string) => ({
    username,
    role: "member",
    passwordHash: "scrypt$n=1,r=1,p=1$AA$AA",
    mustChangePassword: false,
    screenname: username,
    createdAt: now,
    updatedAt: now,
    createdBy: "seed",
  });
  writeJson(path.join(accounts, "accounts.json"), {
    version: 1,
    accounts: [account("alice"), account("bob")],
  });
  return { vid, accounts };
}

/** One legacy module thread, in the exact shape the retired store wrote. */
function legacyThread(a: string, b: string, texts: Array<{ from: string; to: string; read: boolean }>) {
  const id = [a.toLowerCase(), b.toLowerCase()].sort().join("--");
  return {
    version: 1,
    id,
    participants: [a.toLowerCase(), b.toLowerCase()].sort(),
    messages: texts.map((t, i) => ({
      id: `m${i}`,
      threadId: id,
      from: t.from,
      to: t.to,
      text: `line ${i}`,
      sentAt: `2026-08-1${i}T10:00:00.000Z`,
      deliveredAt: `2026-08-1${i}T10:00:01.000Z`,
      readAt: t.read ? `2026-08-1${i}T10:00:02.000Z` : null,
    })),
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
  };
}

async function withRoots<T>(vid: string, accounts: string, fn: () => Promise<T>): Promise<T> {
  const prevVid = process.env.AMBERXVID_DATA_DIR;
  const prevAcc = process.env.ACCOUNTS_DATA_DIR;
  process.env.AMBERXVID_DATA_DIR = vid;
  process.env.ACCOUNTS_DATA_DIR = accounts;
  process.env.AMBERXVID_SILENT_JOURNAL = "1";
  try {
    return await fn();
  } finally {
    if (prevVid === undefined) delete process.env.AMBERXVID_DATA_DIR;
    else process.env.AMBERXVID_DATA_DIR = prevVid;
    if (prevAcc === undefined) delete process.env.ACCOUNTS_DATA_DIR;
    else process.env.ACCOUNTS_DATA_DIR = prevAcc;
  }
}

/* ------------------------------- the migration -------------------------------- */

test("a migrated conversation is read back by the accounts store with its unread intact", async () => {
  const { vid, accounts } = roots();
  // Two messages TO alice: one she read, one she did not. The unread count is
  // the whole point — it comes from a cursor the normaliser reconstructs from
  // these per-message stamps, so it is the thing that proves the shape landed.
  writeJson(
    path.join(vid, "messages", "alice--bob.json"),
    legacyThread("alice", "bob", [
      { from: "bob", to: "alice", read: true },
      { from: "alice", to: "bob", read: true },
      { from: "bob", to: "alice", read: false },
    ]),
  );

  await withRoots(vid, accounts, async () => {
    const { migrateMessages } = await import("@axs/modules/amberxvid/lib/migrate-messages");
    const report = await migrateMessages();
    assert.equal(report.status, "migrated");
    assert.equal(report.moved.length, 1);
    assert.equal(report.messagesMigrated, 3);
    assert.equal(report.skipped.length, 0);

    // The original is KEPT, renamed — an audit compares against it.
    assert.ok(fs.existsSync(path.join(vid, "messages", "alice--bob.json.migrated")));
    assert.ok(!fs.existsSync(path.join(vid, "messages", "alice--bob.json")));

    // ...and the ACCOUNTS store answers about it, which is the real assertion.
    const store = await import("@axs/modules/accounts/lib/messages");
    const list = await store.listThreads("alice");
    assert.equal(list.threads.length, 1);
    assert.equal(list.threads[0].kind, "dm");
    assert.equal(list.threads[0].with, "bob");
    assert.equal(list.threads[0].unread, 1, "the one message alice never read");

    // Bob read everything addressed to him, so he owes nothing.
    const bobs = await store.listThreads("bob");
    assert.equal(bobs.threads[0].unread, 0);

    // Seqs were assigned by position and the pager can seek by them.
    const read = await store.getThreadById("alice", "alice--bob", { limit: 2 });
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.page.total, 3);
    assert.equal(read.page.messages.length, 2);
    // `nextCursor` is the seq to ask for the messages BEFORE — the first seq
    // ON this page, not the last one off it.
    assert.equal(read.page.nextCursor, 2, "the page starts at seq 2; seq 1 is older");
  });
});

test("usernames are mapped and the thread id is rederived from the mapped pair", async () => {
  const { vid, accounts } = roots();
  writeJson(
    path.join(vid, "messages", "al--bob.json"),
    legacyThread("al", "bob", [{ from: "al", to: "bob", read: false }]),
  );

  await withRoots(vid, accounts, async () => {
    const { migrateMessages } = await import("@axs/modules/amberxvid/lib/migrate-messages");
    const report = await migrateMessages({ identityMap: { al: "alice" } });
    assert.equal(report.status, "migrated");
    assert.equal(report.moved[0].sourceId, "al--bob");
    assert.equal(report.moved[0].threadId, "alice--bob", "the id follows the mapping");

    const doc = readJson<{ messages: Array<{ from: string; threadId: string }> }>(
      path.join(accounts, "messages", "alice--bob.json"),
    );
    assert.equal(doc.messages[0].from, "alice", "the sender is mapped too, not just the filename");
    assert.equal(doc.messages[0].threadId, "alice--bob");
  });
});

test("a thread the accounts store already has is skipped, never merged", async () => {
  const { vid, accounts } = roots();
  writeJson(
    path.join(vid, "messages", "alice--bob.json"),
    legacyThread("alice", "bob", [{ from: "bob", to: "alice", read: false }]),
  );
  // Something is already there — a real conversation these two had in the
  // studio messenger before the module's store was drained.
  writeJson(path.join(accounts, "messages", "alice--bob.json"), { version: 1, id: "alice--bob", messages: [] });
  const before = fs.readFileSync(path.join(accounts, "messages", "alice--bob.json"), "utf8");

  await withRoots(vid, accounts, async () => {
    const { migrateMessages } = await import("@axs/modules/amberxvid/lib/migrate-messages");
    const report = await migrateMessages();
    assert.equal(report.status, "nothing-to-migrate");
    assert.equal(report.moved.length, 0);
    assert.equal(report.skipped.length, 1);
    assert.match(report.skipped[0].why, /refused to merge/);

    // Neither side was touched.
    assert.equal(fs.readFileSync(path.join(accounts, "messages", "alice--bob.json"), "utf8"), before);
    assert.ok(fs.existsSync(path.join(vid, "messages", "alice--bob.json")));
  });
});

test("a second run is a no-op and the marker keeps the FIRST run's record", async () => {
  const { vid, accounts } = roots();
  writeJson(
    path.join(vid, "messages", "alice--bob.json"),
    legacyThread("alice", "bob", [{ from: "bob", to: "alice", read: false }]),
  );

  await withRoots(vid, accounts, async () => {
    const { migrateMessages } = await import("@axs/modules/amberxvid/lib/migrate-messages");
    const first = await migrateMessages();
    assert.equal(first.status, "migrated");

    const again = await migrateMessages();
    assert.equal(again.status, "already-migrated");
    assert.equal(again.moved.length, 1, "the record survives — a re-run cannot erase what moved");
    assert.equal(again.moved[0].threadId, "alice--bob");
  });
});

test("it refuses to run while P1 has not retired the module account store", async () => {
  const { vid, accounts } = roots();
  // The un-retired member store: the exact ordering mistake the gate exists for.
  writeJson(path.join(vid, "accounts.json"), { version: 1, users: [] });
  writeJson(
    path.join(vid, "messages", "alice--bob.json"),
    legacyThread("alice", "bob", [{ from: "bob", to: "alice", read: false }]),
  );

  await withRoots(vid, accounts, async () => {
    const { migrateMessages } = await import("@axs/modules/amberxvid/lib/migrate-messages");
    const report = await migrateMessages();
    assert.equal(report.status, "blocked");
    assert.match(report.blockedBy ?? "", /P1 member migration has not run/);
    assert.ok(!fs.existsSync(path.join(accounts, "messages", "alice--bob.json")));
    assert.ok(fs.existsSync(path.join(vid, "messages", "alice--bob.json")), "nothing moved");
  });
});

test("a dry run plans everything and writes nothing — not the threads, not the marker", async () => {
  const { vid, accounts } = roots();
  writeJson(
    path.join(vid, "messages", "alice--bob.json"),
    legacyThread("alice", "bob", [{ from: "bob", to: "alice", read: false }]),
  );

  await withRoots(vid, accounts, async () => {
    const { migrateMessages, identityMapFrom } = await import(
      "@axs/modules/amberxvid/lib/migrate-messages"
    );
    // The mapping projection, on the record shape P1 actually writes.
    const map = identityMapFrom({ members: [{ from: "Alice", to: "alice" }, { from: 3, to: "x" }] });
    assert.deepEqual(map, { alice: "alice" }, "junk entries drop, names lowercase");

    const report = await migrateMessages({ dryRun: true });
    assert.equal(report.status, "migrated");
    assert.equal(report.moved.length, 1, "the plan is the plan the real run executes");
    assert.ok(!fs.existsSync(path.join(accounts, "messages", "alice--bob.json")));
    assert.ok(!fs.existsSync(path.join(vid, "messages", ".message-migration.json")));
    assert.ok(fs.existsSync(path.join(vid, "messages", "alice--bob.json")));
  });
});

/* ---------------------- the retention sweep the module kept --------------------- */

/**
 * `pruneMessages` gained `olderThanDays` in P6 because the retiring store's
 * admin window has always offered it, and dropping the capability with the
 * store would have been a silent regression. Tested here rather than in
 * `accounts-store.test.ts` because this phase is why it exists.
 */
test("the accounts prune sweep drops messages older than a cutoff and keeps the thread", async () => {
  const { vid, accounts } = roots();
  const now = "2026-08-15T00:00:00.000Z";
  writeJson(path.join(accounts, "accounts.json"), {
    version: 1,
    accounts: [
      {
        username: "root",
        role: "administrator",
        passwordHash: "scrypt$n=1,r=1,p=1$AA$AA",
        mustChangePassword: false,
        screenname: "root",
        createdAt: now,
        updatedAt: now,
        createdBy: "seed",
      },
    ],
  });
  writeJson(path.join(accounts, "messages", "alice--bob.json"), {
    version: 1,
    id: "alice--bob",
    participants: ["alice", "bob"],
    messages: [
      { id: "old", threadId: "alice--bob", from: "alice", to: "bob", text: "ancient", sentAt: "2020-01-01T00:00:00.000Z", deliveredAt: null, readAt: null },
      { id: "new", threadId: "alice--bob", from: "alice", to: "bob", text: "recent", sentAt: new Date().toISOString(), deliveredAt: null, readAt: null },
    ],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: now,
  });

  await withRoots(vid, accounts, async () => {
    const store = await import("@axs/modules/accounts/lib/messages");
    const swept = await store.pruneMessages("root", { olderThanDays: 30 });
    assert.equal(swept.ok, true);
    if (!swept.ok) return;
    assert.equal(swept.messagesRemoved, 1);
    assert.equal(swept.threadsTouched, 1);

    const doc = readJson<{ messages: Array<{ id: string }> }>(
      path.join(accounts, "messages", "alice--bob.json"),
    );
    assert.equal(doc.messages.length, 1);
    assert.equal(doc.messages[0].id, "new");

    // A prune with no cutoff is the cap sweep it always was, and finds nothing.
    const capOnly = await store.pruneMessages("root");
    assert.equal(capOnly.ok, true);
    if (!capOnly.ok) return;
    assert.equal(capOnly.messagesRemoved, 0);
    assert.equal(capOnly.cutoff, null);
  });
});
