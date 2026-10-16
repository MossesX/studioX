/**
 * @file The assistant's client store — window state, per-module transcripts,
 * the config/agents caches, and the one streaming `send()`.
 *
 * A store rather than component state for the standing reason: the writers
 * have no hooks. The `assistant.toggle` command (fired from the command bar
 * or a context menu) is a plain function; the window is the one React reader.
 *
 * ── PERSISTENCE, AND WHY sessionStorage ───────────────────────────────────────
 *
 * Every nav click in this app is `window.location.assign` — a full document
 * load — so in-memory state dies on every page change. The window being open
 * and the conversation so far must survive that or the assistant forgets
 * everything each time you follow its own advice to another module. They ride
 * `sessionStorage` (per-tab, cleared when the tab closes): a chat with an
 * assistant is a session-shaped thing, and resurrecting week-old transcripts
 * from localStorage is how a chat window turns into a junk drawer. Window
 * GEOMETRY is the exception — where you put the window is a preference, not
 * a conversation — and lives in localStorage inside the window component.
 *
 * Transcripts are PER MODULE, keyed by the hosted module id (`shell` on
 * routes hosting none): "help with the thing on screen" is the plugin's whole
 * premise, so the conversation follows the screen.
 */
"use client";

import { hostedModule, registry } from "@axf/core";

import { agentForModule, DEFAULT_AGENT } from "./types";
import type {
  AnthropicAuthMode,
  AssistantAgent,
  ChatEvent,
  MaskedProviderSettings,
  ProviderId,
  WireMessage
} from "./types";

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly ts: number;
  /** Stamped on assistant turns: which provider/model actually answered. */
  readonly provider?: string;
  readonly model?: string;
}

export interface Transcript {
  readonly messages: readonly ChatMessage[];
  readonly streaming: boolean;
  /** The live draft while a turn streams. */
  readonly draft: string;
  /**
   * The `claude --resume` id, when the last turn came back with one — only the
   * Anthropic *subscription* connection sets it, because only there does the
   * history live in a CLI session rather than in this array. Held per module
   * for the same reason the transcript is: the conversation follows the screen,
   * so its session has to as well.
   */
  readonly sessionId?: string;
}

export interface MaskedConfig {
  provider: ProviderId;
  model: string;
  /** The agent a module with no pin of its own gets. */
  agentId: string;
  /** moduleId → agentId. Absent key = follow `agentId`. See `types.ts`. */
  moduleAgents: Readonly<Record<string, string>>;
  /** The scanned agent directories, in collision order. See `types.ts`. */
  agentDirs: readonly string[];
  providers: Partial<Record<ProviderId, MaskedProviderSettings>>;
}

/** The watermark's tone is a theme ROLE, never a colour — each one names an
 *  `--axf-*` variable the drawing's own `--gxb-*` fills are re-pointed at, so
 *  the watermark re-tints on every theme roll and ships no hex. */
export type LogoTone = "accent" | "accent2" | "accent3" | "ink" | "dim";

export const LOGO_TONES: readonly LogoTone[] = ["accent", "accent2", "accent3", "ink", "dim"];

/** The chat window's watermark logo — always present behind the transcript,
 *  animating only while a reply streams. See `AssistantWindow.tsx` for the
 *  SMIL mechanics. */
export interface LogoPrefs {
  /** Pack id of an ANIMATED drawing (`GlyphEntry.animated`). */
  readonly asset: string;
  /** Multiplier over the drawing's own SMIL `dur`s. 1 = as authored. */
  readonly speed: number;
  readonly tone: LogoTone;
  readonly opacity: number;
}

export const DEFAULT_LOGO: LogoPrefs = {
  asset: "anim-icon-bolt-flicker",
  speed: 1,
  tone: "accent",
  opacity: 0.08
};

/** localStorage, not sessionStorage: like the window's geometry, the watermark
 *  is a look preference, not a conversation. */
const LOGO_KEY = "axs:assistant-logo@1";

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
}

