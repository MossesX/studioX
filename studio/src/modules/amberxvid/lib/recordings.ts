/**
 * @file AmberX Vid recording store — the library's persistence layer under the
 * env-driven root (`./paths`): one directory per recording with
 * the versioned edit-ready `manifest.json` (v1, `RecordingManifest`), the
 * media file the chunked upload appends into, and the server-generated
 * thumbnail.
 *
 * Upload lifecycle (the browser engine's contract, P3):
 *   begin → manifest written with `endedAt: null` + an `upload.json` sidecar
 *   append (seq-ordered chunks; duplicates of the last chunk are idempotent —
 *     a retry after a lost response must not double-append)
 *   finalize → size statted from disk, `endedAt` stamped, sidecar removed,
 *     thumbnail generated through the in-tree ffmpeg-static binary
 *   abort → the open recording's directory is removed (never a finished one —
 *     deleting finished recordings is the library's job, P5)
 *
 * Visibility (2026-08-03): the store lists by owner. A member sees only their
 * own captures; an administrator sees the whole store and may delete any of it
 * (`deleteRecording(…, { admin: true })`, `purgeRecordings`). The role itself
 * is never read here — the route verifies it and passes the flag.
 *
 * Limits are sized for internet uploads to the VPS: chunks are hard-capped per
 * request and the whole recording bounded by `AMBERXVID_MAX_RECORDING_MB`
 * (default 2048). House store posture: degrade never crash (a junk manifest is
 * skipped, a failed thumbnail leaves `thumbnail: null` — honest, not fatal),
 * atomic manifest writes, mutations in the activity ledger (which can never
 * fail a save). Server-only.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { appendJournal } from "./fsCore";
import {
  ensureVault,
  legacyRecordingsDir,
  listVaultKeys,
  resolveRecordingDir,
  usersDir,
  vaultRecordingDir,
  vaultRecordingsDir,
} from "./paths";
import { assertCanRecordServerSide } from "./policy";
import { assertVaultQuota, chargeVault, dirBytes } from "./vault";
import type { RecordingManifest, RecordingQuality } from "./types";

/* ---------------------------------- limits ----------------------------------- */

/** Hard per-request chunk cap — the client slices well under this. */
export const CHUNK_MAX_BYTES = 32 * 1024 * 1024;

/** Whole-recording cap, env-tunable for prod storage reality. */
export function maxRecordingBytes(): number {
  const mb = Number.parseInt(process.env.AMBERXVID_MAX_RECORDING_MB ?? "", 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 2048) * 1024 * 1024;
}

/* --------------------------------- results ------------------------------------ */

export type RecordingResult =
  | { ok: true; manifest: RecordingManifest }
  | { ok: false; error: string; status: number };

const fail = (status: number, error: string): RecordingResult => ({ ok: false, error, status });

/* --------------------------------- plumbing ----------------------------------- */

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

/** Journaling must never fail a save (same posture + mute switch as accounts). */
async function journal(op: "create" | "edit" | "delete", abs: string, summary: string): Promise<void> {
  if (process.env.AMBERXVID_SILENT_JOURNAL === "1") return;
  try {
    await appendJournal(op, ledgerPath(abs), { summary });
  } catch {
    /* ignore */
  }
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tmp, file);
}

/* ------------------------- where a recording lives (P2) -------------------------
 *
 * Recordings moved into the per-member vault in P2, and they are the awkward
 * one of the three stores that moved: they are addressed by CAPTURE id in URLs
 * while the owner is a field inside the manifest. So there are two resolvers,
 * and which one a call site may use is decided by what it knows:
 *
 * - `dirOf(owner, id)`     — the owner is known (every write path). Straight to
 *                            `users/<vaultKey>/recordings/<id>`, no lookup.
 * - `dirOfManifest(m)`     — a manifest in hand. Prefers whatever
 *                            `resolveRecordingDir` finds, so a capture the
 *                            vault migration skipped (unreadable owner) still
 *                            serves from the legacy directory instead of
 *                            resolving to a vault path that does not exist.
 *
 * Nothing here builds a per-user path itself; both bottom out in `./paths`.
 */

const dirOf = (owner: string, id: string): string => vaultRecordingDir(owner, id);

