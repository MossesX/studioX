/**
 * @file The context-menu renderer — `axf-context-menus` P2.
 *
 * Its gate, verbatim: *opens correctly at all four corners; fully
 * keyboard-drivable; a disabled row states why.* All three are asserted here,
 * and none of them by looking at a screen.
 *
 * That is only possible because the renderer was built inside out. A menu
 * component with the geometry, the key handling and the row states tangled into
 * its JSX can only be checked by opening it and squinting, which is how "tested
 * at each corner" becomes "we clicked the bottom-right one once". So the three
 * things the gate names live in three pure modules — `place.ts`, `keyboard.ts`,
 * `row-model.ts` — and `ContextMenu.tsx` is the thin DOM layer over them.
 *
 * NO DOM, for the same reason as `ctx-resolver.test.ts`: no jsdom, no new
 * dependency, and the imports go through `scripts/_axf-ctx-stub.ts` (see that
 * file for why the barrel cannot be loaded under `node --test`).
 *
 * The one thing here that IS a source scan is the theming check, and it is a
 * scan on purpose: "themed entirely through `var(--axf-*)`" is a claim about
 * what the file does NOT contain, and only reading the file can prove an
 * absence.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MENU_MARGIN,
  NAV_INITIAL,
  TYPEAHEAD_RESET_MS,
  focusableIndexes,
  isOnScreen,
  itemAt,
  navFirst,
  navigate,
  panelItems,
  placeAtPoint,
  placeFlyout,
  rowModel,
  toneToken
} from "../scripts/_axf-ctx-stub.ts";
import type { CtxItem, NavKey, NavState, Size } from "../scripts/_axf-ctx-stub.ts";

const CORE = path.resolve(import.meta.dirname, "..", "..", "core", "src", "ctx");

/* ======================================================================== *
 * 1. PLACEMENT — "opens correctly at all four corners"
 * ======================================================================== */

const VIEWPORT: Size = { width: 1280, height: 800 };
/** A believable menu: the renderer's fixed width, a dozen-ish rows tall. */
const MENU: Size = { width: 248, height: 300 };

/** Every corner of the viewport, named — the assertion messages read as English. */
const CORNERS = [
  { name: "top-left", x: 0, y: 0, flipX: false, flipY: false },
  { name: "top-right", x: VIEWPORT.width, y: 0, flipX: true, flipY: false },
  { name: "bottom-left", x: 0, y: VIEWPORT.height, flipX: false, flipY: true },
  { name: "bottom-right", x: VIEWPORT.width, y: VIEWPORT.height, flipX: true, flipY: true }
] as const;

test("placement: the menu lands fully on screen at all four corners", () => {
  for (const c of CORNERS) {
    const p = placeAtPoint({ x: c.x, y: c.y }, MENU, VIEWPORT);
    assert.ok(
      isOnScreen(p, MENU, VIEWPORT),
      `${c.name}: menu at (${p.x}, ${p.y}) ${MENU.width}x${MENU.height} escaped the viewport`
    );
  }
});

test("placement: each corner flips the axes that have no room, and only those", () => {
  for (const c of CORNERS) {
    const p = placeAtPoint({ x: c.x, y: c.y }, MENU, VIEWPORT);
    assert.equal(p.flippedX, c.flipX, `${c.name}: flippedX`);
    assert.equal(p.flippedY, c.flipY, `${c.name}: flippedY`);
  }
});

