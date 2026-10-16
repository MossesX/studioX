/**
 * @file `/api/forge/mcp` — the repo's `.mcp.json` and the processes it names.
 *
 * GET  → { config, status } — the parsed file plus the live process table
 *        (running/pid/uptime/exit and the ring-buffered log per server).
 * PUT  → replace the config; validated before a byte is written.
 * POST → { action: "launch" | "stop" | "test", name } — launch keeps the
 *        process running under the manager; stop kills the tree; test speaks
 *        a real MCP `initialize` handshake and reports the verdict as a
 *        sentence.
 */
import {
  launchMcp,
  mcpStatus,
  readMcpConfig,
  stopMcp,
  testMcp,
  writeMcpConfig
} from "@axs/modules/forge/mcp.server";
import type { McpConfig } from "@axs/modules/forge/mcp.server";

export async function GET() {
  return Response.json({ config: readMcpConfig(), status: mcpStatus() });
}

export async function PUT(request: Request) {
  let body: McpConfig;
  try {
    body = (await request.json()) as McpConfig;
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  try {
    writeMcpConfig(body);
    return Response.json({ ok: true, config: readMcpConfig() });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  let body: { action?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  const name = String(body.name ?? "");
  try {
    switch (body.action) {
      case "launch":
        return Response.json({ ok: true, status: launchMcp(name) });
      case "stop":
        return Response.json({ ok: true, stopped: stopMcp(name) });
      case "test": {
        const verdict = await testMcp(name);
        return Response.json({ ok: verdict.ok, detail: verdict.detail });
      }
      default:
        return Response.json({ error: "action must be launch|stop|test" }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
