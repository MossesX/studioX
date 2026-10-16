/**
 * @file `npm run check:dashboard` — the CI layer of the P3 dashboard-kind
 * gate.
 *
 * Executes the REAL chokepoint and registry — `core/src/dashboard/types.ts`
 * and `registry.ts` under Node's native type stripping (their only imports
 * are type-only, erased) — never a copy written for the checker.
 *
 * Self-tests run the MUTATIONS every time (the `check:coverage` precedent):
 *
 *   1. an id that is not lower-kebab must throw;
 *   2. an empty description must throw;
 *   3. a spec without a render function must throw;
 *   4. activating an UNREGISTERED id must NOT throw — it must resolve to the
 *      default with `substituted: true` and name what was requested;
 *   5. registering the missing wrapper afterwards must heal the substitution
 *      live, with the stored preference intact;
 *   6. a duplicate registration must throw.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const DASH = resolve(here, "../../core/src/dashboard");

registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.\w+$/.test(specifier)) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      for (const ext of [".ts", ".tsx"]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  }
});

const { defineDashboard, DashboardDefinitionError } = await import(
  pathToFileURL(resolve(DASH, "types.ts")).href
);
const { DashboardRegistry } = await import(pathToFileURL(resolve(DASH, "registry.ts")).href);

let failures = 0;
const ok = (msg) => console.log(`  ok  ${msg}`);
const bad = (msg) => {
  failures += 1;
  console.error(`  FAIL  ${msg}`);
};

/* ------------------------------------------------- chokepoint mutations */

function mustThrow(label, spec) {
  try {
    defineDashboard(spec);
    bad(`${label} — defineDashboard accepted it`);
  } catch (e) {
    e instanceof DashboardDefinitionError
      ? ok(`${label} — threw: ${e.message}`)
      : bad(`${label} — threw the wrong error: ${e}`);
  }
}

const render = () => null;
mustThrow("id not lower-kebab", { id: "Bad_Id", title: "t", description: "d", render });
mustThrow("empty description", { id: "mut-a", title: "t", description: "  ", render });
mustThrow("render is not a function", { id: "mut-b", title: "t", description: "d", render: "nope" });

/* --------------------------------------------- registry fallback + report */

const reg = new DashboardRegistry();
const plain = defineDashboard({ id: "dash-plain", title: "Plain", description: "d", render });
const framed = defineDashboard({ id: "dash-framed", title: "Framed", description: "d", render });
reg.register(plain).register(framed);

let r = reg.resolve();
r.dashboard?.id === "dash-plain" && !r.substituted
  ? ok("first registered is the default and resolves un-substituted")
  : bad(`default resolution wrong: ${JSON.stringify({ id: r.dashboard?.id, substituted: r.substituted })}`);

reg.activate("dash-framed");
r = reg.resolve();
r.dashboard?.id === "dash-framed" && !r.substituted
  ? ok("activating a registered id resolves it exactly")
  : bad(`exact activation wrong: ${JSON.stringify({ id: r.dashboard?.id, substituted: r.substituted })}`);

try {
  reg.activate("dash-does-not-exist");
  r = reg.resolve();
  r.dashboard?.id === "dash-plain" && r.substituted && r.requestedId === "dash-does-not-exist"
    ? ok("unknown id FALLS BACK to the default, substituted:true, requested id named")
    : bad(`fallback wrong: ${JSON.stringify(r, (k, v) => (k === "render" ? undefined : v))}`);
} catch (e) {
  bad(`activate(unknown) threw — the contract is fall back and report, never throw: ${e}`);
}

reg.register(defineDashboard({ id: "dash-does-not-exist", title: "Late", description: "d", render }));
r = reg.resolve();
r.dashboard?.id === "dash-does-not-exist" && !r.substituted
  ? ok("late registration heals the substitution with the stored preference intact")
  : bad(`healing wrong: ${JSON.stringify({ id: r.dashboard?.id, substituted: r.substituted })}`);

try {
  reg.register(plain);
  bad("duplicate registration was accepted");
} catch {
  ok("duplicate registration throws");
}

if (failures) {
  console.error(`\ncheck:dashboard — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:dashboard — all green (mutations watched red this run)");
