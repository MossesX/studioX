/**
 * @file **The photo surface's client half** — every call `Albums.tsx`, the
 * profile's album strip and the module shell make to `/api/amberxvid/albums`,
 * in one file (P10 of `axf-amberxvid-social`, 2026-08-15).
 *
 * It is a separate module for the reason `./wallClient.ts` is: albums are drawn
 * by THREE surfaces (the photo surface, the profile shelf, the Profiles stage)
 * and a fetch written three times is three places for the payload shape to
 * drift. The store's own contract stays in `./albums.ts`, which is server-only
 * and must never reach a client bundle — so this file re-derives nothing from
 * it beyond the TYPES, which erase.
 *
 * ## Three things worth knowing before calling anything here
 *
 * **1. A 404 is not an error, it is an answer.** The store answers identically
 * for an album that never existed and one this viewer may not see; that silence
 * is load-bearing (`./social.ts`, rule 1) and this file must not undo it by
 * inventing a friendlier sentence. Callers get the route's own line.
 *
 * **2. Every mutation answers with the whole ALBUM**, not with the thing that
 * changed — a caption, a reaction and a comment all come back as the manifest
 * the store rewrote. That is what lets a surface replace one object and be
 * exactly in step with disk, instead of patching a local copy and hoping.
 *
 * **3. The deep link is built and parsed HERE, by one pair of functions**
 * ({@link albumItemUrl} / {@link parseAlbumLink}). A link that is minted in one
 * file and read in another is a link that breaks the day one of them changes
 * separators.
 */

import type { Album, SocialVisibility } from "./types";

export type AlbumLoad = { ok: true; albums: Album[] } | { ok: false; error: string };
export type AlbumOne = { ok: true; album: Album } | { ok: false; error: string };

/** An upload's verdict. `album` is the manifest after the batch; `rejected`
 *  names each file the sniffer, the policy or the quota refused — a mixed batch
 *  is a success with losses, and a member is owed the list. */
export type PhotoUpload =
  | { ok: true; album: Album; added: number; rejected: { name: string; error: string }[] }
  | { ok: false; error: string };

interface AlbumPayload {
  ok?: boolean;
  error?: string;
  album?: Album;
  albums?: Album[];
  added?: number;
  results?: { name: string; ok: boolean; error?: string }[];
}

/**
 * The body's own error line, or an honest statement of the status when there is
 * none. A 413 comes from the transport and carries no JSON the store wrote, so
 * it gets the one sentence that is true of it.
 */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  if (res.status === 413) return "that was too large to send — pick smaller photos";
  try {
    const body = (await res.json()) as AlbumPayload;
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* a body that will not parse tells us nothing — fall through */
  }
  return `${fallback} (HTTP ${res.status})`;
}

async function getAlbums(url: string, fallback: string): Promise<AlbumLoad> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: await errorFrom(res, fallback) };
    const body = (await res.json()) as AlbumPayload;
    return { ok: true, albums: Array.isArray(body.albums) ? body.albums : [] };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** One member's albums as the caller may see them, newest first. */
export const loadAlbums = (owner: string): Promise<AlbumLoad> =>
  getAlbums(`/api/amberxvid/albums?owner=${encodeURIComponent(owner)}`, "could not read those albums");

/** The caller's own albums merged with their buddies', most recent first. */
export const loadAlbumFeed = (): Promise<AlbumLoad> =>
  getAlbums("/api/amberxvid/albums?feed=1", "could not read your album feed");

