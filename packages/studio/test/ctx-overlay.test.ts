/**
 * @file The edits-only overlay — `axf-context-menus` P4.
 *
 * Its gate, verbatim: *deleting the overlay restores defaults exactly; a stale
 * overlay entry is reported by name.*
 *
 * Both halves are here, and both are asserted the awkward way on purpose.
 *
 * RESTORE IS COMPARED ON A WHOLE SNAPSHOT, NOT ON A LABEL. "Exactly" is the load
 * -bearing word in the gate, and a test that checked one row would pass while an
 * edit left an `order` behind, a group re-sorted, a submenu child dropped, or an
 * area's title stuck at whatever a manager last typed. So the reference is
 * `map.toJSON()` plus the composed `CtxItem[]` a real click produces, captured
 * before any edit and deep-compared after the overlay is dropped. The composed
 * rows matter as much as the map: they are what a person sees, and they are
 * where a divider left over from an emptied band would show up.
 *
 * AND THE COMPARISON IS WATCHED FAILING. A deep-equal that has never gone red is
 * a deep-equal nobody has tested — the whole assertion could be comparing two
 * references to the same object and pass forever. One test here applies an edit
 * and asserts the snapshots DIFFER, in the same shape as the restore test, so
 * the restore assertion is known to have teeth rather than assumed to.
 *
 * DRIFT IS ASSERTED TO SURVIVE, NOT MERELY TO BE NOTICED. The phase's reason for
 * the rule is that *silence here is indistinguishable from the edit never having
 * been made* — so it is not enough that a stale entry is reported once. It has
 * to still be in the document afterwards, still be in the document after a save
 * and reload, and still be reported on the next sweep. A store that reported and
 * then tidied up would pass a naive test and lose the evidence.
 *
 * NO DOM, like its P1 and P3 siblings: the walk is typed against `dataset` +
 * `parentElement`, so a plain object is a valid element. Imports go through
 * `scripts/_axf-ctx-stub.ts` for the reason written at the top of that file.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  CTX_OVERLAY_KEY,
  MenuMap,
  OVERLAY_VERSION,
  OverlayStore,
  commands,
  composeMenu,
  installCtxOverlay,
  isEmptyOverlay,
  overlayDrift,
  parseOverlay,
  resolveAreaPath,
  universalMenu
} from "../scripts/_axf-ctx-stub.ts";
import type {
  AreaElement,
  ComposeInput,
  CtxItem,
  CtxTarget,
  MenuItem,
  MenuOverlay,
  OverlayStorage
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
  value: ""
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

function compose(el: Fake | null, map: MenuMap): CtxItem[] {
  return composeMenu(input(el, map), { map, noticeUndeclared: false });
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
const ids = (items: CtxItem[]) => items.map((i) => i.id);
/** The rows, without the band dividers — for assertions that are about content. */
const visible = (items: CtxItem[]) => items.filter((i) => i.role !== "separator");
const seps = (items: CtxItem[]) => items.filter((i) => i.role === "separator");

/**
 * A composed menu with its separator ids normalised.
 *
 * `compose.ts` numbers dividers from a process-global counter, because their ids
 * only have to be unique WITHIN one composed menu and the renderer keys on them.
 * So two composes of the identical map differ in exactly those ids and in
 * nothing else. The gate is about the menu a person sees, not about a key
 * generator, and comparing raw ids would make it fail for the one reason that
 * does not matter.
 */
function stable(items: CtxItem[]): CtxItem[] {
  return items.map((item, i) => (item.role === "separator" ? { ...item, id: `sep@${i}` } : item));
}

/** Storage that keeps what it is given, and can be inspected. */
function fakeStorage(seed: Record<string, string> = {}) {
  const cells = new Map(Object.entries(seed));
  return {
    cells,
    storage: {
      read: (k: string) => cells.get(k) ?? null,
      write: (k: string, v: string) => void cells.set(k, v),
      remove: (k: string) => void cells.delete(k)
    } satisfies OverlayStorage
  };
}

function store(seed: Record<string, string> = {}) {
  const { cells, storage } = fakeStorage(seed);
  return { cells, store: new OverlayStore({ storage, warn: false }) };
}

/**
 * The fixture: two areas on one path, four rows in the inner one across two
 * bands, plus a submenu — so that hiding, renaming, re-grouping and reordering
 * all have something to bite on, at the top level and one level down.
 */
