/**
 * @file `@axf/core` as the TEST LOADER serves it — the JSX-free subset of the
 * real barrel, and the third sibling of `_axf-core-stub.ts` / `_axf-ctx-stub.ts`,
 * here for the same reason those exist:
 *
 * **The real barrel cannot be loaded by Node.** `core/src/index.ts` re-exports
 * React components from `.tsx` files, and Node's type stripping does not
 * transform JSX — so any module whose graph reaches the barrel dies under
 * `node --test` on the file extension. The ctx tests dodge that by importing
 * their stub directly, but ordinary SDK source cannot dodge: it MUST import
 * the `@axf/core` specifier (check:imports forbids deep paths from src/), so
 * the fix has to live in the loader. `src/claude/**` was the case that forced
 * this and was deleted at v0.3.0 P0; the constraint it exposed is unchanged. `test/alias-hook.mjs` resolves
 * the bare `@axf/core` specifier to THIS file, which re-exports only the
 * plain-`.ts` core modules — the kernel-of-the-core: points, module,
 * subsystem, kernel, registry, commands.
 *
 * The boundary is not widened: only the exact `@axf/core` specifier maps, so
 * a deep import still fails to resolve under the test runner exactly as it
 * does in the bundler. A test that needs a symbol living in a `.tsx` (Slot,
 * AppShell, the theme bridge) fails to import it here — correctly: that is a
 * component test, and `node --test` without a JSX transform is the wrong
 * harness for it.
 *
 * NOT A WORKAROUND TO KEEP. The real fix is a JSX transform in the test
 * loader, after which the hook maps back to the real barrel and this file is
 * deleted — same owner's-call dependency note as `_axf-ctx-stub.ts`.
 *
 * Outside `tsconfig.json`'s include set on purpose: the runtime `.ts`
 * extensions below are for Node's type stripping, not for the bundler.
 */
export * from "../../core/src/points.ts";
export * from "../../core/src/module.ts";
export * from "../../core/src/subsystem.ts";
export * from "../../core/src/kernel.ts";
export * from "../../core/src/registry.ts";
export * from "../../core/src/commands.ts";
/* The shell's own extension point (0.0.22). `shell/strips.ts` is the point
   DEFINITION and its idempotent declarer — plain `.ts`, importing only the
   registry and a type — while `ShellStrips.tsx`, the thing that renders it, is
   NOT added, by the same rule as `MuiBridge.tsx` below. What this buys is a
   test-time answer to "is `shell.strip` a declared point": `registry-scoping`
   replays every declared point plus every plugin contribution into a fresh
   registry, and without this the tab bar's band would read as a contribution to
   nothing — a violation for doing exactly what the point exists for. */
export * from "../../core/src/shell/strips.ts";
/* Module settings (0.0.20). `settings/decl.ts` is a Node LEAF — it imports
   nothing at all, by its own rule, so the closure resolver can read it — and it
   carries the structural validator a plugin's declared rows are checked with. */
export * from "../../core/src/settings/decl.ts";
/* The settings STORE and the menus registration seam (2026-08-13, the
   plugin-engine work). Both are plain `.ts` — `store.ts` imports the `react`
   PACKAGE (loadable JS, no JSX) for its hook, `register-menus.ts` only the ctx
   engine's own `.ts` modules. What this buys is `installPluginModules`
   (src/plugins/plugin-manager/install.ts) importable under `node --test`: the
   two-host gate installs one plugin package into two fresh registries through
   the REAL installer, and the installer's decl branch needs these two seams. */
export * from "../../core/src/settings/store.ts";
export * from "../../core/src/ctx/register-menus.ts";
export * from "../../core/src/persist/kv.ts";
export * from "../../core/src/persist/client.ts";
export * from "../../core/src/panes/model.ts";
/* The dock/float engine's PURE half (0.0.23; wired to its consumers by P8,
   2026-08-15). `dock/model.ts` is the geometry — the snap decision, the
   orientation flip, the viewport clamp and the persisted-state parser — and it
   imports nothing, so it loads here exactly as `panes/model.ts` does.
   `dock/index.ts` is deliberately NOT used: it re-exports `Floatable.tsx`, and
   one JSX file in the graph kills the whole barrel under type stripping. The
   renderer's harness is a browser probe, which is the same split this file
   draws for `mui.ts` vs `MuiBridge.tsx`. */
