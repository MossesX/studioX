/**
 * @file The Module Assistant's isomorphic vocabulary — types both runtimes and
 * the wire share. No React, no node:fs, no side effects: the chat route, the
 * agents scanner, the client store and the window all import from here, so
 * this file is the one place the wire shape is stated.
 *
 * ── what the assistant IS ─────────────────────────────────────────────────────
 *
 * One floating chat window, mounted once by the shell, that assists with
 * whichever MODULE is on screen. The plugin is `target: "universal"` — the
 * grammar `pack.mjs` already accepts — because per-module assistants would be
 * seven integrations and one per module forever; this is one integration and
 * per-module CONTEXT (the hosted module's title, summary and points ride each
 * turn as a context block).
 *
 * ── agents are DATA, add-ons are FILES ────────────────────────────────────────
 *
 * An assistant agent is a markdown file with YAML frontmatter — the same shape
 * GizmoX's `.claude/agents/<slug>.md` uses, chosen so the format is already
 * familiar and already provably editable by hand:
 *
 *     ---
 *     name: Amber
 *     description: The house module assistant.
 *     provider: anthropic        # optional — pins a provider
 *     model: claude-opus-5      # optional — pins a model
 *     ---
 *     You are Amber… (the body IS the system prompt)
 *
 * ONE default agent ships in code (`DEFAULT_AGENT` below — emitted from a
 * literal, never generated). Others are files the scanner finds in two places:
 * `data/assistant/agents/*.md` (user-authored, the Forge writes here) and
 * `assets/installed/add-on/<id>/agents/*.md` — which is what makes "add agents
 * as add-on assets after the app is compiled" a real operation: `npm run pack`
 * installs the zip, the scanner picks the files up, no code changes.
 */

export type ProviderId = "anthropic" | "openai" | "xai" | "ollama";

export const PROVIDERS: readonly { id: ProviderId; label: string; needsKey: boolean }[] = [
  { id: "anthropic", label: "Claude (Anthropic)", needsKey: true },
  { id: "openai", label: "OpenAI", needsKey: true },
  { id: "xai", label: "Grok (xAI)", needsKey: true },
  { id: "ollama", label: "Ollama (local)", needsKey: false }
];

/**
 * How Anthropic turns are paid for. The only provider with two answers, which
 * is why this is not a general `ProviderSettings` concept applied everywhere.
 *
 *   - **`api-key`** — the Messages API with a key from the settings tab. Billed
 *     to an Anthropic *API* account, per token.
 *   - **`subscription`** — the locally installed, already-signed-in `claude`
 *     CLI, driven through `src/server/claudeBroker.ts`. Billed to the owner's
 *     Claude *subscription*; **no key is stored anywhere on this path** and
 *     nothing in it reads `ANTHROPIC_API_KEY`.
 *
 * Two accounts, two bills, one provider — so the mode is a stored setting
 * rather than "whichever happens to be configured". A studio that silently
 * picked one would be a studio that charges the wrong account.
 *
 * The default is `subscription` — owner decision, 2026-08-13. The studio runs
 * on the owner's machine beside a signed-in `claude` CLI, so out of the box the
 * assistant works with no key stored anywhere; the API key is the opt-in. (The
 * default was `api-key` while that was the only mode an absent field could have
 * meant; the owner's stored config names its mode explicitly, so flipping the
 * fallback changes no existing install.)
 */
export type AnthropicAuthMode = "api-key" | "subscription";

export const ANTHROPIC_AUTH_MODES: readonly {
  id: AnthropicAuthMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "api-key",
    label: "API key",
    hint: "Anthropic's Messages API, billed per token to the key's API account."
  },
  {
    id: "subscription",
    label: "Claude subscription (claude CLI)",
    hint: "Runs the signed-in claude CLI on this machine — your Claude plan pays, no key is stored."
  }
];

export const DEFAULT_ANTHROPIC_AUTH: AnthropicAuthMode = "subscription";

export function isAnthropicAuthMode(v: unknown): v is AnthropicAuthMode {
  return v === "api-key" || v === "subscription";
}

/**
 * Model suggestions per provider — SUGGESTIONS, not an allowlist. The model
 * field is free text on purpose: providers ship models faster than any list
 * here can chase, and a studio that refuses a model id it has not heard of is
 * a studio that breaks the day one ships. The server passes the id through
 * and surfaces the provider's own error if it is wrong.
 */
export const MODEL_SUGGESTIONS: Readonly<Record<ProviderId, readonly string[]>> = {
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5"],
  openai: ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o"],
  xai: ["grok-4", "grok-4-fast", "grok-3"],
  ollama: ["llama3.3", "qwen3", "mistral", "gemma3"]
};

export const DEFAULT_MODELS: Readonly<Record<ProviderId, string>> = {
  anthropic: "claude-opus-5",
  openai: "gpt-5.2",
  xai: "grok-4",
  ollama: "llama3.3"
};

