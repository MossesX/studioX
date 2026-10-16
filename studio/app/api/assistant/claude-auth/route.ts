/**
 * @file `/api/assistant/claude-auth` — "is the Claude subscription actually
 * connected?", answered honestly.
 *
 * POST (not GET) because it SPENDS something: the probe is one real, tiny turn
 * through the local `claude` CLI, and a route that costs tokens must not be
 * reachable by a prefetch, a link hover or a browser's speculative fetch.
 *
 * The cheaper check — does the binary exist — is deliberately not what this
 * does. `claude --version` succeeds while signed out, so it would show a green
 * status to somebody with no connection at all, and a status line that can be
 * confidently wrong is worse than none. `/api/claude` GET still offers that
 * probe for callers that only need "is the CLI installed".
 */
import { axfKv, kvUser } from "@axs/server/axfKv";
import { testSubscription } from "@axs/plugins/module-assistant/providers.server";
import {
  ASSISTANT_CONFIG_NS,
  DEFAULT_MODELS
} from "@axs/plugins/module-assistant/types";
import type { AssistantConfig } from "@axs/plugins/module-assistant/types";

export const dynamic = "force-dynamic";
/** The broker gives the test turn a 90s leash; Next needs telling separately. */
export const maxDuration = 120;

export async function POST(request: Request) {
  let model: string | undefined;
  try {
    const body = (await request.json()) as { model?: unknown };
    if (typeof body.model === "string" && body.model.trim()) model = body.model.trim();
  } catch {
    // No body is fine — fall through to the stored model.
  }
  if (!model) {
    const stored = (await axfKv.read(kvUser(request), ASSISTANT_CONFIG_NS)) as AssistantConfig | null;
    model = stored?.model || DEFAULT_MODELS.anthropic;
  }
  const result = await testSubscription(model);
  // 200 either way: "not connected" is a successful answer to the question,
  // and the tab renders the detail. A 5xx here would read as "the route broke".
  return Response.json(result);
}
