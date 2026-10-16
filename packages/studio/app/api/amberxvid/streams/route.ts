/**
 * @file `/api/amberxvid/streams` — live-stream rooms: lifecycle, group chat,
 * poster thumbnails. Room bookkeeping ONLY since P7: media rides the SFU
 * (`/api/amberxvid/media`), the host publishes one upstream, and the sdp/ice
 * relay this route used to carry is deleted with the mesh it wired
 * (`MEDIA_CONTRACT.signaling` — SDP never transits the app server again).
 *
 * Same transport shape as `/api/amberxvid/calls`: plain short POSTs in, the
 * push half riding the presence SSE stream (Traefik-safe, no WebSocket).
 *
 * GET                     → `{ streams, watching, chat? }` — live rooms + the
 *   caller's own attachment; `?chat=<id>` adds a room's backlog (member-gated).
 * GET `?thumb=<id>[&t=…]` → the room's poster jpeg (any member; `t` busts cache).
 * GET `?history=1`        → `{ hosted, watched }` — the caller's own stream and
 *   watch history (P12). Own only: a member's viewing history is theirs.
 * POST `{ action }`:
 *   `open      { title, description }` go live (one room per host)
 *   `close     { streamId }`          host or administrator ends the room
 *   `join      { streamId, preview }` take a seat — preview = the hidden hover
 *     player, leased server-side (`MEDIA_TIMING.previewLeaseMs`); the seat is
 *     what the media route mints the participant token from
 *   `leave     { streamId }`          give the seat back
 *   `chat      { streamId, text }`    group message → everyone attached (not previews)
 *   `thumbnail { streamId, dataUrl }` host posts the poster frame (~10 s cadence)
 *   `describe  { streamId, title?, description? }` host edits either, LIVE (P12)
 *   `remove    { streamId, user }`    host removes a viewer (P12) — the seat
 *     goes and the removal is remembered; the media seat is vacated by the
 *     bridge's keepalive, which is what closes their consumers server-side
 *
 * HISTORY IS NOT WRITTEN HERE, deliberately: every way out of a stream goes
 * through `lib/streams`, so the rows are written there (see `leaveStream`'s
 * docblock). This route's only history duty is the `close` path's
 * `archiveClosure`, which needs the closure the mutation handed back.
 *
 * Every mutation that changes what the world sees (open/close/join/leave/
 * thumbnail/describe/remove) broadcasts the fresh `streams` list to EVERY open
 * SSE stream — that one event is what flips "Live" badges, tab tiles and viewer
 * counts everywhere at once, and it is also how the host's UI learns of joiners
 * now that nothing signals the host directly. Double gate as always.
 *
 * ## The follower alert (P12)
 *
 * `open` fans a `stream-alert` out to everybody who FOLLOWS the host and may be
 * interrupted. Three things about it are deliberate:
 *
 *   - it is ADDRESSED, never broadcast. The whole point of following somebody
 *     is that you hear about them and not about everybody;
 *   - it is filtered SERVER-SIDE through `lib/dnd`'s one chokepoint, so a
 *     client never has to decide whether it was allowed to be told — and P13's
 *     do-not-disturb model lands in that one function rather than here;
 *   - it rides `notifyUsers`, so it reaches a follower on another app process
 *     through the outbox, and a stale one dies at `outboxTtlMs` rather than
 *     ringing about a stream that ended twenty minutes ago.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { findAccount } from "@axs/modules/amberxvid/lib/accounts";
import { broadcastAll, notifyUsers, presenceSnapshot } from "@axs/modules/amberxvid/lib/presence";
import {
  THUMBNAIL_MAX_BYTES,
  archiveClosure,
  closeStream,
  describeStream,
  getChat,
  getThumbnail,
  joinStream,
  leaveStream,
  listStreams,
  openStream,
  postChat,
  removeViewer,
  roomAudience,
  setThumbnail,
  watchingStreamFor,
} from "@axs/modules/amberxvid/lib/streams";
import { followersOf } from "@axs/modules/amberxvid/lib/follows";
import { interruptible } from "@axs/modules/amberxvid/lib/dnd";
import { readPrefs } from "@axs/modules/amberxvid/lib/prefsServer";
import {
  streamHistoryFor,
  watchHistoryFor,
} from "@axs/modules/amberxvid/lib/streamHistory";
import type { StreamInfo, StreamSignal } from "@axs/modules/amberxvid/lib/types";

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

function err(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Push the fresh room list to everyone — the event behind tiles and counts.
 *  The roster rides along because `Presence.streamingId` changed with it —
 *  without the re-send, buddy-list "Live" badges would wait for the next
 *  presence flip instead of the moment the room opened. */
async function broadcastStreams(): Promise<void> {
  broadcastAll({ type: "streams", streams: listStreams() });
  broadcastAll({ type: "roster", roster: await presenceSnapshot() });
}

/**
 * Ring this host's followers that they are live (P12).
 *
 * The audience is `followers ∩ interruptible` — the follow graph decides WHO
 * cares, `lib/dnd` decides who may be interrupted, and neither question is
 * answered on the client. Best-effort by construction: a follow store that
 * cannot be read costs the alert, never the broadcast.
 */
