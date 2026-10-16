/**
 * @file The AI portrait builder — pick from example chips, hit Generate, watch
 * the studio work.
 *
 * Left: the axis list (23 axes, ~160 options) where every option shows a
 * rendered EXAMPLE of itself rather than a word — swatches for colours, tiny
 * line-art exemplars for shapes and styles, so you choose by looking. Jewelry
 * is multi-select; height and weight are sliders.
 *
 * Right: the result panel. Before a generation it lists the current selection
 * as plain sentences; during one it shows the **progress meter**, whose stage
 * script is built from THOSE SELECTIONS (`buildStages`) — so the narration is
 *真 to what was asked for ("Tinting ginger red", "Fitting cat-eye", "Hanging
 * hoop earrings + choker") rather than a generic spinner. The meter paces
 * itself to ~92% and then waits: the last stretch belongs to the real answer,
 * because a bar that hits 100% before the work is done is a lie.
 *
 * Generation is one POST to `/api/amberxvid/portrait`, which spawns Claude on
 * the subscription, sanitizes the SVG and saves it as the caller's avatar.
 * This dialog never writes the profile itself — same contract as
 * `AvatarDesigner`, whose 16-axis cartoon designer this sits BESIDE, not
 * replaces.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import LinearProgress from "@mui/material/LinearProgress";
import Slider from "@mui/material/Slider";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Close as CloseIcon } from "./kit/icons";
import { AutoAwesome as SparkleIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip, useToast } from "./kit/ax";
import { GizmoXMark, GizmoXMarkAnimated } from "./gizmox-kit";
import {
  PORTRAIT_AXES,
  PORTRAIT_OPTION_COUNT,
  buildStages,
  defaultSelections,
  describeSelections,
  exampleSvg,
  normalizeSelections,
  type PortraitAxis,
  type PortraitOption,
  type PortraitSelections,
} from "./lib/portrait-options";
import type { PortraitAvatar } from "./lib/types";

/** One example chip — the rendered exemplar plus its label. */
function OptionChip({
  axis,
  option,
  selected,
  onPick,
}: {
  axis: PortraitAxis;
  option: PortraitOption;
  selected: boolean;
  onPick: () => void;
}) {
  const svg = React.useMemo(() => exampleSvg(axis, option), [axis, option]);
  return (
    <Tooltip title={option.label} placement="top">
      <Box
        onClick={onPick}
        data-el-id={`amberxvid:portrait:${axis.id}:${option.id}`}
        sx={{
          width: 60,
          cursor: "pointer",
          borderRadius: 1,
          p: 0.4,
          border: `2px solid ${selected ? GX.accent : "transparent"}`,
          bgcolor: selected ? gxa(GX.accent, "18") : GX.panel2,
          transition: "border-color .12s, background-color .12s",
          "&:hover": { borderColor: selected ? GX.accent : gxa(GX.accent, "66") },
        }}
      >
        <Box
          sx={{ width: "100%", aspectRatio: "1", borderRadius: 0.5, overflow: "hidden", bgcolor: GX.page }}
          // Exemplars come from our own pure `exampleSvg` — a fixed table of
          // hand-written paths, no user or model input reaches it.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <Typography
          sx={{
            fontSize: 8.5,
            textAlign: "center",
            color: selected ? GX.accent : GX.dim,
            fontWeight: selected ? 700 : 500,
            lineHeight: 1.25,
            pt: 0.3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {option.label}
        </Typography>
      </Box>
    </Tooltip>
  );
}

export default function PortraitBuilder({
  open,
  initial,
  onClose,
  onGenerated,
}: {
  open: boolean;
  /** Re-opens pre-filled when the member already has an AI portrait. */
  initial: PortraitAvatar | null;
  onClose: () => void;
  /** Fired after a successful save so the profile surfaces refetch. */
  onGenerated: (avatar: PortraitAvatar) => void;
}) {
  const toast = useToast();
  const [sel, setSel] = React.useState<PortraitSelections>(() => defaultSelections());
  const [busy, setBusy] = React.useState(false);
  const [stageIx, setStageIx] = React.useState(0);
  const [pct, setPct] = React.useState(0);
  const [result, setResult] = React.useState<PortraitAvatar | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const timers = React.useRef<ReturnType<typeof setInterval>[]>([]);

  React.useEffect(() => {
    if (!open) return;
    setSel(initial ? normalizeSelections(initial.selections) : defaultSelections());
    setResult(initial);
    setError(null);
    setPct(0);
    setStageIx(0);
  }, [open, initial]);

  React.useEffect(
    () => () => {
      for (const t of timers.current) clearInterval(t);
    },
    [],
  );

  const stages = React.useMemo(() => buildStages(sel), [sel]);
  const summary = React.useMemo(() => describeSelections(sel), [sel]);

  const pick = (axis: PortraitAxis, id: string): void => {
    setSel((s) => {
      if (axis.multi) {
        const cur = Array.isArray(s[axis.id]) ? (s[axis.id] as string[]) : [];
        return { ...s, [axis.id]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
      }
      return { ...s, [axis.id]: id };
    });
  };

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    setStageIx(0);
    setPct(0);

    // The meter walks the stage script built from the real selections, easing
    // toward 92% — the last 8% is the actual answer landing, never faked.
    const perStage = Math.max(900, Math.min(2600, 42_000 / Math.max(1, stages.length)));
    const stageTimer = setInterval(() => setStageIx((i) => Math.min(stages.length - 1, i + 1)), perStage);
    const pctTimer = setInterval(() => setPct((p) => (p >= 92 ? 92 : p + Math.max(0.25, (92 - p) * 0.045))), 260);
    timers.current = [stageTimer, pctTimer];

    try {
      const res = await fetch("/api/amberxvid/portrait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: sel }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; avatar?: PortraitAvatar; error?: string; meta?: { elapsedMs?: number; bytes?: number } }
        | null;
      if (!res.ok || !json?.ok || !json.avatar) {
        throw new Error(json?.error ?? `the portrait service answered ${res.status}`);
      }
      setPct(100);
      setStageIx(stages.length - 1);
      setResult(json.avatar);
      onGenerated(json.avatar);
      toast(
        "Portrait ready",
        `${Math.round((json.meta?.elapsedMs ?? 0) / 1000)}s · ${Math.round((json.meta?.bytes ?? 0) / 1024)} KB — it is now your avatar`,
      );
    } catch (e) {
      setError((e as Error).message);
      setPct(0);
      toast("Portrait failed", (e as Error).message);
    } finally {
      for (const t of timers.current) clearInterval(t);
      timers.current = [];
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="lg" fullWidth>
      <Box sx={{ bgcolor: GX.page, display: "flex", flexDirection: "column", maxHeight: "88vh" }}>
        {/* header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.6, py: 1, borderBottom: `1px solid ${GX.edge}` }}>
          <GizmoXMark size={22} glow={false} />
          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>AI portrait studio</Typography>
          <GxChip label={`${PORTRAIT_AXES.length} axes · ${PORTRAIT_OPTION_COUNT} options`} kind="accent" />
          <GxChip label="drawn by Claude" kind="info" />
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={onClose} disabled={busy} startIcon={<CloseIcon />}>
            Close
          </Button>
        </Box>

        <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* the option catalog */}
          <Box sx={{ flex: 1, minWidth: 0, overflowY: "auto", p: 1.4, display: "flex", flexDirection: "column", gap: 1.6 }}>
            {PORTRAIT_AXES.map((axis) => (
              <Box key={axis.id}>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.8, pb: 0.5 }}>
                  <Typography sx={{ fontSize: 10.5, fontFamily: GX.mono, letterSpacing: 0.7, color: GX.dim, textTransform: "uppercase" }}>
                    {axis.label}
                  </Typography>
                  {axis.multi ? <GxChip label="pick any" kind="dim" /> : null}
                </Box>

                {axis.kind === "slider" && axis.range ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 0.5 }}>
                    <Slider
                      size="small"
                      min={axis.range.min}
                      max={axis.range.max}
                      step={axis.range.step}
                      value={Number(sel[axis.id] ?? axis.range.fallback)}
                      onChange={(_, v) => setSel((s) => ({ ...s, [axis.id]: v as number }))}
                      data-el-id={`amberxvid:portrait:${axis.id}`}
                      sx={{ flex: 1 }}
                    />
                    <Typography sx={{ fontSize: 12, fontFamily: GX.mono, minWidth: 54, textAlign: "right" }}>
                      {String(sel[axis.id] ?? axis.range.fallback)}
                      {axis.range.unit}
                    </Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6 }}>
                    {(axis.options ?? []).map((option) => {
                      const v = sel[axis.id];
                      const selected = axis.multi
                        ? Array.isArray(v) && v.includes(option.id)
                        : v === option.id;
                      return (
                        <OptionChip
                          key={option.id}
                          axis={axis}
                          option={option}
                          selected={selected}
                          onPick={() => pick(axis, option.id)}
                        />
                      );
                    })}
                  </Box>
                )}
              </Box>
            ))}
          </Box>

          {/* the result / progress column */}
          <Box
            sx={{
              width: 330,
              flexShrink: 0,
              borderLeft: `1px solid ${GX.edge}`,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <Box sx={{ p: 1.4, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
              <Box
                sx={{
                  width: 190,
                  height: 209,
                  borderRadius: 1.5,
                  border: `1px solid ${busy ? GX.accent : GX.edge}`,
                  bgcolor: GX.panel,
                  overflow: "hidden",
                  display: "grid",
                  placeItems: "center",
                  "& svg": { width: "100%", height: "100%", display: "block" },
                }}
                data-el-id="amberxvid:portrait:preview"
                {...(result && !busy
                  ? {
                      // Sanitized server-side by `sanitizePortraitSvg` before it
                      // was ever stored; this is the same string the avatar
                      // surfaces render.
                      dangerouslySetInnerHTML: { __html: result.svg },
                    }
                  : {})}
              >
                {busy ? (
                  <Box sx={{ textAlign: "center" }}>
                    <GizmoXMarkAnimated size={54} accent={GX.accent} />
                    <Typography sx={{ fontSize: 10, color: GX.dim, fontFamily: GX.mono, pt: 0.8 }}>
                      {Math.round(pct)}%
                    </Typography>
                  </Box>
                ) : result ? null : (
                  <Typography sx={{ fontSize: 11.5, color: GX.dim, textAlign: "center", px: 2 }}>
                    Pick your features, then generate.
                  </Typography>
                )}
              </Box>

              <LinearProgress
                variant="determinate"
                value={pct}
                sx={{
                  width: "100%",
                  height: 5,
                  borderRadius: 2,
                  bgcolor: GX.edge,
                  "& .MuiLinearProgress-bar": { bgcolor: GX.accent, transition: "transform .4s linear" },
                }}
              />

              <Typography
                sx={{ fontSize: 11.5, color: busy ? GX.accent : GX.dim, fontFamily: GX.mono, minHeight: 18, textAlign: "center" }}
                data-el-id="amberxvid:portrait:stage"
              >
                {busy ? `${stages[stageIx] ?? "Working"}…` : result ? "portrait saved as your avatar" : "idle"}
              </Typography>

              <Button
                fullWidth
                variant="contained"
                disabled={busy}
                onClick={() => void generate()}
                startIcon={<SparkleIcon />}
                data-el-id="amberxvid:portrait:generate"
              >
                {busy ? "Generating…" : result ? "Generate again" : "Generate portrait"}
              </Button>
              {error ? (
                <Typography sx={{ fontSize: 11, color: GX.err, textAlign: "center" }}>{error}</Typography>
              ) : null}
            </Box>

            {/* the selection read-back */}
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1.4, pb: 1.4 }}>
              <Typography sx={{ fontSize: 10, fontFamily: GX.mono, letterSpacing: 0.7, color: GX.dim, pb: 0.5 }}>
                YOUR SUBJECT
              </Typography>
              {summary.map((row) => (
                <Box key={row.axis} sx={{ display: "flex", gap: 1, py: 0.15 }}>
                  <Typography sx={{ fontSize: 10.5, color: GX.dim, minWidth: 92, flexShrink: 0 }}>{row.axis}</Typography>
                  <Typography sx={{ fontSize: 10.5, color: GX.ink }}>{row.value}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}