test("placement: an EXACT corner click clamps by the margin on top of flipping", () => {
  // Worth stating because it is the one result that surprised this test when it
  // was first written: flipping alone is never quite enough at a literal corner.
  // A click at x = 0 wants to open at 0, which is inside the margin; a click at
  // x = viewport.width flips to `width - menu`, which is ALSO inside it, by the
  // same 6px. Both clamp, on purpose — the margin is what keeps the menu from
  // sitting flush against the window edge, and a corner is where that matters.
  const br = placeAtPoint({ x: VIEWPORT.width, y: VIEWPORT.height }, MENU, VIEWPORT);
  assert.equal(br.x, VIEWPORT.width - MENU.width - MENU_MARGIN);
  assert.equal(br.y, VIEWPORT.height - MENU.height - MENU_MARGIN);
  assert.equal(br.flippedX, true);
  assert.equal(br.clampedX, true);

  const tl = placeAtPoint({ x: 0, y: 0 }, MENU, VIEWPORT);
  assert.equal(tl.x, MENU_MARGIN, "clamped to the left margin");
  assert.equal(tl.y, MENU_MARGIN, "clamped to the top margin");
  assert.equal(tl.flippedX, false, "there was nothing to flip away from");
});

test("placement: an ordinary click well inside an edge neither flips nor clamps", () => {
  const p = placeAtPoint({ x: 400, y: 200 }, MENU, VIEWPORT);
  assert.deepEqual(
    [p.x, p.y, p.flippedX, p.flippedY, p.clampedX, p.clampedY],
    [400, 200, false, false, false, false],
    "the common case must be the identity — the menu opens exactly at the cursor"
  );
});

test("placement: a click one pixel inside an edge still fits", () => {
  // The off-by-one that a corners-only test misses: just enough room to open
  // down-and-right, or just too little.
  const justFits = placeAtPoint(
    { x: VIEWPORT.width - MENU.width - MENU_MARGIN, y: 10 },
    MENU,
    VIEWPORT
  );
  assert.equal(justFits.flippedX, false, "there was exactly enough room — do not flip");
  assert.ok(isOnScreen(justFits, MENU, VIEWPORT));

  const justDoesNot = placeAtPoint(
    { x: VIEWPORT.width - MENU.width - MENU_MARGIN + 1, y: 10 },
    MENU,
    VIEWPORT
  );
  assert.equal(justDoesNot.flippedX, true, "one pixel short — flip");
  assert.ok(isOnScreen(justDoesNot, MENU, VIEWPORT));
});

test("placement: a menu taller than the viewport pins to the top and caps its height", () => {
  const tall: Size = { width: 248, height: 2000 };
  const p = placeAtPoint({ x: 600, y: 700 }, tall, VIEWPORT);
  assert.equal(p.y, MENU_MARGIN, "pinned to the top margin, so the first rows are reachable");
  assert.equal(p.clampedY, true);
  assert.equal(
    p.maxHeight,
    VIEWPORT.height - MENU_MARGIN * 2,
    "max-height is the usable viewport, so the panel scrolls instead of overflowing"
  );
});

test("placement: max-height never depends on WHERE the menu opened", () => {
  // This is what stops measure → place → re-measure from oscillating: a panel
  // measures the same height wherever it is put.
  const top = placeAtPoint({ x: 10, y: 10 }, MENU, VIEWPORT);
  const bottom = placeAtPoint({ x: 10, y: VIEWPORT.height - 10 }, MENU, VIEWPORT);
  assert.equal(top.maxHeight, bottom.maxHeight);
});

/* ---------------------------------------------------------------- flyouts */

/** A parent panel sitting at `x`, and the row two-thirds of the way down it. */
function parent(x: number, y: number) {
  return {
    panel: { x, y, width: 248, height: 300 },
    row: { x, y: y + 200, width: 248, height: 20 }
  };
}

test("flyout: opens to the right of its parent when there is room", () => {
  const { panel, row } = parent(100, 100);
  const p = placeFlyout(row, panel, MENU, VIEWPORT);
  assert.equal(p.flippedX, false);
  assert.ok(p.x > panel.x, "the flyout is to the right of the parent panel");
  assert.ok(p.x < panel.x + panel.width, "and it overlaps it, so the diagonal path has no gap");
  assert.ok(isOnScreen(p, MENU, VIEWPORT));
});

