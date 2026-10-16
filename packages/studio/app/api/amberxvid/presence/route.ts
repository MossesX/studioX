/**
 * @file `/api/amberxvid/presence` — the messenger's SSE channel: presence
 * heartbeat + live message delivery in one stream.
 *
 * GET → `text/event-stream`. Every open stream marks its member online in
 * the presence registry; the stream opens with a `hello` (you + full roster),
 * gets a `roster` on every online/offline flip anywhere, a `message` the
 * instant someone messages you, and a `ping` every 15 s so intermediaries
 * never reap the idle connection. Headers are Traefik-proof by construction:
 * `X-Accel-Buffering: no` + `no-cache, no-transform` + an immediate first
 * flush, so presence works identically on localhost and behind the
 * amberxai.com proxy hop.
 *
 * Same gate as the rest of the module: a signed-in AmberX Vid session —
 * presence is member-to-member state.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { connect, presenceSnapshot } from "@axs/modules/amberxvid/lib/presence";
import type { MessengerEvent } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_MS = 15_000;

export async function GET(req: NextRequest): Promise<Response> {
  const me = await memberUser(req);
  if (!me) {
    return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
  }

  const enc = new TextEncoder();
  let closed = false;
  let disconnect: (() => void) | null = null;
  let pinger: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: MessengerEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (pinger) clearInterval(pinger);
        disconnect?.();
        try {
          controller.close();
        } catch {
          /* already gone */
        }
      };

      // Register FIRST (the roster in the hello must include ourselves), then
      // flush the hello immediately — the anti-buffering first byte.
      disconnect = connect(me, send);
      send({ type: "hello", you: me, roster: await presenceSnapshot() });
      pinger = setInterval(() => send({ type: "ping", at: new Date().toISOString() }), PING_MS);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      if (pinger) clearInterval(pinger);
      disconnect?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx-lineage proxies (and is honoured through the Traefik hop)
      // never to buffer this response — SSE dies buffered.
      "X-Accel-Buffering": "no",
    },
  });
}
