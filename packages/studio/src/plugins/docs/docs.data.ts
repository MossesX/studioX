/**
 * @file The documentation LEDGER — every fact this surface renders, as data.
 *
 * Written 2026-08-12 by reading every session that touched AmberX AI Studio
 * (the `amberx-ai-studio` and `GizmoX` transcript sets from 2026-08-06
 * onward), `PLANNING-STATE.md`, `issues.md`, the nine `.bmpx` manifests and
 * the tree itself. Nothing here is remembered: every row cites where it can be
 * checked, and where a claim came from a session rather than from disk the row
 * says so.
 *
 * **Two editorial rules, both from the brief that asked for this file.**
 *
 * 1. **Stale information is removed, not struck.** A feature that was renamed,
 *    reversed or replaced is recorded at its CURRENT truth. The one exception
 *    is deliberate: anything that was *planned and then cancelled* stays, WITH
 *    the reason — a cancelled decision that is deleted gets re-proposed, and
 *    this project has re-proposed style packs twice already.
 * 2. **A status is a measurement.** `built` means it is on disk and running
 *    now; `pending` means nothing is on disk; `cancelled` means it existed or
 *    was planned and was deliberately ended. Where the two disagree — a `.bmpx`
 *    reading `built` whose output the MUI strip deleted — the DISK wins and the
 *    row says what the file claims.
 *
 * Data-only on purpose: `import type` only, so the shape can be read by a test
 * or a script without pulling React in.
 */

/* ══════════════════════════════════════════════════════ status vocabulary ══ */

export type FeatureStatus =
  /** On disk, running, verified. */
  | "built"
  /** Nothing on disk. Wanted, specified to some degree, not started. */
  | "pending"
  /** Existed or was planned; deliberately ended. Always carries `why`. */
  | "cancelled"
  /** Built, then removed by a later decision — the row records both. */
  | "removed"
  /** Replaced by something else that does the same job. */
  | "superseded";

export type Area =
  | "framework"
  | "theme"
  | "brand"
  | "chrome"
  | "modules"
  | "build"
  | "sdk"
  | "process";

export interface Feature {
  readonly id: string;
  readonly title: string;
  readonly area: Area;
  readonly status: FeatureStatus;
  /** What it is, in one paragraph a reader can act on. */
  readonly what: string;
  /** Where it lives. Repo-relative paths. */
  readonly where: readonly string[];
  /** A route in THIS app that shows it. Rendered as a real link. */
  readonly route?: string;
  /** Why it was cancelled/removed/superseded. Required on those three. */
  readonly why?: string;
  /** How it was proven — the gate, the test, the measurement. */
  readonly proof?: readonly string[];
  /** Date it reached this status, ISO. */
  readonly on: string;
  /** Owner words that decided it, verbatim where they exist. */
  readonly quote?: string;
}

/* ═══════════════════════════════════════════════════════════ what is built ══ */

