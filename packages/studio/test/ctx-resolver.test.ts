/**
 * @file The context-menu resolver — `axf-context-menus` P1.
 *
 * Its gate, verbatim: *a composed menu from a 6-deep tree contains exactly the
 * nearest 4 areas' groups, in order, and the walk is measured.* Both halves are
 * here, plus the cases that decide whether an area-resolved menu is trustworthy
 * rather than merely working:
 *
 * - the D3 cap is a CONSTANT WITH A TEST, which the plan asks for by name — and
 *   an undeclared area must not spend a slot, or one typo costs twice;
 * - a row whose command was unregistered after the map was built renders greyed
 *   NAMING it, because the alternative is a row that does nothing when clicked;
 * - dividers appear between bands and nowhere else — no leading, trailing or
 *   doubled ones, and none introducing an area that ended up contributing
 *   nothing, which reads as something having failed to load.
 *
 * NO DOM, ON PURPOSE. The walk is typed against a structural node (`dataset` +
 * `parentElement`), so a plain object is a valid element and the deep-tree
 * measurement runs under `node --test` with no jsdom and no new dependency. That
 * same narrow type is what makes "no layout reads" a compile-time fact rather
 * than a promise — there is no `getBoundingClientRect` on the parameter to call.
 *
 * WHY THE IMPORTS GO THROUGH `scripts/_axf-ctx-stub.ts`. `@axf/core`'s barrel
 * re-exports React components from `.tsx` files and Node's type stripping does
 * not transform JSX, so importing the package entry under `node --test` dies on
 * the extension before a single assertion runs. The stub reaches the REAL ctx
 * sources — no copy — and lives in `scripts/` because that is where tooling that
 * spans both packages belongs, and because the import guard
 * (`isolation-guards.test.ts`) deliberately scans `test/` and would rightly
 * refuse a core deep path written here. The guard is left exactly as it is: the
 * barrel is still the one way in for anything that reads like SDK code.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AREA_ATTR,
  MAX_CONTRIBUTING_AREAS,
  MenuMap,
  clearUndeclaredAreaWarnings,
  commands,
  composeMenu,
  predicates,
  resolveAreaPath
} from "../scripts/_axf-ctx-stub.ts";
import type {
  AreaElement,
  ComposeInput,
  CtxItem,
  CtxTarget,
  MenuItem
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

const area = (id: string, extra: Record<string, string> = {}) => ({ axfArea: id, ...extra });

/** A chain `depth` nodes long, an area every `every` nodes, innermost returned. */
function deepTree(depth: number, every = 8): Fake {
  let parent: Fake | null = null;
  for (let i = 0; i < depth; i++) {
    parent = node(i % every === 0 ? { axfArea: `a${i}` } : {}, parent);
  }
  return parent as Fake;
}

/* ---------------------------------------------------------- fake context -- */

const TARGET: CtxTarget = {
  element: null,
  label: "Row 7",
  selection: "",
  editable: false,
  // Added by P3 alongside D2's Copy value row. Empty here on purpose: these
  // tests are about the WALK, and a value would only change what an unrelated
  // predicate returns.
  value: ""
};

function input(el: Fake | null, map: MenuMap, cap?: number): ComposeInput {
  return {
    path: resolveAreaPath(el as AreaElement, { map, warn: false, ...(cap ? { cap } : {}) }),
    target: TARGET,
    clipboard: { text: null, unreadable: null },
    signedIn: false,
    user: null
  };
}

/**
 * Walk and compose against the SAME map.
 *
 * Passing it twice is the whole reason this helper exists: composing with the
 * singleton while resolving against a test map silently produced an empty menu,
 * which every assertion here would otherwise have to notice for itself.
 */
function compose(el: Fake | null, map: MenuMap, notice = false): CtxItem[] {
  return composeMenu(input(el, map), { map, noticeUndeclared: notice });
}

/** Register throwaway commands for the duration of one test. */
function withCommands(ids: string[], run: () => void): void {
  const off = ids.map((id) => commands.register({ id, title: id, run: () => {} }));
  try {
    run();
  } finally {
    for (const undo of off) undo();
  }
}

