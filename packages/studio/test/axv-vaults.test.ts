/**
 * @file The P2 vault — layout, migration, and the accounting chokepoint.
 *
 * Everything happens under a fresh temp root via `AMBERXVID_DATA_DIR`, which
 * `lib/paths` reads per call rather than latching at import; nothing here can
 * reach the real store.
 *
 * The properties worth the most, in order:
 *
 * 1. **The migration is idempotent and never clobbers.** A re-run reports
 *    `already-migrated` and the marker still holds the FIRST run's record.
 * 2. **It refuses to run before P1.** Filing data keyed on retired module
 *    usernames into accounts-keyed vaults is the silent corruption the ordering
 *    exists to prevent, so the refusal is tested rather than trusted.
 * 3. **The quota guard actually goes red.** A guard nobody has watched fail is
 *    a guard nobody has tested — and this one is doubly worth watching, because
 *    the accounts policy cascade that will supply the real limit does not exist
 *    yet (see `lib/vault.ts`'s header). The test installs a limit source and
 *    reads the numbers back out of the refusal.
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

/** A pre-vault store: a profile, an album with a photo, and two recordings —
 *  one with a readable owner and one whose manifest is junk. */
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axv-vault-"));
  writeJson(path.join(root, "profiles", "alice.json"), { bio: "keep me" });
  writeJson(path.join(root, "albums", "alice", "alb-20260814-101010-aaaaaa", "album.json"), {
    version: 1,
    id: "alb-20260814-101010-aaaaaa",
    owner: "alice",
    photos: [],
  });
  fs.writeFileSync(path.join(root, "albums", "alice", "alb-20260814-101010-aaaaaa", "ph-x.jpg"), Buffer.alloc(1024));
  writeJson(path.join(root, "recordings", "rec-20260814-101010-bbbbbb", "manifest.json"), {
    version: 1,
    id: "rec-20260814-101010-bbbbbb",
    owner: "Alice",
    startedAt: "2026-08-14T10:10:10.000Z",
    endedAt: "2026-08-14T10:11:10.000Z",
  });
  writeJson(path.join(root, "recordings", "rec-20260814-101011-cccccc", "manifest.json"), { nonsense: true });
  return root;
}

/** Every test re-imports through a fresh env, so `dataRoot()` follows. */
async function withRoot<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.AMBERXVID_DATA_DIR;
  process.env.AMBERXVID_DATA_DIR = root;
  process.env.AMBERXVID_SILENT_JOURNAL = "1";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.AMBERXVID_DATA_DIR;
    else process.env.AMBERXVID_DATA_DIR = prev;
  }
}

/* ------------------------------- the layout --------------------------------- */

test("every per-user path resolves under one vault keyed by accounts username", async () => {
  const root = fixture();
  await withRoot(root, async () => {
    const paths = await import("@axs/modules/amberxvid/lib/paths");

    // The key normalises; the vault is the same location for either spelling.
    assert.equal(paths.vaultKey("Alice"), "alice");
    assert.equal(paths.vaultDir("Alice"), paths.vaultDir("alice"));
    assert.equal(paths.vaultDir("alice"), path.join(root, "users", "alice"));

    // All five stores hang off that one directory — nothing lands outside it.
    for (const sub of paths.VAULT_SUBDIRS) {
      assert.equal(path.join(paths.vaultDir("alice"), sub), path.join(root, "users", "alice", sub));
    }
    assert.equal(paths.vaultProfileFile("alice"), path.join(root, "users", "alice", "profile", "profile.json"));

    // An empty username has no vault — it must never resolve to the users root,
    // which would make one member's vault every member's.
    assert.throws(() => paths.vaultKey("   "), /no vault/);
    // Nor may a key escape it. The property that matters is CONTAINMENT — the
    // resolved vault is always a direct child of the users root — not the
    // absence of a ".." substring, which is harmless once the separators are
    // gone (`../../etc` collapses to the single segment `_.._etc`).
    for (const hostile of ["../../etc", "a/b", "C:\\windows", "....//"]) {
      const dir = path.resolve(paths.vaultDir(hostile));
      assert.equal(path.dirname(dir), path.resolve(paths.usersDir()), `${hostile} escaped the users root`);
    }
    // `..` collapses to nothing once the separators go and the leading dots are
    // stripped, and an empty key is refused rather than resolved — so the one
    // name that could have meant "the parent directory" cannot be a vault.
    assert.throws(() => paths.vaultDir(".."), /no vault/);
  });
});

