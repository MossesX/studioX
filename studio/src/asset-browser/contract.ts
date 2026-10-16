/**
 * @file **THE ASSET BROWSER'S CONTRACT** — one read model across seven kinds,
 * and the rule that every write names an ENGINE plus a SOURCE edit.
 *
 * Produced by P1 of `axf-graphical-asset-browser` over P0's kind map
 * (`@axs/asset-browser/kinds`). P0 answered *what the kinds are*; this file
 * answers the two questions every later phase asks about them:
 *
 *   1. **How does the browser READ one?** — {@link AssetCard}, the single shape
 *      a card, a rail row and a detail pane are all drawn from, whatever kind
 *      the thing is.
 *   2. **How is the browser allowed to CHANGE one?** — {@link PlannedMutation},
 *      which cannot be constructed without naming an engine and a source file,
 *      and which has no way to express "write this path".
 *
 * ## Why one shape and not seven
 *
 * The failure available here is a browser that forks per kind: a logo-kit card
 * with its own fields, a toolbar card with different ones, and a detail pane
 * that is a `switch` seven cases deep. That browser cannot show two kinds side
 * by side, cannot sort a mixed grid, and grows an eighth case the day a kind is
 * added. So the kinds differ in exactly two places — {@link AssetCard.preview},
 * which names the REAL renderer to draw with, and {@link KindContract}, which is
 * data. Everything else is one shape.
 *
 * ## Why the mutation contract is a type and not a paragraph
 *
 * The owner's directive is that a framework-authored asset *cannot be hand
 * written* (2026-08-15), and three layers already enforce it for the generated
 * kinds — a branded type, a throwing `define*()`, and a sha256 signature the
 * generator writes and `--check` recomputes. A browser that wrote
 * `assets/installed/logo_kit/lk001/manifest.json` would break the signature on
 * the first click and turn a real guard into a nuisance everybody learns to
 * re-run past. Stating "the browser never writes an asset file by hand" in a
 * docblock does not stop that; it is a habit, and habits have holes.
 *
 * So the same three layers apply to the browser's own writes:
 *
 *   1. **compile time** — {@link PlannedMutation} is branded. Only
 *      {@link planMutation} produces one, so a hand-built request object does
 *      not typecheck where the executor (P7) wants a plan.
 *   2. **runtime** — {@link planMutation} throws {@link AssetMutationError},
 *      naming the kind, the verb and what *is* allowed. It re-validates because
 *      a brand is erased and an `as` cast sails past it.
 *   3. **CI** — `test/asset-browser-contract.test.ts` DISCOVERS the kinds from
 *      P0's map and fails if one has no tuple here, plus the RED proofs that
 *      the refusals actually refuse.
 *
 * {@link NEVER_WRITTEN} is the other half: the outputs no engine's caller may
 * touch, as data, so P7's executor can *ask* rather than remember.
 *
 * ## Reading rules
 *
 * Zero runtime imports beyond the kind map, which is itself import-free data.
 * The contract must be loadable from a server route, a client component and a
 * node test alike, in either module graph — the same property that lets a
 * `*.decl.ts` be discovered, and for the same reason.
 *
 * ## Why this is in `src/asset-browser/` and not `src/modules/asset-browser/`
 *
 * P1's step named the module directory. It is not there, and the reason is a
 * gate rather than a preference: `test/ctx-conformance.test.ts` DISCOVERS
 * module directories off disk and asserts each contributes exactly one
 * `*.decl.ts` — so a directory under `src/modules/` holding only a contract
 * reads as a shipped module with a missing declaration, and the gate goes red
 * (watched: `the discovery found a real tree to check`, 22 pass / 1 fail).
 *
 * The two ways out were to write the decl now or to move the file. Writing the
 * decl means authoring the module's id, route and context-menu areas three
 * phases before the screen they describe exists — inventing P4's design blind,
 * which is the exact class of guess this contract is meant to end. Moving the
 * file costs one import path and puts it beside `kinds.ts`, its only
 * dependency, where the substrate this project reads across every kind already
 * lives.
 *
 * The module directory is created by P4, with its declaration, in one edit.
 * The module imports this; nothing here imports the module.
 */

import { GRAPHICAL_KINDS, KIND_BY_ID } from "./kinds";
import type { GraphicalKind, MutationStrategy } from "./kinds";

/* ══════════════════════════════════════════════════ 1. THE UNIFIED READ MODEL */

/**
 * How a card DRAWS its subject.
 *
 * Each value names a real renderer that already exists (see
 * {@link KindContract.renderer}, pinned against P0's map by the conformance
 * test). The browser never re-implements one and never falls back to a
 * screenshot: a preview that is a picture of a logo cannot show that the logo
 * animates, and a preview that re-draws a toolbar is a second toolbar
 * implementation that will disagree with the first.
 */
export type PreviewKind =
  /** Every logo in the kit, each through `LogoKitLogo`, motion running. */
  | "logo-kit"
  /** The landing's composed hero, resolved through `resolveLanding`. */
  | "landing"
  /** The pack's drawings as a grid of `Glyph`s, plus its coverage report. */
  | "glyph-grid"
  /** The bar itself, through core's `Toolbar`, at its declared height. */
  | "toolbar"
  /** The menu itself, through core's `NavMenu`. */
  | "nav-menu"
  /** The wrapper's pane arrangement. */
  | "dashboard";

/**
 * What a field may point AT. Closed on purpose: an open target vocabulary is
 * how a reference graph (P3) ends up with a category of link nothing resolves,
 * which renders as a card that silently claims fewer references than it has.
 */
