/**
 * @file **The packing list.** Every file the running app reads that the module
 * tracer cannot see, declared once, consumed by three things that must agree.
 *
 * INITIATION-PROMPT §2.1, stated as a mechanism rather than a warning:
 *
 * > The standalone tracer only sees imports. Anything read at runtime through
 * > `path.join(process.cwd(), …)` is invisible to it and simply will not exist
 * > in the container. So: every asset manifest declares its runtime file
 * > dependencies, a script generates the Dockerfile's COPY list from those
 * > declarations, and a test fails when a module reads a path it did not
 * > declare.
 *
 * The failure this prevents does not look like a failure. `next build` succeeds,
 * the image builds, the container starts, and then a directory read returns `[]`
 * — so the plugin roster is empty, the asset ledger has no entries, and every
 * screen renders its "nothing installed" state as if that were the truth. GizmoX
 * shipped `public/`, `.claude/` and `CLAUDE.md` missing in production exactly
 * this way. Nothing errors. That is the whole problem.
 *
 * ## The three consumers
 *
 *   1. `next.config.ts` → `outputFileTracingIncludes`, so `next build` copies the
 *      declared files into `.next/standalone` itself;
 *   2. `scripts/deploy-copy-list.mjs` → the Dockerfile's copy step, for files
 *      that live OUTSIDE the tracing root (`assets/` at the repo root) and so
 *      cannot be traced at all;
 *   3. `scripts/check-runtime-files.mjs` → the gate, which greps the server code
 *      for filesystem reads and fails on a root nothing here declares.
 *
 * A fourth consumer would be a fourth chance to drift, so a new reader imports
 * this rather than restating it.
 *
 * ## Bases, and why there are two
 *
 * `studio` is `packages/studio` — the container's WORKDIR and the app's `cwd`,
 * so a studio-based glob means the same string in dev and in production.
 * `repo` is the directory above `packages/`, which exists in the dev tree and
 * is DELIBERATELY not reproduced in the image: only the declared slices of it
 * are copied, to a fixed path the app is pointed at with `AXF_ASSETS_ROOT`.
 *
 * ## What is deliberately NOT here
 *
 * `data/` — the persisted volume (see `PERSISTED_ROOT`). Baking it into the
 * image is the §2.2 trap: the container filesystem is ephemeral, so an image
 * that carries `data/` looks correct on the first boot and silently resets
 * every write on the next redeploy. It is in `.dockerignore` for that reason.
 *
 * **ffmpeg** — a BINARY, not a file to copy. `recordings.ts › ffmpegPath()`
 * prefers `node_modules/ffmpeg-static`, and that package turns out not to be
 * installed here at all, so the resolver already falls through to bare
 * `"ffmpeg"` on PATH. Declaring a path to a package that does not exist would
 * have looked like coverage and provided none. The Dockerfile installs system
 * ffmpeg instead, and says what that costs; `FFMPEG` still overrides.
 *
 * `../GizmoX`, `build/projects/`, `.history/` — the Build Manager's inputs. It
 * shells out to a build tree that exists on one workstation; in a container it
 * finds nothing and lists nothing, which is the correct behaviour for a local
 * tool reached through a deployed UI. Declaring them would ship a build system
 * to a web host to make an empty list slightly less empty.
 */

/**
 * The ONE directory that survives a redeploy, relative to the studio cwd.
 *
 * §2.2 allows exactly one, and this is it. Every server-side root resolves
 * under it through `src/server/dataRoot.ts`; `scripts/check-runtime-files.mjs`
 * fails on a writer that resolves anywhere else. In the container it is a
 * mounted volume, so the value is the same string in both worlds and only the
 * mount differs.
 */
export const PERSISTED_ROOT = "data";

/**
 * Where the declared slices of the repo land in the image.
 *
 * The app finds them through `AXF_ASSETS_ROOT`, which the plugin engine already
 * honours (`engine.server.ts`: *"`AXF_ROOT`/`AXF_ASSETS_ROOT` env win"*) — so
 * production needs no code path of its own, it needs one environment variable
 * pointed at this.
 */
export const IMAGE_ASSETS_ROOT = "/app/assets";

/**
 * @typedef {object} RuntimeFileGroup
 * @property {string} id          Stable name, used in check output and copy comments.
 * @property {"studio"|"repo"} base
 * @property {string[]} globs     Paths relative to the base.
 * @property {string} reader      The module that reads them, so a stale entry is traceable.
 * @property {string} why         What breaks when they are absent — the sentence that
 *                                stops someone deleting the entry to make a build smaller.
 * @property {boolean} [trace]    Feed to `outputFileTracingIncludes`. Only meaningful
 *                                for `studio`, which is inside the tracing root.
 */

