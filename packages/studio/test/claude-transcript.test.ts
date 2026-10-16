/**
 * @file The workspace's PURE layer, replayed through the REAL captures —
 * `axf-claude` P3.
 *
 * P0's non-negotiable was *"DESIGN AGAINST A CAPTURED TRANSCRIPT, NOT AN
 * IMAGINED ONE."* `test/claude-events.test.ts` holds that for the normaliser.
 * This holds it one level up: the fold, the markdown parser and the diff engine
 * are fed the SAME four fixtures, wrapped in the service's `cli` envelope
 * exactly as `ClaudeService` wraps them, and asserted against what a reader
 * would actually see.
 *
 * That matters because the fold is where the transcript's four hard problems
 * live — interleaved subagent traffic, a tool call arriving in three pieces,
 * todos that are not a todo tool here, and thinking that streams while redacted
 * — and every one of them is a property of the real stream that an invented
 * fixture would get wrong in exactly the way the UI would then be wrong.
 *
 * NO DOM and no React: everything under test is pure by construction, which is
 * why it was built as a fold rather than as something the renderer does.
 * Imports go through the same alias hook the other tests use.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { normaliseCliLine } from "../src/server/claudeEvents.ts";
import type { BrokerEvent } from "../src/server/claudeEvents.ts";
import type { ClaudeSessionEvent } from "../src/claude/types.ts";
import { buildTranscript, foldEvents, todoOpOf } from "../src/modules/claude-workspace/transcript.ts";
import type { ToolItem, TranscriptItem } from "../src/modules/claude-workspace/transcript.ts";
import { codeBlocksOf, parseInline, parseMarkdown, spansToText } from "../src/modules/claude-workspace/markdown.ts";
import { diffStrings, fileDiffOf, toUnifiedPatch } from "../src/modules/claude-workspace/diff.ts";
import { tokenize, languageKey } from "../src/modules/claude-workspace/highlight.ts";
import { parseQuery, searchRecord } from "../src/claude/search.ts";
import { exportConversation, fileStem } from "../src/claude/export.ts";
import { applySlash, slashMatch } from "../src/modules/claude-workspace/slash.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "claude-stream");

/**
 * A capture, wrapped exactly as `ClaudeService#runTurn` wraps it.
 *
 * The wrapping is not decoration — the fold reads `ClaudeSessionEvent`, the
 * capture is raw CLI lines, and the service's `cli` envelope is the seam
 * between them. Replaying without it would test a shape nothing produces.
 */
function replay(file: string, conversationId = "c1", turnId = "t1"): ClaudeSessionEvent[] {
  const lines = fs.readFileSync(path.join(FIXTURES, file), "utf8").split("\n").filter(Boolean);
  const out: ClaudeSessionEvent[] = [
    { type: "turn-started", conversationId, turnId, model: "claude-sonnet-5", resume: false, at: "2026-08-12T00:00:00.000Z" }
  ];
  for (const line of lines) {
    for (const event of normaliseCliLine(line)) {
      if (event.type === "session") {
        out.push({ type: "session", conversationId, turnId, cliSessionId: event.sessionId });
      }
      if (event.type === "result") {
        // The service converts the terminal into turn-done/turn-error rather
        // than forwarding it, so the replay does the same.
        out.push(
          event.isError
            ? {
                type: "turn-error",
                conversationId,
                turnId,
                message: event.errors.join("; ") || "failed",
                at: "2026-08-12T00:00:01.000Z"
              }
            : {
                type: "turn-done",
                conversationId,
                turnId,
                text: event.text ?? "",
                usage: { ...event.usage, costUsd: event.costUsd ?? 0 },
                cliSessionId: event.sessionId,
                at: "2026-08-12T00:00:01.000Z"
              }
        );
        continue;
      }
      out.push({ type: "cli", conversationId, turnId, event: event as BrokerEvent });
    }
  }
  return out;
}

/** Every item at every depth, flattened — the fold nests, the assertions do not
 *  all want to. */
function flatten(items: readonly TranscriptItem[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  const walk = (list: readonly TranscriptItem[]): void => {
    for (const item of list) {
      out.push(item);
      if (item.kind === "tool") walk(item.children);
    }
  };
  walk(items);
  return out;
}

const toolsOf = (items: readonly TranscriptItem[]): ToolItem[] =>
  flatten(items).filter((item): item is ToolItem => item.kind === "tool");

/* ==================================================================== the fold */

test("the fixtures are there and the replay produces a real stream", () => {
  // The floor every other assertion rests on: a replay that silently produced
  // nothing would make every count below pass vacuously.
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".ndjson"));
  assert.equal(files.length, 4, `expected the four P0 captures, found ${files.join(", ")}`);
  const events = replay("a-tools-subagent-thinking.ndjson");
  assert.ok(events.length > 100, `the broad capture replayed to only ${events.length} events`);
});