function sanitizeLogo(doc: Partial<LogoPrefs> | null | undefined): LogoPrefs {
  const tone = doc?.tone;
  return {
    asset: typeof doc?.asset === "string" && doc.asset ? doc.asset : DEFAULT_LOGO.asset,
    speed: clampNum(doc?.speed, 0.25, 4, DEFAULT_LOGO.speed),
    tone: (LOGO_TONES as readonly string[]).includes(tone as string)
      ? (tone as LogoTone)
      : DEFAULT_LOGO.tone,
    opacity: clampNum(doc?.opacity, 0.02, 0.5, DEFAULT_LOGO.opacity)
  };
}

export interface AssistantState {
  readonly open: boolean;
  readonly minimized: boolean;
  readonly view: "chat" | "settings";
  readonly moduleId: string;
  readonly transcripts: Readonly<Record<string, Transcript>>;
  readonly config: MaskedConfig | null;
  readonly agents: readonly Omit<AssistantAgent, "system">[] | null;
  readonly logo: LogoPrefs;
}

const EMPTY_TRANSCRIPT: Transcript = { messages: [], streaming: false, draft: "" };

const STORAGE_KEY = "axs:assistant@1";

type Listener = () => void;

let idCounter = 0;
const nextId = () => `m${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

/** What the assistant tells the model about the module on screen. Composed
 *  from the live registry, so it is never stale and never hand-authored. */
export function moduleContextFor(moduleId: string): string | undefined {
  const mod = registry.module(moduleId);
  if (!mod) return undefined;
  const points = mod.points.length
    ? mod.points.map((p) => `- \`${p.id}\` (${p.kind}): ${p.description}`).join("\n")
    : "- (none)";
  const settings = mod.settings
    ? mod.settings.rows.map((r) => `- ${r.label}: ${r.hint}`).join("\n")
    : "- (none)";
  return [
    `id: ${mod.id}`,
    `title: ${mod.title}`,
    `route: ${mod.route}`,
    `summary: ${mod.summary}`,
    `extension points:\n${points}`,
    `settings (opened via the gear on the module, or right-click → Module settings):\n${settings}`
  ].join("\n");
}

