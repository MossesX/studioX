/**
 * @file The Claude subsystem's own vocabulary — project records, conversation
 * records and session events, as plain data.
 *
 * Everything a consumer sees crosses this file: the store persists a
 * {@link ConversationRecord}, the project store persists a
 * {@link ProjectRecord}, the service emits a {@link ClaudeSessionEvent}, the
 * routes serialise all three, and the extension-point payloads in `./points`
 * are typed against them.
 *
 * **Isomorphic on purpose.** Types and tiny pure helpers only; every import is
 * an `import type` and therefore fully erased (`isolatedModules` is on), so a
 * browser consumer — the P3 workspace, a plugin's panel — can share the
 * vocabulary without dragging `node:child_process` into its bundle. The
 * transport lives in `../server/claudeBroker`, the CLI-line normaliser in
 * `../server/claudeEvents`, the service in `./service`; the first and third are
 * server-only.
 *
 * ── the one vocabulary rule ──────────────────────────────────────────────────
 *
 * There is exactly ONE description of what the CLI said, and it is P0's
 * `BrokerEvent` union in `../server/claudeEvents` — written against a captured
 * transcript and replayed through fixtures by `test/claude-events.test.ts`.
 * This file does **not** restate it in a second, narrower shape. A service
 * event either belongs to the CONVERSATION (which the CLI knows nothing about:
 * turns, persistence, cancellation) or it is a CLI event carried verbatim
 * inside a `cli` envelope.
 *
 * That is a deliberate reversal of the pre-strip design, which re-mapped the
 * broker's stream into a second union of its own. Two consequences made it the
 * wrong shape and both are avoidable here:
 *
 *   1. **It silently lost events.** The re-map handled delta / thinking /
 *      tool-start / tool-input / tool-result. The capture proves the CLI also
 *      emits subagent lifecycle, hooks, rate limits, message start/stop and
 *      `unknown` — every one of which fell on the floor, which is precisely
 *      the failure `../server/claudeEvents` emits `unknown` to prevent.
 *   2. **It was a second thing to keep in step with the fixtures.** A CLI
 *      event kind added tomorrow reaches a consumer here with no edit; under a
 *      re-map it reaches the re-mapper's `else` and stops.
 *
 * The cost is that a consumer matching on a CLI event writes
 * `e.type === "cli" && e.event.type === "delta"` rather than
 * `e.type === "delta"`. That is the honest shape: it says out loud which half
 * of the vocabulary it is reading.
 */
import type { BrokerEvent, CliUsage } from "../server/claudeEvents";
import type { EffortLevel, PermissionMode } from "../server/claudeBroker";

export type { BrokerEvent, CliUsage, EffortLevel, PermissionMode };

/* --------------------------------- records ---------------------------------- */

export interface StoredMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  /** ISO 8601. */
  readonly at: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
}

/**
 * One conversation, exactly as it sits on disk — the P1 contract, field for
 * field: *"id, messages, CLI session id for --resume, cwd, model, effort,
 * permission mode"*, plus the bookkeeping a library needs to list it.
 *
 * The `format` tag is bumped on a shape change so a future migration reads
 * what it has rather than guessing. It is deliberately UNCHANGED from the
 * pre-strip subsystem (`axs-claude-conversation/1`): the fields below are that
 * record's P1 subset, nothing was renamed or given a new meaning, and a record
 * written by either reads correctly here.
 */
