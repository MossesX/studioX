/**
 * `npm run check:runtime-files` — the §2 gate.
 *
 * INITIATION-PROMPT §2 ends both of its production facts with the same clause:
 * *"a test fails when a module reads a path it did not declare"*, and *"writing
 * anywhere else is a bug a test should catch"*. This is that test, at the
 * command line, next to the other `check:*` gates.
 *
 * Three scans, each for a failure that is SILENT in production:
 *
 *   1. **A second persisted root.** Any server file that assembles
 *      `process.cwd()` + `"data"` on its own is writing outside the mounted
 *      volume the moment `AXS_DATA_ROOT` is set. Nothing errors — the writes
 *      land on the container's ephemeral layer and vanish at the next deploy.
 *      `src/server/dataRoot.ts` is the one file allowed to name it.
 *
 *   2. **An undeclared runtime read.** A path assembled from `cwd` and read
 *      with `node:fs` is invisible to the tracer, so unless a group in
 *      `deploy/runtime-files.mjs` covers it, the directory is simply absent in
 *      the image and the read returns `[]`. An empty list renders as "nothing
 *      installed", which reads as data loss rather than as a packaging bug.
 *
 *   3. **A stale COPY block.** Delegated to `deploy-copy-list.mjs --check`, so
 *      one command answers "is this image going to be complete".
 *
 * Every rule reports the FILE and the LINE and what to do, because a gate whose
 * output is a count is a gate people learn to ignore.
 *
 * Exit 0 clean, exit 1 with one block per violation.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RUNTIME_FILES, PERSISTED_ROOT } from "../deploy/runtime-files.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.resolve(here, "..");

/** Server-side trees only. A client component cannot touch the filesystem, and
 *  `scripts/` and `test/` run on a developer's machine where the repo is real. */
const SCAN_DIRS = ["src", "app"];

/** The one file allowed to resolve the persisted root. */
const DATA_ROOT_OWNER = path.join("src", "server", "dataRoot.ts");

/**
 * The workstation-only surfaces, exempt by design rather than by oversight.
 *
 * Each of these reaches a tree that exists on ONE developer machine — a build
 * checkout, an MCP server roster, `.claude/agents` beside the repo — and each
 * already handles absence by listing nothing. That is the correct behaviour for
 * a local tool reached through a deployed UI, so declaring their inputs would
 * mean shipping a build system and an agent roster to a web host in order to
 * make an empty list slightly less empty.
 *
 * The exemption is per FILE and each entry states its subject, because a broad
 * directory exemption is how a genuinely undeclared read gets in later.
 */
const REPO_ROOT_READERS = [
  // The Build Manager: runs .bmpx builds against ../GizmoX and build/projects/.
  path.join("src", "server", "paths.ts"),
  path.join("app", "api", "bmpx"),
  // Agent Forge: personas and skills under the repo's and the home dir's
  // `.claude/`, plus the `?cwd=` tree the UI asks about by name.
  path.join("src", "modules", "forge", "forge.server.ts"),
  path.join("app", "api", "agent-forge", "route.ts"),
  // The MCP roster: reads `.mcp.json` at the repo root and SPAWNS what it
  // names, with the repo as cwd. A container has neither the file nor the
  // servers, and spawning arbitrary commands is not something to make work
  // there.
  path.join("src", "modules", "forge", "mcp.server.ts"),
  // `resolveAgentDir()` resolves an operator-configured directory spelling
  // against the repo root. The value is configuration, not a shipped path.
  path.join("src", "plugins", "module-assistant", "agents.server.ts")
];

/**
 * Reads whose absence is answered by the IMAGE rather than by a declaration.
 *
 * A separate list from `REPO_ROOT_READERS` on purpose: that one means "correct
 * to find nothing in production", this one means "production supplies it another
 * way". Filing the second under the first would record the wrong reason, and the
 * reason is the only part of an exemption worth keeping.
 */
const SUPPLIED_BY_IMAGE = [
  // ffmpegPath() probes node_modules/ffmpeg-static and falls through to bare
  // "ffmpeg" on PATH. ffmpeg-static is not a dependency of this package, so the
  // probe never hits even in dev; the Dockerfile installs system ffmpeg, which
  // is what the fallback finds. `FFMPEG` overrides both.
  path.join("src", "modules", "amberxvid", "lib", "recordings.ts")
];

const violations = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => {
  const abs = path.join(STUDIO, d);
  return fs.existsSync(abs) ? walk(abs) : [];
});

/**
 * Every declared glob as a REPO-RELATIVE literal prefix.
 *
 * A `studio` glob is relative to `packages/studio`, a `repo` glob to the root,
 * and the reads being checked are written from `packages/studio` with `".."`
 * segments — so all three are put in one coordinate system here rather than
 * compared in their own. The prefix is the part before the first wildcard,
 * which is the most a source expression can be matched against honestly.
 */
const declaredPrefixes = RUNTIME_FILES.flatMap((g) =>
  g.globs.map((glob) => {
    const full = g.base === "studio" ? `packages/studio/${glob}` : glob;
    return { group: g, prefix: full.split("*")[0].replace(/\/$/, "") };
  })
);

