/**
 * @file The theme designer's TAB BAR — the six screens of `/theme`, as a
 * toolbar asset rather than an `<MUI Tabs>`.
 *
 * Owner request, 2026-08-13: *"in theme designer convert these links to a
 * toolbar asset with branded icons but larger"*.
 *
 * Three consequences of it being an asset, which is the whole reason to make
 * the swap rather than just adding icons to the tabs:
 *
 *   1. **The icons are the branding pack's.** Standing owner rule: *"whenever
 *      you use icons or i say use or add icon use 1 from the branding pack"*.
 *      Every id below is in the glyph CONTRACT (`brand/requirements.ts`), so it
 *      is drawn by whichever identity is in force — swap the pack and the
 *      designer's own navigation restyles with the app.
 *   2. **"But larger" is data.** `iconSize: 22` is the asset's declared size
 *      (the shipped default is 13). A reader who wants them bigger, smaller,
 *      wordless or down the side gets that from the bar's own right-click
 *      settings — see `core/toolbar/prefs.ts` — with nothing here to edit.
 *   3. It can be duplicated and rebuilt in the designer's own Toolbar tab, like
 *      any other bar. The designer's navigation is now made of the thing the
 *      designer designs, which is the sharpest test the toolbar kind has.
 *
 * The commands are handled by the screen itself through `<Toolbar onCommand>`,
 * NOT by the core command registry, and that is deliberate: "which tab is
 * showing" is React state inside one component, and registering six global
 * commands to reach it would mean a store whose only reader is the component
 * that owns the state anyway. The names are still namespaced so they read
 * correctly in a menu or a log.
 */
import { defineToolbar } from "@axf/core";

/** The surface id, exported so the screen and the bar cannot disagree on it. */
export const DESIGNER_TABS_SURFACE = "designer.tabs";

/** `designer.tab.<id>` — the command a tab fires. The item id IS the tab key,
 *  so the screen can pass its state straight to `activeItem` and hand the
 *  command's tail back to `setTab` with no lookup table in between. */
export const DESIGNER_TAB_COMMAND = "designer.tab.";

export const DESIGNER_TABS_BAR = defineToolbar({
  id: "designer-tabs-bar",
  title: "Theme designer tabs",
  role: "pane-toolbar",
  surface: DESIGNER_TABS_SURFACE,
  description:
    "The theme designer's six screens as one bar: branded icons at 22px with their names beside them.",
  // 48 against the icons' 22 — the icon plus the button's own 9px of breathing
  // room is 31, and the rest is the bar's padding either side of it.
  height: 48,
  iconSize: 22,
  background: "page",
  items: [
    {
      kind: "action",
      id: "dials",
      glyph: "icon-palette",
      title: "Every dial in the spec, grouped by subsystem",
      label: "Dials",
      command: "designer.tab.dials"
    },
    {
      kind: "action",
      id: "roller",
      glyph: "icon-sparkle",
      title: "Seeded rolls — generate a whole look",
      label: "Roller",
      command: "designer.tab.roller"
    },
    {
      kind: "action",
      id: "toolbar",
      glyph: "icon-bolt",
      title: "Build, edit and select the banner toolbar",
      label: "Toolbar",
      command: "designer.tab.toolbar"
    },
    {
      kind: "action",
      id: "navmenu",
      glyph: "icon-grid",
      title: "Build, edit and select the navigation menu",
      label: "Nav menu",
      command: "designer.tab.navmenu"
    },
    {
      kind: "action",
      id: "dashboard",
      glyph: "icon-layers",
      title: "Build, edit and select the dashboard wrapper",
      label: "Dashboard",
      command: "designer.tab.dashboard"
    },
    {
      kind: "action",
      id: "surfaces",
      glyph: "icon-eye",
      command: "designer.tab.surfaces",
      label: "Surfaces",
      title: "Landing pages, plugin screens and dialogs — every UI that is not a module"
    },
    {
      kind: "action",
      id: "saved",
      glyph: "icon-folder",
      title: "The shelf — saved looks, every dial included",
      label: "Saved",
      command: "designer.tab.saved"
    }
  ]
});