export type ReferenceTarget =
  /** A logo inside a logo kit — `lk002-orbit`. Resolved by `resolveLogo`. */
  | "logo"
  /** A drawing id in the active branding pack — `icon-plugin`, `mark`. */
  | "glyph"
  /** A motion id from the CLOSED motion registry — `orbit`, `none`. */
  | "motion"
  /** An app-absolute route — `/taskman`. `check:nav` is its other consumer. */
  | "route"
  /** A registered command id — `ctx.copy`, `project-state.generate`. */
  | "command"
  /** A chrome surface slot — `app.banner`, `app.nav`. */
  | "surface";

/** Where in an asset a reference lives, and what it points at. */
export interface ReferenceSpec {
  /**
   * Dotted path into the asset, `[]` for "every element of this array" —
   * `assets.logo`, `logos[].motion`, `items[].glyph`. The browser reads it; it
   * is not an eval target, and P3 walks it explicitly.
   */
  readonly path: string;
  readonly target: ReferenceTarget;
  /** Is a dangling value here refused at author time, or tolerated? */
  readonly integrity: "refused-at-author-time" | "dropped-silently" | "unchecked";
  readonly note?: string;
}

/**
 * A resolved reference, as a card carries it. `resolved: false` is a real state
 * the detail pane must render — a pack swapped out from under a toolbar leaves
 * a glyph id nothing draws, and hiding that is how a blank tile ships.
 */
export interface AssetReference {
  readonly path: string;
  readonly target: ReferenceTarget;
  /** The value found at `path` — the id being pointed at. */
  readonly id: string;
  readonly resolved: boolean;
  /** When the target is itself a browsable asset, its kind and id. */
  readonly ownerKind?: string;
  readonly ownerId?: string;
}

/** How a field is edited on screen. Drives the detail pane's control choice. */
export type FieldControl =
  | "text"
  | "multiline"
  | "number"
  | "boolean"
  | "select"
  /** A picker over the target vocabulary — a logo picker, a glyph picker. */
  | "reference"
  /** A whole ordered list of records (a bar's items, a menu's items). */
  | "items";

/**
 * One thing a person may change, and — the load-bearing half — the ENGINE that
 * change goes through.
 *
 * The engine is on the FIELD and not only on the kind because `x_landing` needs
 * it there: its name and version are regenerated from source, while its logo
 * and card opacity land in the override document instead. One engine per kind
 * would have forced a lie about one of those two pairs.
 */
export interface EditableField {
  /** Dotted path into the asset, as {@link ReferenceSpec.path}. */
  readonly path: string;
  readonly label: string;
  readonly control: FieldControl;
  /** Set when `control` is `"reference"` — what the picker offers. */
  readonly target?: ReferenceTarget;
  /** The engine that applies a change to THIS field. */
  readonly engine: EngineId;
  readonly note?: string;
}

/**
 * The one shape every kind is read as.
 *
 * Assembled by the server catalog (P2) and enriched by the reference graph
 * (P3). Nothing here is kind-specific except {@link AssetCard.preview} and
 * {@link AssetCard.raw}, which is the whole point.
 */
export interface AssetCard {
  /** Unique within its kind — `lk001`, `banner-standard`, `axs-studio`. */
  readonly id: string;
  /** A kind id from P0's closed list. */
  readonly kind: string;
  readonly name: string;
  /**
   * Semver where the kind has one. The chrome kinds do NOT — a bar in a kv
   * document is not versioned — so this is nullable rather than defaulted to
   * `"0.0.0"`, which would read as a real version nobody set.
   */
  readonly version: string | null;
  readonly description: string;
  readonly preview: PreviewKind;
  /** Resolved outgoing references. Empty is a real answer; absent is not. */
  readonly references: readonly AssetReference[];
  /** What this instance's detail pane may offer, already filtered by kind. */
  readonly editable: readonly EditableField[];
  /** Which of build/edit/rename/expand are live for this instance. */
  readonly verbs: readonly MutationVerb[];
  /** Where the instance actually lives — the three answers P0 found. */
  readonly registration: RegistrationSite;
  /**
   * True when a user-owned override document is currently winning over the
   * asset. Only `x_landing` can be in this state today; the field is on the
   * card rather than in a kind-specific bag because the badge that shows it is
   * one badge in one card component.
   */
  readonly overridden: boolean;
  /** The underlying manifest/asset, for the preview renderer to draw from. */
  readonly raw: unknown;
}

/**
 * The three different meanings of "registered" P0 found. Named rather than
 * inferred from the lifecycle, because the rail's "where is this?" line and
 * P9's retirement step both branch on it, and a browser that told a reader a
 * pack has an archive zip would be inventing a file.
 */
export type RegistrationSite =
  /** `assets/registry.json` + an archive zip + an installed dir. */
  | "asset-registry"
  /** Core's in-memory `PackRegistry`, populated at boot from `src/packs/`. */
  | "pack-registry"
  /** The one `chrome-assets` kv document, seeded into the client by PacksSeed. */
  | "chrome-document"
  /** Registered in code at boot and not persisted anywhere a user can reach. */
  | "code";

/* ═══════════════════════════════════════════════ 2. THE MUTATION CONTRACT */

/**
 * The four verbs, and exactly the four `KindMutation` flags P0 recorded.
 *
 * Kept in step with those flags deliberately: the conformance test asserts the
 * bound verbs are SET-EQUAL to the flags, so a kind that grows a capability in
 * the map and not here (or here and not in the map) goes red rather than
 * quietly offering a button that does nothing.
 *
 * Retiring an old id (P9) is not a fifth verb — it is what `rename` does to
 * what it leaves behind, and splitting it out would let a rename be planned
 * without its retirement.
 */