class AssistantStore {
  #state: AssistantState = {
    open: false,
    minimized: false,
    view: "chat",
    moduleId: "shell",
    transcripts: {},
    config: null,
    agents: null,
    logo: DEFAULT_LOGO
  };
  #serverState: AssistantState = this.#state;
  #restored = false;
  #listeners = new Set<Listener>();
  #abort: AbortController | null = null;

  /* ── plumbing ─────────────────────────────────────────────────────────── */

  #restore(): void {
    if (this.#restored || typeof window === "undefined") return;
    this.#restored = true;
    try {
      const rawLogo = window.localStorage.getItem(LOGO_KEY);
      if (rawLogo) {
        this.#state = {
          ...this.#state,
          logo: sanitizeLogo(JSON.parse(rawLogo) as Partial<LogoPrefs>)
        };
      }
    } catch {
      // A corrupt doc reads as the default look.
    }
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const doc = JSON.parse(raw) as {
        v?: number;
        open?: boolean;
        minimized?: boolean;
        transcripts?: Record<string, { messages: ChatMessage[]; sessionId?: string }>;
      };
      if (doc?.v !== 1) return;
      const transcripts: Record<string, Transcript> = {};
      for (const [key, t] of Object.entries(doc.transcripts ?? {})) {
        if (Array.isArray(t?.messages)) {
          transcripts[key] = {
            messages: t.messages,
            streaming: false,
            draft: "",
            // Restored with the transcript, for the same reason the transcript
            // is restored at all: every nav in this app is a full document
            // load, and a CLI session dropped on each one would make the
            // subscription connection re-send the whole conversation every
            // time the user follows the assistant's own advice to a module.
            sessionId: typeof t.sessionId === "string" ? t.sessionId : undefined
          };
        }
      }
      this.#state = {
        ...this.#state,
        open: Boolean(doc.open),
        minimized: Boolean(doc.minimized),
        transcripts
      };
    } catch {
      // A corrupt doc reads as a fresh session.
    }
  }

  #persist(): void {
    try {
      const transcripts: Record<string, { messages: readonly ChatMessage[]; sessionId?: string }> = {};
      for (const [key, t] of Object.entries(this.#state.transcripts)) {
        if (t.messages.length) {
          transcripts[key] = { messages: t.messages.slice(-80), sessionId: t.sessionId };
        }
      }
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: 1,
          open: this.#state.open,
          minimized: this.#state.minimized,
          transcripts
        })
      );
    } catch {
      // Quota: the session keeps its in-memory state.
    }
  }

  #set(patch: Partial<AssistantState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#persist();
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: Listener): (() => void) => {
    this.#restore();
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): AssistantState => {
    this.#restore();
    return this.#state;
  };

  /** Server snapshot: closed, empty — hydration cannot tear. */
  getServerState = (): AssistantState => this.#serverState;

  /* ── window controls (command-callable: no hooks, no arguments) ───────── */

  toggle(): void {
    this.#restore();
    if (this.#state.open && !this.#state.minimized) this.#set({ open: false });
    else this.#set({ open: true, minimized: false, moduleId: this.#currentModuleId() });
  }

  open(): void {
    this.#restore();
    this.#set({ open: true, minimized: false, moduleId: this.#currentModuleId() });
  }

  close(): void {
    this.#abort?.abort();
    this.#set({ open: false });
  }

  minimize(on: boolean): void {
    this.#set({ minimized: on });
  }

  setView(view: "chat" | "settings"): void {
    this.#set({ view });
  }

  /** Watermark preferences — applied instantly (they are a look, like the
   *  theme, and the theme rules say looks hot-render with no confirm step)
   *  and persisted per browser under their own key. */
  setLogo(patch: Partial<LogoPrefs>): void {
    this.#restore();
    const logo = sanitizeLogo({ ...this.#state.logo, ...patch });
    try {
      window.localStorage.setItem(LOGO_KEY, JSON.stringify(logo));
    } catch {
      // Quota: the session keeps its in-memory value.
    }
    this.#set({ logo });
  }

  #currentModuleId(): string {
    return hostedModule()?.id ?? "shell";
  }

  /** Re-read the hosted module — the window calls this on mount, which after
   *  a full-document nav is exactly once per page. */
  syncModule(): void {
    const moduleId = this.#currentModuleId();
    if (moduleId !== this.#state.moduleId) this.#set({ moduleId });
  }

  transcript(moduleId: string): Transcript {
    return this.#state.transcripts[moduleId] ?? EMPTY_TRANSCRIPT;
  }

  clearTranscript(moduleId: string): void {
    this.#abort?.abort();
    const transcripts = { ...this.#state.transcripts };
    delete transcripts[moduleId];
    this.#set({ transcripts });
  }

  /* ── config + agents ──────────────────────────────────────────────────── */

  async loadConfig(force = false): Promise<void> {
    if (this.#state.config && !force) return;
    try {
      const res = await fetch("/api/assistant/config", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { config: MaskedConfig };
      this.#set({ config: body.config });
    } catch {
      // Route down: the chat still works with server-side defaults.
    }
  }

  async saveConfig(patch: {
    provider?: ProviderId;
    model?: string;
    agentId?: string;
    /** Merged by key server-side; `""` unpins that module. */
    moduleAgents?: Record<string, string>;
    /** REPLACED whole server-side when sent — the settings tab's list editor
     *  owns the whole list. Absent keeps the stored one. */
    agentDirs?: string[];
    providers?: Partial<
      Record<ProviderId, { apiKey?: string; baseUrl?: string; authMode?: AnthropicAuthMode }>
    >;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch("/api/assistant/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      const body = (await res.json()) as { config?: MaskedConfig; error?: string };
      if (!res.ok || !body.config) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      this.#set({ config: body.config });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async loadAgents(force = false): Promise<void> {
    if (this.#state.agents && !force) return;
    try {
      const res = await fetch("/api/assistant/agents", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { agents: Omit<AssistantAgent, "system">[] };
      this.#set({ agents: body.agents });
    } catch {
      this.#set({ agents: [DEFAULT_AGENT] });
    }
  }

  /* ── which agent this module talks to ─────────────────────────────────── */

  /**
   * The agent id in force for a module — its pin, else the module's OWN agent,
   * else the default.
   *
   * Through `agentForModule`, the SAME function the chat route resolves with,
   * so the name on the header chip is the name of the agent that answers.
   *
   * The ROSTER has to be passed, and that is the whole point of this line: the
   * middle step (a module answered by the agent its own directory ships) can
   * only be taken by someone holding the list of agents. When it was omitted
   * here, the peeled demo opened its window captioned "Amber" while the server
   * answered as "Iris" — the exact split `agentForModule`'s docblock warns
   * about, found by reading the chip in a peeled app.
   */
  agentIdFor(moduleId: string): string {
    const config = this.#state.config;
    if (!config) return DEFAULT_AGENT.id;
    return agentForModule(config, moduleId, this.#state.agents);
  }

  /** Whether this module has a pin of its own, as opposed to following the
   *  default. The window shows the difference, because they behave
   *  differently when the default changes. */
  isAgentPinned(moduleId: string): boolean {
    return Boolean(this.#state.config?.moduleAgents?.[moduleId]);
  }

  /**
   * Pin an agent to one module, or unpin it with `null`.
   *
   * **Drops that module's CLI `sessionId`.** On the Anthropic subscription path
   * the history lives in a `claude --resume` session that was started under the
   * OLD agent's system prompt, so resuming it would keep answering as the agent
   * you just switched away from — the setting would look applied and not be.
   * The transcript is deliberately KEPT: the conversation is the person's, and
   * only the thread the CLI holds has to restart.
   */
  async setModuleAgent(moduleId: string, agentId: string | null): Promise<{ ok: boolean; error?: string }> {
    const result = await this.saveConfig({ moduleAgents: { [moduleId]: agentId ?? "" } });
    if (!result.ok) return result;
    const current = this.transcript(moduleId);
    if (current.sessionId) this.#patchTranscript(moduleId, { sessionId: undefined });
    return result;
  }

  /* ── the turn ─────────────────────────────────────────────────────────── */

  stop(): void {
    this.#abort?.abort();
  }

  async send(moduleId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const existing = this.transcript(moduleId);
    if (existing.streaming) return;

    const userMsg: ChatMessage = { id: nextId(), role: "user", text: trimmed, ts: Date.now() };
    const base = [...existing.messages, userMsg];
    this.#patchTranscript(moduleId, { messages: base, streaming: true, draft: "" });

    const wire: WireMessage[] = base
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));

    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;

    let draft = "";
    let finished: { provider: string; model: string; sessionId?: string } | null = null;
    let failed: string | null = null;
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        signal: abort.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: wire,
          // The id as well as the context block: the route resolves THIS
          // module's pinned agent from it (`agentForModule`), which is what
          // makes the per-module choice govern the answer rather than only
          // the label on the chip.
          moduleId,
          moduleContext: moduleContextFor(moduleId),
          sessionId: existing.sessionId
        })
      });
      if (!res.ok || !res.body) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        failed = errBody?.error ?? `HTTP ${res.status}`;
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (!line.trim()) continue;
            let evt: ChatEvent;
            try {
              evt = JSON.parse(line) as ChatEvent;
            } catch {
              continue;
            }
            if (evt.type === "delta") {
              draft += evt.text;
              this.#patchTranscript(moduleId, { draft });
            } else if (evt.type === "done") {
              finished = { provider: evt.provider, model: evt.model, sessionId: evt.sessionId };
            } else if (evt.type === "error") {
              failed = evt.message;
            }
          }
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) failed = String(err);
    }

    const closing: ChatMessage[] = [];
    if (draft || finished) {
      closing.push({
        id: nextId(),
        role: "assistant",
        text: draft || "(empty response)",
        ts: Date.now(),
        provider: finished?.provider,
        model: finished?.model
      });
    }
    if (failed) {
      closing.push({ id: nextId(), role: "system", text: failed, ts: Date.now() });
    }
    if (abort.signal.aborted && draft && !finished) {
      closing.push({ id: nextId(), role: "system", text: "stopped", ts: Date.now() });
    }
    this.#patchTranscript(moduleId, {
      messages: [...base, ...closing],
      streaming: false,
      draft: "",
      // Keep the previous id when a turn brings none back: a stateless provider
      // answering one question mid-conversation must not end the CLI session
      // the subscription turns before it were resuming.
      sessionId: finished?.sessionId ?? existing.sessionId
    });
    if (this.#abort === abort) this.#abort = null;
  }

  #patchTranscript(moduleId: string, patch: Partial<Transcript>): void {
    const current = this.transcript(moduleId);
    this.#set({
      transcripts: { ...this.#state.transcripts, [moduleId]: { ...current, ...patch } }
    });
  }
}

export const assistant = new AssistantStore();
