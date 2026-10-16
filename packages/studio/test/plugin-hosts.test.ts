/**
 * @file The spec's gate, INITIATION §3: *"a test installs one plugin zip into
 * Studio and into a peeled app and asserts identical registration"* — one
 * plugin artifact, two hosts.
 *
 * The two hosts are real DIRECTORY LAYOUTS, not mocks: an SDK-shaped tree
 * (sources under `packages/studio/`, assets at the root — what `engineRoots`
 * resolves in the dev repo) and a peel-shaped tree (sources and assets under
 * the app root — what the generated `src/server/paths.ts` produces). The SAME
 * engine module serves both because it resolves its roots per call from the
 * `AXF_ROOT`/`AXF_ASSETS_ROOT` env, which this test flips between hosts —
 * exactly the mechanism that lets the vendored copy run unmodified inside a
 * peeled app.
 *
 * "Identical registration" is then proven through the REAL installer:
 * `installPluginModules` feeds each host's imported entry module into its own
 * fresh `Registry`, and the two registries must answer `contributionsTo` with
 * the same payloads. Render is covered by contract rather than pixels — the
 * payload the point requires (`id`, `title`, `render`) is what both hosts'
 * shells draw from, and it is asserted equal.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { Registry, SHELL_STRIP_POINT_DEF } from "@axf/core";

import { installPluginModules } from "../src/plugins/plugin-manager/install";
import { packZip } from "../src/server/zip";

/* ── the one artifact ─────────────────────────────────────────────────────── */

const PLUGIN_ID = "hello-strip";

const MANIFEST = {
  id: PLUGIN_ID,
  kind: "plugin",
  name: "Hello Strip",
  version: "0.1.0",
  layer: "sdk",
  target: "core",
  entry: "plugin.ts",
  summary: "Two-host gate fixture: one shell.strip contribution."
};

/** Deliberately dependency-free so BOTH hosts' copies import under plain Node
 *  — the render is a named function the payload carries, not JSX. */
const PLUGIN_TS = `export const HELLO_STRIP = {
  from: "${PLUGIN_ID}",
  point: "shell.strip",
  priority: 7,
  payload: {
    id: "${PLUGIN_ID}",
    title: "Hello Strip",
    render: function helloStrip() {
      return "hello from the strip";
    }
  }
};
`;

const PACKAGE = packZip([
  { name: "manifest.json", data: Buffer.from(JSON.stringify(MANIFEST, null, 2) + "\n") },
  { name: "plugin.ts", data: Buffer.from(PLUGIN_TS) },
  { name: "README.md", data: Buffer.from("# Hello Strip\n") }
]);

/* ── the two hosts ────────────────────────────────────────────────────────── */

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "axf-two-hosts-"));

/** SDK layout: the repo root holds packages/studio/ and assets/. */
const SDK_ROOT = path.join(SCRATCH, "sdk");
fs.mkdirSync(path.join(SDK_ROOT, "packages", "studio", "src", "plugins"), { recursive: true });

/** Peel layout: the app root holds src/ and assets/ directly. */
const PEEL_ROOT = path.join(SCRATCH, "peel");
fs.mkdirSync(path.join(PEEL_ROOT, "src", "plugins"), { recursive: true });

/** Run `fn` with the engine pointed at one host. The engine resolves roots
 *  per call, so flipping env between calls IS the host switch. */
async function onHost<T>(root: string, fn: () => T | Promise<T>): Promise<T> {
  const prevRoot = process.env.AXF_ROOT;
  const prevAssets = process.env.AXF_ASSETS_ROOT;
  process.env.AXF_ROOT = root;
  process.env.AXF_ASSETS_ROOT = path.join(root, "assets");
  try {
    return await fn();
  } finally {
    if (prevRoot === undefined) delete process.env.AXF_ROOT;
    else process.env.AXF_ROOT = prevRoot;
    if (prevAssets === undefined) delete process.env.AXF_ASSETS_ROOT;
    else process.env.AXF_ASSETS_ROOT = prevAssets;
  }
}

/** The engine — imported AFTER the fixtures exist; roots resolve per call. */
const engine = await import("../src/plugins/plugin-manager/engine.server");

const sdkPlugins = path.join(SDK_ROOT, "packages", "studio", "src", "plugins");
const peelPlugins = path.join(PEEL_ROOT, "src", "plugins");

