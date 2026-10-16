"use client";

/**
 * @file The difference browser — rebuilt on MUI by `axf-claude` P5.
 *
 * One column per historical instance, oldest left, current right. Columns
 * collapse to a left rail and resize by drag. Each column's toolbar folds into
 * its rail when collapsed, so a collapsed column still shows its identity and
 * its change count without occupying width.
 *
 * Two filters, in a deliberate order. The **changes-only** filter reduces a
 * column to the rows it introduced. Only once that is on does the **comparison
 * base** toggle appear, because "compare against the previous revision or
 * against every earlier one" is a meaningless question while you are looking at
 * the whole file.
 *
 * Find behaves the way every OS and browser has trained people to expect:
 * arrows, F3 and Shift+F3, wrap-around, the current hit highlighted differently
 * from the rest and scrolled into view. The **global toggle** promotes one
 * column's query to all of them — every column then reports its own hit count,
 * and every other field greys out, so there is exactly one query in play and no
 * ambiguity about which box is driving.
 *
 * ── what the rebuild changed, and what it deliberately did not ──────────────
 *
 * The BEHAVIOUR is the pre-strip browser's, feature for feature, because that
 * behaviour was specified by the owner and verified live (`axf-diff-browser.bmpx`
 * P3: changes-only cut 1611 rows to 1135; per-column find 1/20; global mode
 * 1/12 · 1/19 · 1/20 with the other fields greyed). The MARKUP is new: every
 * raw `<button>` is an `IconButton`, the find field is a `TextField`, and the
 * hand-drawn chrome is `Box`/`Stack`/`Paper` — `.claude/rules/no-hand-rolled-ui.md`
 * §0 and `npm run check:ui`, which would fail this file on any of the old ones.
 *
 * One capability is genuinely new, and it is a bug fix rather than a feature:
 * a **tracked-file selector**. `history.ts` discovers the folders under
 * `.history/` instead of hardcoding `PLANNING-STATE`, and there are four — so
 * three sets of snapshots were unreachable through the viewer that exists to
 * read them.
 *
 * All icons resolve through the branding pack. There is no icon-library import
 * in this file, by contract.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { fetchInstances, type TrackedFile } from "./client";
import { buildModel, changedRowKeys, findHits } from "./engine";
import type { DiffModel, Hit, Instance, Row } from "./engine";

/* ------------------------------------------------------------------ atoms */

const MONO = { fontFamily: token("mono"), fontSize: 11.5 } as const;

const ROW_H = 18;
const COLLAPSED_W = 44;

/**
 * Icon button.
 *
 * It does NOT check whether the pack has the glyph first. `Glyph` already
 * renders a labelled placeholder for a miss, and having a second fallback here
 * meant a missing drawing silently became a three-letter text stub — which
 * looks like a design choice rather than a defect, and hid the fact that no
 * icons were resolving at all. That lesson survived the rewrite; the raw
 * `<button>` it used to be did not.
 */
function IconBtn({
  icon,
  label,
  active,
  disabled,
  onClick,
  tone = "accent"
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  tone?: "accent" | "warn";
}) {
  return (
    <Tooltip title={label} enterDelay={400}>
      {/* A disabled button raises no events, so the tooltip needs a live
          wrapper or the explanation vanishes exactly when it is wanted. */}
      <Box component="span" sx={{ display: "inline-flex" }}>
        <IconButton
          size="small"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          sx={{
            width: 24,
            height: 22,
            borderRadius: "var(--axf-radius-tight)",
            border: `1px solid ${active ? token(tone) : token("edge")}`,
            background: active ? token(tone) : "transparent",
            color: active ? token("page") : token("ink"),
            "&:hover": { background: active ? token(tone) : token("panel2") }
          }}
        >
          <Glyph id={icon} size={13} />
        </IconButton>
      </Box>
    </Tooltip>
  );
}

/* ------------------------------------------------------------- column state */

interface ColState {
  width: number;
  collapsed: boolean;
  changesOnly: boolean;
  base: "prev" | "all";
  query: string;
  hitIndex: number;
}

const newCol = (): ColState => ({
  width: 380,
  collapsed: false,
  changesOnly: false,
  base: "prev",
  query: "",
  hitIndex: 0
});

/* ------------------------------------------------------------------ screen */

