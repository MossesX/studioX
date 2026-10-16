/**
 * @file **Step (2): the vault roots, handed to the platform.** The ONE adapter
 * between this module's vault layout and the accounts module's storage ledger
 * and policy cascade (P2 of `axf-amberxvid-social`, 2026-08-14).
 *
 * ## Why this is an adapter and not an import
 *
 * When this file was written, `accounts/lib/storage.ts` (with `USER_DATA_ROOTS`)
 * and `accounts/lib/policy.ts` (with `storageQuotaMB`) **did not exist on
 * disk**. They were P1 and P2 of `axf-accounts-admin-suite` — this project's own
 * P0 preflight established exactly that and stopped the build over it
 * (`build/projects/axf-amberxvid-social.p0-inventory.md`, gate (b)). Writing
 * them here would fork ownership of the accounts storage contract, which is the
 * one thing P0 refused to do.
 *
 * So the registration was written against the seam's **stated shape**, taken
 * from the producing project's own step text rather than guessed:
 *
 * > *"`USER_DATA_ROOTS` — a data-only registry mapping root id →
 * > `{ title, resolve(user) → absolute dir }` … plus a registration seam other
 * > modules use to add their roots later (amberxvid's vaults will, when its
 * > projects run — the seam is a plain exported map, no imports of other
 * > modules, ever)"*
 * > — `axf-accounts-admin-suite.bmpx`, P1 step 1
 *
 * ## Both modules have since landed, and the prose was wrong (I-30)
 *
 * They exist now, and the shape P1 built is BETTER than the sentence above: a
 * registry behind accessors rather than an open map, so `charge` can refuse an
 * unknown root id, with the root's id inside its own descriptor. The seam here
 * was still describing the sentence, so the one-line arrival below **did not
 * typecheck** — for a day, silently, because a structural agreement written in
 * prose is checked by nothing until somebody writes the call.
 *
 * Repaired 2026-08-15 by widening THIS side to what accounts exports (the
 * producing module's design is the better one and was not reshaped to match its
 * own step text), and by standing the two `*SeamPin` assignments below where the
 * call will stand, so the next divergence is a compile error rather than a
 * discovery.
 *
 * The registration itself is still **passed in**, never imported at runtime.
 * That is what the producer's "no imports of other modules, ever" requires of
 * both sides, and it is what makes the arrival a one-line change over there and
 * a zero-line change here:
 *
 * ```ts
 * // in the accounts admin suite's registration pass, when it lands:
 * import { installVaultStorage } from "@axs/modules/amberxvid/lib/vault-registration";
 * installVaultStorage(accountsStorage, accountsPolicy);
 * ```
 *
 * After that call the admin suite's Files and Storage tabs see amberxvid data
 * with **no admin-suite change** — they read `USER_DATA_ROOTS`, and the five
 * vault roots are in it — and `rescan(user)` walks the vaults, because a
 * registered root is exactly what it walks.
 *
 * ## P3 widened it: the same call carries the POLICY rows
 *
 * The second argument was always the policy cascade; as of P3 (2026-08-14) it
 * is bidirectional. `installVaultStorage` now also pushes this module's twelve
 * catalog rows (`./policy`) INTO the accounts catalog and wires the guards'
 * reads back out of it, so the admin suite's **generic** policy editor renders
 * the AmberX Vid group with no admin-suite change either — the same property
 * the storage half has, for the same reason: one catalog, one editor.
 *
 * It stays ONE function rather than growing a sibling `installPolicy()`. The
 * accounts suite has one registration pass; two entry points is how a codebase
 * ends up with two ways to register and only one of them called — and here the
 * failure would be silent, because a catalog with no rows and a module with no
 * cascade both look exactly like a studio nobody has configured.
 *
 * ## It does not silently pass
 *
 * Until that call happens {@link vaultStorageStatus} reports
 * `installed: false` with the reason in a sentence. A storage integration whose
 * absence looks identical to its presence is the false-green shape this project
 * has been bitten by before; "nothing is being charged" is a fact a caller and a
 * test can read here, not something you find out from an empty ledger.
 *
 * Server-only.
 */

