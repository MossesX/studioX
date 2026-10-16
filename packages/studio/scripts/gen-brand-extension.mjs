/**
 * @file `npm run gen:brand-ext` — composes the brand-extension into the staged
 * gizmox-brand pack.
 *
 * 275 drawings: 50 `animated-icon`, 25 `badge`, 50 `animated-badge` (a category
 * the staged pack did not have), 100 lettered `logo` and 50 lettered
 * `animated-logo`. Specs live in `scripts/branding/ext-*.mjs`; the shared
 * drawing grammar lives in `scripts/branding/kit.mjs`.
 *
 * ## Why a generator and not 275 files
 *
 * GizmoX's rule for its own pack — *nothing under the pack directory is
 * hand-authored; edit the generator and re-run it* — is the rule here too, and
 * for the same reason: the catalogue (`manifest.json`, `pack.json`) has to keep
 * describing what is actually on disk, and a hand-edited SVG makes the
 * catalogue a claim rather than a record. GizmoX's `gen-branding-pack.ts` did
 * not come across in the port; this is the extension's equivalent and it owns
 * every file it writes.
 *
 * ## Idempotent by construction
 *
 * Extension entries are marked with the `extension` tag. Every run STRIPS all
 * of them from the catalogue and deletes the SVGs of any it will not re-emit,
 * then writes the current set. So the second run of an unchanged generator is a
 * no-op byte for byte, and dropping a drawing from a spec actually removes it
 * rather than orphaning it in the pack.
 *
 * ## What it refuses on
 *
 * The same assertions the import downstream makes, made here where they can
 * still be fixed cheaply — plus the two the import cannot make:
 *
 *   - a bare `fill`/`stroke`/`stop-color` hex outside a `var()` fallback;
 *   - a drawing with no `viewBox`;
 *   - an entry id that collides with the base pack or with another extension
 *     entry;
 *   - a DOM id (gradient, filter, clipPath, textPath target) used twice ACROSS
 *     the pack — packs are inlined, so two `<defs>` under one id means one of
 *     the two drawings silently borrows the other's paint;
 *   - a category left under the pack's 25-per-category floor.
 *
 * Run `--dry` first: it validates, prints the per-category counts, writes
 * nothing.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { rolesUsed, svgDoc } from "./branding/kit.mjs";
import { ANIMATED_ICONS } from "./branding/ext-icons.mjs";
import { ANIMATED_BADGES, BADGES } from "./branding/ext-badges.mjs";
import { ANIMATED_LOGOS, LOGOS } from "./branding/ext-logos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(here, "../../../assets/import/branding/gizmox-brand");
const MANIFEST = join(PACK, "manifest.json");
const CATALOG = join(PACK, "pack.json");
const DRY = process.argv.includes("--dry");

/** The tag that marks a drawing as this generator's, and nothing else's. */
const MARKER = "extension";
/** The pack's own floor — the generator refuses to leave a category thinner. */
const CATEGORY_FLOOR = 25;

if (!existsSync(MANIFEST)) {
  console.error(`REFUSED: no staged pack at ${PACK}`);
  process.exit(1);
}

/* ------------------------------------------------------------------- compose */

/** A spec's namespaced id minter — the same shape `ext-logos` uses internally. */
const nsFor = (id) => {
  let n = 0;
  return () => `gx2-${id}-${(n += 1)}`;
};

/** Square specs (`build`) and pre-laid-out specs (`inner` + `w`/`h`) both land here. */
function render(spec) {
  const inner = spec.inner ?? spec.build(nsFor(spec.id));
  const svg = svgDoc(inner, { w: spec.w ?? 100, h: spec.h ?? 100 });
  return {
    id: spec.id,
    label: spec.label,
    category: spec.category,
    size: spec.size,
    shape: spec.shape,
    style: spec.style,
    animated: spec.animated,
    motion: spec.motion ?? "none",
    tags: spec.tags,
    file: `${spec.dir}/${spec.id}.svg`,
    roles: rolesUsed(svg),
    recolorable: true,
    // Not part of the entry — stripped before it reaches the catalogue.
    _svg: svg
  };
}

const produced = [...ANIMATED_ICONS, ...BADGES, ...ANIMATED_BADGES, ...LOGOS, ...ANIMATED_LOGOS].map(render);

/* ------------------------------------------------------------------ validate */

const BARE_PAINT = /(?:fill|stroke|stop-color)\s*[:=]\s*"?\s*(?:#[0-9a-fA-F]{3,8}\b|rgba?\()/g;
const faults = [];

const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"));
const catalog = JSON.parse(readFileSync(CATALOG, "utf-8"));

const isExt = (e) => (e.tags ?? []).includes(MARKER);
const baseEntries = manifest.payload.entries.filter((e) => !isExt(e));
const baseCatalog = catalog.entries.filter((e) => !isExt(e));
const baseIds = new Set(baseEntries.map((e) => e.id));

const seenEntryIds = new Set();
const seenDomIds = new Map();

// DOM ids already spoken for by the 453 drawings the extension is joining.
for (const entry of baseEntries) {
  const path = join(PACK, entry.file);
  if (!existsSync(path)) continue;
  for (const m of readFileSync(path, "utf-8").matchAll(/\sid="([^"]+)"/g)) {
    seenDomIds.set(m[1], entry.id);
  }
}