test("flyout: flips to the LEFT of its parent when the right edge has no room", () => {
  const { panel, row } = parent(VIEWPORT.width - 260, 100);
  const p = placeFlyout(row, panel, MENU, VIEWPORT);
  assert.equal(p.flippedX, true);
  assert.ok(p.x < panel.x, "the flyout is now to the left of the parent panel");
  assert.ok(isOnScreen(p, MENU, VIEWPORT));
});

test("flyout: a row near the bottom bottom-aligns rather than flying off screen", () => {
  const { panel, row } = parent(100, VIEWPORT.height - 320);
  const p = placeFlyout(row, panel, MENU, VIEWPORT);
  assert.ok(isOnScreen(p, MENU, VIEWPORT));
  assert.ok(
    p.y < row.y,
    "the flyout was lifted so its bottom fits, keeping it beside the row that opened it"
  );
});

test("flyout: with no room on EITHER side it is clamped on screen, never hidden", () => {
  const narrow: Size = { width: 400, height: 200 };
  const wide = { x: 60, y: 100, width: 400, height: 300 };
  const row = { x: 60, y: 200, width: 400, height: 20 };
  const p = placeFlyout(row, wide, narrow, { width: 700, height: 800 });
  assert.ok(
    isOnScreen(p, narrow, { width: 700, height: 800 }),
    `clamped flyout at ${p.x} escaped a 700px viewport`
  );
});

test("flyout: every corner of the viewport, exhaustively", () => {
  // A flyout's placement depends on its parent, so the four CORNERS above do
  // not cover it — the parent panel is what has to be at each corner.
  const size: Size = { width: 200, height: 240 };
  for (const px of [MENU_MARGIN, VIEWPORT.width - 248 - MENU_MARGIN]) {
    for (const py of [MENU_MARGIN, VIEWPORT.height - 300 - MENU_MARGIN]) {
      for (const rowOffset of [0, 280]) {
        const panel = { x: px, y: py, width: 248, height: 300 };
        const row = { x: px, y: py + rowOffset, width: 248, height: 20 };
        const p = placeFlyout(row, panel, size, VIEWPORT);
        assert.ok(
          isOnScreen(p, size, VIEWPORT),
          `flyout off screen for parent at (${px}, ${py}), row +${rowOffset}: got (${p.x}, ${p.y})`
        );
      }
    }
  }
});

/* ======================================================================== *
 * 2. THE ROW MODEL — "a disabled row states why"
 * ======================================================================== */

test("row model: a disabled row carries its reason and is drawn dim", () => {
  const model = rowModel({
    id: "paste",
    label: "Paste",
    command: "ctx.paste",
    disabledReason: "nothing here accepts text"
  });
  assert.equal(model.runnable, false);
  assert.equal(model.reason, "nothing here accepts text");
  assert.equal(toneToken(model.tone), "dim");
});

test("row model: a disabled row is still REACHABLE from the keyboard", () => {
  // Skipping it would put the reason out of reach of a keyboard user, which is
  // the pre-`disabledReason` experience this package exists to abolish.
  const model = rowModel({ id: "x", label: "X", command: "c", disabledReason: "not now" });
  assert.equal(model.focusable, true);
});

test("row model: no row is ever both inert and silent", () => {
  // The invariant, over every shape a row can take — including the ones a
  // hand-built or half-migrated map produces.
  const shapes: CtxItem[] = [
    { id: "a", label: "Runs", command: "c" },
    { id: "b", label: "Greyed", command: "c", disabledReason: "because" },
    { id: "c", label: "No command at all" },
    { id: "d", label: "Empty command", command: "" },
    { id: "e", label: "Empty submenu", role: "submenu", items: [] },
    { id: "f", label: "Danger", role: "danger", command: "c" },
    { id: "g", label: "Toggle", role: "toggle", command: "c", checked: true },
    { id: "h", label: "Sub", role: "submenu", items: [{ id: "h1", label: "Child", command: "c" }] }
  ];
  for (const item of shapes) {
    const m = rowModel(item);
    if (!m.focusable) continue;
    if (m.runnable || m.submenu) continue;
    assert.ok(
      m.reason && m.reason.length > 0,
      `"${item.label}" is focusable, cannot be actioned, and says nothing about why`
    );
  }
});

