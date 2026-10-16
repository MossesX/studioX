/**
 * @file Bridge stubs for the two GizmoX server modules the AmberX Vid lib
 * layer imported (`@/lib/server/authUsers`, `@/lib/server/accountSyncClient`).
 * Neither system exists in AmberX — there is no GizmoX account store and no
 * Account Sync daemon — so this file keeps the same export names and lets the
 * callers degrade gracefully instead of porting either subsystem.
 *
 * - `notifyAccountSync` — NO-OP. In GizmoX it poked the standalone account-sync
 *   daemon (production → local reconciliation) fire-and-forget after every
 *   account mutation. There is no daemon here; account edits simply stay local,
 *   which is exactly the behaviour GizmoX itself had with the daemon down.
 *
 * - `authSecret` — kept for the module's other token families; `./session`
 *   and the `axv_session`
 *   HMAC signing key from it; a null stub would make every login unverifiable.
 *   Same resolution order as GizmoX's original (env override, else a secret
 *   file, else generate-and-persist), with module-local homes: the
 *   `AMBERXVID_AUTH_SECRET` env var, else `<dataRoot>/.auth-secret`. GizmoX
 *   shared one machine secret across token families and derived per-family
 *   keys; here the module is the only token family, so a module-owned secret
 *   preserves the security properties with nothing to collide with.
 *
 * Server-only (node imports).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataRoot } from "./paths";

/** Sync channels GizmoX's daemon knew about — kept for signature parity. */
export type SyncChannel = "gizmox-logins" | "amberxvid";

/**
 * NO-OP. GizmoX told its account-sync daemon a store changed; AmberX has no
 * such daemon, so an account mutation is complete once it hits disk. Never
 * throws, never blocks — same contract as the original.
 */
export function notifyAccountSync(_channel: SyncChannel, _reason = "account changed"): void {
  /* account sync does not exist in AmberX — intentionally nothing */
}

const secretFile = (): string => path.join(dataRoot(), ".auth-secret");

/**
 * The machine secret the suite session key is derived from. Env override
 * (`AMBERXVID_AUTH_SECRET`, >= 16 chars), else the persisted secret file,
 * else a fresh 32-byte secret generated and persisted — the same ladder as
 * GizmoX's `authUsers.authSecret()`, rehomed under the module's data root.
 */
export function authSecret(): string {
  const env = process.env.AMBERXVID_AUTH_SECRET;
  if (env && env.length >= 16) return env;
  try {
    const onDisk = fs.readFileSync(secretFile(), "utf8").trim();
    if (onDisk.length >= 16) return onDisk;
  } catch {
    /* generate below */
  }
  const fresh = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(dataRoot(), { recursive: true });
  fs.writeFileSync(secretFile(), fresh, "utf8");
  return fresh;
}
