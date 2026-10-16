/**
 * @file The difference browser, as CONTRIBUTIONS to the Claude workspace's two
 * declared points — `axf-claude` P5.
 *
 * `axf-diff-browser.bmpx` declared `target: "module:claude"` on the day the
 * browser was built and then said, honestly, that it was *"UNWIRED BY
 * DIRECTIVE"*: mounted at `/diff` so it could be used and tested for real
 * without being registered, until the phase that absorbs it arrived. This file
 * is that phase. The route survives — it is where an eight-column grid belongs
 * — but the plugin now reaches the workspace through the registry, and the
 * workspace imports nothing of it.
 *
 * (The manifest says `module:claude-workspace`, not the `.bmpx`'s
 * `module:claude`. `claude` is the SUBSYSTEM — transport and sessions, no
 * screen for a panel to land on. The plan predates the split into two assets;
 * the module is what a UI point can belong to.)
 *
 * ── the two rules this file obeys, both learned the hard way in P5 ──────────
 *
 * `scripts/lib/closure.mjs` imports every `plugin.ts` under plain Node with
 * native type stripping and no JSX transform. So a `.tsx` in the static graph
 * makes the plugin unresolvable, and so does an extensionless relative
 * specifier — Node's ESM resolver does not guess. What may appear statically is
 * packages and `import type`. Hence `React.lazy` for the panel and a DYNAMIC
 * import for the action's body, with everything real in `actions.ts`.
 * `npm run suite` is the gate, and it refuses to write a closure with a blind
 * spot rather than writing one quietly.
 */
import * as React from "react";

import type { Contribution } from "@axf/core";

import type {
  ComposerActionPayload,
  WorkspacePanelPayload
} from "../../modules/claude-workspace/points";

/** Loaded on first render of the panels column, not at boot. */
const Panel = React.lazy(() => import("./HistoryPanel"));

export const DIFF_BROWSER_PANEL: Contribution<WorkspacePanelPayload> = {
  from: "diff-browser",
  point: "claude-workspace.panel",
  priority: 20,
  payload: {
    title: "History",
    glyph: "icon-compare",
    render: () => React.createElement(Panel)
  }
};

export const DIFF_BROWSER_QUOTE_ACTION: Contribution<ComposerActionPayload> = {
  from: "diff-browser",
  point: "claude-workspace.composer-action",
  priority: 20,
  payload: {
    id: "diff-browser.quote-newest",
    label: "Quote the newest change",
    glyph: "icon-compare",
    run: () => import("./actions").then((m) => m.quoteNewestChange())
  }
};