export const FEATURES: readonly Feature[] = [
  /* ───────────────────────────────────────────────────────────── framework ── */
  {
    id: "core-package",
    title: "@axf/core — the framework, as its own package",
    area: "framework",
    status: "built",
    on: "2026-08-06",
    what:
      "The engine and the app are two npm packages with no path alias between them, so a " +
      "core→SDK import FAILS TO RESOLVE rather than failing a review. `packages/core` is " +
      "consumed as a `file:` dependency through its `exports` map, so a deep import into core's " +
      "internals is an error, not a convention. Currently 0.0.18.",
    where: ["packages/core/package.json", "packages/studio/package.json", "packages/core/src/index.ts"],
    route: "/demo",
    proof: [
      "packages/core tsc clean · packages/studio tsc clean",
      "npm run check:imports — names @mui/icons-material explicitly for both packages"
    ],
    quote:
      "instead of using gizmox core cant we make a placeholder or virtual core in gizmox root " +
      "same location it will be on amberx and build its own framework from scratch"
  },
  {
    id: "kernel",
    title: "Kernel — ordered boot, crash isolation, honest statuses",
    area: "framework",
    status: "built",
    on: "2026-08-06",
    what:
      "Subsystems declare `requires`; the kernel topologically sorts them, refuses a cycle BY " +
      "NAME, marks a subsystem that throws in start() as `failed` with its error retained, and " +
      "marks everything that required it `blocked`. `statuses()` reports what happened, never " +
      "what was intended. Boot is idempotent because a dev server re-executes modules on refresh.",
    where: ["packages/core/src/kernel.ts", "packages/core/src/subsystem.ts"],
    route: "/status"
  },
  {
    id: "points",
    title: "Extension points declared as DATA — and why the peel is computable",
    area: "framework",
    status: "built",
    on: "2026-08-06",
    what:
      "A module declares its points (id, kind, cardinality, requires, ordering). Once declared, " +
      "'what plugs in here' has an answer a machine can compute — which is what makes both the " +
      "peel closure (module → its points → their contributions → their deps) and an honest " +
      "'what can plug in here' UI possible. GizmoX grew its points ad hoc and cannot answer the " +
      "question at all.",
    where: ["packages/core/src/points.ts", "packages/core/src/registry.ts"],
    route: "/demo"
  },
  {
    id: "crash-isolation",
    title: "Crash isolation — three tiers on the chokepoints",
    area: "framework",
    status: "built",
    on: "2026-08-08",
    what:
      "Per-CONTRIBUTION inside `Slot` (siblings survive), MODULE inside `ModuleHost`, APP at the " +
      "shell. Plus `CrashLog` + `useCrashes` + idempotent window handlers, because React " +
      "boundaries never catch event handlers, timers, rAF or promise rejections. Five findings " +
      "beyond the four already paid for: two throw sites (render callback caught synchronously " +
      "so SSR and client render identical fallback), report-from-effects, retry must remount " +
      "(`key={attempt}`), the fallback must be crash-proof (pure token() strings), handler " +
      "install idempotent under fast refresh.",
    where: ["packages/core/src/shell/Boundary.tsx", "packages/core/src/shell/ModuleHost.tsx"],
    proof: ["Each tier mutation-tested live on :3200 and reverted", "npm run check:isolation (2 known failures — see Pending)"],
    quote:
      "im going to be making large modules based almost entirely off of individual plugins " +
      "instead of 100 modules and i need to ensure plugins cant crash the module and the module " +
      "cant crash the wrapper or main application"
  },
  {
    id: "surface-registry",
    title: "SurfaceRegistry — one primitive instead of a registry per asset kind",
    area: "framework",
    status: "built",
    on: "2026-08-11",
    what:
      "`ToolbarRegistry` and `NavRegistry` were structurally identical (93 and 97 lines, same " +
      "eight methods); `DashboardRegistry` was the third. The shape is a type parameter now, so " +
      "the next swappable asset kind is a type argument rather than a file. Deliberately does " +
      "NOT absorb `Registry` (a validated graph), `PackRegistry` (slots + persisted two-tier " +
      "selection) or the command/menu/predicate registries (they resolve NAMES to behaviour).",
    where: ["packages/core/src/registries/surface.ts"],
    route: "/demo",
    quote: "why are there 5 registries cant we make 1 is there gonna be a registry for every asset type"
  },
  {
    id: "commands",
    title: "Command registry — behaviour resolved by NAME",
    area: "framework",
    status: "built",
    on: "2026-08-08",
    what:
      "Menus, toolbars and the palette are all DATA that names a command; the command registry is " +
      "the only place behaviour lives. No inline closures anywhere, which is the property that " +
      "makes a menu editable by a UI rather than by a programmer.",
    where: ["packages/core/src/commands.ts", "packages/core/src/ctx/commands.ts"]
  },
  {
    id: "ctx-engine",
    title: "Context menus — one document listener, area-resolved, map-driven",
    area: "framework",
    status: "built",
    on: "2026-08-09",
    what:
      "ONE `contextmenu` listener mounted by `AppShell`, so coverage cannot be forgotten — " +
      "GizmoX's failure was never bad menus, it was forty modules each hand-writing a handler. " +
      "The resolver walks up from the event target collecting `data-axf-area` into a PATH (capped " +
      "at the nearest 4 areas), each area contributes its declared items, a universal band is " +
      "appended, predicates decide presence and availability, and a disabled row carries its " +
      "REASON — there is no bare `disabled` boolean, so a silently inert row is unrepresentable.",
    where: [
      "packages/core/src/ctx/ContextMenuRoot.tsx",
      "packages/core/src/ctx/areas.ts",
      "packages/core/src/ctx/map.ts",
      "packages/core/src/ctx/compose.ts"
    ],
    route: "/demo",
    proof: ["build/projects/axf-context-menus.bmpx — status built, 6/6 steps, $54.24", "test/ctx-conformance.test.ts — DISCOVERING: reads every *.decl.ts and every data-axf-area in the tree"],
    quote:
      "make the context menu always display a default context menu anywhere in the project… no " +
      "matter where you click at all time"
  },
  {
    id: "module-declared-chrome",
    title: "Modules ship their own nav and their own menus",
    area: "framework",
    status: "built",
    on: "2026-08-09",
    what:
      "`ModuleDecl.nav` and `ModuleDecl.menus` (core 0.0.13 / 0.0.14). A peeled app had no channel " +
      "for navigation at all — a nav-menu asset registers on a SURFACE, not a point, so it stayed " +
      "at the SDK layer. Declaring registers NOTHING; hosts register. The peeled app's generated " +
      "boot and Studio's subsystem call the same `registerModuleMenus`.",
    where: ["packages/core/src/module.ts", "packages/core/src/ctx/register-menus.ts"],
    route: "/demo"
  },
  {
    id: "peel",
    title: "Peel — a module becomes a standalone vendored app",
    area: "sdk",
    status: "built",
    on: "2026-08-09",
    what:
      "`npm run peel <moduleId>` computes the closure (module → its points → their contributions " +
      "→ deps), vendors a copy of core, generates a boot that registers the module's nav and " +
      "menus, and writes a `package.json` whose dependency list is derived FROM core's " +
      "peerDependencies — so every peeled app inherited MUI the day core did, with no edit to the " +
      "generator. Vendored rather than linked: a peeled app cannot break when the framework moves.",
    where: ["packages/studio/scripts/peel.mjs", "packages/studio/scripts/lib/closure.mjs", "packages/studio/scripts/lib/core-peers.mjs"],
    proof: [
      "axf-framework-gaps F1 — the gate: one module, one plugin, peeled, booted, asserted to render",
      "Re-run green 2026-08-11: peel demo vendors core 0.0.17 (72 files) + demo-badge, installs and typechecks clean"
    ]
  },
  {
    id: "suite",
    title: "Suite manifest + the 12-module cap, as a gate",
    area: "sdk",
    status: "built",
    on: "2026-08-09",
    what:
      "What constitutes Studio is DATA (`suite.manifest.ts`), resolved by the same closure " +
      "resolver the peel uses, pointed inward, and committed as `suite.resolved.generated.json` " +
      "whose `--check` mode fails when stale. The cap of 12 module-kind assets is enforced by " +
      "`test/suite.test.ts`. 7 of 12 slots are used: amberart, buildmgr, claude-workspace, " +
      "dashboard, demo, expenses, taskman.",
    where: ["packages/studio/src/suite.manifest.ts", "packages/studio/test/suite.test.ts"],
    proof: ["npm run check:suite"],
    quote: "what the fuck are you talking about why would i cap at 2 modules! the whole purpose of the sdk is to build modules — (the cap is a COUNT of slots used, not a limit of 2)"
  },

  /* ───────────────────────────────────────────────────────────────── theme ── */
  {
    id: "theme-spec",
    title: "48 dials, declared as data",
    area: "theme",
    status: "built",
    on: "2026-08-07",
    what:
      "A dial is an entry in `DIALS` with a type, a range, a default and the CSS custom property " +
      "it publishes as. The generator rolls every dial, the applier publishes every dial, and the " +
      "designer renders a control per dial — all three read the same list, so a dial added today " +
      "is rolled, published and editable the same day with no edit to any of them. Proven by the " +
      "five module-interior layout dials added 2026-08-11: no applier edit was needed.",
    where: ["packages/core/src/theme/spec.ts"],
    route: "/theme-designer",
    proof: ["npm run check:rolls — 2000-roll sweep: 0 legibility failures, 1999 distinct accents, deterministic", "test/module-layout-roll.test.ts — DISCOVERING: walks DIALS, so a new layout dial is covered with no edit"]
  },
  {
    id: "theme-generate",
    title: "Seeded generator — model-free, deterministic, contrast CLAMPED",
    area: "theme",
    status: "built",
    on: "2026-08-07",
    what:
      "Mulberry32 from a six-character seed. `Math.random()` is never used anywhere in the engine: " +
      "a theme that cannot be reproduced from its seed is a random one with a label. Contrast is " +
      "CLAMPED rather than re-rolled — rejection biases the distribution toward whatever happens " +
      "to pass and quietly narrows the palette space; clamping keeps the hue the roll chose and " +
      "moves only lightness.",
    where: ["packages/core/src/theme/generate.ts", "packages/core/src/theme/color.ts"],
    route: "/theme-designer"
  },
  {
    id: "theme-derived",
    title: "Derived tokens, declared as data with their dependency list",
    area: "theme",
    status: "built",
    on: "2026-08-07",
    what:
      "The type scale from body-size and ratio, the shadow from one elevation number, padding from " +
      "a density word, the nav geometry from the placement words. These were a hardcoded block " +
      "inside the applier — the exact thing that stops a theme engine scaling, because adding a " +
      "token meant editing the applier and the applier grew a branch per token. Declared as data " +
      "now: adding one is one array entry and no edit anywhere else. `from` is the dependency " +
      "list, so a surface can show what a token is computed FROM.",
    where: ["packages/core/src/theme/derived.ts"],
    route: "/theme-designer"
  },
  {
    id: "theme-resolve",
    title: "ONE resolver, ONE publisher, a stated precedence",
    area: "theme",
    status: "built",
    on: "2026-08-07",
    what:
      "The original bug: `ThemeBridge` and `StylePublisher` each wrote `--axf-ink` / `--axf-page` / " +
      "the brand roles from their own effect. Which won depended on which ran LAST, so the same " +
      "state produced different pixels depending on interaction history — roll and it showed, " +
      "reload and the pack won. Re-ordering effects only moves that race. There is one resolver " +
      "and one writer now, and the precedence is one sentence: the THEME owns every `--axf-*` " +
      "value; the PACK owns only the `--gxb-*` / `--axf-brand-*` identity roles its drawings paint in.",
    where: ["packages/core/src/theme/resolve.ts", "packages/core/src/theme/ThemeBridge.tsx"],
    proof: ["test/theme-follows.test.ts pins the hostile-pack case", "npm run check:brand proves both halves live"]
  },
  {
    id: "theme-publish",
    title: "Diffed publishing, and publishing to an element rather than :root",
    area: "theme",
    status: "built",
    on: "2026-08-07",
    what:
      "`applyVariables` diffs against what it wrote last, so dragging one slider writes 1 of 51 " +
      "properties instead of all 51 — the cost of rewriting everything is not the writes, it is " +
      "that the browser cannot tell 'one colour moved' from 'the design system was replaced'. And " +
      "it can target any element, which is what makes `ThemeScope` (a live preview beside the " +
      "current theme, a module in its own theme) possible at all.",
    where: ["packages/core/src/theme/publish.ts", "packages/core/src/theme/ThemeScope.tsx"],
    proof: ["npm run check:publish"]
  },
  {
    id: "theme-mui",
    title: "The MUI bridge — one store, two renderings",
    area: "theme",
    status: "built",
    on: "2026-08-10",
    what:
      "`muiThemeFrom(values)` derives an MUI `Theme` from the live dial values; `AxfMuiRoot` mounts " +
      "the ONE provider inside `AppShell`. It consumes `themeVariables()` rather than re-reading " +
      "dials, because the type ramp, shadow, padding and selection colour are DERIVED and " +
      "computing them a second time is how an MUI `<Paper>` ends up a pixel off the card beside " +
      "it. One derivation, two renderings. `MUI_DIAL_MAP` records where every dial lands; " +
      "`MUI_UNDRIVEN` records what is deliberately not driven (breakpoints, z-index).",
    where: ["packages/core/src/theme/mui.ts", "packages/core/src/theme/MuiBridge.tsx"],
    route: "/mui-probe",
    proof: ["npm run check:mui — watches a real browser: a roll moves an MUI component's computed colour", "Watched RED on a bridge unsubscribed from the store (axf-mui P6 mutation 1)"],
    quote:
      "i just want mui wherever possible i want to make sure when modules or plugins or uis are " +
      "built if an mui component exist i want it used i want the theme engine to be compatible " +
      "with mui components"
  },
  {
    id: "theme-boot",
    title: "Pre-paint boot script + the theme cookie — the flash, killed",
    area: "theme",
    status: "built",
    on: "2026-08-12",
    what:
      "The stored theme lives in localStorage, which the server cannot read, so the document " +
      "arrived painted in the DEFAULT theme and the client corrected it after hydration. Three " +
      "mechanisms, each closing a different half: (1) markup made theme-INDEPENDENT so React stops " +
      "discarding the tree; (2) a blocking `<head>` script replaying a SIGNED cache of resolved " +
      "variables before first paint; (3) an `axf_theme` COOKIE the server reads, because MUI " +
      "resolves colour in JS and emotion bakes literal hex into the SSR'd CSS — which the browser " +
      "paints before hydration, where no boot script can reach it.",
    where: ["packages/core/src/theme/boot.ts", "packages/studio/app/layout.tsx"],
    proof: ["The SSR head block carries the applied values byte-for-byte", "Zero hydration warnings on the 2026-08-12 evening verification pass"],
    quote: "a different theme loads for 1 second every time i switch pages"
  },
  {
    id: "theme-store",
    title: "Preview vs Apply — and what persists where",
    area: "theme",
    status: "built",
    on: "2026-08-12",
    what:
      "Dial edits PREVIEW: they repaint the whole app immediately and persist nothing. The " +
      "designer's one 'Apply to app' button commits to localStorage (`axf:theme@1`) and the theme " +
      "cookie. A roll, a history step and applying a saved look each commit on their own. The " +
      "older 'hot render, save instantly, no confirm step' rule still governs everything that is " +
      "not a designer edit.",
    where: ["packages/core/src/theme/store.ts", "packages/studio/src/plugins/theme-designer/ThemeDesigner.tsx"],
    route: "/theme-designer",
    proof: ["test/theme-preview.test.ts", "test/designer-commits.test.ts", "npm run check:designer"],
    quote:
      "get rid of all that lock unlock shit. just put apply button when its applied fuckin apply " +
      "it when its saved fuckin save it damn you makin it complicated"
  },
  {
    id: "theme-saved",
    title: "Saved designs — a photograph, not a recipe",
    area: "theme",
    status: "built",
    on: "2026-08-12",
    what:
      "A saved look stores THE VALUES — every dial, chrome dials included — not the seed. Storing " +
      "the seed was sound about size and wrong about meaning: a seed regenerates what the " +
      "generator produces TODAY, and the generator grows. It never records a pack: branding is a " +
      "fixed app setting a look must not touch. Looks sync to the server (`shelf-sync.ts`) so they " +
      "survive clearing site data, another browser, another machine.",
    where: [
      "packages/studio/src/plugins/theme-designer/saved-store.ts",
      "packages/studio/src/plugins/theme-designer/shelf-sync.ts",
      "packages/studio/src/plugins/theme-designer/SavedThemes.tsx"
    ],
    route: "/theme-designer",
    proof: ["test/saved-themes.test.ts"],
    quote: "i want it to save everything exactly as is. the layout, the colors, the dials, everything"
  },
  {
    id: "layout-roll",
    title: "A rolled theme rearranges a MODULE, not just the chrome",
    area: "theme",
    status: "built",
    on: "2026-08-11",
    what:
      "All 15 layout dials addressed the SHELL — ten were nav*, the rest bar* / contentWidth / " +
      "pagePad — so a roll could move the rail to another edge and leave every module's interior " +
      "pixel-identical. Five dials now address a module's interior: gridColumns, gridUnit, " +
      "gridGap, surfacePad, paneGutter. Bounded on purpose: no dial here can drop a pane, hide a " +
      "card or push a control off screen. A roll that can make content unreachable is a roll " +
      "nobody dares run.",
    where: ["packages/core/src/theme/spec.ts", "packages/studio/src/modules/dashboard/grid.ts"],
    route: "/",
    proof: ["Live: seed gwmtmg → 4 columns, seed qq7x2m → 5 columns; published variable and rendered grid agree exactly", "test/module-layout-roll.test.ts (7 cases), watched red by mutation"],
    quote: "now fix the layout rolling so modules can roll layouts"
  },

  /* ───────────────────────────────────────────────────────────────── brand ── */
  {
    id: "pack-layer",
    title: "The pack layer — drawings, and only drawings",
    area: "brand",
    status: "built",
    on: "2026-08-07",
    what:
      "Two pack kinds, shaped field-for-field like GizmoX's so its packs load unmodified: " +
      "`branding-package` and `logo-package`. AmberX adds exactly one thing and it is additive — " +
      "an entry may carry inline `svg` instead of pointing at a `file`, so a pack needs no " +
      "filesystem, which is what lets one ship compiled into a peeled app.",
    where: ["packages/core/src/brand/types.ts", "packages/core/src/brand/packs.ts"],
    route: "/brand"
  },
  {
    id: "brand-roles",
    title: "Ten roles, published TWICE — the compatibility trick",
    area: "brand",
    status: "built",
    on: "2026-08-07",
    what:
      "Every role publishes as `--axf-brand-<role>` AND GizmoX's `--gxb-<role>`, same value, one " +
      "write. So GizmoX's 453-SVG pack drops in and recolours with no edit to a single SVG. One " +
      "publication, two vocabularies, no translation step to drift.",
    where: ["packages/core/src/brand/roles.ts", "packages/core/src/theme/apply.ts"],
    route: "/brand",
    proof: ["npm run check:brand — live recolour probe"]
  },
  {
    id: "brand-contract",
    title: "34 required drawings, with the geometry measured off the registry",
    area: "brand",
    status: "built",
    on: "2026-08-08",
    what:
      "'Complete' is DATA. A pack is checked at registration and told exactly what it is missing, " +
      "by id, with the viewBox and aspect it has to fit — because a replacement lockup drawn 1:1 " +
      "does not fit a 6.25:1 slot and no CSS rescues it. `checkCoverage()` reports " +
      "`missingRequired` / `wrongAspect` / `extra` / `uncheckable` rather than throwing, because a " +
      "90%-complete pack is exactly when you most want to look at it.",
    where: ["packages/core/src/brand/requirements.ts", "BRAND-PACK-TEMPLATE.md"],
    route: "/brand",
    proof: ["npm run check:coverage — executes the SHIPPED pack modules under Node type stripping", "Mutation-tested twice: a dropped lockup and a 3.33:1 viewBox each reported on the broken pack only"]
  },
  {
    id: "glyph",
    title: "<Glyph> — a pack swap repaints hundreds of SVGs with one style write",
    area: "brand",
    status: "built",
    on: "2026-08-07",
    what:
      "Every drawing references role variables rather than literals, so changing the values " +
      "repaints the whole identity without a single component re-rendering. `Glyph` strips the " +
      "hardcoded width/height a pack SVG carries (which otherwise beats any container — a lockup " +
      "asked for 340 rendered at 200, silently), sets 100%/100% with preserveAspectRatio, and " +
      "derives height from the viewBox aspect. Regex work is WeakMap-memoised per entry.",
    where: ["packages/core/src/brand/Glyph.tsx"],
    route: "/brand",
    proof: ["npm run check:glyphs — every glyph id in the tree ⊆ the identity template; mutation-tested red on a bare `grid`"]
  },
  {
    id: "brand-setting",
    title: "Branding is a fixed APP SETTING",
    area: "brand",
    status: "built",
    on: "2026-08-12",
    what:
      "The branding pack is picked at `/settings` and nowhere else. A theme cannot name a pack, a " +
      "roll cannot change one, a saved look neither records nor restores one. Persisted by " +
      "`packs.activate()` (localStorage `axf:packs@1` + an `axf_packs` cookie the server reads). " +
      "Precedence is two tiers: an explicit selection outranks the app default.",
    where: ["packages/studio/src/plugins/settings/SettingsPage.tsx", "packages/studio/src/packs/default-identity.ts"],
    route: "/settings",
    quote:
      "branding pack should not change as part of the theme! its fixed! its a setting not " +
      "something rollable! branding is just that its not negotiable its global and does not change"
  },
  {
    id: "pack-persistence",
    title: "Two tiers of activation — the selection survives a reload",
    area: "brand",
    status: "built",
    on: "2026-08-11",
    what:
      "`activate()` is the user's move: written to storage the instant it is made and restored in " +
      "the registry's CONSTRUCTOR, so it is in force before the first render rather than arriving " +
      "as a correction. `activateDefault()` is the app stating its default: code, re-applied every " +
      "boot, never persisted, and it does not displace a stored selection. One tier and the boot " +
      "callers always won — which is why a pack chosen in the gallery used to vanish on reload.",
    where: ["packages/core/src/brand/packs.ts"],
    route: "/settings",
    proof: ["test/pack-persistence.test.ts — 15 cases written against the real boot ORDER", "Watched red by mutation: collapsing the tiers took the suite to 8 failures"],
    quote: "make brand gallery in amberx keep theme changes persistent"
  },

  /* ──────────────────────────────────────────────────────────────── chrome ── */
  {
    id: "toolbar-kind",
    title: "toolbar asset kind — the asset owns arrangement, the host owns content",
    area: "chrome",
    status: "built",
    on: "2026-08-07",
    what:
      "`defineToolbar` chokepoint, a registry, and ONE `<Toolbar>` renderer. Items are nine kinds: " +
      "brand · label · divider · spacer · slot · action · status · menu · field. The split matters: " +
      "without it you get either a bar that cannot show anything dynamic or one carrying " +
      "host-specific fields. `SURFACE_ROLES` refuses a role/surface mismatch, and the renderer " +
      "honours orientation (a rail is vertical with a right border; a status bar is a `<footer>`).",
    where: ["packages/core/src/toolbar/types.ts", "packages/core/src/toolbar/Toolbar.tsx"],
    route: "/theme-designer",
    proof: ["npm run check:toolbar — runs the REAL chokepoint and watches its mutations go red on every run"],
    quote: "lets use a toolbar asset as a banner. convert the banner into a toolbar that is rendered as a hot swappable asset"
  },
  {
    id: "nav-kind",
    title: "nav-menu asset kind — items only, placement is a dial",
    area: "chrome",
    status: "built",
    on: "2026-08-08",
    what:
      "The asset owns items, routes and glyph ids. Where it sits, what style it draws in, how big " +
      "its icons are and what its hover does are LAYOUT DIALS — so a rolled layout theme moves and " +
      "redesigns the menu with no edit to the asset. Hot-roll proven: six rolls moved it " +
      "top→right→bottom→top→bottom and rail→labeled→pills with `sameNode: true` throughout — no remount.",
    where: ["packages/core/src/nav/types.ts", "packages/core/src/nav/NavMenu.tsx", "packages/studio/src/nav/studio-nav.ts"],
    route: "/theme-designer",
    quote:
      "i want to make a navigation menu asset type as well just like the toolbar… so that a " +
      "different layout theme can be rolled and hot rendered on the fly completely moving and " +
      "redesigning the style, design, animation, icons, and location of the navigation menu"
  },
  {
    id: "dashboard-kind",
    title: "dashboard wrapper kind — a shell wrapper, nothing more",
    area: "chrome",
    status: "built",
    on: "2026-08-08",
    what:
      "`defineDashboard({id, title, description, render(ctx)})`. The host owns all state; the " +
      "wrapper takes a resolved ctx and returns chrome around `ctx.children`. Its ONE deliberate " +
      "difference from the other registries: `activate()` ACCEPTS an unknown id and resolution " +
      "falls back to the default with `substituted: true`, a once-per-id warn, and a visible strip " +
      "naming requested vs shown. Late registration heals the substitution with the preference intact.",
    where: ["packages/core/src/dashboard/registry.ts", "packages/studio/src/dashboards/amberx-console.tsx"],
    proof: ["npm run check:dashboard — drives the real registry through default / exact / fallback / healing"],
    quote: "the dashboard is simply a wrapper ui it means nothing"
  },
  {
    id: "chrome-dials",
    title: "Chrome is two dials — and custom chrome assets are authored in the designer",
    area: "chrome",
    status: "built",
    on: "2026-08-12",
    what:
      "`bannerBar` and `navMenu` (a new `chrome` dial subsystem, optionless text so a roll never " +
      "randomises them). `Toolbar` and `NavMenu` resolve them through `useAppliedThemeValues()` " +
      "with the registry default as the FLOOR, so SSR and client agree and a stale id degrades to " +
      "the default bar instead of a blank banner. The designer's Toolbar and Nav-menu tabs build, " +
      "edit and save real assets — validated through `defineToolbar` / `defineNavMenu` on save AND " +
      "on load, persisted whole in `data/axf/kv/local/chrome-assets.json`, re-registered into the " +
      "client graph by `PacksSeed` on both runtimes.",
    where: [
      "packages/studio/src/plugins/theme-designer/ToolbarTab.tsx",
      "packages/studio/src/plugins/theme-designer/NavMenuTab.tsx",
      "packages/studio/src/chrome/store.ts"
    ],
    route: "/theme-designer",
    quote:
      "also make a toolbar tab and a navigation menu tab to build edit and save toolbar and " +
      "navigation menu assets and select one thats part of the theme design"
  },
  {
    id: "appshell",
    title: "AppShell — every route is a testing surface",
    area: "chrome",
    status: "built",
    on: "2026-08-08",
    what:
      "The style root, the app-tier boundary, the MUI provider, the banner, the nav and the " +
      "context-menu root all mount ONCE at the app root. They used to be mounted by `ModuleHost`, " +
      "which made them true for module routes and absent everywhere else — the bug where `/` and " +
      "the plugin routes had no navbar. Chrome each surface has to remember is chrome that is " +
      "missing somewhere.",
    where: ["packages/core/src/shell/AppShell.tsx", "packages/studio/src/StudioShell.tsx"],
    proof: ["npm run check:ui — verifies the delegation CHAIN at each link's source; `shell-owns-the-banner` / `shell-owns-the-style-root` fail a page mounting its own", "npm run check:shell"],
    quote: "i want to turn localhost:3200 into a full development server for testing. a permanent fixture in the repo that persists through to production"
  },
  {
    id: "shell-scroll",
    title: "The shell scroll model — one scrolling <main>",
    area: "chrome",
    status: "built",
    on: "2026-08-08",
    what:
      "The shell is a fixed `height: 100vh` column and `NavShell` wraps content in ONE scrolling " +
      "`<main>`. A tall page scrolls there; a viewport app takes `flex:1 + minHeight:0` and scrolls " +
      "its own panes. Before this nothing bounded a viewport app and the diff page grew to 24,000px " +
      "of document scroll.",
    where: ["packages/core/src/shell/AppShell.tsx"]
  },

  /* ─────────────────────────────────────────────────────────────── modules ── */
  {
    id: "mod-demo",
    title: "Core Inspector (module `demo`)",
    area: "modules",
    status: "built",
    on: "2026-08-06",
    route: "/demo",
    what:
      "Renders the live kernel, registry, declared points, peel closure, capability list and theme " +
      "tokens — every number read from the running system, nothing authored. It is not 'the demo " +
      "app': :3200 IS the Studio. `/demo` boots the SERVER kernel, then `BootedHost` boots the " +
      "CLIENT one, then `ModuleHost` resolves module `demo` from the registry WITHOUT importing it. " +
      "It exists to prove the registry does real work rather than decorating a direct import, and " +
      "it is the one place the two-runtime split is visible. Three gates rest on it existing at " +
      "all: peel, ModuleHost/Slot, and check:isolation — deleting it silently DISABLES them.",
    where: ["packages/studio/src/modules/demo/"]
  },
  {
    id: "mod-dashboard",
    title: "Dashboard (module `dashboard`) — the landing card screen",
    area: "modules",
    status: "built",
    on: "2026-08-11",
    route: "/",
    what:
      "Six live-source cards on a free-placement grid whose columns, row unit and gap are ROLLED " +
      "THEME DIALS, so a roll reflows it. The grid engine (`grid.ts`, pure geometry, no React) was " +
      "ported byte-verified from GizmoX with its test. The column count is read ONCE as a JS number " +
      "and drives both the CSS and the integer placement math — if CSS read the variable while the " +
      "math kept a constant, a roll would place cards into columns the grid does not have.",
    where: ["packages/studio/src/modules/dashboard/"],
    proof: ["test/dashboard-grid.test.ts (ported verbatim)"]
  },
  {
    id: "mod-taskman",
    title: "Task Manager (module `taskman`) — GizmoX's taskflow, imported",
    area: "modules",
    status: "built",
    on: "2026-08-11",
    route: "/taskman",
    what:
      "List rail, Tree and Grid views, item detail, floating list windows, context menus declared " +
      "as data, a three-setting sui. Restored from the pre-strip archive with the pure layer " +
      "(types, ops, store, seed, decl, commands) verbatim and every screen rebuilt on MUI.",
    where: ["packages/studio/src/modules/taskman/"],
    quote:
      "import taskflow from gizmox missed everything! no tree no way to float windows or lists or " +
      "add children import that shit entirely or this project is dead if i cant import modules from gizmox"
  },
  {
    id: "mod-buildmgr",
    title: "Build Manager (module `buildmgr`) — real builds, locks, glow",
    area: "build",
    status: "built",
    on: "2026-08-09",
    route: "/buildmgr",
    what:
      "Three surfaces (projects · plan · run) driving `bmpx_builder.py` for real: `--control-file` " +
      "always, sentinel armed, a REAL run needing a confirming second click. Model badges and " +
      "status badges per step; an in-memory overlay hot-renders progress and the file is written " +
      "ONCE when the process stops. Two locks (a RUN lock keyed on PID LIVENESS, never age; a " +
      "WRITE lock around every read-modify-write) plus atomic writes everywhere. Run sessions " +
      "persist across screen changes because the session IS the events file. Promoted to a " +
      "registered module 2026-08-11 — it had always been imported directly by its route, so no " +
      "registry could see the surface that runs the builds.",
    where: ["packages/studio/src/modules/buildmgr/", "packages/studio/app/api/bmpx/"],
    proof: ["Locks mutation-tested live: two racing builders → exactly one wins; dead-pid lock broken with a warning; live-pid lock → builder exit 2 and all three routes 409", "test/model-catalog.test.ts pins the catalog to bmpx_builder.py"],
    quote: "put a file lock on bmpx files so they can not become corrupted if another build process tries to open them"
  },
  {
    id: "mod-expenses",
    title: "Expense Tracker (module `expenses`)",
    area: "modules",
    status: "built",
    on: "2026-08-12",
    route: "/expenses",
    what:
      "Three tabs (Grid · Tree · Statements) over ONE store and ONE integer-cents math module, so " +
      "the grid, the rollup and the statement can never disagree by a cent. The cents engine came " +
      "from GizmoX verbatim; the screens were rebuilt on MUI; the menus are decl data over three " +
      "areas; the ledger persists through the kv store. GizmoX's receipt-vision import and " +
      "Data-Grid sync stayed behind on purpose — their backends do not exist here.",
    where: ["packages/studio/src/modules/expenses/", "packages/studio/app/api/expenses/"],
    quote: "import expenses module from gizmox"
  },
  {
    id: "mod-claude-workspace",
    title: "Claude workspace (module `claude-workspace`)",
    area: "modules",
    status: "built",
    on: "2026-08-13",
    route: "/claude",
    what:
      "The screen over the Claude subsystem, and the proof its service API is real: it reaches " +
      "the transport ONLY through /api/claude/*, importing nothing of src/claude/ but the " +
      "isomorphic vocabulary. Transcript to desktop-app standard — streaming markdown, " +
      "syntax-highlighted code with a copy button that copies the SOURCE (never the rendered " +
      "text with its line numbers), collapsible thinking, expandable tool cards, todo lists, " +
      "nested subagent runs and file-edit diffs. Composer with multiline editing, a history " +
      "ring and slash completion. Scroll anchoring is a latch only the READER moves: scrolling " +
      "up unpins and nothing else does, and an unpinned transcript says so rather than silently " +
      "stopping. Every renderer is hand-written — no new dependencies — and the fold, the " +
      "markdown parser and the diff engine are pure, replayed through P0's four captured " +
      "transcripts by test/claude-transcript.test.ts. Declares claude-workspace.panel and " +
      "claude-workspace.composer-action for the assets P5 absorbs.",
    where: [
      "packages/studio/src/modules/claude-workspace/",
      "packages/studio/app/claude/",
      "packages/studio/src/claude/"
    ],
    proof: [
      "test/claude-transcript.test.ts replays all four real captures: subagent traffic nests under its spawning call, a tool call's three events collapse to one card, 14 TaskCreate + 26 TaskUpdate fold into ONE todo list, a REDACTED thinking block is still visible",
      "test/claude-subsystem.test.ts holds the library verbs: rename refuses an empty title, delete is refused while a turn is live, search is AND-within-one-message and pinned-leads",
      "Two guards caught real bugs on their first run — a thinking block that never settled when closed by the next message, and the highlighter colouring an unknown language it had promised to leave alone"
    ]
  },
  {
    id: "claude-projects",
    title: "Claude projects and the bound working directory",
    area: "modules",
    status: "built",
    on: "2026-08-13",
    route: "/claude",
    what:
      "A project is a BOUND WORKING DIRECTORY plus standing instructions, knowledge files and " +
      "default model/effort/permission mode; conversations belong to one and inherit it. The " +
      "bound repo is the whole advantage over the desktop app — the CLI already runs with a cwd, " +
      "so it is surfaced deliberately: set on the process AND stated to the model in the system " +
      "contract, because setting it tells the CLI and naming it tells the model which tree it is " +
      "standing in. What is inherited splits two ways, and the split is load-bearing. " +
      "cwd/model/effort/permissionMode are COPIED onto the conversation at start(), because the " +
      "CLI holds a --resume session's history and that history was produced in a particular " +
      "directory — re-reading the project at turn time would let an edit move a live session's " +
      "tree out from under it. Instructions and knowledge are read LIVE on the first turn, " +
      "because the file on disk IS the knowledge and a copy taken when the path was added would " +
      "be a snapshot disagreeing with the file beside it. cwd is BOUND rather than defaulted: a " +
      "start whose cwd disagrees with the project's is refused by name (both sides normalised, " +
      "or one Windows tree spelled two ways reads as two trees), while the other three stay " +
      "overridable per conversation — a model varies turn to turn, a repository does not. " +
      "Knowledge is capped at 24 files / 128 KB each / 512 KB total with bounded reads, and a " +
      "truncation is STATED inside the contract: a silently cut file is a model answering " +
      "confidently from a document's first half. A missing knowledge file is skipped silently at " +
      "turn time (telling the model about the operator's typo helps nobody), which is why the " +
      "manager resolves every path live and shows the size or the reason — that readout is the " +
      "only place the typo can be caught before a turn is spent.",
    where: [
      "packages/studio/src/claude/projects.ts",
      "packages/studio/src/modules/claude-workspace/ProjectsDialog.tsx",
      "packages/studio/app/api/claude/projects/"
    ],
    proof: [
      "test/claude-projects.test.ts's GATE reads the BrokerChatParams the injected transport receives — the last point before node:child_process — and asserts the cwd, the instructions, the knowledge bodies and the directory as stated to the model",
      "Three mutations watched go red: the project block disabled in composeSystem, the bound cwd replaced with process.cwd(), and the route's projectId removed",
      "A probe importing the route handlers directly caught the bug no unit test could: app/api/claude/conversations/route.ts destructures StartOptions field by field and silently dropped projectId, returning 201 with a correct-looking record. Now pinned by a source scan of the interface against the route's call"
    ]
  },
  {
    id: "plugin-agent-forge",
    title: "Agent Forge — personas and skills, inside Claude",
    area: "sdk",
    status: "built",
    on: "2026-08-13",
    route: "/claude",
    what:
      "The `.claude/agents` and `.claude/skills` the CLI itself would load for a conversation's " +
      "working directory, listed in a workspace panel — and one of them BOUND to the " +
      "conversation, so `claude.context-provider` folds it into the system contract on the first " +
      "turn. Three contributions across two hosts, and the split is load-bearing: the panel and " +
      "the composer action are in `plugin.ts`, which the browser bundle evaluates, while the " +
      "context provider is in `plugin.server.ts` because it reads the filesystem. Binding is " +
      "first-turn only — a resumed session already carries its history and the broker ignores " +
      "`system` under `--resume` — so the panel says so instead of offering a control that would " +
      "quietly do nothing, and the composer action pastes the identical compiled text into one " +
      "message for a conversation already under way. A `.md.disabled` persona is listed and " +
      "never compiled: that suffix is the CLI's own off switch, and honouring it is agreeing " +
      "with the tool rather than inventing a second meaning.",
    where: [
      "packages/studio/src/plugins/agent-forge/",
      "packages/studio/app/api/agent-forge/route.ts",
      "packages/studio/src/server/plugins.ts"
    ],
    proof: [
      "test/agent-forge.test.ts — the parser, the scan and the composition against a PLANTED tree, plus the provider's four ordinary misses, each answering '' rather than throwing inside a turn",
      "npm run check:absorption — the panel renders in the live workspace at /claude and names its contributor",
      "The restored parser had a real bug and the test found it on the first run: `[x, 'y']` parsed as \"'y\" because quotes were stripped before trimming. Restoring a bug verbatim is still shipping it"
    ]
  },
  {
    id: "plugin-diff-browser",
    title: "Difference browser — absorbed, and back at /diff",
    area: "sdk",
    status: "built",
    on: "2026-08-13",
    route: "/diff",
    what:
      "Every historical instance of a tracked file as its own column, oldest left to newest " +
      "right, with per-column collapse to a 45px rail, drag resize, synchronised scroll, a " +
      "changes-only filter, a comparison-base toggle the first filter REVEALS (the question it " +
      "answers does not exist until you are looking at changes), and find with arrows, F3/Shift+F3, " +
      "wrap-around and a global mode that greys every other field so exactly one query is in play. " +
      "Built 2026-08-07 and deliberately left unwired; archived and deleted by the v0.3.0 strip; " +
      "restored here with the pure engine VERBATIM and every screen rebuilt on MUI. It now reaches " +
      "the Claude workspace through `claude-workspace.panel` (a summary pane) and " +
      "`claude-workspace.composer-action` (quote the newest change), which is the wiring the " +
      "original was waiting for. One capability is new and is a bug fix: the history folders are " +
      "DISCOVERED rather than hardcoded, and there are four — three sets of snapshots were " +
      "unreachable through the viewer that exists to read them.",
    where: [
      "packages/studio/src/plugins/diff-browser/",
      "packages/studio/app/api/history/route.ts",
      "packages/studio/app/diff/page.tsx"
    ],
    proof: [
      "test/diff-engine.test.ts — including the case the second filter exists for: a line cut in one revision and pasted back in a later one is 'added' against its neighbour and NOT new to the document",
      "npm run check:absorption, live on the real 14-column history: changes-only cut 37338 rendered rows to 2676; the base toggle was absent until the filter was on; find reported 1/34 and WRAPPED backwards to 34/34; global mode gave 14 counters with 13 fields greyed",
      "That run also re-earned the three rows axf-diff-browser.bmpx marks 'NOT RE-VERIFIED IN ANY RECORD' — deep collapse (12 rails, labels intact), F3 wrap watched rather than assumed, and the global toolbar exercised one control at a time"
    ]
  },
  {
    id: "plugin-scoping",
    title: "Registry scoping — a plugin reaches one host and no other",
    area: "framework",
    status: "built",
    on: "2026-08-13",
    what:
      "Five points are contributed to from ONE mixed array in `studio.subsystem.ts`, and the " +
      "registry files each contribution under the point it NAMES — so the workspace's panel " +
      "column shows two panels and AmberArt's rail shows three tools, with nothing written to " +
      "keep them apart. The proof discovers: the points come from every `<id>.decl.ts` plus the " +
      "subsystem's own, the contributions from every `src/plugins/*/plugin*.ts`, so a plugin " +
      "written next month joins the test the day it is written. The same claim is checked one " +
      "level up against the resolved suite closure, which is what a peel would actually ship.",
    where: [
      "packages/studio/test/registry-scoping.test.ts",
      "packages/core/src/registry.ts",
      "packages/studio/suite.resolved.generated.json"
    ],
    proof: [
      "Three mutations watched red: a contribution to an undeclared point, an impostor naming another host's point (refused BY NAME on the payload check), and a payload missing a required field",
      "Two more watched red on the real tree: retargeting a live contribution's point, and deleting the server-seam call from the turn-starting route"
    ]
  },
  {
    id: "plugin-brand-gallery",
    title: "Brand gallery",
    area: "brand",
    status: "built",
    on: "2026-08-07",
    route: "/brand",
    what:
      "Every pack at judging size: mark, lockup, wordmark, spinner, a 16→96px scale ladder, the " +
      "full glyph catalog and the published role variables, plus the coverage card. Selection " +
      "itself moved to /settings on 2026-08-12; the gallery keeps a click-to-activate list because " +
      "it is the surface the recolour probe drives.",
    where: ["packages/studio/src/plugins/brand-gallery/BrandGallery.tsx"]
  },
  {
    id: "plugin-theme-designer",
    title: "Theme Designer — five tabs, one authority",
    area: "theme",
    status: "built",
    on: "2026-08-12",
    route: "/theme-designer",
    what:
      "Dials (rendered FROM the spec, so a new dial appears with no edit) · Roller (seeded rolls " +
      "with history) · Toolbar (build/edit/save banner assets) · Nav menu (same for menus) · Saved " +
      "(the shelf of looks). One 'Apply to app' in the header is the only commit. The Branding and " +
      "Style-packs tabs were removed the same evening they were discussed.",
    where: ["packages/studio/src/plugins/theme-designer/"],
    proof: ["npm run check:designer"]
  },
  {
    id: "plugin-bmpx-taskman",
    title: "Build Manager → Task Manager sync",
    area: "build",
    status: "built",
    on: "2026-08-11",
    route: "/taskman",
    what:
      "Mounted once by `StudioShell`, inert unless a taskman module is registered. Turns every " +
      "`.bmpx` into a managed list, ticks steps off live from disk, glows the active list and " +
      "pulses the step being built.",
    where: ["packages/studio/src/plugins/bmpx-taskman/"],
    quote: "whenever a build manager project is added add it as a list in task manager if task manager is installed"
  },
  {
    id: "kv",
    title: "The kv store — server-backed documents",
    area: "framework",
    status: "built",
    on: "2026-08-11",
    what:
      "`/api/axf` over `data/axf/kv/local/*.json`. What it holds today: the chrome assets doc, the " +
      "saved-look shelf, the expense ledger. It is the seam that turns a browser-only cache into an " +
      "asset — a look you built is gone the moment you clear site data if it lives only in localStorage.",
    where: ["packages/studio/src/server/axfKv.ts", "packages/studio/app/api/axf/"],
    proof: ["test/axf-kv.test.ts"]
  },
  {
    id: "gates",
    title: "The gate suite — 20 check:* scripts and 275 tests",
    area: "process",
    status: "built",
    on: "2026-08-12",
    what:
      "Every rule in this project is a test that goes red; a rule written as a sentence in markdown " +
      "is a suggestion. Several gates run the REAL chokepoints under Node's native type stripping " +
      "and watch their own mutations go red on EVERY run, so a guard that stopped guarding says so.",
    where: ["packages/studio/package.json", "packages/studio/scripts/", "packages/studio/test/"],
    proof: ["275/275 tests · both packages typecheck clean (2026-08-12 evening)"]
  },
  {
    id: "glyph-docs",
    title: "Glyph-rendering documentation (the earlier pass)",
    area: "process",
    status: "built",
    on: "2026-08-08",
    what:
      "Seven interactive light-theme HTML pages plus MDX mirrors and a README, at " +
      "`pre_docs/glyph-rendering-structure/`. `glyphs-data.js` is GENERATED from the installed pack " +
      "by `extract-glyphs.mjs`, which refuses bare hex — so the extraction itself proves the " +
      "role-variable claim. Carries an obsolescence notice on every page by the owner's own " +
      "instruction. Served on :3401, not by this app.",
    where: ["pre_docs/glyph-rendering-structure/"],
    quote:
      "i want documentation built for it in html and markup mdx along with a detailed readme… " +
      "visual maps that show and explain how things are connected"
  },

  /* ═════════════════════════════════════════════════════════════ PENDING ══ */
  {
    id: "pending-ctx-manager",
    title: "Context-menu manager (axf-ctx-manager) — the UI that edits the map",
    area: "sdk",
    status: "pending",
    on: "2026-08-12",
    what:
      "Deliberately a separate project from the engine, and built AFTER the engine has been used in " +
      "anger: building an editor in the same pass as the thing it edits settles the contract " +
      "against imagined use. The engine half it needs is already there — the map is data, commands " +
      "and predicates resolve by NAME, and the edits-only overlay (P4) applies on read, so dropping " +
      "an overlay restores the defaults exactly.",
    where: ["build/projects/axf-ctx-manager.bmpx"],
    route: "/buildmgr",
    proof: ["Manifest: v0.1.0, status planned, 0/13 steps"]
  },
  {
    id: "pending-toolchain",
    title: "Move the build toolchain into AmberX",
    area: "build",
    status: "pending",
    on: "2026-08-12",
    what:
      "`build/tools/*.py`, its own `.venv`, and making AmberX's `build/projects/` authoritative " +
      "instead of a mirror of GizmoX's. Five paths, all in `app/api/bmpx/run/route.ts`. Then the " +
      "MIRROR DUTY itself can be deleted — the run route's copy step and §1 of " +
      "`amberx-bound-builds.md` — because it exists only because the projects live in GizmoX. " +
      "`test/model-catalog.test.ts` reads `bmpx_builder.py` from the GizmoX tree by design and its " +
      "path moves with the toolchain.",
    where: ["packages/studio/app/api/bmpx/run/route.ts"],
    quote: "cut off gizmox stop using its core entirely. transfer all work to amberx"
  },
  {
    id: "pending-core-link",
    title: "I-1 · node_modules/@axf/core is a COPY, not a link",
    area: "framework",
    status: "pending",
    on: "2026-08-12",
    what:
      "HIGH severity and SILENT. You edit `packages/core/src`, typecheck passes, tests pass, you " +
      "reload — and nothing changes. No error anywhere. It reads as 'my fix was wrong' and sends " +
      "you rewriting correct code. It has bitten twice in two days; on 2026-08-12 the copy had " +
      "drifted so far that `core/src/registries/` was missing entirely from the loaded tree. Ten " +
      "second check: `diff -rq packages/core/src packages/studio/node_modules/@axf/core/src`. Real " +
      "fix: `scripts/link-kit.mjs` (already a postinstall) should relink `@axf/core`, not just the " +
      "MUI kit.",
    where: ["issues.md", "packages/studio/scripts/link-kit.mjs"]
  },
  {
    id: "pending-nav-w",
    title: "I-2 · --axf-nav-w is ignored — the rail keeps its labelled width",
    area: "chrome",
    status: "pending",
    on: "2026-08-11",
    what:
      "Roll a theme to `navStyle: rail`. The labels correctly disappear, but the rail stays at its " +
      "full labelled width, leaving an icon strip in ~212px of dead space. Measured: `--axf-nav-w` " +
      "is 54px, `--axf-nav-size` 238px, the `<nav>` computes to 212px. Already ruled out: the " +
      "declaration is not missing and the variable is not stale — the same element correctly " +
      "honours `--axf-nav-pad`, the borders shorthand and `--axf-nav-surface`. Leading suspect, " +
      "unproven: the flex `min-width: auto` content floor.",
    where: ["issues.md", "packages/core/src/nav/NavMenu.tsx", "packages/core/src/theme/derived.ts"]
  },
  {
    id: "pending-buildmgr-baseline",
    title: "I-3 · check:buildmgr is red on a stale baseline",
    area: "build",
    status: "pending",
    on: "2026-08-12",
    what:
      "168 differences, of which only ~4 are current work; ~112 are shell drift that predates it " +
      "(nav sections, module slots 1/12 → 5/12, a Build Manager banner, the new Settings row). It " +
      "is NOT just re-baselined because `captures/buildmgr/before` is the only surviving record of " +
      "the pre-MUI screen — overwriting it makes any P5 infidelity permanently invisible and the " +
      "gate would then defend the drift instead of catching it. Re-baselining both labels " +
      "deliberately is an OWNER call.",
    where: ["issues.md", "packages/studio/scripts/buildmgr-probe.mjs"]
  },
  {
    id: "pending-isolation",
    title: "I-4 · check:isolation has 2 failures, undiagnosed",
    area: "framework",
    status: "pending",
    on: "2026-08-12",
    what:
      "`a throwing MUI provider reads \"application failed\" rather than white-screening — []` and " +
      "`the panel is PAINTED from --axf-* with no MUI provider above it — no panel`. Confirmed " +
      "PRE-EXISTING: run with that day's core change reverted in the loaded tree, they reproduce " +
      "identically. Nobody has looked at what they mean yet.",
    where: ["issues.md", "packages/studio/scripts/isolation-probe.mjs", "packages/core/src/shell/Boundary.tsx"]
  },
  {
    id: "pending-pane-transpose",
    title: "PaneLayout cannot transpose from a roll",
    area: "theme",
    status: "pending",
    on: "2026-08-11",
    what:
      "`paneGutter` themes the divider, but a rolled tree cannot swap a split from row to column. " +
      "`direction` drives markup, the drag axis and the min-extent arithmetic together, and the " +
      "file's one law is 'measure before you latch' — a transpose done wrong latches panes at " +
      "their minimum, the exact bug that file exists to make unrepresentable. The safe version " +
      "reads the computed direction at the interaction. Not attempted.",
    where: ["packages/core/src/panes/PaneLayout.tsx"]
  },
  {
    id: "pending-surface-pad",
    title: "Only the dashboard consumes the module-interior dials",
    area: "theme",
    status: "pending",
    on: "2026-08-11",
    what:
      "demo, taskman, buildmgr and expenses still hand-author their interiors. The tokens are " +
      "global so any module CAN read them, but nothing FORCES adoption. The chokepoint would be " +
      "`ModuleHost` applying `--axf-surface-pad` to every module it hosts — left out of that pass " +
      "because it changes every module's padding at once.",
    where: ["packages/core/src/shell/ModuleHost.tsx"]
  },
  {
    id: "pending-ssr",
    title: "Client-only shell vs SSR — undecided, and worth deciding first",
    area: "framework",
    status: "pending",
    on: "2026-08-10",
    what:
      "Every hard bug of the 2026-08-10 session traced to server-rendering a preference the server " +
      "cannot see. For a local single-operator studio, SSR buys no SEO and no cold-visitor TTFB " +
      "while costing the hydration failure, the boot script, the serverState snapshots, the " +
      "two-module-graph problem and a cookie. A client-only shell would delete the whole category " +
      "for the price of a brief skeleton. Nothing has been decided.",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "pending-applications",
    title: "Is `applications` a sixth asset kind? — abandoned thread",
    area: "sdk",
    status: "pending",
    on: "2026-08-05",
    what:
      "The owner began defining a new asset kind, `applications`, and the prompt was cut off before " +
      "the compile target was stated. Never finished, never carried into the AmberX taxonomy. If " +
      "that kind is still wanted it is a sixth u-asset and needs deciding before the taxonomy is " +
      "treated as settled.",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "pending-prompt-builder",
    title: "Prompt builder module — wanted, never specified",
    area: "sdk",
    status: "pending",
    on: "2026-08-06",
    what:
      "An exhaustive search proved it does not exist anywhere: not in 52 `.bmpx` projects, not in " +
      "33 captured build prompts, not in the abbreviation registry, not in the asset registry, not " +
      "in any transcript. It was being carried in the owner's head. Two things it should absorb " +
      "rather than reinvent: GizmoX's Claude Chat prompt library (21 prompts with tickable option " +
      "branches and a preview that INSERTS into the composer and never sends) and the build-prompt " +
      "capture flow.",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "pending-designer-layout",
    title: "The drag-and-drop LAYOUT designer",
    area: "sdk",
    status: "pending",
    on: "2026-08-06",
    what:
      "From the founding brief and never started: a designer that renders a module's CURRENT active " +
      "layout and edits it through property trees and drag-and-drop resizing, and that rolls a " +
      "layout for confirmation against seeded data before a module's final build. The colour/token " +
      "half of that brief shipped as the Theme Designer; the layout half has not.",
    where: ["INITIATION-PROMPT.md"],
    quote:
      "the sdk needs a powerful full token style and color theme designer and a drag and drop " +
      "layout designer… render a modules existing layout whichever layout is active in the module " +
      "at that time and edit it through property trees and drag and drop resizing"
  },
  {
    id: "pending-tutorials",
    title: "Per-module interactive documentation + video tutorials",
    area: "sdk",
    status: "pending",
    on: "2026-08-06",
    what:
      "Decided in the founding brief and not built: every module generates detailed interactive " +
      "documentation and video tutorials with checkpoints on how to build plugins, and every peeled " +
      "app ships several plugin templates each with its own documentation. The rendering model was " +
      "decided at the same time and still stands — tutorials are DATA ASSETS with video RENDERED " +
      "from them, never hand-recorded, because a recorded video goes stale the moment a module " +
      "rolls a new layout.",
    where: ["INITIATION-PROMPT.md", "PLANNING-STATE.md"]
  },
  {
    id: "pending-docengine",
    title: "The documentation engine",
    area: "sdk",
    status: "pending",
    on: "2026-08-06",
    what:
      "The reason AmberX-bound builds are BANNED from producing documentation (no build_log.mdx, no " +
      "IMPORT-NOTES, no docgen) — a new engine is coming and half-written docs in the old format " +
      "would have to be migrated. The fallback pattern if it never arrives is GizmoX's `/dox`: one " +
      "viewer, no registry, writing the file under `documentation/` IS the registration. Treat that " +
      "as the fallback, not a commitment. This page is a stopgap, not the engine.",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "pending-sdk-vision",
    title: "The rest of the SDK vision — agents, MCP, sessions, auth, hosting",
    area: "sdk",
    status: "pending",
    on: "2026-08-06",
    what:
      "From the founding prompt, none of it started: a complete Claude Code wrapper with integrated " +
      "session management, project management, agent/skills/tools management, an API, and MCP tool " +
      "server development and deployment; user account authorization inherited by peeled apps; a " +
      "desktop application and hosting at amberxai.com. `auth/session.ts` is a real store over a " +
      "STUB backend — 'local only' is a hardcoded label and nothing fakes a login.",
    where: ["INITIATION-PROMPT.md", "packages/core/src/auth/session.ts"]
  },
  {
    id: "pending-expenses-io",
    title: "Expense Tracker — save/load, reports in tabs, floating tabs",
    area: "modules",
    status: "pending",
    on: "2026-08-12",
    what:
      "Asked for at 23:45 on 2026-08-12 and in flight in a parallel session at the time this page " +
      "was written: save and load, import HTML, 'new report' opening in a new tab (the layout is a " +
      "tab group), open report from a saved directory, multi-select rows with delete from the " +
      "context menu or the Del key, find and import saved reports, undock a tab and float it as a " +
      "window, and an animated AmberX logo in the empty tab when the last tab is removed.",
    where: ["packages/studio/src/modules/expenses/"],
    route: "/expenses"
  },
  {
    id: "pending-amberart",
    title: "Import Logo Designer + AmberArt (and AmberArt's plugins)",
    area: "sdk",
    status: "pending",
    on: "2026-08-12",
    what:
      "Requested as a `.bmpx` to be authored — 'create bmpx to import logo designer, and amberart " +
      "along with the plugins for amber art'. No such project exists in `build/projects/` yet.",
    where: ["build/projects/"],
    route: "/buildmgr"
  },

  /* ═══════════════════════════════════════════════════ CANCELLED / REMOVED ══ */
  {
    id: "x-style-packs",
    title: "Style packages (the `style-package` asset kind)",
    area: "brand",
    status: "cancelled",
    on: "2026-08-12",
    what:
      "A pack kind that bundled a branding pack and a logo pack and declared that it OVERRODE both, " +
      "supplying a complete identity: palette, typography and shape. Four shipped (Signal, " +
      "Monolith, Vapor, Terra) plus `axs-artifact-style` and the house `axf-amber`.",
    why:
      "It could outrank the dials, which made a rolled theme change the values and not the pixels — " +
      "the owner's repeated report that a roll 'does nothing'. Deleted rather than deprecated so it " +
      "cannot grow back: the kind, the slot, the designer tabs, the API route, `styles.ts`, " +
      "`whitey.json` and `look-binding.ts` all went in one pass. Worth noting the path it took, " +
      "because it was reversed twice in one day: 13:24 'lets delete style packs entirely'; 13:33 " +
      "'no lets keep option 3 i like that i can ship style packs'; 17:02 'cancel all that last " +
      "stuff about style packs'; 17:42 the final call.",
    where: ["packages/core/src/brand/types.ts", "packages/core/src/theme/resolve.ts"],
    quote: "get rid of style packs entirely and just use branding packs"
  },
  {
    id: "x-brand-dials",
    title: "The `brandingPack` / `logoPack` theme dials (and the `brand` dial subsystem)",
    area: "theme",
    status: "cancelled",
    on: "2026-08-12",
    what: "Two text dials that let a theme name which packs draw, and a dial subsystem to hold them.",
    why:
      "Branding is a fixed APP SETTING — global, never rolled, never part of a theme, never in a " +
      "saved look. With packs demoted to a setting, a dial that selected one was a theme reaching " +
      "into a thing themes do not own. Pack selection lives only in `PackRegistry` now.",
    where: ["packages/core/src/theme/spec.ts"],
    quote: "branding is just that its not negotiable its global and does not change"
  },
  {
    id: "x-theme-lock",
    title: "The theme LOCK (lock / unlock on ThemeStore)",
    area: "theme",
    status: "cancelled",
    on: "2026-08-12",
    what:
      "A lock on the store that refused every mutation, added because 'hot render + no confirm step' " +
      "meant one roll could destroy an afternoon of hand edits with no undo.",
    why:
      "It was not merely redundant once Preview/Apply existed, it was ACTIVELY HARMFUL: eight " +
      "mutation paths — `setValue` included — returned early while a lock was held, so applying a " +
      "saved theme made every dial in the designer silently do nothing. A control that swallows " +
      "input without saying so is the failure mode this project keeps refusing to ship.",
    where: ["packages/core/src/theme/store.ts"],
    quote: "get rid of all that lock unlock shit"
  },
  {
    id: "x-claude-workspace",
    title: "Claude Workspace module + the Claude subsystem + Agent Forge",
    area: "sdk",
    status: "removed",
    on: "2026-08-10",
    what:
      "A browser Claude client mimicking the desktop app against the owner's subscription, with " +
      "Agent Forge ported in as a plugin. Partially built: `claudeBroker.ts` was copied in, a " +
      "streaming route existed at `app/api/claude/chat/`, and two real stream-json capture sets " +
      "were taken.",
    why:
      "Archived and deleted by `axf-mui` P0 — 'strip to the frame' — so the MUI rebuild would start " +
      "from the frame rather than from screens written against the token() era. Roughly $110 of " +
      "work built the same week went with it, and the owner chose it knowingly. The archive zip is " +
      "the ONLY copy: AmberX is not a git repository at that point in its history, so there is no " +
      "reflog and no checkout. The plan survived as `axf-claude.bmpx` and has since been built out " +
      "in full — P0–P4 on 2026-08-13 and P5 the same day, which is when Agent Forge finally " +
      "arrived as the PLUGIN this entry describes it as having been. The archive earned its keep: " +
      "the diff engine and Agent Forge's scan core were restored from it line for line.",
    where: ["assets/archive/build-archive/2026-08-09_19-15_axf-mui-v030-p0-prestrip.zip"],
    quote: "do everything to repair amberx to use mui… just fix the project i meant it to use mui"
  },
  {
    id: "x-diff-browser",
    title: "Difference Browser (the `/diff` plugin)",
    area: "sdk",
    status: "removed",
    on: "2026-08-10",
    what:
      "A multi-column history viewer — one column per `.history` snapshot, oldest left, live file " +
      "rightmost. N-way LCS alignment anchored on the NEWEST revision so the current document reads " +
      "top-to-bottom without holes, with two comparisons (vs previous, vs all earlier) because a " +
      "paragraph cut in rev 3 and pasted back in rev 5 reads as 'added' against rev 4 and is not new " +
      "to the document. Built and verified live; `.bmpx` still reads `built`.",
    why:
      "Deleted by the same `axf-mui` P0 strip. The design was the part worth keeping — the union " +
      "comparison is the insight, and it was written down here rather than only in the archive. " +
      "**IT CAME BACK on 2026-08-13** (`axf-claude` P5): the pure engine restored verbatim from " +
      "the archive, every screen rebuilt on MUI, `/diff` live again and the `.diff.` rule's stale " +
      "banner removed. See `plugin-diff-browser` under Features — this entry stays as the record " +
      "of the three days it did not exist.",
    where: ["build/projects/axf-diff-browser.bmpx", "GizmoX/.claude/rules/diff-browser-trigger.md"],
    quote:
      "open every instance of the file in the difference browser each in a consecutive fashion in " +
      "columns left to right left being first right being most recent"
  },
  {
    id: "x-sandbox",
    title: "/sandbox — the permanent dial playground",
    area: "chrome",
    status: "removed",
    on: "2026-08-10",
    what:
      "A live playground over every dial, generated from the spec — the first working " +
      "`store.setValue` designer surface — plus toolbar activation, a crash harness rendering real " +
      "boundary catches and the crash log, and a glyph grid. The owner had declared it a PERMANENT " +
      "fixture that persists to production as the full sandbox.",
    why:
      "Taken by the `axf-mui` P0 strip two days later, along with the sandbox wrappers. Its role " +
      "was largely absorbed: the Theme Designer's Dials tab is the generated-from-spec dial surface " +
      "now, and `/sandbox/panes` survives as the pane probe. The crash harness did not come back.",
    where: ["packages/studio/app/sandbox/panes/"],
    quote: "a permanent fixture in the repo that persists through to production"
  },
  {
    id: "x-gizmox-replica",
    title: "The GizmoX dashboard replica (`gizmox-replica`)",
    area: "chrome",
    status: "removed",
    on: "2026-08-10",
    what:
      "An exact replica of GizmoX's live dashboard — same free-placement grid, same twelve cards, " +
      "seeded where the backing module did not exist — built deliberately WITHOUT MUI on the " +
      "`token()` system.",
    why:
      "Deleted by the strip, and with it the token()-only exemption that existed for it. That " +
      "exemption's reasoning was correct and is worth keeping: a replica of GizmoX's dashboard built " +
      "by importing GizmoX's own kit proves nothing about AmberX's framework. The ERROR was " +
      "generalising it from one screen into a package-wide MUI ban that then got cited in later " +
      "prompts that had nothing to do with the replica.",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "x-p4-undo",
    title: "studio-shell-init P4 + P5, first attempt",
    area: "build",
    status: "cancelled",
    on: "2026-08-08",
    what:
      "P4 (the command bar + minimal command registry) was BUILT and its gate observed live — bar " +
      "active as the `app.banner` default, clock ticking, Modules menu from the live registry, " +
      "palette autofocus, reserved actions toasting — and P5's grid port was byte-verified " +
      "mid-port. Every file was then reverted and every gate re-run green at the P3 state.",
    why:
      "The owner interrupted mid-run: 'stop undo and leave complete at p3'. A scope and stopping " +
      "decision, NOT a defect — the design worked and was re-run later. Six findings from the " +
      "undone attempt were kept because they recur: the icon gate conflicts with the lockup " +
      "binding, the bar needs two icons the template lacks, `brand` items need an optional command, " +
      "`ModuleSpec` needs an optional glyph, `apply()` clears overrides on every roll, and " +
      "`NavRegistry` has no deactivate.",
    where: ["build/projects/studio-shell-init.bmpx"],
    quote: "stop undo and leave complete at p3"
  },
  {
    id: "x-merge",
    title: "The merge system (`.merge.`, `.merge all.`, and both ledgers)",
    area: "process",
    status: "cancelled",
    on: "2026-08-09",
    what:
      "A ceremony run at session end: snapshot every planning file, append the session's decisions, " +
      "sweep previous sessions for anything missed, open the diff browser, and maintain two ledgers " +
      "— `inotes.md` (session ↔ planning-state) and `archive state.md` (archive status per session).",
    why:
      "Retired by the owner one day after the ledger half was built, said while a `.merge.` was " +
      "actually running and honoured mid-procedure. `inotes.md` and `archive state.md` are FROZEN " +
      "records with retirement headers — no session registers as pending and nothing moves between " +
      "states. `PLANNING-STATE.md` remains the knowledge base; there is simply no ceremony and no " +
      "bookkeeping attached. `.newx.` (formerly `.amberx.`) and `.issues.` are the surviving triggers.",
    where: ["GizmoX/.claude/rules/merge-planning-state.md", "inotes.md", "archive state.md"],
    quote: "i dont want merge to be a thing anymore"
  },
  {
    id: "x-option-a",
    title: "Option A — `axf/` at the GizmoX root",
    area: "framework",
    status: "superseded",
    on: "2026-08-06",
    what:
      "A plain out-of-`src` directory at the GizmoX root with its own `@axf/*` tsconfig alias, " +
      "anchored by `axf/boundary.ts` which exported `IMPORTS_FROM_GIZMOX` — the port debt as a " +
      "countable number rather than an opinion. Built, and retired within the hour.",
    why:
      "The owner proposed better: build at AmberX's REAL paths with its own tsconfigs and no `@/*` " +
      "alias, so GizmoX is unreachable by RESOLUTION rather than by discipline, and the port becomes " +
      "a directory move instead of a rename sweep. The distinction the first recommendation had " +
      "blurred is the keeper: GizmoX as a BUILD ENVIRONMENT is a different thing from GizmoX as a " +
      "RUNTIME DEPENDENCY.",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "x-gizmox-packages",
    title: "`GizmoX/packages/` — the duplicate tree",
    area: "framework",
    status: "cancelled",
    on: "2026-08-07",
    what: "An arrangement that kept core and studio inside GizmoX and mirrored them across.",
    why:
      "Two copies of a live codebase drift, and they did — 12 files existed only in one, 11 more " +
      "differed, including `core/src/index.ts`. Mirroring is only safe for RECORDS, never for " +
      "source. Abandoned; the surviving copy is the one that runs.",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "x-workspaces",
    title: "Root npm workspaces",
    area: "framework",
    status: "cancelled",
    on: "2026-08-06",
    what: "Hoisting core and studio into a workspace root sharing one `node_modules`.",
    why:
      "Tried and reverted. GizmoX is itself a Next app at the repo root, so a nested app sharing its " +
      "node_modules cannot be told apart from it. `packages/studio` installs its own instead, and " +
      "`turbopack.root` is `packages/` — the repo root makes Next pick up GizmoX's `proxy.ts` and " +
      "`instrumentation.ts` as Studio's, which is real cross-contamination.",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "x-mui-icons",
    title: "@mui/icons-material",
    area: "brand",
    status: "cancelled",
    on: "2026-08-10",
    what: "The obvious icon source for an all-MUI app.",
    why:
      "PERMANENTLY excluded, and the reason is mechanical rather than aesthetic. A pack drawing " +
      "paints in `var(--axf-brand-*)`, which the style root republishes from the live theme — so a " +
      "roll repaints hundreds of glyphs with one style write and no re-render. A Material icon " +
      "paints a hex compiled into its own SVG; a theme can reach its `color` and nothing else, so a " +
      "two-tone or role-coloured mark would simply stop following the theme. Half the icons " +
      "following a roll and half not is worse than either. Enforced by `check:imports`, which names " +
      "it explicitly for both packages. The consequence, stated so it is a decision and not a " +
      "surprise: a name with no drawing means ADDING a glyph to the pack.",
    where: ["packages/studio/scripts/check-imports.mjs", "packages/core/src/brand/Glyph.tsx"]
  },
  {
    id: "x-cssvariables",
    title: "MUI `cssVariables` mode",
    area: "theme",
    status: "cancelled",
    on: "2026-08-10",
    what: "Mapping `--axf-*` onto MUI v9's CSS-variables mode instead of handing it resolved values.",
    why:
      "Rejected on a MEASUREMENT, not a preference: `createTheme({palette:{primary:{main:\"var(--axf-accent)\"}}})` " +
      "throws `MUI: Unsupported var(--axf-accent) color` — and throws the SAME error with " +
      "`cssVariables: true`, because that mode emits `--mui-*` as OUTPUT and must parse real colours " +
      "to do it. It would also create a second variable namespace carrying the same value from the " +
      "same source, and a roll would have to update both publication mechanisms in step — which is " +
      "the ordering race `resolve.ts` exists to have ended.",
    where: ["packages/core/src/theme/mui.ts", "packages/studio/test/mui-bridge.test.ts"]
  },
  {
    id: "x-react-error-boundary",
    title: "`react-error-boundary` (and a react-dom portal for the menu)",
    area: "framework",
    status: "cancelled",
    on: "2026-08-08",
    what: "Two third-party/dependency shortcuts for crash isolation and menu rendering.",
    why:
      "Core's boundaries are three declared tiers on `Slot` and `ModuleHost`, mutation-tested; a " +
      "third-party boundary component would add a dependency to EVERY peeled app to replace " +
      "something core already owns. The portal is the same shape of argument: it would make " +
      "`react-dom` a peer dependency of core, which declares only `react` on purpose. The menu is " +
      "`position: fixed` instead — valid because AppShell's root is a direct child of `<body>` with " +
      "no transform/filter/will-change, and THAT is the line that breaks if the shell grows one.",
    where: ["packages/core/src/shell/Boundary.tsx", "packages/core/src/ctx/ContextMenu.tsx"]
  },
  {
    id: "x-shift-rightclick",
    title: "Shift+right-click fall-through to the native Inspect menu",
    area: "framework",
    status: "cancelled",
    on: "2026-08-09",
    what:
      "An escape hatch, because 'a default context menu no matter where you click at all time' makes " +
      "the browser's own Inspect element unreachable.",
    why:
      "Offered and NOT added — awaiting the owner's call. It is recorded rather than silently " +
      "dropped because the consequence follows directly from a directive the owner gave, and " +
      "somebody will hit it and assume it is a bug.",
    where: ["packages/core/src/ctx/ContextMenuRoot.tsx"]
  },
  {
    id: "x-gizmox-chrome",
    title: "GizmoX's mandatory chrome contract on AmberX-bound work",
    area: "process",
    status: "cancelled",
    on: "2026-08-07",
    what:
      "Suis, `settings.ts`, context menus, toolbar assets, abbreviation registration and the rest of " +
      "`asset-types.md`'s mandatory-chrome list, which every GizmoX module must carry.",
    why:
      "Abandoned so AmberX can define its own contracts from the accumulated records in one pass, " +
      "rather than guessing a contract per build and reconciling later. Two carve-outs since: SUIS " +
      "are allowed MINIMALLY (a ceiling, not a target — none of GizmoX's settings contract comes " +
      "across: no chromeGroup(), no override cascade, no cui, no registerSettingsSource()), and " +
      "CONTEXT MENUS were built anyway at the owner's direction, so AmberX has its own contract for " +
      "that one item. The ban stands for everything still unspecified.",
    where: ["GizmoX/.claude/rules/amberx-bound-builds.md"],
    quote: "abandon all the required build stuff for gizmox modules like the sui, context menu, and all that other stuff"
  },
  {
    id: "x-docs-on-builds",
    title: "Documentation output on AmberX-bound builds",
    area: "process",
    status: "cancelled",
    on: "2026-08-06",
    what: "`build_log.mdx`, `terminal_output.txt`, `IMPORT-NOTES.mdx`, `documentation/` entries, `docgen`.",
    why:
      "Banned because a new documentation engine is coming and docs written in the old format would " +
      "have to be migrated. Raw `*.jsonl` build exhaust is still kept — that is a RECORD, not " +
      "documentation. Notes that would have gone in a build log go in the `.bmpx`'s own `notes` " +
      "array, which is data and ports with the project.",
    where: ["GizmoX/.claude/rules/amberx-bound-builds.md"]
  },
  {
    id: "x-module-list",
    title: "Importing GizmoX's 38-entry module list",
    area: "chrome",
    status: "cancelled",
    on: "2026-08-07",
    what: "The `MODULES` list behind GizmoX's Modules menu and Quick Launch tiles.",
    why:
      "'its stale anyways it will be populated later'. Quick Launch is seeded like any other card and " +
      "the Modules menu reads the LIVE registry, which is the better answer anyway. Cancelling it " +
      "also deleted a 21-icon drawing task that existed only to serve those entries. Those 38 " +
      "screens are, incidentally, a large part of why the 12-module cap exists.",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "x-untitled-logo",
    title: "The `untitled-logo-logo-pack` import",
    area: "brand",
    status: "cancelled",
    on: "2026-08-07",
    what:
      "A logo package that had appeared as an inventory line in at least six prior sessions, always " +
      "described as 'the logo-package', and never once opened.",
    why:
      "Cancelled on inspection. It is not GizmoX branding at all: it is a Logo Studio export of a " +
      "document named 'Untitled logo', whose wordmark renders the literal text UNTITLED LOGO, with " +
      "every colour baked as hex inside a gradient plus PNG/ICO raster — it would fail the " +
      "no-bare-hex assertion on its first entry. The GizmoX logos were already INSIDE `gizmox-brand` " +
      "(154 logo-family entries of its 453), so there was never a separate logo import to do.",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "x-animation",
    title: "Animated marks and animated logos",
    area: "brand",
    status: "cancelled",
    on: "2026-08-07",
    what:
      "`gizmox-brand` carries 28 `animated-logo` entries and the imported artifact had an animated " +
      "mark.",
    why:
      "Owner decision: the logo is STATIC on both wrappers. 'Do not wire motion in.' The one animated " +
      "mark in the staged artifact was made static in place. (The Amber house mark keeps ONE motion " +
      "use that predates this and was approved: the bead of resin at the apex of the A reappears as " +
      "the spinner, orbiting — so the loading state is the logo in motion.)",
    where: ["PLANNING-STATE.md"]
  },
  {
    id: "x-banner-default",
    title: "The three `banner-*` assets as the app.banner default",
    area: "chrome",
    status: "superseded",
    on: "2026-08-07",
    what: "Three banner candidates authored as the shell's default top bar.",
    why:
      "'Forget the banner that we made into a toolbar' — the GizmoX command bar replaced them as the " +
      "default. They stay REGISTERED on purpose, because three candidates are what makes hot-swap a " +
      "real operation rather than a claim, and they are what the `bannerBar` dial cycles through today.",
    where: ["packages/studio/src/toolbars/banners.ts"]
  },
  {
    id: "x-look-binding",
    title: "The console wrapper's `look-binding`",
    area: "chrome",
    status: "cancelled",
    on: "2026-08-12",
    what:
      "A binding that activated the console bar and nav, applied the artifact style package and set " +
      "three layout dials whenever the console wrapper became active — with a `LookReason` " +
      "(`boot` | `switch`) so it could tell a boot from a real user switch.",
    why:
      "Every writer it had is gone with the thing it wrote to: style packages no longer exist, and " +
      "the banner and menu are the theme's own `bannerBar` / `navMenu` dials. A wrapper " +
      "re-activating its own chrome on boot was a SECOND WRITER fighting the theme — the exact class " +
      "of bug the one-resolver rework exists to end.",
    where: ["packages/studio/src/dashboards/amberx-console.tsx"]
  },
  {
    id: "x-fable-all",
    title: "The `fable→all` model switch, as a habit",
    area: "build",
    status: "cancelled",
    on: "2026-08-09",
    what:
      "A Build Manager switch making EVERY step run on fable-5, honoured by the builder at the " +
      "`effective_model()` chokepoint.",
    why:
      "Under review and not to be used by default. The two builds that used it are the two most " +
      "expensive on record ($107.03 and $38.83), the one runaway that the token-velocity sentinel " +
      "had to kill happened on a fable-5 step, and it contradicts `model-selection.md` wholesale — " +
      "which reserves fable for AT MOST the single hardest long-horizon step per plan. The switch " +
      "itself still exists; the practice was stopped.",
    where: ["build/projects/", "GizmoX/.claude/rules/model-selection.md"]
  },
  {
    id: "x-cleanup-sweep",
    title: "Deleting all backup and git files from the GizmoX tree",
    area: "process",
    status: "cancelled",
    on: "2026-08-11",
    what: "A sweep to remove every backup and git file in GizmoX not belonging to the AmberX pre-build.",
    why: "Withdrawn by the owner mid-task — 'nevermind forget it'. Nothing was deleted.",
    where: [],
    quote: "nevermind forget ir"
  },
  {
    id: "x-theme-atlas",
    title: "`gizmox-theme-atlas` — staged, deliberately not built",
    area: "theme",
    status: "pending",
    on: "2026-08-07",
    what:
      "GizmoX's entire region/action contract as data, extracted from a published Artifact to a " +
      "263KB JSON: 41 uis, 224 regions, 511 actions, 182 tokens, 175 spec fields over 14 subsystems, " +
      "13 headline dials, 8 always-true rules.",
    why:
      "Held out of every build so far on purpose — it is the best available input to AmberX's " +
      "LAYOUT-THEME work, which is a later build, and folding it in early would have meant designing " +
      "against it before the engine existed.",
    where: ["assets/import/artifacts/gizmox-theme-atlas.json"]
  }
];

