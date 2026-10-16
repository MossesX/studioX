/**
 * @file The cascade and the publish meter — what a dial move actually did.
 *
 * Two readouts that exist for the same reason: **a designer that shows only the
 * dial you touched hides the effect you caused.**
 *
 * `derived.ts` declares, per derived token, the dial ids it reads (`from`), and
 * exports `dependentsOf()` over that list. So "moving `radius` also moved
 * `--axf-radius-tight`" is a fact the engine already knows and can be shown
 * rather than discovered. Eleven of the forty-odd derived tokens hang off
 * `navPlacement` alone; a designer that hides that is a designer whose user
 * concludes the engine is inert.
 *
 * The publish meter is the other half. `applyVariables` diffs and touches only
 * what changed, and `changeCount()` is in `publish.ts` explicitly "for a
 * designer surface, and for proving the diff works rather than assuming it". If
 * this reads 42-of-42 on a single slider step, the designer has undone the
 * engine's central optimisation by republishing the whole set — which is the
 * failure mode the meter is here to make impossible to miss.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { DERIVED, DIALS_BY_ID, dependentsOf } from "@axf/core";
import type { ThemeValues } from "@axf/core";

import type { PublishDiff } from "./usePublishDiff";

const MONO = { fontFamily: "var(--axf-mono)", fontSize: 11 } as const;

/** Every cssVar the engine derives — used to tell a derived write from a dial's own. */
const DERIVED_VARS = new Set(DERIVED.map((d) => d.cssVar));

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <Box sx={{ minWidth: 74 }}>
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", display: "block", fontSize: 10, letterSpacing: "0.08em" }}
      >
        {label.toUpperCase()}
      </Typography>
      <Typography
        sx={{
          ...MONO,
          fontSize: 19,
          fontWeight: 700,
          color: tone === "bad" ? "error.main" : tone === "good" ? "success.main" : "text.primary"
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export function PublishMeter({ diff }: { diff: PublishDiff | null }) {
  if (!diff) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          Publish diff — move any dial. This counts the custom properties
          <code style={MONO}> applyVariables </code> actually rewrites, so a change that touches one
          property reads as one and not as the whole set.
        </Typography>
      </Paper>
    );
  }

  // The number this readout exists to distinguish. "The whole set" is the
  // failure; a handful is the design working.
  const wholeSet = diff.written >= diff.total;
  const heavy = diff.written > 12;

  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
        <Stat label="written" value={diff.written} tone={wholeSet || heavy ? "bad" : "good"} />
        <Stat label="removed" value={diff.removed} />
        <Stat label="unchanged" value={diff.unchanged} />
        <Box sx={{ flex: 1, pt: 1.5 }}>
          <LinearProgress
            variant="determinate"
            color={wholeSet || heavy ? "error" : "success"}
            value={Math.min(100, (diff.written / Math.max(1, diff.total)) * 100)}
          />
          <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 10 }}>
            {diff.written} of {diff.total} published properties
          </Typography>
        </Box>
      </Stack>

      {wholeSet ? (
        <Typography variant="caption" color="error">
          Every property was rewritten. The designer is republishing the whole set and the
          publisher&apos;s diffing has been undone by its own UI.
        </Typography>
      ) : null}

      {/* Bounded, so a long write list cannot push the panels below it around
          while a slider is being dragged. */}
      <Stack
        direction="row"
        spacing={0.5}
        useFlexGap
        sx={{ flexWrap: "wrap", maxHeight: 64, overflow: "auto" }}
      >
        {diff.writtenNames.map((name) => (
          <Chip
            key={name}
            size="small"
            variant={DERIVED_VARS.has(name) ? "filled" : "outlined"}
            color={DERIVED_VARS.has(name) ? "primary" : "default"}
            label={name}
            sx={{ ...MONO, height: 19 }}
          />
        ))}
        {diff.removedNames.map((name) => (
          <Chip key={name} size="small" color="warning" label={`− ${name}`} sx={{ ...MONO, height: 19 }} />
        ))}
      </Stack>
      <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 10 }}>
        Filled chips are DERIVED tokens — the cascade. Outlined are dials and brand roles.
      </Typography>
    </Paper>
  );
}