test("row model: a row that reached the renderer with no command says so", () => {
  const m = rowModel({ id: "x", label: "Broken" });
  assert.equal(m.runnable, false);
  assert.match(m.reason ?? "", /no command/i);
});

test("row model: danger is the error tone; separators and headers take no focus", () => {
  assert.equal(toneToken(rowModel({ id: "o", label: "Sign out", role: "danger", command: "c" }).tone), "err");
  assert.equal(rowModel({ id: "s", label: "", role: "separator" }).focusable, false);
  assert.equal(rowModel({ id: "h", label: "Head", role: "header" }).focusable, false);
});

test("row model: a toggle reports its state, and nothing else does", () => {
  assert.equal(rowModel({ id: "t", label: "T", role: "toggle", command: "c", checked: true }).checked, true);
  assert.equal(rowModel({ id: "t", label: "T", role: "toggle", command: "c" }).checked, false);
  assert.equal(rowModel({ id: "n", label: "N", command: "c" }).checked, null);
});

/* ======================================================================== *
 * 3. THE KEYBOARD — "fully keyboard-drivable"
 * ======================================================================== */

const MENU_ITEMS: CtxItem[] = [
  { id: "head", label: "Task · Fix login redirect", role: "header" },
  { id: "open", label: "Open", command: "task.open" },
  { id: "copy", label: "Copy", command: "task.copy" },
  { id: "sep", label: "", role: "separator" },
  { id: "cut", label: "Cut", command: "task.cut", disabledReason: "this text is not editable" },
  {
    id: "move",
    label: "Move to",
    role: "submenu",
    items: [
      { id: "m1", label: "Backlog", command: "task.move" },
      { id: "m2", label: "Doing", command: "task.move" },
      {
        id: "m3",
        label: "Done",
        role: "submenu",
        items: [{ id: "m3a", label: "Archive", command: "task.archive" }]
      }
    ]
  },
  { id: "del", label: "Delete", role: "danger", command: "task.delete" }
];

const key = (k: string, mods: Partial<NavKey> = {}): NavKey => ({ key: k, ...mods });
const NOW = 1_000_000;

/** Drive a sequence of keys, returning the final state and the last effect. */
function drive(state: NavState, keys: (string | NavKey)[], now = NOW) {
  let s = state;
  let last = navigate(MENU_ITEMS, s, key("Shift"), now);
  assert.equal(last.handled, false, "a bare modifier must never be a keystroke");
  for (const k of keys) {
    last = navigate(MENU_ITEMS, s, typeof k === "string" ? key(k) : k, now);
    s = last.state;
  }
  return { state: s, effect: last.effect, handled: last.handled };
}

const labelOf = (items: readonly CtxItem[], s: NavState): string =>
  panelItems(items, s.open)[s.index]?.label ?? "<none>";

test("keyboard: ArrowDown skips the header and the separator", () => {
  const a = drive(NAV_INITIAL, ["ArrowDown"]);
  assert.equal(labelOf(MENU_ITEMS, a.state), "Open", "the header is not a stop");

  const b = drive(NAV_INITIAL, ["ArrowDown", "ArrowDown", "ArrowDown"]);
  assert.equal(labelOf(MENU_ITEMS, b.state), "Cut", "the separator is not a stop");
});

test("keyboard: ArrowDown DOES stop on the disabled row", () => {
  const s = drive(NAV_INITIAL, ["ArrowDown", "ArrowDown", "ArrowDown"]).state;
  const item = panelItems(MENU_ITEMS, s.open)[s.index]!;
  assert.equal(item.id, "cut");
  assert.ok(rowModel(item).reason, "and the row it stopped on states why it cannot run");
});