/* ══════════════════════════════════════════════════════════════ the chains ══ */

export interface ChainStep {
  readonly n: number;
  readonly title: string;
  /** File that does it. */
  readonly at: string;
  /** What it does. */
  readonly does: string;
  /** Dynamic data picked up AT this step — the thing a static diagram hides. */
  readonly picksUp?: string;
}

export interface Chain {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  /** The one thing that goes wrong if you get this chain wrong. */
  readonly failureMode: string;
  readonly steps: readonly ChainStep[];
  readonly gates?: readonly string[];
}

export const CHAINS: readonly Chain[] = [
  {
    id: "glyph",
    title: "A drawing reaches the screen",
    subtitle: "<Glyph id=\"icon-grid\" /> → an SVG painted in live theme colours",
    failureMode:
      "Hundreds of role-coloured SVGs that are CAPABLE of recolouring and never do, because nothing " +
      "publishes the roles. That is GizmoX's situation, and the brand bridge in `apply.ts` is the " +
      "entire difference.",
    steps: [
      {
        n: 1,
        title: "A surface names a CONTRACT ID",
        at: "any .tsx — <Glyph id=\"icon-grid\" />",
        does:
          "Surfaces reference template ids only — `icon-grid`, never `grid`. No name vocabulary, no " +
          "alias table, no fallback chain.",
        picksUp: "the id (authored, static)"
      },
      {
        n: 2,
        title: "The active packs are read as a SNAPSHOT",
        at: "brand/Glyph.tsx → useResolvedStyle()",
        does:
          "`useSyncExternalStore` over `PackRegistry` — not React state, because packs are registered " +
          "at boot by a subsystem, outside any component. Its third argument is `packs.serverResolved()` " +
          "(defaults only), so the server render and the hydrating client render agree by construction.",
        picksUp:
          "the branding + logo slot selection: localStorage `axf:packs@1`, the `axf_packs` cookie the " +
          "server reads, and the `PacksSeed` prop that carries it into the CLIENT module graph"
      },
      {
        n: 3,
        title: "Entries merge, logo over branding",
        at: "brand/packs.ts → PackRegistry.resolved()",
        does:
          "Branding entries first, logo entries second, so a logo pack's `mark` wins over the branding " +
          "pack's. A stored id whose pack was renamed or removed falls back to the app default AND is " +
          "named in `ResolvedStyle.unresolved` — because 'my identity silently reverted' is the " +
          "complaint that follows otherwise.",
        picksUp: "the merged entry map, and any unresolved id"
      },
      {
        n: 4,
        title: "The entry's inline SVG is prepared",
        at: "brand/Glyph.tsx",
        does:
          "`assertPackSvg` runs on every entry (the guard cannot be forgotten later). Hardcoded " +
          "`width`/`height` are stripped — they beat any container, so a lockup asked for 340px " +
          "rendered at 200px, silently. 100%/100% + preserveAspectRatio is set and height is derived " +
          "from the viewBox aspect. All of it WeakMap-memoised per entry.",
        picksUp: "the viewBox aspect, and the container size at render"
      },
      {
        n: 5,
        title: "The markup lands in the DOM",
        at: "dangerouslySetInnerHTML",
        does:
          "Safe for a checkable reason, not by assumption: pack markup is authored in this repo and " +
          "compiled in, never fetched, never user-supplied.",
        picksUp: "nothing — this is the boundary"
      },
      {
        n: 6,
        title: "The paint resolves against role variables",
        at: "the SVG's own fill/stroke: var(--gxb-accent, #ff7a1a)",
        does:
          "Every drawing references roles rather than literals. Changing the values repaints the whole " +
          "identity in ONE style write, with no component re-rendering to change colour.",
        picksUp: "ten role values — see the theme chain for where they come from"
      }
    ],
    gates: [
      "check:glyphs — every glyph id in the tree ⊆ the identity template (mutation-tested red on a bare `grid`)",
      "check:coverage — executes the SHIPPED pack modules; fails on incomplete coverage, bare paint hexes, or an unmeasurable required drawing",
      "check:brand — a live browser probe that a pack swap and a theme roll both repaint"
    ]
  },
  {
    id: "theme",
    title: "A theme reaches the screen",
    subtitle: "a six-character seed → 51+ CSS custom properties AND an MUI Theme",
    failureMode:
      "Two independent writers of one custom property. Which wins depends on which effect ran last, " +
      "so the same state produces different pixels depending on interaction history. Re-ordering the " +
      "effects only moves the race.",
    steps: [
      {
        n: 1,
        title: "A seed becomes values",
        at: "theme/generate.ts → rollTheme(seed, options)",
        does:
          "Mulberry32 from the seed; hue chosen from the seed with a varying harmony rule so " +
          "consecutive seeds are not four shades of the same blue. Contrast is CLAMPED against the " +
          "named dial, never re-rolled.",
        picksUp: "the seed, the mode (light/dark), and any roll options"
      },
      {
        n: 2,
        title: "The store decides preview vs applied",
        at: "theme/store.ts → ThemeStore",
        does:
          "A dial edit in the designer PREVIEWS: repaints the whole app, persists nothing. Apply " +
          "commits. A roll, a history step and applying a saved look commit on their own. " +
          "`serverState()` is what the server and the hydrating client both read.",
        picksUp:
          "localStorage `axf:theme@1` (seed + options + overrides), the `axf_theme` cookie, and the " +
          "hand overrides layered on top of the rolled values"
      },
      {
        n: 3,
        title: "ONE resolver composes theme and pack",
        at: "theme/resolve.ts → resolveVariables(values, packInput)",
        does:
          "`themeVariables()` publishes every dial through its declared `cssVar`; `derivedVariables()` " +
          "adds the computed ones; the brand bridge republishes the palette as `--axf-brand-*` AND " +
          "`--gxb-*`. Precedence, one sentence: the THEME owns every `--axf-*`; the PACK contributes " +
          "only its identity roles, and its surface roles are republished FROM the theme so a logo " +
          "drawn for one surface stays legible on whatever surface rolls.",
        picksUp: "48 dial values + the derived set + the active pack's identity palette"
      },
      {
        n: 4,
        title: "ONE publisher writes :root, diffed",
        at: "theme/ThemeBridge.tsx → AxfStyleRoot → publish.ts",
        does:
          "Written imperatively rather than as a `<style>` tag, so a change MUTATES existing properties " +
          "instead of swapping a stylesheet — the difference between the colours transitioning and the " +
          "page flashing through unstyled. Diffed: moving one dial writes one property, not 51.",
        picksUp: "the previous handle, so removals are removed rather than left stale"
      },
      {
        n: 5,
        title: "…and caches its answer for the NEXT document",
        at: "theme/boot.ts → THEME_VARS_KEY + themeSignature()",
        does:
          "The variables are the expensive part (seed → generator → spec → derivations → colour maths), " +
          "and a `<head>` script cannot run any of that. So the publisher leaves its answer behind, " +
          "SIGNED with the `{seed, options, overrides, packs}` it answered for. A signature mismatch " +
          "applies nothing — the failure mode of the optimisation is exactly the behaviour it replaces.",
        picksUp: "the pack selection, read as the same raw JSON the boot script reads"
      },
      {
        n: 6,
        title: "The same values become an MUI Theme",
        at: "theme/mui.ts → muiThemeFrom(values) → MuiBridge.tsx",
        does:
          "Consumes `themeVariables()` rather than re-reading dials, because the type ramp, shadow, " +
          "padding and selection colour are DERIVED — computing them twice is how a `<Paper>` ends up " +
          "a pixel off the card beside it. MUI needs RESOLVED hex: it runs `alpha()`, `darken()` and " +
          "`getContrastRatio()` over palette entries and throws on a `var()`.",
        picksUp: "nothing new — one derivation, two renderings"
      },
      {
        n: 7,
        title: "The correction is flushed BEFORE paint",
        at: "MuiBridge.tsx — a layout effect, not an ordinary update",
        does:
          "The hydrating render uses the DEFAULTS by design and matches the server byte for byte. " +
          "Adopting the persisted values as an ordinary (passive) update let the browser paint the " +
          "default-themed tree first — which is exactly the one-second flash. A layout effect is " +
          "flushed synchronously before paint. `token()` surfaces never flashed, because " +
          "`AxfStyleRoot` was already using one.",
        picksUp: "the live store value, read directly — `useTheme()` is still reporting the server snapshot at that moment"
      },
      {
        n: 8,
        title: "The SERVER renders from a cookie",
        at: "app/layout.tsx",
        does:
          "The last hole: emotion bakes literal hex into the SSR'd CSS and the browser paints it BEFORE " +
          "hydration, where no boot script can reach. So the applied theme mirrors to the `axf_theme` " +
          "cookie and the server renders both the `<head>` block and the SSR MUI palette from it. The " +
          "cookie tracks what is APPLIED, never what a designer is previewing.",
        picksUp: "the cookie, on the server, before any JS runs"
      }
    ],
    gates: [
      "check:rolls — 2000 rolls: 0 legibility failures, 1999 distinct accents, deterministic",
      "check:publish — proves the diff writes 1 property, not 51",
      "check:mui — a real browser: a roll moves an MUI component's computed colour",
      "test/theme-follows.test.ts — pins the hostile-pack case (a pack may not touch --axf-*)"
    ]
  },
  {
    id: "chrome",
    title: "A banner or a nav menu reaches the screen",
    subtitle: "a dial names an asset id; the asset owns arrangement; the host owns content",
    failureMode:
      "A bar that cannot show anything dynamic, or one carrying host-specific fields. The split — the " +
      "ASSET owns arrangement, the HOST fills named slots — is what avoids both.",
    steps: [
      {
        n: 1,
        title: "The theme names an asset",
        at: "theme/spec.ts → the `chrome` subsystem: bannerBar, navMenu",
        does:
          "Optionless TEXT dials, so `rollTheme` never randomises them — a roll must not swap your " +
          "banner for a stranger's. They are ordinary dials in every other respect, so they save with " +
          "a look and restore with it.",
        picksUp: "the applied values (not the previewed ones) via useAppliedThemeValues()"
      },
      {
        n: 2,
        title: "The registry resolves, with a FLOOR",
        at: "registries/surface.ts → toolbars.resolve / navs.resolve",
        does:
          "The registry default is the floor, so a stale id degrades to the default bar rather than a " +
          "blank banner. The dashboard registry goes further and reports the substitution on screen, " +
          "naming requested vs shown; late registration heals it with the stored preference intact.",
        picksUp: "which assets are registered right now — including custom ones loaded from the kv store"
      },
      {
        n: 3,
        title: "Custom assets arrive from the kv store",
        at: "chrome/store.ts + PacksSeed.tsx → data/axf/kv/local/chrome-assets.json",
        does:
          "Assets built in the designer's Toolbar / Nav-menu tabs are persisted WHOLE and validated " +
          "through `defineToolbar` / `defineNavMenu` on save AND on load — a corrupt doc fails at the " +
          "chokepoint rather than rendering a broken bar. `PacksSeed` carries the doc into the client " +
          "module graph, because a module singleton is not a channel between the two graphs; a PROP is.",
        picksUp: "the saved asset definitions"
      },
      {
        n: 4,
        title: "The renderer draws by item kind",
        at: "toolbar/Toolbar.tsx",
        does:
          "brand · label · divider · spacer · slot · action · status · menu · field. `field` renders as " +
          "a BUTTON styled as a field — a read-only input with onFocus re-opens the palette forever, " +
          "because MUI restores focus on dialog close. That trap was paid for once in GizmoX and is " +
          "documented at the type. Role decides the element: header / footer / div role=\"toolbar\", " +
          "and a rail is vertical with `aria-orientation`.",
        picksUp: "the host's named slot fills — a ticking clock, a sync label, a dock chip"
      },
      {
        n: 5,
        title: "Its glyphs resolve through the pack",
        at: "brand/Glyph.tsx",
        does: "Straight into the drawing chain — which is why a pack swap redraws the bar with no edit to it.",
        picksUp: "see the drawing chain"
      }
    ],
    gates: [
      "check:toolbar / check:dashboard — run the REAL chokepoints and watch their mutations go red on every run",
      "check:ui — no hand-rolled control where an MUI component exists; shell-owns-the-banner"
    ]
  },
  {
    id: "module",
    title: "A module renders — and then peels",
    subtitle: "declaration → registry → host → boundary → screen → standalone app",
    failureMode:
      "`boot()` on the server populates the SERVER's registry; the browser bundle evaluates @axf/core " +
      "separately and gets its own EMPTY one. A client `ModuleHost` then finds nothing. This will " +
      "recur for every registry the framework grows — design each one knowing there are two runtimes.",
    steps: [
      {
        n: 1,
        title: "Declare, in two halves",
        at: "modules/<id>/<id>.decl.ts + <id>.module.ts",
        does:
          "The DECL is data-only (`import type` only) so plain Node can read it — that is what lets the " +
          "closure resolver compute a peel without executing React. The MODULE half binds the component.",
        picksUp: "id, route, glyph, declared points, declared nav, declared menus"
      },
      {
        n: 2,
        title: "Register, on BOTH runtimes",
        at: "studio.subsystem.ts → registry.registerModule + BootedHost",
        does:
          "Boot runs on the server and again on the client from the same declaration, idempotently.",
        picksUp: "the live registry graph"
      },
      {
        n: 3,
        title: "Host resolves WITHOUT importing",
        at: "shell/ModuleHost.tsx",
        does:
          "`<ModuleHost id=\"demo\" />` looks the module up. That it does not import the component is " +
          "the whole point — it proves the registry does real work rather than decorating a direct " +
          "import. `buildmgr` is the counter-example that proves it matters: it was a working screen " +
          "for weeks that no registry could see, because its route imported it directly.",
        picksUp: "nothing — resolution is the step"
      },
      {
        n: 4,
        title: "Boundaries wrap the chokepoints",
        at: "shell/Boundary.tsx",
        does:
          "Module tier inside `ModuleHost`, contribution tier inside `Slot`, app tier at the shell. On " +
          "the chokepoints so a module author cannot forget. A contribution must be invoked INSIDE a " +
          "child component — `<Boundary>{render(payload)}</Boundary>` evaluates during the PARENT's " +
          "render, above a boundary that has not mounted, and the throw escapes upward.",
        picksUp: "the crash log; the retry attempt number, which must remount via key={attempt}"
      },
      {
        n: 5,
        title: "Contributions fill the declared points",
        at: "shell/ModuleHost.tsx → <Slot point=\"demo.panel\" />",
        does: "Ordered by the point's declared ordering; refused at registration if the payload does not satisfy the point.",
        picksUp: "every registered contribution targeting that point"
      },
      {
        n: 6,
        title: "Peel computes the closure",
        at: "scripts/peel.mjs → scripts/lib/closure.mjs",
        does:
          "module → its points → their contributions → their deps. Plus `ClosureSource`s, so `ctx` can " +
          "answer 'which menu rows travel with this module' without the registry knowing anything about menus.",
        picksUp: "the module's declared nav and ctx areas, recorded into peel.manifest.json"
      },
      {
        n: 7,
        title: "…and vendors an app that boots itself",
        at: "the generated app",
        does:
          "A vendored copy of core (72 files), the plugins, and a generated `package.json` whose deps " +
          "come FROM core's peerDependencies — which is why every peeled app inherited MUI the day core " +
          "did, with no edit to the generator. `/api/health` reports declared vs active and gates `ok` on it.",
        picksUp: "core's peer list, at generation time"
      }
    ],
    gates: [
      "the peel gate (axf-framework-gaps F1) — 'if that is green, the whole model works; if it is not, nothing else is trustworthy'",
      "check:suite — the resolved suite artifact fails when stale",
      "check:isolation — the boundary tiers"
    ]
  },
  {
    id: "ctx",
    title: "A right-click composes a menu",
    subtitle: "one document listener → an area PATH → declared items → a placed menu",
    failureMode:
      "Forty modules each hand-writing a `useCtx` handler. The menus were never bad — the COVERAGE was " +
      "inconsistent, because a habit has holes.",
    steps: [
      {
        n: 1,
        title: "ONE listener, mounted by the shell",
        at: "ctx/ContextMenuRoot.tsx (mounted in AppShell)",
        does: "Every route gets a menu without any surface opting in. Coverage cannot be forgotten.",
        picksUp: "the event, the target element, the click point"
      },
      {
        n: 2,
        title: "Walk up collecting areas",
        at: "ctx/areas.ts → resolveAreaPath",
        does:
          "Collects `data-axf-area` into a PATH (`cell` → `row` → `table` → `module:x` → `shell`), capped " +
          "at the nearest 4 contributing areas. Areas are DECLARED as well as marked, which costs one " +
          "line and buys two things a marker alone cannot: the manager gets a real list instead of a " +
          "guess, and a typo'd marker becomes a warning rather than an invisible menu.",
        picksUp: "every `data-axf-*` attribute up the chain, harvested into MenuContext.data"
      },
      {
        n: 3,
        title: "Each area contributes its declared items",
        at: "ctx/map.ts → MenuMap.itemsFor",
        does:
          "Items are DATA naming a command and predicates BY NAME — no inline closures, which is what " +
          "makes the map editable by a UI. The human edits overlay applies ON READ, so dropping the " +
          "overlay restores the defaults exactly.",
        picksUp: "the edits overlay; the area's group, for ordering"
      },
      {
        n: 4,
        title: "The universal band is appended",
        at: "ctx/universal.ts",
        does:
          "Copy value / Copy path / Inspect / Reload, plus the default menu's own rows: a header naming " +
          "the target, Cut/Copy when text is selected, Paste when the SYSTEM clipboard has text (so " +
          "content copied from any app counts), and Sign in / Sign out in `--axf-err`. Declared as an " +
          "area the engine appends, not a hard-coded block.",
        picksUp: "the selection, `navigator.clipboard.readText()`, and the session store's login state"
      },
      {
        n: 5,
        title: "Predicates decide presence and availability",
        at: "ctx/predicates.ts → compose.ts",
        does:
          "`when` decides whether the row is there at all; `enabledWhen` returns the REASON it does not " +
          "hold, and that string renders beside the greyed label. There is no bare `disabled` boolean.",
        picksUp: "the resolved MenuContext"
      },
      {
        n: 6,
        title: "Place, flip and clamp",
        at: "ctx/place.ts",
        does:
          "A menu opened near the bottom-right flips fully on screen — measured live: a right-click at " +
          "(1276,716) placed the menu at (1024,576).",
        picksUp: "the viewport size at the moment of the click"
      },
      {
        n: 7,
        title: "Run by name",
        at: "core/commands.ts, with activeContext() parked",
        does:
          "The handler reads `ctx.data.expense` (or whatever the surface marked) rather than receiving " +
          "props — which is why the same command works from a menu and from a palette.",
        picksUp: "the harvested data attributes"
      }
    ],
    gates: [
      "test/ctx-conformance.test.ts — DISCOVERING in both directions: a marker nobody declared is an invisible menu, an area nobody marks is a menu nobody can open"
    ]
  },
  {
    id: "build",
    title: "A build runs",
    subtitle: "a .bmpx plan → a python builder → real code on disk → an archive",
    failureMode:
      "Two builders on one plan. Process listing is NOT how you decide what is a duplicate — a run's " +
      "process tree contains python CHILDREN with builder-matching command lines, and killing the " +
      "'duplicate' killed the run. The RUN LOCK answers it authoritatively.",
    steps: [
      {
        n: 1,
        title: "The plan is the interface",
        at: "build/projects/<id>.bmpx",
        does:
          "Phases and steps, each with its own model, plus a `notes` array that is the ONLY record of " +
          "why the decisions were made. The UI is an accelerator for the three things done often; " +
          "anything touched monthly is a text edit with a validator rather than a panel.",
        picksUp: "model switches stored as plan data, never React state — so what a badge shows is what a runner reads"
      },
      {
        n: 2,
        title: "The UI spawns the real builder",
        at: "app/api/bmpx/run/route.ts",
        does:
          "`bmpx_builder.py` from the GizmoX venv, `--control-file` always, sentinel armed, dry adds " +
          "`--no-archive`, REAL adds `--confirm-real` and needs a confirming second click.",
        picksUp: "the effective model per step, resolved once per run at the effective_model() chokepoint"
      },
      {
        n: 3,
        title: "Locks make concurrency safe",
        at: "bmpx_builder.py + server/bmpxLocks.ts",
        does:
          "A RUN lock `<file>.bmpx.running` for the whole run, staleness by PID LIVENESS never by age; " +
          "a WRITE lock around every read-modify-write; atomic writes (tmp + replace) everywhere, so a " +
          "killed writer can never leave truncated JSON. The switches and update routes REFUSE writes " +
          "while a run is live, because the builder is the single writer.",
        picksUp: "the holding PID, named in the refusal"
      },
      {
        n: 4,
        title: "Events stream; the UI hot-renders",
        at: "logs/build/<id>/ui-run-<stamp>.events.ndjson",
        does:
          "stdout NDJSON tees to a file; GET serves it incrementally BY BYTE OFFSET. The session IS the " +
          "events file, so leaving the screen and coming back replays from byte 0 and resumes polling. " +
          "Liveness is the in-memory child OR the latest-run pointer plus file freshness — a dev-server " +
          "reload cannot orphan a run invisibly.",
        picksUp: "step/phase completion, cost events, the archive path"
      },
      {
        n: 5,
        title: "The builder alone writes the result",
        at: "bmpx_builder.py",
        does:
          "Done-flags and the cost ledger are the BUILDER's to write; the UI never writes run results. A " +
          "dry run writes nothing at all — which is why a dry run used to leave the plan LOOKING built, " +
          "and why all run-derived decoration is now dropped ten seconds after a dry run exits.",
        picksUp: "actual cost per group"
      },
      {
        n: 6,
        title: "Archive and register",
        at: "build/archive/<stamp>_<name>/ + assets/archive/<type>/<id>.zip",
        does:
          "Verified readable BEFORE any deletion — that was the MUI strip's gate, and it is why $110 of " +
          "deleted work is a decision rather than a loss.",
        picksUp: "the archive name, from the `archived` event"
      }
    ],
    gates: [
      "Known gap: a sentinel kill does NOT bill into the cost ledger — the runaway group logged cost null while real spend was higher than the file says by exactly the amount hardest to see"
    ]
  }
];

