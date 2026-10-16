/**
 * @file The tab bar's declaration half: its context-menu areas and its settings
 * rows, as DATA.
 *
 * A `*.decl.ts` even though this is a PLUGIN, for the reason `docs.decl.ts` and
 * `settings.decl.ts` each state about themselves: `test/ctx-conformance.test.ts`
 * discovers the map by importing every `*.decl.ts` under `src/` and discovers
 * the DOM half by scanning every `.tsx` for `data-axf-area`. It fails in both
 * directions, so a surface that marks areas declares them here whatever kind of
 * surface it is. Same hard rule as every other decl: **nothing but
 * `import type`** — the closure resolver and that gate read this file under
 * Node's native type stripping.
 *
 * `route` is `/` and that deserves a sentence, because it is the one field here
 * that is not literally true. The bar has no route — it is chrome, drawn above
 * the banner on every route by `shell.strip`. The field exists because it is the
 * conformance scanner's discovery key (`typeof decl.route === "string"` is how a
 * decl is recognised at all), and `/` is the closest honest answer: the shell
 * mounts this at the app root and it is present from there down.
 *
 * ── the settings, and the ceiling ─────────────────────────────────────────────
 *
 * GizmoX's top-strip carried ~70 settings across 961 lines — pattern, motion,
 * speed, three colour tokens, glow size, edge width, bar fill, blur, density,
 * radius, border style, letter spacing, five animation dials, and so on. None of
 * that came across, and not for want of effort: the standing directive
 * (`.claude/rules/amberx-bound-builds.md`, restated at the head of
 * `settings/decl.ts`) is that **a row earns its place only when the surface
 * cannot work properly without it**. Every drawing decision here reads the live
 * theme instead, which is what makes the bar recolour with a roll rather than
 * needing its own palette.
 *
 * The eight rows below are the ones that survive that test. Each is a decision
 * about BEHAVIOUR that different people genuinely need answered differently, and
 * each says why in its hint. `enabled` is first among them and is also the row
 * the future plugin manager writes — see `studio.points.ts` on why the manager
 * flips a plugin through its own settings store rather than through a second
 * switch that could disagree with it.
 */
import type { ModuleMenusDecl, ModuleSettingsDecl } from "@axf/core";

/** The settings owner id, the asset id and the menu namespace — one string. */
export const TAB_BAR_ID = "tab-bar";

/** The row that means "the bar is on". Named here so the plugin, its manifest
 *  and the roster entry the manager reads cannot spell it three ways. */
export const TAB_BAR_ENABLED_KEY = "enabled";

const menus: ModuleMenusDecl = {
  areas: [
    {
      id: "tab-bar.strip",
      title: "Tab bar",
      description:
        "The band across the top of the app and the empty space in the bar it reveals — " +
        "everything about the bar itself rather than about one tab."
    },
    {
      id: "tab-bar.tab",
      title: "Open tab",
      description:
        "One tab. Carries the surface's id and route, so the menu can go to it, move it or " +
        "close it without the bar handing anything to the command."
    }
  ],
  items: {
    "tab-bar.strip": [
      {
        id: "settings",
        label: "Tab bar settings",
        icon: "icon-gear",
        command: "tab-bar.settings.open",
        order: 10
      },
      {
        id: "pin",
        label: "Keep the bar open",
        role: "toggle",
        command: "tab-bar.pin.toggle",
        checkedWhen: "tab-bar.pinned",
        order: 20
      },
      {
        id: "close-all",
        label: "Close all tabs",
        role: "danger",
        command: "tab-bar.closeAll",
        enabledWhen: "tab-bar.hasTabs",
        order: 30
      }
    ],
    "tab-bar.tab": [
      { id: "go", label: "Go to this surface", command: "tab-bar.tab.go", order: 10 },
      {
        id: "open-window",
        label: "Open in a new browser tab",
        command: "tab-bar.tab.openWindow",
        order: 20
      },
      {
        id: "move-left",
        label: "Move left",
        command: "tab-bar.tab.moveLeft",
        enabledWhen: "tab-bar.canMoveLeft",
        order: 30
      },
      {
        id: "move-right",
        label: "Move right",
        command: "tab-bar.tab.moveRight",
        enabledWhen: "tab-bar.canMoveRight",
        order: 40
      },
      { id: "copy-route", label: "Copy route", command: "tab-bar.tab.copyRoute", order: 50 },
      {
        id: "close",
        label: "Close tab",
        role: "danger",
        command: "tab-bar.tab.close",
        order: 60
      },
      {
        id: "close-others",
        label: "Close other tabs",
        role: "danger",
        command: "tab-bar.tab.closeOthers",
        enabledWhen: "tab-bar.manyTabs",
        order: 70
      }
    ]
  }
};