export function Cascade({
  dialId,
  values,
  diff,
  suppressed,
  packOwner
}: {
  dialId: string | null;
  values: ThemeValues;
  diff: PublishDiff | null;
  /**
   * Variables the active pack publishes over the theme's. A derived token in
   * here still RECOMPUTES when its dial moves and still never reaches the page,
   * and the difference has to be on screen: this panel's whole job is saying
   * what a dial did, and "it moved" about a value that was then overruled is
   * the same lie as saying nothing.
   */
  suppressed: ReadonlySet<string>;
  packOwner: string;
}) {
  const dial = dialId ? DIALS_BY_ID.get(dialId) : undefined;
  const dependents = React.useMemo(() => (dialId ? dependentsOf(dialId) : []), [dialId]);

  if (!dial) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          Cascade — turn a dial and this lists the derived tokens that moved with it.
          <code style={MONO}> derived.ts </code> declares each token&apos;s inputs, so this is the
          engine&apos;s own dependency list rather than a guess.
        </Typography>
      </Paper>
    );
  }

  const written = new Set(diff?.writtenNames ?? []);

  /* A derived token that MOVED without declaring this dial in its `from` list is
     a gap in the declaration, not a curiosity: `from` is what an incremental
     publisher would trust to skip recomputation, so an undeclared input is a
     token that would silently stop updating. Surfaced rather than swallowed. */
  const declared = new Set(dependents.map((d) => d.cssVar));
  const undeclared = [...written].filter((name) => DERIVED_VARS.has(name) && !declared.has(name));

  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
        <Typography variant="subtitle2">{dial.label}</Typography>
        <Chip size="small" label={dial.kind} sx={{ ...MONO, height: 18 }} />
        {/* Read by scripts/publish-diff-probe.mjs: the probe compares the
            cascade this panel CLAIMS against the properties it taps being
            written to :root, so neither side can vouch for itself. */}
        <Typography data-cascade-var={dial.cssVar} sx={{ ...MONO, color: "text.secondary" }}>
          {dial.cssVar}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Chip
          size="small"
          color={written.has(dial.cssVar) ? "primary" : "default"}
          variant="outlined"
          label={String(values[dial.id])}
          sx={{ ...MONO, height: 18 }}
        />
      </Stack>

      <Typography variant="caption" color="text.secondary">
        {dial.effect}
      </Typography>

      {dependents.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          Nothing is derived from this dial — it publishes {dial.cssVar} and stops there.
        </Typography>
      ) : (
        <Box sx={{ display: "grid", gap: 0.25, maxHeight: 210, overflow: "auto" }}>
          <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 10 }}>
            {dependents.length} DERIVED TOKEN{dependents.length === 1 ? "" : "S"} READ THIS DIAL
          </Typography>
          {dependents.map((token) => {
            const now = token.compute(values);
            const before = diff ? token.compute(diff.previousValues) : now;
            const recomputed = before !== now;
            const overruled = suppressed.has(token.cssVar);
            /* "Moved" means moved AND published. A recomputed token the pack
               overrules did not move as far as the page is concerned, and this
               attribute is what the publish probe cross-examines its DOM tap
               against — so it has to mean the same thing on both sides. */
            const moved = recomputed && !overruled;
            return (
              <Tooltip
                key={token.cssVar}
                title={overruled ? `${token.note} — but ${packOwner} publishes this variable, so the theme's value is not what renders.` : token.note}
                placement="left"
              >
                <Stack
                  direction="row"
                  spacing={1}
                  data-cascade-token={token.cssVar}
                  data-cascade-moved={moved ? "yes" : "no"}
                  sx={{ alignItems: "center",
                    px: 0.75,
                    py: 0.25,
                    borderRadius: 0.5,
                    bgcolor: moved ? "action.selected" : "transparent"
                  }}
                >
                  <Typography
                    sx={{ ...MONO, minWidth: 168, color: overruled ? "text.secondary" : "text.primary" }}
                    noWrap
                  >
                    {token.cssVar}
                  </Typography>
                  {recomputed ? (
                    <>
                      <Typography sx={{ ...MONO, color: "text.secondary" }} noWrap>
                        {before}
                      </Typography>
                      <Typography sx={{ ...MONO, color: "text.secondary" }}>→</Typography>
                      <Typography
                        sx={{
                          ...MONO,
                          fontWeight: 700,
                          color: overruled ? "text.disabled" : "primary.main",
                          textDecoration: overruled ? "line-through" : "none"
                        }}
                        noWrap
                      >
                        {now}
                      </Typography>
                    </>
                  ) : (
                    <Typography sx={{ ...MONO, color: "text.secondary" }} noWrap>
                      {now}
                    </Typography>
                  )}
                  {overruled ? (
                    <Chip
                      size="small"
                      color="warning"
                      variant="outlined"
                      label="pack wins"
                      sx={{ height: 16, fontSize: 9.5 }}
                    />
                  ) : null}
                </Stack>
              </Tooltip>
            );
          })}
        </Box>
      )}

      {undeclared.length > 0 ? (
        <Typography variant="caption" color="warning.main">
          {undeclared.join(", ")} moved without declaring <code style={MONO}>{dial.id}</code> in
          their <code style={MONO}>from</code> list — the declaration in derived.ts is incomplete.
        </Typography>
      ) : null}
    </Paper>
  );
}
