/**
 * The ONE closure resolver — both directions (INITIATION-PROMPT.md §4.4):
 * "One closure resolver, two directions. The peel (§3) resolves *outward* —
 * module → its plugins → its deps. The suite resolves *inward* — Studio → its
 * modules → their deps. Same resolver, same manifest shape, opposite arrow.
 * Write it once; a bug fixed in one direction is fixed in both."
 *
 * `scripts/peel.mjs` points this outward to compute what a standalone app must
 * carry. `scripts/suite.mjs` points it inward to state what Studio itself
 * ships — and to enforce the module cap (§4.6) against that statement, never
 * against a live registry, so nothing the SDK builds can trip or mask it.
 *
 * Everything here reads DATA-ONLY declarations under plain Node (native type
 * stripping, no JSX): a module's `<id>.decl.ts`, a plugin's `plugin.ts`, the
 * suite's `src/suite.manifest.ts`. Zero dependencies, Node ≥ 23.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Format tag on the RESOLVED suite artifact — versioned like `axf-peel/1`. */
export const SUITE_FORMAT = "axf-suite/1";
/** Format tag the AUTHORED manifest (src/suite.manifest.ts) must carry. */
export const SUITE_MANIFEST_FORMAT = "axs-suite-manifest/1";

/**
 * Read the framework version the closure pins — from core's source, not its
 * package.json, because AXF_CORE_VERSION is what the runtime reports.
 *
 * It lives in `src/version.ts` as of 0.0.19 and `index.ts` re-exports it: a
 * module INSIDE core needed to read it (the dashboard wrapper renderer prints
 * it in a band), and importing the barrel from within the barrel's own tree is
 * a cycle. `index.ts` is still checked, and checked FIRST, because that is
 * where it lived for eighteen versions and a peeled or archived core may still
 * carry the literal there — this has to keep working against a tree it did not
 * write. The error names both files for the same reason.
 */
export function readFrameworkVersion(coreDir) {
  const VERSION_RE = /AXF_CORE_VERSION\s*=\s*"([^"]+)"/;
  let match = null;
  for (const rel of [["src", "index.ts"], ["src", "version.ts"]]) {
    const file = path.join(coreDir, ...rel);
    if (!fs.existsSync(file)) continue;
    match = fs.readFileSync(file, "utf8").match(VERSION_RE);
    if (match) break;
  }
  if (!match) {
    throw new Error("cannot find AXF_CORE_VERSION in packages/core/src/{index,version}.ts");
  }
  const corePkg = JSON.parse(fs.readFileSync(path.join(coreDir, "package.json"), "utf8"));
  return { frameworkVersion: match[1], corePkg };
}

/** Every directory under src/modules IS a module Studio ships — the resolver
 *  discovers them; nothing else may live there. */
export function listModuleDirs(studioDir) {
  const root = path.join(studioDir, "src", "modules");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Plugin directories with a scannable declaration (`plugin.ts`). */
export function listPluginDirs(studioDir) {
  const root = path.join(studioDir, "src", "plugins");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, "plugin.ts")))
    .map((e) => e.name)
    .sort();
}

/**
 * Import a module's data-only declaration and validate the conventions both
 * directions depend on: `<id>.decl.ts` exports the ModuleDecl, `<id>.module.ts`
 * sits beside it and exports `<ID>_MODULE` (SCREAMING_SNAKE of the id).
 *
 * When `coreDir` is given, a declared nav menu (`decl.nav`) is validated
 * through core's own `defineNavMenu` chokepoint — the same rules the peeled
 * app's boot applies at runtime, checked here so an invalid menu fails the
 * resolve rather than the generated app.
 */
