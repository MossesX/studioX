/**
 * The MUI bridge — the mapping, the colour-parsing choice, and the dial ledger.
 *
 * This is the unit half. It cannot prove the bridge REACHES the DOM (nothing
 * running in Node can — see `scripts/mui-probe.mjs`, and the 2026-08-09
 * incident where every assertion available here was green while the app
 * rendered unthemed). What it does hold:
 *
 *   1. The colour-parsing measurement the design decision rests on. The
 *      docblock in `theme/mui.ts` claims `cssVariables` mode throws on a
 *      `var()` exactly as plain mode does; this RUNS both, so the claim is a
 *      measurement rather than a recollection, and a future MUI that changed
 *      this would reopen the decision instead of silently invalidating it.
 *   2. Every dial is accounted for — mapped, or recorded as having no
 *      counterpart. Discovering: it walks `DIALS`, so a dial added to the spec
 *      joins this test the day it exists.
 *   3. The mapping actually carries the values, including the derived ones.
 *   4. Rolling produces a different theme — the re-derivation the provider
 *      depends on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createTheme } from "@mui/material/styles";

import {
  DIALS,
  MUI_DIAL_MAP,
  MUI_UNDRIVEN,
  defaultValues,
  mappingFor,
  muiThemeFrom,
  resolveVariables,
  rollTheme,
  shadowFor,
  themeVariables,
  unmappedDials,
  unmappedSpecDials
} from "@axf/core";

/* ------------------------------------------------------------------------- */
/* 1 — the colour-parsing trap, measured in both modes                        */
/* ------------------------------------------------------------------------- */

test("var() in a palette entry throws — in BOTH plain and cssVariables mode", () => {
  // This is the measurement the whole design choice rests on. If either of
  // these ever stops throwing, `theme/mui.ts`'s stated reason for rejecting
  // cssVariables mode needs re-reading, not deleting.
  assert.throws(
    () => createTheme({ palette: { primary: { main: "var(--axf-accent)" } } }),
    /Unsupported/,
    "plain createTheme accepted a var() — the docblock's premise has changed"
  );

  assert.throws(
    () => createTheme({ cssVariables: true, palette: { primary: { main: "var(--axf-accent)" } } }),
    /Unsupported/,
    "cssVariables mode accepted a var(). That is the mode the alternative design would have " +
      "used, and the reason it was rejected is that it does NOT accept variable references as " +
      "input — it emits --mui-* as output and must parse real colours to do so."
  );
});

test("cssVariables mode still needs a parseable colour, so it dodges nothing", () => {
  // The positive half of the same point: given a real hex it works, and what it
  // produces is a SECOND variable namespace carrying the same truth as --axf-*.
  const t = createTheme({ cssVariables: true, palette: { primary: { main: "#ff7a1a" } } });
  assert.equal(
    t.palette.primary.mainChannel,
    "255 122 26",
    "cssVariables mode computes a channel by decomposing the colour — which is the same " +
      "parsing step a var() cannot survive"
  );
});

test("the bridge produces resolved colours, never a var() reference", () => {
  const t = muiThemeFrom(defaultValues());
  const entries = [
    t.palette.primary.main,
    t.palette.secondary.main,
    t.palette.background.default,
    t.palette.background.paper,
    t.palette.text.primary,
    t.palette.divider
  ];
  for (const value of entries) {
    assert.ok(
      !String(value).includes("var("),
      `palette entry "${value}" is a var() reference. MUI runs alpha()/darken()/` +
        `getContrastRatio() over these; a var() throws at construction.`
    );
  }
});

test("an unparseable colour degrades to the default instead of taking the app down", () => {
  // A hand-authored theme or a brand pack may legally carry `page: "white"`.
  // createTheme is called during the render of the app root, so throwing there
  // is a white screen on every route.
  const values = { ...defaultValues(), accent: "white", page: "rebeccapurple" };
  const t = muiThemeFrom(values);
  assert.equal(t.palette.primary.main, defaultValues().accent);
  assert.ok(t.palette.mode === "dark" || t.palette.mode === "light");
});

/* ------------------------------------------------------------------------- */
/* 2 — every dial accounted for                                               */
/* ------------------------------------------------------------------------- */

test("every dial in the spec has an entry in MUI_DIAL_MAP", () => {
  const missing = unmappedSpecDials();
  assert.deepEqual(
    missing,
    [],
    `these dials have no entry in MUI_DIAL_MAP: ${missing.join(", ")}.\n` +
      `  Add one — mapped, or with muiPath: null and the reason there is no counterpart.\n` +
      `  A dial silently dropped is a dial that looks broken to whoever turns it later.`
  );
  assert.equal(MUI_DIAL_MAP.length, DIALS.length, "the map and the spec disagree on dial count");
});