const dirOfManifest = (m: RecordingManifest): string =>
  resolveRecordingDir(m.id) ?? vaultRecordingDir(m.owner, m.id);

const manifestIn = (dir: string): string => path.join(dir, "manifest.json");
const uploadIn = (dir: string): string => path.join(dir, "upload.json");

const manifestFile = (owner: string, id: string): string => manifestIn(dirOf(owner, id));

export const mediaPathOf = (m: RecordingManifest): string => path.join(dirOfManifest(m), m.file);
export const thumbPathOf = (m: RecordingManifest): string | null =>
  m.thumbnail ? path.join(dirOfManifest(m), m.thumbnail) : null;

/** Recording ids are path segments — keep them strictly filesystem-safe. */
const ID_RE = /^rec-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;
export const isRecordingId = (id: string): boolean => ID_RE.test(id);

function newId(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Array.from({ length: 6 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  return `rec-${stamp}-${rand}`;
}

/** The chunked-upload sidecar — exists only while a recording is open. */
interface UploadState {
  version: 1;
  nextSeq: number;
  receivedBytes: number;
  lastChunkBytes: number;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * A recording by id alone — the media route has the id from the URL and nothing
 * else, so this is the one read that has to find the vault before it can read.
 */
export async function getRecording(id: string): Promise<RecordingManifest | null> {
  if (!isRecordingId(id)) return null;
  const dir = resolveRecordingDir(id);
  if (!dir) return null;
  const m = await readJson<RecordingManifest>(manifestIn(dir));
  return m && m.version === 1 && m.id === id ? m : null;
}

/**
 * Every readable manifest, newest first. Junk directories are skipped.
 *
 * `owner` narrows the listing to one account — the library's visibility rule
 * (2026-08-03): a member sees ONLY their own captures, an administrator sees
 * everyone's. Pass null/undefined for the unfiltered store.
 */
export async function listRecordings(owner?: string | null): Promise<RecordingManifest[]> {
  // P2: an owner-scoped listing now reads ONE directory instead of the whole
  // store — the vault turned the library's visibility rule into a path. The
  // unfiltered (administrator) listing walks every vault, plus the legacy
  // directory, so a capture the migration skipped is still visible to an admin.
  const dirs: string[] = owner
    ? [vaultRecordingsDir(owner)]
    : [...listVaultKeys().map((k) => vaultRecordingsDir(k)), legacyRecordingsDir()];

  const only = owner ? owner.toLowerCase() : null;
  const out: RecordingManifest[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const id of entries) {
      if (!isRecordingId(id) || seen.has(id)) continue;
      const m = await readJson<RecordingManifest>(manifestIn(path.join(dir, id)));
      if (!m || m.version !== 1 || m.id !== id) continue;
      if (only !== null && m.owner.toLowerCase() !== only) continue;
      seen.add(id);
      out.push(m);
    }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/* ----------------------------------- begin ------------------------------------ */

export interface RecordingBeginInput {
  title: string;
  mimeType: string;
  width: number;
  height: number;
  quality: RecordingQuality;
  micEnabled: boolean;
}

const QUALITIES: readonly RecordingQuality[] = ["low", "medium", "high", "max"];

function mediaExt(mimeType: string): string {
  if (/mp4/i.test(mimeType)) return "mp4";
  if (/matroska|mkv/i.test(mimeType)) return "mkv";
  return "webm";
}

export async function beginRecording(owner: string, input: RecordingBeginInput): Promise<RecordingResult> {
  if (!/^(video|audio)\//.test(input.mimeType)) return fail(400, "mimeType must be a media type");
  if (!QUALITIES.includes(input.quality)) return fail(400, "unknown quality preset");
  const width = Math.trunc(input.width);
  const height = Math.trunc(input.height);
  if (!(width > 0 && width <= 7680) || !(height > 0 && height <= 4320)) {
    return fail(400, "resolution out of range");
  }

  const id = newId();
  const now = new Date().toISOString();
  const manifest: RecordingManifest = {
    version: 1,
    id,
    owner,
    title: input.title.trim() || `Capture ${now.slice(0, 16).replace("T", " ")}`,
    engine: "browser",
    file: `media.${mediaExt(input.mimeType)}`,
    mimeType: input.mimeType,
    startedAt: now,
    endedAt: null,
    durationS: 0,
    sizeBytes: 0,
    width,
    height,
    micEnabled: input.micEnabled,
    quality: input.quality,
    thumbnail: null,
    notes: "",
    tags: [],
    edits: [],
  };

  ensureVault(owner);
  await fsp.mkdir(dirOf(owner, id), { recursive: true });
  await writeAtomic(manifestFile(owner, id), manifest);
  const upload: UploadState = { version: 1, nextSeq: 0, receivedBytes: 0, lastChunkBytes: 0 };
  await writeAtomic(uploadIn(dirOf(owner, id)), upload);
  await journal("create", manifestFile(owner, id), `AmberX Vid capture started by ${owner} (${width}×${height}, ${input.quality})`);
  return { ok: true, manifest };
}

/* ---------------------------------- append ------------------------------------ */

/**
 * Append one seq-ordered chunk. Chunks must arrive in order (the client
 * uploads sequentially); a duplicate of the LAST chunk is answered ok without
 * appending, so a retry after a lost response can't corrupt the media file.
 */
export async function appendChunk(owner: string, id: string, seq: number, chunk: Buffer): Promise<RecordingResult> {
  const manifest = await getRecording(id);
  if (!manifest) return fail(404, "no such recording");
  if (manifest.owner.toLowerCase() !== owner.toLowerCase()) return fail(403, "not your recording");
  if (manifest.endedAt !== null) return fail(409, "recording already finalized");
  if (chunk.length === 0) return fail(400, "empty chunk");
  if (chunk.length > CHUNK_MAX_BYTES) return fail(413, "chunk too large");

  const dir = dirOfManifest(manifest);
  const upload = await readJson<UploadState>(uploadIn(dir));
  if (!upload) return fail(409, "recording is not accepting chunks");

  if (seq === upload.nextSeq - 1 && chunk.length === upload.lastChunkBytes) {
    return { ok: true, manifest: { ...manifest, sizeBytes: upload.receivedBytes } }; // duplicate retry
  }
  if (seq !== upload.nextSeq) return fail(409, `expected chunk ${upload.nextSeq}, got ${seq}`);
  if (upload.receivedBytes + chunk.length > maxRecordingBytes()) {
    return fail(413, `recording exceeds the ${Math.round(maxRecordingBytes() / 1024 / 1024)} MB limit`);
  }

  // The vault quota, per chunk, BEFORE the append. Checking once at `begin`
  // would be checking a size nobody knows yet — a browser capture's length is
  // discovered as it arrives — so the cap has to bite mid-upload, and a refusal
  // here leaves the partial capture in place for the client to abort.
  const room = await assertVaultQuota(manifest.owner, chunk.length);
  if (!room.ok) return fail(room.status, room.error);

  await fsp.appendFile(mediaPathOf(manifest), chunk);
  const next: UploadState = {
    version: 1,
    nextSeq: seq + 1,
    receivedBytes: upload.receivedBytes + chunk.length,
    lastChunkBytes: chunk.length,
  };
  await writeAtomic(uploadIn(dir), next);
  await chargeVault(manifest.owner, "recordings", chunk.length, `capture chunk ${seq} of ${id}`);
  return { ok: true, manifest: { ...manifest, sizeBytes: next.receivedBytes } };
}

/* --------------------------------- finalize ----------------------------------- */

/** ffmpeg binary: `AMBERXVID_FFMPEG` env override (read per call — the
 *  turn.ts parity rule), else the ffmpeg-static download, else whatever is on
 *  PATH (the X-Wrecorder probe — never `require`d, so bundling can't break
 *  it). Exported since P10: the media server's recorder resolves ffmpeg
 *  through this ONE function, so "is ffmpeg present" has a single answer. */
export function ffmpegPath(): string {
  const env = process.env.AMBERXVID_FFMPEG?.trim();
  if (env) return env;
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const p = path.join(process.cwd(), "node_modules", "ffmpeg-static", exe);
  return fs.existsSync(p) ? p : "ffmpeg";
}

/**
 * Whether {@link ffmpegPath}'s answer actually runs — the P10 capability
 * check behind the room UI's record toggle. A bare `"ffmpeg"` fallback is only
 * a REAL answer if PATH resolves it, so this probes by spawning `-version`
 * rather than statting a file. Cheap (a few ms) and read per call, never
 * latched: dropping a binary into place mid-session takes effect on the next
 * toggle render.
 */
export function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ["-version"], { timeout: 5_000, windowsHide: true }, (err) => resolve(!err));
  });
}

function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), args, { timeout: 30_000, windowsHide: true }, (err) => resolve(!err));
  });
}

