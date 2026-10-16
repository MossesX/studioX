/**
 * @file The vault's **accounting chokepoint** — every byte that enters or
 * leaves a member's vault is weighed here, charged here, and refused here
 * (P2 of `axf-amberxvid-social`, 2026-08-14).
 *
 * ## What this file is, and why it has two seams in it
 *
 * P2's steps (3) and (4) are written against `accounts/lib/storage.ts` — its
 * `charge()`, its `checkQuota()`, and a `storageQuotaMB` row in the accounts
 * policy cascade. **None of those exist on disk.** They are deliverables of
 * `axf-accounts-admin-suite`, which has never run; this project's own P0
 * preflight found exactly that and stopped the build over it
 * (`build/projects/axf-amberxvid-social.p0-inventory.md`, gate (b)).
 *
 * Building a copy of them here would fork ownership of the accounts storage
 * contract, which is the one thing P0 refused to do. So this file builds the
 * half that is genuinely the module's — **where the charge happens, what the
 * delta is, and what a refusal says** — behind two injection seams that the
 * accounts ledger fills in when it lands:
 *
 * ```ts
 * setStorageLedger(ledger);      // (3) charge
 * setVaultQuotaSource(limitFor); // (4) the limit, from the policy cascade
 * ```
 *
 * Both are called by `./vault-registration`, the ONE adapter that also hands
 * the five roots to `USER_DATA_ROOTS` — see that file for the shape the seam is
 * written against and for the single line the accounts suite adds to fill it.
 * `vaultStorageStatus()` there reports, in a sentence, when nothing is
 * installed.
 *
 * ## This is not a guard that silently passes
 *
 * A quota check with no limit source that answers "allowed" is the false-green
 * shape this project has been bitten by before. Two things keep it honest:
 *
 * 1. `quotaStatus()` reports `configured: false` — the absence of a limit is a
 *    *stated* condition a caller and a test can read, not an invisible pass.
 * 2. The refusal path is exercised for real by `test/axv-vaults.test.ts`, which
 *    installs a quota source, watches `assertVaultQuota` refuse, and reads the
 *    quota and the usage out of the message. The machinery is tested today; it
 *    is only the limit's *origin* that is waiting.
 *
 * Injection rather than an env var is deliberate. An env-read limit would be a
 * second policy system, and P3 ("no second policy system") is explicit that the
 * accounts cascade is the only one. A seam takes whatever the cascade answers.
 *
 * Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { VAULT_SUBDIRS, vaultDir, vaultKey } from "./paths";
import type { VaultSubdir } from "./paths";

/* ================================ measurement ================================= */

/**
 * Bytes under one directory, recursively. A missing directory weighs nothing.
 *
 * Exported because the stores need it too: a path whose delta cannot be known
 * as it goes (a remux that rewrites the media file, a capture aborted
 * mid-upload) reconciles by weighing the directory, which is the rescan half of
 * the ledger contract applied to one folder instead of a whole vault. One
 * walker, so "how big is this" has a single answer.
 */
export async function dirBytes(dir: string): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirBytes(abs);
    } else if (entry.isFile()) {
      try {
        total += (await fsp.stat(abs)).size;
      } catch {
        /* a file that vanished mid-walk weighs nothing — degrade, never crash */
      }
    }
  }
  return total;
}

export interface VaultUsage {
  username: string;
  /** Total bytes across all five stores. */
  bytes: number;
  /** The same total, broken down — what an admin row wants to show. */
  byStore: Record<VaultSubdir, number>;
}

/**
 * Measure a vault by walking it. This is the RESCAN half of the ledger's
 * contract: the truth of record for stores whose byte delta no write path can
 * know (a remux that rewrites a media file in place, an aborted upload, a file
 * removed outside the module).
 */
export async function vaultUsage(username: string): Promise<VaultUsage> {
  const root = vaultDir(username);
  const byStore = {} as Record<VaultSubdir, number>;
  let bytes = 0;
  for (const store of VAULT_SUBDIRS) {
    const n = await dirBytes(path.join(root, store));
    byStore[store] = n;
    bytes += n;
  }
  return { username: vaultKey(username), bytes, byStore };
}

/* ============================ seam (2): the roots ============================= */

/*
 * Registration — handing the five vault roots to accounts' `USER_DATA_ROOTS` —
 * lives in `./vault-registration`, which is also what installs the two setters
 * below. It is one file rather than a function here because the translation
 * into the accounts shape, the ledger adapter and the quota adapter are one
 * decision, and splitting them across two files is how a codebase ends up with
 * two ways to register and only one of them called.
 */