test("keyboard: the arrows wrap in both directions", () => {
  const order = focusableIndexes(MENU_ITEMS);
  // From nothing focused, the FIRST press lands on the first row — so `order
  // .length` presses reach the last, and the next one wraps.
  const last = drive(NAV_INITIAL, Array(order.length).fill("ArrowDown"));
  assert.equal(last.state.index, order[order.length - 1], "the last focusable row");
  const wrapped = navigate(MENU_ITEMS, last.state, key("ArrowDown"), NOW);
  assert.equal(wrapped.state.index, order[0], "and one more wraps to the first");

  const up = drive(NAV_INITIAL, ["ArrowUp"]);
  assert.equal(up.state.index, order[order.length - 1], "ArrowUp from nothing lands on the last");
});

test("keyboard: Home and End jump to the first and last focusable rows", () => {
  const order = focusableIndexes(MENU_ITEMS);
  assert.equal(drive(NAV_INITIAL, ["End"]).state.index, order[order.length - 1]);
  assert.equal(drive(NAV_INITIAL, ["ArrowDown", "ArrowDown", "Home"]).state.index, order[0]);
});

test("keyboard: Enter runs the focused row", () => {
  const r = drive(NAV_INITIAL, ["ArrowDown", "Enter"]);
  assert.equal(r.effect.kind, "run");
  assert.equal(r.effect.kind === "run" && r.effect.item.command, "task.open");
});

test("keyboard: Enter on a DISABLED row does nothing and keeps the menu open", () => {
  // Closing would take the reason off the screen at the exact moment the user
  // asked what the row was for.
  const r = drive(NAV_INITIAL, ["ArrowDown", "ArrowDown", "ArrowDown", "Enter"]);
  assert.equal(r.effect.kind, "none");
  assert.equal(r.handled, true, "the key is still consumed — it must not fall through to the page");
});

test("keyboard: ArrowRight opens a submenu and lands on its first row", () => {
  const r = drive(NAV_INITIAL, ["End", "ArrowUp", "ArrowRight"]);
  assert.deepEqual(r.state.open, [5], "the 'Move to' flyout is open");
  assert.equal(labelOf(MENU_ITEMS, r.state), "Backlog");
});

test("keyboard: ArrowLeft closes the submenu and restores focus to the row that opened it", () => {
  const r = drive(NAV_INITIAL, ["End", "ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"]);
  assert.deepEqual(r.state.open, []);
  assert.equal(labelOf(MENU_ITEMS, r.state), "Move to");
});

test("keyboard: submenus nest, and unwind one level at a time", () => {
  const open = drive(NAV_INITIAL, ["End", "ArrowUp", "ArrowRight", "End", "ArrowRight"]);
  assert.deepEqual(open.state.open, [5, 2], "two levels deep");
  assert.equal(labelOf(MENU_ITEMS, open.state), "Archive");

  const back = navigate(MENU_ITEMS, open.state, key("Escape"), NOW);
  assert.deepEqual(back.state.open, [5], "Escape collapsed ONE level, not the whole menu");
  assert.equal(back.effect.kind, "none");
});

test("keyboard: Escape at the root closes the menu", () => {
  const r = navigate(MENU_ITEMS, NAV_INITIAL, key("Escape"), NOW);
  assert.equal(r.effect.kind, "close");
  assert.equal(r.handled, true);
});

test("keyboard: Tab closes rather than tabbing through rows", () => {
  assert.equal(navigate(MENU_ITEMS, NAV_INITIAL, key("Tab"), NOW).effect.kind, "close");
});

test("keyboard: ArrowRight on a non-submenu row is NOT handled, so the page keeps it", () => {
  const r = navigate(MENU_ITEMS, drive(NAV_INITIAL, ["ArrowDown"]).state, key("ArrowRight"), NOW);
  assert.equal(r.handled, false);
});