/**
 * Rewrite the captured file into something a `<video>` element can actually
 * play, stream-copying so nothing is re-encoded (fast, lossless).
 *
 * Two real defects this repairs, both found on 2026-08-03 when every finished
 * recording played back blank:
 *
 *   * **Matroska is not a browser container.** The tray captures h264+aac into
 *     `.mkv` on purpose — Matroska survives a killed process, which a
 *     background recorder needs — but Chrome/Edge refuse `video/x-matroska`
 *     outright. Same streams in mp4 (`+faststart`, so the moov atom leads)
 *     play everywhere.
 *   * **Live MediaRecorder webm has no duration or cues.** The browser writes
 *     an unseekable stream: `Duration: N/A`, so the player shows a dead
 *     timeline. A plain `-c copy` remux writes the Duration element and Cues
 *     index, and seeking works.
 *
 * Degrade, never crash: if ffmpeg is missing or fails, the original file stays
 * exactly as captured and the manifest is untouched — a worse player
 * experience beats a lost recording.
 */
async function remuxForPlayback(manifest: RecordingManifest): Promise<RecordingManifest> {
  const src = mediaPathOf(manifest);
  const matroska = /matroska|mkv/i.test(manifest.mimeType) || /\.mkv$/i.test(manifest.file);
  const webm = /webm/i.test(manifest.mimeType) || /\.webm$/i.test(manifest.file);
  if (!matroska && !webm) return manifest;

  const ext = matroska ? "mp4" : "webm";
  const out = path.join(dirOfManifest(manifest), `remux.${ext}`);
  const args = matroska
    ? ["-y", "-i", src, "-c", "copy", "-movflags", "+faststart", out]
    : ["-y", "-i", src, "-c", "copy", out];

  if (!(await runFfmpeg(args))) return manifest;
  let size = 0;
  try {
    size = (await fsp.stat(out)).size;
  } catch {
    size = 0;
  }
  if (size === 0) {
    await fsp.rm(out, { force: true });
    return manifest;
  }

  const file = `media.${ext}`;
  await fsp.rm(path.join(dirOfManifest(manifest), file), { force: true });
  await fsp.rename(out, path.join(dirOfManifest(manifest), file));
  if (manifest.file !== file) await fsp.rm(src, { force: true });
  return {
    ...manifest,
    file,
    mimeType: matroska ? "video/mp4" : "video/webm",
    sizeBytes: size,
  };
}

