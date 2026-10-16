/**
 * The Claude subsystem's contract, held without spawning a CLI: the transport
 * is injected (`ClaudeTransport` is the seam), so these tests script the
 * broker's event vocabulary and assert what the SERVICE does with it —
 * persistence, resume, fan-out, cancellation. The real CLI end of the path is
 * proven live by `/api/claude/consumer-proof` on :3200, which is the honest
 * split: unit tests must not depend on a subscription being logged in, and a
 * live proof must not be the only thing holding the event plumbing.
 *
 * The scripted events below are the REAL vocabulary — `src/server/claudeEvents.ts`'s
 * `BrokerEvent` shapes, `agentId` and all — not a convenient simplification.
 * `test/claude-events.test.ts` pins that vocabulary to captured fixtures, so a
 * CLI change breaks there rather than silently making these tests describe a
 * stream nothing produces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Registry } from "@axf/core";

import { CLAUDE } from "@axs/claude/claude.subsystem";
import {
  CLAUDE_CONTEXT_PROVIDER_POINT,
  CLAUDE_POINTS,
  CLAUDE_SESSION_OBSERVER_POINT,
  declareClaudePoints
} from "@axs/claude/points";
import { ClaudeService, type ClaudeTransport } from "@axs/claude/service";
import { ConversationStore } from "@axs/claude/store";
import { assistantTextOf, isTerminalEvent, type ClaudeSessionEvent } from "@axs/claude/types";
import type { BrokerChatParams } from "@axs/server/claudeBroker";

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "axs-claude-test-"));

const SESSION = "11111111-2222-4333-8444-555555555555";

/** A transport that records its params and replays a scripted broker stream. */
function scripted(
  calls: BrokerChatParams[],
  script: (p: BrokerChatParams) => Record<string, unknown>[]
): ClaudeTransport {
  return async (p, emit) => {
    calls.push(p);
    for (const event of script(p)) emit(event);
  };
}

/** One successful turn, in the transport's real vocabulary. */
const okTurn = (text: string) => (p: BrokerChatParams) => [
  { type: "session", sessionId: p.sessionId ?? SESSION, model: p.model, cwd: p.cwd, tools: [] },
  { type: "delta", text: text.slice(0, 3), agentId: null },
  { type: "delta", text: text.slice(3), agentId: null },
  // A subagent's prose, interleaved — it must NOT count as the answer.
  { type: "delta", text: "(subagent chatter)", agentId: "toolu_deadbeef" },
  {
    type: "done",
    text,
    sessionId: p.sessionId ?? SESSION,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0
    },
    costUsd: 0.01
  }
];

function makeService(root: string, transport: ClaudeTransport, points = new Registry()) {
  return {
    service: new ClaudeService({ store: new ConversationStore(root), transport, points }),
    points
  };
}

// ---------------------------------------------------------------------------
// The store: survives a "restart" (a fresh instance over the same directory)
// ---------------------------------------------------------------------------
test("a conversation written by one store instance is read whole by a fresh one", async () => {
  const root = tmpRoot();
  const first = new ConversationStore(root);
  const created = await first.create({
    title: "restart survival",
    cwd: root,
    model: "opus-5",
    effort: "high",
    permissionMode: "default",
    system: "sys"
  });
  await first.mutate(created.id, (r) => ({
    ...r,
    cliSessionId: SESSION,
    messages: [...r.messages, { role: "user", text: "hello", at: new Date().toISOString() }]
  }));

  // A brand-new instance — nothing in memory, only the files on disk.
  const second = new ConversationStore(root);
  const loaded = await second.load(created.id);
  assert.ok(loaded, "the record did not survive");
  assert.equal(loaded.cliSessionId, SESSION);
  assert.equal(loaded.messages.length, 1);
  assert.equal(loaded.effort, "high");
  assert.equal(loaded.permissionMode, "default");
  const listed = await second.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].messageCount, 1);
});

