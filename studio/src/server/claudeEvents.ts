/**
 * @file Translates one line of `claude --output-format stream-json` into the
 * normalised event vocabulary the rest of AmberX consumes.
 *
 * ── written against a CAPTURE, not against an assumed shape ──────────────────
 *
 * `axf-claude.bmpx` P0 makes this non-negotiable: *"DESIGN AGAINST A CAPTURED
 * TRANSCRIPT, NOT AN IMAGINED ONE."* Every branch below exists because a real
 * event of that kind is sitting in `test/fixtures/claude-stream/`, captured
 * from CLI **2.1.229** on 2026-08-12. `test/claude-events.test.ts` replays
 * those fixtures through this file, so the two cannot drift apart silently.
 *
 * Five things the capture taught that an assumed shape would have got wrong,
 * each of which would have been a live bug:
 *
 *  1. **A failed turn has no `result` field.** `capture-c` (a resume against a
 *     dead session id) is `subtype:"error_during_execution"` with the reason
 *     ONLY in `errors: [...]`. GizmoX's broker reads `r.result` for the error
 *     message and would have reported an empty string.
 *  2. **`assistant` whole-messages are per-MESSAGE, not per-turn.** `capture-a`
 *     has seven of them in one turn (a tool loop). GizmoX's broker does
 *     `text = whole`, which keeps only the last — fine for a chat pane with no
 *     tools, silent truncation here. The turn's authoritative final text is
 *     `result.result`.
 *  3. **`tool_result.content` is polymorphic** — a plain string, or an array of
 *     `{type:"text"}` / `{type:"tool_reference"}` blocks. It is forwarded
 *     verbatim, with a flattened `text` alongside for the simple case.
 *  4. **Subagent traffic is interleaved into the same stream** and is only
 *     distinguishable by `parent_tool_use_id`. Every event therefore carries
 *     `agentId` (`null` = the main thread), which is what lets a UI nest a
 *     subagent's work under the tool call that spawned it instead of
 *     scrambling it into the transcript.
 *  5. **Thinking text is sometimes REDACTED, and the block streams anyway.**
 *     `capture-a` (sonnet-5, `--effort high`) has ten `thinking_delta` events
 *     carrying an EMPTY string — while the same turn reports 813 thinking
 *     tokens. `capture-b` (haiku-4-5) has twenty-nine, all with real prose. So
 *     thinking text is not guaranteed even when the model demonstrably thought,
 *     and a UI that only reacts to thinking TEXT shows a frozen screen for the
 *     redacted case. That is why `thinking_start` is its own event: it fires
 *     off `content_block_start`, before any text exists, and
 *     `thinking_tokens` gives the progress number when the prose never comes.
 *
 * ── the permission finding ───────────────────────────────────────────────────
 *
 * Headless `-p` mode has **no interactive permission request**. Four captures
 * went looking for one:
 *   - `--disallowed-tools Bash` (capture-b) REMOVES the tool — the model never
 *     asks, and `permission_denials` stays empty. Disallowed ≠ denied.
 *   - a `permissions.deny` rule (capture-e) surfaces as a normal `tool_result`
 *     with `is_error:true` and a `<tool_use_error>` payload.
 * So the renderable failure channel is the error tool_result, and
 * `result.permission_denials[]` is the post-hoc ledger. A UI built expecting a
 * prompt-shaped event would have waited for something this transport never
 * sends.
 *
 * ── deliberately NOT forwarded (decisions, not oversights) ───────────────────
 *
 *  - `content_block_delta[input_json_delta]` — partial, unparseable JSON. The
 *    complete input arrives moments later on the `assistant` message, which is
 *    authoritative. A streaming-argument view can add it at P3.
 *  - `content_block_delta[signature_delta]` — a thinking-block crypto
 *    signature. Not renderable, and large.
 *  - `content_block_stop` — the `assistant` message already delimits blocks.
 *
 * Anything NOT recognised becomes `{type:"unknown"}` rather than being dropped.
 * That is the point: when the CLI grows an event kind, it shows up in the UI as
 * an unknown event instead of vanishing, so nobody has to notice an absence.
 */

/** `parent_tool_use_id` — `null` on the main thread, a `toolu_…` id inside a
 *  subagent. The thread key for the whole vocabulary. */
export type AgentId = string | null;

