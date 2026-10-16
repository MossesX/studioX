/**
 * @file `/api/firecrawl/control` — steer a live run.
 *
 * POST `{ runId, op, value? }` → pause / resume / stop / speed. The run's
 * NDJSON stream is one-way, so the transport for "slow down" and "pause" is
 * this second, tiny channel addressing the run by the id the CLIENT chose
 * (`RunRequest.runId`) — chosen client-side precisely so a control can land
 * before the stream's first event has arrived.
 *
 * `stop` aborts the control's own AbortController, which the run route merged
 * into the engine's signal with `AbortSignal.any` — one abort path, whether
 * the run dies by disconnect or by button.
 */
import { controlRun } from "@axs/modules/firecrawl/browser.server";
import type { RunControlRequest } from "@axs/modules/firecrawl/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: RunControlRequest;
  try {
    body = (await request.json()) as RunControlRequest;
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const op = body.op;
  if (!runId || !["pause", "resume", "stop", "speed"].includes(op)) {
    return Response.json({ error: "body must carry runId and op (pause|resume|stop|speed)" }, { status: 400 });
  }
  const known = controlRun(runId, op, typeof body.value === "number" ? body.value : undefined);
  if (!known) {
    return Response.json({ error: "unknown run — it may have already finished" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
