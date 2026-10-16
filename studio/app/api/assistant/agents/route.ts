/**
 * @file `/api/assistant/agents` — the agent roster.
 *
 * GET lists every installed agent (built-in + GizmoX's `.claude/agents` +
 * `data/assistant/agents/` + installed add-on assets), WITHOUT bodies — the
 * list feeds pickers, and a
 * picker holding forty system prompts is a payload nobody asked for. GET a
 * single agent (`/agents/<id>`) for the full record. POST creates one in the
 * data root; the Forge module's Agents tab is the intended caller, but the
 * route is the contract and anything may speak it.
 */
import { scanAgents, storedAgentDirs, writeAgent } from "@axs/plugins/module-assistant/agents.server";

export async function GET(request: Request) {
  const agents = scanAgents(await storedAgentDirs(request)).map(
    ({ system: _system, ...rest }) => rest
  );
  return Response.json({ agents });
}

export async function POST(request: Request) {
  let body: {
    id?: string;
    name?: string;
    description?: string;
    provider?: string;
    model?: string;
    system?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  try {
    const agent = writeAgent(String(body.id ?? ""), {
      name: String(body.name ?? ""),
      description: String(body.description ?? ""),
      provider: body.provider ? String(body.provider) : undefined,
      model: body.model ? String(body.model) : undefined,
      system: String(body.system ?? "")
    });
    return Response.json({ agent }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
