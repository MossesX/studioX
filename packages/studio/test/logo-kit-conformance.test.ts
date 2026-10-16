/**
 * @file Conformance gate for `logo_kit` assets — layer three of the enforcement
 * doctrine. `defineLogoKit` brands and validates at author time; this test reads
 * what actually landed on disk and asserts it is exactly what the framework
 * author (the generator) would produce from source.
 *
 * That is the anti-hand-write guarantee: a manifest edited by hand fails the
 * manifest comparison, and an installed kit that is not in the source list fails
 * the orphan check. The only way to change a kit is to edit the source and
 * re-run `npm run gen:logo-kit`.
 *
 * PORTED from GizmoX `test/logo-kit-conformance.test.ts` (2026-08-15) with one
 * strengthening: the manifest check compares the whole `logos` array AND the
 * signature, because a hand-edit that leaves `signature` alone was found to slip
 * past a signature-only comparison (the same hole this port closed in
 * `scripts/lib/gen-asset.mjs --check`; GizmoX's copy still has it).
 *
 * The assets root comes from `scripts/lib/registry-store.mjs` rather than being
 * spelled a second time here — the studio's cwd is `packages/studio` but the
 * registry lives at the AmberX root, and two spellings of that relationship
 * would drift the first time either moved.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { assetsRoot } from "../scripts/lib/registry-store.mjs";
import { defineLogoKit } from "@axs/logo-kits/define";
import { kitSignature } from "@axs/logo-kits/sign";
import { SOURCE_KITS } from "@axs/logo-kits/kits";
import { MOTIONS, MOTION_IDS, drawingFor } from "@axs/logo-kits/motions";
import { KIT_ID_RE, LOGO_SLUG_RE, MAX_LOGOS_PER_KIT, LOGO_KIT_TYPE } from "@axs/logo-kits/types";

const ASSETS = assetsRoot();
const INSTALLED = path.join(ASSETS, "installed", LOGO_KIT_TYPE);

interface RegistryEntry {
  id: string;
  kind: string;
  version: string;
  archive?: string | null;
}
const registry = JSON.parse(fs.readFileSync(path.join(ASSETS, "registry.json"), "utf8")) as {
  assets: RegistryEntry[];
};

/** The branding pack's drawings, by entry id — what a `pack` motion resolves
 *  against. Read from the generated entries file the app itself renders from,
 *  so a motion naming a drawing that is not really there fails here. */
const PACK_ENTRIES: Map<string, { id: string; svg?: string }> = new Map(
  (
    JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, "..", "src", "packs", "axs-studio-brand.entries.json"), "utf8")
    ) as { entries: { id: string; svg?: string }[] }
  ).entries.map((e) => [e.id, e])
);

for (const input of SOURCE_KITS) {
  const kit = defineLogoKit(input);

  test(`logo_kit ${kit.id}: manifest on disk matches source`, () => {
    const manifestPath = path.join(INSTALLED, kit.id, "manifest.json");
    assert.ok(fs.existsSync(manifestPath), "missing manifest — run npm run gen:logo-kit");
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    assert.equal(m.id, kit.id);
    assert.equal(m.type, LOGO_KIT_TYPE);
    assert.equal(m.authored_by, "framework");
    assert.equal(m.version, kit.version);
    assert.equal(m.name, kit.name);
    assert.equal(m.description, kit.description);
    assert.equal(m.signature, kitSignature(kit), "signature drift — manifest was hand-edited or is stale");
    assert.deepEqual(m.logos, kit.logos, "logos differ from source — the manifest was hand-edited");
  });

  test(`logo_kit ${kit.id}: invariants hold`, () => {
    assert.ok(KIT_ID_RE.test(kit.id));
    assert.ok(
      kit.logos.length >= 1 && kit.logos.length <= MAX_LOGOS_PER_KIT,
      `1..${MAX_LOGOS_PER_KIT} logos, got ${kit.logos.length}`
    );
    const ids = new Set<string>();
    for (const l of kit.logos) {
      assert.ok(l.id.startsWith(`${kit.id}-`), `logo ${l.id} must be prefixed by its kit id`);
      assert.ok(LOGO_SLUG_RE.test(l.slug), `slug ${l.slug}`);
      assert.ok(!ids.has(l.id), `duplicate logo id ${l.id}`);
      ids.add(l.id);
      assert.ok(MOTION_IDS.includes(l.motion), `unknown motion ${l.motion}`);
      assert.equal(
        l.kind,
        MOTIONS[l.motion].animated ? "animated" : "static",
        `kind must match motion ${l.motion}`
      );
    }
  });

  test(`logo_kit ${kit.id}: registered with a real archive`, () => {
    const entry = registry.assets.find((a) => a.id === kit.id && a.kind === LOGO_KIT_TYPE);
    assert.ok(entry, "no registry entry — run npm run gen:logo-kit");
    assert.equal(entry!.version, kit.version);
    assert.ok(entry!.archive, "registry entry has no archive path");
    assert.ok(fs.existsSync(path.join(ASSETS, entry!.archive!)), "archive zip missing on disk");
  });
}