function fixture(): MenuMap {
  const map = new MenuMap();
  // After the default band (100), so the fixture reads top-to-bottom the way it
  // renders: Open, Move to | Rename, Delete.
  map.declareGroup({ id: "edit", order: 200 });
  map.declareArea({ id: "shell", title: "Shell" });
  map.declareArea({ id: "row", title: "Row" });
  map.contribute("shell", [{ id: "about", label: "About", command: "t.run" }]);
  map.contribute("row", [
    { id: "open", label: "Open", command: "t.run", order: 10 },
    { id: "rename", label: "Rename", command: "t.run", group: "edit", order: 10 },
    { id: "delete", label: "Delete", role: "danger", command: "t.gone", group: "edit", order: 20 },
    {
      id: "move",
      label: "Move to",
      role: "submenu",
      order: 20,
      items: [
        { id: "backlog", label: "Backlog", command: "t.run", order: 10 },
        { id: "doing", label: "Doing", command: "t.run", order: 20 }
      ]
    }
  ]);
  return map;
}

const CLICK = () => chain(area("shell"), area("row"));

/** Everything a person could observe about a map, in one comparable value. */
function snapshot(map: MenuMap) {
  return {
    map: map.toEffectiveJSON(),
    menu: stable(compose(CLICK(), map)),
    universal: universalMenu(input(CLICK(), map), { map })
  };
}

/* ================================================== derived, never persisted */

test("with no overlay, the effective menu IS the scanned defaults", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    assert.equal(map.overlay(), null);
    assert.deepEqual(map.itemsFor("row"), map.defaultItemsFor("row"));
    assert.deepEqual(map.toEffectiveJSON(), map.toJSON());
  });
});

test("an overlay with no real edits is the same state as no overlay at all", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const before = snapshot(map);
    // The shape a manager's UI produces by opening a row and changing nothing.
    map.setOverlay({ version: OVERLAY_VERSION, areas: { row: { items: { open: {} } } } });
    assert.equal(map.overlay(), null, "normalised away, so it cannot become a second state");
    assert.deepEqual(snapshot(map), before);
    assert.equal(isEmptyOverlay({ version: OVERLAY_VERSION, areas: { row: { items: {} } } }), true);
  });
});

test("the map itself is never serialised WITH the edits — toJSON stays the defaults", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const scanned = map.toJSON();
    map.setOverlay({
      version: OVERLAY_VERSION,
      areas: { row: { items: { open: { label: "Open it", hidden: false } } } }
    });
    assert.deepEqual(map.toJSON(), scanned, "a manifest must not carry one person's edits");
    assert.notDeepEqual(map.toEffectiveJSON(), scanned, "the effective view does");
  });
});

/* ====================================================== the four edits work */

test("hidden: the row leaves the menu, and takes no divider with it", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { store: s } = store();
    s.bind(map);
    // Both rows of the `edit` band, so the band empties entirely.
    s.editItem("row", "rename", { hidden: true });
    s.editItem("row", "delete", { hidden: true });

    const rows = compose(CLICK(), map);
    assert.deepEqual(labels(visible(rows)), ["Open", "Move to", "About"]);
    assert.equal(
      seps(rows).length,
      1,
      "one divider, between `row` and `shell` — not one left behind by the emptied band"
    );
    assert.equal(rows[rows.length - 1]?.role !== "separator" && rows[0]?.role !== "separator", true);
  });
});

test("renamed: the label changes; the id, origin and command do not", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { store: s } = store();
    s.bind(map);
    s.editItem("row", "open", { label: "Open in pane" });

    const row = compose(CLICK(), map).find((r) => r.origin?.item === "open");
    assert.equal(row?.label, "Open in pane");
    assert.equal(row?.id, "row:open", "the renderer keys on this — a rename must not move it");
    assert.equal(row?.command, "t.run");
  });
});

test("re-grouped and reordered: the row moves band, and moves within it", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { store: s } = store();
    s.bind(map);

    assert.deepEqual(labels(visible(compose(CLICK(), map))).slice(0, 4), [
      "Open",
      "Move to",
      "Rename",
      "Delete"
    ]);

    // Open joins the `edit` band, ordered between Rename and Delete.
    s.editItem("row", "open", { group: "edit", order: 15 });
    assert.deepEqual(labels(visible(compose(CLICK(), map))).slice(0, 4), [
      "Move to",
      "Rename",
      "Open",
      "Delete"
    ]);
  });
});

