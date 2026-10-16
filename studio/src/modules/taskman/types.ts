/**
 * @file The task manager's data model — the tasks slice of GizmoX's
 * `src/lib/types.ts`, ported near-verbatim (MASTER §5). GizmoX keeps these in
 * one app-wide types barrel; studio has no such barrel and this module is the
 * only consumer, so they live beside the ops that walk them.
 *
 * `WindowState` rides along from the same barrel: the floating list windows
 * are this module's signature, and their geometry is part of its model.
 */

export type ItemType =
  | "task"
  | "todo"
  | "note"
  | "bug"
  | "idea"
  | "milestone"
  | "question"
  | "link";

export type ItemAction =
  | "none"
  | "build"
  | "fix"
  | "review"
  | "research"
  | "design"
  | "deploy"
  | "test"
  | "document"
  | "refactor"
  | "automate";

/** 0 = none, 1 = low, 2 = medium, 3 = high */
export type Priority = 0 | 1 | 2 | 3;

/** A single task / todo / note node. Nests arbitrarily deep via `children`. */
export interface TaskItem {
  id: string;
  title: string;
  done: boolean;
  type: ItemType;
  action: ItemAction;
  category: string;
  /** Named palette color key (see ./palette) used for dots + cross-out. */
  color: string;
  /** Icon key — kept through the port so items round-trip, even where the
   *  studio UI draws a color dot rather than a per-type drawing. */
  icon: string;
  priority: Priority;
  notes: string;
  children: TaskItem[];
  collapsed?: boolean;
  createdAt: number;
  updatedAt: number;
  due?: number;
  /** Set when another asset contributed this item (dynamic integration). */
  source?: { module: string; ref: string };
}

export type ListKind = "project" | "tasks" | "todo" | "notes";

/** A root-level list. Multiple project-level roots can be open at once. */
export interface TaskList {
  id: string;
  name: string;
  kind: ListKind;
  color: string;
  icon: string;
  items: TaskItem[];
  collapsed?: boolean;
  pinned?: boolean;
  createdAt: number;
  /**
   * The rail group this list files under, or undefined for the root band.
   *
   * A LIST's field rather than a group's membership array, deliberately: the
   * two sync engines (`bmpx-taskman`, `modules-taskman`) mint their lists on a
   * timer and would each have to write a second document to keep an array in
   * step, which is the classic way two truths about one fact drift. See
   * `groups.ts` for the resolution rule and the by-kind fallback.
   */
  groupId?: string;
}

/**
 * A collapsible band in the lists rail — "Build Manager", "Modules", "ToDo",
 * "Project Notes" and whatever the person adds with *Add group…*.
 *
 * A group is presentation over the SAME flat list array, not a second level of
 * the data model. `TaskList.items` still nests arbitrarily deep and every
 * existing reader (the dashboard card, the floating windows, `countItems`)
 * keeps working unchanged, because none of them looks at the rail.
 */
export interface TaskGroup {
  id: string;
  name: string;
  /** Rail order, low first. Built-ins take 10/20/30/40 so an added group can
   *  land between two of them later without renumbering the set. */
  order: number;
  collapsed?: boolean;
  /**
   * The engine that owns this group's MEMBERSHIP, when one does — `"bmpx"` for
   * Build Manager, `"modules"` for Modules. An owned group cannot be renamed or
   * deleted from the menu, because the next sync tick would put it straight
   * back: the same "delete did nothing" failure `managed.ts` was written to
   * stop. Undefined means the group is the person's, entirely.
   */
  managedBy?: string;
}

/** One floating list window: draggable, resizable, z-ordered, minimizable. */
export interface WindowState {
  id: string;
  kind: "task-list";
  title: string;
  /** Module-specific payload — `{ listId }` for task-list windows. */
  payload: Record<string, string>;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
}
