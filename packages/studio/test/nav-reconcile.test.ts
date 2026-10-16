/**
 * @file The saved-nav reconciler's gate — that a forked menu keeps up.
 *
 * `check:nav` proves the AUTHORED menus link every live route and every
 * declared module. It cannot prove anything about the menu the app actually
 * renders, because that one lives in user data (`chrome-assets.json`) and is
 * minted by the branding page's glyph editor, which copies the source WHOLE and
 * freezes its destinations. Measured 2026-08-13: the live fork carried 16 rows
 * against the authored 19, with two modules registered that same day missing
 * from it, and every gate green throughout.
 *
 * So this covers the half no gate could reach — and it is a unit test rather
 * than another scanner because `reconcileNav` is pure, and the properties worth
 * pinning are behavioural: it must add what is missing, put it in the right
 * place, and change NOTHING a user deliberately made theirs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { NavMenuAsset } from "@axf/core";

import { reconcileNav } from "../src/chrome/reconcile";

const authored: NavMenuAsset = {
  id: "studio-nav",
  title: "Studio navigation",
  surface: "app.nav",
  description: "authored",
  items: [
    { kind: "section", id: "sec-core", label: "Core" },
    { kind: "link", id: "index", label: "Dashboard", glyph: "icon-grid", route: "/" },
    { kind: "link", id: "taskman", label: "Task Manager", glyph: "icon-layers", route: "/taskman" },
    { kind: "link", id: "newmod", label: "New Module", glyph: "icon-bolt", route: "/newmod" },
    { kind: "divider", id: "div-1" },
    { kind: "section", id: "sec-studio", label: "Studio" },
    { kind: "link", id: "settings", label: "Settings", glyph: "icon-gear", route: "/settings" }
  ]
};

/** A fork as the glyph editor mints one: same rows, replaced drawings, and
 *  missing whatever was registered after the day it was made. */
const fork: NavMenuAsset = {
  id: "custom-studio-navigation-edited",
  title: "Studio navigation (edited)",
  surface: "app.nav",
  description: "forked",
  items: [
    { kind: "section", id: "sec-core", label: "Core" },
    { kind: "link", id: "index", label: "Home", glyph: "anim-logo-draw-hex", route: "/" },
    { kind: "link", id: "taskman", label: "Task Manager", glyph: "spinner-cross-spin", route: "/taskman" },
    { kind: "divider", id: "div-1" },
    { kind: "section", id: "sec-studio", label: "Studio" },
    { kind: "link", id: "settings", label: "Settings", glyph: "icon-gear", route: "/settings" }
  ]
};

test("a missing destination is added, inside the section it belongs to", () => {
  const out = reconcileNav(fork, [authored]);
  const routes = out.items.filter((i) => i.kind === "link").map((i) => i.route);
  assert.ok(routes.includes("/newmod"), "the module registered after the fork was made is absent");
  // Directly after `/taskman`, which is what it follows in the source — not at
  // the foot, where it would land under the "Studio" heading and read as one.
  assert.deepEqual(routes, ["/", "/taskman", "/newmod", "/settings"]);
});

test("nothing the user made theirs is touched", () => {
  const out = reconcileNav(fork, [authored]);
  const byRoute = new Map(out.items.filter((i) => i.kind === "link").map((i) => [i.route, i]));
  // The replaced drawings are the entire point of a fork; a reconciler that
  // "fixed" them back to the source glyph would undo the edit it exists beside.
  assert.equal(byRoute.get("/")?.glyph, "anim-logo-draw-hex");
  assert.equal(byRoute.get("/taskman")?.glyph, "spinner-cross-spin");
  // A relabelled row keeps its label — matching is by ROUTE for this reason.
  assert.equal(byRoute.get("/")?.label, "Home");
  assert.equal(out.title, "Studio navigation (edited)");
  assert.equal(out.id, "custom-studio-navigation-edited");
});

test("an up-to-date fork is returned unchanged, by identity", () => {
  const current = reconcileNav(fork, [{ ...authored, items: fork.items }]);
  // Identity, not deep equality: `seedChromeAssets` runs in the render phase and
  // a fresh object every render invalidates the registry snapshot every render,
  // which `useSyncExternalStore` turns into an infinite loop.
  assert.equal(current, fork);
});

test("a menu for another surface contributes nothing", () => {
  const other: NavMenuAsset = { ...authored, id: "other", surface: "app.sidebar" };
  assert.equal(reconcileNav(fork, [other]), fork);
});

test("an id collision yields a suffixed row rather than a dropped one", () => {
  // `defineNavMenu` refuses a repeated item id and the refusal costs the WHOLE
  // menu, so a fork that reused an id must still gain the destination.
  const clash: NavMenuAsset = {
    ...fork,
    items: [...fork.items, { kind: "link", id: "newmod", label: "Mine", glyph: "icon-eye", route: "/mine" }]
  };
  const out = reconcileNav(clash, [authored]);
  const ids = out.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "ids must stay unique or the menu is refused whole");
  assert.ok(out.items.some((i) => i.kind === "link" && i.route === "/newmod"));
  assert.ok(out.items.some((i) => i.kind === "link" && i.route === "/mine"));
});