export default function DiffBrowser({ file = "PLANNING-STATE" }: { file?: string }) {
  const [tracked, setTracked] = React.useState<readonly TrackedFile[]>([]);
  const [picked, setPicked] = React.useState(file);
  const [instances, setInstances] = React.useState<Instance[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cols, setCols] = React.useState<ColState[]>([]);
  const [globalCol, setGlobalCol] = React.useState<number | null>(null);
  const [wrap, setWrap] = React.useState(false);
  const [syncScroll, setSyncScroll] = React.useState(true);
  const [showUnchanged, setShowUnchanged] = React.useState(true);

  const bodyRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const scrolling = React.useRef(false);

  /* ------------------------------------------------------------ load */

  const load = React.useCallback(() => {
    setError(null);
    fetchInstances(picked)
      .then((data) => {
        setTracked(data.tracked ?? []);
        const list = [...(data.instances ?? [])];
        if (data.error && !list.length) setError(data.error);
        setInstances(list);
        setCols(list.map(() => newCol()));
        setGlobalCol(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [picked]);

  React.useEffect(load, [load]);

  const model: DiffModel | null = React.useMemo(
    () => (instances && instances.length ? buildModel(instances) : null),
    [instances]
  );

  /* ------------------------------------------------------------ find */

  // The query actually in force per column: its own, or the global one.
  const effectiveQuery = React.useCallback(
    (col: number) => (globalCol === null ? (cols[col]?.query ?? "") : (cols[globalCol]?.query ?? "")),
    [cols, globalCol]
  );

  const hitsByCol: Hit[][] = React.useMemo(() => {
    if (!model) return [];
    return model.instances.map((_, col) => {
      const q = globalCol === null ? (cols[col]?.query ?? "") : (cols[globalCol]?.query ?? "");
      return q ? findHits(model.rows, q, [col]) : [];
    });
  }, [model, cols, globalCol]);

  const step = React.useCallback(
    (col: number, delta: number) => {
      const hits = hitsByCol[col] ?? [];
      if (!hits.length) return;
      setCols((prev) => {
        const next = [...prev];
        const cur = next[col];
        if (!cur) return prev;
        // Wrap-around, because every find bar anyone has used wraps.
        const idx = (cur.hitIndex + delta + hits.length) % hits.length;
        next[col] = { ...cur, hitIndex: idx };
        return next;
      });
    },
    [hitsByCol]
  );

  // F3 / Shift+F3 anywhere on the surface, like the rest of the world.
  const focusedCol = React.useRef(0);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F3") {
        e.preventDefault();
        step(focusedCol.current, e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape" && globalCol !== null) {
        setGlobalCol(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, globalCol]);

  /* Scroll the active hit into view whenever it moves. */
  const hitCursor = cols.map((c) => c.hitIndex).join(",");
  React.useEffect(() => {
    cols.forEach((c, col) => {
      const hits = hitsByCol[col];
      if (!hits?.length) return;
      const hit = hits[Math.min(c.hitIndex, hits.length - 1)];
      const body = bodyRefs.current[col];
      if (!body || !hit) return;
      const el = body.querySelector<HTMLElement>(`[data-rowkey="${hit.rowKey}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    // Keyed on the hit INDICES only. Re-running on every model change would
    // yank the viewport while someone is reading, which is why `cols` itself is
    // deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitCursor, globalCol]);

  const onBodyScroll = (col: number) => (e: React.UIEvent<HTMLDivElement>) => {
    if (!syncScroll || scrolling.current) return;
    scrolling.current = true;
    const top = e.currentTarget.scrollTop;
    bodyRefs.current.forEach((el, i) => {
      if (i !== col && el) el.scrollTop = top;
    });
    requestAnimationFrame(() => (scrolling.current = false));
  };

  /* ------------------------------------------------------------ resize */

  const startResize = (col: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = cols[col]?.width ?? 380;
    const move = (ev: PointerEvent) => {
      const w = Math.max(180, Math.min(1200, startW + (ev.clientX - startX)));
      setCols((prev) => {
        const next = [...prev];
        const cur = next[col];
        if (!cur) return prev;
        next[col] = { ...cur, width: w };
        return next;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const patch = (col: number, p: Partial<ColState>) =>
    setCols((prev) => {
      const next = [...prev];
      const cur = next[col];
      if (!cur) return prev;
      next[col] = { ...cur, ...p, ...(p.query !== undefined ? { hitIndex: 0 } : {}) };
      return next;
    });

  const setAll = (p: Partial<ColState>) => setCols((prev) => prev.map((c) => ({ ...c, ...p })));

  /* ------------------------------------------------------------ render */

  if (!model) {
    return (
      <Box sx={{ p: 3.5 }}>
        <Typography sx={{ ...MONO, fontSize: 13, color: error ? token("err") : token("dim") }}>
          {error ?? "reading history…"}
        </Typography>
        <Typography sx={{ ...MONO, fontSize: 11.5, color: token("dim"), mt: 1, lineHeight: 1.7 }}>
          {tracked.length
            ? "Pick another tracked file — this one has no snapshots yet."
            : `Nothing under .history/. The merge system that wrote these snapshots was retired on
               2026-08-09; the folders it left are records, and this browser is their viewer.`}
        </Typography>
        {tracked.length > 0 && (
          <Box sx={{ mt: 1.4, maxWidth: 320 }}>
            <FilePicker tracked={tracked} picked={picked} onPick={setPicked} />
          </Box>
        )}
      </Box>
    );
  }

  const totalHits = hitsByCol.reduce((n, h) => n + h.length, 0);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        // flex:1 inside the shell's content area — 100vh here would overflow by
        // exactly the height of the banner above it.
        flex: 1,
        minHeight: 0,
        background: token("page"),
        color: token("ink")
      }}
    >
      <MainToolbar
        model={model}
        tracked={tracked}
        picked={picked}
        totalHits={totalHits}
        globalOn={globalCol !== null}
        wrap={wrap}
        syncScroll={syncScroll}
        showUnchanged={showUnchanged}
        onPick={setPicked}
        onReload={load}
        onWrap={() => setWrap((v) => !v)}
        onSync={() => setSyncScroll((v) => !v)}
        onUnchanged={() => setShowUnchanged((v) => !v)}
        onExpandAll={() => setAll({ collapsed: false })}
        onCollapseOlder={() =>
          setCols((prev) => prev.map((c, i) => ({ ...c, collapsed: i < prev.length - 2 })))
        }
        onChangesAll={() => setAll({ changesOnly: true })}
        onClearFilters={() => {
          setAll({ changesOnly: false, base: "prev", query: "" });
          setGlobalCol(null);
        }}
      />

      <Box sx={{ flex: 1, display: "flex", overflowX: "auto", minHeight: 0 }}>
        {model.instances.map((inst, col) => {
          const state = cols[col] ?? newCol();
          const hits = hitsByCol[col] ?? [];
          const active = hits[Math.min(state.hitIndex, Math.max(0, hits.length - 1))];
          const changed = state.changesOnly ? changedRowKeys(model.rows, col, state.base) : null;
          const disabledField = globalCol !== null && globalCol !== col;

          return (
            <Column
              key={inst.id}
              col={col}
              instance={inst}
              state={state}
              stats={model.stats[col] ?? { added: 0, removed: 0, addedVsAll: 0 }}
              rows={model.rows}
              changed={changed}
              hits={hits}
              activeHit={active}
              disabledField={disabledField}
              globalOn={globalCol !== null}
              query={effectiveQuery(col)}
              wrap={wrap}
              showUnchanged={showUnchanged}
              isLast={col === model.instances.length - 1}
              bodyRef={(el) => {
                bodyRefs.current[col] = el;
              }}
              onScroll={onBodyScroll(col)}
              onFocus={() => (focusedCol.current = col)}
              onPatch={(p) => patch(col, p)}
              onStep={(d) => step(col, d)}
              onToggleGlobal={() => setGlobalCol(globalCol === col ? null : col)}
              onResize={startResize(col)}
            />
          );
        })}
      </Box>
    </Box>
  );
}

/* ----------------------------------------------------------- file picker */

function FilePicker({
  tracked,
  picked,
  onPick
}: {
  tracked: readonly TrackedFile[];
  picked: string;
  onPick: (name: string) => void;
}) {
  return (
    <TextField
      size="small"
      select
      fullWidth
      label="Tracked file"
      value={tracked.some((t) => t.name === picked) ? picked : ""}
      onChange={(e) => onPick(e.target.value)}
      slotProps={{ select: { displayEmpty: true }, htmlInput: { sx: MONO } }}
    >
      {tracked.map((t) => (
        <MenuItem key={t.name} value={t.name} sx={MONO}>
          {t.name} · {t.snapshots} snapshot{t.snapshots === 1 ? "" : "s"}
          {t.live ? "" : " · no live file"}
        </MenuItem>
      ))}
    </TextField>
  );
}

/* --------------------------------------------------------------- toolbar */

function MainToolbar(props: {
  model: DiffModel;
  tracked: readonly TrackedFile[];
  picked: string;
  totalHits: number;
  globalOn: boolean;
  wrap: boolean;
  syncScroll: boolean;
  showUnchanged: boolean;
  onPick: (name: string) => void;
  onReload: () => void;
  onWrap: () => void;
  onSync: () => void;
  onUnchanged: () => void;
  onExpandAll: () => void;
  onCollapseOlder: () => void;
  onChangesAll: () => void;
  onClearFilters: () => void;
}) {
  const { model } = props;
  const totalAdded = model.stats.reduce((n, s) => n + s.added, 0);
  const totalRemoved = model.stats.reduce((n, s) => n + s.removed, 0);

  return (
    /* No page-level banner. `AppShell` mounts the ONE app.banner toolbar at the
       root for every route — a second mount here rendered two banners on one
       screen. This is the controls row, not a banner. */
    <Stack
      direction="row"
      spacing={1.2}
      useFlexGap
      sx={{
        alignItems: "center",
        flexWrap: "wrap",
        px: 1.5,
        py: 0.6,
        borderBottom: `var(--axf-border) solid ${token("edge")}`,
        background: token("panel")
      }}
    >
      <Box sx={{ minWidth: 210 }}>
        <FilePicker tracked={props.tracked} picked={props.picked} onPick={props.onPick} />
      </Box>

      <Stack direction="row" spacing={0.6}>
        <IconBtn
          icon="icon-collapse"
          label="Collapse every revision except the two newest, so recent history fits without scrolling sideways"
          onClick={props.onCollapseOlder}
        />
        <IconBtn
          icon="icon-expand"
          label="Expand every collapsed column back to full width"
          onClick={props.onExpandAll}
        />
        <IconBtn
          icon="icon-filter"
          label="Hide unchanged lines in every column at once — leaves only what each revision introduced"
          onClick={props.onChangesAll}
        />
        <IconBtn
          icon="icon-filter-off"
          label="Turn off every filter and search box and show the full text again"
          onClick={props.onClearFilters}
        />
      </Stack>

      <Stack direction="row" spacing={0.6}>
        <IconBtn
          icon="icon-wrap"
          label="Wrap long lines instead of cutting them off at the column edge"
          active={props.wrap}
          onClick={props.onWrap}
        />
        <IconBtn
          icon="icon-sync"
          label="Scroll every column together so the same line stays side by side — turn off to scroll one column alone"
          active={props.syncScroll}
          onClick={props.onSync}
        />
        <IconBtn
          icon="icon-eye"
          label="Show lines carried over unchanged — turn off to see only what moved"
          active={props.showUnchanged}
          onClick={props.onUnchanged}
        />
        <IconBtn
          icon="icon-reload"
          label="Re-read the snapshots from disk"
          onClick={props.onReload}
        />
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Typography sx={{ ...MONO, fontSize: 10.5, color: token("dim"), whiteSpace: "nowrap" }}>
        {model.instances.length} revisions · +{totalAdded} −{totalRemoved}
        {props.globalOn ? ` · find ${props.totalHits}` : ""}
      </Typography>
    </Stack>
  );
}

/* ---------------------------------------------------------------- column */

function Column(props: {
  col: number;
  instance: Instance;
  state: ColState;
  stats: { added: number; removed: number; addedVsAll: number };
  rows: readonly Row[];
  changed: Set<number> | null;
  hits: readonly Hit[];
  activeHit: Hit | undefined;
  disabledField: boolean;
  globalOn: boolean;
  query: string;
  wrap: boolean;
  showUnchanged: boolean;
  isLast: boolean;
  bodyRef: (el: HTMLDivElement | null) => void;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onPatch: (p: Partial<ColState>) => void;
  onStep: (delta: number) => void;
  onToggleGlobal: () => void;
  onResize: (e: React.PointerEvent) => void;
}) {
  const { state, instance, stats, col } = props;

  if (state.collapsed) {
    return (
      <Tooltip title={`${instance.label} — click to expand`}>
        <Stack
          onClick={() => props.onPatch({ collapsed: false })}
          sx={{
            width: COLLAPSED_W,
            flexShrink: 0,
            borderRight: `var(--axf-border) solid ${token("edge")}`,
            background: token("panel"),
            cursor: "pointer",
            alignItems: "center",
            gap: 1,
            pt: 1.2
          }}
        >
          <Glyph id="icon-layers" size={15} />
          {/* The toolbar folds into the rail: identity and change count survive
              the collapse, which is what makes a collapsed column still useful. */}
          <Typography
            sx={{
              ...MONO,
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              color: instance.live ? token("accent") : token("dim"),
              whiteSpace: "nowrap",
              letterSpacing: "0.06em"
            }}
          >
            {instance.label}
          </Typography>
          <Typography sx={{ ...MONO, writingMode: "vertical-rl", color: token("ok"), fontSize: 10 }}>
            +{stats.added}
          </Typography>
          {state.changesOnly && (
            <Typography
              sx={{ ...MONO, writingMode: "vertical-rl", color: token("accent"), fontSize: 9 }}
            >
              filtered
            </Typography>
          )}
        </Stack>
      </Tooltip>
    );
  }

  const visible = props.rows.filter((r) => {
    if (props.changed && !props.changed.has(r.key)) return false;
    if (!props.showUnchanged) {
      const c = r.cells[col];
      if (c && c.vsPrev === "same" && col > 0) return false;
    }
    return true;
  });

  return (
    <Box
      onMouseDown={props.onFocus}
      sx={{
        width: state.width,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: `var(--axf-border) solid ${token("edge")}`,
        background: instance.live ? token("panel") : token("page"),
        position: "relative",
        minWidth: 0
      }}
    >
      {/* ------------------------------------------------ column toolbar */}
      <Box
        sx={{
          px: 1,
          py: 0.8,
          borderBottom: `var(--axf-border) solid ${token("edge")}`,
          background: token("panel2"),
          display: "grid",
          gap: 0.8
        }}
      >
        <Stack direction="row" spacing={0.8} sx={{ alignItems: "center" }}>
          <IconBtn
            icon="icon-collapse"
            label="Fold this revision down to a narrow strip — its label and change count stay visible"
            onClick={() => props.onPatch({ collapsed: true })}
          />
          <Typography
            title={instance.id}
            sx={{
              ...MONO,
              color: instance.live ? token("accent") : token("ink"),
              fontWeight: instance.live ? 700 : 400,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {instance.label}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ ...MONO, color: token("ok"), fontSize: 10 }}>+{stats.added}</Typography>
          <Typography sx={{ ...MONO, color: token("err"), fontSize: 10 }}>
            −{stats.removed}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
          <IconBtn
            icon="icon-filter"
            label="Show only the lines this revision added — everything carried over is hidden"
            active={state.changesOnly}
            onClick={() => props.onPatch({ changesOnly: !state.changesOnly })}
          />
          {/* Revealed by the first filter, because the question it answers does
              not exist until you are looking at changes. */}
          {state.changesOnly && (
            <IconBtn
              icon="icon-compare"
              label={
                state.base === "prev"
                  ? "Comparing against the previous revision — click for all earlier"
                  : "Comparing against ALL earlier revisions — click for previous only"
              }
              active={state.base === "all"}
              tone="warn"
              onClick={() => props.onPatch({ base: state.base === "prev" ? "all" : "prev" })}
            />
          )}
          {state.changesOnly && (
            <Typography sx={{ ...MONO, fontSize: 9.5, color: token("dim") }}>
              {state.base === "prev" ? "vs prev" : `vs all · +${stats.addedVsAll}`}
            </Typography>
          )}
        </Stack>

        {/* ------------------------------------------------------ find */}
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <TextField
            size="small"
            hiddenLabel
            value={props.query}
            disabled={props.disabledField}
            placeholder={props.disabledField ? "— global find —" : "find in this column"}
            onChange={(e) => props.onPatch({ query: e.target.value })}
            onFocus={props.onFocus}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                props.onStep(e.shiftKey ? -1 : 1);
              }
            }}
            sx={{ flex: 1, minWidth: 0 }}
            slotProps={{ htmlInput: { sx: { ...MONO, py: 0.35 } } }}
          />
          <Typography
            sx={{ ...MONO, fontSize: 9.5, color: token("dim"), minWidth: 40, textAlign: "right" }}
          >
            {props.hits.length
              ? `${Math.min(state.hitIndex + 1, props.hits.length)}/${props.hits.length}`
              : props.query
                ? "0/0"
                : ""}
          </Typography>
          <IconBtn
            icon="icon-chevron-up"
            label="Jump to the previous match in this column (Shift+F3, wraps to the end)"
            disabled={!props.hits.length}
            onClick={() => props.onStep(-1)}
          />
          <IconBtn
            icon="icon-chevron-down"
            label="Jump to the next match in this column (F3, wraps to the start)"
            disabled={!props.hits.length}
            onClick={() => props.onStep(1)}
          />
          <IconBtn
            icon="icon-globe"
            label={
              props.globalOn
                ? "Global find is on — click to return to per-column"
                : "Search every column with this query"
            }
            active={props.globalOn && !props.disabledField}
            tone="warn"
            onClick={props.onToggleGlobal}
          />
        </Stack>
      </Box>

      {/* --------------------------------------------------------- body */}
      <Box ref={props.bodyRef} onScroll={props.onScroll} sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {visible.length === 0 ? (
          <Typography sx={{ ...MONO, color: token("dim"), p: 1.5 }}>
            {state.changesOnly ? "no changes in this revision" : "empty"}
          </Typography>
        ) : (
          visible.map((row) => (
            <Line
              key={row.key}
              row={row}
              col={col}
              base={state.base}
              query={props.query}
              activeHit={props.activeHit}
              wrap={props.wrap}
            />
          ))
        )}
      </Box>

      {/* resize handle — geometry, not chrome: it paints nothing at all. */}
      {!props.isLast && (
        <Box
          onPointerDown={props.onResize}
          title="Drag to resize"
          sx={{
            position: "absolute",
            top: 0,
            right: -3,
            width: 6,
            height: "100%",
            cursor: "col-resize",
            zIndex: 2
          }}
        />
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ line */

function Line({
  row,
  col,
  base,
  query,
  activeHit,
  wrap
}: {
  row: Row;
  col: number;
  base: "prev" | "all";
  query: string;
  activeHit: Hit | undefined;
  wrap: boolean;
}) {
  const cell = row.cells[col];
  if (!cell) return null;
  const status = base === "prev" ? cell.vsPrev : cell.vsAll;

  const bg =
    status === "added"
      ? "color-mix(in srgb, var(--axf-ok) 14%, transparent)"
      : status === "empty"
        ? "color-mix(in srgb, var(--axf-edge) 22%, transparent)"
        : "transparent";

  const isActiveRow = activeHit?.rowKey === row.key && activeHit.col === col;

  return (
    <Box
      data-rowkey={row.key}
      sx={{
        display: "flex",
        gap: 1,
        minHeight: ROW_H,
        background: isActiveRow ? "color-mix(in srgb, var(--axf-accent) 22%, transparent)" : bg,
        borderLeft: `2px solid ${status === "added" ? token("ok") : "transparent"}`
      }}
    >
      <Typography
        component="span"
        sx={{
          ...MONO,
          fontSize: 9.5,
          color: token("dim"),
          minWidth: 34,
          textAlign: "right",
          userSelect: "none",
          pt: "1px"
        }}
      >
        {cell.lineNo ?? ""}
      </Typography>
      <Typography
        component="span"
        sx={{
          ...MONO,
          flex: 1,
          minWidth: 0,
          whiteSpace: wrap ? "pre-wrap" : "pre",
          overflow: wrap ? "visible" : "hidden",
          wordBreak: wrap ? "break-word" : "normal",
          color: status === "empty" ? token("dim") : token("ink"),
          pr: 0.8
        }}
      >
        {query ? <Highlight text={cell.text} query={query} /> : cell.text || " "}
      </Typography>
    </Box>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (!needle) return <>{text || " "}</>;
  const hay = text.toLowerCase();
  const out: React.ReactNode[] = [];
  let from = 0;
  let n = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    if (at > from) out.push(text.slice(from, at));
    out.push(
      <Box
        component="mark"
        key={n++}
        sx={{ background: token("warn"), color: token("page"), borderRadius: "2px" }}
      >
        {text.slice(at, at + needle.length)}
      </Box>
    );
    from = at + needle.length;
  }
  out.push(text.slice(from));
  return <>{out}</>;
}
