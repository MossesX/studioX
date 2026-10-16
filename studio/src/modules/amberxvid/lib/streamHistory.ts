/**
 * @file STREAM HISTORY (P12) — what a member broadcast, and what they watched.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE STORE FROM THE ROOM RECORD
 * ---------------------------------------------------------------------------
 * A room record (`./roomStore`) is a LIVE object with a sweeper attached: it is
 * deleted a few minutes after the room ends, on purpose, because a store of
 * every room that ever existed is a store nothing sweeps. History is the
 * opposite — it is the small, permanent residue a room leaves behind, and it
 * has to outlive both the record and the process that ended it.
 *
 * So the room record stays ephemeral and this file writes the residue at the
 * moment the room ends, from the record itself. Nothing reconstructs history
 * later from a roster nobody kept: `peakViewers` and the distinct-watcher set
 * are counted WHILE the room is live (`./streams`) precisely because they are
 * unrecoverable afterwards.
 *
 * ---------------------------------------------------------------------------
 * THE RECORDING LINK, AND WHY IT IS A SEARCH RATHER THAN A FIELD
 * ---------------------------------------------------------------------------
 * "Recording link if kept" would be one field if the app server knew the id of
 * the server-side recording. It does not: `beginServerRecording` runs inside
 * the MEDIA server (`media-server/recording.ts`), and the media plane's
 * snapshot carries `recording: boolean` and nothing else — deliberately, since
 * the snapshot is a consent fact every seat renders, not a library index.
 *
 * Rather than grow the media protocol a field for the sake of one link,
 * {@link findStreamRecording} matches the host's own `server`-engine recordings
 * against the room's window. Two properties make that sound rather than
 * approximate: a member has at most one server recording running at a time
 * (one live room per host, and the media server records the room), and the
 * match is against the recording's `startedAt` falling inside the stream, which
 * a second stream cannot also contain.
 *
 * It also answers "if kept" for free: a recording the member has since deleted
 * is not found, and the entry keeps `null` — which is the honest value for a
 * link that would 404.
 *
 * House store posture: one JSON per member, atomic writes under the member's
 * own lock, junk on disk is treated as empty rather than obeyed. Server-only.
 */

import crypto from "node:crypto";

import { readJson, withStoreLock, writeJsonAtomic } from "./fsCore";
import { streamHistoryFile } from "./paths";
import { listRecordings } from "./recordings";
import {
  STREAM_HISTORY_KEEP,
  type StreamHistoryEntry,
  type WatchHistoryEntry,
} from "./types";

const norm = (u: string): string => u.trim().toLowerCase();

interface HistoryDoc {
  version: 1;
  user: string;
  hosted: StreamHistoryEntry[];
  watched: WatchHistoryEntry[];
}

const lockName = (user: string): string => `stream-history-${norm(user)}`;

const secondsBetween = (fromIso: string, toIso: string): number => {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
};

function readDoc(user: string): HistoryDoc {
  const key = norm(user);
  const raw = readJson<Partial<HistoryDoc> | null>(streamHistoryFile(key), null);
  return {
    version: 1,
    user: key,
    hosted: Array.isArray(raw?.hosted) ? (raw.hosted as StreamHistoryEntry[]) : [],
    watched: Array.isArray(raw?.watched) ? (raw.watched as WatchHistoryEntry[]) : [],
  };
}

/** Newest first, capped. The cap is applied on WRITE so a document cannot grow
 *  past it even if something appends in a loop. */
function trim<T>(rows: T[]): T[] {
  return rows.slice(0, STREAM_HISTORY_KEEP);
}

function mutateDoc(user: string, fn: (doc: HistoryDoc) => void): void {
  withStoreLock(lockName(user), () => {
    const doc = readDoc(user);
    fn(doc);
    doc.hosted = trim(doc.hosted);
    doc.watched = trim(doc.watched);
    writeJsonAtomic(streamHistoryFile(doc.user), doc);
  });
}

