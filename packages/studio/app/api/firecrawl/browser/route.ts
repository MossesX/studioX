/**
 * @file `/api/firecrawl/browser` — the live browser's HTTP face.
 *
 *   GET  ?session=<id> → NDJSON stream of `BrowserEvent`s (frames, navs,
 *                        actions, recording state) while the viewer watches.
 *                        A client disconnect detaches the viewer; the frame
 *                        pump stops when the last viewer leaves.
 *   POST { op, … }     → one `BrowserOpRequest` op: open / act /
 *                        record-start / record-pause / record-resume /
 *                        record-stop / extract-links / replay / close.
 *
 * The transport is the module's house idiom — NDJSON over fetch, the run
 * route's exact shape — because the client already knows how to walk it.
 * Sessions are server-side Playwright pages (`browser.server.ts`); this
 * route never holds state of its own.
 */
import {
  act,
  attachViewer,
  closeSession,
  extractLinks,
  getSession,
  openSession,
  pauseRecording,
  replayActions,
  startRecording,
  stopRecording
} from "@axs/modules/firecrawl/browser.server";
import type { BrowserEvent, BrowserOpRequest } from "@axs/modules/firecrawl/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get("session")?.trim();
  if (!sessionId) {
    return Response.json({ error: "?session=<id> is required" }, { status: 400 });
  }
  const session = await openSession(sessionId);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: BrowserEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Stream closed under us — the abort listener detaches.
        }
      };
      const detach = attachViewer(session, emit);
      request.signal.addEventListener("abort", () => {
        detach();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    }
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" }
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: BrowserOpRequest;
  try {
    body = (await request.json()) as BrowserOpRequest;
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }

  try {
    if (body.op === "open") {
      const id = body.sessionId?.trim() || `bs_${Date.now().toString(36)}`;
      const session = await openSession(id);
      if (body.url?.trim()) {
        await act(session, { kind: "goto", url: body.url });
      }
      return Response.json({ ok: true, sessionId: session.id, url: session.page.url() });
    }

    const session = body.sessionId ? getSession(body.sessionId) : null;
    if (!session) {
      return Response.json({ error: "unknown or closed session" }, { status: 404 });
    }

    switch (body.op) {
      case "act": {
        if (!body.action) return Response.json({ error: "op act needs an action" }, { status: 400 });
        const enriched = await act(session, body.action);
        return Response.json({ ok: true, action: enriched, url: session.page.url() });
      }
      case "record-start":
        startRecording(session);
        return Response.json({ ok: true });
      case "record-pause":
        pauseRecording(session, true);
        return Response.json({ ok: true });
      case "record-resume":
        pauseRecording(session, false);
        return Response.json({ ok: true });
      case "record-stop": {
        const { startUrl, actions } = stopRecording(session);
        return Response.json({ ok: true, startUrl, actions });
      }
      case "extract-links": {
        const urls = await extractLinks(session, {
          selector: body.selector ?? "",
          filter: body.filter ?? "",
          delayMs: Math.max(0, Math.min(body.delayMs ?? 0, 3000)),
          highlight: true,
          signal: request.signal
        });
        return Response.json({ ok: true, urls });
      }
      case "replay": {
        if (!Array.isArray(body.actions) || body.actions.length === 0) {
          return Response.json({ error: "op replay needs actions[]" }, { status: 400 });
        }
        await replayActions(session, body.url?.trim() ?? "", body.actions, {
          delayMs: typeof body.delayMs === "number" ? Math.max(0, Math.min(body.delayMs, 10000)) : null,
          signal: request.signal
        });
        return Response.json({ ok: true, url: session.page.url() });
      }
      case "close":
        await closeSession(session.id);
        return Response.json({ ok: true });
      default:
        return Response.json({ error: `unknown op` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
