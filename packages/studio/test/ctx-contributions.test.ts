/**
 * @file Plugin contributions and D2's universal group — `axf-context-menus` P3.
 *
 * Its gate, verbatim: *a plugin item renders in the menu with no import from the
 * host module, and does not leak into another module.*
 *
 * BOTH HALVES ARE STRUCTURAL HERE, and that is the thing worth noticing about
 * this file rather than any individual assertion.
 *
 * - *No import from the host module.* This file imports no module, and there is
 *   no module to import: `module:a` and `module:b` are ids in a map and strings
 *   in a payload. That is the entire mechanism — a plugin names an AREA, and an
 *   area is a name. If a contribution needed a handle on its host, this test
 *   could not have been written without one.
 * - *Does not leak.* Nothing in `contributions.ts` implements that rule. The row
 *   is stored against `module:a`; `module:a` is on the area path only when the
 *   click was physically inside it; an area off the path contributes nothing.
 *   Scoping is a consequence of the resolver, so the assertion below is really
 *   checking that no special case crept in to undo it.
 *
 * Also here, because P3's real risk is not the happy path:
 *
 * - the peel closure genuinely counts a menu-only plugin (the step's stated
 *   reason for reusing the point machinery, and the half that was silently
 *   false until `ctxContributorsFor` existed — `closureOf` walks the module's
 *   OWN points, and `ctx.item` is core's);
 * - two plugins may put a row with the same id in the same area, because
 *   neither can see the other and "you lose, install fewer plugins" is not a
 *   contract;
 * - a refused contribution is REPORTED naming who made it, never dropped;
 * - the universal group is on every menu, last of what the map contributes, and
 *   off exactly where an area says so — and `suppressUniversal` is honoured
 *   from the area the click was ROOTED in, not from an ancestor, or `shell`
 *   would strip the basics from the whole app in one line.
 *
 * NO DOM, same as its P1 sibling: the walk is typed against `dataset` +
 * `parentElement`, so a plain object is a valid element. Imports go through
 * `scripts/_axf-ctx-stub.ts` for the reason written at the top of that file —
 * core's barrel re-exports `.tsx` and Node's type stripping will not transform
 * JSX. The stub reaches the REAL `Registry`; a stubbed one would be testing the
 * wrong thing, since the whole point of the phase is that menu rows travel
 * through the registry core already has.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AREA_UNIVERSAL,
  CTX_ITEM_POINT,
  MenuMap,
  Registry,
  UNIVERSAL_ITEMS,
  commands,
  composeMenu,
  contributedItemId,
  ctxContributorsFor,
  ctxItem,
  declareCtxItemPoint,
  declareUniversalArea,
  installCtxContributions,
  predicates,
  resolveAreaPath,
  universalMenu,
  universalSuppressedBy
} from "../scripts/_axf-ctx-stub.ts";
import type {
  AreaElement,
  ComposeInput,
  CtxItem,
  CtxTarget,
  MenuItem,
  Module
} from "../scripts/_axf-ctx-stub.ts";

/* ------------------------------------------------------------- fake tree -- */

interface Fake {
  dataset: Record<string, string | undefined>;
  parentElement: Fake | null;
}

const node = (data: Record<string, string> = {}, parent: Fake | null = null): Fake => ({
  dataset: { ...data },
  parentElement: parent
});

/** Build a chain from the levels given OUTERMOST first; returns the innermost. */
function chain(...levels: Record<string, string>[]): Fake {
  let parent: Fake | null = null;
  for (const level of levels) parent = node(level, parent);
  return parent as Fake;
}

const area = (id: string) => ({ axfArea: id });

const TARGET: CtxTarget = {
  element: null,
  label: "Row 7",
  selection: "",
  editable: false,
  value: "seven"
};

function input(el: Fake | null, map: MenuMap): ComposeInput {
  return {
    path: resolveAreaPath(el as AreaElement, { map, warn: false }),
    target: TARGET,
    clipboard: { text: null, unreadable: null },
    signedIn: false,
    user: null
  };
}

/** Walk and compose against the SAME map — composing with the singleton while
 *  resolving against a test map silently produces an empty menu. */
function compose(el: Fake | null, map: MenuMap): CtxItem[] {
  return composeMenu(input(el, map), { map, noticeUndeclared: false });
}

const labels = (items: readonly CtxItem[]): string[] => items.map((i) => i.label);

/** Register throwaway commands for the duration of one test. */
function withCommands(ids: string[], run: () => void): void {
  const off = ids.map((id) => commands.register({ id, title: id, run: () => {} }));
  try {
    run();
  } finally {
    for (const undo of off) undo();
  }
}

