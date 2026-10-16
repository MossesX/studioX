/**
 * `npm run pack <assetId>` — the asset packaging lifecycle
 * (INITIATION-PROMPT.md §4): **zip → installed dir → registry entry.**
 *
 *   1. Validate the asset's `manifest.json` (plain checks, the same fields the
 *      Python side reads — id, u-asset kind, name, version, `layer`, and the
 *      required `target` on plugin/extension/add-on).
 *   2. Zip the asset's source directory into
 *      `<assets root>/archive/<kind>/<id>-<version>.zip`, verified member-by-
 *      member against the source tree (scripts/lib/zip.mjs — the truncation
 *      fix ported from GizmoX).
 *   3. Install by extracting THE ZIP into
 *      `<assets root>/installed/<kind>/<id>/` — from the archive, not copied
 *      from source, so the installed dir is provably what the archive holds.
 *   4. Register the entry in `<assets root>/registry.json` under the shared
 *      lock — the whole read-modify-write locked, never just the save
 *      (scripts/lib/registry-store.mjs; the Python writer takes the same lock).
 *
 * Then the verification duty: the zip, the installed manifest and the registry
 * entry are each re-read OFF DISK before this script claims success — a
 * transcript that says "registered" is not evidence.
 *
 * Enable/disable afterwards is ONLY the registry flag
 * (`asset_registry.py enable|disable <id>`, or `setEnabled()`); nothing here
 * runs again and no file moves on a state flip.
 *
 * Framework tooling per INITIATION §0.1 — build-time only, ships nothing of
 * itself. Zero dependencies, Node ≥ 23.
 */
import fs from "node:fs";
import path from "node:path";

import { assetsRoot, getAsset, registerAsset, registryPath } from "./lib/registry-store.mjs";
import { extractZip, listFilesRelative, readZipMemberNames, zipDir } from "./lib/zip.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");

/** The five u-asset kinds (INITIATION §4). Layout/theme/content kinds join
 *  when the first asset of one is packaged — a list ahead of its subjects is
 *  a list nobody checks. */
const U_KINDS = new Set(["module", "subsystem", "plugin", "extension", "add-on"]);
const NEEDS_TARGET = new Set(["plugin", "extension", "add-on"]);
const TARGET_RE = /^(core|universal|module:[a-z][a-z0-9-]*)$/;
const LAYERS = new Set(["core", "sdk"]);

