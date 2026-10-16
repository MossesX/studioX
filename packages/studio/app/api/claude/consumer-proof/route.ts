/**
 * @file THE THROWAWAY CONSUMER — `axf-claude` P1 step 2, and nothing more.
 *
 * The Build Manager plugin's precondition, tested before that plugin exists:
 * something that is NOT the subsystem's own UI drives a conversation end to
 * end through the PUBLIC API — starts it, streams the reply, observes session
 * events — without touching subsystem internals. The step's own reasoning is
 * why it is here rather than later: *"retrofitting a consumer API after the
 * first consumer arrives is how it ends up shaped for one caller."* This route
 * is the second caller, arriving first.
 *
 * **The import list IS the proof, and it is the grep target.** Three imports:
 * `src/claude/service` (the public API), `src/claude/points` + `src/claude/types`
 * (the declared contract), and the `@axf/core` barrel. No `./store`, no
 * `claudeBroker`, no `claudeEvents`, no reaching around the front door — if
 * this route cannot do the job through it, the front door is decoration.
 * `test/claude-subsystem.test.ts` asserts that list against the file on disk,
 * so an import added here in a hurry goes red rather than quietly voiding the
 * proof.
 *
 *   GET /api/claude/consumer-proof            → JSON report (two real CLI turns)
 *   GET /api/claude/consumer-proof?model=…    → same, on another catalog model
 *
 * What it proves, each reported as a named check:
 *   1. `start()` creates a persisted conversation.
 *   2. `send()` runs a real turn, and the reply is assembled from OBSERVED
 *      events (`observe()`), not from the send handle — observation is the
 *      claim under test.
 *   3. `stream()` attached BEFORE the second `send()` — the re-attach path a
 *      monitoring consumer uses — sees that turn whole and ends by itself.
 *   4. A `claude.session-observer` CONTRIBUTION, registered through the
 *      registry exactly the way a plugin would, sees the same events.
 *   5. A second turn resumes the SAME CLI session: `turn-started.resume` is
 *      true and the session id is unchanged — `--resume` demonstrably works
 *      without this route ever seeing a command line.
 *   6. `resume()` reads the record back off disk with both turns on it.
 *
 * `cancel()` is deliberately NOT exercised here: proving it needs a turn long
 * enough to interrupt, which makes a live route slow and flaky. It is held by
 * `test/claude-subsystem.test.ts` against a transport that hangs until its
 * abort hook fires — the shape of a real child that only dies when killed.
 *
 * Throwaway means throwaway: when the Build Manager plugin lands and passes
 * the same checks through the same API, this file is DELETED, not grown.
 */
import { registry } from "@axf/core";

import { CLAUDE_SESSION_OBSERVER_POINT } from "../../../../src/claude/points";
import { claudeService } from "../../../../src/claude/service";
import { assistantTextOf, type ClaudeSessionEvent } from "../../../../src/claude/types";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/** Events seen by the POINT contribution — a plugin's channel — kept across
 *  requests in this process. Contributed ONCE: the registry has no
 *  un-contribute, and re-contributing per request would double-deliver. */
function pointChannel(): ClaudeSessionEvent[] {
  const g = globalThis as { __axsClaudeConsumerProof?: ClaudeSessionEvent[] };
  if (!g.__axsClaudeConsumerProof) {
    const seen: ClaudeSessionEvent[] = [];
    g.__axsClaudeConsumerProof = seen;
    claudeService(); // constructing the service is what declares the points
    registry.contribute({
      from: "claude-consumer-proof",
      point: CLAUDE_SESSION_OBSERVER_POINT,
      payload: {
        id: "consumer-proof",
        onEvent: (event: ClaudeSessionEvent) => {
          seen.push(event);
        }
      }
    });
  }
  return g.__axsClaudeConsumerProof;
}

