/**
 * @file The assistant's provider layer — Node-only, imported by the chat
 * route. One function per provider, all with the same shape: take the
 * resolved request, call `emit` per text delta, return when the stream ends.
 *
 * Providers:
 *
 *   - **anthropic** — TWO paths, chosen by `settings.authMode`:
 *       · `subscription` (the default) — the signed-in local `claude` CLI,
 *         through `src/server/claudeBroker.ts`. See `runClaudeSubscription`.
 *       · `api-key` — the official `@anthropic-ai/sdk`, streaming, with the
 *         server-side refusal fallback opted in by default (a declined request
 *         re-runs on Anthropic's recommended fallback model instead of dying);
 *   - **openai** / **xai** — the OpenAI-compatible `chat/completions` SSE
 *     wire, over plain fetch. xAI's API is deliberately OpenAI-shaped, which
 *     is why the two share one implementation with different origins.
 *   - **ollama** — the local daemon's `/api/chat` NDJSON stream. No key; the
 *     base URL is the setting.
 *
 * API keys arrive here from the kv store; they are never sent to the client
 * (the config route masks them) and never logged. The subscription path has no
 * key to handle at all — that is the point of it.
 */
import Anthropic from "@anthropic-ai/sdk";

import { MODEL_CATALOG, resolveModel } from "../../modules/buildmgr/models";
import { runBrokerTest, runCliChat } from "../../server/claudeBroker";
import { DEFAULT_ANTHROPIC_AUTH } from "./types";
import type { ProviderId, ProviderSettings, WireMessage } from "./types";

export interface ProviderCall {
  readonly provider: ProviderId;
  readonly model: string;
  readonly system: string;
  readonly messages: readonly WireMessage[];
  readonly settings: ProviderSettings;
  readonly signal: AbortSignal;
  readonly emit: (text: string) => void;
  /** A `claude --resume` id from a previous turn. Subscription path only. */
  readonly sessionId?: string;
  /** Called with the CLI's session id so the client can resume next turn. */
  readonly onSession?: (id: string) => void;
  /**
   * The agent's declared CLI tools (`tools:` in its frontmatter). Honoured on
   * the subscription path, where the broker turns them into `--allowed-tools`;
   * the other paths have no tool loop and ignore the field rather than
   * pretending to enforce it. A module agent ships a read-only set by default
   * — see `DEFAULT_CLI_TOOLS` in scripts/lib/module-agent.mjs.
   */
  readonly allowedTools?: readonly string[];
}

export class ProviderError extends Error {}

export async function runProvider(call: ProviderCall): Promise<void> {
  switch (call.provider) {
    case "anthropic":
      return (call.settings.authMode ?? DEFAULT_ANTHROPIC_AUTH) === "subscription"
        ? runClaudeSubscription(call)
        : runAnthropic(call);
    case "openai":
      return runOpenAiCompatible(call, call.settings.baseUrl ?? "https://api.openai.com");
    case "xai":
      return runOpenAiCompatible(call, call.settings.baseUrl ?? "https://api.x.ai");
    case "ollama":
      return runOllama(call);
  }
}

/**
 * The subscription path: the owner's own signed-in `claude` CLI, spawned by the
 * shared broker. No key is read, stored or sent — account auth is the CLI's,
 * and this file never learns anything about it.
 *
 * ## The model has to be allowlisted, not passed through
 *
 * Everywhere else in this file the model id is free text and a wrong one earns
 * the provider's own 404. Here it reaches a **command line** (`claude` is a
 * `.cmd` shim on Windows, so the broker spawns with `shell: true`), so it goes
 * through `MODEL_CATALOG` and an unknown id is REFUSED rather than forwarded —
 * the same rule `/api/claude` states and for the same reason.
 *
 * ## Continuity is the CLI's, not ours
 *
 * `runCliChat` sends **only the newest user turn** and lets `--resume` supply
 * the history, which is right and is why a long conversation costs a fraction
 * of re-uploading itself every turn. It also means a turn WITHOUT a session id
 * would arrive with no context at all — so the first turn of a conversation
 * that already has history flattens that history into the prompt, once, and
 * every turn after it resumes. The session id rides out on `done` and back in
 * on the next request.
 *
 * ## What the CLI may do while it is answering
 *
 * No `--permission-mode` is passed, so the turn runs at the CLI's default: it
 * can read, it cannot write without being asked, and in `-p` there is nobody to
 * ask. The working directory is the broker's default (the studio package). Both
 * are deliberate and both are visible here rather than buried — an assistant
 * that could edit files from a chat bubble is not what this window is.
 */
