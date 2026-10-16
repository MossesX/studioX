/**
 * @file The Claude transport — spawns the local `claude` CLI and turns its
 * `stream-json` output into normalised NDJSON. This is the whole of the
 * `claude` subsystem's P0: everything above it (service API, session store,
 * extension points, the workspace screen) is later phases.
 *
 * ── provenance ───────────────────────────────────────────────────────────────
 *
 * Ported 2026-08-12 from `GizmoX/src/lib/server/claudeBroker.ts` (553 lines, in
 * production there). `axf-claude.bmpx` calls this "the finding that makes this
 * cheap", and it held: that file imports ONLY `node:child_process`,
 * `node:fs/promises` and `node:path` — zero GizmoX imports — so the port is a
 * copy rather than a rewrite. This file imports only `node:child_process` and
 * its own sibling `claudeEvents.ts`, so the AmberX-side path contains no GizmoX
 * import either, which is half of P0's gate.
 *
 * ── what was dropped, and why ────────────────────────────────────────────────
 *
 * **The `api-key` auth mode is gone**, on the project's own instruction: *"Do
 * not add an api-key path unless asked — the second auth mode in the GizmoX
 * broker is optional here and shipping it invites someone to configure the
 * wrong one."* The CLI mode **is** the subscription: account auth, no key
 * stored anywhere, `--resume` for continuity. In a container the token comes
 * from `CLAUDE_CODE_OAUTH_TOKEN`; there is no `ANTHROPIC_API_KEY` in this path
 * and nothing here will read one.
 *
 * Removing it took real code with it, none of it missed:
 *   - `ANTHROPIC_URL` / `ANTHROPIC_VERSION`, `runApiKeyChat`, and the api-key
 *     half of `runBrokerTest`;
 *   - `BrokerAuthMode` — with one mode there is nothing to select;
 *   - `BrokerAuthFile` / `BrokerKeyStore` / `makeKeyStore` — a key store with no
 *     key to store, and with it the only reason this file imported `node:fs`
 *     and `node:path`;
 *   - `maxTokens` and `clampMaxTokens` — `claude` exposes no max-tokens flag, so
 *     the clamp only ever fed the Messages API call. Keeping it would have left
 *     a knob on the API that reaches nothing.
 *
 * ── what was added, and why ──────────────────────────────────────────────────
 *
 *  - **Event translation moved out** to `claudeEvents.ts`. GizmoX's broker
 *    collapses the stream to `delta`/`done`/`error` — it feeds a chat pane that
 *    renders prose. This subsystem's consumers need tool calls, thinking,
 *    subagents and errors, so the vocabulary is wider and is pinned to a real
 *    captured transcript. Splitting it out is what lets a fixture be replayed
 *    through the normaliser with no process and no network.
 *  - **`cwd`, `permissionMode` and `effort`** on the turn params. Without `cwd`
 *    the subsystem can never be pointed at a project (P4 is exactly that);
 *    without `permissionMode` no tool event can ever occur through this route,
 *    which would make the captured vocabulary unreachable. Both are validated
 *    here — everything on this list reaches a command line.
 *  - **`killTree()`** — one chokepoint for ending a turn. See the trap.
 *
 * ── the trap the project warned about ────────────────────────────────────────
 *
 * *"STOP MUST KILL THE PROCESS. Aborting a stream has to terminate the spawned
 * child, not merely close the reader. A CLI left running after the user hits
 * stop is a cost leak with no UI."*
 *
 * Every path that ends a turn — client abort, timeout, connection close — goes
 * through the one `killTree()` below, and it was VERIFIED by watching a real
 * spawn die rather than by reading the docs: a turn aborted mid-stream through
 * `/api/claude` leaves no `claude.exe` under the dev server.
 *
 * That function is also where an assumption got corrected. It began as a
 * `taskkill /T /F`, because `shell: true` means the handle here is cmd.exe and
 * the CLI is its child. Measurement showed the kill already cascades through
 * the shared console — even to a `PING.EXE` three levels down — so the special
 * case was removed rather than kept "just in case". Its header records the
 * experiment and the spawn options the cascade depends on.
 *
 * **Node-only.** `node:child_process` is imported here; nothing in this file
 * may be pulled into a client bundle.
 */

import { spawn } from "node:child_process";

import { normaliseCliLine, type BrokerEvent, type CliUsage } from "./claudeEvents";

/** The one clamp that survived the api-key removal. */
export const BROKER_LIMITS = {
  timeoutS: { min: 30, max: 3600, default: 600 }
} as const;

export function clampTimeoutS(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : BROKER_LIMITS.timeoutS.default;
  return Math.min(BROKER_LIMITS.timeoutS.max, Math.max(BROKER_LIMITS.timeoutS.min, Math.round(n)));
}

