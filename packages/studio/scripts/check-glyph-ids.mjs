/**
 * @file The pack-independent glyph-id gate (owner directive, 2026-08-08).
 *
 * Every glyph id a SURFACE names — a toolbar asset's `glyph:` field, a nav
 * menu's, a literal `<Glyph id="…">` — must be in `REQUIRED_GLYPH_IDS`, the
 * template every conforming pack guarantees.
 *
 * Deliberately NOT a resolution check against the active pack: "resolves in
 * the merged pack" proves only *works with this pack*, and stays green while
 * the app is still swap-fragile — the false-green shape the verification rule
 * exists to catch. This gate reads NO pack, so it cannot go stale when one is
 * swapped. (The packs' own completeness against the same template is the
 * coverage card's job — the two checks meet in the middle.)
 *
 * Discovers files on disk (src/ + app/), so a new surface joins the check the
 * day it is written. Pack SOURCES are excluded: an entry id in a pack is a
 * supply, not a demand — packs legitimately carry hundreds of ids outside the
 * contract (nothing is required to render them).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const studio = resolve(here, "..");

// requirements.ts imports nothing, so Node's native type stripping loads it
// directly — the check runs against the template that actually ships, not a
// second copy written for the checker.
const requirements = pathToFileURL(
  resolve(studio, "../core/src/brand/requirements.ts")
).href;
const { REQUIRED_GLYPH_IDS } = await import(requirements);
const contract = new Set(REQUIRED_GLYPH_IDS);

const EXCLUDED = [join("src", "packs") + sep];
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(path);
    } else if (/\.(ts|tsx)$/.test(name)) {
      const rel = relative(studio, path);
      if (!EXCLUDED.some((ex) => rel.startsWith(ex))) files.push(path);
    }
  }
})(join(studio, "src"));
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name)) files.push(path);
  }
})(join(studio, "app"));

/** A surface naming a glyph: `glyph: "id"` in an asset, `<Glyph id="id"`. */
const NAMED = [/\bglyph:\s*"([^"]+)"/g, /<Glyph\s+id="([^"]+)"/g];

/**
 * Identity bindings declared by owner directive — NOT an alias table, and NOT
 * an escape hatch. Each entry is a deliberate decision that a specific surface
 * carries a specific identity drawing from a specific pack, accepting that it
 * renders the missing-glyph placeholder under a pack that lacks it. The
 * `icon-*` rule is untouched: an icon id in this map is itself a fault, so the
 * map cannot quietly become the alias table the contract exists to prevent.
 */
const BOUND_IDENTITY_IDS = new Map([
  [
    "lockup-horizontal",
    "owner directive: the GizmoX lockup is the command bar's brand, resolved from " +
      "axs-studio-brand (MASTER §6.2 table; RUN prompt §P4) — the swap, when it comes, " +
      "is this one id in that one asset"
  ]
]);

const faults = [];
let named = 0;
let bound = 0;
for (const path of files) {
  const source = readFileSync(path, "utf-8");
  for (const pattern of NAMED) {
    for (const hit of source.matchAll(pattern)) {
      named += 1;
      if (contract.has(hit[1])) continue;
      if (BOUND_IDENTITY_IDS.has(hit[1])) {
        if (hit[1].startsWith("icon-")) {
          faults.push(
            `${relative(studio, path)}: "${hit[1]}" is an icon in BOUND_IDENTITY_IDS — icons ` +
              `join the contract, never the binding map`
          );
        } else {
          bound += 1;
        }
        continue;
      }
      faults.push(`${relative(studio, path)}: "${hit[1]}" is not in REQUIRED_GLYPH_IDS`);
    }
  }
}

if (faults.length) {
  console.error(`check:glyphs FAILED — ${faults.length} id(s) outside the contract:`);
  for (const f of faults) console.error("  -", f);
  process.exit(1);
}
console.log(
  `check:glyphs OK — ${named} glyph reference(s) across ${files.length} files, ` +
    `all in the ${contract.size}-id template (${bound} declared identity binding(s); ` +
    `no pack was read)`
);
