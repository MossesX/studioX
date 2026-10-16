/**
 * The Asset Browser's disk half, driven against BROKEN trees on purpose.
 *
 * `disk.server.ts` claims one property — *degrade, never crash* — and a claim
 * in a docblock is a habit, not a guarantee. A browser over an installed tree
 * meets a broken install eventually (a manifest half-written by an interrupted
 * generator, a registry row pointing at a directory somebody moved), and the
 * failure mode that matters is the QUIET one: an exception becomes a 500, the
 * screen renders its empty state, and "no assets" reads as data loss rather
 * than as one bad file.
 *
 * So each case below plants a real fault on disk and asserts two things
 * together — that the read still ANSWERS, and that the fault is REPORTED. The
 * second half is the one worth having: a `try/catch` that swallows would pass
 * a test asserting only the first, and would hide exactly what a manager screen
 * exists to show.
 *
 * `AXF_ROOT` is set before the module is imported, because `src/server/paths.ts`
 * resolves it at module scope. That is also why this is one dynamic import per
 * test rather than a top-level one.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { DiskReport } from "../src/modules/asset-browser/wire";

const roots: string[] = [];

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A throwaway AmberX root with whatever registry text is handed in. */
function plant(registry: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axf-asset-browser-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  if (registry !== null) fs.writeFileSync(path.join(root, "assets", "registry.json"), registry);
  return root;
}

function installKit(root: string, id: string, manifest: string | null): void {
  const dir = path.join(root, "assets", "installed", "logo_kit", id);
  fs.mkdirSync(dir, { recursive: true });
  if (manifest !== null) fs.writeFileSync(path.join(dir, "manifest.json"), manifest);
}

/**
 * Read `root`.
 *
 * The first draft of this file set `AXF_ROOT` and re-imported the module with a
 * cache-busting query, and it QUIETLY answered about the first test's tree for
 * every case after it: `src/server/paths.ts` resolves `AXF_ROOT` once and is
 * itself cached, so busting the engine's cache re-imported a module that still
 * closed over the old root. Every assertion after the first passed or failed
 * for the wrong reason.
 *
 * That is why `readDisk` takes the root as a parameter now. A property about
 * broken trees can only be proven by planting one, so the engine has to be
 * pointable — and the fix belongs in the engine rather than in a test working
 * around it.
 */
async function readAgainst(root: string): Promise<DiskReport> {
  const { readDisk } = (await import("../src/modules/asset-browser/disk.server.ts")) as {
    readDisk: (root?: string) => DiskReport;
  };
  return readDisk(root);
}

test("a clean tree reads clean — the control, so a green below means something", async () => {
  const root = plant(
    JSON.stringify({
      format: "axf-assets/1",
      assets: [
        {
          id: "lk900",
          kind: "logo_kit",
          name: "Fixture",
          version: "0.1.0",
          enabled: true,
          installed: "installed/logo_kit/lk900"
        }
      ]
    })
  );
  installKit(root, "lk900", JSON.stringify({ id: "lk900", authored_by: "framework", signature: "sha256:abc" }));

  const report = await readAgainst(root);
  assert.equal(report.registry.ok, true);
  assert.equal(report.assets.length, 1);
  assert.equal(report.assets[0].installedPresent, true);
  assert.equal(report.assets[0].signature, "sha256:abc");
  assert.equal(report.assets[0].authoredBy, "framework");
  assert.deepEqual(report.notes, []);
  assert.deepEqual(report.orphans, []);
});

test("RED: a registry that is not JSON is reported, not thrown", async () => {
  const root = plant("{ this is not json");
  const report = await readAgainst(root);

  assert.equal(report.registry.ok, false);
  assert.equal(report.assets.length, 0);
  const note = report.notes.find((n) => n.level === "error" && n.path?.endsWith("registry.json"));
  assert.ok(note, "an unreadable registry must produce an error note naming the file");
  // The wording matters: an empty catalog with no note is indistinguishable
  // from a tree with no assets in it, which is the confusion this prevents.
  assert.match(note.message, /could not be read|not JSON/i);
});

test("RED: a missing registry is reported the same way — absent is not empty", async () => {
  const report = await readAgainst(plant(null));
  assert.equal(report.registry.ok, false);
  assert.ok(report.notes.some((n) => n.level === "error"));
});

