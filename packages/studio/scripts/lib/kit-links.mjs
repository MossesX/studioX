/**
 * The UI-kit link invariant, as a library — so the CLI (`scripts/link-kit.mjs`)
 * and the gate (`test/mui-singleton.test.ts`) share ONE definition of "shared",
 * exactly as `check-imports.mjs` and `isolation-guards.test.ts` share
 * `lib/import-graph.mjs`.
 *
 * ## The invariant
 *
 * `packages/core` and `packages/studio` must resolve `@mui/material` and
 * `@emotion/*` to the same directory on disk.
 *
 * Core declares them as PEER dependencies, which is correct — the host supplies
 * them, and a second copy of Emotion means a second style cache while a second
 * copy of MUI means a second `ThemeContext` identity. Core also keeps its own
 * copy so `tsc -p packages/core` can typecheck the package standing alone.
 * Those two facts collide, because Turbopack and Node resolve a module from the
 * importing file's REAL path and `studio/node_modules/@axf/core` is a symlink
 * into `packages/core`.
 *
 * Measured consequence, 2026-08-09: `AxfMuiRoot` mounted `<ThemeProvider>` with
 * a correct theme (`primary.main #ff7a1a`) and every MUI component rendered the
 * stock light palette. No error, no warning. That is why this is a checked
 * invariant and not a comment.
 *
 * Zero dependencies, `node:fs` only — framework tooling per INITIATION §0.1.
 */
import fs from "node:fs";
import path from "node:path";

import { corePeers } from "./core-peers.mjs";

/**
 * The scopes to share, read from core's OWN peer declaration.
 *
 * Derived rather than listed, so a peer added to core joins the link and the
 * gate the day it is declared. `react`/`react-dom` are excluded because Next
 * already forces a single React — a second mechanism for it would be redundant
 * at best and a divergent copy at worst.
 *
 * Whole SCOPES rather than packages, because that is how the kit is installed:
 * `@mui/material` drags in `@mui/system`, `@mui/utils`, `@mui/styled-engine`
 * and the rest, and sharing only the named package would leave the internals
 * duplicated — which reproduces the same context split one level down.
 */
export function sharedScopes(coreDir) {
  const scopes = new Set();
  for (const name of Object.keys(corePeers(coreDir))) {
    if (name === "react" || name === "react-dom") continue;
    if (!name.startsWith("@")) {
      throw new Error(
        `core declares the unscoped peer "${name}". This mechanism links whole SCOPES, ` +
          `because that is how the kit is packaged. An unscoped peer needs a per-package ` +
          `link — a deliberate change to make, not one to guess at.`
      );
    }
    scopes.add(name.split("/")[0]);
  }
  return [...scopes].sort();
}

/** True when both packages resolve `scope` to the same real directory. */
export function isShared(scope, coreDir, studioDir) {
  const mine = path.join(coreDir, "node_modules", scope);
  const theirs = path.join(studioDir, "node_modules", scope);
  if (!fs.existsSync(mine) || !fs.existsSync(theirs)) return false;
  return fs.realpathSync(mine) === fs.realpathSync(theirs);
}

/**
 * Point core's `scope` at studio's, and verify it took.
 *
 * A junction rather than a symlink: Windows creates junctions without
 * elevation, and this has to work from a plain shell. Ignored on POSIX, where
 * `fs.symlinkSync` makes a directory symlink either way.
 */
export function linkScope(scope, coreDir, studioDir) {
  const target = path.join(studioDir, "node_modules", scope);
  const linkPath = path.join(coreDir, "node_modules", scope);

  if (!fs.existsSync(target)) {
    throw new Error(
      `studio has no ${scope} to share (${target}). Install it in packages/studio first — ` +
        `studio is the app, and the app owns the install.`
    );
  }
  if (isShared(scope, coreDir, studioDir)) return `${scope}  already shared`;

  // A real duplicate install, or a junction pointing somewhere else.
  if (fs.existsSync(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, "junction");

  if (!isShared(scope, coreDir, studioDir)) {
    throw new Error(`linked ${scope} but the real paths still differ — refusing to report success`);
  }
  return `${scope}  linked -> ${path.relative(path.dirname(coreDir), target)}`;
}
