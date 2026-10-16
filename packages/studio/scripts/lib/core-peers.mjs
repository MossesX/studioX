/**
 * What `@axf/core` requires its HOST to supply — read from core, in one place.
 *
 * Three callers need this exact list and they must not each keep their own:
 *
 *   - `peel.mjs` and `bare-core.mjs` generate standalone apps that vendor core,
 *     so every peer core declares has to appear in the generated
 *     `package.json` — otherwise the app does not typecheck and does not run;
 *   - `lib/kit-links.mjs` links the scoped ones to studio's copies so there is
 *     one instance in the dev tree.
 *
 * This existed as a hardcoded `{next, react, react-dom}` literal in both
 * generators until 2026-08-09, and the day core gained `@mui/material` both
 * peels broke — `Cannot find module '@mui/material/styles'`, caught by
 * `test/bare-core.test.ts`. Hardcoding was the bug: a peel's dependency list
 * is a FACT ABOUT CORE, and facts about core belong to core. Derived here, a
 * peer added to core reaches every generated app the same day, with no edit to
 * either generator.
 *
 * Zero dependencies, `node:fs` only — framework tooling per INITIATION §0.1.
 */
import fs from "node:fs";
import path from "node:path";

/** Every peer core declares, as `{ name: range }`, straight off disk. */
export function corePeers(coreDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(coreDir, "package.json"), "utf8"));
  return { ...(pkg.peerDependencies ?? {}) };
}

/**
 * The peers a generated app must add beyond what its template already lists.
 *
 * `react` and `react-dom` are excluded because every template names them
 * explicitly already (they are also the app's own dependency, not merely
 * core's). Everything else — today the MUI/Emotion kit — is core's requirement
 * and nothing else in the generated app would mention it.
 *
 * Versions come from STUDIO's pinned ranges rather than core's peer ranges, so
 * a generated app installs exactly what the dev tree runs. A peer studio does
 * not declare is a real inconsistency and is reported, not defaulted: core
 * would be asking a host for something the reference host does not supply.
 */
export function peerDepsForGeneratedApp(coreDir, studioPkg, fail) {
  const out = {};
  for (const [name, coreRange] of Object.entries(corePeers(coreDir))) {
    if (name === "react" || name === "react-dom") continue;
    const pinned = studioPkg.dependencies?.[name];
    if (!pinned) {
      fail(
        `@axf/core declares the peer "${name}" (${coreRange}) but packages/studio does not ` +
          `depend on it. A generated app cannot be given a version nobody is running — ` +
          `add it to studio's dependencies, or drop the peer from core.`
      );
    }
    out[name] = pinned;
  }
  return out;
}
