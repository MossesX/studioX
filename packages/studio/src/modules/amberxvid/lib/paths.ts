/**
 * @file AmberX Vid store layout — every path under ONE env-driven root, and
 * every PER-USER path under ONE vault inside it (P2 of `axf-amberxvid-social`,
 * 2026-08-14).
 *
 * Dev root: `data/amberxvid/` in the repo. Prod (`amberxai.com`): set
 * `AMBERXVID_DATA_DIR` to a volume that survives a redeploy — the container
 * tree is rebuilt by `deploy/redeploy.sh`, so accounts/recordings must live on
 * mounted storage (verified across a redeploy in the deploy phase). The env
 * var is read per call, never latched at import, so tests and the deploy env
 * both take effect without ordering games.
 *
 * ```
 * <root>/
 *   users/<vaultKey>/        THE VAULT — one data location per account (P2)
 *     profile/profile.json     the profile document
 *     albums/<albumId>/        album.json + photo files
 *     recordings/<recId>/      manifest.json + media + thumbnail
 *     wall/                    posts and their media (P8)
 *     files/                   everything else the member owns
 *   users/.vault-migration.json  the migration marker (see ./migrate-vaults)
 *
 *   accounts.json.retired  the retired member store (P1 renamed it)
 *   messages/<pair>.json   messenger threads — keyed by PAIR, not by user
 *   messenger/<user>.json  per-profile messenger settings (theme, alerts…)
 *   presence/              last-seen stamps
 *   presence/live/         one file per LIVE APP PROCESS: the connections it
 *                          holds (P3 — "who is online" is the union across
 *                          processes, not one process's opinion)
 *   ratings/<kind>--<id>.json  ratings, keyed by TARGET
 *   rooms/<roomId>.json    call + stream rooms with their participants (P3)
 *   rooms/<roomId>.poster  a stream's latest poster frame (jpeg bytes)
 *   outbox/<user>/*.json   cross-process events queued for whichever process
 *                          holds that user's SSE socket (P3)
 *   invites/<user>.json    invitations, keyed by the INVITER (P7)
 *   reports.json           the moderation queue (P17) — one flat document
 *   locks/                 fsCore's cross-process lock files
 *   tray/                  tray-service sync (status.json ← tray, commands.json ← web)
 * ```
 *
 * ## What the vault is, and what it deliberately is NOT
 *
 * The vault holds the five stores the step names — **profile, albums,
 * recordings, wall, files** — because those are the ones that are *owned by a
 * member* and therefore the ones a storage ledger, a quota and an admin "show
 * me this person's data" view have to be able to name in one place.
 *
 * Everything else stays flat ON PURPOSE, and the reason is the key each store
 * is addressed by:
 *
 * - `messages/` is keyed by the sorted PAIR. A thread belongs to two people, so
 *   filing it under one of them would make the other's copy either a duplicate
 *   or a lie.
 * - `ratings/` is keyed by the TARGET being rated, not by the rater.
 * - `rooms/`, `outbox/`, `presence/live/`, `locks/` are ephemeral cross-process
 *   state keyed by room or process id; they are rebuilt on the next connection
 *   and are not anybody's stored data.
 * - `messenger/` and `presence/<user>.json` ARE per-user, and are single small
 *   documents that no quota will ever meaningfully count. They are left flat
 *   rather than moved so that P1's re-keying stays the last thing that touched
 *   them; moving a settings file to save nothing is churn with a rename bug in
 *   it. If a later phase needs them vaulted, they go under `files/`.
 *
 * ## The vault key
 *
 * `vaultKey()` is the **normalised accounts username**. The accounts module has
 * no separate id column — `Account.username` is the primary key of
 * `accounts.json` — and every per-user store in this module was already keyed
 * on the lowercased username. P1 re-keyed those stores onto the accounts
 * username, so the vault key and the on-disk key are the same value. That is
 * what makes the P2 migration a pure MOVE with no mapping table.
 *
 * ## Single authority
 *
 * Nothing outside this file builds a per-user path. `albums.ts`, `profiles.ts`,
 * `recordings.ts` and `admin.ts` resolve through the helpers below, and no
 * route builds one at all. A path built by hand is a path the migration, the
 * ledger and the admin suite cannot see.
 *
 * Server-only (node imports) — client code never touches these.
 */

import fs from "node:fs";
import path from "node:path";

import { dataRoot as persistedRoot } from "@axs/server/dataRoot";

