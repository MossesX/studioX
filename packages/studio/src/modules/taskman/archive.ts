/**
 * @file The client half of the archive: **the only way a list leaves the rail.**
 *
 * Owner, 2026-08-14: *"any and all deleted lists are not deleted they are
 * stored in archive."* "Any and all" is the load-bearing part, so there is one
 * function — {@link deleteLists} — and every delete path calls it: the rail's ×
 * button, the list menu's Delete, a multi-selection delete, Delete-all, and
 * deleting a group with the lists included. A second path that removed a list
 * without this would make the promise false without making anything look broken,
 * which is the failure mode this module's own docblocks keep naming.
 *
 * ── the ordering is the whole guarantee ──────────────────────────────────────
 *
 * Archive FIRST, await it, and remove from the store only on success. The other
 * order — remove now, upload after — is faster and is a lie: a delete during a
 * dev-server restart, an offline tab or a full disk would destroy the list and
 * report that it was archived. On failure nothing is removed and the caller is
 * told; the lists are still there to try again, which is the only honest
 * outcome when the promise cannot be kept.
 *
 * That does mean deleting a list is now a NETWORK operation and can fail. It is
 * the price of "not deleted, archived", and it is the right price: the module
 * has no undo anywhere else.
 */
"use client";

import { taskStore } from "./store";
import type { TaskList } from "./types";

const ENDPOINT = "/api/taskman/archive";

/** An archived list as the dialog sees it — no item tree; see the route. */
export interface ArchiveMeta {
  id: string;
  listId: string;
  name: string;
  archivedAt: number;
  reason: string;
  itemCount: number;
}

/** What an archiving delete reports back to whoever asked for it. */
export interface ArchiveResult {
  archived: number;
  /** Entries pushed out of the far end of the archive by this write. */
  trimmed: number;
}

async function jsonOrThrow(res: Response, what: string): Promise<unknown> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    let named = false;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        detail = body.error;
        named = true;
      }
    } catch {
      /* a non-JSON error body is still an error — the status carries it */
    }
    // A 404 the ROUTE did not write means the route is not mounted at all —
    // which is the peeled app's state, because `scripts/peel.mjs` carries a
    // plugin's declared routes and a module's own routes travel with nothing
    // (the same reason `/api/tasks/inbox` is absent there). Saying that beats
    // "HTTP 404", which reads as a bug in a delete that is working correctly by
    // refusing to destroy what it cannot archive.
    if (res.status === 404 && !named) {
      detail = `${ENDPOINT} is not mounted in this app, so there is nowhere to archive to`;
    }
    throw new Error(`${what}: ${detail}`);
  }
  return res.json();
}

/**
 * Archive `lists` and then drop them from the store.
 *
 * Rejects — having removed NOTHING — when the archive write fails. Callers show
 * the message; they must not fall back to deleting anyway.
 */
export async function deleteLists(lists: readonly TaskList[], reason: string): Promise<ArchiveResult> {
  if (!lists.length) return { archived: 0, trimmed: 0 };
  const body = (await jsonOrThrow(
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lists, reason })
    }),
    "could not archive"
  )) as { archived?: number; trimmed?: number };

  const going = new Set(lists.map((l) => l.id));
  taskStore.setLists((ls) => ls.filter((l) => !going.has(l.id)));
  // A selection whose lists just went is pruned by the store, but the windows
  // are not: a floating window over an archived list would render an empty
  // shell nothing can fill.
  taskStore.setWindows((ws) =>
    ws.filter((w) => !(w.kind === "task-list" && going.has(w.payload.listId ?? "")))
  );
  return { archived: body.archived ?? lists.length, trimmed: body.trimmed ?? 0 };
}

/** Delete lists BY ID, resolved against the store — the shape the commands use. */
export async function deleteListIds(ids: readonly string[], reason: string): Promise<ArchiveResult> {
  const want = new Set(ids);
  return deleteLists(taskStore.getState().lists.filter((l) => want.has(l.id)), reason);
}

/** Every archived list this user has, newest first, without the item trees. */
export async function listArchive(): Promise<ArchiveMeta[]> {
  const body = (await jsonOrThrow(
    await fetch(ENDPOINT, { cache: "no-store" }),
    "could not read the archive"
  )) as { entries?: ArchiveMeta[] };
  return body.entries ?? [];
}

/**
 * Put an archived list back in the rail, and drop it from the archive.
 *
 * The list returns under a NEW id when its old one is taken — restoring a
 * `bmpx:` list while the Build Manager has already re-minted it must not
 * overwrite the live one, and two rows sharing an id is a React reconciliation
 * bug that shows as one row flickering between two documents.
 */
export async function restoreArchived(id: string): Promise<TaskList> {
  const body = (await jsonOrThrow(
    await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { cache: "no-store" }),
    "could not read the archived list"
  )) as { entry?: { list?: TaskList } };
  const list = body.entry?.list;
  if (!list || typeof list.id !== "string") throw new Error("that archive entry holds no list");

  const taken = new Set(taskStore.getState().lists.map((l) => l.id));
  const restored: TaskList = taken.has(list.id)
    ? { ...list, id: `${list.id}~restored_${Date.now().toString(36)}`, name: `${list.name} (restored)` }
    : list;
  taskStore.setLists((ls) => [...ls, restored]);
  await purgeArchived(id);
  return restored;
}

/** Forget an archived list for good. `"all"` empties the archive. */
export async function purgeArchived(id: string | "all"): Promise<number> {
  const query = id === "all" ? "all=1" : `id=${encodeURIComponent(id)}`;
  const body = (await jsonOrThrow(
    await fetch(`${ENDPOINT}?${query}`, { method: "DELETE" }),
    "could not empty the archive"
  )) as { removed?: number };
  return body.removed ?? 0;
}
