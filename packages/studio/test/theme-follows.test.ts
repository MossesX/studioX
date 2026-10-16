/**
 * @file THE THEME-FOLLOWS LOCK — the half of it that Node can hold.
 *
 * The claim being locked, in one sentence: **the MUI theme is the same truth as
 * the custom properties, re-derived every time the store changes.** A bridge
 * that has quietly stopped bridging still builds a perfect MUI theme; it just
 * builds it from values nobody is updating any more. Nothing throws, nothing
 * warns, and the app looks deliberate — a `token()` card and an MUI `<Paper>`
 * beside it simply stop agreeing after the first roll.
 *
 * ## What this file proves, and what it deliberately cannot
 *
 * `AxfMuiRoot` is a `.tsx` component and Node's type stripping does not
 * transform JSX (`scripts/_axf-core-test-barrel.ts` says so at length, and the
 * barrel refuses to re-export it on purpose). So this file cannot mount the
 * bridge and cannot watch its subscription fire. That half is held by
 * `npm run check:mui` (`scripts/mui-probe.mjs`), which reads COMPUTED styles off
 * a real browser — and whose check 2 was sharpened on 2026-08-11 to say WHICH
 * of the two renderings stopped moving, so its red names the bridge instead of
 * saying "something did not change".
 *
 * What is left for Node is not a consolation prize. It is the three properties
 * the component's subscription RESTS ON, each of which can break silently and
 * none of which a browser probe can state precisely:
 *
 *   1. **The memo key.** `AxfMuiRoot` memoises `muiThemeFrom(...)` on the
 *      adopted `values` IDENTITY, not on its contents. That is only correct
 *      because `ThemeStore.state()` caches a snapshot and drops it on every
 *      mutation. If `values` ever became referentially stable across a roll —
 *      a plausible "optimisation", since the object is deep-equal for the same
 *      seed — the memo would never re-run and MUI would freeze while
 *      `AxfStyleRoot` kept publishing new custom properties. That is the exact
 *      shape of the failure this phase exists to catch, and it is invisible
 *      from the component.
 *   2. **Every mutation is a notification.** The bridge re-renders because the
 *      store told React it changed. A mutation that forgets `#changed()` is a
 *      dial that moves the persisted JSON and moves nothing on screen.
 *   3. **The two renderings agree.** For any state, `muiThemeFrom` and
 *      `resolveVariables` must land on the SAME value for the same dial. This
 *      is the half-light/half-dark regression of 2026-08-11 in assertable form,
 *      swept over many rolled themes rather than the one theme that was on
 *      screen when somebody looked.
 *
 * ## Why it is not a snapshot, and never should become one
 *
 * A guard that compares the bridge's source against a recorded string goes red
 * when the file is REFORMATTED and stays green when the file is unsubscribed —
 * both of which are the wrong answer. Every assertion below is a behaviour:
 * change the store, observe what the derivation does. The word "bridge" appears
 * in the failure messages, not in the assertions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ThemeStore, muiThemeFrom, resolveVariables, rollTheme } from "@axf/core";
import type { StyleInput, ThemeStorage } from "@axf/core";

/** A store with injectable storage — no `window`, no `localStorage`, and never
 *  the process singleton, which a mutation here would leak into every other
 *  test in the run (`theme-lock.test.ts` sets the same precedent). */
function store(): ThemeStore {
  const map = new Map<string, string>();
  const storage: ThemeStorage = {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => void map.set(k, v)
  };
  return new ThemeStore(storage);
}

/** The dial → MUI-path pairs where "the two renderings of one truth" is
 *  literally checkable: the same dial, read out of both renderers. */
const AGREEMENTS = [
  { variable: "--axf-accent", label: "palette.primary.main", read: (t: ReturnType<typeof muiThemeFrom>) => t.palette.primary.main },
  { variable: "--axf-page", label: "palette.background.default", read: (t: ReturnType<typeof muiThemeFrom>) => t.palette.background.default },
  { variable: "--axf-panel", label: "palette.background.paper", read: (t: ReturnType<typeof muiThemeFrom>) => t.palette.background.paper },
  { variable: "--axf-ink", label: "palette.text.primary", read: (t: ReturnType<typeof muiThemeFrom>) => t.palette.text.primary },
  { variable: "--axf-dim", label: "palette.text.secondary", read: (t: ReturnType<typeof muiThemeFrom>) => t.palette.text.secondary },
  { variable: "--axf-edge", label: "palette.divider", read: (t: ReturnType<typeof muiThemeFrom>) => t.palette.divider }
] as const;

