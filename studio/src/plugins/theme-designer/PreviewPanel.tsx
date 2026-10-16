/**
 * @file `<PreviewPanel>` — one theme, on a full specimen sheet, in its own scope.
 *
 * Extracted from `ThemeDesigner` when the roller arrived, because the roller
 * previews candidate rolls and the dial editor previews the live theme, and
 * those are the same act: render a `ThemeValues` beside the one in force,
 * without touching the one in force. A second preview panel written for the
 * roller would drift from this one within a week, and the drift would be
 * invisible — two previews that render the same theme slightly differently is
 * exactly the class of bug this whole project exists to stop being possible.
 *
 * ## Why a scope and not a mutate-then-undo
 *
 * `AxfStyleRoot` owns `:root` and there is exactly ONE of it, deliberately: two
 * writers of the same custom property is a race this engine already had and
 * fixed. `ThemeScope` publishes onto its OWN element, so a candidate theme is a
 * subtree rather than a global write. Previewing by applying a roll to the live
 * store and reverting it would reopen that race, and it loses the person's
 * actual theme if anything throws in between.
 *
 * ## Two publications, one source
 *
 * `ThemeScope` writes the custom properties (for `token()` surfaces and anything
 * reading `var(--axf-*)`), and a nested MUI `ThemeProvider` carries the same
 * values through `muiThemeFrom()`. Both are the engine's own functions. Deriving
 * either a second time here is how an MUI `<Paper>` ends up a pixel off the card
 * beside it.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";

import { ThemeScope, muiThemeFrom } from "@axf/core";
import type { StyleInput, ThemeValues } from "@axf/core";

import SpecimenSheet from "./SpecimenSheet";

export interface PreviewPanelProps {
  /** The theme this panel renders in — live values, a roll, or the default. */
  values: ThemeValues;
  /** The same pack input `AxfStyleRoot` resolves with, so preview matches app. */
  pack: StyleInput | null;
  title: string;
  note: string;
  /** Scroll the sheet inside a bounded box — for a secondary/compare panel. */
  compact?: boolean;
  /** Anything the caller wants in the panel's header, right-aligned. */
  action?: React.ReactNode;
}

export default function PreviewPanel({
  values,
  pack,
  title,
  note,
  compact = false,
  action
}: PreviewPanelProps) {
  const [scopeEl, setScopeEl] = React.useState<HTMLElement | null>(null);
  // The MUI half is a pure function of the dials since 2026-08-12 — a pack can
  // no longer touch an `--axf-*` value, so only `ThemeScope` (which publishes
  // the `--gxb-*` drawing roles) still takes the pack input.
  const mui = React.useMemo(() => muiThemeFrom(values), [values]);

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 1.5, py: 0.75, bgcolor: "action.hover" }}
      >
        <Typography variant="overline" sx={{ fontSize: 10, letterSpacing: "0.1em" }}>
          {title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {note}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {action}
      </Stack>
      <Box sx={{ maxHeight: compact ? 460 : "none", overflow: compact ? "auto" : "visible" }}>
        <ThemeScope values={values} pack={pack}>
          {/* `data-specimen`, not an id: more than one preview panel is on
              screen whenever the comparison is open or a roll is selected, and
              two elements with the same id is invalid markup that quietly
              breaks every `#`-anchored lookup. */}
          <Box ref={setScopeEl} data-specimen={title}>
            <ThemeProvider theme={mui}>
              <SpecimenSheet container={scopeEl} compact={compact} />
            </ThemeProvider>
          </Box>
        </ThemeScope>
      </Box>
    </Paper>
  );
}