async function runClaudeSubscription(call: ProviderCall): Promise<void> {
  const info = resolveCliModel(call.model);
  if (!info) {
    throw new ProviderError(
      `"${call.model}" is not a model the claude CLI is allowlisted for. ` +
        `On a Claude subscription the assistant accepts: ${MODEL_CATALOG.map((m) => m.cliId).join(", ")}.`
    );
  }

  const lastUser = [...call.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) throw new ProviderError("No user turn to send.");
  const prior = call.messages.slice(0, call.messages.lastIndexOf(lastUser));
  const text =
    call.sessionId || prior.length === 0 ? lastUser.content : flatten(prior, lastUser.content);

  const outcome: { sessionId?: string; failure?: string } = {};

  await runCliChat(
    {
      model: info.cliId,
      system: call.system,
      messages: [{ role: "user", text }],
      sessionId: call.sessionId,
      allowedTools: call.allowedTools,
      timeoutMs: SUBSCRIPTION_TIMEOUT_MS
    },
    (event) => {
      // The broker's vocabulary is far wider than a chat pane needs — tool
      // calls, thinking, subagents, rate limits. Prose is `delta`, and only
      // the MAIN thread's (a subagent's prose is its own working-out, not the
      // answer; the broker's own text accumulator draws the same line). The
      // rest is dropped rather than rendered: this window is a chat, and
      // `/claude` already owns the full transcript surface.
      const type = event.type;
      if (type === "delta") {
        if (event.agentId === null && typeof event.text === "string") call.emit(event.text);
      } else if (typeof event.sessionId === "string") {
        // `session`, `done` and `error` all carry it; last one wins.
        outcome.sessionId = event.sessionId;
      }
      if (type === "error" && typeof event.message === "string") outcome.failure = event.message;
    },
    (kill) => {
      // A dismissed window must KILL the CLI, not merely stop reading it — an
      // orphaned `claude` is a cost leak with no UI (claudeBroker's header
      // records that trap and the measurement behind its fix).
      if (call.signal.aborted) kill();
      else call.signal.addEventListener("abort", kill, { once: true });
    }
  );

  if (outcome.sessionId) call.onSession?.(outcome.sessionId);
  if (outcome.failure) throw new ProviderError(outcome.failure);
}

/**
 * Shorter than the broker's own 600s default, on purpose: this is a chat window
 * beside someone's work, not an agentic build step. A turn still running after
 * three minutes has gone wrong, and the broker's timeout is the thing that
 * kills the process rather than leaving it.
 */
const SUBSCRIPTION_TIMEOUT_MS = 180_000;

/**
 * Catalog lookup that tolerates the three spellings of one model.
 *
 * `MODEL_CATALOG` is keyed on the builder's slug (`haiku-4-5`) and CLI id
 * (`claude-haiku-4-5-20251001`); the assistant's own suggestion list uses the
 * API id (`claude-haiku-4-5`), which is neither. That mismatch is real and
 * documented — the catalog's header opens on GizmoX and the builder disagreeing
 * about exactly this model — so the undated form is matched by prefix rather
 * than left to fail. A dated id the catalog does not carry is also stripped and
 * retried, which is what lets a pinned `claude-opus-5-20260101` still resolve.
 */
export function resolveCliModel(model: string) {
  return (
    resolveModel(model) ??
    resolveModel(model.replace(/-\d{8}$/, "")) ??
    MODEL_CATALOG.find((m) => m.cliId.startsWith(`${model}-`))
  );
}

/** Prior turns as a readable preamble, for the one turn that has no session to
 *  resume into. Labelled rather than JSON: it is going into a prompt. */
function flatten(prior: readonly WireMessage[], latest: string): string {
  const history = prior
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  return `## Conversation so far\n\n${history}\n\n---\n\n${latest}`;
}

