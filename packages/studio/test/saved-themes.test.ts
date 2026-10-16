/**
 * The saved-theme shelf, under the 2026-08-12 contract: a look is THE VALUES.
 *
 * (This file replaced `theme-lock.test.ts`. The lock died earlier the same
 * week; the pack-selection and per-surface chrome halves of a saved look died
 * with the style-pack removal — branding is a fixed app setting a look must
 * not carry, and the banner/nav selection lives INSIDE the values as the
 * `bannerBar`/`navMenu` chrome dials, so it needs no machinery of its own.)
 *
 * The library takes injectable storage precisely so this can run headlessly:
 * no `window`, no `localStorage`, no JSX.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SavedThemeLibrary, slugOf } from "../src/plugins/theme-designer/saved-store.ts";
import type { SavedStorage, SavedTheme } from "../src/plugins/theme-designer/saved-store.ts";
import { mergeShelves, shelfFromDoc } from "../src/plugins/theme-designer/shelf-sync.ts";

/** A storage that is just a Map, so a test can also inspect what was written. */
function storage(): SavedStorage & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => void map.set(k, v),
    dump: () => Object.fromEntries(map)
  };
}

test("a saved look is the values — chrome dials ride inside them", () => {
  const lib = new SavedThemeLibrary(storage());
  const values = {
    accent: "#ff7a1a",
    navStyle: "labeled",
    gridColumns: 2,
    // The chrome selection IS two dials, so a look carries its bar and menu
    // with no separate record — that is the whole point of the dial shape.
    bannerBar: "custom-my-bar",
    navMenu: "console-nav"
  };
  const entry = lib.save(
    { name: "Exact look", values, seed: "qmsd6q", options: {}, overrides: { accent: "#ff7a1a" } },
    1_000
  );
  assert.equal(entry.id, "exact-look");
  assert.deepEqual(entry.values, values);
  assert.equal(entry.seed, "qmsd6q", "the seed survives as provenance");
  assert.equal(entry.values?.bannerBar, "custom-my-bar");

  // Copied, not aliased: mutating the caller's object must not reach the shelf.
  (values as Record<string, unknown>).accent = "#000000";
  assert.equal(lib.get("exact-look")?.values?.accent, "#ff7a1a");
});

test("a look does NOT carry a pack selection, and old records that do still load", () => {
  const disk = storage();
  // A record from the era when looks carried packs and surfaces — written raw,
  // as localStorage would actually hold it.
  const legacy = {
    id: "old-look",
    name: "Old look",
    seed: "aa1111",
    options: {},
    overrides: { accent: "#123456" },
    packs: { "style-package": "axf-vapor", "branding-package": "signal-branding" },
    surfaces: { toolbars: { "app.banner": "console-bar" }, navs: {} },
    savedAt: 500
  };
  disk.write("axs:saved-themes@1", JSON.stringify([legacy]));

  const lib = new SavedThemeLibrary(disk);
  assert.equal(lib.list().length, 1, "a legacy record must still load");
  assert.equal(lib.get("old-look")?.overrides.accent, "#123456");

  // And a NEW save writes no pack field: branding is an app setting, and a
  // look that recorded one would silently change a global setting on apply.
  const entry = lib.save({ name: "Fresh", seed: null, options: {}, overrides: {} }, 1_000);
  assert.equal("packs" in entry, false, "a new record must not carry packs");
  assert.equal("surfaces" in entry, false, "a new record must not carry surfaces");
});

test("saving under an existing name replaces it, and does not stack up", () => {
  const lib = new SavedThemeLibrary(storage());
  const input = { seed: "ab3k9m", options: {}, overrides: {} };
  lib.save({ ...input, name: "Draft" }, 1_000);
  lib.save({ ...input, name: "draft" }, 2_000);
  lib.save({ ...input, name: "  DRAFT  " }, 3_000);

  assert.equal(lib.list().length, 1, "three saves of one name left more than one row");
  assert.equal(lib.list()[0]?.savedAt, 3_000, "the replacement is not the surviving one");
  assert.equal(slugOf("  DRAFT  "), "draft");
  assert.equal(slugOf("!!!"), "untitled", "a name of punctuation still has to address a row");
});

test("the shelf survives a reload and a corrupt shelf starts empty", () => {
  const disk = storage();
  new SavedThemeLibrary(disk).save({ name: "Keep", seed: "ab3k9m", options: {}, overrides: {} }, 1_000);
  assert.equal(new SavedThemeLibrary(disk).list().length, 1);

  const corrupt = storage();
  corrupt.write("axs:saved-themes@1", "[ {broken");
  assert.deepEqual(new SavedThemeLibrary(corrupt).list(), []);
});

test("a record saved before values existed has none, and is still a valid look", () => {
  const lib = new SavedThemeLibrary(storage());
  const old = lib.save({ name: "Old", seed: "aa1111", options: {}, overrides: {} }, 1_000);
  assert.equal("values" in old, false);
  // The restore path falls back to the overrides for these — absent must not
  // become an empty object, or "no opinion" would read as "every dial unset".
  assert.equal(lib.get("old")?.values, undefined);
});

test("replaceAll is the only bulk writer and it notifies", () => {
  const lib = new SavedThemeLibrary(storage());
  let notified = 0;
  lib.subscribe(() => void notified++);
  lib.save({ name: "One", seed: null, options: {}, overrides: {} }, 1_000);
  const mine = lib.list();
  lib.replaceAll([...mine, { ...mine[0], id: "two", name: "Two", savedAt: 2_000 }]);
  assert.equal(lib.list().length, 2);
  assert.equal(notified, 2, "save and replaceAll each notify exactly once");
});

/* --------------------------------------------------------------- the mirror */

test("merging two shelves keeps both, newest wins per id, never drops a look", () => {
  const at = (id: string, savedAt: number) =>
    ({ id, name: id, seed: null, options: {}, overrides: {}, savedAt }) as SavedTheme;

  // Two browsers, each with a look the other has never seen.
  const merged = mergeShelves([at("here", 10)], [at("there", 20)]);
  assert.deepEqual(merged.map((m) => m.id), ["there", "here"], "newest first, both survive");

  // Same name edited in both: the newer save is the one that survives, which is
  // the rule saving already uses locally.
  const conflict = mergeShelves([at("look", 10)], [at("look", 99)]);
  assert.equal(conflict.length, 1);
  assert.equal(conflict[0].savedAt, 99);
});

test("a foreign or empty kv document reads as an empty shelf, never a crash", () => {
  assert.deepEqual(shelfFromDoc(undefined), []);
  assert.deepEqual(shelfFromDoc({}), []);
  assert.deepEqual(shelfFromDoc({ themes: "not an array" }), []);
  assert.deepEqual(shelfFromDoc({ themes: [{ nope: 1 }] }), [], "entries without an id are not looks");
  assert.equal(shelfFromDoc({ themes: [{ id: "ok", savedAt: 1 }] }).length, 1);
});
