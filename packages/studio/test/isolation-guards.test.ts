/**
 * Isolation guards (INITIATION-PROMPT.md §5.1 tiers 2 + 4).
 *
 * Tier 2: the discovering import-graph gate — core imports nothing of
 * studio's (nothing at all beyond its declared dep set), and no SDK file
 * imports a core deep path. Tier 4: every one of those guards is watched go
 * RED in this same file, by planting a real violating file on disk through
 * the mutation harness, running the real guard against the real tree, and
 * restoring — "a guard nobody has watched fail is a guard nobody has tested."
 *
 * Green and red paths share ONE file deliberately: `node --test` runs test
 * FILES concurrently, and a mutation planted in the live tree by one process
 * while another process runs the green scan is a flake factory. In one file
 * they run sequentially and the plant/restore window encloses nothing else.
 *
 * Violating specifiers in here are built by concatenation (violatingImport /
 * the `spec` helper) so THIS file's own source never matches the scanner —
 * otherwise the studio green scan would flag the test that guards it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  appScanSpec,
  classifySpecifier,
  coreScanSpec,
  formatViolations,
  importViolations,
  scanSpecifiers,
  studioScanSpec
} from "../scripts/lib/import-graph.mjs";
import { violatingImport, withMutation } from "../scripts/lib/mutation.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const PACKAGES = path.resolve(STUDIO, "..");
const CORE = path.join(PACKAGES, "core");

/** Deep/relative leak specifiers, concatenated so they are not scannable
 *  as imports of this file. */
const spec = (...parts: string[]) => parts.join("/");

const scanCore = () => importViolations(coreScanSpec(CORE));
const scanStudio = () => importViolations(studioScanSpec(STUDIO, CORE));

function assertClean(result: { files: string[]; violations: object[] }, what: string) {
  assert.equal(
    result.violations.length,
    0,
    `${what} has boundary violations:\n${formatViolations(result.violations as never, PACKAGES)}`
  );
}

// ---------------------------------------------------------------------------
// The scanner itself — the primitive everything above stands on
// ---------------------------------------------------------------------------
test("scanSpecifiers reads every import form, and only real ones", () => {
  const src = [
    `import a from "pkg-a";`,
    `import { b } from "./rel";`,
    `import type { T } from "pkg-t";`,
    `export * from "pkg-re";`,
    `import "side-effect";`,
    `const c = await import("pkg-dyn");`,
    `const d = require("pkg-req");`,
    `const notAnImport = "from nothing";`,
    `const dynamicVar = await import(someVariable);`
  ].join("\n");
  const found = scanSpecifiers(src).map((s) => s.specifier);
  assert.deepEqual(
    [...found].sort(),
    ["./rel", "pkg-a", "pkg-dyn", "pkg-re", "pkg-req", "pkg-t", "side-effect"].sort()
  );
});

// ---------------------------------------------------------------------------
// Tier 2, green: the real tree is clean — and the walk really walked
// ---------------------------------------------------------------------------
test("core imports nothing of studio's — nothing beyond its declared deps", () => {
  const result = scanCore();
  // An empty walk is a green lie: core has dozens of source files, and a scan
  // that found almost none of them proves the tree moved, not that it is clean.
  assert.ok(result.files.length >= 20, `core scan walked only ${result.files.length} files`);
  assertClean(result, "packages/core");
});

test("no SDK file imports a core deep path — the barrel is the one way in", () => {
  const result = scanStudio();
  assert.ok(result.files.length >= 30, `studio scan walked only ${result.files.length} files`);
  assertClean(result, "packages/studio (src/, app/, test/)");
});

