/**
 * @file The Forge's MCP half — the repo's `.mcp.json` (read/validate/write)
 * and a process manager for the servers it names: launch, stop, status, a
 * ring-buffered log, and a stdio handshake TEST that actually speaks the
 * protocol rather than checking a process stayed alive.
 *
 * `.mcp.json` is the Claude CLI's own project-scope MCP configuration file,
 * at the repo root — writing it here configures the CLI too, which is the
 * point: ONE file, edited by a designer instead of by hand.
 *
 * The child-process table lives on `globalThis`, the same trade
 * `claudeService()` documents: two tables racing over the same children is
 * the per-runtime registry bug again. Same cost too — the table survives a
 * module re-evaluation with the OLD class's behaviour until the dev server
 * restarts (issues.md I-9).
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface McpServerDef {
  /** stdio servers: the executable and its args. */
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** http/sse servers: the endpoint. */
  readonly url?: string;
  /** "stdio" (default when `command` is set) | "http" | "sse". */
  readonly type?: string;
}

export interface McpConfig {
  readonly mcpServers: Readonly<Record<string, McpServerDef>>;
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const LOG_LINES = 200;

function configFile(): string {
  return path.resolve(process.cwd(), "..", "..", ".mcp.json");
}

export function readMcpConfig(): McpConfig {
  try {
    const doc = JSON.parse(fs.readFileSync(configFile(), "utf8")) as Partial<McpConfig>;
    if (doc && typeof doc.mcpServers === "object" && doc.mcpServers) {
      return { mcpServers: doc.mcpServers };
    }
  } catch {
    /* no file yet, or unreadable — an empty config, not an error */
  }
  return { mcpServers: {} };
}

export function validateMcpConfig(config: McpConfig): string[] {
  const problems: string[] = [];
  if (!config || typeof config.mcpServers !== "object" || config.mcpServers === null) {
    return ["the document must be { mcpServers: { <name>: {…} } }"];
  }
  for (const [name, def] of Object.entries(config.mcpServers)) {
    const at = `server "${name}"`;
    if (!NAME_RE.test(name)) problems.push(`${at}: the name must be a plain identifier`);
    if (!def || typeof def !== "object") {
      problems.push(`${at}: must be an object`);
      continue;
    }
    const hasCommand = typeof def.command === "string" && def.command.trim() !== "";
    const hasUrl = typeof def.url === "string" && def.url.trim() !== "";
    if (!hasCommand && !hasUrl) problems.push(`${at}: needs a command (stdio) or a url (http/sse)`);
    if (def.args !== undefined && !Array.isArray(def.args)) problems.push(`${at}: args must be an array`);
    if (def.env !== undefined && (typeof def.env !== "object" || def.env === null)) {
      problems.push(`${at}: env must be an object of strings`);
    }
  }
  return problems;
}

export function writeMcpConfig(config: McpConfig): void {
  const problems = validateMcpConfig(config);
  if (problems.length) throw new Error(problems.join("; "));
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n", "utf8");
}

/* ── the process table ────────────────────────────────────────────────────── */

interface Managed {
  child: ChildProcess;
  startedAt: number;
  log: string[];
  exit: { code: number | null; at: number } | null;
}

function table(): Map<string, Managed> {
  const g = globalThis as { __axsForgeMcp?: Map<string, Managed> };
  g.__axsForgeMcp ??= new Map();
  return g.__axsForgeMcp;
}

function pushLog(m: Managed, line: string): void {
  m.log.push(line);
  if (m.log.length > LOG_LINES) m.log.splice(0, m.log.length - LOG_LINES);
}

export interface McpStatus {
  readonly running: boolean;
  readonly pid: number | null;
  readonly startedAt: number | null;
  readonly exit: { code: number | null; at: number } | null;
  readonly log: readonly string[];
}

export function mcpStatus(): Record<string, McpStatus> {
  const out: Record<string, McpStatus> = {};
  for (const [name, m] of table()) {
    out[name] = {
      running: m.exit === null,
      pid: m.child.pid ?? null,
      startedAt: m.startedAt,
      exit: m.exit,
      log: [...m.log]
    };
  }
  return out;
}

export function launchMcp(name: string): McpStatus {
  const def = readMcpConfig().mcpServers[name];
  if (!def) throw new Error(`no server "${name}" in .mcp.json`);
  if (!def.command) throw new Error(`"${name}" is a url server — nothing to launch locally`);
  const existing = table().get(name);
  if (existing && existing.exit === null) {
    throw new Error(`"${name}" is already running (pid ${existing.child.pid})`);
  }
  // shell: true so `npx`, `.cmd` shims and PATH resolution behave on Windows —
  // this launches what the operator configured, exactly as the CLI would.
  const child = spawn(def.command, [...(def.args ?? [])], {
    cwd: path.resolve(process.cwd(), "..", ".."),
    env: { ...process.env, ...(def.env ?? {}) },
    shell: true,
    windowsHide: true
  });
  const managed: Managed = { child, startedAt: Date.now(), log: [], exit: null };
  const onData = (prefix: string) => (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.trim()) pushLog(managed, `${prefix}${line}`);
    }
  };
  child.stdout?.on("data", onData(""));
  child.stderr?.on("data", onData("! "));
  child.on("exit", (code) => {
    managed.exit = { code, at: Date.now() };
    pushLog(managed, `— exited with code ${code}`);
  });
  child.on("error", (err) => {
    managed.exit = { code: null, at: Date.now() };
    pushLog(managed, `— failed to start: ${String(err)}`);
  });
  table().set(name, managed);
  return { running: true, pid: child.pid ?? null, startedAt: managed.startedAt, exit: null, log: [] };
}

