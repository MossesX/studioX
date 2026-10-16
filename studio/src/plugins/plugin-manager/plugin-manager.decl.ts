/**
 * @file The Plugin Manager's declaration — DATA, like every other surface's.
 *
 * A `*.decl.ts` even though this is a PLUGIN rather than a module, for the
 * reason `docs.decl.ts` states: `test/ctx-conformance.test.ts` discovers the
 * menu map by importing every `*.decl.ts` under `src/` and the DOM half by
 * scanning every `.tsx` for `data-axf-area`, and it fails in both directions.
 * A surface that marks areas must declare them here, in the shape the scanner
 * reads, whatever kind of surface it is.
 *
 * Consequently the same hard rule applies: **nothing but `import type`**. The
 * resolver reads this file under Node's native type stripping, so the id is a
 * literal here and everywhere else it appears (`plugin.ts`, the commands file)
 * rather than an import edge Node cannot follow.
 *
 * The manager is the consumer `studio.plugin` and `studio.settings-section`
 * were declared FOR (studio.points.ts: "declared before the manager exists,
 * deliberately"). It spends no suite slot: it fails §4.6's third clause on
 * purpose — everything it does is done through points and stores that already
 * exist, which is precisely what qualifies it as a plugin.
 */
import type { ModuleMenusDecl, ModuleSettingsDecl } from "@axf/core";

export const PLUGIN_MANAGER_ID = "plugin-manager";

/**
 * One switch, under the ceiling: the confirm step before an uninstall moves a
 * plugin's files. The manager cannot work SAFELY without the guard existing,
 * and an operator who scripts imports/uninstalls all day needs the row to turn
 * it off — that pair is what earns the setting its place.
 */
const settings: ModuleSettingsDecl = {
  ns: "plugin-manager-settings",
  title: "Plugin Manager",
  rows: [
    {
      key: "confirmUninstall",
      label: "Confirm before uninstalling",
      hint:
        "Uninstalling moves a plugin's files out of the tree. On, the manager asks first; " +
        "off, the Uninstall button acts immediately.",
      kind: "switch",
      defaultValue: true
    }
  ]
};

const menus: ModuleMenusDecl = {
  areas: [
    {
      id: "plugin-manager.surface",
      title: "Plugin Manager",
      description: "Anywhere on the plugin manager page, including empty space."
    },
    {
      id: "plugin-manager.entry",
      title: "Plugin",
      description:
        "One plugin's row or card. Carries the plugin's id, whether it has settings, and its " +
        "enable key when it declares one, so the menu can offer to configure, flip or export " +
        "exactly this plugin."
    }
  ],
  items: {
    "plugin-manager.surface": [
      { id: "refresh", label: "Refresh the roster", command: "plugin-manager.refresh", order: 10 },
      { id: "import", label: "Import a plugin package…", command: "plugin-manager.import", order: 20 },
      { id: "sep-1", label: "", role: "separator", order: 30 },
      { id: "goto-settings", label: "Open Settings", command: "plugin-manager.goto.settings", order: 40 },
      { id: "goto-docs", label: "Open Documentation", command: "plugin-manager.goto.docs", order: 50 }
    ],
    "plugin-manager.entry": [
      {
        id: "entry-settings",
        label: "Plugin settings",
        command: "plugin-manager.entry.settings",
        enabledWhen: "plugin-manager.entry.hasSettings",
        order: 10
      },
      {
        id: "entry-toggle",
        label: "Enable or disable",
        command: "plugin-manager.entry.toggle",
        enabledWhen: "plugin-manager.entry.hasEnableSwitch",
        order: 20
      },
      { id: "sep-1", label: "", role: "separator", order: 30 },
      { id: "entry-export", label: "Export as a package", command: "plugin-manager.entry.export", order: 40 },
      { id: "entry-copy", label: "Copy the plugin id", command: "plugin-manager.entry.copy", order: 50 }
    ]
  }
};

/**
 * Shaped `{ id, route, menus, settings }` — the fields the conformance scanner
 * and the settings loop read off a module decl. NOT a `ModuleDecl`: no
 * component, no points, no suite slot.
 */
export const PLUGIN_MANAGER_DECL: {
  readonly id: string;
  readonly route: string;
  readonly menus: ModuleMenusDecl;
  readonly settings: ModuleSettingsDecl;
} = {
  id: PLUGIN_MANAGER_ID,
  route: "/plugins",
  menus,
  settings
};