/**
 * A map with two module areas, each OWNED by its module.
 *
 * `owner` is not decoration: it is how `ctxContributorsFor` attributes an area
 * to a module, and it is what `registerModuleMenus` fills in for a module that
 * declares its menus on its decl. An area with no owner is in nobody's closure.
 */
function twoModules(): MenuMap {
  const map = new MenuMap();
  map.declareArea({ id: "module:a", title: "Module A", owner: "a" });
  map.declareArea({ id: "module:b", title: "Module B", owner: "b" });
  return map;
}

/** A registry with `ctx.item` declared and its closure source wired to `map`. */
function registryFor(map: MenuMap): Registry {
  const reg = new Registry();
  declareCtxItemPoint(reg, map);
  return reg;
}

const EXPORT_ROW: MenuItem = {
  id: "export",
  label: "Export…",
  command: "acme.export"
};

/* ------------------------------------------------------------- the point -- */

test("ctx.item is a real point on the registry, and declaring it twice is safe", () => {
  const map = twoModules();
  const reg = registryFor(map);

  const point = reg.points().find((p) => p.id === "ctx.item");
  assert.ok(point, "ctx.item should be declared on the registry");
  assert.equal(point?.cardinality, "many");
  assert.deepEqual([...(point?.requires ?? [])], ["area", "item"]);

  // A remount re-runs the host's declaration. It must not throw, and it must not
  // wire a second closure source (which would be invisible until a closure
  // started returning duplicates).
  assert.doesNotThrow(() => declareCtxItemPoint(reg, map));
  assert.equal(reg.points().filter((p) => p.id === "ctx.item").length, 1);
});

test("a contribution missing the point's required fields is refused by the registry", () => {
  const map = twoModules();
  const reg = registryFor(map);

  reg.contribute({ from: "broken", point: CTX_ITEM_POINT.id, payload: { area: "module:a" } });
  const violation = reg.violations().find((v) => v.from === "broken");
  assert.ok(violation, "a payload with no item should be a violation");
  assert.match(violation?.problem ?? "", /item/);
});

/* --------------------------------------------------------------- the gate -- */

test("GATE: a plugin row renders inside module:a and does not leak into module:b", () => {
  const map = twoModules();
  const reg = registryFor(map);

  withCommands(["acme.export"], () => {
    // The whole of the plugin's knowledge of its host: the string "module:a".
    reg.contribute(ctxItem("acme-exporter", "module:a", EXPORT_ROW));
    assert.deepEqual(installCtxContributions({ registry: reg, map, warn: false }), []);

    const inA = compose(chain(area("shell"), area("module:a"), area("row")), map);
    assert.ok(labels(inA).includes("Export…"), `expected the plugin row in module:a, got ${labels(inA).join(", ")}`);

    // ── the leak half ──
    const inB = compose(chain(area("shell"), area("module:b"), area("row")), map);
    assert.equal(
      labels(inB).includes("Export…"),
      false,
      `the plugin row leaked into module:b: ${labels(inB).join(", ")}`
    );
    assert.deepEqual(
      inB.filter((i) => i.origin?.item.startsWith("acme-exporter")),
      [],
      "no row from acme-exporter should survive in another module"
    );
  });
});

test("a contributed row is attributed to the plugin that made it, not to the area", () => {
  const map = twoModules();
  const reg = registryFor(map);

  withCommands(["acme.export"], () => {
    reg.contribute(ctxItem("acme-exporter", "module:a", EXPORT_ROW));
    installCtxContributions({ registry: reg, map, warn: false });

    const row = compose(chain(area("module:a")), map).find((i) => i.label === "Export…");
    assert.ok(row);
    assert.equal(row?.origin?.area, "module:a");
    // "Why is this row in my menu" has to have an answer, and P4's overlay keys
    // its edits on this pair.
    assert.equal(row?.origin?.item, contributedItemId("acme-exporter", "export"));
    assert.equal(row?.command, "acme.export");
  });
});

test("two plugins may contribute the same item id to one area", () => {
  const map = twoModules();
  const reg = registryFor(map);

  withCommands(["one.export", "two.export"], () => {
    reg.contribute(ctxItem("plugin-one", "module:a", { id: "export", label: "Export as CSV", command: "one.export" }));
    reg.contribute(ctxItem("plugin-two", "module:a", { id: "export", label: "Export as JSON", command: "two.export" }));

    // Neither plugin can see the other, so a collision between them is not a
    // defect either of them can fix — and "whichever registered first wins" would
    // make a plugin's behaviour depend on what else is installed.
    assert.deepEqual(installCtxContributions({ registry: reg, map, warn: false }), []);

    const shown = labels(compose(chain(area("module:a")), map));
    assert.ok(shown.includes("Export as CSV"));
    assert.ok(shown.includes("Export as JSON"));
  });
});

