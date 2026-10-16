/**
 * @file The FOLD: a flat stream of `ClaudeSessionEvent`s becomes the tree a
 * transcript is drawn from. Pure, synchronous, and the whole of P3's
 * *"desktop-app standard"* claim that can be reasoned about without a browser.
 *
 * ── why the renderer must not do this itself ─────────────────────────────────
 *
 * The stream is flat, interleaved and out of shape for a reader in four
 * separate ways, and each one is a place a component that folded as it rendered
 * would get it wrong on some deltas and right on others:
 *
 *  1. **Subagent traffic is INTERLEAVED into the same stream.** The capture
 *     proves it: a subagent's deltas, tool calls and results arrive between the
 *     main thread's, distinguishable only by `parent_tool_use_id`. Appending
 *     events in arrival order scrambles a subagent's work into the answer. Here
 *     every event is routed by `agentId` into its own thread and the thread is
 *     nested under the tool call that spawned it.
 *  2. **A tool call arrives in three pieces.** `tool_use_start` (name, no
 *     input), then the whole `assistant` message (the authoritative input),
 *     then a `user` message carrying the result. One card, three events, and
 *     the card must exist from the first so "calling Bash…" is visible during
 *     the argument stream.
 *  3. **Todos are not a todo tool here.** This environment exposes
 *     `TaskCreate`/`TaskUpdate` — one task per call — so a raw transcript of a
 *     planned turn is forty tool cards saying "Task #7 → completed". The fold
 *     collapses them into ONE live list per thread, which is what a todo list
 *     is. See {@link todoOpOf}; it is shape-driven for the reason `diff.ts`
 *     gives about names.
 *  4. **Thinking may be REDACTED and still stream.** `claudeEvents.ts` finding
 *     5: ten `thinking_delta`s carrying an empty string against 813 reported
 *     thinking tokens. So a thinking block is opened by `thinking_start`, not
 *     by its text, and carries a token count for the case where the prose never
 *     arrives — otherwise a redacted think looks like a frozen screen.
 *
 * ── the history/live seam ────────────────────────────────────────────────────
 *
 * The store persists ROLE AND TEXT, nothing more: a reload cannot resurrect
 * tool cards, thinking or subagent runs, because they were never on disk. That
 * is a real limit and this file states it rather than papering over it — a
 * reloaded conversation shows its prose, and the turn you are watching shows
 * everything. {@link buildTranscript} takes the persisted messages and the live
 * events separately and never lets them double-count: `historyCount` is the
 * message count at the moment the live stream was attached, and everything from
 * there is the live half's to render.
 *
 * PURE and isomorphic — no React, no DOM, no node builtins. `Transcript.tsx`
 * paints what this returns.
 */
import type { BrokerEvent, ClaudeSessionEvent, StoredMessage, TurnUsage } from "../../claude/types";
import type { FileDiff } from "./diff";
import { fileDiffOf } from "./diff";

/* ---------------------------------- items ----------------------------------- */

export interface UserItem {
  readonly kind: "user";
  readonly id: string;
  readonly text: string;
  readonly at: string | null;
  /** True for a subagent's own prompt, which is shown under its task rather
   *  than as something the person typed. */
  readonly fromAgent: boolean;
}

export interface AssistantItem {
  readonly kind: "assistant";
  readonly id: string;
  readonly text: string;
  /** Still receiving deltas — what drives the caret and suppresses "empty". */
  readonly streaming: boolean;
}

export interface ThinkingItem {
  readonly kind: "thinking";
  readonly id: string;
  readonly text: string;
  /** From `system/thinking_tokens`. The ONLY progress signal when the prose is
   *  redacted, which the capture proves happens. */
  readonly tokens: number;
  readonly active: boolean;
}

export interface ToolResult {
  readonly text: string;
  /** Verbatim from the wire: a string, or an array of content blocks. */
  readonly content: unknown;
  readonly isError: boolean;
  readonly structured?: unknown;
}

