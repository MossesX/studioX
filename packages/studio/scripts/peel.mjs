/**
 * `npm run peel <moduleId>` — compile a module into a standalone application
 * directory (INITIATION-PROMPT.md §3, the peel-off contract).
 *
 * What comes out, at `<pre-build>/peeled/<moduleId>/`:
 *
 *   - **A vendored framework.** The whole of `packages/core` is copied into
 *     `vendor/axf-core/` and the app depends on `@axf/core` as
 *     `file:vendor/axf-core`. The peeled app resolves NOTHING from the dev
 *     tree at runtime — it cannot break when the framework moves on, and the
 *     accepted cost (a framework fix does not reach peeled apps) is why
 *     `peel.manifest.json` records the exact framework version vendored and
 *     why the peel is re-runnable to refresh one.
 *   - **The closure.** The module's source, plus every plugin with a
 *     contribution to one of the module's DECLARED points. Declared-points-as-
 *     data is what makes this computable: the module's `<id>.decl.ts` and each
 *     plugin's `plugin.ts` are data-only files this script imports under plain
 *     Node (type stripping, no JSX), so the closure is read from the same
 *     declarations the runtime registry validates.
 *   - **A generated app**: Next skeleton, a boot subsystem that registers the
 *     module + its carried contributions + a generated banner + the module's
 *     declared nav menu (when its decl carries one), the module's route, and
 *     `/api/health` reporting the live registry against the manifest.
 *   - **COMPANION MODULES** (`--with <moduleId>`, repeatable). A module whose
 *     identity, storage or messaging lives in ANOTHER module cannot be peeled
 *     alone — amberxvid on the accounts module is the case that forced this,
 *     and it is the identity decision's cost, paid here rather than hidden.
 *     Each companion resolves through the SAME `loadModuleDecl`, its directory
 *     is copied, its `app/api/<id>/**` routes ride the existing server-closure
 *     walk, and the generated boot registers it AFTER the primary so the
 *     registry, menus and settings compose. The primary's route stays the
 *     app's entry; a companion's screens are reachable, never the landing.
 *   - **The module's SIDECAR**, when it has one. A `media-server/` directory
 *     inside the module dir travels with it, and the generated app gets the
 *     `media` script, its loader hook and a README stating the two-process run
 *     with the env vars the sidecar and the app halves each read.
 *
 * Re-runnable: everything except `node_modules/` and `package-lock.json` is
 * wiped and regenerated on every run, so refreshing a peeled app against a
 * newer framework is `npm run peel <id>` again — nothing is merged, nothing
 * drifts.
 *
 * Conventions this script enforces (and the peeled typecheck re-checks):
 *   - `src/modules/<id>/<id>.decl.ts` exports the module's `ModuleDecl`.
 *   - `src/modules/<id>/<id>.module.ts` exports `<ID>_MODULE` (SCREAMING_SNAKE
 *     of the id) — the composed, branded module.
 *   - `src/plugins/<pluginId>/plugin.ts` is data-only and exports its
 *     contributions as named consts. A plugin declaration that imports React
 *     cannot be scanned and is reported, loudly, as unscanned.
 *
 * The resolution itself — framework version, declaration, plugin closure —
 * lives in scripts/lib/closure.mjs, SHARED with the suite resolver
 * (INITIATION §4.4: one resolver, two directions; the peel is the outward
 * one). This script owns only what is peel-specific: vendoring and the
 * generated app.
 *
 * Zero dependencies, Node ≥ 23 (native type stripping). Framework tooling per
 * INITIATION §0.1 — it ships nothing of itself into the app.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { loadModuleDecl, readFrameworkVersion, scanCarriedPlugins } from "./lib/closure.mjs";
import { packageName, scanSpecifiers, walkCodeFiles } from "./lib/import-graph.mjs";
import { readBundle } from "./lib/module-agent.mjs";
import { peerDepsForGeneratedApp } from "./lib/core-peers.mjs";
import { loaderSource } from "./lib/loader-template.mjs";
import { notAMutation } from "./lib/mutation.mjs";
import { loadRegistry } from "./lib/registry-store.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const PACKAGES = path.resolve(STUDIO, "..");
const CORE = path.join(PACKAGES, "core");
const PRE_BUILD = path.resolve(PACKAGES, "..");
const PEELED_ROOT = path.join(PRE_BUILD, "peeled");

/** Files/dirs a re-run preserves: the install, the record of the install —
 *  and since the plugin engine (2026-08-13), the app's own STATE: `assets/`
 *  (the ledger, archives and installed plugin copies) and `data/` (the kv
 *  store). A re-peel refreshes the framework; it does not factory-reset the
 *  app, and INITIATION §3's "re-runnable to refresh one" is only true if
 *  what the user installed survives the refresh. The imported plugins' SOURCE
 *  dirs are wiped with the rest of `src/` and re-materialised below from the
 *  preserved installed copies — provably what the archive holds, the same
 *  property `pack.mjs` step 3 maintains. */
const KEEP_ON_RERUN = new Set(["node_modules", "package-lock.json", "assets", "data"]);

const PEEL_FORMAT = "axf-peel/1";

