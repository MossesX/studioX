/**
 * The Theme Manager's two load-bearing engines, asserted headlessly.
 *
 * Everything visible about this surface is chrome around two pure functions,
 * and both of them fail SILENTLY when they are wrong — which is the whole
 * reason they were written apart from the component:
 *
 *   - `matchTokens` answering the wrong dial does not throw and does not look
 *     broken. It scrolls to a plausible row and glows it, and the person
 *     believes it. A reverse lookup that is confidently wrong is strictly worse
 *     than one that says "nothing here is themed", so the tolerance and the
 *     refusal past it are asserted, not just the happy path.
 *   - `gaugedRoll` honouring a gauge is invisible until you compare two rolls.
 *     A gauge that quietly does nothing is exactly what an optionless dial does
 *     (`generate.ts` records that failure), and "I pressed Roll and it looked
 *     different" cannot tell the two apart.
 *
 * No DOM here on purpose: the component supplies `getComputedStyle` and
 * `elementFromPoint`, and everything downstream of those strings is this.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultValues, contrast, hexToHsl } from "@axf/core";

import {
  gaugedRoll,
  gaugesFrom,
  CONTRAST_RANGE,
  DEFAULT_GAUGES
} from "../src/plugins/theme-manager/gauges";
import {
  buildTokenIndex,
  composite,
  describeMatches,
  matchTokens,
  pageRgb,
  parseColor,
  COLOR_TOLERANCE
} from "../src/plugins/theme-manager/locate";

const VALUES = defaultValues();
const INDEX = buildTokenIndex(VALUES);

/* ------------------------------------------------------------------ parsing */

test("every colour spelling a browser can report is parsed, and the rest is null", () => {
  assert.deepEqual(parseColor("#ff7a1a"), [255, 122, 26, 1]);
  assert.deepEqual(parseColor("#f71"), [255, 119, 17, 1]);
  assert.deepEqual(parseColor("rgb(255, 122, 26)"), [255, 122, 26, 1]);
  assert.deepEqual(parseColor("rgb(255 122 26 / 0.5)"), [255, 122, 26, 0.5]);
  assert.deepEqual(parseColor("rgba(255, 122, 26, 0.25)"), [255, 122, 26, 0.25]);
  // A value this module cannot read must resolve to NOTHING rather than to a
  // guess — a fabricated RGB would name a dial with full confidence.
  assert.equal(parseColor("color(srgb 1 .48 .1)"), null);
  assert.equal(parseColor("oklch(70% .2 40)"), null);
  assert.equal(parseColor(undefined), null);
});

test("a fully transparent colour carries no colour information", () => {
  // `rgba(0,0,0,0)` is what an element with no background reports. Compositing
  // it would produce the page colour and every unstyled div would "resolve" to
  // the `page` dial.
  assert.equal(composite([0, 0, 0, 0], [14, 16, 19]), null);
});

/* -------------------------------------------------------------- the index */

test("the index attributes a dial's own variable, a derived one, and a brand role", () => {
  const of = (cssVar: string) => INDEX.find((e) => e.cssVar === cssVar);

  assert.equal(of("--axf-accent")?.dialId, "accent", "a dial's own cssVar");
  assert.equal(of("--axf-accent")?.direct, true);

  // Derived tokens are attributed to their FIRST dial dependency, so clicking
  // something painted by the size ramp lands on the dial that drives it.
  const label = of("--axf-size-label");
  assert.ok(label, "the derived size ramp is in the index");
  assert.equal(label.dialId, "sizeBody");
  assert.equal(label.direct, false);

  // The brand bridge republishes the palette under two more vocabularies; a
  // click on a pack drawing must land on the palette dial that paints it.
  assert.equal(of("--gxb-accent")?.dialId, "accent");
  assert.equal(of("--axf-brand-ink")?.dialId, "ink");
});

/* -------------------------------------------------------------- the lookup */

test("an exact colour resolves to its dial", () => {
  const matches = matchTokens({ color: VALUES.ink as string }, INDEX);
  assert.equal(matches[0]?.dialId, "ink");
  assert.equal(matches[0]?.property, "text");
  assert.equal(matches[0]?.exact, true);
});

