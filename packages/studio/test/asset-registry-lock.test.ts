/**
 * The registry's cross-process, cross-language write lock — the F3 gate
 * (INITIATION-PROMPT.md §4: "The registry serialises itself. One lock file,
 * one set of rules, wrapping the whole read-modify-write — shared by the Node
 * writer and the Python writer, with a cross-language test.").
 *
 * `registry.json` has two writers in two languages:
 * `scripts/lib/registry-store.mjs` (the `npm run pack` lifecycle) and
 * `build/tools/asset_registry.py` (Python build tooling). What is worth
 * locking down, in order of how expensively it fails:
 *
 *   1. **No lost updates** — concurrent writers each land. Child PROCESSES,
 *      not promises: the race is between OS processes, and an in-process test
 *      would pass against a lock that does nothing.
 *   2. **Cross-language exclusion, both directions** — a mixed fleet of Node
 *      and Python writers all survive, and a lock held by Python blocks this
 *      side outright. A language-local lock passes every same-language test
 *      and still loses entries in production; this is the property the whole
 *      arrangement exists for.
 *   3. **No wedging** — a lock left by a dead process is broken rather than
 *      waited on forever, and a throwing body still releases.
 *
 * GizmoX's precedent for the unlocked failure: twelve simultaneous writers,
 * ONE survivor. The mixed-fleet test here is the standing proof that cannot
 * regress silently.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  REGISTRY_FORMAT,
  withRegistryLock
} from "../scripts/lib/registry-store.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const TOOLS = path.resolve(STUDIO, "..", "..", "build", "tools");
const STORE_URL = pathToFileURL(path.join(STUDIO, "scripts", "lib", "registry-store.mjs")).href;

/**
 * The Python writer, resolved rather than assumed: `AXF_PYTHON`, else the
 * interpreter on PATH. The cross-language tests SKIP loudly when neither
 * answers — a skip is visible in the run summary, where a fake pass is not.
 */
function resolvePython(): string | null {
  const candidates = [process.env.AXF_PYTHON, "python"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}
const PYTHON = resolvePython();

/** A fresh assets root with an empty registry document. */
function tmpRoot(name: string): { root: string; registry: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `axf-registry-${name}-`));
  const registry = path.join(root, "registry.json");
  fs.writeFileSync(registry, `${JSON.stringify({ format: REGISTRY_FORMAT, assets: [] }, null, 2)}\n`);
  return { root, registry };
}

/**
 * One Node writer in its own process: spin to a shared instant so every
 * sibling collides, then append an entry under the lock. The store imports
 * nothing but node builtins, so the child needs no alias hook.
 */
const NODE_WRITER = `
import { loadRegistry, saveRegistry, withRegistryLock } from ${JSON.stringify(STORE_URL)};
const [id, startAt] = process.argv.slice(2);
const root = process.env.AXF_ASSETS_ROOT;
while (Date.now() < Number(startAt)) { /* spin to one instant */ }
withRegistryLock(() => {
  const doc = loadRegistry(root);
  doc.assets.push({ id, kind: "plugin", name: id, version: "0.1.0", enabled: true });
  saveRegistry(doc, root);
}, root);
`;

/** The same writer in Python, through build/tools/asset_registry.py. */
const PY_WRITER = `
import sys, time
sys.path.insert(0, ${JSON.stringify(TOOLS)})
from pathlib import Path
import asset_registry as ar

asset_id, start_at, registry = sys.argv[1], float(sys.argv[2]), Path(sys.argv[3])
while time.time() * 1000 < start_at:
    pass
with ar.registry_lock(registry):
    reg = ar.load_registry(registry)
    reg["assets"].append({"id": asset_id, "kind": "plugin", "name": asset_id, "version": "0.1.0", "enabled": True})
    ar.save_registry(reg, registry)
`;

test("concurrent Node writers do not lose entries", async () => {
  const { root, registry } = tmpRoot("node");
  const writer = path.join(root, "writer.mjs");
  fs.writeFileSync(writer, NODE_WRITER);

  // spawn, never spawnSync: spawnSync blocks the parent, so the "fleet" would
  // run one child at a time and the test would pass with no lock at all —
  // exactly what the mutation check caught on 2026-08-09.
  const N = 8;
  const startAt = Date.now() + 1500;
  const kids = Array.from({ length: N }, (_, i) =>
    spawn(process.execPath, [writer, `asset-${i}`, String(startAt)], {
      env: { ...process.env, AXF_ASSETS_ROOT: root },
      stdio: ["ignore", "ignore", "pipe"]
    })
  );
  await Promise.all(
    kids.map(
      (kid) =>
        new Promise<void>((resolve, reject) => {
          let stderr = "";
          kid.stderr?.on("data", (d) => (stderr += d));
          kid.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error(`a writer exited ${code}: ${stderr}`))
          );
        })
    )
  );

  const ids = (JSON.parse(fs.readFileSync(registry, "utf8")).assets as { id: string }[])
    .map((a) => a.id)
    .sort();
  assert.deepEqual(
    ids,
    Array.from({ length: N }, (_, i) => `asset-${i}`).sort(),
    "registrations were lost — the read-modify-write is not serialised"
  );
});

