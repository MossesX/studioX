/**
 * @file The non-module surface inventory — the data behind the theme designer's
 * Surfaces tab.
 *
 * This carries more weight than a normal data test: the tab lives behind the
 * session gate, so the screen itself cannot be walked without signing in. These
 * assertions are what stands in for that walk, which is why they check the
 * subtraction ITSELF (does a module leak into the list?) rather than just the
 * shape of what comes out.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { surfaceInventory } from "@axs/surfaces/inventory";
import { allXLandings } from "@axs/x-landing/catalog";

/** Stand-in for the live route facts `/api/axf/surfaces` serves. */
const FACTS = {
  live: [
    "/",
    "/taskman",
    "/amberxvid",
    "/accounts",
    "/login",
    "/login-landing",
    "/settings",
    "/docs"
  ],
  moduleRoutes: ["/taskman", "/amberxvid", "/accounts"]
};

test("surface inventory: modules are excluded — that is the whole subtraction", () => {
  const ids = surfaceInventory(FACTS).map((s) => s.id);
  for (const owned of FACTS.moduleRoutes) {
    assert.ok(!ids.includes(owned), `${owned} is a module's route and must not appear among non-module surfaces`);
  }
});

test("surface inventory: the dashboard is excluded", () => {
  // `/` is the dashboard — the studio's own home, not a plugin screen. Listing
  // it under "UI that is not a module" would be technically true and useless.
  assert.ok(!surfaceInventory(FACTS).some((s) => s.route === "/"));
});

test("surface inventory: every landing appears, and only landings are editable", () => {
  const rows = surfaceInventory(FACTS);
  for (const landing of allXLandings()) {
    const row = rows.find((s) => s.id === landing.id);
    assert.ok(row, `landing ${landing.id} is missing from the inventory`);
    assert.equal(row!.kind, "landing");
    assert.equal(row!.editable, true, "a landing has an authoring engine, so it is editable");
    assert.equal(row!.route, landing.route);
  }
  // Nothing else claims to be editable — the tab draws real controls off this
  // flag, and a false positive there is a control that silently does nothing.
  for (const row of rows.filter((s) => s.kind !== "landing")) {
    assert.equal(row.editable, false, `${row.id} claims to be editable but has no engine behind it`);
    assert.ok(row.notEditableWhy, `${row.id} must say WHY it cannot be edited, not just refuse`);
  }
});

test("surface inventory: a landing's route is not also listed as a plugin screen", () => {
  // /login-landing is a landing AND a live route. Listed twice it would offer
  // two rows for one screen, one of them claiming to be uneditable.
  const rows = surfaceInventory(FACTS);
  const routes = rows.map((s) => s.route).filter(Boolean);
  assert.equal(new Set(routes).size, routes.length, `duplicate route in the inventory: ${routes.join(", ")}`);
});

test("surface inventory: plugin screens and dialogs are both represented", () => {
  const rows = surfaceInventory(FACTS);
  assert.ok(
    rows.some((s) => s.kind === "route" && s.route === "/settings"),
    "a plugin-owned screen should be listed"
  );
  assert.ok(
    rows.some((s) => s.kind === "route" && s.route === "/login"),
    "the chromeless gate is a non-module surface and should be listed"
  );
  assert.ok(rows.some((s) => s.kind === "dialog" && s.route === null), "dialogs are listed with no route");
});

test("surface inventory: an empty route table degrades to landings and dialogs", () => {
  // The tab renders before `/api/axf/surfaces` answers, and on a failed fetch it
  // never answers at all. Neither may produce a crash or an empty screen.
  const rows = surfaceInventory({ live: [], moduleRoutes: [] });
  assert.ok(rows.length > 0, "an empty route table must still list landings and dialogs");
  assert.ok(rows.some((s) => s.kind === "landing"));
});
