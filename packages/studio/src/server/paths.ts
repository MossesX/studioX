/**
 * @file The relative placeholder — the single edit the port needs.
 *
 * **Rehomed here at v0.3.0 P0** (the "strip to the frame" run). This constant
 * used to live in `src/plugins/diff-browser/paths.ts`, and the diff browser was
 * archived and deleted by that strip. `AXF_ROOT` is not the diff browser's
 * though — it is the package's answer to "where is the project root", and the
 * four `app/api/bmpx/*` routes the Build Manager runs on have always depended
 * on it. Leaving it inside a plugin was the accident; a surviving neutral home
 * is the fix.
 *
 * The diff browser's own path furniture (`HISTORY_ROOT`, `TRACKED_FILES`,
 * `withinHistory`) went with the plugin — it is only meaningful to a viewer
 * over `.history/`, and nothing else ever read it. It is recoverable from the
 * P0 archive if the browser is ever rebuilt.
 *
 * > `.claude/rules/amberx-bound-builds.md` §4 names the OLD path as the one
 * > line the port has to change. That rule now points at this file — same
 * > constant, same one-argument edit, different home.
 */
import path from "node:path";

/**
 * Project root, resolved from the running package.
 *
 * **THE PORT HAPPENED — 2026-08-11.** `pre-build/*` moved up one directory, so
 * the package runs from `<root>/packages/studio` and the root is two levels up:
 *
 *     packages/studio  →  ..  packages
 *                      →  ..  <root>
 *
 * Removing one `".."` was the entire code change, exactly as the scaffold was
 * built to guarantee. Nothing else in either package moved, because nothing
 * else knew the layout — that was the property being bought.
 *
 * Worth keeping straight: the VALUE is unchanged by the port. It resolved to
 * the AmberX root before and resolves to the AmberX root now, which is why
 * `app/api/bmpx/run/route.ts` still finds GizmoX at `AXF_ROOT/../GizmoX` and
 * the build pipeline survived the move untouched.
 *
 * The `AXF_ROOT` env var still overrides it, so another layout can be tested
 * without editing this.
 */
export const AXF_ROOT: string =
  process.env.AXF_ROOT ?? path.resolve(process.cwd(), "..", "..");
