/**
 * @file The Claude workspace — declaration composed with its component.
 *
 * The declaration lives in `claude-workspace.decl.ts`, data-only, so the
 * registry, the peel and the suite resolver can read it without loading React.
 * This file is the ONLY place the declaration and the screen meet, and
 * `defineModule` validates the result — including that both extension point
 * ids are namespaced to the module, which is the chokepoint's job rather than
 * a convention somebody remembers.
 */
import { defineModule } from "@axf/core";

import ClaudeWorkspaceModule from "./ClaudeWorkspaceModule";
import { CLAUDE_WORKSPACE_DECL } from "./claude-workspace.decl";

export const CLAUDE_WORKSPACE_MODULE = defineModule({
  ...CLAUDE_WORKSPACE_DECL,
  component: ClaudeWorkspaceModule
});
