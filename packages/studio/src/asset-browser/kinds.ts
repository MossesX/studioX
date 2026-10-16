/**
 * @file **THE KIND MAP** — the closed list of UI-related graphical asset kinds
 * the Asset Browser manages, each with its (schema, source-of-truth, generator,
 * renderer) tuple.
 *
 * Produced by P0 of `axf-graphical-asset-browser` (2026-08-15) by reading the
 * asset system end to end. It is DATA, not prose, for one reason: every later
 * phase needs this list, and a phase that re-derives it will derive it slightly
 * differently. Import `GRAPHICAL_KINDS` and read the field; do not re-survey.
 *
 * Zero imports on purpose — a map of the system must not depend on the system,
 * so it stays loadable from a script, a server route and a client component
 * alike, in either module graph.
 *
 * ## The headline finding: there are THREE lifecycles, not one
 *
 * "Graphical asset" reads like one category and is three, with three different
 * ideas of what "registered" and "edited" mean. Conflating them is the mistake
 * this file exists to prevent — a browser that offers the same five buttons on
 * all of them would be lying about four:
 *
 *   1. **`generated-asset`** — `logo_kit`, `x_landing`. The only kinds with the
 *      full on-disk lifecycle: a JSON Schema in `assets/schemas/`, a manifest,
 *      an archive zip, an installed dir extracted FROM that zip, and an entry
 *      in `assets/registry.json`. Authored by the framework and never by hand,
 *      behind three enforcement layers (branded type, throwing `define*()`,
 *      sha256 content signature). **Mutating one means editing its TypeScript
 *      source spec and re-running its generator** — never writing the manifest.
 *   2. **`code-pack`** — `branding-package`, `logo-package`. Registered into
 *      core's in-memory `PackRegistry` at boot from `src/packs/*.ts`. There is
 *      NO entry in `assets/registry.json` for a pack and no JSON Schema in
 *      `assets/schemas/` — the contract is core's TypeScript
 *      (`brand/types.ts` + `brand/requirements.ts`). Selection is a persisted
 *      app SETTING (`axf:packs@1` + the `axf_packs` cookie), made at
 *      `/settings` only.
 *   3. **`chrome-asset`** — `toolbar`, `nav-menu`, `dashboard`. Contract is
 *      core's `define*()` chokepoints; shipped instances are code under
 *      `src/toolbars/` and `src/nav/`, and USER-BUILT ones live whole in one kv
 *      document (`chrome-assets`), revalidated through the same chokepoints on
 *      save AND on load. A theme dial selects which one is live. Again: not in
 *      `assets/registry.json`.
 *
 * The browser therefore has three mutation strategies, one per lifecycle, and
 * {@link GraphicalKind.mutation} states which each kind takes.
 *
 * ## The second finding: what is NOT here
 *
 * The project brief inherited the phrase "layout themes" from GizmoX, where
 * `layout-theme` is a real registered asset kind with 110 instances. **AmberX
 * has no such kind.** Its theme engine is 48 dials plus saved LOOKS (values
 * only), held in kv by the designer — no schema, no manifest, no zip, no
 * registry entry, nothing for an asset browser to browse. See
 * {@link OUT_OF_SCOPE}, which records each exclusion and why, so a later phase
 * does not "restore" a kind that never existed here.
 */

/* -------------------------------------------------------------- vocabulary */

/**
 * How a kind is stored, registered and changed. The single most load-bearing
 * field in this file — see the file docblock.
 */
export type AssetLifecycle = "generated-asset" | "code-pack" | "chrome-asset";

/** How the browser is allowed to CHANGE an instance of a kind. */
export type MutationStrategy =
  /** Edit the TS source spec, then re-run the generator. The manifest, zip,
   *  installed dir and registry entry are all outputs and are never touched. */
  | "regenerate-from-source"
  /** Write a separate user-owned document that WINS over the asset at render
   *  time, leaving the asset (and its signature) exactly as generated. */
  | "user-override-document"
  /** Write the instance into the `chrome-assets` kv document, revalidated
   *  through core's chokepoint on the way in and on the way out. */
  | "chrome-kv-document"
  /** Not mutable from the browser in this project — read and preview only. */
  | "read-only";

