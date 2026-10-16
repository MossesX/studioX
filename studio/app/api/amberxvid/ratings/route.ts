/**
 * @file `/api/amberxvid/ratings` — the 0–10 star system, users and streams.
 *
 * GET  `?kind=user&target=<name>`      → one summary (`mine` filled for the caller)
 * GET  `?users=a,b,c` / `?streams=x,y` → batch summaries (member lists, stream grids)
 * POST `{ kind, target, stars }`       → cast/update the caller's vote
 *
 * Validation lives in the STORE (`@axs/modules/amberxvid/lib/ratings`): integer 0–10,
 * no self-rating, no rating your own stream, user targets must be entered
 * members. For stream targets the route looks the room up in the live
 * registry and passes its `{host, title}` through — that context is the
 * proof the stream is real, and the snapshot that keeps the rating readable
 * after the ephemeral room dies. Double gate as always.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { rateTarget, ratingSummaries, ratingSummary } from "@axs/modules/amberxvid/lib/ratings";
import { listStreams } from "@axs/modules/amberxvid/lib/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in AmberX Vid member, or null.
 *
 * Re-pointed at the accounts session by P1 of `axf-amberxvid-social`
 * (2026-08-14): there is one identity system now, and null here means either
 * "nobody is signed in" or "signed in, but the permission matrix does not
 * grant them amberxvid". Both answer 401 on this route, which is what it
 * already did; a surface that must tell the two apart calls `requireMember`.
 */
async function profileUser(req: NextRequest): Promise<string | null> {
  return memberUser(req);
}

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

const split = (v: string | null): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Async now that the gate asks the permission matrix as well as the cookie —
// the body below is still entirely synchronous.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await profileUser(req);
  if (!me) return unauthorized();
  const q = req.nextUrl.searchParams;

  const users = split(q.get("users"));
  const streams = split(q.get("streams"));
  if (users.length || streams.length) {
    return NextResponse.json({
      ok: true,
      users: ratingSummaries("user", users, me),
      streams: ratingSummaries("stream", streams, me),
    });
  }

  const kind = q.get("kind") === "stream" ? "stream" : "user";
  const target = q.get("target") ?? "";
  if (!target) return NextResponse.json({ ok: false, error: "target required" }, { status: 400 });
  return NextResponse.json({ ok: true, rating: ratingSummary(kind, target, me) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await profileUser(req);
  if (!me) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const kind = body.kind === "stream" ? "stream" : "user";
  const target = typeof body.target === "string" ? body.target.trim() : "";
  if (!target) return NextResponse.json({ ok: false, error: "target required" }, { status: 400 });

  // A live stream's registry entry is the context; the store falls back to a
  // previously-persisted snapshot for rate-after-end.
  const live = kind === "stream" ? listStreams().find((s) => s.id === target) : undefined;
  const context = live ? { host: live.host, title: live.title } : undefined;

  const result = await rateTarget(me, kind, target, body.stars, context);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, rating: result.value });
}
