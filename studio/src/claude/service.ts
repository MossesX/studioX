/**
 * @file THE public service API of the Claude subsystem — `axf-claude` P1.
 *
 * Every consumer goes through this file: the HTTP routes under
 * `app/api/claude/conversations/`, the P3 workspace module when it lands, the
 * Build Manager plugin when the owner builds it, and the consumer-proof route
 * that stands in for it today. **The API is the product; the UI is a
 * consumer.** Nothing outside `src/claude/` may import `./store` or the broker
 * directly — a module reaching into subsystem internals is the private back
 * door this design exists to refuse, and the consumer proof greps for exactly
 * that.
 *
 * The verbs are the plan's, verbatim:
 *
 *   `start(opts)`      create a persisted conversation
 *   `send(id, text)`   run one turn through the local `claude` CLI
 *   `stream(id)`       attach to a conversation's live events (replays the
 *                      active turn's buffer first, ends after one terminal)
 *   `resume(id)`       load a conversation from disk — after a restart, this
 *                      plus the stored `cliSessionId` is what `--resume` runs on
 *   `cancel(id)`       KILL the running CLI child, not merely close a reader —
 *                      a CLI left running after stop is a cost leak with no UI
 *
 * plus the accessors a lobby needs (`get`, `list`, `activeTurn`) and
 * `observe(listener)`, the dynamic twin of the `claude.session-observer`
 * extension point. Every event is fanned out identically to `send()`'s own
 * stream, to `stream()` attachers, to `observe()` listeners and to every
 * registered `claude.session-observer` contribution — an observer cannot be
 * told less than the caller, which is what makes "a plugin follows a build it
 * started" a read of the same stream rather than a second protocol.
 *
 * ── what this file does NOT do ───────────────────────────────────────────────
 *
 * It does not re-map the CLI's stream. The transport emits P0's `BrokerEvent`
 * vocabulary, pinned to captured fixtures, and everything that is not a
 * terminal (`done` / `error`) is carried through in a `cli` envelope with the
 * conversation and turn stamped on it. `./types` states why at length; the
 * short version is that the pre-strip re-map silently dropped five event kinds
 * the capture proves the CLI emits.
 *
 * ── the LIBRARY verbs (P3, 2026-08-13) ──────────────────────────────────────
 *
 *   `rename(id, title)`   retitle a conversation
 *   `setPinned(id, on)`   pin it to the top of the library
 *   `remove(id)`          delete it, refusing while a turn is live
 *   `search(query)`       full-text across message bodies
 *
 * They are HERE rather than in the workspace module for the reason the header
 * already gives: nothing outside `src/claude/` may reach `./store`, and a
 * module that owned rename would have had to. The module is a consumer of these
 * exactly as the Build Manager plugin will be — which is the property the
 * consumer proof exists to keep true, and it greps for the violation.
 *
 * The matcher itself is `./search`, pure and isomorphic, so the library pane
 * filtering a record it already holds and this method scanning the store agree
 * on what "matches" means by construction rather than by both being careful.
 *
 * ── the PROJECT verbs (P4, 2026-08-13) ──────────────────────────────────────
 *
 *   `createProject(init)`      a bound directory, instructions, knowledge files
 *   `listProjects()`           every project, by name
 *   `getProject(id)`           one, or null
 *   `updateProject(id, patch)` a partial edit, each field validated as at create
 *   `removeProject(id, opts)`  refused while conversations belong to it, unless
 *                              told to detach them first
 *   `projectKnowledge(id)`     what each knowledge file resolves to right now
 *
 * and `start({ projectId })`, which is where the inheritance happens.
 * `./projects` states the rule and the reason at length; the short version is
 * that `cwd` / `model` / `effort` / `permissionMode` are COPIED onto the
 * conversation at start (so a `--resume` cannot have its tree moved underneath
 * it), while `instructions` and `knowledge` are read LIVE on the first turn (so
 * a knowledge file is the file, not a snapshot of it). `cwd` is BOUND rather
 * than defaulted: a `cwd` option disagreeing with the project's is refused,
 * because a conversation filed under a project but running somewhere else is a
 * lie in the library's most useful column.
 *
 * The transport is injectable (tests script it); the default is the P0 broker
 * — the local CLI on the owner's subscription, no API key anywhere. The
 * singleton lives on `globalThis` because Next's dev server re-evaluates
 * modules on edit, and a second service copy racing the first over the same
 * child processes is the per-runtime registry bug all over again.
 *
 * **Node-only.** Pulls in the broker (`node:child_process`) and the store
 * (`node:fs`); must never reach a client bundle. The isomorphic surface —
 * subsystem, points, vocabulary — lives in `./claude.subsystem`, `./points`
 * and `./types`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { registry, Registry } from "@axf/core";

import { kvUser } from "../server/axfKv";
import {
  clampTimeoutS,
  isEffortLevel,
  isPermissionMode,
  runCliChat,
  type BrokerChatParams,
  type BrokerEmit,
  type BrokerWireMessage,
  type CostFn,
  type EffortLevel,
  type PermissionMode
} from "../server/claudeBroker";
import type { BrokerEvent, CliUsage } from "../server/claudeEvents";
// The model catalog is the ONE roster — `app/api/claude/route.ts` reads it for
// the same reason and its header records the outstanding refactor: the catalog
// now has two non-module consumers and wants a neutral home. Moving it is a
// refactor of a working path, not this step; re-listing the models here to
// avoid the reach would be the drift that file exists to have ended.
import { MODEL_CATALOG, DEFAULT_TIER, resolveModel } from "../modules/buildmgr/models";
import {
  CLAUDE_CONTEXT_PROVIDER_POINT,
  CLAUDE_SESSION_OBSERVER_POINT,
  declareClaudePoints,
  type ClaudeContextProviderPayload,
  type ClaudeSessionObserverPayload
} from "./points";
import {
  composeProjectSystem,
  loadKnowledge,
  MAX_PROJECT_NAME,
  KNOWLEDGE_LIMITS,
  ProjectStore,
  resolveKnowledge
} from "./projects";
import { orderHits, parseQuery, searchRecord } from "./search";
import { ConversationStore } from "./store";
import type {
  ClaudeSessionEvent,
  ConversationMeta,
  ConversationRecord,
  KnowledgeFile,
  KnowledgeStatus,
  ProjectRecord,
  SearchHit,
  StoredMessage,
  TurnUsage
} from "./types";
import { isTerminalEvent } from "./types";

// Part of the public surface: a consumer validates an id without touching the
// store it guards.
export { isConversationId } from "./store";
export { isProjectId } from "./projects";

/* ------------------------------ the event queue ------------------------------ */