export interface ConversationRecord {
  readonly format: "axs-claude-conversation/1";
  readonly id: string;
  readonly title: string;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * The `claude --resume` session id, once the CLI has reported one. THIS is
   * what makes a conversation resumable after a server restart: the CLI holds
   * the history, this record holds the pointer to it, and the next turn puts
   * `--resume <id>` on the command line from here.
   */
  readonly cliSessionId?: string;
  /** Working directory CLI turns run in — what a tool call can see. */
  readonly cwd: string;
  /**
   * The model's catalog SLUG (`"sonnet-5"`), not its CLI id. The slug is what a
   * `.bmpx` step spells and what `MODEL_CATALOG` keys on; the cliId is derived
   * at turn time. Storing the derived form would pin a record to today's
   * spelling of a model that has already been renamed once
   * (`claude-haiku-4-5` → `claude-haiku-4-5-20251001`, the drift
   * `src/modules/buildmgr/models.ts` exists to have ended).
   */
  readonly model: string;
  /**
   * `claude --effort`, or **null for "do not pass the flag"**.
   *
   * Null is not "unset pending a default" — it is a value with a meaning: let
   * the CLI use whatever its own default is. `claude --help` documents the
   * four levels and states no default, so picking one here would be this
   * subsystem quietly overriding a decision it has no basis for, on every turn,
   * at a real difference in cost.
   */
  readonly effort: EffortLevel | null;
  readonly permissionMode: PermissionMode;
  /** System contract, prepended on a session's FIRST turn only — a `--resume`
   *  already carries it. */
  readonly system: string;
  /** Summed from every turn's reported cost. */
  readonly totalCostUsd: number;
  /**
   * Pinned in the library (P3).
   *
   * OPTIONAL, and the `format` tag is deliberately NOT bumped for it: a record
   * written before this field existed reads back as `undefined`, which is the
   * same answer as "not pinned", so every pre-P3 conversation is correct
   * without a migration. Bumping the tag would have made all of them read as
   * absent — core's recovery posture, applied where it does harm.
   */
  readonly pinned?: boolean;
  /**
   * The {@link ProjectRecord} this conversation belongs to, or absent when it
   * belongs to none (P4).
   *
   * OPTIONAL, and the `format` tag is again deliberately NOT bumped — same
   * argument as `pinned`: a record written before projects existed reads back
   * as `undefined`, which is exactly the right answer ("belongs to no
   * project"), so every pre-P4 conversation is correct without a migration.
   *
   * What it does NOT mean is "read the project for this conversation's
   * settings". `cwd`, `model`, `effort` and `permissionMode` above are COPIES
   * taken when the conversation started, and they stay authoritative — see
   * `./projects` for the argument, which is short: a resumed CLI session must
   * not have its working directory change underneath it. What IS read live
   * from the project, on the first turn only, is its instructions and its
   * knowledge files.
   */
  readonly projectId?: string;
  readonly messages: readonly StoredMessage[];
}

/** The list view — everything but the message bodies. */
export interface ConversationMeta {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cliSessionId?: string;
  readonly cwd: string;
  readonly model: string;
  readonly effort: EffortLevel | null;
  readonly permissionMode: PermissionMode;
  readonly totalCostUsd: number;
  readonly pinned: boolean;
  /** The project it belongs to, or null. On the META so a library can group and
   *  filter by project without loading every record — and so
   *  `removeProject()` can count what a delete would orphan from one `list()`. */
  readonly projectId: string | null;
  readonly messageCount: number;
  /**
   * The first ~160 characters of the first user message — what a library row
   * shows under the title when the title is still the minted default.
   *
   * On the META rather than fetched per row: a lobby of 200 conversations that
   * needs a preview would otherwise be 200 record reads, and the meta is
   * already computed from the record the store just loaded.
   */
  readonly preview: string;
}

/** How much of a message body a list row carries. Long enough to recognise the
 *  conversation, short enough that a 500-conversation list is still one small
 *  response. */
const PREVIEW_CHARS = 160;

export function previewOf(record: ConversationRecord): string {
  const first = record.messages.find((m) => m.role === "user");
  if (!first) return "";
  const flat = first.text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

export function toMeta(record: ConversationRecord): ConversationMeta {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    cliSessionId: record.cliSessionId,
    cwd: record.cwd,
    model: record.model,
    effort: record.effort,
    permissionMode: record.permissionMode,
    totalCostUsd: record.totalCostUsd,
    pinned: record.pinned === true,
    projectId: record.projectId ?? null,
    messageCount: record.messages.length,
    preview: previewOf(record)
  };
}

/* --------------------------------- projects ---------------------------------- */