import { setThreadMemberCapSource } from "@axs/modules/accounts/lib/messages";
import { setStorageLedger, setVaultQuotaSource } from "./vault";
import { AMBERXVID_POLICY_ROWS, groupChatMemberCap, setAmberxvidPolicySource } from "./policy";
import { VAULT_SUBDIRS, vaultRoots } from "./paths";
import type { VaultSubdir } from "./paths";

/* ============================ the accounts seam ============================== */

/**
 * One entry of accounts' `USER_DATA_ROOTS` — the shape that module really
 * exports (`accounts/lib/storage.ts`, `UserDataRoot`), not the shape its
 * producing step described in prose. Two differences, and both were live
 * defects until 2026-08-15 (I-30):
 *
 * - the **id lives inside the descriptor**, because the registry is keyed off
 *   it by `registerUserDataRoot(root)` rather than by a caller's map key;
 * - **`resolve` may answer `null`** — that is how accounts refuses a username
 *   its own `USER_RE` will not let become a path segment. A seam promising a
 *   `string` cannot receive it.
 */
export interface AccountsUserDataRoot {
  readonly id: string;
  readonly title: string;
  resolve: (username: string) => string | null;
  /** Bytes counted for other members too. A vault root never is. */
  readonly shared?: boolean;
}

/**
 * The slice of `accounts/lib/storage.ts` this module needs — still structurally
 * typed, so the real module satisfies it without accounts importing anything
 * from here, but now written against what that module EXPORTS rather than
 * against the sentence that described it before it was built.
 *
 * `registerUserDataRoot` is REQUIRED and there is no assign-into-the-map
 * fallback any more. There cannot be one: `USER_DATA_ROOTS` is a read-only
 * accessor object over a private `Map`, so the documented "plain exported map"
 * the old seam fell back to does not exist and never will. A fallback to a path
 * that cannot be taken is not resilience, it is an untested branch.
 */
export interface AccountsStorageSeam {
  /** Add a root. ONE argument — the descriptor carries its own id. */
  registerUserDataRoot: (root: AccountsUserDataRoot) => void;
  /** Accessors over the registry, not a map: `get` is how `charge` refuses an
   *  unknown root id rather than inventing a bucket for it. */
  USER_DATA_ROOTS: {
    get: (id: string) => AccountsUserDataRoot | undefined;
    ids: () => string[];
  };
  /**
   * `charge(user, rootId, deltaBytes)` — the ledger's advisory fast path.
   *
   * The outcome is deliberately not read. Accounts answers a `ChargeOutcome`
   * saying whether it applied, and this module's stated posture (`chargeVault`)
   * is that an accounting error must never fail the write it was accounting
   * for — so the return is widened to `unknown` rather than narrowed to
   * something this side would then be obliged to handle.
   */
  charge: (username: string, rootId: string, deltaBytes: number) => void | Promise<unknown>;
}

/**
 * One catalog row in the ACCOUNTS shape — core's `SettingRow` vocabulary plus
 * the group heading, exactly as the producing step specifies it:
 *
 * > *"the POLICY SCHEMA as typed rows with kinds mirroring core's `SettingRow`
 * > vocabulary (switch/number/select) so P4's editor can render the whole
 * > catalog generically … each row carrying a site DEFAULT"*
 * > — `axf-accounts-admin-suite.bmpx`, P2 step 1
 */
