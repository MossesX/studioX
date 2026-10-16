/**
 * @file Where the browser's history comes from. **Server-only** (`node:fs`,
 * `node:path`); the panel and the browser reach it through `/api/history`.
 *
 * The pre-strip version of this file was `paths.ts`, and it owned `AXF_ROOT`.
 * That constant is no longer the plugin's: v0.3.0 P0 rehomed it to
 * `src/server/paths.ts` when it deleted the browser, on the correct reasoning
 * that "where is the project root" is the PACKAGE's question and leaving it
 * inside a plugin was the accident. So this file imports it and owns only what
 * is genuinely a viewer-over-`.history`'s business.
 *
 * ── one change from the original, and it removes a hardcoded map ────────────
 *
 * `TRACKED_FILES` used to be a literal with one entry, `PLANNING-STATE`. There
 * are FOUR history folders on disk (`PLANNING-STATE`, `inotes`, `archive
 * state`, `archive-state`), so the literal was already wrong the day the merge
 * system was retired — three sets of snapshots were unreachable through a
 * viewer that existed to read them. {@link trackedFiles} discovers the folders
 * instead, and resolves each one's LIVE file by trying `<name>.md` at the root.
 * A folder with no live file is still browsable; it just has no "current"
 * column, which is the honest rendering of "snapshots of something that is
 * gone" rather than a folder the viewer pretends does not exist.
 */
import fs from "node:fs";
import path from "node:path";

import { AXF_ROOT } from "../../server/paths";

/**
 * Where `.merge.` wrote its pre-merge snapshots, and where they still sit.
 *
 * At the AmberX ROOT, not under any package — a history folder sits beside the
 * thing it is a history of, and the tracked files are root files
 * (`.claude/rules/amberx-bound-builds.md` §1 names this as the one directory
 * that never moved during the pre-build era).
 */
export const HISTORY_ROOT: string = path.join(AXF_ROOT, ".history");

export interface TrackedFile {
  /** The history folder's name — also the `?file=` parameter. */
  readonly name: string;
  /** Absolute path of the live document, or null when there is none. */
  readonly live: string | null;
  /** How many snapshots the folder holds. */
  readonly snapshots: number;
}

/**
 * The tracked files, discovered. Sorted by snapshot count, richest first: a
 * folder with thirteen revisions is what someone opening this came for, and a
 * folder with one is not.
 *
 * Silent on a missing history root — that is the state of a fresh clone, not an
 * error, and the surfaces above render "no history" from an empty list.
 */
export function trackedFiles(): TrackedFile[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(HISTORY_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: TrackedFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let snapshots = 0;
    try {
      snapshots = fs.readdirSync(path.join(HISTORY_ROOT, entry.name)).filter(isSnapshot).length;
    } catch {
      continue;
    }
    const live = path.join(AXF_ROOT, `${entry.name}.md`);
    out.push({
      name: entry.name,
      live: fs.existsSync(live) ? live : null,
      snapshots
    });
  }
  return out.sort((a, b) => b.snapshots - a.snapshots || a.name.localeCompare(b.name));
}

/** A snapshot is a `.md` inside a history folder. Kept as a predicate so the
 *  route and the discovery above cannot disagree about what counts. */
export const isSnapshot = (name: string): boolean => name.endsWith(".md");

/**
 * Guard: refuse anything that escapes the history root.
 *
 * Kept even though the route takes a folder NAME and runs `path.basename` on it
 * first. Two layers, because the day someone adds a second caller that forgets
 * the basename is the day the first layer is all there was.
 */
export function withinHistory(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  const root = path.resolve(HISTORY_ROOT);
  return resolved === root || resolved.startsWith(root + path.sep);
}
