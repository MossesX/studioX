/**
 * @file The saved-theme library — named looks you can come back to.
 *
 * ## Why this is in the SDK and not in core
 *
 * `theme/index.ts` states the split the whole engine is built on: core ships
 * the ROLLING half and the SDK supplies the authoring surface, with
 * `ThemeStore.setValue` as the seam. A named library is authoring — it is a
 * shelf of work in progress, not something a peeled app needs in order to
 * re-theme itself. So it lives beside the designer that fills it.
 *
 * ## What a saved theme actually is, since 2026-08-12: THE VALUES
 *
 * One system now, not three. A look used to also record a pack selection and
 * a per-surface chrome map, because packs could outrank dials and the banner
 * was registry state. Both facts died the same day:
 *
 *   - the branding pack is a FIXED APP SETTING (owner: *"branding is not
 *     negotiable, its global and does not change"*) — a look must NOT carry
 *     it, or applying an old look would silently change a global setting;
 *   - the banner and nav menu are the theme's own `bannerBar` / `navMenu`
 *     dials, so they are inside `values` like every other part of a design.
 *
 * Records saved before this carry extra `packs` / `surfaces` fields; they
 * load fine and those fields are simply ignored.
 *
 * ## Photograph, not recipe (2026-08-12)
 *
 * This used to store the SEED and nothing else — "six characters regenerate
 * the theme exactly", with the hand edits layered on top. That reasoning was
 * sound about size and wrong about meaning, and the owner named the gap
 * precisely: *"i want it to save everything exactly as is. the layout, the
 * colors, the dials, everything"*. A seed is a recipe — it re-derives the
 * theme THROUGH the generator, so the same record renders differently the day
 * the generator changes. So a record carries `values` — every dial at the
 * value it was showing — and applying sets those directly. The seed is kept
 * as provenance, never as the restore path.
 *
 * ## Pure on purpose
 *
 * Nothing here imports `theme` or `packs`. The library takes plain data in and
 * hands plain data back, and the surface wires it to the singletons. That is
 * what lets it run under `node --test`, where there is no `window`, no JSX
 * transform and no registry — the same reason `ThemeStore` takes injectable
 * storage.
 */
import type { RollOptions, ThemeValues } from "@axf/core";

export interface SavedTheme {
  /** Slug of the name. Saving under an existing name replaces that entry. */
  readonly id: string;
  readonly name: string;
  /**
   * EVERY dial, at the value it was actually showing. The photograph, and the
   * restore path. Optional only so records written before it still load;
   * anything saved from here on has it.
   */
  readonly values?: ThemeValues;
  /** Provenance: what it was rolled from. Kept so a look can still be re-rolled
   *  or traced, NOT used to restore when `values` is present. */
  readonly seed: string | null;
  readonly options: RollOptions;
  readonly overrides: ThemeValues;
  readonly savedAt: number;
}

/** What a save needs. The same shape `ThemeState` provides. */
export interface SaveInput {
  readonly name: string;
  readonly values?: ThemeValues;
  readonly seed: string | null;
  readonly options: RollOptions;
  readonly overrides: ThemeValues;
}

export interface SavedStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

/**
 * Its own key, and this is the one place a second key is right.
 *
 * The build's standing rule is no second store, no second publisher, no second
 * persistence key — and it is about the theme IN FORCE, which still comes from
 * `THEME_KEY` and nowhere else. This key holds a shelf of inert records that
 * nothing renders from. Putting them inside the theme's own payload would make
 * every save rewrite the value the pre-paint boot script parses on every load.
 */
export const SAVED_KEY = "axs:saved-themes@1";

/** Readable, stable, and collides exactly when two saves mean the same name. */
export function slugOf(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  // A name of nothing but punctuation still has to address a row.
  return slug || "untitled";
}

const memoryStorage = (): SavedStorage => {
  const map = new Map<string, string>();
  return { read: (k) => map.get(k) ?? null, write: (k, v) => void map.set(k, v) };
};