/**
 * One poster frame, 320 px wide. MediaRecorder webm carries no duration
 * metadata (the known Chrome quirk), so seeking uses output-side `-ss` — and a
 * sub-half-second capture falls back to the very first frame.
 */
async function generateThumbnail(manifest: RecordingManifest): Promise<string | null> {
  const media = mediaPathOf(manifest);
  const thumb = path.join(dirOfManifest(manifest), "thumb.jpg");
  const attempt = (ss: string) =>
    runFfmpeg(["-y", "-i", media, "-ss", ss, "-frames:v", "1", "-vf", "scale=320:-2", thumb]);
  if (!(await attempt("0.5")) || !fs.existsSync(thumb)) {
    await attempt("0");
  }
  return fs.existsSync(thumb) ? "thumb.jpg" : null;
}

export async function finalizeRecording(owner: string, id: string, durationS: number): Promise<RecordingResult> {
  const manifest = await getRecording(id);
  if (!manifest) return fail(404, "no such recording");
  if (manifest.owner.toLowerCase() !== owner.toLowerCase()) return fail(403, "not your recording");
  if (manifest.endedAt !== null) return fail(409, "recording already finalized");

  // What the chunk loop already charged — the sidecar's running total is the
  // exact figure, which is why it is read BEFORE the sidecar is removed below.
  const chargedChunkBytes =
    (await readJson<UploadState>(uploadIn(dirOfManifest(manifest))))?.receivedBytes ?? 0;

  let sizeBytes = 0;
  try {
    sizeBytes = (await fsp.stat(mediaPathOf(manifest))).size;
  } catch {
    sizeBytes = 0;
  }
  if (sizeBytes === 0) {
    await abortRecording(owner, id);
    return fail(400, "no media was uploaded — recording discarded");
  }

  let finished: RecordingManifest = {
    ...manifest,
    endedAt: new Date().toISOString(),
    durationS: Number.isFinite(durationS) && durationS > 0 ? Math.round(durationS * 10) / 10 : 0,
    sizeBytes,
  };
  finished = await remuxForPlayback(finished);
  finished.thumbnail = await generateThumbnail(finished);
  const dir = dirOfManifest(finished);
  await writeAtomic(manifestIn(dir), finished);
  await fsp.rm(uploadIn(dir), { force: true });
  // Finalize REMUXES and generates a thumbnail, so the directory is no longer
  // the sum of the chunks that were charged. Reconcile against the truth on
  // disk rather than guessing the delta — this is the one recording path where
  // a walk is cheaper than being wrong.
  await chargeVault(
    finished.owner,
    "recordings",
    (await dirBytes(dir)) - chargedChunkBytes,
    `capture ${id} finalized (remux + thumbnail reconciliation)`,
  );
  await journal(
    "edit",
    manifestIn(dir),
    `AmberX Vid capture finalized by ${owner} (${finished.durationS}s, ${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`
  );
  return { ok: true, manifest: finished };
}