export type MutationVerb = "build" | "edit" | "rename" | "expand";

/**
 * The engines. **This list is the mutation contract's teeth**: a write names
 * one of these or it is not a write the browser can make.
 *
 * Two families, matching P0's two mutating strategies:
 *
 *   - **generators** (`gen:*`) — the browser edits a TypeScript source spec and
 *     re-runs the generator, which owns the manifest, the zip, the installed
 *     dir and the registry entry. Those are OUTPUTS and appear in
 *     {@link NEVER_WRITTEN}.
 *   - **documents** — the browser writes a small user-owned kv document that
 *     the renderer resolves over the asset (`landing-overrides`) or that IS the
 *     asset's storage (`chrome-assets`). Both revalidate through core's
 *     chokepoints on the way in and on the way out.
 */
export type EngineId =
  | "gen:logo-kit"
  | "gen:x-landing"
  | "gen:brand-ext"
  | "landing-overrides"
  | "chrome-assets";

export interface Engine {
  readonly id: EngineId;
  readonly family: "generator" | "document";
  /** How the engine is actually invoked. P7 turns these into server ops. */
  readonly invoke: string;
  /**
   * The gate that must be re-run and pass after this engine runs. A generator
   * whose `--check` is not re-run has not been proven to have produced what the
   * source says — which is the verification duty, restated as a field.
   */
  readonly verify: string | null;
  /** The chokepoint every value passes through before the engine stores it. */
  readonly chokepoint: string;
}

export const ENGINES: Readonly<Record<EngineId, Engine>> = Object.freeze({
  "gen:logo-kit": {
    id: "gen:logo-kit",
    family: "generator",
    invoke: "npm run gen:logo-kit (packages/studio/scripts/gen-logo-kit.mjs over scripts/lib/gen-asset.mjs)",
    verify: "npm run check:logo-kit",
    chokepoint: "defineLogoKit() — src/logo-kits/define.ts"
  },
  "gen:x-landing": {
    id: "gen:x-landing",
    family: "generator",
    invoke: "npm run gen:x-landing (packages/studio/scripts/gen-x-landing.mjs over scripts/lib/gen-asset.mjs)",
    verify: "npm run check:x-landing",
    chokepoint: "defineXLanding() — src/x-landing/define.ts"
  },
  "gen:brand-ext": {
    id: "gen:brand-ext",
    family: "generator",
    invoke: "npm run gen:brand-ext (packages/studio/scripts/gen-brand-extension.mjs)",
    verify: "npm run check:glyphs",
    chokepoint: "PackRegistry.register() — packages/core/src/brand/packs.ts"
  },
  "landing-overrides": {
    id: "landing-overrides",
    family: "document",
    invoke: "PUT /api/axf/kv/landing-overrides — saveOverrides() in src/x-landing/overrides.ts",
    verify: null,
    chokepoint: "parseOverridesDoc() — drops a field that does not resolve rather than storing it"
  },
  "chrome-assets": {
    id: "chrome-assets",
    family: "document",
    invoke: "PUT /api/axf/kv/chrome-assets — saveChromeAssets() in src/chrome/assets.ts",
    verify: "npm run check:toolbar and npm run check:nav",
    chokepoint: "defineToolbar() / defineNavMenu() — re-run by parseChromeAssetsDoc on save AND on load"
  }
} satisfies Record<EngineId, Engine>);

/** The form of the thing the browser edits. Never an output, always a source. */
export type SourceForm =
  /** A TypeScript spec under `src/` that a generator reads. */
  | "ts-source"
  /** A kv document under `data/axf/kv/<user>/`. */
  | "kv-document";

export interface SourceEdit {
  readonly form: SourceForm;
  /**
   * The file or namespace the browser edits. A SOURCE — the thing whose change
   * causes the asset to change — never the asset's own manifest.
   */
  readonly target: string;
}

/**
 * A verb, bound to the engine that performs it and the source it edits.
 *
 * A kind may bind the same verb twice (`x_landing`'s `edit` goes through the
 * generator for its name and through the override document for its logo), which
 * is why this is a list rather than a record keyed by verb.
 */
export interface VerbBinding {
  readonly verb: MutationVerb;
  readonly engine: EngineId;
  readonly source: SourceEdit;
  /** Why this verb takes this engine, when the kind offers more than one. */
  readonly note?: string;
}

/* ─────────────────────────────────────── what no caller may write, ever */

export interface ForbiddenWrite {
  /** A `/`-separated glob, relative to the AmberX root. `**` spans segments. */
  readonly pattern: string;
  readonly why: string;
}

/**
 * The paths the browser — and P7's executor on its behalf — must never write.
 *
 * Every one of them is an OUTPUT of `GENERATED_ASSET_LIFECYCLE`. Writing an
 * output is not a shortcut to the same result: the installed dir is EXTRACTED
 * FROM THE ZIP precisely so that "what is installed" provably equals "what the
 * archive holds", and a hand-written manifest breaks the signature that makes
 * the whole anti-hand-write guarantee real.
 *
 * As data rather than prose so {@link assertNoDirectWrite} can be *called*.
 * A rule you have to remember is a rule with holes; this one answers questions.
 */