test("a nested row is addressed by its path, and reordering one is not inert", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { store: s } = store();
    s.bind(map);

    const children = (m: MenuMap) =>
      labels([...(compose(CLICK(), m).find((r) => r.origin?.item === "move")?.items ?? [])]);
    assert.deepEqual(children(map), ["Backlog", "Doing"]);

    s.editItem("row", "move/doing", { order: 5, label: "In progress" });
    assert.deepEqual(
      children(map),
      ["In progress", "Backlog"],
      "an order edit one level down has to actually reorder, or it is an edit that lies"
    );

    s.editItem("row", "move/backlog", { hidden: true });
    s.editItem("row", "move/doing", { hidden: true });
    assert.equal(
      compose(CLICK(), map).find((r) => r.origin?.item === "move"),
      undefined,
      "a submenu with every child hidden is dropped, not opened on nothing"
    );
  });
});

test("an area can be hidden, renamed, and made to suppress the universal band", () => {
  withCommands(["t.run", "t.gone", "ctx.copyValue", "ctx.copyPath", "ctx.inspect", "ctx.reload"], () => {
    const map = fixture();
    map.declareArea({
      id: "universal",
      title: "Universal",
      group: "universal"
    });
    map.contribute("universal", [
      { id: "copy-path", label: "Copy path", command: "ctx.copyPath" }
    ]);
    const { store: s } = store();
    s.bind(map);

    assert.deepEqual(labels(universalMenu(input(CLICK(), map), { map })), ["Copy path"]);

    s.editArea("row", { title: "Task row", suppressUniversal: true });
    assert.equal(map.area("row")?.title, "Task row");
    assert.equal(map.declaredArea("row")?.title, "Row", "source is untouched");
    assert.deepEqual(
      universalMenu(input(CLICK(), map), { map }),
      [],
      "the area the click was rooted in suppresses the basics"
    );

    s.editArea("row", { hidden: true, suppressUniversal: false });
    assert.deepEqual(map.itemsFor("row"), [], "a hidden area contributes nothing");
    assert.notEqual(
      map.area("row"),
      undefined,
      "but it stays DECLARED — hiding must not read as a typo'd marker"
    );
    assert.deepEqual(labels(compose(CLICK(), map)), ["About"], "and no divider is left over");
  });
});

/* ================================================ THE GATE: exact restore */

test("GATE — deleting the overlay restores the scanned defaults exactly", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const before = snapshot(map);

    const { cells, store: s } = store();
    s.bind(map);
    // One of each dial, at both depths, plus an area edit — so the restore has
    // the widest possible set of things it could fail to undo.
    s.editItem("row", "open", { label: "Open in pane", group: "edit", order: 1 });
    s.editItem("row", "rename", { hidden: true });
    s.editItem("row", "move/doing", { order: 5 });
    s.editArea("row", { title: "Task row", suppressUniversal: true });
    s.editArea("shell", { hidden: true });
    assert.notDeepEqual(snapshot(map), before, "the edits really did change the menu");
    assert.ok(cells.has(CTX_OVERLAY_KEY), "and really were persisted");

    s.clear();

    assert.deepEqual(snapshot(map), before);
    assert.equal(map.overlay(), null);
    assert.equal(cells.has(CTX_OVERLAY_KEY), false, "the key is removed, not left as a husk");
  });
});

test("the restore comparison has teeth — the same shape goes red on one edit", () => {
  // The self-test for the assertion above. A deep-equal that has never failed
  // could be comparing an object with itself and pass forever; this is the same
  // snapshot, the same comparison, and one hidden row between them.
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const before = snapshot(map);
    const { store: s } = store();
    s.bind(map);
    s.editItem("row", "open", { hidden: true });
    assert.throws(
      () => assert.deepEqual(snapshot(map), before),
      /AssertionError/,
      "if this does not throw, the GATE test above proves nothing"
    );
  });
});

test("unbinding restores the defaults too — a map is never left holding stale edits", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const before = snapshot(map);
    const { store: s } = store();
    const unbind = s.bind(map);
    s.editItem("row", "open", { hidden: true });
    unbind();
    assert.deepEqual(snapshot(map), before);
  });
});

/* ============================================= only human edits, persisted */

test("the document holds ONLY what somebody edited", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { cells, store: s } = store();
    s.bind(map);
    s.editItem("row", "rename", { hidden: true });

    const written = JSON.parse(cells.get(CTX_OVERLAY_KEY) as string) as MenuOverlay;
    assert.deepEqual(written, {
      version: OVERLAY_VERSION,
      areas: { row: { items: { rename: { hidden: true } } } }
    });
    // The map has five rows across two areas; the document mentions one. This
    // is the whole design: a stored copy of a scanned tree goes stale silently.
    const text = cells.get(CTX_OVERLAY_KEY) as string;
    for (const absent of ["open", "delete", "move", "about", "Delete", "About"]) {
      assert.equal(text.includes(absent), false, `"${absent}" was never edited and must not persist`);
    }
  });
});

