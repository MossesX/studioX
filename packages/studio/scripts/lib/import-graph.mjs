/**
 * The import graph, read off disk (INITIATION-PROMPT.md §5.1 tier 2).
 *
 * Tier 1 makes a boundary violation UNRESOLVABLE (two packages, no shared
 * alias, an `exports` map with no wildcard). This module is the tier that
 * DETECTS what resolution cannot: a file that names the other side without
 * ever resolving it — a type-only import, a specifier behind a cast, a
 * relative path that happens to resolve because both packages share a disk.
 *
 * Four scans, one classifier:
 *
 *   - **core** — walk every file under `packages/core/src` OFF DISK, resolve
 *     every import, fail on anything outside {core itself, node builtins, the
 *     dep set core's own package.json declares}. The allowlist is READ from
 *     that package.json at scan time, never restated here — a dep added there
 *     is allowed here the same day, and a dep removed there goes red here.
 *     On top of that allowlist core carries a NAMED denial of
 *     `@mui/icons-material` (`ICON_KIT_PREFIXES`).
 *
 *     ~~A blanket named denial of `@mui/*` and `@emotion/*` stood here~~ and
 *     was REMOVED on 2026-08-09 (axf-mui.bmpx P1), by owner direction, as a
 *     deliberate reversal rather than a relaxation. The old rule's reasoning
 *     was "core is framework-only, the UI kit belongs to the SDK". The owner's
 *     direction inverted the premise: everything built from here on is MUI, so
 *     the MUI theme object is a contract OF the framework, and core cannot
 *     produce it without `createTheme`. A rule whose premise has been replaced
 *     is deleted, not left in place to be worked around.
 *
 *     **What did NOT change, and is the point of this note:** the allowlist.
 *     Core may import `@mui/material` and `@emotion/*` for exactly one reason
 *     — its own package.json declares them, as peers. Remove them there and
 *     this scan goes red the same run, which is why `check-imports.mjs` now
 *     carries a `mustBeGreen` row asserting the BECAUSE rather than merely the
 *     absence of a complaint. Nothing was widened to let MUI through; a
 *     wrong-headed narrow rule was retired and the general rule left standing.
 *
 *     The named-denial MECHANISM stays, pointed at what is still genuinely
 *     banned. `@mui/icons-material` is excluded permanently in both packages:
 *     every icon resolves through the branding pack's role variables, and a
 *     Material icon paints a shipped hex no theme can reach. The allowlist
 *     alone would catch it today as "not in the declared dep set" — a generic
 *     reason that evaporates the moment somebody adds the dep to make the
 *     message go away. The named rule survives that; declaring the dependency
 *     is exactly the mistake, not the fix.
 *   - ~~**replica**~~ — REMOVED at v0.3.0 P0. A third scan banned the UI kit
 *     from `src/dashboards/*-replica.tsx`, on the grounds that a replica built
 *     from anything but token() primitives proves nothing about the
 *     primitives. `gizmox-replica.tsx` was the only replica that ever existed
 *     and the strip deleted it, so the scan had nothing left to walk — and it
 *     was written to FAIL on an empty set (correctly: a discovering check that
 *     passes over zero files is a green lie). Keeping it would have meant a
 *     permanently red gate guarding a file that no longer exists. Deleted
 *     deliberately rather than quietly relaxed to allow zero, which is the
 *     move that turns a real guard into decoration. If a replica dashboard is
 *     ever built again, restore this scan with it — the shape is in the P0
 *     archive.
 *   - **studio** — the same walk in reverse over the SDK's shipped surface
 *     (`src/`, `app/`, `test/`): no file may import a core deep path — the
 *     barrel `@axf/core` is the one way in. `scripts/` is deliberately OUT of
 *     scope: the check-* tooling executes core's real contract sources under
 *     Node by design (`_axf-core-stub.ts`, `check-toolbar.mjs`, …) — that is
 *     framework tooling reading the chokepoint it verifies, not the SDK
 *     importing internals, and scanning it would force those checks through a
 *     stub that drifts.
 *   - **app** — a generated standalone app (a peel, the bare-core fixture) is
 *     SELF-CONTAINED: everything resolves inside its own directory, through
 *     its vendored `@axf/core` barrel, or to its declared deps.
 *
 * Discovery does the enforcement work: the walk finds subjects on disk, so a
 * new core file joins the scan the day it exists, with no edit here. The
 * scanner is regex-based over raw source — it reads STRING LITERALS in import
 * position, so a violating specifier in a comment or template literal can
 * false-positive; the green gates in test/isolation-guards.test.ts are what
 * keep that honest (a hit is either a real leak or dead text worth deleting).
 *
 * Zero dependencies, `node:fs` only — framework tooling per INITIATION §0.1.
 */
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