test("the store refuses anything that is not a conversation id", async () => {
  const store = new ConversationStore(tmpRoot());
  await assert.rejects(() => store.load("../../etc/passwd"), /not a conversation id/);
  await assert.rejects(() => store.mutate("not-an-id", (r) => r), /not a conversation id/);
  // A well-formed id that does not exist reads as absent, and MUTATING it is a
  // rejection rather than a silent create — different answers, deliberately.
  assert.equal(await store.load("22222222-3333-4444-8555-666666666666"), null);
  await assert.rejects(
    () => store.mutate("22222222-3333-4444-8555-666666666666", (r) => r),
    /does not exist/
  );
});

// ---------------------------------------------------------------------------
// The points: declared as data, idempotently
// ---------------------------------------------------------------------------
test("declareClaudePoints is idempotent and declares all three points", () => {
  const reg = new Registry();
  declareClaudePoints(reg);
  declareClaudePoints(reg); // a second declaration must not throw
  assert.deepEqual(
    reg.points().map((p) => p.id).sort(),
    ["claude.context-provider", "claude.session-observer", "claude.tool"]
  );
  assert.equal(CLAUDE_POINTS.length, 3);
});

test("the subsystem is well-formed and its start() can run twice", () => {
  assert.equal(CLAUDE.id, "claude");
  assert.equal(CLAUDE.layer, "sdk");
  assert.equal(CLAUDE.points?.length, 3);
  // start() declares into the process-wide registry; a second run is the
  // both-runtimes / dev-refresh case and must be a no-op, not a throw.
  CLAUDE.start?.();
  CLAUDE.start?.();
});

// ---------------------------------------------------------------------------
// The service: one turn, end to end, against a scripted transport
// ---------------------------------------------------------------------------
test("send() streams the turn and persists the result; a second send resumes", async () => {
  const root = tmpRoot();
  const calls: BrokerChatParams[] = [];
  const { service } = makeService(root, scripted(calls, okTurn("OK-ONE")));

  const conversation = await service.start({ title: "t", model: "opus-5" });
  const handle = await service.send(conversation.id, "first question");
  const events: ClaudeSessionEvent[] = [];
  for await (const event of handle.events) events.push(event);

  assert.deepEqual(
    events.map((e) => e.type),
    ["turn-started", "session", "cli", "cli", "cli", "cli", "turn-done"]
  );
  assert.equal(events[0].type === "turn-started" && events[0].resume, false);
  // The CLI vocabulary reaches the consumer verbatim, inside the envelope.
  assert.deepEqual(
    events.filter((e) => e.type === "cli").map((e) => (e as { event: { type: string } }).event.type),
    ["session", "delta", "delta", "delta"]
  );
  // ...and the subagent's prose is not the answer.
  assert.equal(assistantTextOf(events), "OK-ONE");

  const result = await handle.done;
  assert.equal(result.ok, true);
  assert.equal(result.text, "OK-ONE");
  assert.equal(result.cliSessionId, SESSION);

  // Persisted: both messages, the session id, the cost — readable by a FRESH
  // store instance, which is the restart claim at the service level.
  const reloaded = await new ConversationStore(root).load(conversation.id);
  assert.ok(reloaded);
  assert.equal(reloaded.cliSessionId, SESSION);
  assert.equal(reloaded.messages.length, 2);
  assert.equal(reloaded.messages[1].role, "assistant");
  assert.equal(reloaded.messages[1].text, "OK-ONE");
  assert.equal(reloaded.totalCostUsd, 0.01);

  // Turn two: the stored session id must reach the transport as `sessionId` —
  // that is what puts --resume on the real command line — and the event must
  // say so. The model reaches it as the CLI ID, not the stored slug.
  const second = await service.send(conversation.id, "second question");
  const secondEvents: ClaudeSessionEvent[] = [];
  for await (const event of second.events) secondEvents.push(event);
  assert.equal(secondEvents[0].type === "turn-started" && secondEvents[0].resume, true);
  await second.done;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sessionId, undefined);
  assert.equal(calls[1].sessionId, SESSION);
  assert.equal(calls[0].model, "claude-opus-5");
});

test("an unknown model is refused at start(), never silently defaulted", async () => {
  const { service } = makeService(tmpRoot(), scripted([], okTurn("X")));
  await assert.rejects(() => service.start({ model: "opus-6" }), /unknown model "opus-6"/);
  // The default tier is still reachable by omitting it entirely.
  const conversation = await service.start({});
  assert.equal(conversation.model, "sonnet-5");
});

