"use client";

/**
 * @file The AmberX Vid dockable quick-action toolbar — the branded bar the
 * whole suite hangs off. Contract: `TOOLBAR_PLACEMENT` + `TOOLBAR_QUICK_ACTIONS`
 * (`./lib/contract`, verbatim from the build capture).
 *
 * Placement is entirely settings-set (`amberxvid.toolbar.*`): docks
 * top/left/right/bottom, autohide with an 8 px reveal edge and a 1200 ms hide
 * delay, four icon sizes, icons-only or icons+text. The module places the bar
 * in its flow for the static docks; with autohide on, the bar absolutely
 * positions itself against the module root and slides off its edge.
 *
 * PORT NOTE (GizmoX → AmberX, per the 2026-08-13 port record in PLANNING-STATE.md): the `toolbar.*` values are
 * unpromoted constants here — the dock context menu's persistence writes are
 * no-ops, and the menu itself never opens while `useCtx()` is the accepted
 * no-op. The bar still docks/labels/sizes off whatever the constants say.
 *
 * Quick actions, every one ending in visible behaviour:
 *   - record / mic — real session state owned by the module (props), shown
 *     live here and in the channel-status strip;
 *   - quality / resolution — cycle the contract values and PERSIST through
 *     `setSettingValue` (promoted decl rows), so the shell's settings dialog
 *     shows the same truth;
 *   - background — flips the `background.armed` setting (the tray hand-off);
 *   - mailbox — popover listing unread mail by buddy (live from the messenger
 *     engine), the unread badge + alert pulse, rows open straight to the chat;
 *   - messenger / admin — launchers owned by the module; the admin button
 *     renders ONLY for the administrator role.
 *
 * Icons are branding-package glyphs (`./kit/icons`, `--gxb-*` roles); every
 * animation scales with the module intensity knob and `prefers-reduced-motion`
 * always wins (`useAnimationIntensity`).
 */

