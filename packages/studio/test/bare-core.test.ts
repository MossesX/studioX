/**
 * The bare-core boot fixture (INITIATION-PROMPT.md §5.1 tier 3, fixture 1):
 * "an app with zero SDK assets installed boots, renders the shell and serves
 * its health route, in CI, with Studio's data directory deleted."
 *
 * This is the behavioural guard for the leaks static analysis cannot see —
 * core hardcoding a string-keyed SDK id, listening for an SDK-named event,
 * growing an SDK-shaped store field. An app made of nothing but core either
 * survives all of this test or one of those leaks exists.
 *
 * Deliberately HEAVY, exactly like the peel gate: real generation, real
 * `npm install` (skipped when the fixture's node_modules already carries
 * next), the real `tsc --noEmit`, a real `next dev` boot on :3261. The
 * "data directory deleted" clause is made literal: AXF_ASSETS_ROOT is
 * pointed at a directory that verifiably does not exist, and the health
 * route must report `ok` alongside `dataDir.exists === false`.
 *
 * Steps run in order inside one test; each depends on the one before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STUDIO = path.resolve(import.meta.dirname, "..");
const CORE = path.resolve(STUDIO, "..", "core");
const OUT = path.resolve(STUDIO, "..", "..", "bare-core");
const PORT = 3261;
const BASE = `http://localhost:${PORT}`;

function runGenerator(): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["scripts/bare-core.mjs"], {
    cwd: STUDIO,
    encoding: "utf8"
  });
}

function sh(command: string, args: string[], cwd: string) {
  // shell:true so npm resolves to npm.cmd on Windows.
  return spawnSync(command, args, { cwd, shell: true, encoding: "utf8" });
}

async function tryFetch(url: string): Promise<Response | null> {
  try {
    return await fetch(url);
  } catch {
    return null;
  }
}

test("bare-core boots, renders the shell, health green — with the data directory deleted", async () => {
  // ---- 1. generate the fixture -------------------------------------------
  const first = runGenerator();
  assert.equal(first.status, 0, `bare-core generation failed:\n${first.stdout}\n${first.stderr}`);

  // ---- 2. the artifact, on disk, not in a transcript ----------------------
  const manifestPath = path.join(OUT, "bare-core.manifest.json");
  assert.ok(fs.existsSync(manifestPath), "bare-core.manifest.json missing");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // `version.ts` since 0.0.19, `index.ts` before it (which still re-exports
  // the name) — both are read, so this holds against an older vendored core
  // as well as the live one. Same two-file lookup `closure.mjs` does.
  const liveVersion = ["index.ts", "version.ts"]
    .map((file) => path.join(CORE, "src", file))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8").match(/AXF_CORE_VERSION\s*=\s*"([^"]+)"/)?.[1])
    .find(Boolean);
  assert.ok(liveVersion, "AXF_CORE_VERSION not found in core");
  assert.equal(manifest.framework.version, liveVersion);
  assert.deepEqual(manifest.sdkAssets, [], "the bare fixture must declare zero SDK assets");

  for (const rel of [
    "vendor/axf-core/src/index.ts",
    "vendor/axf-core/package.json",
    "src/boot.ts",
    "app/page.tsx",
    "app/api/health/route.ts"
  ]) {
    assert.ok(fs.existsSync(path.join(OUT, rel)), `bare app missing ${rel}`);
  }
  // Zero SDK assets means zero: nothing under src/ but the generated boot pair.
  assert.ok(!fs.existsSync(path.join(OUT, "src", "modules")), "a module leaked into the bare app");
  assert.ok(!fs.existsSync(path.join(OUT, "src", "plugins")), "a plugin leaked into the bare app");

  // ---- 3. re-runnable: wipe-and-regenerate, but never the install ---------
  fs.writeFileSync(path.join(OUT, "src", "__STALE__.txt"), "planted by bare-core.test.ts");
  fs.mkdirSync(path.join(OUT, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "node_modules", ".bare-keep"), "planted by bare-core.test.ts");
  const second = runGenerator();
  assert.equal(second.status, 0, `regeneration failed:\n${second.stdout}\n${second.stderr}`);
  assert.ok(
    !fs.existsSync(path.join(OUT, "src", "__STALE__.txt")),
    "regeneration must wipe stale files"
  );
  assert.ok(
    fs.existsSync(path.join(OUT, "node_modules", ".bare-keep")),
    "regeneration must preserve node_modules"
  );

  // ---- 4. buildable: install (once) + the real typecheck ------------------
  if (!fs.existsSync(path.join(OUT, "node_modules", "next"))) {
    const install = sh("npm", ["install", "--no-audit", "--no-fund"], OUT);
    assert.equal(install.status, 0, `npm install failed:\n${install.stdout}\n${install.stderr}`);
  }
  const typecheck = sh("npm", ["run", "typecheck"], OUT);
  assert.equal(typecheck.status, 0, `bare app typecheck failed:\n${typecheck.stdout}\n${typecheck.stderr}`);

  // ---- 5. Studio's data directory, DELETED --------------------------------
  // A real path that verifiably does not exist: created, then removed, and
  // handed to the app as AXF_ASSETS_ROOT. If any core path reads it at boot,
  // the boot (or health) goes red and names the leak.
  const deletedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "axf-deleted-data-"));
  fs.rmSync(deletedDataDir, { recursive: true, force: true });
  assert.ok(!fs.existsSync(deletedDataDir), "the deleted data directory must not exist");

  // ---- 6. boots, and the health route tells the truth ---------------------
  assert.equal(
    await tryFetch(`${BASE}/api/health`),
    null,
    `port ${PORT} already answers — stop the stray bare-core dev server before running the gate`
  );

  const nextBin = path.join(OUT, "node_modules", "next", "dist", "bin", "next");
  const server = spawn(process.execPath, [nextBin, "dev", "--port", String(PORT)], {
    cwd: OUT,
    env: { ...process.env, AXF_ASSETS_ROOT: deletedDataDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));

  try {
    let health: Response | null = null;
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      health = await tryFetch(`${BASE}/api/health`);
      if (health) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    assert.ok(health, `bare app never answered on :${PORT}\n${serverLog}`);
    if (health.status !== 200) {
      // Read the body only on the failing path — a template literal in an
      // assert message would consume it eagerly and break the json() below.
      assert.fail(`health route not ok (${health.status}): ${await health.text()}`);
    }
    const body = (await health.json()) as {
      ok: boolean;
      framework: { running: string; vendored: string; match: boolean };
      modules: string[];
      registry: { violations: unknown[] };
      subsystems: { id: string; layer: string; state: string }[];
      dataDir: { env: string | null; exists: boolean };
    };
    assert.equal(body.ok, true, `health reports not-ok: ${JSON.stringify(body)}`);
    assert.equal(body.framework.match, true, "running framework must be the vendored one");
    assert.equal(body.framework.running, liveVersion);
    // Zero SDK assets, as a checked fact of the LIVE registry.
    assert.deepEqual(body.modules, [], "a booted bare core must hold zero modules");
    assert.equal(body.registry.violations.length, 0);
    assert.ok(body.subsystems.length >= 1, "the bare subsystem itself must be supervised");
    assert.ok(
      body.subsystems.every((s) => s.layer === "core" && s.state === "started"),
      `non-core or unstarted subsystem in the bare boot: ${JSON.stringify(body.subsystems)}`
    );
    assert.ok(body.subsystems.every((s) => !s.id.includes("studio")), "the SDK leaked into bare core");
    // The deleted-data-directory clause, verified end to end: the app was told
    // to look THERE, there is nothing there, and it is healthy anyway.
    assert.equal(body.dataDir.env, deletedDataDir);
    assert.equal(body.dataDir.exists, false, "the data directory reappeared mid-test");

    // ---- 7. the SHELL renders, not just a route handler --------------------
    const page = await tryFetch(`${BASE}/`);
    assert.ok(page && page.status === 200, "the root page did not render");
    const html = await page.text();
    assert.ok(html.includes("Bare core is up"), "the page body must render");
    assert.ok(
      html.includes("zero SDK assets"),
      "the generated banner must render — the shell is part of the fixture's claim"
    );
  } finally {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { encoding: "utf8" });
    } else {
      server.kill("SIGKILL");
    }
  }
});