const labels = (items: CtxItem[]) => items.map((i) => i.label);
const roles = (items: CtxItem[]) => items.map((i) => i.role ?? "normal");

/** A map with `n` nested areas, each contributing one row naming itself. */
function mapOfAreas(n: number, itemFor?: (id: string) => MenuItem): MenuMap {
  const map = new MenuMap();
  for (let i = 0; i < n; i++) {
    const id = `a${i}`;
    map.declareArea({ id, title: id });
    map.contribute(id, [itemFor ? itemFor(id) : { id: "act", label: id, command: "t.run" }]);
  }
  return map;
}

/* ================================================================= the walk */

test("the walk collects areas innermost-first and reports what it visited", () => {
  const el = chain(area("shell"), area("module:claude"), area("pane:library"), {}, area("row"), {});
  const p = resolveAreaPath(el as AreaElement, { map: new MenuMap(), warn: false });

  assert.deepEqual(p.path, ["row", "pane:library", "module:claude", "shell"]);
  assert.equal(p.visited, 6, "every node examined exactly once, including the two plain ones");
  assert.deepEqual(
    p.areas.map((a) => a.depth),
    [1, 3, 4, 5],
    "depth is nodes walked, so the manager can say how far up a group came from"
  );
});

test("a null target resolves to an empty path rather than throwing", () => {
  const p = resolveAreaPath(null, { map: new MenuMap(), warn: false });
  assert.deepEqual(p.path, []);
  assert.equal(p.visited, 0);
  assert.deepEqual(compose(null, new MenuMap()), []);
});

test("data is harvested up the whole chain, innermost winning, area marker excluded", () => {
  const el = chain(
    area("table", { axfSource: "outer", axfTable: "tasks" }),
    { axfRowId: "outer-row" },
    area("row", { axfRowId: "7", axfSource: "inner" })
  );
  const p = resolveAreaPath(el as AreaElement, { map: new MenuMap(), warn: false });

  assert.deepEqual(p.data, { rowId: "7", source: "inner", table: "tasks" });
  assert.equal(p.data.area, undefined, "the area marker is the path, not data");
});

test("an area nested inside itself counts once and spends one cap slot", () => {
  const el = chain(area("shell"), area("row"), area("row"));
  const p = resolveAreaPath(el as AreaElement, { map: new MenuMap(), warn: false });
  assert.deepEqual(p.path, ["row", "shell"]);
});

/* ============================================================ D1 — declared */

test("an undeclared DOM area is reported, warned about ONCE, and adds no rows", () => {
  clearUndeclaredAreaWarnings();
  const map = new MenuMap();
  map.declareArea({ id: "row", title: "Row" });

  const warnings: string[] = [];
  const real = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    const el = chain(area("row"), area("rwo"));
    const first = resolveAreaPath(el as AreaElement, { map, warn: true });
    resolveAreaPath(el as AreaElement, { map, warn: true });

    assert.deepEqual(first.undeclared, ["rwo"]);
    assert.deepEqual(first.contributing, ["row"]);
    assert.equal(warnings.length, 1, "once per id — a warning on every right-click gets muted");
    assert.match(warnings[0], /rwo/);
    assert.match(warnings[0], new RegExp(AREA_ATTR));
  } finally {
    console.warn = real;
    clearUndeclaredAreaWarnings();
  }
});

test("in development the menu itself says an area is undeclared, as an unclickable header", () => {
  const map = new MenuMap();
  const el = chain(area("typo"));
  const items = compose(el, map, true);

  assert.equal(items.length, 1);
  assert.equal(items[0].role, "header", "structural, so it can never become a dead row");
  assert.equal(items[0].command, undefined);
  assert.match(items[0].label, /typo/);

  assert.deepEqual(
    compose(el, map),
    [],
    "and it stays out of production"
  );
});

/* ============================================================ D3 — the cap */

test("the cap is a constant, and it is four", () => {
  assert.equal(MAX_CONTRIBUTING_AREAS, 4);
});