/** A subagent's lifecycle, folded from `system/task_*`. */
export interface SubagentRun {
  readonly taskId: string;
  readonly subagentType: string | null;
  readonly description: string | null;
  readonly status: string | null;
  readonly summary: string | null;
  readonly lastToolName: string | null;
  readonly totalTokens: number | null;
  readonly durationMs: number | null;
  readonly done: boolean;
}

export interface ToolItem {
  readonly kind: "tool";
  /** The `toolu_…` id — stable across all three of the call's events. */
  readonly id: string;
  readonly name: string;
  /** Undefined until the whole `assistant` message lands. */
  readonly input: unknown;
  readonly result: ToolResult | null;
  /** Computed once here rather than per render — `Edit`/`Write` become diffs. */
  readonly diff: FileDiff | null;
  readonly subagent: SubagentRun | null;
  /** The subagent's own transcript, nested. Empty for an ordinary tool call. */
  readonly children: readonly TranscriptItem[];
}

export type TodoStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface TodoEntry {
  readonly id: string;
  readonly subject: string;
  readonly description: string | null;
  readonly status: TodoStatus;
}

export interface TodoItem {
  readonly kind: "todo";
  readonly id: string;
  readonly todos: readonly TodoEntry[];
}

export interface NoticeItem {
  readonly kind: "notice";
  readonly id: string;
  readonly tone: "info" | "warn" | "error";
  readonly title: string;
  readonly detail: string | null;
  /** Raw payload for an `unknown` event — shown on expand, never dropped. */
  readonly payload?: unknown;
}

export type TranscriptItem =
  | UserItem
  | AssistantItem
  | ThinkingItem
  | ToolItem
  | TodoItem
  | NoticeItem;

export interface TranscriptModel {
  readonly items: readonly TranscriptItem[];
  /** A turn is live — the composer disables, the stop button arms. */
  readonly streaming: boolean;
  /** The CLI's own coarse status ("requesting"), while streaming. */
  readonly status: string | null;
  /** The last completed turn's tally. */
  readonly usage: TurnUsage | null;
  /** Summed cost of the turns in the live half. */
  readonly liveCostUsd: number;
  /** Set when the turn ended badly — the composer shows it and stays usable. */
  readonly error: string | null;
}

export const EMPTY_TRANSCRIPT: TranscriptModel = {
  items: [],
  streaming: false,
  status: null,
  usage: null,
  liveCostUsd: 0,
  error: null
};

/* ---------------------------------- todos ----------------------------------- */

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const rec = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function asStatus(v: unknown): TodoStatus | null {
  const s = str(v);
  if (s === "pending" || s === "in_progress" || s === "completed" || s === "deleted") return s;
  // The TodoWrite spelling, accepted because it costs one line and a transcript
  // recorded elsewhere should still render.
  if (s === "in-progress") return "in_progress";
  return null;
}

export type TodoOp =
  | { readonly op: "create"; readonly subject: string; readonly description: string | null }
  | { readonly op: "update"; readonly id: string; readonly status: TodoStatus | null; readonly subject: string | null }
  | { readonly op: "replace"; readonly todos: readonly TodoEntry[] };

/**
 * A todo operation out of a tool call, or null when the call is not one.
 *
 * SHAPE-driven, exactly as `fileDiffOf` is and for the same stated reason: a
 * name check is silent when the name changes. `{ subject }` with no `taskId` is
 * a creation; `{ taskId, status }` is an update; `{ todos: [...] }` is a whole
 * list replacing the previous one (the `TodoWrite` shape, which this
 * environment does not emit — the capture manifest says so outright — but which
 * costs almost nothing to accept and would otherwise render as an opaque card).
 */