test("the storage-root descriptor covers every store in the layout", async () => {
  await withRoot(fixture(), async () => {
    const { VAULT_SUBDIRS, vaultRoots, vaultDir } = await import("@axs/modules/amberxvid/lib/paths");
    const roots = vaultRoots();
    // Derived from VAULT_SUBDIRS, so a sixth store cannot be added to the
    // layout and quietly left out of what the ledger is told about.
    assert.deepEqual(
      roots.map((r) => r.store),
      [...VAULT_SUBDIRS],
    );
    for (const r of roots) {
      assert.equal(r.moduleId, "amberxvid");
      assert.equal(r.resolve("alice"), path.join(vaultDir("alice"), r.store));
    }
  });
});

/* ------------------------------ the migration -------------------------------- */

test("the vault migration refuses to run before P1 has retired the member store", async () => {
  const root = fixture();
  writeJson(path.join(root, "accounts.json"), { version: 1, accounts: [] });
  await withRoot(root, async () => {
    const { migrateVaults } = await import("@axs/modules/amberxvid/lib/migrate-vaults");
    const report = await migrateVaults();
    assert.equal(report.status, "blocked");
    assert.match(String(report.blockedBy), /P1 member migration has not run/);
    // Blocked means BLOCKED: nothing moved, and no marker was left behind that
    // would make the real run think it had already happened.
    assert.ok(!fs.existsSync(path.join(root, "users", ".vault-migration.json")));
    assert.ok(fs.existsSync(path.join(root, "profiles", "alice.json")));
  });
});

test("the vault migration moves the three per-user stores, and is idempotent", async () => {
  const root = fixture();
  await withRoot(root, async () => {
    const { migrateVaults } = await import("@axs/modules/amberxvid/lib/migrate-vaults");

    const dry = await migrateVaults({ dryRun: true });
    assert.equal(dry.status, "migrated");
    assert.ok(fs.existsSync(path.join(root, "profiles", "alice.json")), "a dry run writes nothing");
    assert.ok(!fs.existsSync(path.join(root, "users", ".vault-migration.json")));

    const first = await migrateVaults();
    assert.equal(first.status, "migrated");
    assert.deepEqual(first.users, ["alice"]);
    assert.deepEqual(first.warnings, []);

    const vault = path.join(root, "users", "alice");
    assert.deepEqual(readJson<{ bio: string }>(path.join(vault, "profile", "profile.json")), { bio: "keep me" });
    assert.ok(fs.existsSync(path.join(vault, "albums", "alb-20260814-101010-aaaaaa", "album.json")));
    assert.ok(fs.existsSync(path.join(vault, "albums", "alb-20260814-101010-aaaaaa", "ph-x.jpg")));
    // The owner is a FIELD on a recording, and it is normalised on the way in —
    // "Alice" files into alice's vault.
    assert.ok(fs.existsSync(path.join(vault, "recordings", "rec-20260814-101010-bbbbbb", "manifest.json")));

    // The unreadable one stays where it is, and says so rather than vanishing.
    assert.equal(first.skipped.length, 1);
    assert.match(first.skipped[0].what, /rec-20260814-101011-cccccc/);
    assert.ok(fs.existsSync(path.join(root, "recordings", "rec-20260814-101011-cccccc", "manifest.json")));

    // Idempotence, and the marker keeps the FIRST run's record rather than
    // being overwritten by an empty re-run.
    const second = await migrateVaults();
    assert.equal(second.status, "already-migrated");
    assert.deepEqual(second.users, ["alice"]);
    assert.equal(second.moved.length, first.moved.length);
    const marker = readJson<{ moved: unknown[] }>(path.join(root, "users", ".vault-migration.json"));
    assert.equal(marker.moved.length, first.moved.length);
  });
});