export interface KindMutation {
  readonly strategy: MutationStrategy;
  /** Can the browser CREATE a new instance of this kind? */
  readonly build: boolean;
  /** Can it change an existing instance's content? */
  readonly edit: boolean;
  /** Can it change the instance's id and/or display name? */
  readonly rename: boolean;
  /** Can it grow an instance — a logo into a kit, an entry into a pack? */
  readonly expand: boolean;
  /** The hard limit a grow operation must refuse past, if any. */
  readonly cap?: string;
  /** What the browser must NOT do, stated so a later phase cannot "improve" it. */
  readonly forbidden: readonly string[];
}

export interface GraphicalKind {
  /** The kind string, exactly as it appears in a manifest / registry entry. */
  readonly id: string;
  /** What a person calls it on screen. */
  readonly display: string;
  readonly lifecycle: AssetLifecycle;
  /** One line for the rail and for a card's subtitle. */
  readonly blurb: string;

  /* ------------------------------------------------- the four-part tuple */

  /** JSON Schema path (repo-relative), or null when the contract is TS only. */
  readonly schema: string | null;
  /** Where the truth lives. Editing this file is what changes the asset. */
  readonly source: string;
  /** The script or call that turns source into what ships, or null. */
  readonly generator: string | null;
  /** What draws one on screen. The browser's live preview uses exactly this. */
  readonly renderer: string;

  /* ----------------------------------------------------- the enforcement */

  /** The validating chokepoint every instance passes through. */
  readonly chokepoint: string | null;
  /** The content-signature function, when the kind has one. */
  readonly signature: string | null;
  /** Client-safe resolution surface, when the kind has one. */
  readonly catalog: string | null;
  /** Where a registration actually lands. Three different answers here. */
  readonly registry: string;
  /** The gate that goes red on drift. */
  readonly gate: string | null;
  /** The user-owned layer over the asset, when one exists. */
  readonly overrides: string | null;

  /* -------------------------------------------------------- what is real */

  /** Instances present on disk on 2026-08-15, read off the registry/source. */
  readonly instances: readonly string[];

  readonly mutation: KindMutation;
  /** Things a later phase would otherwise get wrong. */
  readonly notes: readonly string[];
}

/* ------------------------------------------------------------- the closed list */

/**
 * The seven kinds. Closed — a kind absent from here is out of scope for this
 * project, and {@link OUT_OF_SCOPE} says why for each candidate that was
 * considered and dropped.
 */