test("one zip installs into both hosts and leaves identical artifacts", async () => {
  const a = await onHost(SDK_ROOT, () => engine.importPlugin(PACKAGE));
  const b = await onHost(PEEL_ROOT, () => engine.importPlugin(PACKAGE));

  // The import RESULTS agree.
  assert.deepEqual(a, b);
  assert.equal(a.id, PLUGIN_ID);
  assert.equal(a.needsReload, true);

  // The FILES agree, byte for byte, in each host's plugins root.
  for (const member of ["manifest.json", "plugin.ts", "README.md"]) {
    const sdkFile = fs.readFileSync(path.join(sdkPlugins, PLUGIN_ID, member));
    const peelFile = fs.readFileSync(path.join(peelPlugins, PLUGIN_ID, member));
    assert.ok(sdkFile.equals(peelFile), `${member} identical across hosts`);
  }

  // The LEDGERS agree on everything except the created stamp.
  const ledgerOf = (root: string) =>
    JSON.parse(fs.readFileSync(path.join(root, "assets", "registry.json"), "utf8"));
  const entryA = ledgerOf(SDK_ROOT).assets.find((x: { id: string }) => x.id === PLUGIN_ID);
  const entryB = ledgerOf(PEEL_ROOT).assets.find((x: { id: string }) => x.id === PLUGIN_ID);
  assert.ok(entryA && entryB);
  assert.deepEqual({ ...entryA, created: null }, { ...entryB, created: null });
  assert.equal(entryA.meta.imported, true);

  // The archive zip each host keeps IS the artifact that was sent.
  for (const root of [SDK_ROOT, PEEL_ROOT]) {
    const kept = fs.readFileSync(
      path.join(root, "assets", "archive", "plugin", `${PLUGIN_ID}-0.1.0.zip`)
    );
    assert.ok(kept.equals(PACKAGE), "archived zip is byte-identical to the sent package");
  }

  // The generated LOADERS agree, byte for byte — same emitter, same rows.
  const loaderA = fs.readFileSync(path.join(sdkPlugins, "installed.generated.ts"), "utf8");
  const loaderB = fs.readFileSync(path.join(peelPlugins, "installed.generated.ts"), "utf8");
  assert.equal(loaderA, loaderB);
  assert.match(loaderA, new RegExp(`\\{ id: "${PLUGIN_ID}", mod: p0 \\}`));
});

test("both hosts register the plugin identically through the real installer", async () => {
  // Each host imports ITS OWN copy of the entry module — the files the engine
  // landed, not the fixture source — and installs it into a fresh registry
  // with the host point declared, exactly as each host's boot does.
  const registries: Registry[] = [];
  const reports = [];
  for (const pluginsRoot of [sdkPlugins, peelPlugins]) {
    const mod = await import(
      pathToFileURL(path.join(pluginsRoot, PLUGIN_ID, "plugin.ts")).href
    );
    const registry = new Registry();
    registry.declarePoint(SHELL_STRIP_POINT_DEF);
    reports.push(installPluginModules([{ id: PLUGIN_ID, mod }], registry));
    registries.push(registry);
  }

  // The install REPORTS agree and are clean.
  assert.deepEqual(reports[0], reports[1]);
  assert.deepEqual(reports[0], [
    { id: PLUGIN_ID, commands: 0, contributions: 1, decls: 0, problems: [] }
  ]);

  // The REGISTRATIONS agree: same point, same from, same priority, same
  // payload contract (id, title, and a callable render both shells draw).
  const [sdk, peel] = registries.map((r) => r.contributionsTo("shell.strip"));
  assert.equal(sdk.length, 1);
  assert.equal(peel.length, 1);
  const strip = (c: (typeof sdk)[number]) => ({
    from: c.from,
    point: c.point,
    priority: c.priority,
    id: (c.payload as { id: string }).id,
    title: (c.payload as { title: string }).title,
    rendered: (c.payload as { render: () => unknown }).render()
  });
  assert.deepEqual(strip(sdk[0]), strip(peel[0]));
  assert.equal(strip(sdk[0]).rendered, "hello from the strip");
  // And neither host recorded a violation doing it.
  assert.deepEqual(registries[0].violations(), []);
  assert.deepEqual(registries[1].violations(), []);
});

test("flip and uninstall behave identically on both hosts", async () => {
  for (const root of [SDK_ROOT, PEEL_ROOT]) {
    await onHost(root, () => {
      engine.setImportedEnabled(PLUGIN_ID, false);
    });
  }
  const loaderOff = (p: string) => fs.readFileSync(path.join(p, "installed.generated.ts"), "utf8");
  assert.equal(loaderOff(sdkPlugins), loaderOff(peelPlugins));
  assert.doesNotMatch(loaderOff(sdkPlugins), /hello-strip\/plugin/);

  const results = [];
  for (const root of [SDK_ROOT, PEEL_ROOT]) {
    results.push(
      await onHost(root, () => engine.uninstallPlugin(PLUGIN_ID))
    );
  }
  for (const [i, root] of [SDK_ROOT, PEEL_ROOT].entries()) {
    assert.equal(results[i].id, PLUGIN_ID);
    assert.ok(results[i].archivedTo, "uninstall archived the source dir");
    const plugins = i === 0 ? sdkPlugins : peelPlugins;
    assert.ok(!fs.existsSync(path.join(plugins, PLUGIN_ID)), "source dir removed");
    const ledger = JSON.parse(
      fs.readFileSync(path.join(root, "assets", "registry.json"), "utf8")
    );
    assert.ok(!ledger.assets.some((x: { id: string }) => x.id === PLUGIN_ID), "ledger entry gone");
    // The archive zip — the record and the re-import artifact — stays.
    assert.ok(
      fs.existsSync(path.join(root, "assets", "archive", "plugin", `${PLUGIN_ID}-0.1.0.zip`))
    );
  }
});
