/**
 * @file The AGENT BUILDER INBOX — where a build waits for its agent to be named.
 *
 *   POST   /api/assistant/agent-inbox            { draft, module, source } → { id }
 *   POST   /api/assistant/agent-inbox            { id, action: "resolve", draft }
 *   POST   /api/assistant/agent-inbox            { id, action: "cancel" }
 *   GET    /api/assistant/agent-inbox            → { requests } — pending only
 *   GET    /api/assistant/agent-inbox?id=<id>    → { request } — the build polls this
 *   DELETE /api/assistant/agent-inbox?id=<id>    → drop one; no id drops the lot
 *
 * ## Why an inbox and not a dialog the build opens
 *
 * `npm run agent <id>` (and the peel, which runs the same step) derives an
 * agent from the module's declaration and then has to ask the owner one thing
 * it cannot derive: the name — plus whatever they want to change about the
 * persona, the skills and the tools while they are looking at it. The build is
 * a Node script. It has no window.
 *
 * This is the SAME SHAPE as the Task Manager's capture inbox
 * (`app/api/tasks/inbox`), and it is here for the same reason its docblock
 * gives: something outside the browser has a thing to say to the app and HTTP
 * is the only channel it has. The difference is the direction of the wait —
 * a capture is parked and forgotten, whereas a build BLOCKS until the dialog
 * comes back, so an entry here has a status and a result rather than just a
 * text. That is also why GET-by-id does not drain: the poller must be able to
 * ask twice and get the same answer.
 *
 * ## Three surfaces, one draft
 *
 * If the studio is not running there is no dialog to open, so the CLI falls
 * back to a PyQt6 window and then to a terminal form (see
 * `scripts/module-agent.mjs`). All three edit the same {@link ModuleAgentDraft}
 * and post nothing back through here except the accepted result, so which
 * surface answered is invisible to everything downstream.
 *
 * Storage is the studio's own kv primitive, like every other small state here.
 */
import { axfKv, kvUser } from "@axs/server/axfKv";
import { AGENT_INBOX_NS } from "@axs/plugins/module-assistant/types";
import type { AgentBuildRequest, ModuleAgentDraft } from "@axs/plugins/module-assistant/types";

export const dynamic = "force-dynamic";

/** A draft is a persona plus a handful of skills — generous, but bounded, so a
 *  runaway caller cannot fill the disk through an unauthenticated local route. */
const MAX_DRAFT_BYTES = 512 * 1024;
/** More than anyone builds in one sitting; oldest are dropped first. */
const MAX_REQUESTS = 20;
/** A build that has not been answered in an hour has been abandoned — its
 *  terminal has long since fallen through to another surface or been closed. */
const TTL_MS = 60 * 60 * 1000;

interface InboxDoc {
  readonly v: 1;
  readonly requests: AgentBuildRequest[];
}

const MODULE_RE = /^[a-z][a-z0-9-]{0,63}$/;

function isDraft(value: unknown): value is ModuleAgentDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<ModuleAgentDraft>;
  return (
    typeof d.module === "string" &&
    MODULE_RE.test(d.module) &&
    typeof d.name === "string" &&
    typeof d.persona === "string" &&
    Array.isArray(d.skills) &&
    Array.isArray(d.tools)
  );
}

async function read(request: Request): Promise<AgentBuildRequest[]> {
  const doc = (await axfKv.read(kvUser(request), AGENT_INBOX_NS)) as Partial<InboxDoc> | null;
  if (!doc || doc.v !== 1 || !Array.isArray(doc.requests)) return [];
  const now = Date.now();
  return doc.requests.filter(
    (r) => r && typeof r.id === "string" && now - Date.parse(r.opened) < TTL_MS
  );
}

async function write(request: Request, requests: AgentBuildRequest[]): Promise<void> {
  await axfKv.write(kvUser(request), AGENT_INBOX_NS, {
    v: 1,
    requests: requests.slice(-MAX_REQUESTS)
  } as unknown as Record<string, unknown>);
}

export async function POST(request: Request): Promise<Response> {
  let body: {
    id?: unknown;
    action?: unknown;
    draft?: unknown;
    module?: unknown;
    source?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "open";

  if (action === "resolve" || action === "cancel") {
    if (typeof body.id !== "string") {
      return Response.json({ error: "resolve and cancel need the request id" }, { status: 400 });
    }
    if (action === "resolve" && !isDraft(body.draft)) {
      return Response.json({ error: "resolve needs the accepted draft" }, { status: 400 });
    }
    const requests = await read(request);
    const target = requests.find((r) => r.id === body.id);
    if (!target) return Response.json({ error: "no such request" }, { status: 404 });
    const closed: AgentBuildRequest = {
      ...target,
      status: action === "resolve" ? "resolved" : "cancelled",
      closed: new Date().toISOString(),
      ...(action === "resolve" ? { result: body.draft as ModuleAgentDraft } : {})
    };
    await write(
      request,
      requests.map((r) => (r.id === closed.id ? closed : r))
    );
    return Response.json({ ok: true, request: closed });
  }

  if (!isDraft(body.draft)) {
    return Response.json(
      { error: "body.draft must be a module agent draft (module, name, persona, skills, tools)" },
      { status: 400 }
    );
  }
  if (JSON.stringify(body.draft).length > MAX_DRAFT_BYTES) {
    return Response.json({ error: "draft too large" }, { status: 413 });
  }

  const entry: AgentBuildRequest = {
    id: crypto.randomUUID(),
    module: body.draft.module,
    source:
      typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 40) : "build",
    opened: new Date().toISOString(),
    status: "pending",
    draft: body.draft
  };
  // A second build of the same module supersedes the first: the dialog can only
  // show one, and answering a stale one would write an agent from a declaration
  // that has since changed.
  const requests = (await read(request)).filter(
    (r) => !(r.module === entry.module && r.status === "pending")
  );
  await write(request, [...requests, entry]);
  return Response.json({ ok: true, id: entry.id }, { status: 201 });
}

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  const requests = await read(request);
  if (id) {
    const found = requests.find((r) => r.id === id);
    if (!found) return Response.json({ error: "no such request" }, { status: 404 });
    return Response.json({ request: found });
  }
  // The dialog's feed: only what is still waiting for an answer.
  return Response.json({ requests: requests.filter((r) => r.status === "pending") });
}

export async function DELETE(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  const requests = await read(request);
  await write(request, id ? requests.filter((r) => r.id !== id) : []);
  return Response.json({ ok: true });
}