/* ----------------------------------- abort ------------------------------------ */

/** Discard an OPEN recording. Finished recordings are the library's to delete (P5). */
export async function abortRecording(owner: string, id: string): Promise<RecordingResult> {
  const manifest = await getRecording(id);
  if (!manifest) return fail(404, "no such recording");
  if (manifest.owner.toLowerCase() !== owner.toLowerCase()) return fail(403, "not your recording");
  if (manifest.endedAt !== null) return fail(409, "recording already finalized");
  const dir = dirOfManifest(manifest);
  // An aborted capture's true size is whatever arrived, which the manifest does
  // not carry (it is still `sizeBytes: 0` until finalize stats the file). Weigh
  // the directory before removing it, so the credit matches what was charged.
  const freed = await dirBytes(dir);
  await fsp.rm(dir, { recursive: true, force: true });
  await chargeVault(manifest.owner, "recordings", -freed, `capture ${id} aborted`);
  await journal("delete", manifestIn(dir), `AmberX Vid capture aborted by ${owner}`);
  return { ok: true, manifest };
}

/* -------------------------------- library ops --------------------------------- */

/**
 * The library's mutations (P5) — rename, per-recording notes, delete. All
 * three touch FINISHED recordings only (an open capture belongs to its upload
 * lifecycle: abort is its only exit). Rename and notes stay owner-only; delete
 * additionally answers to an administrator (`admin: true`, which only the
 * role-verified route may pass) — admins own the whole store's housekeeping.
 * Every manifest write stays a full-shape v1 rewrite, so `edits`, provenance
 * and every future field ride through untouched — the edit-ready contract
 * honoured end-to-end.
 */
async function finishedOwn(
  owner: string,
  id: string,
  opts: { admin?: boolean } = {}
): Promise<RecordingResult> {
  const manifest = await getRecording(id);
  if (!manifest) return fail(404, "no such recording");
  if (opts.admin !== true && manifest.owner.toLowerCase() !== owner.toLowerCase()) {
    return fail(403, "not your recording");
  }
  if (manifest.endedAt === null) return fail(409, "recording is still capturing");
  return { ok: true, manifest };
}

export const TITLE_MAX = 120;
export const NOTES_MAX = 4000;

export async function renameRecording(owner: string, id: string, title: string): Promise<RecordingResult> {
  const cur = await finishedOwn(owner, id);
  if (!cur.ok) return cur;
  const next = title.trim();
  if (!next) return fail(400, "title cannot be empty");
  if (next.length > TITLE_MAX) return fail(400, `title is capped at ${TITLE_MAX} characters`);
  const manifest: RecordingManifest = { ...cur.manifest, title: next };
  const file = manifestIn(dirOfManifest(manifest));
  await writeAtomic(file, manifest);
  await journal("edit", file, `AmberX Vid recording renamed by ${owner}: "${cur.manifest.title}" → "${next}"`);
  return { ok: true, manifest };
}

