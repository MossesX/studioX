/**
 * @file `/api/assistant/agents/<id>` — one agent, whole.
 *
 * GET returns the full record, system prompt included — the Forge's editor
 * reads through here. PUT rewrites the file in the data root (editing an
 * add-on or the built-in creates a SHADOWING data file rather than touching
 * the source — an installed asset stays byte-identical to its zip, and the
 * built-in stays in code). DELETE removes the data file only; deleting a
 * shadow un-shadows whatever it covered.
 */
import {
  getAgent,
  removeAgent,
  storedAgentDirs,
  writeAgent
} from "@axs/plugins/module-assistant/agents.server";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const agent = getAgent(id, await storedAgentDirs(request));
  if (!agent) return Response.json({ error: `no agent "${id}"` }, { status: 404 });
  return Response.json({ agent });
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  let body: {
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
  const existing = getAgent(id, await storedAgentDirs(request));
  try {
    const agent = writeAgent(id, {
      name: String(body.name ?? existing?.name ?? ""),
      description: String(body.description ?? existing?.description ?? ""),
      provider: body.provider !== undefined ? String(body.provider) || undefined : existing?.provider,
      model: body.model !== undefined ? String(body.model) || undefined : existing?.model,
      system: String(body.system ?? existing?.system ?? "")
    });
    return Response.json({ agent });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const removed = removeAgent(id);
    return Response.json({ ok: true, removed });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
