/**
 * @file Build Manager — LAYOUT PREVIEW, dense single-screen.
 *
 * The first attempt used three tabs, which was wrong for a reason worth keeping
 * written down: **tabs hide two-thirds of the information at all times.** When
 * the job is "structure a build", you are constantly moving between the project
 * list, a phase's steps, and the notes that constrain them — and a tab bar
 * turns every one of those glances into a navigation. So: panes, everything on
 * screen, nothing behind a click.
 *
 * Density rules applied here, since "more information per screen" is a design
 * target and not a vague wish:
 *   - 11px mono, line-height 1.3, ~20px rows.
 *   - Numbers are tabular and right-aligned so columns scan vertically.
 *   - Status is a coloured dot plus a short word, never a badge with padding.
 *   - Explanation lives in this docblock, NOT on screen. Captions teaching the
 *     user about the design are the first thing to cut when space is the
 *     constraint.
 *   - No max-width. The screen is the budget; use it.
 *
 * Real `.bmpx` data throughout — and since 2026-08-08 the run is REAL too:
 * START spawns `bmpx_builder.py` through `/api/bmpx/run` (GizmoX venv,
 * `--control-file`, sentinel armed), the log pane tails its NDJSON event
 * stream, and the overlay is driven by the builder's own `group_start` /
 * `group_done` events via their `step_refs`. Dry is the default mode and
 * rehearses without archiving; REAL takes a second confirming click and
 * spends money. STOP is cooperative (control-file), so the builder settles
 * finished groups before exiting.
 *
 * Run statuses (owner directive, 2026-08-08): every step carries a MODEL badge
 * and a STATUS badge (pending · building · skip · complete). The statuses are
 * READ from the todo file (`.bmpx`); while a run is live the changes are
 * hot-rendered from the event-driven overlay, and THE BUILDER is the single
 * writer of done-flags and the cost ledger — this screen never writes run
 * results itself (`/api/bmpx/update` is not called on this path any more; the
 * old simulation used it). When the process exits the screen re-reads disk.
 *
 * A dry run leaves NO trace on screen (owner directive, 2026-08-09). The
 * builder never writes done-flags for a rehearsal (`mark_steps_done` returns 0
 * unless the mode is real), so every ✓, strike-through and glow a dry run puts
 * up comes from the in-memory overlay alone — and until now nothing cleared it,
 * so a finished rehearsal read exactly like a completed build. Ten seconds
 * after a dry run exits, all of it is dropped and the screen goes back to
 * rendering the FILE: step/phase overlay, phase glows, project glow. The log
 * lines and the cost readout stay — those are the rehearsal's OUTPUT, which is
 * the whole reason to run one. The same rule holds on re-entry: replaying a
 * finished dry run's events restores its log and cost but never its decoration,
 * or leaving and returning would put the ✓ back and defeat the ten seconds.
 *
 * Model switches (owner directive, 2026-08-08): three per-project toggles,
 * persisted as `plan.model_switches` in the `.bmpx` via `/api/bmpx/switches`
 * (both trees, `.swbak` backup) — never React-state-only, so what the badges
 * show is what a runner would read. `opus→all` runs every non-fable step on
 * opus-5; `fable→all` runs EVERY step on fable-5 (the two are mutually
 * exclusive — turning one on drops the other). Stored models stay untouched
 * underneath; an overridden badge renders struck-through beside the effective
 * one. `fable redo` appends ONE generated group at the end of the plan
 * redoing every opus-run step on fable-5; toggling off removes exactly that
 * group, and under `fable→all` it generates nothing (no step runs on opus).
 * All are disabled while a run is live — regenerating phases under a run
 * would shift the overlay's phase indices mid-flight.
 *
 * ── MUI (2026-08-10, P5) ─────────────────────────────────────────────────────
 *
 * The last entry in `check:ui`'s pre-MUI debt ledger (5 raw controls, 19
 * hand-painted containers) and the largest one: a raw `<table>` for the whole
 * plan outline and four hand-drawn `<button>` sites.
 *
 * The owner's instruction was explicitly NOT a redesign — *"exactly the way the
 * new one looks now it works great i just need mui"* — so this is a re-render
 * onto MUI primitives with every paint declaration carried across literally,
 * and it was held to that by measurement rather than by intent:
 * `scripts/buildmgr-probe.mjs` captured all four views BEFORE the first edit
 * (text leaves with their boxes and type, painted boxes with their geometry,
 * every control with its title and disabled state) and the same probe compares
 * afterwards. `npm run check:buildmgr` is that comparison, and a difference is
 * reported as a defect. The probe was verified against ITSELF first — two
 * captures of the unmodified screen, zero differences — because a comparator
 * that cannot hold still proves nothing about the thing it measures.
 *
 * What each piece became, and the three places the obvious MUI answer is the
 * wrong one:
 *
 *   - the plan outline is `Table` / `TableBody` / `TableRow` / `TableCell`.
 *     Every cell resets `border: 0` and re-declares the mono face, because
 *     `TableCell` ships a `borderBottom` and its own `fontFamily`/`fontSize`
 *     that would otherwise overwrite what the table inherited. That is what
 *     `Cell` exists for — one reset, applied everywhere, instead of nineteen
 *     chances to forget it.
 *   - phase rows stay `TableRow onClick` rather than becoming buttons. A
 *     `<button>` cannot be a `<tr>`, and row-level `onClick` is MUI's own
 *     pattern for a selectable table row. They are deliberately NOT given the
 *     `hover` prop: the original rows have no hover paint, and adding some
 *     would be a look change wearing an accessibility argument.
 *   - project rows WERE `<div onClick>` — the control that decides what the
 *     whole screen is showing, and unreachable from a keyboard. They are
 *     `ButtonBase` now (the same correction P3 made to brand-gallery's pack
 *     rows). `disableRipple`, because a ripple washing across a 20px row is a
 *     look change; and a `Mui-focusVisible` outline, because making something
 *     focusable without making the focus visible is half a fix. Neither shows
 *     in any captured view — the outline only paints under keyboard focus.
 *     **This is the one intentional behaviour difference in the rebuild** and
 *     it is reported as such rather than folded in quietly.
 *   - the switches, the mode pair and START are `ButtonBase`, not `Button` or
 *     `ToggleButton`. Those two arrive with `minWidth: 64px`, their own
 *     padding and an uppercase transform — at this density every one of those
 *     would have to be overridden back off, and a component you neutralise
 *     declaration by declaration is not being used, it is being fought. The
 *     switches and the mode pair carry `aria-pressed`, so "which one is on" is
 *     a state that is announced rather than only a colour.
 *   - panes are `Box component="section"`, deliberately NOT `Paper` — the same
 *     call P4 made for the console sub-band and for the same reason. `Paper`
 *     paints `background.paper` (`--axf-panel`) and sets `color:
 *     text.primary`; a pane here paints `--axf-page` and lets its children
 *     declare their own ink, so a `Paper` would have introduced two colour
 *     declarations the design does not have.
 *   - the pulse keyframes moved from a raw `<style>` element to `GlobalStyles`.
 *
 * **`M` gained one property: `letterSpacing: "normal"`.** It is not cosmetic.
 * The MUI bridge writes the `tracking` dial onto `body1`, so every `Typography`
 * on this screen would pick up letter-spacing that the plain `<span>`s it
 * replaced did not have — 0.11px per glyph across a dense mono table, which is
 * exactly the kind of drift that is invisible in review and obvious in a diff.
 * The probe caught it as a real difference; `normal` is what the original
 * computed to, so `normal` is what is declared.
 *
 * Text that sat DIRECTLY inside a styled container stays directly inside its
 * MUI replacement (the pane titles, in a `Stack`) instead of being wrapped in a
 * `Typography`. Wrapping would shrink the text's box from the full pane width
 * to the width of the words — identical on screen, a different element box, and
 * a faithfulness gate that reports it is right to. Where the original already
 * had its own element for the text, that element is a `Typography`.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import GlobalStyles from "@mui/material/GlobalStyles";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { getModuleSettings, toolbars, token } from "@axf/core";

import AssignModelPopup from "./AssignModelPopup";
import PlanReview from "./PlanReview";
import { effectiveModel, isKnownModel } from "./models";

/* ------------------------------------------------------------------- types */