test("capture-a folds into prose, thinking, tools and ONE todo list", () => {
  const model = foldEvents(replay("a-tools-subagent-thinking.ndjson"));
  const items = flatten(model.items);

  const assistant = items.filter((i) => i.kind === "assistant");
  assert.ok(assistant.length >= 1, "no assistant prose came out of a turn that demonstrably spoke");
  assert.ok(
    assistant.some((i) => i.kind === "assistant" && i.text.length > 20),
    "every assistant block was empty"
  );

  // The whole reason todos are folded: the capture has fourteen TaskCreate and
  // twenty-six TaskUpdate calls. Drawn as cards that is forty rows; folded it is
  // one list.
  const todos = items.filter((i) => i.kind === "todo");
  assert.equal(todos.length, 1, `expected one todo list, got ${todos.length}`);
  const list = todos[0]!;
  assert.ok(list.kind === "todo" && list.todos.length >= 3, "the todo list came out empty");
  assert.ok(
    list.kind === "todo" && list.todos.some((t) => t.status === "completed"),
    "no todo ever reached completed — the TaskUpdate ids never matched the TaskCreate results"
  );

  // …and none of those calls left a card behind.
  const todoCards = toolsOf(model.items).filter((t) => /^Task(Create|Update)$/.test(t.name));
  assert.deepEqual(todoCards, [], "a todo operation was also drawn as a tool card");
});

test("a tool call's three events collapse into ONE card carrying its result", () => {
  const model = foldEvents(replay("a-tools-subagent-thinking.ndjson"));
  const tools = toolsOf(model.items);
  const ids = tools.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, `a tool call produced two cards: ${ids.join(", ")}`);

  const bash = tools.find((t) => t.name === "Bash");
  assert.ok(bash, "the capture's Bash call produced no card");
  assert.ok(bash.input !== undefined, "the Bash card never received its input");
  assert.ok(bash.result, "the Bash card never received its result");
  assert.equal(bash.result?.isError, false);
});

test("subagent traffic nests under the call that spawned it, never in the main thread", () => {
  const model = foldEvents(replay("a-tools-subagent-thinking.ndjson"));
  const agent = toolsOf(model.items).find((t) => t.name === "Agent");
  assert.ok(agent, "the capture's Agent call produced no card");
  assert.ok(agent.children.length > 0, "the subagent's work did not nest — it is loose in the transcript");
  assert.ok(agent.subagent, "the system/task_* lifecycle never reached the card");
  assert.equal(agent.subagent?.subagentType, "Explore");
  assert.equal(
    agent.subagent?.done,
    true,
    "task_updated/task_notification reported completion and the card did not take it"
  );

  // The negative half, which is the one that would actually be wrong on screen:
  // no top-level item may be a subagent's.
  const topLevelUsers = model.items.filter((i) => i.kind === "user");
  assert.deepEqual(
    topLevelUsers.filter((i) => i.kind === "user" && i.fromAgent),
    [],
    "a subagent's own prompt was scrambled into the main transcript"
  );
});

test("thinking opens on its START, so a REDACTED think is still visible", () => {
  // capture-a: ten thinking_delta events carrying an empty string, against 813
  // reported thinking tokens. A block that waited for text would show nothing
  // through the slowest part of the turn.
  const model = foldEvents(replay("a-tools-subagent-thinking.ndjson"));
  const thinking = flatten(model.items).filter((i) => i.kind === "thinking");
  assert.ok(thinking.length >= 1, "the redacted thinking block produced no item at all");
  assert.ok(
    thinking.some((i) => i.kind === "thinking" && i.tokens > 0),
    "no thinking block carried a token count — the redacted case has no progress signal left"
  );

  // capture-b is the same event with real prose, which is what proves the
  // branch above is about redaction and not about a broken fold.
  const b = foldEvents(replay("b-disallowed-tool.ndjson"));
  const withText = flatten(b.items).filter((i) => i.kind === "thinking" && i.text.trim().length > 0);
  assert.ok(withText.length >= 1, "capture-b's twenty-nine thinking deltas produced no prose");
});