test("every unmapped dial states WHY, and every mapped one names where it lands", () => {
  for (const m of MUI_DIAL_MAP) {
    if (m.muiPath === null) {
      // An unmapped dial owes an EXPLANATION — somebody will turn it, see
      // nothing happen on an MUI surface, and come here to find out why. A
      // one-liner is not an answer to that.
      assert.ok(
        m.note.trim().length > 40,
        `${m.dialId} has no MUI counterpart but its note is too thin to explain why: ` +
          `"${m.note}"`
      );
    } else {
      // A mapped dial owes a POINTER, and "Body text." is a complete one.
      assert.ok(m.muiPath.trim().length > 0, `${m.dialId}: muiPath is empty rather than null`);
      assert.ok(m.note.trim().length > 0, `${m.dialId}: mapped with no note at all`);
    }
  }
  // Non-vacuous in both directions: there ARE unmapped dials (the layout
  // block), and there ARE mapped ones. A map that became all-null or all-mapped
  // would sail past the loop above.
  assert.ok(unmappedDials().length > 0, "no unmapped dials — has the layout block been mapped?");
  assert.ok(
    MUI_DIAL_MAP.filter((m) => m.muiPath !== null).length >= 20,
    "fewer than 20 dials map to MUI — the palette/typography/shape mapping has been gutted"
  );
  assert.ok(MUI_UNDRIVEN.length > 0, "MUI_UNDRIVEN is empty — breakpoints and zIndex are driven?");
});

test("the layout dials are the unmapped ones, by name", () => {
  // Names them so a future edit that quietly moves a PALETTE dial into the
  // unmapped set is caught, rather than only the count.
  for (const id of ["navPlacement", "navStyle", "barHeight", "contentWidth", "pagePad"]) {
    assert.equal(mappingFor(id)?.muiPath, null, `${id} should have no MUI counterpart`);
  }
  for (const id of ["accent", "page", "ink", "edge", "ok", "warn", "err", "radius", "motionMs"]) {
    assert.notEqual(mappingFor(id)?.muiPath, null, `${id} must map into the MUI theme`);
  }
});

/* ------------------------------------------------------------------------- */
/* 3 — the mapping carries the values                                         */
/* ------------------------------------------------------------------------- */

test("palette, typography, shape, spacing and transitions come from the dials", () => {
  const values = defaultValues();
  const vars = themeVariables(values);
  const t = muiThemeFrom(values);

  assert.equal(t.palette.primary.main, values.accent);
  assert.equal(t.palette.secondary.main, values.accent2);
  assert.equal(t.palette.success.main, values.ok);
  assert.equal(t.palette.warning.main, values.warn);
  assert.equal(t.palette.error.main, values.err);
  assert.equal(t.palette.info.main, values.info);
  assert.equal(t.palette.background.default, values.page);
  assert.equal(t.palette.background.paper, values.panel);
  assert.equal(t.palette.text.primary, values.ink);
  assert.equal(t.palette.text.secondary, values.dim);
  assert.equal(t.palette.divider, values.edge);
  assert.equal(t.palette.action.hover, values.panel2);
  assert.equal(t.palette.mode, "dark", "the shipped page is dark; mode must follow luminance");

  assert.equal(t.shape.borderRadius, values.radius);
  assert.equal(t.spacing(2), `${Number(values.gap)}px`, "spacing(2) must equal one gap");
  assert.equal(t.transitions.duration.standard, Number(values.motionMs));
  assert.equal(t.transitions.easing.easeInOut, values.easing);
  assert.equal(t.typography.fontFamily, values.sans);
  assert.equal(t.typography.fontWeightBold, values.weightStrong);
});

test("typography reads the DERIVED ramp, so there is only one type scale", () => {
  const values = { ...defaultValues(), sizeBody: 15, scaleRatio: 1.5 };
  const vars = themeVariables(values);
  const t = muiThemeFrom(values);

  // Each mapped variant equals the derived token exactly — not a recomputation
  // that happens to agree today.
  assert.equal(t.typography.caption.fontSize, vars["--axf-size-micro"]);
  assert.equal(t.typography.body2.fontSize, vars["--axf-size-label"]);
  assert.equal(t.typography.body1.fontSize, vars["--axf-size-body"]);
  assert.equal(t.typography.h6.fontSize, vars["--axf-size-title"]);
  assert.equal(t.typography.h5.fontSize, vars["--axf-size-hero"]);
});

