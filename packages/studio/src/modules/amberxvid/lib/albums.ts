/**
 * @file **The platform's photo surface** — named albums in the member's vault
 * (`<root>/users/<vaultKey>/albums/<albumId>/`), an `album.json` manifest beside
 * the photo files themselves, and — since P10 — a visibility, an order, real
 * pixel dimensions and the wall's own reactions and comments on every item.
 *
 * ```
 * users/<vaultKey>/albums/<albumId>/album.json   the manifest (items included)
 * users/<vaultKey>/albums/<albumId>/<photoId>.jpg  the bytes
 * ```
 *
 * ## ONE COMMENT SYSTEM, TWO SUBJECTS
 *
 * An album item's reactions and comments are **not a photo feature**. They are
 * the wall's, pointed at a second subject: the viewer tiers, the
 * `public`/`buddies`/`private` filter, the toggling-and-exclusive reaction, the
 * one-level thread, the cap and — the part that matters most — the rule that a
 * refusal must be byte-identical to an absence all live in `./social.ts`, and
 * `./wall.ts` and this file both call them. There is no second implementation of
 * any of it, which is the whole reason the machinery moved: two copies of the
 * silence rule is one copy that eventually admits a block exists.
 *
 * ## What P10 added to the model, and why each is load-bearing
 *
 * **1. `visibility`, through the SAME `canInteract` filter as the wall.** An
 * album a viewer may not see is ABSENT from their list, and one of its items
 * refuses a reaction with the same "no such photo" a photo that never existed
 * gets. Before P10 albums were a shared surface — any member could read anybody's
 * — which was defensible for a private suite and is not for a platform.
 * {@link listAlbumsFor} and {@link readAlbumFor} are the viewer-aware doors, and
 * the photo-bytes route goes through {@link resolvePhoto} for the same reason
 * the wall's media route goes through `resolveWallMedia`: serving bytes for an
 * album a viewer cannot open would leak exactly what the filter withholds.
 *
 * **2. `width`/`height`, sniffed from the BYTES.** The justified-rows grid lays
 * out on true aspect ratios; a grid that square-crops is telling the member
 * their photo is a shape it is not. {@link imageSize} reads the dimensions out
 * of the JPEG/PNG/GIF/WebP header at upload — no dependency, no decode, and
 * nothing a client claimed. Items uploaded before P10 have none and the grid
 * measures them in the browser instead, so they land in the same true-aspect row
 * one beat later rather than being cropped.
 *
 * **3. The array IS the order.** {@link reorderPhotos} rewrites it and is
 * non-destructive by construction: ids it does not recognise are dropped and
 * items the caller did not name are kept, appended in their current order. A
 * stale client cannot delete a photo by omitting it from a reorder.
 *
 * ## Bytes, quota and refusals (unchanged in shape since P2/P3)
 *
 * Uploads are sniffed for a genuine image signature ({@link sniffImage}); the
 * stored extension comes from the bytes, never from a client filename, so
 * nothing executable can land in the store. Ids are strictly patterned path
 * segments, so a bad id simply does not resolve and no path escapes the albums
 * root. Every byte is weighed against the member's quota before it lands and
 * charged to the ledger after (`./vault`), and `maxAlbums` / `maxAlbumItemMB`
 * from the policy catalog (`./policy`) narrow the module's own caps with
 * refusals that name which limit bit.
 *
 * Mutation is the owner's — or an administrator's, per `resolveActor` (the
 * admin-manageable duty, one gate for all member data) — while reacting and
 * commenting are any permitted viewer's, exactly as on the wall.
 *
 * House posture: degrade never crash, one cross-process lock around each whole
 * read-modify-write (`withStoreLock`, per `.claude/rules/concurrent-builds.md`),
 * atomic manifest writes, every mutation journaled by a journal that can never
 * fail a save. Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { findAccount, isValidUsername } from "./accounts";
import { appendJournal, withStoreLock, writeJsonAtomic } from "./fsCore";
import { ensureVault, vaultAlbumDir, vaultAlbumsDir, vaultKey } from "./paths";
import {
  assertAlbumCount,
  assertAlbumItemBytes,
  assertCanComment,
  assertCanUploadAlbums,
} from "./policy";
import { resolveActor } from "./profiles";
import {
  appendComment,
  buddiesOf,
  checkCommentText,
  emptyReactions,
  interactionRefusal,
  isRefusal,
  mayDeleteComment,
  newCommentId,
  newSocialId,
  norm,
  normalizeComments,
  normalizeReactions,
  toggleReaction,
  viewerLevel,
  visibleTo,
  withoutComment,
  type ReactionKind,
  type SocialRefusal,
} from "./social";
import { assertVaultQuota, chargeVault } from "./vault";
import {
  ALBUM_CAPTION_MAX,
  ALBUM_TITLE_MAX,
  type Album,
  type Photo,
  type SocialComment,
  type SocialVisibility,
} from "./types";

export type AlbumResult =
  | { ok: true; album: Album }
  | { ok: false; error: string; status: number };

type AlbumFailure = Extract<AlbumResult, { ok: false }>;

const fail = (status: number, error: string): AlbumFailure => ({ ok: false, error, status });

/**
 * The refusal an item a viewer may not touch gets — the SAME one an item that
 * does not exist gets. `./social.ts`, rule 1: a probe that can tell "hidden from
 * you" from "never existed" has defeated the silence.
 */
