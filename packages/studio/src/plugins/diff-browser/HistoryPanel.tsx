"use client";

/**
 * @file The difference browser's `claude-workspace.panel` contribution — the
 * pane the workspace mounts, and the whole reason the plugin is absorbed rather
 * than left as a route.
 *
 * ── why this is a summary and not the browser itself ────────────────────────
 *
 * The workspace's panels column is 22% of the screen. An N-column diff grid in
 * it would be eight columns of forty characters, which is not a small version
 * of the browser — it is an unusable one. So the pane answers the questions a
 * side column CAN answer, and hands off:
 *
 *   · what history exists, and how deep each folder is (one cheap request);
 *   · what the newest revision of the selected file introduced;
 *   · a way into the full browser at `/diff`.
 *
 * The roster is fetched on mount because it is a directory listing. The
 * INSTANCES are not: reading thirteen documents to draw a summary nobody asked
 * for is the kind of cost that makes people close a pane. They load when the
 * reader asks, and the button says so.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { fetchInstances, fetchTracked, type TrackedFile } from "./client";
import { buildModel } from "./engine";
import type { Cell } from "./engine";
import { diffSelection, useDiffSelection } from "./selection";

const MONO = { fontFamily: token("mono"), fontSize: 11 } as const;

/** How many introduced lines the pane shows before it stops and says so. A
 *  revision can add nine hundred; a side column that renders all of them is a
 *  scrollbar with a summary hidden somewhere in it. */
const PREVIEW_LINES = 24;

interface Summary {
  readonly file: string;
  readonly revisions: number;
  readonly label: string;
  readonly added: readonly Cell[];
  readonly addedTotal: number;
  readonly removed: number;
}

export default function HistoryPanel() {
  const file = useDiffSelection();
  const [tracked, setTracked] = React.useState<readonly TrackedFile[] | null>(null);
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetchTracked()
      .then((data) => {
        if (!alive) return;
        setTracked(data.tracked ?? []);
        // Land on something real: the roster is sorted richest-first, so the
        // default is the folder with the most to look at rather than a name
        // this file happens to remember.
        if (data.tracked?.length && !data.tracked.some((t) => t.name === file)) {
          diffSelection.set(data.tracked[0]!.name);
        }
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // Roster only, once. Re-fetching it whenever the selection changes would
    // re-read the directory to learn something that did not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A selection change invalidates the summary — showing the previous file's
  // added lines under the new file's name is worse than showing nothing.
  React.useEffect(() => setSummary(null), [file]);

  async function loadSummary(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const data = await fetchInstances(file);
      const instances = data.instances ?? [];
      if (!instances.length) {
        setSummary(null);
        setError(data.error ?? "no snapshots in this folder");
        return;
      }
      const model = buildModel([...instances]);
      const last = model.instances.length - 1;
      const stats = model.stats[last] ?? { added: 0, removed: 0, addedVsAll: 0 };
      const added = model.rows
        .map((r) => r.cells[last])
        .filter((c): c is Cell => Boolean(c) && c!.vsPrev === "added" && Boolean(c!.text.trim()));
      setSummary({
        file,
        revisions: model.instances.length,
        label: model.instances[last]?.label ?? "current",
        added: added.slice(0, PREVIEW_LINES),
        addedTotal: added.length,
        removed: stats.removed
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (tracked && !tracked.length) {
    return (
      <Box sx={{ p: 1.2 }}>
        <Typography sx={{ fontSize: 11.5, color: token("dim"), lineHeight: 1.6 }}>
          Nothing under <code>.history/</code>. The merge system that wrote those snapshots was
          retired on 2026-08-09; this browser is the viewer over what it left.
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={1} sx={{ p: 1.2 }}>
      <TextField
        size="small"
        select
        fullWidth
        hiddenLabel
        value={tracked?.some((t) => t.name === file) ? file : ""}
        onChange={(e) => diffSelection.set(e.target.value)}
        slotProps={{ select: { displayEmpty: true }, htmlInput: { sx: MONO } }}
      >
        {(tracked ?? []).map((t) => (
          <MenuItem key={t.name} value={t.name} sx={MONO}>
            {t.name} · {t.snapshots}
          </MenuItem>
        ))}
      </TextField>

      <Stack direction="row" spacing={0.8}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<Glyph id="icon-compare" size={13} />}
          onClick={() => void loadSummary()}
          disabled={busy || !tracked?.length}
          sx={{ flex: 1, fontSize: 11 }}
        >
          {busy ? "reading…" : "Newest change"}
        </Button>
        <Button
          size="small"
          variant="outlined"
          href={`/diff?file=${encodeURIComponent(file)}`}
          sx={{ fontSize: 11, minWidth: 34, px: 0.8 }}
          aria-label="Open the full difference browser"
          title="Open the full difference browser — every revision as its own column"
        >
          <Glyph id="icon-history" size={13} />
        </Button>
      </Stack>

      {busy && <CircularProgress size={14} />}

      {error && (
        <Typography sx={{ fontSize: 11, color: token("err"), lineHeight: 1.6 }}>{error}</Typography>
      )}

      {summary && (
        <Stack spacing={0.6}>
          <Typography sx={{ ...MONO, fontSize: 10.5, color: token("dim") }}>
            {summary.revisions} revisions · newest “{summary.label}” · +{summary.addedTotal} −
            {summary.removed}
          </Typography>
          {summary.added.length === 0 ? (
            <Typography sx={{ fontSize: 11, color: token("dim") }}>
              The newest revision introduced nothing — it is identical to the one before it.
            </Typography>
          ) : (
            <Box
              sx={{
                border: `1px solid ${token("edge")}`,
                borderRadius: "var(--axf-radius-tight)",
                background: token("page"),
                maxHeight: 260,
                overflow: "auto"
              }}
            >
              {summary.added.map((cell, i) => (
                <Typography
                  key={`${cell.lineNo ?? "x"}:${i}`}
                  sx={{
                    ...MONO,
                    px: 0.8,
                    py: "1px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    borderLeft: `2px solid ${token("ok")}`
                  }}
                >
                  {cell.text}
                </Typography>
              ))}
            </Box>
          )}
          {summary.addedTotal > summary.added.length && (
            <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
              {summary.addedTotal - summary.added.length} more line
              {summary.addedTotal - summary.added.length === 1 ? "" : "s"} — the full browser shows
              them all.
            </Typography>
          )}
        </Stack>
      )}
    </Stack>
  );
}
