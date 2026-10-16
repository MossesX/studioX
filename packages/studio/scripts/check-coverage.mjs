/**
 * @file CI-runnable coverage gate for the shipped packs (MASTER §9-P0 note:
 * "a gate that can run in CI is achievable, contrary to the planning state's
 * older note").
 *
 * Executes the REAL pack modules — `src/packs/axs-studio.ts` and friends —
 * under Node's native type stripping, with two small hooks: extension-less
 * relative specifiers get their `.ts`/`.tsx` appended, and `@axf/core` resolves
 * to a stub over `core/src/brand/{roles,requirements}.ts` (the only RUNTIME
 * imports the packs make from core; everything else is `import type` and is
 * erased). That keeps the check on the packs that actually ship rather than on
 * a second copy of the merge written for the checker.
 *
 * What it asserts:
 *   1. the merge module loads (its own throws cover 468 / overlay⊆contract /
 *      no entry without svg);
 *   2. `checkCoverage` reports the merged identity COMPLETE;
 *   3. no bare paint hex outside a `var()` fallback anywhere in the merge;
 *   4. self-test: stripping `lockup`'s svg flips the report to incomplete with
 *      `uncheckable: ["lockup"]` — the guard is watched red on every run, so
 *      it can never silently regress to the skip-in-silence behaviour it fixed.
 */
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CORE_STUB = pathToFileURL(resolve(here, "_axf-core-stub.ts")).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@axf/core") return { url: CORE_STUB, shortCircuit: true };
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.\w+$/.test(specifier)) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      for (const ext of [".ts", ".tsx"]) {
        if (existsSync(base + ext)) {
          return { url: pathToFileURL(base + ext).href, shortCircuit: true };
        }
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".json")) {
      return {
        format: "module",
        source: `export default ${readFileSync(fileURLToPath(url), "utf-8")};`,
        shortCircuit: true
      };
    }
    return next(url, context);
  }
});

const { checkCoverage } = await import(CORE_STUB);
// The style package that used to bundle these two died with the style-pack
// kind (2026-08-12). The IDENTITY the app ships is the branding pack plus the
// logo pack, merged exactly as `PackRegistry.#resolve` merges them — branding
// first, logos second — so that is what coverage is measured on.
const { AXS_STUDIO_BRAND, AXS_STUDIO_LOGOS } = await import(
  pathToFileURL(resolve(here, "../src/packs/axs-studio.ts")).href
);

const branding = AXS_STUDIO_BRAND.payload.entries;
const logos = AXS_STUDIO_LOGOS.payload.entries;
const merged = [...branding, ...logos];

const faults = [];

// 2 — the merged identity is complete against the template.
const report = checkCoverage(`${AXS_STUDIO_BRAND.id}+${AXS_STUDIO_LOGOS.id}`, merged);
if (!report.complete) {
  faults.push(
    `coverage incomplete: missing=[${report.missingRequired}] ` +
      `wrongAspect=[${report.wrongAspect.map((w) => w.id)}] uncheckable=[${report.uncheckable}]`
  );
}

// 3 — themeable is the requirement, not a side effect.
const BARE_PAINT = /(?:fill|stroke|stop-color)\s*[:=]\s*"?\s*(?:#[0-9a-fA-F]{3,8}\b|rgba?\()/;
for (const entry of merged) {
  if (BARE_PAINT.test(entry.svg ?? "")) faults.push(`${entry.id}: bare paint hex`);
}

// 4 — watch the uncheckable guard go red, every run.
const mutated = merged.map((e) => (e.id === "lockup" ? { ...e, svg: undefined } : e));
const red = checkCoverage(AXS_STUDIO_BRAND.id, mutated);
if (red.complete || !red.uncheckable.includes("lockup")) {
  faults.push(
    "MUTATION NOT CAUGHT: lockup with no svg should report uncheckable and incomplete — " +
      "the skip-in-silence hole is back"
  );
}

if (faults.length) {
  console.error(`check:coverage FAILED — ${faults.length} fault(s):`);
  for (const f of faults) console.error("  -", f);
  process.exit(1);
}
console.log(
  `check:coverage OK — ${AXS_STUDIO_BRAND.id}+${AXS_STUDIO_LOGOS.id}: ${merged.length} entries, ` +
    `complete against the template (${report.extra.length} extra, nothing renders them); no bare ` +
    "paints; uncheckable guard watched red on a stripped lockup"
);