// ---------------------------------------------------------------------------
// The UI kit (@mui/*, @emotion/*): installed into studio 2026-08-09, and into
// CORE later the same day when the owner reversed the premise — everything
// built from here on is MUI, so the MUI theme is a framework contract and
// core's `src/theme/mui.ts` cannot exist without createTheme.
//
// The narrow "core is framework-only, no UI kit" rule went with that premise.
// What replaces it is not a hole: core may import @mui/material BECAUSE its
// package.json declares it as a peer, and the test below asserts the BECAUSE
// (declared → green, undeclared sibling → red) rather than just the absence of
// a complaint. `@mui/icons-material` keeps a NAMED denial, because that one is
// still banned for a live reason — the branding pack owns every icon.
//
// A SECOND narrow rule stood here — the replica dashboards
// (`src/dashboards/*-replica.tsx`) had to be token() primitives only, asserted
// green here and watched red by a planted `__mutation__-replica.tsx`. It was
// deleted at v0.3.0 P0 along with `gizmox-replica.tsx`, the only replica that
// ever existed. Both halves went: keeping the mutation test alone would have
// proven a scanner nothing calls, which is worse than no test because it reads
// like coverage.
// ---------------------------------------------------------------------------
// Tier 4: each guard watched RED, via the mutation harness, then restored
// ---------------------------------------------------------------------------
const CORE_MUTATION = path.join(CORE, "src", "__mutation__leak.ts");
const STUDIO_MUTATION = path.join(STUDIO, "src", "__mutation__leak.ts");

async function expectRed(
  file: string,
  leak: string,
  guard: () => { violations: { file: string; reason: string }[] },
  reasonFragment: string
) {
  const red = await withMutation(file, violatingImport(leak), guard);
  const hit = red.violations.find((v) => v.file === file);
  assert.ok(
    hit,
    `guard stayed GREEN with ${path.basename(file)} planted importing "${leak}" — ` +
      `an untested guard is no guard`
  );
  assert.ok(
    hit.reason.includes(reasonFragment),
    `violation named the wrong reason: "${hit.reason}" (wanted …${reasonFragment}…)`
  );
}

test("mutation: core importing the SDK goes red", async () => {
  await expectRed(CORE_MUTATION, "@axs/studio", scanCore, "not in the declared dep set");
  // By relative walk too — the leak that never names a package.
  await expectRed(
    CORE_MUTATION,
    spec("..", "..", "studio", "src", "StudioShell"),
    scanCore,
    "escapes the package"
  );
  // And any undeclared dep at all — the boundary is core's own package.json.
  await expectRed(CORE_MUTATION, "left-pad", scanCore, "not in the declared dep set");
  // Restored: the mutation is gone and the guard is green again.
  assert.ok(!fs.existsSync(CORE_MUTATION), "mutation harness failed to clean up");
  assertClean(scanCore(), "packages/core after mutation cleanup");
});

test("mutation: studio importing a core deep path goes red", async () => {
  await expectRed(
    STUDIO_MUTATION,
    spec("@axf", "core", "src", "registry"),
    scanStudio,
    "the public barrel is the only way in"
  );
  // The same leak as a relative walk into packages/core.
  await expectRed(
    STUDIO_MUTATION,
    spec("..", "..", "core", "src", "kernel"),
    scanStudio,
    "resolves into core/"
  );
  assert.ok(!fs.existsSync(STUDIO_MUTATION), "mutation harness failed to clean up");
  assertClean(scanStudio(), "packages/studio after mutation cleanup");
});

test("mutation: core importing the Material ICON set goes red, and BY NAME", async () => {
  // Named, not merely undeclared. Core does not declare @mui/icons-material,
  // so the dep-set rule would already flag it — which is exactly why the
  // reason is asserted: if the named rule were deleted this would still go
  // red, and a laxer assertion would call that a pass. The icon set is banned
  // permanently because every AmberX icon resolves through the branding pack's
  // role variables, and a Material icon paints a hex no theme can reach.
  await expectRed(
    CORE_MUTATION,
    "@mui/icons-material",
    scanCore,
    "resolves through the branding pack"
  );
  await expectRed(
    CORE_MUTATION,
    "@mui/icons-material/Menu",
    scanCore,
    "resolves through the branding pack"
  );
  assert.ok(!fs.existsSync(CORE_MUTATION), "mutation harness failed to clean up");
  assertClean(scanCore(), "packages/core after mutation cleanup");
});