interface Step {
  text: string;
  tok: number;
  done: boolean;
  model: string;
  reasonTag: string;
}
interface Phase {
  n: number;
  name: string;
  status: string;
  gate: string;
  generatedBy: string;
  estTok: number;
  steps: Step[];
}
interface Project {
  file: string;
  id: string;
  name: string;
  status: string;
  amberxBound: boolean;
  supersededBy: string | null;
  modified: number;
  version: string;
  created: string;
  bytes: number;
  notes: string[];
  checklist: string[];
  produces: Record<string, unknown> | null;
  rates: Record<string, number> | null;
  modelSwitches: {
    opus_everywhere?: boolean;
    fable_everywhere?: boolean;
    fable_redo?: boolean;
  } | null;
  phases: Phase[];
}

/* ------------------------------------------------------------------- atoms */

/**
 * The screen's type. `letterSpacing: "normal"` is load-bearing under MUI — see
 * the docblock: `Typography` would otherwise inherit the `tracking` dial from
 * `body1`, which the `<span>`s this replaced never had.
 */
const M = {
  fontFamily: token("mono"),
  fontSize: 11,
  lineHeight: 1.3,
  letterSpacing: "normal",
  fontVariantNumeric: "tabular-nums"
} as const;

/**
 * For text that INHERITED its type from the container it sits in — the pane
 * headers' right-hand readouts, which take the header's 9.5px, its `0.09em`
 * tracking and its uppercase transform.
 *
 * Spreading `M` on those instead was a real regression, caught by the probe on
 * the first comparison: `M` re-declares `fontSize: 11`, so each readout grew
 * from 9.5px to 11px, each pane header grew 2px taller, and every row in every
 * pane shifted down. `font` is a shorthand and does not cover tracking, so
 * `letterSpacing` is inherited explicitly beside it — this is the `AppShell`
 * idiom P4 recorded, and the reason it is an idiom.
 */
const INHERIT_TYPE = { font: "inherit", letterSpacing: "inherit" } as const;

/**
 * `TableCell` ships a `borderBottom` and its own type. Both have to come back
 * off for a cell to look like the `<td>` it replaced, and doing that per call
 * site is nineteen chances to miss one.
 */
const CELL = {
  border: 0,
  ...M,
  color: "inherit"
} as const;

const STATUS_TONE: Record<string, string> = {
  planned: "dim",
  ready: "accent2",
  building: "accent",
  superseded: "dim",
  // `built` is what bmpx_builder.py writes when every step is done — it was
  // missing here, so a finished project rendered a dim dot and read as
  // nothing-special in the list (found the night studio-shell-init shipped).
  built: "ok",
  done: "ok",
  todo: "dim",
  unreadable: "err"
};

/** How long a finished DRY run's status decoration stays on screen before the
 *  screen reverts to what the `.bmpx` says (owner directive, 2026-08-09). Long
 *  enough to read the outcome, short enough that nobody mistakes a rehearsal
 *  for a build. */
const DRY_CLEAR_MS = 10_000;

const fmtTok = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : n ? String(n) : "—");
const usd = (tok: number, r: Record<string, number> | null) =>
  `$${(((tok * 0.35 * (r?.in_per_mtok ?? 5)) + (tok * 0.65 * (r?.out_per_mtok ?? 25))) / 1e6).toFixed(0)}`;

function ago(ms: number): string {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Effective status of a step on screen: the run's in-memory overlay first,
 *  then what the todo file says. The file is the truth between runs; the
 *  overlay is the truth during one. */
type StepState = "pending" | "building" | "skip" | "complete";

const MODEL_TONE: Record<string, string> = {
  fable: "accent",
  opus: "accent3",
  sonnet: "accent2",
  haiku: "dim"
};

const STATE_TONE: Record<StepState, string> = {
  pending: "dim",
  building: "accent",
  skip: "warn",
  complete: "ok"
};

/** Small chip: 9px mono, toned border and text. */
function Badge({ text, tone, filled }: { text: string; tone: string; filled?: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        ...M,
        fontSize: 8.5,
        lineHeight: "13px",
        padding: "0 4px",
        borderRadius: "3px",
        border: `1px solid ${token(tone)}`,
        color: filled ? token("page") : token(tone),
        background: filled ? token(tone) : "transparent",
        whiteSpace: "nowrap",
        flexShrink: 0,
        display: "inline-block"
      }}
    >
      {text}
    </Box>
  );
}

/**
 * A model that is not in the catalog renders in `err` with a `?`, because the
 * builder's own resolution (`MODEL_CLI_IDS.get(model, MODEL_CLI_IDS[DEFAULT_TIER])`)
 * does NOT fail on one — it silently runs the step on sonnet-5. Painting the
 * family name from `model.split("-")[0]` made a typo look like a valid tier:
 * `"opus5"` rendered a perfectly ordinary `opus` badge.
 */
function ModelBadge({ model }: { model: string }) {
  if (!model) return null;
  const family = model.split("-")[0];
  if (!isKnownModel(model)) return <Badge text={`${family}?`} tone="err" />;
  return <Badge text={family} tone={MODEL_TONE[family] ?? "dim"} />;
}

function StateBadge({ state }: { state: StepState }) {
  return <Badge text={state} tone={STATE_TONE[state]} filled={state === "building"} />;
}

/**
 * Toggle chip for the model switches. `tone` is the on-state colour — the same
 * family tone the model badges use, so a switch reads as its model.
 *
 * `ButtonBase` rather than `ToggleButton`: see the docblock. `aria-pressed`
 * carries the on/off state that was previously only a fill colour.
 */
function SwitchChip({
  label,
  on,
  disabled,
  title,
  tone = "accent3",
  onClick
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  title: string;
  tone?: string;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      disableRipple
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      sx={{
        ...M,
        cursor: disabled ? "default" : "pointer",
        padding: "2px 8px",
        borderRadius: "3px",
        border: `1px solid ${token(on ? tone : "edge")}`,
        background: on ? token(tone) : "transparent",
        color: on ? token("page") : token("dim"),
        fontWeight: on ? 700 : 400,
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap"
      }}
    >
      {on ? "●" : "○"} {label}
    </ButtonBase>
  );
}

function Dot({ tone }: { tone: string }) {
  return (
    <Box
      component="span"
      sx={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: token(tone),
        flexShrink: 0,
        display: "inline-block"
      }}
    />
  );
}

