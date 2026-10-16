/**
 * @file The Task Manager's LISTS bar — a `pane-toolbar` asset that sits under
 * the rail's "Lists" header.
 *
 * Owner, 2026-08-13: *"build a toolbar asset to go under the lists columns
 * header with 1 icon refresh, delete all, new list"*.
 *
 * Three things about it are deliberate:
 *
 *   1. **It is an ASSET, not three IconButtons in the screen.** That is the
 *      whole point of the toolbar kind (`core/toolbar/types.ts`: three UIs had
 *      each hand-rolled their own bar). Being data means it can be edited in
 *      the designer's Toolbar tab, swapped, and — since 2026-08-13 — placed by
 *      writing its id into the markup.
 *   2. **Its icons are the branding pack's.** Standing owner rule, same day:
 *      *"whenever you use icons or i say use or add icon use 1 from the
 *      branding pack"*. `icon-reload` was already in the template;
 *      `icon-trash` and `icon-plus` were added to it — and drawn in
 *      `packs/glyph-kit.ts` — in the edit that created this file, because a
 *      surface may name contract ids only. Nothing here paints a character or
 *      an emoji.
 *   3. **It carries no brand**, which `defineToolbar` enforces for every role
 *      but `banner`: the brand belongs to the app banner, and repeating it
 *      inside a pane is how an app ends up with three logos on one screen.
 *
 * The commands are the Task Manager's own, registered by
 * `taskman.commands.ts` — the bar names them and knows nothing else about
 * them, which is why deleting all lists can grow a confirm dialog and a
 * checkmark without this file changing.
 */
import { defineToolbar } from "@axf/core";

/** The surface id, exported so the screen and the bar cannot disagree on it. */
export const TASKMAN_LISTS_SURFACE = "taskman.lists";

export const TASKMAN_LISTS_BAR = defineToolbar({
  id: "taskman-lists-bar",
  title: "Task Manager lists bar",
  role: "pane-toolbar",
  surface: TASKMAN_LISTS_SURFACE,
  description: "Refresh, delete all, new list — the lists rail's three actions.",
  // Shorter than a banner: it is a strip under a column header, not chrome.
  height: 28,
  background: "panel",
  items: [
    {
      kind: "action",
      id: "refresh",
      glyph: "icon-reload",
      title: "Re-read the lists and the build projects on disk",
      command: "taskman.lists.refresh"
    },
    {
      kind: "action",
      id: "delete-all",
      glyph: "icon-trash",
      title: "Delete all lists — asks first, and says exactly what goes",
      command: "taskman.delete-all"
    },
    {
      kind: "action",
      id: "new-list",
      glyph: "icon-plus",
      title: "New list",
      command: "taskman.new-list"
    }
  ]
});