/**
 * The store root — `AMBERXVID_DATA_DIR` env override, else `amberxvid/` under
 * the install's one persisted directory.
 *
 * Same two tiers as the accounts store: this var moves THIS store (tests, the
 * p13/p22 proof servers), `AXS_DATA_ROOT` moves the whole install at once (see
 * `src/server/dataRoot.ts` and §2.2). The default is unchanged — with neither
 * set it is still `<cwd>/data/amberxvid` — so the docblock above, which already
 * told a deployment to point this at a surviving volume, now has a way to do it
 * for every store in one variable.
 */
export function dataRoot(): string {
  const env = process.env.AMBERXVID_DATA_DIR?.trim();
  return env ? path.resolve(env) : path.join(persistedRoot(), "amberxvid");
}

/* =============================== the vault ================================== */

/**
 * The five per-user stores, in the order they are scaffolded. Exported because
 * the migration walks it and the storage-root descriptor is built from it —
 * one list, so a sixth store cannot be added to the layout and forgotten by
 * the ledger.
 */
export const VAULT_SUBDIRS = ["profile", "albums", "recordings", "wall", "files"] as const;

export type VaultSubdir = (typeof VAULT_SUBDIRS)[number];

/**
 * A username reduced to its vault key: the normalised accounts username, with
 * every character that is not filesystem-safe collapsed.
 *
 * The collapse is a SAFETY net, not a naming scheme — `isValidUsername` already
 * refuses anything exotic at the door, and this exists so that a key can never
 * contain a separator or a `..` even if a caller reaches here with something
 * unvalidated. An empty result is refused outright rather than silently
 * becoming the users root, which would make one member's vault every member's.
 */
export function vaultKey(username: string): string {
  const key = username.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^\.+/, "");
  if (!key) throw new Error("vaultKey: empty username has no vault");
  return key;
}

/** The parent of every vault. */
export const usersDir = (): string => path.join(dataRoot(), "users");

/** One account's whole data location. */
export const vaultDir = (username: string): string => path.join(usersDir(), vaultKey(username));

export const vaultProfileDir = (username: string): string => path.join(vaultDir(username), "profile");
export const vaultAlbumsDir = (username: string): string => path.join(vaultDir(username), "albums");
export const vaultRecordingsDir = (username: string): string => path.join(vaultDir(username), "recordings");
export const vaultWallDir = (username: string): string => path.join(vaultDir(username), "wall");
export const vaultFilesDir = (username: string): string => path.join(vaultDir(username), "files");

/** The profile document — one file, its own directory, so an avatar can join it. */
export const vaultProfileFile = (username: string): string =>
  path.join(vaultProfileDir(username), "profile.json");

export const vaultAlbumDir = (username: string, albumId: string): string =>
  path.join(vaultAlbumsDir(username), albumId);

export const vaultRecordingDir = (username: string, recordingId: string): string =>
  path.join(vaultRecordingsDir(username), recordingId);

/**
 * Wall attachments — inside the **files** store, not the wall one (P8).
 *
 * The wall store holds documents: one JSON per post plus the index. The bytes
 * a post attaches are ordinary member files, and the ledger charges them to
 * `files` because that is where a RESCAN will find them — a charge filed
 * against a store the walker does not weigh is a ledger that disagrees with
 * the disk on its first reconciliation.
 *
 * Named here rather than joined at the store because it is the one path that
 * crosses two of the five stores, and a crossing that is spelled out once
 * cannot be spelled differently the second time.
 */
export const vaultWallMediaDir = (username: string): string =>
  path.join(vaultFilesDir(username), "wall");

