/**
 * @file `/api/claude/conversations/<id>/stream` — attach to a live turn.
 *
 *   GET → application/x-ndjson, the same ClaudeSessionEvent lines `send`
 *         streams, ending after one terminal event
 *
 * This is the re-attach path, and it is what makes a dropped connection
 * survivable: `stream()` replays the active turn's buffer first (deduped by
 * sequence, so nothing is missed or doubled) and then follows it live. A
 * client that reloads mid-answer gets the whole answer, not the tail.
 *
 * It is also the observation channel for a consumer that did not start the
 * turn — a monitoring plugin watching a build it triggered elsewhere. That is
 * the same guarantee `observe()` and the `claude.session-observer` point give
 * in-process: an observer cannot be told less than the caller.
 *
 * Attaching to a conversation with no live turn is not an error — the stream
 * simply waits for the next one, which is what a lobby that opened first
 * needs. A client that wants "is anything running?" asks the record, not this.
 */
import { ndjsonStream } from "../../../../../../src/server/claudeBroker";
import { claudeServiceFor } from "../../../../../../src/claude/service";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const service = claudeServiceFor(request);
  try {
    if (!(await service.get(id))) {
      return Response.json({ error: `no conversation "${id}"` }, { status: 404 });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  return ndjsonStream(async (emit) => {
    for await (const event of service.stream(id)) {
      emit(event as unknown as Record<string, unknown>);
    }
  }, request.signal);
}
