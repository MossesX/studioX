/**
 * @file The project-state bar — a `pane-toolbar` asset carrying EXACTLY ONE
 * item: the button that regenerates PROJECT-STATE.md/.json at the AmberX root.
 *
 * One item is the owner's spec, not a starting point ("a toolbar asset and 1
 * item in toolbar that read all current and archived sessions … to create a
 * new project state file"). Everything else the surface shows — the last
 * generated stamp, the resume-prompt preview, the run's result — is the
 * SCREEN's content, not bar chrome, so it stays off the bar.
 *
 * The same three deliberate properties as `taskman-lists-bar.ts`, the bar this
 * one mirrors:
 *
 *   1. **It is an ASSET, not an IconButton in the screen** — data, registered,
 *      editable in the designer's Toolbar tab, placeable by id.
 *   2. **Its glyph is the branding pack's.** `icon-sync` ("keep two things in
 *      step") is in core's REQUIRED_GLYPHS contract, so every complete pack
 *      draws it — nothing here names a drawing only one pack has.
 *   3. **It carries no brand**, which `defineToolbar` enforces for every role
 *      but `banner`.
 *
 * The command is registered by `project-state.commands.ts`; the bar names it
 * and knows nothing else about it — which is why the run can grow a progress
 * readout and an error surface without this file changing.
 */
import { defineToolbar } from "@axf/core";

/** The surface id, exported so the screen and the bar cannot disagree on it.
 *  Not in `SURFACE_ROLES`, so it accepts any role — the role stated here is a
 *  compatibility claim for pickers, not a constraint the registry enforces. */
export const PROJECT_STATE_SURFACE = "project-state.bar";

export const PROJECT_STATE_BAR = defineToolbar({
  id: "project-state-bar",
  title: "Project state bar",
  role: "pane-toolbar",
  surface: PROJECT_STATE_SURFACE,
  description: "One action: digest every AmberX session and regenerate the project state files.",
  // A strip above the preview pane, not chrome — same height as the lists bar.
  height: 28,
  background: "panel",
  items: [
    {
      kind: "action",
      id: "generate",
      glyph: "icon-sync",
      label: "Generate project state",
      title:
        "Read every current and archived session that touched AmberX and regenerate " +
        "PROJECT-STATE.md + PROJECT-STATE.json at the AmberX root",
      command: "project-state.generate"
    }
  ]
});
