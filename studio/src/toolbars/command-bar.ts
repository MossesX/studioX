/**
 * @file The `command-bar` toolbar asset — GizmoX's shell bar, control for
 * control, as data (MASTER §3, binding).
 *
 * Eleven items, left to right, replicating `CommandBarWrapper.tsx` from the
 * live GizmoX shell: brand, Modules menu, search field, surface title, then
 * the right-aligned status cluster (note / sync / clock), the dock chip and
 * the two reserved actions. What the original hand-rolled in 429 lines of MUI
 * this file declares in one literal — the arrangement is the asset's, every
 * behaviour is the host's, reached by command NAME through the core registry.
 *
 * Deliberate departures from the original, all directed:
 *   - **no `StyleRollBar`** — GizmoX chrome; AmberX's theme store has its own
 *     roll surface;
 *   - **no REC pill** — that is x-wrecorder's floating toolbar, not the bar;
 *   - item 11 (gear) is NOT a sui affordance — AmberX has no suis; it opens the
 *     app settings page.
 *
 * **Item 10 stopped being reserved on 2026-08-15 (P10).** It was an `action`
 * firing `account.open`, which toasted "reserved, not wired yet" — honest at the
 * time, and a dead control the day the studio grew a real session. It is a
 * `slot` now, because what belongs there is not one button: signed out it is
 * *Sign in*, signed in it is the account chip carrying the person's name with
 * *Sign out* and *Settings* behind it. That is the asset/host split this file's
 * header states — the ARRANGEMENT (a control, here, this wide) is the asset's,
 * and the live content is the host's (`CommandBarChrome.tsx`'s `SessionChip`).
 * Every affordance inside it still fires a registered command by NAME, exactly
 * like the actions either side of it.
 *
 * The brand is **deliberately GizmoX's `lockup-horizontal`**, resolved through
 * the registered pack (owner directive, MASTER §6.2 — never an inline SVG,
 * never a file import, never an `amberx-*` lockup). The owner will swap it,
 * and the swap is then one id in this one asset. Note it is an IDENTITY
 * binding: it renders wherever `axs-studio-brand` is the identity in force,
 * and shows the framework's missing-glyph placeholder under a pack that lacks
 * it — which is honest, and exactly what `check:glyphs`' BOUND_IDENTITY_IDS
 * entry records.
 *
 * Slot ids the host fills: `context` (AppShell's route-aware surface title),
 * `dock` (the disabled chat chip — the seam the future dock system wires
 * into), `account` (the session chip), and the statuses `note` (floating-window
 * count — empty until the task manager brings floating windows), `sync`,
 * `clock`.
 */
import { defineToolbar } from "@axf/core";

export const COMMAND_BAR = defineToolbar({
  id: "command-bar",
  title: "Command bar",
  role: "banner",
  surface: "app.banner",
  description:
    "One horizontal bar: brand, modules behind a menu, inline search, surface title, " +
    "status cluster, dock chip and reserved actions — the GizmoX shell bar as an asset.",
  height: 40,
  background: "panel2",
  items: [
    // 324×100 lockup at width 104 renders 32px tall inside the 40px bar.
    { kind: "brand", id: "brand", glyph: "lockup-horizontal", width: 104, command: "nav.home" },
    { kind: "menu", id: "modules", glyph: "icon-grid", label: "Modules", command: "modules.open" },
    {
      kind: "field",
      id: "search",
      glyph: "icon-search",
      placeholder: "Search everything…",
      hint: "⌃⇧G",
      width: 260,
      command: "search.open"
    },
    { kind: "slot", id: "context" },
    { kind: "spacer", id: "sp" },
    { kind: "status", id: "note", tone: "dim" },
    { kind: "status", id: "sync", tone: "dim" },
    { kind: "status", id: "clock", tone: "ink" },
    { kind: "slot", id: "dock" },
    // The Module Assistant (2026-08-13): every module ships with the floating
    // chat window, and this is its bar affordance — same command the universal
    // context-menu row fires.
    { kind: "action", id: "assistant", glyph: "icon-chat", title: "Module assistant", command: "assistant.toggle" },
    { kind: "slot", id: "account" },
    { kind: "action", id: "gear", glyph: "icon-gear", title: "Settings", command: "settings.open" }
  ]
});
