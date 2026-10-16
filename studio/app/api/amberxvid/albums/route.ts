/**
 * @file `/api/amberxvid/albums` — the photo surface: album CRUD, multi-file
 * upload, ordering, visibility, and the social rail on an item.
 *
 * Gated like every module API on `memberUser` — a signed-in studio session
 * (`axs_session`) holding the amberxvid grant, asked of the permission matrix
 * per request. Everything past that gate is the store's job.
 *
 * **Reads are VIEWER-FILTERED since P10.** Albums were a shared surface until
 * this phase (any member browsed anybody's); they now carry a visibility
 * resolved through the accounts social graph, and an album a caller may not see
 * is ABSENT from their list and 404s by id — identically to one that does not
 * exist. Mutation is still owner-or-admin, enforced in the store
 * (`resolveActor`), which journals every change to the activity ledger;
 * reacting and commenting are any permitted viewer's, exactly as on the wall.
 *
 * GET ?owner=<u>            → `{ albums }` — that member's albums as the caller
 *                             may see them, newest first.
 * GET ?owner=<u>&id=<alb-…> → `{ album }` — one album (404 on junk, missing or
 *                             not-for-you ids alike).
 * GET ?feed=1               → `{ albums }` — the caller's own albums merged with
 *                             their buddies', most recently touched first.
 * POST multipart/form-data  → upload: fields `owner`, `albumId`, files under
 *   `photos` (any count). Bytes are signature-sniffed in the store; a mixed
 *   batch reports per-file results instead of failing the lot.
 * POST JSON `{ action, … }`:
 *   - `create`         { owner?, title, visibility? }
 *   - `rename`         { owner?, albumId, title }
 *   - `visibility`     { owner?, albumId, visibility }
 *   - `delete`         { owner?, albumId }
 *   - `caption`        { owner?, albumId, photoId, caption }
 *   - `cover`          { owner?, albumId, photoId }
 *   - `reorder`        { owner?, albumId, photoIds: string[] }
 *   - `delete-photo`   { owner?, albumId, photoId }
 *   - `react`          { owner?, albumId, photoId, kind: "like" | "dislike" }
 *   - `comment`        { owner?, albumId, photoId, text, replyTo? }
 *   - `delete-comment` { owner?, albumId, photoId, commentId }
 *   (`owner` defaults to the caller — the admin window and every reaction on
 *   somebody else's album pass theirs explicitly.)
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import {
  addPhoto,
  albumFeedFor,
  commentOnPhoto,
  createAlbum,
  deleteAlbum,
  deletePhoto,
  deletePhotoComment,
  getAlbum,
  listAlbumsFor,
  reactToPhoto,
  readAlbumFor,
  renameAlbum,
  reorderPhotos,
  setAlbumVisibility,
  setCaption,
  setCover,
  type AlbumResult,
} from "@axs/modules/amberxvid/lib/albums";
import type { ReactionKind } from "@axs/modules/amberxvid/lib/social";
import type { SocialVisibility } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

function resultJson(result: AlbumResult): NextResponse {
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, album: result.album });
}

const VISIBILITIES = new Set(["public", "buddies", "private"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const viewer = await memberUser(req);
  if (!viewer) return unauthorized();

  const q = req.nextUrl.searchParams;
  if (q.get("feed")) {
    return NextResponse.json({ ok: true, albums: await albumFeedFor(viewer) });
  }

  const owner = q.get("owner");
  if (!owner) {
    return NextResponse.json({ ok: false, error: "owner is required" }, { status: 400 });
  }
  const id = q.get("id");
  if (id) {
    const album = await readAlbumFor(viewer, owner, id);
    if (!album) return NextResponse.json({ ok: false, error: "no such album" }, { status: 404 });
    return NextResponse.json({ ok: true, album });
  }
  return NextResponse.json({ ok: true, albums: await listAlbumsFor(viewer, owner) });
}

/** Multi-file upload — per-file verdicts, so one bad file never sinks a batch. */
async function handleUpload(req: NextRequest, actor: string): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "malformed multipart body" }, { status: 400 });
  }
  const ownerField = form.get("owner");
  const owner = typeof ownerField === "string" && ownerField.trim() ? ownerField.trim() : actor;
  const albumId = form.get("albumId");
  if (typeof albumId !== "string" || !albumId) {
    return NextResponse.json({ ok: false, error: "albumId is required" }, { status: 400 });
  }

  const files = form.getAll("photos").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "no files under \"photos\"" }, { status: 400 });
  }

  const results: { name: string; ok: boolean; error?: string }[] = [];
  let album = null;
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await addPhoto(actor, owner, albumId, bytes);
    if (result.ok) {
      album = result.album;
      results.push({ name: file.name, ok: true });
      continue;
    }
    results.push({ name: file.name, ok: false, error: result.error });
    // Per-FILE failures (not an image, too big, empty) skip to the next file;
    // batch-level ones (access denied, no such album, album full) end the run.
    const perFile = result.status === 415 || result.status === 413 || result.status === 400;
    if (!perFile) break;
  }

  const added = results.filter((r) => r.ok).length;
  if (added === 0) {
    const first = results.find((r) => !r.ok);
    return NextResponse.json(
      { ok: false, error: first?.error ?? "nothing uploaded", results },
      { status: 400 },
    );
  }
  // The uploader is the owner or an administrator, so the stored album IS the
  // one they may see — this read does not go through the viewer filter.
  if (!album) album = await getAlbum(owner, albumId);
  return NextResponse.json({ ok: true, added, results, album });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await memberUser(req);
  if (!actor) return unauthorized();

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return handleUpload(req, actor);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const str = (k: string): string => (typeof body[k] === "string" ? (body[k] as string) : "");
  const owner = str("owner").trim() || actor;
  const albumId = str("albumId");
  const photoId = str("photoId");
  const visibility = VISIBILITIES.has(str("visibility"))
    ? (str("visibility") as SocialVisibility)
    : undefined;

  switch (str("action")) {
    case "create":
      return resultJson(await createAlbum(actor, owner, str("title"), visibility ?? "public"));
    case "rename":
      return resultJson(await renameAlbum(actor, owner, albumId, str("title")));
    case "visibility":
      // An unrecognised value is refused by name rather than silently defaulted
      // to public — a visibility that quietly widens is the one bug this whole
      // field exists to prevent.
      return resultJson(
        visibility
          ? await setAlbumVisibility(actor, owner, albumId, visibility)
          : { ok: false, status: 400, error: "visibility is public, buddies or private" },
      );
    case "delete":
      return resultJson(await deleteAlbum(actor, owner, albumId));
    case "caption":
      return resultJson(await setCaption(actor, owner, albumId, photoId, str("caption")));
    case "cover":
      return resultJson(await setCover(actor, owner, albumId, photoId));
    case "reorder":
      return resultJson(
        await reorderPhotos(
          actor,
          owner,
          albumId,
          Array.isArray(body.photoIds)
            ? (body.photoIds as unknown[]).filter((v): v is string => typeof v === "string")
            : [],
        ),
      );
    case "delete-photo":
      return resultJson(await deletePhoto(actor, owner, albumId, photoId));
    case "react":
      return resultJson(
        await reactToPhoto(actor, owner, albumId, photoId, str("kind") as ReactionKind),
      );
    case "comment":
      return resultJson(
        await commentOnPhoto(actor, owner, albumId, photoId, str("text"), str("replyTo") || null),
      );
    case "delete-comment":
      return resultJson(
        await deletePhotoComment(actor, owner, albumId, photoId, str("commentId")),
      );
    default:
      return NextResponse.json({ ok: false, error: `unknown action "${str("action")}"` }, { status: 400 });
  }
}