/**
 * One file a project carries as knowledge — `axf-claude` P4.
 *
 * A PATH, never the contents. A knowledge file that was copied into the project
 * when it was added is a snapshot that silently goes stale, and the thing it
 * goes stale against is a file sitting right there on disk. So the project
 * stores where to look and the subsystem reads it at turn time; editing the
 * file is editing the knowledge, with nothing to re-sync.
 *
 * Relative paths resolve against the project's bound {@link ProjectRecord.cwd},
 * which is the common case and the one worth making short: a project bound to a
 * repo lists `README.md`, not `C:/Home/Projects/thing/README.md`. An absolute
 * path is accepted too — a shared style guide outside the tree is a real thing
 * to want, and this runs the owner's own CLI on the owner's own machine, where
 * a tool call can already read any file the account can.
 */
export interface KnowledgeFile {
  /** As authored: relative to the project's cwd, or absolute. */
  readonly path: string;
  /** Why this file is here. Reaches the model with the contents — a heading
   *  saying "the wire format the parser must accept" is worth more than the
   *  filename it sits above. */
  readonly note?: string;
}

/**
 * A project: instructions, knowledge files, default model/effort/permission
 * mode, and a BOUND WORKING DIRECTORY. `axf-claude` P4, verbatim: *"The bound
 * repo is what makes this better than the desktop app — the CLI already runs
 * with a cwd, so surface it deliberately rather than leaving it implicit."*
 *
 * `cwd` is therefore required and is the only required field with no default.
 * A project without one would be a folder of preferences; with one it is a
 * statement about which tree the work happens in, and every conversation
 * started under it inherits that tree rather than whatever the server process
 * happened to be launched from.
 */
export interface ProjectRecord {
  readonly format: "axs-claude-project/1";
  readonly id: string;
  readonly name: string;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly updatedAt: string;
  /** THE BOUND WORKING DIRECTORY — an existing absolute directory, validated
   *  when it is set. Every conversation in this project runs its CLI here. */
  readonly cwd: string;
  /** Prepended to the system contract of every conversation in this project,
   *  on its first turn. Empty is allowed: a project can be a bound directory
   *  and nothing else, and that is already worth having. */
  readonly instructions: string;
  readonly knowledge: readonly KnowledgeFile[];
  /** Catalog SLUG, as on a conversation and for the same reason. */
  readonly model: string;
  readonly effort: EffortLevel | null;
  readonly permissionMode: PermissionMode;
}

/**
 * What a knowledge file resolves to RIGHT NOW — the answer the manager screen
 * shows beside each row.
 *
 * This exists because the alternative is finding out at turn time. A missing
 * knowledge file is skipped when the contract is composed (injecting "this file
 * was missing" into a system prompt is telling the model about the operator's
 * mistake, which helps nobody), so without a resolution readout the failure is
 * silent and costs a turn to notice. Showing it in the editor moves the whole
 * class of typo to before the money is spent.
 */
export interface KnowledgeStatus {
  /** As authored. */
  readonly path: string;
  /** Absolute, after resolution against the project's cwd. */
  readonly resolved: string;
  readonly exists: boolean;
  /** Size on disk; 0 when it does not exist or is not a file. */
  readonly bytes: number;
  /** True when this file will be cut short at turn time by the per-file cap. */
  readonly truncated: boolean;
  /** Set when the path resolves to something that is not a readable file. */
  readonly error?: string;
}

/**
 * Shape an untrusted knowledge list without judging it — what both project
 * routes run their JSON body through.
 *
 * SHAPE only. Every question of validity (an empty path, a duplicate, the file
 * cap) belongs to the service, which refuses each by name, and re-asking any of
 * them here would be the second validator that goes out of date. The one thing
 * this does is stop a `null` entry from becoming `null.path` and a 500: a
 * missing path becomes `""`, which is precisely the case the service's "a
 * knowledge file needs a non-empty path" exists to answer.
 *
 * Here rather than in a route because a Next route module may only export its
 * handlers — an exported helper beside them fails the generated route types.
 */
export function coerceKnowledge(value: unknown): KnowledgeFile[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = (entry ?? {}) as { path?: unknown; note?: unknown };
    return {
      path: typeof item.path === "string" ? item.path : "",
      ...(typeof item.note === "string" ? { note: item.note } : {})
    };
  });
}

/* ---------------------------------- search ---------------------------------- */