/** @type {RuntimeFileGroup[]} */
export const RUNTIME_FILES = [
  {
    id: "plugin-manifests",
    base: "studio",
    // `manifest.json`, not `plugin.manifest.json` — the constant is
    // `PLUGIN_MANIFEST_NAME` in plugin-manager/types.ts. The wrong spelling
    // matched zero files and the build said nothing about it, which is the
    // §2.1 failure happening to the mechanism built to prevent it: verify a
    // declaration against the output, never against memory.
    globs: ["src/plugins/*/manifest.json"],
    reader: "src/plugins/plugin-manager/engine.server.ts › listPluginDirs()",
    why:
      "The plugin roster is a DIRECTORY READ of src/plugins/, not an import — the engine " +
      "walks it and parses each manifest. Without these the Plugin Manager reports zero " +
      "plugins installed while the plugins themselves are compiled in and running, which " +
      "reads as data loss rather than as a missing file.",
    trace: true
  },
  {
    id: "asset-ledger",
    base: "repo",
    globs: ["assets/registry.json"],
    reader: "src/plugins/plugin-manager/engine.server.ts › the assets root",
    why:
      "The document of record for every packaged asset — which are installed and which " +
      "are enabled. Absent, the engine treats every asset as unregistered, so the brand " +
      "packs, layout themes and logo kits vanish from the surfaces that list them."
  },
  {
    id: "installed-assets",
    base: "repo",
    globs: ["assets/installed/**"],
    reader: "the asset engine, per entry in registry.json",
    why:
      "The asset payloads the ledger points at. A registered asset whose files are missing " +
      "is worse than an unregistered one: it lists, it resolves, and then it renders empty."
  },
  {
    id: "forge-roster",
    base: "studio",
    globs: ["forge/agents/**", "forge/skills/**"],
    reader: "src/plugins/agent-forge/forge.ts › STUDIO_FORGE_ROOT",
    why:
      "The house personas and skills, read from disk at request time. This is the SOURCE " +
      "half of the pair (.claude/agents and .claude/skills are its generated mirror and " +
      "are gitignored), so shipping the source is what keeps the roster non-empty.",
    trace: true
  }
];

/**
 * What the tracer must be told to LEAVE OUT, and why this list is not optional.
 *
 * §2.1 warns about the tracer missing files. The first real build showed the
 * opposite failure and it is the more dangerous one: `.next/standalone` came out
 * carrying the entire package — `data/` (506 files), `captures/`, `test/`,
 * `scripts/`, and **`.env`**. The cause is `@vercel/nft` doing the reasonable
 * thing with an unreasonable expression: several modules build a path from
 * `process.cwd()` at runtime, nft cannot evaluate that statically, and its
 * conservative answer is to keep the directory rather than risk dropping a
 * needed file.
 *
 * The consequences are not symmetrical. A missing file is an empty screen; a
 * `.env` in an image layer is a credential to rotate, and a baked `data/`
 * shadows the mount point so the §2.2 volume silently stops being the store.
 * `.dockerignore` already keeps both out of the build CONTEXT, so the image was
 * never going to ship them — but a property that holds only because a second,
 * unrelated file is correct is a property waiting to break. This is the belt to
 * that file's braces, and it also makes a local `npm run build` honest.
 */
export const TRACING_EXCLUDES = [
  // The persisted volume. Baked in, it shadows the mount (§2.2).
  //
  // ⚠ THESE DO NOT FULLY WORK, and the reason is worth more than the patterns.
  // `test/**`, `scripts/**` and `captures/**` below are honoured. `data/**` is
  // not, in any of the three spellings here — measured, not assumed. Grepping
  // the emitted traces found the culprit: `data/accounts` is listed in
  // `server/middleware.js.nft.json`. `proxy.ts` is middleware, middleware
  // imports the accounts session code, that code does `fs` work under a path
  // nft can partially evaluate — and Next applies these route-keyed
  // include/exclude lists to ROUTES, not to the middleware trace. Nothing
  // written here can reach it.
  //
  // So the guarantee that `data/` and `.env` stay out of the IMAGE is
  // `.dockerignore`, which removes them from the build CONTEXT — the build
  // stage cannot trace a file it was never given. That is a real guarantee and
  // it is checkable by reading one file, but it means those `.dockerignore`
  // lines are load-bearing rather than tidy-minded. Do not delete them on the
  // grounds that this list covers it. It does not.
  PERSISTED_ROOT,
  `${PERSISTED_ROOT}/**`,
  `**/${PERSISTED_ROOT}/**`,
  // Credentials. FIRECRAWL_API_KEY and anything else key-shaped.
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/.auth-secret",
  // Developer-machine trees: the test suite, the build and probe scripts, and
  // the recorder's scratch output. None is reachable from a route.
  "test/**",
  "scripts/**",
  "captures/**",
  // Build records and history, which the Build Manager reads on a workstation.
  "**/*.bmpx",
  "**/*.tsbuildinfo"
];

/**
 * `outputFileTracingIncludes` for `next.config.ts`.
 *
 * Keyed by `"**"` — every route — rather than per route. Per-route keys would be
 * tighter, but the reads above happen in server modules that any route may
 * import, and a tracing key that is subtly too narrow fails the same silent way
 * the missing file did. The cost is a few hundred kilobytes of manifests in the
 * image; the benefit is that this cannot be wrong.
 */
export function tracingIncludes() {
  const globs = RUNTIME_FILES.filter((g) => g.base === "studio" && g.trace).flatMap((g) => g.globs);
  return { "**": globs };
}

/** `outputFileTracingExcludes`, keyed the same way the includes are. */
export function tracingExcludes() {
  return { "**": TRACING_EXCLUDES };
}

/** The `repo`-based groups, which the Dockerfile copies because no tracer can
 *  reach outside its own root. */
export function repoGroups() {
  return RUNTIME_FILES.filter((g) => g.base === "repo");
}