export interface AccountsPolicyRow {
  key: string;
  group: string;
  label: string;
  hint: string;
  kind: "switch" | "number" | "text" | "select";
  defaultValue: boolean | number | string;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * The slice of `accounts/lib/policy.ts` this module needs. The cascade resolves
 * site-default → per-user override itself; this module asks for the effective
 * answer and never re-implements the precedence.
 *
 * Two halves, and P3 added the second:
 *
 * - `effectivePolicy(user)` — the resolved answer, read by both integrations
 *   (`storageQuotaMB` for the vault, the twelve amberxvid rows for the guards).
 *   It is one function because it is one question; a module asking the cascade
 *   twice for two subsets of one document is two chances to disagree.
 * - `POLICY_CATALOG` / `registerPolicyRows` — where this module's rows are
 *   ADDED. Same shape as the storage seam above and for the same reason: a
 *   plain exported array is the documented way in, and a registration FUNCTION
 *   is honoured in preference when the catalog grows one, because a function
 *   can validate and an array push cannot.
 */
export interface AccountsPolicySeam {
  effectivePolicy: (
    user: string,
  ) =>
    | ({ storageQuotaMB?: number | null } & Record<string, unknown>)
    | Promise<{ storageQuotaMB?: number | null } & Record<string, unknown>>;
  POLICY_CATALOG?: AccountsPolicyRow[];
  registerPolicyRows?: (rows: readonly AccountsPolicyRow[]) => void;
}

/* ============================ the seam pins ================================== */

/**
 * **The assertion that would have caught I-30, and the one that caught it.**
 *
 * A structurally-typed seam agreed in PROSE is checked by nothing until somebody
 * writes the call. Both interfaces above were written from the producing
 * project's step text; when `accounts/lib/storage.ts` actually landed it had a
 * better shape than the prose described, and the two sides sat there
 * disagreeing — compiling perfectly, individually — for a day. The line the
 * arrival was advertised as (`installVaultStorage(accountsStorage,
 * accountsPolicy)`) could not have been written at all.
 *
 * These two assignments are that call's type-checking half, standing where it
 * will stand. They are `typeof import(...)` in TYPE position, so nothing is
 * imported at runtime and this file's server-only, no-cycle posture is
 * unchanged — but `tsc --noEmit` now fails the moment either module's exported
 * shape moves away from what this one asks of it.
 *
 * They live in `src/` on purpose. `tsconfig.json` includes `src/**` and `app/**`
 * and NOT `test/**`, so the "two-line pin in a test file" this issue's own entry
 * proposed would have been a gate nobody runs — the exact false-green this
 * codebase keeps paying for.
 */
type AccountsStorageExports = typeof import("@axs/modules/accounts/lib/storage");
type AccountsPolicyExports = typeof import("@axs/modules/accounts/lib/policy");

const storageSeamPin: AccountsStorageSeam = undefined as unknown as AccountsStorageExports;
const policySeamPin: AccountsPolicySeam = undefined as unknown as AccountsPolicyExports;
void storageSeamPin;
void policySeamPin;

/* ============================== the root ids ================================= */

/**
 * The id one vault store is registered under. Namespaced by module because
 * `USER_DATA_ROOTS` is a flat platform-wide map — an unprefixed `files` would
 * collide with the first other module that has files, and the collision would
 * be a silent overwrite of somebody's root.
 */
export const vaultRootId = (store: VaultSubdir): string => `amberxvid.${store}`;

/** Every vault store's root id, in layout order. */
export const VAULT_ROOT_IDS: readonly string[] = VAULT_SUBDIRS.map(vaultRootId);

/**
 * The five roots in the ACCOUNTS shape — this module's descriptors translated,
 * which is the whole of the translation and the reason it is in one function.
 *
 * Descriptors, not `[id, root]` pairs: the id belongs inside the entry, because
 * that is where `registerUserDataRoot` reads it from.
 */
export function accountsRootEntries(): AccountsUserDataRoot[] {
  return vaultRoots().map((root) => ({
    id: vaultRootId(root.store),
    title: root.label,
    resolve: root.resolve,
  }));
}

/* ============================== installation ================================= */

export interface VaultStorageInstallation {
  /** Root ids now present in `USER_DATA_ROOTS`. */
  rootIds: string[];
  /** True once the ledger is taking charges from this module. */
  charging: boolean;
  /** True once a quota limit has an origin — the policy cascade. */
  quotaEnforced: boolean;
  /** Catalog keys this module contributed — empty until a catalog is passed. */
  policyRowKeys: string[];
}

let installation: VaultStorageInstallation | null = null;

/**
 * Register the vaults with the platform, and route this module's accounting
 * through it. Idempotent by construction: registering the same root id twice
 * writes the same descriptor, and both seams are last-call-wins setters.
 *
 * `policy` is optional so the ledger half can land before the cascade does —
 * that is the producing project's own order (its P1 builds storage, its P2
 * builds policy), and charging without a limit is strictly better than neither.
 */
export function installVaultStorage(
  storage: AccountsStorageSeam,
  policy?: AccountsPolicySeam,
): VaultStorageInstallation {
  const rootIds: string[] = [];
  for (const root of accountsRootEntries()) {
    storage.registerUserDataRoot(root);
    rootIds.push(root.id);
  }

  setStorageLedger({
    // Awaited and discarded, not returned: accounts answers a `ChargeOutcome`
    // and this module's ledger seam promises `void | Promise<void>`. Handing the
    // outcome straight back would make the two disagree, and swallowing it here
    // is the posture `chargeVault` already states.
    charge: async ({ username, store, deltaBytes }) => {
      await storage.charge(username, vaultRootId(store), deltaBytes);
    },
  });

  const policyRowKeys: string[] = [];
  if (policy) {
    setVaultQuotaSource(async (username) => {
      const mb = (await policy.effectivePolicy(username)).storageQuotaMB;
      // A missing, null or non-positive quota is "no limit for this member" —
      // the cascade's way of saying unlimited. Never a zero-byte allowance,
      // which would refuse every write from a policy that simply said nothing.
      return typeof mb === "number" && mb > 0 ? Math.round(mb * 1024 * 1024) : null;
    });

    // P3: the same one call carries the twelve amberxvid rows INTO the catalog
    // and wires the guards' read back OUT of it. Both directions here, because
    // a catalog holding rows nothing enforces and a guard reading a row nobody
    // registered are the two halves of the same integration being half-done.
    const rows = AMBERXVID_POLICY_ROWS as readonly AccountsPolicyRow[];
    if (policy.registerPolicyRows) policy.registerPolicyRows(rows);
    else if (policy.POLICY_CATALOG) {
      // Idempotent: a re-install replaces this module's rows rather than
      // appending a second copy of each, which the editor would render twice.
      const mine = new Set(rows.map((r) => r.key));
      const kept = policy.POLICY_CATALOG.filter((r) => !mine.has(r.key));
      policy.POLICY_CATALOG.length = 0;
      policy.POLICY_CATALOG.push(...kept, ...rows);
    }
    if (policy.registerPolicyRows || policy.POLICY_CATALOG) {
      policyRowKeys.push(...rows.map((r) => r.key));
    }

    setAmberxvidPolicySource((username) => policy.effectivePolicy(username));

    // P5: the group-chat member cap. The accounts THREAD store owns the refusal
    // and declares the seam; this module owns the number and hands it over.
    // Note the direction — accounts imports nothing from here, exactly as with
    // the storage and catalog seams above, so a studio without amberxvid still
    // has group chats, at the site default.
    setThreadMemberCapSource((username) => groupChatMemberCap(username));
  }

  installation = {
    rootIds,
    charging: true,
    quotaEnforced: policy !== undefined,
    policyRowKeys,
  };
  return installation;
}

/**
 * Undo an installation — for tests, and for a seam being replaced. The roots
 * stay in `USER_DATA_ROOTS` on purpose: unregistering them would make an
 * admin's Files tab lose a member's data because a *ledger* was swapped.
 */
export function uninstallVaultStorage(): void {
  setStorageLedger(null);
  setVaultQuotaSource(null);
  setAmberxvidPolicySource(null);
  setThreadMemberCapSource(null);
  installation = null;
}

export type VaultStorageStatus =
  | ({ installed: true } & VaultStorageInstallation)
  | { installed: false; why: string };

/** Where the integration stands. `installed: false` is a stated fact. */
export function vaultStorageStatus(): VaultStorageStatus {
  if (installation) return { installed: true, ...installation };
  return {
    installed: false,
    why:
      "no accounts storage seam has installed itself yet, so vault bytes are not being " +
      "charged, no quota is enforced, this module's twelve policy rows are not in the " +
      "catalog and every one of them resolves to its site default. " +
      "`accounts/lib/storage.ts` (USER_DATA_ROOTS) and `accounts/lib/policy.ts` " +
      "(storageQuotaMB, POLICY_CATALOG) both EXIST and both satisfy the seams this file " +
      "declares — the compile-time pins beside them prove it — so what is missing is only " +
      "the call: `installVaultStorage(accountsStorage, accountsPolicy)` from the accounts " +
      "registration pass. Nothing in this module changes when it arrives.",
  };
}
