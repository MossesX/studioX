#!/usr/bin/env node
/**
 * P1 member migration — AmberX Vid's retired member store onto studio accounts.
 *
 *   npm run migrate:amberxvid -- [--dry-run] [--policy match|separate]
 *
 * or directly, which is the same thing:
 *
 *   node --import ./test/alias-hook.mjs scripts/axv-p1-migrate.mjs [flags]
 *
 * The `--import` is not optional: it is what teaches plain Node the `@axs/*`
 * alias and how to load TypeScript sources, exactly as `npm test` does. This
 * script checks for it and says so rather than failing with a bare
 * ERR_MODULE_NOT_FOUND, which is the error everybody misreads as "the file is
 * missing".
 *
 * Idempotent: once `data/amberxvid/accounts.json` has been renamed to
 * `.retired`, a re-run reports `already-migrated` and changes nothing.
 *
 * `--dry-run` plans everything and writes NOTHING — not the accounts store, not
 * the rename, not the report. Run it first; the plan it prints is the plan the
 * real run executes.
 *
 * The mapping file the phase requires lands at
 * `<AmberX root>/build/projects/axf-amberxvid-social.p1-migration.json`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
process.chdir(studio);

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const policyIdx = argv.indexOf("--policy");
const policy = policyIdx >= 0 ? argv[policyIdx + 1] : "match";
if (policy !== "match" && policy !== "separate") {
  console.error(`--policy must be "match" or "separate" (got "${policy}")`);
  process.exit(2);
}

// Fail with the fix, not with a resolution error somebody has to decode.
if (!process.execArgv.some((a) => a.includes("alias-hook"))) {
  console.error(
    "run this through the alias hook, or `@axs/*` cannot resolve:\n" +
      "  npm run migrate:amberxvid -- " +
      argv.join(" ") +
      "\n  node --import ./test/alias-hook.mjs scripts/axv-p1-migrate.mjs " +
      argv.join(" "),
  );
  process.exit(2);
}

const { migrateMembers } = await import("@axs/modules/amberxvid/lib/migrate-members");
const { dataRoot: accountsRoot } = await import("@axs/modules/accounts/lib/paths");

const report = await migrateMembers(accountsRoot(), { policy, dryRun });

// The AmberX root is two levels up from `packages/studio`; GizmoX sits beside
// it, which is the same relationship `app/api/bmpx/run/route.ts` relies on.
const amberxRoot = path.resolve(studio, "..", "..");
const REPORT = "axf-amberxvid-social.p1-migration.json";
// GizmoX holds the ORIGINAL (it owns build/projects); AmberX gets the mirror.
const out = path.join(amberxRoot, "..", "GizmoX", "build", "projects", REPORT);
const mirror = path.join(amberxRoot, "build", "projects", REPORT);

/**
 * Idempotence covers the RECORD as well as the data.
 *
 * An `already-migrated` report is a status line with `members: []` — writing it
 * over a real mapping would erase which member became which account, which
 * suffix was handed out and which paths moved. That file is the only audit
 * trail the migration leaves, so a re-run preserves it and says so. A first run
 * (`migrated`) still writes, and a missing mapping is still backfilled.
 */
const isStub = report.status === "already-migrated" && report.members.length === 0;

function write(target, body) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
}

if (!dryRun && isStub) {
  // Never write the stub — not over a record, and not into a gap either, where
  // it would read as an authoritative "no members were migrated". If exactly one
  // copy survives, the other is repaired FROM it; that is a real mirror rather
  // than a fresh lie. The status still goes to stdout.
  const live = [out, mirror].filter((f) => fs.existsSync(f));
  if (live.length === 1) {
    const from = live[0];
    const to = from === out ? mirror : out;
    write(to, fs.readFileSync(from, "utf8"));
    console.log(`repaired      ${to} (copied from the surviving record at ${from})`);
  } else if (live.length === 0) {
    console.log("no mapping file on disk, and an already-migrated run has nothing to record");
  } else {
    console.log("kept          both mapping files — the existing record stands");
  }
} else if (!dryRun) {
  const body = `${JSON.stringify(report, null, 2)}\n`;
  write(out, body);
  write(mirror, body);
}

console.log(JSON.stringify(report, null, 2));
console.log("");
console.log(`status        ${report.status}${dryRun ? "  (DRY RUN — nothing written)" : ""}`);
console.log(`policy        ${report.policy}`);
console.log(`members       ${report.members.length}`);
for (const m of report.members) {
  const moved = m.rekeyed.length > 0 ? `, ${m.rekeyed.length} path(s) re-keyed` : "";
  console.log(`  ${m.from} → ${m.to}  [${m.outcome}]${moved}`);
}
console.log(`needs a password from an administrator: ${report.pendingResets}`);
for (const w of report.warnings) console.log(`WARNING  ${w}`);
if (!dryRun && !isStub) {
  console.log(`mapping       ${out}`);
  console.log(`mirror        ${mirror}`);
}

// A warning is not a failure — the migration completed and said what it could
// not do. Only an unreadable source store is a non-zero exit, and that already
// returned `nothing-to-migrate` with the reason in `warnings`.
process.exit(0);
