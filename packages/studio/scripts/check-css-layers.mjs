/**
 * `npm run check:css` — every AmberX stylesheet lives inside `@layer axf`.
 *
 * ## The rule, and the incident behind it
 *
 * MUI's styles are inside `@layer mui` (studio opts in with `enableCssLayer` —
 * MUI 9.3 does not layer by default). `app/layout.tsx` declares the order
 * `@layer mui, axf;`, so AmberX rules beat MUI rules without out-specifying
 * them.
 *
 * None of that survives an UNLAYERED rule. In the cascade, an unlayered
 * declaration beats every layered one at any specificity — that is the spec,
 * not a quirk. GizmoX paid for it: a `*` reset in an unlayered `globals.css`
 * collapsed every MUI TextField in the app, and nothing inside `@layer mui`
 * could have won that fight.
 *
 * So the rule is one line — **an AmberX stylesheet is layered** — and this is
 * the gate on it.
 *
 * ## Why it exists before the first stylesheet does
 *
 * This app has zero `.css` files today, and that is exactly why the check is
 * written now. Layer order has to be decided before anything joins a layer, and
 * a rule agreed after the first stylesheet exists is a rule that starts with an
 * exception.
 *
 * That makes this a discovering check over a currently-empty set, which
 * elsewhere in this codebase is called a green lie (see the deleted replica
 * scan in `scripts/lib/import-graph.mjs`). The difference is deliberate and
 * worth stating: the replica scan's subject was supposed to exist, so zero
 * files meant the thing it guarded was gone. Here zero is the CORRECT current
 * state, and the check is a fence placed ahead of the first stylesheet. It is
 * not, however, allowed to be vacuous — so it also verifies the two things that
 * DO exist and that the whole arrangement depends on:
 *
 *   - `app/layout.tsx` declares the layer order, mui before axf;
 *   - it enables MUI's layer, so `@layer mui` is a layer something is actually
 *     in rather than a name in a statement.
 *
 * Those two assertions have a non-empty subject on every run.
 *
 * Zero dependencies, `node:fs` only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".next", ".turbo", ".git", "captures", "vendor"]);

/** The declared order. Both names, in this sequence — later layers win. */
export const LAYER_ORDER_RE = /@layer\s+mui\s*,\s*axf\s*;/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.name.endsWith(".css")) out.push(abs);
  }
  return out;
}

/**
 * Rules outside any `@layer` block, as a rough count.
 *
 * Deliberately crude: it strips comments, strips balanced `@layer <name> { … }`
 * blocks, and then asks whether any `{` survives. A stylesheet that is entirely
 * one layer block leaves nothing. This cannot parse pathological CSS, and it
 * does not need to — the rule it enforces is "wrap the file", which is a shape
 * a blunt check reads correctly.
 */
export function unlayeredRuleCount(css) {
  let src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove `@layer name;` statements — declarations, not rules.
  src = src.replace(/@layer[^;{]*;/g, "");
  // Repeatedly strip the innermost-balanced @layer blocks.
  for (;;) {
    const start = src.search(/@layer[^;{]*\{/);
    if (start < 0) break;
    let i = src.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) break; // unbalanced — leave it; the `{` count below reports it
    src = src.slice(0, start) + src.slice(end + 1);
  }
  return (src.match(/\{/g) ?? []).length;
}

const violations = [];

// --- the two always-present assertions --------------------------------------
const layoutPath = path.join(ROOT, "app", "layout.tsx");
const layout = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, "utf8") : "";
if (!layout) {
  violations.push(["app/layout.tsx", "missing — the layer order is declared there and nowhere else"]);
} else {
  if (!LAYER_ORDER_RE.test(layout)) {
    violations.push([
      "app/layout.tsx",
      "no `@layer mui, axf;` declaration. Without it the order is decided by whichever " +
        "rule the browser parses first, which is not a decision anyone made."
    ]);
  }
  if (!/enableCssLayer\s*:\s*true/.test(layout)) {
    violations.push([
      "app/layout.tsx",
      "MUI's cascade layer is not enabled (`enableCssLayer: true` on the cache provider). " +
        "MUI 9.3 does not layer by default, so `@layer mui` would name an empty layer and " +
        "every MUI rule would be unlayered — i.e. would beat every AmberX rule."
    ]);
  }
}

// --- the discovering half ---------------------------------------------------
const sheets = walk(ROOT);
for (const file of sheets) {
  const count = unlayeredRuleCount(fs.readFileSync(file, "utf8"));
  if (count > 0) {
    violations.push([
      path.relative(ROOT, file),
      `${count} rule(s) outside any @layer. Wrap the file in \`@layer axf { … }\`. ` +
        `An unlayered rule beats EVERY layered rule at any specificity — this is how a ` +
        `global reset silently destroys every MUI component in the app.`
    ]);
  }
}

if (violations.length) {
  console.error(`check:css FAILED — ${violations.length} violation(s):\n`);
  for (const [file, why] of violations) console.error(`  ${file}\n    ${why}\n`);
  process.exit(1);
}

console.log(
  `check:css OK — layer order declared (mui before axf), MUI's layer enabled, ` +
    `${sheets.length} stylesheet(s) all layered`
);
