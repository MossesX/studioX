/**
 * @file The Task Manager's DECLARATION — data only, importable by plain Node.
 *
 * The closure resolver (scripts/lib/closure.mjs — the peel outward, the suite
 * inward) imports this under native type stripping, no JSX, to learn the
 * module's id, route and declared points. So the one hard rule: **nothing but
 * `import type`**. A runtime import — of React, a component, the core barrel —
 * breaks resolution for every module at once.
 *
 * Asset id `taskman`, settled by MASTER §5: GizmoX's `/tasks` and `/taskflow`
 * are the same module under two names (the route alias existed because the
 * registry asset was named `taskflow`), and adopting a third, clean id here is
 * what stops that split being inherited.
 *
 * `taskman.module.ts` composes this back into a real `Module` by adding the
 * component; the registry and the screen see no difference.
 */
import type { ModuleDecl } from "@axf/core";

export const TASKMAN_DECL: ModuleDecl = {
  id: "taskman",
  title: "Task Manager",
  summary:
    "Multi-list task, todo and note manager ported from GizmoX's taskflow: nested trees with " +
    "progress counts, and floating per-list windows. The dashboard's tasks card reads its store.",
  route: "/taskman",
  glyph: "icon-layers",
  /**
   * Context menus as decl data, the way `nav` rides a decl (core 0.0.14).
   *
   * The GizmoX original leaned on context menus for most of its operations and
   * the first port dropped them entirely — correctly at the time, because
   * AmberX had no menu contract and anything written would have been written
   * against a spec being replaced. That contract now exists, so the rows come
   * back HERE, as data, instead of as the forty hand-written `useCtx` calls
   * whose inconsistent coverage was the failure the area walk was built to end.
   *
   * Three areas, nested by the DOM rather than by configuration: an item row
   * sits inside the surface, so right-clicking one composes the item rows and
   * the surface rows together, and right-clicking empty space composes only
   * the surface's. The screen marks the ids with `data-axf-area`, plus
   * `data-axf-item` / `data-axf-list` for the handlers to read back out of
   * `MenuContext.data` (see `taskman.commands.ts`).
   */
  menus: {
    areas: [
      {
        id: "taskman.item",
        title: "Task item",
        description: "A row in the tree or the grid — the item the pointer is over."
      },
      {
        id: "taskman.list",
        title: "Task list",
        description: "A list: its rail row, its tree header, or its grid parent row."
      },
      {
        id: "taskman.group",
        title: "Rail group",
        description:
          "A collapsible band in the lists rail — Build Manager, Modules, ToDo, Project Notes, " +
          "or one you added."
      },
      {
        id: "taskman.surface",
        title: "Task Manager surface",
        description: "Anywhere on the screen, including empty space below the rows."
      }
    ],
    items: {
      "taskman.item": [
        { id: "add-child", label: "Add sub-item", command: "taskman.item.add-child", order: 10 },
        { id: "toggle-done", label: "Toggle done", command: "taskman.item.toggle-done", order: 20 },
        { id: "duplicate", label: "Duplicate", command: "taskman.item.duplicate", order: 30 },
        { id: "sep", label: "", role: "separator", order: 40 },
        { id: "delete", label: "Delete item", command: "taskman.item.delete", role: "danger", order: 50 }
      ],
      "taskman.list": [
        { id: "new-item", label: "New item in list", command: "taskman.list.new-item", order: 10 },
        { id: "float", label: "Open in floating window", command: "taskman.list.float", order: 20 },
        // Rename is the only way to name a list at all — the rail creates them
        // as "List 3" and no other surface edits a list's name. See the
        // command's docblock; this closes a hole rather than adding a feature.
        { id: "rename", label: "Rename list…", command: "taskman.list.rename", order: 25 },
        { id: "pin", label: "Pin / unpin list", command: "taskman.list.pin", order: 30 },
        { id: "sep", label: "", role: "separator", order: 40 },
        /**
         * Takes the whole ctrl-click selection when the clicked row is part of
         * one, and the row alone otherwise — the count is in the confirm, not
         * in this label, because a menu row's label is static data and a label
         * naming a stale count is worse than one naming none. See
         * `listsToDelete` and `deleteFlow.ts`.
         */
        { id: "delete", label: "Delete list", command: "taskman.list.delete", role: "danger", order: 50 }
      ],
      /**
       * The rail's group headers (2026-08-14). *Delete group* is NOT marked
       * destructive on purpose: it removes the band and moves its lists to the
       * root, destroying nothing — see the command.
       */
      "taskman.group": [
        { id: "new-list", label: "New list in this group", command: "taskman.group.new-list", order: 10 },
        { id: "toggle", label: "Collapse / expand group", command: "taskman.group.toggle", order: 20 },
        {
          id: "rename",
          label: "Rename group…",
          command: "taskman.group.rename",
          enabledWhen: "taskman.group.editable",
          order: 30
        },
        { id: "sep", label: "", role: "separator", order: 40 },
        {
          id: "delete",
          label: "Delete group",
          command: "taskman.group.delete",
          enabledWhen: "taskman.group.editable",
          order: 50
        }
      ],
      "taskman.surface": [
        { id: "new-list", label: "New list", command: "taskman.new-list", order: 10 },
        { id: "add-group", label: "Add group…", command: "taskman.group.add", order: 15 },
        { id: "refresh", label: "Refresh lists", command: "taskman.lists.refresh", order: 20 },
        // The way back from any delete on this screen. It sits above the
        // separator with the other non-destructive rows: reading the archive is
        // the opposite of a destructive act, and burying it under the delete
        // band is how a recovery path goes unnoticed.
        { id: "archive", label: "Archived lists…", command: "taskman.archive.open", order: 30 },
        { id: "sep", label: "", role: "separator", order: 80 },
        /**
         * The checkmark, and it sits ABOVE the delete because it changes what
         * the delete means. Owner, 2026-08-13: *"with check mark confirming the
         * deletion of bmpx project lists if selected"*. Ticked, Delete-all
         * takes the Build Manager's lists too and stops it re-adding them;
         * unticked, those lists are left alone — see `taskman.delete-all`.
         */
        {
          id: "include-managed",
          label: "…including the build project lists",
          role: "toggle",
          command: "taskman.delete-all.toggle-managed",
          checkedWhen: "taskman.delete-all.managedArmed",
          order: 90
        },
        {
          id: "delete-all",
          label: "Delete all lists",
          command: "taskman.delete-all",
          enabledWhen: "taskman.hasLists",
          role: "danger",
          order: 100
        }
      ]
    }
  },
  /**
   * Settings as decl data (core 0.0.20). These four rows and their reasons
   * moved here VERBATIM from `settings.ts`, which now adapts the module's
   * typed API over the core store. The minimal-sui ceiling stands — see each
   * hint, and `settings.ts`'s docblock for what was considered and refused.
   */
  settings: {
    ns: "taskman-settings",
    rows: [
      {
        key: "dense",
        label: "Dense rows",
        hint: "Tighter row height in the tree. Floating windows are always dense.",
        kind: "switch",
        defaultValue: false
      },
      {
        key: "crossOutDone",
        label: "Cross out completed items",
        hint: "Draw a coloured line through a done item's title.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "confirmDelete",
        label: "Confirm destructive deletes",
        hint: "Ask before deleting an item with sub-items, or a list with contents.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "autoBuildLists",
        label: "Auto-add build project lists",
        hint:
          "The Build Manager keeps a list per .bmpx project, refreshed every few seconds. Deleting " +
          "all lists with build projects included switches this off — this is the way back.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "autoModuleLists",
        label: "Auto-add module lists",
        hint:
          "Keep an empty list per installed module under the rail's Modules group. Deleting all " +
          "lists with the system's included switches this off — this is the way back.",
        kind: "switch",
        defaultValue: true
      }
    ]
  },
  points: [
    {
      id: "taskman.item-action",
      title: "Item action",
      description:
        "An action offered on the selected task item. Payload: `label` (button text) and " +
        "`command` (a core command-registry name fired on click).",
      kind: "command",
      cardinality: "many",
      requires: ["label", "command"],
      ordering: "priority"
    }
  ]
};
