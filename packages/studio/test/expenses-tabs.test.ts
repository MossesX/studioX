/**
 * @file The expenses tab group, held to the owner's contract: a generated
 * report is A TAB — its own, titled, closable, one of many — and the group is
 * a store, so tabs survive any remount of the screen that shows them.
 *
 * Everything here is the PURE half (`tabs.ts`); the strip, the windows and the
 * iframe are React over this model, and not one property below needs a DOM to
 * be true or false: "a second report opens a second tab", "the same saved
 * report never grows a duplicate", "closing keeps your place", "floating is
 * not closing" are all statements about the store.
 *
 * Tests construct fresh `TabsStore` instances; the app's `expenseTabs`
 * singleton is the same class, and the one singleton test at the end is what
 * makes the remount-survival claim about THAT object rather than the class.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  BASE_TABS,
  TabsStore,
  expenseTabs,
  type ReportPayload
} from "../src/modules/expenses/tabs.ts";

/* ------------------------------------------------------------------ helpers */

const draft = (over: Partial<ReportPayload> = {}): ReportPayload => ({
  name: null,
  format: "html",
  content: "<!doctype html><html><body>report</body></html>",
  ...over
});

const ids = (store: TabsStore) => store.getState().tabs.map((t) => t.id);

/* ===================================================== reports open as tabs */

describe("a generated report becomes its own tab", () => {
  test("opening a draft adds a report tab, titled as asked, and activates it", () => {
    const store = new TabsStore();
    const id = store.openReport(draft(), "Expense statement — 2026-08");
    const state = store.getState();
    const tab = state.tabs.find((t) => t.id === id);
    assert.equal(state.tabs.length, BASE_TABS.length + 1);
    assert.equal(tab?.kind, "report");
    assert.equal(tab?.title, "Expense statement — 2026-08");
    assert.equal(state.activeId, id);
    assert.equal(tab?.window, null);
  });

  test("generating a second report opens a SECOND tab — it never replaces the first", () => {
    const store = new TabsStore();
    const first = store.openReport(draft(), "Statement — July");
    const second = store.openReport(draft(), "Statement — August");
    assert.notEqual(first, second);
    const state = store.getState();
    assert.ok(state.tabs.some((t) => t.id === first));
    assert.ok(state.tabs.some((t) => t.id === second));
    assert.equal(state.tabs.filter((t) => t.kind === "report").length, 2);
    assert.equal(state.activeId, second);
  });

  test("opening the same SAVED report twice focuses the tab you already have", () => {
    const store = new TabsStore();
    const a = store.openReport(draft({ name: "expenses-2026-08.html" }), "August");
    store.activate("grid");
    const b = store.openReport(
      draft({ name: "expenses-2026-08.html", content: "<html>fresher</html>" }),
      "August (reopened)"
    );
    assert.equal(a, b);
    const state = store.getState();
    const copies = state.tabs.filter((t) => t.id === a);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].title, "August (reopened)");
    assert.equal(copies[0].report?.content, "<html>fresher</html>");
    assert.equal(state.activeId, a);
  });

  test("a saved draft adopts the filename identity, and the strip follows it", () => {
    const store = new TabsStore();
    const id = store.openReport(draft(), "Draft");
    const next = store.renameReport(id, "expenses-2026-08.html", "August");
    assert.equal(next, "report:expenses-2026-08.html");
    const state = store.getState();
    assert.ok(!state.tabs.some((t) => t.id === id));
    const tab = state.tabs.find((t) => t.id === next);
    assert.equal(tab?.report?.name, "expenses-2026-08.html");
    assert.equal(tab?.title, "August");
    assert.equal(state.activeId, next);
  });

  test("saving over an already-open copy of that file closes the clash, not the save", () => {
    const store = new TabsStore();
    store.openReport(draft({ name: "august.html" }), "August (old)");
    const fresh = store.openReport(draft(), "Draft");
    const next = store.renameReport(fresh, "august.html", "August (new)");
    const copies = store.getState().tabs.filter((t) => t.id === next);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].title, "August (new)");
  });
});

/* ============================================================== closing tabs */

