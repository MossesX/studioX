/**
 * @file THE STREAM PAGE (P12) — the full Twitch pattern on the transport the
 * client/server conversion proved.
 *
 * ---------------------------------------------------------------------------
 * THE LAYOUT, AND WHAT EACH PART IS FOR
 * ---------------------------------------------------------------------------
 *   PLAYER LEFT, taking every pixel the rest does not claim.
 *   IDENTITY ROW under the player: the streamer's accounts avatar and
 *     screenname, the LIVE badge, the live viewer count read off the room
 *     record, and the FOLLOW button. This is the row that turns "a video is
 *     playing" into "a person is broadcasting", and it is why it sits under the
 *     picture rather than in the header — a header is chrome, and this is the
 *     page's subject.
 *   CHAT RAIL RIGHT, 340px: the roster over the room's chat, arranged exactly
 *     like the group room's rail (`GroupRoom.tsx`) so the two rooms read the
 *     same way.
 *   HOST TOOLS, collapsed by default, under the identity row for the host only:
 *     the live title/description editor, the viewer list with REMOVE, and the
 *     server-side recording toggle with its on-air indicator.
 *
 * ### The one place this deliberately differs from the group room
 *
 * The group room's rail is a real P5 group THREAD in the accounts messages
 * store, bound to the room record. This rail is the stream's own chat, and the
 * difference is audience shape rather than convenience:
 *
 *   - a group thread is capped by `maxGroupChatMembers`, the policy row that
 *     caps a room's roster. A STREAM is capped by `streamViewerLimit`, a
 *     different row with a different (much larger) number, so a thread-backed
 *     stream chat would admit viewers to the room and then refuse them the
 *     chat — the exact "in a meeting unable to type in it" failure
 *     `lib/groupRooms`'s header rejects, one layer up;
 *   - a group thread applies the pairwise social guard to its membership. In a
 *     meeting of people who chose each other that is correct; in a public
 *     broadcast it means one viewer blocking another can decide who is allowed
 *     in the room's chat.
 *
 * So the rail LOOKS like the room's and shares its shape, and the transport
 * underneath stays the room chat that scales to an audience: ephemeral, capped,
 * gone when the room is (decision 2026-08-04, unchanged).
 *
 * ---------------------------------------------------------------------------
 * BOTH DIRECTIONS OF RECORDING, ON ONE SCREEN
 * ---------------------------------------------------------------------------
 *   HOST   presses REC → the MEDIA SERVER records the SFU's own copy into the
 *          host's vault (P10). Everybody in the room sees `REC` because the
 *          fact rides the media snapshot, and the ON AIR indicator is on this
 *          page because a recording nobody can see is a recording nobody
 *          consented to.
 *   VIEWER presses REC → `MediaRecorder` over the CONSUMED track, chunk-
 *          uploaded into the VIEWER's own vault through the ordinary recordings
 *          API — quota-charged, journaled, thumbnailed, in their Library.
 *          "Record streams coming in and save your own sessions."
 *
 * Two files land, in two vaults, from one broadcast, and both play from the
 * Library. See `lib/streamRecorder.ts` for why they are two engines.
 *
 * ---------------------------------------------------------------------------
 * WHAT CLOSING THE WINDOW MEANS (unchanged from P7)
 * ---------------------------------------------------------------------------
 *   HOST    closing does NOT end the room — the broadcast is shell-owned, like
 *           a recording and like a call, and the toast says how to get back.
 *   VIEWER  closing leaves.
 *
 * Rendering reuses `VideoSurface` from the P8 video chat — one <video>
 * implementation in the module, not two.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Close as CloseIcon } from "./kit/icons";
import { Delete as RemoveIcon } from "./kit/icons";
import { ExpandLess as ExpandLessIcon } from "./kit/icons";
import { ExpandMore as ExpandMoreIcon } from "./kit/icons";
import { FiberManualRecord as RecordIcon } from "./kit/icons";
import { RecordVoiceOver as MicIcon } from "./kit/icons";
import { Stop as StopIcon } from "./kit/icons";
import { Tune as ToolsIcon } from "./kit/icons";
import { VolumeOff as MicOffIcon } from "./kit/icons";
import { Videocam as VideocamIcon } from "./kit/icons";
import { VideocamOff as VideocamOffIcon } from "./kit/icons";
import { Send as SendIcon } from "./kit/icons";
import { Sensors as SensorsIcon } from "./kit/icons";
import { Visibility as ViewersIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip, type CtxItem } from "./kit/ax";
import AvatarView from "./Avatar";
import { VideoSurface } from "./VideoChat";
import { fmtBytes, fmtClock } from "./Recorder";
import { STREAM_CHAT_MAX, STREAM_DESCRIPTION_MAX, STREAM_TITLE_MAX } from "./lib/types";
import { MEDIA_FAILURE_USER_COPY } from "./lib/mediaContract";
import { useIncomingRecorder } from "./lib/streamRecorder";
import { RatingStars } from "./RatingStars";
import { StreamToolSlot } from "./PointSlots";
import type { StreamToolHost } from "./points";
import type { StreamHub } from "./StreamHub";
import type { MessengerLink } from "./Messenger";

/** The chat rail's width. The group room's is 320 and this is 340 because a
 *  broadcast's chat is the audience's ONLY voice — it is the room's second
 *  subject, not a side panel. */
