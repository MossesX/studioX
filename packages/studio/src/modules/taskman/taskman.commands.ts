/**
 * @file The behaviour behind the Task Manager's context-menu rows.
 *
 * The menu itself is DATA on `taskman.decl.ts`; this is where the acting half
 * lives, and the two meet only through a command name. That indirection is the
 * whole point of the core's design: the same row can later be reordered, or
 * bound to a hotkey, or edited by a menu manager, without any of this moving.
 *
 * ## How a command knows WHICH item was right-clicked
 *
 * A `CommandHandler` takes no arguments, on purpose (see `core/commands.ts`) —
 * a handler that took the click event would be a handler only a menu could
 * call. The engine parks the resolved click in `activeContext()` instead, and
 * `MenuContext.data` carries every `data-axf-*` attribute harvested up the
 * area chain, innermost winning. So the surfaces mark
 * `data-axf-item="<id>"` / `data-axf-list="<id>"` on their rows, and these
 * handlers read `ctx.data.item` / `ctx.data.list`.
 *
 * That is why these can be plain functions over the store rather than
 * React callbacks: the store is a module-scope singleton with more than one
 * reader already (the screen, every floating window, the dashboard card), so a
 * command mutating it lands everywhere at once with nothing wired through
 * props.
 *
 * ## Registration is idempotent
 *
 * `CommandRegistry.register` throws on a duplicate name — correct for a real
 * conflict, fatal under a dev-server remount, which would otherwise take down
 * the shell the second time this module evaluated. So the whole set is taken
 * once and the flag guards re-entry, exactly as core's own
 * `registerCtxCommands` does.
 *
 * Must run BEFORE `registerModuleMenus(TASKMAN_MODULE)`: the map's gate
 * refuses an item naming an unregistered command, which is what makes a typo
 * here a loud boot failure rather than a dead row.
 */
import { activeContext, commands, predicates } from "@axf/core";

import { openArchiveDialog } from "./archiveBridge";
import { deleteListsWithConfirm } from "./deleteFlow";
import { groupIdOf, newGroup, sortedGroups } from "./groups";
import { uid } from "./id";
import { isManagedList, managedLabels } from "./managed";
import { getTaskmanSettings, taskmanSettings } from "./settings";
import { taskStore, TASKMAN_REFRESH_EVENT } from "./store";
import {
  cloneItem,
  findItem,
  insertItem,
  newItem,
  newList,
  removeItem,
  updateItem
} from "./taskOps";
import type { TaskItem, WindowState } from "./types";

/** The click's harvested data — `{}` when a command is fired from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

/** The right-clicked item's id, or null when the click carried no item. */
function targetItemId(): string | null {
  return ctxData().item ?? null;
}

/**
 * The list the click belongs to. An item row marks its own list, so this
 * answers for both areas; falling back to the first list would act on the
 * wrong one, so a click with no list does nothing instead.
 */
function targetListId(): string | null {
  return ctxData().list ?? null;
}

/** The rail group the click belongs to — marked by the group header rows. */
function targetGroupId(): string | null {
  return ctxData().group ?? null;
}

/**
 * The lists a list-scoped delete should take.
 *
 * The ctrl-click selection when the right-clicked row is PART of it, and just
 * that row otherwise. Right-clicking outside a selection to delete the row you
 * pointed at is the behaviour every file manager has, and the alternative —
 * always taking the selection — deletes five lists because one of them happened
 * to still be highlighted from a minute ago.
 */
function listsToDelete(listId: string): string[] {
  const selected = taskStore.getState().selectedListIds;
  return selected.length > 1 && selected.includes(listId) ? [...selected] : [listId];
}

function patchItem(id: string, patch: Partial<TaskItem>): void {
  taskStore.setLists((ls) => updateItem(ls, id, (it) => ({ ...it, ...patch })));
}

/**
 * The destructive-delete guard, in ONE place.
 *
 * Two commands ask it and both used to call `window.confirm` inline and
 * unconditionally, which is why the `confirmDelete` setting had nowhere to
 * land. Routed through here, switching the setting off really does remove the
 * prompt from both — and a third delete added later cannot forget to ask.
 *
 * Returns true when the caller may proceed.
 */
