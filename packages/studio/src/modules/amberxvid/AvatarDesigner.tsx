"use client";

/**
 * @file The avatar designer (P6) — every dial of `AVATAR_AXES`, in React,
 * over the shared deterministic renderer.
 *
 * The surface is generated FROM the contract: it iterates `AVATAR_AXES`
 * (verbatim from the captured build plan) and renders each axis by kind —
 * swatch axes as color-dot rows fed by the engine's palettes, catalog axes as
 * option pickers fed by the engine's catalogs, slider axes (height, build)
 * as real sliders on the contract's ranges. Add an axis to the engine and the
 * designer grows it with no edit here.
 *
 * The live preview IS the shared renderer (`AvatarView`), so what the member
 * approves is byte-identical to what the profile, buddy list, chat and admin
 * surfaces will draw. Randomize rolls `randomAvatar()`; nothing saves until
 * the member commits — the parent owns the POST.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Casino as RandomizeIcon } from "./kit/icons";
import { RestartAlt as ResetIcon } from "./kit/icons";
import { ChevronLeft as PrevIcon } from "./kit/icons";
import { ChevronRight as NextIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip } from "./kit/ax";
import { GizmoXMark } from "./gizmox-kit";
import { AVATAR_AXES } from "./lib/contract";
import {
  DEFAULT_AVATAR,
  axisCatalog,
  axisSwatches,
  normalizeAvatar,
  randomAvatar
} from "./lib/avatar";
import type { AvatarSpec } from "./lib/types";
import AvatarView from "./Avatar";
import { useAnimationIntensity } from "./Splash";

export interface AvatarDesignerProps {
  open: boolean;
  /** The member's current spec (null = designing from the default). */
  initial: AvatarSpec | null;
  onClose: () => void;
  /** Commit the design — resolve true on success (the dialog closes itself). */
  onSave: (spec: AvatarSpec) => Promise<boolean>;
}

type AxisId = Exclude<keyof AvatarSpec, "version">;

