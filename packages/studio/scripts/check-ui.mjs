/**
 * @file `npm run check:ui` — the CI layer of the no-hand-rolled-ui rule.
 *
 * The rule (owner, 2026-08-07): **no part of a ui may be hand-rolled, and that
 * includes its assets.** A ui is assembled from registered assets; it does not
 * hand-draw the pieces an asset kind already exists for.
 *
 * Extended 2026-08-10 (owner, verbatim): *"i just want mui wherever possible i
 * want to make sure when modules or plugins or uis are built if an mui
 * component exist i want it used"*. Prose does not hold that — a rule that
 * depends on remembering is not a rule — so it lands here, on the discovering
 * scan, and it covers **both packages**. Core is in scope on purpose:
 * `check-imports.mjs` keeps a separate core spec and a separate studio spec,
 * and a guard that scanned only studio would leave the framework itself exempt
 * from the rule meant to make it universal.
 *
 * Compile-time and runtime layers live in `@axf/core` — `defineToolbar` refuses
 * a banner without a brand, a non-banner WITH one, and any role/surface
 * mismatch. This is the third layer: a DISCOVERING scan, so a ui, module or
 * plugin written next month joins the check the day it is written with no edit
 * here.
 *
 * ## What it checks
 *
 *   1. **The delegation chain to the banner is intact** — verified at each
 *      link's source rather than trusted, because a broken link silently strips
 *      the banner from every route while a marker-trusting scan stays green.
 *   2. **No `<header>` outside core**, the thing the toolbar asset replaced.
 *   3. **No route re-mounting shell chrome** (a second banner, a second style
 *      root).
 *   4. **No hand-rolled control where an MUI component exists** — `<button>`,
 *      `<input>`, `<select>`, `<textarea>`, `<table>`, `<dialog>`, `<nav>`.
 *   5. **No inline-styled `<div>` chrome standing in for `Paper`/`Card`/
 *      `Box`/`Stack`** — a plain container carrying background, border,
 *      radius, shadow, padding or flex/grid layout in a `style={{…}}`.
 *
 * ## What is NOT claimed
 *
 * Not "zero non-MUI elements". Everything bottoms out in a `div` — `Box` IS a
 * div — so a scan demanding otherwise would be demanding something false. The
 * checkable rule is "no hand-rolled CONTROL where an MUI component exists, and
 * no hand-drawn CHROME where a surface component exists", and that is what is
 * implemented. Inline style is the proxy for hand-drawn chrome because it is
 * what hand-drawn chrome actually looks like in this tree; a file could still
 * move the same declarations into a stylesheet, and the compile-time and
 * runtime layers (plus review) are what stand behind that gap.
 *
 * ## Exceptions vs. debt — two lists, and they are not the same thing
 *
 * An **exception** is permanent and is about the SURFACE: there is no MUI
 * component for what it does, or using one would be wrong. Each is written with
 * that reason below.
 *
 * A **debt ledger entry** is a surface that predates the directive and has not
 * been rewritten yet. It is NOT an exception — "we did not get round to it"
 * belongs in a failing assertion, and this is that assertion, deferred with a
 * number attached. The ledger RATCHETS: a count that goes up fails, a count
 * that goes down fails until the number is lowered, and a file that becomes
 * clean fails until its entry is deleted. So the debt can only shrink, and it
 * cannot be added to quietly — a new file that violates is not in the ledger
 * and goes straight to red.
 *
 * Exit code 1 on any violation, so it is usable as a gate.
 */
import fs from "node:fs";
import path from "node:path";

const STUDIO = path.resolve(import.meta.dirname, "..");
const CORE = path.resolve(STUDIO, "..", "core");
const SKIP = new Set(["node_modules", ".next", ".turbo", "scripts", "captures", "data"]);

/**
 * The scanned roots. `packages/core/src` is here for the reason in the header;
 * `node_modules/@axf/core` is a symlink to the very same directory, which is
 * why node_modules is skipped rather than followed — the alternative is every
 * core violation reported twice under two names.
 */
const ROOTS = [
  { pkg: "core", dir: "src", abs: path.join(CORE, "src") },
  { pkg: "studio", dir: "src", abs: path.join(STUDIO, "src") },
  { pkg: "studio", dir: "app", abs: path.join(STUDIO, "app") }
];

