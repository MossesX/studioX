/**
 * @file `/mui-probe` — the surface that proves the MUI bridge is live.
 *
 * P1's last requirement is "prove it on screen before any rebuild starts", and
 * the honest way to do that is a route that mounts real MUI components and lets
 * the theme be rolled beside them. Rebuilding StudioShell, the toolbars, the
 * brand gallery and the console dashboard on a bridge that has never been
 * watched work means rebuilding them twice.
 *
 * It stays after P1 rather than being deleted, for the same reason
 * `scripts/geometry-probe.mjs` stayed: it is the regression surface. When a
 * later phase makes a themed MUI component stop following a roll, this is where
 * that is visible in one click instead of one bisect.
 *
 * It mounts no chrome of its own — no banner, no style root. `AppShell` supplies
 * both (and now `AxfMuiRoot` too), which is exactly the property being
 * demonstrated: this file contains no provider, and its components are themed
 * anyway.
 *
 * The readout is deliberately COMPUTED, not declared: it reads
 * `getComputedStyle` off the real nodes, so what it shows is what the browser
 * resolved, not what the theme object claims. A readout of the theme object
 * would go green for a bridge that builds a perfect theme and never reaches the
 * DOM.
 */
"use client";

import * as React from "react";

import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTheme as useMuiTheme } from "@mui/material/styles";

import {
  MUI_DIAL_MAP,
  muiThemeFrom,
  theme as themeStore,
  token,
  unmappedDials,
  useResolvedStyle,
  useTheme
} from "@axf/core";

/** What the probe measures, per node. One row per assertion worth making. */
const MEASURED = [
  { id: "probe-button", label: "Button (contained)", props: ["background-color", "border-radius", "font-size"] },
  { id: "probe-secondary", label: "Button (secondary)", props: ["background-color"] },
  { id: "probe-outlined", label: "Button (outlined)", props: ["color", "border-color"] },
  { id: "probe-paper", label: "Paper", props: ["background-color", "box-shadow", "border-radius"] },
  { id: "probe-field", label: "TextField input", props: ["color", "font-family", "font-size"] }
] as const;

type Readings = Record<string, Record<string, string>>;

function measure(): Readings {
  const out: Readings = {};
  for (const node of MEASURED) {
    const el = document.querySelector(`[data-probe="${node.id}"]`);
    if (!el) continue;
    const cs = getComputedStyle(el instanceof HTMLElement ? el : (el as Element));
    out[node.id] = Object.fromEntries(node.props.map((p) => [p, cs.getPropertyValue(p).trim()]));
  }
  return out;
}

