#!/usr/bin/env node
/**
 * P6 message migration — amberxvid's retired conversation store drained into
 * the accounts message store.
 *
 *   npm run migrate:amberxvid-messages -- [--dry-run]
 *
 * or directly, which is the same thing:
 *
 *   node --import ./test/alias-hook.mjs scripts/axv-p6-messages.mjs [--dry-run]
 *
 * The `--import` is not optional: it is what teaches plain Node the `@axs/*`
 * alias and how to load TypeScript sources, exactly as `npm test` does.
 *
 * Runs AFTER `axv-p1-migrate.mjs` and refuses to run before it — thread ids and
 * every message's `from`/`to` are keyed on the module's retired usernames until
 * P1 re-keys them onto accounts usernames.
 *
 * THE IDENTITY MAPPING is read from P1's own record,
 * `<AmberX root>/build/projects/axf-amberxvid-social.p1-migration.json` (or
 * GizmoX's original, whichever is there — GizmoX owns `build/projects` and
 * AmberX holds the mirror). A missing record is not fatal: every username then
 * maps to itself, which is what P1's `match` policy produced anyway. It IS
 * reported, because "mapped by the record" and "mapped by assumption" are
 * different claims.
 *
 * Idempotent: the marker `data/amberxvid/messages/.message-migration.json` is
 * what makes a re-run report `already-migrated` and change nothing.
 *
 * `--dry-run` plans everything and writes nothing — not the threads, not the
 * renames, not the marker. The plan it prints is the plan the real run executes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
process.chdir(studio);

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

if (!process.execArgv.some((a) => a.includes("alias-hook"))) {
  console.error(
    "run this through the alias hook, or `@axs/*` cannot resolve:\n" +
      `  npm run migrate:amberxvid-messages -- ${argv.join(" ")}\n` +
      `  node --import ./test/alias-hook.mjs scripts/axv-p6-messages.mjs ${argv.join(" ")}`,
  );
  process.exit(2);
}

const { identityMapFrom, migrateMessages } = await import(
  "@axs/modules/amberxvid/lib/migrate-messages"
);

// Same root relationship the P1 script uses: the AmberX root is two levels up
// from `packages/studio`, and GizmoX sits beside it.
const amberxRoot = path.resolve(studio, "..", "..");
const RECORD = "axf-amberxvid-social.p1-migration.json";
const candidates = [
  path.join(amberxRoot, "..", "GizmoX", "build", "projects", RECORD),
  path.join(amberxRoot, "build", "projects", RECORD),
];

let identityMap = {};
let mappingFrom = null;
for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  try {
    identityMap = identityMapFrom(JSON.parse(fs.readFileSync(file, "utf8")));
    mappingFrom = file;
    break;
  } catch {
    /* try the mirror */
  }
}

const report = await migrateMessages({ dryRun, identityMap, mappingFrom });

console.log(JSON.stringify(report, null, 2));
console.log("");
console.log(`status        ${report.status}${dryRun ? "  (DRY RUN — nothing written)" : ""}`);
console.log(`source        ${report.amberxvidRoot}`);
console.log(`target        ${report.accountsRoot}`);
console.log(
  `mapping       ${report.mappingFrom ?? "(none on disk — every username mapped to itself)"}`,
);
console.log(`moved         ${report.moved.length} conversation(s), ${report.messagesMigrated} message(s)`);
for (const m of report.moved) {
  console.log(`  ${m.sourceId} → ${m.threadId}  (${m.messages} message(s))`);
}
for (const s of report.skipped) console.log(`SKIPPED  ${s.from} — ${s.why}`);
for (const w of report.warnings) console.log(`WARNING  ${w}`);

// `blocked` is the one non-zero exit: nothing moved and the reason is an
// ordering mistake a person has to fix, which a silent success would hide.
if (report.status === "blocked") {
  console.error(`\nBLOCKED: ${report.blockedBy}`);
  process.exit(1);
}
process.exit(0);
