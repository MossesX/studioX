/**
 * @file `/api/claude/conversations/<id>/send` — run one turn, stream it back.
 *
 *   POST { text, timeoutS? } → application/x-ndjson, one ClaudeSessionEvent
 *                              per line, ending in exactly one terminal
 *                              (`turn-done` / `turn-error` / `turn-cancelled`)
 *
 * The transport's own `ndjsonStream` is reused rather than re-plumbed: it
 * already carries the abort wiring that makes a closed connection KILL the CLI
 * child instead of merely dropping the reader, and a second stream helper
 * would be a second place for that to be got wrong. What differs from
 * `/api/claude` is the level — that route streams the raw CLI vocabulary for
 * one anonymous turn; this one streams the SERVICE vocabulary for a persisted
 * conversation, so every event is stamped with its conversation and turn and
 * the transcript is on disk when the terminal lands.
 *
 * A client closing the connection does NOT cancel the turn. That is deliberate
 * and is the difference persistence buys: the turn keeps running, keeps
 * streaming to every other observer and still persists its answer, and the
 * client re-attaches with `GET .../stream`. Cancelling is an explicit act with
 * its own route, because "my tab closed" and "stop spending money" are
 * different intentions.
 */
import { ndjsonStream } from "../../../../../../src/server/claudeBroker";
import { claudeServiceFor } from "../../../../../../src/claude/service";
import { registerServerPlugins } from "../../../../../../src/server/plugins";

export const dynamic = "force-dynamic";
/** The broker's own ceiling is 3600s; Next needs telling separately or it cuts
 *  the response out from under a long agentic turn. */
export const maxDuration = 3600;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { text?: unknown; timeoutS?: unknown };
  try {
    body = (await request.json()) as { text?: unknown; timeoutS?: unknown };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ error: "text must be a non-empty string" }, { status: 400 });
  }
  const text = body.text;
  const timeoutS = typeof body.timeoutS === "number" ? body.timeoutS : undefined;

  // The server-side plugin contributions, before the turn that reads them
  // (`axf-claude` P5). Idempotent and cheap; it is HERE rather than in the
  // service because the subsystem must not import its own plugins, and here
  // rather than in `instrumentation.ts` because that runs in a different module
  // graph and would contribute into a different registry. `src/server/plugins.ts`
  // argues both, and `test/registry-scoping.test.ts` fails a turn-starting route
  // that omits this line.
  registerServerPlugins();

  // `send()` is awaited BEFORE the stream opens so a refusal — no such
  // conversation, a turn already running — is a 4xx with a message rather than
  // a 200 whose first line is an error nobody checks for.
  let handle;
  try {
    handle = await claudeServiceFor(request).send(id, text, { timeoutS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: /does not exist/.test(message) ? 404 : 409 });
  }

  const turn = handle;
  return ndjsonStream(async (emit) => {
    for await (const event of turn.events) emit(event as unknown as Record<string, unknown>);
  }, request.signal);
}