test("installing twice does not double the rows", () => {
  const map = twoModules();
  const reg = registryFor(map);

  withCommands(["acme.export"], () => {
    reg.contribute(ctxItem("acme-exporter", "module:a", EXPORT_ROW));
    installCtxContributions({ registry: reg, map, warn: false });
    installCtxContributions({ registry: reg, map, warn: false });

    const rows = compose(chain(area("module:a")), map).filter((i) => i.label === "Export…");
    assert.equal(rows.length, 1, "a host that drains the registry twice must not double the menu");
  });
});

/* -------------------------------------------------------- refusals report -- */

test("a contribution to an undeclared area is reported by name, not dropped", () => {
  const map = twoModules();
  const reg = registryFor(map);

  withCommands(["acme.export"], () => {
    reg.contribute(ctxItem("acme-exporter", "module:typo", EXPORT_ROW));
    const problems = installCtxContributions({ registry: reg, map, warn: false });

    assert.equal(problems.length, 1);
    assert.equal(problems[0].from, "acme-exporter");
    assert.equal(problems[0].area, "module:typo");
    assert.match(problems[0].problem, /no area is declared/);
  });
});

test("a contribution naming an unregistered command is reported, and the others still install", () => {
  const map = twoModules();
  const reg = registryFor(map);

  withCommands(["acme.export"], () => {
    reg.contribute(ctxItem("acme-exporter", "module:a", EXPORT_ROW));
    reg.contribute(ctxItem("ghost", "module:a", { id: "vanish", label: "Vanish", command: "ghost.gone" }));

    const problems = installCtxContributions({ registry: reg, map, warn: false });
    assert.equal(problems.length, 1);
    assert.equal(problems[0].from, "ghost");
    assert.match(problems[0].problem, /not registered/);

    // One bad plugin must not cost the user every other plugin's rows.
    assert.ok(labels(compose(chain(area("module:a")), map)).includes("Export…"));
  });
});

/* ------------------------------------------------------------ the closure -- */

test("a menu-only plugin is carried in its host module's peel closure", () => {
  const map = twoModules();
  const reg = registryFor(map);

  // A module that declares NO points of its own. Before the closure source, its
  // closure was necessarily empty and a peeled app shipped without the row.
  //
  // Cast rather than built with `defineModule`, deliberately: the chokepoint
  // lives in `module.ts`, which pulls the nav validator and the menus decl in
  // with it, and this stub exists precisely to keep the test's module graph to
  // the plain-`.ts` ctx sources. `closureOf` reads `id` and `points` and nothing
  // else, so this is the whole of what a module is to the code under test.
  reg.registerModule({
    id: "a",
    title: "Module A",
    summary: "the host",
    route: "/a",
    points: [],
    component: () => null
  } as unknown as Module);

  withCommands(["acme.export"], () => {
    reg.contribute(ctxItem("acme-exporter", "module:a", EXPORT_ROW));
    installCtxContributions({ registry: reg, map, warn: false });

    assert.deepEqual(ctxContributorsFor("a", { registry: reg, map }), ["acme-exporter"]);
    assert.deepEqual(reg.closureOf("a")?.carries, ["acme-exporter"]);
    // And it is not carried by the module it does not touch.
    assert.deepEqual(ctxContributorsFor("b", { registry: reg, map }), []);
  });
});

/* --------------------------------------------------------- the universal -- */

/** The universal area and its rows, on a map, with their commands live.
 *
 *  The fifth row (0.0.20, "Module settings") also names a `when` PREDICATE.
 *  It is stubbed here to answer "not here" — which both satisfies the map's
 *  registration gate and keeps the row out of every composed menu, so the
 *  assertions about D2's four basics stay statements about the four basics.
 *  Registered once and left in place: the predicate registry is a process
 *  singleton and re-registration throws. */
function withUniversal(map: MenuMap, run: () => void): void {
  const ids = UNIVERSAL_ITEMS.map((i) => i.command as string);
  for (const item of UNIVERSAL_ITEMS) {
    if (item.when && !predicates.has(item.when)) {
      predicates.register({
        id: item.when,
        title: `${item.when} (test stub)`,
        test: () => "no module is hosted in this harness"
      });
    }
  }
  withCommands(ids, () => {
    declareUniversalArea(map);
    run();
  });
}