test("logo_kit: every motion a kit names is renderable", () => {
  // The closed motion registry is what makes a kit safe to render sight-unseen.
  // A `css` motion with no keyframe text, or a `brand-smil` one with no variant,
  // would fall through the renderer to the static mark and silently lose its
  // animation — so the registry itself is asserted, not just the kits' use of it.
  for (const id of MOTION_IDS) {
    const m = MOTIONS[id];
    assert.equal(m.id, id, `motion "${id}" disagrees with its key`);
    if (m.engine === "css") {
      assert.ok(m.css && m.css.trim().length > 0, `css motion "${id}" has no keyframe text`);
      assert.ok(m.durationMs > 0, `css motion "${id}" has no duration`);
      assert.equal(m.animated, true, `css motion "${id}" must be animated`);
    }
    if (m.engine === "brand-smil") {
      assert.ok(m.variant, `brand-smil motion "${id}" has no variant`);
      assert.equal(m.animated, true, `brand-smil motion "${id}" must be animated`);
      /*
       * AmberX-only: the branding contract renders one `spinner` glyph for both
       * variants, so without a fallback keyframe `orbit` and `pulse` would be
       * pixel-identical — and `orbit` is the logo the login landing chose. See
       * the port note in `src/logo-kits/motions.ts`. Delete this assertion the
       * day the pack ships real Snap/Glitch drawings.
       */
      assert.ok(
        m.fallbackCss && m.durationMs > 0,
        `brand-smil motion "${id}" needs a fallbackCss + duration while the pack cannot ` +
          `distinguish variants, or it renders identically to the other brand-smil motion`
      );
    }
    if (m.engine === "static") assert.equal(m.animated, false, `static motion "${id}" must not be animated`);
  }
});

test("logo_kit: no motion resolves to the spinner, and every drawing it names exists", () => {
  /*
   * The regression this exists for: `orbit` (engine `brand-smil`) was routed to
   * the animated component, which AmberX's branding shim maps to the `spinner`
   * glyph — a loading ring with an orbiting dot. The login landing therefore drew
   * a SPINNER as its hero instead of the mark, and every gate stayed green,
   * because they all check the kit's DATA and none of them checked the drawing.
   * Found by reading the emitted SVG in the browser.
   *
   * `animated-mark` is legitimate only when the pack ships a real per-variant
   * animated drawing keyed to the Snap/Glitch variants. AmberX's does not, so no
   * motion may select it. `pack` motions are the supported way to reach real
   * animated artwork, and each must name an entry that is actually IN the pack —
   * a typo there is a blank tile, which is the "renders wrong" failure again.
   */
  for (const id of MOTION_IDS) {
    const m = MOTIONS[id];
    const { drawing, glyphId, css } = drawingFor(m);

    assert.notEqual(
      drawing,
      "animated-mark",
      `motion "${id}" resolves to the spinner glyph, which is a loading indicator, not a logo`
    );

    if (drawing === "pack") {
      assert.ok(glyphId, `pack motion "${id}" names no drawing`);
      const entry = PACK_ENTRIES.get(glyphId!);
      assert.ok(entry, `pack motion "${id}" names "${glyphId}", which is not an entry in the branding pack`);
      assert.match(
        entry!.svg ?? "",
        /<animate|animateMotion|animateTransform/,
        `pack motion "${id}" names "${glyphId}", which carries no SMIL — it would render as a still image`
      );
      assert.equal(css, null, `pack motion "${id}" must not also run a CSS animation over its own SMIL`);
      continue;
    }

    assert.equal(drawing, "mark", `motion "${id}" draws "${drawing}"`);
    if (m.animated) assert.ok(css && css.trim().length > 0, `animated motion "${id}" resolves to no keyframe body`);
    else assert.equal(css, null, `static motion "${id}" must resolve to no animation`);
  }
});

test("logo_kit: within a kit, no two logos render identically", () => {
  /*
   * Ten logos that render the same are not ten logos — that is how `orbit` first
   * shipped as a byte-identical copy of `spin`. Distinctness is asserted PER KIT
   * rather than globally, because lk001 and lk002 deliberately both have an
   * "orbit": one is the mark rotating, the other is a pack drawing. Those two are
   * meant to differ, and comparing across kits would flag the pair that is the
   * whole point of having both.
   */
  for (const input of SOURCE_KITS) {
    const kit = defineLogoKit(input);
    const seen = new Map<string, string>();
    for (const logo of kit.logos) {
      const m = MOTIONS[logo.motion];
      if (!m.animated) continue;
      const { glyphId, css } = drawingFor(m);
      const fingerprint = `${glyphId ?? ""}|${css ?? ""}`;
      const prior = [...seen.entries()].find(([, f]) => f === fingerprint);
      assert.ok(!prior, `in ${kit.id}, logos "${prior?.[0]}" and "${logo.slug}" render identically`);
      seen.set(logo.slug, fingerprint);
    }
  }
});

test("logo_kit: no orphan installed kits (every installed kit is framework-authored from source)", () => {
  const installed = fs.existsSync(INSTALLED)
    ? fs.readdirSync(INSTALLED).filter((d) => fs.existsSync(path.join(INSTALLED, d, "manifest.json")))
    : [];
  assert.deepEqual(
    installed.sort(),
    SOURCE_KITS.map((k) => k.id).sort(),
    "an installed kit with no source is an orphan — it cannot have been framework-authored"
  );
});
