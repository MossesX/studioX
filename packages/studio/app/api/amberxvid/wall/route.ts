/**
 * @file `/api/amberxvid/wall` — posts, reactions, comments and the feed.
 *
 * Gated like every module API on `memberUser` — a signed-in studio session
 * (`axs_session`) holding the amberxvid grant, asked of the permission matrix
 * per request. Everything past that gate is the store's job: visibility runs
 * through the accounts social graph (`canInteract`), mutation rights are the
 * author's or a moderator's, and every byte is quota-checked and charged.
 *
 * A post the caller may not see and a post that does not exist answer
 * IDENTICALLY (404 "no such post"). That is deliberate and load-bearing — see
 * `lib/wall.ts`'s header, decision (2).
 *
 * GET ?owner=<u>[&cursor=]  → `{ posts, nextCursor, owners }` — one wall,
 *                             visibility-filtered for the caller, 20 at a time.
 * GET ?owner=<u>&id=<wp-…>  → `{ post }` — one post (404 when not visible).
 * GET ?feed=1[&cursor=]     → the merged feed: the caller's wall plus buddies'.
 * POST JSON `{ action, … }`:
 *   - `create`         { owner?, text, media?: string[], visibility? }
 *   - `edit`           { owner?, postId, text?, media?, visibility? }
 *   - `delete`         { owner?, postId }
 *   - `react`          { owner?, postId, kind: "like" | "dislike" }
 *   - `comment`        { owner?, postId, text, replyTo? }
 *   - `delete-comment` { owner?, postId, commentId }
 *   (`owner` defaults to the caller — a reaction or a comment on somebody
 *   else's wall passes theirs.)
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import {
  comment,
  createPost,
  deleteComment,
  deletePost,
  editPost,
  feedFor,
  react,
  readPost,
  wallFor,
  type ReactionKind,
  type WallResult,
} from "@axs/modules/amberxvid/lib/wall";
import type { WallVisibility } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

function resultJson(result: WallResult): NextResponse {
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, post: result.post });
}

const VISIBILITIES = new Set(["public", "buddies", "private"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const viewer = await memberUser(req);
  if (!viewer) return unauthorized();

  const q = req.nextUrl.searchParams;
  const cursor = q.get("cursor");

  if (q.get("feed")) {
    return NextResponse.json({ ok: true, ...feedFor(viewer, cursor) });
  }

  const owner = q.get("owner");
  if (!owner) {
    return NextResponse.json({ ok: false, error: "owner is required" }, { status: 400 });
  }
  const id = q.get("id");
  if (id) {
    const post = readPost(viewer, owner, id);
    if (!post) return NextResponse.json({ ok: false, error: "no such post" }, { status: 404 });
    return NextResponse.json({ ok: true, post });
  }
  return NextResponse.json({ ok: true, ...wallFor(viewer, owner, cursor) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await memberUser(req);
  if (!actor) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const str = (k: string): string => (typeof body[k] === "string" ? (body[k] as string) : "");
  const owner = str("owner").trim() || actor;
  const postId = str("postId");
  const media = Array.isArray(body.media)
    ? (body.media as unknown[]).filter((v): v is string => typeof v === "string")
    : undefined;
  const visibility = VISIBILITIES.has(str("visibility"))
    ? (str("visibility") as WallVisibility)
    : undefined;

  switch (str("action")) {
    case "create":
      return resultJson(await createPost(actor, owner, { text: str("text"), media, visibility }));
    case "edit":
      return resultJson(
        await editPost(actor, owner, postId, {
          // `undefined` means "leave it alone", so an absent field must not
          // become an empty string on its way through the route.
          ...(typeof body.text === "string" ? { text: body.text } : {}),
          ...(media ? { media } : {}),
          ...(visibility ? { visibility } : {}),
        }),
      );
    case "delete":
      return resultJson(await deletePost(actor, owner, postId));
    case "react":
      return resultJson(await react(actor, owner, postId, str("kind") as ReactionKind));
    case "comment":
      return resultJson(
        await comment(actor, owner, postId, str("text"), str("replyTo") || null),
      );
    case "delete-comment":
      return resultJson(await deleteComment(actor, owner, postId, str("commentId")));
    default:
      return NextResponse.json(
        { ok: false, error: `unknown action "${str("action")}"` },
        { status: 400 },
      );
  }
}