export interface CliUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
}

export type BrokerEvent =
  /** `system/init` — the first line of every run. Carries the session id a
   *  later `--resume` needs, so a client must persist it. */
  | {
      type: "session";
      sessionId: string;
      model?: string;
      cwd?: string;
      permissionMode?: string;
      tools?: string[];
    }
  /** `system/status` — coarse lifecycle ("requesting", …). */
  | { type: "status"; status: string }
  | { type: "message_start"; messageId?: string; model?: string; agentId: AgentId }
  /** Assistant prose, incrementally. Named `delta` to match the vocabulary the
   *  GizmoX broker already speaks. */
  | { type: "delta"; text: string; agentId: AgentId }
  /** A thinking block opened. Emitted SEPARATELY from its text because the text
   *  may never come — see finding 5. This is the event a UI hangs "Thinking…"
   *  on; `thinking` and `thinking_tokens` fill it in if and when they arrive. */
  | { type: "thinking_start"; agentId: AgentId }
  /** Extended-thinking prose, incrementally. Separate from `delta` so a UI can
   *  fold it — it is not the answer. */
  | { type: "thinking"; text: string; agentId: AgentId }
  | { type: "thinking_tokens"; estimatedTokens: number }
  | { type: "message_delta"; stopReason?: string; outputTokens?: number; agentId: AgentId }
  | { type: "message_stop"; agentId: AgentId }
  /** A tool call has begun; `input` is not known yet. Lets a UI show "calling
   *  Bash…" during the (sometimes long) argument stream. */
  | { type: "tool_use_start"; id: string; name: string; agentId: AgentId }
  /** The complete, authoritative tool call. */
  | { type: "tool_use"; id: string; name: string; input: unknown; agentId: AgentId }
  | {
      type: "tool_result";
      toolUseId: string;
      /** Verbatim: a string, or an array of content blocks. */
      content: unknown;
      /** Flattened text where that is meaningful — convenience, not the truth. */
      text: string;
      isError: boolean;
      /** The CLI's structured `tool_use_result` sidecar, when present. */
      structured?: unknown;
      agentId: AgentId;
    }
  /** A user-role message. Inside a subagent (`agentId` set) this is the
   *  subagent's own prompt, which is worth showing under its task. */
  | { type: "user_message"; text: string; agentId: AgentId; subagentType?: string }
  /** `system/task_*` — the subagent lifecycle. */
  | {
      type: "subagent";
      phase: "started" | "progress" | "updated" | "completed";
      taskId: string;
      toolUseId?: string;
      subagentType?: string;
      description?: string;
      summary?: string;
      status?: string;
      lastToolName?: string;
      totalTokens?: number;
      durationMs?: number;
    }
  | {
      type: "hook";
      phase: "started" | "response";
      name?: string;
      event?: string;
      outcome?: string;
      exitCode?: number;
    }
  | {
      type: "rate_limit";
      status?: string;
      rateLimitType?: string;
      resetsAt?: number;
      isUsingOverage?: boolean;
    }
  /** The terminal line. `runCliChat` converts this into `done`/`error`; it is
   *  its own event so the normaliser stays pure and testable. */
  | {
      type: "result";
      isError: boolean;
      /** Absent on the error path — see finding 1. */
      text?: string;
      /** Populated from `errors[]` when `text` is absent. */
      errors: string[];
      subtype?: string;
      sessionId?: string;
      costUsd?: number;
      durationMs?: number;
      numTurns?: number;
      usage: CliUsage;
      permissionDenials: unknown[];
    }
  /** A line that did not parse as JSON, or a kind this file does not know.
   *  Emitted rather than swallowed — see the header. */
  | { type: "unknown"; kind: string; event: unknown };

/* ------------------------------- tiny accessors ----------------------------- */

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function agentOf(line: Record<string, unknown>): AgentId {
  return str(line.parent_tool_use_id) ?? null;
}

/** Usage lives in three different shapes across the stream; this reads the one
 *  on `result`, which is the only complete tally. Cache tokens are separate
 *  fields and are NOT included in `input_tokens` — a cost display that adds
 *  only `input_tokens` under-reports a cached turn by orders of magnitude
 *  (capture-a: 67 input vs 464,153 cache-read). */