import * as React from "react";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { FiberManualRecord as RecordIcon } from "./kit/icons";
import { Stop as StopIcon } from "./kit/icons";
import { RecordVoiceOver as MicOnIcon } from "./kit/icons";
import { VolumeOff as MicOffIcon } from "./kit/icons";
import { Tune as QualityIcon } from "./kit/icons";
import { FitScreen as ResolutionIcon } from "./kit/icons";
import { FlipToBack as BackgroundIcon } from "./kit/icons";
import { Notifications as MailboxIcon } from "./kit/icons";
import { ForumRounded as MessengerIcon } from "./kit/icons";
import { Sensors as StreamIcon } from "./kit/icons";
import { Link as InviteIcon } from "./kit/icons";
import { Security as AdminIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { useCtx, type CtxItem } from "./kit/ax";
import { useToast } from "./kit/Toast";
import { TOOLBAR_PLACEMENT, TOOLBAR_QUICK_ACTIONS } from "./lib/contract";
import type { AccountMe } from "./lib/types";
import {
  AMBERXVID_ASSET_ID,
  bool,
  setSettingValue,
  str,
  useEffectiveValues
} from "./settings";
// PORT NOTE: `GizmoXMark` is the shim in `./Splash` (GizmoX's logo kit did not
// port; the branding pack's `mark` glyph stands in).
import { GizmoXMark, useAnimationIntensity } from "./Splash";

export type ToolbarPosition = (typeof TOOLBAR_PLACEMENT.positions)[number];

/** The values a `cycle` quick action steps through, straight off the contract. */
function cycleValues(id: "quality" | "resolution"): readonly string[] {
  for (const qa of TOOLBAR_QUICK_ACTIONS) {
    if (qa.id === id && "values" in qa) return qa.values;
  }
  return [];
}

/**
 * One mailbox popover row — a CONVERSATION with unread mail.
 *
 * It was keyed by buddy until P6 (2026-08-15). A conversation can now be a
 * group, which has no buddy to be keyed by, so the row carries the thread id
 * and a label the messenger already knows how to compute.
 */
export interface MailboxEntry {
  /** The accounts thread id — a DM's pair id, or a group's `g-…`. */
  threadId: string;
  /** Who or what it is: a screenname, or the group's name. */
  screenname: string;
  unread: number;
  preview: string;
}

export interface ToolbarProps {
  me: AccountMe;
  /** Live session mic state (the module owns it; `recorder.micDefault` seeds it). */
  micOn: boolean;
  onMicToggle: () => void;
  /** Capture armed/disarmed — the record toggle's session state. */
  armed: boolean;
  onRecordToggle: () => void;
  /** Real unread mail count, live from the messenger engine. */
  unread: number;
  /** Unread mail grouped by conversation — the popover's rows. */
  mailbox: MailboxEntry[];
  /** Open the messenger straight to that conversation (a mailbox row click). */
  onOpenMail: (threadId: string) => void;
  onMessenger: () => void;
  /** Open the invitations dialog (P7) — compose, hand over, revoke. */
  onInvite: () => void;
  onAdmin: () => void;
  /** P14: true while I am HOSTING a room — the button pulses "on air". */
  streaming: boolean;
  /** Go live, or re-open my room when already hosting (the module decides). */
  onStream: () => void;
}

/** The toolbar's current placement, shared with the module so it can slot the bar. */
export function useToolbarPlacement(): {
  position: ToolbarPosition;
  autohide: boolean;
  iconSize: number;
  showLabels: boolean;
} {
  const values = useEffectiveValues(AMBERXVID_ASSET_ID);
  const raw = str(values, "toolbar.position", "top");
  const position: ToolbarPosition = (TOOLBAR_PLACEMENT.positions as readonly string[]).includes(raw)
    ? (raw as ToolbarPosition)
    : "top";
  return {
    position,
    autohide: bool(values, "toolbar.autohide", TOOLBAR_PLACEMENT.autohide.default),
    iconSize: Number.parseInt(str(values, "toolbar.iconSize", "26"), 10) || 26,
    showLabels: str(values, "toolbar.labels", "icons-only") === "icons+text"
  };
}

export default function AmberXVidToolbar({
  me,
  micOn,
  onMicToggle,
  armed,
  onRecordToggle,
  unread,
  mailbox,
  onOpenMail,
  onMessenger,
  onInvite,
  onAdmin,
  streaming,
  onStream
}: ToolbarProps) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const { openCtx, ctxMenu } = useCtx();
  const values = useEffectiveValues(AMBERXVID_ASSET_ID);
  const { position, autohide, iconSize, showLabels } = useToolbarPlacement();

  const quality = str(values, "recorder.quality", "high");
  const resolution = str(values, "recorder.resolution", "1280x720");
  const backgroundArmed = bool(values, "background.armed", false);
  const vertical = position === "left" || position === "right";

  /* ------------------------------ autohide ------------------------------- */

  const [revealed, setRevealed] = React.useState(false);
  const hideTimer = React.useRef<number | null>(null);
  const cancelHide = React.useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);
  const scheduleHide = React.useCallback(() => {
    cancelHide();
    hideTimer.current = window.setTimeout(
      () => setRevealed(false),
      TOOLBAR_PLACEMENT.autohide.hideDelayMs
    );
  }, [cancelHide]);
  React.useEffect(() => cancelHide, [cancelHide]);

  /* --------------------------- mailbox + pulse --------------------------- */

  const [mailAnchor, setMailAnchor] = React.useState<HTMLElement | null>(null);
  // The alert pulse fires when the unread count RISES (new mail while you sit
  // here), and the badge itself glows for as long as anything is unread.
  const prevUnread = React.useRef(unread);
  const [alerting, setAlerting] = React.useState(false);
  React.useEffect(() => {
    const rose = unread > prevUnread.current;
    prevUnread.current = unread;
    if (rose && intensity !== "off") {
      setAlerting(true);
      const t = window.setTimeout(() => setAlerting(false), 4000);
      return () => window.clearTimeout(t);
    }
  }, [unread, intensity]);

  /* ------------------------------- actions ------------------------------- */

  const cycle = (settingId: string, id: "quality" | "resolution", current: string, label: string) => {
    const options = cycleValues(id);
    const next = options[(options.indexOf(current) + 1) % options.length] ?? options[0];
    setSettingValue(AMBERXVID_ASSET_ID, settingId, next);
    toast(`${label} → ${next}`);
  };

  const toggleBackground = () => {
    setSettingValue(AMBERXVID_ASSET_ID, "background.armed", !backgroundArmed);
    toast(
      backgroundArmed
        ? "Background mode off — the browser engine keeps the capture"
        : "Background mode armed — recording hands to the tray service"
    );
  };

  const dockItems: CtxItem[] = TOOLBAR_PLACEMENT.positions.map((p) => ({
    label: `${p === position ? "● " : ""}${p[0].toUpperCase()}${p.slice(1)}`,
    onClick: () => {
      setSettingValue(AMBERXVID_ASSET_ID, "toolbar.position", p);
      toast(`Toolbar docked ${p}`);
    }
  }));
  const sizeItems: CtxItem[] = TOOLBAR_PLACEMENT.iconSizes.map((s) => ({
    label: `${s === iconSize ? "● " : ""}${s} px`,
    onClick: () => {
      setSettingValue(AMBERXVID_ASSET_ID, "toolbar.iconSize", String(s));
      toast(`Toolbar icons → ${s} px`);
    }
  }));
  const barMenu: CtxItem[] = [
    { label: "Dock", sub: dockItems },
    { label: "Icon size", sub: sizeItems },
    {
      label: autohide ? "Autohide off" : "Autohide on",
      onClick: () => {
        setSettingValue(AMBERXVID_ASSET_ID, "toolbar.autohide", !autohide);
        toast(autohide ? "Toolbar pinned" : "Toolbar autohides — hover the edge to reveal");
      }
    },
    {
      label: showLabels ? "Icons only" : "Icons + text",
      onClick: () => {
        setSettingValue(AMBERXVID_ASSET_ID, "toolbar.labels", showLabels ? "icons-only" : "icons+text");
        toast(showLabels ? "Toolbar labels hidden" : "Toolbar labels shown");
      }
    }
  ];

  /* ------------------------------- buttons ------------------------------- */

  const dur = intensity === "off" ? 0 : intensity === "subtle" ? 120 : 200;

  const button = (opts: {
    id: string;
    tooltip: string;
    caption: string;
    icon: React.ReactNode;
    active?: boolean;
    activeColor?: string;
    onClick: (e: React.MouseEvent<HTMLElement>) => void;
  }) => (
    <Tooltip key={opts.id} title={opts.tooltip} placement={vertical ? "right" : "bottom"}>
      <Box
        component="button"
        data-el-id={`amberxvid:toolbar:${opts.id}`}
        onClick={opts.onClick}
        sx={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.25,
          px: 0.75,
          py: 0.5,
          borderRadius: 1,
          color: opts.active ? opts.activeColor ?? GX.accent : GX.dim,
          transition: dur ? `background-color ${dur}ms, color ${dur}ms, transform ${dur}ms` : "none",
          "&:hover": {
            color: opts.active ? opts.activeColor ?? GX.accent : GX.ink,
            bgcolor: gxa(GX.accent, "14"),
            transform: intensity === "maximum" ? "scale(1.08)" : undefined
          },
          "&:active": { transform: intensity === "off" ? undefined : "scale(0.94)" }
        }}
      >
        {opts.icon}
        {showLabels && (
          <Typography
            sx={{
              fontFamily: GX.mono,
              fontSize: 9,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              lineHeight: 1,
              whiteSpace: "nowrap"
            }}
          >
            {opts.caption}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );

  const iconSx = { fontSize: `${iconSize}px` } as const;

  const actionButtons = (
    <>
      {button({
        id: "record",
        tooltip: armed
          ? "Stop — end the capture and save it to the library"
          : backgroundArmed
            ? "Record — background mode is armed, the tray service takes the capture"
            : "Record — start the browser webcam capture",
        caption: armed ? "stop" : "rec",
        active: armed,
        activeColor: GX.err,
        icon: armed ? (
          <StopIcon
            sx={{
              ...iconSx,
              ...(intensity !== "off" && {
                "@keyframes gxvArmGlow": {
                  "0%, 100%": { opacity: 1 },
                  "50%": { opacity: 0.55 }
                },
                animation: `gxvArmGlow ${intensity === "maximum" ? 0.8 : 1.4}s ease-in-out infinite`
              })
            }}
          />
        ) : (
          <RecordIcon sx={iconSx} />
        ),
        onClick: onRecordToggle
      })}
      {button({
        id: "mic",
        tooltip: micOn ? "Mic is live — click to mute" : "Mic is muted — click to unmute",
        caption: micOn ? "mic on" : "muted",
        active: micOn,
        icon: micOn ? <MicOnIcon sx={iconSx} /> : <MicOffIcon sx={iconSx} />,
        onClick: onMicToggle
      })}
      {button({
        id: "quality",
        tooltip: `Quality · ${quality} — click to cycle`,
        caption: quality,
        icon: <QualityIcon sx={iconSx} />,
        onClick: () => cycle("recorder.quality", "quality", quality, "Quality")
      })}
      {button({
        id: "resolution",
        tooltip: `Resolution · ${resolution} — click to cycle`,
        caption: resolution,
        icon: <ResolutionIcon sx={iconSx} />,
        onClick: () => cycle("recorder.resolution", "resolution", resolution, "Resolution")
      })}
      {button({
        id: "background",
        tooltip: backgroundArmed
          ? "Background mode armed — the tray service takes the capture"
          : "Background mode off — recording stays in the browser",
        caption: backgroundArmed ? "bg on" : "bg off",
        active: backgroundArmed,
        activeColor: GX.warn,
        icon: <BackgroundIcon sx={iconSx} />,
        onClick: toggleBackground
      })}

      <Divider
        orientation={vertical ? "horizontal" : "vertical"}
        flexItem
        sx={{ borderColor: GX.edge, my: vertical ? 0.5 : 0, mx: vertical ? 0 : 0.5 }}
      />

      {button({
        id: "mailbox",
        tooltip: unread > 0 ? `Mailbox · ${unread} unread` : "Mailbox — no unread mail",
        caption: "mail",
        active: unread > 0,
        icon: (
          <Badge
            badgeContent={unread}
            color="error"
            overlap="circular"
            sx={{
              "& .MuiBadge-badge": { fontSize: 9, height: 14, minWidth: 14 },
              ...(alerting &&
                intensity !== "off" && {
                  "@keyframes gxvMailPulse": {
                    "0%": { boxShadow: `0 0 0 0 ${gxa(GX.accent, "66")}` },
                    "70%": { boxShadow: `0 0 0 ${intensity === "maximum" ? 14 : 8}px transparent` },
                    "100%": { boxShadow: "0 0 0 0 transparent" }
                  },
                  borderRadius: "50%",
                  animation: "gxvMailPulse 1.2s ease-out infinite"
                })
            }}
          >
            <MailboxIcon sx={iconSx} />
          </Badge>
        ),
        onClick: (e) => {
          const target = e.currentTarget;
          setMailAnchor((a) => (a ? null : target));
        }
      })}
      {button({
        id: "stream",
        tooltip: streaming
          ? "You are ON AIR — open your stream room"
          : "Go live — broadcast to every member, with a room chat",
        caption: streaming ? "on air" : "stream",
        active: streaming,
        activeColor: GX.err,
        icon: (
          <StreamIcon
            sx={{
              ...iconSx,
              // On air pulses, so the state is readable without the caption
              // (icon-only is a valid label mode) — and respects the intensity.
              ...(streaming &&
                intensity !== "off" && {
                  "@keyframes gxvOnAir": {
                    "0%, 100%": { opacity: 1 },
                    "50%": { opacity: 0.5 }
                  },
                  animation: `gxvOnAir ${intensity === "maximum" ? 0.9 : 1.6}s ease-in-out infinite`
                })
            }}
          />
        ),
        onClick: onStream
      })}
      {button({
        id: "messenger",
        tooltip: "Messenger — buddy list, presence and chat",
        caption: "chat",
        icon: <MessengerIcon sx={iconSx} />,
        onClick: onMessenger
      })}
      {button({
        id: "invite",
        tooltip: "Invite somebody — a single-use link straight into a room",
        caption: "invite",
        icon: <InviteIcon sx={iconSx} />,
        onClick: onInvite
      })}
      {me.role === "administrator" &&
        button({
          id: "admin",
          tooltip: "Admin control window (administrator only)",
          caption: "admin",
          active: true,
          activeColor: GX.warn,
          icon: <AdminIcon sx={iconSx} />,
          onClick: onAdmin
        })}
    </>
  );

  /* --------------------------------- bar --------------------------------- */

  const bar = (
    <Box
      data-el-id="amberxvid:toolbar"
      onContextMenu={(e) => openCtx(e, "AmberX Vid · Toolbar", barMenu)}
      onPointerEnter={autohide ? cancelHide : undefined}
      onPointerLeave={autohide ? scheduleHide : undefined}
      sx={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        alignItems: "center",
        gap: 0.25,
        p: 0.5,
        bgcolor: GX.panel,
        border: `1px solid ${GX.edge}`,
        borderRadius: 1.5,
        boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
        width: "fit-content",
        maxWidth: "100%",
        maxHeight: "100%",
        overflow: "auto"
      }}
    >
      {/* P14 — the house mark used to head this bar, and it is gone.
          `no-hand-rolled-ui.md` rule 3 says it in the toolbar kind's own terms:
          a `banner` carries the brand and a `pane-toolbar` must NOT, because
          "repeating the brand inside a pane is how an app ends up with three
          logos on one screen". That is exactly what was on screen once the
          suite banner started drawing the real `lockup` asset — the lockup, this
          mark and the stage watermark, all the same drawing, within 60px of
          each other. The bar is a pane toolbar; the banner above it is the
          banner. */}
      {actionButtons}
    </Box>
  );

  /* Static dock: the module slots the bar into its flow. Autohide: the bar
     pins itself to the module root's edge and slides away; an 8 px strip on
     that edge reveals it (TOOLBAR_PLACEMENT.autohide). */
  const edgeSx: Record<ToolbarPosition, object> = {
    top: { top: 6, left: 0, right: 0, justifyContent: "center" },
    bottom: { bottom: 6, left: 0, right: 0, justifyContent: "center" },
    left: { left: 6, top: 0, bottom: 0, alignItems: "center", flexDirection: "column" },
    right: { right: 6, top: 0, bottom: 0, alignItems: "center", flexDirection: "column" }
  };
  const hiddenTransform: Record<ToolbarPosition, string> = {
    top: "translateY(calc(-100% - 12px))",
    bottom: "translateY(calc(100% + 12px))",
    left: "translateX(calc(-100% - 12px))",
    right: "translateX(calc(100% + 12px))"
  };
  const stripSx: Record<ToolbarPosition, object> = {
    top: { top: 0, left: 0, right: 0, height: TOOLBAR_PLACEMENT.autohide.revealPx },
    bottom: { bottom: 0, left: 0, right: 0, height: TOOLBAR_PLACEMENT.autohide.revealPx },
    left: { left: 0, top: 0, bottom: 0, width: TOOLBAR_PLACEMENT.autohide.revealPx },
    right: { right: 0, top: 0, bottom: 0, width: TOOLBAR_PLACEMENT.autohide.revealPx }
  };

  return (
    <>
      {autohide ? (
        <>
          <Box
            onPointerEnter={() => {
              cancelHide();
              setRevealed(true);
            }}
            sx={{ position: "absolute", zIndex: 29, ...stripSx[position] }}
          />
          <Box
            sx={{
              position: "absolute",
              zIndex: 30,
              display: "flex",
              pointerEvents: revealed ? "auto" : "none",
              ...edgeSx[position]
            }}
          >
            <Box
              sx={{
                transition: dur ? `transform ${dur}ms ease` : "none",
                transform: revealed ? "none" : hiddenTransform[position]
              }}
            >
              {bar}
            </Box>
          </Box>
        </>
      ) : (
        bar
      )}

      <Popover
        open={Boolean(mailAnchor)}
        anchorEl={mailAnchor}
        onClose={() => setMailAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Box sx={{ p: 1.5, width: 300, display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <GizmoXMark size={22} glow={false} ring="transparent" />
            <Typography sx={{ fontFamily: GX.mono, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: GX.accent }}>
              Mailbox
            </Typography>
            <Box sx={{ flex: 1 }} />
            {unread > 0 && (
              <Typography sx={{ fontSize: 10.5, color: GX.dim }}>{unread} unread</Typography>
            )}
          </Box>
          {mailbox.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: GX.dim, textAlign: "center", py: 1 }}>
              No mail — you&apos;re all caught up. Messages sent while you were away land here at
              login.
            </Typography>
          ) : (
            mailbox.map((entry) => (
              <Box
                key={entry.threadId}
                component="button"
                data-el-id={`amberxvid:toolbar:mail:${entry.threadId}`}
                onClick={() => {
                  setMailAnchor(null);
                  onOpenMail(entry.threadId);
                }}
                sx={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  p: 0.75,
                  borderRadius: 1,
                  "&:hover": { bgcolor: gxa(GX.accent, "14") }
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>
                    {entry.screenname}
                  </Typography>
                  <Typography
                    sx={{ fontSize: 10.5, color: GX.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {entry.preview || "…"}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    minWidth: 18,
                    height: 18,
                    px: 0.5,
                    borderRadius: 9,
                    display: "grid",
                    placeItems: "center",
                    bgcolor: GX.err,
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    flexShrink: 0
                  }}
                >
                  {entry.unread}
                </Box>
              </Box>
            ))
          )}
        </Box>
      </Popover>

      {ctxMenu}
    </>
  );
}