/** Scaffold one member's vault (idempotent). */
export function ensureVault(username: string): string {
  const dir = vaultDir(username);
  for (const sub of VAULT_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
}

/**
 * Every vault key on disk, sorted. Dot-prefixed entries are skipped — the
 * migration marker lives in this directory and is not a member.
 */
export function listVaultKeys(): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(usersDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

/**
 * Find the directory of a recording whose OWNER is not known to the caller.
 *
 * Recordings are addressed by capture id in URLs (`/api/amberxvid/recordings/
 * <id>/file`), and the owner is a field inside the manifest — so the one route
 * that serves media has an id and nothing else. Rather than make every caller
 * carry an owner it does not have, the lookup walks the vaults; there is one
 * `existsSync` per member and it happens once per media request.
 *
 * The legacy flat directory is checked last so that a store which has not been
 * migrated yet still serves its recordings instead of 404-ing. Callers that DO
 * know the owner (everything holding a manifest) must use `vaultRecordingDir`
 * and never this.
 */
export function resolveRecordingDir(recordingId: string): string | null {
  for (const key of listVaultKeys()) {
    const dir = path.join(usersDir(), key, "recordings", recordingId);
    if (fs.existsSync(dir)) return dir;
  }
  const legacy = path.join(legacyRecordingsDir(), recordingId);
  return fs.existsSync(legacy) ? legacy : null;
}

/* ==================== the flat half of the store (see header) ================= */

/**
 * The RETIRED message store (P6, 2026-08-15). Messages live in the accounts
 * store now; this directory is a migration source and an archive of what was
 * drained out of it, nothing else. `migrate-messages.ts` is the only file that
 * still names it, and every thread it moves is left behind as `<id>.json.migrated`
 * — never deleted, so the migration is auditable against the originals.
 */
export const messagesDir = (): string => path.join(dataRoot(), "messages");
/** The message-migration marker — its presence is what makes the P6 pass a
 *  no-op, and it holds the first run's record. */
export const messageMarkerFile = (): string =>
  path.join(messagesDir(), ".message-migration.json");
export const messengerSettingsDir = (): string => path.join(dataRoot(), "messenger");

/**
 * THE MODERATION QUEUE (P17), one flat document for the whole deployment.
 *
 * Not per-reporter and not per-subject, because every operation the queue has
 * is a queue-wide one: show the open reports, act on this one, count what is
 * waiting. A file per reporter would make "what is open" a directory scan, and
 * a file per subject would make a report about a deleted post homeless — the
 * entry has to OUTLIVE its subject or the evidence dies with it.
 *
 * Flat rather than vaulted for the reason `invites/` and `follows/` are: the
 * vault holds what the storage ledger and the quota must count, and a capped
 * list of report rows is not a member's stored data — it is the moderators'.
 */
export const reportsFile = (): string => path.join(dataRoot(), "reports.json");
export const presenceDir = (): string => path.join(dataRoot(), "presence");
export const trayDir = (): string => path.join(dataRoot(), "tray");
export const ratingsDir = (): string => path.join(dataRoot(), "ratings");

/**
 * The FOLLOW graph (P12), one document per member: who they follow and who
 * follows them.
 *
 * Flat rather than vaulted, for the reason `invites/` is: the vault holds what
 * a storage ledger and a quota have to count, and a follow list is one small
 * document no quota will ever meaningfully count. Keyed by vault key so an
 * exotic username lands on the same filename rule every other per-user path
 * uses.
 */
export const followsDir = (): string => path.join(dataRoot(), "follows");
export const followsFile = (username: string): string =>
  path.join(followsDir(), `${vaultKey(username)}.json`);

/**
 * STREAM HISTORY (P12), one document per member holding both halves: the
 * streams they hosted and the streams they watched.
 *
 * One file rather than two because both are written on the same events (a room
 * ending writes the host's hosted row and every attached watcher's watched
 * row) and both are read by the same surface. A member who has never streamed
 * and never watched has no file at all, which is the honest empty state.
 */
export const streamHistoryDir = (): string => path.join(dataRoot(), "stream-history");
export const streamHistoryFile = (username: string): string =>
  path.join(streamHistoryDir(), `${vaultKey(username)}.json`);

/**
 * CALL HISTORY (P13), one document per member: everything they placed,
 * received and missed, 1:1 calls and group-room rings alike.
 *
 * Flat rather than vaulted, for the reason `follows/` and `invites/` are: the
 * vault holds what the storage ledger and the quota have to count, and a capped
 * list of call rows is not that. Keyed by vault key so an exotic username lands
 * on the same filename rule every other per-user path uses.
 *
 * Per MEMBER rather than per CALL, because both sides of a call keep their own
 * row: the caller's says "placed" and the callee's may say "missed", and they
 * close at different moments. One shared record would have had to hold both
 * viewpoints anyway, under a lock two processes contend for.
 */
export const callHistoryDir = (): string => path.join(dataRoot(), "call-history");
export const callHistoryFile = (username: string): string =>
  path.join(callHistoryDir(), `${vaultKey(username)}.json`);

/**
 * AVAILABILITY (P13) — the do-not-disturb document, one per member.
 *
 * Its own file rather than a field on the messenger settings, because the ring
 * path reads it on EVERY invite and the messenger settings document is written
 * whenever somebody changes a chat theme. Splitting them keeps a theme change
 * off the hot path of a ring, and keeps a DND read from having to parse twenty
 * skin values.
 */
export const availabilityDir = (): string => path.join(dataRoot(), "availability");
export const availabilityFile = (username: string): string =>
  path.join(availabilityDir(), `${vaultKey(username)}.json`);

/** One file per live app process, listing the SSE connections it holds. */
export const presenceLiveDir = (): string => path.join(presenceDir(), "live");
/** Call + stream room records, one JSON per room. */
export const roomsDir = (): string => path.join(dataRoot(), "rooms");
/** Per-user cross-process event queues: `outbox/<user>/<seq>.json`. */
export const outboxDir = (): string => path.join(dataRoot(), "outbox");
/** fsCore's lock files — never data, safe to delete when nothing is running. */
export const locksDir = (): string => path.join(dataRoot(), "locks");

/**
 * Invitations, keyed by the INVITER (P7).
 *
 * Flat rather than vaulted, and the header's own test says why: the vault
 * holds what a storage ledger and a quota have to count, and a member's
 * invitations are one small document that no quota will ever meaningfully
 * count — the same reasoning that leaves `messenger/` flat.
 *
 * One file per inviter rather than one per invite, because every operation
 * this store has is per-inviter: list mine, revoke mine, and count how many I
 * created in the last hour for the rate cap. A file per invite would make the
 * cap a directory scan. Redemption still finds its record in one read, because
 * the TOKEN carries the inviter — which is the property that made this the
 * cheaper key rather than merely the tidier one.
 */
export const invitesDir = (): string => path.join(dataRoot(), "invites");

/** One inviter's invitations. Keyed by vault key, so it survives the same
 *  exotic-username cases every other per-user path does. */
export const invitesFile = (username: string): string =>
  path.join(invitesDir(), `${vaultKey(username)}.json`);

/* ------------------------------- pre-vault layout ------------------------------ */

/**
 * Where profiles, albums and recordings lived BEFORE the vault.
 *
 * These are migration sources and legacy read fallbacks, nothing else. They are
 * named `legacy*` rather than left under their old names precisely so that a
 * new call site cannot reach for one by accident — writing here again would
 * put data somewhere the ledger, the quota and the admin suite do not look.
 */
export const legacyProfilesDir = (): string => path.join(dataRoot(), "profiles");
export const legacyAlbumsDir = (): string => path.join(dataRoot(), "albums");
export const legacyRecordingsDir = (): string => path.join(dataRoot(), "recordings");

/** The migration marker — its presence is what makes the P2 pass a no-op. */
export const vaultMarkerFile = (): string => path.join(usersDir(), ".vault-migration.json");

/* ============================ storage-root descriptor ========================= */

/**
 * One vault root, described as data.
 *
 * This is the module's own shape, deliberately NOT an import from the accounts
 * module: `accounts/lib/storage.ts` and its `USER_DATA_ROOTS` seam do not exist
 * on disk yet (they belong to `axf-accounts-admin-suite`, which has never run —
 * see this project's P0 inventory). Declaring the roots as module-owned data is
 * what keeps the registration to ONE adapter — `./vault-registration`, which
 * translates these descriptors into the accounts shape and is the only file
 * that knows that shape — rather than a rewrite of every helper above.
 */
export interface VaultRootDescriptor {
  /** The owning module — what the admin suite groups a row under. */
  moduleId: "amberxvid";
  /** Which of the five stores this root is. */
  store: VaultSubdir;
  /** Human label for an admin row, e.g. "AmberX Vid · albums". */
  label: string;
  /** Absolute directory for one member's copy of this store. */
  resolve: (username: string) => string;
}

const STORE_LABELS: Record<VaultSubdir, string> = {
  profile: "AmberX Vid · profile",
  albums: "AmberX Vid · albums",
  recordings: "AmberX Vid · recordings",
  wall: "AmberX Vid · wall",
  files: "AmberX Vid · files",
};

/**
 * The five roots the module asks the platform ledger to count, derived from
 * `VAULT_SUBDIRS` rather than listed again — a store added to the layout is a
 * store the ledger is told about, with no second edit.
 */
export function vaultRoots(): VaultRootDescriptor[] {
  return VAULT_SUBDIRS.map((store) => ({
    moduleId: "amberxvid" as const,
    store,
    label: STORE_LABELS[store],
    resolve: (username: string) => path.join(vaultDir(username), store),
  }));
}

/* ---------------------------------- scaffold ---------------------------------- */

/** Scaffold the whole layout (idempotent). Vaults are made per member. */
export function ensureStoreDirs(): void {
  for (const dir of [
    dataRoot(),
    usersDir(),
    messagesDir(),
    messengerSettingsDir(),
    presenceDir(),
    presenceLiveDir(),
    roomsDir(),
    outboxDir(),
    invitesDir(),
    locksDir(),
    trayDir(),
    ratingsDir(),
    followsDir(),
    streamHistoryDir(),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
