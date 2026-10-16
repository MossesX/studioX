/**
 * `npm run check:rolls` — 2000 rolls, every one audited.
 *
 * The requirement (axf-theme-designer.bmpx P3): *"Run a 2000-roll sweep — the
 * same scale GizmoX verified its engine at — auditing every roll and reporting
 * the distribution of warnings plus any roll that threw. This is the cheapest
 * possible proof that the roller is sound across the seed space rather than on
 * the three seeds a human happened to try."*
 *
 * ## Why this is not "roller-determinism.test.ts with a bigger loop"
 *
 * That test asserts the properties on five hand-picked seeds, which is the
 * right shape for a unit test: it names the property, it goes red fast, and it
 * runs on every `npm test`. What it cannot tell you is whether the property
 * holds in the corners — a clamp that gives out at a hue nobody typed, a
 * harmony that only fails in light mode, a seed whose accent lands on the
 * exact luminance where `clampContrast` runs out of headroom. Five seeds is
 * five samples of a space with 31^6 addresses in it.
 *
 * So this sweeps, and it reports rather than merely asserting: the point of a
 * sweep is the DISTRIBUTION. "0 warnings across 2000 rolls" and "0 warnings
 * across the 5 seeds in the test" are the same sentence with very different
 * evidence behind them, and only one of them tells you the clamp has headroom.
 *
 * ## The seeds are generated, not random
 *
 * `Math.random()` would make a red run unreproducible — the one property a
 * failure report most needs. Seeds come from `seedFrom(i)`, which is the
 * engine's own seed derivation, so run N is byte-identical to run N+1 and a
 * failing seed can simply be pasted into the roller.
 *
 * ## What it checks, per roll
 *
 *   1. **It rolls at all.** A throw is caught with its seed and options, never
 *      allowed to abort the sweep — one bad corner must not hide the other
 *      1999 results.
 *   2. **The audit.** `auditTheme()` is the engine's own verdict and the only
 *      one; warnings are tallied by KIND (`<dial> on <dial>`) rather than by
 *      message, because the ratio in the text differs on every roll and a
 *      per-message tally would be 2000 rows of noise.
 *   3. **It reproduces.** The same seed and options rolled twice must give the
 *      same values. Determinism across the whole seed space is the roller's
 *      entire sales pitch, and it is nearly free to check here.
 *   4. **It is actually varied.** Distinct value-sets are counted. A generator
 *      that collapsed to a handful of themes would pass every other check in
 *      this file — 2000 identical rolls are 2000 rolls that reproduce, audit
 *      clean and never throw.
 *
 * Exit 1 on a throw, a non-reproducing roll, a collapsed distribution or any
 * audit warning. A warning is a REAL failure here, not a statistic to admire:
 * the generator clamps rather than re-rolls, so a warning means a clamp gave
 * out, and `generate.ts` says so in `auditTheme`'s own docblock.
 */
import { DIALS, HARMONIES, auditTheme, rollTheme, seedFrom } from "@axf/core";

const TOTAL = Number(process.env.AXF_SWEEP ?? 2000);
const HARMONY_IDS = Object.keys(HARMONIES);

/* ----------------------------------------------------------- self-check --- */
/**
 * The instrument, before the measurement.
 *
 * "0 warnings across 2000 rolls" is indistinguishable from "the audit returns
 * an empty array no matter what" — and the second reads as a triumph. So a
 * theme that MUST warn is audited first, on every run: one contrast-audited
 * dial set to the very colour it is measured against, which is 1:1 and cannot
 * be legible under any threshold. If that comes back clean, the sweep below is
 * worthless and says so instead of printing a green number.
 */
{
  const victim = DIALS.find((d) => d.kind === "color" && d.contrastAgainst && d.minContrast);
  if (!victim) {
    console.error("roll-sweep SELF-CHECK FAILED — no dial declares a contrast requirement, so");
    console.error("  auditTheme has nothing to check and a clean sweep would mean nothing.");
    process.exit(1);
  }
  const sample = rollTheme("ab3k9m");
  const broken = {
    ...sample,
    values: { ...sample.values, [victim.id]: sample.values[victim.contrastAgainst] }
  };
  const caught = auditTheme(broken);
  if (!caught.some((w) => w.startsWith(`${victim.id} on ${victim.contrastAgainst}`))) {
    console.error(
      `roll-sweep SELF-CHECK FAILED — auditTheme stayed silent about ${victim.id} set to its own\n` +
        `  background (1:1). The audit cannot go red, so "0 warnings" below would be an artefact\n` +
        `  of a blind instrument rather than a property of the generator.\n` +
        `  got: ${JSON.stringify(caught)}`
    );
    process.exit(1);
  }
  console.log(
    `roll-sweep self-check — auditTheme reports ${victim.id} at 1:1 on ` +
      `${victim.contrastAgainst}; the instrument can go red.\n`
  );
}

/**
 * The option sets cycled through the sweep.
 *
 * `undefined` — a free roll, where the seed picks mode, harmony and hue — is
 * first and is the case the roller's own "roll" button produces. The forced
 * rows exist because mode is drawn 3:1 toward dark, so a free-only sweep would
 * spend ~500 of its 2000 rolls on light mode and none of them on a light roll
 * of a seed that also has a dark one. Forcing covers the axis the bias thins.
 */