export default function AvatarDesigner({ open, initial, onClose, onSave }: AvatarDesignerProps) {
  const intensity = useAnimationIntensity();
  const [spec, setSpec] = React.useState<AvatarSpec>(DEFAULT_AVATAR);
  const [saving, setSaving] = React.useState(false);

  // Re-seed from the member's current avatar every time the dialog opens.
  React.useEffect(() => {
    if (open) setSpec(initial ? normalizeAvatar(initial) : DEFAULT_AVATAR);
  }, [open, initial]);

  const set = React.useCallback((id: AxisId, value: number) => {
    setSpec((s) => normalizeAvatar({ ...s, [id]: value }));
  }, []);

  const save = React.useCallback(async () => {
    setSaving(true);
    try {
      if (await onSave(spec)) onClose();
    } finally {
      setSaving(false);
    }
  }, [onSave, onClose, spec]);

  const animate = intensity !== "off";

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5, maxHeight: "82vh" }}>
        {/* header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
          <GizmoXMark size={20} glow={false} ring="transparent" />
          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Avatar designer</Typography>
          <GxChip label={`${AVATAR_AXES.length} axes`} kind="dim" />
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Roll a completely random look">
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<RandomizeIcon />}
                onClick={() => setSpec(randomAvatar())}
                data-el-id="amberxvid:avatar:randomize"
                disabled={saving}
              >
                Randomize
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Back to the stock look">
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ResetIcon />}
                onClick={() => setSpec(DEFAULT_AVATAR)}
                disabled={saving}
              >
                Reset
              </Button>
            </span>
          </Tooltip>
        </Box>

        <Box sx={{ display: "flex", gap: 2, minHeight: 0, flex: 1 }}>
          {/* live preview — the shared renderer, so approved = shipped */}
          <Box
            sx={{
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
              width: 236
            }}
          >
            <Box
              sx={{
                borderRadius: 2,
                overflow: "hidden",
                border: `1px solid ${GX.edge}`,
                transition: animate ? "box-shadow 200ms" : "none",
                boxShadow: animate ? `0 0 24px ${gxa(GX.accent, "22")}` : "none"
              }}
            >
              <AvatarView spec={spec} name="preview" size={220} round={false} />
            </Box>
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", justifyContent: "center" }}>
              <GxChip label={`${spec.height} cm`} kind="dim" />
              <GxChip label={`build ${spec.build}/10`} kind="dim" />
              <GxChip label={axisCatalog("hairStyle")[spec.hairStyle]} kind="dim" />
            </Box>
            <Typography sx={{ fontSize: 10.5, color: GX.dim, textAlign: "center" }}>
              One deterministic renderer — this exact look follows you into the member list, chat
              and your profile.
            </Typography>
          </Box>

          {/* the axes, generated from the contract */}
          <Box sx={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1.25, pr: 0.5 }}>
            {AVATAR_AXES.map((axis) => {
              const id = axis.id as AxisId;
              const value = spec[id];
              return (
                <Box key={axis.id} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  <Typography
                    sx={{
                      fontFamily: GX.mono,
                      fontSize: 10,
                      letterSpacing: 1.2,
                      textTransform: "uppercase",
                      color: GX.dim
                    }}
                  >
                    {axis.label}
                  </Typography>

                  {axis.kind === "swatch" && (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                      {axisSwatches(axis.id).map((color, i) => (
                        <Box
                          key={color + i}
                          onClick={() => set(id, i)}
                          data-el-id={`amberxvid:avatar:${axis.id}:${i}`}
                          sx={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            bgcolor: color,
                            cursor: "pointer",
                            border: value === i ? `2px solid ${GX.accent}` : `2px solid ${GX.edge}`,
                            transition: animate ? "transform 100ms, border-color 100ms" : "none",
                            "&:hover": animate ? { transform: "scale(1.18)" } : { borderColor: GX.accent }
                          }}
                        />
                      ))}
                    </Box>
                  )}

                  {axis.kind === "catalog" && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <IconButton
                        size="small"
                        aria-label={`previous ${axis.label.toLowerCase()}`}
                        onClick={() => {
                          const n = axisCatalog(axis.id).length;
                          set(id, (value - 1 + n) % n);
                        }}
                      >
                        <PrevIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <Select
                        size="small"
                        value={value}
                        onChange={(e) => set(id, Number(e.target.value))}
                        sx={{ flex: 1, fontSize: 12.5 }}
                        data-el-id={`amberxvid:avatar:${axis.id}`}
                        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 320 } } } }}
                      >
                        {axisCatalog(axis.id).map((label, i) => (
                          <MenuItem key={label} value={i} sx={{ fontSize: 12.5 }}>
                            {label}
                          </MenuItem>
                        ))}
                      </Select>
                      <IconButton
                        size="small"
                        aria-label={`next ${axis.label.toLowerCase()}`}
                        onClick={() => set(id, (value + 1) % axisCatalog(axis.id).length)}
                      >
                        <NextIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>
                  )}

                  {axis.kind === "slider" && "range" in axis && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 1 }}>
                      <Slider
                        size="small"
                        min={axis.range[0]}
                        max={axis.range[1]}
                        value={value}
                        onChange={(_, v) => set(id, v as number)}
                        data-el-id={`amberxvid:avatar:${axis.id}`}
                        sx={{ flex: 1 }}
                      />
                      <Typography sx={{ fontFamily: GX.mono, fontSize: 11.5, width: 56, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {value}
                        {"unit" in axis && axis.unit ? ` ${axis.unit}` : ""}
                      </Typography>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* commit row */}
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", flexShrink: 0 }}>
          <Button size="small" variant="outlined" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={() => void save()}
            disabled={saving}
            data-el-id="amberxvid:avatar:save"
          >
            {saving ? "Saving…" : "Save avatar"}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