test("keyboard: keys the menu does not use fall through", () => {
  for (const k of ["F5", "PageDown", "Insert"]) {
    assert.equal(navigate(MENU_ITEMS, NAV_INITIAL, key(k), NOW).handled, false, k);
  }
  // …including a printable one with a modifier, which is a browser shortcut.
  assert.equal(navigate(MENU_ITEMS, NAV_INITIAL, key("f", { ctrlKey: true }), NOW).handled, false);
});

/* ------------------------------------------------------------- type-ahead */

test("type-ahead: one letter jumps to the matching row", () => {
  const r = navigate(MENU_ITEMS, NAV_INITIAL, key("d"), NOW);
  assert.equal(labelOf(MENU_ITEMS, r.state), "Delete");
});

test("type-ahead: repeating a letter cycles through every row starting with it", () => {
  // "Copy" and "Cut" both start with C.
  const first = navigate(MENU_ITEMS, NAV_INITIAL, key("c"), NOW);
  assert.equal(labelOf(MENU_ITEMS, first.state), "Copy");
  const second = navigate(MENU_ITEMS, first.state, key("c"), NOW + 50);
  assert.equal(labelOf(MENU_ITEMS, second.state), "Cut");
  const third = navigate(MENU_ITEMS, second.state, key("c"), NOW + 100);
  assert.equal(labelOf(MENU_ITEMS, third.state), "Copy", "and wraps");
});

test("type-ahead: a longer prefix REFINES the match rather than skipping past it", () => {
  const c = navigate(MENU_ITEMS, NAV_INITIAL, key("c"), NOW);
  assert.equal(labelOf(MENU_ITEMS, c.state), "Copy");
  const cu = navigate(MENU_ITEMS, c.state, key("u"), NOW + 50);
  assert.equal(labelOf(MENU_ITEMS, cu.state), "Cut", "'cu' matched Cut, not the row after Copy");
});

test("type-ahead: the buffer expires, so a later letter starts a fresh search", () => {
  const c = navigate(MENU_ITEMS, NAV_INITIAL, key("c"), NOW);
  const late = navigate(MENU_ITEMS, c.state, key("u"), NOW + TYPEAHEAD_RESET_MS + 1);
  assert.equal(late.state.typed, "u", "the stale 'c' was dropped");
  assert.equal(labelOf(MENU_ITEMS, late.state), "Copy", "no row starts with 'u' — focus holds");
});

test("type-ahead: no match keeps the buffer and holds focus", () => {
  const r = navigate(MENU_ITEMS, NAV_INITIAL, key("z"), NOW);
  assert.equal(r.handled, true);
  assert.equal(r.state.index, -1);
  assert.equal(r.state.typed, "z");
});

test("type-ahead: an arrow key ends the run", () => {
  const c = navigate(MENU_ITEMS, NAV_INITIAL, key("c"), NOW);
  const moved = navigate(MENU_ITEMS, c.state, key("ArrowDown"), NOW + 10);
  assert.equal(moved.state.typed, "", "a deliberate move must not leave a stale prefix behind");
});

test("type-ahead: Space activates, but continues a live buffer instead", () => {
  const plain = navigate(MENU_ITEMS, drive(NAV_INITIAL, ["ArrowDown"]).state, key(" "), NOW);
  assert.equal(plain.effect.kind, "run", "with no buffer, Space is Enter");

  const mid = navigate(MENU_ITEMS, navigate(MENU_ITEMS, NAV_INITIAL, key("m"), NOW).state, key(" "), NOW + 50);
  assert.equal(mid.effect.kind, "none", "mid-word, Space is a character");
  assert.equal(mid.state.typed, "m ");
});

test("type-ahead: it searches the OPEN panel, not the root", () => {
  const inSub = drive(NAV_INITIAL, ["End", "ArrowUp", "ArrowRight"]);
  const r = navigate(MENU_ITEMS, inSub.state, key("d"), NOW);
  assert.equal(labelOf(MENU_ITEMS, r.state), "Doing", "not the root's 'Delete'");
});

/* --------------------------------------------------------- opening states */

