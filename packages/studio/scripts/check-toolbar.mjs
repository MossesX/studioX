/**
 * @file `npm run check:toolbar` — the CI layer of the P2 toolbar-kind gate.
 *
 * Executes the REAL chokepoint — `core/src/toolbar/types.ts` under Node's
 * native type stripping (its only import is `type { ReactNode }`, erased) —
 * and the REAL shipped assets (`banners.ts`, `console-bar.ts`) with
 * `@axf/core` resolved to that same module, so the check runs against what
 * ships rather than a copy written for the checker.
 *
 * Self-tests run the MUTATIONS every time (the `check:coverage` precedent —
 * a guard watched red on every run can never silently regress):
 *
 *   1. a `field` with an empty command must throw;
 *   2. a `menu` with an empty command must throw;
 *   3. a `rail` carrying a brand item must throw;
 *   4. a `banner` role offered to the `app.rail` surface must throw;
 *   5. a valid rail with labelled action / menu / field must define.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = pathToFileURL(resolve(here, "../../core/src/toolbar/types.ts")).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@axf/core") return { url: TYPES, shortCircuit: true };
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.\w+$/.test(specifier)) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      for (const ext of [".ts", ".tsx"]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  }
});

const { defineToolbar, ToolbarDefinitionError, SURFACE_ROLES } = await import(TYPES);

let failures = 0;
const ok = (msg) => console.log(`  ok  ${msg}`);
const bad = (msg) => {
  failures += 1;
  console.error(`  FAIL  ${msg}`);
};

/* ------------------------------------------------- shipped assets still define */

const { BANNERS } = await import(pathToFileURL(resolve(here, "../src/toolbars/banners.ts")).href);
const { CONSOLE_BARS } = await import(
  pathToFileURL(resolve(here, "../src/toolbars/console-bar.ts")).href
);
const { COMMAND_BAR } = await import(
  pathToFileURL(resolve(here, "../src/toolbars/command-bar.ts")).href
);

BANNERS.length === 3
  ? ok(`banners.ts defines ${BANNERS.length} banner assets (unedited additions rule holds)`)
  : bad(`banners.ts defines ${BANNERS.length} assets, expected 3`);

/* ------------------------------ the theme designer's tab bar (2026-08-13) */

const { DESIGNER_TABS_BAR, DESIGNER_TABS_SURFACE, DESIGNER_TAB_COMMAND } = await import(
  pathToFileURL(resolve(here, "../src/toolbars/designer-tabs-bar.ts")).href
);

DESIGNER_TABS_BAR.role === "pane-toolbar" && DESIGNER_TABS_BAR.surface === DESIGNER_TABS_SURFACE
  ? ok("designer-tabs-bar is a pane-toolbar for its own surface")
  : bad(`designer-tabs-bar role/surface: ${DESIGNER_TABS_BAR.role} / ${DESIGNER_TABS_BAR.surface}`);

/* Seven, because /theme has seven screens — Surfaces joined on 2026-08-15.
 * Pinned so an eighth tab added to the designer without an eighth item here — a
 * screen with no way to reach it — is a failing gate rather than a tab that
 * quietly does not exist. Moving this number is a deliberate act each time: the
 * gate caught the Surfaces tab exactly as designed, and the number went up only
 * once the item beside it existed. */
DESIGNER_TABS_BAR.items.length === 7
  ? ok("designer-tabs-bar carries one item per designer screen (7)")
  : bad(`designer-tabs-bar carries ${DESIGNER_TABS_BAR.items.length} items, expected 7`);

/* "with branded icons but LARGER" — the owner's words, as a number. The
 * shipped default is 13, so an asset that lost its declared size would render
 * a bar that looks like every other one and nothing else would notice. */
DESIGNER_TABS_BAR.iconSize > 13
  ? ok(`designer-tabs-bar declares iconSize ${DESIGNER_TABS_BAR.iconSize} (> the shipped 13)`)
  : bad(`designer-tabs-bar declares iconSize ${DESIGNER_TABS_BAR.iconSize}, expected larger than 13`);

/* The screen slices the tab key off the command and feeds it to setState, so a
 * command that stops matching the prefix, or an item id that stops matching its
 * own command's tail, is a tab that silently does nothing when clicked. */
for (const item of DESIGNER_TABS_BAR.items) {
  const expected = `${DESIGNER_TAB_COMMAND}${item.id}`;
  const branded = typeof item.glyph === "string" && item.glyph.startsWith("icon-");
  item.kind === "action" && item.command === expected && item.label && branded
    ? ok(`designer tab "${item.id}" → ${item.command}, labelled, drawn by ${item.glyph}`)
    : bad(`designer tab item is ${JSON.stringify(item)}, expected an action ${expected} with a label and an icon- glyph`);
}

/* --------------------------------------- the command bar (P4, MASTER §3) */

COMMAND_BAR.role === "banner" && COMMAND_BAR.surface === "app.banner"
  ? ok("command-bar is a banner for app.banner")
  : bad(`command-bar role/surface: ${COMMAND_BAR.role} / ${COMMAND_BAR.surface}`);

/* 12 as of 2026-08-13: the 11 items of MASTER §3's binding table plus the
 * Module Assistant action — a deliberate addition (owner directive: every
 * module ships with the assistant, and the bar is one of its affordances),
 * pinned here BY NAME so the count check keeps meaning "the replica plus the
 * recorded departures" rather than "whatever the file has today". */