export function todoOpOf(input: unknown): TodoOp | null {
  const fields = rec(input);
  if (!fields) return null;

  const todos = fields.todos;
  if (Array.isArray(todos)) {
    const entries: TodoEntry[] = [];
    todos.forEach((raw, index) => {
      const todo = rec(raw);
      if (!todo) return;
      const subject = str(todo.content) ?? str(todo.subject) ?? str(todo.activeForm);
      if (!subject) return;
      entries.push({
        id: str(todo.id) ?? String(index + 1),
        subject,
        description: str(todo.description),
        status: asStatus(todo.status) ?? "pending"
      });
    });
    return entries.length ? { op: "replace", todos: entries } : null;
  }

  const taskId = str(fields.taskId) ?? str(fields.task_id);
  if (taskId) {
    return { op: "update", id: taskId, status: asStatus(fields.status), subject: str(fields.subject) };
  }

  const subject = str(fields.subject);
  if (subject && fields.description !== undefined) {
    return { op: "create", subject, description: str(fields.description) };
  }
  return null;
}

/**
 * The id a creation was assigned, read from the tool RESULT.
 *
 * `TaskCreate`'s input does not carry an id — the result does, as
 * `tool_use_result.task.id` (capture: `{"task":{"id":"1","subject":"…"}}`).
 * Without it a later `TaskUpdate` naming task 1 has nothing to attach to, so a
 * created todo would never change state and the list would look stuck.
 */
function createdTodoId(result: ToolResult | null): string | null {
  const structured = rec(result?.structured);
  const task = rec(structured?.task);
  const id = str(task?.id);
  if (id) return id;
  // The prose fallback: "Task #1 created successfully: …". Second, never first
  // — parsing a sentence is a guess, and the structured field is the record.
  const match = /Task #(\d+) created/.exec(result?.text ?? "");
  return match ? match[1]! : null;
}

/* --------------------------------- the fold --------------------------------- */

/** One thread of the transcript: the main one, or one subagent's. */
interface Thread {
  readonly items: TranscriptItem[];
  assistant: { id: string; text: string } | null;
  thinking: { id: string; text: string; tokens: number } | null;
  /** The todo list's item id, so every op updates ONE item in place. */
  todoItemId: string | null;
  todos: TodoEntry[];
  /** Creations awaiting the id their result will carry. */
  pendingCreate: Map<string, string>;
}

const newThread = (): Thread => ({
  items: [],
  assistant: null,
  thinking: null,
  todoItemId: null,
  todos: [],
  pendingCreate: new Map()
});

class Fold {
  readonly #threads = new Map<string, Thread>();
  readonly #tools = new Map<string, ToolItem>();
  /** Which thread each item lives in — how a tool's children are attached. */
  readonly #ownerOf = new Map<string, string>();
  /** Tool-call ids that turned out to be todo operations — their RESULTS must
   *  be routed to the list rather than to a card that was never drawn. */
  readonly #todoCalls = new Set<string>();
  /** `task_id` → the `tool_use_id` that spawned it. `task_updated` carries the
   *  task id and NOT the tool id (capture-a proves it), so without this map the
   *  one event that reports completion has nothing to attach to. */
  readonly #taskTool = new Map<string, string>();
  #seq = 0;

  status: string | null = null;
  usage: TurnUsage | null = null;
  liveCostUsd = 0;
  error: string | null = null;
  streaming = false;