export const GRAPHICAL_KINDS: readonly GraphicalKind[] = [
  {
    id: "logo_kit",
    display: "Logo kit",
    lifecycle: "generated-asset",
    blurb: "A bundle of logos, animated or static, each naming a motion from the closed motion registry.",

    schema: "assets/schemas/manifest.logo_kit.schema.json",
    source: "packages/studio/src/logo-kits/kits/index.ts (SOURCE_KITS) → kits/<slug>.ts",
    generator: "packages/studio/scripts/gen-logo-kit.mjs (npm run gen:logo-kit) over scripts/lib/gen-asset.mjs",
    renderer: "packages/studio/src/logo-kits/LogoKitLogo.tsx",

    chokepoint: "packages/studio/src/logo-kits/define.ts → defineLogoKit()",
    signature: "packages/studio/src/logo-kits/sign.ts → kitSignature()",
    catalog: "packages/studio/src/logo-kits/catalog.ts (allLogoKits / logoKit / resolveLogo / kitOfLogo)",
    registry: "assets/registry.json, kind \"logo_kit\", layer \"sdk\", meta.target \"universal\"",
    gate: "npm run check:logo-kit + test/logo-kit-conformance.test.ts",
    overrides: null,

    instances: ["lk001 \"X Throb\" — 10 logos", "lk002 \"Amber Motion\" — 10 logos"],

    mutation: {
      strategy: "regenerate-from-source",
      build: true,
      edit: true,
      rename: true,
      expand: true,
      cap: "MAX_LOGOS_PER_KIT = 40 (owner directive, 2026-08-15) — defineLogoKit throws past it",
      forbidden: [
        "writing assets/installed/logo_kit/<id>/manifest.json directly — it breaks the signature and turns a real guard into a nuisance",
        "inventing a motion id: defineLogoKit rejects anything not in MOTIONS",
        "forging the __brand field to skip defineLogoKit"
      ]
    },
    notes: [
      "A logo's global id is `<kitId>-<slug>` (lk001-orbit). Slugs are unique within a kit; `kind` (animated/static) is DERIVED from the motion so the two can never disagree.",
      "The motion registry is CLOSED and lives at src/logo-kits/motions.ts. Four engines: brand-smil, css, static, pack. `pack` names a branding-pack entry id whose SVG carries its own SMIL — which is how lk002 works and why lk002 is a pack CONSUMER as well as a kit.",
      "A rename of a kit id or a logo slug changes every logo id in it, which is the reference-integrity problem P8/P9 exist for: xl001 currently points at lk002-orbit."
    ]
  },

  {
    id: "x_landing",
    display: "Landing page",
    lifecycle: "generated-asset",
    blurb: "A landing page defined by ASSIGNING other assets to it by id, plus a couple of its own knobs.",

    schema: "assets/schemas/manifest.x_landing.schema.json",
    source: "packages/studio/src/x-landing/landings/index.ts (SOURCE_LANDINGS) → landings/<slug>.ts",
    generator: "packages/studio/scripts/gen-x-landing.mjs (npm run gen:x-landing) over scripts/lib/gen-asset.mjs",
    renderer: "the route named by `landing.route` (/login-landing), which draws its logo through LogoKitLogo",

    chokepoint: "packages/studio/src/x-landing/define.ts → defineXLanding()",
    signature: "packages/studio/src/x-landing/sign.ts → landingSignature()",
    catalog: "packages/studio/src/x-landing/catalog.ts (allXLandings / xLanding / xLandingForRoute / loginLandingRoute)",
    registry: "assets/registry.json, kind \"x_landing\", meta.references carries the composed asset ids",
    gate: "npm run check:x-landing + test/x-landing-conformance.test.ts",
    overrides: "packages/studio/src/x-landing/overrides.ts — kv namespace `landing-overrides`",

    instances: ["xl001 \"Login landing\" — route /login-landing, role login, logo lk002-orbit"],

    mutation: {
      strategy: "user-override-document",
      build: true,
      edit: true,
      rename: true,
      expand: false,
      forbidden: [
        "overriding `id`, `route` or `role` — those are STRUCTURAL. Letting a UI hand a landing the `login` role would let a click repoint the session gate, which is a lock-out reachable from a colour picker",
        "a second landing claiming role \"login\" — the catalog throws at module load"
      ]
    },
    notes: [
      "THE PATTERN TO COPY: the asset stays exactly what the generator produced and a UI edit lands in a separate user-owned kv document, with `resolveLanding()` as the ONE place precedence is decided (override wins while it exists). That is how a designer edits a signed asset without breaking the anti-hand-write contract — the browser should reuse this shape, not invent a second one.",
      "defineXLanding checks every reference RESOLVES, so a dangling logo id is refused at author time rather than rendering an empty hero.",
      "parseOverridesDoc drops a stale logo id silently: a customisation is optional, and losing it beats failing to render."
    ]
  },

  {
    id: "branding-package",
    display: "Branding pack",
    lifecycle: "code-pack",
    blurb: "The whole visual vocabulary a UI draws itself from — marks, lockups, wordmarks, icons, spinners — addressed by id.",

    schema: null,
    source: "packages/studio/src/packs/*.ts (glyph-kit.ts, axs-studio.ts, amber.ts, signal.ts) + axs-studio-brand.entries.json",
    generator: "packages/studio/scripts/gen-brand-extension.mjs (npm run gen:brand-ext) and import-gizmox-brand.mjs; entries are otherwise authored TS",
    renderer: "@axf/core `Glyph` (packages/core/src/brand/Glyph.tsx)",

    chokepoint: "packages/core/src/brand/packs.ts → PackRegistry.register() (validates palette + reports coverage)",
    signature: null,
    catalog: "packages/core/src/brand/packs.ts → the `packs` singleton (packs() / pack() / problems())",
    registry: "IN-MEMORY PackRegistry only — a pack has NO assets/registry.json entry. Selection persists to localStorage `axf:packs@1` + cookie `axf_packs`",
    gate: "npm run check:glyphs, npm run check:brand (brand-recolour-probe), checkCoverage() against REQUIRED_GLYPHS",
    overrides: "packages/core/src/brand/edits.tsx",

    instances: [
      "registered in code at boot — see src/packs/; assets/archive/branding-package/gizmox-brand-0.1.0.zip is an IMPORT SOURCE, not a registered asset"
    ],

    mutation: {
      strategy: "regenerate-from-source",
      build: false,
      edit: true,
      rename: false,
      expand: true,
      cap: "the 54-id REQUIRED_GLYPHS contract is a MINIMUM, not a maximum — packs/axs-studio.ts refuses any overlay entry OUTSIDE the contract",
      forbidden: [
        "adding a drawing without adding its REQUIRED_GLYPHS entry in the SAME edit — axs-studio.ts's overlay guard 500s the whole app between the two halves (it has, for about a minute)",
        "letting a pack set --axf-* values: THE THEME OWNS EVERY --axf-* VALUE (2026-08-12). A pack publishes only its --gxb-* / --axf-brand-* identity roles",
        "treating pack selection as theme state — branding is a FIXED APP SETTING picked at /settings, never rolled, never in a saved look"
      ]
    },
    notes: [
      "packages/core/src/brand/requirements.ts is what 'complete' MEANS: 54 drawings (5 identity + 49 icons) each with a required viewBox, aspect and min/max render size, plus checkCoverage() which counts an unmeasurable required drawing as a FAULT rather than a pass. That report is the browser's per-pack completeness card, already computed — do not write a second one.",
      "An entry may carry `file` (GizmoX's shape) or inline `svg` (AmberX's addition, so a pack ships with no filesystem). The browser's preview must handle both.",
      "There is no `style-package` kind. It was deleted framework-wide 2026-08-12 rather than deprecated, so it cannot grow back; do not restore it from a GizmoX record."
    ]
  },

  {
    id: "logo-package",
    display: "Logo pack",
    lifecycle: "code-pack",
    blurb: "One logo exported as a set of variants — the Logo Studio export shape, kept loadable here.",

    schema: null,
    source: "packages/core/src/brand/types.ts → LogoPackage (payload.{source, document, variants[], files?, entries?})",
    generator: null,
    renderer: "@axf/core `Glyph`, same as a branding pack",

    chokepoint: "packages/core/src/brand/packs.ts → PackRegistry.register()",
    signature: null,
    catalog: "the `packs` singleton, slot-separated from the branding pack",
    registry: "IN-MEMORY PackRegistry only, second selection slot",
    gate: null,
    overrides: null,

    instances: ["none on disk in AmberX — the type exists so a GizmoX-exported pack loads unmodified"],

    mutation: {
      strategy: "read-only",
      build: false,
      edit: false,
      rename: false,
      expand: false,
      forbidden: [
        "building a logo-package authoring flow — Logo Studio is GizmoX's and is explicitly DROPPED from AmberX's creative-suite import; a pack with no author here is a pack the browser can only display"
      ]
    },
    notes: [
      "Listed because the browser must SHOW one if it is ever registered (the rail would otherwise silently omit a live pack), not because this project authors one.",
      "A logo pack is not a branding pack: one logo at many sizes versus the whole vocabulary addressed by role. Keeping them separate kinds is deliberate."
    ]
  },

  {
    id: "toolbar",
    display: "Toolbar",
    lifecycle: "chrome-asset",
    blurb: "A bar — banner, pane toolbar, status bar or rail — declared as items, with the brand as one of them.",

    schema: null,
    source: "shipped: packages/studio/src/toolbars/*.ts · user-built: the `chrome-assets` kv document (ChromeAssetsDoc.toolbars)",
    generator: null,
    renderer: "@axf/core toolbar/Toolbar.tsx (every toolbar is wrapped there in ONE place, core 0.0.24)",

    chokepoint: "packages/core/src/toolbar/types.ts → defineToolbar(); ToolbarRegistry.register() re-checks",
    signature: null,
    catalog: "packages/core/src/toolbar/registry.ts",
    registry: "IN-MEMORY ToolbarRegistry; user-built bars persist whole in data/axf/kv/local/chrome-assets.json and are seeded into the client graph by PacksSeed",
    gate: "npm run check:toolbar, npm run check:ui",
    overrides: "packages/core/src/toolbar/prefs.ts (per-user bar settings, separate from any bar's definition)",

    instances: [
      "banner-standard / banner-compact / banner-mark (app.banner)",
      "command-bar",
      "console-bar + console-status",
      "designer-tabs-bar (designer.tabs)",
      "taskman-lists-bar (taskman.lists)"
    ],

    mutation: {
      strategy: "chrome-kv-document",
      build: true,
      edit: true,
      rename: true,
      expand: true,
      forbidden: [
        "a `banner` with no brand item, or any NON-banner role WITH one — defineToolbar refuses both by name, because repeating the brand inside a pane is how an app ends up with three logos on one screen",
        "a role that disagrees with the surface's SURFACE_ROLES requirement",
        "an @mui/icons-material import: icons resolve through the branding pack's Glyph ids, and a name with no drawing means adding a glyph (plus its REQUIRED_GLYPHS entry), never a literal SVG"
      ]
    },
    notes: [
      "The theme's `bannerBar` chrome dial SELECTS which registered bar is live; Toolbar.tsx resolves it through useAppliedThemeValues() with the registry default as the floor, so a stale id degrades to the default bar instead of a blank banner.",
      "The theme designer's Toolbar tab already builds and saves these. The browser is a second surface on the SAME kv document and the SAME chokepoint — it must not fork either.",
      "iconSize and `labels` belong to the ASSET, not the theme: a tab strip of big branded icons and a 40px command bar are different bars, not one bar under different dials."
    ]
  },

  {
    id: "nav-menu",
    display: "Nav menu",
    lifecycle: "chrome-asset",
    blurb: "A navigation menu as items — sections and links, each link carrying its route and its pack glyph.",

    schema: null,
    source: "shipped: packages/studio/src/nav/{studio-nav,console-nav}.ts · user-built: the `chrome-assets` kv document (ChromeAssetsDoc.navs)",
    generator: null,
    renderer: "@axf/core nav/NavMenu.tsx",

    chokepoint: "packages/core/src/nav/types.ts → defineNavMenu()",
    signature: null,
    catalog: "packages/core/src/nav/registry.ts",
    registry: "IN-MEMORY nav registry; user-built menus persist in the same chrome-assets kv document",
    gate: "npm run check:nav — asserts both nav menus link every live route except the deliberately unlisted ones",
    overrides: null,

    instances: ["studio-nav (app.nav)", "console-nav"],

    mutation: {
      strategy: "chrome-kv-document",
      build: true,
      edit: true,
      rename: true,
      expand: true,
      forbidden: [
        "a menu with no links — defineNavMenu refuses it: 'a menu that navigates nowhere is not a menu'",
        "a link with no glyph or no label — refused, because nav icons come from the pack and a rail style hides labels while the tooltip still needs one",
        "a route that does not start with '/'",
        "adding a row for a route that does not exist, or adding a route without a row — check:nav goes red both ways"
      ]
    },
    notes: [
      "Where the menu sits, its style, its icon size and its hover are LAYOUT DIALS, not fields on the asset — a rolled layout theme redesigns the menu without touching it. The asset is items only.",
      "The theme's `navMenu` chrome dial selects which registered menu is live, exactly as `bannerBar` does for toolbars."
    ]
  },

  {
    id: "dashboard",
    display: "Dashboard wrapper",
    lifecycle: "chrome-asset",
    blurb: "An authored dashboard arrangement, stored beside the toolbars and navs in the one chrome document.",

    schema: null,
    source: "the `chrome-assets` kv document (ChromeAssetsDoc.dashboards) · shipped specs under packages/studio/src/dashboards/",
    generator: null,
    renderer: "packages/studio/src/dashboards/",

    chokepoint: "@axf/core → defineDashboardSpec()",
    signature: null,
    catalog: null,
    registry: "IN-MEMORY, seeded from the chrome-assets document by PacksSeed",
    gate: "npm run check:dashboard",
    overrides: null,

    instances: ["shipped specs under src/dashboards/; user-authored wrappers land in the chrome document"],

    mutation: {
      strategy: "chrome-kv-document",
      build: false,
      edit: false,
      rename: false,
      expand: false,
      forbidden: [
        "splitting dashboards out into their own kv document — they share chrome-assets deliberately, so the server layout reads ONE document and PacksSeed registers everything before the first render"
      ]
    },
    notes: [
      "Included for completeness because it is the third member of ChromeAssetsDoc and the browser will read that document: a rail that showed two of its three lists would misrepresent the file.",
      "Marked read-only for THIS project — it is chrome, but it is arrangement rather than a graphical asset, and authoring it is the theme designer's job. Promote it only on an explicit owner call."
    ]
  }
];