for (const e of produced) {
  if (baseIds.has(e.id)) faults.push(`${e.id}: collides with a base-pack entry`);
  if (seenEntryIds.has(e.id)) faults.push(`${e.id}: duplicate extension entry id`);
  seenEntryIds.add(e.id);

  if (!/viewBox="/.test(e._svg)) faults.push(`${e.id}: no viewBox — unmeasurable`);
  for (const hit of e._svg.matchAll(BARE_PAINT)) faults.push(`${e.id}: bare paint "${hit[0]}"`);
  if (!e.roles.length) faults.push(`${e.id}: paints through no role at all`);
  if (e.animated && !/<animate/.test(e._svg)) faults.push(`${e.id}: declared animated, carries no SMIL`);
  if (!e.animated && /<animate/.test(e._svg)) faults.push(`${e.id}: carries SMIL but is not declared animated`);
  if (!e.label || !e.category || !e.style) faults.push(`${e.id}: incomplete entry metadata`);

  for (const m of e._svg.matchAll(/\sid="([^"]+)"/g)) {
    const owner = seenDomIds.get(m[1]);
    if (owner) faults.push(`${e.id}: DOM id "${m[1]}" already used by ${owner}`);
    seenDomIds.set(m[1], e.id);
  }
  for (const m of e._svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)) {
    const ref = m[1] ?? m[2];
    if (!new RegExp(`\\sid="${ref}"`).test(e._svg)) faults.push(`${e.id}: dangling reference to #${ref}`);
  }
}

const counts = {};
for (const e of [...baseEntries, ...produced]) counts[e.category] = (counts[e.category] ?? 0) + 1;
for (const [cat, n] of Object.entries(counts)) {
  if (n < CATEGORY_FLOOR) faults.push(`category "${cat}" would hold ${n} — under the ${CATEGORY_FLOOR} floor`);
}

if (faults.length) {
  console.error(`REFUSED — ${faults.length} fault(s):`);
  for (const f of faults.slice(0, 40)) console.error("  -", f);
  if (faults.length > 40) console.error(`  … and ${faults.length - 40} more`);
  process.exit(1);
}

/* --------------------------------------------------------------------- report */

const byCategory = {};
for (const e of produced) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;

console.log(`brand-extension: ${produced.length} drawing(s) composed`);
for (const [cat, n] of Object.entries(byCategory).sort()) {
  console.log(`  + ${String(n).padStart(3)}  ${cat}  (pack total ${counts[cat]})`);
}
console.log(`  pack: ${baseEntries.length} base + ${produced.length} extension = ${baseEntries.length + produced.length}`);

if (DRY) {
  console.log("--dry: validated, nothing written.");
  process.exit(0);
}

/* ----------------------------------------------------------------------- write */

const wanted = new Set(produced.map((e) => join(PACK, e.file)));
const dirs = [...new Set(produced.map((e) => e.file.split("/")[0]))];

for (const dir of dirs) mkdirSync(join(PACK, dir), { recursive: true });

// Sweep first: an id a spec no longer produces must leave the pack, not linger
// as a file the catalogue has stopped mentioning.
let swept = 0;
const baseFiles = new Set(baseEntries.map((e) => join(PACK, e.file)));
for (const dir of dirs) {
  for (const name of readdirSync(join(PACK, dir))) {
    const path = join(PACK, dir, name);
    if (!name.endsWith(".svg") || wanted.has(path) || baseFiles.has(path)) continue;
    rmSync(path);
    swept += 1;
  }
}

for (const e of produced) writeFileSync(join(PACK, e.file), e._svg + "\n", "utf-8");

const entryOf = (e) => {
  const { _svg, ...rest } = e;
  return rest;
};

manifest.payload.entries = [...baseEntries, ...produced.map(entryOf)];
manifest.version = "0.2.0";
manifest.description =
  `The framework's full visual vocabulary as one swappable asset: ${manifest.payload.entries.length} ` +
  `role-coloured SVGs across ${Object.keys(counts).length} categories — icons, logos, marks, wordmarks, ` +
  "lockups, watermarks, badges, patterns, spinners and their animated counterparts, plus the AmberX/GizmoX " +
  "lettered logo set. Every colour is a palette-role variable, so the whole pack recolours at once.";

catalog.entries = [...baseCatalog, ...produced.map(entryOf)];
catalog.version = "0.2.0";
catalog.counts = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
catalog.generator = "gen-branding-pack + scripts/gen-brand-extension.mjs";
manifest.payload.generator = catalog.generator;

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n", "utf-8");
writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + "\n", "utf-8");

/* --------------------------------------------------------------------- re-read */

// Re-stat rather than trust the log: the claim is "the pack on disk holds
// these", and only a read back proves it.
const check = JSON.parse(readFileSync(MANIFEST, "utf-8"));
const missing = check.payload.entries.filter((e) => !existsSync(join(PACK, e.file)));
if (missing.length) {
  console.error(`REFUSED after write: ${missing.length} entr(ies) with no file on disk`);
  for (const m of missing.slice(0, 10)) console.error("  -", m.id, m.file);
  process.exit(1);
}

console.log(
  `written: ${produced.length} svg(s)${swept ? `, ${swept} stale swept` : ""} — ` +
  `manifest ${check.payload.entries.length} entries, all files verified present.`
);
console.log("next: npm run import:brand");