/* ════════════════════════════════════════════════════════════════ tutorials ══ */

export interface TutorialStep {
  readonly title: string;
  readonly body: string;
  readonly code?: string;
}

export interface Tutorial {
  readonly id: string;
  readonly title: string;
  readonly forWhom: string;
  readonly minutes: number;
  readonly route?: string;
  readonly steps: readonly TutorialStep[];
  /** The mistake this tutorial exists to stop you making. */
  readonly trap: string;
}

export const TUTORIALS: readonly Tutorial[] = [
  {
    id: "add-dial",
    title: "Add a theme dial",
    forWhom: "anyone adding a new themeable value",
    minutes: 5,
    route: "/theme-designer",
    trap:
      "A NUMBER dial with no `unit`. The applier builds every number as `${raw}${unit}`, so it " +
      "publishes the string \"4undefined\" — which is not a CSS error. The browser DISCARDS the " +
      "declaration and the property silently keeps its old value, so the dial simply appears to do " +
      "nothing. `NumberDial.unit` is required and documents `\"\"` for a bare number, so TypeScript " +
      "catches it; the applier also carries a `?? \"\"` runtime backstop for a JS caller or an `as` cast.",
    steps: [
      {
        title: "1 · Add ONE entry to DIALS",
        body:
          "That is the whole edit. The generator rolls it, the applier publishes it, and the designer " +
          "renders a control for it — all three read this list.",
        code:
          "// packages/core/src/theme/spec.ts\n" +
          "{\n" +
          "  id: \"cardGap\",\n" +
          "  subsystem: \"layout\",\n" +
          "  label: \"Card gap\",\n" +
          "  effect: \"Space between cards on a module's grid.\",\n" +
          "  cssVar: \"--axf-card-gap\",\n" +
          "  kind: \"number\",\n" +
          "  unit: \"px\",        // \"\" for a bare number — REQUIRED, see the trap\n" +
          "  min: 4,\n" +
          "  max: 28,\n" +
          "  step: 2,\n" +
          "  default: 12\n" +
          "}"
      },
      {
        title: "2 · Read it",
        body:
          "From CSS with `var(--axf-card-gap)`. From JS with `useTheme().values.cardGap` — but only " +
          "when the value is not ONLY a CSS value. The dashboard's column count is read as a JS number " +
          "because `resolvePlacements`, `moveCard` and `resizeCard` do integer placement math against " +
          "it; if CSS read the variable while the math kept a constant, a roll would place cards into " +
          "columns the grid does not have."
      },
      {
        title: "3 · Watch the gate cover it automatically",
        body:
          "`test/module-layout-roll.test.ts` is DISCOVERING — it walks `DIALS`, so your dial is covered " +
          "with no edit. It asserts no published variable ever contains `undefined` or `NaN`, that a " +
          "roll actually VARIES the dial (a dial the generator never moves is themeable in principle " +
          "and constant in practice), and that rolled values stay inside their bounds.",
        code: "cd packages/studio && npm test && npm run check:rolls"
      }
    ]
  },
  {
    id: "derived-token",
    title: "Add a derived token",
    forWhom: "when a value is COMPUTED from dials rather than set",
    minutes: 4,
    trap:
      "Putting it in the applier. That block is the exact thing that stops a theme engine scaling: " +
      "adding a token meant editing the applier, so the applier grew a branch per token and became the " +
      "file nobody wants to touch. GizmoX's engine reached ~175 fields that way.",
    steps: [
      {
        title: "1 · One entry in DERIVED",
        body:
          "`from` is not decoration — it is the dependency list, so a surface can show what a token is " +
          "computed FROM and a future incremental publisher can skip tokens whose inputs did not change.",
        code:
          "// packages/core/src/theme/derived.ts\n" +
          "{\n" +
          "  cssVar: \"--axf-card-pad\",\n" +
          "  from: [\"density\", \"radius\"],\n" +
          "  note: \"Card padding follows density; derived so it cannot drift from row height.\",\n" +
          "  compute: (v) => DENSITY_PAD[String(v.density)] ?? DENSITY_PAD.normal\n" +
          "}"
      },
      { title: "2 · There is no step 2", body: "The applier loops. Nothing else changes." }
    ]
  },
  {
    id: "brand-pack",
    title: "Author a branding pack",
    forWhom: "designers replacing the identity",
    minutes: 45,
    route: "/brand",
    trap:
      "Bare hex. A colour compiled into the SVG is a colour no theme can reach, and the import script " +
      "and CI both refuse it. Draw in role variables with the shipped colour as the FALLBACK: " +
      "`fill=\"var(--gxb-accent, #ff7a1a)\"`.",
    steps: [
      {
        title: "1 · Work to the contract",
        body:
          "34 required ids with exact geometry, measured off the running registry — not invented. The " +
          "hard ones: `mark` 24×24 must still read at 16px; `lockup` is 200×32 (6.25:1); `wordmark` is " +
          "160×32 (5:1); the 20 contract icons are 24×24 and render as small as 13px. A replacement " +
          "lockup drawn 1:1 does not fit a 6.25:1 slot — it letterboxes or crops, and no CSS rescues a " +
          "drawing whose proportions are wrong. `BRAND-PACK-TEMPLATE.md` is the full table."
      },
      {
        title: "2 · Paint through roles",
        body:
          "Ten roles: accent, accent2, accent3, ink, dim, edge, page, ok, warn, err. Both variable " +
          "families are published with the same value, so a pack authored for GizmoX drops in unchanged.",
        code:
          "<path d=\"...\" fill=\"var(--gxb-accent, #ff7a1a)\" />\n" +
          "<path d=\"...\" stroke=\"var(--axf-brand-ink, #f4efe7)\" />"
      },
      {
        title: "3 · Register it and read the coverage card",
        body:
          "`checkCoverage()` REPORTS rather than throws — a 90%-complete pack is exactly when you most " +
          "want to look at it. It names `missingRequired`, `wrongAspect`, `extra`, and `uncheckable` " +
          "(a required id supplied without measurable SVG, which used to pass in silence).",
        code: "cd packages/studio && npm run check:coverage && npm run check:glyphs"
      },
      {
        title: "4 · Select it",
        body:
          "At `/settings`, and nowhere else. Branding is a fixed app setting: a theme cannot name a " +
          "pack, a roll cannot change one, a saved look neither records nor restores one."
      }
    ]
  },
  {
    id: "chrome-asset",
    title: "Build a banner and put it in a theme",
    forWhom: "anyone shaping the shell",
    minutes: 15,
    route: "/theme-designer",
    trap:
      "A `field` item drawn as a real `<input>`. A read-only input with `onFocus` re-opens the command " +
      "palette FOREVER, because MUI restores focus when a dialog closes. The kind renders as a BUTTON " +
      "styled as a field, and the trap is documented at the type because it was paid for once already.",
    steps: [
      {
        title: "1 · Open the Toolbar tab",
        body:
          "It builds real `toolbar` assets. Items are the nine kinds; brand items pick their logo from " +
          "the branding pack's own drawings, so the bar redraws when the pack changes."
      },
      {
        title: "2 · Save",
        body:
          "The asset is validated through `defineToolbar` on save AND again on load, then persisted " +
          "whole in the kv doc `data/axf/kv/local/chrome-assets.json` and re-registered into the client " +
          "graph by `PacksSeed`."
      },
      {
        title: "3 · Select it into the theme",
        body:
          "The `bannerBar` dial. It is an ordinary dial, so it saves with a look and restores with it — " +
          "but it is OPTIONLESS text, so a roll never randomises it. `navMenu` is the same for menus."
      },
      {
        title: "4 · Apply",
        body:
          "The header's one 'Apply to app' commits. Until then everything you are looking at is a " +
          "preview that repaints the app and persists nothing."
      }
    ]
  },
  {
    id: "ctx-menu",
    title: "Give a surface a context menu",
    forWhom: "module and plugin authors",
    minutes: 10,
    route: "/expenses",
    trap:
      "Marking a `data-axf-area` that no decl declares. The conformance gate is DISCOVERING in both " +
      "directions — a marker nobody declared is an invisible menu, and an area nobody marks is a menu " +
      "nobody can open — so it fails either way.",
    steps: [
      {
        title: "1 · Declare the areas and the rows, as data",
        body: "In your `<id>.decl.ts`, which is `import type` only so plain Node can read it.",
        code:
          "menus: {\n" +
          "  areas: [{ id: \"expenses.expense\", title: \"Expense\" }],\n" +
          "  items: {\n" +
          "    \"expenses.expense\": [\n" +
          "      { id: \"copy-line\", label: \"Copy as a line\", command: \"expenses.expense.copy-line\", order: 60 },\n" +
          "      { id: \"sep\", label: \"\", role: \"separator\", order: 70 },\n" +
          "      { id: \"delete\", label: \"Delete expense\", command: \"expenses.expense.delete\", role: \"danger\", order: 80 }\n" +
          "    ]\n" +
          "  }\n" +
          "}"
      },
      {
        title: "2 · Register the commands BEFORE the menus",
        body:
          "The map's gate refuses an item naming an unregistered command — which is what makes a typo a " +
          "loud boot failure rather than a dead row. `test/ctx-conformance.test.ts` asserts this ORDERING " +
          "by source index, not merely that both calls exist.",
        code:
          "// studio.subsystem.ts, in start()\n" +
          "registerExpensesCommands();\n" +
          "for (const mod of [/* … */ EXPENSES_DECL]) registerModuleMenus({ id: mod.id, menus: mod.menus });"
      },
      {
        title: "3 · Mark the DOM",
        body:
          "The screen's whole part. Any `data-axf-*` attribute up the chain is harvested into " +
          "`MenuContext.data`, which is how the handler knows WHICH row you right-clicked.",
        code: "<TableRow data-axf-area=\"expenses.expense\" data-axf-expense={expense.id}>"
      },
      {
        title: "4 · Read the click in the command",
        body: "Not from props — from the parked context, so the same command works from a palette.",
        code:
          "const id = activeContext()?.data?.expense ?? null;\n" +
          "const expense = id ? expenseStore.get(id) : undefined;"
      }
    ]
  },
  {
    id: "add-module",
    title: "Add a module",
    forWhom: "when a plugin genuinely will not do",
    minutes: 60,
    route: "/demo",
    trap:
      "Importing the component directly from its route page. That is exactly how the Build Manager " +
      "spent weeks as a working screen that no registry could see — no peel closure, no inspector " +
      "count, and nothing for `ModuleDecl.menus` to attach to.",
    steps: [
      {
        title: "0 · First: should it be a module at all?",
        body:
          "The default answer is NO. It must own state or a workflow nothing else owns, cohere as a " +
          "peeled standalone app, and be IMPOSSIBLE as a plugin or extension on an existing module's " +
          "declared points. Failing the third is the common case and the correct outcome is a plugin. " +
          "The cap is 12 and 5 are used; the thirteenth REPLACES one, it does not join it."
      },
      {
        title: "1 · Three files",
        body:
          "`<id>.decl.ts` (data only — no runtime imports, the closure resolver reads it under plain " +
          "Node), `<id>.module.ts` (`defineModule`, binds the component), and the component itself."
      },
      {
        title: "2 · Compose it in the subsystem",
        body:
          "Register the module, register its commands, then register its menus — in that order. The " +
          "menus loop stays a LOOP even at one member, because the conformance test reads that exact " +
          "shape to learn which decls the host registers."
      },
      {
        title: "3 · Add it to the suite manifest",
        body:
          "One line in `SUITE.modules`. The resolver reads `src/modules/*` off disk and fails on drift " +
          "in EITHER direction, so the manifest and the directory cannot disagree.",
        code: "cd packages/studio && npm run suite && npm run check:suite && npm test"
      },
      {
        title: "4 · Prove it peels",
        body: "The gate that matters. If this is green the whole model works; if it is not, nothing else is trustworthy.",
        code: "npm run peel <id>"
      }
    ]
  },
  {
    id: "run-build",
    title: "Run a build",
    forWhom: "the owner",
    minutes: 20,
    route: "/buildmgr",
    trap:
      "Starting a plan whose steps are marked done but whose OUTPUT was deleted. `pending_steps()` " +
      "filters on the per-STEP `done` boolean and both call sites hardcode `only_pending=True`, so no " +
      "code path re-runs a done step — the run would skip almost everything and report success. That " +
      "is exactly `axf-claude`'s state. Reset the flags first. Related: a phase's `status` string is " +
      "DISPLAY METADATA and is routinely stale — 67 phases across every `.bmpx` on disk once read " +
      "`todo` while every step under them was done. Never read `status` as truth; count the steps.",
    steps: [
      {
        title: "1 · Dry first",
        body:
          "A dry run writes NOTHING to the `.bmpx`. Every checkmark you see after one comes from the " +
          "in-memory overlay, and all run-derived decoration is dropped ten seconds after it exits so " +
          "the screen renders the FILE again. The log lines and the cost stay — they are the " +
          "rehearsal's output."
      },
      {
        title: "2 · Check the model switches",
        body:
          "They are stored as PLAN DATA, never React state, so what the badges show is what a runner " +
          "reads. `fable→all` is under review: the two builds that used it are the two most expensive " +
          "on record and the one runaway happened on a fable step."
      },
      {
        title: "3 · Real needs two clicks",
        body:
          "And it takes the RUN LOCK. If it refuses, read the holder's PID from the message rather than " +
          "looking at the process list — a run's process tree contains python children with " +
          "builder-matching command lines, and killing the 'duplicate' kills the run."
      },
      {
        title: "4 · Watch the ledger, not the total",
        body:
          "A sentinel kill does NOT bill into the cost ledger: the runaway group logged `cost_usd: null` " +
          "and the run logged `actual_usd: 0.0`, so real spend is higher than the file says by exactly " +
          "the amount that is hardest to see."
      }
    ]
  }
];