  #id(prefix: string): string {
    return `${prefix}-${++this.#seq}`;
  }

  /** `null` (the main thread) is keyed as `"main"` so one Map holds both. */
  #thread(agentId: string | null): Thread {
    const key = agentId ?? "main";
    let thread = this.#threads.get(key);
    if (!thread) {
      thread = newThread();
      this.#threads.set(key, thread);
    }
    return thread;
  }

  /**
   * Close the open prose and thinking blocks of a thread — a new assistant
   * message, or a tool call, means the next delta starts a fresh block.
   *
   * It SETTLES the items as well as dropping the pointers, and that is not
   * bookkeeping. A block closed here is finished, and a finished block that
   * still reads `streaming`/`active` keeps a blinking caret and the word
   * "Thinking" on work that ended several tool calls ago. `#finish` alone
   * cannot catch it: by the time the turn terminates, the pointer to that block
   * is long gone, so there is nothing left to settle. Caught by
   * `test/claude-transcript.test.ts` replaying capture-a, where a thinking
   * block is closed by the `message_start` of the next assistant message.
   */
  #close(thread: Thread): void {
    if (thread.assistant) {
      this.#replace({
        kind: "assistant",
        id: thread.assistant.id,
        text: thread.assistant.text,
        streaming: false
      });
    }
    if (thread.thinking) {
      this.#replace({
        kind: "thinking",
        id: thread.thinking.id,
        text: thread.thinking.text,
        tokens: thread.thinking.tokens,
        active: false
      });
    }
    thread.assistant = null;
    thread.thinking = null;
  }

  #push(agentId: string | null, item: TranscriptItem): void {
    const thread = this.#thread(agentId);
    thread.items.push(item);
    this.#ownerOf.set(item.id, agentId ?? "main");
  }

  /** Replace an item in place, wherever it lives. Tool cards and the todo list
   *  are both mutated long after they were appended. */
  #replace(item: TranscriptItem): void {
    const key = this.#ownerOf.get(item.id) ?? "main";
    const thread = this.#thread(key === "main" ? null : key);
    const index = thread.items.findIndex((existing) => existing.id === item.id);
    if (index >= 0) thread.items[index] = item;
  }

  #tool(id: string): ToolItem | null {
    return this.#tools.get(id) ?? null;
  }

  #setTool(next: ToolItem): void {
    this.#tools.set(next.id, next);
    this.#replace(next);
  }

  /* ------------------------------- the todos ------------------------------- */

  #applyTodo(agentId: string | null, op: TodoOp, toolUseId: string): boolean {
    const thread = this.#thread(agentId);
    if (op.op === "create") {
      // The id is not known yet — the result carries it. Parked under the tool
      // call's id and adopted in `#todoResult`.
      thread.pendingCreate.set(toolUseId, op.subject);
      thread.todos = [
        ...thread.todos,
        { id: `pending:${toolUseId}`, subject: op.subject, description: op.description, status: "pending" }
      ];
    } else if (op.op === "update") {
      thread.todos = thread.todos.map((todo) =>
        todo.id === op.id
          ? { ...todo, status: op.status ?? todo.status, subject: op.subject ?? todo.subject }
          : todo
      );
      // An update naming a task no creation was seen for is REAL — a resumed
      // session's todos were created in an earlier turn. Kept as a row with the
      // id as its subject rather than dropped, so the list does not lie by
      // omission about how many tasks there are.
      if (!thread.todos.some((todo) => todo.id === op.id)) {
        thread.todos = [
          ...thread.todos,
          {
            id: op.id,
            subject: op.subject ?? `Task #${op.id}`,
            description: null,
            status: op.status ?? "pending"
          }
        ];
      }
    } else {
      thread.todos = [...op.todos];
    }

    if (!thread.todoItemId) {
      const item: TodoItem = { kind: "todo", id: this.#id("todo"), todos: thread.todos };
      thread.todoItemId = item.id;
      this.#push(agentId, item);
    } else {
      this.#replace({ kind: "todo", id: thread.todoItemId, todos: thread.todos });
    }
    return true;
  }

  /** Adopt the id a creation's result reported, so later updates land. */
  #todoResult(agentId: string | null, toolUseId: string, result: ToolResult): void {
    const thread = this.#thread(agentId);
    if (!thread.pendingCreate.has(toolUseId)) return;
    thread.pendingCreate.delete(toolUseId);
    const id = createdTodoId(result);
    if (!id) return;
    thread.todos = thread.todos.map((todo) =>
      todo.id === `pending:${toolUseId}` ? { ...todo, id } : todo
    );
    if (thread.todoItemId) {
      this.#replace({ kind: "todo", id: thread.todoItemId, todos: thread.todos });
    }
  }

  /* ------------------------------- CLI events ------------------------------ */

  #cli(event: BrokerEvent): void {
    switch (event.type) {
      case "status":
        this.status = event.status;
        return;

      case "message_start":
        this.#close(this.#thread(event.agentId));
        return;

      case "delta": {
        const thread = this.#thread(event.agentId);
        if (!thread.assistant) {
          thread.assistant = { id: this.#id("assistant"), text: "" };
          this.#push(event.agentId, {
            kind: "assistant",
            id: thread.assistant.id,
            text: "",
            streaming: true
          });
        }
        thread.assistant.text += event.text;
        this.#replace({
          kind: "assistant",
          id: thread.assistant.id,
          text: thread.assistant.text,
          streaming: true
        });
        return;
      }

      case "thinking_start": {
        const thread = this.#thread(event.agentId);
        if (thread.thinking) return;
        thread.thinking = { id: this.#id("thinking"), text: "", tokens: 0 };
        this.#push(event.agentId, {
          kind: "thinking",
          id: thread.thinking.id,
          text: "",
          tokens: 0,
          active: true
        });
        return;
      }

      case "thinking": {
        const thread = this.#thread(event.agentId);
        // Text can arrive without a start if the block opened before we
        // attached; opening one here keeps the prose rather than dropping it.
        if (!thread.thinking) {
          thread.thinking = { id: this.#id("thinking"), text: "", tokens: 0 };
          this.#push(event.agentId, {
            kind: "thinking",
            id: thread.thinking.id,
            text: "",
            tokens: 0,
            active: true
          });
        }
        thread.thinking.text += event.text;
        this.#replace({
          kind: "thinking",
          id: thread.thinking.id,
          text: thread.thinking.text,
          tokens: thread.thinking.tokens,
          active: true
        });
        return;
      }

      case "thinking_tokens": {
        // Not thread-scoped on the wire — it arrives with no `parent_tool_use_id`
        // — so it lands on the main thread's open block, which is where a
        // reader is looking.
        const thread = this.#thread(null);
        if (!thread.thinking) return;
        thread.thinking.tokens = event.estimatedTokens;
        this.#replace({
          kind: "thinking",
          id: thread.thinking.id,
          text: thread.thinking.text,
          tokens: event.estimatedTokens,
          active: true
        });
        return;
      }

      case "message_stop":
      case "message_delta":
        return;

      case "tool_use_start": {
        this.#close(this.#thread(event.agentId));
        const item: ToolItem = {
          kind: "tool",
          id: event.id,
          name: event.name,
          input: undefined,
          result: null,
          diff: null,
          subagent: null,
          children: []
        };
        this.#tools.set(item.id, item);
        this.#push(event.agentId, item);
        return;
      }

      case "tool_use": {
        this.#close(this.#thread(event.agentId));
        const todo = todoOpOf(event.input);
        const existing = this.#tool(event.id);

        if (todo) {
          // A todo call is NOT drawn as a tool card — it folds into the list.
          // The placeholder `tool_use_start` already pushed has to go, or the
          // transcript shows an empty card beside the list it became.
          if (existing) this.#drop(event.agentId, existing.id);
          this.#applyTodo(event.agentId, todo, event.id);
          // Remembered so the RESULT can be routed to the list rather than to a
          // card that no longer exists.
          this.#todoCalls.add(event.id);
          return;
        }

        const next: ToolItem = {
          kind: "tool",
          id: event.id,
          name: event.name,
          input: event.input,
          result: existing?.result ?? null,
          diff: fileDiffOf(event.name, event.input),
          subagent: existing?.subagent ?? null,
          children: existing?.children ?? []
        };
        if (existing) this.#setTool(next);
        else {
          this.#tools.set(next.id, next);
          this.#push(event.agentId, next);
        }
        return;
      }

      case "tool_result": {
        const result: ToolResult = {
          text: event.text,
          content: event.content,
          isError: event.isError,
          structured: event.structured
        };
        if (this.#todoCalls.has(event.toolUseId)) {
          this.#todoResult(event.agentId, event.toolUseId, result);
          return;
        }
        const existing = this.#tool(event.toolUseId);
        if (!existing) {
          // A result for a call we never saw start — a re-attach mid-turn. Show
          // it as its own card rather than dropping it on the floor.
          const orphan: ToolItem = {
            kind: "tool",
            id: event.toolUseId,
            name: "(tool)",
            input: undefined,
            result,
            diff: null,
            subagent: null,
            children: []
          };
          this.#tools.set(orphan.id, orphan);
          this.#push(event.agentId, orphan);
          return;
        }
        this.#setTool({ ...existing, result });
        return;
      }

      case "user_message":
        // Only a SUBAGENT's user message is an item: the main thread's user
        // turn is persisted by the service and rendered from the record, and
        // emitting it here too would double every question asked.
        if (event.agentId === null) return;
        this.#push(event.agentId, {
          kind: "user",
          id: this.#id("user"),
          text: event.text,
          at: null,
          fromAgent: true
        });
        return;

      case "subagent": {
        const toolUseId = event.toolUseId ?? this.#taskTool.get(event.taskId) ?? null;
        if (event.toolUseId) this.#taskTool.set(event.taskId, event.toolUseId);
        if (!toolUseId) return;
        const tool = this.#tool(toolUseId);
        if (!tool) return;
        const previous = tool.subagent;
        this.#setTool({
          ...tool,
          subagent: {
            taskId: event.taskId,
            subagentType: event.subagentType ?? previous?.subagentType ?? null,
            description: event.description ?? previous?.description ?? null,
            // `task_updated` carries the real state change on its patch, which
            // `claudeEvents` already flattened onto `status`.
            status: event.status ?? previous?.status ?? null,
            summary: event.summary ?? previous?.summary ?? null,
            lastToolName: event.lastToolName ?? previous?.lastToolName ?? null,
            totalTokens: event.totalTokens ?? previous?.totalTokens ?? null,
            durationMs: event.durationMs ?? previous?.durationMs ?? null,
            done: event.phase === "completed" || event.status === "completed" || previous?.done === true
          }
        });
        return;
      }

      case "rate_limit":
        // Only the states worth interrupting a reader for. A steady stream of
        // "allowed" events is the normal case and is not news.
        if (!event.status || event.status === "allowed") return;
        this.#push(null, {
          kind: "notice",
          id: this.#id("notice"),
          tone: "warn",
          title: `Rate limit: ${event.status}`,
          detail: event.resetsAt
            ? `resets at ${new Date(event.resetsAt * 1000).toLocaleTimeString()}`
            : event.isUsingOverage
              ? "running on overage"
              : null
        });
        return;

      case "hook":
        // Hooks are the CLI's own plumbing and fire constantly. A FAILING hook
        // is news; a successful one is not, and rendering both is how a
        // transcript becomes a log nobody reads.
        if (event.phase !== "response" || !event.exitCode) return;
        this.#push(null, {
          kind: "notice",
          id: this.#id("notice"),
          tone: "warn",
          title: `Hook ${event.name ?? event.event ?? ""} exited ${event.exitCode}`.trim(),
          detail: event.outcome ?? null
        });
        return;

      case "unknown":
        // The reason `claudeEvents.ts` emits `unknown` instead of dropping: a
        // CLI event kind added tomorrow shows up HERE, visibly, rather than
        // vanishing and leaving somebody to notice an absence.
        this.#push(null, {
          kind: "notice",
          id: this.#id("notice"),
          tone: "info",
          title: `Unrecognised CLI event: ${event.kind}`,
          detail: null,
          payload: event.event
        });
        return;

      case "session":
      case "result":
        // `session` is plumbing the service already hoisted and persisted, and
        // `result` is the terminal the service converts into `turn-done` —
        // rendering either would duplicate what the turn events already say.
        return;
    }
  }

  /* ------------------------------ service events ---------------------------- */

  event(event: ClaudeSessionEvent): void {
    switch (event.type) {
      case "conversation-started":
        return;
      case "turn-started":
        this.streaming = true;
        this.error = null;
        this.status = null;
        return;
      case "session":
        return;
      case "cli":
        this.#cli(event.event);
        return;
      case "turn-done":
        this.streaming = false;
        this.status = null;
        this.usage = event.usage;
        this.liveCostUsd += event.usage.costUsd;
        this.#finish();
        return;
      case "turn-error":
        this.streaming = false;
        this.status = null;
        this.error = event.message;
        this.#finish();
        this.#push(null, {
          kind: "notice",
          id: this.#id("notice"),
          tone: "error",
          title: "The turn failed",
          detail: event.message
        });
        return;
      case "turn-cancelled":
        this.streaming = false;
        this.status = null;
        this.#finish();
        this.#push(null, {
          kind: "notice",
          id: this.#id("notice"),
          tone: "warn",
          title: "Stopped",
          detail: "The CLI process was killed; everything above was still persisted."
        });
        return;
    }
  }

  /** Settle every open block when a turn terminates: a caret still blinking
   *  after the answer landed is the tell that a stream was never closed.
   *
   *  Every thread, not just the main one — a subagent whose last delta arrived
   *  before its parent's terminal would otherwise keep a live caret forever. */
  #finish(): void {
    for (const thread of this.#threads.values()) this.#close(thread);
  }

  #drop(agentId: string | null, id: string): void {
    const thread = this.#thread(agentId);
    const index = thread.items.findIndex((item) => item.id === id);
    if (index >= 0) thread.items.splice(index, 1);
    this.#tools.delete(id);
    this.#ownerOf.delete(id);
  }

  /** The main thread, with every subagent's items nested under its tool call. */
  items(): TranscriptItem[] {
    const attach = (items: readonly TranscriptItem[]): TranscriptItem[] =>
      items.map((item) => {
        if (item.kind !== "tool") return item;
        const children = this.#threads.get(item.id);
        return children ? { ...item, children: attach(children.items) } : item;
      });
    return attach(this.#thread(null).items);
  }
}

