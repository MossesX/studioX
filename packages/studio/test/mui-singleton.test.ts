/**
 * The UI kit is ONE copy — the invariant that broke the theme bridge silently.
 *
 * On 2026-08-09, with `muiThemeFrom` correct and `AxfMuiRoot` mounted,
 * `packages/core` and `packages/studio` resolved different `@mui/material`
 * directories. Core's `<ThemeProvider>` wrote core's `ThemeContext`; studio's
 * components read studio's. Every component rendered MUI's stock light theme.
 * Nothing threw, nothing warned, and the theme object was verifiably correct
 * (`primary.main #ff7a1a`) the entire time — so every signal available in code
 * said the bridge worked.
 *
 * The invariant is on DISK, so it can be asserted without a browser, and the
 * subject list is derived from core's own `peerDependencies`, so a peer added
 * later joins this check the day it is declared rather than the day it breaks
 * something.
 *
 * Fix when red: `npm run link:kit`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { isShared, sharedScopes } from "../scripts/lib/kit-links.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const CORE = path.resolve(STUDIO, "..", "core");

const corePkg = () =>
  JSON.parse(fs.readFileSync(path.join(CORE, "package.json"), "utf8")) as {
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

test("core declares the UI kit as PEERS, never as plain dependencies", () => {
  const pkg = corePkg();
  const peers = pkg.peerDependencies ?? {};

  for (const name of ["@mui/material", "@emotion/react", "@emotion/styled"]) {
    assert.ok(
      name in peers,
      `core no longer declares "${name}" as a peer dependency.\n` +
        `  It must be a PEER: two @emotion/react copies means two style caches and two MUI\n` +
        `  copies means two ThemeContext identities, and both fail SILENTLY — the app renders\n` +
        `  unthemed with no error anywhere. A plain "dependencies" entry guarantees the second\n` +
        `  copy rather than merely risking it.\n` +
        `  If the bridge was removed deliberately, delete this test with it.`
    );
  }

  const deps = (JSON.parse(fs.readFileSync(path.join(CORE, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  }).dependencies;
  assert.ok(
    !deps || Object.keys(deps).every((n) => !n.startsWith("@mui/") && !n.startsWith("@emotion/")),
    "core lists a UI-kit package under `dependencies`. It must be a peer — see above."
  );
});

test("core's scoped peers resolve to the SAME directory studio uses", () => {
  const scopes = sharedScopes(CORE);
  assert.ok(scopes.length > 0, "no scoped peers found on core — has the kit been removed?");

  for (const scope of scopes) {
    const mine = path.join(CORE, "node_modules", scope);
    const theirs = path.join(STUDIO, "node_modules", scope);
    assert.ok(
      isShared(scope, CORE, STUDIO),
      `${scope} is TWO copies:\n` +
        `    core   -> ${fs.existsSync(mine) ? fs.realpathSync(mine) : "(absent)"}\n` +
        `    studio -> ${fs.existsSync(theirs) ? fs.realpathSync(theirs) : "(absent)"}\n` +
        `  Turbopack resolves from a file's REAL path and @axf/core is a symlink into\n` +
        `  packages/core, so core's imports land in core/node_modules and studio's in\n` +
        `  studio/node_modules. The result is a ThemeProvider that writes a context nothing\n` +
        `  reads — silently.\n` +
        `  Fix: npm run link:kit`
    );
  }
});

test("react is NOT linked by this mechanism, and that is deliberate", () => {
  // Next already forces a single React, so linking it here would be a second
  // mechanism doing a job that is already done — and a second mechanism is a
  // second thing to be wrong. Asserted rather than left as a comment, because
  // "add react to the list" is the obvious-looking next edit.
  assert.ok(
    !sharedScopes(CORE).includes("react"),
    "react has entered the kit-link list. Next aliases React itself; a second linker for it " +
      "is redundant at best and a divergent copy at worst."
  );
});
