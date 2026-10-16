/**
 * `npm run suite` — resolve the suite manifest (INITIATION §4.4) into the
 * closure of assets that constitute Studio, and write it to
 * `suite.resolved.generated.json` (committed, deterministic — no timestamps).
 *
 * `npm run check:suite` (`--check`) re-resolves and fails when the committed
 * artifact is stale — the generated-artifact rule from §4.4: the build never
 * has to RUN a generator, it only verifies the committed artifact is current.
 *
 * The resolution itself lives in scripts/lib/closure.mjs, shared with the
 * peel: one resolver, two directions — this is the inward one. The module cap
 * (§4.6) is enforced during resolution, against the manifest, never against a
 * live registry: a resolution over the cap fails and writes nothing.
 *
 * Zero dependencies, Node ≥ 23 (native type stripping — the manifest is a
 * data-only .ts file, imported directly).
 */
import fs from "node:fs";
import path from "node:path";

import { resolveSuite } from "./lib/closure.mjs";
import { SUITE, SUITE_MODULE_CAP } from "../src/suite.manifest.ts";

const STUDIO = path.resolve(import.meta.dirname, "..");
const CORE = path.resolve(STUDIO, "..", "core");
const OUT = path.join(STUDIO, "suite.resolved.generated.json");
const check = process.argv.includes("--check");

const { resolved, problems } = await resolveSuite({
  studioDir: STUDIO,
  coreDir: CORE,
  manifest: SUITE,
  moduleCap: SUITE_MODULE_CAP
});

if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nsuite: the manifest does not resolve — nothing written");
  process.exit(1);
}

const body = JSON.stringify(resolved, null, 2) + "\n";
const modules = resolved.entries.filter((e) => e.kind === "module");
const plugins = resolved.entries.filter((e) => e.kind === "plugin");

if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
  if (current !== body) {
    console.error("suite: suite.resolved.generated.json is stale — run `npm run suite`");
    process.exit(1);
  }
  console.log(
    `suite: ok — ${modules.length}/${resolved.moduleCap} module slot(s) used, artifact current`
  );
} else {
  fs.writeFileSync(OUT, body);
  console.log(`suite: resolved "${resolved.suite}" → ${path.relative(process.cwd(), OUT) || OUT}`);
  console.log(
    `  modules     ${modules.length}/${resolved.moduleCap} slot(s): ${modules.map((m) => m.id).join(", ")}`
  );
  console.log(
    `  carries     ${plugins.length} plugin(s): ${plugins.map((p) => p.id).join(", ") || "(none)"}`
  );
  console.log(`  framework   @axf/core ${resolved.framework.version} · ${resolved.studio.package} ${resolved.studio.version}`);
}