const OPTION_SETS = [
  { label: "free", options: undefined },
  { label: "dark", options: { mode: "dark" } },
  { label: "light", options: { mode: "light" } },
  ...HARMONY_IDS.flatMap((harmony) => [
    { label: `dark/${harmony}`, options: { mode: "dark", harmony } },
    { label: `light/${harmony}`, options: { mode: "light", harmony } }
  ])
];

/* ----------------------------------------------------------------- sweep --- */

const started = Date.now();
const threw = [];
const warned = [];
const nonReproducing = [];
const warningKinds = new Map();
const warningsPerRoll = new Map();
const modes = new Map();
const harmonies = new Map();
const fingerprints = new Set();
const accents = new Set();

const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

for (let i = 0; i < TOTAL; i++) {
  const seed = seedFrom(i);
  const { label, options } = OPTION_SETS[i % OPTION_SETS.length];

  let rolled;
  try {
    rolled = rollTheme(seed, options);
  } catch (err) {
    threw.push({ seed, label, error: err instanceof Error ? err.stack ?? err.message : String(err) });
    continue;
  }

  // 3 — reproduces. Same seed, same options, same theme.
  try {
    const again = rollTheme(seed, options);
    if (JSON.stringify(again.values) !== JSON.stringify(rolled.values)) {
      nonReproducing.push({ seed, label });
    }
  } catch (err) {
    threw.push({
      seed,
      label: `${label} (re-roll)`,
      error: err instanceof Error ? err.stack ?? err.message : String(err)
    });
  }

  // 2 — the engine's audit, tallied by kind.
  let warnings;
  try {
    warnings = auditTheme(rolled);
  } catch (err) {
    threw.push({
      seed,
      label: `${label} (audit)`,
      error: err instanceof Error ? err.stack ?? err.message : String(err)
    });
    continue;
  }
  bump(warningsPerRoll, warnings.length);
  if (warnings.length) {
    warned.push({ seed, label, warnings });
    for (const w of warnings) bump(warningKinds, w.split(" is ")[0]);
  }

  // 4 — variety.
  bump(modes, rolled.mode);
  bump(harmonies, rolled.harmony);
  fingerprints.add(JSON.stringify(rolled.values));
  accents.add(String(rolled.values.accent));
}

const elapsed = Date.now() - started;

/* ---------------------------------------------------------------- report --- */

const rolled = TOTAL - threw.filter((t) => !/\(/.test(t.label)).length;
console.log(`roll-sweep — ${TOTAL} rolls in ${elapsed}ms (${(elapsed / TOTAL).toFixed(2)}ms each)\n`);

console.log(`  option sets cycled: ${OPTION_SETS.length} (${OPTION_SETS.map((o) => o.label).join(", ")})`);
console.log(`  distinct themes:    ${fingerprints.size} of ${rolled} rolled`);
console.log(`  distinct accents:   ${accents.size}`);
console.log(`  modes:              ${[...modes].map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`  harmonies:          ${[...harmonies].map(([k, v]) => `${k} ${v}`).join(", ")}`);

console.log("\n  audit warnings per roll:");
for (const n of [...warningsPerRoll.keys()].sort((a, b) => a - b)) {
  const count = warningsPerRoll.get(n);
  console.log(
    `    ${String(n).padStart(2)} warning(s): ${String(count).padStart(5)} roll(s)  ` +
      `${((count / rolled) * 100).toFixed(1)}%`
  );
}
if (warningKinds.size) {
  console.log("\n  by kind:");
  for (const [kind, count] of [...warningKinds].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${count.toString().padStart(5)}  ${kind}`);
  }
  console.log("\n  worst offenders (first 10):");
  for (const w of warned.slice(0, 10)) {
    console.log(`    seed ${w.seed} [${w.label}] — ${w.warnings.join("; ")}`);
  }
}

if (threw.length) {
  console.log(`\n  rolls that threw: ${threw.length}`);
  for (const t of threw.slice(0, 10)) console.log(`    seed ${t.seed} [${t.label}]\n      ${t.error}`);
}

/* ----------------------------------------------------------------- gate --- */

const failures = [];
if (threw.length) {
  failures.push(
    `${threw.length} roll(s) threw. A seed that cannot be rolled is a seed that was shared, ` +
      `saved in a roll history or pasted into a bug report and now produces nothing.`
  );
}
if (nonReproducing.length) {
  failures.push(
    `${nonReproducing.length} roll(s) did not reproduce (${nonReproducing
      .slice(0, 5)
      .map((n) => `${n.seed} [${n.label}]`)
      .join(", ")}). A seed that does not reproduce is a label on a random theme.`
  );
}
if (warned.length) {
  failures.push(
    `${warned.length} roll(s) failed the engine's own audit. The generator CLAMPS rather than ` +
      `re-rolling, so a warning is a clamp that gave out — see auditTheme's docblock — and the ` +
      `seeds above are the reproduction.`
  );
}
// A collapsed generator passes every check above. 2000 rolls over 11 option
// sets should be very nearly 2000 distinct themes; anything under half is a
// generator that has stopped consuming its seed.
if (fingerprints.size < rolled * 0.5) {
  failures.push(
    `only ${fingerprints.size} distinct themes across ${rolled} rolls — the generator has ` +
      `collapsed and is no longer reading its seed.`
  );
}

if (failures.length) {
  console.error(`\nroll-sweep FAILED — ${failures.length} finding(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `\nroll-sweep OK — ${rolled} rolls, ${fingerprints.size} distinct themes, ` +
    `0 throws, 0 audit warnings, every seed reproduced`
);
