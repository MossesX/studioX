/**
 * @file **The vault migration** — the pre-vault flat stores moved into
 * `users/<vaultKey>/` (P2 of `axf-amberxvid-social`, 2026-08-14).
 *
 * Run through `scripts/axv-p2-vaults.mjs`. A library rather than a script body
 * so the same code can be exercised against a temp store without a subprocess,
 * exactly like `./migrate-members`.
 *
 * ## It runs AFTER P1, and that ordering is the whole reason it is simple
 *
 * P1 re-keyed every per-user store onto the accounts username. So the key each
 * legacy path is filed under is ALREADY the vault key, and this pass is a pure
 * move with no mapping table and no rename inside a document. Running it
 * against a store P1 has not touched would file data under the module's old
 * member names — which is why `migrationBlocked()` refuses while
 * `accounts.json` is still there, un-retired.
 *
 * ## Three properties, in the order they matter
 *
 * **Idempotent.** Finished-ness is the MARKER FILE, `users/.vault-migration.json`.
 * A second run reads it, reports `already-migrated`, and touches nothing. The
 * marker holds the first run's record, so a re-run cannot erase what moved.
 *
 * **Never destructive.** Every move is a rename that REFUSES to clobber. Two
 * people's albums are never merged because their directories collided, and a
 * recording whose owner cannot be read is left where it is and reported — the
 * legacy directory stays a read fallback in `resolveRecordingDir`, so a skipped
 * recording still plays.
 *
 * **Recorded.** Every path that moved, and every one that did not with the
 * reason, lands in the marker file. A migration you cannot audit afterwards is
 * a migration you cannot trust.
 *
 * Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  dataRoot,
  ensureVault,
  legacyAlbumsDir,
  legacyProfilesDir,
  legacyRecordingsDir,
  usersDir,
  vaultAlbumsDir,
  vaultKey,
  vaultMarkerFile,
  vaultProfileFile,
  vaultRecordingDir,
} from "./paths";

/* ---------------------------------- shapes ----------------------------------- */

export interface VaultMove {
  from: string;
  to: string;
  what: string;
  /** The vault this landed in. */
  user: string;
}

export interface VaultSkip {
  what: string;
  why: string;
}

export interface VaultMigrationReport {
  version: 1;
  status: "migrated" | "already-migrated" | "blocked" | "nothing-to-migrate";
  ranAt: string;
  dryRun: boolean;
  amberxvidRoot: string;
  /** Vault keys that now exist. */
  users: string[];
  moved: VaultMove[];
  skipped: VaultSkip[];
  warnings: string[];
  /** Set on `blocked` — what has to happen first, in one sentence. */
  blockedBy?: string;
}

export interface VaultMigrateOptions {
  /** Plan everything, write nothing — not the moves, not the marker. */
  dryRun?: boolean;
}

/* --------------------------------- plumbing ---------------------------------- */

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tmp, file);
}

/**
 * The P1 gate. `accounts.json` still present means the member store was never
 * retired, so the legacy directories are keyed on the MODULE's old usernames
 * rather than on accounts usernames — and moving them into vaults now would
 * file somebody's albums under a name that is not their account.
 */
export function migrationBlocked(): string | null {
  return fs.existsSync(path.join(dataRoot(), "accounts.json"))
    ? "the P1 member migration has not run — data/amberxvid/accounts.json is still present, " +
        "so the flat stores are keyed on retired module usernames rather than accounts usernames. " +
        "Run `npm run migrate:amberxvid` first."
    : null;
}

/** One rename, refusing to clobber. Returns null when there was nothing there. */
async function move(
  from: string,
  to: string,
  what: string,
  user: string,
  dryRun: boolean,
  warnings: string[],
): Promise<VaultMove | null> {
  if (!fs.existsSync(from)) return null;
  if (fs.existsSync(to)) {
    warnings.push(`refused to move ${what}: ${to} already exists — left ${from} in place`);
    return null;
  }
  if (!dryRun) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
  }
  return { from, to, what, user };
}

/** Remove a legacy directory only if the migration emptied it. Never recursive. */
async function removeIfEmpty(dir: string, dryRun: boolean): Promise<void> {
  if (dryRun || !fs.existsSync(dir)) return;
  try {
    await fsp.rmdir(dir);
  } catch {
    /* not empty — something was skipped and must stay readable */
  }
}

/* -------------------------------- the migration -------------------------------- */

/**
 * Move the pre-vault stores into per-member vaults.
 *
 * Three stores move, and they move in increasing order of difficulty:
 * profiles are one file each, albums are one directory each, and recordings are
 * keyed by CAPTURE id with the owner as a field inside the manifest — so the
 * owner has to be read before the destination is even known.
 */