test("every open block is settled when the turn terminates", () => {
  const model = foldEvents(replay("a-tools-subagent-thinking.ndjson"));
  assert.equal(model.streaming, false);
  for (const item of flatten(model.items)) {
    if (item.kind === "assistant") assert.equal(item.streaming, false, "a caret is still blinking after turn-done");
    if (item.kind === "thinking") assert.equal(item.active, false, "a thinking block is still active after turn-done");
  }
});

test("a failed turn reports the reason from errors[], not an empty string", () => {
  // capture-c: subtype error_during_execution with NO `result` field. This is
  // the fixture the manifest calls "the most load-bearing here".
  const model = foldEvents(replay("c-error-bad-resume.ndjson"));
  assert.equal(model.streaming, false);
  assert.ok(model.error && model.error.length > 0, "the failure came through with no message");
  const notices = flatten(model.items).filter((i) => i.kind === "notice" && i.tone === "error");
  assert.equal(notices.length, 1, "the reader is told nothing about a failed turn");
});

test("a denied tool surfaces as an ERROR RESULT — the only refusal channel there is", () => {
  // capture-e: a permissions.deny rule is an ordinary tool_result with
  // is_error true. Headless mode never sends a prompt-shaped permission event,
  // so this card is the whole of what a UI can render.
  const model = foldEvents(replay("e-denied-tool-error-result.ndjson"));
  const failed = toolsOf(model.items).filter((t) => t.result?.isError === true);
  assert.ok(failed.length >= 1, "the denied Write did not come through as a failed tool card");
});

test("an unrecognised CLI event becomes a visible notice, never a silent drop", () => {
  // The whole reason `claudeEvents.ts` emits `unknown` instead of dropping. A
  // synthetic event, because by construction the captures contain none.
  const model = foldEvents([
    { type: "turn-started", conversationId: "c", turnId: "t", model: "m", resume: false, at: "x" },
    { type: "cli", conversationId: "c", turnId: "t", event: { type: "unknown", kind: "system/brand-new", event: { a: 1 } } }
  ]);
  const notice = model.items.find((i) => i.kind === "notice");
  assert.ok(notice, "an unknown CLI event vanished — nobody would ever notice the absence");
  assert.match(notice.kind === "notice" ? notice.title : "", /system\/brand-new/);
});

/* ------------------------------- the history seam --------------------------- */

test("history and the live half never double-count the same turn", () => {
  const events = replay("a-tools-subagent-thinking.ndjson");
  const messages = [
    { role: "user" as const, text: "first question", at: "2026-08-12T00:00:00.000Z" },
    { role: "assistant" as const, text: "first answer", at: "2026-08-12T00:00:01.000Z" },
    // Persisted DURING the live turn — the service writes the user message
    // before the CLI runs, and this is the message the segment also carries.
    { role: "user" as const, text: "second question", at: "2026-08-12T00:01:00.000Z" }
  ];
  const model = buildTranscript(messages, 2, [
    { id: "s1", user: { text: "second question", at: "2026-08-12T00:01:00.000Z" }, events }
  ]);
  const users = model.items.filter((i) => i.kind === "user" && !(i.kind === "user" && i.fromAgent));
  const texts = users.map((i) => (i.kind === "user" ? i.text : ""));
  assert.deepEqual(
    texts.filter((t) => t === "second question"),
    ["second question"],
    "the live turn's question was rendered twice — once from disk and once from the segment"
  );
  assert.equal(texts[0], "first question", "the history did not come first");
});

test("a segment with no user message is the ATTACH case and adds nothing", () => {
  const model = buildTranscript(
    [{ role: "user", text: "q", at: "2026-08-12T00:00:00.000Z" }],
    1,
    [{ id: "attach", user: null, events: [] }]
  );
  assert.equal(model.items.length, 1, "attaching invented a message");
});

/* ---------------------------------- todo ops -------------------------------- */

test("todoOpOf reads SHAPES, so a renamed task tool still folds", () => {
  assert.deepEqual(todoOpOf({ subject: "Do it", description: "how" }), {
    op: "create",
    subject: "Do it",
    description: "how"
  });
  assert.deepEqual(todoOpOf({ taskId: "7", status: "completed" }), {
    op: "update",
    id: "7",
    status: "completed",
    subject: null
  });
  // The TodoWrite shape this environment does not emit, accepted anyway.
  const replaced = todoOpOf({ todos: [{ content: "a", status: "in_progress" }] });
  assert.equal(replaced?.op, "replace");
  // …and things that are NOT todo operations stay tool cards.
  assert.equal(todoOpOf({ command: "npm test" }), null);
  assert.equal(todoOpOf({ file_path: "x", content: "y" }), null);
  assert.equal(todoOpOf(null), null);
});