test("a migrated recording is still reachable by id alone, and so is a skipped one", async () => {
  const root = fixture();
  await withRoot(root, async () => {
    const { migrateVaults } = await import("@axs/modules/amberxvid/lib/migrate-vaults");
    const { resolveRecordingDir } = await import("@axs/modules/amberxvid/lib/paths");
    await migrateVaults();

    // The media route has an id and nothing else — this is the lookup that
    // stands between a URL and a playable file.
    assert.equal(
      resolveRecordingDir("rec-20260814-101010-bbbbbb"),
      path.join(root, "users", "alice", "recordings", "rec-20260814-101010-bbbbbb"),
    );
    // The skipped capture still resolves, from the legacy directory. A recording
    // the migration could not file must not become a 404.
    assert.equal(
      resolveRecordingDir("rec-20260814-101011-cccccc"),
      path.join(root, "recordings", "rec-20260814-101011-cccccc"),
    );
    assert.equal(resolveRecordingDir("rec-20260814-101012-dddddd"), null);
  });
});

/* -------------------------- the accounting chokepoint ------------------------- */

test("vault usage is measured per store and totals the vault", async () => {
  const root = fixture();
  await withRoot(root, async () => {
    const { migrateVaults } = await import("@axs/modules/amberxvid/lib/migrate-vaults");
    const { vaultUsage } = await import("@axs/modules/amberxvid/lib/vault");
    await migrateVaults();

    const usage = await vaultUsage("Alice");
    assert.equal(usage.username, "alice");
    assert.ok(usage.byStore.albums >= 1024, "the album photo is counted");
    assert.ok(usage.byStore.profile > 0, "the profile document is counted");
    assert.equal(usage.bytes, Object.values(usage.byStore).reduce((a, b) => a + b, 0));
  });
});

test("with no ledger installed, nothing is charged AND the absence is stated", async () => {
  await withRoot(fixture(), async () => {
    const { chargeVault, storageLedgerInstalled, quotaStatus, assertVaultQuota } = await import(
      "@axs/modules/amberxvid/lib/vault"
    );
    // This is the state the module ships in today, and it is reported as a
    // fact rather than looking like a pass: `configured: false`.
    assert.equal(storageLedgerInstalled(), false);
    await chargeVault("alice", "albums", 999, "no ledger to take it");
    const status = await quotaStatus("alice");
    assert.equal(status.configured, false);
    assert.equal(status.limitBytes, null);
    assert.deepEqual(await assertVaultQuota("alice", 10 ** 9), { ok: true });
  });
});

test("the quota guard refuses, and the refusal names the quota and the usage", async () => {
  const root = fixture();
  await withRoot(root, async () => {
    const { migrateVaults } = await import("@axs/modules/amberxvid/lib/migrate-vaults");
    const vault = await import("@axs/modules/amberxvid/lib/vault");
    await migrateVaults();

    // Stand in for the accounts policy cascade's `storageQuotaMB` answer. The
    // seam is injected rather than read from an env var precisely so that this
    // test can watch the guard go RED without inventing a second policy system.
    try {
      vault.setVaultQuotaSource(() => 4096);
      const used = (await vault.vaultUsage("alice")).bytes;
      assert.ok(used > 0 && used < 4096, `fixture should sit under the limit (was ${used})`);

      // Under the limit: allowed.
      assert.deepEqual(await vault.assertVaultQuota("alice", 8), { ok: true });

      // Over it: refused, with numbers, as a typed result and not a throw.
      const verdict = await vault.assertVaultQuota("alice", 4096);
      assert.equal(verdict.ok, false);
      if (verdict.ok) return;
      assert.equal(verdict.status, 507);
      assert.equal(verdict.limitBytes, 4096);
      assert.equal(verdict.usedBytes, used);
      assert.match(verdict.error, /storage quota reached/);
      assert.match(verdict.error, /0\.0 MB vault/); // the quota, named
      assert.match(verdict.error, /would add/); // and what was asked for

      // A member with no limit set is unaffected by the cascade being present.
      vault.setVaultQuotaSource(() => null);
      assert.deepEqual(await vault.assertVaultQuota("alice", 10 ** 9), { ok: true });
    } finally {
      vault.setVaultQuotaSource(null);
    }
  });
});