test("the universal group carries D2's four basics and is declared, not hard-coded", () => {
  const map = twoModules();
  withUniversal(map, () => {
    assert.ok(map.area(AREA_UNIVERSAL), "the universal band is an ordinary declared area");
    // Six AUTHORED rows since core 0.0.21: D2's four basics, the "Module
    // settings" row (0.0.20) and the "Toolbar settings" row (0.0.21). Both of
    // the additions are `when`-gated — to module surfaces and to a click inside
    // a bar — so both are absent from every composed menu in this harness (see
    // withUniversal), which is exactly why the AUTHORED list is asserted here
    // and the COMPOSED one is asserted in the test below.
    assert.deepEqual(
      map.itemsFor(AREA_UNIVERSAL).map((i) => i.id),
      ["copy-value", "copy-path", "inspect", "reload", "module-settings", "toolbar-settings"]
    );
    // Declaring twice is a remount, not a bug.
    assert.doesNotThrow(() => declareUniversalArea(map));
  });
});

test("the universal group is composed last, after every area's rows", () => {
  const map = twoModules();
  withCommands(["acme.export"], () => {
    map.contribute("module:a", [EXPORT_ROW]);
    withUniversal(map, () => {
      const el = chain(area("shell"), area("module:a"));
      const rows = [...compose(el, map), ...universalRows(el, map)];
      const shown = labels(rows).filter(Boolean);

      assert.ok(shown.includes("Export…"));
      assert.deepEqual(shown.slice(-4), ["Copy value", "Copy path", "Inspect", "Reload"]);
    });
  });
});

test("an area can suppress the universal group, and only the area the click is rooted in can", () => {
  const map = new MenuMap();
  // The canvas genuinely has no "value" and no "path" worth copying, so it opts
  // out. `shell` does NOT — an outer veto would empty every menu in the app.
  map.declareArea({ id: "shell", title: "Shell", owner: "core", suppressUniversal: true });
  map.declareArea({ id: "canvas", title: "Canvas", owner: "art", suppressUniversal: true });
  map.declareArea({ id: "panel", title: "Panel", owner: "art" });

  withUniversal(map, () => {
    const rooted = resolveAreaPath(chain(area("shell"), area("canvas")) as AreaElement, { map, warn: false });
    assert.equal(universalSuppressedBy(rooted, map), "canvas");

    // The same `shell` is an ancestor here, and it does not get a veto: the
    // innermost declared area is the one that decides.
    const inner = resolveAreaPath(chain(area("shell"), area("canvas"), area("panel")) as AreaElement, { map, warn: false });
    assert.equal(universalSuppressedBy(inner, map), null);
  });
});

test("a plugin can contribute to the universal group like any other area", () => {
  const map = twoModules();
  withCommands(["acme.about"], () => {
    withUniversal(map, () => {
      const reg = registryFor(map);
      reg.contribute(
        ctxItem("acme-exporter", AREA_UNIVERSAL, {
          id: "about",
          label: "About",
          command: "acme.about",
          order: 90
        })
      );
      assert.deepEqual(installCtxContributions({ registry: reg, map, warn: false }), []);

      const shown = labels(universalRows(chain(area("module:a")), map));
      assert.deepEqual(shown, ["Copy value", "Copy path", "Inspect", "Reload", "About"]);
    });
  });
});

test("Copy value greys with a reason when the click holds nothing", () => {
  const map = twoModules();
  withUniversal(map, () => {
    const rows = universalRows(chain(area("module:a")), map, { ...TARGET, value: "" });
    const copyValue = rows.find((i) => i.label === "Copy value");
    assert.equal(copyValue?.disabledReason, "there is nothing here to copy");

    // …and is live when it does. A row that is always greyed is a row nobody
    // learns to use.
    const live = universalRows(chain(area("module:a")), map).find((i) => i.label === "Copy value");
    assert.equal(live?.disabledReason, undefined);
  });
});

/* ---------------------------------------------------------------- helper -- */

/**
 * The universal band for a click, composed the way `ContextMenuRoot` does.
 *
 * Written against `universalMenu` through a local wrapper rather than inlined at
 * six call sites, because the target override is what the Copy value test needs
 * and threading it through by hand each time is how two of these assertions
 * would end up testing slightly different clicks.
 */
function universalRows(el: Fake | null, map: MenuMap, target: CtxTarget = TARGET): CtxItem[] {
  return universalMenu({ ...input(el, map), target }, { map });
}
