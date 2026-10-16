/**
 * @file Agent Forge's SERVER contribution — `claude.context-provider`.
 *
 * The reason the plugin exists at all. `axf-claude`'s own plan names Agent
 * Forge as the asset *"feeding the context-provider point"*, and this is that
 * feed: the persona a conversation is bound to, compiled into the text the
 * subsystem folds into the system contract on the conversation's first turn.
 *
 * **Node-only** (`roster.ts` reads the filesystem). It lives apart from
 * `plugin.ts` because that file is imported by `studio.subsystem.ts`, which is
 * evaluated in the browser bundle — see the split argument there.
 *
 * ── everything here fails soft, on purpose ──────────────────────────────────
 *
 * `provide()` runs inside `#composeSystem`, while a turn is being assembled.
 * The service already wraps providers in a try/catch and logs a thrower, so a
 * crash here costs the turn its context and not the turn — but "logged and
 * skipped" is still a silent degradation, and the cases below are ordinary
 * rather than exceptional: no binding at all (the common case), a persona file
 * deleted since it was bound, a `.md.disabled` rename. Each answers with an
 * empty string, which the service drops without adding a blank paragraph to the
 * contract.
 */
import { registry } from "@axf/core";
import type { Contribution } from "@axf/core";

import { axfKv } from "../../server/axfKv";
import type { ClaudeContextProviderPayload } from "../../claude/points";
import { CLAUDE_CONTEXT_PROVIDER_POINT } from "../../claude/points";

import { AGENT_FORGE_NS, boundPersona } from "./bindings";
import { personaContext } from "./roster";

/**
 * The kv user.
 *
 * `kvUser(request)` is the host's resolver and it takes a Request — which a
 * context provider does not have, and structurally cannot: it is called from a
 * turn, not from a handler. AmberX has no auth subsystem yet and that resolver
 * answers `"local"` unconditionally, so this constant and that function agree
 * today. When auth lands they will not, and the fix is a conversation-scoped
 * identity on the record rather than a request threaded down here — noted so
 * the next reader finds the seam instead of the surprise.
 */
const KV_USER = "local";

/**
 * The two things this provider actually needs from the outside world, named so
 * a test can supply them.
 *
 * The alternative is a test that writes into the running install's real kv
 * store to see what the provider does with it, which is not a test — it is a
 * mutation of the thing being measured. Injection here costs one type and buys
 * the ONE piece of P5 logic that runs inside a turn its own coverage; the
 * defaults below are the real store and the real scan, so nothing about the
 * production path is different.
 */
export interface ForgeContextDeps {
  readDoc: () => Promise<unknown>;
  resolve: (repo: string, personaId: string) => string | null;
}

const REAL: ForgeContextDeps = {
  readDoc: () => axfKv.read(KV_USER, AGENT_FORGE_NS).catch(() => null),
  resolve: (repo, personaId) => personaContext(repo, personaId)
};

/**
 * The bound persona's text for one conversation, or `""`.
 *
 * Empty string rather than null: the service joins provider output with blank
 * lines and drops falsy answers, so `""` is "nothing to add" and costs the
 * contract nothing. A throw would be caught and logged by the service — a
 * silent degradation, for cases (no binding at all) that are ordinary rather
 * than exceptional.
 */
export async function personaContextFor(
  conversation: { id: string; cwd: string },
  deps: ForgeContextDeps = REAL
): Promise<string> {
  const personaId = boundPersona(await deps.readDoc(), conversation.id);
  if (!personaId) return "";
  return deps.resolve(conversation.cwd, personaId) ?? "";
}

export const AGENT_FORGE_CONTEXT: Contribution<ClaudeContextProviderPayload> = {
  from: "agent-forge",
  point: CLAUDE_CONTEXT_PROVIDER_POINT,
  priority: 10,
  payload: {
    id: "agent-forge.persona",
    provide: ({ conversation }) => personaContextFor(conversation)
  }
};

/**
 * Register it, once per runtime.
 *
 * The registry has no un-contribute, and Next's dev server re-evaluates modules
 * on edit — so a second evaluation of this file would contribute a second copy
 * and every first turn would carry the persona twice. The guard is on
 * `globalThis` for the same reason `claudeService()` is: it is the one thing a
 * module re-evaluation does not replace.
 */
export function registerAgentForgeContext(): void {
  const g = globalThis as { __axsAgentForgeContributed?: boolean };
  if (g.__axsAgentForgeContributed) return;
  g.__axsAgentForgeContributed = true;
  registry.contribute(AGENT_FORGE_CONTEXT);
}