/* --------------------------------- the API ---------------------------------- */

/**
 * Fold live events into a transcript model.
 *
 * Called with the WHOLE event array each time rather than incrementally, which
 * is deliberate: an incremental fold has to be correct under React's
 * re-invocation, double-invocation in strict mode and an out-of-order attach,
 * and this one is a pure function of its input. The arrays are hundreds of
 * events, not millions, and `session.ts` memoises on the array identity so it
 * runs once per delta rather than once per render.
 */
export function foldEvents(events: readonly ClaudeSessionEvent[]): TranscriptModel {
  const fold = new Fold();
  for (const event of events) fold.event(event);
  return {
    items: fold.items(),
    streaming: fold.streaming,
    status: fold.status,
    usage: fold.usage,
    liveCostUsd: fold.liveCostUsd,
    error: fold.error
  };
}

/**
 * The persisted half: role and text, nothing more. Deliberately NOT dressed up
 * — there is no tool detail on disk, and inventing a card for a tool call the
 * store never recorded would be a transcript that claims to remember something
 * it does not.
 */
export function foldHistory(messages: readonly StoredMessage[]): TranscriptItem[] {
  return messages.map((message, index) =>
    message.role === "user"
      ? { kind: "user", id: `history-${index}`, text: message.text, at: message.at, fromAgent: false }
      : { kind: "assistant", id: `history-${index}`, text: message.text, streaming: false }
  );
}