test("effort is null unless asked for — the CLI's own default is not overridden", async () => {
  const root = tmpRoot();
  const calls: BrokerChatParams[] = [];
  const { service } = makeService(root, scripted(calls, okTurn("E")));

  const plain = await service.start({});
  assert.equal(plain.effort, null);
  await (await service.send(plain.id, "go")).done;
  assert.equal(calls[0].effort, undefined, "--effort must not be passed when none was chosen");

  const deep = await service.start({ effort: "max" });
  assert.equal(deep.effort, "max");
  await (await service.send(deep.id, "go")).done;
  assert.equal(calls[1].effort, "max");

  await assert.rejects(() => service.start({ effort: "colossal" }), /unknown effort/);
});

test("stream() attached before send() sees the whole turn and then ends", async () => {
  const root = tmpRoot();
  const { service } = makeService(root, scripted([], okTurn("STREAMED")));
  const conversation = await service.start({});

  const seen: ClaudeSessionEvent[] = [];
  const attached = (async () => {
    for await (const event of service.stream(conversation.id)) seen.push(event);
  })();

  const handle = await service.send(conversation.id, "go");
  await handle.done;
  await attached; // ends at the terminal event, or this test hangs — that IS the assertion
  assert.equal(seen.at(-1)?.type, "turn-done");
  assert.ok(seen.some((e) => e.type === "cli" && e.event.type === "delta"));
});

test("observers — dynamic and point-contributed — see the same events", async () => {
  const root = tmpRoot();
  const points = new Registry();
  const { service } = makeService(root, scripted([], okTurn("OBSERVED")), points);

  const viaObserve: string[] = [];
  const unobserve = service.observe((e) => viaObserve.push(e.type));
  const viaPoint: string[] = [];
  points.contribute({
    from: "test-observer",
    point: CLAUDE_SESSION_OBSERVER_POINT,
    payload: { id: "test-observer", onEvent: (e: ClaudeSessionEvent) => viaPoint.push(e.type) }
  });
  assert.equal(points.violations().length, 0, "the observer contribution was refused");

  const conversation = await service.start({});
  const handle = await service.send(conversation.id, "watch this");
  await handle.done;
  unobserve();

  assert.ok(viaPoint.includes("turn-started") && viaPoint.includes("turn-done"));
  // The dynamic observer drains through a microtask queue; give it one tick,
  // then both channels must have seen the identical sequence — an observer
  // cannot be told less than the caller.
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(viaObserve, viaPoint);
});

test("an observer that throws is skipped, not allowed to break the turn", async () => {
  const root = tmpRoot();
  const points = new Registry();
  const { service } = makeService(root, scripted([], okTurn("SURVIVED")), points);
  points.contribute({
    from: "bad-observer",
    point: CLAUDE_SESSION_OBSERVER_POINT,
    payload: {
      id: "bad-observer",
      onEvent: () => {
        throw new Error("this observer is broken");
      }
    }
  });

  const conversation = await service.start({});
  const result = await (await service.send(conversation.id, "go")).done;
  assert.equal(result.ok, true);
  assert.equal(result.text, "SURVIVED");
});

test("context providers reach the transport's system contract on the first turn only", async () => {
  const root = tmpRoot();
  const calls: BrokerChatParams[] = [];
  const points = new Registry();
  const { service } = makeService(root, scripted(calls, okTurn("CTX")), points);
  points.contribute({
    from: "test-provider",
    point: CLAUDE_CONTEXT_PROVIDER_POINT,
    payload: { id: "test-provider", provide: () => "INJECTED-CONTEXT" }
  });

  const conversation = await service.start({ system: "BASE" });
  await (await service.send(conversation.id, "one")).done;
  await (await service.send(conversation.id, "two")).done;

  assert.match(calls[0].system, /BASE/);
  assert.match(calls[0].system, /INJECTED-CONTEXT/);
  // The resumed turn carries the session; the broker ignores `system` there and
  // the service does not re-run providers against a session that has history.
  assert.equal(calls[1].system, "BASE");
});

