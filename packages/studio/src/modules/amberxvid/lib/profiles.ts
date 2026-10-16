/**
 * @file AmberX Vid profile store — one JSON per member at
 * `users/<vaultKey>/profile/profile.json`, holding the module face of an
 * account: status line, about-me and the designed `AvatarSpec`.
 *
 * The path is resolved through `./paths` and nowhere else (P2, 2026-08-14):
 * `profile` is one of the five vault stores, so the platform ledger counts it,
 * the admin suite lists it, and the remove-user cascade takes it with the rest
 * of the vault. It used to live flat under `<root>/profiles/`, which is now a
 * migration source only.
 *
 * The accounts store stays the single source of truth for identity: a profile
 * EXISTS exactly when its account has completed entry (screenname chosen), and
 * `screenname` is re-synced from the account on every read — a profile file
 * can never disagree with the roster. Missing files synthesize an honest
 * default (no avatar yet, empty status) rather than 404ing a member who has
 * simply never opened the editor.
 *
 * Mutation rights: the owner, or an administrator who has completed their own
 * entry (the admin-manageable duty — the P9 window drives the same functions).
 * House store posture throughout: degrade never crash, atomic writes, every
 * mutation in the activity ledger (which can never fail a save). Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { appendJournal } from "./fsCore";
import { findAccount, isValidUsername, listAccounts } from "./accounts";
import { isPortrait, normalizeAvatarValue } from "./avatar";
import { vaultProfileFile } from "./paths";
import { assertVaultQuota, chargeVault } from "./vault";
import { ABOUT_MAX, STATUS_MAX, type AmberXVidAccount, type Profile } from "./types";

export type ProfileResult =
  | { ok: true; profile: Profile }
  | { ok: false; error: string; status: number };

const fail = (status: number, error: string): ProfileResult => ({ ok: false, error, status });

// Re-exported for existing store consumers; the caps LIVE in the type spine
// so the client editor can import them without touching this node-only file.
export { ABOUT_MAX, STATUS_MAX };

/* --------------------------------- plumbing ----------------------------------- */

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

/** Journaling must never fail a save (same posture + mute switch as accounts). */
async function journal(op: "create" | "edit", abs: string, summary: string): Promise<void> {
  if (process.env.AMBERXVID_SILENT_JOURNAL === "1") return;
  try {
    await appendJournal(op, ledgerPath(abs), { summary });
  } catch {
    /* ignore */
  }
}

/**
 * Exactly the bytes {@link writeAtomicText} puts on disk. Serializing once and
 * measuring THAT string is what lets the quota check and the write agree about
 * the size of the same document — a quota that guesses is a quota that is wrong
 * on the one save that matters (an AI portrait, which is tens of KB of SVG).
 */
const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

async function writeAtomicText(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, text, "utf8");
  await fsp.rename(tmp, file);
}

/** What this document currently weighs; a document that is not there weighs 0. */
function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** The profile document, in the member's vault (P2). Resolved through `./paths`
 *  — this store never builds a per-user path of its own. */
const profileFile = (username: string): string => vaultProfileFile(username);

/* ---------------------------------- access ------------------------------------- */

/**
 * May `actor` act on `owner`'s data? Owner always; otherwise an administrator
 * whose own entry flow is complete. Shared with the album store — this is the
 * whole "all data admin-manageable" rule in one place.
 */
export async function resolveActor(
  actor: string,
  owner: string,
): Promise<{ ok: true; asAdmin: boolean } | { ok: false; error: string; status: number }> {
  if (actor.toLowerCase() === owner.toLowerCase()) return { ok: true, asAdmin: false };
  const admin = await findAccount(actor);
  if (!admin || admin.disabled === true || admin.role !== "administrator") {
    return { ok: false, error: "only the owner or an administrator may do that", status: 403 };
  }
  if (admin.mustChangePassword || !admin.screenname) {
    return { ok: false, error: "complete your own entry flow first", status: 409 };
  }
  return { ok: true, asAdmin: true };
}

/* ----------------------------------- reads ------------------------------------- */

/** A member has a profile the moment their entry flow completes. */
function entered(account: AmberXVidAccount): boolean {
  return account.screenname !== null && !account.mustChangePassword;
}

function synthesize(account: AmberXVidAccount): Profile {
  return {
    version: 1,
    username: account.username,
    screenname: account.screenname ?? account.username,
    avatar: null,
    statusLine: "",
    aboutMe: "",
    createdAt: account.updatedAt,
    updatedAt: account.updatedAt,
  };
}

