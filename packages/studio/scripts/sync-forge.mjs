/**
 * `npm run sync:forge` — mirror the studio's OWN roster into `.claude/`, and
 * `npm run check:forge` (`--check`) — refuse to pass if the two have drifted.
 *
 * ## Why this exists
 *
 * `packages/studio/forge/{agents,skills}` is the canonical home of the personas
 * and skills AmberX ships (imported from GizmoX, 2026-08-13). It is source: in
 * git, in diffs, in the build, and readable by every conversation through the
 * `studio` scope `forge.ts` added for it.
 *
 * The `claude` CLI cannot see it. The CLI reads `<repo>/.claude/agents` and
 * `<repo>/.claude/skills` and nothing else — so working on THIS repo with the
 * house personas requires a copy there. That copy is the output of this script,
 * never a second original.
 *
 * ## One way, and only over what the studio owns
 *
 * Studio → `.claude/`. Never back. If you edit `.claude/agents/molly.md` you
 * are editing a generated file and `check:forge` will say so; the edit belongs
 * in `forge/agents/molly.md`.
 *
 * What it does NOT do is own the whole directory. A repo may keep personas of
 * its own beside the mirrored ones, so files the studio does not ship are left
 * exactly where they are — listed as extras, never deleted, never a failure.
 * A mirror that deleted what it did not recognise would make `.claude/` a
 * directory nobody else could put anything in.
 *
 * ## Why byte-identical, with no generated-file header
 *
 * The obvious courtesy — a `<!-- generated, do not edit -->` line at the top —
 * would sit above the `---` that opens the frontmatter, and both the CLI's
 * loader and `parseFrontmatter` anchor that fence to the START of the file. The
 * header would silently turn every mirrored persona into a file with no
 * frontmatter: no name, no tools, no declared skills. So the mirror is a byte
 * copy, and this file is where the "do not edit" lives instead.
 *
 * Zero dependencies, `node:fs` only — framework tooling per INITIATION §0.1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.resolve(here, "..");
const REPO = path.resolve(STUDIO, "..", "..");

/** `forge/<from>` is the source; `.claude/<to>` is the mirror. */
const PAIRS = [
  { from: path.join(STUDIO, "forge", "agents"), to: path.join(REPO, ".claude", "agents") },
  { from: path.join(STUDIO, "forge", "skills"), to: path.join(REPO, ".claude", "skills") }
];

/** Every file under `dir`, as paths relative to it. `[]` for a missing dir —
 *  a fresh clone with no `.claude/` yet is the normal case, not an error. */
function walk(dir, prefix = "") {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

const read = (file) => {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
};

const check = process.argv.includes("--check");
const label = check ? "check:forge" : "sync:forge";

let copied = 0;
let identical = 0;
const drifted = [];
const missing = [];
const extras = [];

for (const { from, to } of PAIRS) {
  const owned = walk(from);
  if (owned.length === 0) {
    console.error(`${label} FAILED — ${path.relative(REPO, from)} is empty or absent.`);
    console.error("  The studio scope is the source of the house roster; an empty one is a bug,");
    console.error("  not an empty roster. If it was removed deliberately, remove this script too.");
    process.exit(1);
  }

  for (const rel of owned) {
    const src = read(path.join(from, rel));
    const dst = read(path.join(to, rel));
    if (dst !== null && src.equals(dst)) {
      identical += 1;
      continue;
    }
    if (check) {
      (dst === null ? missing : drifted).push(path.join(path.basename(to), rel));
      continue;
    }
    const target = path.join(to, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, src);
    copied += 1;
  }

  const ownedSet = new Set(owned);
  for (const rel of walk(to)) {
    if (!ownedSet.has(rel)) extras.push(path.join(path.basename(to), rel));
  }
}

if (extras.length) {
  console.log(`${label} — ${extras.length} local file(s) the studio does not ship, left alone:`);
  for (const rel of extras) console.log(`  ${rel}`);
}

if (check && (drifted.length || missing.length)) {
  console.error(`${label} FAILED — the .claude/ mirror is not the studio roster.`);
  for (const rel of missing) console.error(`  MISSING  ${rel}`);
  for (const rel of drifted) console.error(`  DIFFERS  ${rel}`);
  console.error("");
  console.error("  Run `npm run sync:forge`. If the DIFFERING file is the one you meant to");
  console.error("  change, move the change into packages/studio/forge/ first — the mirror is");
  console.error("  output, and sync will overwrite it.");
  process.exit(1);
}

console.log(
  check
    ? `${label} OK — ${identical} mirrored file(s) match the studio roster`
    : `${label} OK — ${copied} written, ${identical} already current`
);