/* ==================================================================== markdown */

test("an UNTERMINATED fence is still a code block — the streaming case", () => {
  const blocks = parseMarkdown("Here:\n```ts\nconst a = 1;\nconst b = 2;");
  const code = blocks.find((b) => b.kind === "code");
  assert.ok(code, "a streaming code block rendered as prose, backticks and all");
  assert.equal(code.kind === "code" && code.closed, false, "it did not report itself as still open");
  assert.equal(code.kind === "code" && code.lang, "ts");
});

test("a half-typed inline marker renders as itself, never swallowing the rest", () => {
  assert.equal(spansToText(parseInline("**bol")), "**bol");
  assert.equal(spansToText(parseInline("`unclosed")), "`unclosed");
  // …and completes correctly the moment its mate arrives.
  const done = parseInline("**bold**");
  assert.equal(done.length, 1);
  assert.equal(done[0]?.kind, "strong");
});

test("block ids are structural, so a growing document keeps element identity", () => {
  const first = parseMarkdown("one\n\ntwo");
  const grown = parseMarkdown("one\n\ntwo\n\nthree");
  assert.equal(first[0]?.id, grown[0]?.id, "a paragraph changed id when a later one was added");
  assert.equal(first[1]?.id, grown[1]?.id);
});

test("snake_case survives, and a bare URL linkifies", () => {
  assert.equal(spansToText(parseInline("call some_function_name now")), "call some_function_name now");
  const spans = parseInline("see https://example.com/a.");
  const link = spans.find((s) => s.kind === "link");
  assert.equal(link?.kind === "link" ? link.href : null, "https://example.com/a");
});

test("lists, tables and quotes come out as their own blocks", () => {
  const blocks = parseMarkdown(
    ["- [ ] todo", "- [x] done", "", "| a | b |", "| --- | ---: |", "| 1 | 2 |", "", "> quoted"].join("\n")
  );
  const list = blocks.find((b) => b.kind === "list");
  assert.equal(list?.kind === "list" ? list.items.length : 0, 2);
  assert.equal(list?.kind === "list" ? list.items[1]?.checked : null, true);
  const table = blocks.find((b) => b.kind === "table");
  assert.equal(table?.kind === "table" ? table.align[1] : null, "right");
  assert.ok(blocks.some((b) => b.kind === "quote"));
});

test("codeBlocksOf finds every fence, which is what 'copy the code' copies", () => {
  const blocks = codeBlocksOf(parseMarkdown("a\n\n```js\nx\n```\n\nb\n\n```\ny\n```"));
  assert.deepEqual(blocks.map((b) => b.code), ["x", "y"]);
});

/* ================================================================== highlight */

test("the highlighter colours what it knows and refuses what it does not", () => {
  const ts = tokenize('const x = "s"; // note', "typescript");
  assert.ok(ts.some((t) => t.kind === "keyword" && t.text === "const"));
  assert.ok(ts.some((t) => t.kind === "string" && t.text === '"s"'));
  assert.ok(ts.some((t) => t.kind === "comment"));
  // An unknown language is `plain`, deliberately: uncoloured beats mis-coloured.
  assert.equal(languageKey("brainfuck"), "plain");
  const plain = tokenize("const x = 1", "brainfuck");
  assert.ok(plain.every((t) => t.kind === "plain"));
  // Round-tripping is the property a highlighter must never break.
  const source = "def f(x):\n  return x  # hi\n";
  assert.equal(tokenize(source, "python").map((t) => t.text).join(""), source);
});

test("a diff's file headers are not read as deleted lines", () => {
  const tokens = tokenize("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n", "diff");
  const kinds = tokens.filter((t) => t.text.trim()).map((t) => t.kind);
  assert.deepEqual(kinds, ["meta", "meta", "meta", "removed", "added"]);
});

/* ======================================================================= diff */

