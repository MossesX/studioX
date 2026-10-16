/**
 * @file The Plugin Manager's own contributions — data only, Node-importable.
 *
 * The manager eats its own dog food: it is a plugin, so it announces itself on
 * the same two points it consumes — a roster row on `studio.plugin` (it lists
 * itself, exactly as a settings page appears in its own list) and a section on
 * `studio.settings-section` for its one declared switch. The same hard rules
 * as every plugin entry hold: static imports are packages and `import type`
 * only, the id is a literal pinned to the decl's by test rather than by an
 * import edge Node cannot follow.
 */
import type { Contribution } from "@axf/core";

import type { StudioPluginPayload, StudioSettingsSectionPayload } from "../../studio.points";

const ID = "plugin-manager";

export const PLUGIN_MANAGER_PLUGIN: Contribution<StudioPluginPayload> = {
  from: ID,
  point: "studio.plugin",
  priority: 90,
  payload: {
    id: ID,
    title: "Plugin Manager",
    summary:
      "The roster of every plugin in the install: what each one contributes, its settings, its " +
      "documentation and its files — with enable/disable through each plugin's own store, and " +
      "import/export as portable packages.",
    // `core`: it extends the SDK itself — the roster and the package engine
    // serve every surface, not one module's points.
    target: "core",
    contributes: ["studio.plugin", "studio.settings-section"],
    // A settings owner but deliberately NO `enabledKey`: the switch that turns
    // off the switchboard is a lockout, not a feature.
    settingsOwner: ID
  }
};

export const PLUGIN_MANAGER_SETTINGS_SECTION: Contribution<StudioSettingsSectionPayload> = {
  from: ID,
  point: "studio.settings-section",
  priority: 5,
  payload: {
    id: ID,
    title: "Plugin Manager",
    summary: "The confirm step before an uninstall moves a plugin's files.",
    ownerId: ID
  }
};