/** Single-consumer async queue — the seam between a callback-shaped transport
 *  and the async-iterable-shaped API. */
class EventQueue<T> {
  #buffer: T[] = [];
  #waiter: ((r: IteratorResult<T>) => void) | null = null;
  #ended = false;

  push(value: T): void {
    if (this.#ended) return;
    if (this.#waiter) {
      const resolve = this.#waiter;
      this.#waiter = null;
      resolve({ value, done: false });
    } else {
      this.#buffer.push(value);
    }
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    if (this.#waiter) {
      const resolve = this.#waiter;
      this.#waiter = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.#buffer.length) {
          return Promise.resolve({ value: this.#buffer.shift() as T, done: false });
        }
        if (this.#ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.#waiter = resolve;
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      }
    };
  }
}

/* ---------------------------------- types ------------------------------------ */

/** The broker's shape, named — what a test injects a fake of. */
export type ClaudeTransport = (
  params: BrokerChatParams,
  emit: BrokerEmit,
  onAbort: (fn: () => void) => void,
  costUsd?: CostFn
) => Promise<void>;

export interface StartOptions {
  readonly title?: string;
  /** A catalog slug or CLI id. An UNKNOWN model is refused — see `#model`. */
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: string;
  readonly system?: string;
  /** Absolute existing directory the CLI runs in; anything else is refused.
   *  Under a project this is BOUND: supplying one that disagrees with the
   *  project's bound directory is refused rather than quietly winning. */
  readonly cwd?: string;
  /**
   * The project this conversation belongs to (P4). Its bound directory becomes
   * the conversation's cwd; its model / effort / permission mode become the
   * defaults for the three options above; its instructions and knowledge files
   * are folded into the system contract on the first turn.
   */
  readonly projectId?: string;
}

/** What `createProject()` is given. Everything is validated before anything is
 *  written, so a refusal never leaves a half-configured project on disk. */
export interface ProjectOptions {
  readonly name: string;
  /** REQUIRED, and must be an existing directory — a project without a bound
   *  tree is a folder of preferences. */
  readonly cwd: string;
  readonly instructions?: string;
  readonly knowledge?: readonly KnowledgeFile[];
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: string;
}

/** A partial edit. An absent field is left alone; a present one is validated
 *  exactly as it is at create, because two validators is how one of them ends
 *  up out of date. */
export type ProjectPatch = Partial<ProjectOptions>;

export interface SendOptions {
  readonly timeoutS?: number;
}

export interface TurnResult {
  readonly conversationId: string;
  readonly turnId: string;
  readonly ok: boolean;
  readonly cancelled: boolean;
  readonly text: string;
  readonly error?: string;
  readonly cliSessionId?: string;
}

export interface TurnHandle {
  readonly conversationId: string;
  readonly turnId: string;
  /** This turn's events, first to terminal. The same stream every observer gets. */
  readonly events: AsyncIterable<ClaudeSessionEvent>;
  /** Resolves when the turn reaches its terminal event and is persisted. */
  readonly done: Promise<TurnResult>;
}

interface Envelope {
  readonly seq: number;
  readonly event: ClaudeSessionEvent;
}

interface ActiveTurn {
  readonly conversationId: string;
  readonly turnId: string;
  readonly buffer: Envelope[];
  readonly kills: (() => void)[];
  cancelled: boolean;
}

const EMPTY_USAGE: CliUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  thinkingTokens: 0
};

/**
 * The FALLBACK price of a turn, and only that: `runCliChat` prefers the CLI's
 * own `total_cost_usd`, which is what the account was actually charged, cache
 * tiers included. A local rate table cannot know that (capture-a: 67 input
 * tokens against 464,153 cache-read), so this exists for the turn that ends
 * without a `result` line, not as a second opinion.
 */
export const catalogCost: CostFn = (model, usage) => {
  const info = resolveModel(model);
  if (!info) return 0;
  return (
    ((usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens) / 1e6) *
      info.inPerMTok +
    (usage.outputTokens / 1e6) * info.outPerMTok
  );
};

/* --------------------------------- service ----------------------------------- */

export class ClaudeService {
  readonly #store: ConversationStore;
  readonly #projects: ProjectStore;
  readonly #transport: ClaudeTransport;
  readonly #registry: Registry;
  readonly #subscribers = new Set<EventQueue<Envelope>>();
  readonly #turns = new Map<string, ActiveTurn>();
  #seq = 0;