test("core may import MUI — but only because it DECLARES it", async () => {
  // The reversal, pinned to its cause. Three claims, and the middle one is the
  // whole test: a blanket "@mui/ is fine" would satisfy the first, and only
  // the second and third can tell it apart from the declared-dep-set lookup
  // that is actually in force.
  const coreCtx = coreScanSpec(CORE).ctx;
  const inCore = path.join(CORE, "src");

  // 1 — the declared packages pass.
  for (const declared of ["@mui/material", "@mui/material/styles", "@emotion/react", "@emotion/styled"]) {
    assert.equal(
      classifySpecifier(declared, inCore, coreCtx),
      null,
      `core is refusing "${declared}", which it declares as a peer dependency. ` +
        `src/theme/mui.ts needs createTheme; restore the declaration rather than the ban.`
    );
  }

  // 2 — an UNDECLARED sibling in the same scope is still refused. This is what
  //     proves the permission comes from the allowlist and not from the
  //     prefix, and it is the assertion that would catch a well-meaning
  //     "let MUI through" patch.
  for (const undeclared of ["@mui/lab", "@mui/x-data-grid", "@emotion/css"]) {
    const reason = classifySpecifier(undeclared, inCore, coreCtx);
    assert.ok(
      reason?.includes("not in the declared dep set"),
      `core accepted undeclared "${undeclared}" (reason: ${reason ?? "allowed"}) — ` +
        `the MUI permission has been widened from a declaration into a family pass`
    );
  }

  // 3 — and it is genuinely READ from disk, not hardcoded here: the allowlist
  //     is core's own peerDependencies, so a scan built from a package.json
  //     without MUI refuses it. Proven by scanning with a doctored spec rather
  //     than by trusting the comment above.
  const pkg = JSON.parse(fs.readFileSync(path.join(CORE, "package.json"), "utf8"));
  assert.ok(
    "@mui/material" in (pkg.peerDependencies ?? {}),
    "core/package.json no longer declares @mui/material as a peer — the theme bridge's " +
      "import is now undeclared, and MUI must stay a PEER (two @emotion copies means two " +
      "style caches and half the app renders unthemed with no error anywhere)"
  );
  const withoutMui = {
    ...coreCtx,
    allowPackages: new Set(
      Object.keys(pkg.peerDependencies).filter((n) => !n.startsWith("@mui/"))
    )
  };
  assert.ok(
    classifySpecifier("@mui/material", inCore, withoutMui)?.includes("not in the declared dep set"),
    "the allowlist is not actually being read from package.json — remove the declaration " +
      "and MUI still passes, which means the gate is decoration"
  );

  // The real scan is still clean with the real tree (core DOES import MUI now).
  assertClean(scanCore(), "packages/core with the MUI theme bridge in it");
});

// ---------------------------------------------------------------------------
// The bare-core fixture's static guard, green then red — generated into a
// TEMP directory so this never races test/bare-core.test.ts over the real
// fixture at pre-build/bare-core.
// ---------------------------------------------------------------------------
test("mutation: an SDK import inside a generated bare app goes red", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axf-bare-guard-"));
  try {
    const gen = spawnSync(process.execPath, ["scripts/bare-core.mjs", "--out", tmp], {
      cwd: STUDIO,
      encoding: "utf8"
    });
    assert.equal(gen.status, 0, `bare-core generation failed:\n${gen.stdout}\n${gen.stderr}`);

    const scanApp = () => importViolations(appScanSpec(tmp));
    const clean = scanApp();
    assert.ok(clean.files.length >= 5, `bare app scan walked only ${clean.files.length} files`);
    assertClean(clean, "the generated bare-core app");

    await expectRed(
      path.join(tmp, "src", "__mutation__leak.ts"),
      "@axs/studio",
      scanApp,
      "not in the declared dep set"
    );
    await expectRed(
      path.join(tmp, "src", "__mutation__leak.ts"),
      spec("@axf", "core", "src", "registry"),
      scanApp,
      "the public barrel is the only way in"
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The harness's own contract: it must refuse to overwrite, and must restore
// even when the guard throws.
// ---------------------------------------------------------------------------
test("the mutation harness cannot destroy a real file, and always restores", async () => {
  const real = path.join(CORE, "src", "index.ts");
  await assert.rejects(
    () => withMutation(real, "clobbered", () => ({ violations: [] })),
    /refuses to overwrite/,
    "the harness overwrote a real source file"
  );
  assert.match(fs.readFileSync(real, "utf8"), /AXF_CORE_VERSION/, "index.ts was damaged");

  await assert.rejects(
    () =>
      withMutation(CORE_MUTATION, violatingImport("@axs/studio"), () => {
        throw new Error("guard exploded");
      }),
    /guard exploded/
  );
  assert.ok(!fs.existsSync(CORE_MUTATION), "a throwing guard left the mutation behind");
});