export async function updateRecordingNotes(owner: string, id: string, notes: string): Promise<RecordingResult> {
  const cur = await finishedOwn(owner, id);
  if (!cur.ok) return cur;
  if (notes.length > NOTES_MAX) return fail(400, `notes are capped at ${NOTES_MAX} characters`);
  const manifest: RecordingManifest = { ...cur.manifest, notes };
  const file = manifestIn(dirOfManifest(manifest));
  await writeAtomic(file, manifest);
  await journal("edit", file, `AmberX Vid recording notes updated by ${owner} on "${manifest.title}"`);
  return { ok: true, manifest };
}

/**
 * Remove a finished recording — directory and all (media, thumbnail,
 * manifest). The owner deletes their own; `admin: true` (route-verified role)
 * deletes anyone's, and the ledger line names whose it was.
 */
export async function deleteRecording(
  actor: string,
  id: string,
  opts: { admin?: boolean } = {}
): Promise<RecordingResult> {
  const cur = await finishedOwn(actor, id, opts);
  if (!cur.ok) return cur;
  const dir = dirOfManifest(cur.manifest);
  const freed = await dirBytes(dir);
  await fsp.rm(dir, { recursive: true, force: true });
  await chargeVault(cur.manifest.owner, "recordings", -freed, `recording ${id} deleted`);
  const whose = cur.manifest.owner.toLowerCase() === actor.toLowerCase() ? "" : ` (owner ${cur.manifest.owner})`;
  await journal(
    "delete",
    manifestIn(dir),
    `AmberX Vid recording deleted by ${actor}${whose}: "${cur.manifest.title}" (${cur.manifest.durationS}s, ${(cur.manifest.sizeBytes / 1024 / 1024).toFixed(1)} MB)`
  );
  return { ok: true, manifest: cur.manifest };
}

/** What a bulk purge actually removed — the honest count, never a claim. */
export interface PurgeResult {
  deleted: number;
  bytes: number;
  /** Open captures are left alone: their engine still owns them. */
  skippedOpen: number;
}

/**
 * The administrator's bulk delete — every finished recording in the store, or
 * every one of a single member's when `owner` is given. Admin-only: the role
 * is verified by the route before this is ever called (the store has no view
 * of accounts). Open captures are skipped, never yanked out from under a
 * running engine; an unreadable directory is skipped rather than fatal.
 */
export async function purgeRecordings(actor: string, owner?: string | null): Promise<PurgeResult> {
  const targets = await listRecordings(owner ?? null);
  let deleted = 0;
  let bytes = 0;
  let skippedOpen = 0;
  for (const m of targets) {
    if (m.endedAt === null) {
      skippedOpen += 1;
      continue;
    }
    try {
      const dir = dirOfManifest(m);
      const freed = await dirBytes(dir);
      await fsp.rm(dir, { recursive: true, force: true });
      await chargeVault(m.owner, "recordings", -freed, `recording ${m.id} purged by ${actor}`);
      deleted += 1;
      bytes += m.sizeBytes;
    } catch {
      /* a stuck file must never abort the sweep — the rest still goes */
    }
  }
  if (deleted > 0) {
    await journal(
      "delete",
      owner ? vaultRecordingsDir(owner) : usersDir(),
      `AmberX Vid admin ${actor} deleted ${deleted} recording(s) (${(bytes / 1024 / 1024).toFixed(1)} MB)${owner ? ` owned by ${owner}` : " — the whole library"}`
    );
  }
  return { deleted, bytes, skippedOpen };
}

/* ---------------------------- server recordings (P10) --------------------------- */