test("undefined reverts one dial; null reverts the whole row", () => {
  const { cells, store: s } = store();
  s.editItem("row", "open", { label: "Open in pane", order: 5 });
  s.editItem("row", "open", { label: undefined });
  assert.deepEqual(
    s.get().areas.row?.items?.open,
    { order: 5 },
    "the rename went, the reorder stayed — and no present-but-meaningless key was left"
  );

  s.editItem("row", "open", null);
  assert.equal(s.isEmpty(), true);
  assert.equal(cells.has(CTX_OVERLAY_KEY), false, "an empty document is deleted, not written");
});

test("edits merge, so setting one dial does not forget another", () => {
  const { store: s } = store();
  s.editItem("row", "open", { label: "Open in pane" });
  s.editItem("row", "open", { order: 5 });
  assert.deepEqual(s.get().areas.row?.items?.open, { label: "Open in pane", order: 5 });
});

test("reverting an AREA's own fields keeps the row edits under it", () => {
  const { store: s } = store();
  s.editItem("row", "open", { hidden: true });
  s.editArea("row", { hidden: true });
  s.editArea("row", null);
  assert.deepEqual(s.get().areas.row, { items: { open: { hidden: true } } });

  s.clearArea("row");
  assert.equal(s.get().areas.row, undefined);
});

test("edits survive a save and a reload", () => {
  const { cells, store: s } = store();
  s.editItem("row", "open", { label: "Open in pane", order: 5 });
  s.editArea("row", { title: "Task row" });

  const reopened = new OverlayStore({
    storage: fakeStorage(Object.fromEntries(cells)).storage,
    warn: false
  });
  assert.deepEqual(reopened.get(), s.get());
});

/* ============================================ THE GATE: drift is reported */

test("GATE — an edit for an area that no longer exists is reported by name", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { store: s } = store();
    s.bind(map);
    s.editItem("gone:area", "open", { hidden: true });
    s.editItem("gone:area", "close", { label: "x" });

    const drift = overlayDrift(map);
    assert.equal(drift.length, 1, "one line for the AREA, not one per stranded row");
    assert.equal(drift[0]?.area, "gone:area");
    assert.equal(drift[0]?.item, null);
    assert.match(drift[0]?.problem ?? "", /no area is declared under this id/);
    assert.match(drift[0]?.problem ?? "", /"close", "open"/, "and it names what is stranded");
  });
});

test("GATE — an edit whose row names a vanished command is reported by name", () => {
  // `t.gone` is registered for the fixture's construction and then withdrawn,
  // which is exactly the case the plan calls out: a command unregistered AFTER
  // the map was built.
  let map!: MenuMap;
  withCommands(["t.run", "t.gone"], () => {
    map = fixture();
  });
  withCommands(["t.run"], () => {
    const { store: s } = store();
    s.bind(map);
    s.editItem("row", "delete", { label: "Delete for ever" });

    const drift = overlayDrift(map);
    assert.equal(drift.length, 1);
    assert.deepEqual(
      { area: drift[0]?.area, item: drift[0]?.item },
      { area: "row", item: "delete" }
    );
    assert.match(drift[0]?.problem ?? "", /command "t\.gone", which is not registered/);

    // And the row itself is still honest downstream — greyed, naming the
    // command, never a row that does nothing when clicked.
    const row = compose(CLICK(), map).find((r) => r.origin?.item === "delete");
    assert.equal(row?.label, "Delete for ever");
    assert.match(row?.disabledReason ?? "", /t\.gone/);
  });
});

test("an edit for a row that is no longer authored, and one naming a dead band", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { store: s } = store();
    s.bind(map);
    s.editItem("row", "archive", { hidden: true });
    s.editItem("row", "move/done", { label: "x" });
    s.editItem("row", "open", { group: "nosuchband" });

    const drift = overlayDrift(map);
    assert.deepEqual(
      drift.map((d) => `${d.area}/${d.item}`),
      ["row/archive", "row/move/done", "row/open"]
    );
    assert.match(drift[0]?.problem ?? "", /no row is authored at this path/);
    assert.match(drift[2]?.problem ?? "", /group "nosuchband", which is not declared/);
  });
});

test("a HIDDEN row is not drift — the edit is checked against the defaults", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { store: s } = store();
    s.bind(map);
    s.editItem("row", "open", { hidden: true });
    // Checked against `itemsFor` instead, this would report every hide as drift
    // the moment it was made — the edit disagreeing with its own output.
    assert.deepEqual(overlayDrift(map), []);
  });
});