describe("tabs are closable, and closing keeps your place", () => {
  test("closing the active middle tab activates the neighbour that took its place", () => {
    const store = new TabsStore();
    store.activate("tree");
    store.close("tree");
    const state = store.getState();
    assert.ok(!state.tabs.some((t) => t.id === "tree"));
    assert.equal(state.activeId, "statements");
  });

  test("closing every tab leaves an EMPTY group — a legitimate state, not an error", () => {
    const store = new TabsStore();
    for (const id of ids(store)) store.close(id);
    const state = store.getState();
    assert.equal(state.tabs.length, 0);
    assert.equal(state.activeId, null);
  });

  test("close-others clears floated tabs too — that is what 'others' means on screen", () => {
    const store = new TabsStore();
    const report = store.openReport(draft(), "Keep me");
    store.float("tree");
    store.closeOthers(report);
    const state = store.getState();
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].id, report);
    assert.equal(state.activeId, report);
  });

  test("restore brings the base views back in canonical order, ahead of reports", () => {
    const store = new TabsStore();
    store.openReport(draft(), "Report");
    store.close("grid");
    store.close("tree");
    store.close("statements");
    store.restoreBaseTabs();
    const order = ids(store);
    assert.deepEqual(order.slice(0, 3), ["grid", "tree", "statements"]);
    assert.equal(store.getState().tabs[3].kind, "report");
  });
});

/* ================================================================== floating */

describe("floating moves a tab out of the strip without closing it", () => {
  test("a floated tab leaves the docked list but keeps its content", () => {
    const store = new TabsStore();
    const id = store.openReport(draft(), "Report");
    store.float(id);
    assert.ok(!store.docked().some((t) => t.id === id));
    const win = store.floating().find((t) => t.id === id);
    assert.ok(win?.window);
    assert.equal(win?.report?.content, draft().content);
    // The strip reseated itself rather than pointing at a window.
    assert.notEqual(store.getState().activeId, id);
  });

  test("windows cascade — two floats never land on exactly the same spot", () => {
    const store = new TabsStore();
    store.float("grid");
    store.float("tree");
    const [a, b] = store.floating();
    assert.ok(a.window && b.window);
    assert.notDeepEqual({ x: a.window.x, y: a.window.y }, { x: b.window.x, y: b.window.y });
  });

  test("activating a floated tab focuses its WINDOW instead of re-docking it", () => {
    const store = new TabsStore();
    store.float("grid");
    const before = store.get("grid")?.window?.z ?? 0;
    store.float("tree");
    store.activate("grid");
    const tab = store.get("grid");
    assert.ok(tab?.window, "activate must not dock the window");
    assert.ok((tab?.window?.z ?? 0) > before, "the window came to the front");
  });

  test("docking puts the tab back in the strip and makes it active", () => {
    const store = new TabsStore();
    const id = store.openReport(draft(), "Report");
    store.float(id);
    store.dock(id);
    const state = store.getState();
    const tab = state.tabs.find((t) => t.id === id);
    assert.equal(tab?.window, null);
    assert.equal(state.activeId, id);
  });

  test("floating the last docked tab empties the strip while the window lives on", () => {
    const store = new TabsStore();
    store.close("tree");
    store.close("statements");
    store.float("grid");
    const state = store.getState();
    assert.equal(state.activeId, null);
    assert.equal(store.docked().length, 0);
    assert.equal(store.floating().length, 1);
  });
});

/* ============================================== the store outlives the screen */

describe("tab state lives in the module store, not the component", () => {
  test("a remount — unsubscribe, then a fresh subscription — sees the same open tabs", () => {
    const id = expenseTabs.openReport(draft(), "Survives remount");
    const unmount = expenseTabs.subscribe(() => {});
    unmount();
    let notified = 0;
    const remount = expenseTabs.subscribe(() => notified++);
    const state = expenseTabs.getState();
    assert.ok(state.tabs.some((t) => t.id === id && t.title === "Survives remount"));
    expenseTabs.activate("grid");
    assert.equal(notified, 1);
    remount();
    expenseTabs.close(id);
  });

  test("the server snapshot is constant, so hydration cannot tear", () => {
    assert.equal(expenseTabs.getServerState(), expenseTabs.getServerState());
    assert.deepEqual(
      expenseTabs.getServerState().tabs.map((t) => t.id),
      BASE_TABS.map((t) => t.id)
    );
  });
});