/** Pane frame: a title strip and a scrolling body. Used for every region. */
function Pane({
  title,
  right,
  children,
  flex,
  width,
  minWidth
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  flex?: number;
  width?: number;
  minWidth?: number;
}) {
  return (
    <Box
      component="section"
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: flex ?? undefined,
        width,
        minWidth: minWidth ?? 0,
        borderRight: `1px solid ${token("edge")}`,
        minHeight: 0,
        background: token("page")
      }}
    >
      {/* The title sits directly in the Stack rather than in a Typography —
          wrapping would shrink its box to the width of the words. */}
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          gap: "8px",
          padding: "3px 8px",
          background: token("panel2"),
          borderBottom: `1px solid ${token("edge")}`,
          ...M,
          fontSize: 9.5,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: token("dim"),
          flexShrink: 0
        }}
      >
        {title}
        <Box sx={{ flex: 1 }} />
        {right}
      </Stack>
      <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>{children}</Box>
    </Box>
  );
}

/** One cell of the plan outline, with `TableCell`'s own paint reset off. */
function Cell({
  sx,
  children,
  ...rest
}: React.ComponentProps<typeof TableCell>) {
  return (
    <TableCell sx={{ ...CELL, ...sx }} {...rest}>
      {children}
    </TableCell>
  );
}

/* ------------------------------------------------------------------ screen */

