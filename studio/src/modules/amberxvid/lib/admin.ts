/**
 * @file AmberX Vid admin composition — the store-side half of the P9 control
 * window: the overview snapshot `/api/amberxvid/admin` serves, and the
 * remove-user data cascade that follows a successful account removal.
 *
 * Composition only: account mutation lives in `./accounts`
 * (`updateUser`/`removeUser`, with the lock-out guards), album/profile
 * mutation behind `resolveActor`. The cascade here is deliberately NOT part of
 * `removeUser` itself — the accounts store cannot import the other stores
 * without a cycle, and a best-effort cleanup must never be able to fail the
 * account removal.
 *
 * **The thread stats come from the ACCOUNTS store (P6, 2026-08-15).** This
 * module's own message store retired that phase, so `adminListThreads` is
 * imported from `@axs/modules/accounts/lib/messages` — the same threads the
 * accounts admin suite summarises, which is the point: one store, one set of
 * numbers, and an administrator who prunes here and looks there sees the same
 * conversation. A group appears in the list as itself; the section that used
 * to say "the pair" now reads the participant list.
 *
 * Conversations survive a member's removal on purpose: a thread belongs to
 * BOTH participants, so the survivor keeps their history; the admin window's
 * Messages section can wipe them explicitly (`deleteUserThreads`).
 *
 * Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { appendJournal } from "./fsCore";
import { listAccounts } from "./accounts";
import { listAlbums } from "./albums";
import { adminListThreads } from "@axs/modules/accounts/lib/messages";
import { presenceSnapshot } from "./presence";
import { listRecordings, purgeRecordings } from "./recordings";
import { messengerSettingsDir, presenceDir, vaultDir } from "./paths";
import type {
  AdminAccountRow,
  AdminAlbumStats,
  AdminOverview,
  AdminRecordingStats,
  AmberXVidAccount,
} from "./types";

/* --------------------------------- overview ----------------------------------- */

function toAdminRow(a: AmberXVidAccount): AdminAccountRow {
  return {
    username: a.username,
    role: a.role,
    screenname: a.screenname,
    createdAt: a.createdAt,
    disabled: a.disabled === true,
    mustChangePassword: a.mustChangePassword,
    createdBy: a.createdBy,
    lastLoginAt: a.lastLoginAt ?? null,
    updatedAt: a.updatedAt,
  };
}

/**
 * Per-member capture totals over the WHOLE store — the admin window is the
 * only surface that sees past the per-owner visibility rule. A recording whose
 * owner no longer has an account still gets a row (orphans are the admin's to
 * clean up, so they must be visible).
 */
function recordingStats(all: Awaited<ReturnType<typeof listRecordings>>): AdminRecordingStats[] {
  const byOwner = new Map<string, AdminRecordingStats>();
  for (const r of all) {
    const key = r.owner.toLowerCase();
    const row =
      byOwner.get(key) ??
      { owner: r.owner, recordings: 0, bytes: 0, durationS: 0, open: 0, lastAt: null };
    row.recordings += 1;
    row.bytes += r.sizeBytes;
    row.durationS += r.durationS;
    if (r.endedAt === null) row.open += 1;
    if (row.lastAt === null || r.startedAt > row.lastAt) row.lastAt = r.startedAt;
    byOwner.set(key, row);
  }
  return [...byOwner.values()].sort((a, b) => b.bytes - a.bytes);
}

/** Everything the control window shows, in one snapshot. */
export async function adminOverview(): Promise<AdminOverview> {
  const accounts = await listAccounts();
  const [presence, threads, allRecordings] = await Promise.all([
    presenceSnapshot(),
    adminListThreads(),
    listRecordings(),
  ]);
  const albums: AdminAlbumStats[] = [];
  for (const a of accounts) {
    const list = await listAlbums(a.username);
    if (list.length === 0) continue;
    albums.push({
      owner: a.username,
      albums: list.length,
      photos: list.reduce((n, alb) => n + alb.photos.length, 0),
      bytes: list.reduce(
        (n, alb) => n + alb.photos.reduce((m, p) => m + (p.sizeBytes ?? 0), 0),
        0,
      ),
    });
  }
  return {
    accounts: accounts.map(toAdminRow),
    presence,
    threads,
    albums,
    recordings: recordingStats(allRecordings),
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------ remove-user cascade ---------------------------- */

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

/**
 * Best-effort cleanup of a removed member's stored data — profile, albums
 * (photos included), messenger settings, last-seen stamp and their recordings
 * (nobody but an admin could ever see an orphaned capture again, so leaving
 * them would be dead storage). Threads are NOT touched (see the file header).
 * Returns what was actually removed; failures skip silently — the account row
 * is already gone, and orphaned files can never resurrect it.
 */
export async function removeUserData(actor: string, username: string): Promise<string[]> {
  const u = username.trim().toLowerCase();
  const removed: string[] = [];
  try {
    const purged = await purgeRecordings(actor, u);
    if (purged.deleted > 0) removed.push(`${purged.deleted} recording(s)`);
  } catch {
    /* best-effort — a stuck capture never fails the removal */
  }
  // P2: profile, albums, recordings, wall and files are all inside ONE vault,
  // so the cascade removes the vault rather than four paths — a store added to
  // the layout later cannot be forgotten here. The two that stayed flat (see
  // `./paths`) are still named individually, because they are still flat.
  const targets: Array<[string, string]> = [
    [vaultDir(u), "vault (profile, albums, recordings, wall, files)"],
    [path.join(messengerSettingsDir(), `${u}.json`), "messenger settings"],
    [path.join(presenceDir(), `${u}.json`), "last-seen stamp"],
  ];
  for (const [abs, what] of targets) {
    try {
      if (!fs.existsSync(abs)) continue;
      await fsp.rm(abs, { recursive: true, force: true });
      removed.push(what);
    } catch {
      /* best-effort — never fail the removal over a stuck file */
    }
  }
  if (removed.length > 0 && process.env.AMBERXVID_SILENT_JOURNAL !== "1") {
    try {
      await appendJournal("delete", ledgerPath(vaultDir(u)), {
        summary: `AmberX Vid admin ${actor} removed "${username}" and their ${removed.join(", ")}`,
      });
    } catch {
      /* journaling never fails a cascade */
    }
  }
  return removed;
}