/** Routes that legitimately render no full-page ui of their own. */
const NOT_A_FULL_PAGE_UI = {
  "studio/app/layout.tsx": "the document shell — it wraps uis, it is not one",
  "studio/app/api": "route handlers, not screens"
};

/* ------------------------------------------------------- the MUI rule ----- */

/**
 * Hand-rolled control → the MUI component that already exists for it.
 *
 * The message names the replacement, because a violation whose fix is a
 * lookup is a violation people work around. `<header>` is in the list twice
 * over — it is also rule 2, which predates this one and carries the toolbar
 * asset's own reason.
 */
const RAW_CONTROLS = {
  button: "Button / IconButton / ButtonBase",
  input: "TextField (or Input / InputBase)",
  select: "Select, or TextField with `select`",
  textarea: "TextField with `multiline`",
  table: "Table / TableHead / TableBody / TableRow / TableCell",
  dialog: "Dialog",
  nav: "the nav asset — <NavShell>/<NavMenu>, not a hand-drawn bar"
};

/** Plain containers that can stand in for a surface component. */
const CONTAINERS = ["div", "span", "section", "article", "aside", "main", "ul", "ol", "li", "p"];

/**
 * Declarations that make a container CHROME rather than a layout detail.
 *
 * Deliberately not "any inline style": a `style={{ width: measured }}` on a
 * pane being dragged is geometry a component cannot express, and flagging it
 * would push people toward the file-level exception list for something that is
 * not the violation. What is flagged is the vocabulary of a surface — paint,
 * edge, elevation, spacing, and the flex/grid arrangement `Stack` exists for.
 */
const CHROME_PROPS = [
  "background",
  "backgroundColor",
  "border",
  "borderTop",
  "borderBottom",
  "borderLeft",
  "borderRight",
  "borderRadius",
  "boxShadow",
  "padding",
  "gap",
  "flexDirection",
  "alignItems",
  "justifyContent"
];

/**
 * `display: flex|grid` counts too, and only in those values.
 *
 * A `display: "none"` or `"inline-block"` is not chrome — it is a visibility or
 * a flow detail, and flagging it would make the rule mean "no inline style",
 * which is not the rule. A flex or grid container laid out by hand IS the thing
 * `Stack` exists for, so it belongs in the count.
 */