/* =========================== seam (3): the ledger ============================= */

/**
 * The platform storage ledger, as this module needs to see it. The accounts
 * module's real ledger is adapted onto this — one small adapter beats every
 * call site in this module importing a shape that is still being designed.
 */
export interface StorageLedger {
  /** Record a byte delta against a member. Negative on delete. */
  charge(input: {
    username: string;
    moduleId: "amberxvid";
    store: VaultSubdir;
    deltaBytes: number;
    what: string;
  }): void | Promise<void>;
}

let ledger: StorageLedger | null = null;

/** Install the platform ledger. Called once, by whoever owns the accounts seam. */
export function setStorageLedger(next: StorageLedger | null): void {
  ledger = next;
}

/** Whether a ledger is installed — stated, so "nothing was charged" is readable. */
export const storageLedgerInstalled = (): boolean => ledger !== null;

/**
 * Charge a byte delta to a member's ledger.
 *
 * Never throws and never fails the write that called it: an accounting error
 * that loses somebody's upload is a worse bug than an accounting error. This is
 * the same posture as the module's activity journal, and it is why every caller
 * can `await chargeVault(...)` without a try/catch of its own.
 */
export async function chargeVault(
  username: string,
  store: VaultSubdir,
  deltaBytes: number,
  what: string,
): Promise<void> {
  if (!ledger || deltaBytes === 0) return;
  try {
    await ledger.charge({ username: vaultKey(username), moduleId: "amberxvid", store, deltaBytes, what });
  } catch {
    /* the ledger can be rebuilt by a rescan; the member's bytes cannot */
  }
}

/* =========================== seam (4): the quota ============================== */

/**
 * The effective storage limit for one member, in BYTES, or `null` for "no limit
 * configured". This is the accounts policy cascade's `storageQuotaMB` answer,
 * already resolved through site-default → per-user override by the cascade
 * itself — the module asks for the effective number and never re-implements the
 * precedence.
 */
export type VaultQuotaSource = (username: string) => number | null | Promise<number | null>;

let quotaSource: VaultQuotaSource | null = null;

/** Install the policy cascade's answer. Called once, by the accounts seam. */
export function setVaultQuotaSource(next: VaultQuotaSource | null): void {
  quotaSource = next;
}

export interface QuotaStatus {
  /** False while no cascade is installed — the honest "there is no limit yet". */
  configured: boolean;
  /** The limit in bytes, or null when unconfigured or unlimited for this member. */
  limitBytes: number | null;
  usedBytes: number;
}

/** Where a member stands. `configured: false` is a fact, not a pass. */
export async function quotaStatus(username: string): Promise<QuotaStatus> {
  const usedBytes = (await vaultUsage(username)).bytes;
  if (!quotaSource) return { configured: false, limitBytes: null, usedBytes };
  const limitBytes = await quotaSource(username);
  return { configured: true, limitBytes, usedBytes };
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export type QuotaVerdict =
  | { ok: true }
  | { ok: false; error: string; status: number; limitBytes: number; usedBytes: number };

/**
 * The check every vault write passes through before it writes.
 *
 * The refusal names the quota AND the current usage, because "storage quota
 * exceeded" with no numbers is a support ticket. It is returned as a typed
 * result with an HTTP status, never thrown — the module's stores all answer
 * `{ ok: false, error, status }` and the routes turn that into a message, so a
 * quota refusal reaches the UI as a sentence and never as a stack trace.
 *
 * 507 (Insufficient Storage) rather than 403: the request is permitted, the
 * space is not, and the difference is what tells a member to delete something
 * instead of asking an administrator for a grant.
 */
export async function assertVaultQuota(username: string, addedBytes: number): Promise<QuotaVerdict> {
  if (!quotaSource || addedBytes <= 0) return { ok: true };
  const limitBytes = await quotaSource(username);
  if (limitBytes === null || limitBytes <= 0) return { ok: true };
  const usedBytes = (await vaultUsage(username)).bytes;
  if (usedBytes + addedBytes <= limitBytes) return { ok: true };
  return {
    ok: false,
    status: 507,
    limitBytes,
    usedBytes,
    error:
      `storage quota reached — your ${mb(limitBytes)} vault is holding ${mb(usedBytes)}, ` +
      `and this would add ${mb(addedBytes)}. Delete something, or ask an administrator to raise the quota.`,
  };
}