test("RED: a registry with no `assets` array refuses to answer emptily", async () => {
  const report = await readAgainst(plant(JSON.stringify({ format: "axf-assets/1" })));
  assert.equal(report.registry.ok, true);
  assert.equal(report.assets.length, 0);
  assert.ok(
    report.notes.some((n) => n.level === "error" && /no `assets` array/.test(n.message)),
    "a parsed registry with nothing to list must say so"
  );
});

test("RED: a row naming a directory that is not there is an error ON the asset", async () => {
  const root = plant(
    JSON.stringify({
      assets: [
        {
          id: "lk901",
          kind: "logo_kit",
          name: "Moved",
          installed: "installed/logo_kit/lk901",
          archive: "archive/logo_kit/lk901-0.1.0.zip"
        }
      ]
    })
  );
  const report = await readAgainst(root);

  assert.equal(report.assets.length, 1, "the asset still LISTS — it exists, its files do not");
  const asset = report.assets[0];
  assert.equal(asset.installedPresent, false);
  assert.equal(asset.archivePresent, false);
  assert.ok(asset.notes.some((n) => n.level === "error" && /installed directory/.test(n.message)));
  // A missing zip is a warning and a missing directory an error, because one
  // costs the ability to re-install and the other costs the asset itself.
  assert.ok(asset.notes.some((n) => n.level === "warn" && /archive zip/.test(n.message)));
  // Per-asset notes are repeated at the top so a header count is the truth.
  assert.ok(report.notes.length >= asset.notes.length);
});

test("RED: a manifest that does not parse costs a note, and the card survives", async () => {
  const root = plant(
    JSON.stringify({
      assets: [
        { id: "lk902", kind: "logo_kit", name: "Half written", installed: "installed/logo_kit/lk902" }
      ]
    })
  );
  installKit(root, "lk902", "{ interrupted");

  const report = await readAgainst(root);
  assert.equal(report.assets.length, 1);
  assert.equal(report.assets[0].manifest, null);
  // The registry's name is the fallback — a card with a blank title is one
  // nobody can talk about.
  assert.equal(report.assets[0].name, "Half written");
  assert.ok(report.assets[0].notes.some((n) => /manifest is missing or does not parse/.test(n.message)));
});

test("RED: an installed directory with no registry row is surfaced as an orphan", async () => {
  const root = plant(JSON.stringify({ assets: [] }));
  installKit(root, "lk903", JSON.stringify({ id: "lk903" }));

  const report = await readAgainst(root);
  assert.equal(report.orphans.length, 1);
  assert.equal(report.orphans[0].id, "lk903");
  assert.ok(
    report.notes.some((n) => /no registry row/.test(n.message)),
    "an unregistered asset is invisible to the framework — the browser is where it gets noticed"
  );
});

test("a kind with nothing installed is the empty case, not a fault", async () => {
  const report = await readAgainst(plant(JSON.stringify({ assets: [] })));
  assert.deepEqual(report.assets, []);
  assert.deepEqual(report.orphans, []);
  assert.deepEqual(report.notes, [], "no directory for a kind is normal and must earn no note");
});

test("a row with no `enabled` field is enabled — absent is not disabled", async () => {
  const root = plant(
    JSON.stringify({
      assets: [{ id: "lk904", kind: "logo_kit", name: "Older row", installed: "installed/logo_kit/lk904" }]
    })
  );
  installKit(root, "lk904", JSON.stringify({ id: "lk904" }));

  const report = await readAgainst(root);
  // Reading a missing switch as "off" would hide half the catalog on an older
  // registry, which looks exactly like the assets having been deleted.
  assert.equal(report.assets[0].enabled, true);
});

test("kinds that are not on disk are not invented — packs and chrome are in memory", async () => {
  const root = plant(
    JSON.stringify({
      assets: [
        { id: "plug", kind: "plugin", name: "Not graphical" },
        { id: "bar", kind: "toolbar", name: "A chrome asset has no registry row" }
      ]
    })
  );
  const report = await readAgainst(root);
  // The route answers about the two `asset-registry` kinds only. A toolbar row
  // in a registry is not where toolbars live, and reporting one would give the
  // browser two disagreeing sources for the same asset.
  assert.deepEqual(report.assets, []);
});
