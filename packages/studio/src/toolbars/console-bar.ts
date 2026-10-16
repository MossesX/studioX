/**
 * @file The console's two toolbar assets — the banner and the status strip
 * from the owner's patched Artifact (MASTER §4.4), as data.
 *
 * `console-bar` is the artifact's top bar: the breadcrumb `GizmoX / <surface>`
 * — the GizmoX lockup IS the "GizmoX" (owner directive, §6.2: never an inline
 * SVG; the artifact draws its own AmberX mark there and that is exactly the
 * hand-rolled brand this asset kind exists to stop), a dim `/`, then the
 * shell's route-aware context slot as the surface name. Search stays a
 * field-shaped BUTTON (the focus-loop trap, §2.2). The dock chip and sync
 * status reuse the command bar's fill ids on purpose — the host's fills land
 * by item id, so one `COMMAND_BAR_FILLS` serves both banners.
 *
 * `console-status` is the artifact's bottom strip (`#statusbar`: readout line
 * · clock · right-aligned accent mode label), registered on its OWN surface
 * (`console.status`) so activating it never fights the sandbox's status-bar
 * fixture on `app.status`. It is wrapper chrome: `dash-amberx-console` mounts
 * it and fills it; no other chrome renders that surface.
 */
import { defineToolbar } from "@axf/core";

export const CONSOLE_BAR = defineToolbar({
  id: "console-bar",
  title: "Console banner",
  role: "banner",
  surface: "app.banner",
  description:
    "The artifact console's top bar: GizmoX lockup as the breadcrumb root, the live surface " +
    "name, inline search, sync readout and the dock chip.",
  height: 44,
  background: "panel",
  items: [
    // 324×100 lockup at width 104 renders 32px tall inside the 44px bar.
    { kind: "brand", id: "brand", glyph: "lockup-horizontal", width: 104, command: "nav.home" },
    { kind: "label", id: "crumb-sep", text: "/", tone: "dim" },
    { kind: "slot", id: "context" },
    { kind: "spacer", id: "sp" },
    {
      kind: "field",
      id: "search",
      glyph: "icon-search",
      placeholder: "Search everything…",
      hint: "⌃⇧G",
      width: 240,
      command: "search.open"
    },
    { kind: "status", id: "sync", tone: "dim" },
    { kind: "slot", id: "dock" }
  ]
});

export const CONSOLE_STATUS = defineToolbar({
  id: "console-status",
  title: "Console status strip",
  role: "status-bar",
  surface: "console.status",
  description:
    "The artifact's bottom readout strip: environment line, clock, and the right-aligned " +
    "accent mode label.",
  height: 26,
  background: "page",
  items: [
    { kind: "label", id: "name", text: "GizmoX Build Systems", tone: "dim" },
    { kind: "divider", id: "d1" },
    { kind: "status", id: "line", tone: "dim" },
    { kind: "spacer", id: "sp" },
    { kind: "status", id: "clock", tone: "dim" },
    { kind: "status", id: "mode", tone: "accent" }
  ]
});

export const CONSOLE_BARS = [CONSOLE_BAR, CONSOLE_STATUS];
