/**
 * @file The tab bar's contributions — data only, Node-importable.
 *
 * The closure resolver imports this under plain Node with native type
 * stripping (`scripts/lib/closure.mjs`), and a plugin whose entry cannot run
 * there is recorded as UNSCANNED rather than skipped — the suite may not ship
 * blind spots. So the hard rules hold: static imports are PACKAGES (`react`)
 * and `import type` only, the `.tsx` goes through `React.lazy`, and behaviour is
 * named, never inlined.
 *
 * That is also why the plugin id is a literal here and not imported from
 * `./tab-bar.decl` where it also lives: an extensionless relative RUNTIME import
 * does not resolve under type stripping, which is the same constraint every
 * `*.decl.ts` in this tree states about itself. The two spellings are pinned
 * together by `test/tab-bar.test.ts`, which reads both — a comment asking
 * someone to keep them in step would not be.
 *
 * ── three contributions, three different audiences ────────────────────────────
 *
 *   1. `shell.strip` — the band itself, mounted by core's `AppShell` above the
 *      banner on every route. This is the one that draws.
 *   2. `studio.plugin` — the roster row a future PLUGIN MANAGER lists. It names
 *      the settings owner and the row that means "on", so the manager enables
 *      and disables this plugin through the plugin's own store rather than
 *      through a second switch that could disagree with it.
 *   3. `studio.settings-section` — a section in the SDK's SETTINGS interface,
 *      naming the same owner. `/settings` renders it today; anything that
 *      replaces or extends that page inherits it without editing this file.
 *
 * Two and three are declared before their consumers are finished, deliberately,
 * for the reason `claude/points.ts` gives about `claude.tool`: *retrofitting a
 * consumer API after the first consumer arrives is how it ends up shaped for one
 * caller.*
 */
import * as React from "react";

import type { Contribution, ShellStripPayload } from "@axf/core";

import type { StudioPluginPayload, StudioSettingsSectionPayload } from "../../studio.points";

/** The asset id, the settings owner and the menu namespace — see the docblock
 *  on why this is a literal rather than an import from the decl. */
const ID = "tab-bar";

const Bar = React.lazy(() => import("./TabBar"));

export const TAB_BAR_STRIP: Contribution<ShellStripPayload> = {
  from: ID,
  point: "shell.strip",
  priority: 100,
  payload: {
    id: ID,
    title: "Tab bar",
    render: () => React.createElement(Bar)
  }
};

export const TAB_BAR_PLUGIN: Contribution<StudioPluginPayload> = {
  from: ID,
  point: "studio.plugin",
  payload: {
    id: ID,
    title: "Tab bar",
    summary:
      "A band across the top of the app that reveals the surfaces you have open, with a tab " +
      "each. Ported from GizmoX's top-strip.",
    // `core`: it extends the framework's own shell, not a module's points —
    // which is what makes it present on routes no module hosts.
    target: "core",
    contributes: ["shell.strip", "studio.plugin", "studio.settings-section"],
    settingsOwner: ID,
    enabledKey: "enabled"
  }
};

export const TAB_BAR_SETTINGS_SECTION: Contribution<StudioSettingsSectionPayload> = {
  from: ID,
  point: "studio.settings-section",
  priority: 10,
  payload: {
    id: ID,
    title: "Tab bar",
    summary:
      "Whether the band is shown, how it reveals, how many surfaces it remembers, and what a " +
      "middle-click does.",
    ownerId: ID
  }
};
