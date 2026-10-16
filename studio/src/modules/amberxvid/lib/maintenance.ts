/**
 * @file **DB maintenance** — the vault integrity scan, its fix pass, and the
 * orphan sweep for rooms and threads whose owners are gone (P17 of
 * `axf-amberxvid-social`, 2026-08-15).
 *
 * ## Why a scan exists at all
 *
 * Every store in this module keeps two things that must agree: a DOCUMENT (an
 * index, a manifest, an album) and the BYTES it describes. They are written in
 * separate steps by design — a crash between them, a killed upload, a `rm` a
 * human ran, a migration that skipped a vault, and the two disagree. Each
 * disagreement is individually harmless and cumulatively expensive:
 *
 * - **orphan files** are charged to a member's quota forever and shown to
 *   nobody. This is the silent one, and it is the reason the scan exists.
 * - **missing files** render as a broken image or a recording that will not
 *   play — loud, so somebody eventually reports them.
 * - **stale index rows** cost a read that finds nothing, every read.
 *
 * ## Scan and fix are two calls, deliberately
 *
 * {@link scanVaults} writes nothing. The moderator reads the findings, and only
 * then may run {@link repairVaults}, which re-scans and repairs — never acting
 * on the numbers the first pass reported, which are already minutes old by the
 * time a person has read them. A one-button "scan and fix" would delete files
 * on the strength of a scan nobody looked at.
 *
 * ## Every repair goes through the store that owns the thing
 *
 * `repairWall` (wall.ts), `deletePhoto` (albums.ts), `deleteRecording`
 * (recordings.ts), `deleteRoom` (roomStore.ts), `deleteThread` (accounts
 * messages). This file composes them and does the arithmetic NOBODY else can —
 * the quota credit for bytes that belong to no document, which by definition no
 * store verb knows about. That one exception aside, a repair here is the same
 * code path the ordinary delete is.
 *
 * Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { adminListThreads, deleteThread } from "@axs/modules/accounts/lib/messages";
import { findAccount } from "@axs/modules/accounts/lib/accounts";

import { deletePhoto, listAlbums, photoPathOf } from "./albums";
import { auditModeration } from "./moderation";
import {
  listVaultKeys,
  usersDir,
  vaultAlbumsDir,
  vaultDir,
  vaultRecordingsDir,
} from "./paths";
import { listRecordings } from "./recordings";
import { deleteRoom, listRooms } from "./roomStore";
import { chargeVault, dirBytes } from "./vault";
import { auditWall, repairWall } from "./wall";
import type { VaultFinding, VaultScan } from "./types";

/* --------------------------------- plumbing ------------------------------------ */

const finding = (f: Omit<VaultFinding, "bytes" | "fixable"> & Partial<VaultFinding>): VaultFinding => ({
  bytes: 0,
  fixable: true,
  ...f,
});

function statBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Does this vault key still have an account? The question every orphan check
 *  bottoms out in — asked of the ACCOUNTS store, which is the one identity
 *  system (P1), never of a roster kept here. */
async function accountExists(username: string): Promise<boolean> {
  return (await findAccount(username)) !== null;
}

/* ------------------------------- the album store -------------------------------- */

/**
 * Albums, both directions: a photo the manifest lists but has no bytes for, and
 * a file in an album directory the manifest does not list.
 *
 * `album.json` itself is skipped as a matter of course, and so is anything in a
 * directory that is not a readable album — an unreadable album is reported as
 * one finding rather than as every file inside it, because the repair for it is
 * a human reading the JSON, not a sweep.
 */