COMMAND_BAR.items.length === 12
  ? ok("command-bar carries the 11 binding-table items + the assistant action")
  : bad(`command-bar carries ${COMMAND_BAR.items.length} items, expected 12 (11 + assistant)`);

const cbAssistant = COMMAND_BAR.items.find((i) => i.id === "assistant");
cbAssistant?.kind === "action" && cbAssistant?.command === "assistant.toggle"
  ? ok("command-bar assistant action fires assistant.toggle")
  : bad(`command-bar assistant item is ${JSON.stringify(cbAssistant)}`);

const cbBrand = COMMAND_BAR.items.find((i) => i.kind === "brand");
cbBrand?.glyph === "lockup-horizontal" && cbBrand?.command === "nav.home"
  ? ok("command-bar brand binds lockup-horizontal and fires nav.home")
  : bad(`command-bar brand is ${JSON.stringify(cbBrand)}`);

/* The shipped NON-banner roles.
 *
 * This used to read `sandbox-bars.ts` and require the shipped set to cover
 * rail / status-bar / pane-toolbar. v0.3.0 P0 deleted the sandbox plugin and
 * its bars, and `console-bar.ts` is what still ships a non-banner role
 * (`status-bar` on the console's own surface). Asserting the three roles
 * against a tree that only has one would be asserting a wish.
 *
 * The other two roles are NOT left unchecked, and each is exercised below
 * through the real chokepoint on every run: `rail` by the mutation that refuses
 * one carrying a brand item, and `pane-toolbar` by the empty-command mutations
 * and by the valid-bar case that defines a labelled action / menu / field. So
 * the ROLES stay covered; what narrowed is the claim about which of them
 * happens to be registered today, which is the honest thing to narrow. */
const roles = new Set(CONSOLE_BARS.map((b) => b.role));
roles.has("status-bar")
  ? ok(`console bars ship a status-bar role (${[...roles].join(", ")})`)
  : bad(`console bars cover only: ${[...roles].join(", ")}`);

/* ---------------------------------------------------------- surface contract */

for (const [surface, role] of [
  ["app.banner", "banner"],
  ["app.rail", "rail"],
  ["app.status", "status-bar"]
]) {
  SURFACE_ROLES[surface] === role
    ? ok(`SURFACE_ROLES["${surface}"] = "${role}"`)
    : bad(`SURFACE_ROLES["${surface}"] is "${SURFACE_ROLES[surface]}", expected "${role}"`);
}

/* -------------------------------------------- mutations, watched red each run */

function mustThrow(label, spec) {
  try {
    defineToolbar(spec);
    bad(`${label} — defineToolbar accepted it`);
  } catch (e) {
    e instanceof ToolbarDefinitionError
      ? ok(`${label} — threw: ${e.message}`)
      : bad(`${label} — threw the wrong error: ${e}`);
  }
}

mustThrow("field with empty command", {
  id: "mut-field",
  title: "m",
  role: "pane-toolbar",
  surface: "mut.pane",
  description: "m",
  items: [{ kind: "field", id: "f", glyph: "icon-search", placeholder: "p", command: "  " }]
});

mustThrow("menu with empty command", {
  id: "mut-menu",
  title: "m",
  role: "pane-toolbar",
  surface: "mut.pane",
  description: "m",
  items: [{ kind: "menu", id: "m", glyph: "icon-grid", label: "M", command: "" }]
});

mustThrow("brand with an empty command (a clickable logo that does nothing)", {
  id: "mut-brand-cmd",
  title: "m",
  role: "banner",
  surface: "app.banner",
  description: "m",
  items: [{ kind: "brand", id: "b", command: "  " }]
});

mustThrow("iconSize of 0 (a bar whose icons are invisible)", {
  id: "mut-icon-size",
  title: "m",
  role: "pane-toolbar",
  surface: "mut.pane",
  description: "m",
  iconSize: 0,
  items: [{ kind: "action", id: "a", glyph: "icon-grid", title: "A", command: "x" }]
});

mustThrow("rail carrying a brand item", {
  id: "mut-rail-brand",
  title: "m",
  role: "rail",
  surface: "mut.rail",
  description: "m",
  items: [{ kind: "brand", id: "b" }]
});

mustThrow("banner role on the app.rail surface", {
  id: "mut-surface",
  title: "m",
  role: "banner",
  surface: "app.rail",
  description: "m",
  items: [{ kind: "brand", id: "b" }]
});

try {
  defineToolbar({
    id: "mut-valid",
    title: "m",
    role: "pane-toolbar",
    surface: "mut.pane",
    description: "m",
    items: [
      { kind: "action", id: "a", glyph: "icon-grid", title: "A", command: "x", label: "Act" },
      { kind: "menu", id: "m", glyph: "icon-grid", label: "M", command: "x" },
      { kind: "field", id: "f", glyph: "icon-search", placeholder: "p", command: "x" }
    ]
  });
  ok("valid bar with labelled action / menu / field defines");
} catch (e) {
  bad(`valid bar with the new kinds was refused: ${e}`);
}

if (failures) {
  console.error(`\ncheck:toolbar — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:toolbar — all green (mutations watched red this run)");
