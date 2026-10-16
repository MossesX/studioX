/**
 * `npm run check:imports` — the import-graph gate at the command line
 * (INITIATION-PROMPT.md §5.1 tier 2).
 *
 * Two scans, both discovering:
 *   1. core imports nothing of studio's — nothing at all beyond its own
 *      declared dep set, node builtins and itself, and never
 *      `@mui/icons-material`, which is NAMED rather than left to the dep-set
 *      message;
 *   2. no SDK file (src/, app/, test/) imports a core deep path — the
 *      `@axf/core` barrel is the one way in.
 *
 * A third scan (no replica dashboard imports the UI kit) was removed at v0.3.0
 * P0 with the last replica — see the note above the violation tally.
 *
 * Like check:coverage, the gate distrusts itself before it reports: every run
 * pushes specifiers through the REAL classifier and requires the verdict it
 * should give — red rows with the RIGHT reason, and green rows that must not
 * be flagged at all.
 *
 * **The green rows are new on 2026-08-09 and they carry the MUI reversal.**
 * Core may now import `@mui/material`, and it may do so for exactly one
 * reason: its own package.json declares it as a peer. An absence-of-complaint
 * check cannot tell "allowed because declared" from "allowed because somebody
 * gutted the allowlist" — so the green rows assert the permission, and if MUI
 * is ever dropped from core's peerDependencies this gate fails immediately
 * instead of at whatever later point the import stops resolving. That is the
 * shape "do not weaken the rule to let MUI through" actually requires: the
 * general rule still bites (`@mui/lab`, undeclared, must still go red), and
 * the specific permission is pinned to its cause.
 *
 * The self-check is pure (no file is planted — the disk-mutation proof lives
 * in test/isolation-guards.test.ts, on the mutation harness); it exists so a
 * refactor that lobotomises the classifier cannot leave this gate silently
 * green in CI.
 *
 * Exit 0 clean, exit 1 with one line per violation.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifySpecifier,
  coreScanSpec,
  formatViolations,
  importViolations,
  studioScanSpec
} from "./lib/import-graph.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.resolve(here, "..");
const CORE = path.resolve(STUDIO, "..", "core");
const PACKAGES = path.resolve(STUDIO, "..");

// --- the self-check: the classifier must still be able to go red -----------
// Each row is [reason, what it should have caught, a fragment the reason must
// contain]. The fragment is not decoration: two of these rows would go red for
// the WRONG reason if their rule were deleted.
const coreCtx = coreScanSpec(CORE).ctx;
const studioCtx = studioScanSpec(STUDIO, CORE).ctx;
const mustBeRed = [
  [
    classifySpecifier("@axs/studio", path.join(CORE, "src"), coreCtx),
    "core importing the SDK",
    "not in the declared dep set"
  ],
  [
    classifySpecifier("@axf/core/src/registry", path.join(STUDIO, "src"), studioCtx),
    "studio importing a core deep path",
    "the public barrel is the only way in"
  ],
  [
    classifySpecifier("@mui/icons-material", path.join(CORE, "src"), coreCtx),
    "core importing the Material icon set",
    "resolves through the branding pack"
  ],
  [
    classifySpecifier("@mui/icons-material/Menu", path.join(CORE, "src"), coreCtx),
    "core deep-importing one Material icon",
    "resolves through the branding pack"
  ],
  [
    // The general rule, aimed at the family that is now PARTLY allowed. If the
    // permission were ever implemented as a blanket "@mui/ is fine" instead of
    // as the declared-dep-set lookup it actually is, this row is what catches
    // it — an undeclared MUI package must still be refused.
    classifySpecifier("@mui/lab", path.join(CORE, "src"), coreCtx),
    "core importing an UNDECLARED MUI package",
    "not in the declared dep set"
  ]
];
for (const [reason, what, fragment] of mustBeRed) {
  if (!reason) {
    console.error(`check:imports SELF-CHECK FAILED — the classifier no longer flags ${what}`);
    process.exit(1);
  }
  if (!reason.includes(fragment)) {
    console.error(
      `check:imports SELF-CHECK FAILED — ${what} is flagged for the wrong reason:\n` +
        `  got:    ${reason}\n  wanted: …${fragment}…`
    );
    process.exit(1);
  }
}

// --- and the other direction: what must NOT be flagged, and WHY -------------
// Each row is [verdict, what it is, the declaration that permits it]. These
// exist because "no complaint" is not evidence of a working allowlist — see
// the header. Removing @mui/material from core's peerDependencies makes these
// fail here, at the gate, naming the cause.
const mustBeGreen = [
  [
    classifySpecifier("@mui/material/styles", path.join(CORE, "src"), coreCtx),
    "core importing MUI",
    "core/package.json declares @mui/material in peerDependencies"
  ],
  [
    classifySpecifier("@emotion/react", path.join(CORE, "src"), coreCtx),
    "core importing Emotion",
    "core/package.json declares @emotion/react in peerDependencies"
  ]
];
for (const [reason, what, because] of mustBeGreen) {
  if (reason) {
    console.error(
      `check:imports SELF-CHECK FAILED — ${what} is being refused, but it is permitted:\n` +
        `  got:      ${reason}\n` +
        `  expected: allowed, because ${because}\n` +
        `  Since 2026-08-09 core owns the MUI theme bridge (src/theme/mui.ts) and cannot be\n` +
        `  written without createTheme. If the declaration was removed, restore it; do not\n` +
        `  delete this row.`
    );
    process.exit(1);
  }
}

// --- the real scans ---------------------------------------------------------
const core = importViolations(coreScanSpec(CORE));
const studio = importViolations(studioScanSpec(STUDIO, CORE));

if (core.files.length === 0 || studio.files.length === 0) {
  console.error("check:imports FAILED — a scan walked zero files; the tree moved under the gate");
  process.exit(1);
}
// The replica scan lived here and DELETED ITSELF by its own instruction. It
// stood over `src/dashboards/*-replica.tsx` and failed on an empty set, with
// the note: "if there genuinely stops being one, delete the rule deliberately
// rather than letting it pass over an empty set." v0.3.0 P0 deleted
// gizmox-replica.tsx — the only replica there has ever been — so that is what
// happened, in full, rather than the tempting one-character relaxation of the
// zero check.

const violations = [...core.violations, ...studio.violations];
if (violations.length) {
  console.error(`check:imports FAILED — ${violations.length} boundary violation(s):`);
  console.error(formatViolations(violations, PACKAGES));
  process.exit(1);
}

console.log(
  `check:imports OK — core clean (${core.files.length} files), ` +
    `studio clean (${studio.files.length} files), ` +
    `self-check ${mustBeRed.length} red + ${mustBeGreen.length} green as required`
);