async function scanAlbums(owner: string): Promise<VaultFinding[]> {
  const out: VaultFinding[] = [];
  const albums = await listAlbums(owner);
  const known = new Set(albums.map((a) => a.id));

  for (const album of albums) {
    const listed = new Set<string>(["album.json"]);
    for (const photo of album.photos) {
      listed.add(photo.file);
      const abs = photoPathOf(album, photo);
      if (!fs.existsSync(abs)) {
        out.push(
          finding({
            owner,
            kind: "missing-file",
            subject: `albums/${album.id}/${photo.id}`,
            detail: `“${album.title}” lists a photo whose bytes are gone (${photo.file})`,
          }),
        );
      }
    }
    let names: string[] = [];
    try {
      names = await fsp.readdir(path.join(vaultAlbumsDir(owner), album.id));
    } catch {
      names = [];
    }
    for (const name of names) {
      if (listed.has(name) || name.endsWith(".tmp")) continue;
      const abs = path.join(vaultAlbumsDir(owner), album.id, name);
      out.push(
        finding({
          owner,
          kind: "orphan-file",
          subject: `albums/${album.id}/${name}`,
          detail: `a file in “${album.title}” that the album manifest does not list`,
          bytes: statBytes(abs),
        }),
      );
    }
  }

  // A directory under `albums/` with no readable manifest: the album that was
  // half-created, or whose JSON was corrupted. Not swept automatically — the
  // photos inside it may be the only copy, and a manifest is repairable.
  let dirs: string[] = [];
  try {
    dirs = await fsp.readdir(vaultAlbumsDir(owner));
  } catch {
    dirs = [];
  }
  for (const dir of dirs) {
    if (known.has(dir)) continue;
    const abs = path.join(vaultAlbumsDir(owner), dir);
    if (!fs.statSync(abs).isDirectory()) continue;
    out.push(
      finding({
        owner,
        kind: "orphan-file",
        subject: `albums/${dir}`,
        detail: "an album directory with no readable manifest — the photos inside are unreachable",
        bytes: await dirBytes(abs),
        fixable: false,
      }),
    );
  }
  return out;
}

/** Repair the album findings the scan can fix: drop the photo rows whose bytes
 *  are gone (through the store's own delete, so the manifest and the cover
 *  fall back correctly), and delete the files the manifest does not list. */
async function repairAlbums(actor: string, owner: string, findings: VaultFinding[]): Promise<number> {
  let freed = 0;
  for (const f of findings) {
    if (f.owner !== owner || !f.fixable) continue;
    const parts = f.subject.split("/");
    if (parts[0] !== "albums" || parts.length < 3) continue;
    const albumId = parts[1] ?? "";
    const leaf = parts.slice(2).join("/");
    if (f.kind === "missing-file") {
      const res = await deletePhoto(actor, owner, albumId, leaf);
      f.fixed = res.ok;
    } else if (f.kind === "orphan-file") {
      const abs = path.join(vaultAlbumsDir(owner), albumId, leaf);
      const bytes = statBytes(abs);
      try {
        await fsp.rm(abs, { force: true });
        // The credit no store verb can give: these bytes belong to no photo, so
        // nothing else in the module knows they were ever charged.
        if (bytes > 0) await chargeVault(owner, "albums", -bytes, "maintenance: unlisted album file removed");
        freed += bytes;
        f.fixed = true;
      } catch {
        f.fixed = false;
      }
    }
  }
  return freed;
}

/* ----------------------------- the recording store ------------------------------- */

/** Recordings: a manifest whose media file is gone, and a capture directory
 *  with no readable manifest at all. */
async function scanRecordings(owner: string): Promise<VaultFinding[]> {
  const out: VaultFinding[] = [];
  const mine = await listRecordings(owner);
  const known = new Set(mine.map((m) => m.id));

  for (const m of mine) {
    const abs = path.join(vaultRecordingsDir(owner), m.id, m.file);
    if (!fs.existsSync(abs) && m.endedAt !== null) {
      out.push(
        finding({
          owner,
          kind: "missing-file",
          subject: `recordings/${m.id}`,
          detail: `“${m.title}” has a manifest but no media file`,
        }),
      );
    }
  }

  let dirs: string[] = [];
  try {
    dirs = await fsp.readdir(vaultRecordingsDir(owner));
  } catch {
    dirs = [];
  }
  for (const dir of dirs) {
    if (known.has(dir)) continue;
    const abs = path.join(vaultRecordingsDir(owner), dir);
    out.push(
      finding({
        owner,
        kind: "orphan-file",
        subject: `recordings/${dir}`,
        detail: "a capture directory with no readable manifest",
        bytes: await dirBytes(abs),
      }),
    );
  }
  return out;
}

/** Remove the manifest-less capture directories, crediting the bytes back. A
 *  manifest with no media is left to the recordings browser's own purge — it
 *  is a real library row and deleting it belongs behind that confirm. */