test("cancel() kills the transport and the turn ends turn-cancelled", async () => {
  const root = tmpRoot();
  // A transport that hangs until its abort hook fires — the shape of a real
  // child process that only dies when killed.
  const hanging: ClaudeTransport = (_p, emit, onAbort) =>
    new Promise((resolve) => {
      onAbort(() => {
        emit({ type: "error", message: "claude exited with code 1: killed" });
        resolve();
      });
    });
  const { service } = makeService(root, hanging);
  const conversation = await service.start({});
  const handle = await service.send(conversation.id, "never finishes");

  assert.equal(service.activeTurn(conversation.id), handle.turnId);
  assert.equal(service.cancel(conversation.id), true);
  const result = await handle.done;
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, false);

  const events: ClaudeSessionEvent[] = [];
  for await (const event of handle.events) events.push(event);
  const terminal = events.filter(isTerminalEvent);
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].type, "turn-cancelled");
  assert.equal(service.cancel(conversation.id), false, "nothing left to cancel");

  // The question survives the cancellation — it was persisted before the CLI
  // ran, which is the whole reason that ordering was chosen.
  const reloaded = await new ConversationStore(root).load(conversation.id);
  assert.equal(reloaded?.messages.length, 1);
  assert.equal(reloaded?.messages[0].role, "user");
});

test("a second send() while a turn is live is refused", async () => {
  const root = tmpRoot();
  let release!: () => void;
  const gated: ClaudeTransport = (_p, emit) =>
    new Promise((resolve) => {
      release = () => {
        emit({ type: "done", text: "late" });
        resolve();
      };
    });
  const { service } = makeService(root, gated);
  const conversation = await service.start({});
  const handle = await service.send(conversation.id, "long turn");
  await assert.rejects(() => service.send(conversation.id, "impatient"), /already has a turn running/);
  release();
  await handle.done;
});

test("send() to a conversation that does not exist is refused", async () => {
  const { service } = makeService(tmpRoot(), scripted([], okTurn("X")));
  await assert.rejects(
    () => service.send("22222222-3333-4444-8555-666666666666", "hello"),
    /does not exist/
  );
});

// ---------------------------------------------------------------------------
// The consumer proof's own contract: it must go through the front door
// ---------------------------------------------------------------------------
test("the consumer-proof route touches no subsystem internals", () => {
  const file = path.resolve(
    import.meta.dirname,
    "..",
    "app",
    "api",
    "claude",
    "consumer-proof",
    "route.ts"
  );
  const source = fs.readFileSync(file, "utf8");
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";$/gm)].map((m) => m[1]);

  assert.deepEqual(imports.sort(), [
    "../../../../src/claude/points",
    "../../../../src/claude/service",
    "../../../../src/claude/types",
    "@axf/core"
  ]);
  // Named individually so a failure says WHICH back door was opened — the
  // deep-equal above already fails, but not legibly.
  for (const forbidden of ["claude/store", "claudeBroker", "claudeEvents", "axfKv"]) {
    assert.ok(
      !imports.some((i) => i.includes(forbidden)),
      `the consumer proof reached past the service API into "${forbidden}"`
    );
  }
});

// ---------------------------------------------------------------------------
// The LIBRARY verbs (P3) — rename, pin, delete, search
//
// On the SERVICE rather than in the workspace module, because nothing outside
// `src/claude/` may reach `./store` and a module that owned rename would have
// had to. These hold the rules the routes deliberately do not restate.
// ---------------------------------------------------------------------------
test("rename refuses an empty title rather than inventing one", async () => {
  const { service } = makeService(tmpRoot(), scripted([], okTurn("hi")));
  const started = await service.start({ title: "Original" });

  const renamed = await service.rename(started.id, "  A better name  ");
  assert.equal(renamed.title, "A better name", "the title was not trimmed");

  for (const bad of ["", "   "]) {
    await assert.rejects(
      () => service.rename(started.id, bad),
      /cannot be empty/,
      "an empty rename was accepted, silently losing the user's edit"
    );
  }
  await assert.rejects(() => service.rename(started.id, "x".repeat(201)), /cannot exceed/);

  // The refusals left the record alone.
  assert.equal((await service.get(started.id))?.title, "A better name");
});

