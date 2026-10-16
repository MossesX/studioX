/**
 * The suite gate (INITIATION-PROMPT.md §4.4, §4.6): the suite manifest is the
 * statement of what constitutes Studio, and the module cap of 12 is a TEST
 * against that statement — "a scope rule that is only prose is the exact
 * failure mode §5 exists to eliminate."
 *
 * Two properties this file is careful about:
 *
 *   - **The cap is measured against the MANIFEST'S resolution, never against
 *     a live registry.** Nothing here boots the kernel or counts
 *     `registry.report()` — what the SDK builds (a user's modules, a peeled
 *     app) can neither trip the cap nor mask it.
 *   - **The red path runs through the REAL resolver.** A guard nobody has
 *     watched fail is a guard nobody has tested, so the over-cap case is
 *     exercised on every run with a synthetic thirteen-module manifest — not
 *     by trusting that a comparison somewhere would probably fire.
 *
 * Discovery does the rest: `resolveSuite` reads `src/modules/*` off disk and
 * fails on drift in either direction, so a module added to the tree without a
 * manifest line (or claimed without existing) is caught here, with no edit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  listModuleDirs,
  moduleCapProblems,
  resolveSuite,
  SUITE_FORMAT
} from "../scripts/lib/closure.mjs";
import { SUITE, SUITE_MODULE_CAP } from "../src/suite.manifest.ts";

const STUDIO = path.resolve(import.meta.dirname, "..");
const CORE = path.resolve(STUDIO, "..", "core");
const RESOLVED_PATH = path.join(STUDIO, "suite.resolved.generated.json");

const resolveReal = () =>
  resolveSuite({ studioDir: STUDIO, coreDir: CORE, manifest: SUITE, moduleCap: SUITE_MODULE_CAP });

test("the suite manifest resolves clean, and within the module cap", async () => {
  const { resolved, problems } = await resolveReal();
  assert.deepEqual(problems, [], "the suite manifest must resolve with zero problems");

  assert.equal(resolved.format, SUITE_FORMAT);
  const modules = resolved.entries.filter((e: { kind: string }) => e.kind === "module");
  assert.ok(
    modules.length <= SUITE_MODULE_CAP,
    `the suite resolves ${modules.length} module-kind entries — the cap is ${SUITE_MODULE_CAP}`
  );

  // The count is asserted against the DISK, not against a floor.
  //
  // This used to be `modules.length >= 1` plus "the inward closure carries
  // demo-badge through demo's declared points". v0.3.0 P0 stripped Studio to
  // the frame: all four modules and the demo-badge reference plugin were
  // archived and deleted, so both assertions now describe a tree that does not
  // exist. Relaxing the floor to zero and deleting the closure assertion would
  // leave this test unable to tell "correctly empty" from "resolver returned
  // nothing" — which is the failure mode the whole file is written against.
  //
  // So it is pinned to what is actually on disk instead. Empty stays green
  // while the tree is empty, and the day a module lands it must appear here or
  // this goes red — the same discovering property, with no floor to forget to
  // raise.
  assert.equal(
    modules.length,
    listModuleDirs(STUDIO).length,
    "the resolved module entries must match src/modules/ exactly"
  );
  assert.equal(
    modules.length,
    SUITE.modules.length,
    "the resolved module entries must match the manifest exactly"
  );

  // The manifest may not list a module the shipped subsystem never composes —
  // that would make the manifest a wish list rather than a statement.
  const subsystem = fs.readFileSync(path.join(STUDIO, "src", "studio.subsystem.ts"), "utf8");
  for (const id of SUITE.modules) {
    assert.ok(
      subsystem.includes(`./modules/${id}/${id}.module`),
      `suite manifest lists "${id}" but studio.subsystem.ts never imports its module`
    );
  }
});

test("the committed resolved artifact is current (generated-artifact rule, §4.4)", async () => {
  assert.ok(
    fs.existsSync(RESOLVED_PATH),
    "suite.resolved.generated.json missing — run `npm run suite`"
  );
  const { resolved, problems } = await resolveReal();
  assert.deepEqual(problems, []);
  assert.equal(
    fs.readFileSync(RESOLVED_PATH, "utf8"),
    JSON.stringify(resolved, null, 2) + "\n",
    "suite.resolved.generated.json is stale — run `npm run suite`"
  );
});

test("the cap goes red at thirteen — through the real resolver", async () => {
  const thirteen = Array.from({ length: SUITE_MODULE_CAP + 1 }, (_, i) => `synthetic-${i + 1}`);
  const { problems } = await resolveSuite({
    studioDir: STUDIO,
    coreDir: CORE,
    manifest: { ...SUITE, modules: thirteen },
    moduleCap: SUITE_MODULE_CAP
  });
  assert.ok(
    problems.some((p: string) => p.includes(`the cap is ${SUITE_MODULE_CAP}`)),
    `an over-cap manifest must fail resolution; problems were:\n${problems.join("\n")}`
  );
  // Manifest → disk: thirteen modules nothing on disk backs.
  assert.ok(
    problems.some((p: string) => p.includes("does not exist")),
    "a manifest claiming a nonexistent module must fail resolution"
  );
});

test("disk → manifest drift goes red — a module on disk the manifest never claims", async () => {
  // The OTHER direction, and after v0.3.0 P0 it needs its own fixture: this
  // assertion used to ride along on the over-cap run, because there were always
  // real modules in src/modules/ for a synthetic manifest to fail to mention.
  // The strip left that directory empty, so the same run can no longer prove
  // it — an empty disk cannot drift from anything.
  //
  // Rather than drop the half of the gate that catches a module someone adds
  // WITHOUT declaring it (the more likely mistake of the two, and the one the
  // manifest exists to prevent), it gets a temp studio tree with a module
  // directory the manifest does not list. The drift check runs before any decl
  // is loaded, so a bare directory is a sufficient fixture.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axs-suite-drift-"));
  try {
    fs.mkdirSync(path.join(tmp, "src", "modules", "ghost"), { recursive: true });
    fs.copyFileSync(path.join(STUDIO, "package.json"), path.join(tmp, "package.json"));

    const { problems } = await resolveSuite({
      studioDir: tmp,
      coreDir: CORE,
      manifest: { ...SUITE, modules: [] },
      moduleCap: SUITE_MODULE_CAP
    });
    assert.ok(
      problems.some((p: string) =>
        p.includes("src/modules/ghost exists on disk but is not in the suite manifest")
      ),
      `an unlisted on-disk module must fail resolution; problems were:\n${problems.join("\n")}`
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("moduleCapProblems — the chokepoint itself, both sides of the line", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
  assert.deepEqual(moduleCapProblems(ids(SUITE_MODULE_CAP), SUITE_MODULE_CAP), []);
  assert.equal(moduleCapProblems(ids(SUITE_MODULE_CAP + 1), SUITE_MODULE_CAP).length, 1);
  // Duplicates are not a way under the cap, and a nonsense cap is refused.
  assert.deepEqual(moduleCapProblems(["a", "a", "b"], 2), []);
  assert.equal(moduleCapProblems(["a"], 0).length, 1);
});