async function repairRecordings(owner: string, findings: VaultFinding[]): Promise<number> {
  let freed = 0;
  for (const f of findings) {
    if (f.owner !== owner || f.kind !== "orphan-file" || !f.subject.startsWith("recordings/")) continue;
    const abs = path.join(vaultRecordingsDir(owner), f.subject.slice("recordings/".length));
    try {
      const bytes = await dirBytes(abs);
      await fsp.rm(abs, { recursive: true, force: true });
      if (bytes > 0) {
        await chargeVault(owner, "recordings", -bytes, "maintenance: manifest-less capture removed");
      }
      freed += bytes;
      f.fixed = true;
    } catch {
      f.fixed = false;
    }
  }
  return freed;
}

/* ------------------------------------ the wall ----------------------------------- */

/** The wall's own audit, projected into the shared finding shape. The scan
 *  itself lives in `wall.ts`, where the index rules are. */
function wallFindings(owner: string): VaultFinding[] {
  const audit = auditWall(owner);
  return [
    ...audit.staleIndexRows.map((id) =>
      finding({
        owner,
        kind: "stale-index-row",
        subject: `wall/${id}`,
        detail: "the wall index names a post whose document is gone",
      }),
    ),
    ...audit.danglingMedia.map(({ postId, mediaId }) =>
      finding({
        owner,
        kind: "dangling-media",
        subject: `wall/${postId}/${mediaId}`,
        detail: "a post references an attachment whose bytes are gone — it renders broken",
      }),
    ),
    ...audit.orphanFiles.map((o) =>
      finding({
        owner,
        kind: "orphan-file",
        subject: `files/${o.file}`,
        detail: o.young
          ? "an unclaimed wall attachment, too young to sweep (a composer may still be open)"
          : "a wall attachment no post claims — charged to the quota, shown to nobody",
        bytes: o.bytes,
        fixable: !o.young,
      }),
    ),
  ];
}

/* -------------------------------- rooms and threads ------------------------------- */

/**
 * Rooms whose HOST no longer has an account.
 *
 * A room outlives the process that made it (the shared room store's whole
 * point), and the participant sweeper only drops people who stopped
 * heartbeating — neither notices that the host's account was deleted. The
 * record then sits in the store forever, listed as live to anybody who asks.
 */
async function scanRooms(): Promise<{ findings: VaultFinding[]; rooms: number }> {
  const rooms = listRooms();
  const out: VaultFinding[] = [];
  for (const rec of rooms) {
    if (await accountExists(rec.host)) continue;
    out.push(
      finding({
        owner: rec.host,
        kind: "orphan-room",
        subject: `rooms/${rec.id}`,
        detail: `a ${rec.kind} room whose host “${rec.host}” no longer has an account`,
      }),
    );
  }
  return { findings: out, rooms: rooms.length };
}

/**
 * Threads every one of whose participants is gone.
 *
 * EVERY one, not any: a conversation belongs to both sides, and deleting it
 * because one of them was removed would take the survivor's history with it —
 * which is the accounts store's stated posture on a member removal, honoured
 * here rather than re-decided.
 */
async function scanThreads(): Promise<{ findings: VaultFinding[]; threads: number }> {
  const threads = await adminListThreads();
  const out: VaultFinding[] = [];
  for (const t of threads) {
    const alive = await Promise.all(t.participants.map((p) => accountExists(p)));
    if (alive.some(Boolean)) continue;
    out.push(
      finding({
        owner: t.participants[0] ?? "-",
        kind: "orphan-thread",
        subject: `threads/${t.id}`,
        detail: `a conversation (${t.participants.join(" ↔ ")}) none of whose members still have accounts`,
        bytes: t.sizeBytes,
      }),
    );
  }
  return { findings: out, threads: threads.length };
}

/* ------------------------------------ the scan ------------------------------------ */

/**
 * Walk every vault, every room and every thread. Writes nothing.
 *
 * A vault whose account is gone is reported as ONE finding and then walked no
 * further: its contents are not defects, they are a deleted member's data, and
 * removing them is the accounts suite's `remove-user-data` cascade — which is
 * exactly the sort of thing the wing must not grow a second copy of.
 */
export async function scanVaults(): Promise<VaultScan> {
  const findings: VaultFinding[] = [];
  const keys = listVaultKeys();

  for (const key of keys) {
    if (!(await accountExists(key))) {
      findings.push(
        finding({
          owner: key,
          kind: "orphan-vault",
          subject: `users/${key}`,
          detail:
            "a vault whose account no longer exists — remove it from the suite's own " +
            "Remove stored data control, which is the audited path for a member's data",
          bytes: await dirBytes(vaultDir(key)),
          fixable: false,
        }),
      );
      continue;
    }
    findings.push(...wallFindings(key));
    findings.push(...(await scanAlbums(key)));
    findings.push(...(await scanRecordings(key)));
  }

  const rooms = await scanRooms();
  const threads = await scanThreads();
  findings.push(...rooms.findings, ...threads.findings);

  return {
    findings,
    vaults: keys.length,
    rooms: rooms.rooms,
    threads: threads.threads,
    bytes: findings.reduce((n, f) => n + f.bytes, 0),
    generatedAt: new Date().toISOString(),
    repaired: false,
  };
}