/** Fast lookup by kind id. */
export const KIND_BY_ID: Readonly<Record<string, GraphicalKind>> = Object.freeze(
  Object.fromEntries(GRAPHICAL_KINDS.map((k) => [k.id, k]))
);

/** The kinds sharing a lifecycle — the browser's three mutation strategies. */
export function kindsWithLifecycle(lifecycle: AssetLifecycle): GraphicalKind[] {
  return GRAPHICAL_KINDS.filter((k) => k.lifecycle === lifecycle);
}

/** The only kinds that appear in `assets/registry.json`. */
export const REGISTERED_KIND_IDS: readonly string[] = GRAPHICAL_KINDS.filter(
  (k) => k.lifecycle === "generated-asset"
).map((k) => k.id);

/* ------------------------------------------------------------ what is excluded */

export interface Exclusion {
  readonly candidate: string;
  readonly why: string;
}

/**
 * Kinds considered and deliberately left out. Recorded because an unexplained
 * absence gets "fixed" by the next phase, and two of these are named in the
 * project's own summary — inherited from GizmoX, where they are real.
 */
export const OUT_OF_SCOPE: readonly Exclusion[] = [
  {
    candidate: "layout-theme / style-theme / color-theme",
    why:
      "GizmoX asset kinds with 110 registered instances; AmberX has NONE of them. Its theming is 48 dials " +
      "plus saved LOOKS (values only) held in kv by the designer's saved-store.ts — no schema, no manifest, " +
      "no zip, no registry entry. There is nothing for an asset browser to browse, and building the kind " +
      "would be inventing a contract the theme engine deliberately does not have."
  },
  {
    candidate: "style-package",
    why:
      "Deleted framework-wide on 2026-08-12 (owner: \"get rid of style packs entirely and just use branding " +
      "packs\") and removed rather than deprecated so it cannot grow back. A pack supplies drawings; colour, " +
      "typography and shape belong to the theme's dials always."
  },
  {
    candidate: "ui-main / ui-wrapper",
    why:
      "GizmoX UI Forge layout assets (36 instances there), harvested from source by scripts/harvest-ui-assets.ts. " +
      "AmberX has no UI Forge, no harvester and no such assets. Porting the harvester is a project, not a phase."
  },
  {
    candidate: "tutorial",
    why: "A content asset, not a graphical one. GizmoX-only; nothing in AmberX registers or plays one."
  },
  {
    candidate: "module / plugin / extension / subsystem / add-on",
    why:
      "The five u-asset kinds. They are managed by the plugin manager at /plugins and by scripts/pack.mjs, " +
      "and they are not graphical. `plugin` is the third kind in assets/registry.json today and must NOT " +
      "appear in this browser's rail."
  },
  {
    candidate: "build-archive / session",
    why: "Records, not assets with a UI. They exist under assets/archive/ and have no renderer."
  }
];