/** `claude --permission-mode` values. Allowlisted, not passed through: this
 *  string reaches a command line. */
export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** `claude --effort` levels. The CLI exposes no temperature or top-p, so effort
 *  is the whole of the depth dial — there is no sampling knob to forward. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function isPermissionMode(v: unknown): v is PermissionMode {
  return typeof v === "string" && (PERMISSION_MODES as readonly string[]).includes(v);
}
export function isEffortLevel(v: unknown): v is EffortLevel {
  return typeof v === "string" && (EFFORT_LEVELS as readonly string[]).includes(v);
}

export interface BrokerWireMessage {
  role: "user" | "assistant";
  text: string;
}

export interface BrokerChatParams {
  /** Already allowlisted by the caller — this string reaches a command line. */
  model: string;
  system: string;
  messages: BrokerWireMessage[];
  /** `claude --resume` session. The continuity mechanism: the CLI holds the
   *  history, so only the newest user turn is sent. */
  sessionId?: string;
  /** Working directory the CLI runs in — what a tool call can see. */
  cwd?: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  /**
   * Tool names the turn is allowed to use — the CLI's `--allowed-tools`.
   *
   * Absent means "the CLI's own defaults", which is what every caller meant
   * before agents could declare a tool set, so an omitted field changes
   * nothing. Present, it NARROWS: an agent whose frontmatter says `["Read",
   * "Grep"]` gets a turn that can read and search and nothing else. Each name
   * reaches a command line (the spawn uses `shell: true`), so the caller is
   * responsible for what it puts here — the same contract `model` carries two
   * fields up, and `runCliChat` refuses anything that is not a plain tool name
   * or a `Tool(scope)` form rather than trusting it.
   */
  allowedTools?: readonly string[];
  timeoutMs: number;
}

/** Per-turn price in USD. Injected so this file never imports a model roster.
 *  OPTIONAL, and only a fallback: the CLI reports `total_cost_usd` on its
 *  `result` line and that figure is authoritative — it is what the account was
 *  actually charged, cache tiers included. A local rate table cannot know that
 *  (capture-a: 67 input tokens but 464,153 cache-read). */
export type CostFn = (model: string, usage: CliUsage) => number;

export type BrokerEmit = (event: Record<string, unknown>) => void;

/* ------------------------------ request parsing ----------------------------- */

/** Pull a valid wire history out of an untrusted JSON body. Anything that is
 *  not a `user`/`assistant` message with text is dropped rather than rejected —
 *  the only hard requirement is that at least one real user turn survives. */
export function parseWireMessages(raw: unknown): BrokerWireMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is { role: string; text: string } =>
        !!m &&
        typeof m === "object" &&
        ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
        typeof (m as { text?: unknown }).text === "string"
    )
    .map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
}

export function hasUserTurn(messages: BrokerWireMessage[]): boolean {
  return messages.some((m) => m.role === "user" && m.text.trim() !== "");
}

/* -------------------------------- CLI probing ------------------------------- */

let cliProbe: { at: number; ok: boolean; detail: string } | null = null;

/** `claude --version` with a short leash, cached for 30s so a status poll and a
 *  panel mounting do not stack spawns. */
