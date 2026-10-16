/**
 * The dashboard AUTHORING contract — the gate for the kind's second half.
 *
 * `check:dashboard` already drives the original chokepoint and resolver (a
 * wrapper is registered, a stale id substitutes and reports). None of that
 * touches what arrived on 2026-08-12: a wrapper is now a serialisable RECORD
 * with per-dial switches and a seeded generator, and three of its properties
 * are load-bearing in a way that fails silently if they regress.
 *
 *   1. **A wrapper with nothing switched on IS the theme default.** That is
 *      the owner's stated starting point ("default matches theme default"),
 *      and it is a property of `resolveDash`, not a claim in a docblock.
 *   2. **An inactive dial resolves to its DEFAULT, never to its stored
 *      value.** This is what makes a switch reversible: turning a dial off
 *      must not destroy the roll that produced it, and turning it back on must
 *      bring the same value back.
 *   3. **The roll draws every dial always and keeps only the active ones.**
 *      The alternative — skipping the draw for an inactive dial — shifts every
 *      later draw by one, so flipping ONE switch silently changes every dial
 *      after it in the spec and a seed stops reproducing. `rollTheme` carries
 *      the same rule and the same comment; that one was found by shipping the
 *      bug, so this one is tested before it can be.
 *
 * Pure functions over pure data, so this is a Node test and not a browser one.
 * `Wrapper.tsx` — the rendering half — is deliberately out of reach here; its
 * harness is a browser.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DASH_DIALS,
  DASH_DIALS_BY_ID,
  DIALS,
  DashboardRegistry,
  DashboardSpecError,
  dashDialsBySubsystem,
  dashName,
  defaultDashValues,
  defineDashboard,
  defineDashboardSpec,
  emptyDashboardSpec,
  inheritedTheme,
  resolveDash,
  rollDash
} from "@axf/core";
import type { DashboardSpec } from "@axf/core";

/* ------------------------------------------------------------------ helpers */

const spec = (over: Partial<DashboardSpec> = {}): DashboardSpec =>
  defineDashboardSpec({
    id: "custom-test",
    title: "Test",
    description: "A wrapper for the gate.",
    display: defaultDashValues(),
    theme: {},
    active: [],
    inherit: [],
    ...over
  });

/** A dial of each kind, taken FROM the spec rather than named — so this test
 *  keeps working when the vocabulary changes, which it will. */
const anEnum = DASH_DIALS.find((d) => d.kind === "enum")!;
const aNumber = DASH_DIALS.find((d) => d.kind === "number")!;

/* --------------------------------------------------------- 1 — the record */

test("the chokepoint refuses what a picker and a registry cannot survive", () => {
  assert.throws(() => spec({ id: "Bad_Id" }), DashboardSpecError);
  assert.throws(() => spec({ title: "   " }), DashboardSpecError);
  assert.throws(() => spec({ description: "" }), DashboardSpecError);
});

test("a display value for a dial the spec has never heard of is DROPPED, not stored", () => {
  // A record outlives the spec that wrote it: a dial gets renamed or removed
  // and the stored document still names it. Dropping is right — keeping it
  // would let `resolveDash` hand a renderer a key with no dial behind it.
  const s = spec({ display: { ...defaultDashValues(), notADial: "boom" } as never });
  assert.equal("notADial" in s.display, false);
  assert.equal(s.display[anEnum.id], anEnum.default);
});

test("the record round-trips through JSON — that is the whole point of the kind", () => {
  const s = spec({ active: [anEnum.id], theme: { accent: "#ff0000" }, inherit: ["accent"], seed: "abc123" });
  assert.deepEqual(defineDashboardSpec(JSON.parse(JSON.stringify(s)) as DashboardSpec), s);
});

/* --------------------------------------------- 2 — nothing on = the default */

test("a wrapper with no dial active resolves to EXACTLY the dial defaults", () => {
  // The owner's starting point, as an assertion: a fresh dashboard adds
  // nothing to the theme, so `New dashboard` cannot change how the app looks
  // until a switch is turned on.
  assert.deepEqual(resolveDash(emptyDashboardSpec("custom-fresh", "Fresh")), defaultDashValues());
});

test("an INACTIVE dial resolves to its default even when the record holds a rolled value", () => {
  const rolledValue = anEnum.options.find((o) => o !== anEnum.default)!;
  const s = spec({ display: { ...defaultDashValues(), [anEnum.id]: rolledValue }, active: [] });

  // Off: the default is in force …
  assert.equal(resolveDash(s)[anEnum.id], anEnum.default);
  // … and the record still HOLDS the value, so switching back on restores it
  // rather than requiring another roll. A switch that destroys its value is a
  // delete button wearing a toggle's clothes.
  assert.equal(s.display[anEnum.id], rolledValue);
  assert.equal(resolveDash({ ...s, active: [anEnum.id] })[anEnum.id], rolledValue);
});