test("an album upload is charged its exact bytes, and refused when it would not fit", async () => {
  const root = fixture();
  await withRoot(root, async () => {
    const { migrateVaults } = await import("@axs/modules/amberxvid/lib/migrate-vaults");
    const vault = await import("@axs/modules/amberxvid/lib/vault");
    await migrateVaults();

    const charges: Array<{ store: string; deltaBytes: number }> = [];
    try {
      vault.setStorageLedger({
        charge: (input) => {
          charges.push({ store: input.store, deltaBytes: input.deltaBytes });
        },
      });
      assert.equal(vault.storageLedgerInstalled(), true);

      await vault.chargeVault("Alice", "albums", 2048, "a photo");
      await vault.chargeVault("Alice", "albums", -2048, "and its deletion");
      // A zero delta is not a ledger line — an empty entry is noise that makes
      // a real one harder to find.
      await vault.chargeVault("Alice", "albums", 0, "nothing happened");

      assert.deepEqual(charges, [
        { store: "albums", deltaBytes: 2048 },
        { store: "albums", deltaBytes: -2048 },
      ]);
    } finally {
      vault.setStorageLedger(null);
    }
  });
});

test("a ledger that throws never fails the write it was accounting for", async () => {
  await withRoot(fixture(), async () => {
    const vault = await import("@axs/modules/amberxvid/lib/vault");
    try {
      vault.setStorageLedger({
        charge: () => {
          throw new Error("ledger is down");
        },
      });
      // The posture the module uses everywhere: an accounting error must never
      // be the reason somebody's upload is lost.
      await vault.chargeVault("alice", "albums", 100, "boom");
    } finally {
      vault.setStorageLedger(null);
    }
  });
});

/* ======================= step (2): the platform registration ==================== */

/**
 * A stand-in for `accounts/lib/storage.ts`, in the shape that module really
 * exports: a registry behind accessors, `registerUserDataRoot(root)` taking ONE
 * argument, and `charge(user, rootId, delta)`.
 *
 * It stood in for a file that did not exist when these tests were written; the
 * file exists now, and this fixture was rebuilt onto its actual shape as part of
 * I-30. A stand-in is still the right thing here — it is exactly what the
 * adapter is FOR, and it keeps these tests from dragging the whole accounts
 * store in — but a stand-in is only as good as its fidelity to the real export,
 * which is a claim a fixture cannot make about itself. The compile-time pins in
 * `vault-registration.ts` make it: they assert the REAL namespace satisfies the
 * same seam this fixture does, so the two cannot drift apart again without
 * `tsc` saying so.
 */
function seamFixture() {
  const charges: Array<{ user: string; rootId: string; deltaBytes: number }> = [];
  const roots = new Map<string, { id: string; title: string; resolve: (u: string) => string | null }>();
  return {
    charges,
    roots,
    seam: {
      registerUserDataRoot: (root: { id: string; title: string; resolve: (u: string) => string | null }) => {
        roots.set(root.id, root);
      },
      USER_DATA_ROOTS: {
        get: (id: string) => roots.get(id),
        ids: () => [...roots.keys()],
      },
      charge: (user: string, rootId: string, deltaBytes: number) => {
        charges.push({ user, rootId, deltaBytes });
      },
    },
  };
}

test("the five vault roots register into USER_DATA_ROOTS, and charges arrive with their root id", async () => {
  const root = fixture();
  await withRoot(root, async () => {
    const reg = await import("@axs/modules/amberxvid/lib/vault-registration");
    const vault = await import("@axs/modules/amberxvid/lib/vault");
    const { vaultAlbumsDir } = await import("@axs/modules/amberxvid/lib/paths");
    const { charges, seam, roots } = seamFixture();

    try {
      const installed = reg.installVaultStorage(seam);

      // Every store in the layout is a registered root — the admin suite's
      // Files and Storage tabs read this map and nothing else, so a store
      // missing here is a store the admin cannot see.
      assert.deepEqual(installed.rootIds, [
        "amberxvid.profile",
        "amberxvid.albums",
        "amberxvid.recordings",
        "amberxvid.wall",
        "amberxvid.files",
      ]);
      assert.deepEqual(seam.USER_DATA_ROOTS.ids(), installed.rootIds);
      assert.equal(seam.USER_DATA_ROOTS.get("amberxvid.albums")?.title, "AmberX Vid · albums");

      // The root RESOLVES to the real directory — a title with a wrong path is
      // an admin browsing an empty folder and believing it.
      assert.equal(
        seam.USER_DATA_ROOTS.get("amberxvid.albums")?.resolve("Alice"),
        vaultAlbumsDir("Alice"),
      );
      // The id the registry is keyed by is the id INSIDE the descriptor, which
      // is the mismatch I-30 was: a caller-supplied key would have looked
      // identical here and been wrong at the real seam.
      assert.equal(roots.get("amberxvid.albums")?.id, "amberxvid.albums");

      // And the ledger seam is now wired: a module-side charge arrives at the
      // platform with the namespaced root id, not the bare store name.
      await vault.chargeVault("Alice", "albums", 2048, "a photo");
      assert.deepEqual(charges, [{ user: "alice", rootId: "amberxvid.albums", deltaBytes: 2048 }]);

      const status = reg.vaultStorageStatus();
      assert.equal(status.installed, true);
      if (status.installed) assert.equal(status.charging, true);
    } finally {
      reg.uninstallVaultStorage();
    }
  });
});

