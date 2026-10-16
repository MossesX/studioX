/**
 * The designer's preview — a change that repaints everything and persists
 * nothing until it is applied.
 *
 * ## What the owner asked for, and why it is asserted HERE
 *
 * 2026-08-12: *"theme designer is not supposed to apply the theme to the app
 * across all pages until its saved and applied"*. The chosen shape (of three
 * offered) keeps the app-wide hot render — a palette is judged on real chrome —
 * and makes the preview disposable instead of scoping it to a panel.
 *
 * So "disposable" is the whole contract, and it is a property of the STORE, not
 * of the designer: `#persist()` is what refuses, so every writer gets the same
 * behaviour without knowing a preview exists. The designer is provably not the
 * only writer — `dashboards/amberx-console.tsx` sets dials on entry to the
 * console wrapper — so a preview enforced by disabled controls would not be one.
 * Asserted headlessly, with injectable storage and no UI in the picture.
 *
 * The bug this file would have caught on the first run: `beginPreview()` set the
 * flag without invalidating the cached snapshot, so `previewing` was true in the
 * store and false in every React surface reading it. The banner never appeared.
 * It was caught in a browser instead, which is exactly the trade this test
 * removes for the next change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ThemeStore } from "@axf/core";
import type { ThemeStorage } from "@axf/core";

/** A storage that is just a Map, so a test can inspect what was written. */
function storage(): ThemeStorage & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => void map.set(k, v),
    dump: () => Object.fromEntries(map)
  };
}

const KEY = "axf:theme@1";

/** What is actually on disk, as the next page load would read it. */
function persisted(s: ReturnType<typeof storage>): Record<string, unknown> {
  const raw = s.dump()[KEY];
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

test("a preview edit repaints but never reaches storage", () => {
  const s = storage();
  const store = new ThemeStore(s);

  store.setValue("accent", "#111111");
  const applied = persisted(s);
  assert.equal(
    (applied.overrides as Record<string, unknown>).accent,
    "#111111",
    "a normal edit still persists immediately — rule 2 is not repealed"
  );

  store.beginPreview();
  store.setValue("accent", "#222222");

  assert.equal(
    store.state().values.accent,
    "#222222",
    "the preview IS in force — the whole app repaints, that is the point"
  );
  assert.equal(
    (persisted(s).overrides as Record<string, unknown>).accent,
    "#111111",
    "…but storage still describes the APPLIED theme, so any other page loads it"
  );
});

test("previewing is on the snapshot, so React surfaces can see it", () => {
  const store = new ThemeStore(storage());

  assert.equal(store.state().previewing, false);
  store.beginPreview();
  // The regression guard. `state()` caches, so a flag set without invalidating
  // the snapshot is a flag no component ever observes.
  assert.equal(
    store.state().previewing,
    true,
    "beginPreview must invalidate the cached snapshot, not just set a field"
  );
  store.endPreview();
  assert.equal(store.state().previewing, false);
});

test("beginPreview notifies, so a mounted designer re-renders into the banner", () => {
  const store = new ThemeStore(storage());
  let notifications = 0;
  store.subscribe(() => void (notifications += 1));

  store.beginPreview();
  assert.ok(notifications > 0, "a state change nobody is told about is not a state change");
});

test("endPreview restores the applied theme exactly", () => {
  const s = storage();
  const store = new ThemeStore(s);

  store.setValue("accent", "#111111");
  store.setValue("page", "#000000");

  store.beginPreview();
  store.setValue("accent", "#999999");
  store.setValue("page", "#ffffff");
  store.endPreview();

  assert.equal(store.state().values.accent, "#111111");
  assert.equal(store.state().values.page, "#000000");
  assert.equal(
    store.state().previewing,
    false,
    "and the store is no longer previewing, so ordinary edits persist again"
  );
});

test("commitPreview is what 'applied' means — the values persist", () => {
  const s = storage();
  const store = new ThemeStore(s);

  store.setValue("accent", "#111111");
  store.beginPreview();
  store.setValue("accent", "#333333");
  store.commitPreview();

  assert.equal(
    (persisted(s).overrides as Record<string, unknown>).accent,
    "#333333",
    "Apply must reach storage, or it repaints and is gone on the first nav click"
  );
  assert.equal(store.state().values.accent, "#333333", "and nothing re-applies — it was already in force");
});

/*
 * Two tests stood here and were removed on 2026-08-12, the day they were
 * written: "a lock set during a preview persists only once it is committed" and
 * "the lock still wins over a preview". The lock was deleted from `ThemeStore`
 * the same afternoon, in a separate session, so both asserted an API that no
 * longer exists.
 *
 * Recorded rather than silently dropped because the SECOND one covered a real
 * interaction — a preview must not smuggle an edit past a refusal — and if any
 * refusing state is ever reintroduced (a lock, a read-only theme, a policy),
 * that assertion is the one to bring back.
 */

test("choosing a roll survives the next document — the roller's contract", () => {
  const s = storage();
  const store = new ThemeStore(s);
  store.setValue("accent", "#111111");

  // Exactly the sequence `Roller.apply()` runs, in order.
  store.beginPreview();
  store.apply("zq71fv");
  store.commitPreview();
  store.beginPreview();

  // A new store over the same storage is what the next nav click produces,
  // because the nav navigates with `window.location.assign`.
  const reloaded = new ThemeStore(s);
  assert.equal(
    reloaded.state().seed,
    "zq71fv",
    "a roll left uncommitted repaints the designer and nothing else — the owner saw " +
      "that as two different themes, dark on the designer and light everywhere else"
  );
});

test("stepping through history also survives — same act, same rule", () => {
  const s = storage();
  const store = new ThemeStore(s);
  store.apply("ab3k9m");
  store.apply("zq71fv");

  store.beginPreview();
  const moved = store.back();
  assert.ok(moved, "precondition: there is somewhere to step back to");
  store.commitPreview();
  store.beginPreview();

  assert.equal(new ThemeStore(s).state().seed, "ab3k9m");
});

test("preview state is never restored from storage — it cannot outlive a reload", () => {
  const s = storage();
  const first = new ThemeStore(s);
  first.setValue("accent", "#111111");
  first.beginPreview();
  first.setValue("accent", "#555555");

  // A new store over the SAME storage is what the next document does.
  const reloaded = new ThemeStore(s);
  assert.equal(reloaded.state().previewing, false);
  assert.equal(
    reloaded.state().values.accent,
    "#111111",
    "leaving the designer is a full document load, and that alone discards the preview"
  );
});