/* ------------------------------------------------------------ 3 — the roll */

test("the same seed and the same switches produce the same wrapper, always", () => {
  const active = DASH_DIALS.map((d) => d.id);
  assert.deepEqual(rollDash("amberx", active), rollDash("amberx", active));
  assert.notDeepEqual(rollDash("amberx", active), rollDash("amberz", active));
});

test("every dial is DRAWN always — flipping one switch cannot move another dial", () => {
  // The regression that would otherwise be invisible: if the generator skipped
  // the draw for an inactive dial, every dial after it in `DASH_DIALS` would
  // take the number its predecessor should have had, and the same seed would
  // produce a different wrapper depending on which switches happened to be up.
  const all = DASH_DIALS.map((d) => d.id);
  const withAll = rollDash("amberx", all);
  const withoutFirst = rollDash("amberx", all.filter((id) => id !== DASH_DIALS[0].id));

  assert.equal(withoutFirst[DASH_DIALS[0].id], DASH_DIALS[0].default, "the switched-off dial is not rolled");
  for (const dial of DASH_DIALS.slice(1)) {
    assert.equal(
      withoutFirst[dial.id],
      withAll[dial.id],
      `dial "${dial.id}" moved when a DIFFERENT dial was switched off — the draw was skipped, not the value`
    );
  }
});

test("a rolled value is always inside the dial's own declared range", () => {
  // A roll must be able to rearrange the chrome without being able to break
  // it. Twenty seeds is enough to catch an off-by-one in the quantiser.
  for (let i = 0; i < 20; i += 1) {
    const values = rollDash(`seed-${i}`, DASH_DIALS.map((d) => d.id));
    for (const dial of DASH_DIALS) {
      const value = values[dial.id];
      if (dial.kind === "enum") {
        assert.ok(dial.options.includes(String(value)), `${dial.id} rolled "${value}", not a declared option`);
      } else {
        assert.ok(
          Number(value) >= dial.min && Number(value) <= dial.max,
          `${dial.id} rolled ${value}, outside ${dial.min}..${dial.max}`
        );
      }
    }
  }
});

test("the name is deterministic too — a rolled wrapper is referable in speech", () => {
  assert.equal(dashName("amberx"), dashName("amberx"));
  assert.match(dashName("amberx"), /^\w+ \w+$/);
});

/* --------------------------------------------------------- 4 — inheritance */

test("the theme takes only what is BOTH active and inherited, and only with a value", () => {
  const s = spec({
    theme: { accent: "#ff0000", radius: 14, gap: 20 },
    active: ["accent", "radius", "motionMs"],
    // `gap` is inherited but never switched on; `motionMs` is switched on but
    // carries no value; `radius` is switched on but not inherited.
    inherit: ["accent", "gap", "motionMs"]
  });
  assert.deepEqual(inheritedTheme(s), { accent: "#ff0000" });
});

test("nothing inherited means the theme is untouched — a wrapper is not a second publisher", () => {
  const s = spec({ theme: { accent: "#ff0000" }, active: ["accent"], inherit: [] });
  assert.deepEqual(inheritedTheme(s), {});
});

/* ------------------------------------------------- 5 — the registry's half */

test("an AUTHORED wrapper seeded before code registers never becomes the app's floor", () => {
  /*
   * The real ordering, and the bug it caused (observed live, 2026-08-12).
   *
   * `<PacksSeed>` seeds authored wrappers during the RENDER phase; code
   * registers from `Subsystem.start()`, which `kernel.boot()` awaits — a later
   * microtask. So the DOCUMENT lands first. While `upsert` claimed the default
   * the way `register` does, one saved wrapper with no selection anywhere made
   * every route render it instead of the built-in.
   *
   * The rule: code's first `register()` owns the floor whichever order the two
   * arrive in, and the app is never chrome-less in the meantime.
   */
  const reg = new DashboardRegistry();
  const make = (id: string) =>
    defineDashboard({ id, title: id, description: "x", render: (ctx) => ctx.children });

  reg.upsert(make("custom-authored"));
  // Nothing from code yet — the authored one stands in, because no chrome at
  // all is the one outcome worse than the wrong chrome.
  assert.equal(reg.resolve().dashboard?.id, "custom-authored");
  assert.equal(reg.resolve().substituted, false);

  reg.register(make("dash-builtin"));
  assert.equal(reg.floorId(), "dash-builtin", "code's first registration takes the floor back");
  assert.equal(reg.resolve().dashboard?.id, "dash-builtin");
  assert.equal(
    reg.candidates()[0].id,
    "dash-builtin",
    "the picker's 'app default' chip reads candidates()[0] — it has to agree with resolve()"
  );

  // And an authored wrapper arriving AFTER code still does not take it.
  reg.upsert(make("custom-later"));
  assert.equal(reg.floorId(), "dash-builtin");
});