function fail(message) {
  console.error(`\npack: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) flags.set(args[i].slice(2), args[i + 1] ?? ""), i++;
  else positional.push(args[i]);
}
const assetId = positional[0];
if (!assetId || !/^[a-z][a-z0-9-]*$/.test(assetId)) {
  fail("usage: npm run pack <assetId> [-- --dir <sourceDir>]");
}

// ---------------------------------------------------------------------------
// 1. Locate the source directory and validate its manifest
// ---------------------------------------------------------------------------
let srcDir = flags.get("dir") ? path.resolve(flags.get("dir")) : null;
if (!srcDir) {
  for (const candidate of [
    path.join(STUDIO, "src", "modules", assetId),
    path.join(STUDIO, "src", "plugins", assetId)
  ]) {
    if (fs.existsSync(path.join(candidate, "manifest.json"))) {
      srcDir = candidate;
      break;
    }
  }
}
if (!srcDir || !fs.existsSync(srcDir)) {
  fail(
    `no source directory for "${assetId}" — looked in src/modules/ and src/plugins/ for a ` +
      `manifest.json, and no --dir was given. An asset without a manifest cannot be packaged.`
  );
}

const manifestPath = path.join(srcDir, "manifest.json");
if (!fs.existsSync(manifestPath)) fail(`${srcDir} has no manifest.json — every asset carries one (INITIATION §4)`);

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (err) {
  fail(`manifest.json is not valid JSON: ${err.message}`);
}

const problems = [];
if (manifest.id !== assetId) problems.push(`manifest id is "${manifest.id}", expected "${assetId}"`);
if (!U_KINDS.has(manifest.kind)) {
  problems.push(`manifest kind is ${JSON.stringify(manifest.kind)} — not a u-asset kind (${[...U_KINDS].join(", ")})`);
}
if (typeof manifest.name !== "string" || !manifest.name.trim()) problems.push("manifest has no name");
if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
  problems.push(`manifest version ${JSON.stringify(manifest.version)} is not x.y.z`);
}
if (!LAYERS.has(manifest.layer)) {
  problems.push(`manifest layer is ${JSON.stringify(manifest.layer)} — every manifest declares "core" or "sdk" (INITIATION §5.1 tier 2)`);
}
if (NEEDS_TARGET.has(manifest.kind)) {
  if (typeof manifest.target !== "string" || !TARGET_RE.test(manifest.target)) {
    problems.push(
      `kind "${manifest.kind}" requires target "core" | "universal" | "module:<id>" ` +
        `(got ${JSON.stringify(manifest.target)})`
    );
  }
} else if (manifest.target !== undefined) {
  problems.push(`kind "${manifest.kind}" must not carry a target (got ${JSON.stringify(manifest.target)})`);
}
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  fail(`manifest.json for "${assetId}" does not validate — nothing was packaged`);
}

const { kind, version } = manifest;
const root = assetsRoot();

// ---------------------------------------------------------------------------
// 2. Zip → assets/archive/<kind>/<id>-<version>.zip   (verified)
// ---------------------------------------------------------------------------
const zipRel = `archive/${kind}/${assetId}-${version}.zip`;
const zipAbs = path.join(root, ...zipRel.split("/"));
let zipped;
try {
  zipped = zipDir(srcDir, zipAbs, {
    onRetry: (attempt, reason) => console.warn(`pack: zip attempt ${attempt} failed (${reason}) — retrying`)
  });
} catch (err) {
  fail(String(err?.message ?? err));
}

// ---------------------------------------------------------------------------
// 3. Install → assets/installed/<kind>/<id>/   (extracted FROM the zip)
// ---------------------------------------------------------------------------
const installedRel = `installed/${kind}/${assetId}`;
const installedAbs = path.join(root, ...installedRel.split("/"));
fs.rmSync(installedAbs, { recursive: true, force: true });
let extracted;
try {
  extracted = extractZip(zipAbs, installedAbs);
} catch (err) {
  fail(`install failed: ${String(err?.message ?? err)}`);
}

// ---------------------------------------------------------------------------
// 4. Registry entry, under the shared lock
// ---------------------------------------------------------------------------
registerAsset(
  {
    id: assetId,
    kind,
    name: manifest.name,
    version,
    archive: zipRel,
    installed: installedRel,
    enabled: true,
    layer: manifest.layer,
    ...(manifest.target ? { target: manifest.target } : {}),
    meta: {
      ...(manifest.summary ? { summary: manifest.summary } : {}),
      ...(manifest.entry ? { entry: manifest.entry } : {}),
      packagedFrom: path.relative(STUDIO, srcDir).replace(/\\/g, "/") || srcDir
    }
  },
  root
);

// ---------------------------------------------------------------------------
// 5. Verification duty — re-read everything OFF DISK before claiming success
// ---------------------------------------------------------------------------
const verifyProblems = [];

if (!fs.existsSync(zipAbs)) verifyProblems.push(`archive missing on disk: ${zipAbs}`);
const zipMembers = readZipMemberNames(zipAbs);
const srcFiles = listFilesRelative(srcDir);
for (const rel of srcFiles) {
  if (!zipMembers.includes(rel)) verifyProblems.push(`archive is missing ${rel}`);
}

for (const rel of zipMembers) {
  if (!fs.existsSync(path.join(installedAbs, ...rel.split("/")))) {
    verifyProblems.push(`installed dir is missing ${rel}`);
  }
}
let installedManifest = null;
try {
  installedManifest = JSON.parse(fs.readFileSync(path.join(installedAbs, "manifest.json"), "utf8"));
} catch {
  verifyProblems.push(`installed dir has no readable manifest.json`);
}
if (installedManifest && installedManifest.id !== assetId) {
  verifyProblems.push(`installed manifest id is "${installedManifest.id}", expected "${assetId}"`);
}

const entry = getAsset(assetId, root);
if (!entry) verifyProblems.push(`registry has no entry for "${assetId}" after registration`);
else {
  if (entry.archive !== zipRel) verifyProblems.push(`registry archive path is ${entry.archive}, expected ${zipRel}`);
  if (entry.installed !== installedRel) {
    verifyProblems.push(`registry installed path is ${entry.installed}, expected ${installedRel}`);
  }
}

if (verifyProblems.length) {
  for (const p of verifyProblems) console.error(`  ${p}`);
  fail("packaging FAILED verification — do not trust this asset's lifecycle");
}

// ---------------------------------------------------------------------------
// 6. Report — every path re-read above, none merely asserted
// ---------------------------------------------------------------------------
console.log(`packed "${assetId}" (${kind} v${version}) → ${root}`);
console.log(`  archive     ${zipRel} · ${zipped.members} member(s), ${zipped.bytes} bytes${zipped.attempts > 1 ? ` (${zipped.attempts} attempts)` : ""}`);
console.log(`  installed   ${installedRel} · ${extracted.length} file(s) extracted from the zip`);
console.log(`  registry    ${path.relative(process.cwd(), registryPath(root)) || registryPath(root)} · entry "${assetId}" enabled=${entry.enabled}`);