/**
 * One matched message inside a conversation — the LIBRARY's unit of a hit
 * (P3: *"full-text search across message bodies"*).
 *
 * It carries an excerpt rather than the message, because a search over a long
 * transcript that returns the bodies is a response the size of the corpus. The
 * offsets are into the EXCERPT, so a renderer highlights without re-running the
 * matcher and cannot disagree with the server about where the match was.
 */
export interface SearchMatch {
  /** Index into `ConversationRecord.messages`. */
  readonly index: number;
  readonly role: "user" | "assistant";
  readonly at: string;
  readonly excerpt: string;
  /** `[start, end)` ranges within `excerpt`. */
  readonly ranges: readonly (readonly [number, number])[];
}

export interface SearchHit {
  readonly meta: ConversationMeta;
  /** True when the query matched the TITLE — a hit with no message match is
   *  still a hit, and saying which is why the field exists. */
  readonly titleMatched: boolean;
  readonly matches: readonly SearchMatch[];
  /** Total matching messages, which may exceed `matches.length` when capped. */
  readonly matchCount: number;
}

/* ---------------------------------- events ---------------------------------- */

/** A turn's tally. The CLI's own `total_cost_usd` where it reported one — that
 *  figure is authoritative, being what the account was actually charged, cache
 *  tiers included. */
export interface TurnUsage extends CliUsage {
  readonly costUsd: number;
}

/**
 * What the service emits — to `send()`'s own stream, to `stream()` attachers,
 * to `observe()` listeners and to every `claude.session-observer` contribution
 * alike. One vocabulary, so **an observer cannot be told less than the
 * caller**; that is what makes "a plugin follows a build it started" a read of
 * the same stream rather than a second protocol.
 *
 * A turn ends with exactly one of `turn-done`, `turn-error` or
 * `turn-cancelled` — the broker's one-terminal-event contract, lifted a level.
 */
export type ClaudeSessionEvent =
  | { type: "conversation-started"; conversationId: string; at: string }
  | {
      type: "turn-started";
      conversationId: string;
      turnId: string;
      /** The CLI id actually put on the command line. */
      model: string;
      /** True when this turn resumes an existing CLI session via `--resume`. */
      resume: boolean;
      at: string;
    }
  /**
   * The CLI reported the session id this turn runs under.
   *
   * Hoisted out of the `cli` envelope — and therefore delivered twice, once
   * here and once raw — because it is the only event whose meaning is a
   * CONVERSATION fact rather than a stream fact: from now on this conversation
   * is resumable. The store persists on exactly this event, so a turn that
   * dies before its terminal still leaves a resumable record behind.
   */
  | { type: "session"; conversationId: string; turnId: string; cliSessionId: string }
  /** A CLI event, verbatim — the whole of `BrokerEvent`, `unknown` included. */
  | { type: "cli"; conversationId: string; turnId: string; event: BrokerEvent }
  | {
      type: "turn-done";
      conversationId: string;
      turnId: string;
      /** The turn's final assistant text, as the broker assembled it. */
      text: string;
      usage: TurnUsage;
      cliSessionId?: string;
      at: string;
    }
  | { type: "turn-error"; conversationId: string; turnId: string; message: string; at: string }
  | { type: "turn-cancelled"; conversationId: string; turnId: string; at: string };

const TERMINAL: ReadonlySet<ClaudeSessionEvent["type"]> = new Set([
  "turn-done",
  "turn-error",
  "turn-cancelled"
]);

export function isTerminalEvent(event: ClaudeSessionEvent): boolean {
  return TERMINAL.has(event.type);
}

/** Assistant prose out of a stream of session events, main thread only.
 *
 *  A convenience for consumers, and the one place the `cli` envelope's shape is
 *  spelled out for them — a subagent's prose is its own work, not the answer,
 *  which is why `agentId === null` is part of the definition rather than a
 *  caller's option. */
export function assistantTextOf(events: readonly ClaudeSessionEvent[]): string {
  let text = "";
  for (const event of events) {
    if (event.type !== "cli") continue;
    if (event.event.type === "delta" && event.event.agentId === null) text += event.event.text;
  }
  return text;
}
