/**
 * @file `/api/firecrawl/run` — one POST, an NDJSON stream of `RunEvent`s back.
 *
 * The workflow rides the request whole (so an unsaved builder draft runs
 * exactly as drafted), the engine walks it server-side, and every event goes
 * out as one JSON line — the assistant chat route's transport, because the
 * client-side reader already knows how to walk it. A closed client aborts the
 * engine through the request signal: a dismissed run stops scraping AND stops
 * the analyze step's provider call, which is billing, not tidiness.
 *
 * `analyzeBudget` rides the request from the client's settings because module
 * settings live in the CLIENT's kv view and this route should not guess —
 * clamped here all the same, because a request field is a claim, not a law.
 */
import { registerRun, unregisterRun } from "@axs/modules/firecrawl/browser.server";
import { runWorkflow } from "@axs/modules/firecrawl/engine.server";
import { kvUser } from "@axs/server/axfKv";
import type { LinkList, Recording, RunEvent, RunRequest, Workflow } from "@axs/modules/firecrawl/types";

export const dynamic = "force-dynamic";

const MAX_STEPS = 20;

export async function POST(request: Request): Promise<Response> {
  let body: RunRequest & { analyzeBudget?: unknown };
  try {
    body = (await request.json()) as RunRequest & { analyzeBudget?: unknown };
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  const workflow = body.workflow as Workflow | undefined;
  if (!workflow || !Array.isArray(workflow.steps)) {
    return Response.json({ error: "body.workflow must carry steps[]" }, { status: 400 });
  }
  if (workflow.steps.length === 0) {
    return Response.json({ error: "the workflow has no steps" }, { status: 400 });
  }
  if (workflow.steps.length > MAX_STEPS) {
    return Response.json({ error: `at most ${MAX_STEPS} steps per workflow` }, { status: 400 });
  }
  const analyzeBudget = Math.max(
    2000,
    Math.min(120000, typeof body.analyzeBudget === "number" ? body.analyzeBudget : 24000)
  );
  const runId = typeof body.runId === "string" && body.runId.trim() ? body.runId.trim() : undefined;
  const startAt = typeof body.startAt === "number" ? Math.max(0, Math.floor(body.startAt)) : 0;
  const stepDelayMs =
    typeof body.stepDelayMs === "number" ? Math.max(0, Math.min(body.stepDelayMs, 10000)) : 0;
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : undefined;
  const lists = Array.isArray(body.lists) ? (body.lists as LinkList[]) : [];
  const recordings = Array.isArray(body.recordings) ? (body.recordings as Recording[]) : [];

  // The pause/speed/stop control registers under the CLIENT's run id before
  // the first event goes out, and its stop is one more abort source merged
  // into the engine's signal — disconnect and Stop share one path.
  const control = runId ? registerRun(runId, stepDelayMs) : null;
  const signal = control ? AbortSignal.any([request.signal, control.controller.signal]) : request.signal;

  const encoder = new TextEncoder();
  const user = kvUser(request);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: RunEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Stream already closed by a client disconnect; the engine's own
          // signal check ends the walk.
        }
      };
      try {
        await runWorkflow(workflow, {
          user,
          signal,
          emit,
          analyzeBudget,
          runId,
          startAt,
          sessionId,
          lists,
          recordings
        });
      } finally {
        if (runId) unregisterRun(runId);
      }
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    }
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" }
  });
}
