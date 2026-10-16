/**
 * @file The Module Assistant's contributions — data only, Node-importable.
 *
 * The closure resolver imports this under plain Node with native type
 * stripping, so the hard rules hold: static imports are PACKAGES (`react`,
 * `@axf/core`) and `import type` only; the `.tsx` window goes through
 * `React.lazy`; behaviour is named, never inlined.
 *
 * Two contributions:
 *
 *   1. `studio.assistant` — the window itself. The shell's `AssistantHost`
 *      renders whatever plugs in here, which is what makes the assistant
 *      swappable: a different assistant plugin contributes to the same point
 *      and the shell needs no edit.
 *   2. `ctx.item` — an "Ask the assistant" row on the UNIVERSAL band, so the
 *      assistant is reachable from every right-click in the app. The row is
 *      pure data: it names the `assistant.toggle` command, registered by
 *      `registerAssistantCommands()` at subsystem start.
 */
import * as React from "react";
import type { Contribution } from "@axf/core";
import type { CtxItemPayload } from "@axf/core";

const Window = React.lazy(() => import("./AssistantWindow"));
/** The build's question, asked in the app. Rendered BESIDE the window rather
 *  than inside it: the window returns null when it is closed, and a build
 *  waiting for a name must be able to interrupt an owner who never opened it. */
const AgentBuilder = React.lazy(() => import("./ModuleAgentBuilder"));

export interface AssistantSurfacePayload {
  readonly title: string;
  readonly render: () => React.ReactNode;
}

export const ASSISTANT_WINDOW: Contribution<AssistantSurfacePayload> = {
  from: "module-assistant",
  point: "studio.assistant",
  priority: 10,
  payload: {
    title: "Module Assistant",
    render: () =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Window),
        React.createElement(AgentBuilder)
      )
  }
};

export const ASSISTANT_CTX_ITEM: Contribution<CtxItemPayload> = {
  from: "module-assistant",
  point: "ctx.item",
  payload: {
    area: "universal",
    item: {
      id: "ask-assistant",
      label: "Ask the assistant",
      icon: "icon-chat",
      command: "assistant.toggle",
      order: 60
    }
  }
};