export async function migrateVaults(options: VaultMigrateOptions = {}): Promise<VaultMigrationReport> {
  const dryRun = options.dryRun === true;
  const warnings: string[] = [];
  const moved: VaultMove[] = [];
  const skipped: VaultSkip[] = [];
  const touched = new Set<string>();

  const base: VaultMigrationReport = {
    version: 1,
    status: "nothing-to-migrate",
    ranAt: new Date().toISOString(),
    dryRun,
    amberxvidRoot: dataRoot(),
    users: [],
    moved,
    skipped,
    warnings,
  };

  const existing = readJson<VaultMigrationReport>(vaultMarkerFile());
  if (existing) return { ...existing, status: "already-migrated", ranAt: base.ranAt, dryRun };

  const blockedBy = migrationBlocked();
  if (blockedBy) return { ...base, status: "blocked", blockedBy };

  /* --- profiles: <root>/profiles/<key>.json → users/<key>/profile/profile.json --- */

  if (fs.existsSync(legacyProfilesDir())) {
    for (const entry of await fsp.readdir(legacyProfilesDir())) {
      if (!entry.endsWith(".json")) continue;
      const key = vaultKey(entry.slice(0, -5));
      if (!dryRun) ensureVault(key);
      const done = await move(
        path.join(legacyProfilesDir(), entry),
        vaultProfileFile(key),
        "profile",
        key,
        dryRun,
        warnings,
      );
      if (done) {
        moved.push(done);
        touched.add(key);
      }
    }
    await removeIfEmpty(legacyProfilesDir(), dryRun);
  }

  /* ------- albums: <root>/albums/<key>/ → users/<key>/albums/ (contents) -------- */

  if (fs.existsSync(legacyAlbumsDir())) {
    for (const entry of await fsp.readdir(legacyAlbumsDir(), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const key = vaultKey(entry.name);
      if (!dryRun) ensureVault(key);
      // `ensureVault` has already made `users/<key>/albums`, so the owner
      // directory cannot be renamed onto it — the ALBUMS inside it move, which
      // is also what keeps a partial re-run from clobbering an album that
      // already made it across.
      const ownerDir = path.join(legacyAlbumsDir(), entry.name);
      for (const albumId of await fsp.readdir(ownerDir)) {
        const done = await move(
          path.join(ownerDir, albumId),
          path.join(vaultAlbumsDir(key), albumId),
          `album ${albumId}`,
          key,
          dryRun,
          warnings,
        );
        if (done) {
          moved.push(done);
          touched.add(key);
        }
      }
      await removeIfEmpty(ownerDir, dryRun);
    }
    await removeIfEmpty(legacyAlbumsDir(), dryRun);
  }

  /* --- recordings: <root>/recordings/<recId>/ → users/<owner>/recordings/<recId>/ --- */

  if (fs.existsSync(legacyRecordingsDir())) {
    for (const recId of await fsp.readdir(legacyRecordingsDir())) {
      const dir = path.join(legacyRecordingsDir(), recId);
      const manifest = readJson<{ owner?: string }>(path.join(dir, "manifest.json"));
      if (!manifest || typeof manifest.owner !== "string" || !manifest.owner.trim()) {
        // Left in place ON PURPOSE: `resolveRecordingDir` still finds it there,
        // so an unreadable manifest costs a vault row, never a playable file.
        skipped.push({
          what: `recording ${recId}`,
          why: "its manifest has no readable owner, so there is no vault to file it under; left in the legacy directory, where it still resolves and still plays",
        });
        continue;
      }
      const key = vaultKey(manifest.owner);
      if (!dryRun) ensureVault(key);
      const done = await move(dir, vaultRecordingDir(key, recId), `recording ${recId}`, key, dryRun, warnings);
      if (done) {
        moved.push(done);
        touched.add(key);
      }
    }
    await removeIfEmpty(legacyRecordingsDir(), dryRun);
  }

  const report: VaultMigrationReport = {
    ...base,
    status: moved.length > 0 || skipped.length > 0 ? "migrated" : "nothing-to-migrate",
    users: [...touched].sort(),
  };

  if (!dryRun) {
    // The marker goes down even when nothing moved: "there was nothing to move"
    // and "we never ran" are different facts, and only the marker tells them
    // apart on the next boot.
    await fsp.mkdir(usersDir(), { recursive: true });
    await writeJsonAtomic(vaultMarkerFile(), report);
  }

  return report;
}
