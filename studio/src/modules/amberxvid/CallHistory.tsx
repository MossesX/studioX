"use client";

/**
 * @file **Calls** — the member's own call history, and the do-not-disturb
 * controls that decide whether the next one rings (P13 of
 * `axf-amberxvid-social`, 2026-08-15).
 *
 * ---------------------------------------------------------------------------
 * WHY THE HISTORY AND THE DND CONTROLS ARE ONE SCREEN
 * ---------------------------------------------------------------------------
 * They answer the same question from two sides. A member opens this screen for
 * one of exactly two reasons: "who rang me while I was away", and "stop ringing
 * me". Putting the switch anywhere else means the member who has just read
 * three missed calls has to go and find it — and, worse, means the screen that
 * shows the consequence of do-not-disturb ("missed — do not disturb") does not
 * show the cause.
 *
 * The quiet-hours window and the switch will ALSO be settings rows in P16. That
 * is not a duplicate: the sui is where you configure a module, and this is
 * where you act on the thing in front of you. Both read and write the one
 * server document (`/api/amberxvid/availability`), which is what keeps them
 * from disagreeing.
 *
 * ---------------------------------------------------------------------------
 * CLICK-TO-CALL-BACK, AND THE ONE CASE THAT IS NOT A CALL
 * ---------------------------------------------------------------------------
 * Every row is clickable and does the obvious thing — except that "the obvious
 * thing" differs by kind, and the row says which BEFORE it is clicked:
 *
 *  - a `call` row rings that member back;
 *  - a `room` row rejoins THAT ROOM if it is still open, and rings the member
 *    who invited you if it is not.
 *
 * The second case is the one worth being careful about. A room from yesterday
 * no longer exists, and silently converting "rejoin" into "phone somebody" is a
 * surprise; so the room rows carry the room's name and the fallback is stated
 * on the button rather than discovered by pressing it.
 *
 * ---------------------------------------------------------------------------
 * NO UNREAD BADGE OF ITS OWN
 * ---------------------------------------------------------------------------
 * Missed calls announced themselves in the messenger — that is what the DM note
 * is for, and the messenger already has unread machinery. This screen counts
 * missed rows, it does not track which ones have been looked at. Two unread
 * counters for one fact is two counters that disagree.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { CallMade as PlacedIcon } from "./kit/icons";
import { CallReceived as ReceivedIcon } from "./kit/icons";
import { Close as MissedIcon } from "./kit/icons";
import { ForumRounded as RoomIcon } from "./kit/icons";
import { Videocam as VideocamIcon } from "./kit/icons";
import { Delete as DeleteIcon } from "./kit/icons";
import { Refresh as RefreshIcon } from "./kit/icons";
import { DarkMode as DndIcon } from "./kit/icons";
import { Schedule as ScheduleIcon } from "./kit/icons";
import { History as HistoryIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxCard, GxChip, StatTile, type CtxItem } from "./kit/ax";
import { GizmoXMark } from "./gizmox-kit";
import AvatarView from "./Avatar";
import { axvPlatform, useAxvSubjectResolver } from "./ctxBridge";
import type {
  AvailabilityDoc,
  CallHistoryEntry,
  MissedReason,
  Profile,
} from "./lib/types";

/** Weekday labels, Sunday-first, matching the store's `0`=Sunday numbering. */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The quarter-hours a window can start or end on. Ninety-six options is a
 *  dropdown; 1,440 is a puzzle, and nobody sets quiet hours to 22:07. */
const QUARTERS: number[] = Array.from({ length: 96 }, (_, i) => i * 15);

const clock = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Relative for the recent past, absolute once "3 days ago" stops being useful
 *  — the same rule the rest of the module reads by. */
function whenLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown";
  const ms = Date.now() - at.getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return at.toLocaleDateString();
}

