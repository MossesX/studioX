/**
 * @file The lists rail's GROUPS — the root-level collapsible bands and the one
 * rule that decides which band a list falls into.
 *
 * Owner, 2026-08-14: *"in the all lists column create a new root level entry
 * which are collapsible starting with 'Build Manager' add all build manager
 * projects as sub items. another root level entry called 'modules' and list all
 * installed modules. root level entries for ToDo, Project Notes."*
 *
 * ── why a group is presentation, not a second data level ─────────────────────
 *
 * The obvious model — `TaskGroup.listIds: string[]` — puts the same fact in two
 * places the moment a sync engine is involved, and there are two of them. The
 * Build Manager mints a list per `.bmpx` project every few seconds and the
 * Modules engine mints one per registered module; both would have to write
 * their list AND edit a membership array, atomically, on a timer, forever. The
 * first tick that wrote one and not the other leaves a list nothing shows and a
 * group pointing at nothing.
 *
 * So membership is a field ON the list (`TaskList.groupId`) and this file holds
 * the resolution. `lists` stays the one flat array every other reader already
 * walks — the dashboard card, the floating windows, `countItems`, the peel —
 * and none of them learns that the rail grew bands.
 *
 * ── the by-kind fallback, and why it exists ──────────────────────────────────
 *
 * ToDo and Project Notes would otherwise be two headers that are empty forever:
 * nothing sets `groupId` on a list the person made in 2026-08-13's rail, and
 * there is no drag between rail rows to put one there. A group you cannot fill
 * is worse than no group, so `ListKind` — which the model has carried since the
 * GizmoX port and which `newList` already takes — answers when `groupId` does
 * not. A `todo` list files under ToDo; a `notes` list files under Project
 * Notes; anything else sits in the root band under the groups.
 *
 * An explicit `groupId` always wins, so moving a list out of its kind's group
 * is possible and sticks.
 */
import type { ListKind, TaskGroup, TaskList } from "./types";

/* The four built-in group ids. Exported as constants because three files name
 * them — the two sync engines and the rail — and a string typed a fourth time
 * is the drift `managed.ts` already argued against. */
export const GROUP_BUILD = "build";
export const GROUP_MODULES = "modules";
export const GROUP_TODO = "todo";
export const GROUP_NOTES = "notes";

/**
 * The groups every store starts with.
 *
 * `managedBy` on the first two is what makes them un-renameable and
 * un-deletable from the menu: their contents are minted on a timer, so a delete
 * would be undone within seconds and read as a menu row that does nothing.
 *
 * Deterministic — no `Date.now()`, no ids from `uid()` — because the store
 * builds this in the server bundle and the browser bundle independently and the
 * two must agree or hydration tears. Same rule the seed states about itself.
 */
export const BUILTIN_GROUPS: readonly TaskGroup[] = [
  { id: GROUP_BUILD, name: "Build Manager", order: 10, managedBy: "bmpx" },
  { id: GROUP_MODULES, name: "Modules", order: 20, managedBy: "modules" },
  { id: GROUP_TODO, name: "ToDo", order: 30 },
  { id: GROUP_NOTES, name: "Project Notes", order: 40 }
];

/** Which built-in group a list's KIND implies, when it names no group. */
const KIND_GROUP: Partial<Record<ListKind, string>> = {
  todo: GROUP_TODO,
  notes: GROUP_NOTES
};

/**
 * The group a list belongs to, or null for the root band.
 *
 * The ONE place the rule lives — the rail, the group commands and the tests all
 * ask this rather than each reading `groupId` and remembering the fallback.
 */
export function groupIdOf(list: TaskList): string | null {
  return list.groupId ?? KIND_GROUP[list.kind] ?? null;
}

/** A group's lists, pinned first, in rail order. */
export function listsInGroup(lists: readonly TaskList[], groupId: string): TaskList[] {
  return sortForRail(lists.filter((l) => groupIdOf(l) === groupId));
}

/** Lists that belong to no group — the band under the groups. */
export function ungroupedLists(lists: readonly TaskList[], groups: readonly TaskGroup[]): TaskList[] {
  const known = new Set(groups.map((g) => g.id));
  // A list naming a group that no longer exists shows at root rather than
  // vanishing. Deleting a group re-homes its lists explicitly, but a document
  // written by an older build (or a hand-edited one) must not be able to hide
  // a list where nothing draws it.
  return sortForRail(lists.filter((l) => {
    const id = groupIdOf(l);
    return id === null || !known.has(id);
  }));
}

/** Pinned first, otherwise the order the store holds them in. */
export function sortForRail(lists: readonly TaskList[]): TaskList[] {
  return [...lists].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
}

/** Groups in rail order, ties broken by name so the order is total. */
export function sortedGroups(groups: readonly TaskGroup[]): TaskGroup[] {
  return [...groups].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * Merge stored groups over the built-ins.
 *
 * The built-ins are not persisted as data the person can lose: a stored
 * document supplies the person's groups and whatever `collapsed` / `name` state
 * it holds for a built-in, and anything missing comes back. That is what makes
 * "Build Manager" survive a document written before groups existed, and what
 * stops a partially-written document from deleting a band the sync engines are
 * still filling.
 */
export function withBuiltinGroups(stored: readonly TaskGroup[] | undefined): TaskGroup[] {
  const out = new Map<string, TaskGroup>();
  for (const g of BUILTIN_GROUPS) out.set(g.id, g);
  for (const g of stored ?? []) {
    if (!g || typeof g.id !== "string" || typeof g.name !== "string") continue;
    const builtin = out.get(g.id);
    out.set(
      g.id,
      builtin
        ? // A built-in keeps its ownership and its order whatever the document
          // says — those are code, not preference. Collapsed IS preference.
          { ...builtin, collapsed: g.collapsed }
        : { id: g.id, name: g.name, order: g.order ?? 100, collapsed: g.collapsed }
    );
  }
  return sortedGroups([...out.values()]);
}

/** A fresh group, ordered after everything currently in the rail. */
export function newGroup(name: string, groups: readonly TaskGroup[]): TaskGroup {
  const maxOrder = groups.reduce((m, g) => Math.max(m, g.order), 0);
  return {
    // Slugged from the name so the id reads in a stored document, with a
    // counter suffix when that collides — an id derived from user text has to
    // survive "ToDo" being typed twice.
    id: uniqueGroupId(name, groups),
    name: name.trim(),
    order: maxOrder + 10
  };
}

function uniqueGroupId(name: string, groups: readonly TaskGroup[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "group";
  const taken = new Set(groups.map((g) => g.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