/* ═════════════════════════════════════════════════════════════════ timeline ══ */

export interface Day {
  readonly date: string;
  readonly headline: string;
  readonly what: readonly string[];
  readonly quote?: string;
  /** Sessions that worked in the tree that day, as counted from the transcripts. */
  readonly sessions: number;
}

export const TIMELINE: readonly Day[] = [
  {
    date: "2026-08-05",
    headline: "Two threads raised and dropped — both still open",
    sessions: 39,
    what: [
      "'Module independence from core' put the exact fork AmberX would later resolve: a vendored self-contained export, or an `@gizmox/core-lite` workspace package. The owner held off. The answer reached since resolves BOTH branches rather than picking one — peels are vendored AND the framework lives in real workspace packages.",
      "'Applications asset type' — the owner began defining a new asset kind and the prompt was cut off before the compile target was stated. Never finished, never carried into the taxonomy.",
      "That session also measured GizmoX's generated theme spec at 3,562 lines — the scale AmberX is deliberately not starting at."
    ]
  },
  {
    date: "2026-08-06",
    headline: "The project is defined, and the isolation strategy is chosen",
    sessions: 3,
    quote:
      "im just hoping you know what you are doing and we have everything decided to protect me before " +
      "we start building. thats why i wasted thousands of dollars building gizmox by the seat of my " +
      "pants its all polluted and bloated and modules cross contaminate each other with bugs",
    what: [
      "The founding brief: an SDK on a custom framework, built at the same time, producing modules that PEEL into standalone apps that inherit the environment, theme/layout/style engine, assets engine and auth.",
      "`INITIATION-PROMPT.md`, `PLAIN-ENGLISH.md` (with a coverage map, because the first draft silently dropped seven sections), and the 12-module cap as §4.6.",
      "Option A (`axf/` at the GizmoX root) built and RETIRED within the hour on the owner's better proposal — build at AmberX's real paths so GizmoX is unreachable by RESOLUTION, not by discipline.",
      "Three standing directives recorded: mirror every build record, no GizmoX chrome, no documentation."
    ]
  },
  {
    date: "2026-08-07",
    headline: "The engines land — theme, packs, toolbars — and the two-publisher race is found",
    sessions: 5,
    quote: "no part of a ui can be hand rolled including assets. no ui asset can be hand rolled",
    what: [
      "The pack layer, the theme engine (dials as data, derived as data, seeded generator, diffed publisher), and the `toolbar` asset kind.",
      "The two-publisher race found by TESTING an assumption during a sweep: roll and it shows, reload and the pack wins. Same state, different pixels depending on interaction history.",
      "Two silent defects found by looking rather than assuming: `checkCoverage()` was exported and called by NOTHING, and `panel`/`panel2` were never re-derived from an active pack — so every card in the app rendered as a near-white slab under a near-black page, under all five packs, with the legibility check passing the whole time because it only knew about two of the four surface tokens.",
      "The Difference Browser built. The house brand `axf-amber` authored: a bead of resin at the apex of an A, with three candidate marks rejected for having a second reading — a stone with an X is a close button, with a slash a prohibition sign, with a dot a radio button. A mark that reads as a control is a mark people click.",
      "New direction: the Studio shell is a REPLICA of GizmoX's dashboard and command bar."
    ]
  },
  {
    date: "2026-08-08",
    headline: "Crash isolation, the nav kind, the shell — and P4 built then undone",
    sessions: 8,
    quote: "stop undo and leave complete at p3",
    what: [
      "Crash isolation built by a Fable session from scratch, after an Opus attempt was deliberately reverted so the design would genuinely be Fable's.",
      "The glyph-rendering documentation: 7 interactive pages, MDX mirrors, generated glyph data.",
      "`nav-menu` asset kind, 41 dials (+12), `AppShell` (every route is a testing surface), `/sandbox`.",
      "The brand import lands: 453 gizmox-brand entries + Amber's contract overlay = exactly 467, and the merge module THROWS on a wrong total.",
      "studio-shell-init P0–P3 run and marked done; P4 built and verified, then rolled back file-by-file on the owner's order. Six findings from the undone attempt were kept because they will recur.",
      "The Build Manager becomes real: model badges, status badges, hot-rendered progress, write-once-at-stop."
    ]
  },
  {
    date: "2026-08-09",
    headline: "The busiest day: the shell ships, framework-gaps ships, context menus land, the merge system dies",
    sessions: 30,
    quote: "i dont want merge to be a thing anymore",
    what: [
      "studio-shell-init P0–P9 runs for real end to end: 9 groups, all ok, $104.47, core 0.0.10, the replica landing page live.",
      "The Build Manager runs REAL builds; the `.bmpx` lock protocol lands after a concurrent-run scare, all of it mutation-tested.",
      "`axf-framework-gaps` BUILT — but it took four runs, one of which was a runaway killed by the token-velocity sentinel, and the planning state did not know about any of them.",
      "The finding that a sentinel kill does NOT bill into the cost ledger: real spend is higher than the file says by exactly the amount hardest to see.",
      "core 0.0.12 — the always-on default context menu. core 0.0.13/0.0.14 — module-declared nav and module-declared menus.",
      "The session-context system (`.amberx.`, two ledgers) built in the morning and HALF RETIRED the same evening: the merge system was killed while one was actually running, and honoured mid-procedure."
    ]
  },
  {
    date: "2026-08-10",
    headline: "AmberX moves to MUI — and the strip",
    sessions: 8,
    quote: "oh fuck i want mui in amberx! fuck! can we fix that now",
    what: [
      "The no-MUI rule is reversed. It had always been about ONE surface — the GizmoX replica, where a replica built by importing the original proves nothing — and had been generalised into a package-wide ban that then got cited in prompts about unrelated things.",
      "Core declares MUI and Emotion as PEER dependencies (two Reacts or two Emotion caches is the classic silent failure), and the peel derives every generated app's deps from those peers.",
      "`axf-mui` P0 archives and deletes taskman, claude-workspace + the claude subsystem, agent-forge, diff-browser, sandbox, demo, demo-badge, the dashboard module, gizmox-replica and sandbox-wrappers. AmberX is not a git repo — the archive zip is the only copy.",
      "The theme flash: one symptom, three causes. The third is the general one — a module singleton is NOT a channel between the server and client module graphs; a PROP is."
    ]
  },
  {
    date: "2026-08-11",
    headline: "The port, the layout roll, and pack persistence",
    sessions: 8,
    quote: "cut off gizmox stop using its core entirely. transfer all work to amberx and move the root out of prebuild",
    what: [
      "THE PORT: `mv pre-build/* ../`. `pre-build/` no longer exists, and a `pre-build/` directory REAPPEARING is now the thing that means something went wrong. Worth one warning: with the move in flight, three independent tools all agreed `packages/core` was 'gone' because all three were looking at the old path. That reads exactly like a catastrophic deletion and is not one.",
      "A rolled theme now rearranges a MODULE: five dials for a module's interior, and no applier edit was needed — the first time the dials-as-data property was exercised by someone who had not written it.",
      "Pack selection PERSISTS, via two tiers of activation.",
      "`SurfaceRegistry` — three structurally identical registries collapsed into one primitive, after the owner asked why there were five.",
      "The 'axf-mui will strip the tree again' hazard is disproven: resume is driven by per-STEP `done` booleans, not by the phase `status` string, and all 27 steps were already done. A phase status is display metadata and is routinely stale.",
      "Taskman restored and rebuilt on MUI; the Build Manager PROMOTED to a registered module; 22 session archives written and mirrored."
    ]
  },
  {
    date: "2026-08-12",
    headline: "Style packs deleted, branding demoted to a setting, the theme engine reworked",
    sessions: 6,
    quote:
      "fix theme designer its a fuckin mess… get rid of style packs entirely and just use branding " +
      "packs… branding pack should not change as part of the theme! its fixed! its a setting not " +
      "something rollable!",
    what: [
      "Style packages DELETED framework-wide — the kind, the slot, the tabs, the API route, `styles.ts`, `whitey.json` and `look-binding.ts`. Reversed twice during the day before the final call.",
      "The `brandingPack`/`logoPack` dials and the whole `brand` dial subsystem removed; branding becomes a fixed app setting on the new `/settings` page.",
      "THE THEME OWNS EVERY `--axf-*` VALUE. No pack may override accent, status or surface — which is what finally made a roll always visibly restyle the app.",
      "The theme LOCK deleted: it was not merely redundant, it silently swallowed every dial edit while held.",
      "Chrome becomes two dials (`bannerBar`, `navMenu`) with designer tabs that build and save real toolbar and nav assets into the kv store.",
      "Preview → Apply persistence proven across full reloads; localStorage, cookie and SSR head block all agree.",
      "The Expense Tracker imported from GizmoX — slot 5 of 12. `issues.md` and the `.issues.` trigger created.",
      "End of day: 275/275 tests, both packages typecheck clean, check:brand and check:designer green."
    ]
  },
  {
    date: "2026-08-13",
    headline: "Claude is built out end to end — and the two deleted assets come back as plugins",
    sessions: 4,
    what: [
      "`axf-claude` P3: the workspace module at `/claude` — streaming markdown, hand-written syntax highlighting and LCS diffs with NO new dependencies, collapsible thinking, expandable tool cards, subagent runs nested under the call that spawned them, and a searchable conversation library. It consumes P1's subsystem over `/api/claude/*` only, which is the test that the service API is real rather than a private back door for its own UI.",
      "P4: PROJECTS and the bound working directory. cwd/model/effort/permission are COPIED at start() so a `--resume` cannot have its tree moved underneath it; instructions and knowledge are read LIVE, because the file on disk IS the knowledge. A start whose cwd disagrees with its project's is refused by name.",
      "P5: ABSORPTION. Agent Forge and the difference browser — both deleted by the MUI strip three days earlier — return as PLUGINS on the two points the module declared before either existed. The pure halves (the N-way diff engine, Agent Forge's scan core) were restored from the archive line for line; every screen was rebuilt on MUI.",
      "The scoping proof P5 was asked for: five points contributed to from one mixed array, each contribution filed under the point it NAMES, checked by a DISCOVERING test and again against the resolved suite closure — with five mutations watched go red.",
      "The `/diff` route is live again and the `.diff.` rule's stale banner is gone. `npm run check:absorption` re-earned the three checklist rows `axf-diff-browser.bmpx` had marked 'NOT RE-VERIFIED IN ANY RECORD' — deep collapse at 14 columns, F3 wrap-around watched rather than assumed, and the global toolbar exercised one control at a time.",
      "The restored Agent Forge parser had a real bug the new test found on its first run. Restoring a bug verbatim is still shipping it.",
      "End of day: 400/400 tests, typecheck clean in both packages, check:suite / imports / ui / glyphs / coverage / css green, and the live absorption probe green against the running :3200."
    ]
  }
];