test("GATE — a 6-deep tree contributes exactly the nearest 4 areas' groups, in order", () => {
  withCommands(["t.run"], () => {
    const map = mapOfAreas(6);
    // a0 is outermost, a5 innermost — the shape the plan names:
    // cell → row → table → pane → module → shell.
    const el = chain(...["a0", "a1", "a2", "a3", "a4", "a5"].map((id) => area(id)));
    const p = resolveAreaPath(el as AreaElement, { map, warn: false });

    assert.deepEqual(p.path, ["a5", "a4", "a3", "a2", "a1", "a0"], "the full path survives");
    assert.deepEqual(p.contributing, ["a5", "a4", "a3", "a2"]);

    const items = compose(el, map);
    assert.deepEqual(labels(items.filter((i) => i.role !== "separator")), ["a5", "a4", "a3", "a2"]);
    assert.deepEqual(roles(items), [
      "normal", "separator", "normal", "separator", "normal", "separator", "normal"
    ]);
    assert.equal(
      items.some((i) => i.origin?.area === "a1" || i.origin?.area === "a0"),
      false,
      "the two areas beyond the cap are in the path for context and contribute nothing"
    );
  });
});

test("predicates still see the WHOLE path, capped or not", () => {
  withCommands(["t.run"], () => {
    const map = mapOfAreas(6);
    let seen: readonly string[] = [];
    const off = predicates.register({
      id: "test.capturePath",
      title: "Capture the path",
      test: (ctx) => {
        seen = ctx.path;
        return true;
      }
    });
    try {
      map.declareArea({ id: "inner", title: "Inner" });
      map.contribute("inner", [
        { id: "act", label: "inner", command: "t.run", enabledWhen: "test.capturePath" }
      ]);
      const el = chain(...["a0", "a1", "a2", "a3", "a4", "a5", "inner"].map((id) => area(id)));
      compose(el, map);
      assert.deepEqual(seen, ["inner", "a5", "a4", "a3", "a2", "a1", "a0"]);
    } finally {
      off();
    }
  });
});

test("an undeclared area does not spend a cap slot — one typo must not cost twice", () => {
  withCommands(["t.run"], () => {
    const map = mapOfAreas(4);
    const el = chain(
      ...["a0", "a1", "a2", "a3"].map((id) => area(id)),
      area("rwo") // the typo, innermost
    );
    const p = resolveAreaPath(el as AreaElement, { map, warn: false });
    assert.deepEqual(
      p.contributing,
      ["a3", "a2", "a1", "a0"],
      "all four real areas still contribute; the typo is reported, not charged for"
    );
  });
});

/* ============================================================== the order */

test("rows sort by group order, then item order, then id — a total order", () => {
  withCommands(["t.run"], () => {
    const map = new MenuMap();
    map.declareGroup({ id: "late", order: 200 });
    map.declareGroup({ id: "early", order: 50 });
    map.declareArea({ id: "row", title: "Row" });
    map.contribute("row", [
      { id: "z", label: "z", command: "t.run", group: "late" },
      { id: "b", label: "b", command: "t.run", group: "early", order: 2 },
      { id: "a", label: "a", command: "t.run", group: "early", order: 2 },
      { id: "first", label: "first", command: "t.run", group: "early", order: 1 }
    ]);
    const items = compose(chain(area("row")), map);
    assert.deepEqual(labels(items).filter(Boolean), ["first", "a", "b", "z"]);
  });
});

test("the same map always composes the same menu, whatever order it was built in", () => {
  withCommands(["t.run"], () => {
    const build = (ids: string[]): string[] => {
      const map = new MenuMap();
      map.declareArea({ id: "row", title: "Row" });
      map.contribute(
        "row",
        ids.map((id) => ({ id, label: id, command: "t.run" }))
      );
      return labels(compose(chain(area("row")), map));
    };
    assert.deepEqual(build(["c", "a", "b"]), build(["b", "c", "a"]));
  });
});