export function probeClaudeCli(): Promise<{ ok: boolean; detail: string }> {
  if (cliProbe && Date.now() - cliProbe.at < 30_000) {
    return Promise.resolve({ ok: cliProbe.ok, detail: cliProbe.detail });
  }
  return new Promise((resolve) => {
    const finish = (ok: boolean, detail: string) => {
      cliProbe = { at: Date.now(), ok, detail };
      resolve({ ok, detail });
    };
    try {
      const child = spawn("claude", ["--version"], { shell: true, windowsHide: true });
      let out = "";
      const timer = setTimeout(() => {
        killTree(child);
        finish(false, "claude CLI did not answer --version within 8s");
      }, 8000);
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        finish(false, `claude CLI not launchable: ${err.message}`);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && out.trim()) finish(true, out.trim().split("\n")[0]);
        else finish(false, `claude --version exited with code ${code}`);
      });
    } catch (err) {
      finish(false, `claude CLI not launchable: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/* ------------------------------- killing a turn ----------------------------- */

/**
 * Kill a spawned turn. The ONE place a turn is terminated, so if the cascade
 * below ever stops holding there is a single line to change.
 *
 * ── measured, not assumed ────────────────────────────────────────────────────
 *
 * The worry was the Windows case. `claude` is a `.cmd` shim so it needs
 * `shell: true`, which means the handle held here is **cmd.exe** and the CLI is
 * its child — the textbook orphan setup, and the project names the consequence:
 * *"a CLI left running after the user hits stop is a cost leak with no UI."*
 * This function was originally a `taskkill /T /F`, on that reasoning.
 *
 * The reasoning was wrong, and measuring it is what showed that. Two isolated
 * experiments on win32, CLI 2.1.229, spawned exactly as `runCliChat` spawns:
 *
 *   - a plain streaming turn — `child.kill()` on the shell, tree gone;
 *   - a turn holding a whole subtree of its own (`claude.exe` → three
 *     `bash.exe` → `PING.EXE`, from a Bash tool call) — `child.kill()` on the
 *     shell, **entire subtree gone**, PING included.
 *
 * The children share the spawn's hidden console, and losing it takes all of
 * them. So `taskkill` was solving a problem that does not exist here, and its
 * comment asserted a leak nobody had observed. Both are gone.
 *
 * **What would bring the leak back**, and therefore what to re-measure if any
 * of it changes: spawning with `detached: true`, giving the child its own
 * console, or redirecting stdio such that the CLI no longer shares one. The
 * cascade is a property of the spawn options above, not a guarantee of Windows.
 */
export function killTree(child: { pid?: number; kill: (sig?: NodeJS.Signals) => boolean }): void {
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone — a turn that finished on its own is still "stopped" */
  }
}

/* ------------------------------ stream plumbing ----------------------------- */

/** Wrap a producer in an NDJSON `Response`. The producer gets an `emit` and an
 *  `onAbort` hook; a client that closes the connection aborts whatever is
 *  running instead of leaking it. */
export function ndjsonStream(
  run: (
    emit: BrokerEmit,
    signals: { closed: () => boolean; onAbort: (fn: () => void) => void }
  ) => Promise<void>,
  reqSignal: AbortSignal
): Response {
  const enc = new TextEncoder();
  let closed = false;
  const abortFns: (() => void)[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit: BrokerEmit = (event) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      reqSignal.addEventListener("abort", () => {
        for (const fn of abortFns) fn();
        close();
      });
      run(emit, { closed: () => closed, onAbort: (fn) => abortFns.push(fn) })
        .catch((err) => emit({ type: "error", message: err instanceof Error ? err.message : String(err) }))
        .finally(close);
    },
    cancel() {
      closed = true;
      for (const fn of abortFns) fn();
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform"
    }
  });
}

/* ---------------------------------- cli mode -------------------------------- */

/**
 * One turn through the local `claude` CLI — the subscription path.
 *
 * The session carries history, so only the newest user message is sent and the
 * system contract is prepended on a session's FIRST turn only (a `--resume`
 * already has it). The prompt goes over **stdin**, never the command line: with
 * `shell: true` a command-line prompt would be parsed by cmd.exe.
 *
 * Emits the full normalised vocabulary from `claudeEvents.ts`, then exactly one
 * terminal `done` or `error`.
 */
export function runCliChat(
  p: BrokerChatParams,
  emit: BrokerEmit,
  onAbort: (fn: () => void) => void,
  costUsd?: CostFn
): Promise<void> {
  return new Promise((resolve) => {
    const lastUser = [...p.messages].reverse().find((m) => m.role === "user");
    const prompt = lastUser?.text ?? "";
    const fullPrompt = p.sessionId || !p.system ? prompt : `${p.system}\n\n---\n\n${prompt}`;

    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
    if (p.sessionId) args.push("--resume", p.sessionId);
    args.push("--model", p.model); // already allowlisted by the caller
    if (p.permissionMode && p.permissionMode !== "default") {
      args.push("--permission-mode", p.permissionMode);
    }
    if (p.effort) args.push("--effort", p.effort);
    // Tool names go on a command line parsed by cmd.exe (`shell: true`), so
    // they are gated to the CLI's own vocabulary — a bare tool name, or the
    // `Tool(scope)` form its docs use. Anything else is DROPPED rather than
    // quoted: a caller that means `Bash(git *)` gets it, and a caller that
    // sends a shell fragment gets nothing instead of a spawn that runs it.
    const allowed = (p.allowedTools ?? []).filter((t) => /^[A-Za-z_][\w-]*(\([^()"'`$&|;<>]*\))?$/.test(t));
    if (allowed.length) args.push("--allowed-tools", allowed.join(","));

    const child = spawn("claude", args, {
      cwd: p.cwd ?? process.cwd(),
      shell: true,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1" }
    });
    onAbort(() => killTree(child));

    child.stdin.write(fullPrompt);
    child.stdin.end();

    /* Accumulated turn state. `text` is built from deltas rather than from the
     * whole `assistant` messages: a tool loop produces one per round trip
     * (capture-a has seven), so assigning the latest would keep only the last.
     * `result.result` overrides it at the end where present, being the CLI's
     * own final answer. */
    let text = "";
    let sessionId: string | undefined = p.sessionId;
    let usage: CliUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0
    };
    let reportedCost: number | null = null;
    let settled = false;
    let errBuf = "";
    let outBuf = "";

    const finish = () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        emit({
          type: "done",
          text,
          sessionId,
          usage,
          // The CLI's own figure first; the injected table only if it is absent.
          costUsd: reportedCost ?? (costUsd ? costUsd(p.model, usage) : null)
        });
      }
      resolve();
    };
    const fail = (message: string) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        emit({ type: "error", message, sessionId });
      }
      resolve();
    };
    const timer = setTimeout(() => {
      killTree(child);
      fail(`claude CLI turn exceeded the ${Math.round(p.timeoutMs / 1000)}s timeout and was terminated.`);
    }, p.timeoutMs);

    const handle = (ev: BrokerEvent) => {
      // Everything reaches the client — including `unknown`, so a CLI event
      // kind added tomorrow is visible rather than silently absent.
      emit(ev as unknown as Record<string, unknown>);
      switch (ev.type) {
        case "session":
          sessionId = ev.sessionId;
          break;
        case "delta":
          // Main thread only: a subagent's prose is its own, not the answer.
          if (ev.agentId === null) text += ev.text;
          break;
        case "result": {
          if (ev.sessionId) sessionId = ev.sessionId;
          if (typeof ev.costUsd === "number") reportedCost = ev.costUsd;
          usage = ev.usage;
          if (ev.isError) {
            // The error path carries no `result` field — the reason is in
            // `errors[]`. Reading only `.result` here would report "" (capture-c).
            fail(ev.errors.join("; ") || ev.text || `claude CLI reported ${ev.subtype ?? "an error"}.`);
            return;
          }
          if (ev.text) text = ev.text;
          break;
        }
        default:
          break;
      }
    };

    child.stdout.on("data", (d: Buffer) => {
      outBuf += d.toString();
      const lines = outBuf.split("\n");
      // A partial trailing line stays buffered rather than parsing as garbage.
      outBuf = lines.pop() ?? "";
      for (const line of lines) {
        for (const ev of normaliseCliLine(line)) handle(ev);
        if (settled) return;
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      errBuf += d.toString();
    });
    child.on("error", (err) => {
      fail(`Failed to launch the claude CLI: ${err.message}. Is Claude Code installed and on PATH?`);
    });
    child.on("close", (code) => {
      // Flush a final unterminated line before deciding — the last event of a
      // short run can arrive without its newline.
      if (outBuf.trim()) {
        for (const ev of normaliseCliLine(outBuf)) handle(ev);
        outBuf = "";
      }
      if (code !== 0 && !text && !settled) {
        fail(`claude exited with code ${code}: ${errBuf.slice(0, 600) || "(no stderr)"}`);
      } else {
        finish();
      }
    });
  });
}