export default function BuildmgrModule() {
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [selPhase, setSelPhase] = React.useState(0);
  /** Review mode swaps the three panes for the full-plan review table. It is a
   *  MODE rather than a fourth pane on purpose: a review needs the whole width
   *  for unclamped step prose, which is the one thing the outline cannot give
   *  it. The run strip stays mounted underneath either way, so the plan being
   *  reviewed and the START that runs it are never on separate screens. */
  const [review, setReview] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [runMode, setRunMode] = React.useState<"dry" | "real">("dry");
  const [armReal, setArmReal] = React.useState(false);
  /** The concurrent-runs override switch. Session state, never persisted —
   *  an armed override outliving the tab would be a standing foot-gun, the
   *  same posture as `armReal` and taskman's delete-all arm. */
  const [allowConcurrent, setAllowConcurrent] = React.useState(false);
  /** Soft warnings the server returned (428) that must be read and
   *  acknowledged before the concurrent start proceeds — the double-check. */
  const [pendingWarnings, setPendingWarnings] = React.useState<string[] | null>(null);
  const [runLines, setRunLines] = React.useState<string[]>([]);
  const [runCost, setRunCost] = React.useState<{ spent?: number; est?: number; actual?: number }>({});
  /** In-memory run overlay, keyed `${phaseIdx}:${stepIdx}`, driven by the
   *  builder's group_start/group_done events. The builder writes the file;
   *  this overlay only renders progress until the re-read at exit. */
  const [runState, setRunState] = React.useState<Record<string, "building" | "complete">>({});
  const [lastWrite, setLastWrite] = React.useState<string | null>(null);
  /** Byte offset into the run's events file (incremental GET polling). */
  const offsetRef = React.useRef(0);
  /** group index → step_refs, remembered from group_start for group_done. */
  const groupRefs = React.useRef<Record<number, [number, number][]>>({});
  /** Exit code of the open project's latest run (null = live or never ran) —
   *  drives the project-row glow: pulse blue building, solid green ok, solid
   *  red failed/stopped (owner directive, 2026-08-09). */
  const [lastExit, setLastExit] = React.useState<number | null>(null);
  /** Phases whose group failed (solid red glow) / just completed (green
   *  flash, cleared after 5s). Keyed by phase array index. */
  const [phaseErr, setPhaseErr] = React.useState<Record<number, boolean>>({});
  const [phaseFlash, setPhaseFlash] = React.useState<Record<number, boolean>>({});
  const flashTimers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  /** Pending "drop the dry run's decoration" timer — one at a time. */
  const dryClearTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      flashTimers.current.forEach(clearTimeout);
      if (dryClearTimer.current) clearTimeout(dryClearTimer.current);
    },
    []
  );

  /** Every piece of run-derived DECORATION, dropped in one go: the step/phase
   *  overlay, the phase glows, the project-row glow. Deliberately NOT the log
   *  lines or the cost — those are the run's output, not its status. After
   *  this the screen renders the `.bmpx` and nothing else. */
  const clearRunDecor = React.useCallback(() => {
    flashTimers.current.forEach(clearTimeout);
    flashTimers.current = [];
    setRunState({});
    setPhaseErr({});
    setPhaseFlash({});
    setLastExit(null);
  }, []);

  const cancelDryClear = React.useCallback(() => {
    if (dryClearTimer.current) {
      clearTimeout(dryClearTimer.current);
      dryClearTimer.current = null;
    }
  }, []);

  const open = projects?.find((p) => p.id === openId) ?? null;
  const openRef = React.useRef(open);
  openRef.current = open;

  const refetch = React.useCallback(async () => {
    try {
      const d = (await (await fetch("/api/bmpx")).json()) as { projects: Project[] };
      setProjects(d.projects);
      return d.projects;
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => {
    void refetch().then((ps) => {
      if (ps) setOpenId((cur) => cur ?? ps.find((p) => p.phases.length)?.id ?? ps[0]?.id ?? null);
    });
  }, [refetch]);

  /** Compact one-liner per builder event for the log pane — whitelisted
   *  fields only (group_start carries full step prose; never dump it). */
  const fmtEvent = (ev: Record<string, unknown>): string => {
    const keys = [
      "message", "text", "status", "phase", "model", "project", "mode", "ok",
      "index", "count", "workers", "spent_usd", "est_total_usd", "actual_usd",
      "armed", "id", "reason", "scope"
    ];
    const bits = keys
      .filter((k) => ev[k] !== undefined)
      .map((k) => `${k}=${String(ev[k])}`);
    return `${String(ev.event)}${bits.length ? " · " + bits.join(" ") : ""}`;
  };

  /** Apply a batch of parsed builder events to the screen — cost, log lines,
   *  and the step overlay. One function, used by the live poll AND the
   *  mount-time replay, so leaving the screen loses nothing: the events file
   *  on disk is the session, and re-entering rebuilds from it.
   *
   *  `decor: false` replays the OUTPUT only (log + cost) and skips every
   *  status change — the overlay, the phase glows. That is what a FINISHED
   *  dry run gets on re-entry, so returning to the screen cannot resurrect
   *  the ✓ that the ten-second clear already took down. */
  const applyEvents = React.useCallback((parsed: Record<string, unknown>[], o: Project, decor = true) => {
    // Pre-pass: remember each group's step refs and collect per-phase
    // outcomes for the glow (ok → 5s green flash, fail → solid red).
    const okPhases = new Set<number>();
    const errPhases = new Set<number>();
    for (const ev of parsed) {
      if (ev.event === "cost") {
        setRunCost((c) => ({ ...c, spent: Number(ev.spent_usd), est: Number(ev.est_total_usd) }));
      }
      if (ev.event === "run_cost") {
        setRunCost((c) => ({ ...c, actual: Number(ev.actual_usd) }));
      }
      const refs = (ev.step_refs ?? null) as [number, number][] | null;
      if (ev.event === "group_start" && refs) groupRefs.current[Number(ev.index)] = refs;
      if (ev.event === "group_done") {
        for (const [pn] of groupRefs.current[Number(ev.index)] ?? []) {
          const pi = o.phases.findIndex((p) => p.n === pn);
          if (pi >= 0) (ev.ok ? okPhases : errPhases).add(pi);
        }
      }
    }
    if (errPhases.size && decor) {
      setPhaseErr((m) => {
        const n = { ...m };
        for (const pi of errPhases) n[pi] = true;
        return n;
      });
    }
    if (okPhases.size && decor) {
      const pis = [...okPhases];
      setPhaseFlash((m) => {
        const n = { ...m };
        for (const pi of pis) n[pi] = true;
        return n;
      });
      flashTimers.current.push(
        setTimeout(() => {
          setPhaseFlash((m) => {
            const n = { ...m };
            for (const pi of pis) delete n[pi];
            return n;
          });
        }, 5000)
      );
    }
    setRunLines((ls) => [...ls, ...parsed.map(fmtEvent)].slice(-400));
    if (!decor) return;
    setRunState((s) => {
      const nx = { ...s };
      for (const ev of parsed) {
        const idx = Number(ev.index);
        if (ev.event === "group_start" && groupRefs.current[idx]) {
          for (const [pn, si] of groupRefs.current[idx]) {
            const pi = o.phases.findIndex((p) => p.n === pn);
            if (pi >= 0) nx[`${pi}:${si}`] = "building";
          }
        }
        if (ev.event === "group_done") {
          for (const [pn, si] of groupRefs.current[idx] ?? []) {
            const pi = o.phases.findIndex((p) => p.n === pn);
            if (pi < 0) continue;
            if (ev.ok) nx[`${pi}:${si}`] = "complete";
            else delete nx[`${pi}:${si}`];
          }
        }
      }
      return nx;
    });
  }, []);

  /** Rebuild the run session whenever a project is opened: replay the latest
   *  run's events from byte 0 (log, overlay, cost all restored), and if the
   *  run is still live, resume polling exactly where the file is. This is
   *  what makes the session survive leaving the screen — component state is
   *  a cache of the events file, never the other way round. */
  const hydratedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    const o = open;
    if (!o || hydratedFor.current === o.id) return;
    hydratedFor.current = o.id;
    cancelDryClear();
    setRunLines([]);
    setRunState({});
    setRunCost({});
    setArmReal(false);
    setRunning(false);
    setLastExit(null);
    setPhaseErr({});
    setPhaseFlash({});
    offsetRef.current = 0;
    groupRefs.current = {};
    void (async () => {
      try {
        const r = await fetch(`/api/bmpx/run?file=${encodeURIComponent(o.file)}&offset=0`);
        const j = (await r.json()) as {
          running: boolean;
          exitCode: number | null;
          mode: string | null;
          offset: number;
          lines: string[];
        };
        if (!j.mode) return; // this project has never run
        offsetRef.current = j.offset ?? 0;
        const parsed = (j.lines ?? [])
          .map((l) => {
            try {
              return JSON.parse(l) as Record<string, unknown>;
            } catch {
              return null;
            }
          })
          .filter((x): x is Record<string, unknown> => x !== null);
        // A finished DRY run replays its output but none of its status: its
        // decoration has either already been cleared or is past due, and a
        // rehearsal must never be able to look like a build just because the
        // screen was re-entered. A LIVE dry run still decorates — it is
        // in-flight, which is exactly when the overlay earns its keep.
        const decor = j.running || j.mode !== "dry";
        if (parsed.length) applyEvents(parsed, o, decor);
        setRunMode(j.mode === "real" ? "real" : "dry");
        if (j.running) {
          setRunning(true);
          setLastWrite(`resumed live ${j.mode} run — session restored from the events file`);
        } else if (j.exitCode !== null) {
          if (decor) setLastExit(j.exitCode);
          setLastWrite(
            `last run (${j.mode}) exited ${j.exitCode === 0 ? "ok" : j.exitCode === 3 ? "stopped" : `code ${j.exitCode}`}` +
              (decor ? "" : " — dry-run status not restored (the file is the truth)")
          );
        }
      } catch {
        /* no run to restore */
      }
    })();
  }, [open, applyEvents]);

  const startRun = React.useCallback(async (acknowledgeWarnings = false) => {
    const o = openRef.current;
    if (!o) return;
    if (runMode === "real" && !armReal && !acknowledgeWarnings) {
      // REAL spends money — first click arms, second confirms.
      setArmReal(true);
      return;
    }
    setArmReal(false);
    setPendingWarnings(null);
    // A clear armed by the PREVIOUS dry run would otherwise fire ten seconds
    // into this one and blank a live overlay.
    cancelDryClear();
    setRunLines([]);
    setRunState({});
    setRunCost({});
    setLastExit(null);
    setPhaseErr({});
    setPhaseFlash({});
    offsetRef.current = 0;
    groupRefs.current = {};
    try {
      const r = await fetch("/api/bmpx/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file: o.file,
          mode: runMode,
          concurrent: allowConcurrent,
          acknowledgeWarnings
        })
      });
      const j = (await r.json()) as {
        pid?: number;
        mode?: string;
        error?: string;
        needsAcknowledge?: boolean;
        warnings?: string[];
        conflicts?: { with: string; paths: string[] }[];
      };
      if (r.status === 428 && j.needsAcknowledge) {
        // The double-check: the server found shared-tree risks worth reading.
        setPendingWarnings(j.warnings ?? []);
        setLastWrite("concurrent start held — read the warnings below, then confirm");
        return;
      }
      if (!r.ok) {
        const detail = j.conflicts?.length
          ? ` — overlapping: ${j.conflicts.map((c) => `${c.with}: ${c.paths.join(", ")}`).join(" · ")}`
          : "";
        setLastWrite(`run refused: ${j.error ?? r.status}${detail}`);
        return;
      }
      setLastWrite(`spawned bmpx_builder pid ${j.pid} (${j.mode})`);
      setRunning(true);
    } catch (e) {
      setLastWrite(`run failed to start: ${String(e)}`);
    }
  }, [runMode, armReal, allowConcurrent, cancelDryClear]);

  const stopRun = React.useCallback(async () => {
    const o = openRef.current;
    if (!o) return;
    try {
      await fetch("/api/bmpx/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: o.file, stop: true })
      });
      setLastWrite("stop requested — the builder settles finished groups at the next gate");
    } catch (e) {
      setLastWrite(`stop failed: ${String(e)}`);
    }
  }, []);

  React.useEffect(() => {
    if (!running) return;
    let alive = true;
    const t = setInterval(async () => {
      const o = openRef.current;
      if (!o || !alive) return;
      try {
        const r = await fetch(
          `/api/bmpx/run?file=${encodeURIComponent(o.file)}&offset=${offsetRef.current}`
        );
        const j = (await r.json()) as {
          running: boolean;
          exitCode: number | null;
          mode: string | null;
          offset: number;
          lines: string[];
        };
        offsetRef.current = j.offset ?? offsetRef.current;
        const parsed = (j.lines ?? [])
          .map((l) => {
            try {
              return JSON.parse(l) as Record<string, unknown>;
            } catch {
              return null;
            }
          })
          .filter((x): x is Record<string, unknown> => x !== null);
        if (parsed.length && alive) {
          applyEvents(parsed, o);
          // Group boundaries are when the builder writes the .bmpx — re-read
          // it so done-flags, the checklist and phase crossing track the FILE
          // in real time, not only the overlay.
          if (parsed.some((ev) => ev.event === "group_done" || ev.event === "steps_done")) {
            void refetch();
          }
        }
        if (!j.running && j.exitCode !== null && alive) {
          setRunning(false);
          setLastExit(j.exitCode);
          setLastWrite(
            `run exited ${j.exitCode === 0 ? "ok" : j.exitCode === 3 ? "stopped" : `code ${j.exitCode}`} — re-read from disk`
          );
          void refetch();
          // A dry run rehearsed; it did not build anything and wrote nothing
          // to the .bmpx, so its ✓ and glows are the screen's own invention.
          // Hold them long enough to read the outcome, then hand the screen
          // back to the file. A real run keeps its status — the builder wrote
          // those done-flags, and the refetch above is where they came from.
          if (j.mode === "dry") {
            cancelDryClear();
            dryClearTimer.current = setTimeout(() => {
              dryClearTimer.current = null;
              clearRunDecor();
              setLastWrite(
                `dry run finished — status cleared after ${DRY_CLEAR_MS / 1000}s (nothing was built; the plan is unchanged)`
              );
            }, DRY_CLEAR_MS);
          }
        }
      } catch {
        /* transient poll failure — next tick retries */
      }
      // Module settings (core 0.0.20): the poll rate is the buildmgr's one
      // setting. Read at interval creation — a change lands on the next run,
      // which is when a rate can change without a tick straddling two rates.
    }, Number(getModuleSettings("buildmgr").pollMs) || 1200);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [running, refetch, applyEvents, cancelDryClear, clearRunDecor]);

  const stepState = React.useCallback(
    (ph: Phase, pi: number, s: Step, si: number): StepState => {
      const live = runState[`${pi}:${si}`];
      if (live) return live;
      if (s.done) return "complete";
      if (/^(dropped|skip)/.test(ph.status)) return "skip";
      return "pending";
    },
    [runState]
  );

  const phaseState = React.useCallback(
    (ph: Phase, pi: number): StepState => {
      if (/^(dropped|skip)/.test(ph.status)) return "skip";
      const sts = ph.steps.map((s, si) => stepState(ph, pi, s, si));
      if (sts.length && sts.every((x) => x === "complete")) return "complete";
      if (sts.some((x) => x === "building")) return "building";
      if (!sts.length && ph.status === "done") return "complete";
      return "pending";
    },
    [stepState]
  );

  const phase = open?.phases[selPhase] ?? null;
  const totalTok = open?.phases.reduce((n, p) => n + p.estTok, 0) ?? 0;
  /** Every step done, from the FILE — what flips the checklist and the final
   *  project crossing. The builder writes done-flags per group, and the poll
   *  refetches at each group boundary, so this tracks a live run. */
  const allDone =
    !!open &&
    open.phases.length > 0 &&
    open.phases.every((ph) => ph.steps.length === 0 || ph.steps.every((s) => s.done));

  /* ---------------------------------------------------- model switches */
  const [switching, setSwitching] = React.useState(false);
  const opusAll = Boolean(open?.modelSwitches?.opus_everywhere);
  const fableAll = Boolean(open?.modelSwitches?.fable_everywhere);
  const fableRedo = Boolean(open?.modelSwitches?.fable_redo);
  /** The model a step RUNS on under the switches. The rule used to be inlined
   *  here as a third copy of it; it is `models.ts`'s now, which is the copy
   *  `test/model-catalog.test.ts` pins against `bmpx_builder.py`. */
  const effModel = React.useCallback(
    (m: string) => effectiveModel(m, { opus_everywhere: opusAll, fable_everywhere: fableAll }),
    [opusAll, fableAll]
  );
  const setSwitches = React.useCallback(
    async (patch: { opusEverywhere?: boolean; fableEverywhere?: boolean; fableRedo?: boolean }) => {
      const o = openRef.current;
      if (!o) return;
      setSwitching(true);
      try {
        const r = await fetch("/api/bmpx/switches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file: o.file, ...patch })
        });
        const j = (await r.json()) as {
          switches?: { opus_everywhere: boolean; fable_everywhere: boolean; fable_redo: boolean };
          redoSteps?: number;
          mirrored?: boolean;
          error?: string;
        };
        setLastWrite(
          r.ok
            ? `switches: opus→all ${j.switches?.opus_everywhere ? "on" : "off"} · fable→all ${
                j.switches?.fable_everywhere ? "on" : "off"
              } · fable-redo ${
                j.switches?.fable_redo ? `on (${j.redoSteps} step group)` : "off"
              } → ${o.file}${j.mirrored ? " +mirror" : ""}`
            : `switch failed: ${j.error ?? r.status}`
        );
      } catch (e) {
        setLastWrite(`switch failed: ${String(e)}`);
      }
      await refetch();
      setSwitching(false);
    },
    [refetch]
  );

  return (
    // flex:1 inside the shell's content area — 100vh here would overflow by
    // exactly the height of the shell banner above it.
    //
    // This REQUIRES `ModuleHost`'s wrapper to be a flex column. It was a plain
    // block until 2026-08-11, which made `flex: 1` inert and let this root grow
    // to its content (2933px inside a 918px host) — panes stopped scrolling
    // independently and the whole run strip sat below the fold. `height: 100%`
    // was tried here first and does NOT fix it: the block parent's height is
    // not definite for percentage resolution, so the root still measured 2906.
    // The fix is in core, at the host.
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Build-state glow, matching the nav's selected-item glow geometry
          (0 0 12px, NavMenu's indicator: "glow"): pulsing info-blue while
          building, solid ok-green on success, solid err-red on failure. */}
      <GlobalStyles
        styles={{
          "@keyframes axsBmPulseBox": {
            "0%, 100%": { boxShadow: "0 0 4px 0 var(--axf-info)" },
            "50%": { boxShadow: "0 0 14px 2px var(--axf-info)" }
          },
          "@keyframes axsBmPulseOutline": {
            "0%, 100%": { outlineColor: "transparent" },
            "50%": { outlineColor: "var(--axf-info)" }
          }
        }}
      />
      {/* No page-level banner. Since core 0.0.6 `AppShell` mounts the ONE
          app.banner toolbar at the root for every route — a second mount here
          rendered two banners on one screen. The open-project readout, the
          swap-banner control and the read-only note live on this strip now. */}
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          gap: "8px",
          padding: "4px 12px",
          flexShrink: 0,
          borderBottom: `1px solid ${token("edge")}`,
          background: token("panel")
        }}
      >
        {open && (
          <>
            <Typography component="span" sx={{ ...M, fontWeight: 700 }}>{open.id}</Typography>
            <Typography component="span" sx={{ ...M, color: token("dim") }}>v{open.version}</Typography>
            <Dot tone={STATUS_TONE[open.status] ?? "dim"} />
            <Typography component="span" sx={{ ...M, color: token(STATUS_TONE[open.status] ?? "dim") }}>
              {open.status}
            </Typography>
            <Typography component="span" sx={{ ...M, color: token("dim") }}>
              {open.phases.length}ph · {fmtTok(totalTok)} · ~{usd(totalTok, open.rates)}
            </Typography>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        {open && (
          <SwitchChip
            label="review"
            on={review}
            tone="ok"
            title="Review the whole plan before running it: every step's full prose, its model, reason tag and token estimate — editable, priced by the model catalog rather than this file's own rates block. The standing pre-build rule is that the step list is reviewed before any build runs."
            onClick={() => setReview((r) => !r)}
          />
        )}
        {open && (
          <>
            <SwitchChip
              label="opus→all"
              on={opusAll}
              disabled={running || switching}
              title="Run every step that is not fable-5 on opus-5. Stored per-step models stay untouched underneath; toggling off restores them. Mutually exclusive with fable→all. Persisted in the .bmpx (plan.model_switches), both trees."
              onClick={() => void setSwitches({ opusEverywhere: !opusAll })}
            />
            <SwitchChip
              label="fable→all"
              on={fableAll}
              tone="accent"
              disabled={running || switching}
              title="Run EVERY step on fable-5. Stored per-step models stay untouched underneath; toggling off restores them. Mutually exclusive with opus→all; while on, fable-redo generates no group (nothing runs on opus). Persisted in the .bmpx, both trees."
              onClick={() => void setSwitches({ fableEverywhere: !fableAll })}
            />
            <SwitchChip
              label="fable redo"
              on={fableRedo}
              disabled={running || switching}
              title="Append a generated group at the end of the plan that redoes every opus-run step on fable-5. Toggling off removes exactly the generated group. Persisted in the .bmpx, both trees."
              onClick={() => void setSwitches({ fableRedo: !fableRedo })}
            />
          </>
        )}
        <Typography component="span" sx={{ ...M, color: token("dim") }}>
          run + switches write the .bmpx
        </Typography>
        <ButtonBase
          disableRipple
          onClick={() => toolbars.cycle("app.banner")}
          title="Swap the banner toolbar asset — changes every surface at once"
          sx={{
            ...M,
            cursor: "pointer",
            padding: "2px 8px",
            borderRadius: "3px",
            border: `1px solid ${token("edge")}`,
            background: "transparent",
            color: token("dim")
          }}
        >
          swap banner
        </ButtonBase>
      </Stack>

      {/* Mounted once, opened by the buildmgr.step context row. Saving goes
          through /api/bmpx/plan, so on success the file changed underneath the
          outline — re-read rather than patch, same posture as PlanReview. */}
      <AssignModelPopup onSaved={() => void refetch()} />

      {/* --------------------------------- pane row, or the review table */}
      {review ? (
        <PlanReview
          project={open}
          running={running}
          onSaved={async (message) => {
            setLastWrite(message);
            // The file changed underneath the outline, the run strip and the
            // cost readout. Re-read rather than patch state: the .bmpx is the
            // truth and the screen is a cache of it.
            await refetch();
          }}
        />
      ) : (
      <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* projects */}
        <Pane
          title={`projects · ${projects?.length ?? 0}`}
          width={252}
          right={<Typography component="span" sx={{ ...INHERIT_TYPE, color: token("dim") }}>tok</Typography>}
        >
          {(projects ?? []).map((p) => {
            const tk = p.phases.reduce((n, x) => n + x.estTok, 0);
            const active = p.id === openId;
            // The open project's run session drives its glow: pulse while
            // building, solid green when the run completed, solid red when it
            // failed or stopped incomplete.
            const glow = !active
              ? null
              : running
                ? "pulse"
                : lastExit === 0
                  ? "ok"
                  : lastExit !== null
                    ? "err"
                    : null;
            return (
              // ButtonBase, not a <div onClick>: this row decides what the
              // whole screen shows and was unreachable from a keyboard.
              // disableRipple keeps the 20px row's paint exactly as it was.
              <ButtonBase
                key={p.id}
                disableRipple
                onClick={() => {
                  setOpenId(p.id);
                  setSelPhase(0);
                }}
                sx={{
                  display: "flex",
                  justifyContent: "flex-start",
                  textAlign: "left",
                  width: "100%",
                  alignItems: "center",
                  gap: "6px",
                  padding: "3px 8px",
                  cursor: "pointer",
                  background: active ? token("panel2") : "transparent",
                  borderLeft: `2px solid ${active ? token("accent") : "transparent"}`,
                  ...M,
                  // Focus has to be visible once the row is focusable —
                  // keyboard-only, so no captured view changes.
                  "&.Mui-focusVisible": {
                    outline: `1px solid ${token("accent")}`,
                    outlineOffset: "-1px"
                  },
                  ...(glow === "pulse"
                    ? { animation: "axsBmPulseBox 2.2s ease-in-out infinite" }
                    : glow === "ok"
                      ? { boxShadow: `0 0 12px ${token("ok")}` }
                      : glow === "err"
                        ? { boxShadow: `0 0 12px ${token("err")}` }
                        : {}),
                  ...(glow ? { borderRadius: "4px", position: "relative", zIndex: 1 } : {})
                }}
              >
                <Dot tone={STATUS_TONE[p.status] ?? "dim"} />
                <Typography
                  component="span"
                  sx={{
                    ...M,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color:
                      p.status === "superseded" || p.status === "built" || p.status === "done"
                        ? token("dim")
                        : token("ink"),
                    // A finished project crosses off in ok, same convention as
                    // a complete phase row; superseded keeps its plain strike.
                    textDecoration:
                      p.status === "superseded" || p.status === "built" || p.status === "done"
                        ? "line-through"
                        : "none",
                    textDecorationColor:
                      p.status === "built" || p.status === "done" ? token("ok") : undefined
                  }}
                >
                  {p.id}
                </Typography>
                <Typography component="span" sx={{ ...M, color: token("dim"), fontSize: 10 }}>
                  {p.phases.length}
                </Typography>
                <Typography component="span" sx={{ ...M, color: token("dim"), width: 30, textAlign: "right" }}>
                  {fmtTok(tk)}
                </Typography>
                <Typography
                  component="span"
                  sx={{ ...M, color: token("dim"), width: 20, textAlign: "right", fontSize: 10 }}
                >
                  {ago(p.modified)}
                </Typography>
              </ButtonBase>
            );
          })}
        </Pane>

        {/* plan outline */}
        <Pane
          title="plan · phases & steps"
          flex={1}
          minWidth={380}
          right={
            <Typography component="span" sx={{ ...INHERIT_TYPE, color: token("dim") }}>
              {open ? `${open.phases.length} phases · ${fmtTok(totalTok)}` : ""}
            </Typography>
          }
        >
          {!open ? null : (
            <Table sx={{ width: "100%", borderCollapse: "collapse", ...M }}>
              <TableBody>
                {open.phases.map((ph, pi) => {
                  const pst = phaseState(ph, pi);
                  // Phase glow: pulse the phase being worked on; a completed
                  // group flashes its phase green for 5s then goes dark; a
                  // failed group leaves its phase solid red.
                  const phGlow =
                    pst === "building"
                      ? "pulse"
                      : phaseFlash[pi]
                        ? "ok"
                        : phaseErr[pi]
                          ? "err"
                          : null;
                  return (
                  <React.Fragment key={ph.n}>
                    {/* No `hover` prop: the original rows have no hover paint,
                        and adding some would be a look change. */}
                    <TableRow
                      onClick={() => setSelPhase(pi)}
                      sx={{
                        cursor: "pointer",
                        background: pi === selPhase ? token("panel2") : token("panel"),
                        borderTop: `1px solid ${token("edge")}`,
                        ...(phGlow
                          ? {
                              outline: `2px solid ${
                                phGlow === "ok" ? token("ok") : phGlow === "err" ? token("err") : "transparent"
                              }`,
                              outlineOffset: "-2px",
                              animation:
                                phGlow === "pulse" ? "axsBmPulseOutline 2.2s ease-in-out infinite" : undefined
                            }
                          : {})
                      }}
                    >
                      <Cell sx={{ width: 16, padding: "2px 4px 2px 6px", color: token(pst === "complete" ? "ok" : "dim") }}>
                        {pst === "complete" ? "✓" : "⠿"}
                      </Cell>
                      <Cell
                        sx={{
                          padding: "2px 4px",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          // The green cross-off: struck through in ok, live.
                          textDecoration: pst === "complete" ? "line-through" : "none",
                          textDecorationColor: token("ok"),
                          color: pst === "complete" ? token("dim") : token("ink")
                        }}
                      >
                        {ph.name}
                        {ph.generatedBy ? (
                          <Box component="span" sx={{ marginLeft: "6px" }}>
                            <Badge text="switch" tone="accent" />
                          </Box>
                        ) : null}
                      </Cell>
                      <Cell sx={{ padding: "2px 4px", color: token("dim") }}>
                        {ph.steps.length}st
                      </Cell>
                      <Cell
                        sx={{
                          padding: "2px 4px",
                          textAlign: "right",
                          color: token("dim"),
                          width: 42
                        }}
                      >
                        {fmtTok(ph.estTok)}
                      </Cell>
                      <Cell sx={{ padding: "2px 6px 2px 4px", textAlign: "right", width: 62 }}>
                        <StateBadge state={pst} />
                      </Cell>
                    </TableRow>
                    {ph.steps.map((s, si) => {
                      const st = stepState(ph, pi, s, si);
                      return (
                      <TableRow
                        key={si}
                        // The right-click contract: the area id plus everything
                        // buildmgr.commands.ts reads back out of the harvested
                        // MenuContext.data. `phase` is ph.n, never pi — the
                        // fable-redo switch moves indices; `n` holds still.
                        data-axf-area="buildmgr.step"
                        data-axf-file={open.file}
                        data-axf-phase={String(ph.n)}
                        data-axf-step={String(si)}
                        data-axf-model={s.model}
                        data-axf-done={s.done ? "1" : "0"}
                        sx={{ background: st === "building" ? token("panel2") : token("page") }}
                      >
                        <Cell sx={{ padding: "1px 4px 1px 6px", color: token(st === "complete" ? "ok" : "dim") }}>
                          {st === "complete" ? "✓" : "⠿"}
                        </Cell>
                        <Cell colSpan={2} sx={{ padding: "2px 4px", color: token("ink") }}>
                          <Typography
                            component="span"
                            sx={{
                              ...M,
                              display: "block",
                              lineHeight: 1.35,
                              textDecoration: st === "complete" ? "line-through" : "none",
                              textDecorationColor: token("ok"),
                              color:
                                st === "complete" || st === "skip" ? token("dim") : token("ink")
                            }}
                          >
                            {s.text.length > 210 ? s.text.slice(0, 210) + "…" : s.text}
                          </Typography>
                          {s.reasonTag && (
                            <Typography component="span" sx={{ ...M, color: token("accent"), fontSize: 9.5 }}>
                              {s.reasonTag}
                            </Typography>
                          )}
                        </Cell>
                        <Cell
                          sx={{
                            padding: "2px 4px",
                            textAlign: "right",
                            color: token("dim"),
                            verticalAlign: "top"
                          }}
                        >
                          {fmtTok(s.tok)}
                        </Cell>
                        <Cell
                          sx={{
                            padding: "2px 6px 2px 4px",
                            textAlign: "right",
                            verticalAlign: "top",
                            whiteSpace: "nowrap",
                            width: 110
                          }}
                        >
                          <Box component="span" sx={{ display: "inline-flex", gap: "4px" }}>
                            {effModel(s.model) !== s.model && (
                              // The stored model, struck through — the switch
                              // overrides it but never rewrites it.
                              <Box component="span" sx={{ textDecoration: "line-through", opacity: 0.55 }}>
                                <ModelBadge model={s.model} />
                              </Box>
                            )}
                            <ModelBadge model={effModel(s.model)} />
                            <StateBadge state={st} />
                          </Box>
                        </Cell>
                      </TableRow>
                      );
                    })}
                    <TableRow sx={{ background: token("page") }}>
                      <Cell sx={{ padding: "1px" }} />
                      <Cell colSpan={4} sx={{ padding: "1px 6px 4px 4px" }}>
                        <Box component="span" sx={{ color: ph.gate ? token("ok") : token("err") }}>▸ </Box>
                        <Box component="span" sx={{ color: ph.gate ? token("dim") : token("err") }}>
                          {ph.gate || "no gate — cannot fail, so cannot pass"}
                        </Box>
                      </Cell>
                    </TableRow>
                  </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Pane>

        {/* inspector */}
        <Pane
          title={phase ? `inspector · ${phase.name}` : "inspector"}
          width={330}
          right={open ? <Typography component="span" sx={{ ...INHERIT_TYPE, color: token("dim") }}>{open.file}</Typography> : null}
        >
          {!open ? null : (
            <Box sx={{ ...M, padding: "4px 8px" }}>
              <Group label="produces">
                {open.produces
                  ? Object.entries(open.produces).map(([k, v]) => (
                      <KV key={k} k={k.replace(/^note_/, "")} v={String(v)} clamp />
                    ))
                  : <KV k="—" v="" />}
              </Group>

              <Group label={`checklist · ${open.checklist.length}${allDone ? " · complete" : ""}`}>
                {open.checklist.map((c, i) => (
                  <Stack key={i} direction="row" sx={{ gap: "5px", padding: "1px 0" }}>
                    <Typography component="span" sx={{ ...M, color: token(allDone ? "ok" : "dim") }}>
                      {allDone ? "☑" : "☐"}
                    </Typography>
                    <Typography
                      component="span"
                      sx={{
                        ...M,
                        color: allDone ? token("dim") : token("ink"),
                        lineHeight: 1.35,
                        textDecoration: allDone ? "line-through" : "none",
                        textDecorationColor: token("ok")
                      }}
                    >
                      {c}
                    </Typography>
                  </Stack>
                ))}
              </Group>

              <Group label={`notes · ${open.notes.length}`}>
                {open.notes.map((n, i) => (
                  <Typography
                    key={i}
                    component="div"
                    sx={{
                      ...M,
                      padding: "2px 0",
                      color: n.startsWith("===") ? token("accent") : token("dim"),
                      lineHeight: 1.35,
                      fontWeight: n.startsWith("===") ? 700 : 400
                    }}
                  >
                    {n.length > 260 ? n.slice(0, 260) + "…" : n}
                  </Typography>
                ))}
              </Group>
            </Box>
          )}
        </Pane>
      </Box>
      )}

      {/* ------------------------------------------------------- run strip */}
      <Stack
        direction="row"
        sx={{
          height: 172,
          flexShrink: 0,
          borderTop: `1px solid ${token("edge")}`,
          background: token("panel")
        }}
      >
        <Box sx={{ width: 252, borderRight: `1px solid ${token("edge")}`, overflow: "auto" }}>
          {(open?.phases ?? []).map((ph, i) => {
            // The same effective state the plan pane renders — one truth, two
            // views, crossing off together in real time.
            const pst = phaseState(ph, i);
            const tone = STATE_TONE[pst];
            return (
              <Stack
                key={ph.n}
                direction="row"
                sx={{
                  gap: "6px",
                  alignItems: "center",
                  padding: "2px 8px",
                  ...M,
                  // was inheriting dim-on-panel and reading as empty rows
                  color: token("ink"),
                  background: pst === "building" ? token("panel2") : "transparent"
                }}
              >
                <Typography component="span" sx={{ ...M, color: token(tone), width: 9 }}>
                  {pst === "complete" ? "✓" : pst === "building" ? "●" : pst === "skip" ? "–" : "·"}
                </Typography>
                <Typography
                  component="span"
                  sx={{
                    ...M,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: pst === "complete" ? "line-through" : "none",
                    textDecorationColor: token("ok"),
                    color: pst === "complete" ? token("dim") : token("ink")
                  }}
                >
                  {ph.name}
                </Typography>
                <Typography component="span" sx={{ ...M, color: token("dim"), fontSize: 10 }}>
                  {fmtTok(ph.estTok)}
                </Typography>
              </Stack>
            );
          })}
        </Box>

        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Box sx={{ flex: 1, overflow: "auto", padding: "4px 8px", background: token("page") }}>
            {runLines.length === 0 ? (
              <Typography component="span" sx={{ ...M, color: token("dim") }}>
                idle — START spawns the real builder (dry rehearses without archiving; REAL
                spends money through claude agents and needs a confirming second click)
              </Typography>
            ) : (
              runLines.map((l, i) => (
                <Typography key={i} component="div" sx={{ ...M, color: token("dim"), whiteSpace: "nowrap" }}>
                  <Box component="span" sx={{ color: token("edge") }}>{String(i).padStart(3, "0")} </Box>
                  <Box
                    component="span"
                    sx={{ color: /error|halted|runaway|stopped/.test(l) ? token("err") : token("ink") }}
                  >
                    {l.length > 220 ? l.slice(0, 220) + "…" : l}
                  </Box>
                </Typography>
              ))
            )}
          </Box>
          {pendingWarnings && (
            <Box
              sx={{
                padding: "6px 8px",
                borderTop: `1px solid ${token("warn")}`,
                background: token("panel2")
              }}
            >
              {pendingWarnings.map((w, i) => (
                <Typography key={i} component="div" sx={{ ...M, color: token("warn"), fontSize: 10 }}>
                  ⚠ {w}
                </Typography>
              ))}
              <Stack direction="row" sx={{ gap: "8px", marginTop: "4px" }}>
                <ButtonBase
                  disableRipple
                  onClick={() => void startRun(true)}
                  sx={{
                    ...M,
                    padding: "2px 10px",
                    borderRadius: "3px",
                    background: token("warn"),
                    color: token("page"),
                    fontWeight: 700
                  }}
                >
                  run anyway — warnings read
                </ButtonBase>
                <ButtonBase
                  disableRipple
                  onClick={() => setPendingWarnings(null)}
                  sx={{ ...M, padding: "2px 10px", borderRadius: "3px", border: `1px solid ${token("edge")}`, color: token("dim") }}
                >
                  cancel
                </ButtonBase>
              </Stack>
            </Box>
          )}
          <Stack
            direction="row"
            sx={{
              alignItems: "center",
              gap: "10px",
              padding: "3px 8px",
              borderTop: `1px solid ${token("edge")}`,
              background: token("panel2"),
              ...M
            }}
          >
            <Typography component="span" sx={{ ...M, color: token("accent"), fontWeight: 700 }}>
              {runCost.spent != null ? `$${runCost.spent.toFixed(2)}` : "$—"}
            </Typography>
            {runCost.est != null && (
              <Typography component="span" sx={{ ...M, color: token("dim") }}>est ${runCost.est.toFixed(2)}</Typography>
            )}
            {runCost.actual != null && (
              <Typography component="span" sx={{ ...M, color: token("ok") }}>run ${runCost.actual.toFixed(2)}</Typography>
            )}
            <Typography component="span" sx={{ ...M, color: token(runMode === "real" ? "err" : "warn"), fontSize: 9.5 }}>
              {running ? `live · ${runMode}` : `mode: ${runMode}`}
            </Typography>
            {lastWrite && (
              <Typography
                component="span"
                sx={{ ...M, color: token("ok"), fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {lastWrite}
              </Typography>
            )}
            <Box sx={{ flex: 1 }} />
            <ButtonBase
              disableRipple
              aria-pressed={allowConcurrent}
              onClick={() => {
                setAllowConcurrent((v) => !v);
                setPendingWarnings(null);
              }}
              title={
                "OFF: one build at a time (the default). ON: this START may run beside live builds — " +
                "the server still refuses overlapping paths outright and holds shared-tree risks for a " +
                "read-and-confirm. Session-only; resets when the tab closes."
              }
              sx={{
                ...M,
                cursor: "pointer",
                padding: "2px 8px",
                borderRadius: "3px",
                border: `1px solid ${token(allowConcurrent ? "warn" : "edge")}`,
                background: allowConcurrent ? token("warn") : "transparent",
                color: allowConcurrent ? token("page") : token("dim")
              }}
            >
              ∥ concurrent
            </ButtonBase>
            {(["dry", "real"] as const).map((m) => (
              <ButtonBase
                key={m}
                disableRipple
                disabled={running}
                aria-pressed={runMode === m}
                onClick={() => {
                  setRunMode(m);
                  setArmReal(false);
                }}
                title={m === "real" ? "REAL spawns claude agents and spends money — START then asks for a confirming second click" : "Dry run: compiles, groups and rehearses the plan without spawning agents or archiving"}
                sx={{
                  ...M,
                  cursor: running ? "default" : "pointer",
                  padding: "2px 8px",
                  borderRadius: "3px",
                  border: `1px solid ${token(runMode === m ? (m === "real" ? "err" : "ok") : "edge")}`,
                  background: runMode === m ? token(m === "real" ? "err" : "ok") : "transparent",
                  color: runMode === m ? token("page") : token("dim"),
                  opacity: running ? 0.5 : 1
                }}
              >
                {m}
              </ButtonBase>
            ))}
            <ButtonBase
              disableRipple
              onClick={() => {
                if (running) void stopRun();
                else void startRun();
              }}
              sx={{
                ...M,
                cursor: "pointer",
                padding: "3px 16px",
                borderRadius: "3px",
                border: "none",
                fontWeight: 700,
                background: running ? token("err") : armReal ? token("warn") : token("ok"),
                color: token("page")
              }}
            >
              {running ? "■ STOP" : armReal ? "▶ CONFIRM REAL $" : "▶ START"}
            </ButtonBase>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}

/* ----------------------------------------------------------------- shared */

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ marginBottom: "8px" }}>
      {/* Typography as a div keeps the label's box the full width it was. */}
      <Typography
        component="div"
        sx={{
          ...M,
          fontSize: 9.5,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: token("accent"),
          borderBottom: `1px solid ${token("edge")}`,
          paddingBottom: "2px",
          marginBottom: "3px"
        }}
      >
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function KV({ k, v, clamp }: { k: string; v: string; clamp?: boolean }) {
  return (
    <Stack direction="row" sx={{ gap: "6px", padding: "1px 0", alignItems: "flex-start" }}>
      <Typography component="span" sx={{ ...M, color: token("dim"), minWidth: 74, flexShrink: 0 }}>
        {k}
      </Typography>
      <Typography component="span" sx={{ ...M, color: token("ink"), lineHeight: 1.35, minWidth: 0 }}>
        {clamp && v.length > 190 ? v.slice(0, 190) + "…" : v}
      </Typography>
    </Stack>
  );
}