function fail(message) {
  console.error(`\npeel: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flags = new Map();
const positional = [];
/** Flags that are ON/OFF and take no value. Without this set, the loop below
 *  reads the NEXT token as every flag's value — which is right for `--port 3260`
 *  and silently eats the following flag for `--yes --no-agent`. Found the hard
 *  way: `peel demo --yes --no-agent` ran the agent step anyway. */
const BOOLEAN_FLAGS = new Set(["yes", "no-agent", "refresh-agent"]);
/** Flags that may be given MORE THAN ONCE and accumulate. `--with` is the only
 *  one: an app may need two companions as easily as one, and a Map that keeps
 *  the last value would silently drop the first — the same class of bug the
 *  BOOLEAN_FLAGS set above exists to have ended. */
const MULTI_FLAGS = new Set(["with"]);
const repeated = new Map();
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) {
    positional.push(args[i]);
    continue;
  }
  const name = args[i].slice(2);
  if (BOOLEAN_FLAGS.has(name)) flags.set(name, "true");
  else if (MULTI_FLAGS.has(name)) {
    const list = repeated.get(name) ?? [];
    list.push(args[++i] ?? "");
    repeated.set(name, list);
  } else flags.set(name, args[++i] ?? "");
}
const moduleId = positional[0];
if (!moduleId || !/^[a-z][a-z0-9-]*$/.test(moduleId)) {
  fail(
    "usage: npm run peel <moduleId> [-- --with <companionId> --port <n> --out <dir> " +
      "--yes --no-agent --refresh-agent]"
  );
}
const companionIds = repeated.get("with") ?? [];
for (const id of companionIds) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`--with expects a module id, got ${JSON.stringify(id)}`);
  if (id === moduleId) {
    fail(`--with ${id} names the module being peeled — a module is not its own companion`);
  }
}
if (new Set(companionIds).size !== companionIds.length) {
  fail(`--with names a companion more than once: ${companionIds.join(", ")}`);
}
const port = Number(flags.get("port") ?? 3260) || 3260;
const OUT = path.resolve(flags.get("out") ?? path.join(PEELED_ROOT, moduleId));

// ---------------------------------------------------------------------------
// 1–3. Resolve: framework version, declaration, plugin closure — the shared
// resolver (scripts/lib/closure.mjs), pointed outward at one module.
// ---------------------------------------------------------------------------
let frameworkVersion, corePkg, decl, moduleDir, MODULE_EXPORT;
try {
  ({ frameworkVersion, corePkg } = readFrameworkVersion(CORE));
  ({ decl, moduleDir, moduleExport: MODULE_EXPORT } = await loadModuleDecl(STUDIO, moduleId, CORE));
} catch (err) {
  fail(String(err?.message ?? err));
}

/**
 * The COMPANIONS, resolved through the same door the primary went through —
 * `loadModuleDecl`, which is what makes "each companion's decl loads through
 * the same loadModuleDecl" a fact rather than a promise: a companion with no
 * `<id>.decl.ts`, a bad route, an invalid nav or invalid menus fails the peel
 * here, naming itself, exactly as the primary would.
 *
 * Order is the ORDER GIVEN, and it is load-bearing: the generated boot
 * registers them in this order after the primary, so a companion that another
 * companion leans on is named first by the operator rather than sorted into
 * place by this script.
 */
const companions = [];
for (const id of companionIds) {
  try {
    const loaded = await loadModuleDecl(STUDIO, id, CORE);
    companions.push({ id, ...loaded });
  } catch (err) {
    fail(`--with ${id}: ${String(err?.message ?? err)}`);
  }
}

const pluginsRoot = path.join(STUDIO, "src", "plugins");
const { carried, unscanned, violations, disabled, left } = await scanCarriedPlugins({
  studioDir: STUDIO,
  coreDir: CORE,
  decl
});

// A plugin whose declaration cannot run under plain Node cannot be peeled
// ANYWHERE — keep going, but never silently.
for (const u of unscanned) {
  console.warn(
    `peel: WARNING — src/plugins/${u.plugin}/plugin.ts failed to import under Node ` +
      `(is it data-only?): ${u.error}`
  );
}

if (violations.length) {
  for (const v of violations) console.error(`  ${v.plugin} → ${v.point}: ${v.problem}`);
  fail("closure contains invalid contributions — a peel that ships them ships a blank pane");
}

// ---------------------------------------------------------------------------
// 3b. The module's AGENT — built before anything is copied, because the bundle
// lands in `src/modules/<id>/agent/` and step 6 copies that directory whole.
//
// Owner, 2026-08-13: *"create an agent for every existing and new module every
// time it's built … when a module is compiled and shipped as an app it will
// include this 1 default agent but others can be installed via plugins."* This
// is the "every time it's built" half; `npm run agent <id>` is the same step on
// its own, and the add-on/plugin route is unchanged (the scanner still reads
// installed add-on assets, so a shipped app's roster still grows).
//
// The naming prompt is the builder's, not the peel's — studio dialog, then
// PyQt6, then the terminal. `--no-agent` skips the step entirely (the bundle
// already on disk is still carried); `--yes` accepts the derivation without
// asking, which is what a scripted or CI peel wants.
// ---------------------------------------------------------------------------
if (!flags.has("no-agent")) {
  const agentArgs = [
    path.join(import.meta.dirname, "module-agent.mjs"),
    moduleId,
    "--source=peel",
    ...(flags.has("yes") ? ["--yes"] : []),
    ...(flags.has("refresh-agent") ? ["--refresh"] : [])
  ];
  const built = spawnSync(process.execPath, agentArgs, { stdio: "inherit", cwd: STUDIO });
  if (built.status !== 0) {
    fail(
      `the agent step failed (exit ${built.status}). Re-run \`npm run agent ${moduleId}\` to see why, ` +
        `or peel with --no-agent to ship whatever bundle is already on disk.`
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Prepare the output directory (re-runnable: keep only the install)
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
for (const entry of fs.readdirSync(OUT)) {
  if (!KEEP_ON_RERUN.has(entry)) fs.rmSync(path.join(OUT, entry), { recursive: true, force: true });
}

const write = (rel, content) => {
  const abs = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

// ---------------------------------------------------------------------------
// 5. Vendor the framework
// ---------------------------------------------------------------------------
const vendorDir = path.join(OUT, "vendor", "axf-core");
fs.mkdirSync(vendorDir, { recursive: true });
for (const f of ["package.json", "tsconfig.json"]) {
  fs.copyFileSync(path.join(CORE, f), path.join(vendorDir, f));
}
// `notAMutation` on every copy below: the live trees are read while test files
// run concurrently, and a planted mutation removed mid-copy is an ENOENT that
// looks like a broken generator. A peeled app must never ship one anyway.
fs.cpSync(path.join(CORE, "src"), path.join(vendorDir, "src"), {
  recursive: true,
  filter: notAMutation
});

// ---------------------------------------------------------------------------
// 6. Copy the closure's source
// ---------------------------------------------------------------------------
fs.cpSync(moduleDir, path.join(OUT, "src", "modules", moduleId), {
  recursive: true,
  filter: notAMutation
});
// Companions travel whole, exactly as the primary does — same directory, same
// path, no rewriting. A companion is a MODULE, not a library extracted from
// one: half of accounts is what the other half's session cookie means.
for (const c of companions) {
  fs.cpSync(c.moduleDir, path.join(OUT, "src", "modules", c.id), {
    recursive: true,
    filter: notAMutation
  });
}
for (const { plugin } of carried) {
  fs.cpSync(path.join(pluginsRoot, plugin), path.join(OUT, "src", "plugins", plugin), {
    recursive: true,
    filter: notAMutation
  });
}

// ---------------------------------------------------------------------------
// 6a. Universal plugins' HOST CONTRACTS (see `hostContract` in closure.mjs).
//
// A universal plugin is host-independent in its CONTRIBUTIONS but not always in
// its surroundings: the Module Assistant needs a point declared, its commands
// registered, a mount on every route, its API routes and the server files those
// routes import. All of that is stated in the plugin's own manifest, so this
// step is a generic reader rather than a peel that knows the assistant's name.
//
// Each piece fails LOUDLY when it cannot be satisfied. A peeled app whose chat
// window renders and then 500s on its first turn is worse than a peel that
// stops and says which file moved.
// ---------------------------------------------------------------------------
const hosts = carried.filter((c) => c.host);

/** The SDK's point declarations, read from source so a peeled app declares the
 *  same point Studio does. Loaded only when a contract asks for one. */
let studioPoints = null;
async function studioPoint(id) {
  if (!studioPoints) {
    const mod = await import(pathToFileURL(path.join(STUDIO, "src", "studio.points.ts")).href);
    studioPoints = Object.values(mod).find(Array.isArray) ?? [];
  }
  const point = studioPoints.find((p) => p.id === id);
  if (!point) {
    fail(
      `a carried plugin's manifest asks the host to declare "${id}", but src/studio.points.ts ` +
        `declares no such point — the contract and the SDK have drifted`
    );
  }
  return point;
}

/**
 * Every bare (npm) specifier any walk below has seen, as PACKAGE names. Used
 * to declare what the carried source actually needs — see the dependency
 * block in step 7. Collected during the walk rather than declared anywhere,
 * because a list of packages maintained beside the code is a list that goes
 * stale the first time somebody adds an import.
 */
const carriedPackages = new Set();

/**
 * Copy a set of ENTRY files and everything they import, transitively, to the
 * same studio-relative paths in the generated app.
 *
 * Only LOCAL specifiers are followed — `@axs/*` (the studio's own alias, which
 * the generated tsconfig maps to this app's `src/`) and relative paths.
 * Packages are somebody else's problem at COPY time: `@axf/core` is vendored,
 * node builtins are the runtime's, and the rest are recorded in
 * `carriedPackages` and declared as dependencies below. A local import that
 * resolves to no file fails the peel, because the alternative is an app that
 * builds and then 500s on first use.
 *
 * `alreadyCopied` names studio-relative directory prefixes whose files came
 * over WHOLE (a carried plugin directory, a module directory). Those files are
 * still WALKED — their imports are exactly how `@axs/server/axfKv` and
 * `@axs/defaults/default-state` reach a peeled app — but not re-copied, so the
 * walk never overwrites a file the copy step already placed.
 */
/** Studio-relative files the generated app replaces with its own (see the
 *  `write("src/boot.ts", …)` below). */
const GENERATED_BY_PEEL = new Set(["src/boot.ts"]);

function copyServerClosure(label, entries, alreadyCopied = []) {
  const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", ".json", "/index.ts", "/index.tsx"];
  const queue = [...entries];
  const seen = new Set();
  const copied = [];
  while (queue.length) {
    const rel = queue.shift().replace(/\\/g, "/");
    if (seen.has(rel)) continue;
    seen.add(rel);
    // Files this script GENERATES for the app are neither copied nor walked.
    // `LoginScreen.tsx` (accounts) imports `../../boot`, which in the peeled
    // app is the generated boot below — but in the STUDIO tree it is the SDK
    // boot, whose `studio.subsystem` imports every module and plugin panel.
    // Following it dragged the whole studio into a `--with accounts` peel and
    // failed on the first panel with a non-.ts import (2026-10-16).
    if (GENERATED_BY_PEEL.has(rel)) continue;
    const from = path.join(STUDIO, rel);
    if (!fs.existsSync(from)) {
      fail(`${label}: the closure reaches ${rel}, which does not exist — the contract is stale`);
    }
    // A planted guard mutation must never ship, and must never fail a peel
    // that raced one — the same reason every cpSync above filters on it.
    if (!notAMutation(rel)) continue;
    const inPlace = alreadyCopied.some((prefix) => rel.startsWith(prefix));
    if (!inPlace) {
      const to = path.join(OUT, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied.push(rel);
    }

    const source = fs.readFileSync(from, "utf8");
    for (const { specifier } of scanSpecifiers(source)) {
      let target = null;
      if (specifier.startsWith("@axs/")) target = `src/${specifier.slice(5)}`;
      else if (specifier.startsWith(".")) {
        target = path.posix.join(path.posix.dirname(rel), specifier);
      } else {
        if (!specifier.startsWith("node:")) carriedPackages.add(packageName(specifier));
        continue;
      }
      const resolved = EXTENSIONS.map((ext) => `${target}${ext}`).find((candidate) =>
        fs.existsSync(path.join(STUDIO, candidate))
      );
      if (!resolved) {
        fail(
          `${label}: ${rel} imports "${specifier}", which resolves to no file under packages/studio ` +
            `— the peeled app would ship a route that cannot build`
        );
      }
      queue.push(resolved);
    }
  }
  return copied;
}

/** Studio-relative directory prefixes already copied WHOLE above. Every walk
 *  below still reads these files — that is how a module reaches
 *  `@axs/server/axfKv` — but never re-writes one. */
const alreadyCopiedDirs = [
  `src/modules/${moduleId}/`,
  ...companions.map((c) => `src/modules/${c.id}/`),
  ...carried.map(({ plugin }) => `src/plugins/${plugin}/`)
];

const copiedServerFiles = [];
const hostPointLiterals = [];
const hostCommandImports = [];
const hostCommandCalls = [];
const hostMountPoints = [];
const hostToolbarItems = [];
const hostDependencies = [];

for (const { plugin, host } of hosts) {
  for (const id of host.points) {
    const point = await studioPoint(id);
    hostPointLiterals.push({ plugin, point });
  }
  if (host.commands) {
    const [file, exportName] = host.commands.split("#");
    if (!file || !exportName) {
      fail(`${plugin}: host.commands must be "<file>#<export>", got ${JSON.stringify(host.commands)}`);
    }
    const source = path.join(pluginsRoot, plugin, `${file}.ts`);
    if (!fs.existsSync(source)) fail(`${plugin}: host.commands names ${file}.ts, which does not exist`);
    hostCommandImports.push(`import { ${exportName} } from "./plugins/${plugin}/${file}";`);
    hostCommandCalls.push(`    ${exportName}();`);
  }
  if (host.mount) hostMountPoints.push({ plugin, point: host.mount });
  for (const item of host.toolbar) {
    // The command has to exist in the peeled app, or the banner ships a button
    // that throws when pressed. It exists exactly when the plugin also brought
    // its command registration — so the pairing is checked here rather than
    // discovered by a user clicking.
    if (!host.commands) {
      fail(
        `${plugin}: host.toolbar names the command "${item.command}" but the manifest declares no ` +
          `host.commands — a generated banner would ship a button nothing registers`
      );
    }
    hostToolbarItems.push({ plugin, item });
  }

  // The server files those routes import from outside the plugin directory,
  // and everything THOSE files import in turn. Copied to the same
  // studio-relative paths, so every import resolves unchanged — no rewriting of
  // carried source, ever.
  //
  // The walk is the point. The manifest names ENTRY files; a flat list would be
  // a list that goes stale the moment somebody adds an import, and it did:
  // `src/server/axfKv.ts` gained an accounts-module import while this was being
  // written, and the peeled app shipped a route that 500'd on
  // "Can't resolve @axs/modules/accounts/lib/session". Now the peel follows the
  // graph, and an unresolvable import fails the BUILD instead of the app.
  copiedServerFiles.push(...copyServerClosure(plugin, host.server, alreadyCopiedDirs));

  // The API routes, copied VERBATIM to the same studio-relative path — and
  // through the same walk, so whatever a route imports comes with it. They
  // import through `@axs/*`, which the generated tsconfig aliases to this app's
  // own `src/`, so one route implementation serves both hosts with no rewrite
  // on the way in: an edit to the studio's route is an edit to every peeled
  // app's route at its next peel.
  copiedServerFiles.push(
    ...copyServerClosure(
      plugin,
      host.routes.map((rel) => `${rel}/route.ts`),
      alreadyCopiedDirs
    )
  );

  hostDependencies.push(...host.dependencies.map((name) => ({ plugin, name })));
}

// ---------------------------------------------------------------------------
// 6a-bis. THE MODULES' OWN CLOSURE — the primary and every companion.
//
// Two things a module needs that copying its directory does not give it:
//
//   1. **What it imports from outside itself.** `@axs/server/axfKv`,
//      `@axs/defaults/default-state`, `@axs/chrome/assets` — studio-level
//      files a module leans on. Found by walking the module's own source
//      rather than by a list, for the reason the host-contract walk above
//      already learned the hard way: a flat list goes stale the moment
//      somebody adds an import, and the symptom is a peeled app that builds
//      and then 500s.
//   2. **Its API routes.** `app/api/<id>/**` is a module's server half by
//      convention in this tree, and a peeled app without it is a screen with
//      nothing behind it. They ride the SAME walk, to the same
//      studio-relative paths, so every `@axs/*` import in a route resolves
//      unchanged through the generated tsconfig's alias — no rewriting of
//      carried source, ever.
//
// This is also the mechanism that makes a companion work at all: amberxvid's
// routes import `@axs/modules/accounts/lib/session`, and the import resolves
// in the peeled app precisely because the companion's directory rode along.
// ---------------------------------------------------------------------------

/** Every `route.ts` under a module's API directory, studio-relative. */
function moduleApiRoutes(id) {
  const root = path.join(STUDIO, "app", "api", id);
  if (!fs.existsSync(root)) return [];
  return walkCodeFiles(root)
    .filter((abs) => path.basename(abs) === "route.ts")
    .map((abs) => path.relative(STUDIO, abs).split(path.sep).join("/"))
    .sort();
}

/** A module's own source, as walk entry points. */
const moduleSourceEntries = (dir) =>
  walkCodeFiles(dir)
    .map((abs) => path.relative(STUDIO, abs).split(path.sep).join("/"))
    .filter((rel) => /\.tsx?$/.test(rel));

const moduleRoutes = new Map();
for (const { id, dir } of [
  { id: moduleId, dir: moduleDir },
  ...companions.map((c) => ({ id: c.id, dir: c.moduleDir }))
]) {
  copiedServerFiles.push(...copyServerClosure(id, moduleSourceEntries(dir), alreadyCopiedDirs));
  const routes = moduleApiRoutes(id);
  moduleRoutes.set(id, routes);
  copiedServerFiles.push(...copyServerClosure(`${id} routes`, routes, alreadyCopiedDirs));
}

// ---------------------------------------------------------------------------
// 6a-bis-2. THE DEFAULT IDENTITY — brand and glyph packs, so the chrome draws.
//
// `Glyph` renders a glyph no active pack answers as a dashed red box, on
// purpose ("a missing drawing is a failing gate rather than an empty box").
// A peeled app registered no packs at all, so its generated banner's brand
// mark and the module's own glyph were exactly that box — measured on the
// first expenses peel (2026-10-16). Studio's answer is `seedDefaultIdentity()`
// (`src/packs/default-identity.ts`), called in BOTH module graphs; the peel
// carries that file's closure and the generated Chrome calls it in the client
// graph, which is the one that renders glyphs. Skipped, not failed, when the
// SDK tree has no such file — a bare core still boots without a pack.
// ---------------------------------------------------------------------------
const IDENTITY_ENTRY = "src/packs/default-identity.ts";
const identityCarried = fs.existsSync(path.join(STUDIO, IDENTITY_ENTRY));
if (identityCarried) {
  copiedServerFiles.push(...copyServerClosure("default identity", [IDENTITY_ENTRY], alreadyCopiedDirs));
}

// ---------------------------------------------------------------------------
// 6a-ter. THE MEDIA SERVER — the module's sidecar, discovered not named.
//
// The directory already travelled inside the module dir (step 6). What is
// missing from a peeled app is everything AROUND it: the script that starts
// it, the loader that lets a plain Node process read this tree's
// bundler-style imports, the npm packages it needs, and a README saying that
// this app is TWO PROCESSES and what each half reads out of the environment.
//
// Discovered by convention (`<moduleDir>/media-server/index.ts`) rather than
// by the module's name, so the next module with a sidecar gets the same
// treatment without an edit here. A module without one produces none of it.
// ---------------------------------------------------------------------------
const MEDIA_ENTRY = `src/modules/${moduleId}/media-server/index.ts`;
const hasMediaServer = fs.existsSync(path.join(STUDIO, MEDIA_ENTRY));

/**
 * `process.env.NAME` reads in a set of studio-relative files, each mapped to
 * the FIRST `file:line` that reads it.
 *
 * The location is the useful half. A table of bare variable names invites
 * somebody to guess a default; a table that points at the line reading it
 * sends them to the code that decides what the default is, which is the only
 * thing that can be right after the next edit.
 */
function envReads(relFiles) {
  const found = new Map();
  for (const rel of relFiles) {
    const file = path.join(STUDIO, rel);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const m of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (found.has(m[1])) continue;
      found.set(m[1], `${rel}:${source.slice(0, m.index).split("\n").length}`);
    }
  }
  return found;
}

/** The longest `<PREFIX>_` shared by every name in a set — the family the
 *  sidecar's own config belongs to, derived rather than spelled out. */
function commonEnvPrefix(names) {
  const list = [...names];
  if (!list.length) return null;
  let prefix = list[0];
  for (const name of list.slice(1)) {
    while (prefix && !name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const cut = prefix.lastIndexOf("_");
  return cut > 0 ? prefix.slice(0, cut + 1) : null;
}

let mediaServer = null;
if (hasMediaServer) {
  const serverFiles = fs
    .readdirSync(path.join(STUDIO, `src/modules/${moduleId}/media-server`))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `src/modules/${moduleId}/media-server/${f}`);
  const serverEnv = envReads(serverFiles);
  const prefix = commonEnvPrefix([...serverEnv.keys()]);
  // The APP half of the same contract: the env names in the module's other
  // files that belong to the sidecar's family. `AMBERXVID_MEDIA_URL` is read
  // only by the app and is exactly what a two-process README must state — a
  // list built from the sidecar's files alone would have omitted it.
  const appEnv = prefix
    ? [...envReads(moduleSourceEntries(moduleDir).filter((r) => !serverFiles.includes(r)))].filter(
        ([name]) => name.startsWith(prefix)
      )
    : [];
  mediaServer = {
    module: moduleId,
    dir: `src/modules/${moduleId}/media-server`,
    entry: MEDIA_ENTRY,
    script: "media",
    command: `node --import ./scripts/media-hook.mjs ${MEDIA_ENTRY}`,
    loader: "scripts/media-hook.mjs",
    envPrefix: prefix,
    // Sorted so a re-peel of an unchanged tree writes an identical manifest.
    serverEnv: [...serverEnv].sort(([a], [b]) => a.localeCompare(b)).map(([name, at]) => ({ name, at })),
    appEnv: appEnv.sort(([a], [b]) => a.localeCompare(b)).map(([name, at]) => ({ name, at }))
  };

  // The loader. The sidecar is a PLAIN NODE PROCESS, not a Next route, so
  // nothing resolves its bundler-style extensionless relative imports for it —
  // the SDK runs it under `test/alias-hook.mjs` for exactly this reason, and a
  // peeled app has no `test/`. Generated rather than copied because the SDK's
  // hook also maps `@axf/core` to a JSX-free test barrel that does not exist
  // here (and must not: this app's `@axf/core` is the vendored package, and a
  // hook that shadowed it would be checking a different framework than the one
  // shipped). The sidecar imports core `type`-only, so stripping is enough.
  write(
    "scripts/media-hook.mjs",
    `/**
 * Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.
 *
 * Module resolution for the media sidecar, which runs as a plain Node process:
 * Node strips the types natively but does NOT understand \`@axs/*\` or
 * bundler-style extensionless relative imports. This teaches it both, with no
 * dependency and no build step.
 *
 * \`@axf/core\` is deliberately NOT mapped: it is a real package here (the
 * vendored copy under vendor/axf-core), so it resolves through node_modules
 * honouring its exports map — the same boundary the app is checked against.
 */
import module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const srcDir = path.resolve(import.meta.dirname, "..", "src");
const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"];

function probe(base) {
  try {
    if (fs.statSync(base).isFile()) return base;
  } catch {
    /* not a file as-is */
  }
  for (const e of EXTS) if (fs.existsSync(base + e)) return base + e;
  for (const e of EXTS) {
    const p = path.join(base, "index" + e);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@axs/")) {
      const hit = probe(path.join(srcDir, specifier.slice("@axs/".length)));
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
        const parentDir = path.dirname(
          new URL(context.parentURL).pathname.replace(/^\\/([A-Za-z]:)/, "$1")
        );
        const hit = probe(path.resolve(parentDir, specifier));
        if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
      }
      throw err;
    }
  }
});
`
  );
}

// ---------------------------------------------------------------------------
// 6b. Vendor the plugin engine — "one plugin artifact, two hosts" (§3): the
// peeled app gets the SAME engine, routes and ledger machinery the SDK runs,
// copied verbatim, never forked. The engine resolves its roots per call
// (engineRoots()), which is what lets identical files serve both layouts.
// ---------------------------------------------------------------------------
const ENGINE_FILES = [
  ["src", "server", "zip.ts"],
  ["src", "plugins", "plugin-manager", "engine.server.ts"],
  ["src", "plugins", "plugin-manager", "types.ts"],
  ["src", "plugins", "plugin-manager", "install.ts"],
  ["src", "plugins", "plugin-manager", "manifest.json"],
  ["scripts", "lib", "registry-store.mjs"],
  ["scripts", "lib", "loader-template.mjs"]
];
for (const rel of ENGINE_FILES) {
  const from = path.join(STUDIO, ...rel);
  const to = path.join(OUT, ...rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
// The routes travel verbatim too: the peeled app's app/api/plugins/** sits at
// the same depth as the studio's, so their relative imports hold unchanged.
fs.cpSync(path.join(STUDIO, "app", "api", "plugins"), path.join(OUT, "app", "api", "plugins"), {
  recursive: true,
  filter: notAMutation
});

// The engine's one host-shaped dependency, generated rather than copied: in
// the SDK, AXF_ROOT is the repo above packages/studio; in a peeled app the
// app directory IS the root.
write(
  "src/server/paths.ts",
  `/**
 * Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.
 * The peeled app is its own root: \`next dev\`, \`next start\` and \`node --test\`
 * all run with the app directory as cwd. \`AXF_ROOT\` env overrides, same as
 * the SDK.
 */
import path from "node:path";

export const AXF_ROOT: string = process.env.AXF_ROOT ?? path.resolve(process.cwd());
`
);

// ---------------------------------------------------------------------------
// 6c. Re-materialise installed plugins from the preserved assets root, and
// write the loader. A fresh peel has an empty ledger and gets the honest
// empty loader; a re-peel finds what the app's operator installed and puts
// it back — from the INSTALLED COPIES under assets/, not from anywhere in
// the dev tree, because those files are the app's, not Studio's.
// ---------------------------------------------------------------------------
const appAssets = path.join(OUT, "assets");
const loaderRows = [];
const loaderSkipped = [];
const rematerialised = [];
try {
  const ledger = loadRegistry(appAssets);
  for (const a of [...ledger.assets].sort((x, y) => x.id.localeCompare(y.id))) {
    if (a.meta?.imported !== true) continue;
    const installedDir = a.installed ? path.join(appAssets, ...a.installed.split("/")) : null;
    const srcDir = path.join(OUT, "src", "plugins", a.id);
    if (installedDir && fs.existsSync(installedDir) && !fs.existsSync(srcDir)) {
      fs.cpSync(installedDir, srcDir, { recursive: true });
      rematerialised.push(a.id);
    }
    if (!a.enabled) continue;
    const entry = typeof a.meta?.entry === "string" ? a.meta.entry : null;
    if (!entry || !fs.existsSync(path.join(OUT, "src", "plugins", a.id, ...entry.split("/")))) {
      loaderSkipped.push(`${a.id} (no usable entry on disk)`);
      continue;
    }
    loaderRows.push({ id: a.id, specifier: `./${a.id}/${entry.replace(/\.tsx?$/, "")}` });
  }
} catch (err) {
  console.warn(`peel: WARNING — could not read the app's asset ledger: ${err?.message ?? err}`);
}
write("src/plugins/installed.generated.ts", loaderSource(loaderRows, loaderSkipped));

// ---------------------------------------------------------------------------
// 7. Generate the app
// ---------------------------------------------------------------------------
const studioPkg = JSON.parse(fs.readFileSync(path.join(STUDIO, "package.json"), "utf8"));
const dep = (name, from) => {
  const version = from[name];
  if (!version) fail(`studio's package.json no longer declares "${name}" — peel template is stale`);
  return version;
};

/**
 * The generated app's runtime dependencies, in four tiers — the framework, the
 * Next trio, core's own peers, a carried plugin's declared packages, and what
 * the CLOSURE WALKS actually saw the carried source import.
 *
 * The last tier is the discovering one and it is deliberately LAST-and-least:
 * it only adds a package no earlier tier already resolved, so a version core
 * pins as a peer is never quietly restated from the studio's own list. What it
 * catches is the thing no declaration covers — `mediasoup` for a module's
 * sidecar, `mediasoup-client` for the screen that talks to it. Without it a
 * peeled amberxvid installs, typechecks against a missing package, and fails
 * at the first room join.
 */
const appDependencies = {
  "@axf/core": "file:vendor/axf-core",
  next: dep("next", studioPkg.dependencies),
  react: dep("react", studioPkg.dependencies),
  "react-dom": dep("react-dom", studioPkg.dependencies),
  // Core's OWN peers, read from core — never a literal here. A peeled app
  // inherits everything core needs, so its dependency list is a fact about
  // core. When this was a hardcoded trio, the day core gained @mui/material
  // every generated app stopped typechecking.
  ...peerDepsForGeneratedApp(CORE, studioPkg, fail),
  // Packages a carried universal plugin's manifest declares it needs — the
  // Module Assistant's Anthropic SDK, for instance. The NAME comes from the
  // plugin, the VERSION from the studio's package.json, so a plugin can never
  // pin a version the SDK is not itself running.
  ...Object.fromEntries(
    hostDependencies.map(({ name }) => [name, dep(name, studioPkg.dependencies)])
  )
};
/** Tier five: discovered, and only what is still missing. `@axf/core` is never
 *  among them — it is the vendored copy, not an npm package. A specifier the
 *  studio does not itself declare is left alone rather than invented: it is
 *  either a transitive of something already here or a real gap, and inventing
 *  a version would hide which. */
const discoveredDependencies = [...carriedPackages]
  .filter((name) => name !== "@axf/core" && !(name in appDependencies))
  .filter((name) => name in studioPkg.dependencies)
  .sort();
for (const name of discoveredDependencies) appDependencies[name] = studioPkg.dependencies[name];

write(
  "package.json",
  JSON.stringify(
    {
      name: `axp-${moduleId}`,
      private: true,
      version: `0.0.0-peel.${frameworkVersion}`,
      description: `${decl.title} — peeled from @axf/core ${frameworkVersion} into a standalone app. Regenerate with \`npm run peel ${moduleId}\` in packages/studio.`,
      scripts: {
        dev: `next dev --port ${port}`,
        build: "next build",
        start: `next start --port ${port}`,
        // The sidecar, when the module has one. This app is TWO PROCESSES —
        // see README.md, which is generated beside this file and says so in
        // the first paragraph rather than in a footnote nobody reaches.
        ...(mediaServer ? { media: mediaServer.command } : {}),
        typecheck: "tsc --noEmit"
      },
      dependencies: appDependencies,
      devDependencies: {
        "@types/node": dep("@types/node", studioPkg.devDependencies),
        "@types/react": dep("@types/react", studioPkg.devDependencies),
        // See bare-core.mjs: core's inline toolbar placement portals, so a
        // vendored core imports react-dom and a peel without its types does
        // not typecheck.
        "@types/react-dom": dep("@types/react-dom", studioPkg.devDependencies),
        typescript: dep("typescript", studioPkg.devDependencies)
      }
    },
    null,
    2
  ) + "\n"
);

write(
  "next.config.ts",
  `import path from "node:path";
import type { NextConfig } from "next";

/**
 * Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.
 *
 * The app is SELF-CONTAINED: \`@axf/core\` resolves to the vendored copy under
 * vendor/axf-core (framework ${frameworkVersion}), which ships source, so it is named in
 * \`transpilePackages\`. \`turbopack.root\` is this directory — everything the
 * app needs lives inside it, which is the whole point of a vendored peel.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname)
  },
  transpilePackages: ["@axf/core"],
  typescript: {
    // Same posture as the dev tree: \`npm run typecheck\` is the real gate.
    ignoreBuildErrors: true
  }
};

export default nextConfig;
`
);

write(
  "tsconfig.json",
  JSON.stringify(
    {
      "//": [
        `Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.`,
        "@axf/core has NO alias: it resolves as a real package through",
        "node_modules into vendor/axf-core, honouring core's exports map, so a",
        "deep import into framework internals fails here exactly as it does in",
        "the bundler. That is the boundary this app is checked against.",
        "@axs/* IS aliased, to this app's own src/, because it is not a boundary",
        "— it is the studio's spelling for 'my own source', and carried plugin",
        "and route files use it. Aliasing it is what lets those files travel",
        "VERBATIM: the alternative was rewriting imports on the way in, which",
        "makes the peeled copy differ from the file it was peeled from."
      ],
      compilerOptions: {
        target: "ES2022",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        skipLibCheck: true,
        jsx: "react-jsx",
        plugins: [{ name: "next" }],
        paths: { "@axs/*": ["./src/*"] }
      },
      include: [
        "next-env.d.ts",
        "app/**/*.ts",
        "app/**/*.tsx",
        "src/**/*.ts",
        "src/**/*.tsx",
        ".next/types/**/*.ts",
        ".next/dev/types/**/*.ts"
      ],
      exclude: ["node_modules"]
    },
    null,
    2
  ) + "\n"
);

write(
  "next-env.d.ts",
  `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`
);

write(".gitignore", "node_modules/\n.next/\n");

// --- README ----------------------------------------------------------------
//
// Generated, like everything else here, and for one reason above the rest: an
// app that is TWO PROCESSES and says so nowhere is an app whose rooms are
// permanently empty and whose operator has no way to know why. The env table
// is DISCOVERED from the sidecar's own source (§6a-ter), so it cannot describe
// a variable the code stopped reading.
const envRow = ({ name, at }) => `| \`${name}\` | \`${at}\` |`;
write(
  "README.md",
  `# ${decl.title} — peeled

${decl.summary}

Generated by \`npm run peel ${moduleId}${companions.map((c) => ` --with ${c.id}`).join("")}\` in
\`packages/studio\`, against **@axf/core ${frameworkVersion}** (vendored to \`vendor/axf-core\`).
Do not edit generated files — re-peel instead. \`peel.manifest.json\` is the
record of what this app is; \`/api/health\` checks the running app against it.

\`\`\`
npm install
npm run typecheck
npm run dev          # http://localhost:${port}${decl.route}
\`\`\`

${
  companions.length
    ? `## Companion modules

This app does not ship one module. \`${moduleId}\` leans on ${companions.length === 1 ? "another module" : "other modules"} for
identity, storage and messaging, so ${companions.length === 1 ? "it travels" : "they travel"} with it — registered after the
primary, so the registry, menus and settings compose.

| Module | Route | Role |
|---|---|---|
| **${moduleId}** | \`${decl.route}\` | the app — this is the landing route |
${companions.map((c) => `| ${c.id} | \`${c.decl.route}\` | companion, reachable but not the landing |`).join("\n")}

Each companion's \`app/api/<id>/**\` routes came with it.

`
    : ""
}${
    mediaServer
      ? `## Two processes

**The app alone is not the whole application.** Calls, rooms and streams are
relayed by the media server — a separate Node process, in this same directory:

\`\`\`
npm run dev            # terminal 1 — the app, port ${port}
npm run media          # terminal 2 — the media server
\`\`\`

Without terminal 2 the app boots, signs in and browses perfectly well, and
every attempt to join a room or start a broadcast fails. Check the sidecar on
its own with:

\`\`\`
npm run media -- --once     # boots, prints one health document, exits 0
\`\`\`

### Environment

Read by the **media server** (\`${mediaServer.dir}\`):

| Variable | Read at |
|---|---|
${mediaServer.serverEnv.map(envRow).join("\n")}

Read by the **app** to find and trust that server:

| Variable | Read at |
|---|---|
${mediaServer.appEnv.map(envRow).join("\n")}

Both halves must agree on the shared secret — it is what signs the tokens the
app hands a client to present to the media server. A mismatch is a room that
refuses every join with no error the user can act on.
`
      : ""
  }
## What is in here

- \`vendor/axf-core\` — the framework, vendored whole. This app resolves
  nothing from the dev tree at runtime.
- \`src/modules/\` — the module${companions.length ? " and its companions" : ""}.
- \`src/plugins/\` — the closure: ${carried.length ? carried.map((c) => c.plugin).join(", ") : "(none)"}.
- \`app/api/plugins\` — the plugin engine. This app installs, enables, disables,
  imports and exports plugins through the same routes, package format and
  ledger document the SDK uses.
- \`assets/\` and \`data/\` — the app's own state. **A re-peel preserves both**:
  it refreshes the framework, it does not factory-reset the app.
`
);

// --- the generated boot ----------------------------------------------------
const pluginImports = carried
  .map(
    ({ plugin, exports }) =>
      `import { ${exports.map((e) => e.name).join(", ")} } from "./plugins/${plugin}/plugin";`
  )
  .join("\n");
const contributionLines = carried
  .flatMap(({ exports }) => exports.map((e) => `    registry.contribute(${e.name});`))
  .join("\n");
// SDK-owned points a carried universal plugin asked the host to declare,
// emitted as the SAME literal src/studio.points.ts holds. Declared before the
// contributions land, for the reason the block below states.
const hostPointLines = hostPointLiterals
  .map(
    ({ plugin, point }) =>
      `    // asked for by ${plugin}'s manifest host contract\n` +
      `    registry.declarePoint(${JSON.stringify(point, null, 6).replace(/\n/g, "\n    ")});`
  )
  .join("\n");

// --- a module's OWN commands, by convention ---------------------------------
//
// `src/modules/<id>/<id>.commands.ts` is where a module registers the commands
// and predicates its DECLARED MENUS name. Studio's boot hand-imports each one;
// a generated boot cannot, so it reads the convention off disk.
//
// This is not a nicety. `registerModuleMenus` refuses an item naming a command
// nobody registered — deliberately, loudly — so a peel that copied the menus
// and skipped the commands produced a boot that THREW, a failed subsystem and
// a red health route. Which is exactly what it did on the first amberxvid
// peel: `area "amberxvid.member" item "profile" names command
// "amberxvid.member.profile", which is not registered`. The registry's refusal
// is the property being relied on; this is the missing half it was refusing.
//
// The exports are called by SHAPE (`register*`, and a function) rather than by
// name, because the names are per-module — `registerAmberXVidCommands`,
// `registerTaskmanCommands` — and a generator that guessed one would be a
// generator that works for one module.
const commandsModules = [
  { id: moduleId, dir: moduleDir },
  ...companions.map((c) => ({ id: c.id, dir: c.moduleDir }))
].filter(({ id, dir }) => fs.existsSync(path.join(dir, `${id}.commands.ts`)));

const commandsImports = commandsModules
  .map(
    ({ id }) =>
      `import * as ${id.replace(/-/g, "_")}Commands from "./modules/${id}/${id}.commands";`
  )
  .join("\n");
/**
 * A commands file that opens with `"use client"` (accounts does: its commands
 * open dialogs) is a client-reference proxy in the SERVER graph, and calling
 * through it throws — "Attempted to call registerAccountsCommands() from the
 * server". Studio never hit this because its boot is client-only (BootedHost);
 * the generated boot also runs on the server (the health route, the companion
 * page). So the call, AND the `registerModuleMenus` that would refuse a menu
 * naming the unregistered commands, are browser-only for such a module. The
 * server registry still gets the module itself, which is all the health
 * route and the pages need from it there. Measured on the first
 * `peel expenses --with accounts` (2026-10-16).
 */
const CLIENT_DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;
const clientOnlyCommands = new Set(
  commandsModules
    .filter(({ id, dir }) =>
      CLIENT_DIRECTIVE.test(fs.readFileSync(path.join(dir, `${id}.commands.ts`), "utf8"))
    )
    .map(({ id }) => id)
);
const browserOnly = (id) => (clientOnlyCommands.has(id) ? 'if (typeof window !== "undefined") ' : "");
const commandsCalls = commandsModules
  .map(
    ({ id }) =>
      `    ${browserOnly(id)}registerCommandsOf(${id.replace(/-/g, "_")}Commands, "${id}");`
  )
  .join("\n");

// --- companions, in the generated boot ---------------------------------------
//
// After the primary, in the order the operator named them, through the SAME
// three seams the primary goes through — registerModule, registerModuleMenus,
// registerModuleSettings. That is what "the registry, menus and settings
// compose" means concretely, and why it is these three lines and not a fourth:
//
// `navs.register` is deliberately NOT among them. Every module's declared nav
// claims the same `app.nav` surface, so registering a companion's would put two
// menus in contention for the one surface the shell renders — and the peeled
// app IS the primary module. A companion contributes its screens and its
// server half; the navigation stays the primary's.
const companionImports = companions
  .map((c) => `import { ${c.moduleExport} } from "./modules/${c.id}/${c.id}.module";`)
  .join("\n");
const companionRegisterLines = companions
  .map(
    (c) =>
      `    // companion (--with ${c.id}) — ${c.decl.title}: registered after the\n` +
      `    // primary so its points, menus and settings are in place before\n` +
      `    // anything of the primary's reaches for them.\n` +
      `    registry.registerModule(${c.moduleExport});\n` +
      `    ${browserOnly(c.id)}registerModuleMenus(${c.moduleExport});\n` +
      `    if (typeof window !== "undefined") registerModuleSettings(${c.moduleExport});`
  )
  .join("\n");

write(
  "src/boot.ts",
  `/**
 * Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.
 *
 * The peeled app's one subsystem: registers the module, the contributions the
 * closure carried, a generated banner, and the module's declared nav menu (if
 * its decl carries one — NavShell renders nothing otherwise, which is
 * legitimate). Layer "core" — nothing of the SDK is here, which is the
 * assertion the peel test makes against /api/health.
 *
 * boot() is idempotent and runs once per RUNTIME: the server components, the
 * SSR pass and the browser each evaluate their own module graph and each get
 * their own registry, so every entry (route handlers, pages, client hosts)
 * calls boot() and only the first call in each graph does work.
 */
import { declareCtxItemPoint, declareShellStripPoint, declareUniversalArea, defineNavMenu, defineSubsystem, defineToolbar, installCtxContributions, kernel, navs, registerCtxCommands, registerModuleMenus, registerModuleSettings, registry, toolbars } from "@axf/core";
import type { SubsystemStatus } from "@axf/core";

import { ${MODULE_EXPORT} } from "./modules/${moduleId}/${moduleId}.module";
${companionImports}
import { installPluginModules } from "./plugins/plugin-manager/install";
import { INSTALLED_PLUGINS } from "./plugins/installed.generated";
${commandsImports}
${pluginImports}
${hostCommandImports.join("\n")}

/**
 * Call every \`register…\` export of a module's commands namespace.
 *
 * By SHAPE, not by name: the export is \`registerAmberXVidCommands\` in one
 * module and \`registerTaskmanCommands\` in the next, and a generated boot that
 * knew one of those names would work for one module. A commands file with no
 * such export is a loud failure rather than a quiet no-op — the file exists
 * precisely because the menus need it, so an empty call is a menu map about to
 * refuse a row.
 */
function registerCommandsOf(namespace: Record<string, unknown>, moduleId: string): void {
  let called = 0;
  for (const [name, value] of Object.entries(namespace)) {
    if (name.startsWith("register") && typeof value === "function") {
      (value as () => void)();
      called += 1;
    }
  }
  if (called === 0) {
    throw new Error(
      \`module "\${moduleId}" ships <id>.commands.ts but exports no register…() function — \` +
        "its declared menus name commands nothing will have registered"
    );
  }
}

const BANNER = defineToolbar({
  id: "axp-${moduleId}-banner",
  title: "${decl.title} banner",
  role: "banner",
  surface: "app.banner",
  description: "Generated banner for the peeled app — brand, title, provenance.",
  items: [
    { kind: "brand", id: "brand", width: 120 },
    { kind: "label", id: "app", text: ${JSON.stringify(decl.title)}, tone: "accent" },
    { kind: "label", id: "peel", text: "peeled · @axf/core ${frameworkVersion}", tone: "dim" },
    { kind: "spacer", id: "gap" },
    { kind: "slot", id: "context" }${
      hostToolbarItems.length
        ? ",\n" +
          hostToolbarItems
            .map(
              ({ plugin, item }) =>
                `    // ${plugin}'s affordance, from its manifest host contract — the\n` +
                `    // surface it mounts only appears when this command fires.\n` +
                `    ${JSON.stringify({ kind: "action", ...item })}`
            )
            .join(",\n")
        : ""
    }
  ]
});