function mayDestroy(question: string): boolean {
  if (!getTaskmanSettings().confirmDelete) return true;
  return window.confirm(question);
}

/**
 * What to CALL the system's lists in a dialog, when there may be more than one
 * kind of them.
 *
 * `managedLabels()[0]` was correct while `bmpx` was the only engine and became
 * a half-truth the day `modules` registered a second: a confirm that says "the
 * build project lists" while it is about to take the module lists as well is
 * describing less than it does.
 */
function describeManaged(): string {
  const labels = managedLabels();
  if (!labels.length) return "system";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * Whether Delete-all is armed to take the SYSTEM's lists as well as yours —
 * the checkmark row's state. Module scope, in memory, never persisted: see the
 * toggle command for why an armed destructive switch must not outlive the tab.
 */
let includeManaged = false;

let registered = false;

/** Register every Task Manager command. Idempotent — see the file docblock. */
export function registerTaskmanCommands(): void {
  if (registered) return;
  registered = true;

  /* ------------------------------- item rows ------------------------------ */

  commands.register({
    id: "taskman.item.add-child",
    title: "Add sub-item",
    run: () => {
      const parentId = targetItemId();
      const listId = targetListId();
      if (!parentId || !listId) return;
      taskStore.setLists((ls) => {
        const found = findItem(ls, parentId);
        // The child inherits the parent's colour, which is what the tree's own
        // "+" button does — a menu row that produced a differently-coloured
        // child would look like a different operation.
        const child = newItem(found ? { color: found.item.color } : {});
        // Expanding is the parent's own state, so a child added to a collapsed
        // parent is visible immediately rather than silently filed away.
        return updateItem(insertItem(ls, child, { listId, parentId, index: -1 }), parentId, (it) => ({
          ...it,
          collapsed: false
        }));
      });
    }
  });

  commands.register({
    id: "taskman.item.toggle-done",
    title: "Toggle done",
    run: () => {
      const id = targetItemId();
      if (id) taskStore.setLists((ls) => updateItem(ls, id, (it) => ({ ...it, done: !it.done })));
    }
  });

  commands.register({
    id: "taskman.item.duplicate",
    title: "Duplicate item",
    run: () => {
      const id = targetItemId();
      if (!id) return;
      taskStore.setLists((ls) => {
        const found = findItem(ls, id);
        if (!found) return ls;
        const parentId = found.parents.length ? found.parents[found.parents.length - 1] : null;
        return insertItem(ls, cloneItem(found.item), { listId: found.listId, parentId, index: -1 });
      });
    }
  });

  commands.register({
    id: "taskman.item.delete",
    title: "Delete item",
    run: () => {
      const id = targetItemId();
      if (!id) return;
      taskStore.setLists((ls) => {
        const found = findItem(ls, id);
        const kids = found?.item.children.length ?? 0;
        if (kids > 0 && !mayDestroy(`Delete "${found?.item.title ?? "item"}" and ${kids} sub-item(s)?`)) {
          return ls;
        }
        return removeItem(ls, id).lists;
      });
    }
  });

  /* ------------------------------- list rows ------------------------------ */

  commands.register({
    id: "taskman.list.new-item",
    title: "New item in list",
    run: () => {
      const listId = targetListId();
      if (listId) taskStore.setLists((ls) => insertItem(ls, newItem(), { listId, parentId: null, index: -1 }));
    }
  });

  commands.register({
    id: "taskman.list.float",
    title: "Open list in a floating window",
    run: () => {
      const listId = targetListId();
      if (!listId) return;
      const list = taskStore.getState().lists.find((l) => l.id === listId);
      taskStore.setWindows((ws) => {
        const existing = ws.find((w) => w.kind === "task-list" && w.payload.listId === listId);
        const maxZ = ws.reduce((m, w) => Math.max(m, w.z), 10);
        if (existing) {
          return ws.map((w) => (w.id === existing.id ? { ...w, minimized: false, z: maxZ + 1 } : w));
        }
        const win: WindowState = {
          id: uid("win"),
          kind: "task-list",
          title: list?.name ?? "List",
          payload: { listId },
          x: 120 + ws.length * 32,
          y: 90 + ws.length * 28,
          w: 560,
          h: 420,
          z: maxZ + 1,
          minimized: false
        };
        return [...ws, win];
      });
    }
  });

  /**
   * Rename a list.
   *
   * Added 2026-08-11, and it closes a real hole rather than adding a feature:
   * a list could be CREATED (rail button, `taskman.new-list`) and never named.
   * It arrived as "List 3" and stayed "List 3" forever — the rail has no
   * rename, the tree header has no rename, and the detail pane edits items, not
   * lists. GizmoX's own list menu carries `tasks.list-rename` for exactly this
   * reason; the first port dropped it along with the menus and nothing replaced
   * it.
   *
   * `window.prompt` matches what the GizmoX original does and what
   * `taskman.item.delete` already does with `confirm` — this module talks to the
   * browser's own dialogs rather than owning a modal, and a rename is not worth
   * being the exception.
   */
  commands.register({
    id: "taskman.list.rename",
    title: "Rename list",
    run: () => {
      const listId = targetListId();
      if (!listId) return;
      const list = taskStore.getState().lists.find((l) => l.id === listId);
      if (!list) return;
      const name = window.prompt("List name", list.name);
      // null = cancelled, blank = not a name. Neither may blank the list out.
      if (!name?.trim()) return;
      const next = name.trim();
      taskStore.setLists((ls) => ls.map((l) => (l.id === listId ? { ...l, name: next } : l)));
      // A floating window titled with the old name would keep showing it: the
      // title is copied into `WindowState` at open time, not read live.
      taskStore.setWindows((ws) =>
        ws.map((w) => (w.kind === "task-list" && w.payload.listId === listId ? { ...w, title: next } : w))
      );
    }
  });

  commands.register({
    id: "taskman.list.pin",
    title: "Pin / unpin list",
    run: () => {
      const listId = targetListId();
      if (!listId) return;
      taskStore.setLists((ls) => ls.map((l) => (l.id === listId ? { ...l, pinned: !l.pinned } : l)));
    }
  });

  /**
   * Delete list — which since 2026-08-14 means **archive** it, and means the
   * whole ctrl-click selection when the clicked row is in one.
   *
   * Owner, same day: *"allow multiple list selections by holding control and
   * delete lists will delete x number of lists after confirmation. any and all
   * deleted lists are not deleted they are stored in archive."* Both halves are
   * `deleteListsWithConfirm`'s — the count in the prompt and the archive write
   * before anything leaves the rail — so this row is only the question of WHICH
   * lists.
   */
  commands.register({
    id: "taskman.list.delete",
    title: "Delete list",
    run: () => {
      const listId = targetListId();
      if (!listId) return;
      void deleteListsWithConfirm(listsToDelete(listId), { reason: "list" });
    }
  });

  /* -------------------------------- surface ------------------------------- */

  commands.register({
    id: "taskman.new-list",
    title: "New list",
    run: () => {
      taskStore.setLists((ls) => [...ls, newList({ name: `List ${ls.length + 1}` })]);
    }
  });

  /**
   * Re-read everything: the persisted document, and the build projects on disk.
   *
   * The lists bar's first action. Both halves are needed and neither is
   * sufficient — the store is the browser's copy (a second tab may have moved
   * it) and the `.bmpx` files are the disk's, polled on a 15s idle cadence that
   * is deliberately slow. "Refresh" that only did one of the two would be right
   * about half the screen.
   */
  commands.register({
    id: "taskman.lists.refresh",
    title: "Refresh lists",
    run: () => {
      taskStore.reload();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(TASKMAN_REFRESH_EVENT));
      }
    }
  });

  /**
   * The checkmark on the Delete-all row.
   *
   * Deliberately NOT persisted. It arms the most destructive operation this
   * module has, and an armed switch that survives a reload is a loaded gun in a
   * drawer: the next person to open the menu would see a ticked row they did
   * not tick. It resets with the tab, which is the correct lifetime for
   * "including the build lists, this time".
   */
  commands.register({
    id: "taskman.delete-all.toggle-managed",
    title: "Also delete the build project lists",
    run: () => {
      includeManaged = !includeManaged;
    }
  });

  /**
   * Delete every list.
   *
   * Owner, 2026-08-13: *"add delete all list to context menu … with check mark
   * confirming the deletion of bmpx project lists if selected. if confirmed
   * delete permanently and dont allow it to be auto added again by the
   * system."*
   *
   * Three decisions worth stating, because each is the difference between this
   * working and this looking broken:
   *
   *   1. **It always asks**, whatever `confirmDelete` says. That setting is
   *      about one item with children or one non-empty list; this is every list
   *      you have, and there is no undo anywhere in this module. A destructive
   *      operation whose blast radius is "all of it" is not the place to honour
   *      a preference for fewer prompts.
   *   2. **Unchecked, the system's lists are SPARED.** Deleting them without
   *      switching the engine off would have the poll loop re-mint them within
   *      three seconds, which reads as "delete all did nothing" — the exact
   *      complaint that produced this feature.
   *   3. **Checked, they go and the engine is switched off** (`autoBuildLists`,
   *      persisted), which is what "permanently, and don't allow it to be auto
   *      added again" means in code. The Task Manager's settings pane carries
   *      the way back, and the confirm says so.
   */
  commands.register({
    id: "taskman.delete-all",
    title: "Delete all lists",
    run: () => {
      const lists = taskStore.getState().lists;
      if (!lists.length) return;
      const managed = lists.filter(isManagedList);
      const mine = lists.filter((l) => !isManagedList(l));
      // One engine used to be the only possibility, so `[0]` read as "the"
      // label. Two of them ship now (build projects, modules) and naming one of
      // the two in a dialog that takes both would be a message that is
      // half-true.
      const label = describeManaged();

      if (!includeManaged && managed.length && mine.length === 0) {
        // Nothing this run would delete. Saying so beats a confirm that
        // promises a deletion and then removes nothing.
        window.alert(
          `Every list here is a ${label} list. Tick "Also delete the ${label} lists" first — ` +
            `without it they are left alone, because the system would put them straight back.`
        );
        return;
      }

      const going = includeManaged ? lists : mine;
      const kept =
        !includeManaged && managed.length
          ? `\n\n${managed.length} ${label} list(s) are NOT included — tick the checkmark row for those.`
          : "";
      const permanent = includeManaged && managed.length
        ? `\n\nThe ${label} lists will also stop being added automatically. That is permanent ` +
          `until you switch them back on in the Task Manager settings.`
        : "";

      // `alwaysAsk` whatever `confirmDelete` says: that setting is about one
      // item with children or one non-empty list, and this is every list you
      // have. The reasoning has been in this docblock since 2026-08-13; it now
      // lives in `deleteFlow` so the four delete paths cannot disagree on it.
      const armed = includeManaged;
      // Disarmed BEFORE the await, not after: the confirm is asynchronous now,
      // and a second Delete-all opened while the first dialog is up must start
      // from the safe position.
      includeManaged = false;

      void deleteListsWithConfirm(
        going.map((l) => l.id),
        { reason: "delete-all", alwaysAsk: true, extra: `${kept}${permanent}` }
      ).then((result) => {
        // The kill switches flip only on a delete that actually happened —
        // switching the engines off after a cancelled or failed archive would
        // leave the lists on screen and the system unable to maintain them.
        if (!result.ok || !armed || !managed.length) return;
        taskmanSettings.set("autoBuildLists", false);
        taskmanSettings.set("autoModuleLists", false);
      });
    }
  });

  /* -------------------------------- groups -------------------------------- */

  /**
   * Add a rail group.
   *
   * Owner, 2026-08-14: *"add context menu entry to add group"*. `window.prompt`
   * for the name, matching `taskman.list.rename` — this module talks to the
   * browser's own dialogs rather than owning a modal, and a group name is not
   * worth being the exception.
   */
  commands.register({
    id: "taskman.group.add",
    title: "Add group",
    run: () => {
      const name = window.prompt("Group name", "New group");
      if (!name?.trim()) return;
      taskStore.setGroups((gs) => sortedGroups([...gs, newGroup(name, gs)]));
    }
  });

  commands.register({
    id: "taskman.group.new-list",
    title: "New list in this group",
    run: () => {
      const groupId = targetGroupId();
      if (!groupId) return;
      taskStore.setLists((ls) => [
        ...ls,
        { ...newList({ name: `List ${ls.length + 1}` }), groupId }
      ]);
    }
  });

  commands.register({
    id: "taskman.group.toggle",
    title: "Collapse / expand group",
    run: () => {
      const groupId = targetGroupId();
      if (!groupId) return;
      taskStore.setGroups((gs) =>
        gs.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g))
      );
    }
  });

  commands.register({
    id: "taskman.group.rename",
    title: "Rename group",
    run: () => {
      const groupId = targetGroupId();
      if (!groupId) return;
      const group = taskStore.getState().groups.find((g) => g.id === groupId);
      if (!group || group.managedBy) return;
      const name = window.prompt("Group name", group.name);
      if (!name?.trim()) return;
      const next = name.trim();
      taskStore.setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, name: next } : g)));
    }
  });

  /**
   * Delete a group — the BAND, not its lists.
   *
   * Its lists move to the root band, which is why this row is not marked
   * destructive and asks nothing: nothing is lost, and every one of those lists
   * still has its own Delete. A group delete that took the task trees with it
   * would be the one operation in this module whose blast radius the label did
   * not describe.
   */
  commands.register({
    id: "taskman.group.delete",
    title: "Delete group",
    run: () => {
      const groupId = targetGroupId();
      if (!groupId) return;
      const state = taskStore.getState();
      const group = state.groups.find((g) => g.id === groupId);
      if (!group || group.managedBy) return;
      taskStore.setLists((ls) => {
        let changed = false;
        const next = ls.map((l) => {
          if (groupIdOf(l) !== groupId) return l;
          changed = true;
          // Explicit `undefined`: leaving the field off would let the by-kind
          // fallback pull a `todo` list into the ToDo group it was never in.
          return { ...l, groupId: undefined };
        });
        return changed ? next : ls;
      });
      taskStore.setGroups((gs) => gs.filter((g) => g.id !== groupId));
    }
  });

  /* -------------------------------- archive ------------------------------- */

  commands.register({
    id: "taskman.archive.open",
    title: "Archived lists…",
    run: () => openArchiveDialog()
  });

  /* ------------------------------- predicates ------------------------------ */

  // The checkmark's state. A `toggle` row must name one — a tick with no state
  // source asserts a fact nothing computed (core/ctx/types.ts).
  if (!predicates.has("taskman.delete-all.managedArmed")) {
    predicates.register({
      id: "taskman.delete-all.managedArmed",
      title: "Delete-all is armed to take the system's lists too",
      // A verdict is `true` or the REASON it is not — there is no bare false in
      // this engine, deliberately (core/ctx/predicates.ts). For a `checkedWhen`
      // the string is never drawn; it is the honest answer to "why is this row
      // not ticked", which an inspector can ask.
      test: () =>
        includeManaged ? true : "Delete-all will leave the build project lists alone"
    });
  }

  // Availability, not presence: with no lists at all the row stays, greyed,
  // saying why — a row that vanishes on an empty screen teaches the reader the
  // menu is inconsistent.
  if (!predicates.has("taskman.hasLists")) {
    predicates.register({
      id: "taskman.hasLists",
      title: "There is at least one list",
      test: () => (taskStore.getState().lists.length ? true : "there are no lists to delete")
    });
  }

  /**
   * Is the right-clicked group the person's to edit?
   *
   * Build Manager and Modules are filled by engines on a tick, so renaming or
   * deleting one is an edit the next tick undoes. Greying the rows and SAYING
   * why is the honest version — a row that vanishes teaches the reader the menu
   * is inconsistent, and a row that works and then silently reverts is worse
   * than either.
   */
  if (!predicates.has("taskman.group.editable")) {
    predicates.register({
      id: "taskman.group.editable",
      title: "This rail group is not maintained by the system",
      test: () => {
        const groupId = targetGroupId();
        if (!groupId) return "no group was clicked";
        const group = taskStore.getState().groups.find((g) => g.id === groupId);
        if (!group) return "that group no longer exists";
        return group.managedBy
          ? `"${group.name}" is filled by the system, which would put it straight back`
          : true;
      }
    });
  }
}