/**
 * The media server's recording lifecycle — the same store, the same path
 * helpers, the same manifest shape as the browser and tray engines, so the
 * finished file is indistinguishable to the Library and everything downstream.
 * What differs is WHO writes the media bytes: the media server's ffmpeg child
 * appends straight into `mediaPathOf(manifest)` (no chunked upload, so no
 * `upload.json` sidecar), and the container is WebM/Matroska ON PURPOSE — it
 * is cluster-structured and crash-tolerant by design, so an abrupt end (host
 * crash, media-server kill) still leaves a playable file with no finalisation
 * step. (v0.1.0 demanded "moov atom in place", an MP4 concept; the requirement
 * is deleted, not solved.)
 *
 * Container per codec: VP8/VP9 + Opus → `.webm`; an H264 publisher → `.mkv`,
 * which `remuxForPlayback` already turns into browser-playable mp4 at
 * finalize — the exact machinery the tray engine has used since 2026-08-03.
 */

export interface ServerRecordingBegin {
  title: string;
  /** Decided by the recorder from the tapped video codec (webm unless H264). */
  container: "webm" | "mkv";
  hasAudio: boolean;
}

export interface ServerRecordingHandle {
  manifest: RecordingManifest;
  /** The recording's directory — where the recorder may park its own exhaust
   *  (the SDP the ffmpeg child reads). */
  dir: string;
  /** Absolute path the ffmpeg child writes. */
  mediaPath: string;
}

/**
 * Open a server recording in the HOST's vault: directory + v1 manifest with
 * `endedAt: null`, exactly the shape the other engines leave while capturing.
 * Width/height start 0×0 and are probed from the real file at finalize — the
 * Library lists finished recordings only, so the placeholder is never
 * rendered. No upload sidecar: the media server owns the bytes directly.
 */
export async function beginServerRecording(
  owner: string,
  input: ServerRecordingBegin,
): Promise<{ ok: true; handle: ServerRecordingHandle } | { ok: false; error: string }> {
  const id = newId();
  const now = new Date().toISOString();
  const manifest: RecordingManifest = {
    version: 1,
    id,
    owner: owner.trim().toLowerCase(),
    title: input.title.trim() || `Stream recording ${now.slice(0, 16).replace("T", " ")}`,
    engine: "server",
    file: `media.${input.container}`,
    mimeType: input.container === "webm" ? "video/webm" : "video/x-matroska",
    startedAt: now,
    endedAt: null,
    durationS: 0,
    sizeBytes: 0,
    width: 0,
    height: 0,
    micEnabled: input.hasAudio,
    quality: "high",
    thumbnail: null,
    notes: "",
    tags: [],
    edits: [],
  };
  // `canRecordServerSide` (P3), before the quota and before the directory:
  // this is the recording that spends the media server's CPU and writes bytes
  // the module never sees an upload for, which is why it is the one that needs
  // a grant. Browser-side recording is untouched by the row.
  const mayRecord = await assertCanRecordServerSide(manifest.owner);
  if (!mayRecord.ok) return { ok: false, error: mayRecord.error };

  // The one quota gate that has to bite at BEGIN rather than per chunk: the
  // media server writes the bytes itself, so there is no append this module
  // sees and nothing to refuse later. One byte is the honest question here —
  // "does this member have ANY room left" — because the size of a stream that
  // has not started is unknowable, and refusing at the door beats letting a
  // member who is already full record for an hour into a vault the ledger will
  // reject. A member with room is charged the real total at finalize.
  const room = await assertVaultQuota(manifest.owner, 1);
  if (!room.ok) return { ok: false, error: room.error };

  try {
    ensureVault(manifest.owner);
    await fsp.mkdir(dirOf(manifest.owner, id), { recursive: true });
    await writeAtomic(manifestFile(manifest.owner, id), manifest);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  await journal("create", manifestFile(manifest.owner, id), `AmberX Vid server recording started for ${manifest.owner}: "${manifest.title}"`);
  return {
    ok: true,
    handle: { manifest, dir: dirOf(manifest.owner, id), mediaPath: mediaPathOf(manifest) },
  };
}

/** The real dimensions, read from the file itself (`ffmpeg -i` prints them on
 *  stderr; there is no ffprobe in ffmpeg-static). Null when unparseable —
 *  honest zeros beat invented numbers. */
function probeDimensions(media: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ["-i", media], { timeout: 30_000, windowsHide: true }, (_err, _out, stderr) => {
      // `-i` with no output always "errs"; the stream info is still printed.
      const m = /Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(String(stderr));
      resolve(m ? { width: Number(m[1]), height: Number(m[2]) } : null);
    });
  });
}