export * from "../../core/src/dock/model.ts";
/* The core session store, added 2026-08-15 so `modules/accounts/store.ts` is
   importable under `node --test` — it consumes `session` as its bridge to core
   and was otherwise unreachable from a test, which is why the front-door bounce
   had no pin until now. Plain `.ts`, and its three exports collide with nothing
   else in this barrel. */
export * from "../../core/src/auth/session.ts";
// The pack registry is plain `.ts` — only `Glyph` in the brand layer is JSX —
// so the selection and persistence semantics are reachable from here.
export * from "../../core/src/brand/packs.ts";
export * from "../../core/src/brand/types.ts";

/* The theme engine's plain-`.ts` half, added 2026-08-09 for the MUI bridge.
 *
 * `mui.ts` is the mapping and it is pure data + createTheme, so it loads here;
 * `MuiBridge.tsx` (the provider) does NOT and must not be added — that is a
 * component, and the harness for it is `scripts/mui-probe.mjs`, which reads
 * computed styles off a real browser. The distinction matters more here than
 * anywhere else in this file: every assertion reachable from Node was GREEN
 * during the 2026-08-09 two-copies incident while the app rendered unthemed. */
export * from "../../core/src/theme/spec.ts";
export * from "../../core/src/theme/color.ts";
export * from "../../core/src/theme/derived.ts";
export * from "../../core/src/theme/apply.ts";
export * from "../../core/src/theme/resolve.ts";
export * from "../../core/src/theme/generate.ts";
export * from "../../core/src/theme/mui.ts";
/* `store.ts` (added 2026-08-11 for the lock) is JSX-free and takes injectable
   storage, so `test/theme-lock.test.ts` can construct one with a Map and assert
   that a locked store refuses mutation — with no window, no localStorage and no
   designer in the picture. Exporting it here also brings `theme`, the process
   singleton; a test that mutated THAT would leak into every other test in the
   run, so tests construct their own `new ThemeStore(...)`. */
export * from "../../core/src/theme/store.ts";
/* `boot.ts` is already IN the graph (store.ts imports it) — re-exported since
   2026-08-14 so consumers of `THEME_VARS_KEY` / the cookie helpers
   (src/appearance-reset.ts, and through it the accounts state engine) load
   under `node --test` too. */
export * from "../../core/src/theme/boot.ts";

/* The dashboard KIND's plain-`.ts` half, added 2026-08-10 for P4.
 *
 * `types.ts` (the chokepoint) and `registry.ts` (the resolver AND the
 * `dashboards` singleton) are both JSX-free; `Dashboard.tsx` — the component
 * that renders a wrapper — is NOT added, by the same rule as `MuiBridge.tsx`
 * above. What this buys is `src/dashboards/look-binding.ts`, whose whole
 * contract is WHEN a wrapper's look is applied, expressed against the registry
 * singleton. That rule had no test at all until P4, and it is the rule the
 * owner's approval gate rests on: a theme roll made while a wrapper is active
 * is the user's move, and a re-render must not clobber it. */
export * from "../../core/src/dashboard/types.ts";
export * from "../../core/src/dashboard/registry.ts";
/* And the AUTHORING half, added 2026-08-12: `spec.ts` is the dial spec, the
   serialisable `DashboardSpec`, its chokepoint, its resolver and its seeded
   generator — all plain `.ts`, all pure. `Wrapper.tsx`, which turns a record
   into rendered chrome, is NOT added, by the same rule as `MuiBridge.tsx`: the
   harness for a component is a browser, and every assertion reachable from
   Node was green during the 2026-08-09 two-copies incident while the app
   rendered unthemed. What this buys is `test/dashboard-spec.test.ts` — the
   determinism and active/inherit gating that the whole designer rests on. */
export * from "../../core/src/dashboard/spec.ts";

/* The nav and toolbar CHOKEPOINTS, added 2026-08-14 for `default-state` P3.
   `defineNavMenu` / `defineToolbar` are plain-`.ts` validators (types.ts each
   side), and the registries are plain `.ts` too; `NavShell.tsx` / `Toolbar.tsx`
   — the renderers — are NOT added, by the `MuiBridge.tsx` rule above. What this
   buys is `src/chrome/assets.ts` (which re-validates a stored chrome-assets
   document through the same three chokepoints the editors use) importable under
   `node --test`, and with it the accounts module's `state-snapshot.ts`. */
export * from "../../core/src/nav/types.ts";
export * from "../../core/src/nav/registry.ts";
export * from "../../core/src/toolbar/types.ts";
export * from "../../core/src/toolbar/registry.ts";
