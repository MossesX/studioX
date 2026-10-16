/**
 * @file `/api/assistant/chat` — one POST, an NDJSON stream back.
 *
 * The route resolves everything server-side from the stored config — the
 * agent (its system prompt never crosses to the client), the provider, the
 * model, the API key — merges the request's overrides, appends the module
 * context block, and hands the call to the provider layer. The response is
 * newline-delimited JSON (`ChatEvent` per line): `delta` while text arrives,
 * one `done` or `error` at the end. A closed client aborts the upstream call
 * through the request signal, so a dismissed window stops billing.
 *
 * `sessionId` is the one piece of state this route relays rather than owns. On
 * the Anthropic subscription path the local `claude` CLI holds the history and
 * `--resume` is how a second turn finds the first, so the id comes in on the
 * request and goes back out on `done`. Every other provider is stateless and
 * never sets it — which is exactly why it lives on the wire and not in kv.
 *
 * ── the turn counter (P18 of `axf-amberxvid-social`, 2026-08-15) ─────────────
 *
 * One call, `chargeAssistantTurn`, and it is the ONE real consumer that proves
 * the `amberxvid.credits-meter` point. Three things about it are deliberate:
 *
 *  - **The module decides whether the turn is its own.** The route passes
 *    `body.moduleId` straight through and never branches on a module name; the
 *    meter answers `null` for everything that is not amberxvid. So a second
 *    metered module is an edit in that module's meter, not in the assistant —
 *    which is what keeps this route free of a growing list of who charges.
 *  - **The charge happens BEFORE the provider is called**, and a refusal ends
 *    the turn with an `error` line instead of an answer. Charging afterwards
 *    would hand a member at zero credits the answer and then fail the charge,
 *    which is a free turn for anyone watching their balance.
 *  - **A provider failure refunds it.** A charge paid for an answer; no answer
 *    means the credit goes back, as a new ledger entry rather than a deletion,
 *    so the history shows both halves.
 *
 * With `AMBERXVID_CREDITS` unset — every studio today — the call is a no-op and
 * this route behaves exactly as it did before the phase landed.
 */
import { axfKv, kvUser } from "@axs/server/axfKv";
import { axsUserFromCookieHeader } from "@axs/modules/accounts/lib/session";
import { chargeAssistantTurn, refundCharge } from "@axs/modules/amberxvid/lib/credits";
import { composeAgentSystem, scanAgents } from "@axs/plugins/module-assistant/agents.server";
import { ProviderError, runProvider } from "@axs/plugins/module-assistant/providers.server";
import {
  ASSISTANT_CONFIG_NS,
  DEFAULT_AGENT,
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  PROVIDERS,
  agentForModule,
  parseAgentDirs,
  parseModuleAgents
} from "@axs/plugins/module-assistant/types";
import type {
  AssistantConfig,
  ChatEvent,
  ChatRequest,
  ProviderId
} from "@axs/plugins/module-assistant/types";

const PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "messages must be a non-empty array" }, { status: 400 });
  }
  for (const m of body.messages) {
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return Response.json({ error: "each message is {role: user|assistant, content: string}" }, { status: 400 });
    }
  }

  const user = kvUser(request);
  const stored = ((await axfKv.read(user, ASSISTANT_CONFIG_NS)) ?? DEFAULT_CONFIG) as AssistantConfig;

  // The agent is resolved HERE, from the stored map, and not taken from the
  // request: `moduleAgents` is what makes "a different agent per module" a
  // configuration rather than a claim the caller makes each turn. An explicit
  // `agentId` still wins for the callers that mean one specific turn.
  //
  // The roster is scanned ONCE and passed in, because the resolution now has a
  // step that needs it: a module carrying its own agent bundle is answered by
  // that agent with nothing configured (see `agentForModule`). Scanning here
  // and reusing the result also stops the route reading the same directories
  // twice for one turn.
  const roster = scanAgents(parseAgentDirs(stored.agentDirs));
  const resolvedAgentId =
    body.agentId ??
    agentForModule(
      { agentId: stored.agentId ?? DEFAULT_AGENT.id, moduleAgents: parseModuleAgents(stored.moduleAgents) },
      body.moduleId,
      roster
    );
  const agent = roster.find((a) => a.id === resolvedAgentId) ?? DEFAULT_AGENT;
  // Resolution order for provider/model: request override → agent pin →
  // stored config → default. An agent that pins a provider brings its own
  // model default along unless something more specific names one.
  const provider: ProviderId =
    body.provider && PROVIDER_IDS.has(body.provider)
      ? body.provider
      : agent.provider ?? (PROVIDER_IDS.has(stored.provider) ? stored.provider : DEFAULT_CONFIG.provider);
  const model =
    body.model ??
    agent.model ??
    (provider === stored.provider && stored.model ? stored.model : DEFAULT_MODELS[provider]);

  // Persona + the agent's own skills + the module context, in that order. A
  // module agent's skills are its module's real commands, settings and points,
  // so this is where an agent stops being a tone of voice and starts being
  // someone who knows the surface.
  const system = composeAgentSystem(agent, body.moduleContext);

  // The ACCOUNTS username — the ledger is keyed by it. `kvUser` above answers
  // with a kv scope (which is `local` for a signed-out visitor), and charging
  // "local" would be one shared balance for everybody who is not signed in.
  const member = axsUserFromCookieHeader(request.headers.get("cookie"));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      let sessionId: string | undefined;

      // Charged before the provider is called — see the docblock. `null` means
      // "not a metered module", which is every module today.
      const charge = await chargeAssistantTurn(body.moduleId, member, `${provider}/${model}`);
      if (charge && !charge.ok) {
        send({ type: "error", message: charge.error });
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
        return;
      }

      let answered = false;
      try {
        await runProvider({
          provider,
          model,
          system,
          messages: body.messages,
          settings: stored.providers?.[provider] ?? {},
          // The agent's declared CLI tools. Real on the subscription path —
          // the broker passes them as `--allowed-tools` — and ignored by the
          // paths with no tool loop, which is why they are a hint here rather
          // than a promise the route makes.
          allowedTools: agent.tools,
          signal: request.signal,
          emit: (text) => send({ type: "delta", text }),
          sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
          onSession: (id) => {
            sessionId = id;
          }
        });
        answered = true;
        send({ type: "done", provider, model, sessionId });
      } catch (err) {
        if (request.signal.aborted) {
          // The client hung up; nothing is listening for an error line.
        } else {
          send({
            type: "error",
            message: err instanceof ProviderError ? err.message : `provider failed: ${String(err)}`
          });
        }
      } finally {
        // A charge bought an answer. No answer — a provider fault, or a client
        // that hung up before one arrived — means the credit goes back, as a
        // new ledger entry rather than a deletion, so the member's history
        // shows the charge AND the correction. A no-op when nothing was
        // charged, which is why it is safe here rather than in both branches.
        if (charge && !answered) {
          await refundCharge(
            member ?? "",
            charge,
            request.signal.aborted ? "the turn was cancelled" : "the provider did not answer"
          );
        }
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    }
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" }
  });
}