/**
 * Resolve the literal segments of a `path.join(process.cwd(), …)` to a
 * repo-relative path.
 *
 * `process.cwd()` is `packages/studio` under `next dev`, `next start` and
 * `node --test` alike — the assumption `KV_ROOT` and `STUDIO_FORGE_ROOT`
 * already make and state. `..` is applied rather than matched textually,
 * because `join(cwd, "..", "..", "assets", "installed", "add-on")` IS the
 * declared assets root and must pass on that fact, not fail on its spelling.
 *
 * Returns null when a segment is not a literal — a computed segment cannot be
 * resolved statically, and guessing at one would produce exactly the confident
 * wrong answer this gate exists to prevent.
 */
function resolveFromCwd(segments) {
  const parts = ["packages", "studio"];
  for (const seg of segments) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null; // above the repo — not ours to police
      parts.pop();
      continue;
    }
    parts.push(...seg.split(/[\\/]/).filter(Boolean));
  }
  return parts.join("/");
}

/**
 * Is this resolved path covered by a declaration — in EITHER direction?
 *
 * The question the gate is actually asking is "will this path exist in the
 * image", and two different relations answer yes:
 *
 *   - the read is INSIDE a declared tree (`assets/installed/add-on` under
 *     `assets/installed/**`) — the file arrives with its tree;
 *   - the read is a DIRECTORY that declared files land in (`forge/` read as a
 *     directory, `forge/agents/**` and `forge/skills/**` declared) — copying a
 *     file creates the directories above it, so the read succeeds.
 *
 * Only the first direction was checked at first, and the second went red on two
 * declarations that were already correct. A gate that cries wolf on its own
 * declarations gets its exemption list padded until it stops meaning anything,
 * which is a worse failure than the one it was guarding.
 */
function declaredCovers(resolved) {
  return declaredPrefixes.some(
    ({ prefix }) =>
      resolved === prefix ||
      resolved.startsWith(`${prefix}/`) ||
      prefix.startsWith(`${resolved}/`)
  );
}

for (const file of files) {
  const rel = path.relative(STUDIO, file);
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    const at = `${rel.replace(/\\/g, "/")}:${i + 1}`;

    // --- 1. a second persisted root ----------------------------------------
    const dataJoin = /process\.cwd\(\)\s*,\s*["']data["']/.exec(line);
    if (dataJoin && rel !== DATA_ROOT_OWNER) {
      violations.push(
        `${at}\n` +
          `  resolves the persisted root itself: process.cwd() + "${PERSISTED_ROOT}"\n` +
          "  In a container AXS_DATA_ROOT names a MOUNTED volume, so this path is on the\n" +
          "  ephemeral layer — the writes work all session and are gone after the next\n" +
          "  deploy, with no error at any point.\n" +
          '  Fix: import { dataPath } from "@axs/server/dataRoot" and call dataPath(...).'
      );
    }

    // --- 2. an undeclared runtime read -------------------------------------
    // `path.join(process.cwd(), "a", "b", …)` — every literal segment, so a
    // `".."` chain resolves instead of being compared as text.
    const cwdJoin = /process\.cwd\(\)((?:\s*,\s*["'][^"']+["'])+)/.exec(line);
    if (cwdJoin) {
      const segments = [...cwdJoin[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
      const resolved = resolveFromCwd(segments);
      const exempt = [...REPO_ROOT_READERS, ...SUPPLIED_BY_IMAGE].some((p) => rel.startsWith(p));
      const persisted = segments[0] === PERSISTED_ROOT;
      if (resolved && !persisted && !exempt && !declaredCovers(resolved)) {
        violations.push(
          `${at}\n` +
            `  reads "${resolved}" at runtime, and nothing in deploy/runtime-files.mjs\n` +
            "  declares it. The standalone tracer only follows imports, so this path will\n" +
            "  not exist in the image — the read returns nothing and the screen above it\n" +
            "  renders its empty state as if that were the truth.\n" +
            "  Fix: add a group to deploy/runtime-files.mjs (id, base, globs, reader, why)\n" +
            "  and run `npm run deploy:copy-list`; or, if this is a workstation-only\n" +
            "  surface that correctly lists nothing in production, add the file to\n" +
            "  REPO_ROOT_READERS in this script WITH the reason."
        );
      }
    }
  });
}

// --- 3. the COPY block ------------------------------------------------------
let copyListStale = null;
try {
  execFileSync(process.execPath, [path.join(here, "deploy-copy-list.mjs"), "--check"], {
    stdio: "pipe"
  });
} catch (e) {
  copyListStale = (e.stderr?.toString() || e.message).trim();
}

if (violations.length === 0 && !copyListStale) {
  console.log(
    `check:runtime-files: clean — ${files.length} server file(s), ` +
      `${RUNTIME_FILES.length} declared group(s), COPY block current`
  );
  process.exit(0);
}

for (const v of violations) console.error(`\n${v}`);
if (copyListStale) console.error(`\n${copyListStale}`);
console.error(
  `\ncheck:runtime-files: ${violations.length} violation(s)${copyListStale ? " + a stale COPY block" : ""}`
);
process.exit(1);
