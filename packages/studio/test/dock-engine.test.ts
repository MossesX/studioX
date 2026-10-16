/**
 * @file The dock/float engine's pure half — the geometry P8 wired the command
 * bar, the module toolbars and every pane leaf onto.
 *
 * `dock/index.ts` describes `model.ts` as *"the pure geometry (no DOM, no React
 * — the half that can be wrong and therefore the half that is unit-tested)"*.
 * Until this file, nothing tested it, which made that sentence the most
 * expensive kind of wrong: a claim about coverage, in the barrel, that a reader
 * has no reason to doubt.
 *
 * What is pinned here is chosen by what the phase GATE asserts and what the
 * consumers actually rely on, not by what is easy to assert:
 *
 *   - **the FLIP** — the gate's word. It has to be a total function of the
 *     zone, decided while the drag is still in flight, or the ghost previews
 *     one shape and the release produces another;
 *   - **the CLAMP** — the step calls it *"the first defence"* against a
 *     toolbar dragged off-screen, and a defence nobody has watched hold is a
 *     defence nobody has tested;
 *   - **`isInFlow`** — added by P8 so `<Floatable>` and `PaneLayout` reach the
 *     same verdict. Two answers to "is this pane still here" is a hole in a
 *     split that nothing reports, so the cases are pinned rather than trusted;
 *   - **`parseDockState`** — the one input the engine does not control.
 *
 * A live browser probe would be the other half of this and is currently
 * impossible: the studio's sign-in gate turns every probe into a read of
 * `/login` (filed as I-31, which names `geometry-probe` among the ten). These
 * are the assertions that do not need a session.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCK_DEFAULT_FLOAT_SIZE,
  DOCK_SNAP_RANGE_PX,
  clampDockPosition,
  decide,
  dockTo,
  floatAt,
  isInFlow,
  nudged,
  orientationFor,
  parseDockState,
  resolveDockDefault
} from "@axf/core";
import type { DockState } from "@axf/core";

/** A 1000×600 container at the origin — the shape every case below snaps in. */
const BOX = { x: 0, y: 0, width: 1000, height: 600 };

const docked = (zone: DockState["zone"]): DockState => ({
  mode: "docked",
  zone,
  orientation: orientationFor(zone ?? "top"),
  z: 1
});

/* ── the flip ─────────────────────────────────────────────────────────────── */

test("the flip is a total function of the zone — vertical edges run vertical", () => {
  assert.equal(orientationFor("left"), "vertical");
  assert.equal(orientationFor("right"), "vertical");
  assert.equal(orientationFor("top"), "horizontal");
  assert.equal(orientationFor("bottom"), "horizontal");
  // A released float runs horizontal, so "no zone" is not a third answer.
  assert.equal(orientationFor(null), "horizontal");
});

test("the flip is decided DURING the drag, so the ghost previews the flipped shape", () => {
  // Well inside the left snap range: the decision must already say vertical
  // while the pointer is still down.
  const left = decide({ x: 10, y: 300 }, BOX);
  assert.equal(left.zone, "left");
  assert.equal(left.orientation, "vertical");
  assert.ok(left.ghostRect, "a snapping drag must preview a ghost");
  // The ghost is the vertical strip, not the horizontal one it came from.
  assert.ok(left.ghostRect!.height > left.ghostRect!.width);

  const top = decide({ x: 500, y: 10 }, BOX);
  assert.equal(top.zone, "top");
  assert.equal(top.orientation, "horizontal");
  assert.ok(top.ghostRect!.width > top.ghostRect!.height);
});

test("dockTo never takes a second opinion on orientation", () => {
  // A state carrying the WRONG orientation is repaired by the transition, not
  // preserved — the flip is the zone's, not the caller's.
  const wrong: DockState = { mode: "docked", zone: "top", orientation: "vertical", z: 1 };
  assert.equal(dockTo(wrong, "left").orientation, "vertical");
  assert.equal(dockTo(wrong, "bottom").orientation, "horizontal");
  assert.equal(dockTo(wrong, "bottom").zone, "bottom");
});

test("outside the snap range, and outside the container, nothing snaps", () => {
  assert.equal(decide({ x: 500, y: 300 }, BOX).zone, null, "the middle snaps to nothing");
  assert.equal(decide({ x: -5, y: 300 }, BOX).zone, null, "dragging OUT is how you undock");
  assert.equal(decide({ x: 500, y: 300 }, BOX).ghostRect, null);
  // Just inside vs just outside the documented range.
  assert.equal(decide({ x: DOCK_SNAP_RANGE_PX - 1, y: 300 }, BOX).zone, "left");
  assert.equal(decide({ x: DOCK_SNAP_RANGE_PX + 1, y: 300 }, BOX).zone, null);
});

test("a degenerate container answers null rather than producing a layout from nothing", () => {
  assert.equal(decide({ x: 0, y: 0 }, { x: 0, y: 0, width: 0, height: 0 }).zone, null);
});

