/**
 * @file Which lists the SYSTEM owns — a seam the module offers and an engine
 * fills.
 *
 * The Task Manager has two kinds of list and, until this file, no way to tell
 * them apart from inside the module:
 *
 *   - **yours** — made in the rail, by the menu, by a capture;
 *   - **the system's** — created and kept in step by something that polls. The
 *     only one today is `plugins/bmpx-taskman`, which mints a list per `.bmpx`
 *     build project every few seconds.
 *
 * That difference is the whole substance of the owner's 2026-08-13 request:
 * *"delete all list … with check mark confirming the deletion of bmpx project
 * lists if selected. if confirmed delete permanently and dont allow it to be
 * auto added again by the system."* A "delete all" that cannot name the system
 * lists would either spare them (and look broken) or delete them and watch the
 * poll loop put them straight back (which is worse — it looks like the delete
 * silently failed).
 *
 * ## Why a registry rather than a string test
 *
 * The knowledge lives in the plugin: `bmpx:` is ITS id prefix, declared in its
 * own `sync.ts` and documented there as "the ONLY thing separating mine to
 * rewrite from the person's to leave alone". A module reaching into a plugin to
 * borrow that constant inverts the dependency — the module must not know a
 * plugin exists — and copying the string here would leave two definitions of
 * the same fact, one of which goes stale silently.
 *
 * So the module offers a seam and the engine fills it at import time, which is
 * the same shape `integrations.tsx` uses for task providers and the framework
 * uses for every other extension point. With no engine registered, every list
 * is yours and every caller below still works.
 */
import type { TaskList } from "./types";

/** True when `list` is one this engine created and maintains. */
export type ManagedListTest = (list: TaskList) => boolean;

interface ManagedEngine {
  /** Human name — what a confirm dialog calls these lists. */
  readonly label: string;
  readonly test: ManagedListTest;
}

const engines = new Map<string, ManagedEngine>();

/**
 * Declare that `owner` creates and maintains some of the lists. Idempotent by
 * owner id, so a dev-server remount re-registers rather than duplicating.
 */
export function registerManagedLists(owner: string, label: string, test: ManagedListTest): void {
  engines.set(owner, { label, test });
}

/** Is this list the system's rather than the person's? */
export function isManagedList(list: TaskList): boolean {
  for (const engine of engines.values()) if (engine.test(list)) return true;
  return false;
}

/**
 * What to CALL the system lists in a message, e.g. "build project". Empty when
 * nothing has registered — callers then say nothing about them, which is
 * correct: there are none.
 */
export function managedLabels(): string[] {
  return [...engines.values()].map((e) => e.label);
}