function readFileFor(account: AmberXVidAccount): Profile {
  try {
    const raw = JSON.parse(fs.readFileSync(profileFile(account.username), "utf8")) as Profile;
    if (raw?.version !== 1 || typeof raw.username !== "string") return synthesize(account);
    return {
      ...synthesize(account),
      ...raw,
      // Identity always re-syncs from the account — the roster is the truth.
      username: account.username,
      screenname: account.screenname ?? account.username,
      // Two kinds now (16-axis spec | AI portrait) — one door for both.
      avatar: normalizeAvatarValue(raw.avatar),
      statusLine: typeof raw.statusLine === "string" ? raw.statusLine : "",
      aboutMe: typeof raw.aboutMe === "string" ? raw.aboutMe : "",
    };
  } catch {
    return synthesize(account);
  }
}

export async function getProfile(username: string): Promise<Profile | null> {
  if (!isValidUsername(username.trim())) return null;
  const account = await findAccount(username);
  if (!account || account.disabled === true || !entered(account)) return null;
  return readFileFor(account);
}

/** Every entered member's profile, screenname order. */
export async function listProfiles(): Promise<Profile[]> {
  const accounts = await listAccounts();
  return accounts
    .filter((a) => a.disabled !== true && entered(a))
    .map(readFileFor)
    .sort((a, b) => a.screenname.localeCompare(b.screenname, undefined, { sensitivity: "base" }));
}

/* ---------------------------------- mutation ------------------------------------ */

export interface ProfilePatch {
  statusLine?: string;
  aboutMe?: string;
  /** An `AvatarSpec` or a `PortraitAvatar` to set (normalized on write),
   *  or `null` to clear. A portrait must ALREADY be sanitized — the
   *  portrait route is the only writer and does that at its own door. */
  avatar?: unknown;
}

/** Update `owner`'s profile as `actor` (owner or admin). */
export async function updateProfile(
  actor: string,
  owner: string,
  patch: ProfilePatch,
): Promise<ProfileResult> {
  const gate = await resolveActor(actor, owner);
  if (!gate.ok) return fail(gate.status, gate.error);
  const account = await findAccount(owner);
  if (!account || account.disabled === true) return fail(404, "no such module account");
  if (!entered(account)) return fail(409, "that member has not completed entry yet");

  if (patch.statusLine !== undefined && patch.statusLine.length > STATUS_MAX) {
    return fail(400, `status line is capped at ${STATUS_MAX} characters`);
  }
  if (patch.aboutMe !== undefined && patch.aboutMe.length > ABOUT_MAX) {
    return fail(400, `about-me is capped at ${ABOUT_MAX} characters`);
  }

  const current = readFileFor(account);
  const isNew = !fs.existsSync(profileFile(owner));
  const next: Profile = {
    ...current,
    statusLine: patch.statusLine !== undefined ? patch.statusLine.trim() : current.statusLine,
    aboutMe: patch.aboutMe !== undefined ? patch.aboutMe : current.aboutMe,
    avatar: patch.avatar === undefined ? current.avatar : normalizeAvatarValue(patch.avatar),
    updatedAt: new Date().toISOString(),
  };
  // The vault quota, then the ledger — the profile document is one of the five
  // vault stores, and its delta IS knowable (this is the only writer), so it
  // charges rather than waiting for a rescan. The delta is signed: clearing an
  // avatar gives bytes back.
  const payload = serialize(next);
  const deltaBytes = Buffer.byteLength(payload) - fileBytes(profileFile(owner));
  const room = await assertVaultQuota(owner, deltaBytes);
  if (!room.ok) return fail(room.status, room.error);
  await writeAtomicText(profileFile(owner), payload);
  await chargeVault(
    owner,
    "profile",
    deltaBytes,
    isNew ? `profile created for ${account.username}` : `profile saved for ${account.username}`,
  );

  const what =
    patch.avatar !== undefined
      ? patch.avatar === null
        ? "cleared the avatar on"
        : isPortrait(patch.avatar)
          ? "saved an AI portrait to"
          : "saved a designed avatar to"
      : "edited";
  await journal(
    isNew ? "create" : "edit",
    profileFile(owner),
    gate.asAdmin
      ? `AmberX Vid admin ${actor} ${what} ${account.username}'s profile`
      : `AmberX Vid: ${account.username} ${what} their profile`,
  );
  return { ok: true, profile: next };
}
