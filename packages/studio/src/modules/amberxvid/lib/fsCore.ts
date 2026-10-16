/**
 * @file The module's ONE store core: cross-process locking, atomic writes, and
 * the edit journal. Originally a local port of the slice of GizmoX's
 * `src/lib/server/fsCore.ts` that the AmberX Vid lib layer used
 * (`appendJournal` plus its private helpers and the two journal types, inlined
 * from GizmoX's `src/lib/types.ts`).
 *
 * GizmoX's original docblock: "Server-side filesystem core shared by the
 * /api/fs/* routes: safe path resolution (jailed to the project, with denied
 * directories), the edit journal (.gizmox/journal.json), timestamped backups,
 * and soft-delete trash." None of the path-jail / backup / trash machinery is
 * needed here.
 *
 * ONE adaptation kept from that port: the journal lives inside the module's own
 * store (`<dataRoot>/journal.json`, i.e. `data/amberxvid/journal.json` by
 * default) instead of GizmoX's app-wide `.gizmox/journal.json` — this app has
 * no `.gizmox/` tree, and the module's audit trail belongs beside its data.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NO LONGER TRUE (P3, the shared room store)
 * ---------------------------------------------------------------------------
 * This file used to be a journal appender and nothing else, because every
 * OTHER piece of live state in this module lived in one process's `globalThis`
 * and therefore had no readers to race with. That is over: `roomStore.ts` and
 * `outbox.ts` are read-modify-written by SEVERAL app processes at once, so the
 * two primitives that make a shared file store safe belong here, once —
 * {@link withStoreLock} and {@link writeJsonAtomic}. "Do not invent a second
 * store" is the rule this file exists to satisfy.
 *
 * The lock is GizmoX's registry-lock discipline verbatim in shape (`wx` create,
 * spin, break a lock older than {@link LOCK_STALE_MS} because a process died
 * holding it, give up after {@link LOCK_TIMEOUT_MS}) — see
 * `.claude/rules/concurrent-builds.md`, which documents why exclusion must wrap
 * the WHOLE read-modify-write and never just the save.
 *
 * `appendJournal` now takes that lock too: the journal is a read-modify-write
 * of one shared file, and with more than one app process it was silently
 * losing entries to last-writer-wins.
 *
 * SYNC ON PURPOSE. The lock and the JSON helpers come in synchronous flavours
 * because the callers that need them — `calls.ts`, `streams.ts`, `presence.ts`
 * — export synchronous functions that routes and components already call, and
 * P3's contract is that not one of those signatures moves. A store operation
 * here is a few small files under a lock held for microseconds; the honest
 * trade is a blocking millisecond against a phase-wide API churn.
 *
 * Server-only (node imports) — imported by lib files and API routes only.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { dataRoot, locksDir } from "./paths";

/* ----------------------------------- lock ------------------------------------ */

/** A lock older than this was left by a process that died holding it. */
const LOCK_STALE_MS = 10_000;
/** Give up rather than wedge a request forever. */
const LOCK_TIMEOUT_MS = 5_000;

const lockPath = (name: string): string =>
  path.join(locksDir(), `${name.replace(/[^a-z0-9._-]+/gi, "_")}.lock`);

/** Busy-wait without a dependency — the lock is held for microseconds, and the
 *  callers are synchronous by contract (see the docblock). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` with the named store lock held, across processes. Wrap the WHOLE
 * read-modify-write — locking only the write still loses updates.
 */
export function withStoreLock<T>(name: string, fn: () => T): T {
  fs.mkdirSync(locksDir(), { recursive: true });
  const lock = lockPath(name);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      fs.writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: "wx" });
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // EPERM/EACCES: Windows reports access-denied rather than EEXIST while
      // the lock file is in a delete-pending state. Contention, so retry.
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw err;

      let heldMs = 0;
      try {
        heldMs = Date.now() - fs.statSync(lock).mtimeMs;
      } catch {
        heldMs = 0; // vanished underneath us — retry immediately
      }
      if (heldMs > LOCK_STALE_MS) {
        try {
          fs.unlinkSync(lock); // a process died holding it; do not wedge forever
        } catch {
          /* someone else broke it first */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `amberxvid store lock "${name}" is held by another process (${lock}, ` +
            `held ${(heldMs / 1000).toFixed(1)}s) — gave up after ${LOCK_TIMEOUT_MS / 1000}s`,
        );
      }
      sleepSync(15);
    }
  }

  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}

/* ------------------------------- json helpers -------------------------------- */

/** Read + parse, or the fallback — a store file is allowed to be absent or
 *  half-written (a reader can arrive between a crash and the next write). */
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Same-dir tmp + rename — the idiom `accounts.ts` and `messages.ts` already
 * use. A reader never sees a partial file, because rename is atomic within a
 * filesystem and the tmp name carries this process's pid.
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/** Binary sibling of {@link writeJsonAtomic} — stream poster frames. */
export function writeBytesAtomic(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
}

/** Best-effort unlink — "it is already gone" is the success case. */
export function unlinkQuiet(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}

/* -- journal types, verbatim from GizmoX src/lib/types.ts ------------------- */

export type FileOp = "create" | "edit" | "open" | "delete" | "restore";

export interface JournalEntry {
  id: string;
  ts: number;
  op: FileOp;
  path: string;
  summary: string;
  added: number;
  removed: number;
  /** Backup file name (GizmoX concept; unused here — no backup machinery). */
  backup?: string;
}

/* ---------------------------------- journal --------------------------------- */

const journalFile = (): string => path.join(dataRoot(), "journal.json");

interface JournalFile {
  entries: JournalEntry[];
}

/**
 * Append one entry. The read-modify-write runs under the store lock: with more
 * than one app process (P3) two concurrent appends used to race, and
 * last-writer-wins silently dropped the loser's entry.
 */
export async function appendJournal(
  op: FileOp,
  relPath: string,
  extra: Partial<JournalEntry> = {}
): Promise<JournalEntry> {
  await fsp.mkdir(dataRoot(), { recursive: true });
  const entry: JournalEntry = {
    id: `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    op,
    path: relPath,
    summary: extra.summary ?? op,
    added: extra.added ?? 0,
    removed: extra.removed ?? 0,
    backup: extra.backup
  };
  withStoreLock("journal", () => {
    const j = readJson<JournalFile>(journalFile(), { entries: [] });
    if (!Array.isArray(j.entries)) j.entries = [];
    j.entries.push(entry);
    if (j.entries.length > 2000) j.entries = j.entries.slice(-2000);
    writeJsonAtomic(journalFile(), j);
  });
  return entry;
}