const GONE = fail(404, "no such photo");

/* ----------------------------------- limits ------------------------------------ */

/** Re-exported so a client editor can hold the caps without this node file. */
export { ALBUM_TITLE_MAX };
/** The P6 name for the caption cap, kept where its callers learned it. */
export const CAPTION_MAX = ALBUM_CAPTION_MAX;
export const ALBUMS_PER_OWNER_MAX = 50;
export const PHOTOS_PER_ALBUM_MAX = 200;

/** Per-photo byte cap, env-tunable for prod storage reality. */
export function maxPhotoBytes(): number {
  const mb = Number.parseInt(process.env.AMBERXVID_MAX_PHOTO_MB ?? "", 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 25) * 1024 * 1024;
}

/* --------------------------------- plumbing ------------------------------------ */

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

async function journal(op: "create" | "edit" | "delete", abs: string, summary: string): Promise<void> {
  if (process.env.AMBERXVID_SILENT_JOURNAL === "1") return;
  try {
    await appendJournal(op, ledgerPath(abs), { summary });
  } catch {
    /* ignore — accounting must never fail a save */
  }
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tmp, file);
}

function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/* ----------------------------- ids + path safety ------------------------------- */

const ALBUM_ID_RE = /^alb-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;
const PHOTO_ID_RE = /^ph-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;

export const isAlbumId = (id: string): boolean => ALBUM_ID_RE.test(id);
export const isPhotoId = (id: string): boolean => PHOTO_ID_RE.test(id);

/** Ids are minted in the shared shape (`./social.ts`) — one id vocabulary for
 *  every document this module stores. */
const newId = newSocialId;

// Both resolve through `./paths` (P2): albums live in the owner's vault, and
// this store never builds a per-user path of its own.
const ownerDir = (owner: string): string => vaultAlbumsDir(owner);
const albumDir = (owner: string, albumId: string): string => vaultAlbumDir(owner, albumId);
const albumFile = (owner: string, albumId: string): string => path.join(albumDir(owner, albumId), "album.json");

/** One lock per member's album store — the whole read-modify-write, never the
 *  write alone (`.claude/rules/concurrent-builds.md`). */
const lockName = (owner: string): string => `albums-${vaultKey(owner)}`;

export const photoPathOf = (album: Album, photo: Photo): string =>
  path.join(albumDir(album.owner, album.id), photo.file);

/* -------------------------------- image sniffing -------------------------------- */

/** Genuine image signatures only — the stored ext/mime come from the BYTES. */
export function sniffImage(bytes: Buffer): { ext: string; mime: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", mime: "image/png" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("latin1"))) {
    return { ext: "gif", mime: "image/gif" };
  }
  return null;
}

export function photoMime(photo: Photo): string {
  const ext = path.extname(photo.file).toLowerCase();
  return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
}

export interface PixelSize {
  width: number;
  height: number;
}

/** JPEG: walk the segment chain to the first start-of-frame and read its two
 *  16-bit fields. Every other segment is skipped by its own declared length. */
function jpegSize(b: Buffer): PixelSize | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    // Padding, SOI, and the standalone markers carry no length field.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

