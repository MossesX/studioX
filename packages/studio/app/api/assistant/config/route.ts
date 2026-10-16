/**
 * @file `/api/assistant/config` — the assistant's stored configuration.
 *
 * GET returns the config with every API key MASKED (`set` + a 4-char hint) —
 * a key goes IN through this route and never comes back out; the chat route
 * reads the real value server-side. PUT merges: a provider's `apiKey` field
 * absent means "keep what is stored", the empty string means "clear it", and
 * anything else replaces it. That three-state rule is what lets the settings
 * tab round-trip the masked config without wiping keys it cannot see.
 *
 * `authMode` is the one provider field that is NOT a secret and so round-trips
 * unmasked — it decides which ACCOUNT an Anthropic turn is billed to (API key
 * or Claude subscription), and a setting the settings tab cannot read back is a
 * setting it would silently reset on every save.
 */
import { axfKv, kvUser } from "@axs/server/axfKv";
import {
  ASSISTANT_CONFIG_NS,
  DEFAULT_ANTHROPIC_AUTH,
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  PROVIDERS,
  isAnthropicAuthMode,
  parseAgentDirs,
  parseModuleAgents
} from "@axs/plugins/module-assistant/types";
import type {
  AssistantConfig,
  MaskedProviderSettings,
  ProviderId,
  ProviderSettings
} from "@axs/plugins/module-assistant/types";

const PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));

async function readConfig(user: string): Promise<AssistantConfig> {
  const doc = (await axfKv.read(user, ASSISTANT_CONFIG_NS)) as Partial<AssistantConfig> | null;
  if (!doc) return DEFAULT_CONFIG;
  const provider = PROVIDER_IDS.has(doc.provider as ProviderId)
    ? (doc.provider as ProviderId)
    : DEFAULT_CONFIG.provider;
  return {
    provider,
    model: typeof doc.model === "string" && doc.model ? doc.model : DEFAULT_MODELS[provider],
    agentId: typeof doc.agentId === "string" && doc.agentId ? doc.agentId : DEFAULT_CONFIG.agentId,
    moduleAgents: parseModuleAgents(doc.moduleAgents),
    agentDirs: parseAgentDirs(doc.agentDirs),
    providers: (doc.providers as AssistantConfig["providers"]) ?? {}
  };
}

function masked(config: AssistantConfig) {
  const providers: Partial<Record<ProviderId, MaskedProviderSettings>> = {};
  for (const { id } of PROVIDERS) {
    const s = config.providers[id];
    providers[id] = {
      keySet: Boolean(s?.apiKey),
      keyHint: s?.apiKey ? `…${s.apiKey.slice(-4)}` : "",
      baseUrl: s?.baseUrl,
      // Reported for anthropic only, and always reported for it — an absent
      // stored value is the default made explicit, so the tab never has to
      // guess which radio is on.
      authMode: id === "anthropic" ? (s?.authMode ?? DEFAULT_ANTHROPIC_AUTH) : undefined
    };
  }
  return {
    provider: config.provider,
    model: config.model,
    agentId: config.agentId,
    // Not a secret, and the window needs it to name the agent on its header
    // chip — a per-module pin the client could not read is one it would have
    // to re-derive, which is how the chip and the answering agent drift apart.
    moduleAgents: config.moduleAgents,
    // Paths, not secrets — the settings tab's directory editor round-trips it.
    agentDirs: config.agentDirs,
    providers
  };
}

export async function GET(request: Request) {
  const config = await readConfig(kvUser(request));
  return Response.json({ config: masked(config) });
}

export async function PUT(request: Request) {
  let body: {
    provider?: string;
    model?: string;
    agentId?: string;
    moduleAgents?: Record<string, string>;
    agentDirs?: string[];
    providers?: Partial<Record<ProviderId, ProviderSettings>>;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  if (body.provider !== undefined && !PROVIDER_IDS.has(body.provider as ProviderId)) {
    return Response.json({ error: `"${body.provider}" is not a known provider` }, { status: 400 });
  }
  // Refused rather than dropped: an unrecognised mode silently falling back to
  // the API key is how a turn gets billed to the account the owner did not pick.
  const requestedAuth = body.providers?.anthropic?.authMode;
  if (requestedAuth !== undefined && !isAnthropicAuthMode(requestedAuth)) {
    return Response.json(
      { error: `"${String(requestedAuth)}" is not an Anthropic connection mode` },
      { status: 400 }
    );
  }
  const user = kvUser(request);
  const current = await readConfig(user);
  const next: AssistantConfig = {
    provider: (body.provider as ProviderId) ?? current.provider,
    model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : current.model,
    agentId:
      typeof body.agentId === "string" && body.agentId.trim() ? body.agentId.trim() : current.agentId,
    // Per-module pins MERGE by key, and the empty string DELETES one — the same
    // three-state rule the provider keys use two blocks down, for the same
    // reason: the window sends one module's choice at a time, so a whole-map
    // replace would unpin every other module on every save. "Delete" is a real
    // instruction here, not an absence: it is how a module goes back to
    // following the default agent, which a pin set to the default cannot do.
    moduleAgents: { ...current.moduleAgents },
    // REPLACED whole, not merged, when sent — unlike `moduleAgents` this is an
    // ordered list edited as one control, and order is the collision rule, so
    // "the list you see is the list that is stored" is the only sane contract.
    // Absent keeps the stored list.
    agentDirs: Array.isArray(body.agentDirs) ? parseAgentDirs(body.agentDirs) : current.agentDirs,
    providers: { ...current.providers }
  };
  if (body.moduleAgents && typeof body.moduleAgents === "object") {
    for (const [moduleId, agentId] of Object.entries(body.moduleAgents)) {
      if (typeof agentId !== "string" || !moduleId.trim()) continue;
      if (agentId.trim()) next.moduleAgents = { ...next.moduleAgents, [moduleId]: agentId.trim() };
      else {
        const rest = { ...next.moduleAgents };
        delete rest[moduleId];
        next.moduleAgents = rest;
      }
    }
  }
  for (const { id } of PROVIDERS) {
    const patch = body.providers?.[id];
    if (!patch) continue;
    const stored = current.providers[id] ?? {};
    const merged: ProviderSettings = { ...stored };
    if (typeof patch.apiKey === "string") {
      // Three states: absent = keep, "" = clear, value = replace.
      if (patch.apiKey === "") delete merged.apiKey;
      else merged.apiKey = patch.apiKey;
    }
    if (typeof patch.baseUrl === "string") {
      if (patch.baseUrl === "") delete merged.baseUrl;
      else merged.baseUrl = patch.baseUrl;
    }
    if (id === "anthropic" && isAnthropicAuthMode(patch.authMode)) merged.authMode = patch.authMode;
    next.providers[id] = merged;
  }
  await axfKv.write(user, ASSISTANT_CONFIG_NS, next as unknown as Record<string, unknown>);
  return Response.json({ config: masked(next) });
}
