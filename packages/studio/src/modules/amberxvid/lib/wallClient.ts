/**
 * @file **The wall's client half** — every call the social face makes to
 * `/api/amberxvid/wall` and `/api/amberxvid/wall/media`, in one file (P9 of
 * `axf-amberxvid-social`, 2026-08-15).
 *
 * It is a separate module for the reason `accounts/profileClient.tsx` is: the
 * wall is drawn by THREE surfaces (a profile's wall, the merged feed, and
 * whatever P10–P12 hang beside them) and a fetch written three times is three
 * places for the payload shape to drift. The store's own contract stays in
 * `./wall.ts`, which is server-only and must never reach a client bundle — so
 * this file re-derives nothing from it beyond the TYPES, which erase.
 *
 * ## Two things worth knowing before calling anything here
 *
 * **1. A 404 is not an error, it is an answer.** The store answers "no such
 * post" identically for a post that never existed and one this viewer may not
 * see (`wall.ts` header, decision 2) — that silence is load-bearing and this
 * file must not undo it by inventing a friendlier sentence. Callers get the
 * route's own line and render it as the post being gone.
 *
 * **2. Media upload is a SEPARATE step from posting, on purpose.** The composer
 * uploads bytes first and names the returned ids on the post. That is what lets
 * one rejected attachment fail on its own instead of taking a written post down
 * with it, and it is why {@link uploadWallMedia} reports per-file verdicts
 * rather than one boolean. An upload nobody names is swept by the store as an
 * orphan after a day, so an abandoned composer costs nothing.
 */

import type { WallMedia, WallPost, WallVisibility } from "./types";

/** One page of a wall or the feed, exactly as the route serves it. */
export interface WallPage {
  /** Newest first, hydrated. */
  posts: WallPost[];
  /** Pass back as `cursor` for the next page; `null` at the end. */
  nextCursor: string | null;
  /** Which wall each post came from, by post id — a merged feed's items come
   *  from several vaults, and every link and media URL needs the owner. */
  owners: Record<string, string>;
}

export type WallPageLoad = { ok: true; page: WallPage } | { ok: false; error: string };
export type PostResult = { ok: true; post: WallPost } | { ok: false; error: string };

/** An upload's verdict. `media` can be short of what was picked and still be a
 *  success — `rejected` names each file the sniffer or the quota refused. */
export type MediaUpload =
  | { ok: true; media: WallMedia[]; rejected: { name: string; error: string }[] }
  | { ok: false; error: string };

/** Everything either route can put on the wire, on either side of ok/error. */
interface WallPayload {
  ok?: boolean;
  error?: string;
  post?: WallPost;
  posts?: WallPost[];
  nextCursor?: string | null;
  owners?: Record<string, string>;
  media?: WallMedia[];
  results?: { name: string; ok: boolean; error?: string }[];
}

/**
 * The body's own error line, or an honest statement of the status when there
 * is none. A 413 comes from the transport and carries no JSON the store wrote,
 * so it gets the one sentence that is true of it — the same posture
 * `profileClient.errorFrom` takes, for the same reason.
 */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  if (res.status === 413) return "that was too large to send — pick smaller attachments";
  try {
    const body = (await res.json()) as WallPayload;
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* a body that will not parse tells us nothing — fall through */
  }
  return `${fallback} (HTTP ${res.status})`;
}

/** A page out of a payload, defaulted field by field — a route that answers
 *  `ok` with a missing array must render as an empty wall, never as a crash. */
function pageFrom(body: WallPayload): WallPage {
  return {
    posts: Array.isArray(body.posts) ? body.posts : [],
    nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : null,
    owners: body.owners && typeof body.owners === "object" ? body.owners : {},
  };
}

