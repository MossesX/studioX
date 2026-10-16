/**
 * @file `@axf/core` stub for script-time execution of the pack modules
 * (`scripts/check-coverage.mjs`). The packs' only RUNTIME imports from core
 * are `brandRoleRef` (roles) and `REQUIRED_GLYPH_IDS`/`checkCoverage`
 * (requirements) — both files import nothing but each other's types, so this
 * stub keeps Node's module graph tiny while the checks still run against the
 * REAL contract sources, not a copy.
 *
 * Outside `tsconfig.json`'s include set on purpose: the runtime `.ts`
 * extensions below are for Node's type stripping, not for the bundler.
 */
export * from "../../core/src/brand/roles.ts";
export * from "../../core/src/brand/requirements.ts";