export default function MuiProbePage() {
  const axf = useTheme();
  const mui = useMuiTheme();
  // The pack layer, because the provider composes it now (2026-08-11): the
  // "engine (computed here)" row must run the SAME composition the provider
  // runs, or an active style package reads as a provider fault in this table.
  const style = useResolvedStyle();

  const [now, setNow] = React.useState<Readings>({});
  const [before, setBefore] = React.useState<Readings | null>(null);

  // Re-measure after every commit the theme causes. A layout effect would read
  // before Emotion has flushed the new class; a frame later is after paint,
  // which is the moment the claim is actually about.
  //
  // …and then AGAIN once transitions have settled, which is not a refinement —
  // without it this readout reports the wrong answer for the most visible row
  // on the page. MUI's contained Button transitions `background-color` (350ms
  // at the default theme), and `getComputedStyle` during a transition returns
  // the INTERPOLATED value, so a measurement one frame after the commit reads
  // the colour the button is leaving. On 2026-08-10 this table showed
  // `rgb(255, 122, 26) -> rgb(255, 122, 26)` for the Button while the button
  // beside it was plainly olive and `scripts/mui-probe.mjs` — which waits —
  // measured `rgb(139, 149, 32)`. Rows that MUI does not transition
  // (border-radius, font-size, Paper's background) were correct throughout,
  // which is what made it read as "the Button specifically is broken".
  //
  // This surface is the regression reference for the phases that follow, so a
  // row that says "did not move" when it did is worse than no row at all.
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setNow(measure()));
    const settled = setTimeout(
      () => setNow(measure()),
      mui.transitions.duration.standard + 150
    );
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settled);
    };
  }, [axf.values, mui.transitions.duration.standard]);

  const roll = () => {
    setBefore(measure());
    themeStore.roll();
  };

  const cell: React.CSSProperties = {
    padding: "4px 10px",
    borderBottom: `1px solid ${token("edge")}`,
    fontFamily: token("mono"),
    fontSize: token("size-micro"),
    textAlign: "left",
    whiteSpace: "nowrap"
  };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontSize: token("size-hero"), fontWeight: 700 }}>MUI bridge probe</div>
        <div style={{ color: token("dim"), fontSize: token("size-label") }}>
          These components mount no provider. Roll the theme and watch their COMPUTED colours
          move — no reload, no remount.
        </div>
      </div>

      {/* The three components the step names, plus an outlined button because
          its colour comes from palette.primary via MUI's own alpha() maths —
          the code path that throws on a var().

          …and a SECONDARY button, added 2026-08-11 (P6) because without it this
          page cannot demonstrate its own claim. The app's default identity is a
          STYLE PACKAGE (`axs-studio`), and a style package is a complete
          identity: `resolveVariables` gives it `page`, `panel`, `ink`, `edge`
          AND `accent`, so a theme roll cannot move any of them while it is
          active. Every component above reads one of exactly those five roles,
          which is why `scripts/mui-probe.mjs` reported "nothing moved" on a
          bridge that was working perfectly. `accent2` is NOT published by that
          pack, so `palette.secondary.main` is the tracked value a roll can
          actually reach — and therefore the one the theme-follows check hangs
          on. If a future pack starts publishing `--axf-accent2`, this button
          goes still and the probe says so rather than going quietly green. */}
      <Stack
        direction="row"
        spacing={2}
        useFlexGap
        sx={{ alignItems: "flex-start", flexWrap: "wrap" }}
      >
        <Button data-probe="probe-button" variant="contained" onClick={roll}>
          Roll theme
        </Button>
        <Button data-probe="probe-secondary" variant="contained" color="secondary" onClick={roll}>
          Roll (secondary)
        </Button>
        <Button data-probe="probe-outlined" variant="outlined" onClick={() => themeStore.reset()}>
          Reset to default
        </Button>
        <TextField
          data-probe="probe-field-root"
          label="TextField"
          defaultValue="themed by the engine"
          slotProps={{ htmlInput: { "data-probe": "probe-field" } }}
        />
      </Stack>

      <Paper data-probe="probe-paper" elevation={6} sx={{ p: 2, maxWidth: 560 }}>
        <Typography variant="h6">Paper, elevation 6</Typography>
        <Typography variant="body2">
          Its background is <code>palette.background.paper</code> (the <code>panel</code> dial) and
          its shadow is <code>shadows[6]</code>, which the bridge builds from the{" "}
          <code>elevation</code> dial through the same <code>shadowFor()</code> that publishes{" "}
          <code>--axf-shadow</code>.
        </Typography>
      </Paper>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Computed values {before ? "(before → after the last roll)" : "(roll to capture a before)"}
          </div>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {MEASURED.flatMap((node) =>
                node.props.map((prop) => {
                  const after = now[node.id]?.[prop] ?? "—";
                  const prev = before?.[node.id]?.[prop];
                  const moved = prev !== undefined && prev !== after;
                  return (
                    <tr key={`${node.id}.${prop}`}>
                      <td style={cell}>{node.label}</td>
                      <td style={cell}>{prop}</td>
                      <td style={{ ...cell, color: token("dim") }}>{prev ?? "—"}</td>
                      <td style={{ ...cell, color: moved ? token("ok") : token("ink") }}>{after}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>The theme object it came from</div>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {[
                // The engine's answer, computed HERE rather than read from
                // context. Keep it: it is the row that separates "the mapping
                // is wrong" from "the provider is not reaching this subtree",
                // and on 2026-08-09 those looked identical for hours. If this
                // says #ff7a1a while the row below says #1976d2, the mapping is
                // fine and the provider is dead — start at `npm run link:kit`.
                ["engine (computed here)", muiThemeFrom(axf.values).palette.primary.main],
                ["seed", axf.seed ?? "(default)"],
                ["palette.mode", mui.palette.mode],
                ["palette.primary.main", mui.palette.primary.main],
                ["palette.background.paper", mui.palette.background.paper],
                ["shape.borderRadius", String(mui.shape.borderRadius)],
                ["spacing(2)", mui.spacing(2)],
                ["typography.body1.fontSize", String(mui.typography.body1.fontSize)],
                ["transitions.duration.standard", `${mui.transitions.duration.standard}ms`],
                ["shadows[6]", mui.shadows[6]]
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={cell}>{k}</td>
                  <td style={cell}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          Dials with no MUI counterpart ({unmappedDials().length} of {MUI_DIAL_MAP.length})
        </div>
        <div style={{ color: token("dim"), fontSize: token("size-micro"), maxWidth: 900 }}>
          Recorded rather than dropped, so a dial that does nothing to an MUI surface says so
          here instead of looking broken:{" "}
          <span style={{ fontFamily: token("mono") }}>
            {unmappedDials()
              .map((d) => d.dialId)
              .join(", ")}
          </span>
        </div>
      </div>
    </div>
  );
}