export async function loadModuleDecl(studioDir, moduleId, coreDir) {
  const moduleDir = path.join(studioDir, "src", "modules", moduleId);
  const declPath = path.join(moduleDir, `${moduleId}.decl.ts`);
  if (!fs.existsSync(declPath)) {
    throw new Error(
      `no declaration at src/modules/${moduleId}/${moduleId}.decl.ts — a resolvable module ` +
        `exports its ModuleDecl from a data-only <id>.decl.ts (see demo.decl.ts)`
    );
  }
  const declModule = await import(pathToFileURL(declPath).href);
  const decl = Object.values(declModule).find(
    (v) => v && typeof v === "object" && v.id === moduleId && Array.isArray(v.points)
  );
  if (!decl) throw new Error(`${moduleId}.decl.ts exports no declaration with id "${moduleId}"`);
  if (typeof decl.route !== "string" || !decl.route.startsWith("/")) {
    throw new Error(`declaration for "${moduleId}" has no route starting with "/"`);
  }
  const moduleFile = path.join(moduleDir, `${moduleId}.module.ts`);
  if (!fs.existsSync(moduleFile)) throw new Error(`missing ${moduleId}.module.ts beside the decl`);
  if (decl.nav && coreDir) {
    const { defineNavMenu } = await import(
      pathToFileURL(path.join(coreDir, "src", "nav", "types.ts")).href
    );
    try {
      defineNavMenu(decl.nav);
    } catch (err) {
      throw new Error(
        `module "${moduleId}" declares an invalid nav menu: ${err?.message ?? err}`
      );
    }
  }
  if (decl.menus && coreDir) {
    // The same structural pass defineModule runs — under plain Node, so an
    // invalid menus decl fails the resolve, not the generated app's boot.
    const { validateMenusDecl } = await import(
      pathToFileURL(path.join(coreDir, "src", "ctx", "menus.ts")).href
    );
    const problems = validateMenusDecl(moduleId, decl.menus);
    if (problems.length) {
      throw new Error(
        `module "${moduleId}" declares invalid context menus:\n  - ${problems.join("\n  - ")}`
      );
    }
  }
  const moduleExport = `${moduleId.toUpperCase().replace(/-/g, "_")}_MODULE`;
  return { decl, moduleDir, moduleFile, moduleExport };
}

const isContribution = (v) =>
  v &&
  typeof v === "object" &&
  typeof v.from === "string" &&
  typeof v.point === "string" &&
  "payload" in v;

/**
 * Core-owned UI points a GENERATED host (a peeled app's boot) declares and
 * renders without any module's help: `AppShell` mounts every `shell.strip`
 * contribution on every route. This is the set a `target: "universal"`
 * plugin's contributions are allowed to ride into a peel on — a universal
 * contribution to any OTHER host-absent point (a Studio point, a ctx row
 * naming a command only Studio registers) is recorded as LEFT BEHIND with the
 * reason, because carrying it would ship a recorded violation and a red
 * health route rather than a working surface.
 */
const UNIVERSAL_HOST_POINTS = new Set(["shell.strip"]);

/**
 * What a plugin's manifest may ask a generated host to do for it, so that more
 * of a universal plugin than `shell.strip` can ride into a peel:
 *
 *     "host": {
 *       "points": ["studio.assistant"],
 *       "commands": "assistant.commands#registerAssistantCommands",
 *       "mount": "studio.assistant",
 *       "routes": ["chat", "agents"],
 *       "server": ["src/server/axfKv.ts"],
 *       "dependencies": ["@anthropic-ai/sdk"]
 *     }
 *
 *   - **`points`** — SDK-owned points the plugin contributes to. The peel emits
 *     their declarations into the generated boot, read from
 *     `src/studio.points.ts` so the peeled app declares the SAME point Studio
 *     does rather than a copy that drifts. A point named here but absent there
 *     is a violation, not a silent pass.
 *   - **`commands`** — `<file>#<export>`, called at boot before contributions
 *     land. This is what lets a `ctx.item` row ride: the map refuses an item
 *     naming an unregistered command, so a plugin may only bring menu rows if
 *     it also brings the commands they name.
 *   - **`mount`** — a POINT the generated Chrome renders on every route, for a
 *     plugin whose surface is not inside any module's screen. The generated
 *     host reads the registry and renders the first contribution's `render()`,
 *     which is what Studio's own `AssistantHost` does; naming the point rather
 *     than a component is what keeps the generator from importing the plugin.
 *   - **`toolbar`** — action items for the generated app's banner, in the
 *     toolbar vocabulary (`id`, `glyph`, `title`, `command`). A mounted surface
 *     that only appears when a command fires needs somewhere to fire it from:
 *     Studio has the command bar's chat button, and without this a peeled app
 *     registered the assistant, mounted it, and gave nobody a way to open it.
 *     Found exactly that way — the peeled demo had the window and no button.
 *   - **`routes`** — studio-relative route DIRECTORIES the plugin's client
 *     calls (`app/api/assistant/chat`). The peel copies each `route.ts` to the
 *     same path in the generated app, rewriting `@axs/*` to a relative path, so
 *     ONE implementation serves both hosts and an edit to the studio's route is
 *     an edit to every peeled app's route at its next peel.
 *   - **`server`** — studio-relative files those routes import that live
 *     outside the plugin directory. Named rather than crawled: a wrong path
 *     fails the peel loudly, whereas a crawler that guessed would ship an app
 *     that builds and 500s.
 *   - **`dependencies`** — npm packages the generated app must declare. Their
 *     VERSIONS come from the studio's package.json, never from here.
 *
 * The alternative was a peel that special-cases the assistant by name. This is
 * the same information, stated by the plugin, checked by the resolver, and
 * available to the next universal plugin without touching the generator.
 */