test("a composited hover overlay still resolves — the reason nearest-match exists", () => {
  // MUI paints a hovered row as the panel colour under a low-alpha ink wash.
  // The computed value shares no digits with any token, so an exact match would
  // report "nothing is themed" for half the app's chrome.
  //
  // It resolves to `panel2`, not `panel`, and that is the RIGHT answer rather
  // than a near miss: the elevation ramp is ~15 apart in RGB, a 4% ink wash
  // moves a surface almost exactly one step up it, and `panel2`'s own effect
  // line in the spec is "gutters, headers, hovered rows". The person clicking a
  // hovered row is being sent to the dial that decides what a hovered row looks
  // like.
  const panel = parseColor(VALUES.panel as string);
  assert.ok(panel);
  const washed = composite([230, 232, 236, 0.04], [panel[0], panel[1], panel[2]]);
  assert.ok(washed);
  const matches = matchTokens(
    { backgroundColor: `rgb(${washed[0]}, ${washed[1]}, ${washed[2]})` },
    INDEX
  );
  assert.equal(matches[0]?.dialId, "panel2");
  assert.equal(matches[0]?.exact, false, "near, and it says so rather than claiming exact");
});

test("a colour outside the tolerance resolves to NOTHING, and the footer says so", () => {
  // Magenta is nowhere near any default token. The nearest-of-everything answer
  // would be a confident lie; the contract is silence plus a sentence.
  const matches = matchTokens({ backgroundColor: "rgb(255, 0, 255)" }, INDEX);
  assert.deepEqual(matches, []);
  assert.match(describeMatches(matches), /Nothing there resolves/);
});

test("the tolerance is the boundary it claims to be", () => {
  // Measured against `accent`, whose nearest neighbour in the default palette is
  // 113 away — the elevation ramp is only ~15 apart, so a boundary test there
  // would be measuring which SURFACE is nearest rather than where the tolerance
  // sits.
  const accent = parseColor(VALUES.accent as string);
  assert.ok(accent);
  const shifted = (by: number) => `rgb(${accent[0]}, ${accent[1] - by}, ${accent[2]})`;
  assert.equal(
    matchTokens({ backgroundColor: shifted(COLOR_TOLERANCE - 2) }, INDEX)[0]?.dialId,
    "accent"
  );
  assert.deepEqual(matchTokens({ backgroundColor: shifted(COLOR_TOLERANCE + 6) }, INDEX), []);
});

test("faces and radii resolve too, and one click never names one dial twice", () => {
  const matches = matchTokens(
    {
      color: VALUES.ink as string,
      backgroundColor: VALUES.ink as string,
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      borderRadius: `${VALUES.radius as number}px`
    },
    INDEX
  );
  const dials = matches.map((m) => m.dialId);
  assert.ok(dials.includes("mono"), "the mono face is found by its first family");
  assert.ok(dials.includes("radius"), "the corner radius is found by its px value");
  assert.equal(new Set(dials).size, dials.length, "no dial is reported twice for one click");
});

test("a duration is not a length — the radius lookup ignores ms and em tokens", () => {
  // `--axf-motion: 140ms` and `--axf-tracking: .01em` sit in the same bag as the
  // sizes. A bare parseFloat made a transition duration a candidate for "what
  // gives this element its corners", which is a confidently wrong answer.
  const motion = INDEX.find((e) => e.cssVar === "--axf-motion");
  assert.ok(motion, "the motion token is in the index");
  assert.equal(motion.px, null, "140ms must not read as 140px");
  assert.deepEqual(
    matchTokens({ borderRadius: `${VALUES.motionMs as number}px` }, INDEX),
    [],
    "a radius equal to the motion duration resolves to nothing, not to motion"
  );
});

/* --------------------------------------------------------------- the gauges */

test("the dark gauge keeps rolled surfaces dark, and the light gauge does not", () => {
  const dark = gaugedRoll("aaaaaa", { ...DEFAULT_GAUGES, mode: "dark" });
  const light = gaugedRoll("aaaaaa", { ...DEFAULT_GAUGES, mode: "light" });
  assert.ok(hexToHsl(dark.values.page as string).l < 0.2, "dark gauge → dark page");
  assert.ok(hexToHsl(light.values.page as string).l > 0.8, "light gauge → light page");
});