/* --------------------------------------------------------- the shared lifecycle */

/**
 * The one lifecycle every `generated-asset` goes through, in order. Stated here
 * because P7 turns it into a server operation and the ORDER is the property
 * that makes it trustworthy — in particular step 3, which is what makes "what
 * is installed" provably equal to "what the archive holds".
 *
 * Implemented once in `packages/studio/scripts/lib/gen-asset.mjs`. Do not
 * reimplement it; call it.
 */
export const GENERATED_ASSET_LIFECYCLE: readonly string[] = [
  "1. validate every source through the kind's define*() chokepoint — an invalid source fails the build, in check mode as much as in write mode",
  "2. write the manifest into a temp STAGING dir and zip it to assets/archive/<kind>/<id>-<version>.zip",
  "3. install by EXTRACTING THE ZIP into assets/installed/<kind>/<id>/ — never by copying the staging dir",
  "4. upsert the registry entry under the shared cross-language lock (the whole read-modify-write, never just the save), preserving the original `created`",
  "5. VERIFICATION DUTY — re-read the zip members, the installed files, the installed manifest's signature and the registry entry OFF DISK before claiming success"
];

/**
 * The three enforcement layers behind the anti-hand-write directive (owner,
 * 2026-08-15: *"All logo kit assets must be authored by the framework and
 * cannot be hand written"*). A new generated kind adds ALL THREE in the same
 * phase; two of three is a guard with a hole.
 */
export const ANTI_HAND_WRITE_LAYERS: readonly string[] = [
  "compile time — a branded type (`axf.logo_kit`, `axf.x_landing`) that only define*() produces, so an object literal does not typecheck where the asset is required",
  "runtime — define*() throws, naming the asset and the exact rule breached",
  "on disk — a sha256 content signature the generator writes and --check recomputes. NOTE: --check compares the WHOLE manifest, not just the stored signature field. A signature-only comparison was mutation-tested and let a hand-edited logo name pass; GizmoX's gen-logo-kit.ts --check still has that hole"
];