/** One album by id. A 404 covers "gone" and "not for you" alike. */
export async function loadAlbum(owner: string, albumId: string): Promise<AlbumOne> {
  try {
    const res = await fetch(
      `/api/amberxvid/albums?owner=${encodeURIComponent(owner)}&id=${encodeURIComponent(albumId)}`,
    );
    if (!res.ok) return { ok: false, error: await errorFrom(res, "could not open that album") };
    const body = (await res.json()) as AlbumPayload;
    if (!body.album) return { ok: false, error: "the album route answered with no album" };
    return { ok: true, album: body.album };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Every mutation the album route takes; the caller passes the action's own
 *  fields and gets the album back as the store rewrote it. */
async function albumAction(body: Record<string, unknown>): Promise<AlbumOne> {
  try {
    const res = await fetch("/api/amberxvid/albums", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: await errorFrom(res, "that did not go through") };
    const payload = (await res.json()) as AlbumPayload;
    if (!payload.album) return { ok: false, error: "the album route answered with no album" };
    return { ok: true, album: payload.album };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* ---------------------------------- the album ----------------------------------- */

export const createAlbum = (
  owner: string,
  title: string,
  visibility: SocialVisibility = "public",
): Promise<AlbumOne> => albumAction({ action: "create", owner, title, visibility });

export const renameAlbum = (owner: string, albumId: string, title: string): Promise<AlbumOne> =>
  albumAction({ action: "rename", owner, albumId, title });

export const setAlbumVisibility = (
  owner: string,
  albumId: string,
  visibility: SocialVisibility,
): Promise<AlbumOne> => albumAction({ action: "visibility", owner, albumId, visibility });

export const deleteAlbum = (owner: string, albumId: string): Promise<AlbumOne> =>
  albumAction({ action: "delete", owner, albumId });

/* ---------------------------------- the items ----------------------------------- */

export const setCaption = (
  owner: string,
  albumId: string,
  photoId: string,
  caption: string,
): Promise<AlbumOne> => albumAction({ action: "caption", owner, albumId, photoId, caption });

export const setCover = (owner: string, albumId: string, photoId: string): Promise<AlbumOne> =>
  albumAction({ action: "cover", owner, albumId, photoId });

/** The whole order, in one call. The store keeps anything this list forgets, so
 *  a stale client cannot delete a photo by omitting it. */
export const reorderPhotos = (
  owner: string,
  albumId: string,
  photoIds: string[],
): Promise<AlbumOne> => albumAction({ action: "reorder", owner, albumId, photoIds });

export const deletePhoto = (owner: string, albumId: string, photoId: string): Promise<AlbumOne> =>
  albumAction({ action: "delete-photo", owner, albumId, photoId });

/* -------------------------------- the social rail -------------------------------- */

/** Like or dislike, toggling — casting the one you already hold clears it, and
 *  casting the other moves it. The store owns that rule; this just posts. */
export const reactToPhoto = (
  owner: string,
  albumId: string,
  photoId: string,
  kind: "like" | "dislike",
): Promise<AlbumOne> => albumAction({ action: "react", owner, albumId, photoId, kind });

/** A comment, or — with `replyTo` — the one level of reply the model allows. */
export const commentOnPhoto = (
  owner: string,
  albumId: string,
  photoId: string,
  text: string,
  replyTo: string | null = null,
): Promise<AlbumOne> =>
  albumAction({ action: "comment", owner, albumId, photoId, text, ...(replyTo ? { replyTo } : {}) });

export const deletePhotoComment = (
  owner: string,
  albumId: string,
  photoId: string,
  commentId: string,
): Promise<AlbumOne> => albumAction({ action: "delete-comment", owner, albumId, photoId, commentId });

/* ---------------------------------- the bytes ----------------------------------- */

/** Where one item's bytes are served from. Private per the route's own cache
 *  header — an album's visibility can be narrowed after the fact. */
export const photoUrl = (owner: string, albumId: string, photoId: string): string =>
  `/api/amberxvid/albums/photo?owner=${encodeURIComponent(owner)}&album=${encodeURIComponent(albumId)}&id=${encodeURIComponent(photoId)}`;

/**
 * Upload photos into an album.
 *
 * Per-file verdicts are surfaced rather than collapsed: the route already
 * refuses one non-image without sinking the other seven, and a client that
 * reported only "3 of 4 uploaded" would leave the member guessing which.
 */
export async function uploadPhotos(
  owner: string,
  albumId: string,
  files: File[],
): Promise<PhotoUpload> {
  if (files.length === 0) return { ok: false, error: "nothing picked" };
  const form = new FormData();
  form.set("owner", owner);
  form.set("albumId", albumId);
  for (const file of files) form.append("photos", file);
  try {
    const res = await fetch("/api/amberxvid/albums", { method: "POST", body: form });
    if (!res.ok) return { ok: false, error: await errorFrom(res, "the upload failed") };
    const payload = (await res.json()) as AlbumPayload;
    if (!payload.album) return { ok: false, error: "the upload answered with no album" };
    return {
      ok: true,
      album: payload.album,
      added: payload.added ?? 0,
      rejected: (payload.results ?? [])
        .filter((r) => !r.ok)
        .map((r) => ({ name: r.name, error: r.error ?? "refused" })),
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* --------------------------------- the deep link --------------------------------- */

/** The query parameter one album link rides on. */
export const ALBUM_LINK_PARAM = "axv-album";

/** Where a link points: an album, or one item inside it. */
export interface AlbumLink {
  owner: string;
  albumId: string;
  photoId: string | null;
}

/**
 * A shareable link to an album, or to ONE item in it — what the lightbox's
 * "Copy link" puts on the clipboard so it can be pasted into a DM.
 *
 * Absolute, because a relative link pasted into a chat is a link that only
 * works for whoever is already on the page it was copied from. The module
 * resolves it on arrival (`AmberXVidModule`), and the album's own visibility
 * decides what the recipient actually sees — a link is an address, never a
 * grant, so forwarding one to a stranger shows them exactly what browsing to it
 * would have.
 */
export function albumItemUrl(owner: string, albumId: string, photoId?: string | null): string {
  const value = photoId ? `${owner}:${albumId}:${photoId}` : `${owner}:${albumId}`;
  const query = `${ALBUM_LINK_PARAM}=${encodeURIComponent(value)}`;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/amberxvid?${query}`;
}

/**
 * Read a link back out of a query string. `null` for anything malformed — a
 * junk parameter must land the visitor on the module, never on an error.
 */
export function parseAlbumLink(search: string): AlbumLink | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get(ALBUM_LINK_PARAM);
  } catch {
    return null;
  }
  if (!raw) return null;
  const [owner, albumId, photoId] = raw.split(":");
  if (!owner || !albumId) return null;
  return { owner, albumId, photoId: photoId || null };
}