test("a titled group opens with a heading; an untitled one is just a divider", () => {
  withCommands(["t.run"], () => {
    const map = new MenuMap();
    map.declareGroup({ id: "named", order: 10, title: "Clipboard" });
    map.declareGroup({ id: "plain", order: 20 });
    map.declareArea({ id: "row", title: "Row" });
    map.contribute("row", [
      { id: "one", label: "one", command: "t.run", group: "named" },
      { id: "two", label: "two", command: "t.run", group: "plain" }
    ]);
    const items = compose(chain(area("row")), map);
    assert.deepEqual(roles(items), ["header", "normal", "separator", "normal"]);
    assert.equal(items[0].label, "Clipboard");
  });
});

test("dividers separate bands and nothing else — none leading, trailing, doubled or empty", () => {
  withCommands(["t.run"], () => {
    const map = new MenuMap();
    map.declareArea({ id: "outer", title: "Outer" });
    map.declareArea({ id: "silent", title: "Silent" });
    map.declareArea({ id: "inner", title: "Inner" });
    map.contribute("outer", [{ id: "o", label: "o", command: "t.run" }]);
    // Every row of `silent` is filtered out by `when`.
    map.contribute("silent", [
      { id: "s", label: "s", command: "t.run", when: "selection.present" }
    ]);
    map.contribute("inner", [{ id: "i", label: "i", command: "t.run" }]);

    const el = chain(area("outer"), area("silent"), area("inner"));
    const items = compose(el, map);

    assert.deepEqual(roles(items), ["normal", "separator", "normal"]);
    assert.deepEqual(labels(items).filter(Boolean), ["i", "o"]);
    assert.equal(
      new Set(items.map((i) => i.id)).size,
      items.length,
      "ids are unique across the composed menu — the renderer keys on them"
    );
  });
});

test("two areas may carry the same item id; the composed ids stay distinct", () => {
  withCommands(["t.run"], () => {
    const map = new MenuMap();
    for (const id of ["row", "table"]) {
      map.declareArea({ id, title: id });
      map.contribute(id, [{ id: "copy", label: `copy ${id}`, command: "t.run" }]);
    }
    const items = compose(chain(area("table"), area("row")), map);
    const rows = items.filter((i) => i.role !== "separator");
    assert.deepEqual(rows.map((i) => i.id), ["row:copy", "table:copy"]);
    assert.deepEqual(rows.map((i) => i.origin), [
      { area: "row", item: "copy" },
      { area: "table", item: "copy" }
    ]);
  });
});

/* ======================================================= the four dials */

test("`when` removes a row; `enabledWhen` greys it WITH the reason", () => {
  withCommands(["t.run"], () => {
    const map = new MenuMap();
    map.declareArea({ id: "row", title: "Row" });
    map.contribute("row", [
      { id: "gone", label: "gone", command: "t.run", when: "selection.present" },
      { id: "grey", label: "grey", command: "t.run", enabledWhen: "target.editable" },
      { id: "live", label: "live", command: "t.run", enabledWhen: "always" }
    ]);
    const items = compose(chain(area("row")), map);

    assert.deepEqual(labels(items), ["grey", "live"]);
    assert.equal(items[0].disabledReason, "this text is not editable");
    assert.equal(items[1].disabledReason, undefined);
  });
});

test("a command unregistered after the map was built renders greyed, naming it", () => {
  const map = new MenuMap();
  withCommands(["t.gone"], () => {
    map.declareArea({ id: "row", title: "Row" });
    map.contribute("row", [{ id: "act", label: "Act", command: "t.gone" }]);
  });
  // `t.gone` is now unregistered — the case the plan calls out: caught at package
  // time by MenuMap.validate, reported at run time as a disabled row naming it.
  assert.deepEqual(map.validate().map((v) => v.item), ["act"]);

  const items = compose(chain(area("row")), map);
  assert.equal(items.length, 1);
  assert.match(items[0].disabledReason ?? "", /t\.gone/);
  assert.match(items[0].disabledReason ?? "", /no longer registered/);
});

test("a toggle carries the state its checkedWhen computed", () => {
  withCommands(["t.run"], () => {
    const map = new MenuMap();
    map.declareArea({ id: "row", title: "Row" });
    map.contribute("row", [
      { id: "t1", label: "on", role: "toggle", command: "t.run", checkedWhen: "always" },
      {
        id: "t2",
        label: "off",
        role: "toggle",
        command: "t.run",
        checkedWhen: "selection.present"
      }
    ]);
    const items = compose(chain(area("row")), map);
    assert.deepEqual(items.map((i) => i.checked), [true, false]);
  });
});