test("upsert REPLACES rather than duplicating, and never steals the default", () => {
  const reg = new DashboardRegistry();
  const make = (id: string, title: string) =>
    defineDashboard({ id, title, description: "x", render: (ctx) => ctx.children });

  reg.register(make("dash-a", "A"));
  reg.upsert(make("dash-b", "B"));
  reg.upsert(make("dash-b", "B revised"));

  assert.equal(reg.candidates().length, 2, "upserting an existing id must not add a second entry");
  assert.equal(reg.candidates().find((d) => d.id === "dash-b")?.title, "B revised");
  // Replacing in place must not hand the default to somebody else: the first
  // registration owns it, and it is what every fallback lands on.
  assert.equal(reg.resolve().dashboard?.id, "dash-a");
});

test("removing the selected wrapper substitutes and SAYS SO — contract rule 4", () => {
  const reg = new DashboardRegistry();
  const make = (id: string) =>
    defineDashboard({ id, title: id, description: "x", render: (ctx) => ctx.children });

  reg.register(make("dash-a"));
  reg.upsert(make("dash-b"));
  reg.activate("dash-b");
  assert.equal(reg.resolve().substituted, false);

  reg.remove("dash-b");
  const after = reg.resolve();
  assert.equal(after.dashboard?.id, "dash-a", "a deleted wrapper must fall back, never blank the shell");
  assert.equal(after.substituted, true);
  assert.equal(after.requestedId, "dash-b", "the substitution has to name what was asked for");

  // And re-registering heals it live, with the stored preference intact.
  reg.upsert(make("dash-b"));
  assert.equal(reg.resolve().dashboard?.id, "dash-b");
  assert.equal(reg.resolve().substituted, false);
});

test("removing the DEFAULT hands the floor to what is left, never to nothing", () => {
  // A dangling default resolves to null, and null is an app with no chrome —
  // the one outcome this kind exists to make impossible.
  const reg = new DashboardRegistry();
  const make = (id: string) =>
    defineDashboard({ id, title: id, description: "x", render: (ctx) => ctx.children });

  reg.register(make("dash-a"));
  reg.upsert(make("dash-b"));
  reg.remove("dash-a");

  assert.equal(reg.resolve().dashboard?.id, "dash-b");
  reg.remove("dash-b");
  assert.equal(reg.resolve().dashboard, null, "with nothing registered there is honestly nothing");
});

/* ---------------------------------------------------------- 6 — the spec's own shape */

test("every dial is grouped, uniquely identified, and carries an effect line", () => {
  // The designer renders FROM the spec, so a dial with no group never appears
  // and a dial with no effect line has nothing to say when it is hovered.
  const grouped = Object.values(dashDialsBySubsystem()).flat();
  assert.equal(grouped.length, DASH_DIALS.length);
  assert.equal(DASH_DIALS_BY_ID.size, DASH_DIALS.length, "two dials share an id");

  const vars = new Set<string>();
  for (const dial of DASH_DIALS) {
    assert.match(dial.cssVar, /^--axd-/, `${dial.id} publishes ${dial.cssVar} — dashboards own --axd-*, never --axf-*`);
    assert.equal(vars.has(dial.cssVar), false, `two dials publish ${dial.cssVar}`);
    vars.add(dial.cssVar);
    assert.ok(dial.effect.trim().length > 10, `${dial.id} has no effect line`);
    if (dial.kind === "enum") {
      assert.ok(dial.options.includes(dial.default), `${dial.id}'s default is not one of its options`);
    } else {
      assert.ok(dial.default >= dial.min && dial.default <= dial.max, `${dial.id}'s default is out of range`);
    }
  }
});

test("a dashboard dial can never collide with a theme dial — one `active` set holds both", () => {
  // `DashboardSpec.active` is ONE list of ids covering both specs, so a shared
  // id would make switching a wrapper dial on also switch a theme dial on —
  // and `DashboardTab`'s roll splits the two lists by membership of the
  // dashboard-dial set, so a collision would send the value to both engines.
  const themeIds = new Set(DIALS.map((d) => d.id));
  for (const dial of DASH_DIALS) {
    assert.equal(themeIds.has(dial.id), false, `"${dial.id}" is both a wrapper dial and a theme dial`);
  }
});

test("the theme's own `dashboard` chrome dial exists — the selection has somewhere to live", () => {
  const dial = DIALS.find((d) => d.id === "dashboard");
  assert.ok(dial, "no `dashboard` dial in the theme spec — nothing can select a wrapper");
  assert.equal(dial?.subsystem, "chrome");
  assert.equal(dial?.default, "", "empty must mean 'the registry default', or a fresh theme picks a wrapper for you");
});

test("aNumber is genuinely a number dial — the fixtures above mean what they say", () => {
  assert.equal(aNumber.kind, "number");
  assert.equal(anEnum.kind, "enum");
});
