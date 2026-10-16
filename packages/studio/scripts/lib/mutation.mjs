/**
 * The guard mutation harness (INITIATION-PROMPT.md §5.1 tier 4).
 *
 * "A permanent test that writes a fixture file containing a violating import,
 * runs the guard, asserts it goes red, and cleans up. A guard nobody has
 * watched fail is a guard nobody has tested."
 *
 * This is the machinery, guard-agnostic: plant a file, run a function, restore
 * the tree no matter what. The assertions belong to the caller — the harness
 * only guarantees that a crash mid-guard never leaves the mutation behind
 * (and that a mutation can never overwrite a real file, which would turn a
 * test into a corruption).
 *
 * Planted files carry a `__mutation__` marker in their name by convention, so
 * the one failure mode left — a hard kill between write and finally — leaves
 * behind something that names itself, fails the green gates loudly, and is
 * safe to delete on sight.
 */
import fs from "node:fs";
import path from "node:path";

/** The naming convention above, as a value the rest of the tooling can honour
 *  instead of re-deriving. */
export const MUTATION_MARKER = "__mutation__";

/**
 * An `fs.cpSync` filter that refuses to copy a planted mutation.
 *
 * The generators (`bare-core.mjs`, `peel.mjs`) vendor the LIVE
 * `packages/core/src` while `node --test` runs test files CONCURRENTLY, so a
 * mutation planted and removed by test/isolation-guards.test.ts can vanish
 * between `cpSync`'s directory enumeration and its per-entry stat — an ENOENT
 * that fails the generator and reads as a broken build rather than as the
 * race it is. `filter` runs before that stat, so excluding the marker closes
 * the window.
 *
 * It is also just correct on its own: a generated app must never ship a test
 * artefact, whether or not anything is racing.
 */
export const notAMutation = (src) => !path.basename(src).includes(MUTATION_MARKER);

/**
 * Write `content` at `file`, run `guard`, remove the file. Returns the
 * guard's result. Refuses to touch a path that already exists.
 */
export async function withMutation(file, content, guard) {
  if (fs.existsSync(file)) {
    throw new Error(
      `mutation refuses to overwrite ${file} — a real file (or a leftover ` +
        `mutation from a killed run) is sitting there; inspect and remove it first`
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  try {
    return await guard();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * The violating-import fixture, built by concatenation ON PURPOSE: the
 * scanner in import-graph.mjs reads raw source, and a literal
 * `import … from "<leak>"` in the CALLING test's own file would be
 * indistinguishable from a real leak. Built this way, only the PLANTED file
 * ever contains the scannable form.
 */
export function violatingImport(specifier) {
  return [
    "/** Planted by the guard mutation harness (§5.1 tier 4) — safe to delete. */\n",
    "import * as __leak from ",
    JSON.stringify(specifier),
    ";\nexport const __mutation__ = typeof __leak;\n"
  ].join("");
}
