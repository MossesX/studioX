/**
 * @file Replays the captured `claude` transcripts through the normaliser.
 *
 * `axf-claude.bmpx` P0: *"DESIGN AGAINST A CAPTURED TRANSCRIPT, NOT AN IMAGINED
 * ONE."* `src/server/claudeEvents.ts` was written against the fixtures in
 * `fixtures/claude-stream/`; this is what keeps the two together. It needs no
 * process, no clock and no network — the normaliser is pure, which is the whole
 * reason it is a separate file from the broker.
 *
 * ── what this does and does not catch ────────────────────────────────────────
 *
 * It catches a REGRESSION in the normaliser: a branch deleted, a field renamed,
 * an event kind that stops being recognised. It does NOT catch the CLI growing
 * a new event kind, because the fixtures are frozen bytes — only a fresh
 * capture finds that. `capture-manifest.json` records the exact commands so a
 * re-capture is a copy-paste rather than an archaeology exercise.
 *
 * The `unknown` assertion is the sharp one. `normaliseCliEvent` never drops a
 * line: anything it does not recognise comes back as `{type:"unknown"}` so it
 * surfaces in the UI instead of vanishing. That makes "zero unknowns across
 * every fixture" a meaningful claim — the vocabulary covers everything 2.1.229
 * actually emitted — and it goes red the moment a branch is lost.
 *
 * Every other assertion below pins one of the findings in the normaliser's
 * header, so the comment and the code cannot part company.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { normaliseCliLine, type BrokerEvent } from "@axs/server/claudeEvents";

const DIR = path.resolve(import.meta.dirname, "fixtures", "claude-stream");

function replay(file: string): BrokerEvent[] {
  const raw = readFileSync(path.join(DIR, file), "utf8");
  return raw.split("\n").flatMap((line) => normaliseCliLine(line));
}

const fixtures = () => readdirSync(DIR).filter((f) => f.endsWith(".ndjson"));

test("the fixtures are present — a passing suite over an empty directory proves nothing", () => {
  assert.ok(fixtures().length >= 4, `expected the four captures, found ${fixtures().length}`);
});

test("every captured line normalises, and nothing is unrecognised", () => {
  for (const file of fixtures()) {
    const events = replay(file);
    assert.ok(events.length > 0, `${file} produced no events`);
    const unknown = events.filter((e) => e.type === "unknown");
    assert.deepEqual(
      unknown.map((e) => (e.type === "unknown" ? e.kind : "")),
      [],
      `${file} produced unrecognised event kinds — either the normaliser lost a branch or the CLI grew one`
    );
  }
});

test("capture A: the full agentic vocabulary survives the round trip", () => {
  const events = replay("a-tools-subagent-thinking.ndjson");
  const kinds = new Set(events.map((e) => e.type));
  for (const expected of [
    "session",
    "status",
    "delta",
    "thinking_start",
    "thinking_tokens",
    "tool_use_start",
    "tool_use",
    "tool_result",
    "subagent",
    "hook",
    "rate_limit",
    "message_start",
    "message_stop",
    "result"
  ]) {
    assert.ok(kinds.has(expected as BrokerEvent["type"]), `capture A lost the "${expected}" event`);
  }

  // The session id is what --resume needs, and the `session` event is the only
  // place it appears before the turn ends.
  const session = events.find((e) => e.type === "session");
  assert.ok(session && session.type === "session" && session.sessionId, "no session id");

  // Tool calls arrive with COMPLETE inputs on the assistant message. The
  // content_block_start only ever carries an empty `input`, so a UI reading
  // arguments off the start event would render every tool call blank.
  const write = events.find((e) => e.type === "tool_use" && e.name === "Write");
  assert.ok(write && write.type === "tool_use", "no Write tool_use");
  const input = write.input as { file_path?: string; content?: string };
  assert.match(String(input.content), /alpha/, "Write's input did not survive normalisation");
});

test("capture A: subagent traffic is threaded, not scrambled into the transcript", () => {
  const events = replay("a-tools-subagent-thinking.ndjson");

  const started = events.find((e) => e.type === "subagent" && e.phase === "started");
  assert.ok(started && started.type === "subagent", "no subagent start");
  assert.equal(started.subagentType, "Explore");
  assert.ok(started.toolUseId, "a subagent with no spawning tool call cannot be nested under it");

  const completed = events.find((e) => e.type === "subagent" && e.phase === "completed");
  assert.ok(completed && completed.type === "subagent" && completed.summary, "no subagent summary");

  // The whole point of `agentId`: the subagent's own messages are interleaved
  // into the same stream and are ONLY distinguishable by parent_tool_use_id.
  const nested = events.filter((e) => "agentId" in e && e.agentId !== null);
  assert.ok(nested.length > 0, "no event carried a parent tool-use id — subagent nesting is unrenderable");
});

test("capture A: a tool loop produces many assistant messages, so text must accumulate", () => {
  const events = replay("a-tools-subagent-thinking.ndjson");
  const starts = events.filter((e) => e.type === "message_start" && e.agentId === null);
  assert.ok(
    starts.length > 1,
    "this fixture is supposed to contain a multi-message tool loop — it is the evidence that GizmoX's `text = whole` truncates"
  );
});

test("capture A: usage is dominated by cache tokens, so input_tokens alone under-reports", () => {
  const events = replay("a-tools-subagent-thinking.ndjson");
  const result = events.find((e) => e.type === "result");
  assert.ok(result && result.type === "result");
  assert.ok(result.usage.cacheReadTokens > result.usage.inputTokens * 100, "cache spread not preserved");
  assert.ok(result.usage.thinkingTokens > 0, "thinking tokens lost");
  assert.ok(typeof result.costUsd === "number" && result.costUsd > 0, "the CLI's own cost figure was lost");
});

test("thinking is announced even when its text is redacted", () => {
  // capture A thought for 813 tokens and emitted TEN thinking deltas carrying
  // an empty string; capture B emitted twenty-nine with real prose. Both are
  // normal. A UI keyed on thinking TEXT renders nothing for the first case,
  // which is why the block's START is its own event.
  const a = replay("a-tools-subagent-thinking.ndjson");
  assert.ok(
    a.some((e) => e.type === "thinking_start"),
    "no thinking_start — the redacted-thinking case is unrenderable"
  );
  assert.equal(
    a.filter((e) => e.type === "thinking").length,
    0,
    "this fixture is the REDACTED case; if it now has thinking text the finding needs re-checking"
  );
  const aResult = a.find((e) => e.type === "result");
  assert.ok(aResult && aResult.type === "result" && aResult.usage.thinkingTokens > 0);

  // ...and the same normaliser still carries real thinking prose through.
  const b = replay("b-disallowed-tool.ndjson");
  const thinking = b.filter((e) => e.type === "thinking");
  assert.ok(thinking.length > 20, "capture B's thinking prose was lost");
  assert.ok(thinking.every((e) => e.type === "thinking" && e.text.length > 0));
});

test("capture C: the error path has no `result` field — the reason is in errors[]", () => {
  const events = replay("c-error-bad-resume.ndjson");
  const result = events.find((e) => e.type === "result");
  assert.ok(result && result.type === "result");
  assert.equal(result.isError, true);
  assert.equal(result.subtype, "error_during_execution");
  // The finding itself: reading `.text` here yields nothing.
  assert.ok(!result.text, "this fixture is supposed to have no result text");
  assert.ok(result.errors.length > 0, "errors[] is the only channel and it is empty");
  assert.match(result.errors.join("; "), /No conversation found/);
});

test("capture E: a denied tool is an is_error tool_result, not a permission prompt", () => {
  const events = replay("e-denied-tool-error-result.ndjson");
  const failed = events.filter((e) => e.type === "tool_result" && e.isError);
  assert.ok(failed.length > 0, "no failed tool_result — the renderable refusal channel is missing");
  const first = failed[0];
  assert.ok(first.type === "tool_result");
  assert.match(first.text, /tool_use_error|disabled/i);

  // And the ledger stays empty for a deny rule, which is why it cannot be the
  // live channel a UI listens on.
  const result = events.find((e) => e.type === "result");
  assert.ok(result && result.type === "result");
  assert.deepEqual(result.permissionDenials, []);
});

test("tool_result content keeps both observed shapes, with a flattened text alongside", () => {
  const events = replay("b-disallowed-tool.ndjson");
  const results = events.filter((e) => e.type === "tool_result");
  assert.ok(results.length > 0);
  const asString = results.find((e) => e.type === "tool_result" && typeof e.content === "string");
  const asBlocks = results.find((e) => e.type === "tool_result" && Array.isArray(e.content));
  assert.ok(asString, "the plain-string tool_result shape was lost");
  assert.ok(asBlocks, "the block-array tool_result shape was lost");
});

test("an unparseable line becomes an event rather than a silent skip", () => {
  const events = normaliseCliLine("{not json");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "unknown");
});

test("a blank line is genuinely nothing", () => {
  assert.deepEqual(normaliseCliLine("   "), []);
});
