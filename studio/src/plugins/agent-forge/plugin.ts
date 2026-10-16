/**
 * @file Agent Forge's CLIENT contributions — `axf-claude` P5.
 *
 * Two of the plugin's three contributions live here: the workspace panel and
 * the composer action. The third, `claude.context-provider`, is in
 * `plugin.server.ts` and is registered by `src/server/plugins.ts`.
 *
 * ── why the server half is split off ────────────────────────────────────────
 *
 * The context provider runs inside the subsystem's process and must read
 * `.claude/agents` off disk, so its file imports `node:fs`. This file is
 * imported by `studio.subsystem.ts`, which is evaluated in the CLIENT bundle —
 * so putting all three contributions in one module would put `node:fs` in the
 * browser graph, which tsc does not complain about and the bundler does
 * (`gizmox-unarchived-tab` is the write-up of that exact trap).
 *
 * The closure resolver only reads THIS file, and that costs nothing: it carries
 * a plugin when a contribution's point starts with a member MODULE's id, and
 * `claude.context-provider` belongs to the SUBSYSTEM. It would not have been
 * carried from either file.
 *
 * ── THE RULE THIS FILE OBEYS: no static value import of a sibling ───────────
 *
 * `scripts/lib/closure.mjs` imports every `plugin.ts` under plain Node with
 * native type stripping. Two consequences, and both bit during P5 before they
 * were understood:
 *
 *   · a `.tsx` in the static graph is unresolvable (no JSX transform), so
 *     `render()` goes through `React.lazy` rather than holding a component;
 *   · a relative specifier with no extension is unresolvable too (Node's ESM
 *     resolver does not guess), so the action's body is a DYNAMIC import.
 *
 * What may appear statically is therefore: packages (`react`, `@axf/core`) and
 * `import type`, which is erased. `actions.ts` holds everything else.
 * `npm run suite` is the gate — it refuses to write the closure at all rather
 * than write one with a blind spot in it.
 */
import * as React from "react";

import type { Contribution } from "@axf/core";

import type {
  ComposerActionPayload,
  WorkspacePanelPayload
} from "../../modules/claude-workspace/points";

/** Fetched the first time the panels column renders, not at boot. */
const Panel = React.lazy(() => import("./AgentForgePanel"));

export const AGENT_FORGE_PANEL: Contribution<WorkspacePanelPayload> = {
  from: "agent-forge",
  point: "claude-workspace.panel",
  priority: 10,
  payload: {
    title: "Agent Forge",
    glyph: "icon-account",
    render: () => React.createElement(Panel)
  }
};

export const AGENT_FORGE_BRIEF_ACTION: Contribution<ComposerActionPayload> = {
  from: "agent-forge",
  point: "claude-workspace.composer-action",
  priority: 10,
  payload: {
    id: "agent-forge.insert-brief",
    label: "Insert the persona brief",
    glyph: "icon-account",
    run: () => import("./actions").then((m) => m.insertPersonaBrief())
  }
};