/**
 * The fix pass: re-scan, then repair everything marked fixable, and report what
 * was actually done per finding (`fixed`) rather than what was attempted.
 *
 * Orphan rooms and threads are NOT touched here — {@link sweepOrphans} is their
 * own verb behind its own button, because ending a room and deleting a
 * conversation are visible to people, while everything in this pass is invisible
 * housekeeping. One button that did both would make the safe half unusable
 * without the unsafe half.
 */
export async function repairVaults(actor: string): Promise<VaultScan> {
  const scan = await scanVaults();
  let freed = 0;
  const owners = new Set(
    scan.findings
      .filter((f) => f.fixable && f.kind !== "orphan-room" && f.kind !== "orphan-thread")
      .map((f) => f.owner),
  );

  for (const owner of owners) {
    const mine = scan.findings.filter((f) => f.owner === owner);
    const wall = await repairWall(owner);
    freed += wall.freedBytes;
    for (const f of mine) {
      if (f.kind === "stale-index-row" || f.kind === "dangling-media") f.fixed = true;
      if (f.kind === "orphan-file" && f.subject.startsWith("files/wall/")) f.fixed = f.fixable;
    }
    freed += await repairAlbums(actor, owner, mine);
    freed += await repairRecordings(owner, mine);
  }

  const fixed = scan.findings.filter((f) => f.fixed === true).length;
  await auditModeration({
    actor,
    act: "vault-repaired",
    subject: `maintenance/vaults/-`,
    reason: "vault integrity fix pass",
    detail: `${fixed}/${scan.findings.length} finding(s) repaired · ${(freed / 1024 / 1024).toFixed(2)} MB reclaimed`,
  });

  return { ...scan, repaired: true, bytes: freed, generatedAt: new Date().toISOString() };
}

/**
 * Delete the rooms and conversations whose owners are gone. Its own verb, its
 * own button, its own audit line — see {@link repairVaults} for why it is not
 * folded into the fix pass.
 */
export async function sweepOrphans(actor: string): Promise<VaultScan> {
  const rooms = await scanRooms();
  const threads = await scanThreads();
  const findings = [...rooms.findings, ...threads.findings];

  for (const f of findings) {
    if (f.kind === "orphan-room") {
      try {
        deleteRoom(f.subject.slice("rooms/".length));
        f.fixed = true;
      } catch {
        f.fixed = false;
      }
    } else if (f.kind === "orphan-thread") {
      const res = await deleteThread(actor, f.subject.slice("threads/".length));
      f.fixed = res.ok;
    }
  }

  const swept = findings.filter((f) => f.fixed === true).length;
  await auditModeration({
    actor,
    act: "orphans-swept",
    subject: `maintenance/orphans/-`,
    reason: "sweep of rooms and conversations whose owners were deleted",
    detail: `${swept}/${findings.length} removed`,
  });

  return {
    findings,
    vaults: 0,
    rooms: rooms.rooms,
    threads: threads.threads,
    bytes: findings.reduce((n, f) => n + (f.fixed ? f.bytes : 0), 0),
    generatedAt: new Date().toISOString(),
    repaired: true,
  };
}

/** The scan, audited — what the wing's button calls, so that even a read-only
 *  pass leaves a line saying an administrator went looking. */
export async function scanVaultsAudited(actor: string): Promise<VaultScan> {
  const scan = await scanVaults();
  await auditModeration({
    actor,
    act: "vault-scanned",
    subject: `maintenance/vaults/-`,
    reason: "vault integrity scan",
    detail:
      `${scan.findings.length} finding(s) across ${scan.vaults} vault(s), ` +
      `${scan.rooms} room(s), ${scan.threads} thread(s)`,
  });
  return scan;
}

/** The store root, for the wing's header line. Named here so the wing never
 *  builds a path (`./paths`'s single-authority rule). */
export const storeRoot = (): string => usersDir();
