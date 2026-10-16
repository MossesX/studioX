import path from "node:path";
import type { NextConfig } from "next";

import { tracingExcludes, tracingIncludes } from "./deploy/runtime-files.mjs";

/**
 * Studio's own Next app, on :3200 — the port AmberX already decided on, and
 * deliberately not GizmoX's :80. Next locks `next dev` per directory, so the
 * two coexist rather than fight.
 *
 * `turbopack.root` is `packages/` — the parent of core and studio — and every
 * other candidate is wrong for a specific reason:
 *
 *   - **The repo root** makes Next resolve its file conventions from there and
 *     pick up GizmoX's own `src/proxy.ts` and `src/instrumentation.ts` as if
 *     they belonged to Studio. That is real cross-contamination, and the fact
 *     that it happens to fail the build is luck, not protection.
 *   - **This package alone** excludes `../core`, and Turbopack will not compile
 *     files outside its root — so every `@axf/core` import dies even though it
 *     resolves.
 *
 * `packages/` contains both, and contains this package's own node_modules, so
 * nothing has to reach outside it. GizmoX's `src/` sits outside it, so nothing
 * of GizmoX's can be reached in.
 */
/**
 * ## The UI kit must be ONE copy, and this is NOT where that is arranged
 *
 * Core declares `@mui/material` and `@emotion/*` as PEERS — the host supplies
 * them — and also carries its own copy in `packages/core/node_modules` so it
 * can typecheck standing alone. Turbopack resolves a module from the file's
 * REAL path, and `@axf/core` is a symlink into `packages/core`, so core's
 * imports land in `core/node_modules` while studio's land in
 * `studio/node_modules`: two Emotion caches and two MUI `ThemeContext`
 * identities in one tree.
 *
 * That is not a theoretical hazard. It is what happened on 2026-08-09, the
 * first time `AxfMuiRoot` was mounted. `createTheme` ran on the real palette
 * and produced the right object — `primary.main #ff7a1a`, measured — and every
 * component still resolved MUI's DEFAULT theme (`#1976d2`, `background.paper
 * #fff`, Roboto, radius 4), because core's `<ThemeProvider>` wrote core's
 * context and studio's `useTheme` read studio's. NOTHING errored. A provider
 * that silently fails to reach its children is the worst shape this bug comes
 * in: it looks exactly like a broken mapping, so the hours go into the mapping.
 *
 * **`turbopack.resolveAlias` was tried here first and does not work on
 * Windows.** Recorded as a negative result rather than left in as a line that
 * looks like a fix: an absolute path value fails the build outright with
 * `Module not found … windows imports are not implemented yet`, and a relative
 * value is resolved against the IMPORTING file, so no single string can be
 * correct for both packages. It also never matched core's actual request,
 * which is the subpath `@mui/material/styles`, not the bare package.
 *
 * The fix is therefore on disk, where it is bundler-independent and checkable:
 * `npm run link:kit` makes `core/node_modules/@mui` and `@emotion` junctions to
 * studio's, so both packages have the same REAL path and there is genuinely one
 * copy. `test/mui-singleton.test.ts` fails when they diverge, naming the
 * command — and it derives its subject list from core's own peerDependencies,
 * so a fourth peer joins the check the day it is declared.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname, "..")
  },
  /**
   * ## The container build (2026-08-15)
   *
   * `standalone` is what INITIATION-PROMPT §2 committed this project to on day
   * one: `.next/standalone` carries the server plus only the traced files, so
   * the image never installs `node_modules` and never ships the repo.
   *
   * `outputFileTracingRoot` is `packages/` — the same directory `turbopack.root`
   * names, and for the same reason. The tracer defaults to the project
   * directory, and `@axf/core` resolves through a symlink into
   * `packages/core`; with the default root, every file of core sits OUTSIDE the
   * trace and is silently dropped. The failure mode is not a build error, it is
   * a container that starts and 500s on the first import.
   *
   * `outputFileTracingIncludes` is generated from `deploy/runtime-files.mjs`
   * rather than written here, which is §2.1's rule made mechanical: the tracer
   * follows `import` and `require` and CANNOT see a path assembled at runtime
   * (`path.join(process.cwd(), "src", "plugins", id, "plugin.manifest.json")`),
   * so anything read that way has to be DECLARED or it will not exist in
   * production. One declaration file feeds both this and the Dockerfile's copy
   * step, because two lists drift and the drift is invisible until deploy.
   */
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname, ".."),
  outputFileTracingIncludes: tracingIncludes(),
  /**
   * The other half, and the half that was learned the hard way: the first
   * standalone build carried the whole package out — `data/`, `captures/`,
   * `test/`, and `.env` — because nft cannot evaluate a path built from
   * `process.cwd()` at runtime and keeps the directory rather than risk
   * dropping it. `deploy/runtime-files.mjs › TRACING_EXCLUDES` says what that
   * costs and why `.dockerignore` alone was not an answer.
   */
  outputFileTracingExcludes: tracingExcludes(),
  /**
   * `NEXT_DIST_DIR` lets a production build go somewhere other than `.next`.
   *
   * Not a preference — this tree is worked by several sessions at once against
   * ONE dev server (Next locks `next dev` per directory), and `next build`
   * writes the same `.next` that server is serving from. Building in place
   * takes the running app down mid-session and the cause is nowhere near the
   * symptom. `NEXT_DIST_DIR=.next-prod npm run build` verifies a real
   * production build against a live dev server; the Dockerfile sets nothing and
   * gets the default, which is what the COPY paths expect.
   */
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  /**
   * `@axf/core` ships SOURCE, not a build artefact — its `exports` map points
   * straight at `./src/index.ts`. Next does not transpile anything reached
   * through node_modules unless named here, so without this the import resolves
   * to TypeScript the bundler refuses to parse.
   *
   * Shipping source rather than a compiled `dist/` is deliberate while core is
   * being built: there is no build step to forget to run, and a change to core
   * is live in Studio on the next refresh. It becomes a real build when
   * something outside this repo consumes core.
   */
  transpilePackages: ["@axf/core"],
  /**
   * Playwright drives the firecrawl module's live browser (crawler viewer +
   * recorder). It spawns a real Chromium as a subprocess and resolves its
   * driver files relative to its own package directory, so it must stay a
   * runtime `require` from node_modules — bundling it breaks the driver
   * lookup. Named here so Next leaves it external.
   */
  serverExternalPackages: ["playwright", "playwright-core"],
  typescript: {
    // Same posture as GizmoX: `tsc --noEmit` is the real gate, run on its own,
    // so a build can never be "fixed" by weakening a type.
    ignoreBuildErrors: true
  }
};

export default nextConfig;