/** Everything the walk treats as code. */
export const CODE_EXTS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

/** Never walked: installs, build output, recordings, and a peel's vendored
 *  framework (a byte-copy of core — the live core scan already covers it). */
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "captures", "vendor"]);

const BUILTINS = new Set(builtinModules);

/**
 * The Material icon set, as a specifier prefix. Banned everywhere, forever,
 * and named rather than left to the dep-set message — see the header.
 *
 * Matched by PREFIX so `@mui/icons-material/Menu` and any deep path into it
 * are covered without an edit here. `@mui/material` is deliberately NOT a
 * prefix of this: `"@mui/material".startsWith("@mui/icons-material")` is
 * false, so the framework kit passes and the icon set does not.
 */
export const ICON_KIT_PREFIXES = ["@mui/icons-material"];

/** `denyPackages` entries for a context, with the reason it is banned THERE.
 *  A violation report that cannot say WHY is a violation report nobody acts
 *  on — and a generic reason is the one somebody silences by declaring the
 *  dependency. */
const iconKitDenials = (why) => ICON_KIT_PREFIXES.map((prefix) => ({ prefix, why }));

/** Walk `root` and return every code file, sorted for stable reports. A root
 *  that is itself a code file returns just that file — the replica scan roots
 *  at named files rather than a directory. */
export function walkCodeFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  if (fs.statSync(root).isFile()) {
    return CODE_EXTS.has(path.extname(root)) ? [root] : out;
  }
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs);
      } else if (CODE_EXTS.has(path.extname(entry.name))) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

/**
 * Every import specifier in `source`, with its 1-based line. Catches static
 * imports, re-exports, side-effect imports, literal dynamic `import()` and
 * literal `require()`. A dynamic import of a VARIABLE is invisible to any
 * static scan — that class of leak is what the behavioural fixtures
 * (bare-core boot, the peel assertion) exist to catch.
 */