async function getPage(url: string, fallback: string): Promise<WallPageLoad> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: await errorFrom(res, fallback) };
    return { ok: true, page: pageFrom((await res.json()) as WallPayload) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** One member's wall as the caller may see it, newest first, 20 at a time. */
export function loadWall(owner: string, cursor: string | null = null): Promise<WallPageLoad> {
  const q = new URLSearchParams({ owner });
  if (cursor) q.set("cursor", cursor);
  return getPage(`/api/amberxvid/wall?${q}`, "could not read that wall");
}

/** The merged feed — the caller's own wall plus every buddy's. */
export function loadFeed(cursor: string | null = null): Promise<WallPageLoad> {
  const q = new URLSearchParams({ feed: "1" });
  if (cursor) q.set("cursor", cursor);
  return getPage(`/api/amberxvid/wall?${q}`, "could not read your feed");
}

/** Every mutation the wall route takes; the caller passes the action's own
 *  fields and gets the post back as the store rewrote it. */
async function wallAction(body: Record<string, unknown>): Promise<PostResult> {
  try {
    const res = await fetch("/api/amberxvid/wall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: await errorFrom(res, "that did not go through") };
    const payload = (await res.json()) as WallPayload;
    if (!payload.post) return { ok: false, error: "the wall route answered with no post" };
    return { ok: true, post: payload.post };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export interface NewPostInput {
  text: string;
  /** Attachment ids from {@link uploadWallMedia}, already on disk. */
  media?: string[];
  visibility?: WallVisibility;
}

export const createPost = (owner: string, input: NewPostInput): Promise<PostResult> =>
  wallAction({ action: "create", owner, ...input });

/** An absent field means "leave it alone" all the way down to the store, so
 *  the caller passes only what it is actually changing. */
export const editPost = (
  owner: string,
  postId: string,
  patch: { text?: string; media?: string[]; visibility?: WallVisibility },
): Promise<PostResult> => wallAction({ action: "edit", owner, postId, ...patch });

export const deletePost = (owner: string, postId: string): Promise<PostResult> =>
  wallAction({ action: "delete", owner, postId });

/** Like or dislike, toggling — casting the one you already hold clears it, and
 *  casting the other moves it. The store owns that rule; this just posts. */
export const reactToPost = (
  owner: string,
  postId: string,
  kind: "like" | "dislike",
): Promise<PostResult> => wallAction({ action: "react", owner, postId, kind });

/** A comment, or — with `replyTo` — the one level of reply the model allows. */
export const commentOnPost = (
  owner: string,
  postId: string,
  text: string,
  replyTo: string | null = null,
): Promise<PostResult> =>
  wallAction({ action: "comment", owner, postId, text, ...(replyTo ? { replyTo } : {}) });

export const deleteComment = (
  owner: string,
  postId: string,
  commentId: string,
): Promise<PostResult> => wallAction({ action: "delete-comment", owner, postId, commentId });

/* --------------------------------- attachments ---------------------------------- */

/** Where one attachment's bytes are served from. Private per the route's own
 *  cache header — a post's visibility can be narrowed after the fact. */
export const wallMediaUrl = (owner: string, mediaId: string): string =>
  `/api/amberxvid/wall/media?owner=${encodeURIComponent(owner)}&id=${encodeURIComponent(mediaId)}`;

/**
 * Upload attachments into the owner's vault and get back the descriptors the
 * composer then names on a post.
 *
 * Per-file verdicts are surfaced rather than collapsed: the route already
 * refuses one non-image without sinking the other seven, and a client that
 * reported only "3 of 4 uploaded" would leave the member guessing which.
 */
export async function uploadWallMedia(owner: string, files: File[]): Promise<MediaUpload> {
  if (files.length === 0) return { ok: true, media: [], rejected: [] };
  const form = new FormData();
  form.set("owner", owner);
  for (const file of files) form.append("media", file);
  try {
    const res = await fetch("/api/amberxvid/wall/media", { method: "POST", body: form });
    if (!res.ok) return { ok: false, error: await errorFrom(res, "the upload failed") };
    const payload = (await res.json()) as WallPayload;
    return {
      ok: true,
      media: Array.isArray(payload.media) ? payload.media : [],
      rejected: (payload.results ?? [])
        .filter((r) => !r.ok)
        .map((r) => ({ name: r.name, error: r.error ?? "refused" })),
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
