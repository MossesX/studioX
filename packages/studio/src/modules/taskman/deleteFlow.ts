/**
 * @file Deleting lists, in ONE place — the confirm, the archive write, the
 * removal, and what to say when the archive refuses.
 *
 * Four surfaces delete lists: the rail's × button, the list menu's *Delete
 * list*, *Delete all lists*, and *Delete group*. Before 2026-08-14 two of them
 * each carried their own `window.confirm` and their own `filter`, which is
 * exactly how `mayDestroy` came to exist for items — a setting with nowhere to
 * land, because the prompt was written twice.
 *
 * Now it is written once. That matters more than it did, because a delete is no
 * longer a filter over an array: it is a network write that can fail, and
 * "archived" has to be TRUE before anything leaves the rail. A second copy of
 * this flow is a second chance to get that order wrong.
 *
 * ── the count is the message ────────────────────────────────────────────────
 *
 * Owner, 2026-08-14: *"delete lists will delete x number of lists after
 * confirmation."* The confirm names the number and, up to a handful, the lists
 * themselves — a dialog that says "Archive 7 lists?" over a rail where you
 * ctrl-clicked what you thought was 5 is the only chance to catch the miscount.
 */
"use client";

import { deleteLists } from "./archive";
import { getTaskmanSettings } from "./settings";
import { taskStore } from "./store";
import type { TaskList } from "./types";

/** How many list names the confirm spells out before falling back to a count. */
const NAMES_SHOWN = 6;

export interface DeleteOptions {
  /** Recorded on the archive entry — "list", "delete-all", "group". */
  reason: string;
  /**
   * Ask even when *Confirm destructive deletes* is off.
   *
   * Delete-all sets this. That setting is about one item with children or one
   * non-empty list; "every list you have" is not the place to honour a
   * preference for fewer prompts, and `taskman.delete-all` has said so since
   * 2026-08-13.
   */
  alwaysAsk?: boolean;
  /** Extra sentences appended to the confirm — what else this delete changes. */
  extra?: string;
}

/** The confirm's body. Exported for the tests: the count is the feature. */
export function deleteQuestion(lists: readonly TaskList[], extra = ""): string {
  const names =
    lists.length <= NAMES_SHOWN
      ? lists.map((l) => `  • ${l.name}`).join("\n")
      : `${lists
          .slice(0, NAMES_SHOWN)
          .map((l) => `  • ${l.name}`)
          .join("\n")}\n  • …and ${lists.length - NAMES_SHOWN} more`;
  const items = lists.reduce((n, l) => n + countTree(l.items), 0);
  return (
    `Delete ${lists.length} list${lists.length === 1 ? "" : "s"} and ${items} item${items === 1 ? "" : "s"}?\n\n` +
    `${names}\n\n` +
    `They go to your archive, not away — reopen them from “Archived lists…” on the ` +
    `Task Manager's right-click menu.${extra}`
  );
}

function countTree(items: readonly { children: readonly unknown[] }[]): number {
  let n = 0;
  for (const it of items) {
    n += 1;
    n += countTree(it.children as readonly { children: readonly unknown[] }[]);
  }
  return n;
}

/**
 * Confirm, archive, remove. Answers what actually happened.
 *
 * `ok: false` with no `error` means the person said no. `ok: false` WITH an
 * error means the archive write failed and **nothing was removed** — the lists
 * are still on screen, which is the only honest outcome when the promise that
 * they were kept somewhere cannot be met.
 */
export async function deleteListsWithConfirm(
  listIds: readonly string[],
  options: DeleteOptions
): Promise<{ ok: boolean; deleted: number; error?: string }> {
  const want = new Set(listIds);
  const lists = taskStore.getState().lists.filter((l) => want.has(l.id));
  if (!lists.length) return { ok: false, deleted: 0 };

  // The same threshold `taskman.list.delete` has always used, widened by one
  // case rather than replaced: *Confirm destructive deletes* is about a list
  // with contents, so a single empty list still goes without a prompt — but a
  // BATCH always asks, because "how many did I have selected" is exactly the
  // question a ctrl-click selection makes easy to get wrong.
  const worthAsking = lists.length > 1 || lists.some((l) => l.items.length > 0);
  const mustAsk = options.alwaysAsk || (getTaskmanSettings().confirmDelete && worthAsking);
  if (mustAsk && !window.confirm(deleteQuestion(lists, options.extra ?? ""))) {
    return { ok: false, deleted: 0 };
  }

  try {
    const result = await deleteLists(lists, options.reason);
    if (result.trimmed > 0) {
      // Said out loud rather than swallowed: the archive is capped, and a cap
      // that quietly drops the oldest entries turns "never really deleted" into
      // a claim that is false for anyone who deletes a lot.
      window.alert(
        `Archived ${result.archived} list(s). The archive is full, so ${result.trimmed} of the ` +
          `oldest entr${result.trimmed === 1 ? "y is" : "ies are"} now gone for good.`
      );
    }
    return { ok: true, deleted: result.archived };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    window.alert(
      `Nothing was deleted.\n\nThese lists could not be written to your archive, and this ` +
        `module deletes nothing it has not archived first:\n\n${error}`
    );
    return { ok: false, deleted: 0, error };
  }
}