export function hostContract(manifest) {
  const host = manifest?.host;
  if (!host || typeof host !== "object") return null;
  const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  return {
    points: strings(host.points),
    commands: typeof host.commands === "string" ? host.commands : null,
    mount: typeof host.mount === "string" ? host.mount : null,
    // Toolbar items are kept whole (the toolbar vocabulary is the toolbar's to
    // define) but must at least name a command, or they are a button that does
    // nothing — the failure this field exists to end.
    toolbar: Array.isArray(host.toolbar)
      ? host.toolbar.filter((item) => item && typeof item.id === "string" && typeof item.command === "string")
      : [],
    routes: strings(host.routes),
    server: strings(host.server),
    dependencies: strings(host.dependencies)
  };
}

/**
 * Scan every plugin declaration and compute one module's closure: a plugin is
 * carried when it exports a contribution whose point starts with `<id>.` of a
 * DECLARED point — plus, per INITIATION §3, `target: "universal"` plugins,
 * whose contributions ride on the host points above. Silent — callers decide
 * whether `unscanned` is a warning (the peel, where only the target module
 * matters) or a failure (the suite, which states Studio's own shipment and
 * may not ship blind spots).
 *
 * Three additions (2026-08-13, the plugin-engine work), one edit fixing both
 * directions as this file's header promises:
 *
 *   - **The ledger's `enabled` flag is honoured.** A plugin
 *     `asset_registry.py disable`d (or flipped off by the plugin manager) is
 *     not carried; each exclusion is recorded in `disabled`, never silent.
 *   - **`target: "universal"` carries** (filtered to the host points above),
 *     with the non-portable remainder in `left`.
 *   - **The three identities are reconciled.** The resolver keys on the
 *     DIRECTORY name; the manifest's `id` and every contribution's `from`
 *     must equal it or the plugin resolves as a violation. Before this,
 *     nothing tied the three together, and an import/export mechanism keyed
 *     on any one of them could ship files under one name that register under
 *     another.
 */