test("an Edit's two strings diff exactly; a Write is honestly all-added", () => {
  const edit = fileDiffOf("Edit", {
    file_path: "notes.txt",
    old_string: "alpha\nbeta\ngamma",
    new_string: "alpha\nBETA\ngamma"
  });
  assert.ok(edit);
  assert.equal(edit.mode, "edit");
  assert.equal(edit.added, 1);
  assert.equal(edit.removed, 1);

  const write = fileDiffOf("Write", { file_path: "notes.txt", content: "alpha\nbeta\n" });
  assert.equal(write?.mode, "write");
  assert.equal(write?.removed, 0, "a whole-file write claimed to have removed lines it never saw");

  // Not an edit at all.
  assert.equal(fileDiffOf("Bash", { command: "ls" }), null);
});

test("the capture's real Edit call produces a real diff", () => {
  const model = foldEvents(replay("a-tools-subagent-thinking.ndjson"));
  const edit = toolsOf(model.items).find((t) => t.name === "Edit");
  assert.ok(edit, "the capture's Edit call produced no card");
  assert.ok(edit.diff, "the Edit card carries no diff — the shape check missed the real payload");
  assert.equal(edit.diff?.added, 1);
  assert.equal(edit.diff?.removed, 1);
  assert.match(toUnifiedPatch(edit.diff!), /^--- a\//);
});

test("an oversize pair is REFUSED rather than diffed slowly", () => {
  const big = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n");
  const diff = diffStrings(big, `${big}\nmore`, { path: "big.txt" });
  assert.equal(diff.truncated, true, "a 2000-line pair was diffed quadratically inside a render");
});

/* ===================================================================== search */

test("search is AND over terms, within ONE message, with excerpts", () => {
  const record = {
    format: "axs-claude-conversation/1" as const,
    id: "00000000-0000-4000-8000-000000000000",
    title: "Nothing to see",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    cwd: "/tmp",
    model: "sonnet-5",
    effort: null,
    permissionMode: "default" as const,
    system: "",
    totalCostUsd: 0,
    messages: [
      { role: "user" as const, text: "the quick brown fox", at: "2026-08-12T00:00:00.000Z" },
      { role: "assistant" as const, text: "a lazy dog", at: "2026-08-12T00:00:01.000Z" }
    ]
  };

  const hit = searchRecord(record, parseQuery("quick fox"));
  assert.ok(hit, "both terms are in one message and it did not match");
  assert.equal(hit.matches.length, 1);
  assert.ok(hit.matches[0]!.ranges.length >= 2, "the excerpt carries no highlight ranges");

  // Terms spread across TWO messages must not match — "the words are in here
  // somewhere" is a claim nobody can act on.
  assert.equal(searchRecord(record, parseQuery("quick dog")), null);
  // A quoted phrase is one term.
  assert.ok(searchRecord(record, parseQuery('"brown fox"')));
  assert.equal(searchRecord(record, parseQuery('"fox brown"')), null);
  // An empty query is not a search.
  assert.deepEqual(parseQuery("   "), []);
});

/* ===================================================================== export */

test("export produces the record verbatim as JSON and a readable markdown", () => {
  const record = {
    format: "axs-claude-conversation/1" as const,
    id: "11111111-1111-4111-8111-111111111111",
    title: "A / weird: name*",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    cwd: "C:/tmp",
    model: "opus-5",
    effort: "high" as const,
    permissionMode: "default" as const,
    system: "be brief",
    totalCostUsd: 1.25,
    messages: [{ role: "user" as const, text: "hi", at: "2026-08-12T00:00:00.000Z" }]
  };

  const json = exportConversation(record, "json");
  assert.equal(json.filename, "a-weird-name.json");
  assert.deepEqual(JSON.parse(json.text), record, "the JSON export is not the record verbatim");

  const md = exportConversation(record, "markdown");
  assert.equal(md.filename, "a-weird-name.md");
  assert.match(md.text, /^---\n/, "no front matter — the export cannot be read back");
  assert.match(md.text, /model: opus-5/);
  assert.match(md.text, /## You ·/);
  // A title that sanitises to nothing must still produce a filename.
  assert.equal(fileStem("***", "fallback"), "fallback");
});

/* ====================================================================== slash */

test("slash completion fires only at the start of a draft, never inside a path", () => {
  const match = slashMatch("/comp", 5);
  assert.ok(match, "a leading slash did not open completion");
  assert.ok(match.matches.some((c) => c.name === "compact"));

  // The case that would put a popup over someone's typing all day.
  assert.equal(slashMatch("open src/claude", 15), null);
  assert.equal(slashMatch("hello /clear", 12), null);

  const applied = applySlash("/comp", 5, match, match.matches[0]!);
  assert.match(applied.text, /^\/compact $/);
  assert.equal(applied.caret, applied.text.length);
});
