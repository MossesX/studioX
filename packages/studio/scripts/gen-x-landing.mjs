/**
 * @file The x_landing authoring engine's entry point — the framework author for
 * landing-page assets.
 *
 * Same contract as `gen-logo-kit.mjs`: validate each source landing through
 * `defineXLanding` (which also checks its asset references RESOLVE), sign it,
 * and write the asset (zip + installed dir + registry entry). Hand-authoring is
 * caught by `--check` and by `test/x-landing-conformance.test.ts`.
 *
 *   npm run gen:x-landing      # write
 *   npm run check:x-landing    # verify only, non-zero on drift
 */
import { generateAssets } from "./lib/gen-asset.mjs";

import { defineXLanding } from "../src/x-landing/define.ts";
import { landingSignature } from "../src/x-landing/sign.ts";
import { SOURCE_LANDINGS } from "../src/x-landing/landings/index.ts";
import { X_LANDING_TYPE } from "../src/x-landing/types.ts";

process.exit(
  generateAssets({
    type: X_LANDING_TYPE,
    script: "gen-x-landing.mjs",
    sources: SOURCE_LANDINGS,
    define: defineXLanding,
    sign: landingSignature,
    check: process.argv.includes("--check"),
    manifest: (landing, signature) => ({
      id: landing.id,
      name: landing.name,
      version: landing.version,
      type: X_LANDING_TYPE,
      description: landing.description,
      author: "AmberX",
      authored_by: landing.authored_by,
      signature,
      route: landing.route,
      role: landing.role,
      assets: landing.assets,
      cardOpacity: landing.cardOpacity
    }),
    registryMeta: (landing) => ({
      target: "core",
      route: landing.route,
      role: landing.role,
      // The composed asset ids, so the registry alone answers "what does this
      // landing depend on" without opening the manifest.
      references: Object.values(landing.assets)
    }),
    describe: (landing) => `route ${landing.route}, logo ${landing.assets.logo}`
  })
);