export function scanSpecifiers(source) {
  const patterns = [
    /\bimport\s+[^"'()]*?\bfrom\s*["']([^"'\n]+)["']/g,
    /\bexport\s+[^"'()]*?\bfrom\s*["']([^"'\n]+)["']/g,
    /\bimport\s*["']([^"'\n]+)["']/g,
    /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g
  ];
  const seen = new Set();
  const out = [];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const key = `${m.index}:${m[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ specifier: m[1], line: source.slice(0, m.index).split("\n").length });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** The package name of a bare specifier: `react/jsx-runtime` → `react`,
 *  `@axf/core/src/x` → `@axf/core`. */
export function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const isInside = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * Classify one specifier against a boundary context. Returns `null` when the
 * import is allowed, otherwise the reason it is a violation. Pure — the CLI's
 * self-check runs the red path through THIS function on every invocation.
 *
 * ctx:
 *   - `within`        resolved relative imports must stay inside this dir
 *   - `denyInto`      dirs a relative import must never resolve into
 *   - `denyDeep`      specifier prefixes that are always violations
 *   - `denyPackages`  `{ prefix, why }` bans checked BEFORE `allowPackages`,
 *                     so the named reason wins over the generic
 *                     "not in the declared dep set" — and still fires when the
 *                     package IS declared, which is the whole point of naming it
 *   - `allowPackages` bare package names allowed (null = any bare package)
 */
export function classifySpecifier(specifier, fileDir, ctx) {
  for (const prefix of ctx.denyDeep ?? []) {
    if (specifier.startsWith(prefix)) {
      return `deep path "${specifier}" — the public barrel is the only way in`;
    }
  }
  for (const { prefix, why } of ctx.denyPackages ?? []) {
    if (specifier.startsWith(prefix)) {
      return `banned package "${specifier}" — ${why}`;
    }
  }
  if (specifier.startsWith(".")) {
    const resolved = path.resolve(fileDir, specifier);
    for (const dir of ctx.denyInto ?? []) {
      if (isInside(dir, resolved)) {
        return `relative import resolves into ${path.basename(dir)}/ (${specifier})`;
      }
    }
    if (ctx.within && !isInside(ctx.within, resolved)) {
      return `relative import escapes the package (${specifier})`;
    }
    return null;
  }
  if (specifier.startsWith("node:") || BUILTINS.has(packageName(specifier))) {
    return null;
  }
  if (ctx.allowPackages && !ctx.allowPackages.has(packageName(specifier))) {
    return `package "${packageName(specifier)}" is not in the declared dep set`;
  }
  return null;
}

/**
 * Run one scan spec: walk its roots, classify every specifier.
 *
 * A file that DISAPPEARS between the walk and the read is skipped rather than
 * thrown on. That window is real and it is not hypothetical: `node --test` runs
 * test FILES concurrently, and `ctx-conformance.test.ts` plants and removes
 * `src/__mutation.commands.ts` while `isolation-guards.test.ts` is scanning the
 * same tree. The scan crashed with ENOENT and was reported as
 * "no SDK file imports a core deep path — FAILED", which is a boundary
 * violation that did not happen. `isolation-guards.test.ts` reasoned about this
 * for its OWN plants (green and red share one file so they run sequentially)
 * and could not account for another file's.
 *
 * Skipping is correct rather than merely convenient: a file that no longer
 * exists cannot import anything, so it is not a subject. Only ENOENT is
 * swallowed — a permissions error or a corrupt read is a genuine problem with
 * the scan and must still be loud.
 */
export function importViolations({ roots, ctx }) {
  const violations = [];
  const walked = roots.flatMap((root) => walkCodeFiles(root));
  const files = [];
  for (const file of walked) {
    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") continue;
      throw err;
    }
    files.push(file);
    const fileDir = path.dirname(file);
    for (const { specifier, line } of scanSpecifiers(source)) {
      const reason = classifySpecifier(specifier, fileDir, ctx);
      if (reason) violations.push({ file, line, specifier, reason });
    }
  }
  return { files, violations };
}

/** Core imports nothing of studio's — nothing of ANYONE'S beyond its own
 *  declared deps, and never the Material icon set even if somebody declares
 *  it. The allowlist is core's package.json, read now; the icon-set denial is
 *  named. `@mui/material` and `@emotion/*` now pass this scan, and they pass
 *  it BECAUSE core declares them as peers — nothing here was widened. */
export function coreScanSpec(coreDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(coreDir, "package.json"), "utf8"));
  return {
    roots: [path.join(coreDir, "src")],
    ctx: {
      within: coreDir,
      denyPackages: iconKitDenials(
        "every icon in AmberX resolves through the branding pack's role " +
          "variables (--axf-brand-* / --gxb-*), so it recolours with the theme. " +
          "A Material icon paints a shipped hex no theme can reach. Use the " +
          "pack; declaring the dependency is the mistake, not the fix"
      ),
      allowPackages: new Set(Object.keys(pkg.peerDependencies ?? {}))
    }
  };
}

/* `replicaFiles()` and `replicaScanSpec()` were removed at v0.3.0 P0 with the
 * replica dashboard they scanned — see the header. `iconKitDenials()` stays
 * because the core scan is its caller and the icon-set rule is still live;
 * its predecessor `uiKitDenials()` was retired with the @mui/* ban it served,
 * on 2026-08-09, when the owner reversed the premise that core is MUI-free. */

/** The reverse: no SDK file imports a core deep path, by name or by walking. */
export function studioScanSpec(studioDir, coreDir) {
  return {
    roots: [path.join(studioDir, "src"), path.join(studioDir, "app"), path.join(studioDir, "test")],
    ctx: {
      denyDeep: ["@axf/core/"],
      denyInto: [coreDir],
      allowPackages: null
    }
  };
}

/** A generated standalone app (peel output, the bare-core fixture): resolves
 *  nothing outside itself except its declared deps and the vendored barrel. */
export function appScanSpec(appDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
  return {
    roots: [path.join(appDir, "src"), path.join(appDir, "app")],
    ctx: {
      within: appDir,
      denyDeep: ["@axf/core/"],
      allowPackages: new Set(Object.keys(pkg.dependencies ?? {}))
    }
  };
}

/** One line per violation, for gates and CLIs. */
export function formatViolations(violations, base) {
  return violations
    .map((v) => `${path.relative(base, v.file)}:${v.line}  ${v.reason}`)
    .join("\n");
}
