/**
 * @file `/api/assistant/models?provider=ollama` — live model discovery.
 *
 * Two providers answer with something real:
 *
 *   - **ollama** — its daemon is local and lists what is actually pulled, so
 *     the picker shows the machine's models rather than a guess.
 *   - **anthropic on the subscription connection** — the id there reaches
 *     `claude --model` on a command line, so it is ALLOWLISTED rather than free
 *     text. Offering the API spellings in that mode would offer ids the turn
 *     will refuse, so the list becomes the CLI catalog's own.
 *
 * The rest return their static suggestions — their list endpoints need the API
 * key and a network hop for what is, in a picker, a suggestion anyway.
 */
import { axfKv, kvUser } from "@axs/server/axfKv";
import { listOllamaModels, subscriptionModels } from "@axs/plugins/module-assistant/providers.server";
import {
  ASSISTANT_CONFIG_NS,
  DEFAULT_ANTHROPIC_AUTH,
  MODEL_SUGGESTIONS
} from "@axs/plugins/module-assistant/types";
import type { AssistantConfig, ProviderId } from "@axs/plugins/module-assistant/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") as ProviderId | null;
  if (!provider || !(provider in MODEL_SUGGESTIONS)) {
    return Response.json({ error: "provider must be one of anthropic|openai|xai|ollama" }, { status: 400 });
  }
  if (provider === "ollama") {
    const stored = (await axfKv.read(kvUser(request), ASSISTANT_CONFIG_NS)) as AssistantConfig | null;
    const live = await listOllamaModels(stored?.providers?.ollama?.baseUrl);
    return Response.json({ models: live.length ? live : [...MODEL_SUGGESTIONS.ollama], live: live.length > 0 });
  }
  if (provider === "anthropic") {
    // `auth` may be supplied by a tab whose selection is not saved yet; the
    // stored mode is the fallback so a plain GET still answers correctly.
    const stored = (await axfKv.read(kvUser(request), ASSISTANT_CONFIG_NS)) as AssistantConfig | null;
    const auth =
      url.searchParams.get("auth") ?? stored?.providers?.anthropic?.authMode ?? DEFAULT_ANTHROPIC_AUTH;
    if (auth === "subscription") {
      return Response.json({ models: subscriptionModels(), live: true, allowlisted: true });
    }
  }
  return Response.json({ models: [...MODEL_SUGGESTIONS[provider]], live: false });
}
