"use client";

/**
 * @file The run panel — a live workflow run, one card per step event, with a
 * transport strip (pause / resume / stop / slow-mo) and, when the run drives
 * the live browser, the viewer pane right above the log.
 *
 * The panel owns NO engine state: it files `RunEvent`s under their `path`
 * (the engine's positional address — "2" for a top-level step, "2.1.0" for a
 * loop's inner step), so the card tree is a pure fold over the event log.
 * Streaming analyze text appends to the card's `text`; a `step-done` pins the
 * card's output for the export buttons and the "Save as dataset" action.
 *
 * Stop aborts the run two ways at once (fetch abort + control stop) — either
 * alone suffices; together they cover a stream that has not answered yet.
 * Pause and the speed slider go through `/api/firecrawl/control`, so they act
 * mid-step, not just between steps.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import BrowserPane from "./BrowserPane";
import { outputContent, outputKind, outputMarkdown, download, fileStem } from "./exporters";
import { saveDataset } from "./store";
import { MONO } from "./viewers";
import type { RunEvent, StepOutput } from "./types";

/** One card in the run log — a step somewhere in the walk. */
export interface RunCard {
  readonly path: string;
  readonly label: string;
  readonly status: "running" | "done" | "error";
  readonly text: string;
  readonly output: StepOutput | null;
  readonly summary: string;
  readonly progress: { index: number; total: number; label: string } | null;
  /** Where the live browser is for this step (the `page` event). */
  readonly page: { url: string; title: string } | null;
  /** The link the highlight sweep just passed over. */
  readonly highlight: { count: number; href: string } | null;
}

export interface RunState {
  readonly running: boolean;
  readonly paused: boolean;
  readonly cards: readonly RunCard[];
  readonly finalOutput: StepOutput | null;
  readonly error: string | null;
  /** One-liners worth keeping in view — "Saved list …". */
  readonly notices: readonly string[];
}

export const IDLE_RUN: RunState = {
  running: false,
  paused: false,
  cards: [],
  finalOutput: null,
  error: null,
  notices: []
};