/* ------------------------------------------------------------------------- */
/* 1 — the memo key: values identity IS the change signal                     */
/* ------------------------------------------------------------------------- */

test("state().values is referentially stable between changes — the memo runs once per theme", () => {
  const s = store();
  s.apply("ab3k9m");
  assert.equal(
    s.state().values,
    s.state().values,
    "two reads with no mutation between them returned different objects. `AxfMuiRoot` memoises " +
      "on this identity, so createTheme would run on every render — and `useSyncExternalStore` " +
      "would loop rather than merely be slow."
  );
});

test("EVERY mutation gives values a NEW identity — the signal the bridge re-derives on", () => {
  // This is the load-bearing one. Deep-equality is not asserted anywhere here
  // on purpose: the bridge does not compare contents, it compares identity, so
  // identity is what has to move.
  const mutations: Array<{ name: string; run: (s: ThemeStore) => void }> = [
    { name: "roll()", run: (s) => s.roll() },
    { name: "apply(seed)", run: (s) => s.apply("zq71fv") },
    { name: "setValue(accent)", run: (s) => s.setValue("accent", "#123456") },
    { name: "reset()", run: (s) => s.reset() }
  ];

  for (const { name, run } of mutations) {
    const s = store();
    s.apply("ab3k9m");
    s.setValue("radius", 9); // a non-default starting point, so reset() is a real change
    const before = s.state().values;
    run(s);
    const after = s.state().values;
    assert.notEqual(
      after,
      before,
      `${name} left state().values referentially IDENTICAL. AxfMuiRoot's useMemo key is that ` +
        `identity, so the MUI theme would never be rebuilt: token() surfaces would follow the ` +
        `change and every MUI surface would keep painting the previous theme. This is the ` +
        `"quietly stopped bridging" failure, and it is silent — nothing throws.`
    );
  }
});

test("every mutation notifies subscribers — the bridge only re-renders when told", () => {
  const cases: Array<{ name: string; run: (s: ThemeStore) => void }> = [
    { name: "roll()", run: (s) => s.roll() },
    { name: "apply(seed)", run: (s) => s.apply("zq71fv") },
    { name: "setValue()", run: (s) => s.setValue("accent", "#123456") },
    { name: "reset()", run: (s) => s.reset() }
  ];

  for (const { name, run } of cases) {
    const s = store();
    s.apply("ab3k9m");
    s.setValue("radius", 9);
    let notifications = 0;
    const unsubscribe = s.subscribe(() => void notifications++);
    run(s);
    unsubscribe();
    assert.ok(
      notifications > 0,
      `${name} changed the store without notifying anyone. React re-renders the bridge from ` +
        `this callback; a mutation that skips it moves the persisted theme and moves nothing ` +
        `on screen until the next unrelated render.`
    );
  }
});

test("unsubscribing really does stop the notifications", () => {
  // Non-vacuity for the test above: if subscribe() returned a no-op disposer,
  // the counter would rise no matter what and "notifications > 0" would prove
  // nothing. It is also the store-level shape of the P6 mutation.
  const s = store();
  let notifications = 0;
  const unsubscribe = s.subscribe(() => void notifications++);
  s.roll();
  const whileSubscribed = notifications;
  unsubscribe();
  s.roll();
  assert.ok(whileSubscribed > 0, "the listener never fired while subscribed");
  assert.equal(
    notifications,
    whileSubscribed,
    "a disposed listener still fired — subscribe()'s disposer does not dispose"
  );
});

/* ------------------------------------------------------------------------- */
/* 3 — the two renderings of one truth agree, over many themes                */
/* ------------------------------------------------------------------------- */

