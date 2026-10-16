/**
 * @file project-state digest cache — one JSON file per session source at
 * `packages/studio/data/project-state/cache/<id>.json`, keyed by the source's
 * `{ mtimeMs, size }`. A re-run digests ONLY new or changed sessions; this
 * incremental property is half of "minimal tokens".
 *
 * Posture mirrors the house `fsCore.ts` shapes (mirrored, NOT imported —
 * that file belongs to the accounts module):
 * - read degrades never crashes: a missing, unreadable, corrupt, or
 *   key-mismatched entry reads as a MISS (null), and the caller re-digests;
 * - write is atomic: same-dir tmp + rename, so a crash mid-write leaves the
 *   previous entry intact — and a failed cache write never fails the
 *   generation it was caching for.
 *
 * Server-only. Absolute path — the builder's cwd is not this package.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { SessionDigest } from "./digest.server";
import type { SessionSource } from "./sources.server";

export const CACHE_DIR =
  "C:/Home/Projects/amberx-ai-studio/packages/studio/data/project-state/cache";

interface CacheEntry {
  key: { mtimeMs: number; size: number };
  digest: SessionDigest;
}

/** Cache filename for a source — its id, sanitised for the filesystem. */
export function cacheFileFor(source: Pick<SessionSource, "id">): string {
  const safe = source.id.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(CACHE_DIR, `${safe}.json`).replace(/\\/g, "/");
}

/**
 * The cached digest for `source`, or null on ANY miss: absent file, junk
 * bytes, malformed entry, or a `{ mtimeMs, size }` key that no longer matches
 * the source on disk.
 */
export function readCached(source: SessionSource): SessionDigest | null {
  let entry: CacheEntry;
  try {
    entry = JSON.parse(fs.readFileSync(cacheFileFor(source), "utf8")) as CacheEntry;
  } catch {
    return null;
  }
  if (
    entry === null ||
    typeof entry !== "object" ||
    entry.key === null ||
    typeof entry.key !== "object" ||
    entry.key.mtimeMs !== source.mtimeMs ||
    entry.key.size !== source.size ||
    entry.digest === null ||
    typeof entry.digest !== "object" ||
    typeof entry.digest.id !== "string"
  ) {
    return null;
  }
  return entry.digest;
}

/**
 * Persist a digest atomically (same-dir tmp + rename). Swallows every fault —
 * a generation whose cache write failed still generated; the only cost is a
 * re-digest next run.
 */
export async function writeCached(source: SessionSource, digest: SessionDigest): Promise<void> {
  try {
    const file = cacheFileFor(source);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const entry: CacheEntry = { key: { mtimeMs: source.mtimeMs, size: source.size }, digest };
    await fsp.writeFile(tmp, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    await fsp.rename(tmp, file);
  } catch {
    /* caching never fails a generation */
  }
}
