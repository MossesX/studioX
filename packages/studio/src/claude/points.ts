/**
 * @file The Claude subsystem's extension points, declared as DATA — the
 * consumer surface the Build Manager plugin (and everything else) targets.
 *
 * Three points, designed for consumers from P1 rather than retrofitted once
 * the first consumer arrives. That ordering is the project's own forcing
 * function, and its reason is stated in the `.bmpx`: *"retrofitting a consumer
 * API after the first consumer arrives is how it ends up shaped for one
 * caller."*
 *
 *   `claude.tool`              a plugin exposes a callable the model can invoke
 *   `claude.context-provider`  a plugin injects context into a prompt
 *   `claude.session-observer`  a plugin watches session events — how a Build
 *                              Manager plugin follows a build it started,
 *                              without owning the transport
 *
 * `session-observer` and `context-provider` are LIVE: the service fans every
 * event out to observer contributions, and folds provider output into the
 * system contract on a session's first turn. `claude.tool` is declared and
 * validated but not yet wired into the CLI invocation — that wiring is an MCP
 * bridge, and it lands with the first real tool consumer rather than as
 * speculation here. Declaring it now is what fixes the contract the bridge
 * will have to serve.
 *
 * UI points are deliberately absent: `claude-workspace.panel` and
 * `claude-workspace.composer-action` belong to the MODULE (P3), because a
 * transport has no screen for a panel to land on.
 *
 * Isomorphic — no node imports, so a client bundle may read the point ids and
 * the payload types.
 */
import type { ExtensionPoint, Registry } from "@axf/core";

import type { ClaudeSessionEvent, ConversationRecord } from "./types";

export const CLAUDE_TOOL_POINT = "claude.tool";
export const CLAUDE_CONTEXT_PROVIDER_POINT = "claude.context-provider";
export const CLAUDE_SESSION_OBSERVER_POINT = "claude.session-observer";

/** What a `claude.tool` contribution provides. */
export interface ClaudeToolPayload {
  /** Tool name the model sees. Lower-kebab, unique among contributions. */
  readonly name: string;
  /** What the tool does and when to call it — the model reads this. */
  readonly description: string;
  /** Executes one invocation. Runs server-side, in the subsystem's process. */
  readonly run: (input: unknown) => unknown | Promise<unknown>;
}

/** What a `claude.context-provider` contribution provides. */
export interface ClaudeContextProviderPayload {
  readonly id: string;
  /** Returns context text folded into the system contract on a session's
   *  FIRST turn (a resumed session already carries its history). */
  readonly provide: (ctx: { conversation: ConversationRecord }) => string | Promise<string>;
}

/** What a `claude.session-observer` contribution provides. */
export interface ClaudeSessionObserverPayload {
  readonly id: string;
  /** Called for every service event, every conversation. An observer that
   *  throws is logged and skipped — it must not be able to break a turn. */
  readonly onEvent: (event: ClaudeSessionEvent) => void;
}

export const CLAUDE_POINTS: readonly ExtensionPoint[] = [
  {
    id: CLAUDE_TOOL_POINT,
    title: "Claude tool",
    description:
      "A callable the model can invoke: name, description and a run function. Declared for " +
      "consumers now; the CLI-side wiring (an MCP bridge) lands with the first real tool.",
    kind: "command",
    cardinality: "many",
    requires: ["name", "description", "run"],
    ordering: "declared"
  },
  {
    id: CLAUDE_CONTEXT_PROVIDER_POINT,
    title: "Claude context provider",
    description:
      "Injects context into a prompt: a provide(ctx) returning text folded into the system " +
      "contract on a session's first turn.",
    kind: "value",
    cardinality: "many",
    requires: ["id", "provide"],
    ordering: "priority"
  },
  {
    id: CLAUDE_SESSION_OBSERVER_POINT,
    title: "Claude session observer",
    description:
      "Watches session events — every turn, CLI event, completion and failure, for every " +
      "conversation. onEvent(event) receives the same vocabulary the service API streams.",
    kind: "command",
    cardinality: "many",
    requires: ["id", "onEvent"],
    ordering: "declared"
  }
];

/**
 * Declare the points into a registry, idempotently.
 *
 * `Registry.declarePoint` throws on a re-declaration — correctly, since two
 * OWNERS for one point id is a real bug and the loser's contributions would be
 * validated against a shape its author never wrote. This is the same owner
 * declaring the same points from two entry paths (the kernel's `start()`, on
 * both runtimes, and the server service's constructor, which must work in a
 * route that never booted the studio kernel), so an existence check is the
 * honest guard rather than a swallowed error.
 */
export function declareClaudePoints(target: Registry): void {
  const declared = new Set(target.points().map((p) => p.id));
  for (const point of CLAUDE_POINTS) {
    if (!declared.has(point.id)) target.declarePoint(point);
  }
}
