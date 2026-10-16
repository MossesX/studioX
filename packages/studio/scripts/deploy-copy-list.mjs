/**
 * `npm run deploy:copy-list` — regenerate the Dockerfile's COPY block from
 * `deploy/runtime-files.mjs`, and `--check` to fail when the two have drifted.
 *
 * INITIATION-PROMPT §2.1 asks for exactly this: *"a script generates the
 * Dockerfile's COPY list from those declarations"*. The alternative — a
 * hand-written COPY block beside a hand-written declaration list — is two lists
 * that agree on the day they are written and diverge on the first edit, and the
 * divergence is invisible until a container is running in production with a
 * directory missing.
 *
 * Only the `repo`-based groups appear in the block. Studio-based groups are
 * INSIDE the tracing root, so `outputFileTracingIncludes` (also generated from
 * the same declarations, in `next.config.ts`) has already put them in
 * `.next/standalone` before the runner stage begins; copying them again would
 * be a second mechanism for one job.
 *
 * The block is delimited by markers rather than rewritten wholesale, because
 * everything around it — the stages, the user, the volume — is hand-written and
 * carries its own reasoning.
 *
 *   node scripts/deploy-copy-list.mjs           write the block
 *   node scripts/deploy-copy-list.mjs --check   exit 1 if it is stale
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { repoGroups, IMAGE_ASSETS_ROOT } from "../deploy/runtime-files.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCKERFILE = path.join(here, "..", "Dockerfile");

const BEGIN = ">>> BEGIN GENERATED COPY LIST";
const END = ">>> END GENERATED COPY LIST";

/**
 * One COPY per glob.
 *
 * A trailing `/**` means "the directory" to the declaration's readers and to a
 * glob library, but Docker's COPY takes the directory itself and recurses — so
 * the suffix is stripped here rather than being left out of the declaration,
 * where it would make the same entry mean different things to the three
 * consumers.
 */
function lines() {
  const out = [`# ${BEGIN} — \`npm run deploy:copy-list\` (do not edit) <<<`];
  for (const group of repoGroups()) {
    // The first sentence of `why` — the full paragraph belongs in the
    // declaration, but a bare COPY with no reason invites deletion.
    out.push(`# ${group.id} — ${group.why.split(". ")[0]}.`);
    for (const glob of group.globs) {
      const src = glob.replace(/\/\*\*$/, "");
      const dest = path.posix.join(IMAGE_ASSETS_ROOT, path.posix.basename(src));
      out.push(`COPY --chown=nextjs:nodejs ${src} ${dest}`);
    }
  }
  out.push(`# ${END} <<<`);
  return out.join("\n");
}

const dockerfile = fs.readFileSync(DOCKERFILE, "utf8");
const start = dockerfile.indexOf(`# ${BEGIN}`);
const finish = dockerfile.indexOf(`# ${END}`);

if (start === -1 || finish === -1) {
  console.error(
    `deploy:copy-list: the markers are gone from ${path.relative(process.cwd(), DOCKERFILE)}.\n` +
      `  The generated block is delimited by "${BEGIN}" and "${END}".\n` +
      "  Restore them around the COPY lines rather than deleting this script's target."
  );
  process.exit(1);
}

const endOfEnd = dockerfile.indexOf("\n", finish);
const current = dockerfile.slice(start, endOfEnd === -1 ? undefined : endOfEnd);
const wanted = lines();

if (current === wanted) {
  console.log(`deploy:copy-list: up to date (${repoGroups().length} declared group(s))`);
  process.exit(0);
}

if (process.argv.includes("--check")) {
  console.error(
    "deploy:copy-list: the Dockerfile's COPY block is STALE.\n" +
      "  deploy/runtime-files.mjs has changed and the image would ship the old set —\n" +
      "  which does not fail the build, it fails the running container.\n" +
      "  Run: npm run deploy:copy-list"
  );
  console.error("\n--- want ---\n" + wanted + "\n--- have ---\n" + current);
  process.exit(1);
}

fs.writeFileSync(
  DOCKERFILE,
  dockerfile.slice(0, start) + wanted + dockerfile.slice(endOfEnd === -1 ? dockerfile.length : endOfEnd),
  "utf8"
);
console.log(
  `deploy:copy-list: wrote ${wanted.split("\n").length - 2} line(s) from ` +
    `${repoGroups().length} declared group(s)`
);