async function alertFollowers(host: string, stream: StreamInfo): Promise<void> {
  try {
    const interruptibleFollowers = await interruptible(followersOf(host));
    // P16 — and the member's own row for THIS alert, which is a narrower
    // question than "may I be interrupted at all": somebody who wants call
    // rings but not a notification every time a friend starts streaming has one
    // switch that says exactly that. Read server-side, because an alert
    // delivered and then discarded by the recipient's browser is an alert their
    // other tab still popped.
    const wants = await Promise.all(
      interruptibleFollowers.map((u) => readPrefs(u).then((p) => p.followedLiveAlerts !== false)),
    );
    const audience = interruptibleFollowers.filter((_, i) => wants[i]);
    if (audience.length === 0) return;
    notifyUsers(audience, {
      type: "stream-alert",
      alert: {
        streamId: stream.id,
        host: host.trim().toLowerCase(),
        hostDisplay: stream.host,
        title: stream.title,
        at: new Date().toISOString(),
      },
    });
  } catch {
    /* nobody's broadcast fails because an alert could not be sent */
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await profileUser(req);
  if (!me) return unauthorized();

  const thumb = req.nextUrl.searchParams.get("thumb");
  if (thumb) {
    const bytes = getThumbnail(thumb);
    if (!bytes) return err("no poster yet", 404);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.length),
        // Posters refresh ~10 s; the client cache-busts with ?t=<thumbnailAt>.
        "Cache-Control": "private, max-age=30",
      },
    });
  }

  // P12 — own history only, and that is the whole access rule: what a member
  // watched is theirs, and there is no `?history=<someone-else>` to forget to
  // gate because the parameter does not name a user.
  if (req.nextUrl.searchParams.get("history")) {
    return NextResponse.json({ ok: true, hosted: streamHistoryFor(me), watched: watchHistoryFor(me) });
  }

  const chatId = req.nextUrl.searchParams.get("chat");
  return NextResponse.json({
    ok: true,
    streams: listStreams(),
    watching: watchingStreamFor(me),
    ...(chatId ? { chat: getChat(chatId) } : {}),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await profileUser(req);
  if (!me) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return err("body must be JSON", 400);
  }
  const action = typeof body.action === "string" ? body.action : "";
  const streamId = typeof body.streamId === "string" ? body.streamId : "";

  switch (action) {
    case "open": {
      const result = await openStream(me, body.title, body.description);
      if (!result.ok) return err(result.error, result.status);
      await broadcastStreams();
      // After the broadcast: the room is on everybody's list before anybody is
      // rung about it, so a follower who clicks the toast instantly finds it.
      await alertFollowers(me, result.value);
      return NextResponse.json({ ok: true, stream: result.value });
    }

    case "close": {
      const account = await findAccount(me);
      const result = closeStream(me, streamId, account?.role === "administrator");
      if (!result.ok) return err(result.error, result.status);
      const ended: StreamSignal = { kind: "ended", streamId, from: me };
      notifyUsers(result.value.attached, { type: "stream-signal", signal: ended });
      await broadcastStreams();
      // P12 — the history rows: the host's, and one per watcher still attached.
      await archiveClosure(result.value.closure);
      return NextResponse.json({ ok: true, stream: result.value.info });
    }

    case "describe": {
      const result = describeStream(me, streamId, {
        title: body.title,
        description: body.description,
      });
      if (!result.ok) return err(result.error, result.status);
      // The title rides every tile, every list row and the room header, so an
      // edit is a world-visible change and gets the same broadcast a join does.
      await broadcastStreams();
      return NextResponse.json({ ok: true, stream: result.value });
    }

    case "remove": {
      const account = await findAccount(me);
      const target = typeof body.user === "string" ? body.user : "";
      const result = removeViewer(me, streamId, target, account?.role === "administrator");
      if (!result.ok) return err(result.error, result.status);
      // Tell them, with the SAME signal a room ending sends: from the removed
      // member's seat the two are the same event — this room is over for you —
      // and their client already folds its player and closes the window on it.
      const ended: StreamSignal = { kind: "ended", streamId, from: me };
      notifyUsers([result.value.removed], { type: "stream-signal", signal: ended });
      await broadcastStreams();
      return NextResponse.json({ ok: true, stream: result.value.info, removed: result.value.removed });
    }

    case "join": {
      const preview = body.preview === true;
      const result = joinStream(me, streamId, preview);
      if (!result.ok) return err(result.error, result.status);
      // Nobody signals the host any more (P7): the seat is the whole join —
      // the media route mints this member's token from it, and the broadcast
      // below updates every roster and viewer count, the host's included.
      await broadcastStreams();
      return NextResponse.json({ ok: true, stream: result.value, chat: preview ? [] : getChat(streamId) });
    }

    case "leave": {
      // The watch-history row is written by `leaveStream` itself — see its
      // docblock for why all four ways out of a stream write in the store
      // layer rather than one of them writing here.
      const result = leaveStream(me, streamId);
      if (!result.ok) return err(result.error, result.status);
      await broadcastStreams();
      return NextResponse.json({ ok: true, stream: result.value });
    }

    case "chat": {
      const result = postChat(me, streamId, body.text);
      if (!result.ok) return err(result.error, result.status);
      notifyUsers(roomAudience(streamId), { type: "stream-chat", streamId, message: result.value });
      return NextResponse.json({ ok: true, message: result.value });
    }

    case "thumbnail": {
      const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!m || dataUrl.length > THUMBNAIL_MAX_BYTES * 1.4) return err("poster must be a small jpeg data URL", 400);
      const result = setThumbnail(me, streamId, Buffer.from(m[1], "base64"));
      if (!result.ok) return err(result.error, result.status);
      await broadcastStreams();
      return NextResponse.json({ ok: true, stream: result.value });
    }

    default:
      return err("unknown action", 400);
  }
}