function readUsage(v: unknown): CliUsage {
  const u = obj(v);
  const details = obj(u?.output_tokens_details);
  return {
    inputTokens: num(u?.input_tokens) ?? 0,
    outputTokens: num(u?.output_tokens) ?? 0,
    cacheReadTokens: num(u?.cache_read_input_tokens) ?? 0,
    cacheCreationTokens: num(u?.cache_creation_input_tokens) ?? 0,
    thinkingTokens: num(details?.thinking_tokens) ?? 0
  };
}

/** Flatten a `tool_result.content` into text where that means anything. Both
 *  observed array shapes carry their prose on `.text`; a `tool_reference` block
 *  has none and contributes nothing. */
function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => str(obj(b)?.text) ?? "")
      .filter(Boolean)
      .join("");
  }
  return "";
}

/* --------------------------------- the switch ------------------------------- */

/**
 * Normalise ONE raw stream-json line. Pure and stateless — accumulation is the
 * caller's job — so a fixture can be replayed through it with no process, no
 * clock and no network. Returns zero or more events; zero is a legitimate
 * answer for the deliberately-dropped kinds listed in the header.
 */
export function normaliseCliEvent(raw: unknown): BrokerEvent[] {
  const line = obj(raw);
  if (!line) return [{ type: "unknown", kind: "non-object", event: raw }];
  const agentId = agentOf(line);

  switch (str(line.type)) {
    /* ------------------------------------------------------------- system */
    case "system": {
      const subtype = str(line.subtype);
      switch (subtype) {
        case "init": {
          const sessionId = str(line.session_id);
          if (!sessionId) return [{ type: "unknown", kind: "system/init-no-session", event: raw }];
          return [
            {
              type: "session",
              sessionId,
              model: str(line.model),
              cwd: str(line.cwd),
              permissionMode: str(line.permissionMode),
              tools: arr(line.tools).filter((t): t is string => typeof t === "string")
            }
          ];
        }
        case "status": {
          const status = str(line.status);
          return status ? [{ type: "status", status }] : [];
        }
        case "thinking_tokens":
          return [{ type: "thinking_tokens", estimatedTokens: num(line.estimated_tokens) ?? 0 }];
        case "hook_started":
        case "hook_response":
          return [
            {
              type: "hook",
              phase: subtype === "hook_started" ? "started" : "response",
              name: str(line.hook_name),
              event: str(line.hook_event),
              outcome: str(line.outcome),
              exitCode: num(line.exit_code)
            }
          ];
        case "task_started":
        case "task_progress":
        case "task_updated":
        case "task_notification": {
          const taskId = str(line.task_id);
          if (!taskId) return [{ type: "unknown", kind: `system/${subtype}-no-task`, event: raw }];
          // `task_notification` is the completion line; `task_updated` carries a
          // `patch` whose `status` is the real state change.
          const patch = obj(line.patch);
          const usage = obj(line.usage);
          const phase =
            subtype === "task_started"
              ? "started"
              : subtype === "task_progress"
                ? "progress"
                : subtype === "task_updated"
                  ? "updated"
                  : "completed";
          return [
            {
              type: "subagent",
              phase,
              taskId,
              toolUseId: str(line.tool_use_id),
              subagentType: str(line.subagent_type),
              description: str(line.description),
              summary: str(line.summary),
              status: str(line.status) ?? str(patch?.status),
              lastToolName: str(line.last_tool_name),
              totalTokens: num(usage?.total_tokens),
              durationMs: num(usage?.duration_ms)
            }
          ];
        }
        default:
          return [{ type: "unknown", kind: `system/${subtype ?? "?"}`, event: raw }];
      }
    }

    /* -------------------------------------------------------- stream_event */
    case "stream_event": {
      const ev = obj(line.event);
      if (!ev) return [{ type: "unknown", kind: "stream_event/no-event", event: raw }];
      switch (str(ev.type)) {
        case "message_start": {
          const msg = obj(ev.message);
          return [
            { type: "message_start", messageId: str(msg?.id), model: str(msg?.model), agentId }
          ];
        }
        case "content_block_start": {
          const block = obj(ev.content_block);
          const kind = str(block?.type);
          if (kind === "thinking") return [{ type: "thinking_start", agentId }];
          if (kind !== "tool_use") return [];
          const id = str(block?.id);
          const name = str(block?.name);
          return id && name ? [{ type: "tool_use_start", id, name, agentId }] : [];
        }
        case "content_block_delta": {
          const delta = obj(ev.delta);
          const kind = str(delta?.type);
          if (kind === "text_delta") {
            const text = str(delta?.text);
            return text ? [{ type: "delta", text, agentId }] : [];
          }
          if (kind === "thinking_delta") {
            const text = str(delta?.thinking);
            return text ? [{ type: "thinking", text, agentId }] : [];
          }
          // input_json_delta / signature_delta — dropped on purpose (header).
          if (kind === "input_json_delta" || kind === "signature_delta") return [];
          return [{ type: "unknown", kind: `content_block_delta/${kind ?? "?"}`, event: raw }];
        }
        case "message_delta": {
          const delta = obj(ev.delta);
          return [
            {
              type: "message_delta",
              stopReason: str(delta?.stop_reason),
              outputTokens: num(obj(ev.usage)?.output_tokens),
              agentId
            }
          ];
        }
        case "message_stop":
          return [{ type: "message_stop", agentId }];
        case "content_block_stop":
          return []; // dropped on purpose (header)
        default:
          return [{ type: "unknown", kind: `stream_event/${str(ev.type) ?? "?"}`, event: raw }];
      }
    }

    /* ----------------------------------------------------------- assistant */
    case "assistant": {
      // Whole-message: authoritative for tool calls (complete input) and the
      // ONLY place a tool call's arguments arrive intact. Text and thinking are
      // skipped here — they already streamed as deltas, and re-emitting them
      // would double every assistant message in the transcript.
      const blocks = arr(obj(line.message)?.content);
      const out: BrokerEvent[] = [];
      for (const b of blocks) {
        const block = obj(b);
        if (str(block?.type) !== "tool_use") continue;
        const id = str(block?.id);
        const name = str(block?.name);
        if (id && name) out.push({ type: "tool_use", id, name, input: block?.input, agentId });
      }
      return out;
    }

    /* ---------------------------------------------------------------- user */
    case "user": {
      const blocks = arr(obj(line.message)?.content);
      const out: BrokerEvent[] = [];
      for (const b of blocks) {
        const block = obj(b);
        const kind = str(block?.type);
        if (kind === "tool_result") {
          const toolUseId = str(block?.tool_use_id);
          if (!toolUseId) continue;
          out.push({
            type: "tool_result",
            toolUseId,
            content: block?.content,
            text: flattenContent(block?.content),
            isError: block?.is_error === true,
            structured: line.tool_use_result,
            agentId
          });
        } else if (kind === "text") {
          const text = str(block?.text);
          if (text) {
            out.push({ type: "user_message", text, agentId, subagentType: str(line.subagent_type) });
          }
        }
      }
      return out;
    }

    /* --------------------------------------------------------- rate limits */
    case "rate_limit_event": {
      const info = obj(line.rate_limit_info);
      return [
        {
          type: "rate_limit",
          status: str(info?.status),
          rateLimitType: str(info?.rateLimitType),
          resetsAt: num(info?.resetsAt),
          isUsingOverage: info?.isUsingOverage === true
        }
      ];
    }

    /* -------------------------------------------------------------- result */
    case "result": {
      const errors = arr(line.errors).filter((e): e is string => typeof e === "string");
      return [
        {
          type: "result",
          isError: line.is_error === true,
          text: str(line.result),
          errors,
          subtype: str(line.subtype),
          sessionId: str(line.session_id),
          costUsd: num(line.total_cost_usd),
          durationMs: num(line.duration_ms),
          numTurns: num(line.num_turns),
          usage: readUsage(line.usage),
          permissionDenials: arr(line.permission_denials)
        }
      ];
    }

    default:
      return [{ type: "unknown", kind: str(line.type) ?? "?", event: raw }];
  }
}

/** Parse then normalise one raw NDJSON line. A line that is not JSON becomes an
 *  `unknown` event rather than being skipped — a silently-skipped line is how a
 *  truncated stream reads as a short answer. */
export function normaliseCliLine(line: string): BrokerEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  try {
    return normaliseCliEvent(JSON.parse(trimmed));
  } catch {
    return [{ type: "unknown", kind: "unparseable-line", event: trimmed.slice(0, 500) }];
  }
}