test("a submenu resolves its children; one left with none is dropped, not opened empty", () => {
  withCommands(["t.run"], () => {
    const map = new MenuMap();
    map.declareArea({ id: "row", title: "Row" });
    map.contribute("row", [
      {
        id: "keep",
        label: "Keep",
        role: "submenu",
        items: [
          { id: "a", label: "a", command: "t.run" },
          { id: "b", label: "b", command: "t.run", when: "selection.present" }
        ]
      },
      {
        id: "drop",
        label: "Drop",
        role: "submenu",
        items: [{ id: "c", label: "c", command: "t.run", when: "selection.present" }]
      }
    ]);
    const items = compose(chain(area("row")), map);
    assert.deepEqual(labels(items), ["Keep"]);
    assert.deepEqual(labels([...(items[0].items ?? [])]), ["a"]);
  });
});

/* ================================================== the measured guarantee */

test("the walk is O(depth): nodes visited equals tree depth, exactly", () => {
  for (const depth of [1, 8, 64, 512, 4096]) {
    const p = resolveAreaPath(deepTree(depth) as AreaElement, {
      map: new MenuMap(),
      warn: false
    });
    assert.equal(p.visited, depth, `depth ${depth}`);
  }
});

test("MEASURED — per-node cost is flat from depth 64 to 4096, and recorded", () => {
  const map = new MenuMap();
  const ITER = 2000;
  const measure = (depth: number): number => {
    const el = deepTree(depth) as AreaElement;
    for (let i = 0; i < 200; i++) resolveAreaPath(el, { map, warn: false }); // warm up
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) resolveAreaPath(el, { map, warn: false });
    return Number(process.hrtime.bigint() - t0) / ITER; // ns per walk
  };

  const rows = [8, 64, 512, 4096].map((depth) => {
    const perWalk = measure(depth);
    return { depth, perWalk, perNode: perWalk / depth };
  });
  for (const r of rows) {
    console.log(
      `    depth ${String(r.depth).padStart(4)} · ${(r.perWalk / 1e6).toFixed(4)} ms/walk · ` +
        `${r.perNode.toFixed(0)} ns/node`
    );
  }

  const base = rows.find((r) => r.depth === 64)!;
  const deep = rows.find((r) => r.depth === 4096)!;
  // Quadratic would put this at ~64×. Four is loose enough to survive a noisy
  // machine and nowhere near loose enough to let O(depth²) through.
  assert.ok(
    deep.perNode < base.perNode * 4,
    `per-node cost must not grow with depth: ${base.perNode.toFixed(0)} ns at 64 vs ` +
      `${deep.perNode.toFixed(0)} ns at 4096`
  );
  // A realistic DOM is 20-40 deep. This is the number that matters for "does the
  // menu feel instant", and it has an entire frame of headroom to spare.
  assert.ok(deep.perWalk / 1e6 < 16, "even a 4096-deep tree resolves inside one frame");
});

test("the walk reads no layout — enforced by the type, and checked in the source", () => {
  const dir = path.resolve(import.meta.dirname, "..", "..", "core", "src", "ctx");
  // Comments are stripped first: the docblocks NAME these APIs to explain why
  // they are absent, and a scan that cannot tell prose from code would fail on
  // its own documentation.
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const LAYOUT =
    /\b(getBoundingClientRect|getClientRects|getComputedStyle|offset(Width|Height|Top|Left|Parent)|client(Width|Height|Top|Left)|scroll(Width|Height|Top|Left)|innerText|matchMedia|closest)\b/;

  for (const file of ["areas.ts", "compose.ts"]) {
    const code = strip(fs.readFileSync(path.join(dir, file), "utf8"));
    const hit = LAYOUT.exec(code);
    assert.equal(hit, null, `${file} must not read layout during the walk (found "${hit?.[0]}")`);
  }
});
