/**
 * Zero-dependency module resolution hook for `node --test` — studio's port of
 * GizmoX's `test/alias-hook.mjs`, against studio's own aliases.
 *
 * Node runs the project's TypeScript natively, but it does NOT understand the
 * `@axs/*` → `src/*` path alias (that is a bundler/tsconfig concern) and does
 * not probe extensions for extensionless specifiers. This hook teaches the
 * native loader both, so app modules import unchanged under the test runner.
 * No test framework, no new npm dependency — just Node's stable
 * `module.registerHooks` API.
 */
import module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const srcDir = path.resolve(import.meta.dirname, "..", "src");
/**
 * `@axf/core` — mapped to the bare specifier only, never a deep path, so this
 * hook mirrors core's `exports` map instead of quietly widening it: a test
 * that reaches into core's internals fails to resolve here exactly as it
 * would in the app.
 *
 * It maps to `scripts/_axf-core-test-barrel.ts` — the JSX-free subset of the
 * real barrel — because the real one re-exports `.tsx` components Node's type
 * stripping cannot load, and SDK source under `src/**` (unlike the ctx tests,
 * which import their stub directly) has no choice but to import the
 * `@axf/core` specifier: check:imports forbids SDK source a deep path. See
 * that file's header; it goes away when the loader grows a JSX transform.
 *
 * `src/claude/**` was the original consumer and was deleted by the v0.3.0 P0
 * strip. The hook stays: the constraint is about the BARREL and JSX, not about
 * that subsystem, and the next `.ts` module a test drags in through `@axf/core`
 * needs it exactly the same way.
 */
const axfCoreBarrel = path.resolve(import.meta.dirname, "..", "scripts", "_axf-core-test-barrel.ts");
const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"];

/** Resolve an extensionless filesystem path the way a bundler would. */
function probe(base) {
  try {
    if (fs.statSync(base).isFile()) return base;
  } catch {
    /* not a file as-is */
  }
  for (const e of EXTS) {
    if (fs.existsSync(base + e)) return base + e;
  }
  for (const e of EXTS) {
    const p = path.join(base, "index" + e);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@axs/")) {
      const hit = probe(path.join(srcDir, specifier.slice("@axs/".length)));
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
    if (specifier === "@axf/core" && fs.existsSync(axfCoreBarrel)) {
      return { url: pathToFileURL(axfCoreBarrel).href, shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      // Bundler-style extensionless package subpaths — retry with the concrete
      // `.js` file before giving up.
      if (/^[^./]/.test(specifier) && !specifier.endsWith(".js")) {
        try {
          return nextResolve(specifier + ".js", context);
        } catch {
          /* fall through to the original error */
        }
      }
      // Bundler-style extensionless RELATIVE imports inside src
      // (`./types`) — probe extensions the way the `@axs/` branch does.
      if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
        const parentDir = path.dirname(new URL(context.parentURL).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
        const hit = probe(path.resolve(parentDir, specifier));
        if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
      }
      throw err;
    }
  },
});