export async function GET(request: Request): Promise<Response> {
  // Deliberately the DEFAULT ("local") service: this is the subsystem's own
  // proof harness, not a user surface, and the consumer contract pins this
  // file's imports to the public API alone — no `axfKv`, no `kvUser`.
  const service = claudeService();
  const pointEvents = pointChannel();
  const model = new URL(request.url).searchParams.get("model") ?? undefined;

  // Observation channel 1: the dynamic observer — everything for our
  // conversation, collected the way a monitoring consumer would.
  const observed: ClaudeSessionEvent[] = [];
  let conversationId = "";
  const unobserve = service.observe((event) => {
    if (event.conversationId === conversationId) observed.push(event);
  });

  try {
    // The prompts are plain arithmetic on purpose. A pre-strip draft asked the
    // model to echo marker strings and it REFUSED — "reply with exactly" plus
    // a wiring-proof system prompt reads as an injection test. Arithmetic is an
    // honest task with a deterministic answer, and the second question
    // DEPENDING on the first is a stronger resume proof than any echo: it only
    // comes back right if --resume really carried the history.
    const started = await service.start({
      title: "consumer proof (throwaway)",
      model,
      system: "Answer arithmetic questions with the number only — no words, no punctuation."
    });
    conversationId = started.id;

    const forTurn = (turnId: string) => observed.filter((e) => "turnId" in e && e.turnId === turnId);
    const doneOf = (turnId: string) =>
      forTurn(turnId).find((e) => e.type === "turn-done") as
        | Extract<ClaudeSessionEvent, { type: "turn-done" }>
        | undefined;
    const startedOf = (turnId: string) =>
      forTurn(turnId).find((e) => e.type === "turn-started") as
        | Extract<ClaudeSessionEvent, { type: "turn-started" }>
        | undefined;
    /** The answer as the OBSERVER saw it: the terminal's text, or the deltas
     *  it streamed — so a partial failure still reports what arrived. */
    const textOf = (turnId: string) => doneOf(turnId)?.text || assistantTextOf(forTurn(turnId));

    /* -- turn one: a fresh session ------------------------------------------ */
    const first = await service.send(conversationId, "What is 2 + 3?");
    const firstResult = await first.done;

    /* -- turn two: attach FIRST, then send ---------------------------------- */
    // Observation channel 2: `stream()` subscribed before the turn exists —
    // the re-attach path. It ends at the terminal on its own; if it did not,
    // the await below would hang, which IS the assertion.
    const attached: ClaudeSessionEvent[] = [];
    const attachment = (async () => {
      for await (const event of service.stream(conversationId)) attached.push(event);
    })();

    const second = await service.send(conversationId, "Add 10 to your previous answer.");
    const secondResult = await second.done;
    await attachment;

    const record = await service.resume(conversationId);
    const pointSeen = pointEvents.filter((e) => e.conversationId === conversationId);

    const checks = {
      "start() persisted a conversation": record.id === conversationId,
      "first turn answered, seen through observe()": /\b5\b/.test(textOf(first.turnId)),
      "second turn remembered the first across --resume": /\b15\b/.test(textOf(second.turnId)),
      "first turn was fresh (no --resume)": startedOf(first.turnId)?.resume === false,
      "second turn resumed the CLI session": startedOf(second.turnId)?.resume === true,
      "one CLI session across both turns":
        Boolean(firstResult.cliSessionId) && firstResult.cliSessionId === secondResult.cliSessionId,
      "the record on disk carries the CLI session id":
        Boolean(record.cliSessionId) && record.cliSessionId === firstResult.cliSessionId,
      "the record on disk carries all four messages": record.messages.length === 4,
      "stream() attached before send() saw the turn and ended":
        attached.at(-1)?.type === "turn-done" &&
        attached.some((e) => e.type === "cli" && e.event.type === "delta"),
      "the claude.session-observer point saw the turns":
        pointSeen.filter((e) => e.type === "turn-done").length === 2,
      "no registry violations from the contribution": !registry
        .violations()
        .some((v) => v.from === "claude-consumer-proof")
    };

    return Response.json({
      ok: Object.values(checks).every(Boolean),
      conversationId,
      cliSessionId: record.cliSessionId ?? null,
      model: record.model,
      totalCostUsd: record.totalCostUsd,
      checks,
      // The CLI vocabulary this run actually exercised — useful when a check
      // fails, and evidence that the `cli` envelope carries the real thing.
      cliEventKinds: [
        ...new Set(observed.filter((e) => e.type === "cli").map((e) => e.event.type))
      ].sort(),
      observedEventCount: observed.length,
      attachedEventCount: attached.length,
      pointObserverEventCount: pointSeen.length
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), conversationId },
      { status: 500 }
    );
  } finally {
    unobserve();
  }
}
