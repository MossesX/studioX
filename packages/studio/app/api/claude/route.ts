/**
 * @file `/api/claude` — the streaming transport surface. POST a turn, get
 * normalised NDJSON back, one JSON object per line.
 *
 * This is the P0 gate of `axf-claude.bmpx`: *"a real streamed reply reaches the
 * browser on :3200 with zero GizmoX imports in the path"*. The path is this
 * file → `src/server/claudeBroker.ts` → `src/server/claudeEvents.ts`, and its
 * only non-local imports are `node:child_process` and the model catalog. It is
 * deliberately NOT the subsystem's service API — that is P1, and it will sit on
 * top of this rather than beside it.
 *
 * ── the wire ─────────────────────────────────────────────────────────────────
 *
 *   POST { messages | prompt, sessionId?, model?, permissionMode?, effort?,
 *          cwd?, timeoutS? }  →  application/x-ndjson
 *   GET                       →  { ok, detail } from `claude --version`
 *
 * Every line is one event from the `BrokerEvent` union in `claudeEvents.ts`,
 * ending in exactly one `done` or `error`. **A client must keep the `sessionId`
 * off the `session` event** — it is what `--resume` needs, and it is the only
 * place it appears before the turn ends.
 *
 * The broker's `system` prompt parameter is deliberately NOT exposed on this
 * wire. A system contract belongs to a conversation, and conversations are P1's
 * to own; putting it on the raw transport now would mean two places decide it.
 *
 * ── what is allowlisted, and why it has to be ────────────────────────────────
 *
 * `model`, `permissionMode` and `effort` all reach a command line that is run
 * through a shell (`claude` is a `.cmd` shim on Windows, so `shell: true` is
 * unavoidable). None of them is passed through: the model resolves through the
 * shared `MODEL_CATALOG` and the other two through the broker's own literal
 * unions. An unknown value is REFUSED with 400 rather than dropped — a silently
 * ignored model is how a turn runs on the wrong tier and nobody finds out
 * (`src/modules/buildmgr/models.ts` documents that exact defect in the builder).
 *
 * The model catalog is reused rather than re-listed on purpose. A second roster
 * would drift from the first, which is the whole subject of that file's header.
 * It wants a neutral home now that a non-module consumer reads it; moving it is
 * a refactor, not this step.
 *
 * `cwd` is NOT validated against an allowlist here, and that is a real decision
 * rather than an oversight: this transport runs the owner's own CLI under the
 * owner's own subscription, on their machine, and a workspace whose working
 * directory it cannot set is the feature missing. P4 ("Projects and the bound
 * working directory") is where a project binding decides what it may be. Until
 * then the route only checks the directory exists, so a typo fails loudly here
 * instead of silently running the turn against the studio package root.
 *
 * ── auth ─────────────────────────────────────────────────────────────────────
 *
 * There is none to configure. The CLI mode IS the subscription — account auth,
 * no API key anywhere in this path. See the broker header.
 */
import { existsSync, statSync } from "node:fs";

import {
  clampTimeoutS,
  hasUserTurn,
  isEffortLevel,
  isPermissionMode,
  ndjsonStream,
  parseWireMessages,
  probeClaudeCli,
  runCliChat,
  type BrokerWireMessage
} from "../../../src/server/claudeBroker";
import { DEFAULT_TIER, MODEL_CATALOG, resolveModel } from "../../../src/modules/buildmgr/models";

export const dynamic = "force-dynamic";
/** The broker's own ceiling is 3600s; Next needs telling separately or it cuts
 *  the response out from under a long agentic turn. */
export const maxDuration = 3600;

interface TurnBody {
  messages?: unknown;
  prompt?: unknown;
  sessionId?: unknown;
  model?: unknown;
  permissionMode?: unknown;
  effort?: unknown;
  cwd?: unknown;
  timeoutS?: unknown;
}

const bad = (error: string) => Response.json({ error }, { status: 400 });

/** GET → is the CLI actually there? The honest health check: it spawns
 *  `claude --version` (cached 30s) rather than reporting that a route exists. */
export async function GET() {
  const probe = await probeClaudeCli();
  return Response.json(probe, { status: probe.ok ? 200 : 503 });
}

export async function POST(req: Request) {
  let body: TurnBody;
  try {
    body = (await req.json()) as TurnBody;
  } catch {
    return bad("invalid JSON body");
  }

  /* ------------------------------------------------------------- messages */
  // Two accepted shapes: a full wire history, or a bare `prompt` for the common
  // single-turn case. A resumed session needs only the newest turn anyway — the
  // CLI is holding the history.
  let messages: BrokerWireMessage[] = parseWireMessages(body.messages);
  if (!messages.length && typeof body.prompt === "string" && body.prompt.trim()) {
    messages = [{ role: "user", text: body.prompt }];
  }
  if (!hasUserTurn(messages)) return bad("at least one non-empty user message is required");

  /* ---------------------------------------------------------------- model */
  const requested = typeof body.model === "string" && body.model ? body.model : DEFAULT_TIER;
  const model = resolveModel(requested);
  if (!model) {
    return bad(
      `unknown model "${requested}" — refused rather than silently defaulted to ${DEFAULT_TIER}. Known: ${MODEL_CATALOG.map((m) => m.slug).join(", ")}.`
    );
  }

  /* --------------------------------------------------- permission, effort */
  if (body.permissionMode !== undefined && !isPermissionMode(body.permissionMode)) {
    return bad(`unknown permissionMode "${String(body.permissionMode)}"`);
  }
  if (body.effort !== undefined && !isEffortLevel(body.effort)) {
    return bad(`unknown effort "${String(body.effort)}"`);
  }

  /* ------------------------------------------------------------------ cwd */
  let cwd: string | undefined;
  if (body.cwd !== undefined) {
    if (typeof body.cwd !== "string" || !body.cwd.trim()) return bad("cwd must be a non-empty string");
    cwd = body.cwd;
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return bad(`cwd is not an existing directory: ${cwd}`);
    }
  }

  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId : undefined;
  const timeoutMs = clampTimeoutS(body.timeoutS) * 1000;

  /* --------------------------------------------------------------- stream */
  return ndjsonStream(
    (emit, { onAbort }) =>
      runCliChat(
        {
          model: model.cliId,
          system: "",
          messages,
          sessionId,
          cwd,
          permissionMode: isPermissionMode(body.permissionMode) ? body.permissionMode : undefined,
          effort: isEffortLevel(body.effort) ? body.effort : undefined,
          timeoutMs
        },
        emit,
        onAbort
      ),
    // Closing the connection kills the CLI process tree, not just the reader —
    // see `killTree` in the broker. A turn left running is a cost leak with no
    // UI attached to it.
    req.signal
  );
}