test("GATE — a stale entry is KEPT, and is still reported on the next sweep", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { cells, store: s } = store();
    s.bind(map);
    s.editItem("gone:area", "open", { hidden: true });

    assert.equal(overlayDrift(map).length, 1);
    // Reported, and NOT tidied away. A store that pruned would pass a naive
    // test and destroy the only evidence that the edit was ever made.
    assert.deepEqual(s.get().areas["gone:area"], { items: { open: { hidden: true } } });
    assert.ok((cells.get(CTX_OVERLAY_KEY) as string).includes("gone:area"));

    const reopened = new OverlayStore({
      storage: fakeStorage(Object.fromEntries(cells)).storage,
      warn: false
    });
    const fresh = fixture();
    reopened.bind(fresh);
    assert.equal(overlayDrift(fresh).length, 1, "still there, still reported, after a reload");
  });
});

test("a stale entry costs the healthy edits around it nothing", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { store: s } = store();
    s.bind(map);
    s.editItem("gone:area", "open", { hidden: true });
    s.editItem("row", "open", { label: "Open in pane" });

    assert.equal(overlayDrift(map).length, 1);
    assert.equal(
      compose(CLICK(), map).find((r) => r.origin?.item === "open")?.label,
      "Open in pane"
    );
  });
});

test("installCtxOverlay binds and sweeps, and is idempotent", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { store: s } = store();
    s.editItem("row", "open", { label: "Open in pane" });
    s.editItem("gone:area", "x", { hidden: true });

    const first = installCtxOverlay({ store: s, map, warn: false });
    const second = installCtxOverlay({ store: s, map, warn: false });
    assert.deepEqual(first, second);
    assert.equal(first.length, 1);
    assert.equal(
      compose(CLICK(), map).find((r) => r.origin?.item === "open")?.label,
      "Open in pane",
      "binding applied the healthy edit"
    );
  });
});

/* ===================================================== an unreadable document */

test("a corrupt or foreign-version document is reported, never silently emptied", () => {
  const broken = store({ [CTX_OVERLAY_KEY]: "{not json" });
  assert.equal(broken.store.isEmpty(), true);
  assert.match(broken.store.parseProblems()[0]?.problem ?? "", /not valid JSON/);

  const future = store({
    [CTX_OVERLAY_KEY]: JSON.stringify({ version: 99, areas: { row: { items: {} } } })
  });
  assert.equal(future.store.isEmpty(), true);
  assert.match(future.store.parseProblems()[0]?.problem ?? "", /version 99/);
  assert.equal(
    future.cells.has(CTX_OVERLAY_KEY),
    true,
    "left in place, unread — a newer client's document is not ours to delete"
  );
});

test("junk inside a valid document is dropped FIELD BY FIELD, and every drop is named", () => {
  const { overlay, problems } = parseOverlay({
    version: OVERLAY_VERSION,
    areas: {
      row: {
        title: 7,
        items: {
          open: { label: "Open in pane", order: "soon", hidden: "yes" },
          bad: "not an object"
        }
      },
      other: []
    }
  });

  assert.deepEqual(overlay.areas.row, { items: { open: { label: "Open in pane" } } });
  assert.equal(overlay.areas.other, undefined, "an array is not an entry");

  // The good half of a bad row survives, and each discarded field is accounted
  // for by name — a value dropped for its type is still somebody's edit
  // disappearing, and the reason this whole phase exists is that it must not do
  // so quietly.
  const said = problems.map((p) => `${p.area}: ${p.problem}`);
  assert.equal(problems.length, 5, said.join("\n"));
  assert.match(said.join("\n"), /row: the edit for row "open": `hidden` is "yes", not a boolean/);
  assert.match(said.join("\n"), /row: the edit for row "open": `order` is "soon", not a number/);
  assert.match(said.join("\n"), /row: the edit for row "bad" is not an object/);
  assert.match(said.join("\n"), /row: `title` is 7, not a string/);
  assert.match(said.join("\n"), /other: the entry is not an object/);
});

/* ================================================= the composed menu itself */

test("the overlay reaches the rows a person actually sees, in order", () => {
  withCommands(["t.run", "t.gone"], () => {
    const map = fixture();
    const { store: s } = store();
    s.bind(map);
    s.editItem("row", "delete", { hidden: true });
    s.editItem("row", "open", { label: "Open in pane", group: "edit", order: 99 });

    const rows = compose(CLICK(), map);
    assert.deepEqual(labels(visible(rows)), ["Move to", "Rename", "Open in pane", "About"]);
    assert.deepEqual(ids(visible(rows)), ["row:move", "row:rename", "row:open", "shell:about"]);
  });
});