test("pinning is idempotent, and an unpinned record reads as unpinned", async () => {
  const { service } = makeService(tmpRoot(), scripted([], okTurn("hi")));
  const started = await service.start({});
  // Never written: `pinned` is optional so every pre-P3 record reads correctly
  // without a migration, which is why the format tag was NOT bumped for it.
  assert.equal(started.pinned, undefined);
  assert.equal((await service.list())[0]?.pinned, false, "an absent flag did not read as unpinned");

  assert.equal((await service.setPinned(started.id, true)).pinned, true);
  // Twice, because the affordance is a toggle and a double click must not fail.
  assert.equal((await service.setPinned(started.id, true)).pinned, true);
  assert.equal((await service.setPinned(started.id, false)).pinned, false);
});

test("delete is refused while a turn is live, and idempotent otherwise", async () => {
  // A transport that hangs, so the turn is genuinely still running.
  let release: (() => void) | null = null;
  const hanging: ClaudeTransport = async (_p, emit, onAbort) => {
    onAbort(() => {
      emit({ type: "error", message: "killed" });
      release?.();
    });
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const { service } = makeService(tmpRoot(), hanging);
  const started = await service.start({});
  const handle = await service.send(started.id, "go");

  await assert.rejects(
    () => service.remove(started.id),
    /has a turn running/,
    "a live turn's record was deleted out from under it — the CLI keeps running with nowhere to persist"
  );

  service.cancel(started.id);
  await handle.done;

  assert.equal(await service.remove(started.id), true);
  // Deleting the deleted is an ANSWER, not a failure: a double click on a row
  // that is already gone must not produce an error.
  assert.equal(await service.remove(started.id), false);
  assert.equal(await service.get(started.id), null);
});

test("search is AND-within-one-message, over bodies, ordered pinned-then-recent", async () => {
  const root = tmpRoot();
  const { service } = makeService(root, scripted([], okTurn("the lazy dog sleeps")));

  const a = await service.start({ title: "Alpha" });
  await (await service.send(a.id, "the quick brown fox")).done;
  const b = await service.start({ title: "Beta" });
  await (await service.send(b.id, "nothing relevant here")).done;

  const hits = await service.search("quick fox");
  assert.equal(hits.length, 1, "both terms are in one message and it did not match exactly once");
  assert.equal(hits[0]?.meta.id, a.id);
  assert.ok(hits[0]!.matches[0]!.ranges.length >= 2, "the excerpt carries no highlight ranges");

  // The assistant's own text is searched too — "message bodies", both roles.
  assert.equal((await service.search("lazy dog")).length, 2);

  // Terms spread across two different messages must not match.
  assert.equal((await service.search("quick nothing")).length, 0);

  // A title-only hit is still a hit, and says so.
  const byTitle = await service.search("Beta");
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0]?.titleMatched, true);
  assert.equal(byTitle[0]?.matchCount, 0);

  // An empty query returns NOTHING rather than everything — "show me all" is
  // list(), and conflating them makes a cleared search box dump the corpus.
  assert.deepEqual(await service.search("   "), []);

  // Pinned leads, whatever the timestamps say.
  await service.setPinned(b.id, true);
  const both = await service.search("the");
  assert.equal(both[0]?.meta.id, b.id, "a pinned conversation did not lead the results");
});

test("a fresh service over the same directory sees every library change", async () => {
  // The restart property, for the LIBRARY half: rename and pin are on disk, not
  // in memory, so a server restart cannot lose them.
  const root = tmpRoot();
  const { service } = makeService(root, scripted([], okTurn("hi")));
  const started = await service.start({ title: "Before" });
  await service.rename(started.id, "After");
  await service.setPinned(started.id, true);

  const { service: reborn } = makeService(root, scripted([], okTurn("hi")));
  const record = await reborn.get(started.id);
  assert.equal(record?.title, "After");
  assert.equal(record?.pinned, true);
});