const LAYOUT_DISPLAY = /\bdisplay\s*:\s*["'](flex|grid|inline-flex)["']/;

/**
 * Permanent exceptions. Every one names the SURFACE and why no MUI component
 * is the right answer for it — never "this file is old".
 *
 * `rules` scopes the exception, so an exempt file that grows a genuinely
 * hand-rolled control is still caught: `PaneLayout` may compute geometry
 * inline, and would still go red for a raw `<button>`.
 */
const EXCEPTIONS = [
  {
    file: "core/src/brand/Glyph.tsx",
    rules: ["mui-chrome"],
    reason:
      "draws pack SVG. Icons resolve through the branding pack's role variables so they " +
      "recolour with the theme; @mui/icons-material is excluded on purpose because a Material " +
      "icon paints a shipped hex no theme can reach. The inline style here is the drawing's own " +
      "box, not chrome around it."
  },
  {
    file: "core/src/panes/PaneLayout.tsx",
    rules: ["mui-chrome"],
    reason:
      "split-pane drag and measurement. MUI has no split-pane component, and a pane's size " +
      "during a drag is a measured number that no `sx` prop can carry. Its CHROME is still MUI; " +
      "only the geometry is bespoke, which is why this exemption is scoped to the style rule and " +
      "a raw control here would still fail."
  },
  {
    file: "core/src/shell/Boundary.tsx",
    rules: ["mui-control", "mui-chrome"],
    reason:
      "the crash fallback. It renders BECAUSE something in the tree threw — and the thing that " +
      "threw may be the theme provider, the Emotion cache or MUI itself. A fallback built from " +
      "the kit it is catching a failure in can throw inside the boundary, which takes down the " +
      "app the boundary exists to keep up. It paints from `token()` (engine CSS variables) so it " +
      "still follows the theme without depending on a provider. RE-READ in P2 (2026-08-10) " +
      "rather than inherited: the failure is reachable, not hypothetical — theme/mui.ts records " +
      "that createTheme throws on an unparseable colour and that 'the alternative is a white " +
      "screen', and AppShell mounts the app tier OUTSIDE AxfMuiRoot for exactly that case. " +
      "Confirmed by mutation the same day: AxfMuiRoot was made to throw and this panel rendered."
  },
  {
    file: "core/src/theme/ThemeScope.tsx",
    rules: ["mui-control", "mui-chrome"],
    reason:
      "a publisher, not a visual component. It writes custom properties onto its own element; " +
      "the four style declarations it sets are the scope painting itself in the theme it " +
      "publishes, which is the whole point of the component."
  },
  {
    file: "core/src/theme/ThemeBridge.tsx",
    rules: ["mui-control", "mui-chrome"],
    reason:
      "AxfStyleRoot — the ONE root publisher. Not a visual component either; it owns `:root` and " +
      "renders nothing a person sees."
  }
];

/**
 * Pre-directive debt. NOT exceptions — see the header.
 *
 * `raw` and `chrome` are the counts measured on 2026-08-10, the day the rule
 * arrived. `owner` names who removes it, because a debt with no owner is an
 * exception wearing a different hat.
 */
const PRE_MUI_DEBT = {
  // CLEARED by axf-mui P2 (2026-08-10), and their entries deleted rather than
  // zeroed — a zero is still a line the ratchet has to be told to ignore:
  //   - core/src/ctx/ContextMenu.tsx (was 0 raw / 2 chrome) → Paper panels,
  //     MenuItem rows, ListSubheader headings, Divider rules. It did NOT take
  //     Menu/Popover/MenuList; the file's docblock names each and why.
  //   - core/src/shell/AppShell.tsx (was 0 raw / 1 chrome) → the viewport
  //     column is a Box.
  // Core's remaining surfaces (Boundary, PaneLayout, Glyph) are EXCEPTIONS
  // above, not debt, and each of those reasons was re-read in P2 rather than
  // inherited.
  //
  // CLEARED by axf-mui P3 (2026-08-10) — the shell chrome and the studio
  // surfaces the ledger named P3 as owner of. Entries deleted rather than
  // zeroed, per the header:
  //   - studio/src/toolbars/CommandBarChrome.tsx (was 4 raw / 5 chrome) → the
  //     Modules menu is a Menu, the palette a Dialog + TextField + List, the
  //     toast a Snackbar whose autoHideDuration replaced a hand-run timer. The
  //     bar's search control stays a BUTTON styled as a field: MUI restores
  //     focus to the trigger on dialog close, and a read-only input with an
  //     onFocus re-opens the palette forever. That trap is why the file's
  //     docblock names MUI rather than treating this as paint.
  //   - studio/src/plugins/brand-gallery/BrandGallery.tsx (was 2 raw /
  //     25 chrome) → Card/CardHeader/CardContent, Stack, Typography,
  //     ToggleButtonGroup for the zoom, and CardActionArea/ListItemButton for
  //     the pack rows, which were <div onClick> and unreachable by keyboard
  //     while being the most consequential control on the screen.
  //   - studio/app/page.tsx (was 0 raw / 2 chrome) and studio/app/status/
  //     page.tsx (was 0 raw / 4 chrome) → both also dropped a second <main>
  //     landmark; NavShell renders the one <main>.
  //
  // CLEARED by axf-mui P4 (2026-08-10), entry deleted rather than zeroed:
  //   - studio/src/dashboards/amberx-console.tsx (was 0 raw / 3 chrome) → the
  //     INTEGRATED FRAMEWORK sub-band is a Stack, the screen container and the
  //     outer column are Box, and the clock is Typography. It did NOT take
  //     Paper for the sub-band: Paper paints background.paper, and the band
  //     sits on the page with only a rule under it. `look-binding.ts` and the
  //     wrapper's activation seam were not touched — the transition-only rule
  //     is what the owner's approval gate is guarding, and paint was the only
  //     thing P4 had licence to change.
  //
  // CLEARED by axf-mui P5 (2026-08-10), entry deleted rather than zeroed — the
  // largest one in the ledger:
  //   - studio/src/plugins/build-manager/BuildManagerPreview.tsx (was 5 raw /
  //     19 chrome) → the plan outline is Table/TableBody/TableRow/TableCell,
  //     the switches, mode pair and START are ButtonBase, panes and strips are
  //     Box/Stack, text is Typography, and the pulse keyframes moved from a raw
  //     <style> element to GlobalStyles. It did NOT take Button/ToggleButton
  //     (minWidth 64, own padding, uppercase — all of it overridden back off at
  //     this density) or Paper for the panes (it paints background.paper and
  //     sets text.primary; a pane here paints --axf-page). The one behaviour
  //     change is deliberate and recorded in the file: project rows were
  //     <div onClick> and are ButtonBase now, so the control that decides what
  //     the whole screen shows is reachable from a keyboard.
  //     `npm run check:buildmgr` holds the LOOK, separately and by measurement.
  "studio/app/mui-probe/page.tsx": {
    raw: 2,
    chrome: 2,
    owner: "axf-mui (it owns the probe fixture)",
    note:
      "the fixture `scripts/mui-probe.mjs` drives. Its raw tables are the readout, not the " +
      "subject — but they are still raw tables, so they are debt rather than an exception."
  },
};

/* ------------------------------------------------------------- machinery -- */

function walk(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const p = path.join(dir, e.name);
    const rel = base + e.name;
    return e.isDirectory() ? walk(p, rel + "/") : [rel];
  });
}