const RAIL_W = 340;

function elapsed(sinceIso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - Date.parse(sinceIso)) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0
    ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------------------------------- host tools ---------------------------------- */

/**
 * The host's own controls: retitle and re-describe LIVE, and the viewer list
 * with removal.
 *
 * The editor holds a DRAFT and saves explicitly. A live-typing save would push
 * a `streams` broadcast per keystroke to every client in the suite — the title
 * rides every tile everywhere — so the one thing this pane must not do is
 * "save as you type", however modern that reads.
 */
function HostTools({
  hub,
  title,
  description,
  viewers,
  screennameFor,
  openCtx,
  userMenu,
}: {
  hub: StreamHub;
  title: string;
  description: string;
  viewers: string[];
  screennameFor: (user: string) => string;
  openCtx: (e: React.MouseEvent, label: string, items: CtxItem[]) => void;
  userMenu: (user: string) => CtxItem[];
}) {
  const [draftTitle, setDraftTitle] = React.useState(title);
  const [draftDesc, setDraftDesc] = React.useState(description);
  const [saving, setSaving] = React.useState(false);

  // Follow the server's truth whenever it changes underneath an untouched
  // draft — another tab editing the same stream, or the open landing.
  React.useEffect(() => setDraftTitle(title), [title]);
  React.useEffect(() => setDraftDesc(description), [description]);

  const dirty = draftTitle.trim() !== title || draftDesc.trim() !== description;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await hub.describe({ title: draftTitle.trim(), description: draftDesc.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ px: 1.4, py: 1, borderTop: `1px solid ${GX.edge}`, bgcolor: GX.panel }}>
      <Typography sx={{ fontSize: 10.5, fontFamily: GX.mono, letterSpacing: 0.6, color: GX.dim, pb: 0.6 }}>
        HOST TOOLS — EDITS GO LIVE FOR EVERYONE
      </Typography>
      <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 0.8 }}>
          <TextField
            size="small"
            label="Stream title"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            slotProps={{ htmlInput: { maxLength: STREAM_TITLE_MAX, "data-el-id": "amberxvid:stream-room:title-edit" } }}
          />
          <TextField
            size="small"
            label="What's happening"
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            multiline
            minRows={2}
            maxRows={4}
            slotProps={{ htmlInput: { maxLength: STREAM_DESCRIPTION_MAX, "data-el-id": "amberxvid:stream-room:description-edit" } }}
          />
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Button
              size="small"
              variant="contained"
              disabled={!dirty || saving || !draftTitle.trim()}
              onClick={() => void save()}
              data-el-id="amberxvid:stream-room:save-details"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono }}>
              {dirty ? "unsaved — nobody sees these yet" : "live for every viewer"}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ width: 260, minWidth: 220 }}>
          <Typography sx={{ fontSize: 10.5, fontFamily: GX.mono, letterSpacing: 0.6, color: GX.dim }}>
            VIEWERS · {viewers.length}
          </Typography>
          <Box sx={{ maxHeight: 150, overflowY: "auto", pt: 0.5, display: "flex", flexDirection: "column", gap: 0.3 }}>
            {viewers.length === 0 ? (
              <Typography sx={{ fontSize: 11, color: GX.dim }}>nobody watching yet</Typography>
            ) : (
              viewers.map((v) => (
                <Box
                  key={v}
                  onContextMenu={(e) => openCtx(e, `Viewer · ${screennameFor(v)}`, userMenu(v))}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.6,
                    px: 0.6,
                    py: 0.2,
                    borderRadius: 0.6,
                    border: `1px solid ${GX.edge}`,
                    bgcolor: GX.panel2,
                  }}
                >
                  <Typography sx={{ flex: 1, minWidth: 0, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {screennameFor(v)}
                  </Typography>
                  <Tooltip title="remove from this stream — their player closes and they cannot rejoin">
                    <IconButton
                      size="small"
                      onClick={() => void hub.removeViewer(v)}
                      data-el-id={`amberxvid:stream-room:remove:${v.toLowerCase()}`}
                    >
                      <RemoveIcon sx={{ fontSize: 15, color: GX.err }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/* ------------------------------------ the page ----------------------------------- */

export default function StreamRoomWindow({
  hub,
  link,
  me,
  notify,
  openCtx,
  userMenu,
}: {
  hub: StreamHub;
  /** The messenger link — profiles and screennames for the identity row, the
   *  same source the group room's rail reads. */
  link: MessengerLink;
  me: string;
  notify: (msg: string, detail?: string) => void;
  openCtx: (e: React.MouseEvent, label: string, items: CtxItem[]) => void;
  /** The shared everywhere-menu builder — viewer rows get the full treatment. */
  userMenu: (user: string) => CtxItem[];
}) {
  const room = hub.room;
  const hosting = hub.myStream !== null;
  const [draft, setDraft] = React.useState("");
  const [micOn, setMicOn] = React.useState(true);
  const [camOn, setCamOn] = React.useState(true);
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const chatEnd = React.useRef<HTMLDivElement | null>(null);
  const screennameFor = link.screennameFor;

  // The VIEWER's own recorder — the other direction (see the header).
  const incoming = useIncomingRecorder({ notify });

  React.useEffect(() => {
    if (!hub.roomOpen) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hub.roomOpen]);

  React.useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [hub.chat.length, hub.roomOpen]);

  // The identity row's follower count: the hub's boot read only covers people
  // this member already follows, so a stranger's room asks for theirs. Once
  // per room, not per render.
  const openHost = hub.roomOpen ? (room?.host ?? null) : null;
  const { refreshFollowInfo } = hub;
  React.useEffect(() => {
    if (openHost) refreshFollowInfo(openHost);
  }, [openHost, refreshFollowInfo]);

  if (!room || !hub.roomOpen) return null;

  const hostKey = room.host.toLowerCase();
  const profile = link.profiles[hostKey];
  const followerCount = hub.followerCounts[hostKey];
  const followed = hub.isFollowing(room.host);

  /**
   * The narrow surface a contributed control (`amberxvid.stream-tool`) is
   * handed — P19. It is the whole of what a tool may touch: the broadcast's
   * identity, who is looking at it, which side they are on, the live follow
   * state and the two verbs. Not the hub, not the room record, not the chat.
   *
   * Built inline rather than memoised because every field on it changes with
   * the room anyway; a `useMemo` here would list the same six dependencies and
   * recompute on each of them.
   */
  const streamToolHost: StreamToolHost = {
    streamId: room.id,
    streamer: room.host,
    title: room.title,
    me,
    hosting,
    following: followed,
    setFollow: (on) => void hub.setFollow(room.host, on),
    notify: (message) => notify(message),
  };

  const toggleTrack =(kind: "audio" | "video", on: boolean): void => {
    // Server-known since P7: the hub pauses the PRODUCER, so the SFU stops
    // fanning that upstream — not just a disabled local track.
    hub.setTrackEnabled(kind, on);
    if (kind === "audio") setMicOn(on);
    else setCamOn(on);
    notify(kind === "audio" ? (on ? "Mic live" : "Mic muted") : on ? "Camera on" : "Camera off");
  };

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (!(await hub.sendChat(text))) notify("Message failed", "the room refused it");
  };

  const close = (): void => {
    if (hosting) {
      hub.closeRoom();
      notify("Still live", "your stream keeps running — reopen it from the Stream button or end it there");
    } else {
      if (incoming.active) incoming.stop(); // save what was captured rather than dropping it
      void hub.leaveWatch();
    }
  };

  const toggleIncoming = (): void => {
    if (incoming.active) {
      incoming.stop();
      return;
    }
    if (!hub.remoteStream) {
      notify("Nothing to record yet", "wait for the picture to arrive");
      return;
    }
    void incoming.start(hub.remoteStream, `${screennameFor(room.host)} — ${room.title}`);
  };

  return (
    <Dialog
      open
      onClose={close}
      maxWidth={false}
      fullWidth
      slotProps={{ paper: { sx: { width: "96vw", height: "92vh", maxWidth: "none", bgcolor: GX.page } } }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* header */}
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.4, py: 0.8, borderBottom: `1px solid ${GX.edge}` }}
          onContextMenu={(e) => openCtx(e, `Stream · ${room.title}`, [
            ...(hosting
              ? ([{ label: "End stream", danger: true, onClick: () => void hub.endLive() }] as CtxItem[])
              : ([
                  { label: followed ? "Unfollow the streamer" : "Follow the streamer", onClick: () => void hub.setFollow(room.host, !followed) },
                  { label: incoming.active ? "Stop recording this stream" : "Record this stream to my library", onClick: toggleIncoming },
                  "---",
                  { label: "Leave stream", onClick: () => void hub.leaveWatch() },
                  ...userMenu(room.host),
                ] as CtxItem[])),
          ])}
        >
          <SensorsIcon sx={{ color: GX.err, fontSize: 18 }} />
          <Typography sx={{ fontSize: 14.5, fontWeight: 700 }}>{room.title}</Typography>
          <GxChip label={`LIVE · ${elapsed(room.startedAt, now)}`} kind="err" />
          {/* P10 — the on-screen consent fact: while the server records this
              room, EVERY seat sees it said here, host and viewers alike. */}
          {hub.recording ? <GxChip label="REC · recorded on server" kind="err" /> : null}
          {/* P12 — and the same honesty for the OTHER direction: a viewer
              recording is visible to the viewer doing it, on the same strip. */}
          {incoming.active ? (
            <GxChip label={`REC · to your library · ${fmtClock(incoming.elapsedMs)}`} kind="warn" />
          ) : null}
          {/* P11 — the media leg is down and the backoff loop is rejoining
              the same room; the room stays open and says which. */}
          {hub.mediaReconnecting ? (
            <GxChip label="media server unreachable — reconnecting…" kind="err" />
          ) : null}
          <Box sx={{ flex: 1 }} />
          <RatingStars kind="stream" target={room.id} notify={notify} size={15} disabled={hosting} />
          <IconButton size="small" onClick={close} data-el-id="amberxvid:stream-room:close">
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        {/* body: stage + chat */}
        <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* stage */}
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <Box sx={{ flex: 1, minHeight: 240, bgcolor: "#000", position: "relative" }}>
              <VideoSurface stream={hosting ? hub.localStream : hub.remoteStream} muted={hosting} mirror={hosting} />
              {!hosting && !hub.remoteStream ? (
                <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", px: 4 }}>
                  {hub.mediaReconnecting ? (
                    // P11 — the specific sentence, never a spinner that does
                    // not resolve: what is wrong, and that the player resumes
                    // by itself. There is no peer-to-peer fallback.
                    <Typography
                      sx={{ color: GX.warn, fontSize: 12.5, textAlign: "center", maxWidth: 440 }}
                      data-el-id="amberxvid:stream-room:media-down"
                    >
                      {MEDIA_FAILURE_USER_COPY["server-unreachable"]} You are still in the room — the
                      picture resumes by itself when the server is back.
                    </Typography>
                  ) : (
                    <Typography sx={{ color: GX.dim, fontFamily: GX.mono, fontSize: 12 }}>
                      connecting to the host…
                    </Typography>
                  )}
                </Box>
              ) : null}
              {hosting && hub.mediaReconnecting ? (
                <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", px: 4, bgcolor: "#000a" }}>
                  <Typography
                    sx={{ color: GX.warn, fontSize: 12.5, textAlign: "center", maxWidth: 440 }}
                    data-el-id="amberxvid:stream-room:media-down-host"
                  >
                    {MEDIA_FAILURE_USER_COPY["server-unreachable"]} Your room stays open and your
                    camera stays on — the broadcast republishes by itself when the server is back.
                  </Typography>
                </Box>
              ) : null}
              {/* ON AIR — the indicator the server-recording contract requires,
                  over the picture where nobody can miss it (P10/P12). */}
              {hub.recording ? (
                <Box
                  data-el-id="amberxvid:stream-room:on-air"
                  sx={{
                    position: "absolute",
                    top: 10,
                    left: 10,
                    px: 1,
                    py: 0.3,
                    borderRadius: 0.6,
                    bgcolor: gxa(GX.err, "DD"),
                    color: "#fff",
                    fontFamily: GX.mono,
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                  }}
                >
                  <RecordIcon sx={{ fontSize: 12 }} /> ON AIR · RECORDING
                </Box>
              ) : null}
            </Box>

            {/* identity row — the page's subject */}
            <Box
              data-el-id="amberxvid:stream-room:identity"
              sx={{ display: "flex", alignItems: "center", gap: 1.2, px: 1.4, py: 1, borderTop: `1px solid ${GX.edge}` }}
              onContextMenu={(e) => openCtx(e, `Member · ${screennameFor(room.host)}`, hosting ? [] : userMenu(room.host))}
            >
              <AvatarView spec={profile?.avatar ?? null} name={screennameFor(room.host)} size={44} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {screennameFor(room.host)}
                  </Typography>
                  <GxChip label="LIVE" kind="err" />
                  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.3 }}>
                    <ViewersIcon sx={{ fontSize: 14, color: GX.dim }} />
                    <Typography
                      sx={{ fontSize: 11.5, color: GX.dim, fontFamily: GX.mono }}
                      data-el-id="amberxvid:stream-room:viewer-count"
                    >
                      {room.viewers.length} watching · peak {room.peakViewers}
                    </Typography>
                  </Box>
                  {typeof followerCount === "number" ? (
                    <Typography sx={{ fontSize: 11.5, color: GX.dim, fontFamily: GX.mono }}>
                      {followerCount} follower{followerCount === 1 ? "" : "s"}
                    </Typography>
                  ) : null}
                </Box>
                <Typography
                  sx={{ fontSize: 11.5, color: GX.dim, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 42, overflow: "hidden" }}
                  data-el-id="amberxvid:stream-room:description"
                >
                  {room.description || (hosting ? "No description yet — add one in host tools." : profile?.statusLine || "")}
                </Typography>
              </Box>
              {/**
               * The FOLLOW button used to be the `!hosting` half of this
               * ternary. It moved onto `amberxvid.stream-tool` (P19) and now
               * draws in the control bar below — see `FollowTool.tsx`. The
               * follower COUNT stayed here, because this row is the page's
               * subject and a count is a fact about the person; a button is
               * something the viewer does.
               */}
              {hosting ? (
                <Button
                  size="small"
                  variant={toolsOpen ? "contained" : "outlined"}
                  startIcon={<ToolsIcon sx={{ fontSize: 15 }} />}
                  endIcon={toolsOpen ? <ExpandLessIcon sx={{ fontSize: 15 }} /> : <ExpandMoreIcon sx={{ fontSize: 15 }} />}
                  onClick={() => setToolsOpen((o) => !o)}
                  data-el-id="amberxvid:stream-room:host-tools"
                >
                  Host tools
                </Button>
              ) : null}
            </Box>

            {/* host tools */}
            {hosting ? (
              <Collapse in={toolsOpen} unmountOnExit>
                <HostTools
                  hub={hub}
                  title={room.title}
                  description={room.description}
                  viewers={room.viewers}
                  screennameFor={screennameFor}
                  openCtx={openCtx}
                  userMenu={userMenu}
                />
              </Collapse>
            ) : null}

            {/* controls */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.2, py: 0.8, borderTop: `1px solid ${GX.edge}` }}>
              {hosting ? (
                <>
                  <Tooltip title={micOn ? "mute mic" : "unmute mic"}>
                    <IconButton size="small" onClick={() => toggleTrack("audio", !micOn)} data-el-id="amberxvid:stream-room:mic">
                      {micOn ? <MicIcon sx={{ fontSize: 18 }} /> : <MicOffIcon sx={{ fontSize: 18, color: GX.err }} />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={camOn ? "blank camera" : "camera on"}>
                    <IconButton size="small" onClick={() => toggleTrack("video", !camOn)} data-el-id="amberxvid:stream-room:cam">
                      {camOn ? <VideocamIcon sx={{ fontSize: 18 }} /> : <VideocamOffIcon sx={{ fontSize: 18, color: GX.err }} />}
                    </IconButton>
                  </Tooltip>
                  {/* P10 — server-side recording toggle. Unavailable is
                      DISABLED with the reason shown, never a silent no-op. */}
                  <Tooltip
                    title={
                      !hub.recordingAvailable
                        ? (hub.recordingReason ?? "server recording is unavailable")
                        : hub.recording
                          ? "stop recording — the file lands in your library"
                          : "record this stream on the server (everyone sees REC)"
                    }
                  >
                    <span>
                      <Button
                        size="small"
                        variant={hub.recording ? "contained" : "outlined"}
                        color={hub.recording ? "error" : "inherit"}
                        disabled={!hub.recordingAvailable}
                        startIcon={<RecordIcon sx={{ fontSize: 14 }} />}
                        onClick={() => void hub.setRecording(!hub.recording)}
                        data-el-id="amberxvid:stream-room:record"
                      >
                        {hub.recording ? "Stop recording" : "Record on server"}
                      </Button>
                    </span>
                  </Tooltip>
                  {/* P19 — contributed controls for the HOST's side of the bar
                      (`audience: "host" | "both"`). Nothing in the tree
                      contributes one today; the slot draws nothing when the
                      registry is empty. */}
                  <StreamToolSlot host={streamToolHost} />
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" color="error" variant="contained" onClick={() => void hub.endLive()} data-el-id="amberxvid:stream-room:end">
                    End stream
                  </Button>
                </>
              ) : (
                <>
                  {/* P12 — the viewer's own recorder. Enabled the moment there
                      is a picture; disabled with the reason when there is not. */}
                  <Tooltip
                    title={
                      incoming.active
                        ? "stop and save — the file lands in YOUR library"
                        : hub.remoteStream
                          ? "record this incoming stream into your own library (counts against your storage)"
                          : "nothing to record until the picture arrives"
                    }
                  >
                    <span>
                      <Button
                        size="small"
                        variant={incoming.active ? "contained" : "outlined"}
                        color={incoming.active ? "warning" : "inherit"}
                        disabled={!hub.remoteStream && !incoming.active}
                        startIcon={incoming.active ? <StopIcon sx={{ fontSize: 14 }} /> : <RecordIcon sx={{ fontSize: 14 }} />}
                        onClick={toggleIncoming}
                        data-el-id="amberxvid:stream-room:record-incoming"
                      >
                        {incoming.status === "finishing"
                          ? "Saving…"
                          : incoming.active
                            ? `Stop · ${fmtClock(incoming.elapsedMs)}`
                            : "Record this stream"}
                      </Button>
                    </span>
                  </Tooltip>
                  {incoming.active ? (
                    <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono }}>
                      {fmtBytes(incoming.bytesUploaded)} of {fmtBytes(incoming.bytesRecorded)} uploaded
                    </Typography>
                  ) : incoming.error ? (
                    <Typography sx={{ fontSize: 10.5, color: GX.err, fontFamily: GX.mono }} data-el-id="amberxvid:stream-room:record-error">
                      {incoming.error}
                    </Typography>
                  ) : incoming.lastSaved ? (
                    <Typography sx={{ fontSize: 10.5, color: GX.ok, fontFamily: GX.mono }}>
                      saved · {incoming.lastSaved.title}
                    </Typography>
                  ) : (
                    <Typography sx={{ fontSize: 11.5, color: GX.dim, fontFamily: GX.mono }}>
                      one-way broadcast — chat is your voice here
                      {hub.recording ? (
                        <Box component="span" sx={{ color: GX.err }}>
                          {" · this stream is being recorded on the server"}
                        </Box>
                      ) : null}
                    </Typography>
                  )}
                  {/* P19 — contributed controls for the VIEWER's side of the
                      bar. The module's own *Follow* lands here, through
                      `amberxvid.stream-tool` rather than through an import. */}
                  <StreamToolSlot host={streamToolHost} />
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" variant="outlined" onClick={close} data-el-id="amberxvid:stream-room:leave">
                    Leave
                  </Button>
                </>
              )}
            </Box>
          </Box>

          {/* chat + viewers — the rooms rail's arrangement */}
          <Box sx={{ width: RAIL_W, borderLeft: `1px solid ${GX.edge}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* viewer list */}
            <Box sx={{ px: 1.2, py: 0.7, borderBottom: `1px solid ${GX.edge}`, maxHeight: 160, overflowY: "auto" }}>
              <Typography sx={{ fontSize: 10.5, fontFamily: GX.mono, letterSpacing: 0.6, color: GX.dim }}>
                IN THE ROOM
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, pt: 0.5 }}>
                <GxChip label={`${screennameFor(room.host)} · host`} kind="accent" />
                {room.viewers.map((v) => (
                  <Box
                    key={v}
                    onContextMenu={(e) =>
                      openCtx(e, `Member · ${screennameFor(v)}`, [
                        ...(hosting && v.toLowerCase() !== me.toLowerCase()
                          ? ([
                              {
                                label: `Remove ${screennameFor(v)} from the stream`,
                                danger: true,
                                onClick: () => void hub.removeViewer(v),
                              },
                              "---",
                            ] as CtxItem[])
                          : []),
                        ...userMenu(v),
                      ])
                    }
                  >
                    <GxChip label={screennameFor(v)} kind={v.toLowerCase() === me.toLowerCase() ? "ok" : "dim"} />
                  </Box>
                ))}
                {room.viewers.length === 0 ? (
                  <Typography sx={{ fontSize: 11, color: GX.dim }}>nobody yet — the room just opened</Typography>
                ) : null}
              </Box>
            </Box>

            {/* messages */}
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1.2, py: 0.8, display: "flex", flexDirection: "column", gap: 0.6 }}>
              {hub.chat.length === 0 ? (
                <Typography sx={{ fontSize: 11.5, color: GX.dim, textAlign: "center", pt: 2 }}>
                  Say hello — chat lives with the stream and goes when it goes.
                </Typography>
              ) : (
                hub.chat.map((m) => {
                  const mine = m.from.toLowerCase() === me.toLowerCase();
                  return (
                    <Box
                      key={m.id}
                      onContextMenu={(e) =>
                        openCtx(e, `Message · ${screennameFor(m.from)}`, [
                          {
                            label: "Copy text",
                            onClick: () => {
                              void navigator.clipboard.writeText(m.text);
                              notify("Copied");
                            },
                          },
                          ...(hosting && !mine
                            ? ([
                                {
                                  label: `Remove ${screennameFor(m.from)} from the stream`,
                                  danger: true,
                                  onClick: () => void hub.removeViewer(m.from),
                                },
                              ] as CtxItem[])
                            : []),
                          ...(mine ? [] : userMenu(m.from)),
                        ])
                      }
                      sx={{
                        alignSelf: mine ? "flex-end" : "flex-start",
                        maxWidth: "88%",
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        bgcolor: mine ? gxa(GX.accent, "22") : GX.panel2,
                        border: `1px solid ${mine ? gxa(GX.accent, "55") : GX.edge}`,
                      }}
                    >
                      <Typography sx={{ fontSize: 10, color: m.from.toLowerCase() === hostKey ? GX.accent : GX.dim, fontFamily: GX.mono }}>
                        {screennameFor(m.from)}
                        {m.from.toLowerCase() === hostKey ? " · host" : ""}
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</Typography>
                    </Box>
                  );
                })
              )}
              <div ref={chatEnd} />
            </Box>

            {/* composer */}
            <Box sx={{ display: "flex", gap: 0.6, p: 0.8, borderTop: `1px solid ${GX.edge}` }}>
              <TextField
                size="small"
                fullWidth
                placeholder="message the room…"
                value={draft}
                slotProps={{ htmlInput: { maxLength: STREAM_CHAT_MAX, "data-el-id": "amberxvid:stream-room:composer" } }}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <IconButton size="small" onClick={() => void send()} disabled={!draft.trim()} data-el-id="amberxvid:stream-room:send">
                <SendIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}
