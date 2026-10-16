/**
 * The two properties the roller is a surface over, locked where they live.
 *
 * The roller's whole value is that a seed is a theme: six characters that
 * reproduce a design system anywhere, forever. That claim is checked on screen
 * (the "deterministic" chip re-rolls and compares), but a chip only fires when
 * someone is looking at it — so the same property is asserted here, headlessly,
 * where CI can see it go red.
 *
 * The second property is subtler and is the one a UI erodes by accident:
 * **the audit belongs to the engine.** `auditTheme()` decides what a bad
 * contrast is, using each colour dial's own `contrastAgainst`/`minContrast` and
 * its own epsilon. A designer that re-derived that verdict would eventually
 * disagree with the authority it reports on. There is no way to assert "the UI
 * did not write its own checker" from data alone, so what is asserted is the
 * consequence: the engine's verdict is a real, decidable function that a surface
 * can simply display — including on a deliberately broken theme, where it must
 * NOT return clean.
 *
 * Component-level assertions are out of scope for this harness on purpose: the
 * loader has no JSX transform, so anything reaching a `.tsx` dies on the
 * extension (see `scripts/_axf-core-test-barrel.ts`). These are the engine
 * properties the surface rests on, which is the half that can be locked here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DIALS, HARMONIES, auditTheme, rollTheme, seedFrom } from "@axf/core";
import type { ColorDial, Harmony, Mode, RollOptions } from "@axf/core";

const SEEDS = ["ab3k9m", "zzzzzz", "q7r2ts", "gizmox", "amberx"];
const MODES: Mode[] = ["dark", "light"];

test("the same seed produces the same theme — the property the roller sells", () => {
  for (const seed of SEEDS) {
    const a = rollTheme(seed);
    const b = rollTheme(seed);
    assert.deepEqual(
      b.values,
      a.values,
      `seed "${seed}" produced two different themes. A seed that does not reproduce is not a\n` +
        `  seed, it is a label on a random theme — and every shared seed, every history entry\n` +
        `  and every bug report that names one becomes wrong at the same moment.`
    );
    assert.equal(b.mode, a.mode);
    assert.equal(b.harmony, a.harmony);
    assert.equal(b.name, a.name);
  }
});

test("forced options reproduce too — the roller applies with the options it previewed", () => {
  // The roller carries each roll's RollOptions with it and applies them
  // alongside the seed, because ThemeStore keeps ONE options object: a seed
  // rolled under {mode:'light'} applied while the store holds {mode:'dark'}
  // would hand back a theme other than the previewed one.
  //
  // NOT a determinism guard, and the mutation run proved it: with the hue draw
  // replaced by `Math.random()`, the test above went red and this one stayed
  // GREEN — because forcing all three options overrides every non-deterministic
  // draw. It covers option PLUMBING only. The determinism claim is the first
  // test's alone, which is why that one forces nothing.
  const harmonies = Object.keys(HARMONIES) as Harmony[];
  for (const seed of SEEDS) {
    for (const mode of MODES) {
      for (const harmony of harmonies) {
        const options: RollOptions = { mode, harmony, hue: 210 };
        const a = rollTheme(seed, options);
        const b = rollTheme(seed, options);
        assert.deepEqual(b.values, a.values, `seed "${seed}" + ${mode}/${harmony} did not reproduce`);
        assert.equal(a.mode, mode);
        assert.equal(a.harmony, harmony);
      }
    }
  }
});

test("forcing an option changes only that option — the draw is never skipped", () => {
  // `rollTheme` draws mode, harmony and hue from the stream ALWAYS and only then
  // lets an option override the VALUE. The roller's mode/harmony/hue controls
  // are only usable because of that: with short-circuiting, forcing a mode would
  // shift every later draw and "the same theme in light" would be a different
  // theme entirely.
  const seed = "ab3k9m";
  const free = rollTheme(seed);
  const forced = rollTheme(seed, { mode: free.mode });
  assert.deepEqual(
    forced.values,
    free.values,
    "forcing the mode the seed had already chosen produced a different theme — the generator is\n" +
      "  consuming its rng stream conditionally again, and every roller control is unreliable."
  );
});

test("seedFrom takes a string or a number, and the two agree", () => {
  // The seed field hands a numeric entry over as a number, which is the
  // advertised signature; seedFrom stringifies internally, so the roller does
  // not have to care which one it had.
  assert.equal(seedFrom(42), seedFrom("42"));
  assert.equal(seedFrom(0), seedFrom("0"));
  assert.notEqual(seedFrom("2026 launch"), seedFrom("2026 Launch"));
  // Whatever it returns is itself a usable seed — that is what makes "derive"
  // and "use as seed" two paths to the same place rather than two systems.
  const derived = seedFrom("2026 launch");
  assert.deepEqual(rollTheme(derived).values, rollTheme(seedFrom("2026 launch")).values);
});

test("auditTheme is the only verdict, and it is a real one", () => {
  // Clean on what the generator produces: it CLAMPS rather than re-rolls, so a
  // warning on a fresh roll means a clamp regressed. That is exactly why the
  // roller shows the warnings instead of hiding them behind a pass badge.
  for (const seed of SEEDS) {
    for (const mode of MODES) {
      const rolled = rollTheme(seed, { mode });
      assert.deepEqual(
        auditTheme(rolled),
        [],
        `roll "${seed}" (${mode}) failed its own audit — a contrast clamp has regressed`
      );
    }
  }

  // …and NOT clean when a theme genuinely fails, which is what makes displaying
  // it worth anything. A checker that cannot go red is a decoration.
  const audited = DIALS.filter(
    (d): d is ColorDial => d.kind === "color" && !!d.contrastAgainst && !!d.minContrast
  );
  assert.ok(audited.length > 0, "no dial declares a contrast requirement — nothing to audit");

  const victim = audited[0];
  const rolled = rollTheme("ab3k9m");
  const broken = {
    ...rolled,
    values: { ...rolled.values, [victim.id]: rolled.values[victim.contrastAgainst!] }
  };
  const warnings = auditTheme(broken);
  assert.ok(
    warnings.some((w) => w.startsWith(`${victim.id} on ${victim.contrastAgainst}`)),
    `auditTheme stayed silent about ${victim.id} set to its own background (1:1 contrast).\n` +
      `  got: ${JSON.stringify(warnings)}`
  );
});

test("HARMONIES is data, so a harmony picker cannot go stale", () => {
  // The roller builds its harmony menu from this object. The alternative was a
  // hand-kept list of four names in the UI, which goes stale silently the day a
  // fifth rule is added to generate.ts.
  const ids = Object.keys(HARMONIES) as Harmony[];
  assert.ok(ids.length >= 4, "HARMONIES lost entries");
  for (const id of ids) {
    const rotations = HARMONIES[id];
    assert.equal(rotations.length, 2, `${id} must place two companions`);
    // Every declared harmony must actually be rollable — a menu entry that
    // throws is worse than a missing one.
    const rolled = rollTheme("ab3k9m", { harmony: id });
    assert.equal(rolled.harmony, id);
    assert.deepEqual(auditTheme(rolled), [], `harmony ${id} rolled an illegible theme`);
  }
});
