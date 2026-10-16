/**
 * @file Installed modules → Task Manager, the PURE half: turning the registry's
 * modules into managed task lists under the rail's **Modules** group.
 *
 * Owner, 2026-08-14: *"another root level entry called 'modules' and list all
 * installed modules."*
 *
 * Deliberately the same SHAPE as `bmpx-taskman/sync.ts`, because it is the same
 * problem: an engine and the person edit one list, so every field needs exactly
 * one owner and the merge must never guess. Reading the two side by side should
 * teach the pattern rather than two different ones.
 *
 * | field                            | owner  | on every pass |
 * |----------------------------------|--------|---------------|
 * | list `name`                      | ENGINE | rewritten from the module's title |
 * | list `groupId`                   | ENGINE | rewritten — the Modules band is what this file is for |
 * | list `items`                     | PERSON | never touched; a module list starts EMPTY |
 * | `color`, `pinned`, `collapsed`   | PERSON | preserved |
 * | a list whose module is gone      | PERSON | left alone entirely |
 *
 * ── why a real list rather than a decorative row ─────────────────────────────
 *
 * The rail could have drawn module names it read straight from the registry,
 * and every one of them would have been a row you cannot click, cannot scope
 * to, cannot right-click and cannot put a task in — a list-shaped thing in a
 * column of lists that is not a list. Minting one real, empty list per module
 * makes "Modules" mean *here is where tasks about this module go*, and every
 * operation the rail already has works on it with nothing special-cased.
 *
 * It also makes the archive rule hold for free: a module list deleted is
 * archived like any other, and re-minted empty on the next tick if the setting
 * is still on. Switching **Auto-add module lists** off is what stops that, the
 * same way `autoBuildLists` stops the Build Manager's.
 *
 * ── idempotence ──────────────────────────────────────────────────────────────
 *
 * {@link mergeModules} returns the SAME array instance when nothing moved. The
 * store persists on every accepted mutation and this runs whenever the registry
 * changes, so a merge that allocated each pass would rewrite the document — and
 * re-render every reader — for no reason.
 */
import { GROUP_MODULES } from "../../modules/taskman/groups";
import { newList } from "../../modules/taskman/taskOps";
import { PALETTE } from "../../modules/taskman/palette";
import type { TaskList } from "../../modules/taskman/types";

/** The registry's module, narrowed to what this file reads. */
export interface InstalledModule {
  id: string;
  title: string;
}

export const MODULE_PREFIX = "module:";

export const listIdFor = (moduleId: string): string => `${MODULE_PREFIX}${moduleId}`;

/** A list this engine created — never one the person made. */
export const isManagedList = (list: TaskList): boolean => list.id.startsWith(MODULE_PREFIX);

/**
 * A stable colour per module id.
 *
 * Hashed rather than cycled by index: the registry sorts by id and a new module
 * inserted in the middle would otherwise recolour every list after it, which
 * looks like the rail rearranged itself. Same id, same colour, forever.
 */
export function colorFor(moduleId: string): string {
  let hash = 0;
  for (let i = 0; i < moduleId.length; i++) hash = (hash * 31 + moduleId.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length].key;
}

/**
 * Merge every installed module into `lists`.
 *
 * Returns `lists` itself when nothing changed — see the idempotence note above.
 */
export function mergeModules(lists: TaskList[], modules: readonly InstalledModule[]): TaskList[] {
  let changed = false;
  const byId = new Map(lists.map((l) => [l.id, l]));
  const out: TaskList[] = [...lists];

  for (const module of modules) {
    const id = listIdFor(module.id);
    const prev = byId.get(id);
    const name = module.title;

    if (!prev) {
      out.push({
        ...newList({ name, kind: "tasks", color: colorFor(module.id), icon: "package" }),
        id,
        groupId: GROUP_MODULES,
        // EMPTY, and it stays empty until the person puts something in it. The
        // engine has nothing to say about a module's tasks — only that the
        // module exists and is worth having a list for.
        items: []
      });
      changed = true;
      continue;
    }
    // The two fields this engine owns. `items` is conspicuously absent.
    if (prev.name === name && prev.groupId === GROUP_MODULES) continue;
    out[out.indexOf(prev)] = { ...prev, name, groupId: GROUP_MODULES };
    changed = true;
  }

  // A module that is no longer registered leaves its list ALONE — same rule the
  // Build Manager applies to a vanished project, and for the stronger reason
  // here: the list holds tasks the person wrote, and an uninstalled module is
  // far more often a temporarily-disabled one than a decision to throw work away.
  return changed ? out : lists;
}