const APP = defineSubsystem({
  id: "axp-${moduleId}",
  title: ${JSON.stringify(`${decl.title} (peeled)`)},
  summary: "The peeled app's boot: registers the module and its carried closure.",
  layer: "core",
  start() {
    if (${MODULE_EXPORT}.id !== "${moduleId}") {
      throw new Error(
        \`peeled module export ${MODULE_EXPORT} has id "\${${MODULE_EXPORT}.id}", expected "${moduleId}"\`
      );
    }
    registry.registerModule(${MODULE_EXPORT});
    // The core-owned points, declared exactly as Studio's boot declares them:
    // \`shell.strip\` is what a universal strip plugin (carried or installed
    // later through the engine) contributes to, and \`ctx.item\` is where an
    // installed plugin's context-menu rows land. Declared BEFORE the
    // contributions below — the registry refuses a contribution to an
    // undeclared point rather than dropping it, which is the property being
    // relied on, not fought.
    declareShellStripPoint(registry);
    declareCtxItemPoint(registry);
${hostPointLines}
    // A carried universal plugin's own commands, registered BEFORE its
    // contributions and before the ctx hand-off below: the menu map refuses an
    // item naming a command nobody registered, so a plugin that brings menu
    // rows brings the commands they name (closure.mjs enforces the pairing).
    // \`registerCtxCommands\` is idempotent and runs here rather than only
    // inside \`registerModuleMenus\`, which returns early for a module with no
    // menus of its own.
    registerCtxCommands();
    // Each carried MODULE's own commands and predicates, before any
    // \`registerModuleMenus\` below reads a decl that names them.
${commandsCalls}
${hostCommandCalls.join("\n")}
${contributionLines}
    toolbars.register(BANNER);
    // The module's declared nav, registered through the same chokepoint the
    // dev tree uses. Read off the composed module so this line is identical
    // for every peel — a decl with no nav registers nothing.
    const nav = ${MODULE_EXPORT}.nav;
    if (nav) navs.register(defineNavMenu(nav));
    // The module's declared context menus, through the same seam Studio uses.
    // Registers the default ctx commands first (the map's gate needs them),
    // then declares the module's groups/areas and contributes its rows.
    ${browserOnly(moduleId)}registerModuleMenus(${MODULE_EXPORT});
    // The module's declared settings (core 0.0.20), same seam as menus — a
    // decl with no settings registers nothing; with one, the peeled app gets
    // the gear, the universal row and the shell dialog for free. CLIENT ONLY:
    // \`registerModuleSettings\` lives in a "use client" module (settings/
    // store.ts), so on the server the import is a client-reference proxy and
    // calling it throws — which is why Studio's own boot is client-side
    // (BootedHost) and why the health route's server boot must skip it. The
    // server registry never reads settings; the browser's boot registers them
    // for the dialog and the gear.
    if (typeof window !== "undefined") registerModuleSettings(${MODULE_EXPORT});
${companionRegisterLines}
    // Plugins the app's OPERATOR installed through the engine
    // (/api/plugins/import), fed from the generated loader — the same seam
    // studio.subsystem.ts uses, so "one plugin artifact, two hosts" is a
    // fact about this line, not a slogan. Per-plugin failures are caught and
    // reported, never allowed to take the boot down.
    installPluginModules(INSTALLED_PLUGINS);
    // The universal ctx area and the ctx.item hand-off, after the installs so
    // an installed plugin's rows are in the registry before the map reads it.
    // Both idempotent, same as Studio's boot.
    declareUniversalArea();
    installCtxContributions();
  }
});

let started: Promise<SubsystemStatus[]> | null = null;

export function boot(): Promise<SubsystemStatus[]> {
  if (!started) {
    if (!kernel.booted) kernel.register(APP);
    started = kernel.boot();
  }
  return started;
}
`
);

// --- the mount host, for universal plugins whose surface is not in a screen --
//
// One component per `host.mount` point. It is Studio's `AssistantHost` in
// generated form, and deliberately so: read the registry, render the first
// contribution's `render()`, behind a contribution-tier boundary so a broken
// surface cannot take the app down. It reads AFTER boot resolves — the registry
// fills asynchronously, and a component that reads on its first render renders
// null once and stays null forever.
for (const { plugin, point } of hostMountPoints) {
  write(
    `src/mounts/${point.replace(/[^a-z0-9]+/gi, "-")}.tsx`,
    `/**
 * Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.
 * Mounts whatever contributed to \`${point}\` on every route, asked for by
 * ${plugin}'s manifest host contract.
 */
"use client";

import * as React from "react";
import { Boundary, ContributionView, registry } from "@axf/core";
import type { Contribution } from "@axf/core";

import { boot } from "../boot";

interface SurfacePayload {
  readonly title: string;
  readonly render: () => React.ReactNode;
}

export default function Mount() {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void boot().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!ready) return null;
  const contributions = registry.contributionsTo<SurfacePayload>(${JSON.stringify(point)});
  if (!contributions.length) return null;
  const first: Contribution<SurfacePayload> = contributions[0];
  return (
    <Boundary tier="contribution" source={\`\${first.from} → ${point}\`} compact>
      <React.Suspense fallback={null}>
        <ContributionView
          render={(payload) => (payload as SurfacePayload).render()}
          payload={first.payload}
          from={first.from}
          point={${JSON.stringify(point)}}
        />
      </React.Suspense>
    </Boundary>
  );
}
`
  );
}

const mountImports = hostMountPoints
  .map(
    ({ point }, i) => `import Mount${i} from "./mounts/${point.replace(/[^a-z0-9]+/gi, "-")}";`
  )
  .join("\n");
const mountElements = hostMountPoints.map((_, i) => `      <Mount${i} />`).join("\n");

write(
  "src/Chrome.tsx",
  `/**
 * Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.
 * Boots the CLIENT runtime, then mounts the framework's whole chrome — plus
 * any surface a carried universal plugin asked to be mounted on every route.
 */
"use client";

import type { ReactNode } from "react";
import { AppShell } from "@axf/core";

import { boot } from "./boot";
${identityCarried ? 'import { seedDefaultIdentity } from "./packs/default-identity";' : ""}
${mountImports}

// Module scope: runs once per bundle evaluation, before the first render.
${identityCarried ? "seedDefaultIdentity();" : "// (no default identity packs in the SDK tree — glyphs render as placeholders)"}
void boot();

export default function Chrome({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      {children}
${mountElements}
    </AppShell>
  );
}
`
);

write(
  "src/PeeledHost.tsx",
  `/**
 * Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.
 * The client entry that boots before it hosts — the registry is per-runtime,
 * so the browser bundle must boot itself; a server-side boot fills a registry
 * the client never sees.
 */
"use client";

import { ModuleHost } from "@axf/core";

import { boot } from "./boot";

void boot();

export default function PeeledHost({ moduleId }: { moduleId: string }) {
  return <ModuleHost moduleId={moduleId} />;
}
`
);

write(
  "app/layout.tsx",
  `/**
 * Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.
 * The default theme is server-rendered into the head so the first paint is
 * themed; AxfStyleRoot (inside AppShell) takes over on the client.
 */
import type { ReactNode } from "react";
import { defaultValues, themeStyleBlock } from "@axf/core";

import Chrome from "../src/Chrome";

export const metadata = {
  title: ${JSON.stringify(`${decl.title} — peeled`)},
  description: ${JSON.stringify(decl.summary)}
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeStyleBlock(defaultValues()) }} />
      </head>
      <body
        style={{
          margin: 0,
          background: "var(--axf-page)",
          color: "var(--axf-ink)",
          fontFamily: "var(--axf-sans)",
          fontSize: "var(--axf-size-body)"
        }}
      >
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
`
);

write(
  "app/page.tsx",
  `/** Generated by \`npm run peel ${moduleId}\` — the app IS the module. */
import { redirect } from "next/navigation";

export default function Home() {
  redirect(${JSON.stringify(decl.route)});
}
`
);

const routeSegments = decl.route.replace(/^\//, "").split("/").filter(Boolean);
const up = "../".repeat(routeSegments.length + 1);
write(
  path.join("app", ...routeSegments, "page.tsx"),
  `/**
 * Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.
 * Boots the server-side kernel, then hands off to the client host. The route
 * never imports the module's component — ModuleHost resolves it from the
 * registry by id, exactly as the dev tree does.
 */
import { boot } from "${up}src/boot";
import PeeledHost from "${up}src/PeeledHost";

export const dynamic = "force-dynamic";

export default async function PeeledPage() {
  await boot();
  return <PeeledHost moduleId="${moduleId}" />;
}
`
);

// --- the companions' routes ------------------------------------------------
//
// Reachable, never the landing. `app/page.tsx` above redirects to the PRIMARY
// module's route and nothing here changes that — a companion's screen exists
// at its own declared path for whoever navigates to it (the accounts admin
// pane, a profile editor), and the app still opens on the module it is.
//
// Each page is byte-identical in shape to the primary's, including the boot:
// the registry is per-runtime, so a route reached directly must boot the
// server graph itself rather than assume the primary's route was hit first.
for (const c of companions) {
  const segs = c.decl.route.replace(/^\//, "").split("/").filter(Boolean);
  const climb = "../".repeat(segs.length + 1);
  write(
    path.join("app", ...segs, "page.tsx"),
    `/**
 * Generated by \`npm run peel ${moduleId} --with ${c.id}\` — do not edit; re-peel instead.
 * A COMPANION module's route: reachable, but not the app's landing (that is
 * ${decl.route}). ModuleHost resolves the screen from the registry by id, so
 * this file never imports the companion's component.
 */
import { boot } from "${climb}src/boot";
import PeeledHost from "${climb}src/PeeledHost";

export const dynamic = "force-dynamic";

export default async function CompanionPage() {
  await boot();
  return <PeeledHost moduleId="${c.id}" />;
}
`
  );
}

write(
  "app/api/health/route.ts",
  `/**
 * Generated by \`npm run peel ${moduleId}\` — do not edit; re-peel instead.
 *
 * The peeled app's health route: what the CI peel test hits after boot. It
 * reports the live registry against the peel manifest, so "the vendored
 * framework is the one running" is a checked fact, not an assumption.
 */
import { AXF_CORE_VERSION, kernel, menu, navs, registry } from "@axf/core";

import manifest from "../../../peel.manifest.json";
import { boot } from "../../../src/boot";

export const dynamic = "force-dynamic";

export async function GET() {
  await boot();
  const report = registry.report();
  const module = registry.module("${moduleId}");
  const navDeclared: string | null = manifest.nav;
  const navActive = navs.activeFor("app.nav");
  const navOk = !navDeclared || navActive?.id === navDeclared;
  // Declared ctx areas must exist in the live map, owned by the module, and
  // the map must re-validate clean (a command unregistered after the map was
  // built is exactly what this pass exists to catch).
  const ctxDeclared: string[] = manifest.ctxAreas;
  const ctxLive = menu.areas().filter((a) => a.owner === "${moduleId}").map((a) => a.id);
  const ctxViolations = menu.validate();
  const ctxOk =
    ctxDeclared.every((id) => ctxLive.includes(id)) && ctxViolations.length === 0;
  // The manifest's carried plugins, verified against the LIVE registry: every
  // non-universal carry must appear in the module's runtime closure. Universal
  // carries ride core points (\`shell.strip\`), which \`closureOf\` — a walk of
  // the MODULE's own points — rightly does not see; they are checked as
  // registered contributions instead.
  // The COMPANIONS the peel carried, verified the same way the module is: in
  // the live registry, by id. A companion that copied but never registered is
  // an app whose sign-in route answers and whose sign-in SCREEN is missing,
  // and nothing else on this page would have noticed.
  const companionsDeclared = manifest.companions as { id: string; route: string }[];
  const companionsLive = companionsDeclared.map((c) => ({
    id: c.id,
    route: c.route,
    registered: Boolean(registry.module(c.id))
  }));
  const companionsOk = companionsLive.every((c) => c.registered);
  const closure = registry.closureOf("${moduleId}");
  const carriesOk = (manifest.closure.carries as {
    asset: string;
    universal?: boolean;
    contributions: { name: string; point: string }[];
  }[]).every((c) =>
    c.universal
      ? c.contributions.every((x) =>
          registry.contributionsTo(x.point).some((live) => live.from === c.asset)
        )
      : (closure?.carries ?? []).includes(c.asset)
  );
  const ok =
    Boolean(module) &&
    report.violations.length === 0 &&
    kernel.statuses().every((s) => s.state === "started") &&
    AXF_CORE_VERSION === manifest.framework.version &&
    navOk &&
    ctxOk &&
    carriesOk &&
    companionsOk;
  return Response.json(
    {
      ok,
      module: module ? { id: module.id, title: module.title, route: module.route } : null,
      companions: { modules: companionsLive, match: companionsOk },
      mediaServer: manifest.mediaServer,
      nav: { declared: navDeclared, active: navActive?.id ?? null, match: navOk },
      ctx: { declared: ctxDeclared, live: ctxLive, violations: ctxViolations, match: ctxOk },
      framework: {
        package: "@axf/core",
        running: AXF_CORE_VERSION,
        vendored: manifest.framework.version,
        match: AXF_CORE_VERSION === manifest.framework.version
      },
      closure,
      carries: { declared: manifest.closure.carries.map((c: { asset: string }) => c.asset), match: carriesOk },
      registry: report,
      subsystems: kernel.statuses(),
      peeledAt: manifest.peeledAt
    },
    { status: ok ? 200 : 500 }
  );
}
`
);

// ---------------------------------------------------------------------------
// 8. The peel manifest — the record the whole contract hangs off
// ---------------------------------------------------------------------------
const countFiles = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
};

const manifest = {
  format: PEEL_FORMAT,
  module: moduleId,
  title: decl.title,
  entryRoute: decl.route,
  // The module's declared nav menu (ModuleDecl.nav), registered by the
  // generated boot; null when the module declares none.
  nav: decl.nav?.id ?? null,
  // The module's declared context-menu areas (ModuleDecl.menus), registered
  // by the generated boot through registerModuleMenus; empty when none.
  ctxAreas: (decl.menus?.areas ?? []).map((a) => a.id),
  // The module's OWN API routes, carried by the closure walk. A module's
  // server half is `app/api/<id>/**` by convention in this tree, and a peeled
  // app without it is a screen with nothing behind it.
  routes: moduleRoutes.get(moduleId) ?? [],
  /**
   * **The COMPANIONS** (`--with`), and the reason this app is not one module.
   *
   * Recorded per companion rather than as a list of ids because the health
   * route checks them: each must be in the live registry by id, or the app is
   * one whose sign-in route answers and whose sign-in screen is missing.
   *
   * `nav` is stated and deliberately NOT registered — every module's declared
   * nav claims the same `app.nav` surface, and the peeled app IS the primary.
   */
  companions: companions.map((c) => ({
    id: c.id,
    title: c.decl.title,
    route: c.decl.route,
    dir: `src/modules/${c.id}`,
    nav: c.decl.nav?.id ?? null,
    navRegistered: false,
    ctxAreas: (c.decl.menus?.areas ?? []).map((a) => a.id),
    points: c.decl.points.map((p) => p.id),
    routes: moduleRoutes.get(c.id) ?? []
  })),
  /**
   * **The SIDECAR.** `null` for a module without one. When present, this app
   * is TWO PROCESSES and the README says so — the env lists are read off the
   * sidecar's own source, so they cannot name a variable the code dropped.
   */
  mediaServer,
  // Packages declared because the CARRIED SOURCE imports them, discovered by
  // the closure walks. Stated separately from the dependency block so it is
  // visible what was inferred rather than declared.
  discoveredDependencies,
  peeledAt: new Date().toISOString(),
  peeledFrom: "packages/studio",
  framework: {
    package: "@axf/core",
    version: frameworkVersion,
    packageVersion: corePkg.version,
    vendoredTo: "vendor/axf-core",
    files: countFiles(vendorDir)
  },
  closure: {
    rule:
      `a plugin is carried when it exports a contribution whose point starts with "${moduleId}." — ` +
      `plus enabled target:"universal" plugins on the host points, minus anything the ledger disables`,
    points: decl.points.map((p) => p.id),
    carries: carried.map(({ plugin, exports, universal }) => ({
      asset: plugin,
      dir: `src/plugins/${plugin}`,
      ...(universal ? { universal: true } : {}),
      contributions: exports
    })),
    unscanned,
    // Exclusions, stated rather than silent: ledger-disabled plugins, and the
    // non-portable contributions of universal plugins (each with its reason).
    disabled,
    left
  },
  // The vendored plugin engine — the peeled app installs, enables, disables,
  // imports and exports plugins through the same routes, the same package
  // format and the same ledger document as the SDK (INITIATION §3: one
  // plugin artifact, two hosts).
  pluginEngine: {
    routes: "/api/plugins",
    ledger: "assets/registry.json",
    loader: "src/plugins/installed.generated.ts",
    installed: loaderRows.map((r) => r.id),
    rematerialised
  },
  // The agent this app SHIPS WITH — one, the module's own, read back off disk
  // rather than from the builder's return so the manifest states what is in the
  // app rather than what a step reported. `null` when the module has no bundle
  // (peeled with --no-agent before its first build).
  agent: (() => {
    const bundle = readBundle(path.join(OUT, "src", "modules", moduleId));
    return bundle
      ? {
          id: bundle.id,
          name: bundle.name,
          dir: `src/modules/${moduleId}/agent`,
          skills: bundle.skills.map((s) => s.slug),
          tools: bundle.tools.map((t) => t.name),
          cliTools: bundle.cliTools,
          rule:
            "the app's one default agent; more install as add-on assets " +
            "(assets/installed/add-on/<id>/agents/*.md) or as plugins through /api/plugins"
        }
      : null;
  })(),
  // Declared per INITIATION §3; honest empties until the capabilities exist.
  inheritedSubsystems: [`axp-${moduleId}`],
  runtimeFileDeps: [],
  persistedPaths: [],
  requiredGrants: [],
  port
};
write("peel.manifest.json", JSON.stringify(manifest, null, 2) + "\n");

// ---------------------------------------------------------------------------
// 9. Report
// ---------------------------------------------------------------------------
console.log(`peeled "${moduleId}" → ${OUT}`);
console.log(`  framework   @axf/core ${frameworkVersion} vendored (${manifest.framework.files} files)`);
console.log(`  closure     ${carried.length} plugin(s): ${carried.map((c) => c.plugin + (c.universal ? " (universal)" : "")).join(", ") || "(none)"}`);
if (disabled.length) console.log(`  disabled    ${disabled.map((d) => d.plugin).join(", ")} — in the ledger, off`);
if (left.length) console.log(`  left        ${[...new Set(left.map((l) => l.plugin))].join(", ")} — universal, but their points need a host the peel does not ship (see peel.manifest.json closure.left)`);
if (unscanned.length) console.log(`  UNSCANNED   ${unscanned.map((u) => u.plugin).join(", ")} — see warnings above`);
console.log(`  engine      /api/plugins vendored · ledger assets/registry.json · ${loaderRows.length} installed plugin(s)${rematerialised.length ? ` · re-materialised: ${rematerialised.join(", ")}` : ""}`);
console.log(
  `  agent       ${
    manifest.agent
      ? `${manifest.agent.name} (${manifest.agent.id}) · ${manifest.agent.skills.length} skill(s) · ${manifest.agent.tools.length} tool(s)`
      : "(none — the module has no agent bundle; run `npm run agent " + moduleId + "`)"
  }`
);
if (hosts.length) {
  console.log(
    `  host wiring ${hosts
      .map(
        ({ plugin, host }) =>
          `${plugin}: ${host.routes.length} route(s), ${host.points.length} point(s)${host.mount ? ", mounted" : ""}`
      )
      .join(" · ")}`
  );
}
if (companions.length) {
  console.log(
    `  companions  ${companions
      .map((c) => `${c.id} (${c.decl.route}, ${(moduleRoutes.get(c.id) ?? []).length} route(s))`)
      .join(" · ")}`
  );
}
console.log(`  routes      ${(moduleRoutes.get(moduleId) ?? []).length} own API route(s) carried`);
console.log(
  `  media       ${
    mediaServer
      ? `${mediaServer.dir} → \`npm run media\` (SECOND PROCESS; ${mediaServer.serverEnv.length} env var(s), see README)`
      : "(none — the module ships no media-server/)"
  }`
);
if (discoveredDependencies.length) {
  console.log(`  deps        discovered: ${discoveredDependencies.join(", ")}`);
}
console.log(`  nav         ${decl.nav ? decl.nav.id : "(none declared — NavShell renders no menu)"}`);
console.log(`  ctx areas   ${decl.menus?.areas.length ? decl.menus.areas.map((a) => a.id).join(", ") : "(none declared — the default menu still covers every click)"}`);
console.log(`  entry       ${decl.route}  ·  health /api/health  ·  port ${port}`);
console.log(`  next steps  cd ${path.relative(process.cwd(), OUT)} && npm install && npm run typecheck && npm run dev`);