const browserStorage = (): SavedStorage | null => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return {
      read: (k) => window.localStorage.getItem(k),
      write: (k, v) => window.localStorage.setItem(k, v)
    };
  } catch {
    return null;
  }
};

/**
 * The shelf. Newest first, persisted on every mutation, no save step — the
 * store's own rule, applied to the thing that stores the saves.
 */
export class SavedThemeLibrary {
  readonly #storage: SavedStorage;
  readonly #listeners = new Set<() => void>();
  #items: SavedTheme[] = [];
  #snapshot: readonly SavedTheme[] | null = null;
  /** Never invalidated — an empty shelf is what the server always renders. */
  readonly #serverSnapshot: readonly SavedTheme[] = Object.freeze([]);

  constructor(storage?: SavedStorage) {
    this.#storage = storage ?? browserStorage() ?? memoryStorage();
    this.#restore();
  }

  #restore(): void {
    try {
      const raw = this.#storage.read(SAVED_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.#items = parsed.filter(isSaved);
    } catch {
      // Same recovery as `ThemeStore`: a corrupt shelf starts empty rather
      // than taking the page down. The saves are lost either way; an app that
      // will not boot until someone clears storage they do not know about is
      // the strictly worse of the two outcomes.
      this.#items = [];
    }
  }

  #changed(): void {
    this.#snapshot = null;
    try {
      this.#storage.write(SAVED_KEY, JSON.stringify(this.#items));
    } catch {
      /* storage full or unavailable — the shelf still works for this session */
    }
    for (const listener of this.#listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Stable between changes — `useSyncExternalStore` requires that. */
  list = (): readonly SavedTheme[] => {
    this.#snapshot ??= [...this.#items].sort((a, b) => b.savedAt - a.savedAt);
    return this.#snapshot;
  };

  /** Empty, always: a server render cannot read the shelf. See `ThemeStore`. */
  serverList = (): readonly SavedTheme[] => this.#serverSnapshot;

  get = (id: string): SavedTheme | undefined => this.#items.find((s) => s.id === id);

  /**
   * Replace the whole shelf — the seam the server mirror pulls into.
   *
   * Deliberately the only bulk writer, and deliberately NOT a merge: the merge
   * rule lives in `shelf-sync.ts` beside the transport that needs it, so this
   * class keeps knowing nothing about servers and stays testable under
   * `node --test` with no `window` and no `fetch`.
   */
  replaceAll(items: readonly SavedTheme[]): void {
    this.#items = [...items];
    this.#changed();
  }

  /** Save, or replace the entry of the same name. Returns what was stored. */
  save(input: SaveInput, at: number): SavedTheme {
    const name = input.name.trim() || "Untitled";
    const entry: SavedTheme = {
      id: slugOf(name),
      name,
      seed: input.seed,
      options: { ...input.options },
      overrides: { ...input.overrides },
      ...(input.values ? { values: { ...input.values } } : null),
      savedAt: at
    };
    this.#items = [entry, ...this.#items.filter((s) => s.id !== entry.id)];
    this.#changed();
    return entry;
  }

  remove(id: string): void {
    const next = this.#items.filter((s) => s.id !== id);
    if (next.length === this.#items.length) return;
    this.#items = next;
    this.#changed();
  }

  /** Renaming re-slugs the id, so "saved under this name" stays one thing. */
  rename(id: string, name: string): SavedTheme | undefined {
    const found = this.#items.find((s) => s.id === id);
    if (!found) return undefined;
    const trimmed = name.trim();
    if (!trimmed || trimmed === found.name) return found;
    const renamed: SavedTheme = { ...found, id: slugOf(trimmed), name: trimmed };
    this.#items = [renamed, ...this.#items.filter((s) => s.id !== id && s.id !== renamed.id)];
    this.#changed();
    return renamed;
  }
}

function isSaved(value: unknown): value is SavedTheme {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SavedTheme>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    (typeof v.seed === "string" || v.seed === null) &&
    typeof v.savedAt === "number" &&
    !!v.overrides &&
    typeof v.overrides === "object"
  );
}

/** The library the designer uses. One per runtime, like every other store. */
export const savedThemes = new SavedThemeLibrary();