export async function scanCarriedPlugins({ studioDir, coreDir, decl }) {
  const { validateContribution } = await import(
    pathToFileURL(path.join(coreDir, "src", "points.ts")).href
  );
  const { loadRegistry, assetsRoot } = await import("./registry-store.mjs");
  const pluginsRoot = path.join(studioDir, "src", "plugins");

  // The ledger, read once. A missing registry document is the empty ledger —
  // every plugin defaults to enabled, which is what pre-ledger trees are.
  let ledger = new Map();
  try {
    ledger = new Map(loadRegistry(assetsRoot()).assets.map((a) => [a.id, a]));
  } catch {
    /* unreadable ledger = empty ledger; enabled is the default */
  }

  /** @type {{ plugin: string, exports: { name: string, point: string }[], universal?: boolean }[]} */
  const carried = [];
  const unscanned = [];
  const violations = [];
  const disabled = [];
  const left = [];

  for (const plugin of listPluginDirs(studioDir)) {
    const declFile = path.join(pluginsRoot, plugin, "plugin.ts");

    // manifest.json, when the plugin carries one: the id must be the
    // directory's, and the target decides the universal rule below.
    let manifest = null;
    const manifestFile = path.join(pluginsRoot, plugin, "manifest.json");
    if (fs.existsSync(manifestFile)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      } catch (err) {
        violations.push({
          plugin,
          point: "(manifest)",
          problem: `manifest.json is not valid JSON: ${String(err?.message ?? err)}`
        });
      }
      if (manifest && manifest.id !== plugin) {
        violations.push({
          plugin,
          point: "(manifest)",
          problem: `manifest id "${manifest.id}" is not the directory name "${plugin}" — one plugin, one identity`
        });
      }
    }

    const ledgerEntry = ledger.get(plugin);
    if (ledgerEntry && ledgerEntry.enabled === false) {
      disabled.push({ plugin, reason: "disabled in the asset registry" });
      continue;
    }

    let mod;
    try {
      mod = await import(pathToFileURL(declFile).href);
    } catch (err) {
      // A plugin whose declaration cannot run under plain Node cannot be
      // resolved into ANY closure — record it, never silently skip it.
      unscanned.push({ plugin, error: String(err?.message ?? err) });
      continue;
    }

    const contributions = Object.entries(mod).filter(([, v]) => isContribution(v));
    for (const [name, v] of contributions) {
      if (v.from !== plugin) {
        violations.push({
          plugin,
          point: v.point,
          problem: `${name} says from "${v.from}" but lives in src/plugins/${plugin} — one plugin, one identity`
        });
      }
    }

    const matches = contributions
      .filter(([, v]) => v.point.startsWith(`${decl.id}.`))
      .map(([name, v]) => {
        const point = decl.points.find((p) => p.id === v.point);
        if (!point) {
          violations.push({ plugin, point: v.point, problem: "module declares no such point" });
        } else {
          for (const problem of validateContribution(point, v)) {
            violations.push({ plugin, point: v.point, problem: problem.problem });
          }
        }
        return { name, point: v.point };
      });

    if (matches.length) {
      carried.push({ plugin, exports: matches });
      continue;
    }

    // The universal rule: no module-point match, but the plugin declares
    // itself host-independent. Its portable contributions ride; the rest are
    // recorded as left behind, with reasons a person can act on.
    if (manifest && manifest.target === "universal") {
      const host = hostContract(manifest);
      // What this plugin's contributions may ride on: the points every
      // generated host owns, plus the ones its own manifest asks the host to
      // declare — and `ctx.item` only when it also brings the commands its
      // rows name, because the menu map refuses an item naming a command
      // nobody registered.
      const rideable = new Set([
        ...UNIVERSAL_HOST_POINTS,
        ...(host?.points ?? []),
        ...(host?.commands ? ["ctx.item"] : [])
      ]);
      const portable = [];
      for (const [name, v] of contributions) {
        if (rideable.has(v.point)) portable.push({ name, point: v.point });
        else {
          left.push({
            plugin,
            name,
            point: v.point,
            reason: host
              ? `universal plugin, but its manifest's host contract does not cover "${v.point}" — ` +
                "add the point to host.points (and host.commands if its rows name commands)"
              : "universal plugin, but this point is not one a generated host declares — " +
                "carrying it would register a violation, not a surface"
          });
        }
      }
      if (portable.length) carried.push({ plugin, exports: portable, universal: true, host });
    }
  }

  return { carried, unscanned, violations, disabled, left };
}

/**
 * The module-cap check (INITIATION §4.6) as a pure function on the MANIFEST'S
 * module list — the one chokepoint `resolveSuite` and the suite gate share.
 * It counts what the manifest claims, not what resolved: a member that fails
 * to resolve still occupies a slot, and a cap you can duck by breaking a decl
 * is not a cap.
 */
export function moduleCapProblems(moduleIds, cap) {
  if (!Number.isInteger(cap) || cap < 1) {
    return [`module cap must be a positive integer, got ${String(cap)}`];
  }
  const unique = [...new Set(moduleIds)];
  if (unique.length > cap) {
    return [
      `the suite manifest resolves ${unique.length} module-kind entries; the cap is ${cap} ` +
        `(INITIATION §4.6: the thirteenth replaces one, it does not join it): ${unique.join(", ")}`
    ];
  }
  return [];
}

