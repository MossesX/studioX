/**
 * @file The P1 member migration, against a temp store.
 *
 * The LIVE migration (2026-08-14) hit only the `matched` path — both amberxvid
 * members already had studio accounts of the same name. That left the paths
 * that actually move data — `created`, `suffixed`, and the seven-store re-key —
 * unexercised by anything but inspection. This runs them.
 *
 * Everything happens under a fresh temp root via `AMBERXVID_DATA_DIR`, which
 * `lib/paths` reads per call rather than latching at import; nothing here can
 * reach the real store.
 *
 * The two properties worth the most: a re-run reports `already-migrated` and
 * mints nothing, and the source store is RENAMED rather than deleted.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface Fixture {
  axv: string;
  acc: string;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/**
 * A member store with two people: one whose name is free, and one whose name is
 * already a studio account — the collision that makes re-keying necessary.
 * Every per-user store the re-key walks gets a file hung off the colliding one.
 */
function fixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axv-migrate-"));
  const axv = path.join(root, "axv");
  const acc = path.join(root, "accounts");

  writeJson(path.join(axv, "accounts.json"), {
    version: 1,
    accounts: [
      { username: "alice", role: "member", screenname: "Alice" },
      { username: "GizmoX", role: "administrator", screenname: null },
    ],
  });
  writeJson(path.join(acc, "accounts.json"), {
    version: 1,
    accounts: [
      {
        username: "gizmox",
        role: "administrator",
        passwordHash: "scrypt$n=16384,r=8,p=1$c2FsdA==$a2V5",
        mustChangePassword: false,
        screenname: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: "seed",
      },
    ],
  });

  writeJson(path.join(axv, "profiles", "gizmox.json"), { bio: "keep me" });
  writeJson(path.join(axv, "albums", "gizmox", "a1", "album.json"), { title: "Trip" });
  writeJson(path.join(axv, "messages", "brett--gizmox.json"), {
    id: "brett--gizmox",
    participants: ["brett", "gizmox"],
    messages: [{ from: "brett", body: "hi" }],
  });
  writeJson(path.join(axv, "recordings", "cap1", "manifest.json"), { owner: "GizmoX", clip: "x" });

  process.env.AMBERXVID_DATA_DIR = axv;
  return { axv, acc };
}

test("migration: creates, suffixes on collision, and re-keys every per-user store", async () => {
  const { axv, acc } = fixture();
  const { migrateMembers } = await import("@axs/modules/amberxvid/lib/migrate-members");

  const report = await migrateMembers(acc, { policy: "separate" });

  assert.equal(report.status, "migrated");
  assert.deepEqual(report.warnings, []);

  const alice = report.members.find((m) => m.from === "alice");
  assert.equal(alice?.outcome, "created");
  assert.equal(alice?.to, "alice");

  // The collision is suffixed, and the mapping SAYS SO — an unrecorded rename
  // is the thing that makes a migration unauditable later.
  const gizmox = report.members.find((m) => m.from === "GizmoX");
  assert.equal(gizmox?.outcome, "suffixed");
  assert.equal(gizmox?.to, "GizmoX-axv");
  assert.match(String(gizmox?.note), /GizmoX-axv/);

  // Files that move by path.
  assert.ok(fs.existsSync(path.join(axv, "profiles", "gizmox-axv.json")));
  assert.ok(fs.existsSync(path.join(axv, "albums", "gizmox-axv", "a1", "album.json")));

  // A thread carries the id INSIDE the document as well as in the filename, and
  // its reader validates the two agree — renaming alone would corrupt it.
  const thread = path.join(axv, "messages", "brett--gizmox-axv.json");
  assert.ok(fs.existsSync(thread), "thread file re-keyed");
  const doc = readJson<{ id: string; participants: string[] }>(thread);
  assert.equal(doc.id, "brett--gizmox-axv");
  assert.deepEqual(doc.participants, ["brett", "gizmox-axv"]);

  // A recording is keyed by CAPTURE id — the owner is a field, not the path.
  const manifest = readJson<{ owner: string }>(path.join(axv, "recordings", "cap1", "manifest.json"));
  assert.equal(manifest.owner, "GizmoX-axv");

  // Every move is recorded by name — the mapping is the audit trail, so what it
  // claims to have moved must be exactly what moved.
  assert.deepEqual(
    (gizmox?.rekeyed ?? []).map((r) => r.what).sort(),
    ["albums", "conversation", "profile", "recording owner"],
  );
});

test("migration: minted accounts carry no usable password", async () => {
  const { acc } = fixture();
  const { migrateMembers } = await import("@axs/modules/amberxvid/lib/migrate-members");

  const report = await migrateMembers(acc, { policy: "separate" });

  const store = readJson<{ accounts: Array<{ username: string; passwordHash: string; forcePasswordReset?: boolean }> }>(
    path.join(acc, "accounts.json"),
  );
  assert.equal(store.accounts.length, 3, "the seed account plus the two migrated members");

  const minted = store.accounts.filter((a) => a.forcePasswordReset === true);
  assert.equal(minted.length, 2);
  assert.equal(report.pendingResets, 2);
  for (const a of minted) {
    // Not a scrypt record at all, so it fails at parse rather than comparison.
    assert.ok(!a.passwordHash.startsWith("scrypt$"), `${a.username} must have an unusable hash`);
  }
});

test("migration: the source store is renamed, never deleted", async () => {
  const { axv, acc } = fixture();
  const { migrateMembers } = await import("@axs/modules/amberxvid/lib/migrate-members");

  await migrateMembers(acc, { policy: "separate" });

  assert.ok(!fs.existsSync(path.join(axv, "accounts.json")));
  assert.ok(fs.existsSync(path.join(axv, "accounts.json.retired")), "the old hashes stay readable on disk");
});

test("migration: re-running is a no-op that says so", async () => {
  const { acc } = fixture();
  const { migrateMembers } = await import("@axs/modules/amberxvid/lib/migrate-members");

  await migrateMembers(acc, { policy: "separate" });
  const before = fs.readFileSync(path.join(acc, "accounts.json"), "utf8");

  const again = await migrateMembers(acc, { policy: "separate" });

  assert.equal(again.status, "already-migrated");
  assert.deepEqual(again.members, []);
  assert.equal(again.pendingResets, 0);
  assert.equal(fs.readFileSync(path.join(acc, "accounts.json"), "utf8"), before, "no account was touched twice");
});

test("migration: `match` treats a shared username as the same person", async () => {
  const { axv, acc } = fixture();
  const { migrateMembers } = await import("@axs/modules/amberxvid/lib/migrate-members");

  const report = await migrateMembers(acc, { policy: "match" });

  const gizmox = report.members.find((m) => m.from === "GizmoX");
  assert.equal(gizmox?.outcome, "matched");
  assert.deepEqual(gizmox?.rekeyed, [], "a matched member keeps every path it already had");
  // This is the live 2026-08-14 outcome: the profile stays exactly where it was.
  assert.ok(fs.existsSync(path.join(axv, "profiles", "gizmox.json")));
});

test("migration: an absent member store is `nothing-to-migrate`, not a crash", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axv-migrate-empty-"));
  process.env.AMBERXVID_DATA_DIR = path.join(root, "axv");
  const { migrateMembers } = await import("@axs/modules/amberxvid/lib/migrate-members");

  const report = await migrateMembers(path.join(root, "accounts"));

  assert.equal(report.status, "nothing-to-migrate");
  assert.equal(report.retiredStore, null);
  assert.deepEqual(report.members, []);
});