export interface AssistantAgent {
  /** Stable slug — the filename without `.md`, or `amber` for the built-in. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Pin a provider/model; absent means "use the configured ones". */
  readonly provider?: ProviderId;
  readonly model?: string;
  /** The system prompt (the file body). Omitted from list responses. */
  readonly system?: string;
  /** Where the scanner found it. The built-in reports `built-in`; `gizmox`
   *  means a file from one of the configured agent directories
   *  ({@link AssistantConfig.agentDirs} — by default the `.claude/agents`
   *  pair Claude Code itself reads) — read-only here, edited where it lives;
   *  `module` is the bundle a module ships in its own directory, written by
   *  `npm run agent` and carried into a peeled app with the module. */
  readonly source: "built-in" | "gizmox" | "data" | "add-on" | "module";
  /** Present for file-backed agents so the Forge can edit them. */
  readonly file?: string;
  /**
   * The module this agent BELONGS to — set only for `source: "module"`.
   *
   * It is what makes "every module has its own agent" work without anyone
   * configuring anything: {@link agentForModule} falls back to the module's
   * own agent before the global default, so a module that ships a bundle is
   * answered by its own persona the first time its window is opened, and a
   * `moduleAgents` pin still overrides it.
   */
  readonly moduleId?: string;
  /**
   * Skill slugs the agent declares (`skills:` in the frontmatter). For a
   * module agent these are the folders under its bundle's `skills/`, and the
   * chat route appends their bodies to the system prompt — a skill nobody
   * loads is a file, not a skill.
   */
  readonly skills?: readonly string[];
  /**
   * CLI tool names the agent is allowed (`tools:` in the frontmatter — Read,
   * Grep, WebFetch…). Real on the Anthropic SUBSCRIPTION path, where the
   * broker passes them to the `claude` CLI as `--allowed-tools`; the API-key
   * and OpenAI-compatible paths have no tool loop yet and ignore them.
   */
  readonly tools?: readonly string[];
  /**
   * Module tool DEFINITIONS the agent carries (`moduleTools:`) — the names of
   * the JSON documents in its bundle's `tools/`. Data, not behaviour: they are
   * the authored feed for the MCP bridge `claude/points.ts` deferred, and the
   * chat route names them in the prompt so the agent knows what it will be
   * able to call. Nothing executes them yet.
   */
  readonly moduleTools?: readonly string[];
}

/* ── the module agent bundle ──────────────────────────────────────────────── */

/** Format tag on a module's agent bundle. Mirrors the constant in
 *  `scripts/lib/module-agent.mjs`, which is build tooling and cannot import
 *  this file; the two are checked against each other by the bundle test. */
export const MODULE_AGENT_FORMAT = "axf-module-agent/1";

export interface AgentSkillDoc {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** The SKILL.md body — what the model reads when the skill is loaded. */
  readonly body: string;
}