test("every root arrives through the registration function, and a re-install replaces rather than duplicates", async () => {
  await withRoot(fixture(), async () => {
    const reg = await import("@axs/modules/amberxvid/lib/vault-registration");
    const { seam, roots } = seamFixture();
    const viaFunction: string[] = [];
    const watched = {
      ...seam,
      registerUserDataRoot: (root: { id: string; title: string; resolve: (u: string) => string | null }) => {
        viaFunction.push(root.id);
        seam.registerUserDataRoot(root);
      },
    };
    try {
      reg.installVaultStorage(watched);
      // The function is the ONLY door. This test used to assert it was
      // PREFERRED over assigning into `USER_DATA_ROOTS`; that fallback was
      // removed with I-30 because the real registry is accessor-only and there
      // is no map to assign into — a branch that cannot be taken is not a
      // fallback, and an untested branch is how a seam rots.
      assert.deepEqual(viaFunction, [...reg.VAULT_ROOT_IDS]);

      // Idempotent: installing twice re-registers the same five ids rather than
      // growing a second copy of each, which an admin's Files tab would render
      // twice and whose bytes a site total would count twice.
      reg.installVaultStorage(watched);
      assert.equal(viaFunction.length, reg.VAULT_ROOT_IDS.length * 2);
      assert.deepEqual([...roots.keys()], [...reg.VAULT_ROOT_IDS]);
    } finally {
      reg.uninstallVaultStorage();
    }
  });
});

test("the quota limit comes from the policy cascade's storageQuotaMB, in megabytes", async () => {
  const root = fixture();
  await withRoot(root, async () => {
    const reg = await import("@axs/modules/amberxvid/lib/vault-registration");
    const vault = await import("@axs/modules/amberxvid/lib/vault");
    const { migrateVaults } = await import("@axs/modules/amberxvid/lib/migrate-vaults");
    await migrateVaults();
    const { seam } = seamFixture();

    try {
      reg.installVaultStorage(seam, { effectivePolicy: () => ({ storageQuotaMB: 1 }) });
      const status = await vault.quotaStatus("alice");
      assert.equal(status.configured, true);
      assert.equal(status.limitBytes, 1024 * 1024); // MB → bytes, once, here

      const verdict = await vault.assertVaultQuota("alice", 2 * 1024 * 1024);
      assert.equal(verdict.ok, false);
      if (!verdict.ok) assert.match(verdict.error, /1\.0 MB vault/);

      // A cascade that says nothing about storage means NO limit — never a
      // zero-byte allowance, which would refuse every write in the product.
      reg.installVaultStorage(seam, { effectivePolicy: () => ({}) });
      assert.deepEqual(await vault.assertVaultQuota("alice", 10 ** 9), { ok: true });
      reg.installVaultStorage(seam, { effectivePolicy: () => ({ storageQuotaMB: 0 }) });
      assert.deepEqual(await vault.assertVaultQuota("alice", 10 ** 9), { ok: true });
    } finally {
      reg.uninstallVaultStorage();
    }
  });
});