function durationLabel(s: number): string {
  if (s <= 0) return "";
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/** What a row's outcome is CALLED. The store's reasons are a closed enum, so
 *  this map is total and a new reason breaks the build rather than rendering
 *  the raw slug at a member. */
const REASON_COPY: Record<MissedReason, string> = {
  "no-answer": "no answer",
  declined: "declined",
  busy: "they were on another call",
  dnd: "do not disturb",
  failed: "the media link failed",
};

export interface CallHistoryProps {
  /** Screennames, for the rare row whose stored display name is stale. */
  screennameFor: (user: string) => string;
  profiles: Record<string, Profile>;
  /** Ring this member — the shell's call engine. */
  onCall: (user: string) => void | Promise<unknown>;
  /** Rejoin a room by id; resolves false when the room is no longer open. */
  onRejoinRoom: (roomId: string) => Promise<boolean>;
  notify: (msg: string) => void;
  openCtx: (e: React.MouseEvent, label: string, items: CtxItem[]) => void;
  userMenu: (user: string) => CtxItem[];
}

type Filter = "all" | "missed" | "placed" | "received";

interface HistoryReply {
  ok?: boolean;
  history?: CallHistoryEntry[];
  missed?: number;
}

interface AvailabilityReply {
  ok?: boolean;
  availability?: AvailabilityDoc;
  summary?: string;
}

export default function CallHistory({
  screennameFor,
  profiles,
  onCall,
  onRejoinRoom,
  notify,
  openCtx,
  userMenu,
}: CallHistoryProps) {
  const [rows, setRows] = React.useState<CallHistoryEntry[] | null>(null);
  const [availability, setAvailability] = React.useState<AvailabilityDoc | null>(null);
  const [summary, setSummary] = React.useState<string>("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [h, a] = await Promise.all([
        fetch("/api/amberxvid/calls/history").then((r) => r.json() as Promise<HistoryReply>),
        fetch("/api/amberxvid/availability").then((r) => r.json() as Promise<AvailabilityReply>),
      ]);
      if (h.ok && Array.isArray(h.history)) setRows(h.history);
      else setRows([]);
      if (a.ok && a.availability) {
        setAvailability(a.availability);
        setSummary(a.summary ?? "");
      }
    } catch {
      // An empty history and a broken fetch look identical to a reader, so the
      // list stays null and the surface says "couldn't load" rather than
      // showing a confident "no calls yet" that may be a lie.
      setRows(null);
      notify("Couldn't load your call history");
    }
  }, [notify]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** Patch the availability document. The server answers with the whole
   *  document, so nothing here has to guess what it merged. */
  const patchAvailability = React.useCallback(
    async (patch: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch("/api/amberxvid/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = (await res.json().catch(() => null)) as AvailabilityReply | null;
        if (!res.ok || !json?.ok || !json.availability) {
          notify("That didn't save");
          return;
        }
        setAvailability(json.availability);
        setSummary(json.summary ?? "");
      } catch {
        notify("The availability service did not answer");
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const historyPost = React.useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/amberxvid/calls/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as HistoryReply | null;
        if (json?.ok && Array.isArray(json.history)) setRows(json.history);
      } catch {
        notify("That didn't save");
      }
    },
    [notify],
  );

  /** The row action. See the header for why the two kinds differ and why the
   *  fallback is written on the button rather than discovered by pressing it. */
  const act = React.useCallback(
    async (row: CallHistoryEntry) => {
      if (row.kind === "room" && row.roomId) {
        const rejoined = await onRejoinRoom(row.roomId);
        if (rejoined) return;
        notify(`"${row.roomTitle ?? "That room"}" has ended — calling ${row.peerDisplay} instead`);
      }
      await onCall(row.peer);
    },
    [notify, onCall, onRejoinRoom],
  );

  /**
   * The declared `amberxvid.history` area's behaviour, for CALLS (P15).
   *
   * A resolver over the loaded rows — they are a `.map()`. *Call back* is the
   * screen's own `act`, which rejoins the room when the entry is a room ring
   * and falls back to ringing the person when it has ended; the menu therefore
   * cannot get that fallback wrong by doing its own thing.
   *
   * `openRecording` gives up nothing by answering with a sentence here: a call
   * entry has no recording to open (`CallHistoryEntry` carries none), the row is
   * marked `data-axf-call-recording="0"`, and its predicate keeps it off the
   * menu. The row is live on the STREAM history, where entries really do leave
   * a recording behind.
   */
  useAxvSubjectResolver("history", (id) => {
    const row = (rows ?? []).find((r) => r.id === id);
    if (!row) return null;
    return {
      callBack: () => void act(row),
      openThread: () => axvPlatform()?.member(row.peer).message(),
      openRecording: () => notify("That call left no recording"),
    };
  });

  const missed = (rows ?? []).filter((r) => r.direction === "missed").length;
  const shown = (rows ?? []).filter((r) => (filter === "all" ? true : r.direction === filter));

  /* -------------------------------- do not disturb -------------------------------- */

  const q = availability?.quietHours;
  const dndCard = (
    <GxCard title="Availability" meta={<GxChip label={availability?.dnd ? "DND" : "open"} kind={availability?.dnd ? "warn" : "ok"} />}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <DndIcon sx={{ fontSize: 18, color: availability?.dnd ? GX.warn : GX.dim }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>Do not disturb</Typography>
            <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
              Rings are refused and land as missed calls. The caller is told you're unavailable —
              never which of these two silenced you.
            </Typography>
          </Box>
          <Switch
            size="small"
            disabled={busy || availability === null}
            checked={availability?.dnd === true}
            onChange={(e) => void patchAvailability({ dnd: e.target.checked })}
            data-el-id="amberxvid:dnd:toggle"
          />
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ScheduleIcon sx={{ fontSize: 18, color: q?.enabled ? GX.accent : GX.dim }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>Quiet hours</Typography>
            <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
              A window that silences rings on its own. Server time — see below.
            </Typography>
          </Box>
          <Switch
            size="small"
            disabled={busy || availability === null}
            checked={q?.enabled === true}
            onChange={(e) => void patchAvailability({ quietHours: { enabled: e.target.checked } })}
            data-el-id="amberxvid:dnd:quiet"
          />
        </Box>

        {q?.enabled && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, pl: 3.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <TextField
                select
                size="small"
                label="From"
                value={String(q.startMinute)}
                onChange={(e) => void patchAvailability({ quietHours: { startMinute: Number(e.target.value) } })}
                data-el-id="amberxvid:dnd:from"
                sx={{ width: 110 }}
              >
                {QUARTERS.map((m) => (
                  <MenuItem key={m} value={String(m)}>
                    {clock(m)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="To"
                value={String(q.endMinute)}
                onChange={(e) => void patchAvailability({ quietHours: { endMinute: Number(e.target.value) } })}
                data-el-id="amberxvid:dnd:to"
                sx={{ width: 110 }}
              >
                {QUARTERS.map((m) => (
                  <MenuItem key={m} value={String(m)}>
                    {clock(m)}
                  </MenuItem>
                ))}
              </TextField>
              {q.startMinute > q.endMinute && (
                <GxChip label="overnight" kind="dim" />
              )}
            </Box>
            {/* Days are OPT-IN chips over "every day", which is what an empty
                list means in the store — so a member who never opens this row
                gets the window they asked for on every day, not on none. */}
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              {DAYS.map((label, day) => {
                const on = q.days.length === 0 || q.days.includes(day);
                return (
                  <Box
                    key={label}
                    component="button"
                    type="button"
                    data-el-id={`amberxvid:dnd:day:${label.toLowerCase()}`}
                    onClick={() => {
                      // An empty list means EVERY day; turning one off has to
                      // materialise the full list first or the click would read
                      // as "only this day".
                      const base = q.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : q.days;
                      const next = base.includes(day) ? base.filter((d) => d !== day) : [...base, day];
                      void patchAvailability({ quietHours: { days: next.sort((a, b) => a - b) } });
                    }}
                    sx={{
                      cursor: "pointer",
                      border: `1px solid ${on ? gxa(GX.accent, "88") : GX.edge}`,
                      background: on ? gxa(GX.accent, "22") : "transparent",
                      color: on ? GX.ink : GX.dim,
                      borderRadius: 1,
                      px: 0.9,
                      py: 0.3,
                      fontSize: 10.5,
                      fontFamily: GX.mono,
                    }}
                  >
                    {label}
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        {summary && (
          <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono }}>{summary}</Typography>
        )}
      </Box>
    </GxCard>
  );

  /* ----------------------------------- the list ------------------------------------ */

  const rowNode = (row: CallHistoryEntry) => {
    const display = row.peerDisplay || screennameFor(row.peer);
    const profile = profiles[row.peer];
    const icon =
      row.direction === "missed" ? (
        <MissedIcon sx={{ fontSize: 16, color: GX.err }} />
      ) : row.direction === "placed" ? (
        <PlacedIcon sx={{ fontSize: 16, color: GX.dim }} />
      ) : (
        <ReceivedIcon sx={{ fontSize: 16, color: GX.ok }} />
      );
    const outcome = row.missedReason
      ? REASON_COPY[row.missedReason]
      : row.answeredAt
        ? durationLabel(row.durationS) || "answered"
        : "ringing";

    return (
      <Box
        key={row.id}
        /**
         * The ROW is the member; the LIST around it is the history (P15).
         *
         * That nesting is what makes one right-click here offer both — the
         * member's Message / Call / Add buddy AND the entry's Call back / Open
         * the conversation. Marking both ids on the row was the first attempt
         * and it cannot work: an element carries ONE `data-axf-area`, and rows
         * only compose from areas that are actually marked up the chain.
         *
         * The `data-axf-call*` values stay on the row even though the area
         * marker moved out, because the engine harvests `data-axf-*` from every
         * node it walks past and not merely from the ones that are areas.
         *
         * `call-recording` is pinned to "0": a call leaves no recording behind
         * (`CallHistoryEntry` carries none), so the row's predicate keeps *Open
         * the recording* off this surface. It is live on the stream history.
         */
        data-axf-area="amberxvid.member"
        data-axf-member={row.peer}
        data-axf-member-name={display}
        data-axf-call={row.id}
        data-axf-call-peer={row.peer}
        data-axf-call-recording="0"
        onContextMenu={(e) =>
          openCtx(e, `Call · ${display}`, [
            { label: row.kind === "room" ? `Rejoin "${row.roomTitle ?? "room"}"` : "Call back", onClick: () => void act(row) },
            { label: "Remove from history", danger: true, onClick: () => void historyPost({ action: "delete", id: row.id }) },
            "---",
            ...userMenu(row.peer),
          ])
        }
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.85,
          borderBottom: `1px solid ${gxa(GX.edge, "55")}`,
          "&:hover": { background: gxa(GX.accent, "0e") },
        }}
      >
        {icon}
        <AvatarView spec={profile?.avatar ?? null} name={display} size={28} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
              {display}
            </Typography>
            {row.kind === "room" && (
              <GxChip label={row.roomTitle ? `room · ${row.roomTitle}` : "room"} kind="info" />
            )}
            {row.missedReason === "dnd" && <GxChip label="silenced by DND" kind="warn" />}
          </Box>
          <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono }}>
            {whenLabel(row.at)} · {outcome}
          </Typography>
        </Box>
        <Tooltip
          title={
            row.kind === "room"
              ? `Rejoin "${row.roomTitle ?? "the room"}" — or call ${display} if it has ended`
              : `Call ${display} back`
          }
        >
          <IconButton size="small" onClick={() => void act(row)} data-el-id={`amberxvid:callhistory:act:${row.id}`}>
            {row.kind === "room" ? (
              <RoomIcon sx={{ fontSize: 17, color: GX.accent }} />
            ) : (
              <VideocamIcon sx={{ fontSize: 17, color: GX.accent }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>
    );
  };

  return (
    <Box sx={{ position: "relative", display: "flex", gap: 1.5, alignItems: "flex-start", flexWrap: "wrap" }}>
      <Box
        aria-hidden
        sx={{ position: "absolute", right: 0, top: 0, opacity: 0.05, pointerEvents: "none" }}
      >
        <GizmoXMark size={340} glow={false} />
      </Box>

      <Box sx={{ flex: "2 1 420px", minWidth: 320 }}>
        <GxCard
          title="Calls"
          meta={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Tooltip title="Reload">
                <IconButton size="small" onClick={() => void load()} data-el-id="amberxvid:callhistory:reload">
                  <RefreshIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Clear your whole call history">
                <span>
                  <IconButton
                    size="small"
                    disabled={(rows ?? []).length === 0}
                    onClick={() => void historyPost({ action: "clear" })}
                    data-el-id="amberxvid:callhistory:clear"
                  >
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          }
        >
          <Box sx={{ display: "flex", gap: 1, mb: 1, flexWrap: "wrap" }}>
            <StatTile value={String((rows ?? []).length)} label="calls" />
            <StatTile
              value={String(missed)}
              label="missed"
              sub={missed > 0 ? "in your messenger too" : "none"}
              subKind={missed > 0 ? "err" : "dim"}
            />
          </Box>

          <ToggleButtonGroup
            size="small"
            exclusive
            value={filter}
            onChange={(_, v: Filter | null) => v && setFilter(v)}
            sx={{ mb: 1 }}
          >
            <ToggleButton value="all" data-el-id="amberxvid:callhistory:filter:all">All</ToggleButton>
            <ToggleButton value="missed" data-el-id="amberxvid:callhistory:filter:missed">Missed</ToggleButton>
            <ToggleButton value="received" data-el-id="amberxvid:callhistory:filter:received">Received</ToggleButton>
            <ToggleButton value="placed" data-el-id="amberxvid:callhistory:filter:placed">Placed</ToggleButton>
          </ToggleButtonGroup>

          {rows === null ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 3, justifyContent: "center" }}>
              <CircularProgress size={16} />
              <Typography sx={{ fontSize: 12, color: GX.dim }}>Loading your calls…</Typography>
            </Box>
          ) : shown.length === 0 ? (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, py: 4 }}>
              <HistoryIcon sx={{ fontSize: 30, color: GX.dim }} />
              <Typography sx={{ fontSize: 12.5, color: GX.dim, textAlign: "center", maxWidth: 380 }}>
                {rows.length === 0
                  ? "No calls yet. Ring somebody from the members list, a profile, or their name anywhere it appears."
                  : `Nothing ${filter} — try another filter.`}
              </Typography>
              {rows.length > 0 && (
                <Button size="small" variant="outlined" onClick={() => setFilter("all")}>
                  Show everything
                </Button>
              )}
            </Box>
          ) : (
            // The declared `amberxvid.history` area (P15) wraps the LIST, so
            // the rows inside it compose member-then-history and a right-click
            // on the empty space below still knows it is in the history.
            <Box data-axf-area="amberxvid.history">{shown.map(rowNode)}</Box>
          )}
        </GxCard>
      </Box>

      <Box sx={{ flex: "1 1 300px", minWidth: 280 }}>{dndCard}</Box>
    </Box>
  );
}