/** A tool as DATA, the shape `forge.server.ts` already stores. */
export interface AgentToolDoc {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/**
 * The editable draft of a module's agent — what the build derives, what the
 * prompt shows pre-filled, and what the owner accepts.
 *
 * One shape, three prompt surfaces (the studio dialog, the PyQt6 fallback, the
 * terminal form) and two directions (derived → prompt → written). Making it a
 * wire type here rather than a shape each surface re-invents is what keeps the
 * three from disagreeing about which fields are editable.
 */
export interface ModuleAgentDraft {
  readonly format: string;
  /** The module this agent ships with. */
  readonly module: string;
  /** Roster id — always `<module>-agent`, never derived from the name. */
  readonly id: string;
  readonly name: string;
  /** Suggestions the prompt offers beside the name field. */
  readonly nameOptions?: readonly string[];
  readonly description: string;
  readonly provider?: ProviderId;
  readonly model?: string;
  readonly cliTools: readonly string[];
  readonly skills: readonly AgentSkillDoc[];
  readonly tools: readonly AgentToolDoc[];
  /** The system prompt. Derived from the declaration, then the owner's. */
  readonly persona: string;
}

/**
 * CLI tools the prompt offers as tick boxes. Not an allowlist — the field is
 * free text underneath, for the same reason `model` is (see MODEL_SUGGESTIONS):
 * the CLI grows tools faster than this list can chase, and a build that refuses
 * a tool name it has not heard of is a build that breaks on an upgrade.
 */
export const CLI_TOOL_CHOICES: readonly { name: string; hint: string; writes: boolean }[] = [
  { name: "Read", hint: "Read a file the user names.", writes: false },
  { name: "Grep", hint: "Search file contents.", writes: false },
  { name: "Glob", hint: "Find files by pattern.", writes: false },
  { name: "WebFetch", hint: "Fetch a URL the user names.", writes: false },
  { name: "WebSearch", hint: "Search the web.", writes: false },
  { name: "Edit", hint: "Edit a file in place.", writes: true },
  { name: "Write", hint: "Create or overwrite a file.", writes: true },
  { name: "Bash", hint: "Run shell commands.", writes: true },
  { name: "TodoWrite", hint: "Keep a task list during a long answer.", writes: false }
];

/** The kv namespace the agent-builder rendezvous parks requests under. */
export const AGENT_INBOX_NS = "assistant-agent-inbox";

/** One build waiting for a name. The CLI posts it and polls; the studio's
 *  dialog drains it, shows the fields pre-filled, and posts back the result. */
export interface AgentBuildRequest {
  readonly id: string;
  readonly module: string;
  /** Who asked — `peel`, `agent` (the standalone CLI), or anything else. */
  readonly source: string;
  readonly opened: string;
  readonly status: "pending" | "resolved" | "cancelled";
  readonly draft: ModuleAgentDraft;
  /** What the owner accepted. Present once `status` is `resolved`. */
  readonly result?: ModuleAgentDraft;
  readonly closed?: string;
}

/** The one agent the plugin SHIPS with. A literal, deliberately. */
export const DEFAULT_AGENT: AssistantAgent = {
  id: "amber",
  name: "Amber",
  description: "The house module assistant — knows the framework and the module on screen.",
  source: "built-in",
  system:
    "You are Amber, the AmberX AI Studio module assistant. You live in a floating chat window " +
    "over whichever module the user has on screen, and your job is to help them USE that module: " +
    "what it is for, where its controls are, what its settings do, and how its pieces (extension " +
    "points, context menus, toolbars) fit the framework underneath. A `## Current module` block " +
    "in your context describes the module on screen — ground your answers in it, and say so when " +
    "a question is about a different surface. Be direct and concrete; prefer naming the exact " +
    "control or menu over describing categories of controls. Keep answers short — this is a chat " +
    "window beside someone's work, not a documentation page."
};

/** Per-provider connection settings. Keys live server-side in kv and are
 *  MASKED on the way out — see the config route. */
export interface ProviderSettings {
  apiKey?: string;
  /** ollama: the daemon origin; openai-compatible providers: an override. */
  baseUrl?: string;
  /** anthropic only. Absent means {@link DEFAULT_ANTHROPIC_AUTH}. */
  authMode?: AnthropicAuthMode;
}

/** What the config route sends BACK for a provider: the key's presence and a
 *  4-char hint, never the key. The settings tab renders this. */
export interface MaskedProviderSettings {
  keySet: boolean;
  keyHint: string;
  baseUrl?: string;
  /** anthropic only — not a secret, so it round-trips unmasked. */
  authMode?: AnthropicAuthMode;
}

export interface AssistantConfig {
  provider: ProviderId;
  model: string;
  /** The agent a module with no choice of its own gets. */
  agentId: string;
  /**
   * The agent PINNED to a particular module, by module id (`shell` for routes
   * hosting none) — owner request, 2026-08-13: *"i want to be able to select
   * different agents for each module/session … the agent selection needs to be
   * persistent for each module/session individually"*.
   *
   * A window's conversation is already per module (`store.ts` keys transcripts
   * and the CLI `sessionId` that way), so "per module" and "per session" are
   * the same axis here and this map is on it. An absent key means the module
   * follows {@link AssistantConfig.agentId} — which is a different statement
   * from a key pinned TO the default agent, and the difference is visible: the
   * first follows the default when it changes, the second does not.
   *
   * It lives in the stored config rather than in the client's `sessionStorage`
   * for two reasons. Persistence: `sessionStorage` dies with the tab, and the
   * owner asked for the choice to persist. Authority: the chat route resolves
   * the agent SERVER-side (an agent's system prompt never crosses to the
   * client), so the map has to be somewhere the route can read, or the client
   * would be telling the server which persona to wear.
   */
  moduleAgents: Readonly<Record<string, string>>;
  /**
   * The directories the scanner reads `gizmox`-source agents from — editable
   * in the settings tab, so the roster's reach is a CONFIGURATION and not a
   * hard-coded pair of paths. Spellings are portable, resolved server-side:
   * `~` or `~/…` means the user's home directory, an absolute path is itself,
   * and anything else is relative to the repo root. Later entries win an id
   * collision. An absent field means {@link DEFAULT_AGENT_DIRS}; an empty
   * list is a real statement — "scan no extra directories" — and stays empty.
   */
  agentDirs: readonly string[];
  providers: Partial<Record<ProviderId, ProviderSettings>>;
}

/** The out-of-the-box agent directories: the `.claude/agents` pair Claude Code
 *  itself reads — the user's, then the project's, so the project file wins. */
export const DEFAULT_AGENT_DIRS: readonly string[] = ["~/.claude/agents", ".claude/agents"];

export const DEFAULT_CONFIG: AssistantConfig = {
  provider: "anthropic",
  model: DEFAULT_MODELS.anthropic,
  agentId: DEFAULT_AGENT.id,
  moduleAgents: {},
  agentDirs: DEFAULT_AGENT_DIRS,
  providers: {}
};

/**
 * Parse a stored/`PUT` agent-directory list. Not an array at all (including
 * the absent field every pre-existing config has) means the defaults; an array
 * keeps its sane entries — trimmed, deduplicated, order preserved, because
 * order is the collision rule.
 */
export function parseAgentDirs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_AGENT_DIRS];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const dir = entry.trim();
    if (dir && !out.includes(dir)) out.push(dir);
  }
  return out;
}

