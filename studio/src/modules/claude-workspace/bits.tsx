"use client";

/**
 * @file Small shared pieces of the workspace's chrome.
 *
 * Here rather than repeated because the transcript, the library and the tool
 * cards all draw the same three things — a monospace run, a token/cost readout,
 * a relative timestamp — and three copies of a formatter is three answers to
 * "how much did that cost".
 *
 * Everything paints through `token()`, never a literal: the theme owns every
 * `--axf-*` value with no exceptions (core 0.0.18), and a hex here would be the
 * one surface a roll cannot restyle.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

/** The monospace run used for ids, paths, costs and tool names. */
export const MONO = { fontFamily: token("mono"), fontVariantNumeric: "tabular-nums" } as const;

/** Compact money. Sub-cent turns are the common case on a cached conversation,
 *  and `$0.00` for a real charge reads as free. */
export function money(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Compact token counts: `1.2k`, `464k`, `1.4M`. A cached turn reports numbers
 *  in the hundreds of thousands (measured: 464,153 cache-read against 67
 *  input), and the raw digits crowd every row they appear in. */
export function tokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "just now" / "14m" / "3h" / "Aug 12". Absolute below a day is noise; a date
 *  above one is what people actually search their memory by. */
export function ago(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A relative stamp that carries the absolute one in its tooltip — so the row
 *  stays short and the exact time is still one hover away. */
export function Stamp({ at, sx }: { at: string; sx?: object }) {
  const [now, setNow] = React.useState<number | null>(null);
  // Read the clock only after mount: `ago()` is time-dependent, and rendering
  // it on the server would guarantee a hydration mismatch on every row.
  React.useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const label = now === null ? "" : ago(at, now);
  return (
    <Tooltip title={new Date(at).toLocaleString()} disableInteractive>
      <Typography component="span" sx={{ fontSize: 11, color: token("dim"), ...sx }}>
        {label}
      </Typography>
    </Tooltip>
  );
}

/** A thin labelled pill — model, effort, permission mode, status. Not a `Chip`:
 *  a Chip's minimum height crowds a dense header row, and these are readouts
 *  rather than affordances. */
export function Tag({
  children,
  tone = "dim",
  title
}: {
  children: React.ReactNode;
  /** A theme ROLE, not a colour. `accent2`/`accent3` are the palette's own
   *  secondary hues and are what a model name and a token count are drawn in,
   *  so a rolled theme restyles them along with everything else. */
  tone?: "dim" | "ink" | "accent" | "accent2" | "accent3" | "ok" | "warn" | "err" | "info";
  title?: string;
}) {
  const pill = (
    <Box
      component="span"
      sx={{
        ...MONO,
        fontSize: 10.5,
        lineHeight: 1.6,
        px: 0.6,
        borderRadius: 0.6,
        border: `1px solid ${token("edge")}`,
        color: token(tone),
        whiteSpace: "nowrap"
      }}
    >
      {children}
    </Box>
  );
  return title ? (
    <Tooltip title={title} disableInteractive>
      {pill}
    </Tooltip>
  ) : (
    pill
  );
}

/**
 * A blinking caret for a block that is still streaming.
 *
 * A CSS animation rather than a timer: a `setInterval` per streaming block is a
 * re-render per blink, and a turn can have several open blocks at once.
 */
export function Caret() {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: "inline-block",
        width: "0.5em",
        height: "1em",
        ml: "1px",
        verticalAlign: "text-bottom",
        background: token("accent"),
        animation: "axf-claude-caret 1s steps(2, start) infinite",
        "@keyframes axf-claude-caret": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0 } },
        // A reader who asked for less motion should not get a strobing block.
        "@media (prefers-reduced-motion: reduce)": { animation: "none", opacity: 0.6 }
      }}
    />
  );
}