/**
 * One turn's worth of the live half.
 *
 * ── why the live half is SEGMENTED and not one event array ───────────────────
 *
 * A session runs many turns, and the user message that opened each one is not
 * in the event stream: the service persists it before the CLI starts and never
 * emits it (`user_message` events with a null `agentId` are deliberately
 * dropped by the fold, or every question would appear twice). So the client
 * holds it — and if the live half were one flat array, every locally-held user
 * message would have to be positioned by remembering how many events had
 * arrived when it was typed. That is an index into a growing array, which is
 * the kind of bookkeeping that is correct until the day a turn is attached
 * rather than sent.
 *
 * A segment per turn makes the position structural instead: the message sits at
 * the head of its own turn, and a turn that was ATTACHED to rather than sent
 * carries `user: null`, because in that case the message is already in the
 * persisted history — the service wrote it before the CLI ran.
 *
 * Each segment also gets its own {@link Fold}, which is correct rather than
 * merely convenient: thinking blocks, tool cards and the todo list all belong
 * to a turn, and carrying a previous turn's open block into the next one is how
 * a completed answer keeps a blinking caret.
 */
export interface TurnSegment {
  readonly id: string;
  readonly user: { readonly text: string; readonly at: string } | null;
  readonly events: readonly ClaudeSessionEvent[];
}

