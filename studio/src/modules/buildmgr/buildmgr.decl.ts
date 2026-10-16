/**
 * @file The Build Manager's DECLARATION — data only, importable by plain Node.
 *
 * The closure resolver (`scripts/lib/closure.mjs`) imports this under native
 * type stripping, no JSX, so the one hard rule is **nothing but `import type`**.
 * A runtime import breaks resolution for every module at once.
 *
 * ── why this file exists at all (2026-08-11) ─────────────────────────────────
 *
 * The Build Manager was already BUILT — 61KB of MUI, driving real runs through
 * `bmpx_builder.py`. What it was not was REGISTERED. It lived at
 * `src/plugins/build-manager/BuildManagerPreview.tsx` and `app/buildmgr/page.tsx`
 * imported it directly, which put it in a category of its own: not a module, not
 * a registered plugin, invisible to every registry in the framework.
 *
 * That is precisely the arrangement `/` and `/demo` avoid on purpose — their
 * route docblocks say the route never imports the screen, "which is what proves
 * the registry is doing real work rather than decorating a direct import". The
 * app's most consequential surface was the one exception.
 *
 * The consequences were concrete, not theoretical: `npm run peel` could not
 * compute its closure, the Core Inspector could not count it, and
 * `ModuleDecl.menus` had nothing to attach to. Promoting it costs this file plus
 * three lines elsewhere and removes all three.
 *
 * Renamed from "Preview" in the same move. It span up a real builder against
 * real project files for weeks; the name was left over from when it mocked one.
 */
import type { ModuleDecl } from "@axf/core";

export const BUILDMGR_DECL: ModuleDecl = {
  id: "buildmgr",
  title: "Build Manager",
  summary:
    "Runs `.bmpx` build projects through the real builder: the plan outline, per-step models and " +
    "costs, the model switches, and a live run driven by the NDJSON event stream.",
  route: "/buildmgr",
  glyph: "icon-play",
  /**
   * Context menus as decl data (core 0.0.14). The long-standing "no menus yet"
   * note held that rows and `data-axf-area` markers must land TOGETHER —
   * `test/ctx-conformance.test.ts` scans both directions — and 2026-08-13 is
   * the step that lands both: the plan outline marks every step row
   * `buildmgr.step` (plus `data-axf-file`/`phase`/`step`/`model`/`done` for
   * the handler to read back out of `MenuContext.data`), and this block
   * declares the row that opens the Assign-model popup on it. Behaviour lives
   * in `buildmgr.commands.ts`; the popup in `AssignModelPopup.tsx`.
   */
  menus: {
    areas: [
      {
        id: "buildmgr.step",
        title: "Plan step",
        description:
          "A step row in the plan outline — the prompt one agent will run, with its model and cost."
      }
    ],
    items: {
      "buildmgr.step": [
        {
          id: "assign-model",
          label: "Assign model…",
          command: "buildmgr.step.assign-model",
          enabledWhen: "buildmgr.step.editable",
          order: 10
        }
      ]
    }
  },
  /**
   * Settings as decl data (core 0.0.20). One row, and it passes the ceiling's
   * test: the live-run poll hits `/api/bmpx/run` on an interval, and the right
   * rate depends on the machine and the run — 1.2s reads a long fable run
   * live, but on a laptop on battery it is a fetch every blink for an hour.
   * There is no value right for both, so it is a setting.
   */
  settings: {
    ns: "buildmgr-settings",
    rows: [
      {
        key: "pollMs",
        label: "Live-run poll interval (ms)",
        hint: "How often a live run's event stream is fetched. Lower is more live; higher is kinder to the machine.",
        kind: "number",
        defaultValue: 1200,
        min: 500,
        max: 10000,
        step: 100
      }
    ]
  },
  points: []
};
