/**
 * @file The workspace's handle on the Claude SUBSYSTEM — HTTP, and only HTTP.
 *
 * ── the rule this file exists to obey ────────────────────────────────────────
 *
 * `src/claude/service.ts` states it: *"Nothing outside `src/claude/` may import
 * `./store` or the broker directly — a module reaching into subsystem internals
 * is the private back door this design exists to refuse."* The workspace is the
 * subsystem's first UI consumer and it goes through the same door a plugin
 * would: the routes under `app/api/claude/`. That is not ceremony. P1's own
 * gate is *"a non-UI consumer drives a conversation end to end through the
 * public API"*, and a UI that quietly imported the service would make the API's
 * shape a matter of taste rather than a matter of it working.
 *
 * The only thing it imports from the subsystem is `../../claude/types` and
 * `../../claude/export`, which are ISOMORPHIC by construction — types plus
 * pure functions, every import inside them an `import type` and therefore
 * erased. A `node:child_process` in this bundle would be a build failure, and
 * that is the enforcement: not a rule, a resolution.
 *
 * ── streams ─────────────────────────────────────────────────────────────────
 *
 * `send` and `attach` return async iterables over `application/x-ndjson`, one
 * `ClaudeSessionEvent` per line. Two details worth not rediscovering:
 *
 *   - **A line can be split across chunks**, so the reader buffers to the last
 *     newline and never parses a partial line. This is the bug that shows up as
 *     one corrupt event every few hundred deltas, on a fast connection, only
 *     sometimes — the worst kind to debug and the cheapest to prevent.
 *   - **Closing the reader does NOT cancel the turn.** That is the route's
 *     documented contract and the reason `cancel()` is its own call: "my tab
 *     closed" and "stop spending money" are different intentions.
 */
import type {
  ClaudeSessionEvent,
  ConversationMeta,
  ConversationRecord,
  KnowledgeFile,
  KnowledgeStatus,
  ProjectRecord,
  SearchHit
} from "../../claude/types";

/** The service's error shape, as an Error a caller can show. */
async function fail(response: Response, what: string): Promise<never> {
  let detail = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) detail = body.error;
  } catch {
    /* not JSON — the status is what there is to say */
  }
  throw new Error(`${what}: ${detail}`);
}

const BASE = "/api/claude/conversations";
const PROJECTS = "/api/claude/projects";

export interface StartRequest {
  title?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  system?: string;
  cwd?: string;
  /** The project to start under. Its bound directory becomes the
   *  conversation's cwd; supplying a conflicting `cwd` is refused by name. */
  projectId?: string;
}

/** The editor's shape for a project, create and edit alike. `id` distinguishes
 *  them at the call site rather than through two near-identical interfaces. */
export interface ProjectRequest {
  name?: string;
  cwd?: string;
  instructions?: string;
  knowledge?: readonly KnowledgeFile[];
  model?: string;
  effort?: string;
  permissionMode?: string;
}

/* ------------------------------- the NDJSON reader --------------------------- */

/**
 * Read an NDJSON body as events.
 *
 * `signal` aborts the READ, not the turn — see the header. The final flush
 * matters: a stream whose last line arrives without a trailing newline would
 * otherwise lose its terminal event, and the terminal is the one event
 * everything downstream waits for.
 */
async function* readNdjson(
  response: Response,
  what: string
): AsyncGenerator<ClaudeSessionEvent, void, undefined> {
  if (!response.ok) await fail(response, what);
  const body = response.body;
  if (!body) throw new Error(`${what}: the response carried no body`);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const parsed = parseEvent(line);
          if (parsed) yield parsed;
        }
        newline = buffer.indexOf("\n");
      }
    }
    const tail = (buffer + decoder.decode()).trim();
    if (tail) {
      const parsed = parseEvent(tail);
      if (parsed) yield parsed;
    }
  } finally {
    // Releasing the lock rather than cancelling: cancelling here would close
    // the response, and a caller that stopped iterating early (a React effect
    // tearing down) must not take the turn's other observers with it.
    reader.releaseLock();
  }
}

/**
 * One line into an event, or null.
 *
 * A line that does not parse is DROPPED rather than thrown on, and that is the
 * one place this file chooses lenience: the alternative is that a single
 * malformed line ends a live answer mid-sentence. It is logged so it is not
 * silent — the transport's own `unknown` event covers the case where the CLI
 * says something new, and this covers the case where the wire itself broke.
 */
function parseEvent(line: string): ClaudeSessionEvent | null {
  try {
    return JSON.parse(line) as ClaudeSessionEvent;
  } catch {
    console.warn("[claude-workspace] dropped an unparseable stream line:", line.slice(0, 200));
    return null;
  }
}

/* ---------------------------------- the verbs -------------------------------- */

export async function listConversations(signal?: AbortSignal): Promise<ConversationMeta[]> {
  const response = await fetch(BASE, { cache: "no-store", signal });
  if (!response.ok) await fail(response, "could not list conversations");
  const body = (await response.json()) as { conversations?: ConversationMeta[] };
  return body.conversations ?? [];
}