test("a corner tie resolves deterministically, so a test can pin it", () => {
  // Exactly equidistant from top and left: evaluation order top → … wins.
  assert.equal(decide({ x: 5, y: 5 }, BOX).zone, "top");
});

/* ── the clamp: the first defence against a lost panel ─────────────────────── */

test("the clamp keeps a floating panel whole inside its container", () => {
  const size = { width: 320, height: 220 };
  const container = { width: 1000, height: 600 };
  assert.deepEqual(clampDockPosition({ x: 5000, y: 5000 }, size, container), {
    x: 1000 - 320,
    y: 600 - 220
  });
  assert.deepEqual(clampDockPosition({ x: -400, y: -400 }, size, container), { x: 0, y: 0 });
  // Already inside: untouched.
  assert.deepEqual(clampDockPosition({ x: 100, y: 100 }, size, container), { x: 100, y: 100 });
});

test("a panel larger than its container pins to the origin — the HANDLE stays reachable", () => {
  // The clamp's one non-obvious promise: it would rather show the top-left of
  // an oversized panel than centre it, because the handle (and its reset) live
  // there. Clamping into negative space is what strands somebody.
  const pos = clampDockPosition({ x: 300, y: 300 }, { width: 900, height: 700 }, { width: 400, height: 300 });
  assert.deepEqual(pos, { x: 0, y: 0 });
});

test("arrow-key nudges are clamped too, and a docked panel does not nudge", () => {
  const floating = floatAt(docked("top"), { x: 10, y: 10 }, { width: 100, height: 100 });
  const moved = nudged(floating, -500, -500, { width: 1000, height: 600 });
  assert.deepEqual(moved.position, { x: 0, y: 0 });
  // A docked panel's place is the zone's, not a coordinate.
  const still = docked("left");
  assert.equal(nudged(still, 50, 50, { width: 1000, height: 600 }), still);
});

/* ── isInFlow: one verdict, two callers ───────────────────────────────────── */

test("isInFlow: docked at home is in flow; anywhere else is not", () => {
  assert.equal(isInFlow(docked("top"), "top"), true, "a bar docked at its natural top");
  assert.equal(isInFlow(docked("left"), "top"), false, "docked to another edge is a fixed strip");
  assert.equal(isInFlow(docked("bottom"), "bottom"), true, "a status bar's home is the bottom");
  assert.equal(isInFlow(docked("top"), "bottom"), false);
});

test("isInFlow: floating is never in flow, whatever zone it remembers", () => {
  const drifting: DockState = {
    mode: "floating",
    zone: "top",
    orientation: "horizontal",
    position: { x: 10, y: 10 },
    size: DOCK_DEFAULT_FLOAT_SIZE,
    z: 1
  };
  assert.equal(isInFlow(drifting, "top"), false);
});

test("isInFlow: an absent zone reads as home — nobody has moved it", () => {
  // This is the case a pane hits before it has ever been dragged, and the case
  // PaneLayout must NOT collapse the slot for.
  const untouched: DockState = { mode: "docked", orientation: "horizontal", z: 1 };
  assert.equal(isInFlow(untouched, "top"), true);
  assert.equal(isInFlow(untouched, "left"), true);
});

/* ── the defaults path, and the one input the engine does not control ─────── */

test("resolveDockDefault is always internally consistent", () => {
  const d = resolveDockDefault();
  assert.equal(d.mode, "docked");
  assert.equal(d.zone, "top");
  assert.equal(d.orientation, "horizontal");
  // A docked default takes its zone's orientation whatever the partial claimed.
  assert.equal(resolveDockDefault({ zone: "left", orientation: "horizontal" }).orientation, "vertical");
  // A floating default always has something to draw at.
  const f = resolveDockDefault({ mode: "floating" });
  assert.ok(f.position && f.size);
  assert.equal(f.zone, undefined);
});

test("parseDockState reads junk as 'nobody decided' rather than throwing", () => {
  for (const junk of [null, undefined, 42, "docked", {}, { mode: "sideways" }, { mode: "docked", zone: "diagonal" }]) {
    assert.equal(parseDockState(junk), null, `${JSON.stringify(junk)} must not parse`);
  }
});

test("parseDockState REPAIRS what is unambiguous — a stored doc gets no vote on the flip", () => {
  const repaired = parseDockState({ mode: "docked", zone: "left", orientation: "horizontal", z: 3 });
  assert.equal(repaired?.orientation, "vertical", "the zone decides, not the document");
  assert.equal(repaired?.z, 3);
  // A floating state missing its geometry gets the defaults rather than null.
  const floated = parseDockState({ mode: "floating" });
  assert.equal(floated?.mode, "floating");
  assert.ok(floated?.position && floated?.size);
});

test("floatAt drops the zone — a re-dock is a new decision, never a stale edge restored", () => {
  const f = floatAt(docked("right"), { x: 40, y: 40 });
  assert.equal(f.zone, undefined);
  assert.equal(f.orientation, "horizontal");
  assert.deepEqual(f.size, DOCK_DEFAULT_FLOAT_SIZE);
});