/**
 * The whole transcript: persisted history up to `historyCount`, then one fold
 * per live turn.
 *
 * `historyCount` is the message count at the moment the conversation was
 * opened, and it does NOT move afterwards — see the file header. Refetching the
 * record for its cost and title must not re-slice the history, or the turn just
 * rendered from live events would be rendered a second time from disk.
 */
export function buildTranscript(
  messages: readonly StoredMessage[],
  historyCount: number,
  segments: readonly TurnSegment[]
): TranscriptModel {
  const items: TranscriptItem[] = [...foldHistory(messages.slice(0, Math.max(0, historyCount)))];
  let last: TranscriptModel = EMPTY_TRANSCRIPT;
  let liveCostUsd = 0;

  for (const segment of segments) {
    if (segment.user) {
      items.push({
        kind: "user",
        id: `sent-${segment.id}`,
        text: segment.user.text,
        at: segment.user.at,
        fromAgent: false
      });
    }
    last = foldEvents(segment.events);
    items.push(...last.items);
    liveCostUsd += last.liveCostUsd;
  }

  return {
    items,
    // The tail segment owns the live state: only the newest turn can be running,
    // and only its failure is the one the composer should still be showing.
    streaming: last.streaming,
    status: last.status,
    usage: last.usage,
    liveCostUsd,
    error: last.error
  };
}

