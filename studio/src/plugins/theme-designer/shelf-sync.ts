/**
 * @file The saved-look shelf, mirrored to the SERVER so a look outlives the
 * browser profile that made it.
 *
 * Owner, 2026-08-12: a saved look should be *"an assett that can be selected
 * and reapplied at any time"*. It already could be — but only in the browser
 * that saved it, because the shelf is `localStorage`. Clear site data, use a
 * different browser, or open the studio from another machine, and every look
 * you built was gone. That is not an asset, it is a cache.
 *
 * ## Why a mirror rather than moving the store
 *
 * `SavedThemeLibrary` takes a SYNCHRONOUS `SavedStorage` (`read`/`write`
 * returning strings) and `useSyncExternalStore` reads its snapshot during
 * render. The server is `fetch`, which is async. Rewriting the library to be
 * async would make the shelf unavailable on first paint and turn a simple list
 * into a loading state — for the sake of a write that can perfectly well happen
 * after the render.
 *
 * So localStorage stays the synchronous truth the UI reads, and this module
 * keeps it in step with the server in both directions:
 *
 *   - **push** — after any local change, PUT the whole shelf. Whole, not a
 *     delta: the shelf is a handful of small records, and a delta protocol
 *     between two stores that can each be edited independently is how you get
 *     a merge conflict nobody asked for.
 *   - **pull** — once at mount, GET the server's copy and merge it in. Merged,
 *     never replaced: two browsers that each saved a look must end up with
 *     both, and a replace would silently delete whichever was slower.
 *
 * ## The merge rule
 *
 * By `id` (the name slug), newest `savedAt` wins. That is the same rule saving
 * already uses locally — "saving under an existing name replaces that entry" —
 * so a look edited on one machine and re-saved is the one that survives, and
 * two DIFFERENT names never collide at all.
 *
 * ## How deletion actually behaves
 *
 * A delete DOES reach the server, because the push writes the whole shelf and
 * the deleted record is simply not in it. What a delete cannot do is survive
 * another browser that still has the look: the next pull from THAT browser
 * merges it back in, because a merge cannot tell "deleted over there" from
 * "created over here" — the ambiguity `.claude/rules/one-way-sync.md` records
 * as the reason an absence must never be read as a deletion.
 *
 * That is the safe direction to be wrong in, and it is stated here because an
 * earlier draft of this docblock claimed the opposite ("a record removed
 * locally is not removed from the server"). It was describing an intention
 * rather than the code, which is worse than saying nothing — the whole-shelf
 * push had always propagated deletes.
 */
import type { SavedTheme } from "./saved-store";

/** Namespace under `data/axf/kv/<user>/` — a real file on the server. */
export const SHELF_NS = "saved-themes";

const ENDPOINT = `/api/axf/kv/${SHELF_NS}`;

/** Newest-per-id, then newest-first — the order the shelf already renders in. */
export function mergeShelves(
  a: readonly SavedTheme[],
  b: readonly SavedTheme[]
): SavedTheme[] {
  const byId = new Map<string, SavedTheme>();
  for (const entry of [...a, ...b]) {
    const seen = byId.get(entry.id);
    if (!seen || entry.savedAt > seen.savedAt) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((x, y) => y.savedAt - x.savedAt);
}

/** Records out of a KV document, tolerating anything that is not our shape. */
export function shelfFromDoc(doc: unknown): SavedTheme[] {
  if (!doc || typeof doc !== "object") return [];
  const list = (doc as { themes?: unknown }).themes;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is SavedTheme =>
      Boolean(e) && typeof e === "object" && typeof (e as SavedTheme).id === "string"
  );
}

/**
 * PUT the whole shelf. Fire-and-forget by design: a look is already saved
 * locally by the time this runs, so a failed mirror must not surface as a
 * failed save. It returns the outcome for a caller that wants to report it.
 */
export async function pushShelf(themes: readonly SavedTheme[]): Promise<boolean> {
  try {
    const r = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc: { themes } })
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Attach the mirror ONCE, for the whole designer.
 *
 * It lives here rather than in a tab because of a bug this had on its first
 * wiring: the pull/push effects were mounted by `SavedThemes.tsx`, so a look
 * saved from the **Branding** tab — the primary Save button — never reached the
 * server at all, because the subscription only existed while a different tab
 * was on screen. A mirror that depends on which tab you happen to be looking at
 * is not a mirror.
 *
 * Idempotent and module-scoped: `ThemeDesigner` mounts, unmounts and remounts
 * as the route changes, and each mount must not add another subscriber or fire
 * another pull. The first caller wins and every later one is a no-op, so this
 * is safe to call from anywhere that wants to guarantee the mirror is running.
 */
let attached = false;
export function attachShelfSync(store: {
  list(): readonly SavedTheme[];
  replaceAll(items: readonly SavedTheme[]): void;
  subscribe(listener: () => void): () => void;
}): void {
  if (attached || typeof window === "undefined") return;
  attached = true;

  // Push after every local change, from whichever tab made it.
  store.subscribe(() => void pushShelf(store.list()));

  // Pull once and MERGE — replacing would delete whatever another browser
  // saved. Only write when the merge actually adds something, or the mount
  // would notify every subscriber (and push straight back) for no change.
  void pullShelf().then((remote) => {
    if (remote.length === 0) return;
    const merged = mergeShelves(store.list(), remote);
    if (merged.length !== store.list().length) store.replaceAll(merged);
  });
}

/** GET the server's shelf. A 404 means "nothing saved yet", not an error. */
export async function pullShelf(): Promise<SavedTheme[]> {
  try {
    const r = await fetch(ENDPOINT);
    if (!r.ok) return [];
    const body = (await r.json()) as { doc?: unknown };
    return shelfFromDoc(body.doc);
  } catch {
    return [];
  }
}
