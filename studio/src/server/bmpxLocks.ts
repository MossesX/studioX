/**
 * @file The `.bmpx` lock protocol, Node side — the mirror of the helpers in
 * GizmoX `build/tools/bmpx_builder.py` (owner directive, 2026-08-09). Same
 * lock files, same rules, so a Python build write and a studio route write
 * exclude each other — the registry-lock precedent, applied to project files:
 *
 *   RUN lock   `<file>.running`    held by the builder for a whole run;
 *                                  staleness by PID liveness, never age.
 *   WRITE lock `<file>.writelock`  per read-modify-write; stale >60s broken.
 *
 * Plus atomic writes (tmp + rename): no writer may leave half-written JSON.
 */
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

const WRITELOCK_STALE_MS = 60_000;
const ACQUIRE_TIMEOUT_MS = 10_000;

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface RunLockHolder {
  pid: number;
  mode?: string;
  started?: string;
}

/** The live holder of a project's RUN lock, or null. A lock naming a dead
 *  pid is a crash leftover: broken here, exactly as the builder breaks it. */
export function liveRunLock(projectFile: string): RunLockHolder | null {
  const lock = `${projectFile}.running`;
  if (!existsSync(lock)) return null;
  let holder: RunLockHolder;
  try {
    holder = JSON.parse(readFileSync(lock, "utf8")) as RunLockHolder;
  } catch {
    holder = { pid: 0 };
  }
  if (pidAlive(Number(holder.pid))) return holder;
  try {
    unlinkSync(lock);
  } catch { /* raced with the holder's own cleanup */ }
  return null;
}

/**
 * Today's date as `YYYY-MM-DD`, in LOCAL time — what every `.bmpx` write puts
 * in `manifest.revised`.
 *
 * All three write routes used `new Date().toISOString().slice(0, 10)`, which is
 * UTC. This machine is behind UTC, so from late afternoon onwards every write
 * stamped a build record with TOMORROW's date: a save made on 2026-08-11
 * recorded `"revised": "2026-08-12"`. Caught on 2026-08-11 by a round-trip
 * probe of `/api/bmpx/plan` that expected the file to come back unchanged and
 * found the date a day ahead.
 *
 * It matters more than a cosmetic slip: `revised` is the only date a `.bmpx`
 * carries about when its plan last changed, and these records are the material
 * AmberX's build requirements get settled from. A stamp that is sometimes right
 * and sometimes a day early cannot be used to order two edits.
 */
export function bmpxDateStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function atomicWrite(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, file);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` holding the file's WRITE lock — the WHOLE read-modify-write goes
 *  inside (locking only the save still loses updates; the registry taught
 *  this once already). Throws after 10s of contention. */
export async function withBmpxWriteLock<T>(file: string, fn: () => Promise<T> | T): Promise<T> {
  const lock = `${file}.writelock`;
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let age = 0;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue; // released between open and stat — take it next loop
      }
      if (age > WRITELOCK_STALE_MS) {
        try {
          unlinkSync(lock);
        } catch { /* raced */ }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`could not acquire ${path.basename(lock)} within 10s — another writer is holding it`);
      }
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lock);
    } catch { /* already gone */ }
  }
}
