/**
 * Every theme-REPLACING act in the designer must commit.
 *
 * ## Why this scans source instead of calling the store
 *
 * `theme-preview.test.ts` asserts what the store does when it is driven in the
 * right order. It cannot assert that the designer drives it in that order, and
 * that distinction is not academic — it is precisely the bug that shipped on
 * 2026-08-12. `SavedThemes.applySaved` committed; `Roller.apply` did not,
 * because it was simply never wired to match. Every store-level test passed the
 * whole time.
 *
 * The symptom was the one the owner reported: a roll repainted the app while the
 * designer was open, and every nav click — a full document load — restored the
 * theme from storage that the preview had deliberately not written. A roll is
 * the one action that routinely flips the whole palette, so the designer showed
 * a dark theme and every other page showed the light one still on disk.
 *
 * So the guard belongs on the CALL SITES, and it has to DISCOVER them: a check
 * against a hand-written list of files is a check that a new tab silently joins
 * without being covered. This reads the plugin directory off disk.
 *
 * ## What counts as theme-replacing
 *
 * `apply()`, `back()` and `forward()`. Each REPLACES the theme in force rather
 * than adjusting it — `apply()` additionally wipes every hand edit — so each is
 * a person choosing a theme, not fiddling with one. `setValue()` is deliberately
 * NOT here: dial drags are the preview, which is the whole feature.
 *
 * Verified by mutation, 2026-08-12: the commit was removed from `Roller.apply`,
 * this went red naming the file and the call, and it was put back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "src", "plugins", "theme-designer");

/**
 * Calls that replace the theme in force.
 *
 * The trailing `(` is load-bearing: it matches an INVOCATION and not a function
 * passed by reference. `Roller` hands `themeStore.back` to a `step()` helper
 * that commits on its behalf, and flagging that would be flagging the fix.
 */
const REPLACING = ["themeStore.apply(", "themeStore.back(", "themeStore.forward("];

/**
 * The innermost `{ … }` block containing `index`.
 *
 * ## Why not a line window
 *
 * The first version of this test looked for a commit within N lines after the
 * call, and it was a gate that LIED. At N=30 it flagged three call sites that
 * do commit; at N=60 the mutation test — deleting the commit from
 * `Roller.apply`, the exact bug this file exists for — stayed GREEN, because
 * the window reached past the end of that callback into the `step()` helper
 * below it and found *its* commit.
 *
 * Both failures are the same mistake: proximity in a file is not the same
 * relation as "runs as part of this call". Block scope is that relation, and it
 * is cheap to compute exactly, so there is no reason to approximate it.
 */
function enclosingBlock(src: string, index: number): string {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i--) {
    const c = src[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return src;

  let open = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") open++;
    else if (src[i] === "}") {
      open--;
      if (open === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

test("every theme-replacing call in the designer commits the preview", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  assert.ok(files.length > 0, "discovered no designer sources — the path is wrong, not the code");

  const violations: string[] = [];

  for (const file of files) {
    const src = readFileSync(join(DIR, file), "utf8");
    const lines = src.split("\n");

    // Char offset of the start of each line, so a line match maps back into the
    // source for block extraction.
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = offset;
      offset += line.length + 1;

      // Skip prose. Every one of these names appears in the docblocks that
      // explain the rule, and a comment is not a call site.
      const code = line.trim();
      if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) continue;

      const hit = REPLACING.find((call) => code.includes(call));
      if (!hit) continue;

      const block = enclosingBlock(src, lineStart + line.indexOf(hit));
      if (!block.includes("commitPreview()")) {
        violations.push(`${file}:${i + 1} — ${code}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    "these calls replace the theme in force but never commit, so the change repaints " +
      "the designer and is discarded by the next document load:\n  " +
      violations.join("\n  ")
  );
});