/** The fold — `FirecrawlModule` reduces incoming events through this. */
export function reduceRun(state: RunState, event: RunEvent): RunState {
  const patch = (path: string, p: Partial<RunCard>): readonly RunCard[] => {
    let found = false;
    const cards = state.cards.map((c) => {
      if (c.path !== path) return c;
      found = true;
      return { ...c, ...p };
    });
    return found ? cards : state.cards;
  };
  switch (event.type) {
    case "run-start":
      return { ...IDLE_RUN, running: true };
    case "step-start":
      return {
        ...state,
        cards: [
          ...state.cards,
          {
            path: event.path,
            label: event.label,
            status: "running",
            text: "",
            output: null,
            summary: "",
            progress: null,
            page: null,
            highlight: null
          }
        ]
      };
    case "delta": {
      const cards = state.cards.map((c) =>
        c.path === event.path ? { ...c, text: c.text + event.text } : c
      );
      return { ...state, cards };
    }
    case "loop-item":
      return {
        ...state,
        cards: patch(event.path, {
          progress: { index: event.index, total: event.total, label: event.label }
        })
      };
    case "page":
      return { ...state, cards: patch(event.path, { page: { url: event.url, title: event.title } }) };
    case "highlight":
      return {
        ...state,
        cards: patch(event.path, { highlight: { count: event.count, href: event.href } })
      };
    case "list":
      return {
        ...state,
        notices: [
          ...state.notices,
          `Saved link list "${event.name}" — ${event.urls.length} link${event.urls.length === 1 ? "" : "s"} (${event.listMode})`
        ]
      };
    case "paused":
      return { ...state, paused: true };
    case "resumed":
      return { ...state, paused: false };
    case "step-done":
      return {
        ...state,
        cards: patch(event.path, {
          status: "done",
          output: event.output,
          summary: event.summary,
          highlight: null
        })
      };
    case "step-error":
      return { ...state, cards: patch(event.path, { status: "error", summary: event.message }) };
    case "done":
      return { ...state, running: false, paused: false, finalOutput: event.output };
    case "error":
      return { ...state, running: false, paused: false, error: event.message };
  }
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function depthOf(path: string): number {
  return path.split(".").length - 1;
}

function StepCard({ card, workflowName }: { card: RunCard; workflowName: string }) {
  const tint = card.status === "error" ? "err" : card.status === "done" ? "ok" : "accent";
  return (
    <Box
      sx={{
        ml: depthOf(card.path) * 2,
        border: `1px solid ${token("edge")}`,
        borderLeft: `3px solid ${token(tint)}`,
        borderRadius: token("radius-tight"),
        background: token("panel"),
        p: 1.25
      }}
    >
      <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
        {card.status === "running" && <CircularProgress size={12} thickness={6} />}
        <Typography sx={{ ...MONO, fontSize: 11, color: token("dim") }}>{card.path}</Typography>
        <Typography sx={{ fontSize: 12, fontWeight: 700 }}>{card.label}</Typography>
        <Typography noWrap sx={{ fontSize: 11, color: token(card.status === "error" ? "err" : "dim"), flex: 1 }}>
          {card.summary}
        </Typography>
        {card.output && (
          <>
            <Button
              size="small"
              sx={{ fontSize: 10, minWidth: 0 }}
              onClick={() => {
                const ds = saveDataset({
                  name: `${workflowName} · step ${card.path}`,
                  kind: outputKind(card.output as StepOutput),
                  content: outputContent(card.output as StepOutput)
                });
                void ds;
              }}
            >
              Save dataset
            </Button>
            <Button
              size="small"
              sx={{ fontSize: 10, minWidth: 0 }}
              onClick={() =>
                download(
                  `${fileStem(workflowName)}-step-${card.path.replace(/\./g, "-")}.md`,
                  outputMarkdown(card.output as StepOutput),
                  "text/markdown"
                )
              }
            >
              MD
            </Button>
            <Button
              size="small"
              sx={{ fontSize: 10, minWidth: 0 }}
              onClick={() =>
                download(
                  `${fileStem(workflowName)}-step-${card.path.replace(/\./g, "-")}.json`,
                  outputContent(card.output as StepOutput),
                  "application/json"
                )
              }
            >
              JSON
            </Button>
          </>
        )}
      </Stack>
      {card.page && (
        <Typography noWrap sx={{ ...MONO, fontSize: 10.5, color: token("info"), mt: 0.5 }}>
          ⌖ {card.page.title ? `${card.page.title} — ` : ""}
          {card.page.url}
        </Typography>
      )}
      {card.highlight && card.status === "running" && (
        <Typography noWrap sx={{ ...MONO, fontSize: 10.5, color: token("accent"), mt: 0.25 }}>
          ⚡ {card.highlight.count} · {card.highlight.href}
        </Typography>
      )}
      {card.progress && card.status === "running" && (
        <Box sx={{ mt: 0.75 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography noWrap sx={{ ...MONO, fontSize: 10.5, color: token("dim"), maxWidth: "80%" }}>
              {card.progress.label}
            </Typography>
            <Typography sx={{ ...MONO, fontSize: 10.5, color: token("dim") }}>
              {card.progress.index + 1}/{card.progress.total}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={((card.progress.index + 1) / card.progress.total) * 100}
            sx={{ height: 3, borderRadius: 2 }}
          />
        </Box>
      )}
      {card.text && (
        <Typography
          component="pre"
          sx={{
            ...MONO,
            fontSize: 11.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            m: 0,
            mt: 0.75,
            maxHeight: 260,
            overflow: "auto",
            color: token("ink")
          }}
        >
          {card.text}
        </Typography>
      )}
    </Box>
  );
}

export default function RunPanel({
  run,
  workflowName,
  sessionId,
  speed,
  onSpeed,
  onPause,
  onResume,
  onStop
}: {
  run: RunState;
  workflowName: string;
  /** Live browser session to watch, when the run has watchable steps. */
  sessionId: string | null;
  /** Slow-mo delay in ms (the slider's value). */
  speed: number;
  onSpeed: (ms: number) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const cardCount = run.cards.length;
  React.useEffect(() => {
    // Follow the run as it grows — new cards, not every delta, so reading
    // scrolled-up output isn't fought by the stream.
    endRef.current?.scrollIntoView({ block: "end" });
  }, [cardCount]);

  if (!run.running && run.cards.length === 0 && !run.error) {
    return (
      <Typography sx={{ fontSize: 13, color: token("dim"), textAlign: "center", py: 6 }}>
        No run yet — hit <b>Run</b> and the pipeline streams in here, step by step. Live steps
        (harvest / paginate / for-each / replay) show the browser walking the pages above the log.
      </Typography>
    );
  }

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      {/* transport */}
      <Stack
        direction="row"
        sx={{ gap: 1, alignItems: "center", px: 1.5, py: 0.75, borderBottom: `1px solid ${token("edge")}`, flexWrap: "wrap" }}
      >
        {run.running ? (
          <>
            <Chip
              size="small"
              color={run.paused ? "default" : "warning"}
              label={run.paused ? "paused" : "running"}
              sx={{ fontSize: 11 }}
            />
            {run.paused ? (
              <Button size="small" variant="contained" sx={{ fontSize: 11 }} onClick={onResume}>
                ▶ Resume
              </Button>
            ) : (
              <Button size="small" variant="outlined" sx={{ fontSize: 11 }} onClick={onPause}>
                ⏸ Pause
              </Button>
            )}
            <Button size="small" color="error" variant="outlined" sx={{ fontSize: 11 }} onClick={onStop}>
              ■ Stop
            </Button>
          </>
        ) : run.error ? (
          <Chip size="small" color="error" label="failed" sx={{ fontSize: 11 }} />
        ) : (
          <Chip size="small" color="success" label="finished" sx={{ fontSize: 11 }} />
        )}
        <Typography sx={{ fontSize: 12, color: token("dim") }}>{workflowName}</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 11, color: token("dim") }}>slow-mo</Typography>
        <Slider
          size="small"
          value={speed}
          min={0}
          max={3000}
          step={100}
          onChange={(_, v) => onSpeed(v as number)}
          sx={{ width: 140 }}
        />
        <Typography sx={{ ...MONO, fontSize: 11, color: token("dim"), width: 52 }}>
          {speed === 0 ? "off" : `${(speed / 1000).toFixed(1)}s`}
        </Typography>
      </Stack>

      {/* live browser, when the run drives one */}
      {sessionId && (
        <Box sx={{ height: "42%", minHeight: 220, borderBottom: `1px solid ${token("edge")}` }}>
          <BrowserPane sessionId={sessionId} interactive={false} chrome={false} />
        </Box>
      )}

      {/* the log */}
      <Stack sx={{ gap: 1, p: 1.5, overflow: "auto", flex: 1, minHeight: 0 }}>
        {run.notices.map((notice, i) => (
          <Typography key={i} sx={{ fontSize: 11.5, color: token("ok") }}>
            ✓ {notice}
          </Typography>
        ))}
        {run.cards.map((card) => (
          <StepCard key={card.path} card={card} workflowName={workflowName} />
        ))}
        {run.error && (
          <Typography sx={{ fontSize: 12.5, color: token("err"), whiteSpace: "pre-wrap" }}>
            {run.error}
          </Typography>
        )}
        <div ref={endRef} />
      </Stack>
    </Stack>
  );
}