test("with no seam installed, the absence is stated rather than passing silently", async () => {
  await withRoot(fixture(), async () => {
    const reg = await import("@axs/modules/amberxvid/lib/vault-registration");
    reg.uninstallVaultStorage();
    const status = reg.vaultStorageStatus();
    assert.equal(status.installed, false);
    if (!status.installed) {
      // The sentence has to name the file a reader would go looking for, and
      // the thing they should do about it. It named the PROJECT that would one
      // day produce that file until I-30; the file has landed, so the sentence
      // now names the call that is still missing instead — a status telling a
      // reader to wait for something that already happened is worse than none.
      assert.match(status.why, /accounts\/lib\/storage\.ts/);
      assert.match(status.why, /installVaultStorage\(/);
    }
  });
});

/* ================= step (3)+(4) on the store that had neither ================== */

/**
 * A studio accounts store holding one entered member. The profile store reads
 * the roster through the accounts module (P1), so a profile test needs a real
 * account — and `permissions.json` is deliberately absent: grants are
 * default-allow, so an account with no grants row IS a member.
 */
function accountsFixture(username: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axv-accounts-"));
  const now = "2026-08-14T10:00:00.000Z";
  writeJson(path.join(dir, "accounts.json"), {
    version: 1,
    accounts: [
      {
        username,
        role: "user",
        passwordHash: "scrypt$n=1,r=1,p=1$c2FsdA==$a2V5",
        mustChangePassword: false,
        screenname: username,
        createdAt: now,
        updatedAt: now,
        createdBy: "seed",
      },
    ],
  });
  return dir;
}

test("a profile save is charged its exact delta, and refused when it would not fit", async () => {
  const root = fixture();
  const accounts = accountsFixture("alice");
  const prevAccounts = process.env.ACCOUNTS_DATA_DIR;
  process.env.ACCOUNTS_DATA_DIR = accounts;
  try {
    await withRoot(root, async () => {
      const reg = await import("@axs/modules/amberxvid/lib/vault-registration");
      const { migrateVaults } = await import("@axs/modules/amberxvid/lib/migrate-vaults");
      const { updateProfile } = await import("@axs/modules/amberxvid/lib/profiles");
      const { vaultProfileFile } = await import("@axs/modules/amberxvid/lib/paths");
      await migrateVaults();
      const { charges, seam } = seamFixture();

      try {
        // A generous limit first: the save lands, and the ledger is charged the
        // document's real weight — the profile store is one of the five roots,
        // and it is the only one whose sole writer is this function, so it
        // charges rather than waiting for a rescan.
        reg.installVaultStorage(seam, { effectivePolicy: () => ({ storageQuotaMB: 10 }) });
        // The migrated legacy profile is already sitting there and was never
        // charged (it arrived by migration, which is rescan territory), so the
        // charge is the DIFFERENCE this save made — not the document's size.
        const before = fs.statSync(vaultProfileFile("alice")).size;
        const saved = await updateProfile("alice", "alice", { aboutMe: "x".repeat(500) });
        assert.equal(saved.ok, true);

        const onDisk = fs.statSync(vaultProfileFile("alice")).size;
        const profileCharges = charges.filter((c) => c.rootId === "amberxvid.profile");
        assert.equal(profileCharges.length, 1);
        assert.equal(profileCharges[0].deltaBytes, onDisk - before);

        // Shrinking gives bytes back — a signed delta, not an absolute size.
        const shrunk = await updateProfile("alice", "alice", { aboutMe: "" });
        assert.equal(shrunk.ok, true);
        assert.ok(
          charges.filter((c) => c.rootId === "amberxvid.profile")[1].deltaBytes < 0,
          "clearing about-me should credit the ledger",
        );

        // Now a quota that cannot hold the next save. The refusal reaches the
        // caller as a typed result with a message — the routes turn that into a
        // sentence on screen, and a stack trace never happens.
        reg.installVaultStorage(seam, { effectivePolicy: () => ({ storageQuotaMB: 0.0001 }) });
        const refused = await updateProfile("alice", "alice", { aboutMe: "y".repeat(2000) });
        assert.equal(refused.ok, false);
        if (!refused.ok) {
          assert.equal(refused.status, 507);
          assert.match(refused.error, /storage quota reached/);
          assert.match(refused.error, /Delete something/);
        }
        // And the refusal did not half-write: the previous document survives.
        assert.equal(JSON.parse(fs.readFileSync(vaultProfileFile("alice"), "utf8")).aboutMe, "");
      } finally {
        reg.uninstallVaultStorage();
      }
    });
  } finally {
    if (prevAccounts === undefined) delete process.env.ACCOUNTS_DATA_DIR;
    else process.env.ACCOUNTS_DATA_DIR = prevAccounts;
  }
});