/* ═══════════════════════════════════════════════════════════════════ money ══ */

export interface Spend {
  readonly project: string;
  readonly usd: number;
  readonly note: string;
}

/** Read from each `.bmpx` manifest's `cost.spent_usd` on 2026-08-12. */
export const SPEND: readonly Spend[] = [
  {
    project: "axf-claude",
    usd: 110.27,
    note:
      "the figure is the FIRST attempt — killed runs whose output the MUI strip deleted. The " +
      "project was rebuilt from P0 on 2026-08-13 and is now complete (8/8); this number has not " +
      "been re-read since 2026-08-12 and undercounts it"
  },
  { project: "studio-shell-init", usd: 107.03, note: "P0–P9 real, complete — the shell, the command bar, the replica screen" },
  { project: "axf-mui", usd: 105.2, note: "7 phases, 27 steps — the strip and the MUI rebuild" },
  { project: "axf-context-menus", usd: 54.24, note: "built, 6/6" },
  { project: "axf-framework-gaps", usd: 38.83, note: "built in four runs, one killed by the sentinel" },
  { project: "axf-theme-designer", usd: 36.91, note: "built, 15/15" },
  {
    project: "axf-diff-browser",
    usd: 0,
    note:
      "hand-built in-session, never run through the builder — deleted by the strip, and restored " +
      "on 2026-08-13 inside axf-claude P5, so its cost sits in that project's ledger too"
  }
];