export const NEVER_WRITTEN: readonly ForbiddenWrite[] = [
  {
    pattern: "assets/installed/**",
    why:
      "the installed dir is extracted FROM the archive zip (step 3 of the shared lifecycle), which is " +
      "what makes 'what is installed' provably equal to 'what was archived'. Writing it directly " +
      "breaks that equality with nothing to notice"
  },
  {
    pattern: "assets/archive/**",
    why: "the zip is the generator's output and the thing the installed dir is proven against"
  },
  {
    pattern: "assets/registry.json",
    why:
      "upserted by the generator under the shared cross-language lock, wrapping the WHOLE " +
      "read-modify-write. A second writer loses entries — twelve concurrent writers once left one survivor"
  },
  {
    pattern: "**/manifest.json",
    why:
      "a manifest carries the sha256 content signature; hand-editing one breaks the signature and turns " +
      "a real guard into a nuisance everybody learns to re-run past"
  },
  {
    pattern: "assets/schemas/**",
    why: "a schema is the contract a manifest is validated against, not something a browser produces"
  }
];

/** Compile one {@link ForbiddenWrite.pattern} to a matcher. */
function globToRe(pattern: string): RegExp {
  // `**` first, then `*`, so the single-star rule cannot eat half a double.
  const body = pattern
    .split("/")
    .map((seg) => {
      if (seg === "**") return " ";
      return seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
    })
    .join("/")
    // A `**` segment matches zero or more path segments, including the slash
    // that would otherwise be left dangling on either side of it.
    .replace(/ \//g, "(?:[^/]+/)*")
    .replace(/\/ /g, "(?:/[^/]+)*")
    .replace(/ /g, ".*");
  return new RegExp(`^${body}$`);
}

/**
 * The rule a path violates, or `null` if it violates none.
 *
 * Accepts either separator and tolerates a leading `./` — a Windows-shaped path
 * that slipped past this check because of a backslash would be the exact class
 * of hole the list exists to close.
 */
export function forbiddenWriteFor(filePath: string): ForbiddenWrite | null {
  const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  for (const rule of NEVER_WRITTEN) {
    if (globToRe(rule.pattern).test(norm)) return rule;
  }
  return null;
}

export class AssetMutationError extends Error {}

/** Throw if `filePath` is an output the browser must never write. */
export function assertNoDirectWrite(filePath: string): void {
  const rule = forbiddenWriteFor(filePath);
  if (rule) {
    throw new AssetMutationError(
      `refusing to write "${filePath}" — it matches "${rule.pattern}": ${rule.why}. ` +
        `Edit the SOURCE and run the engine instead; see ENGINES in the asset-browser contract.`
    );
  }
}

/* ══════════════════════════════════════════════════ 3. THE PER-KIND TUPLES */

/**
 * Everything the browser needs to know about one kind that is not already in
 * P0's map. One per kind in `GRAPHICAL_KINDS`, no more and no fewer — the
 * conformance test discovers the kinds and fails on either mismatch, which is
 * what makes "a kind added without its tuple" a red build rather than a card
 * that renders blank.
 */
export interface KindContract {
  /** Must be a kind id from `GRAPHICAL_KINDS`. */
  readonly kind: string;
  readonly preview: PreviewKind;
  /**
   * The renderer, echoed from P0's map. Echoed rather than looked up so the
   * test can assert the two agree — a preview pointed at a renderer that moved
   * is a blank tile, and the map is where a move gets recorded.
   */
  readonly renderer: string;
  readonly registration: RegistrationSite;
  /** Where the card reads `version` from, or null when the kind has none. */
  readonly versionField: string | null;
  readonly references: readonly ReferenceSpec[];
  readonly editable: readonly EditableField[];
  /**
   * Fields that may NEVER be edited, with the reason. Structural means "a
   * change here changes what the asset IS, not what it looks like" — and for
   * `x_landing` it is a security property, not tidiness.
   */
  readonly structural: readonly StructuralField[];
  readonly mutations: readonly VerbBinding[];
  /** The hard limit `expand` must refuse past, when the kind has one. */
  readonly cap: ExpandLimit | null;
}

/**
 * What bounds a grow operation. TWO shapes, because the two kinds that can
 * expand are bounded differently and collapsing them into one number would have
 * meant writing a false one.
 *
 * A logo kit has a numeric ceiling: forty logos, and the forty-first is
 * refused. A branding pack has no ceiling at all — the 54-id contract is a
 * MINIMUM — but it is bounded the other way, by membership: an overlay entry
 * outside the contract is refused, so growing the pack means growing the
 * contract in the same edit.
 */
export type ExpandLimit =
  | { readonly limit: "max"; readonly field: string; readonly max: number; readonly enforcedBy: string }
  | {
      readonly limit: "closed-set";
      readonly field: string;
      /** The set an added member must already belong to. */
      readonly members: string;
      readonly enforcedBy: string;
    };

export interface StructuralField {
  readonly path: string;
  readonly why: string;
}

export const KIND_CONTRACTS: readonly KindContract[] = [
  /* ------------------------------------------------------------- logo_kit */
  {
    kind: "logo_kit",
    preview: "logo-kit",
    renderer: "packages/studio/src/logo-kits/LogoKitLogo.tsx",
    registration: "asset-registry",
    versionField: "version",

    references: [
      {
        path: "logos[].motion",
        target: "motion",
        integrity: "refused-at-author-time",
        note: "defineLogoKit rejects a motion outside the closed MOTIONS registry"
      },
      {
        path: "logos[].motion→pack entry",
        target: "glyph",
        integrity: "refused-at-author-time",
        note:
          "a `pack`-engine motion names a branding-pack entry id; the conformance test asserts the " +
          "entry exists AND carries SMIL, because a typo there is a blank tile"
      }
    ],

    editable: [
      { path: "name", label: "Kit name", control: "text", engine: "gen:logo-kit" },
      { path: "description", label: "Description", control: "multiline", engine: "gen:logo-kit" },
      { path: "version", label: "Version", control: "text", engine: "gen:logo-kit" },
      { path: "logos[].name", label: "Logo name", control: "text", engine: "gen:logo-kit" },
      {
        path: "logos[].slug",
        label: "Logo slug",
        control: "text",
        engine: "gen:logo-kit",
        note:
          "changing a slug changes the logo's GLOBAL id (`<kitId>-<slug>`), so it is a rename in " +
          "everything but name — P8 must repoint whatever references it, xl001 included"
      },
      {
        path: "logos[].motion",
        label: "Motion",
        control: "reference",
        target: "motion",
        engine: "gen:logo-kit",
        note: "`kind` is DERIVED from the motion and is therefore not separately editable"
      },
      { path: "logos[].note", label: "Note", control: "text", engine: "gen:logo-kit" }
    ],

    structural: [
      { path: "id", why: "the kit id is changed by the `rename` verb, which also retires the old id (P9)" },
      { path: "type", why: "the asset type is what the schema validates against" },
      { path: "authored_by", why: "always \"framework\" — editing it is claiming a lie about provenance" },
      { path: "logos[].id", why: "derived as `<kitId>-<slug>`; editing it lets the id and the slug disagree" },
      {
        path: "logos[].kind",
        why: "derived from the motion (animated/static) precisely so the two can never disagree"
      }
    ],

    mutations: [
      { verb: "build", engine: "gen:logo-kit", source: { form: "ts-source", target: "packages/studio/src/logo-kits/kits/<slug>.ts + kits/index.ts (SOURCE_KITS)" } },
      { verb: "edit", engine: "gen:logo-kit", source: { form: "ts-source", target: "packages/studio/src/logo-kits/kits/<slug>.ts" } },
      { verb: "rename", engine: "gen:logo-kit", source: { form: "ts-source", target: "packages/studio/src/logo-kits/kits/<slug>.ts + kits/index.ts" } },
      { verb: "expand", engine: "gen:logo-kit", source: { form: "ts-source", target: "packages/studio/src/logo-kits/kits/<slug>.ts" } }
    ],

    cap: {
      limit: "max",
      field: "logos",
      max: 40,
      enforcedBy: "MAX_LOGOS_PER_KIT — defineLogoKit throws past it"
    }
  },

  /* ------------------------------------------------------------ x_landing */
  {
    kind: "x_landing",
    preview: "landing",
    renderer: "the route named by `landing.route` (/login-landing), which draws its logo through LogoKitLogo",
    registration: "asset-registry",
    versionField: "version",

    references: [
      {
        path: "assets.logo",
        target: "logo",
        integrity: "refused-at-author-time",
        note: "defineXLanding checks every reference RESOLVES, so a dangling logo id never reaches a render"
      }
    ],

    editable: [
      { path: "name", label: "Landing name", control: "text", engine: "gen:x-landing" },
      { path: "description", label: "Description", control: "multiline", engine: "gen:x-landing" },
      { path: "version", label: "Version", control: "text", engine: "gen:x-landing" },
      {
        path: "assets.logo",
        label: "Logo",
        control: "reference",
        target: "logo",
        engine: "landing-overrides",
        note:
          "THE PATTERN: the asset stays byte-identical to what the generator produced and the choice " +
          "lands in the override document, with resolveLanding() the one place precedence is decided"
      },
      {
        path: "cardOpacity",
        label: "Card opacity",
        control: "number",
        engine: "landing-overrides"
      }
    ],

    structural: [
      {
        path: "id",
        why: "changed by the `rename` verb through the generator, never by an override"
      },
      {
        path: "route",
        why:
          "STRUCTURAL, and a security property: an override that could move a landing's route would " +
          "let a click repoint the session gate — a lock-out reachable from a colour picker"
      },
      {
        path: "role",
        why:
          "same reason, harder: at most one landing may hold `login`, and it is what the gate sends " +
          "unauthenticated visitors to. The catalog throws on a second claimant"
      }
    ],

    mutations: [
      { verb: "build", engine: "gen:x-landing", source: { form: "ts-source", target: "packages/studio/src/x-landing/landings/<slug>.ts + landings/index.ts (SOURCE_LANDINGS)" } },
      {
        verb: "edit",
        engine: "gen:x-landing",
        source: { form: "ts-source", target: "packages/studio/src/x-landing/landings/<slug>.ts" },
        note: "name, description and version are the asset's own and are regenerated"
      },
      {
        verb: "edit",
        engine: "landing-overrides",
        source: { form: "kv-document", target: "data/axf/kv/<user>/landing-overrides.json" },
        note: "logo and cardOpacity are a reader's choice and never touch the signed asset"
      },
      { verb: "rename", engine: "gen:x-landing", source: { form: "ts-source", target: "packages/studio/src/x-landing/landings/<slug>.ts + landings/index.ts" } }
    ],

    cap: null
  },

  /* ----------------------------------------------------- branding-package */
  {
    kind: "branding-package",
    preview: "glyph-grid",
    renderer: "@axf/core `Glyph` (packages/core/src/brand/Glyph.tsx)",
    registration: "pack-registry",
    versionField: "version",

    references: [
      {
        path: "payload.entries[].id",
        target: "glyph",
        integrity: "unchecked",
        note:
          "coverage is reported by checkCoverage() against REQUIRED_GLYPHS rather than refused — an " +
          "unmeasurable required drawing counts as a FAULT, and that report IS the completeness card"
      }
    ],

    editable: [
      { path: "name", label: "Pack name", control: "text", engine: "gen:brand-ext" },
      { path: "description", label: "Description", control: "multiline", engine: "gen:brand-ext" },
      { path: "payload.entries[].label", label: "Drawing label", control: "text", engine: "gen:brand-ext" },
      { path: "payload.entries[].category", label: "Category", control: "select", engine: "gen:brand-ext" },
      {
        path: "payload.entries[].svg",
        label: "Drawing",
        control: "multiline",
        engine: "gen:brand-ext",
        note:
          "an entry may carry `file` (GizmoX's shape) or inline `svg` (AmberX's); the preview handles " +
          "both, and a drawing paints in var(--gxb-*) so it recolours with the theme"
      }
    ],

    structural: [
      { path: "id", why: "a pack id is what selection persists (`axf:packs@1`); renaming it orphans the setting" },
      { path: "type", why: "branding-package vs logo-package decides which registry slot it takes" },
      { path: "payload.schemaVersion", why: "the shape contract GizmoX packs are loadable against" },
      {
        path: "payload.palette",
        why:
          "THE THEME OWNS EVERY --axf-* VALUE (2026-08-12). A pack publishes its --gxb-* / --axf-brand-* " +
          "identity roles and never overrides accent, status or surface"
      }
    ],

    mutations: [
      {
        verb: "edit",
        engine: "gen:brand-ext",
        source: { form: "ts-source", target: "packages/studio/src/packs/<pack>.ts (+ axs-studio-brand.entries.json)" }
      },
      {
        verb: "expand",
        engine: "gen:brand-ext",
        source: { form: "ts-source", target: "packages/studio/src/packs/<pack>.ts + packages/core/src/brand/requirements.ts" },
        note:
          "the REQUIRED_GLYPHS entry goes in the SAME edit — axs-studio.ts's overlay guard 500s the " +
          "whole app between the two halves, and it has, for about a minute"
      }
    ],

    cap: {
      limit: "closed-set",
      field: "payload.entries",
      members: "REQUIRED_GLYPHS (packages/core/src/brand/requirements.ts) — 54 ids today",
      enforcedBy:
        "axs-studio.ts's overlay guard refuses an entry OUTSIDE the contract, so the 54 ids are a " +
        "MINIMUM and not a maximum: expanding the pack means expanding the contract in the same edit"
    }
  },

  /* --------------------------------------------------------- logo-package */
  {
    kind: "logo-package",
    preview: "glyph-grid",
    renderer: "@axf/core `Glyph`, same as a branding pack",
    registration: "pack-registry",
    versionField: "version",

    references: [
      { path: "payload.entries[].id", target: "glyph", integrity: "unchecked" }
    ],

    editable: [],
    structural: [
      {
        path: "*",
        why:
          "read-only in AmberX: Logo Studio is GizmoX's and is explicitly dropped from the creative-suite " +
          "import, so there is no author here. The kind is listed so the rail SHOWS one if it is ever " +
          "registered — a rail that silently omitted a live pack would be lying about the pack registry"
      }
    ],
    mutations: [],
    cap: null
  },

  /* -------------------------------------------------------------- toolbar */
  {
    kind: "toolbar",
    preview: "toolbar",
    renderer: "@axf/core toolbar/Toolbar.tsx (every toolbar is wrapped there in ONE place, core 0.0.24)",
    registration: "chrome-document",
    versionField: null,

    references: [
      { path: "surface", target: "surface", integrity: "refused-at-author-time", note: "SURFACE_ROLES refuses a role that disagrees with the surface" },
      { path: "items[].glyph", target: "glyph", integrity: "unchecked", note: "a glyph id with no drawing renders nothing — check:glyphs is the gate" },
      { path: "items[].command", target: "command", integrity: "unchecked" }
    ],

    editable: [
      { path: "title", label: "Title", control: "text", engine: "chrome-assets" },
      { path: "description", label: "Description", control: "multiline", engine: "chrome-assets" },
      { path: "role", label: "Role", control: "select", engine: "chrome-assets", note: "banner / pane-toolbar / status-bar / rail" },
      { path: "surface", label: "Surface", control: "reference", target: "surface", engine: "chrome-assets" },
      { path: "items", label: "Items", control: "items", engine: "chrome-assets" },
      { path: "height", label: "Height", control: "number", engine: "chrome-assets" },
      {
        path: "iconSize",
        label: "Icon size",
        control: "number",
        engine: "chrome-assets",
        note: "belongs to the ASSET, not the theme: a branded tab strip and a 40px command bar are different bars"
      },
      { path: "labels", label: "Show labels", control: "boolean", engine: "chrome-assets" },
      { path: "background", label: "Background", control: "select", engine: "chrome-assets" },
      { path: "border", label: "Border", control: "boolean", engine: "chrome-assets" }
    ],

    structural: [
      {
        path: "id",
        why:
          "user-built bars are minted under the `custom-` prefix so a custom asset can never collide " +
          "with, or impersonate, a built-in registered by boot code. `rename` re-mints; a free edit would not"
      }
    ],

    mutations: [
      { verb: "build", engine: "chrome-assets", source: { form: "kv-document", target: "data/axf/kv/<user>/chrome-assets.json (toolbars[])" } },
      { verb: "edit", engine: "chrome-assets", source: { form: "kv-document", target: "data/axf/kv/<user>/chrome-assets.json (toolbars[])" } },
      { verb: "rename", engine: "chrome-assets", source: { form: "kv-document", target: "data/axf/kv/<user>/chrome-assets.json (toolbars[])" } },
      { verb: "expand", engine: "chrome-assets", source: { form: "kv-document", target: "data/axf/kv/<user>/chrome-assets.json (toolbars[])" }, note: "adding an item to the bar" }
    ],

    cap: null
  },

  /* ------------------------------------------------------------- nav-menu */
  {
    kind: "nav-menu",
    preview: "nav-menu",
    renderer: "@axf/core nav/NavMenu.tsx",
    registration: "chrome-document",
    versionField: null,

    references: [
      { path: "surface", target: "surface", integrity: "unchecked" },
      {
        path: "items[].route",
        target: "route",
        integrity: "refused-at-author-time",
        note: "defineNavMenu refuses a route not starting with '/'; check:nav then refuses BOTH a row for a dead route and a route with no row"
      },
      { path: "items[].glyph", target: "glyph", integrity: "refused-at-author-time", note: "a link with no glyph is refused — nav icons come from the pack" }
    ],

    editable: [
      { path: "title", label: "Title", control: "text", engine: "chrome-assets" },
      { path: "description", label: "Description", control: "multiline", engine: "chrome-assets" },
      { path: "surface", label: "Surface", control: "reference", target: "surface", engine: "chrome-assets" },
      { path: "items", label: "Items", control: "items", engine: "chrome-assets" }
    ],

    structural: [
      { path: "id", why: "same custom- minting rule as a toolbar: a rename re-mints, a free edit would not" },
      {
        path: "placement/style/iconSize/hover",
        why:
          "not fields on this asset at all — they are LAYOUT DIALS, so a rolled layout can move and " +
          "redesign the whole menu without rewriting a registered asset. The asset is items only"
      }
    ],

    mutations: [
      { verb: "build", engine: "chrome-assets", source: { form: "kv-document", target: "data/axf/kv/<user>/chrome-assets.json (navs[])" } },
      { verb: "edit", engine: "chrome-assets", source: { form: "kv-document", target: "data/axf/kv/<user>/chrome-assets.json (navs[])" } },
      { verb: "rename", engine: "chrome-assets", source: { form: "kv-document", target: "data/axf/kv/<user>/chrome-assets.json (navs[])" } },
      { verb: "expand", engine: "chrome-assets", source: { form: "kv-document", target: "data/axf/kv/<user>/chrome-assets.json (navs[])" }, note: "adding a link or a section" }
    ],

    cap: null
  },

  /* ------------------------------------------------------------ dashboard */
  {
    kind: "dashboard",
    preview: "dashboard",
    renderer: "packages/studio/src/dashboards/",
    registration: "chrome-document",
    versionField: null,

    references: [],
    editable: [],
    structural: [
      {
        path: "*",
        why:
          "read-only for THIS project. It is chrome, but it is ARRANGEMENT rather than a graphical " +
          "asset, and authoring it is the theme designer's job. It appears in the rail because it is " +
          "the third member of ChromeAssetsDoc and the browser reads that document — showing two of " +
          "its three lists would misrepresent the file. Promote it only on an explicit owner call"
      }
    ],
    mutations: [],
    cap: null
  }
];

/** Fast lookup by kind id. */
export const CONTRACT_BY_KIND: Readonly<Record<string, KindContract>> = Object.freeze(
  Object.fromEntries(KIND_CONTRACTS.map((c) => [c.kind, c]))
);

/** The verbs a kind allows, read off P0's map — the one authority on the flags. */
export function allowedVerbs(kind: string): MutationVerb[] {
  const k: GraphicalKind | undefined = KIND_BY_ID[kind];
  if (!k) return [];
  const m = k.mutation;
  const out: MutationVerb[] = [];
  if (m.build) out.push("build");
  if (m.edit) out.push("edit");
  if (m.rename) out.push("rename");
  if (m.expand) out.push("expand");
  return out;
}

/** The strategy P0 recorded for a kind, or `null` for an unknown kind. */
export function strategyOf(kind: string): MutationStrategy | null {
  return KIND_BY_ID[kind]?.mutation.strategy ?? null;
}

/* ══════════════════════════════════════════════════════ 4. THE CHOKEPOINT */

/**
 * A write, before it has been checked. Note what is NOT here: no path, no file
 * name, no bytes. A mutation is a VERB on an ASSET through an ENGINE, and the
 * engine decides what lands on disk.
 */
export interface MutationRequest {
  readonly kind: string;
  readonly verb: MutationVerb;
  /** The instance being changed. For `build`, the id being minted. */
  readonly assetId: string;
  readonly engine: EngineId;
  /** The engine's payload — a spec fragment, a field patch, a new item. */
  readonly payload?: unknown;
}

declare const MUTATION_BRAND: unique symbol;

/**
 * A validated write. The brand is why P7's executor can take one and run it
 * without re-deriving whether it is allowed — and why a hand-built object
 * literal does not typecheck where one is wanted.
 */
export type PlannedMutation = MutationRequest & {
  readonly [MUTATION_BRAND]: true;
  /** The source the browser edits. Resolved from the kind's binding. */
  readonly source: SourceEdit;
  /** The gate the executor must re-run and prove green afterwards. */
  readonly verify: string | null;
  /** The chokepoint the payload passes through before anything is stored. */
  readonly chokepoint: string;
};

/**
 * **THE ONE WAY TO MAKE A WRITE.** Validates the request against the kind's
 * tuple and P0's flags, and returns a branded plan naming the engine, the
 * source and the gate that proves it worked.
 *
 * Throws {@link AssetMutationError} — naming the kind, the verb and what IS
 * allowed — rather than returning null, because a caller that ignores a null
 * has silently skipped the whole contract.
 */
export function planMutation(req: MutationRequest): PlannedMutation {
  const contract = CONTRACT_BY_KIND[req.kind];
  if (!contract) {
    throw new AssetMutationError(
      `unknown asset kind "${req.kind}" — the browser manages ${KIND_CONTRACTS.map((c) => c.kind).join(", ")}`
    );
  }

  const allowed = allowedVerbs(req.kind);
  if (!allowed.includes(req.verb)) {
    throw new AssetMutationError(
      allowed.length
        ? `"${req.kind}" does not support "${req.verb}" — it allows ${allowed.join(", ")}`
        : `"${req.kind}" is read-only in this browser (strategy "${strategyOf(req.kind)}"): ` +
            (contract.structural[0]?.why ?? "no mutation is bound for it")
    );
  }

  const bindings = contract.mutations.filter((b) => b.verb === req.verb);
  const binding = bindings.find((b) => b.engine === req.engine);
  if (!binding) {
    throw new AssetMutationError(
      `"${req.kind}" cannot "${req.verb}" through engine "${req.engine}" — ` +
        `that verb goes through ${bindings.map((b) => `"${b.engine}"`).join(" or ") || "no engine"}`
    );
  }

  const engine = ENGINES[binding.engine];
  return {
    ...req,
    source: binding.source,
    verify: engine.verify,
    chokepoint: engine.chokepoint
  } as PlannedMutation;
}

/**
 * Can this field be changed at all, and through what?
 *
 * Consulted by the detail pane so a structural field renders as a stated
 * refusal with its reason rather than as a control that throws on save — the
 * refusal is information, and hiding it is how someone spends ten minutes
 * wondering why the route will not stick.
 */
export function editorFor(kind: string, path: string): EditableField | StructuralField | null {
  const contract = CONTRACT_BY_KIND[kind];
  if (!contract) return null;
  return (
    contract.editable.find((f) => f.path === path) ??
    contract.structural.find((f) => f.path === path || f.path === "*") ??
    null
  );
}

/** True when `value` came from {@link editorFor} and is a refusal, not a field. */
export function isStructural(field: EditableField | StructuralField): field is StructuralField {
  return "why" in field;
}

/* ══════════════════════════════════════════════════════════ 5. self-checks */

/**
 * The invariants the conformance test asserts, evaluated here so a caller can
 * ask too — and so the test's expectations and the contract's own idea of
 * correctness cannot drift into two different rules.
 *
 * Returns one message per breach; an empty array is the healthy state.
 */
export function contractProblems(): string[] {
  const problems: string[] = [];
  const kindIds = GRAPHICAL_KINDS.map((k) => k.id);
  const contractIds = KIND_CONTRACTS.map((c) => c.kind);

  for (const id of kindIds) {
    if (!contractIds.includes(id)) {
      problems.push(
        `kind "${id}" is in GRAPHICAL_KINDS but has no tuple in KIND_CONTRACTS — the browser would ` +
          `render it as a blank card with no preview, no fields and no verbs`
      );
    }
  }
  for (const id of contractIds) {
    if (!kindIds.includes(id)) {
      problems.push(`KIND_CONTRACTS has a tuple for "${id}", which is not a kind in GRAPHICAL_KINDS`);
    }
    if (contractIds.indexOf(id) !== contractIds.lastIndexOf(id)) {
      problems.push(`KIND_CONTRACTS holds more than one tuple for "${id}"`);
    }
  }

  for (const c of KIND_CONTRACTS) {
    const kind = KIND_BY_ID[c.kind];
    if (!kind) continue;

    if (c.renderer !== kind.renderer) {
      problems.push(
        `"${c.kind}": the tuple's renderer disagrees with the kind map — a preview pointed at a ` +
          `renderer that moved draws nothing.\n    map:      ${kind.renderer}\n    contract: ${c.renderer}`
      );
    }

    const allowed = [...allowedVerbs(c.kind)].sort();
    const bound = [...new Set(c.mutations.map((m) => m.verb))].sort();
    if (allowed.join(",") !== bound.join(",")) {
      problems.push(
        `"${c.kind}": bound verbs [${bound.join(", ") || "none"}] disagree with the kind map's flags ` +
          `[${allowed.join(", ") || "none"}] — one side offers a capability the other does not`
      );
    }

    if (kind.mutation.strategy === "read-only" && bound.length) {
      problems.push(`"${c.kind}" is read-only in the kind map yet binds ${bound.join(", ")}`);
    }
    if (!bound.length && c.editable.length) {
      problems.push(
        `"${c.kind}" binds no verb yet declares ${c.editable.length} editable field(s) — a control ` +
          `with no engine behind it is a dead button`
      );
    }

    const editEngines = new Set(c.mutations.filter((m) => m.verb === "edit").map((m) => m.engine));
    for (const f of c.editable) {
      if (!editEngines.has(f.engine)) {
        problems.push(
          `"${c.kind}.${f.path}" names engine "${f.engine}", which is not bound to this kind's ` +
            `"edit" verb (${[...editEngines].join(", ") || "nothing is"})`
        );
      }
      if (c.structural.some((s) => s.path === f.path)) {
        problems.push(`"${c.kind}.${f.path}" is declared BOTH editable and structural`);
      }
      if ((f.control === "reference") !== (f.target !== undefined)) {
        problems.push(
          `"${c.kind}.${f.path}": a "reference" control needs a target and only a reference control ` +
            `may carry one — a picker with nothing to offer is a picker that renders empty`
        );
      }
    }

    if (c.cap && !kind.mutation.cap) {
      problems.push(`"${c.kind}" declares a cap the kind map does not record`);
    }
    if (!c.cap && kind.mutation.cap && kind.mutation.expand) {
      problems.push(
        `"${c.kind}" can expand and the kind map records a cap ("${kind.mutation.cap}"), but the ` +
          `tuple carries no machine-readable limit for the expand button to refuse past`
      );
    }
  }

  return problems;
}
