/**
 * @file Shared controller for every task surface (module screen, floating
 * windows): store-backed operations over the pure ops in `taskOps`.
 *
 * Ported from GizmoX's `useTaskController`, trimmed to the chrome cull
 * (MASTER §2/§5): no context-menu builders, no settings source, no
 * foreign-module drop payloads. What survives is everything the tree and the
 * windows actually invoke.
 */
"use client";

import * as React from "react";

import { deleteListsWithConfirm } from "./deleteFlow";
import { groupIdOf, sortedGroups } from "./groups";
import { uid } from "./id";
import { taskStore, useTaskState } from "./store";
import {
  cloneItem,
  findItem,
  insertItem,
  moveItem,
  newItem,
  newList,
  removeItem,
  updateItem,
  type DropTarget
} from "./taskOps";
import type { TaskGroup, TaskItem, TaskList, WindowState } from "./types";

export function useTaskController() {
  const { lists, groups, windows, selectedListIds } = useTaskState();

  const patch = React.useCallback(
    (id: string, p: Partial<TaskItem>) =>
      taskStore.setLists((ls) => updateItem(ls, id, (it) => ({ ...it, ...p }))),
    []
  );

  const toggleDone = React.useCallback(
    (id: string) => taskStore.setLists((ls) => updateItem(ls, id, (it) => ({ ...it, done: !it.done }))),
    []
  );

  const toggleCollapse = React.useCallback(
    (id: string) =>
      taskStore.setLists((ls) => updateItem(ls, id, (it) => ({ ...it, collapsed: !it.collapsed }))),
    []
  );

  const rename = React.useCallback(
    (id: string, title: string) => {
      const t = title.trim();
      if (t) patch(id, { title: t });
    },
    [patch]
  );

  const remove = React.useCallback((id: string) => {
    taskStore.setLists((ls) => {
      const found = findItem(ls, id);
      const kids = found?.item.children.length ?? 0;
      if (kids > 0) {
        const label = found?.item.title ?? "item";
        if (!window.confirm(`Delete "${label}" and ${kids} sub-item(s)?`)) return ls;
      }
      return removeItem(ls, id).lists;
    });
  }, []);

  const duplicate = React.useCallback((id: string) => {
    taskStore.setLists((ls) => {
      const found = findItem(ls, id);
      if (!found) return ls;
      const parentId = found.parents.length ? found.parents[found.parents.length - 1] : null;
      return insertItem(ls, cloneItem(found.item), { listId: found.listId, parentId, index: -1 });
    });
  }, []);

  const addItem = React.useCallback((target: DropTarget, partial: Partial<TaskItem> = {}) => {
    const item = newItem(partial);
    taskStore.setLists((ls) => insertItem(ls, item, target));
    return item.id;
  }, []);

  const move = React.useCallback((itemId: string, target: DropTarget) => {
    taskStore.setLists((ls) => moveItem(ls, itemId, target));
  }, []);

  const addList = React.useCallback((partial: Partial<TaskList> = {}) => {
    const l = newList(partial);
    taskStore.setLists((ls) => [...ls, l]);
    return l.id;
  }, []);

  const patchList = React.useCallback(
    (id: string, p: Partial<TaskList>) =>
      taskStore.setLists((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l))),
    []
  );

  /**
   * Delete a list — which since 2026-08-14 means ARCHIVE it.
   *
   * Selection-aware: the rail's × on a row that is part of a ctrl-click
   * selection takes the whole selection, because a button that deletes one row
   * out of five highlighted ones is a button that ignored the highlight. A row
   * outside the selection takes only itself, which is what makes "× the one I
   * pointed at" still work while something else is selected.
   *
   * Returns the promise so a caller can wait; nothing on screen has to.
   */
  const removeList = React.useCallback(
    (id: string) => {
      const selected = taskStore.getState().selectedListIds;
      const targets = selected.length > 1 && selected.includes(id) ? selected : [id];
      return deleteListsWithConfirm(targets, { reason: "list" });
    },
    []
  );

  /* ---------------------------------- groups --------------------------------- */

  const addGroup = React.useCallback((group: TaskGroup) => {
    taskStore.setGroups((gs) => sortedGroups([...gs, group]));
    return group.id;
  }, []);

  const patchGroup = React.useCallback(
    (id: string, p: Partial<TaskGroup>) =>
      taskStore.setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...p } : g))),
    []
  );

  const toggleGroupCollapse = React.useCallback((id: string) => {
    taskStore.setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)));
  }, []);

  /**
   * Remove a group. Its lists are RE-HOMED to the root band, never deleted —
   * deleting a group is a rail decision, and a rail decision that destroyed
   * task trees would be the worst kind of surprise. Deleting the lists too is
   * available as its own operation on each of them.
   */
  const removeGroup = React.useCallback((id: string) => {
    taskStore.setLists((ls) => {
      let changed = false;
      const next = ls.map((l) => {
        if (groupIdOf(l) !== id) return l;
        changed = true;
        // Explicit `undefined` rather than a delete: the by-kind fallback would
        // otherwise pull a `todo` list straight back into a group it was just
        // taken out of.
        return { ...l, groupId: undefined };
      });
      return changed ? next : ls;
    });
    taskStore.setGroups((gs) => gs.filter((g) => g.id !== id));
  }, []);

  /** Move a list into a group, or out to the root band with `null`. */
  const setListGroup = React.useCallback((listId: string, groupId: string | null) => {
    taskStore.setLists((ls) =>
      ls.map((l) => (l.id === listId ? { ...l, groupId: groupId ?? undefined } : l))
    );
  }, []);

  /* --------------------------------- selection ------------------------------- */

  /** Ctrl-click: add or remove one list from the rail's selection. */
  const toggleListSelected = React.useCallback((id: string) => {
    taskStore.setSelection((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  }, []);

  /** Plain click: the selection becomes exactly this list (or nothing). */
  const setSelection = React.useCallback((ids: readonly string[]) => {
    taskStore.setSelection(() => [...ids]);
  }, []);

  /** Open (or re-focus) the floating window for a list — the signature move. */
  const openListWindow = React.useCallback(
    (listId: string) => {
      const list = lists.find((l) => l.id === listId);
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
    },
    [lists]
  );

  const patchWindow = React.useCallback((id: string, p: Partial<WindowState>) => {
    taskStore.setWindows((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w)));
  }, []);

  const closeWindow = React.useCallback((id: string) => {
    taskStore.setWindows((ws) => ws.filter((w) => w.id !== id));
  }, []);

  const focusWindow = React.useCallback((id: string) => {
    taskStore.setWindows((ws) => {
      const maxZ = ws.reduce((m, w) => Math.max(m, w.z), 10);
      const target = ws.find((w) => w.id === id);
      if (!target || target.z === maxZ) return ws;
      return ws.map((w) => (w.id === id ? { ...w, z: maxZ + 1 } : w));
    });
  }, []);

  return {
    lists,
    groups,
    windows,
    selectedListIds,
    addGroup,
    patchGroup,
    toggleGroupCollapse,
    removeGroup,
    setListGroup,
    toggleListSelected,
    setSelection,
    patch,
    toggleDone,
    toggleCollapse,
    rename,
    remove,
    duplicate,
    addItem,
    move,
    addList,
    patchList,
    removeList,
    openListWindow,
    patchWindow,
    closeWindow,
    focusWindow
  };
}

export type TaskController = ReturnType<typeof useTaskController>;