test("keyboard: a menu opened by the context-menu key starts on the first row", () => {
  // Otherwise the first ArrowDown is spent selecting what the user could
  // reasonably expect was already selected.
  const s = navFirst(MENU_ITEMS);
  assert.equal(labelOf(MENU_ITEMS, s), "Open");
  assert.deepEqual(s.open, []);
});

test("keyboard: a mouse-opened menu starts with nothing focused", () => {
  assert.equal(NAV_INITIAL.index, -1);
});

test("keyboard: every focusable row in every panel is reachable by arrows alone", () => {
  // The completeness claim, checked rather than asserted: walk down through the
  // root and every submenu, and account for every row the model says is a stop.
  const walk = (path: number[]) => {
    const rows = panelItems(MENU_ITEMS, path);
    const order = focusableIndexes(rows);
    let state: NavState = { open: path, index: -1, typed: "", typedAt: 0 };
    const seen: number[] = [];
    for (let i = 0; i < order.length; i++) {
      state = navigate(MENU_ITEMS, state, key("ArrowDown"), NOW).state;
      seen.push(state.index);
    }
    assert.deepEqual(seen, order, `panel [${path}] is not fully reachable`);
    for (const i of order) {
      if (rowModel(rows[i]!).submenu) walk([...path, i]);
    }
  };
  walk([]);
});

test("keyboard: itemAt addresses a nested row by its path", () => {
  assert.equal(itemAt(MENU_ITEMS, [5, 2, 0])?.label, "Archive");
  assert.equal(itemAt(MENU_ITEMS, [5, 9]), null);
  assert.equal(itemAt(MENU_ITEMS, []), null);
});

/* ======================================================================== *
 * 4. THE COMPONENT — the claims only the source can settle
 * ======================================================================== */

const COMPONENT = fs.readFileSync(path.join(CORE, "ContextMenu.tsx"), "utf8");

test("component: not one literal colour — everything goes through var(--axf-*)", () => {
  // Strip comments first: the docblock legitimately discusses colours.
  const code = COMPONENT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const literals = [
    ...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
    ...code.matchAll(/\b(?:rgb|rgba|hsl|hsla)\s*\(/g)
  ].map((m) => m[0]);
  assert.deepEqual(
    literals,
    [],
    `hard-coded colour(s) in ContextMenu.tsx: ${literals.join(", ")} — use token()`
  );
});

test("component: the row's reason is rendered, not merely computed", () => {
  // The gate says a disabled row STATES why. `row-model.ts` proves the reason
  // exists; only the component can be asked whether it reaches the screen.
  assert.match(COMPONENT, /model\.reason/, "the component never reads the reason");
  assert.match(COMPONENT, /title=\{model\.reason/, "the reason is not offered as a title");
});

test("component: the menu escapes overflow — top layer, with a fallback", () => {
  assert.match(COMPONENT, /showPopover/, "no top-layer escape at all");
  assert.match(COMPONENT, /popover: "manual"/, "the popover is not manual, so it will light-dismiss");
  assert.match(
    COMPONENT,
    /setTopLayer\(false\)/,
    "a refused popover must drop the attribute, or the UA's display:none hides the menu"
  );
});

test("component: the three pure modules are the ONLY way it decides anything", () => {
  // The structural claim this whole test file rests on. If the component grows
  // its own flip arithmetic or its own key switch, the assertions above stop
  // describing what ships.
  for (const fn of ["placeAtPoint", "placeFlyout", "navigate", "rowModel"]) {
    assert.match(COMPONENT, new RegExp(`\\b${fn}\\b`), `${fn} is no longer used`);
  }
  assert.doesNotMatch(
    COMPONENT,
    /case "Arrow(Up|Down|Left|Right)"/,
    "key handling has leaked back into the component"
  );
  assert.doesNotMatch(
    COMPONENT,
    /innerWidth\s*-\s*\w+\.width/,
    "flip/clamp arithmetic has leaked back into the component"
  );
});