test("the hue gauge places the accent where it was asked to", () => {
  for (const hue of [10, 140, 275]) {
    const rolled = gaugedRoll("bbbbbb", { ...DEFAULT_GAUGES, hue });
    const actual = hexToHsl(rolled.values.accent as string).h;
    // The generator clamps LIGHTNESS for legibility and never rotates hue, so
    // this is an equality within rounding rather than a range.
    assert.ok(Math.abs(actual - hue) < 2, `accent hue ${actual} should be ${hue}`);
  }
});

test("the contrast gauge LANDS on the ratio asked for, in both directions", () => {
  // The bug this pins: the first cut used `clampContrast`, a floor. A rolled
  // dark theme's ink already sits at 16.6:1, so every gauge position below 16
  // did nothing whatsoever — the slider moved and the app did not.
  const ratio = (roll: ReturnType<typeof gaugedRoll>) =>
    contrast(String(roll.values.ink), String(roll.values.page));

  for (const asked of [4.5, 7, 11, 16]) {
    const rolled = gaugedRoll("cccccc", { ...DEFAULT_GAUGES, contrast: asked });
    assert.ok(
      Math.abs(ratio(rolled) - asked) < 0.35,
      `asked ${asked}:1, got ${ratio(rolled).toFixed(2)}:1`
    );
  }

  // And the hierarchy the spec declares survives: dim is contracted at 3 where
  // ink is 4.5, so it lands proportionally lower rather than level with it.
  const rolled = gaugedRoll("cccccc", { ...DEFAULT_GAUGES, contrast: 12 });
  const dim = contrast(String(rolled.values.dim), String(rolled.values.page));
  assert.ok(dim < ratio(rolled), "dim must stay below ink, or there is no hierarchy");
  assert.ok(dim > 6, `dim should scale with the gauge, got ${dim.toFixed(2)}`);
});

test("no gauge position can push a colour under the contract its dial declares", () => {
  // The gauge designs a look; it does not get to make the app illegible.
  const rolled = gaugedRoll("cccccc", { ...DEFAULT_GAUGES, contrast: CONTRAST_RANGE.min });
  assert.ok(contrast(String(rolled.values.ink), String(rolled.values.page)) >= 4.49);
  for (const id of ["dim", "accent", "ok", "warn", "err", "info"]) {
    const ratio = contrast(String(rolled.values[id]), String(rolled.values.page));
    assert.ok(ratio >= 2.99, `${id} fell to ${ratio.toFixed(2)}:1, under its declared 3:1`);
  }
});

test("the radius gauge is a plain dial value, and lands in the overrides", () => {
  const rolled = gaugedRoll("dddddd", { ...DEFAULT_GAUGES, radius: 17 });
  assert.equal(rolled.values.radius, 17);
  assert.equal(rolled.overrides.radius, 17, "the surface's setValue list carries it");
  // The overrides are the DIFF and nothing else — a gauged roll is an ordinary
  // roll with visible, revertable edits, not a second kind of theme.
  for (const [id, value] of Object.entries(rolled.overrides)) {
    assert.notEqual(rolled.rolled[id], value, `${id} is in the diff but did not change`);
  }
});

test("the whole token set is rolled, not just the palette the gauges touch", () => {
  const rolled = gaugedRoll("eeeeee", DEFAULT_GAUGES);
  for (const id of Object.keys(defaultValues())) {
    assert.notEqual(rolled.values[id], undefined, `${id} was left out of the roll`);
  }
});

test("gauges read back off a theme match the gauges that produced it", () => {
  const asked = { mode: "light", hue: 200, contrast: 8, radius: 12 } as const;
  const rolled = gaugedRoll("ffffff", asked);
  const read = gaugesFrom(rolled.values);
  assert.equal(read.mode, "light");
  assert.ok(Math.abs(read.hue - asked.hue) < 2);
  assert.ok(Math.abs(read.contrast - asked.contrast) < 0.35, `read ${read.contrast}`);
  assert.equal(read.radius, 12);
});

test("gauges read off the shipped default are the shipped default's, not a fallback", () => {
  const read = gaugesFrom(defaultValues());
  assert.equal(read.mode, "dark");
  assert.equal(read.radius, defaultValues().radius);
});