/* ---------------------------------- test hook ------------------------------- */

/** One tiny real round trip — the only honest answer to "is this wired up?".
 *  With the api-key mode gone this is the CLI path and nothing else. */
export async function runBrokerTest(model: string): Promise<{ ok: boolean; detail: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", "--output-format", "json", "--model", model], {
      cwd: process.cwd(),
      shell: true,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1" }
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      killTree(child);
      resolve({ ok: false, detail: "claude CLI test turn timed out after 90s." });
    }, 90_000);
    child.stdin.write("Reply with exactly: OK");
    child.stdin.end();
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: `claude CLI not launchable: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        // The CLI's REAL failure ("Your organization has disabled…", "out of
        // usage credits") arrives as a result JSON on STDOUT even when the exit
        // code is nonzero; stderr is usually just config warnings. Same lesson
        // `/api/amberxvid/portrait` records — stdout wins, stderr is fallback.
        let said = "";
        try {
          const r = JSON.parse(out) as { result?: string; errors?: string[] };
          said = r.errors?.join("; ") || r.result || "";
        } catch {
          // Not JSON — fall through to the raw streams.
        }
        resolve({
          ok: false,
          detail:
            said.slice(0, 300) ||
            `claude exited with code ${code}: ${(err.trim() || out.trim() || "(no output)").slice(0, 300)}`
        });
        return;
      }
      try {
        const r = JSON.parse(out) as { is_error?: boolean; result?: string; errors?: string[] };
        if (r.is_error) {
          resolve({ ok: false, detail: r.errors?.join("; ") || r.result || "CLI returned an error result." });
        } else {
          resolve({
            ok: true,
            detail: `Account auth OK — ${model} answered in ${((Date.now() - started) / 1000).toFixed(1)}s`
          });
        }
      } catch {
        resolve({ ok: false, detail: "CLI answered but its output was not parseable JSON." });
      }
    });
  });
}
