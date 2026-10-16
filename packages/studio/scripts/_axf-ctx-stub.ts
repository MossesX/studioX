/**
 * @file `@axf/core` context-menu stub for test-time execution — the sibling of
 * `_axf-core-stub.ts`, and here for the same two reasons.
 *
 * 1. **The barrel cannot be loaded by Node.** `@axf/core`'s entry re-exports
 *    React components from `.tsx` files, and Node's type stripping does not
 *    transform JSX — so `import "@axf/core"` under `node --test` dies on the
 *    file extension before a single assertion runs. Every one of the ctx
 *    modules below is plain `.ts`, importing nothing but each other, so this
 *    keeps the module graph small AND runs the checks against the REAL contract
 *    sources rather than a copy.
 *
 * 2. **`scripts/` is tooling, and the import guard scopes itself accordingly.**
 *    `studioScanSpec` roots at `src/`, `app/` and `test/` and denies anything
 *    resolving into the core directory from them — deliberately including
 *    tests, so the barrel really is the one way in for anything that reads like
 *    SDK code. `scripts/` is outside those roots because tooling legitimately
 *    reaches into both packages (`peel.mjs`, `closure.mjs`, `check-coverage.mjs`
 *    all do). A test harness is tooling. This is where it belongs, and it is why
 *    the guard is left alone rather than given an allowlist entry.
 *
 * Outside `tsconfig.json`'s include set on purpose, exactly as its sibling is:
 * the runtime `.ts` extensions below are for Node's type stripping, not for the
 * bundler.
 *
 * NOT A WORKAROUND TO KEEP. The real fix is a JSX transform in the test loader,
 * after which tests import the barrel like any other consumer and this file is
 * deleted. That needs a dependency, so it is the owner's call and is recorded on
 * the `axf-context-menus` project for P5, whose discovering conformance test
 * will want the barrel for real.
 */
export * from "../../core/src/ctx/areas.ts";
export * from "../../core/src/ctx/compose.ts";
export * from "../../core/src/ctx/map.ts";
export * from "../../core/src/ctx/predicates.ts";
export * from "../../core/src/ctx/types.ts";
/* P2's renderer, minus the renderer. `ContextMenu.tsx` is a `.tsx` and stays
   out for the reason above, but the three modules it is ASSEMBLED from are
   plain `.ts` with no React import — which is exactly why the geometry, the
   keyboard and the row model were factored out of it. Everything P2's gate
   names is reachable from here. */
export * from "../../core/src/ctx/place.ts";
export * from "../../core/src/ctx/row-model.ts";
export * from "../../core/src/ctx/keyboard.ts";
export * from "../../core/src/ctx/default-menu.ts";
/* P3: contributions and D2's universal group. `contributions.ts` reaches the
   REAL `Registry` — the point of the phase is that menu rows travel through the
   registry core already has, so a stubbed one would test the wrong thing.
   `registry.ts` imports `Module` type-only, so `module.ts` (and with it React
   and every `.tsx` in its graph) never loads. */
export * from "../../core/src/ctx/contributions.ts";
export * from "../../core/src/ctx/universal.ts";
/* P4: the edits-only overlay. Both halves are plain `.ts` — the leaf imports
   nothing but `./types`, and the store reaches the real `MenuMap` and the real
   command registry, which is the point: drift is "this edit no longer matches
   the map", and a stubbed map would be checking the edit against a fiction. */
export * from "../../core/src/ctx/overlay.ts";
export * from "../../core/src/ctx/overlay-store.ts";
/* P5: the REGISTRATION seam, so the conformance test can boot the map the way a
   host does rather than by hand-building one. `menus.ts` is a Node leaf and
   `register-menus.ts` imports nothing but the map and the ctx commands, so both
   load under type stripping. `GROUP_DEFAULT`/`GROUP_UNIVERSAL` are re-exported
   by `map.ts` above and are the SAME bindings, so they are named explicitly
   here rather than star-exported — an ambiguous star re-export is silently
   dropped by ESM, and a constant that vanishes without a word is the failure
   this package keeps designing out. */
export { validateMenusDecl } from "../../core/src/ctx/menus.ts";
export type { ModuleMenusDecl } from "../../core/src/ctx/menus.ts";
export { registerModuleMenus } from "../../core/src/ctx/register-menus.ts";
export { registerCtxCommands } from "../../core/src/ctx/commands.ts";
export * from "../../core/src/points.ts";
export { Registry, registry } from "../../core/src/registry.ts";
/* Type-only, and therefore erased: `module.ts` pulls in the nav validator and
   the menus decl, and none of that is wanted at run time here. */
export type { Module } from "../../core/src/module.ts";
export { commands } from "../../core/src/commands.ts";