  constructor(opts?: {
    store?: ConversationStore;
    projects?: ProjectStore;
    transport?: ClaudeTransport;
    points?: Registry;
  }) {
    this.#store = opts?.store ?? new ConversationStore();
    this.#projects = opts?.projects ?? new ProjectStore();
    this.#transport = opts?.transport ?? runCliChat;
    this.#registry = opts?.points ?? registry;
    // A route may run before (or without) the studio kernel booting on this
    // runtime; the points must exist before a contribution can land on them.
    declareClaudePoints(this.#registry);
  }

  /* ------------------------------- fan-out ---------------------------------- */

  #deliver(event: ClaudeSessionEvent): void {
    const envelope: Envelope = { seq: ++this.#seq, event };
    const turn = this.#turns.get(event.conversationId);
    if (turn && "turnId" in event && event.turnId === turn.turnId) {
      turn.buffer.push(envelope);
    }
    for (const q of this.#subscribers) q.push(envelope);
    for (const c of this.#registry.contributionsTo<ClaudeSessionObserverPayload>(
      CLAUDE_SESSION_OBSERVER_POINT
    )) {
      try {
        c.payload.onEvent(event);
      } catch (err) {
        console.warn(
          `[claude] session observer "${c.payload.id ?? c.from}" threw and was skipped: ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  /** Watch every event of every conversation. Returns the unsubscribe. */
  observe(listener: (event: ClaudeSessionEvent) => void): () => void {
    const q = new EventQueue<Envelope>();
    this.#subscribers.add(q);
    void (async () => {
      for await (const env of q) listener(env.event);
    })();
    return () => {
      this.#subscribers.delete(q);
      q.end();
    };
  }

  /* ------------------------------- validation -------------------------------- */

  /**
   * A model, or a refusal naming what was asked for.
   *
   * Refused rather than silently defaulted, because the silent default is a
   * measured defect in this project's own runner: `bmpx_builder.py` resolves
   * `MODEL_CLI_IDS.get(model, DEFAULT)`, so a typo runs on sonnet-5 and nobody
   * finds out until the output is wrong — at which point it looks like the
   * model underperformed. `src/modules/buildmgr/models.ts` documents that at
   * length; this is the same refusal at this subsystem's door.
   */
  #model(requested: string | undefined): string {
    const name = requested?.trim() || DEFAULT_TIER;
    const info = resolveModel(name);
    if (!info) {
      throw new Error(
        `unknown model "${name}" — refused rather than silently defaulted to ${DEFAULT_TIER}. ` +
          `Known: ${MODEL_CATALOG.map((m) => m.slug).join(", ")}.`
      );
    }
    return info.slug;
  }

  /** An existing directory, or a loud refusal. A cwd that silently fell back
   *  to the package root is a turn whose tools read the wrong tree. */
  #cwd(requested: string | undefined): string {
    if (requested === undefined) return process.cwd();
    const cwd = requested.trim();
    if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
      throw new Error(`cwd is not an existing directory: ${requested}`);
    }
    return cwd;
  }

  /** `null` means "do not pass `--effort`" — see `ConversationRecord.effort`. */
  #effort(requested: string | undefined): EffortLevel | null {
    if (requested === undefined || requested === "") return null;
    if (!isEffortLevel(requested)) throw new Error(`unknown effort "${requested}"`);
    return requested;
  }

  #permissionMode(requested: string | undefined): PermissionMode {
    if (requested === undefined || requested === "") return "default";
    if (!isPermissionMode(requested)) throw new Error(`unknown permissionMode "${requested}"`);
    return requested;
  }

  /**
   * A project's knowledge list, or a refusal.
   *
   * The paths are NOT checked for existence here. A project is routinely
   * written before the file is (a plan names the spec it is about to author),
   * and refusing the save would make the editor unusable for the ordinary case
   * — while `projectKnowledge()` reports resolution the whole time, which is
   * the affordance that actually catches a typo. What IS refused is a list that
   * would cost money to be wrong about: too many files, an empty path, a
   * duplicate.
   */
  #knowledge(requested: readonly KnowledgeFile[] | undefined): KnowledgeFile[] {
    if (requested === undefined) return [];
    if (!Array.isArray(requested)) throw new Error("knowledge must be an array of { path, note? }");
    if (requested.length > KNOWLEDGE_LIMITS.files) {
      throw new Error(
        `a project carries at most ${KNOWLEDGE_LIMITS.files} knowledge files; ${requested.length} ` +
          `were given. Every one of them is prepended to the first turn of every conversation in ` +
          `the project, and that is billed.`
      );
    }
    const seen = new Set<string>();
    return requested.map((file) => {
      const p = typeof file?.path === "string" ? file.path.trim() : "";
      if (!p) throw new Error("a knowledge file needs a non-empty path");
      // A NUL is the classic path-truncation trick and has no business in a
      // filename on any platform this runs on.
      if (p.includes("\0")) throw new Error(`"${p}" is not a usable path`);
      const key = p.toLowerCase();
      if (seen.has(key)) throw new Error(`"${p}" is listed twice`);
      seen.add(key);
      const note = typeof file.note === "string" ? file.note.trim() : "";
      return note ? { path: p, note } : { path: p };
    });
  }

  #projectName(requested: string | undefined): string {
    const name = typeof requested === "string" ? requested.trim() : "";
    if (!name) throw new Error("a project needs a name");
    if (name.length > MAX_PROJECT_NAME) {
      throw new Error(`a project name cannot exceed ${MAX_PROJECT_NAME} characters`);
    }
    return name;
  }

  /**
   * The bound directory. Unlike a conversation's, it has no "the server's own
   * cwd" fallback: an unstated binding is the implicit working directory this
   * whole step exists to replace.
   *
   * NORMALISED with `path.resolve`, and that is not cosmetic. A binding is
   * COMPARED — `start()` refuses a conversation whose cwd disagrees with its
   * project's — and on Windows the same directory has several true spellings:
   * `C:/x/repo`, `C:\x\repo`, `C:\x\repo\`, `C:\x\sub\..\repo`. A raw string
   * compare would refuse a start that named the right tree in the wrong
   * dialect, which is a refusal nobody can act on because the two paths in the
   * message look identical to a reader.
   */
  #boundCwd(requested: string | undefined): string {
    if (typeof requested !== "string" || !requested.trim()) {
      throw new Error("a project needs a working directory to bind to");
    }
    return path.resolve(this.#cwd(requested));
  }

  /* ------------------------------- the verbs -------------------------------- */

  async start(opts: StartOptions = {}): Promise<ConversationRecord> {
    // The project is resolved FIRST: it supplies the defaults everything below
    // validates, and an unknown project must not leave a conversation created
    // under nothing.
    let project: ProjectRecord | null = null;
    if (opts.projectId !== undefined && opts.projectId !== "") {
      project = await this.#projects.load(opts.projectId);
      if (!project) throw new Error(`project "${opts.projectId}" does not exist`);
    }

    // `cwd` is BOUND under a project, not defaulted — see the header. Refused
    // rather than overridden, because silently winning either way is worse:
    // honouring the option files a conversation under a project it does not
    // run in, and ignoring it discards something the caller asked for.
    let cwd: string;
    if (project) {
      // Both sides normalised — the project's already is; the option is put
      // through the same resolution so the same directory spelled differently
      // is not read as a different directory. See `#boundCwd`.
      if (
        opts.cwd !== undefined &&
        opts.cwd.trim() &&
        path.resolve(this.#cwd(opts.cwd)) !== project.cwd
      ) {
        throw new Error(
          `conversation cwd "${opts.cwd}" disagrees with project "${project.name}", which is bound ` +
            `to ${project.cwd} — a conversation in a project runs in the project's tree`
        );
      }
      cwd = project.cwd;
    } else {
      cwd = this.#cwd(opts.cwd);
    }

    // Everything is validated BEFORE the record is created, so a refusal never
    // leaves a half-configured conversation on disk.
    const record = await this.#store.create({
      title:
        opts.title?.trim() ||
        `Conversation ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      cwd,
      model: this.#model(opts.model ?? project?.model),
      effort: this.#effort(opts.effort ?? project?.effort ?? undefined),
      permissionMode: this.#permissionMode(opts.permissionMode ?? project?.permissionMode),
      system: typeof opts.system === "string" ? opts.system : "",
      ...(project ? { projectId: project.id } : {})
    });
    this.#deliver({
      type: "conversation-started",
      conversationId: record.id,
      at: record.createdAt
    });
    return record;
  }

  async send(conversationId: string, text: string, opts: SendOptions = {}): Promise<TurnHandle> {
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("send() needs a non-empty user message");
    }
    if (this.#turns.has(conversationId)) {
      throw new Error(`conversation "${conversationId}" already has a turn running`);
    }
    if (!(await this.#store.load(conversationId))) {
      throw new Error(`conversation "${conversationId}" does not exist`);
    }

    // The user message is persisted BEFORE the CLI runs: a turn that errors or
    // is cancelled must still leave the question in the transcript.
    const record = await this.#store.mutate(conversationId, (r) => ({
      ...r,
      messages: [...r.messages, { role: "user", text, at: new Date().toISOString() }]
    }));

    const turnId = randomUUID();
    const turn: ActiveTurn = { conversationId, turnId, buffer: [], kills: [], cancelled: false };
    this.#turns.set(conversationId, turn);

    // Subscribe the handle's own queue before the first event exists, so the
    // caller misses nothing however late it starts iterating.
    const handleQueue = new EventQueue<Envelope>();
    this.#subscribers.add(handleQueue);

    const done = this.#runTurn(record, turn, opts).finally(() => {
      if (this.#turns.get(conversationId) === turn) this.#turns.delete(conversationId);
      this.#subscribers.delete(handleQueue);
      handleQueue.end();
    });

    const events = this.#drain(
      handleQueue,
      (ev) => ev.conversationId === conversationId && "turnId" in ev && ev.turnId === turnId
    );
    return { conversationId, turnId, events, done };
  }

  /**
   * Attach to a conversation's events. If a turn is live its buffer replays
   * first (subscribe-then-replay, deduped by sequence number, so nothing is
   * missed or doubled); the stream ends after the next terminal event. An
   * attacher that arrives before `send()` simply waits for the turn.
   */
  async *stream(conversationId: string): AsyncGenerator<ClaudeSessionEvent, void, undefined> {
    const q = new EventQueue<Envelope>();
    this.#subscribers.add(q);
    try {
      let seen = 0;
      const active = this.#turns.get(conversationId);
      if (active) {
        for (const env of [...active.buffer]) {
          seen = env.seq;
          yield env.event;
          if (isTerminalEvent(env.event)) return;
        }
      }
      for await (const env of q) {
        if (env.seq <= seen || env.event.conversationId !== conversationId) continue;
        yield env.event;
        if (isTerminalEvent(env.event)) return;
      }
    } finally {
      this.#subscribers.delete(q);
      q.end();
    }
  }

  /** Load a conversation from disk. After a server restart this is the whole
   *  of resumption: the record carries the CLI session id, and the next
   *  `send()` puts `--resume` on the command line from it. */
  async resume(conversationId: string): Promise<ConversationRecord> {
    const record = await this.#store.load(conversationId);
    if (!record) throw new Error(`conversation "${conversationId}" does not exist`);
    return record;
  }

  /** Kill the running CLI child. True if there was one to kill. */
  cancel(conversationId: string): boolean {
    const turn = this.#turns.get(conversationId);
    if (!turn) return false;
    turn.cancelled = true;
    for (const kill of turn.kills) {
      try {
        kill();
      } catch {
        /* the child may already be gone — a turn that finished is still stopped */
      }
    }
    return true;
  }

  get(conversationId: string): Promise<ConversationRecord | null> {
    return this.#store.load(conversationId);
  }

  list(): Promise<ConversationMeta[]> {
    return this.#store.list();
  }

  /** The live turn id for a conversation, or null. */
  activeTurn(conversationId: string): string | null {
    return this.#turns.get(conversationId)?.turnId ?? null;
  }

  /* ----------------------------- the library verbs --------------------------- */

  /**
   * Retitle a conversation.
   *
   * An empty title is REFUSED rather than silently replaced with a generated
   * one: the library's rename affordance is a text field, and a field that
   * answers a cleared value with something invented is a field that lost the
   * user's edit. The caller shows the message.
   */
  async rename(conversationId: string, title: string): Promise<ConversationRecord> {
    const next = typeof title === "string" ? title.trim() : "";
    if (!next) throw new Error("a conversation title cannot be empty");
    // Bounded because it becomes a filename stem on export and a row label in a
    // list; a title longer than a line is a title nothing can display.
    if (next.length > 200) throw new Error("a conversation title cannot exceed 200 characters");
    return this.#store.mutate(conversationId, (r) => ({ ...r, title: next }));
  }

  /** Pin or unpin. Idempotent — pinning a pinned conversation is not an error,
   *  because the affordance is a toggle and a double click must not fail. */
  async setPinned(conversationId: string, pinned: boolean): Promise<ConversationRecord> {
    return this.#store.mutate(conversationId, (r) => ({ ...r, pinned }));
  }

  /**
   * Delete a conversation.
   *
   * REFUSED while a turn is running, and that is the whole reason this is a
   * service method rather than a store call: the CLI child would keep running
   * with nothing left to persist into, and `#runTurn`'s next `store.mutate`
   * would reject against a record that no longer exists — a turn that dies with
   * an unhandled rejection instead of a terminal event. Cancel first; the
   * caller is told which.
   *
   * Returns false when there was nothing to delete, so a double click on a row
   * that is already gone is an answer rather than a failure.
   */
  async remove(conversationId: string): Promise<boolean> {
    if (this.#turns.has(conversationId)) {
      throw new Error(
        `conversation "${conversationId}" has a turn running — cancel it before deleting, or the ` +
          `CLI keeps running with nowhere to persist`
      );
    }
    if (!(await this.#store.load(conversationId))) return false;
    await this.#store.remove(conversationId);
    return true;
  }

  /**
   * Full-text search across every conversation's message bodies.
   *
   * A linear scan of the store, deliberately — `./search` states why there is
   * no index. An unreadable record is SKIPPED rather than fatal, exactly as in
   * `list()`: one corrupt document must not make search stop answering, which
   * would look identical to "nothing matched".
   *
   * An empty query returns nothing rather than everything. "Show me all" is
   * `list()`, and conflating the two makes a cleared search box dump the corpus.
   */
  async search(query: string): Promise<SearchHit[]> {
    const terms = parseQuery(typeof query === "string" ? query : "");
    if (!terms.length) return [];
    const hits: SearchHit[] = [];
    for (const meta of await this.#store.list()) {
      const record = await this.#store.load(meta.id).catch(() => null);
      if (!record) continue;
      const hit = searchRecord(record, terms);
      if (hit) hits.push(hit);
    }
    return orderHits(hits);
  }

  /* ----------------------------- the project verbs --------------------------- */

  async createProject(opts: ProjectOptions): Promise<ProjectRecord> {
    return this.#projects.create({
      name: this.#projectName(opts.name),
      cwd: this.#boundCwd(opts.cwd),
      instructions: typeof opts.instructions === "string" ? opts.instructions : "",
      knowledge: this.#knowledge(opts.knowledge),
      model: this.#model(opts.model),
      effort: this.#effort(opts.effort),
      permissionMode: this.#permissionMode(opts.permissionMode)
    });
  }

  listProjects(): Promise<ProjectRecord[]> {
    return this.#projects.list();
  }

  getProject(id: string): Promise<ProjectRecord | null> {
    return this.#projects.load(id);
  }

  /**
   * Edit a project.
   *
   * Every field runs through the same validators `createProject` uses, so a
   * cwd edited to a directory that does not exist is refused here exactly as it
   * would be at create. What this does NOT do is reach into the conversations
   * already filed under the project: their `cwd` / `model` / `effort` /
   * `permissionMode` were copied at start and stay theirs. `./projects` argues
   * that at length — a `--resume` whose working directory moved is a session
   * whose remembered tool calls no longer describe the tree it is standing in.
   * Instructions and knowledge, by contrast, are read live, so an edit to those
   * reaches the next FIRST turn in the project immediately.
   */
  async updateProject(id: string, patch: ProjectPatch): Promise<ProjectRecord> {
    // Validated BEFORE the mutation opens, so a refusal never runs inside
    // core's write chain and cannot half-apply one field of two.
    // `-readonly` because `ProjectRecord`'s fields are, and a `Partial<>` of it
    // inherits that — the accumulator is built here and frozen by the spread
    // below, which is the only place it needs to be immutable.
    const next: { -readonly [K in keyof ProjectRecord]?: ProjectRecord[K] } = {};
    if (patch.name !== undefined) next.name = this.#projectName(patch.name);
    if (patch.cwd !== undefined) next.cwd = this.#boundCwd(patch.cwd);
    if (patch.instructions !== undefined) {
      if (typeof patch.instructions !== "string") throw new Error("instructions must be a string");
      next.instructions = patch.instructions;
    }
    if (patch.knowledge !== undefined) next.knowledge = this.#knowledge(patch.knowledge);
    if (patch.model !== undefined) next.model = this.#model(patch.model);
    if (patch.effort !== undefined) next.effort = this.#effort(patch.effort);
    if (patch.permissionMode !== undefined) {
      next.permissionMode = this.#permissionMode(patch.permissionMode);
    }
    if (!Object.keys(next).length) throw new Error("nothing to update");
    return this.#projects.mutate(id, (record) => ({ ...record, ...next }));
  }

  /**
   * Delete a project.
   *
   * REFUSED while conversations belong to it, and the refusal counts them. A
   * silent orphaning is the failure worth spending a branch on: the
   * conversations would still work — their cwd and model are their own — but
   * they would carry a `projectId` pointing at nothing, so the library's filter
   * would hide them from every project INCLUDING "none", and a transcript would
   * simply stop being findable.
   *
   * `detach` is the deliberate version of the same thing: clear the binding
   * from each one first, so they come back as project-less conversations, and
   * then delete. The caller is told which it is doing; nothing decides for it.
   *
   * Returns false when there was nothing to delete, so a double click on a row
   * that is already gone is an answer rather than a failure.
   */
  async removeProject(id: string, opts: { detach?: boolean } = {}): Promise<boolean> {
    const project = await this.#projects.load(id);
    if (!project) return false;
    const members = (await this.#store.list()).filter((meta) => meta.projectId === id);
    if (members.length && !opts.detach) {
      throw new Error(
        `project "${project.name}" still holds ${members.length} conversation` +
          `${members.length === 1 ? "" : "s"} — delete or detach them first, or pass detach to ` +
          `unfile them and keep them`
      );
    }
    for (const meta of members) {
      // One at a time, each through the store's own chain. A conversation with
      // a turn running is fine here: detaching changes no field the turn reads.
      await this.#store.mutate(meta.id, (record) => {
        const { projectId: _dropped, ...rest } = record;
        return rest as ConversationRecord;
      });
    }
    await this.#projects.remove(id);
    return true;
  }

  /** What each of a project's knowledge files resolves to right now. Refuses
   *  loudly for a project that does not exist — an empty array would read as
   *  "no knowledge files", which is a different and reassuring answer. */
  async projectKnowledge(id: string): Promise<KnowledgeStatus[]> {
    const project = await this.#projects.load(id);
    if (!project) throw new Error(`project "${id}" does not exist`);
    return resolveKnowledge(project);
  }

  /* ------------------------------ turn plumbing ------------------------------ */

  async *#drain(
    q: EventQueue<Envelope>,
    keep: (ev: ClaudeSessionEvent) => boolean
  ): AsyncGenerator<ClaudeSessionEvent, void, undefined> {
    for await (const env of q) {
      if (!keep(env.event)) continue;
      yield env.event;
      if (isTerminalEvent(env.event)) return;
    }
  }

  /**
   * The project's contract, then the conversation's own, then every context
   * provider's output. FIRST TURN ONLY — a resumed session already carries its
   * history, and the broker ignores `system` when `--resume` is on the command
   * line anyway, so re-running providers there would spend their work on
   * nothing.
   *
   * The project comes FIRST because it is the frame everything else is read
   * inside: which tree this is, what the standing instructions are, what the
   * project knows. A conversation's own `system` narrows that frame for one
   * conversation, and a provider adds live context to it — both are qualifiers
   * on something, and putting the something after them would be reading the
   * footnotes before the page.
   *
   * A project that has been DELETED since the conversation started is skipped
   * with a warning rather than failing the turn: the conversation's own cwd,
   * model and permission mode were copied at start and are all still valid, so
   * there is a real turn to run. Losing the instructions is a degradation, and
   * `removeProject` refuses by default precisely so it is a rare one.
   */
  async #composeSystem(record: ConversationRecord): Promise<string> {
    if (record.cliSessionId) return record.system;
    const parts: string[] = [];

    if (record.projectId) {
      const project = await this.#projects.load(record.projectId).catch(() => null);
      if (project) {
        parts.push(composeProjectSystem(project, await loadKnowledge(project)));
      } else {
        console.warn(
          `[claude] conversation "${record.id}" names project "${record.projectId}", which is ` +
            `gone — the turn runs without its instructions or knowledge`
        );
      }
    }

    if (record.system) parts.push(record.system);
    for (const c of this.#registry.contributionsTo<ClaudeContextProviderPayload>(
      CLAUDE_CONTEXT_PROVIDER_POINT
    )) {
      try {
        const text = await c.payload.provide({ conversation: record });
        if (typeof text === "string" && text.trim()) parts.push(text.trim());
      } catch (err) {
        console.warn(
          `[claude] context provider "${c.payload.id ?? c.from}" threw and was skipped: ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return parts.join("\n\n");
  }

  async #runTurn(
    record: ConversationRecord,
    turn: ActiveTurn,
    opts: SendOptions
  ): Promise<TurnResult> {
    const { conversationId, turnId } = turn;
    const info = resolveModel(record.model);
    if (!info) {
      // A record can outlive a catalog entry. Refuse by name rather than run
      // the turn on whatever the default happens to be today.
      const message = `conversation "${conversationId}" names model "${record.model}", which is not in the catalog`;
      this.#deliver({ type: "turn-error", conversationId, turnId, message, at: new Date().toISOString() });
      return { conversationId, turnId, ok: false, cancelled: false, text: "", error: message };
    }

    const wire: BrokerWireMessage[] = record.messages.map((m) => ({ role: m.role, text: m.text }));
    const params: BrokerChatParams = {
      model: info.cliId,
      system: await this.#composeSystem(record),
      messages: wire,
      sessionId: record.cliSessionId,
      cwd: record.cwd,
      permissionMode: record.permissionMode,
      ...(record.effort ? { effort: record.effort } : {}),
      timeoutMs: clampTimeoutS(opts.timeoutS) * 1000
    };

    this.#deliver({
      type: "turn-started",
      conversationId,
      turnId,
      model: info.cliId,
      resume: Boolean(record.cliSessionId),
      at: new Date().toISOString()
    });

    // The transport speaks in callbacks; this pump re-serialises its events so
    // persistence can be AWAITED per event — an observer reacting to
    // `turn-done` reads a store that already contains the assistant message.
    const raw = new EventQueue<Record<string, unknown>>();
    void this.#transport(
      params,
      (e) => raw.push(e),
      (fn) => turn.kills.push(fn),
      catalogCost
    )
      .catch((err) =>
        raw.push({ type: "error", message: err instanceof Error ? err.message : String(err) })
      )
      .finally(() => raw.end());

    const now = () => new Date().toISOString();
    let result: TurnResult = {
      conversationId,
      turnId,
      ok: false,
      cancelled: false,
      text: "",
      error: "the transport ended without a terminal event"
    };

    for await (const evt of raw) {
      const type = evt.type;

      if (type === "done") {
        const d = evt as {
          text?: string;
          sessionId?: string;
          usage?: CliUsage;
          costUsd?: number | null;
        };
        const usage: TurnUsage = { ...(d.usage ?? EMPTY_USAGE), costUsd: d.costUsd ?? 0 };
        const text = d.text ?? "";
        const at = now();
        const assistant: StoredMessage = {
          role: "assistant",
          text,
          at,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd
        };
        await this.#store.mutate(conversationId, (r) => ({
          ...r,
          cliSessionId: d.sessionId ?? r.cliSessionId,
          totalCostUsd: r.totalCostUsd + usage.costUsd,
          messages: [...r.messages, assistant]
        }));
        result = {
          conversationId,
          turnId,
          ok: true,
          cancelled: false,
          text,
          cliSessionId: d.sessionId
        };
        this.#deliver({
          type: "turn-done",
          conversationId,
          turnId,
          text,
          usage,
          cliSessionId: d.sessionId,
          at
        });
        continue;
      }

      if (type === "error") {
        const message = typeof evt.message === "string" ? evt.message : "unknown transport error";
        if (turn.cancelled) {
          // The kill produced this "error"; the honest terminal is cancelled.
          result = { conversationId, turnId, ok: false, cancelled: true, text: "" };
          this.#deliver({ type: "turn-cancelled", conversationId, turnId, at: now() });
        } else {
          result = { conversationId, turnId, ok: false, cancelled: false, text: "", error: message };
          this.#deliver({ type: "turn-error", conversationId, turnId, message, at: now() });
        }
        continue;
      }

      // Everything else is a CLI event, carried verbatim. The session id is
      // ALSO hoisted and persisted the moment it arrives, so a turn that dies
      // before its terminal still leaves a resumable record behind.
      if (type === "session" && typeof evt.sessionId === "string") {
        const cliSessionId = evt.sessionId;
        await this.#store.mutate(conversationId, (r) => ({ ...r, cliSessionId }));
        this.#deliver({ type: "session", conversationId, turnId, cliSessionId });
      }
      this.#deliver({
        type: "cli",
        conversationId,
        turnId,
        event: evt as unknown as BrokerEvent
      });
    }
    return result;
  }
}

/* --------------------------------- singleton --------------------------------- */

/** The process-wide service PER USER — stashed on `globalThis` so a dev-server
 *  module re-evaluation attaches to the running instances instead of racing
 *  them over the same child processes.
 *
 *  One service per username (P2 of `default-state`, 2026-08-14): each holds a
 *  `ConversationStore` and a `ProjectStore` scoped to that user's subtree
 *  (`data/claude/{conversations,projects}/<user>/`), which is the store
 *  constructors' documented plan for the day auth landed. Routes pass
 *  `kvUser(request)`; `"local"` remains the signed-out owner, and every
 *  pre-P2 record already lives in `local/`'s tree, so nothing migrates. Live
 *  turns are per-instance state, and a user's requests always land on the same
 *  instance because the key is the username. */
export function claudeService(user = "local"): ClaudeService {
  const g = globalThis as { __axsClaudeServices?: Map<string, ClaudeService> };
  const services = (g.__axsClaudeServices ??= new Map<string, ClaudeService>());
  let service = services.get(user);
  if (!service) {
    service = new ClaudeService({
      store: new ConversationStore(undefined, user),
      projects: new ProjectStore(undefined, user)
    });
    services.set(user, service);
  }
  return service;
}

/**
 * The service scoped to the REQUEST's user — the front door the HTTP routes go
 * through. Resolves the verified `axs_session` cookie's username exactly as
 * the kv routes do (`"local"` signed out) and hands back that user's service.
 * It lives HERE rather than in each route because the consumer contract
 * (`test/claude-projects.test.ts`, "the project routes touch no subsystem
 * internals") refuses a route that imports the kv driver — identity resolution
 * is the subsystem's job, and a consumer only says which request is asking.
 */
export function claudeServiceFor(request: Request): ClaudeService {
  return claudeService(kvUser(request));
}
