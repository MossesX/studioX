/**
 * @file `/api/amberxvid/follows` — the follow graph (P12).
 *
 * Its own door rather than two more actions on `/api/amberxvid/streams`,
 * because following is not a property of a room: it outlives every stream the
 * followed member ever opens, it is read by surfaces that have nothing to do
 * with a live room (a profile header, the hub's ordering), and a route named
 * after rooms would have to answer questions about people.
 *
 * GET
 *   - no query          → `{ following, followers, counts }` — the caller's own
 *                          graph plus the follower count of everybody in it,
 *                          which is what a list renders beside a name.
 *   - `?user=<name>`    → `{ following, followerCount }` — is the caller
 *                          following them, and how many follow them. Deliberately
 *                          NOT that member's follower LIST: who follows somebody
 *                          is a social graph, and this route publishes a number
 *                          rather than a roster.
 *
 * POST `{ action: "follow" | "unfollow", user }` → the caller's fresh graph.
 *
 * Gated like every module API on `memberUser` — the studio's `axs_session` plus
 * the amberxvid grant. The relations guard (blocks, buddies-only) is enforced
 * inside `lib/follows`, at the store, so it cannot be missed by a second caller.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import {
  followerCounts,
  followsFor,
  isFollowing,
  setFollow,
} from "@axs/modules/amberxvid/lib/follows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();

  const user = (req.nextUrl.searchParams.get("user") ?? "").trim();
  if (user) {
    return NextResponse.json({
      ok: true,
      user: user.toLowerCase(),
      following: isFollowing(me, user),
      followerCount: followsFor(user).followers.length,
    });
  }

  const graph = followsFor(me);
  return NextResponse.json({
    ok: true,
    ...graph,
    counts: followerCounts([...graph.following, me]),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const user = typeof body.user === "string" ? body.user : "";
  if (action !== "follow" && action !== "unfollow") {
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  }

  const result = await setFollow(me, user, action === "follow");
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({
    ok: true,
    ...result.value,
    counts: followerCounts([...result.value.following, user]),
  });
}