/**
 * Which agent a module gets — the pin, then the module's OWN agent, then the
 * configured default, then the built-in.
 *
 * ONE function, called by the chat route (to pick the system prompt) and by the
 * window (to name the agent on the chip and in the composer placeholder). Two
 * copies of this rule is how the header ends up naming an agent that is not the
 * one answering.
 *
 * The middle step is what makes "every module ships with its own agent" free of
 * configuration: a module whose directory carries an agent bundle is answered
 * by that persona the first time its window opens, with nothing stored and
 * nothing chosen. The order around it is deliberate —
 *
 *   - a PIN wins, because it is the owner naming an agent for this module and
 *     a shipped default that overrode an explicit choice would be a bug;
 *   - the module agent beats the configured default, because the default's job
 *     is to answer for modules that have nobody of their own. An owner who
 *     genuinely wants one persona everywhere pins it, which is the same gesture
 *     they already make to vary it.
 *
 * `agents` is optional so the two callers that only know ids keep working; a
 * caller that passes no roster simply skips the middle step.
 */
export function agentForModule(
  config: Pick<AssistantConfig, "agentId" | "moduleAgents">,
  moduleId: string | undefined,
  // Only the three fields the rule reads, so the CLIENT's roster — which the
  // agents route strips of every `system` body — satisfies it without a cast.
  agents?: readonly Pick<AssistantAgent, "id" | "source" | "moduleId">[] | null
): string {
  const pinned = moduleId ? config.moduleAgents?.[moduleId] : undefined;
  if (pinned?.trim()) return pinned.trim();
  const own = moduleId
    ? agents?.find((a) => a.source === "module" && a.moduleId === moduleId)
    : undefined;
  if (own) return own.id;
  return (config.agentId || DEFAULT_AGENT.id).trim() || DEFAULT_AGENT.id;
}

/**
 * Parse a stored/`PUT` module→agent map, dropping anything that is not a pair
 * of non-empty strings.
 *
 * Shared by the route's read and its merge so a hand-edited kv file gets the
 * same gate a request does — the posture `parseChromeAssetsDoc` takes for the
 * chrome document, for the same reason: a malformed entry must cost that one
 * entry, never the config.
 */
export function parseModuleAgents(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [moduleId, agentId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof agentId === "string" && agentId.trim() && moduleId.trim()) {
      out[moduleId] = agentId.trim();
    }
  }
  return out;
}

/** The kv namespace the config persists under. */
export const ASSISTANT_CONFIG_NS = "assistant-config";

/* ── the chat wire ────────────────────────────────────────────────────────── */

export interface WireMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ChatRequest {
  readonly messages: readonly WireMessage[];
  /** Which module the window is assisting — rides into the system prompt. */
  readonly moduleContext?: string;
  /**
   * The module id that context belongs to, so the route can resolve THIS
   * module's pinned agent through {@link agentForModule}.
   *
   * Deliberately the id and not the resolved `agentId`: the client already
   * knows which agent it expects, but letting it SEND that would make the
   * persona a request parameter — and the map that decides it lives server-side
   * precisely so a turn is answered by the agent the config assigns. The
   * `agentId` override below stays for a caller that genuinely means "this one
   * turn, this agent" (the auth probe), and it still wins.
   */
  readonly moduleId?: string;
  /** Optional overrides; absent fields fall back to the stored config. */
  readonly agentId?: string;
  readonly provider?: ProviderId;
  readonly model?: string;
  /**
   * A `claude --resume` session id, echoed back from a previous `done`. Only
   * the subscription path uses it: the CLI holds the history there, so a turn
   * with a session sends the newest message and nothing else. Every other
   * provider is stateless and ignores it.
   */
  readonly sessionId?: string;
}

/** NDJSON events the chat route streams, one JSON object per line. */
export type ChatEvent =
  | { type: "delta"; text: string }
  /** `sessionId` is present on subscription turns — the client must keep it
   *  for the next turn, or the CLI starts a fresh conversation each time. */
  | { type: "done"; provider: ProviderId; model: string; sessionId?: string }
  | { type: "error"; message: string };