export async function searchConversations(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const response = await fetch(`${BASE}?q=${encodeURIComponent(query)}`, {
    cache: "no-store",
    signal
  });
  if (!response.ok) await fail(response, "search failed");
  const body = (await response.json()) as { hits?: SearchHit[] };
  return body.hits ?? [];
}

export async function getConversation(
  id: string,
  signal?: AbortSignal
): Promise<ConversationRecord> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, { cache: "no-store", signal });
  if (!response.ok) await fail(response, "could not open the conversation");
  return (await response.json()) as ConversationRecord;
}

export async function startConversation(options: StartRequest): Promise<ConversationRecord> {
  const response = await fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options)
  });
  if (!response.ok) await fail(response, "could not start a conversation");
  return (await response.json()) as ConversationRecord;
}

export async function patchConversation(
  id: string,
  patch: { title?: string; pinned?: boolean }
): Promise<ConversationRecord> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) await fail(response, "could not update the conversation");
  return (await response.json()) as ConversationRecord;
}

export async function deleteConversation(id: string): Promise<boolean> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) await fail(response, "could not delete the conversation");
  const body = (await response.json()) as { deleted?: boolean };
  return body.deleted === true;
}

export async function cancelTurn(id: string): Promise<boolean> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  if (!response.ok) await fail(response, "could not stop the turn");
  const body = (await response.json()) as { cancelled?: boolean };
  return body.cancelled === true;
}

/**
 * Run one turn and stream it back.
 *
 * The POST is awaited before iteration begins, so a refusal — no such
 * conversation, a turn already running — arrives as a thrown Error with the
 * service's own message rather than as an empty stream. The route is built for
 * exactly that: it awaits `send()` before opening the response.
 */
export async function sendTurn(
  id: string,
  text: string,
  opts: { timeoutS?: number; signal?: AbortSignal } = {}
): Promise<AsyncGenerator<ClaudeSessionEvent, void, undefined>> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, timeoutS: opts.timeoutS }),
    signal: opts.signal
  });
  return readNdjson(response, "the turn was refused");
}

/**
 * Attach to whatever is running — the reload path.
 *
 * The service replays the live turn's buffer before following it, deduped by
 * sequence, so a tab that reloads mid-answer gets the WHOLE answer rather than
 * the tail. Attaching to an idle conversation is not an error: the stream waits
 * for the next turn, which is what a workspace that opened first needs.
 */
export async function attachStream(
  id: string,
  signal?: AbortSignal
): Promise<AsyncGenerator<ClaudeSessionEvent, void, undefined>> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}/stream`, {
    cache: "no-store",
    signal
  });
  return readNdjson(response, "could not attach to the conversation");
}

/* --------------------------------- projects ---------------------------------- */

export async function listProjects(signal?: AbortSignal): Promise<ProjectRecord[]> {
  const response = await fetch(PROJECTS, { cache: "no-store", signal });
  if (!response.ok) await fail(response, "could not list projects");
  const body = (await response.json()) as { projects?: ProjectRecord[] };
  return body.projects ?? [];
}

/**
 * One project AND what its knowledge files resolve to right now.
 *
 * Two answers in one call because the editor needs both to draw a single row —
 * the path as authored and whether it is there — and asking twice would
 * eventually be optimised into asking once, badly.
 */
export async function getProject(
  id: string,
  signal?: AbortSignal
): Promise<{ project: ProjectRecord; knowledge: KnowledgeStatus[] }> {
  const response = await fetch(`${PROJECTS}/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal
  });
  if (!response.ok) await fail(response, "could not open the project");
  const body = (await response.json()) as {
    project: ProjectRecord;
    knowledge?: KnowledgeStatus[];
  };
  return { project: body.project, knowledge: body.knowledge ?? [] };
}

export async function createProject(request: ProjectRequest): Promise<ProjectRecord> {
  const response = await fetch(PROJECTS, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) await fail(response, "could not create the project");
  return (await response.json()) as ProjectRecord;
}

export async function patchProject(id: string, patch: ProjectRequest): Promise<ProjectRecord> {
  const response = await fetch(`${PROJECTS}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) await fail(response, "could not save the project");
  return (await response.json()) as ProjectRecord;
}

/**
 * Delete a project.
 *
 * `detach` is the caller stating that its conversations should be unfiled and
 * kept. Without it the service refuses while any belong to the project and says
 * how many — which is the message this surfaces, so the confirmation the user
 * sees can quote a real count rather than a warning about a hypothetical.
 */
export async function deleteProject(id: string, opts: { detach?: boolean } = {}): Promise<boolean> {
  const query = opts.detach ? "?detach=1" : "";
  const response = await fetch(`${PROJECTS}/${encodeURIComponent(id)}${query}`, {
    method: "DELETE"
  });
  if (!response.ok) await fail(response, "could not delete the project");
  const body = (await response.json()) as { deleted?: boolean };
  return body.deleted === true;
}

/** Is the `claude` CLI actually there? The route spawns `claude --version`
 *  rather than reporting that a route exists, so a false answer here means the
 *  workspace genuinely cannot run a turn and should say so up front. */
export async function probeCli(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch("/api/claude", { cache: "no-store", signal });
    const body = (await response.json()) as { ok?: boolean; detail?: string };
    return { ok: body.ok === true, detail: body.detail ?? `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