test("the shadow ramp uses the SHARED shadowFor, and the dial scales it", () => {
  const values = defaultValues();
  const t = muiThemeFrom(values);
  assert.equal(t.shadows[0], "none");
  // At the dial's default of 6, MUI level 6 is exactly the engine's --axf-shadow.
  assert.equal(t.shadows[6], themeVariables(values)["--axf-shadow"]);
  assert.equal(t.shadows[12], shadowFor((Number(values.elevation) * 12) / 6));

  const flat = muiThemeFrom({ ...values, elevation: 0 });
  assert.ok(
    flat.shadows.every((s) => s === "none"),
    "elevation 0 must flatten MUI too — a dial that flattens token() surfaces and leaves " +
      "MUI Papers floating is a dial that looks broken"
  );
});

test("density maps to component size defaults", () => {
  const tight = muiThemeFrom({ ...defaultValues(), density: "tight" });
  const normal = muiThemeFrom({ ...defaultValues(), density: "normal" });
  assert.equal(tight.components?.MuiButton?.defaultProps?.size, "small");
  assert.equal(normal.components?.MuiButton?.defaultProps?.size, "medium");
});

/* ------------------------------------------------------------------------- */
/* 4 — a roll re-derives                                                      */
/* ------------------------------------------------------------------------- */

test("rolling the theme produces a different MUI theme", () => {
  const base = muiThemeFrom(defaultValues());
  const rolled = muiThemeFrom(rollTheme("axfmui").values);
  assert.notEqual(
    rolled.palette.primary.main,
    base.palette.primary.main,
    "a rolled theme produced the same MUI primary — the bridge is not reading the roll"
  );
  // And the same seed twice is the same theme, which is what makes the memo in
  // AxfMuiRoot correct rather than merely cheap.
  assert.deepEqual(
    muiThemeFrom(rollTheme("axfmui").values).palette.primary.main,
    rolled.palette.primary.main
  );
});

/* ------------------------------------------------------------------------- */
/* 5 — the pack layer reaches MUI (the half-light/half-dark regression)       */
/* ------------------------------------------------------------------------- */

test("the bridge and the resolver always agree on the winning value", () => {
  // The 2026-08-11 incident: a LIGHT theme applied while the DARK artifact
  // style package was active. AxfStyleRoot composed theme+pack (dark chrome);
  // the bridge read the theme alone (light MUI). /theme-designer rendered half
  // its screen in each.
  //
  // The MECHANISM that caused it is gone — style packages stopped overriding
  // the theme on 2026-08-12 — but the PROPERTY it taught is permanent and is
  // what this test now pins: `muiThemeFrom` and `resolveVariables` take the
  // same input and must never disagree about what won. A pack layer that
  // reaches one and not the other is the split render, whatever the pack is.
  const lightTheme = { ...defaultValues(), page: "#f4f2ee", ink: "#1c1a17" };
  const branding = {
    variables: {
      "--axf-accent": "#ffb454",
      "--axf-brand-accent": "#ffb454",
      "--gxb-accent": "#ffb454"
    }
  };

  const alone = muiThemeFrom(lightTheme);
  assert.equal(alone.palette.mode, "light", "the bare light theme should be light mode");

  // Since 2026-08-12 the agreement is trivial BY CONSTRUCTION — `muiThemeFrom`
  // takes no pack input — so what is pinned is the resolver's half: a pack may
  // land its own drawing roles and may not touch a single `--axf-*` value.
  const vars = resolveVariables(lightTheme, branding);
  assert.equal(vars["--axf-accent"], String(lightTheme.accent), "a pack overrode the accent dial");
  assert.equal(vars["--axf-brand-accent"], "#ffb454", "the drawing role must land");
  assert.equal(
    String(alone.palette.primary.main),
    vars["--axf-accent"],
    "MUI and the resolver disagree about the accent — the split render is back"
  );
});

test("a pack no longer overrides the theme — in the bridge or the resolver", () => {
  // Pins the REMOVAL of every pack tier (style packages first, then the
  // selected-branding override). A pack claiming theme variables must change
  // nothing; restoring either old branch should turn this red.
  const lightTheme = { ...defaultValues(), page: "#f4f2ee", ink: "#1c1a17" };
  const pretendStyle = {
    variables: {
      "--axf-page": "#100c07",
      "--axf-panel": "#1a140d",
      "--axf-ink": "#efe9df"
    }
  };

  const vars = resolveVariables(lightTheme, pretendStyle);
  assert.equal(vars["--axf-page"], "#f4f2ee", "the theme's surface must survive a pack");
  assert.equal(
    muiThemeFrom(lightTheme).palette.mode,
    "light",
    "the MUI mode follows the theme alone — packs have no channel into it"
  );
});