/**
 * The INWARD direction: resolve the authored suite manifest into the closure
 * of assets that constitute Studio — each member module by the same rules the
 * peel applies, plus every plugin those modules' declared points carry.
 *
 * Returns `{ resolved, problems }`. `resolved` is deterministic (no
 * timestamps, sorted entries) so the committed artifact's `--check` mode can
 * compare bytes. `problems` non-empty means the manifest does not resolve —
 * including the cap, the disk↔manifest drift and any unscannable plugin.
 */
export async function resolveSuite({ studioDir, coreDir, manifest, moduleCap }) {
  const problems = [];

  if (manifest.format !== SUITE_MANIFEST_FORMAT) {
    problems.push(
      `suite manifest format is ${JSON.stringify(manifest.format)}, expected "${SUITE_MANIFEST_FORMAT}"`
    );
  }
  for (const dupe of manifest.modules.filter((id, i) => manifest.modules.indexOf(id) !== i)) {
    problems.push(`suite manifest lists "${dupe}" more than once`);
  }

  // Discovering, both directions: the manifest may not miss a module on disk,
  // and may not claim one that is not there. This is what keeps the manifest
  // the statement of record instead of a parallel list that drifts.
  const onDisk = listModuleDirs(studioDir);
  for (const id of onDisk) {
    if (!manifest.modules.includes(id)) {
      problems.push(`src/modules/${id} exists on disk but is not in the suite manifest`);
    }
  }
  for (const id of manifest.modules) {
    if (!onDisk.includes(id)) {
      problems.push(`suite manifest lists "${id}" but src/modules/${id} does not exist`);
    }
  }

  problems.push(...moduleCapProblems(manifest.modules, moduleCap));

  const { frameworkVersion, corePkg } = readFrameworkVersion(coreDir);
  const studioPkg = JSON.parse(fs.readFileSync(path.join(studioDir, "package.json"), "utf8"));

  const moduleEntries = [];
  const pluginEntries = new Map();
  for (const id of [...new Set(manifest.modules)].sort()) {
    if (!onDisk.includes(id)) continue; // already reported
    let loaded;
    try {
      loaded = await loadModuleDecl(studioDir, id, coreDir);
    } catch (err) {
      problems.push(String(err?.message ?? err));
      continue;
    }
    const { carried, unscanned, violations } = await scanCarriedPlugins({
      studioDir,
      coreDir,
      decl: loaded.decl
    });
    for (const v of violations) problems.push(`${id}: ${v.plugin} → ${v.point}: ${v.problem}`);
    for (const u of unscanned) {
      problems.push(
        `src/plugins/${u.plugin}/plugin.ts failed to import under plain Node (is it data-only?): ${u.error}`
      );
    }
    for (const { plugin, exports } of carried) {
      const entry = pluginEntries.get(plugin) ?? {
        kind: "plugin",
        id: plugin,
        dir: `src/plugins/${plugin}`,
        carriedBy: [],
        contributions: []
      };
      entry.carriedBy.push(id);
      entry.contributions.push(...exports);
      pluginEntries.set(plugin, entry);
    }
    moduleEntries.push({
      kind: "module",
      id,
      title: loaded.decl.title,
      route: loaded.decl.route,
      glyph: loaded.decl.glyph ?? null,
      nav: loaded.decl.nav?.id ?? null,
      ctxAreas: (loaded.decl.menus?.areas ?? []).map((a) => a.id),
      points: loaded.decl.points.map((p) => p.id),
      carries: carried.map((c) => c.plugin).sort()
    });
  }

  const resolved = {
    format: SUITE_FORMAT,
    suite: manifest.id,
    title: manifest.title,
    resolvedFrom: "packages/studio",
    // Versions pin COLLECTIVELY: assets do not version independently of the
    // tree yet, so the framework version and the studio tree version pin the
    // whole closure. Per-entry pins arrive with packaging (F3).
    framework: {
      package: "@axf/core",
      version: frameworkVersion,
      packageVersion: corePkg.version
    },
    studio: { package: studioPkg.name, version: studioPkg.version },
    moduleCap,
    rule:
      "a plugin is carried when it exports a contribution whose point starts with " +
      '"<moduleId>." of a member module\'s declared point',
    entries: [
      ...moduleEntries,
      ...[...pluginEntries.values()].sort((a, b) => a.id.localeCompare(b.id))
    ]
  };

  return { resolved, problems };
}