export function stopMcp(name: string): boolean {
  const managed = table().get(name);
  if (!managed || managed.exit !== null) return false;
  const pid = managed.child.pid;
  managed.child.kill();
  if (process.platform === "win32" && pid) {
    // A shell-spawned child is a tree; kill() reaches the shell only.
    try {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } catch {
      /* best effort — the exit handler records whatever actually happens */
    }
  }
  return true;
}

/**
 * The handshake test: spawn the stdio server, send a real MCP `initialize`
 * (newline-delimited JSON-RPC), and wait for a response naming the server.
 * A url server is probed with a fetch instead. Either way the verdict is a
 * SENTENCE — what answered, or what did not and how.
 */
export async function testMcp(name: string, timeoutMs = 6000): Promise<{ ok: boolean; detail: string }> {
  const def = readMcpConfig().mcpServers[name];
  if (!def) return { ok: false, detail: `no server "${name}" in .mcp.json` };

  if (!def.command) {
    const url = def.url ?? "";
    try {
      const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
      return { ok: true, detail: `${url} answered HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: `${url} did not answer: ${String(err)}` };
    }
  }

  return new Promise((resolve) => {
    const child = spawn(def.command as string, [...(def.args ?? [])], {
      cwd: path.resolve(process.cwd(), "..", ".."),
      env: { ...process.env, ...(def.env ?? {}) },
      shell: true,
      windowsHide: true
    });
    let settled = false;
    let stderrTail = "";
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve({ ok, detail });
    };
    const timer = setTimeout(
      () =>
        finish(
          false,
          `no initialize response within ${timeoutMs / 1000}s${stderrTail ? ` — stderr: ${stderrTail.slice(-300)}` : ""}`
        ),
      timeoutMs
    );
    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as {
            id?: number;
            result?: { serverInfo?: { name?: string; version?: string }; protocolVersion?: string };
            error?: { message?: string };
          };
          if (msg.id === 1 && msg.result) {
            const info = msg.result.serverInfo;
            finish(
              true,
              `handshake ok — ${info?.name ?? "unnamed server"}${info?.version ? ` v${info.version}` : ""} (protocol ${msg.result.protocolVersion ?? "?"})`
            );
          } else if (msg.id === 1 && msg.error) {
            finish(false, `initialize refused: ${msg.error.message ?? "unknown error"}`);
          }
        } catch {
          /* a non-JSON line (a banner) is ignored */
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-1000);
    });
    child.on("error", (err) => finish(false, `failed to start: ${String(err)}`));
    child.on("exit", (code) => finish(false, `exited with code ${code} before answering`));
    child.stdin?.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "amberx-forge", version: "0.1.0" }
        }
      }) + "\n"
    );
  });
}
