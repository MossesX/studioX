/**
 * @file `/api/amberxvid/calls` — 1:1 call SESSION signaling. POST + the
 * presence SSE stream is the whole channel: a signal comes in here, is
 * rebuilt through the `sanitizeSignal` whitelist (the chokepoint — see
 * `@axs/modules/amberxvid/lib/calls`), applied to the session state machine, and pushed
 * to the OTHER participant's open streams. Traefik-safe by construction:
 * plain short POSTs, and the push half rides the already anti-buffered SSE
 * stream — no WebSocket to upgrade through the proxy.
 *
 * SINCE P6 this route carries the ring ceremony and nothing else. The
 * `sdp`/`ice` relay kinds and the mesh-era `path` bookkeeping action are
 * DELETED: call media is mediasoup vocabulary over `/api/amberxvid/media`
 * (P4), and every leg terminates on the media server, so there is no
 * direct/relayed distinction left to report (`MEDIA_CONTRACT.path`).
 *
 * Same gate as the rest of the module: a signed-in AmberX Vid session.
 *
 * GET → `{ call }` — the caller's live call session, if any (a reloaded
 *   window re-learns of a ring it missed, and a reconnecting participant
 *   re-learns the live call it should resume into).
 * POST `{ action: "invite", to }`          → mint the session, ring the callee.
 * POST `{ action: "signal", kind, ... }`   → whitelist-relay to the peer
 *   (accept / reject / hangup — `from` is always stamped from the
 *   authenticated profile, never read from the body. Since P5 that stamp is
 *   the whole identity story: the `attest` action and the server-pushed
 *   `verify` verdict are RETIRED with the DTLS-fingerprint referee, which an
 *   SFU makes meaningless — see lib/calls.ts and lib/mediaContract.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { activeCallFor, applySignal, createCall, getCall, sanitizeSignal } from "@axs/modules/amberxvid/lib/calls";
import { recordCallState } from "@axs/modules/amberxvid/lib/callHistory";
import { ringVisibility } from "@axs/modules/amberxvid/lib/ring";
import { isOnline, notifyUsers } from "@axs/modules/amberxvid/lib/presence";
import { findAccount } from "@axs/modules/amberxvid/lib/accounts";
import type { CallSession } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

/**
 * P13 — bring both members' call-history rows in line with the session, and
 * write the missed-call note if this is the transition that missed it.
 *
 * The screennames are resolved HERE, at the moment of the ring, and stored on
 * the rows: a history row has to keep reading after a rename, and the row is
 * the only place that memory can live. A member whose account has since gone
 * falls back to their username, which is what every other surface does.
 *
 * Never allowed to fail the signal — the call is the product, the history is
 * the residue. A store that cannot be written is a row that is missing, not a
 * call that did not happen.
 */
async function writeHistory(session: CallSession): Promise<void> {
  try {
    const [caller, callee] = await Promise.all([findAccount(session.from), findAccount(session.to)]);
    await recordCallState(session, {
      fromDisplay: caller?.screenname ?? session.from,
      toDisplay: callee?.screenname ?? session.to,
    });
  } catch {
    /* history never fails a call */
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();
  return NextResponse.json({ ok: true, call: activeCallFor(me) });
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

  if (action === "invite") {
    const to = typeof body.to === "string" ? body.to.trim() : "";
    if (!to) return NextResponse.json({ ok: false, error: "say who to call" }, { status: 400 });
    if (to.toLowerCase() === me.toLowerCase()) {
      return NextResponse.json({ ok: false, error: "that's you" }, { status: 400 });
    }
    const callee = await findAccount(to);
    if (!callee || callee.disabled === true || callee.screenname === null) {
      return NextResponse.json({ ok: false, error: "no such member" }, { status: 404 });
    }
    // The caller's OWN state first — it leaks nothing about the callee, and
    // answering it here means a busy caller never files a do-not-disturb miss
    // for a ring they were never going to place.
    if (activeCallFor(me)) {
      return NextResponse.json({ ok: false, error: "you're already in a call" }, { status: 409 });
    }
    // P13 — THE COVER STORY, before anything that would leak past it. "They're
    // offline" and "they're in another call" are both facts a blocked member
    // must not be able to read off a probe, and both used to be answered first.
    // `ringVisibility` is the side-effect-free half of the ring door; the full
    // door still runs inside `createCall` below.
    const visible = await ringVisibility({ from: me, to: callee.username, toDisplay: callee.screenname });
    if (!visible.ok) {
      return NextResponse.json({ ok: false, error: visible.error }, { status: visible.status });
    }
    if (!isOnline(to)) {
      return NextResponse.json({ ok: false, error: "they're offline — calls need both sides online" }, { status: 409 });
    }
    if (activeCallFor(to)) {
      return NextResponse.json({ ok: false, error: "they're in another call" }, { status: 409 });
    }
    const caller = await findAccount(me);
    const created = await createCall(me, callee.username, {
      fromDisplay: caller?.screenname ?? me,
      toDisplay: callee.screenname,
    });
    if (!created.ok) {
      // P13: `unavailable` is the do-not-disturb path, and it is NOT a plain
      // refusal — the ring door already wrote the missed row on both sides and
      // put the note in the inbox. The flag rides out so the caller's window
      // can say "unavailable" instead of ringing into a room nobody is in.
      return NextResponse.json(
        { ok: false, error: created.error, unavailable: created.unavailable === true },
        { status: created.status },
      );
    }
    const { session, signal } = created;
    // The rows exist BEFORE the ring is written: a process that dies between
    // the two leaves a placed/received pair the sweeper's timeout will close,
    // which is a truthful record. The reverse order would leave a ring with no
    // history at all.
    await writeHistory(session);
    notifyUsers([callee.username], { type: "call", signal });
    return NextResponse.json({ ok: true, callId: session.id, call: session });
  }

  if (action === "signal") {
    const result = sanitizeSignal(body, me);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    if (result.signal.kind === "invite") {
      return NextResponse.json({ ok: false, error: "invites go through action: invite" }, { status: 400 });
    }
    const applied = applySignal(result.signal);
    if (!applied.ok) {
      return NextResponse.json({ ok: false, error: applied.error }, { status: applied.status });
    }
    // P13: every signal updates both rows. `applySignal` returns the session it
    // mutated in memory; re-reading the record is what makes the write reflect
    // what actually persisted under the room lock, not what this process
    // intended — two processes hanging up at once agree on one end time.
    await writeHistory(getCall(result.signal.callId) ?? applied.session);
    notifyUsers([applied.to], { type: "call", signal: result.signal });
    return NextResponse.json({ ok: true, state: applied.session.state });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
