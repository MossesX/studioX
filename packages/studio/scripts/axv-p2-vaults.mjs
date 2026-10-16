#!/usr/bin/env node
/**
 * P2 vault migration — the pre-vault flat stores into `users/<vaultKey>/`.
 *
 *   npm run migrate:amberxvid-vaults -- [--dry-run]
 *
 * or directly, which is the same thing:
 *
 *   node --import ./test/alias-hook.mjs scripts/axv-p2-vaults.mjs [--dry-run]
 *
 * The `--import` is not optional: it is what teaches plain Node the `@axs/*`
 * alias and how to load TypeScript sources, exactly as `npm test` does. This
 * script checks for it and says so rather than failing with a bare
 * ERR_MODULE_NOT_FOUND, which is the error everybody misreads as "the file is
 * missing".
 *
 * Runs AFTER `axv-p1-migrate.mjs` and refuses to run before it — the flat
 * stores are keyed on the module's retired usernames until P1 re-keys them onto
 * accounts usernames, and filing those under vaults would put somebody's albums
 * in the wrong member's data location.
 *
 * Idempotent: the marker file `users/.vault-migration.json` is what makes a
 * re-run report `already-migrated` and change nothing. The marker holds the
 * FIRST run's record, so a re-run cannot overwrite the audit trail.
 *
 * `--dry-run` plans everything and writes nothing — not the moves, not the
 * marker. The plan it prints is the plan the real run executes.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
process.chdir(studio);

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

if (!process.execArgv.some((a) => a.includes("alias-hook"))) {
  console.error(
    "run this through the alias hook, or `@axs/*` cannot resolve:\n" +
      `  npm run migrate:amberxvid-vaults -- ${argv.join(" ")}\n` +
      `  node --import ./test/alias-hook.mjs scripts/axv-p2-vaults.mjs ${argv.join(" ")}`,
  );
  process.exit(2);
}

const { migrateVaults } = await import("@axs/modules/amberxvid/lib/migrate-vaults");

const report = await migrateVaults({ dryRun });

console.log(JSON.stringify(report, null, 2));
console.log("");
console.log(`status        ${report.status}${dryRun ? "  (DRY RUN — nothing written)" : ""}`);
console.log(`root          ${report.amberxvidRoot}`);
console.log(`vaults        ${report.users.length ? report.users.join(", ") : "(none)"}`);
console.log(`moved         ${report.moved.length} path(s)`);
for (const m of report.moved) console.log(`  ${m.user}  ${m.what}`);
for (const s of report.skipped) console.log(`SKIPPED  ${s.what} — ${s.why}`);
for (const w of report.warnings) console.log(`WARNING  ${w}`);

// `blocked` is the one non-zero exit: nothing moved and the reason is an
// ordering mistake a person has to fix, which a silent success would hide.
if (report.status === "blocked") {
  console.error(`\nBLOCKED: ${report.blockedBy}`);
  process.exit(1);
}
process.exit(0);
