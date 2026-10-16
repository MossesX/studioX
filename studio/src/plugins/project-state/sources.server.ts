/**
 * @file project-state sources — enumerate every session source the generator
 * digests, from the four source classes fixed in `axf-project-state.bmpx`'s
 * manifest notes:
 *
 *   1. AmberX-project Claude transcripts (`*.jsonl` in the AmberX transcript
 *      dir — the dir also holds per-session GUID SUBDIRECTORIES, so the
 *      enumeration filters to plain `.jsonl` files).
 *   2. GizmoX-project transcripts THAT TOUCHED AMBERX — included only when a
 *      STREAMED substring scan (64KB chunks, stop at first hit) finds
 *      `amberx-ai-studio` or `amberx_bound` in the file. Never read whole.
 *   3. Archived session bundles — the extracted `*_session-*` directories
 *      under both trees' `build/archive/`, deduped by basename (the AmberX
 *      copies are mirrors of the GizmoX originals, so AmberX wins).
 *   4. The state-file family (PLANNING-STATE.md, issues.md, inotes.md, the
 *      `.bmpx` manifests) — not sessions, so not `SessionSource`s; exposed as
 *      refs for the generator's snapshot + sources report. The session ZIPS
 *      in both trees are COUNTED for that report, never opened.
 *
 * Degrade never crash: every fs fault costs a note in `skipped`, never a
 * throw. Server-only (node imports); imported by the API route side alone.
 * Absolute paths throughout — the builder's cwd is GizmoX, the target tree is
 * AmberX, and relative resolution would silently pick the wrong repo.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/* --------------------------------- roots ------------------------------------- */

export const AMBERX_ROOT = "C:/Home/Projects/amberx-ai-studio";
export const GIZMOX_ROOT = "C:/Home/Projects/GizmoX";

export const AMBERX_TRANSCRIPTS_DIR =
  "C:/Users/GizmoX/.claude/projects/C--Home-Projects-amberx-ai-studio";
export const GIZMOX_TRANSCRIPTS_DIR =
  "C:/Users/GizmoX/.claude/projects/C--Home-Projects-GizmoX";

export const AMBERX_ARCHIVE_DIR = `${AMBERX_ROOT}/build/archive`;
export const GIZMOX_ARCHIVE_DIR = `${GIZMOX_ROOT}/build/archive`;

export const AMBERX_SESSION_ZIP_DIR = `${AMBERX_ROOT}/assets/archive/session`;
export const GIZMOX_SESSION_ZIP_DIR = `${GIZMOX_ROOT}/assets/archive/session`;

/** Markers whose presence makes a GizmoX transcript AmberX-relevant. */
export const GIZMOX_RELEVANCE_MARKERS = ["amberx-ai-studio", "amberx_bound"] as const;

/* --------------------------------- types ------------------------------------- */

export type SessionSourceKind = "transcript-amberx" | "transcript-gizmox" | "archive-dir";

export interface SessionSource {
  /** Stable id — transcript GUID or archive dir basename. Also the cache key filename stem. */
  id: string;
  kind: SessionSourceKind;
  /** Absolute path to the `.jsonl` file or the archive directory. */
  path: string;
  mtimeMs: number;
  size: number;
  /** Human handle — the archive dir slug (stamp stripped) or the transcript filename. */
  title: string;
}

export interface SourceEnumeration {
  sources: SessionSource[];
  /** One human-readable note per source or class that could not be read. */
  skipped: string[];
}

/** Class 4 — a state file the generator reads for the standing snapshot. */
export interface StateFileRef {
  id: string;
  path: string;
  exists: boolean;
  size: number;
  mtimeMs: number;
}

/* ---------------------------- class 2 relevance scan -------------------------- */

const SCAN_CHUNK = 64 * 1024;
const SCAN_TAIL = Math.max(...GIZMOX_RELEVANCE_MARKERS.map((m) => m.length)) - 1;

/**
 * Streamed substring scan: 64KB chunks, a carried tail so a marker straddling
 * a chunk boundary still hits, stop (destroy the stream) at the first hit.
 * The markers are ASCII, so latin1 decoding is boundary-safe and cheap.
 * Rejects on stream error — the caller degrades that to a skipped note.
 */
export function fileContainsMarker(
  file: string,
  markers: readonly string[] = GIZMOX_RELEVANCE_MARKERS
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file, { encoding: "latin1", highWaterMark: SCAN_CHUNK });
    let tail = "";
    stream.on("data", (chunk) => {
      const hay = tail + chunk;
      if (markers.some((m) => hay.includes(m))) {
        stream.destroy();
        resolve(true);
        return;
      }
      tail = hay.slice(-SCAN_TAIL);
    });
    stream.on("end", () => resolve(false));
    stream.on("error", (err) => reject(err));
  });
}

/* ------------------------------- enumeration ---------------------------------- */

