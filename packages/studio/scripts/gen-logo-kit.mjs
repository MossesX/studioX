/**
 * @file The logo-kit authoring engine's entry point.
 *
 * Logo-kit assets must be authored by the framework and never by hand (owner
 * directive, 2026-08-15). This script is that author: it reads the source kits
 * (`src/logo-kits/kits`), validates each through `defineLogoKit`, signs it, and
 * writes the real asset (zip + installed dir + registry entry). Nothing else
 * writes a logo kit.
 *
 *   npm run gen:logo-kit      # write
 *   npm run check:logo-kit    # verify only, non-zero on drift
 *
 * The lifecycle itself lives in `scripts/lib/gen-asset.mjs`, shared with the
 * x_landing generator. Runs under `test/alias-hook.mjs` because it imports the
 * TypeScript source directly — the source kits ARE the input, so a generator
 * reading anything else could not be the single author.
 */
import { generateAssets } from "./lib/gen-asset.mjs";

import { defineLogoKit } from "../src/logo-kits/define.ts";
import { kitSignature } from "../src/logo-kits/sign.ts";
import { SOURCE_KITS } from "../src/logo-kits/kits/index.ts";
import { LOGO_KIT_TYPE } from "../src/logo-kits/types.ts";

process.exit(
  generateAssets({
    type: LOGO_KIT_TYPE,
    script: "gen-logo-kit.mjs",
    sources: SOURCE_KITS,
    define: defineLogoKit,
    sign: kitSignature,
    check: process.argv.includes("--check"),
    manifest: (kit, signature) => ({
      id: kit.id,
      name: kit.name,
      version: kit.version,
      type: LOGO_KIT_TYPE,
      description: kit.description,
      author: "AmberX",
      authored_by: kit.authored_by,
      signature,
      logos: kit.logos
    }),
    registryMeta: (kit) => ({
      target: "universal",
      logos: kit.logos.length
    }),
    describe: (kit) => `${kit.logos.length} logo(s)`
  })
);
