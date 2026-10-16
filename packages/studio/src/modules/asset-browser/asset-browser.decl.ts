/**
 * @file The Graphical Asset Browser's DECLARATION — data only, importable by
 * plain Node.
 *
 * The closure resolver (`scripts/lib/closure.mjs` — the peel outward, the suite
 * inward) and `test/ctx-conformance.test.ts` import this under native type
 * stripping, no JSX, to learn the module's id, route and declared areas. So the
 * one hard rule holds here as everywhere: **nothing but `import type`**.
 *
 * ## What this module is
 *
 * Slot 12 of 12 — the LAST one (`src/suite.manifest.ts` carries the §4.6 case).
 * It is one screen over every UI-related graphical asset in the studio: logo
 * kits and landings out of `assets/registry.json`, branding and logo packs out
 * of core's in-memory `PackRegistry`, and the toolbars, nav menus and dashboard
 * wrappers that live in the one `chrome-assets` kv document. P0's `kinds.ts`
 * is what says those are three DIFFERENT lifecycles, and the rail groups by it
 * rather than pretending they are one list.
 *
 * ## Menus are DATA, and the areas are the shape of the screen
 *
 * Three areas, one per region, so a right-click means something everywhere on
 * the surface rather than only on a card. `asset-browser.commands.ts` is the
 * acting half; the screens only mark `data-axf-area`.
 *
 * The rows deliberately stop at what a BROWSER can do — open, copy an id,
 * reveal a path, filter. Build / edit / rename / expand are P6–P10's, and each
 * lands with the engine that performs it, per the mutation contract in
 * `src/asset-browser/contract.ts`. A row wired to a `TODO` toast would be a
 * dead button, and the module contract forbids those outright.
 */
import type { ModuleDecl } from "@axf/core";

export const ASSET_BROWSER_DECL: ModuleDecl = {
  id: "asset-browser",
  title: "Asset Browser",
  summary:
    "Every UI-related graphical asset on one screen — logo kits, landings, branding and logo " +
    "packs, toolbars, nav menus and dashboard wrappers — with a live preview per kind and the " +
    "engine that authors each one named on its card.",
  route: "/asset-browser",
  /*
   * `icon-folder` is the contract's one storage drawing and nothing else in
   * either nav menu carries it, so the row is distinguishable at a glance.
   * `icon-palette` was the obvious alternative and is already spent twice (the
   * brand gallery and the logo-kit gallery this screen eventually supersedes).
   *
   * A name with no drawing renders NOTHING and still passes `check:glyphs`,
   * which only sees the literal — so this is a CONTRACT id
   * (`REQUIRED_GLYPH_IDS`), never an invented one. AdminFilesTab's `DIR_GLYPH`
   * comment is the account of how that hole was found.
   */
  glyph: "icon-folder",
  menus: {
    areas: [
      {
        id: "asset-browser.asset",
        title: "Graphical asset",
        description:
          "One asset card — a logo kit, a landing, a pack, a toolbar, a nav menu or a wrapper."
      },
      {
        id: "asset-browser.kind",
        title: "Asset kind",
        description: "One row of the left rail — a kind, with its lifecycle and its engine."
      },
      {
        id: "asset-browser.surface",
        title: "Asset Browser surface",
        description: "Anywhere on the screen, including the empty space beside the grid."
      }
    ],
    items: {
      "asset-browser.asset": [
        {
          id: "select",
          label: "Show in the detail pane",
          command: "asset-browser.asset.select",
          order: 10
        },
        {
          id: "copy-id",
          label: "Copy asset id",
          command: "asset-browser.asset.copy-id",
          order: 20
        },
        { id: "sep-1", label: "", role: "separator", order: 30 },
        {
          id: "copy-source",
          label: "Copy the source path",
          command: "asset-browser.asset.copy-source",
          order: 40
        },
        {
          id: "copy-engine",
          label: "Copy the generator command",
          command: "asset-browser.asset.copy-engine",
          order: 50
        },
        { id: "sep-2", label: "", role: "separator", order: 60 },
        /*
         * `enabledWhen` rather than `when`: the row stays THERE and greys with
         * its reason on a kind that has no other member, because a row that
         * appears and disappears teaches nobody the feature exists. Expenses'
         * `delete-selected` argues the same and cites `predicates.ts`.
         */
        {
          id: "filter-to-kind",
          label: "Show only this kind",
          command: "asset-browser.asset.filter-to-kind",
          enabledWhen: "asset-browser.mixed-view",
          order: 70
        }
      ],
      "asset-browser.kind": [
        { id: "focus", label: "Show only this kind", command: "asset-browser.kind.focus", order: 10 },
        { id: "all", label: "Show every kind", command: "asset-browser.kind.all", order: 20 },
        { id: "sep-1", label: "", role: "separator", order: 30 },
        {
          id: "copy-source",
          label: "Copy this kind's source path",
          command: "asset-browser.kind.copy-source",
          order: 40
        }
      ],
      "asset-browser.surface": [
        { id: "reload", label: "Re-read from disk", command: "asset-browser.reload", order: 10 },
        { id: "all", label: "Show every kind", command: "asset-browser.kind.all", order: 20 },
        { id: "sep-1", label: "", role: "separator", order: 30 },
        {
          id: "toggle-empty",
          label: "Show / hide kinds with no instances",
          command: "asset-browser.toggle-empty",
          order: 40
        }
      ]
    }
  },
  /*
   * MINIMAL, and the word is a ceiling rather than a target
   * (`.claude/rules/amberx-bound-builds.md`, owner 2026-08-11). Two rows, each
   * one the screen cannot work properly without.
   *
   * Considered and REFUSED, written down here because an undocumented refusal
   * gets re-proposed by the next session:
   *
   *   · card size / grid density — the grid is `repeat(auto-fill, minmax(…))`
   *     and already reflows to the pane; a knob would be a second answer to a
   *     question CSS has already answered;
   *   · default kind on open — `showEmptyKinds` plus the rail is one click, and
   *     a remembered filter is how a person opens a manager and concludes an
   *     asset has vanished;
   *   · preview animation on/off — the point of drawing a logo through the real
   *     `LogoKitLogo` is that a still cannot show a motion. Off, the preview
   *     stops being evidence;
   *   · sort order — one order (kind, then id) that everything shares beats a
   *     preference two people describe differently;
   *   · pane sizes — `PaneLayout` already persists those, per pane, for free;
   *   · "confirm before mutating" — there is nothing to confirm yet, and a
   *     switch guarding a verb that does not exist is a promise, not a setting.
   */
  settings: {
    ns: "asset-browser-settings",
    rows: [
      {
        key: "showEmptyKinds",
        label: "Show kinds with no instances",
        hint:
          "Keep a kind in the rail when nothing of it is installed. Off, the rail lists only what " +
          "exists; on, it also shows what COULD exist — which is the difference between " +
          "\"there are no logo packs\" and \"logo packs are not a thing here\".",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "showRawJson",
        label: "Show the raw asset in the detail pane",
        hint:
          "Append the underlying manifest or asset object to the detail pane. It is the only " +
          "place a field the browser does not yet model is visible at all.",
        kind: "switch",
        defaultValue: false
      }
    ]
  },
  /*
   * No extension points. A point is declared when a real plugin needs one —
   * "module drives the core" — and the per-kind previews (P5) are the module's
   * own renderers, not contributions. If a kind ever arrives from outside the
   * suite, `asset-browser.preview` is the point to declare, and P0's kind map
   * is what it would carry.
   */
  points: []
};
