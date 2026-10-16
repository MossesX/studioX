/**
 * @file Pure tree operations over TaskList[] / TaskItem[]. Every mutation
 * returns new arrays (structural sharing where untouched) so the store can
 * diff cheaply. No React in here.
 *
 * Ported near-verbatim from GizmoX `src/modules/tasks/taskOps.ts` (MASTER §5).
 * The one departure: GizmoX re-exported its dropdown option lists from the
 * note-capture engine so four surfaces could not drift apart; the capture
 * engine is chrome this port culls, so the lists are declared here — still one
 * list per field, still guarded against drifting from the type unions below.
 */
import type { ItemAction, ItemType, TaskItem, TaskList } from "./types";
import { uid } from "./id";

/** Default icon key per item type — the GizmoX `TYPE_ICONS` mapping. */
export const TYPE_ICONS: Record<ItemType, string> = {
  task: "task",
  todo: "check",
  note: "doc",
  bug: "bug",
  idea: "idea",
  milestone: "flag",
  question: "help",
  link: "link"
};

export interface FoundItem {
  item: TaskItem;
  listId: string;
  /** Ancestor ids from root item down to (excluding) the item itself. */
  parents: string[];
}

/** Create a fresh item with sensible defaults. */
export function newItem(partial: Partial<TaskItem> = {}): TaskItem {
  const type: ItemType = partial.type ?? "task";
  return {
    id: uid("titem"),
    title: partial.title ?? "New item",
    done: false,
    type,
    action: partial.action ?? "none",
    category: partial.category ?? "",
    color: partial.color ?? "orange",
    icon: partial.icon ?? TYPE_ICONS[type] ?? "task",
    priority: partial.priority ?? 0,
    notes: partial.notes ?? "",
    children: partial.children ?? [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    due: partial.due,
    source: partial.source
  };
}

export function newList(partial: Partial<TaskList> = {}): TaskList {
  return {
    id: uid("tlist"),
    name: partial.name ?? "New list",
    kind: partial.kind ?? "tasks",
    color: partial.color ?? "orange",
    icon: partial.icon ?? "folder",
    items: partial.items ?? [],
    createdAt: Date.now()
  };
}

/** Depth-first search for an item id across all lists. */
export function findItem(lists: TaskList[], id: string): FoundItem | null {
  for (const list of lists) {
    const walk = (items: TaskItem[], parents: string[]): FoundItem | null => {
      for (const it of items) {
        if (it.id === id) return { item: it, listId: list.id, parents };
        const hit = walk(it.children, [...parents, it.id]);
        if (hit) return hit;
      }
      return null;
    };
    const hit = walk(list.items, []);
    if (hit) return hit;
  }
  return null;
}

/** Map one item (by id) through `fn`, bumping updatedAt. */
export function updateItem(
  lists: TaskList[],
  id: string,
  fn: (item: TaskItem) => TaskItem
): TaskList[] {
  const walk = (items: TaskItem[]): TaskItem[] => {
    let changed = false;
    const next = items.map((it) => {
      if (it.id === id) {
        changed = true;
        return { ...fn(it), updatedAt: Date.now() };
      }
      const kids = walk(it.children);
      if (kids !== it.children) {
        changed = true;
        return { ...it, children: kids };
      }
      return it;
    });
    return changed ? next : items;
  };
  return lists.map((l) => {
    const items = walk(l.items);
    return items === l.items ? l : { ...l, items };
  });
}

/** Remove an item; returns the new lists plus the removed node. */
export function removeItem(
  lists: TaskList[],
  id: string
): { lists: TaskList[]; removed: TaskItem | null } {
  let removed: TaskItem | null = null;
  const walk = (items: TaskItem[]): TaskItem[] => {
    const idx = items.findIndex((it) => it.id === id);
    if (idx >= 0) {
      removed = items[idx];
      return [...items.slice(0, idx), ...items.slice(idx + 1)];
    }
    let changed = false;
    const next = items.map((it) => {
      const kids = walk(it.children);
      if (kids !== it.children) {
        changed = true;
        return { ...it, children: kids };
      }
      return it;
    });
    return changed ? next : items;
  };
  const out = lists.map((l) => {
    const items = walk(l.items);
    return items === l.items ? l : { ...l, items };
  });
  return { lists: out, removed };
}

export interface DropTarget {
  listId: string;
  /** null = list root. */
  parentId: string | null;
  /** Insert index inside the parent's children; -1 = append. */
  index: number;
}

/** Insert an item at a target location. */
export function insertItem(lists: TaskList[], item: TaskItem, target: DropTarget): TaskList[] {
  const insertInto = (items: TaskItem[]): TaskItem[] => {
    const idx = target.index < 0 || target.index > items.length ? items.length : target.index;
    return [...items.slice(0, idx), item, ...items.slice(idx)];
  };
  const walk = (items: TaskItem[]): TaskItem[] => {
    let changed = false;
    const next = items.map((it) => {
      if (it.id === target.parentId) {
        changed = true;
        return { ...it, children: insertInto(it.children), collapsed: false };
      }
      const kids = walk(it.children);
      if (kids !== it.children) {
        changed = true;
        return { ...it, children: kids };
      }
      return it;
    });
    return changed ? next : items;
  };
  return lists.map((l) => {
    if (l.id !== target.listId) return l;
    if (target.parentId == null) return { ...l, items: insertInto(l.items) };
    return { ...l, items: walk(l.items) };
  });
}

/** True when `maybeAncestor` is `id` itself or an ancestor of it. */
export function isSelfOrDescendant(lists: TaskList[], maybeAncestor: string, id: string): boolean {
  if (maybeAncestor === id) return true;
  const found = findItem(lists, id);
  return found ? found.parents.includes(maybeAncestor) : false;
}

/** Move an item (any list) to a drop target, guarding against cycles. */
export function moveItem(lists: TaskList[], itemId: string, target: DropTarget): TaskList[] {
  if (target.parentId && isSelfOrDescendant(lists, itemId, target.parentId)) return lists;
  const { lists: without, removed } = removeItem(lists, itemId);
  if (!removed) return lists;
  return insertItem(without, removed, target);
}

/** Flatten every item of a list (or all lists) depth-first with depth info. */
export function flatten(
  lists: TaskList[],
  listId?: string
): { item: TaskItem; listId: string; depth: number }[] {
  const out: { item: TaskItem; listId: string; depth: number }[] = [];
  for (const l of lists) {
    if (listId && l.id !== listId) continue;
    const walk = (items: TaskItem[], depth: number) => {
      for (const it of items) {
        out.push({ item: it, listId: l.id, depth });
        walk(it.children, depth + 1);
      }
    };
    walk(l.items, 0);
  }
  return out;
}

/**
 * Progress counts for a subtree / list. WALKS `children` recursively — that
 * recursion is what makes the dashboard card's numbers right (MASTER §5): a
 * shallow `items.length` would report 4 lists of a dozen rows each, not the
 * real 96/80/49/35.
 */
export function countItems(items: TaskItem[]): { total: number; done: number } {
  let total = 0;
  let done = 0;
  const walk = (arr: TaskItem[]) => {
    for (const it of arr) {
      total++;
      if (it.done) done++;
      walk(it.children);
    }
  };
  walk(items);
  return { total, done };
}

/** Set collapsed on every item of a list. */
export function setAllCollapsed(
  lists: TaskList[],
  listId: string,
  collapsed: boolean,
  parentId?: string
): TaskList[] {
  const walk = (items: TaskItem[]): TaskItem[] =>
    items.map((it) => ({ ...it, collapsed, children: walk(it.children) }));

  return lists.map((l) => {
    if (l.id !== listId) return l;
    if (parentId) {
      // Collapse only the children of the specified parent.
      const walk2 = (items: TaskItem[]): TaskItem[] =>
        items.map((it) => {
          if (it.id === parentId) {
            return { ...it, children: it.children.map((c) => ({ ...c, collapsed })) };
          }
          return { ...it, children: walk2(it.children) };
        });
      return { ...l, items: walk2(l.items) };
    }
    return { ...l, items: walk(l.items) };
  });
}

/** Deep-duplicate an item with fresh ids. */
export function cloneItem(item: TaskItem): TaskItem {
  return {
    ...item,
    id: uid("titem"),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    children: item.children.map(cloneItem)
  };
}

/** Case-insensitive filter that keeps matching items plus their ancestors. */
export function filterItems(items: TaskItem[], query: string): TaskItem[] {
  if (!query.trim()) return items;
  const q = query.toLowerCase();
  const walk = (arr: TaskItem[]): TaskItem[] =>
    arr
      .map((it): TaskItem | null => {
        const kids = walk(it.children);
        const selfHit =
          it.title.toLowerCase().includes(q) ||
          it.category.toLowerCase().includes(q) ||
          it.notes.toLowerCase().includes(q) ||
          it.type.includes(q) ||
          it.action.includes(q);
        if (!selfHit && kids.length === 0) return null;
        return { ...it, children: kids, collapsed: false };
      })
      .filter((x): x is TaskItem => x != null);
  return walk(items);
}

/* One list per field, exactly as the type unions declare them. */
export const TYPE_OPTIONS: readonly ItemType[] = [
  "task",
  "todo",
  "note",
  "bug",
  "idea",
  "milestone",
  "question",
  "link"
];
export const ACTION_OPTIONS: readonly ItemAction[] = [
  "none",
  "build",
  "fix",
  "review",
  "research",
  "design",
  "deploy",
  "test",
  "document",
  "refactor",
  "automate"
];
export const PRIORITY_LABELS = ["None", "Low", "Medium", "High"] as const;

/* Compile-time drift guards: a new `ItemType`/`ItemAction` that never reaches
 * the option lists would silently be unpickable, so it is an error here
 * instead. `Assert<false>` does not satisfy `extends true`. */
type Assert<T extends true> = T;
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type OptionsCoverItemTypes = Assert<Eq<(typeof TYPE_OPTIONS)[number], ItemType>>;
export type OptionsCoverItemActions = Assert<Eq<(typeof ACTION_OPTIONS)[number], ItemAction>>;
