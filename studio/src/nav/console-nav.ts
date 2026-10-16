/**
 * @file `console-nav` — the artifact console's rail, as a registered
 * `nav-menu` asset (the P7 amendment).
 *
 * MASTER §4.4 wrote `console-rail` as a toolbar with `role: "rail"` — before
 * the nav kind existed. Built that way it would hand-roll a second navigation
 * surface beside the registered one, which is exactly the drift rule 6 exists
 * to stop. So the rail IS the nav kind: this asset owns the destinations,
 * `NavShell` places it, and the console's look — placement `left`, style
 * `labeled`, the 212px extent — ships as LAYOUT-DIAL VALUES set through the
 * theme store when the wrapper activates (`dashboards/amberx-console.tsx`),
 * never hardcoded here. A theme roll can still move and redesign it, hot,
 * with the wrapper's chrome intact — that is the P7 gate.
 *
 * The artifact rail's non-navigation furniture (the INTEGRATED FRAMEWORK
 * branding block, the account chip) is deliberately ABSENT: that part is the
 * wrapper's own chrome, not a destination. Sections mirror the artifact's
 * SUITE / MODULES grouping over studio's REAL routes — a menu that navigates
 * nowhere is not a menu, so no `SOON` placeholders ride along (those live on
 * the Quick Launch card, which may be inert; a nav row may not).
 */
import { defineNavMenu } from "@axf/core";

export const CONSOLE_NAV = defineNavMenu({
  id: "console-nav",
  title: "Console navigation",
  surface: "app.nav",
  description:
    "The artifact console's rail destinations: the suite surfaces first, the studio " +
    "workbenches after.",
  // The SUITE section emptied with the v0.3.0 strip and REFILLS as modules
  // return: `/demo` (the Core Inspector) came back 2026-08-10 and `/` is the
  // dashboard module again as of 2026-08-11. Same rule as studio-nav, both
  // ways — a row that navigates nowhere is not a row, and a live route with no
  // row is a surface the rail pretends does not exist. The probes ride at the
  // foot for the same reason; they are real screens.
  //
  // [2026-08-13] `/docs` and `/diff` added, and the second half of that rule
  // is why. Both are live full-page routes, both have rows in `studio-nav`
  // (`/diff` as of the same date), and neither had one here — so switching the
  // `navMenu` dial from studio-nav to console-nav silently LOST two
  // destinations. Two menus over one set of routes may differ in grouping and
  // in order; they may not differ about what exists.
  //
  // [2026-08-13] `/amberxvid` and `/plugins` added — `check:nav` was RED with
  // both missing here while studio-nav carried them, which is the same
  // silent-loss shape the note above records for `/docs` and `/diff`. It
  // recurred within a day of being fixed, and that recurrence is the argument
  // for deriving these rows rather than hand-adding them: see the module→row
  // half of `scripts/check-nav.mjs`.
  //
  // The SUITE section carries the seven registered modules, route-for-route
  // with their decls: `/` (dashboard, labelled Overview here — the rail's own
  // grouping, above the sections), demo, taskman, expenses, amberart, claude.
  // `/buildmgr` is a module too and sits under STUDIO rather than SUITE,
  // because it drives THIS install's builds; that is a grouping choice, not a
  // missing row.
  items: [
    { kind: "link", id: "overview", label: "Overview", glyph: "icon-grid", route: "/" },
    { kind: "divider", id: "div-1" },
    { kind: "section", id: "sec-suite", label: "Suite" },
    { kind: "link", id: "demo", label: "Core Inspector", glyph: "icon-eye", route: "/demo" },
    { kind: "link", id: "taskman", label: "Task Manager", glyph: "icon-layers", route: "/taskman" },
    { kind: "link", id: "expenses", label: "Expense Tracker", glyph: "icon-book", route: "/expenses" },
    { kind: "link", id: "amberart", label: "AmberArt", glyph: "icon-brush", route: "/amberart" },
    { kind: "link", id: "claude", label: "Claude", glyph: "icon-chat", route: "/claude" },
    { kind: "link", id: "forge", label: "Forge", glyph: "icon-bolt", route: "/forge" },
    { kind: "link", id: "amberxvid", label: "AmberX Vid", glyph: "icon-play", route: "/amberxvid" },
    { kind: "link", id: "firecrawl", label: "Firecrawl", glyph: "icon-globe", route: "/firecrawl" },
    // [2026-08-13] `/accounts`, added here in the same breath as studio-nav's
    // row — the two menus may differ in grouping and in order, never about
    // what exists. This rail's module section is SUITE rather than "Core";
    // that is the grouping difference, not a missing row.
    { kind: "link", id: "accounts", label: "Accounts", glyph: "icon-account", route: "/accounts" },
    { kind: "divider", id: "div-2" },
    { kind: "section", id: "sec-studio", label: "Studio" },
    { kind: "link", id: "brand", label: "Brand gallery", glyph: "icon-palette", route: "/brand" },
    {
      kind: "link",
      id: "theme-designer",
      label: "Theme designer",
      glyph: "icon-brush",
      route: "/theme-designer"
    },
    // [2026-08-16] `asset-browser`, added here in the same breath as
    // studio-nav's row — the two menus may differ in grouping and in order,
    // never about what exists.
    {
      kind: "link",
      id: "asset-browser",
      label: "Asset Browser",
      glyph: "icon-folder",
      route: "/asset-browser"
    },
    { kind: "link", id: "buildmgr", label: "Build Manager", glyph: "icon-play", route: "/buildmgr" },
    { kind: "link", id: "settings", label: "Settings", glyph: "icon-gear", route: "/settings" },
    { kind: "link", id: "plugins", label: "Plugin Manager", glyph: "icon-layers", route: "/plugins" },
    { kind: "link", id: "docs", label: "Documentation", glyph: "icon-book", route: "/docs" },
    { kind: "link", id: "diff", label: "Diff browser", glyph: "icon-compare", route: "/diff" },
    // [2026-08-15] `/project-state` added — it was the second route to be live
    // with no row in either menu, the same silent loss `/docs` and `/diff` had.
    // Found by `check:nav` while P15 of `axf-amberxvid-social` was running its
    // gates; the route and the plugin are not that phase's, but a red gate
    // naming a two-line fix is a gate that gets ignored instead of fixed.
    { kind: "link", id: "project-state", label: "Project state", glyph: "icon-book", route: "/project-state" },
    // [2026-08-16] See the twin comment in studio-nav.ts: the `logo-kits` row
    // is retired with the gallery route the asset browser supersedes.
    { kind: "link", id: "status", label: "Boot status", glyph: "icon-sync", route: "/status" },
    { kind: "divider", id: "div-3" },
    { kind: "section", id: "sec-probes", label: "Probes" },
    { kind: "link", id: "mui-probe", label: "MUI probe", glyph: "icon-compare", route: "/mui-probe" },
    {
      kind: "link",
      id: "pane-probe",
      label: "Pane probe",
      glyph: "icon-expand",
      route: "/sandbox/panes"
    }
  ]
});