/** WebP has three container shapes and each states its size differently. */
function webpSize(b: Buffer): PixelSize | null {
  const chunk = b.subarray(12, 16).toString("latin1");
  if (chunk === "VP8X" && b.length >= 30) {
    return {
      width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
    };
  }
  if (chunk === "VP8 " && b.length >= 30) {
    // 3-byte frame tag, then the sync code that proves this is a key frame.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && b.length >= 25) {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

/**
 * The pixel dimensions of an uploaded image, read from its header.
 *
 * No dependency and no decode — four small header parsers, one per format the
 * sniffer accepts. `null` when the header is truncated or a WebP variant this
 * does not read: the item is still stored, and the grid measures it in the
 * browser instead. An unknown size must never cost somebody their upload.
 */
export function imageSize(bytes: Buffer): PixelSize | null {
  try {
    const kind = sniffImage(bytes);
    if (!kind) return null;
    if (kind.ext === "png") {
      return bytes.length >= 24
        ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
        : null;
    }
    if (kind.ext === "gif") {
      return bytes.length >= 10
        ? { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
        : null;
    }
    if (kind.ext === "jpg") return jpegSize(bytes);
    return webpSize(bytes);
  } catch {
    // A malformed header must degrade to "unknown", never throw an upload away.
    return null;
  }
}

const sane = (size: PixelSize | null): PixelSize | null =>
  size && size.width > 0 && size.height > 0 && size.width < 100_000 && size.height < 100_000
    ? size
    : null;

/* ----------------------------------- reads ------------------------------------- */

const VISIBILITIES: readonly SocialVisibility[] = ["public", "buddies", "private"];

export const isVisibility = (v: unknown): v is SocialVisibility =>
  typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v);

/** Normalize one stored item, or drop it. Junk is repaired on read, never
 *  obeyed — an unreadable item is one missing item, not a 500. */
function normalizePhoto(raw: unknown): Photo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isPhotoId(r.id)) return null;
  if (typeof r.file !== "string" || !r.file || r.file.includes("/") || r.file.includes("\\")) return null;
  const dim = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
  const width = dim(r.width);
  const height = dim(r.height);
  return {
    id: r.id,
    file: r.file,
    caption: typeof r.caption === "string" ? r.caption : "",
    uploadedAt: typeof r.uploadedAt === "string" ? r.uploadedAt : new Date(0).toISOString(),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(typeof r.sizeBytes === "number" && r.sizeBytes >= 0 ? { sizeBytes: r.sizeBytes } : {}),
    reactions: normalizeReactions(r.reactions),
    comments: normalizeComments(r.comments),
  };
}

/**
 * One manifest off disk, normalized into today's shape.
 *
 * Everything P10 added is defaulted here rather than migrated on disk: an album
 * written before this phase has no `visibility` and its items have no
 * reactions, comments or dimensions. It reads as `public` (which is what it
 * WAS — albums were a shared surface until P10, so defaulting to `private`
 * would silently hide every existing album from everybody) with empty threads,
 * and the next write persists the filled-in shape.
 */
function normalizeAlbum(raw: unknown, owner: string, albumId: string): Album | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || r.id !== albumId || !Array.isArray(r.photos)) return null;
  const photos = r.photos.map(normalizePhoto).filter((p): p is Photo => p !== null);
  const coverPhotoId =
    typeof r.coverPhotoId === "string" && photos.some((p) => p.id === r.coverPhotoId)
      ? r.coverPhotoId
      : (photos[0]?.id ?? null);
  return {
    version: 1,
    id: albumId,
    owner: typeof r.owner === "string" && r.owner ? r.owner : owner,
    title: typeof r.title === "string" ? r.title : "Untitled",
    coverPhotoId,
    visibility: isVisibility(r.visibility) ? r.visibility : "public",
    photos,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString(),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date(0).toISOString(),
  };
}

/** One album as it is STORED — no viewer filter. The admin surfaces and the
 *  owner's own mutations read through here; a member-facing read must use
 *  {@link readAlbumFor}, which is the one that applies visibility. */
export async function getAlbum(owner: string, albumId: string): Promise<Album | null> {
  if (!isValidUsername(owner.trim()) || !isAlbumId(albumId)) return null;
  try {
    const raw = JSON.parse(await fsp.readFile(albumFile(owner, albumId), "utf8")) as unknown;
    return normalizeAlbum(raw, owner, albumId);
  } catch {
    return null;
  }
}

/** The synchronous twin, for the locked read-modify-write paths. */
function readAlbumSync(owner: string, albumId: string): Album | null {
  if (!isValidUsername(owner.trim()) || !isAlbumId(albumId)) return null;
  try {
    return normalizeAlbum(
      JSON.parse(fs.readFileSync(albumFile(owner, albumId), "utf8")) as unknown,
      owner,
      albumId,
    );
  } catch {
    return null;
  }
}

/** All of one owner's readable albums as STORED, newest first. Junk dirs are
 *  skipped. Viewer-blind — see {@link listAlbumsFor}. */