/**
 * Strip comments before testing markers. Found by mutation, not foresight:
 * AppShell's own docblock says "mounts `<Toolbar>`", and the marker regex
 * matched the PROSE — renaming the real JSX element kept the check green.
 * A guard that can be satisfied by a comment is satisfied by documentation
 * of the thing it is supposed to verify.
 *
 * BLANKED, not deleted — every stripped character becomes a space and every
 * newline survives, so an index into the stripped string is still an index into
 * the original and `lineOf` reports the line the reader will actually find the
 * violation on. Deleting the spans instead (as this did until 2026-08-15) shifts
 * every line after a comment up by that comment's height: two violations
 * reported that day were off by 48 and 36 lines, which reads as a broken scanner
 * rather than a broken offset. Note `^\s*` in the line-comment half can eat the
 * preceding newlines as well, so it is not only the block half that drifted.
 */
function stripComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^\s*\/\/.*$/gm, blank);
}

function readFirst(candidates) {
  for (const p of candidates) {
    if (fs.existsSync(p)) return { found: p, src: stripComments(fs.readFileSync(p, "utf8")) };
  }
  return { found: null, src: "" };
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

const violations = [];
const record = (file, rule, detail) => violations.push({ file, rule, detail });

const exemption = (file, rule) =>
  EXCEPTIONS.find((e) => e.file === file && e.rules.includes(rule));
const exercised = new Set();

/* ------------------------------------------- 1: the delegation chain ------ */

/**
 * Verify the delegation chain instead of trusting it.
 *
 * Since 2026-08-08 the banner (and the nav, and the style root) mount ONCE, at
 * the app root: `app/layout.tsx` → `StudioShell` → core's `AppShell`, which
 * mounts `<Toolbar surface="app.banner">`. Every route is banner-bearing by
 * construction — IF that chain holds. So the chain is what this verifies, at
 * each link's source, because a broken link would silently strip the banner
 * from every route while a marker-trusting scan stayed green (the exact false
 * green this script already caught once when the guarantee lived in
 * ModuleHost).
 */
const appShell = readFirst([path.join(CORE, "src", "shell", "AppShell.tsx")]);
if (!appShell.found) {
  record(
    "@axf/core",
    "delegation-chain-unverifiable",
    "could not locate core's AppShell, so 'the layout shell implies a banner' cannot be " +
      "verified. Fix the resolution rather than trusting the chain."
  );
} else {
  if (!/<Toolbar[\s/>]/.test(appShell.src)) {
    record(
      "core/src/shell/AppShell.tsx",
      "delegation-chain-broken",
      "core's AppShell no longer mounts <Toolbar>, so every route has silently lost its " +
        "banner while still passing this scan. Restore it, or move the guarantee and this " +
        "check together."
    );
  }
  if (!/<NavShell[\s/>]/.test(appShell.src)) {
    record(
      "core/src/shell/AppShell.tsx",
      "delegation-chain-broken",
      "core's AppShell no longer mounts <NavShell> — every route has lost its nav menu."
    );
  }
}

const layout = readFirst([path.join(STUDIO, "app", "layout.tsx")]);
if (!/StudioShell/.test(layout.src)) {
  record(
    "studio/app/layout.tsx",
    "delegation-chain-broken",
    "the root layout no longer mounts StudioShell, so no route gets the shell. " +
      "Every page would need its own chrome, which is the drift the shell exists to stop."
  );
}
const studioShell = readFirst([path.join(STUDIO, "src", "StudioShell.tsx")]);
if (!/<AppShell[\s/>]/.test(studioShell.src)) {
  record(
    "studio/src/StudioShell.tsx",
    "delegation-chain-broken",
    "StudioShell no longer mounts core's AppShell — the chain to the banner is cut."
  );
}

/* ------------------------------------------------- 2-5: the file scan ----- */

const measured = new Map();
let scanned = 0;

for (const root of ROOTS) {
  for (const rel of walk(root.abs).filter((f) => /\.tsx$/.test(f))) {
    const file = `${root.pkg}/${root.dir}/${rel}`;
    const src = stripComments(fs.readFileSync(path.join(root.abs, rel), "utf8"));
    scanned++;
    const counts = { raw: 0, chrome: 0 };

    /* 2 — hand-rolled header. Core is where the toolbar asset lives, so a
       <header> there is the implementation rather than a copy of it. */
    if (root.pkg !== "core" && /<header[\s>]/.test(src)) {
      record(
        file,
        "no-hand-rolled-ui",
        "renders a raw <header>. A bar is a `toolbar` asset — mount <Toolbar surface=…/> " +
          "and supply content by slot instead."
      );
    }

    /* 3 — a page re-mounting shell chrome. The layout provides the banner, the
       nav and the style root for every route; a page mounting its own
       app.banner or style root produces a double banner / a second variable
       publisher — the precise defects the single shell exists to prevent. */
    const isRoutePage = root.pkg === "studio" && root.dir === "app" && /page\.tsx$/.test(rel);
    const exempt = Object.keys(NOT_A_FULL_PAGE_UI).some((k) => file.startsWith(k));
    if (isRoutePage && !exempt) {
      if (/surface="app\.banner"/.test(src)) {
        record(
          file,
          "shell-owns-the-banner",
          'mounts <Toolbar surface="app.banner"> itself. The layout shell already mounts the ' +
            "banner for every route — this renders a second one."
        );
      }
      if (/<AxfStyleRoot[\s/>]/.test(src)) {
        record(
          file,
          "shell-owns-the-style-root",
          "mounts <AxfStyleRoot> itself. The shell mounts the ONE publisher; a second mount " +
            "reopens the two-publisher race the engine already fixed once."
        );
      }
    }

    /* 4 — a hand-rolled control where an MUI component exists. */
    const controlRe = new RegExp(`<(${Object.keys(RAW_CONTROLS).join("|")})[\\s>/]`, "g");
    const controlHits = [];
    for (let m; (m = controlRe.exec(src)); ) controlHits.push({ tag: m[1], line: lineOf(src, m.index) });
    counts.raw = controlHits.length;
    if (controlHits.length) {
      const ex = exemption(file, "mui-control");
      if (ex) exercised.add(`${file}:mui-control`);
      else if (!PRE_MUI_DEBT[file]) {
        for (const hit of controlHits) {
          record(
            `${file}:${hit.line}`,
            "mui-component-exists",
            `renders a raw <${hit.tag}>. Use ${RAW_CONTROLS[hit.tag]} — the owner's rule ` +
              "(2026-08-10) is that where an MUI component exists it is used, so the theme " +
              "engine reaches it and every surface behaves the same way."
          );
        }
      }
    }

    /* 5 — inline-styled chrome standing in for a surface component. */
    const chromeRe = new RegExp(`<(${CONTAINERS.join("|")})\\b[^>]*?\\bstyle=\\{\\{`, "gs");
    const chromeHits = [];
    for (let m; (m = chromeRe.exec(src)); ) {
      // Read the object literal that follows, brace-balanced, so a property
      // list spanning ten lines is judged on all ten.
      const open = src.indexOf("{{", m.index);
      let depth = 0;
      let end = open;
      for (let i = open + 1; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const body = src.slice(open, end + 1);
      const props = CHROME_PROPS.filter((p) => new RegExp(`\\b${p}\\s*:`).test(body));
      if (LAYOUT_DISPLAY.test(body)) props.unshift(`display: ${body.match(LAYOUT_DISPLAY)[1]}`);
      if (props.length) {
        chromeHits.push({ tag: m[1], line: lineOf(src, m.index), props });
      }
    }
    counts.chrome = chromeHits.length;
    if (chromeHits.length) {
      const ex = exemption(file, "mui-chrome");
      if (ex) exercised.add(`${file}:mui-chrome`);
      else if (!PRE_MUI_DEBT[file]) {
        for (const hit of chromeHits) {
          record(
            `${file}:${hit.line}`,
            "mui-component-exists",
            `paints a <${hit.tag}> by hand (${hit.props.slice(0, 4).join(", ")}). That is what ` +
              "Paper / Card / Box / Stack are, and an `sx` prop reaches the theme where an " +
              "inline style does not."
          );
        }
      }
    }

    if (counts.raw || counts.chrome) measured.set(file, counts);
  }
}

/* --------------------------------------------------------- the ratchet ---- */

for (const [file, ledger] of Object.entries(PRE_MUI_DEBT)) {
  const now = measured.get(file);
  if (!now) {
    record(
      file,
      "debt-ledger-stale",
      `is recorded as carrying ${ledger.raw} raw control(s) and ${ledger.chrome} hand-painted ` +
        "container(s), and now has none. Delete its entry from PRE_MUI_DEBT — a ledger nobody " +
        "prunes is an allowlist."
    );
    continue;
  }
  for (const kind of ["raw", "chrome"]) {
    if (now[kind] > ledger[kind]) {
      record(
        file,
        "debt-grew",
        `${kind === "raw" ? "hand-rolled controls" : "hand-painted containers"} went from ` +
          `${ledger[kind]} to ${now[kind]}. This surface is already carrying pre-MUI debt ` +
          `(owner: ${ledger.owner}); it is not a licence to add more. Use ` +
          `${kind === "raw" ? "the MUI component" : "Paper/Card/Box/Stack"} for the new code.`
      );
    } else if (now[kind] < ledger[kind]) {
      record(
        file,
        "debt-shrank",
        `${kind === "raw" ? "hand-rolled controls" : "hand-painted containers"} went from ` +
          `${ledger[kind]} to ${now[kind]} — good. Lower the number in PRE_MUI_DEBT to ` +
          `${now[kind]} so the ratchet holds at the new level; a stale ceiling lets the debt ` +
          "grow back for free."
      );
    }
  }
}

/* ------------------------------------------------------------- reporting -- */

const debtTotal = Object.values(PRE_MUI_DEBT).reduce(
  (acc, d) => ({ raw: acc.raw + d.raw, chrome: acc.chrome + d.chrome }),
  { raw: 0, chrome: 0 }
);
const unexercised = EXCEPTIONS.flatMap((e) =>
  e.rules.filter((r) => !exercised.has(`${e.file}:${r}`)).map((r) => `${e.file} [${r}]`)
);

if (violations.length === 0) {
  console.log(
    `check:ui — ${scanned} files scanned across ${ROOTS.length} roots (core + studio), no violations`
  );
  console.log(
    `  exceptions: ${EXCEPTIONS.length} surfaces, ${
      EXCEPTIONS.reduce((n, e) => n + e.rules.length, 0) - unexercised.length
    } rule(s) load-bearing right now`
  );
  if (unexercised.length) {
    // Not a failure: an exception for a surface that happens to be clean today
    // is a trap disarmed in advance, and deleting it would spring on the next
    // edit. Printed so it is a decision rather than a drift.
    console.log(`  not currently exercised: ${unexercised.join(", ")}`);
  }
  console.log(
    `  pre-MUI debt: ${Object.keys(PRE_MUI_DEBT).length} file(s), ${debtTotal.raw} raw control(s) ` +
      `+ ${debtTotal.chrome} hand-painted container(s), ratchet holding`
  );
  process.exit(0);
}

console.error(`check:ui — ${violations.length} violation(s):\n`);
for (const v of violations) {
  console.error(`  ${v.file}\n    [${v.rule}] ${v.detail}\n`);
}
process.exit(1);
