/**
 * `npm run link:kit` — make core and studio resolve ONE copy of the UI kit.
 *
 * ## Why this exists
 *
 * `@axf/core` declares `@mui/material`, `@emotion/react` and `@emotion/styled`
 * as PEER dependencies, which is the correct declaration: the host supplies
 * them, and two copies of Emotion in one tree means two style caches, while two
 * copies of MUI means two `ThemeContext` identities. It also keeps its own copy
 * in `packages/core/node_modules`, because `tsc -p packages/core` has to resolve
 * them to typecheck the package on its own.
 *
 * Those two facts fight. Turbopack (and Node) resolve a module from a file's
 * REAL path, and `studio/node_modules/@axf/core` is a symlink to
 * `packages/core` — so a `@mui/material/styles` import inside core resolves to
 * `core/node_modules`, and the same import inside studio resolves to
 * `studio/node_modules`. Different files, different module instances.
 *
 * The failure is silent, which is what makes it worth a script and a test
 * rather than a comment. Measured on 2026-08-09, with the bridge fully correct:
 * `muiThemeFrom()` returned `primary.main #ff7a1a`, `AxfMuiRoot` mounted
 * `<ThemeProvider>` with it, and every MUI component still rendered MUI's stock
 * light theme. No warning, no error, no console output — the app simply looked
 * like the mapping was broken.
 *
 * ## What it does
 *
 * Replaces `packages/core/node_modules/<scope>` with a junction to
 * `packages/studio/node_modules/<scope>`, so both packages' real paths are the
 * same directory and there is exactly one copy of each package on disk.
 * Junctions rather than symlinks: Windows creates them without elevation, and
 * this must work from a plain shell.
 *
 * Idempotent — re-running when the link is already correct does nothing and
 * says so. Run it after any `npm install` inside `packages/core`, which is what
 * `postinstall` is for.
 *
 * ## Why not the alternatives
 *
 *   - **`turbopack.resolveAlias`** — does not work on Windows (an absolute path
 *     value fails with "windows imports are not implemented yet", a relative one
 *     resolves against the importing file). See `next.config.ts`.
 *   - **npm workspaces at `packages/`** — the canonical fix, and the right one
 *     eventually. It relocates studio's entire `node_modules`, which is not
 *     something to do underneath a dev server that another session may own
 *     (`.claude/rules/concurrent-builds.md`). Worth doing deliberately, at a
 *     moment chosen for it, rather than as a side effect of a theme bridge.
 *   - **Dropping core's own copy** — measured: Turbopack then cannot resolve
 *     the kit from core at all, because nothing above `packages/core` provides
 *     it. Not a matter of preference.
 *
 * Zero dependencies, `node:fs` only — framework tooling per INITIATION §0.1.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isShared, linkScope, sharedScopes } from "./lib/kit-links.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.resolve(here, "..");
const CORE = path.resolve(STUDIO, "..", "core");

/** Run-as-script, compared as resolved PATHS. The `file://` + argv[1] string
 *  comparison this used first is wrong on Windows (`file:///C:/...` vs `C:\...`)
 *  and failed silently — the script exited 0 having done nothing, which is the
 *  exact shape of green lie this whole file exists to stop. */
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const scopes = sharedScopes(CORE);
  if (scopes.length === 0) {
    console.error("link:kit FAILED — core declares no scoped peers, so there is nothing to share");
    console.error("  If the MUI peers were removed deliberately, delete this script with them.");
    process.exit(1);
  }
  for (const scope of scopes) console.log(`link:kit  ${linkScope(scope, CORE, STUDIO)}`);
  const bad = scopes.filter((s) => !isShared(s, CORE, STUDIO));
  if (bad.length) {
    console.error(`link:kit FAILED — still two copies of: ${bad.join(", ")}`);
    process.exit(1);
  }
  console.log(`link:kit OK — ${scopes.length} scope(s) resolve to one copy`);
}