/** Every code fence and tool output of a transcript, flattened — what "copy the
 *  whole transcript" writes, and what a search over the open conversation
 *  reads. */
export function transcriptText(items: readonly TranscriptItem[]): string {
  const out: string[] = [];
  const walk = (list: readonly TranscriptItem[], depth: number): void => {
    const pad = "  ".repeat(depth);
    for (const item of list) {
      switch (item.kind) {
        case "user":
          out.push(`${pad}${item.fromAgent ? "Subagent prompt" : "You"}: ${item.text}`);
          break;
        case "assistant":
          out.push(`${pad}Claude: ${item.text}`);
          break;
        case "thinking":
          if (item.text) out.push(`${pad}[thinking] ${item.text}`);
          break;
        case "tool":
          out.push(`${pad}[${item.name}] ${JSON.stringify(item.input ?? null)}`);
          if (item.result) out.push(`${pad}  → ${item.result.text}`);
          walk(item.children, depth + 1);
          break;
        case "todo":
          for (const todo of item.todos) out.push(`${pad}[${todo.status}] ${todo.subject}`);
          break;
        case "notice":
          out.push(`${pad}(${item.title}${item.detail ? `: ${item.detail}` : ""})`);
          break;
      }
    }
  };
  walk(items, 0);
  return out.join("\n\n");
}