test(
  "a mixed fleet of Node and Python writers all land — the cross-language contract",
  { skip: PYTHON ? false : "no python interpreter (set AXF_PYTHON)" },
  () => {
    const { root, registry } = tmpRoot("mixed");
    const nodeWriter = path.join(root, "writer.mjs");
    const pyWriter = path.join(root, "writer.py");
    fs.writeFileSync(nodeWriter, NODE_WRITER);
    fs.writeFileSync(pyWriter, PY_WRITER);

    const N = 4; // per language
    const startAt = Date.now() + 2500; // python pays interpreter start-up
    const kids = [
      ...Array.from({ length: N }, (_, i) =>
        spawn(process.execPath, [nodeWriter, `node-${i}`, String(startAt)], {
          env: { ...process.env, AXF_ASSETS_ROOT: root },
          stdio: ["ignore", "ignore", "pipe"]
        })
      ),
      ...Array.from({ length: N }, (_, i) =>
        spawn(PYTHON as string, [pyWriter, `py-${i}`, String(startAt), registry], {
          stdio: ["ignore", "ignore", "pipe"]
        })
      )
    ];

    return Promise.all(
      kids.map(
        (kid) =>
          new Promise<void>((resolve, reject) => {
            let stderr = "";
            kid.stderr?.on("data", (d) => (stderr += d));
            kid.on("close", (code) =>
              code === 0 ? resolve() : reject(new Error(`a writer exited ${code}: ${stderr}`))
            );
          })
      )
    ).then(() => {
      const ids = (JSON.parse(fs.readFileSync(registry, "utf8")).assets as { id: string }[])
        .map((a) => a.id)
        .sort();
      assert.deepEqual(
        ids,
        [
          ...Array.from({ length: N }, (_, i) => `node-${i}`),
          ...Array.from({ length: N }, (_, i) => `py-${i}`)
        ].sort(),
        "a registration was lost across the language boundary — the two writers are not sharing one lock"
      );
    });
  }
);

test(
  "a lock held by the Python writer blocks this side",
  { skip: PYTHON ? false : "no python interpreter (set AXF_PYTHON)" },
  () => {
    const { root, registry } = tmpRoot("crosslang");
    const lock = `${registry}.lock`;

    const holder = path.join(root, "holder.py");
    fs.writeFileSync(
      holder,
      [
        "import sys, time",
        `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
        "from pathlib import Path",
        "import asset_registry as ar",
        `with ar.registry_lock(Path(${JSON.stringify(registry)})):`,
        "    time.sleep(30)",
        ""
      ].join("\n")
    );

    const proc = spawn(PYTHON as string, [holder], { stdio: "ignore" });
    try {
      const deadline = Date.now() + 15_000;
      while (!fs.existsSync(lock) && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
      assert.ok(fs.existsSync(lock), "python never took the lock");

      assert.throws(
        () => withRegistryLock(() => undefined, root),
        /locked by another process/,
        "the Node writer walked straight through a lock Python was holding"
      );
    } finally {
      proc.kill();
    }
  }
);

test("a lock left by a dead process is broken, not waited on forever", () => {
  const { root, registry } = tmpRoot("stale");
  const lock = `${registry}.lock`;
  fs.writeFileSync(lock, "999999 held-by-a-process-that-died\n");
  const stale = new Date(Date.now() - 2 * LOCK_STALE_MS);
  fs.utimesSync(lock, stale, stale);

  let ran = false;
  withRegistryLock(() => {
    ran = true;
  }, root);
  assert.ok(ran, "a stale lock wedged the writer");
  assert.ok(!fs.existsSync(lock), "the lock was not released");
});

test("the lock is released when the body throws", () => {
  const { root, registry } = tmpRoot("throws");
  assert.throws(
    () =>
      withRegistryLock(() => {
        throw new Error("boom");
      }, root),
    /boom/
  );
  assert.ok(!fs.existsSync(`${registry}.lock`), "a thrown body leaked the lock");
});

test("the two writers agree on the lock rules they share", () => {
  // The contract is only as strong as its weakest constant: a Python side
  // with a different lock name or a shorter staleness would break the Node
  // side's LIVE locks. Read the Python source and hold the constants equal.
  const py = fs.readFileSync(path.join(TOOLS, "asset_registry.py"), "utf8");
  assert.match(py, /LOCK_TIMEOUT_S = 10\.0/, "python lock timeout drifted from 10s");
  assert.match(py, /LOCK_STALE_S = 60\.0/, "python lock staleness drifted from 60s");
  assert.match(
    py,
    /reg_path\.with_suffix\(reg_path\.suffix \+ "\.lock"\)/,
    "python lock file name drifted from <registry>.lock"
  );
  assert.match(py, /"axf-asset-registry\/1"/, "python registry format tag drifted");
  assert.equal(LOCK_TIMEOUT_MS, 10_000);
  assert.equal(LOCK_STALE_MS, 60_000);
});