async function runAnthropic(call: ProviderCall): Promise<void> {
  const apiKey = call.settings.apiKey;
  if (!apiKey) {
    throw new ProviderError(
      "No Anthropic API key is configured — add one in the assistant's settings tab, " +
        "or switch Claude's connection there to your Claude subscription."
    );
  }
  const client = new Anthropic({ apiKey });
  const stream = client.beta.messages.stream(
    {
      model: call.model,
      max_tokens: 8192,
      system: call.system,
      // The server-side refusal fallback, on by default: safety classifiers
      // can decline a request (HTTP 200, stop_reason "refusal"); with this,
      // the API re-runs it on Anthropic's recommended fallback model in the
      // same call instead of returning an empty answer.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: call.messages.map((m) => ({ role: m.role, content: m.content }))
    },
    { signal: call.signal }
  );
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      call.emit(event.delta.text);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new ProviderError("The model declined this request (safety classifiers).");
  }
}

/** OpenAI's `chat/completions` SSE wire, shared by openai and xai. */
async function runOpenAiCompatible(call: ProviderCall, origin: string): Promise<void> {
  const apiKey = call.settings.apiKey;
  if (!apiKey) {
    throw new ProviderError(
      `No ${call.provider === "xai" ? "xAI" : "OpenAI"} API key is configured — add one in the assistant's settings tab.`
    );
  }
  const res = await fetch(`${origin.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    signal: call.signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: call.model,
      stream: true,
      messages: [
        { role: "system", content: call.system },
        ...call.messages.map((m) => ({ role: m.role, content: m.content }))
      ]
    })
  });
  if (!res.ok || !res.body) {
    throw new ProviderError(`${call.provider} answered HTTP ${res.status}: ${await safeText(res)}`);
  }
  // SSE: `data: {json}` lines, ending with `data: [DONE]`.
  for await (const line of lines(res.body)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
      const text = evt.choices?.[0]?.delta?.content;
      if (text) call.emit(text);
    } catch {
      // A malformed frame is skipped, not fatal — the stream continues.
    }
  }
}

async function runOllama(call: ProviderCall): Promise<void> {
  const base = (call.settings.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      signal: call.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: call.model,
        stream: true,
        messages: [
          { role: "system", content: call.system },
          ...call.messages.map((m) => ({ role: m.role, content: m.content }))
        ]
      })
    });
  } catch {
    throw new ProviderError(`No Ollama daemon answered at ${base} — is it running?`);
  }
  if (!res.ok || !res.body) {
    throw new ProviderError(`ollama answered HTTP ${res.status}: ${await safeText(res)}`);
  }
  // NDJSON: one JSON object per line, `done: true` on the last.
  for await (const line of lines(res.body)) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
      if (evt.error) throw new ProviderError(evt.error);
      const text = evt.message?.content;
      if (text) call.emit(text);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
    }
  }
}

/** The models the subscription path will accept — the CLI catalog's own ids,
 *  not the API spellings, because these are what reach `claude --model`. */
export function subscriptionModels(): string[] {
  return MODEL_CATALOG.map((m) => m.cliId);
}

/**
 * "Is the Claude subscription actually connected?" — answered by running one
 * tiny real turn through the CLI, not by checking that a binary exists.
 *
 * `claude --version` succeeds while signed OUT, so a version probe would report
 * a working connection to someone who has none. The broker's `runBrokerTest`
 * sends "Reply with exactly: OK" and reports what came back, which is the only
 * answer that distinguishes *installed* from *signed in*. It costs a few tokens
 * against the plan; that is the price of a status line that is true.
 */
export function testSubscription(model: string): Promise<{ ok: boolean; detail: string }> {
  const info = resolveCliModel(model);
  if (!info) {
    return Promise.resolve({
      ok: false,
      detail: `"${model}" is not a model the claude CLI is allowlisted for.`
    });
  }
  return runBrokerTest(info.cliId);
}

/** List the local Ollama daemon's installed models — the settings tab's
 *  model picker calls this so the list is the machine's, not a guess. */
export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const base = (baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: { name?: string }[] };
    return (body.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "(unreadable body)";
  }
}

/** Split a byte stream into text lines, tolerant of chunk boundaries. */
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        yield buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
      }
    }
    if (buffer) yield buffer;
  } finally {
    reader.releaseLock();
  }
}
