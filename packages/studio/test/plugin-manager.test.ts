/**
 * @file The Plugin Manager's gate — the claims its own files make about each
 * other, checked, plus the engine's two pure cores (the zip format and the
 * manifest rules).
 *
 * `registry-scoping.test.ts` already proves its two contributions land under
 * the points they name, and `ctx-conformance.test.ts` proves its areas
 * resolve, are marked, and name registered commands. What only this file
 * checks:
 *
 * 1. **One id, three spellings.** The decl, the contribution payloads and
 *    `manifest.json` each spell `plugin-manager` on their own (the decl is a
 *    Node leaf, the manifest is JSON) — pinned equal here, the tab-bar
 *    precedent.
 * 2. **The manager's own hooks have teeth** — its settings decl validates, its
 *    section names an owner that declares rows, and its roster row carries a
 *    `settingsOwner` but deliberately NO `enabledKey` (the switch that turns
 *    off the switchboard is a lockout, and this test is what keeps that a
 *    decision rather than an accident).
 * 3. **The zip core round-trips and refuses.** A package that unpacks to
 *    different bytes, or accepts a `..` member, is the class of silent wrong
 *    the engine exists to prevent — checked at the format layer where every
 *    reader inherits it.
 * 4. **The manifest rules match `pack.mjs`.** The reference manifest
 *    (demo-badge's) passes; the mutations pack would refuse, this refuses.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { validateContribution, validateSettingsDecl } from "@axf/core";

import { STUDIO_POINTS } from "../src/studio.points";
import { PLUGIN_MANAGER_DECL, PLUGIN_MANAGER_ID } from "../src/plugins/plugin-manager/plugin-manager.decl";
import {
  PLUGIN_MANAGER_PLUGIN,
  PLUGIN_MANAGER_SETTINGS_SECTION
} from "../src/plugins/plugin-manager/plugin";
import { validatePluginManifest } from "../src/plugins/plugin-manager/engine.server";
import { INSTALLED_PLUGINS } from "../src/plugins/installed.generated";
import { badMemberName, crc32, packZip, readZip } from "../src/server/zip";

const STUDIO = path.resolve(import.meta.dirname, "..");

const manifest = JSON.parse(
  fs.readFileSync(path.join(STUDIO, "src", "plugins", "plugin-manager", "manifest.json"), "utf8")
);

test("one id, three spellings, pinned equal", () => {
  assert.equal(PLUGIN_MANAGER_DECL.id, PLUGIN_MANAGER_ID);
  assert.equal(PLUGIN_MANAGER_PLUGIN.from, PLUGIN_MANAGER_ID);
  assert.equal(PLUGIN_MANAGER_PLUGIN.payload.id, PLUGIN_MANAGER_ID);
  assert.equal(PLUGIN_MANAGER_SETTINGS_SECTION.from, PLUGIN_MANAGER_ID);
  assert.equal(manifest.id, PLUGIN_MANAGER_ID);
  assert.equal(manifest.entry, "plugin.ts");
});

test("both contributions satisfy the points they name", () => {
  for (const c of [PLUGIN_MANAGER_PLUGIN, PLUGIN_MANAGER_SETTINGS_SECTION]) {
    const point = STUDIO_POINTS.find((p) => p.id === c.point);
    assert.ok(point, `${c.point} is a declared studio point`);
    assert.deepEqual(validateContribution(point!, c), []);
  }
});

test("the manager's own settings hooks have teeth", () => {
  assert.deepEqual(validateSettingsDecl(PLUGIN_MANAGER_ID, PLUGIN_MANAGER_DECL.settings), []);
  // The section opens the dialog on this owner; the owner must declare rows.
  assert.equal(PLUGIN_MANAGER_SETTINGS_SECTION.payload.ownerId, PLUGIN_MANAGER_ID);
  assert.ok(PLUGIN_MANAGER_DECL.settings.rows.length > 0);
  // A settings owner, deliberately no enable switch — see plugin.ts.
  assert.equal(PLUGIN_MANAGER_PLUGIN.payload.settingsOwner, PLUGIN_MANAGER_ID);
  assert.equal(PLUGIN_MANAGER_PLUGIN.payload.enabledKey, undefined);
  const keys = PLUGIN_MANAGER_DECL.settings.rows.map((r) => r.key);
  assert.ok(!keys.includes("enabled"), "no row that a manager could mistake for an enable switch");
});

test("the generated loader is importable and honest when empty", () => {
  assert.ok(Array.isArray(INSTALLED_PLUGINS));
});

test("zip: round-trips bytes exactly, compressible and not", () => {
  const entries = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
    { name: "src/deep/nested.ts", data: Buffer.from("export const x = 1;\n".repeat(500)) },
    { name: "noise.bin", data: Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)) }
  ];
  const packed = packZip(entries);
  const back = readZip(packed);
  assert.equal(back.length, entries.length);
  for (const e of entries) {
    const hit = back.find((b) => b.name === e.name);
    assert.ok(hit, `${e.name} survived`);
    assert.ok(hit!.data.equals(e.data), `${e.name} round-tripped byte-identical`);
  }
});

test("zip: a flipped byte is a named refusal, not a different file", () => {
  const packed = packZip([{ name: "a.txt", data: Buffer.from("the bytes that matter") }]);
  // Corrupt one payload byte past the local header (30 bytes + name).
  const corrupted = Buffer.from(packed);
  corrupted[30 + "a.txt".length + 2] ^= 0xff;
  assert.throws(() => readZip(corrupted), /a\.txt/);
});

test("zip: the member-name fence refuses, never rewrites", () => {
  for (const name of ["../escape.ts", "/abs.ts", "C:/win.ts", "a\\b.ts", "a//b.ts", "a/./b.ts", ""]) {
    assert.ok(badMemberName(name), `"${name}" is refused`);
    assert.throws(() => packZip([{ name, data: Buffer.alloc(1) }]));
  }
  assert.equal(badMemberName("src/plugins/ok-name.ts"), null);
  assert.equal(crc32(Buffer.from("")), 0);
});

test("manifest rules: the reference passes, pack.mjs's refusals refuse", () => {
  const reference = JSON.parse(
    fs.readFileSync(path.join(STUDIO, "src", "plugins", "demo-badge", "manifest.json"), "utf8")
  );
  assert.deepEqual(validatePluginManifest(reference), []);
  assert.deepEqual(validatePluginManifest(manifest), []);

  const broken = (patch: Record<string, unknown>) =>
    validatePluginManifest({ ...reference, ...patch });
  assert.ok(broken({ kind: "module" }).length, "modules do not install through the engine");
  assert.ok(broken({ version: "1.0" }).length, "version must be x.y.z");
  assert.ok(broken({ layer: "app" }).length, "layer is core|sdk");
  assert.ok(broken({ target: "somewhere" }).length, "target is fenced");
  assert.ok(broken({ id: "../evil" }).length, "id is fenced");
  assert.ok(broken({ entry: "../../outside.ts" }).length, "entry is fenced");
});