test("MUI and the custom properties resolve the SAME value for every shared dial", () => {
  // Swept over 64 seeds rather than the default theme, because the two
  // renderings agreeing on ONE theme is what the half-light/half-dark screen of
  // 2026-08-11 looked like right up until a pack was chosen.
  const s = store();
  for (let i = 0; i < 64; i++) {
    s.roll();
    const { values } = s.state();
    const vars = resolveVariables(values, null);
    const mui = muiThemeFrom(values);
    for (const { variable, label, read } of AGREEMENTS) {
      assert.equal(
        String(read(mui)),
        vars[variable],
        `seed ${s.state().seed}: ${label} is "${read(mui)}" while ${variable} is ` +
          `"${vars[variable]}". The two renderings have drifted, so an MUI surface and a ` +
          `token() surface on the same screen show different themes.`
      );
    }
  }
});

test("a pack can never move an --axf value — the theme is the only authority", () => {
  // INVERTED on 2026-08-12. This test used to assert "the pack must win" for
  // `--axf-accent`, and that mechanism was exactly the owner's "I rolled a
  // theme and nothing changed". A pack is a fixed app setting now: it decides
  // the `--gxb-*` roles its own drawings paint in, and nothing else.
  const s = store();
  const hostile: StyleInput = {
    variables: {
      // A pack trying to claim theme territory…
      "--axf-page": "#100c07",
      "--axf-panel": "#1a140d",
      "--axf-ink": "#efe9df",
      "--axf-accent": "#ffb454",
      // …and its own legitimate drawing roles.
      "--gxb-accent": "#ffb454",
      "--axf-brand-accent": "#ffb454"
    }
  };
  for (let i = 0; i < 32; i++) {
    s.roll();
    const { values } = s.state();
    const vars = resolveVariables(values, hostile);
    assert.equal(
      vars["--axf-accent"],
      String(values.accent),
      `seed ${s.state().seed}: a pack overrode --axf-accent — the dials are dead again`
    );
    assert.equal(
      vars["--axf-page"],
      String(values.page),
      `seed ${s.state().seed}: a pack overrode --axf-page`
    );
    assert.equal(
      vars["--gxb-accent"],
      "#ffb454",
      "the pack's own drawing role must still land — that is the half it owns"
    );
    // And MUI reads only the theme, by construction: there is no pack input,
    // so the two renderings agree on the theme's own value.
    assert.equal(String(muiThemeFrom(values).palette.primary.main), vars["--axf-accent"]);
  }
});

/* ------------------------------------------------------------------------- */
/* 4 — non-vacuity: each channel actually MOVES the MUI theme                 */
/* ------------------------------------------------------------------------- */

test("each channel the bridge listens on moves the MUI theme", () => {
  // Without this, every assertion above would pass against a bridge fed a
  // frozen constant: the two renderings would agree perfectly, on the wrong
  // theme, forever.
  const s = store();
  s.apply("ab3k9m");
  const base = muiThemeFrom(s.state().values);

  s.roll();
  assert.notEqual(
    muiThemeFrom(s.state().values).palette.primary.main,
    base.palette.primary.main,
    "a roll did not move the MUI palette"
  );

  s.reset();
  s.setValue("accent", "#0a7d55");
  assert.equal(
    muiThemeFrom(s.state().values).palette.primary.main,
    "#0a7d55",
    "a single-dial override did not reach the MUI palette — the overrides layer is dropped"
  );

  // The pack channel is GONE by design (2026-08-12): `muiThemeFrom` takes no
  // pack input, so there is no path left through which a pack could move the
  // MUI palette. The hostile-pack test above pins the resolver half.
});

test("the derivation is a pure function of the state, not of when it is called", () => {
  // The property that makes the memo safe in the other direction: same input,
  // same theme. If this stopped holding, the bridge would look "live" while
  // actually re-randomising, and check:mui's check 2 would pass for the wrong
  // reason — colours moving is not the same as colours FOLLOWING.
  const values = rollTheme("axfmui").values;
  assert.equal(
    muiThemeFrom(values).palette.primary.main,
    muiThemeFrom(values).palette.primary.main
  );
  assert.equal(
    muiThemeFrom(values).palette.background.paper,
    muiThemeFrom(rollTheme("axfmui").values).palette.background.paper,
    "the same seed produced two different MUI themes"
  );
});