/* ----------------------------------- reading ------------------------------------ */

/** The streams this member hosted, newest first. */
export function streamHistoryFor(user: string): StreamHistoryEntry[] {
  return readDoc(user).hosted;
}

/** The streams this member watched, newest first. */
export function watchHistoryFor(user: string): WatchHistoryEntry[] {
  return readDoc(user).watched;
}

/* -------------------------------- the recording --------------------------------- */

/**
 * The server-side recording this stream left behind, or null. See the header
 * for why this is a search. A recording is claimed only when it is the HOST's,
 * was made by the `server` engine, is FINISHED, and started inside the room's
 * own window (with a small grace at the front, because the media server opens
 * the manifest a beat after the room does).
 */
export async function findStreamRecording(
  host: string,
  startedAt: string,
  endedAt: string,
): Promise<string | null> {
  const from = Date.parse(startedAt) - 5_000;
  const to = Date.parse(endedAt) + 5_000;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  try {
    const mine = await listRecordings(norm(host));
    const hit = mine.find((m) => {
      if (m.engine !== "server" || m.endedAt === null) return false;
      const at = Date.parse(m.startedAt);
      return Number.isFinite(at) && at >= from && at <= to;
    });
    return hit?.id ?? null;
  } catch {
    // A library that cannot be read is a missing link, never a failed close.
    return null;
  }
}

/* ----------------------------------- writing ------------------------------------ */

/** Everything a finished room knows about itself — assembled by the caller
 *  from the record BEFORE the sweeper can take it. */
export interface StreamSummary {
  streamId: string;
  /** Normalized host. */
  host: string;
  title: string;
  description: string;
  startedAt: string;
  endedAt: string;
  peakViewers: number;
  /** Distinct members who watched at any point, normalized. */
  watchers: string[];
}

/**
 * Write the host's history row for a finished stream, recording link included.
 *
 * Idempotent per stream id: ending a room twice (the host's `close` racing the
 * sweeper's `endStreamsHostedBy`) must not leave two rows for one broadcast.
 */
export async function recordStreamEnded(summary: StreamSummary): Promise<StreamHistoryEntry> {
  const recordingId = await findStreamRecording(summary.host, summary.startedAt, summary.endedAt);
  const entry: StreamHistoryEntry = {
    id: crypto.randomUUID(),
    streamId: summary.streamId,
    title: summary.title,
    description: summary.description,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    durationS: secondsBetween(summary.startedAt, summary.endedAt),
    peakViewers: summary.peakViewers,
    uniqueViewers: summary.watchers.length,
    recordingId,
  };
  mutateDoc(summary.host, (doc) => {
    doc.hosted = [entry, ...doc.hosted.filter((h) => h.streamId !== entry.streamId)];
  });
  return entry;
}

/** One watcher's visit to a stream. */
export interface WatchSummary {
  streamId: string;
  title: string;
  /** Normalized host. */
  host: string;
  hostDisplay: string;
  joinedAt: string;
  leftAt: string;
}

/**
 * Write a watcher's history row.
 *
 * Idempotent per stream id for the same reason the host's is, and with a
 * sharper case behind it: a watcher who leaves is written here, and then the
 * room ends and writes everybody still attached — a client that had already
 * left but whose seat had not swept yet would otherwise get two rows for one
 * visit. The LATER row wins, since it has the truer `leftAt`.
 */
export function recordWatch(user: string, summary: WatchSummary): WatchHistoryEntry {
  const entry: WatchHistoryEntry = {
    id: crypto.randomUUID(),
    streamId: summary.streamId,
    title: summary.title,
    host: summary.host,
    hostDisplay: summary.hostDisplay,
    joinedAt: summary.joinedAt,
    leftAt: summary.leftAt,
    durationS: secondsBetween(summary.joinedAt, summary.leftAt),
  };
  mutateDoc(user, (doc) => {
    doc.watched = [entry, ...doc.watched.filter((w) => w.streamId !== entry.streamId)];
  });
  return entry;
}
