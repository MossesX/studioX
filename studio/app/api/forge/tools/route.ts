/**
 * @file `/api/forge/tools` — tool definitions as data.
 *
 * GET lists `data/assistant/tools/*.json`; POST creates or replaces one
 * (`{name, description, input_schema}` — the `ClaudeToolPayload` shape minus
 * `run`); DELETE `?name=` removes it. Nothing executes these yet: they are
 * the authored feed for the MCP bridge `claude/points.ts` deferred to its
 * first real consumer, and the Forge is where they get authored.
 */
import { deleteTool, listTools, writeTool } from "@axs/modules/forge/forge.server";
import type { ToolDefinition } from "@axs/modules/forge/forge.server";

export async function GET() {
  return Response.json({ tools: listTools() });
}

export async function POST(request: Request) {
  let body: Partial<ToolDefinition>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  try {
    writeTool({
      name: String(body.name ?? ""),
      description: String(body.description ?? ""),
      input_schema: (body.input_schema as Record<string, unknown>) ?? { type: "object", properties: {} }
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  try {
    const removed = deleteTool(name);
    return Response.json({ ok: true, removed });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