async function statSafe(p: string): Promise<fs.Stats | null> {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

/** Strip the archiver's `YYYY-MM-DD_HH-MM_` stamp off a dir basename. */
function archiveTitle(basename: string): string {
  return basename.replace(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_/, "");
}

async function listTranscripts(
  dir: string,
  kind: SessionSourceKind,
  skipped: string[]
): Promise<SessionSource[]> {
  const out: SessionSource[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    skipped.push(`${kind}: cannot read ${dir}: ${(err as Error).message}`);
    return out;
  }
  for (const entry of entries) {
    // The transcript dirs also hold per-session GUID subdirectories.
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const file = path.join(dir, entry.name).replace(/\\/g, "/");
    const st = await statSafe(file);
    if (!st) {
      skipped.push(`${kind}: cannot stat ${file}`);
      continue;
    }
    const id = entry.name.slice(0, -".jsonl".length);
    out.push({ id, kind, path: file, mtimeMs: st.mtimeMs, size: st.size, title: id });
  }
  return out;
}

async function listArchiveDirs(
  dir: string,
  seen: Set<string>,
  skipped: string[]
): Promise<SessionSource[]> {
  const out: SessionSource[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    skipped.push(`archive-dir: cannot read ${dir}: ${(err as Error).message}`);
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.includes("_session-")) continue;
    if (seen.has(entry.name)) continue; // AmberX mirror already enumerated
    const full = path.join(dir, entry.name).replace(/\\/g, "/");
    const st = await statSafe(full);
    if (!st) {
      skipped.push(`archive-dir: cannot stat ${full}`);
      continue;
    }
    seen.add(entry.name);
    out.push({
      id: entry.name,
      kind: "archive-dir",
      path: full,
      mtimeMs: st.mtimeMs,
      size: st.size,
      title: archiveTitle(entry.name),
    });
  }
  return out;
}

/**
 * Enumerate every session source across classes 1–3. Never throws — an
 * unreadable dir or file degrades to a `skipped` note and the rest proceed.
 */
export async function enumerateSources(): Promise<SourceEnumeration> {
  const skipped: string[] = [];
  const sources: SessionSource[] = [];

  // Class 1 — AmberX transcripts, all of them.
  sources.push(...(await listTranscripts(AMBERX_TRANSCRIPTS_DIR, "transcript-amberx", skipped)));

  // Class 2 — GizmoX transcripts, only those the streamed scan marks relevant.
  const gizmoAll = await listTranscripts(GIZMOX_TRANSCRIPTS_DIR, "transcript-gizmox", skipped);
  for (const src of gizmoAll) {
    try {
      if (await fileContainsMarker(src.path)) sources.push(src);
    } catch (err) {
      skipped.push(`transcript-gizmox: scan failed for ${src.path}: ${(err as Error).message}`);
    }
  }

  // Class 3 — archived session bundles, AmberX first so its mirrors win the dedupe.
  const seen = new Set<string>();
  sources.push(...(await listArchiveDirs(AMBERX_ARCHIVE_DIR, seen, skipped)));
  sources.push(...(await listArchiveDirs(GIZMOX_ARCHIVE_DIR, seen, skipped)));

  sources.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return { sources, skipped };
}

/* ---------------------------- class 4 — state family --------------------------- */

/**
 * The state-file family at the AmberX root, plus every `.bmpx` manifest path.
 * Refs only — the generator reads the contents itself (and, per the notes,
 * reads a `.bmpx` for `manifest.status` ONLY, never a whole plan).
 */
export async function stateFamily(): Promise<{ files: StateFileRef[]; bmpx: string[] }> {
  const files: StateFileRef[] = [];
  for (const name of ["PLANNING-STATE.md", "issues.md", "inotes.md"]) {
    const p = `${AMBERX_ROOT}/${name}`;
    const st = await statSafe(p);
    files.push({
      id: name,
      path: p,
      exists: st !== null,
      size: st?.size ?? 0,
      mtimeMs: st?.mtimeMs ?? 0,
    });
  }
  let bmpx: string[] = [];
  try {
    const entries = await fsp.readdir(`${AMBERX_ROOT}/build/projects`, { withFileTypes: true });
    bmpx = entries
      .filter((e) => e.isFile() && e.name.endsWith(".bmpx"))
      .map((e) => `${AMBERX_ROOT}/build/projects/${e.name}`);
  } catch {
    /* an absent projects dir is an empty queue, not a fault */
  }
  return { files, bmpx };
}

/** Session zips in both trees — counted for the sources report, never opened. */
export async function countSessionZips(): Promise<{ amberx: number; gizmox: number }> {
  async function countIn(dir: string): Promise<number> {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isFile() && e.name.endsWith(".zip")).length;
    } catch {
      return 0;
    }
  }
  return {
    amberx: await countIn(AMBERX_SESSION_ZIP_DIR),
    gizmox: await countIn(GIZMOX_SESSION_ZIP_DIR),
  };
}
