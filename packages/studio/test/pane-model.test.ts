/**
 * @file The pane model's pure half — the chokepoint's validations, the
 * fraction arithmetic, and above all the scar this renderer exists to close:
 * **an unmeasured extent must never move a fraction.** GizmoX's LayoutRenderer
 * prorated weights against zero and latched splits at their minimum; here that
 * exact input — extent 0 — is asserted to be a no-op, by identity of values.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MIN_PANE_PX,
  PaneDefinitionError,
  applyDrag,
  definePanes,
  minExtentAlong,
  normalFractions,
  parsePaneDoc,
  treeSignature
} from "@axf/core";
import type { PaneSplitSpec } from "@axf/core";

const TREE = definePanes({
  kind: "split",
  direction: "row",
  weights: [68, 32],
  children: [
    { kind: "pane", id: "transcript", minSize: 240 },
    {
      kind: "split",
      direction: "column",
      children: [
        { kind: "pane", id: "tools", minSize: 96 },
        { kind: "pane", id: "library", minSize: 96 }
      ]
    }
  ]
});

describe("definePanes — the chokepoint", () => {
  it("refuses a one-child split", () => {
    assert.throws(
      () => definePanes({ kind: "split", direction: "row", children: [{ kind: "pane", id: "only" }] }),
      PaneDefinitionError
    );
  });

  it("refuses mismatched or non-positive weights", () => {
    const children: PaneSplitSpec["children"] = [
      { kind: "pane", id: "a" },
      { kind: "pane", id: "b" }
    ];
    assert.throws(
      () => definePanes({ kind: "split", direction: "row", weights: [1], children }),
      /1 weights for 2 children/
    );
    assert.throws(
      () => definePanes({ kind: "split", direction: "row", weights: [1, 0], children }),
      /finite and positive/
    );
  });

  it("refuses duplicate pane ids — the latch keys on them", () => {
    assert.throws(
      () =>
        definePanes({
          kind: "split",
          direction: "row",
          children: [
            { kind: "pane", id: "x" },
            { kind: "pane", id: "x" }
          ]
        }),
      /appears twice/
    );
  });
});

describe("fractions", () => {
  it("normalises declared weights and defaults to equal shares", () => {
    assert.deepEqual(normalFractions(TREE as PaneSplitSpec), [0.68, 0.32]);
    assert.deepEqual(
      normalFractions({
        kind: "split",
        direction: "row",
        children: [
          { kind: "pane", id: "a" },
          { kind: "pane", id: "b" }
        ]
      }),
      [0.5, 0.5]
    );
  });

  it("computes min extents: sums along the axis (plus gutters), max across it", () => {
    const nested = (TREE as PaneSplitSpec).children[1];
    // Along the nested column's own axis its floors add up.
    assert.equal(minExtentAlong(nested, "column", 6), 96 + 96 + 6);
    // Across it (the outer row's axis) the deepest single floor governs.
    assert.equal(minExtentAlong(nested, "row", 6), 96);
    assert.equal(minExtentAlong({ kind: "pane", id: "bare" }, "row", 6), DEFAULT_MIN_PANE_PX);
  });
});

describe("applyDrag — measure before you latch, in pure form", () => {
  const start = [0.68, 0.32];

  it("a ZERO extent is a no-op: the exact GizmoX-scar input moves nothing", () => {
    assert.deepEqual(applyDrag(start, 0, -500, 0, 240, 96), start);
    assert.deepEqual(applyDrag(start, 0, -500, -1, 240, 96), start);
  });

  it("converts pixels to fractions against the real extent", () => {
    const next = applyDrag(start, 0, -100, 1000, 0, 0);
    assert.ok(Math.abs(next[0] - 0.58) < 1e-9);
    assert.ok(Math.abs(next[1] - 0.42) < 1e-9);
    // The pair is conserved — a drag moves a boundary, never total space.
    assert.ok(Math.abs(next[0] + next[1] - 1) < 1e-9);
  });

  it("clamps both neighbours at their pixel floors", () => {
    const squeezeA = applyDrag(start, 0, -900, 1000, 240, 96);
    assert.ok(Math.abs(squeezeA[0] - 0.24) < 1e-9); // 240px of 1000
    const squeezeB = applyDrag(start, 0, +900, 1000, 240, 96);
    assert.ok(Math.abs(squeezeB[1] - 0.096) < 1e-9); // 96px of 1000
  });

  it("ignores an out-of-range boundary index", () => {
    assert.deepEqual(applyDrag(start, 5, 50, 1000, 0, 0), start);
  });
});

describe("the persisted latch", () => {
  const signature = treeSignature(TREE);

  it("signature encodes structure and ids, never weights", () => {
    assert.equal(signature, "row[transcript,column[tools,library]]");
    const retuned = definePanes({ ...(TREE as PaneSplitSpec), weights: [50, 50] });
    assert.equal(treeSignature(retuned), signature); // a retune keeps the latch
  });

  it("round-trips a valid doc and refuses everything else", () => {
    const fractions = { root: [0.6, 0.4] };
    const doc = { format: "axf-panes/1", signature, fractions };
    assert.deepEqual(parsePaneDoc(doc, signature), fractions);

    assert.equal(parsePaneDoc(null, signature), null);
    assert.equal(parsePaneDoc({ ...doc, format: "other/1" }, signature), null);
    assert.equal(parsePaneDoc({ ...doc, signature: "row[a,b]" }, signature), null, "stale structure");
    assert.equal(parsePaneDoc({ ...doc, fractions: { root: [0.6, 0.6] } }, signature), null, "does not sum to 1");
    assert.equal(parsePaneDoc({ ...doc, fractions: { root: [1.2, -0.2] } }, signature), null, "negative share");
    assert.equal(parsePaneDoc({ ...doc, fractions: { root: [1] } }, signature), null, "one-entry split");
  });
});
