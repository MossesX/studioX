/**
 * @file The project-state plugin's declaration — data only, Node-importable.
 *
 * One contribution: the roster row on `studio.plugin` that announces the
 * plugin to the Plugin Manager. The plugin's other two registrations — the
 * `project-state-bar` toolbar asset and the `project-state.generate` command —
 * are not point contributions (a toolbar registers with `toolbars`, a command
 * with `commands`), so this file NAMES them in the summary and the host
 * registers them beside it in `studio.subsystem.ts`.
 *
 * The hard rules every `plugin.ts` obeys (`axf-claude` P5, learned the hard
 * way): `scripts/lib/closure.mjs` and `test/registry-scoping.test.ts` import
 * this file under plain Node — so static imports are PACKAGES and
 * `import type` only. No `.tsx`, no extensionless relative value import. This
 * plugin's screen reaches the app through its route, not through a lazy panel,
 * so nothing here needs `React.lazy` or a dynamic import at all.
 */
import type { Contribution } from "@axf/core";

import type { StudioPluginPayload } from "../../studio.points";

const ID = "project-state";

export const PROJECT_STATE_PLUGIN: Contribution<StudioPluginPayload> = {
  from: ID,
  point: "studio.plugin",
  priority: 40,
  payload: {
    id: ID,
    title: "Project State",
    summary:
      "Reads every current and archived session that touched AmberX plus the PLANNING-STATE.md " +
      "family and regenerates PROJECT-STATE.md + PROJECT-STATE.json at the AmberX root — the md " +
      "opens with a compact resume prompt a new session pastes to pick up where the project " +
      "stands. One registered toolbar asset (project-state-bar) with the one Generate button, " +
      "surfaced at /project-state.",
    // `core`: it extends the SDK itself — the state files serve every session
    // and every surface, not one module's points.
    target: "core",
    contributes: ["studio.plugin"]
    // No settingsOwner and no enabledKey: the plugin has no settings — the
    // generator is deterministic and the one knob it could grow (regenerate)
    // is the bar's single action, not a setting.
  }
};