export async function listAlbums(owner: string): Promise<Album[]> {
  if (!isValidUsername(owner.trim())) return [];
  let entries: string[];
  try {
    entries = await fsp.readdir(ownerDir(owner));
  } catch {
    return [];
  }
  const out: Album[] = [];
  for (const id of entries) {
    const album = await getAlbum(owner, id);
    if (album) out.push(album);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* --------------------------------- who sees what -------------------------------- */

/** May this viewer see this album at all? The wall's filter, same guard. */
export const albumVisibleTo = (viewer: string, album: Album): boolean =>
  visibleTo(viewerLevel(viewer, album.owner), album.visibility);

/**
 * One album, if this viewer may see it. `null` covers "no such album" and "not
 * for you" identically, and every caller renders both the same way.
 */
export async function readAlbumFor(
  viewer: string,
  owner: string,
  albumId: string,
): Promise<Album | null> {
  const album = await getAlbum(owner, albumId);
  return album && albumVisibleTo(viewer, album) ? album : null;
}

/** One member's albums as `viewer` may see them, newest first. A viewer the
 *  guard refuses gets the stranger's view — the public albums, and a shelf that
 *  reads as sparse rather than as hostile. */
export async function listAlbumsFor(viewer: string, owner: string): Promise<Album[]> {
  const level = viewerLevel(viewer, owner);
  return (await listAlbums(owner)).filter((a) => visibleTo(level, a.visibility));
}

/**
 * Serve-time resolution for the photo-bytes route: the item `viewer` asked for,
 * if they may see the album holding it, plus the absolute path of its bytes.
 *
 * The bytes route needs this for the reason the wall's media route needs
 * `resolveWallMedia`: a visibility filter that stops at the JSON and not at the
 * image is a filter that leaks the image.
 */
export async function resolvePhoto(
  viewer: string,
  owner: string,
  albumId: string,
  photoId: string,
): Promise<{ album: Album; photo: Photo; abs: string } | null> {
  const album = await readAlbumFor(viewer, owner, albumId);
  const photo = album?.photos.find((p) => p.id === photoId);
  if (!album || !photo) return null;
  const abs = photoPathOf(album, photo);
  return fs.existsSync(abs) ? { album, photo, abs } : null;
}

/**
 * The album shelf a member's FEED-side surfaces want: their own albums plus
 * every buddy's, newest first, each already visibility-filtered.
 *
 * The same merge the wall's feed does, and deliberately the same shape — an
 * album strip beside a merged feed that showed only your own albums would be
 * the one shelf on the social face that is not social.
 */
export async function albumFeedFor(viewer: string, limit = 60): Promise<Album[]> {
  const me = norm(viewer);
  if (!me) return [];
  const out: Album[] = [];
  for (const owner of [me, ...buddiesOf(me)]) {
    out.push(...(await listAlbumsFor(me, owner)));
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.max(0, limit));
}

/* --------------------------------- album CRUD ----------------------------------- */

/** Owner-or-admin, plus the owner must be a live entered member. */
async function gate(actor: string, owner: string): Promise<AlbumFailure | null> {
  const access = await resolveActor(actor, owner);
  if (!access.ok) return fail(access.status, access.error);
  const account = await findAccount(owner);
  if (!account || account.disabled === true || !account.screenname) {
    return fail(404, "no such module member");
  }
  return null;
}

export async function createAlbum(
  actor: string,
  owner: string,
  title: string,
  visibility: SocialVisibility = "public",
): Promise<AlbumResult> {
  const denied = await gate(actor, owner);
  if (denied) return denied;
  const clean = title.trim();
  if (!clean) return fail(400, "album title cannot be empty");
  if (clean.length > ALBUM_TITLE_MAX) return fail(400, `album title is capped at ${ALBUM_TITLE_MAX} characters`);
  // Policy before the structural cap, and both against the OWNER (never the
  // actor): an administrator acting on somebody's behalf must not be able to
  // push that member past their own allowance. Policy narrows the module's cap
  // and never widens it, so the tighter of the two is what a member feels.
  const may = await assertCanUploadAlbums(owner);
  if (!may.ok) return fail(may.status, may.error);
  const held = (await listAlbums(owner)).length;
  const within = await assertAlbumCount(owner, held);
  if (!within.ok) return fail(within.status, within.error);
  if (held >= ALBUMS_PER_OWNER_MAX) {
    return fail(409, `a member is capped at ${ALBUMS_PER_OWNER_MAX} albums`);
  }
  const now = new Date().toISOString();
  const album: Album = {
    version: 1,
    id: newId("alb"),
    owner,
    title: clean,
    coverPhotoId: null,
    visibility: isVisibility(visibility) ? visibility : "public",
    photos: [],
    createdAt: now,
    updatedAt: now,
  };
  ensureVault(owner);
  await writeAtomic(albumFile(owner, album.id), album);
  await journal("create", albumFile(owner, album.id), `AmberX Vid: ${actor} created album "${clean}" for ${owner}`);
  return { ok: true, album };
}

export async function renameAlbum(actor: string, owner: string, albumId: string, title: string): Promise<AlbumResult> {
  const denied = await gate(actor, owner);
  if (denied) return denied;
  const album = await getAlbum(owner, albumId);
  if (!album) return fail(404, "no such album");
  const clean = title.trim();
  if (!clean) return fail(400, "album title cannot be empty");
  if (clean.length > ALBUM_TITLE_MAX) return fail(400, `album title is capped at ${ALBUM_TITLE_MAX} characters`);
  const next: Album = { ...album, title: clean, updatedAt: new Date().toISOString() };
  await writeAtomic(albumFile(owner, albumId), next);
  await journal("edit", albumFile(owner, albumId), `AmberX Vid: ${actor} renamed ${owner}'s album "${album.title}" → "${clean}"`);
  return { ok: true, album: next };
}

/**
 * Set who may see an album (P10).
 *
 * Narrowing is retroactive and total: the album, its items and every reaction
 * and comment on them go behind the same filter at once, because they are all
 * one document. Nothing is deleted — a member who narrows an album to `private`
 * has hidden it, not thrown their comments away, and widening it again brings
 * the thread back exactly as it was.
 */
export async function setAlbumVisibility(
  actor: string,
  owner: string,
  albumId: string,
  visibility: SocialVisibility,
): Promise<AlbumResult> {
  const denied = await gate(actor, owner);
  if (denied) return denied;
  if (!isVisibility(visibility)) return fail(400, "visibility is public, buddies or private");
  const album = await getAlbum(owner, albumId);
  if (!album) return fail(404, "no such album");
  const next: Album = { ...album, visibility, updatedAt: new Date().toISOString() };
  await writeAtomic(albumFile(owner, albumId), next);
  await journal(
    "edit",
    albumFile(owner, albumId),
    `AmberX Vid: ${actor} set ${owner}'s album "${album.title}" to ${visibility}`,
  );
  return { ok: true, album: next };
}

/** Remove an album — directory and all (photos included). */
export async function deleteAlbum(actor: string, owner: string, albumId: string): Promise<AlbumResult> {
  const denied = await gate(actor, owner);
  if (denied) return denied;
  const album = await getAlbum(owner, albumId);
  if (!album) return fail(404, "no such album");
  // The delta is known exactly — every photo carries its own `sizeBytes` — so
  // this is a charge path rather than a rescan path.
  const freed = album.photos.reduce((n, p) => n + (p.sizeBytes || 0), 0);
  await fsp.rm(albumDir(owner, albumId), { recursive: true, force: true });
  await chargeVault(owner, "albums", -freed, `deleted album "${album.title}" (${album.photos.length} photo(s))`);
  await journal(
    "delete",
    albumFile(owner, albumId),
    `AmberX Vid: ${actor} deleted ${owner}'s album "${album.title}" (${album.photos.length} photo(s))`,
  );
  return { ok: true, album };
}

/* ---------------------------------- photos -------------------------------------- */

export async function addPhoto(
  actor: string,
  owner: string,
  albumId: string,
  bytes: Buffer,
  caption = "",
): Promise<AlbumResult> {
  const denied = await gate(actor, owner);
  if (denied) return denied;
  const album = await getAlbum(owner, albumId);
  if (!album) return fail(404, "no such album");
  if (album.photos.length >= PHOTOS_PER_ALBUM_MAX) {
    return fail(409, `an album is capped at ${PHOTOS_PER_ALBUM_MAX} photos`);
  }
  if (bytes.length === 0) return fail(400, "empty upload");
  // `canUploadAlbums` + `maxAlbumItemMB` (P3). The size check subsumes the old
  // `maxPhotoBytes()` comparison rather than sitting beside it: policy and the
  // deployment cap are two answers to one question, so one function takes both
  // and the refusal names WHICH of them bit — an administrator who set 100 MB
  // on a 25 MB deployment needs to be told raising the row will not help.
  const may = await assertCanUploadAlbums(owner);
  if (!may.ok) return fail(may.status, may.error);
  const sized = await assertAlbumItemBytes(owner, bytes.length, maxPhotoBytes());
  if (!sized.ok) return fail(sized.status, sized.error);
  const kind = sniffImage(bytes);
  if (!kind) return fail(415, "not a recognized image (JPEG, PNG, WebP or GIF)");
  if (caption.length > CAPTION_MAX) return fail(400, `captions are capped at ${CAPTION_MAX} characters`);

  // The vault quota, BEFORE the bytes land. `maxPhotoBytes` above caps one
  // upload; this caps the member's whole vault, and the two are different
  // questions — a member at their limit is refused a photo that is individually
  // legal, and the refusal has to say so with numbers.
  const room = await assertVaultQuota(owner, bytes.length);
  if (!room.ok) return fail(room.status, room.error);

  const id = newId("ph");
  // The dimensions come out of the header the sniffer just validated (P10) —
  // never from a client, and never from a decode. `null` means the grid will
  // measure it in the browser instead.
  const size = sane(imageSize(bytes));
  const photo: Photo = {
    id,
    file: `${id}.${kind.ext}`,
    caption: caption.trim(),
    uploadedAt: new Date().toISOString(),
    ...(size ? { width: size.width, height: size.height } : {}),
    sizeBytes: bytes.length,
    reactions: emptyReactions(),
    comments: [],
  };
  await fsp.mkdir(albumDir(owner, albumId), { recursive: true });
  await fsp.writeFile(path.join(albumDir(owner, albumId), photo.file), bytes);

  // The manifest RMW under the lock: two uploads into one album at once used to
  // race, and last-writer-wins loses a photo whose bytes are already on disk.
  const next = withStoreLock(lockName(owner), (): Album | null => {
    const current = readAlbumSync(owner, albumId);
    if (!current) return null;
    const merged: Album = {
      ...current,
      photos: [...current.photos, photo],
      // The first photo becomes the cover automatically.
      coverPhotoId: current.coverPhotoId ?? id,
      updatedAt: photo.uploadedAt,
    };
    writeJsonAtomic(albumFile(owner, albumId), merged);
    return merged;
  });
  if (!next) {
    // The album vanished between the read and the write — do not leave the
    // bytes charged to somebody for a manifest that no longer names them.
    await fsp.rm(path.join(albumDir(owner, albumId), photo.file), { force: true });
    return fail(404, "no such album");
  }

  await chargeVault(owner, "albums", bytes.length, `photo uploaded to "${album.title}"`);
  await journal(
    "create",
    path.join(albumDir(owner, albumId), photo.file),
    `AmberX Vid: ${actor} uploaded a ${kind.ext.toUpperCase()} (${(bytes.length / 1024).toFixed(0)} KB) to ${owner}'s album "${album.title}"`,
  );
  return { ok: true, album: next };
}

export async function setCaption(
  actor: string,
  owner: string,
  albumId: string,
  photoId: string,
  caption: string,
): Promise<AlbumResult> {
  const denied = await gate(actor, owner);
  if (denied) return denied;
  if (caption.length > CAPTION_MAX) return fail(400, `captions are capped at ${CAPTION_MAX} characters`);
  const outcome = withStoreLock(lockName(owner), (): Album | "no-album" | "no-photo" => {
    const album = readAlbumSync(owner, albumId);
    if (!album) return "no-album";
    if (!album.photos.some((p) => p.id === photoId)) return "no-photo";
    const next: Album = {
      ...album,
      photos: album.photos.map((p) => (p.id === photoId ? { ...p, caption: caption.trim() } : p)),
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(albumFile(owner, albumId), next);
    return next;
  });
  if (outcome === "no-album") return fail(404, "no such album");
  if (outcome === "no-photo") return fail(404, "no such photo");
  await journal("edit", albumFile(owner, albumId), `AmberX Vid: ${actor} captioned a photo in ${owner}'s album "${outcome.title}"`);
  return { ok: true, album: outcome };
}

export async function setCover(
  actor: string,
  owner: string,
  albumId: string,
  photoId: string,
): Promise<AlbumResult> {
  const denied = await gate(actor, owner);
  if (denied) return denied;
  const album = await getAlbum(owner, albumId);
  if (!album) return fail(404, "no such album");
  if (!album.photos.some((p) => p.id === photoId)) return fail(404, "no such photo");
  const next: Album = { ...album, coverPhotoId: photoId, updatedAt: new Date().toISOString() };
  await writeAtomic(albumFile(owner, albumId), next);
  await journal("edit", albumFile(owner, albumId), `AmberX Vid: ${actor} picked a new cover for ${owner}'s album "${album.title}"`);
  return { ok: true, album: next };
}

/**
 * Rewrite the display order of an album's items (P10).
 *
 * Non-destructive by construction: ids this album does not hold are ignored,
 * duplicates collapse, and every item the caller did NOT name keeps its place
 * at the end in its current order. A stale client — one that reorders while
 * somebody else is uploading — therefore cannot delete a photo by omission,
 * which is the failure mode an "the order is exactly what you sent" contract
 * would have.
 */
export async function reorderPhotos(
  actor: string,
  owner: string,
  albumId: string,
  orderedIds: string[],
): Promise<AlbumResult> {
  const denied = await gate(actor, owner);
  if (denied) return denied;
  const outcome = withStoreLock(lockName(owner), (): Album | null => {
    const album = readAlbumSync(owner, albumId);
    if (!album) return null;
    const byId = new Map(album.photos.map((p) => [p.id, p]));
    const ordered: Photo[] = [];
    const taken = new Set<string>();
    for (const id of orderedIds) {
      const photo = byId.get(id);
      if (!photo || taken.has(id)) continue;
      taken.add(id);
      ordered.push(photo);
    }
    for (const photo of album.photos) if (!taken.has(photo.id)) ordered.push(photo);
    const next: Album = { ...album, photos: ordered, updatedAt: new Date().toISOString() };
    writeJsonAtomic(albumFile(owner, albumId), next);
    return next;
  });
  if (!outcome) return fail(404, "no such album");
  await journal("edit", albumFile(owner, albumId), `AmberX Vid: ${actor} reordered ${owner}'s album "${outcome.title}"`);
  return { ok: true, album: outcome };
}

export async function deletePhoto(
  actor: string,
  owner: string,
  albumId: string,
  photoId: string,
): Promise<AlbumResult> {
  const denied = await gate(actor, owner);
  if (denied) return denied;
  const album = await getAlbum(owner, albumId);
  if (!album) return fail(404, "no such album");
  const photo = album.photos.find((p) => p.id === photoId);
  if (!photo) return fail(404, "no such photo");
  await fsp.rm(path.join(albumDir(owner, albumId), photo.file), { force: true });
  await chargeVault(owner, "albums", -(photo.sizeBytes || 0), `photo deleted from "${album.title}"`);
  const outcome = withStoreLock(lockName(owner), (): Album | null => {
    const current = readAlbumSync(owner, albumId);
    if (!current) return null;
    const remaining = current.photos.filter((p) => p.id !== photoId);
    const next: Album = {
      ...current,
      photos: remaining,
      // A deleted cover falls back to the first remaining photo (or none).
      coverPhotoId: current.coverPhotoId === photoId ? (remaining[0]?.id ?? null) : current.coverPhotoId,
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(albumFile(owner, albumId), next);
    return next;
  });
  if (!outcome) return fail(404, "no such album");
  await journal(
    "delete",
    path.join(albumDir(owner, albumId), photo.file),
    `AmberX Vid: ${actor} deleted a photo from ${owner}'s album "${album.title}"`,
  );
  return { ok: true, album: outcome };
}

/* ------------------------- the social rail on an item ---------------------------- */

/**
 * Everything the item-level mutations share: may this actor touch this owner's
 * material at all, and does the item exist for THEM?
 *
 * Both questions answer with {@link GONE} when the answer is no, so an item in
 * an album the viewer cannot see is indistinguishable from an item that never
 * existed — the silence rule, applied to the second subject exactly as the wall
 * applies it to the first.
 */
async function itemGate(
  actor: string,
  owner: string,
  albumId: string,
  photoId: string,
): Promise<AlbumFailure | null> {
  const refused = interactionRefusal(actor, owner, { status: GONE.status, error: GONE.error });
  if (refused) return fail(refused.status, refused.error);
  const album = await readAlbumFor(actor, owner, albumId);
  if (!album || !album.photos.some((p) => p.id === photoId)) return GONE;
  return null;
}

/** Charge the manifest's own growth to the albums store, as the wall charges a
 *  post document's. A comment is bytes in somebody's vault wherever it lands. */
async function chargeManifest(owner: string, albumId: string, before: number, why: string): Promise<void> {
  const after = fileBytes(albumFile(owner, albumId));
  if (after !== before) await chargeVault(owner, "albums", after - before, why);
}

/**
 * Like or dislike an album item — {@link toggleReaction}'s rule, the same one
 * the wall's posts run on, applied to one photo inside its album's manifest.
 */
export async function reactToPhoto(
  actor: string,
  owner: string,
  albumId: string,
  photoId: string,
  kind: ReactionKind,
): Promise<AlbumResult> {
  if (kind !== "like" && kind !== "dislike") return fail(400, "react with a like or a dislike");
  const denied = await itemGate(actor, owner, albumId, photoId);
  if (denied) return denied;
  const me = norm(actor);

  const outcome = withStoreLock(lockName(owner), (): Album | null => {
    const album = readAlbumSync(owner, albumId);
    if (!album || !album.photos.some((p) => p.id === photoId)) return null;
    const next: Album = {
      ...album,
      photos: album.photos.map((p) =>
        p.id === photoId ? { ...p, reactions: toggleReaction(p.reactions, me, kind) } : p,
      ),
    };
    writeJsonAtomic(albumFile(owner, albumId), next);
    return next;
  });
  if (!outcome) return GONE;

  // Reactions move the manifest by a username's worth of bytes, which the
  // ledger does not need to hear about. Journaled, though — moderation reads it.
  await journal("edit", albumFile(owner, albumId), `AmberX Vid: ${actor} reacted (${kind}) on a photo in ${owner}'s album "${outcome.title}"`);
  return { ok: true, album: outcome };
}

/**
 * Comment on an album item, or reply to a comment — ONE level, the cap and the
 * parent rule both {@link appendComment}'s. The `canComment` policy row is the
 * same switch that governs the wall, because it is the same permission: its own
 * hint says "posts, albums or streams".
 */
export async function commentOnPhoto(
  actor: string,
  owner: string,
  albumId: string,
  photoId: string,
  text: string,
  replyTo: string | null = null,
): Promise<AlbumResult> {
  const denied = await itemGate(actor, owner, albumId, photoId);
  if (denied) return denied;

  const may = await assertCanComment(actor);
  if (!may.ok) return fail(may.status, may.error);

  const checked = checkCommentText(text);
  if (isRefusal(checked)) return fail(checked.status, checked.error);

  const entry: SocialComment = {
    id: newCommentId(),
    author: norm(actor),
    text: checked.clean,
    createdAt: new Date().toISOString(),
    replyTo: null,
  };

  const before = fileBytes(albumFile(owner, albumId));
  const outcome = withStoreLock(lockName(owner), (): Album | SocialRefusal | null => {
    const album = readAlbumSync(owner, albumId);
    const photo = album?.photos.find((p) => p.id === photoId);
    if (!album || !photo) return null;
    const folded = appendComment(photo.comments, entry, replyTo, "this photo");
    if (isRefusal(folded)) return folded;
    const next: Album = {
      ...album,
      photos: album.photos.map((p) => (p.id === photoId ? { ...p, comments: folded.comments } : p)),
    };
    writeJsonAtomic(albumFile(owner, albumId), next);
    return next;
  });
  if (!outcome) return GONE;
  if (isRefusal(outcome)) return fail(outcome.status, outcome.error);

  await chargeManifest(owner, albumId, before, "album comment added");
  await journal(
    "edit",
    albumFile(owner, albumId),
    `AmberX Vid: ${actor} ${replyTo ? "replied to a comment" : "commented"} on a photo in ${owner}'s album "${outcome.title}"`,
  );
  return { ok: true, album: outcome };
}

/** `commentOnPhoto(...)` with the parent named — the reply half, spelled out so
 *  a caller cannot forget which argument the parent is. */
export const replyOnPhoto = (
  actor: string,
  owner: string,
  albumId: string,
  photoId: string,
  parentId: string,
  text: string,
): Promise<AlbumResult> => commentOnPhoto(actor, owner, albumId, photoId, text, parentId);

/**
 * Remove a comment from an album item — its author, the album's owner, or a
 * moderator ({@link mayDeleteComment}, the wall's own three). A top-level
 * comment takes its replies with it.
 */
export async function deletePhotoComment(
  actor: string,
  owner: string,
  albumId: string,
  photoId: string,
  commentId: string,
): Promise<AlbumResult> {
  const denied = await itemGate(actor, owner, albumId, photoId);
  if (denied) return denied;

  const album = await readAlbumFor(actor, owner, albumId);
  const target = album?.photos.find((p) => p.id === photoId)?.comments.find((c) => c.id === commentId);
  if (!target) return fail(404, "no such comment");
  if (!(await mayDeleteComment(actor, owner, target))) {
    return fail(403, "only the commenter, the album's owner or a moderator may delete that");
  }

  const before = fileBytes(albumFile(owner, albumId));
  const outcome = withStoreLock(lockName(owner), (): Album | null => {
    const current = readAlbumSync(owner, albumId);
    if (!current || !current.photos.some((p) => p.id === photoId)) return null;
    const next: Album = {
      ...current,
      photos: current.photos.map((p) =>
        p.id === photoId ? { ...p, comments: withoutComment(p.comments, commentId) } : p,
      ),
    };
    writeJsonAtomic(albumFile(owner, albumId), next);
    return next;
  });
  if (!outcome) return GONE;

  await chargeManifest(owner, albumId, before, "album comment deleted");
  await journal("edit", albumFile(owner, albumId), `AmberX Vid: ${actor} deleted a comment on a photo in ${owner}'s album "${outcome.title}"`);
  return { ok: true, album: outcome };
}
