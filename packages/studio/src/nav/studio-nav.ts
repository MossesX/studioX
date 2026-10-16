/**
 * @file Studio's navigation menu, as a registered `nav-menu` asset.
 *
 * Items only — where it sits, what style it draws in, how big its icons are
 * and what its hover does are all LAYOUT DIALS, so a rolled layout theme moves
 * and redesigns this menu without touching this file. Glyph ids come from the
 * 25-drawing brand contract, so every registered pack can supply them and the
 * menu recolours and re-draws with a pack swap.
 */
import { defineNavMenu } from "@axf/core";

export const STUDIO_NAV = defineNavMenu({
  id: "studio-nav",
  title: "Studio navigation",
  surface: "app.nav",
  description:
    "Every live Studio surface: dashboard, core inspector, the studio workbenches and the probes.",
  // The strip removed six rows because their routes were deleted — a nav row
  // that navigates nowhere is the one thing a nav asset may not contain. The
  // rule cuts BOTH ways: rows return when their routes do, and on 2026-08-11
  // they did — `/` is the card-screen dashboard again and `/demo` (the Core
  // Inspector) is back, so this menu links every live route, exactly as the
  // pre-strip menu linked everything live in ITS day. The Quick Launch card
  // derives its tiles from these link rows, which is what keeps card and menu
  // from disagreeing about what exists.
  //
  // [2026-08-13] `/diff` added. It was the one live route with no row: P5
  // restored the difference browser and its page, and the menu was not
  // amended with it — so the rule's second half had been broken since, and a
  // real screen was reachable only by typing its path or by the panel's
  // "open the full browser" button. Its glyph is `icon-compare`, the same one
  // `diff-browser/plugin.ts` gives its own two contributions, so the row and
  // the panel that opens it read as one thing.
  //
  // The ten REGISTERED MODULES (`registry.registerModule` in
  // studio.subsystem.ts) each have a row here, route-for-route: dashboard `/`,
  // demo, taskman, buildmgr, expenses, amberart, forge, amberxvid,
  // claude-workspace, firecrawl. Anything added to that list needs one here
  // too, and the label/glyph should match the decl's `title`/`glyph` — every
  // row below does.
  //
  // [2026-08-13] `amberxvid` added with slot 9 — GizmoX's video suite. Its row
  // reuses `icon-play` from its own decl, which the Build Manager row also
  // carries; the two sit in different sections and read as "run" in both.
  //
  // [2026-08-13] `firecrawl` added with slot 10 — the web-data workbench. Its
  // `icon-globe` matches its decl and nothing else in this menu carries it.
  items: [
    { kind: "section", id: "sec-core", label: "Core" },
    { kind: "link", id: "index", label: "Dashboard", glyph: "icon-grid", route: "/" },
    { kind: "link", id: "demo", label: "Core Inspector", glyph: "icon-eye", route: "/demo" },
    { kind: "link", id: "taskman", label: "Task Manager", glyph: "icon-layers", route: "/taskman" },
    { kind: "link", id: "expenses", label: "Expense Tracker", glyph: "icon-book", route: "/expenses" },
    { kind: "link", id: "amberart", label: "AmberArt", glyph: "icon-brush", route: "/amberart" },
    { kind: "link", id: "claude", label: "Claude", glyph: "icon-chat", route: "/claude" },
    { kind: "link", id: "forge", label: "Forge", glyph: "icon-bolt", route: "/forge" },
    { kind: "link", id: "amberxvid", label: "AmberX Vid", glyph: "icon-play", route: "/amberxvid" },
    { kind: "link", id: "firecrawl", label: "Firecrawl", glyph: "icon-globe", route: "/firecrawl" },
    { kind: "link", id: "accounts", label: "Accounts", glyph: "icon-account", route: "/accounts" },
    { kind: "divider", id: "div-1" },
    { kind: "section", id: "sec-studio", label: "Studio" },
    { kind: "link", id: "brand", label: "Brand gallery", glyph: "icon-palette", route: "/brand" },
    {
      kind: "link",
      id: "theme-designer",
      label: "Theme designer",
      glyph: "icon-brush",
      route: "/theme-designer"
    },
    // [2026-08-16] `asset-browser` — slot 12/12, the last suite member. It sits
    // in Studio rather than Core because it manages the things the workbenches
    // author. `icon-folder` is its decl's glyph and nothing else in either menu
    // carries it.
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
    // [2026-08-16] The `logo-kits` row is GONE with `/login-landing/gallery`
    // itself. Its own comment said to retire it when the graphical asset
    // browser superseded it, and the browser's live previews (P5) do: the
    // gallery drew every logo of every kit through `LogoKitLogo`, and so does
    // `/asset-browser`, over six more kinds. Two surfaces drawing the same
    // kits is two surfaces that can disagree about what a kit holds.
    { kind: "link", id: "status", label: "Boot status", glyph: "icon-sync", route: "/status" },
    { kind: "divider", id: "div-2" },
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
