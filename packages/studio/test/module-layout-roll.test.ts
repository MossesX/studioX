/**
 * @file Module-interior layout is ROLLABLE — the contract, and the traps.
 *
 * Until 2026-08-11 every `layout` dial addressed the shell (nav, bar, page), so
 * a roll could move the nav to another edge and leave every module's interior
 * pixel-identical. `module.ts` had described a module as having "its panes
 * rearranged by a rolled layout" the whole time. These lock the dials that made
 * that true, and the two ways the mechanism silently fails.
 *
 * DISCOVERING, not a hand-kept list: the first test walks `DIALS` itself, so a
 * layout dial added later is covered the day it is written with no edit here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DIALS, defaultValues, rollTheme, themeVariables } from "@axf/core";
import type { NumberDial } from "@axf/core";

/** The dials that address a module's interior rather than the shell chrome. */
const MODULE_LAYOUT = ["gridColumns", "gridUnit", "gridGap", "surfacePad", "paneGutter"];

describe("a dial cannot publish a broken CSS value", () => {
  /**
   * The trap that actually fired while these dials were being added.
   *
   * `themeVariables` builds a number's value as `${raw}${unit}`. `gridColumns`
   * is a column COUNT and the first number dial with no unit — written without
   * one it published the string "4undefined", which is not a CSS *error*: the
   * browser discards the declaration and the property silently keeps its
   * previous value, so the dial appears to do nothing at all. That is the worst
   * class of failure this engine can have, because it looks like a no-op rather
   * than a fault.
   */
  it("no published variable contains 'undefined' or 'NaN' — over every dial", () => {
    for (const values of [defaultValues(), rollTheme("aaa111").values, rollTheme("zz9z9z").values]) {
      for (const [name, value] of Object.entries(themeVariables(values))) {
        assert.ok(
          !/undefined|NaN/.test(String(value)),
          `${name} published "${value}" — the browser discards this and the dial does nothing`
        );
      }
    }
  });

  it("every number dial declares a unit, '' included — discovering", () => {
    for (const dial of DIALS) {
      if (dial.kind !== "number") continue;
      const n = dial as NumberDial;
      assert.equal(
        typeof n.unit,
        "string",
        `${n.id} has no unit; NumberDial documents "" for a bare number`
      );
    }
  });
});

describe("module-interior layout actually rolls", () => {
  it("the module layout dials exist, and are layout-subsystem", () => {
    for (const id of MODULE_LAYOUT) {
      const dial = DIALS.find((d) => d.id === id);
      assert.ok(dial, `${id} is missing — module interiors stop being rollable without it`);
      assert.equal(dial.subsystem, "layout", `${id} must be a layout dial`);
    }
  });

  it("each one publishes a CSS variable a module can consume", () => {
    const vars = themeVariables(defaultValues());
    for (const id of MODULE_LAYOUT) {
      const dial = DIALS.find((d) => d.id === id)!;
      assert.ok(
        vars[dial.cssVar],
        `${id} declares ${dial.cssVar} but nothing published it`
      );
    }
  });

  it("a roll VARIES them — the whole point, and easy to lose", () => {
    // A dial the generator does not vary is a dial that is themeable in
    // principle and constant in practice. Several seeds, because any two could
    // coincide on a small range.
    const seeds = ["aaa111", "bbb222", "ccc333", "ddd444", "eee555", "fff666"];
    const rolls = seeds.map((s) => rollTheme(s).values);
    for (const id of MODULE_LAYOUT) {
      const seen = new Set(rolls.map((v) => String(v[id])));
      assert.ok(
        seen.size > 1,
        `${id} was identical across ${seeds.length} seeds (${[...seen]}) — a roll does not move it`
      );
    }
  });

  it("rolled values stay inside their declared bounds — a roll may not break a screen", () => {
    // The bound IS the safety property: no roll may produce a zero-column grid
    // or a negative gutter, because a roll that can make content unreachable is
    // a roll nobody dares run.
    for (const seed of ["aaa111", "zzz999", "q1w2e3", "000000", "ffffff"]) {
      const values = rollTheme(seed).values;
      for (const id of MODULE_LAYOUT) {
        const dial = DIALS.find((d) => d.id === id) as NumberDial;
        const got = Number(values[id]);
        assert.ok(
          got >= dial.min && got <= dial.max,
          `seed ${seed}: ${id}=${got} outside [${dial.min},${dial.max}]`
        );
        assert.ok(got > 0, `seed ${seed}: ${id}=${got} is not a usable geometry value`);
      }
    }
  });

  it("gridColumns rolls to whole columns only", () => {
    // Half a column is not a layout. The placement math rounds anyway, but a
    // fractional dial would make the CSS template and the math disagree about
    // where card 4 goes — the divergence the dashboard reads ONE number to avoid.
    for (const seed of ["aaa111", "bbb222", "ccc333", "zzz999"]) {
      const n = Number(rollTheme(seed).values.gridColumns);
      assert.equal(n, Math.round(n), `seed ${seed} rolled ${n} columns`);
    }
  });
});