const settings: ModuleSettingsDecl = {
  ns: "tab-bar-settings",
  // The dialog's heading. A module gets one from the registry; a plugin has no
  // entry there, so without this the shell's one dialog heads itself with the
  // bare id — which is what it did until `ModuleSettingsDecl.title` existed.
  title: "Tab bar",
  rows: [
    {
      key: TAB_BAR_ENABLED_KEY,
      label: "Show the tab bar",
      hint:
        "Off removes the band and the bar from every route while every file stays where it is — " +
        "the switch a plugin manager flips, and the reason this row exists rather than a second " +
        "enabled-list somewhere else.",
      kind: "switch",
      defaultValue: true
    },
    {
      key: "reveal",
      label: "Reveal the bar",
      hint:
        "How the bar comes out of the band. A peek overlays the page; 'always' makes it a real " +
        "row that pushes the app down. The three answers suit genuinely different habits, and " +
        "no default is right for all of them.",
      kind: "select",
      defaultValue: "hover",
      options: [
        { value: "hover", label: "On hover" },
        { value: "click", label: "On click (pins it)" },
        { value: "always", label: "Always open" }
      ]
    },
    {
      key: "hideDelay",
      label: "Hide after",
      hint:
        "Milliseconds the bar stays out once the pointer leaves it. Too short and the bar is " +
        "unusable on a large screen — the pointer cannot cross the gap in time.",
      kind: "number",
      defaultValue: 450,
      min: 0,
      max: 3000,
      step: 50
    },
    {
      key: "maxTabs",
      label: "Most tabs kept",
      hint:
        "Over this, the oldest is dropped. It bounds a list that otherwise grows for as long as " +
        "the app is used, and the right bound depends on the width of the screen it is on.",
      kind: "number",
      defaultValue: 12,
      min: 2,
      max: 24,
      step: 1
    },
    {
      key: "newestFirst",
      label: "Newest tab first",
      hint:
        "Which end a newly opened surface appears at. Reverses the whole bar, including which " +
        "neighbour takes over when the tab you are looking at is closed.",
      kind: "switch",
      defaultValue: false
    },
    {
      key: "closeOnPick",
      label: "Hide after picking a tab",
      hint:
        "Collapses a hover peek once you have chosen. It never unpins a pinned bar — a pin is " +
        "the deliberate override of auto-hide, and one that undid itself on the first click " +
        "would make pinning useless.",
      kind: "switch",
      defaultValue: true
    },
    {
      key: "middleClickClose",
      label: "Middle-click closes a tab",
      hint:
        "The browser habit. Off for pointers where the middle button is autoscroll, where it " +
        "would otherwise close a surface every time the reader tried to scroll the bar.",
      kind: "switch",
      defaultValue: true
    },
    {
      key: "showLabels",
      label: "Show tab labels",
      hint:
        "Off leaves the icons alone — the bar becomes a compact strip of marks. There is no " +
        "matching switch for the icons: a tab with neither is unidentifiable, so that state is " +
        "not offered.",
      kind: "switch",
      defaultValue: true
    }
  ]
};

/**
 * Shaped `{ id, route, menus, settings }` — the fields the conformance scanner
 * and the two registration loops in `studio.subsystem.ts` read. It is NOT a
 * `ModuleDecl`: no component, no points, and it spends none of the suite's
 * twelve module slots.
 */
export const TAB_BAR_DECL: {
  readonly id: string;
  readonly route: string;
  readonly menus: ModuleMenusDecl;
  readonly settings: ModuleSettingsDecl;
} = {
  id: TAB_BAR_ID,
  route: "/",
  menus,
  settings
};