/**
 * Close a server recording: stat the real bytes, stamp `endedAt`, probe the
 * true dimensions, remux for playback (webm gains its Duration element and
 * Cues; mkv becomes mp4 — `remuxForPlayback`'s two documented defects), and
 * generate the thumbnail. An empty file removes the directory — a recording
 * nothing reached is not a library entry. No owner parameter: this is the
 * server closing its OWN capture, not a member's request.
 */
export async function finalizeServerRecording(id: string, durationS: number): Promise<RecordingResult> {
  const manifest = await getRecording(id);
  if (!manifest) return fail(404, "no such recording");
  if (manifest.engine !== "server") return fail(409, "not a server recording");
  if (manifest.endedAt !== null) return fail(409, "recording already finalized");

  try {
    await fsp.rm(path.join(dirOfManifest(manifest), "input.sdp"), { force: true });
  } catch {
    // A dying ffmpeg can still hold the SDP for a beat (win32 EBUSY). It is
    // recorder exhaust the Library never sees — lingering beats failing.
  }

  let sizeBytes = 0;
  try {
    sizeBytes = (await fsp.stat(mediaPathOf(manifest))).size;
  } catch {
    sizeBytes = 0;
  }
  if (sizeBytes === 0) {
    await fsp.rm(dirOfManifest(manifest), { recursive: true, force: true });
    await journal(
      "delete",
      manifestFile(manifest.owner, id),
      `AmberX Vid server recording discarded — no media reached the file`,
    );
    return fail(400, "no media was recorded — recording discarded");
  }

  const dims = await probeDimensions(mediaPathOf(manifest));
  let finished: RecordingManifest = {
    ...manifest,
    endedAt: new Date().toISOString(),
    durationS: Number.isFinite(durationS) && durationS > 0 ? Math.round(durationS * 10) / 10 : 0,
    sizeBytes,
    width: dims?.width ?? 0,
    height: dims?.height ?? 0,
  };
  finished = await remuxForPlayback(finished);
  finished.thumbnail = await generateThumbnail(finished);
  const dir = dirOfManifest(finished);
  await writeAtomic(manifestIn(dir), finished);
  // The media server writes the bytes directly, so NOTHING was charged as they
  // arrived — the whole finished directory is the delta. This is the module's
  // clearest example of the ledger's stated split: a path that cannot know its
  // delta as it goes reconciles with a walk at the end.
  await chargeVault(finished.owner, "recordings", await dirBytes(dir), `server recording ${id} finalized`);
  await journal(
    "edit",
    manifestIn(dir),
    `AmberX Vid server recording finalized for ${finished.owner} (${finished.durationS}s, ${(finished.sizeBytes / 1024 / 1024).toFixed(1)} MB)`
  );
  return { ok: true, manifest: finished };
}

/**
 * Boot-time recovery (P10): a media server that died mid-recording leaves a
 * playable file (the container's whole point) under a manifest still saying
 * `endedAt: null` — which the Library treats as an open capture forever. The
 * next media-server boot closes each one honestly: duration derived from the
 * file's mtime (the last moment ffmpeg wrote), then the normal finalize.
 * Returns how many were recovered — a count the boot log states, never a
 * silent sweep.
 */
export async function recoverServerRecordings(): Promise<number> {
  let recovered = 0;
  for (const m of await listRecordings(null)) {
    if (m.engine !== "server" || m.endedAt !== null) continue;
    let durationS = 0;
    try {
      const stat = await fsp.stat(mediaPathOf(m));
      durationS = Math.max(0, (stat.mtimeMs - Date.parse(m.startedAt)) / 1000);
    } catch {
      durationS = 0;
    }
    const done = await finalizeServerRecording(m.id, durationS);
    if (done.ok || done.status === 400) recovered += 1; // discarded-empty is also a clean close
  }
  return recovered;
}

/** A filesystem-safe export filename: `<title>.<ext>`, never an empty stem. */
export function exportFilename(m: RecordingManifest): string {
  const ext = path.extname(m.file).replace(/^\./, "") || "webm";
  const stem = m.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim().slice(0, 80) || m.id;
  return `${stem}.${ext}`;
}
