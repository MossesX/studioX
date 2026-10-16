/**
 * @file The Streams stage view — every live room in the suite, as tiles.
 *
 * Two arrangements, one toggle (persisted): a poster GRID for browsing, and
 * the compact scrollable LIST (small thumbnails, dense rows) for keeping an
 * eye on everything at once. Both render the same `StreamThumb`.
 *
 * THE HOVER CONTRACT: resting the pointer on any thumbnail — grid or list —
 * swaps the poster for the REAL stream for 15 seconds (`STREAM_PREVIEW_S`):
 * the tile joins the room as a hidden preview viewer (never listed, never
 * chatting), plays live and muted, then detaches on the earlier of 15 s or
 * mouse-out. A countdown ring shows the clock honestly. Click = join for
 * real; the preview leg upgrades in place.
 *
 * Tile info is all server truth: title, host (avatar + screenname + Live
 * badge), viewer count, elapsed, and the stream's 0–10 rating. Posters
 * refresh from `?thumb=<id>` keyed by `thumbnailAt`, so a tile never shows a
 * frame older than the host's last 10 s capture.
 *
 * ## P12 — following, alerts and history
 *
 * The ORDER of these tiles is the hub's: streams by people you follow come
 * first, everything else after, each group newest first. This view does not
 * sort — see `StreamHub.streams` for why the ordering is computed once rather
 * than per surface.
 *
 * On top of that: a FOLLOWING chip on a followed streamer's tile and a follow
 * toggle in its menu; the live ALERT strip a `stream-alert` raises, with a way
 * IN rather than only a toast that scrolls away; and the HISTORY dialog, which
 * is where a member sees what they broadcast and what they watched — and plays
 * the recording a stream left behind, which is the thing that proves both
 * halves of the recording story landed.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Dialog from "@mui/material/Dialog";
import { GridView as GridViewIcon } from "./kit/icons";
import { ViewList as ViewListIcon } from "./kit/icons";
import { Sensors as SensorsIcon } from "./kit/icons";
import { PlayArrow as PlayArrowIcon } from "./kit/icons";
import { Close as CloseIcon } from "./kit/icons";
import { History as HistoryIcon } from "./kit/icons";
import { Star as FollowIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip, type CtxItem } from "./kit/ax";
import {
  STREAM_PREVIEW_S,
  type StreamHistoryEntry,
  type StreamInfo,
  type WatchHistoryEntry,
} from "./lib/types";
import { useMediaHealth } from "./lib/mediaHealth";
import { RatingBadge, useRatings } from "./RatingStars";
import type { StreamHub } from "./StreamHub";
import type { UserMenuFactory } from "./userMenu";
import { useAxvSubjectResolver } from "./ctxBridge";
import { useToast } from "./kit/Toast";
import { useAmberxvidPrefs } from "./settings";

const VIEW_KEY = "gx:amberxvid.streams.view";

function elapsed(sinceIso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - Date.parse(sinceIso)) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/* ----------------------------------- thumb ------------------------------------- */

function StreamThumb({
  stream,
  hub,
  compact,
  onJoin,
}: {
  stream: StreamInfo;
  hub: StreamHub;
  compact: boolean;
  onJoin: () => void;
}) {
  const [preview, setPreview] = React.useState<MediaStream | null>(null);
  const [left, setLeft] = React.useState<number | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const stopRef = React.useRef<(() => void) | null>(null);
  const countdownRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const hoverToken = React.useRef(0);

  const stopPreview = React.useCallback(() => {
    hoverToken.current += 1;
    stopRef.current?.();
    stopRef.current = null;
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setPreview(null);
    setLeft(null);
  }, []);

  const startPreview = React.useCallback(() => {
    if (stopRef.current) return; // already previewing
    const token = ++hoverToken.current;
    void hub
      .startPreview(stream.id, (s) => {
        // Stream arriving (or dying) for THIS hover only.
        if (hoverToken.current === token) setPreview(s);
      })
      .then((stop) => {
        if (hoverToken.current !== token) {
          // Mouse already left while we were joining.
          stop();
          return;
        }
        stopRef.current = stop;
        const until = Date.now() + STREAM_PREVIEW_S * 1000;
        setLeft(STREAM_PREVIEW_S);
        countdownRef.current = setInterval(() => {
          const remain = Math.max(0, Math.ceil((until - Date.now()) / 1000));
          setLeft(remain);
          if (remain <= 0) stopPreview(); // the 15 s contract
        }, 250);
      });
  }, [hub, stream.id, stopPreview]);

  React.useEffect(() => stopPreview, [stopPreview]); // unmount folds the leg
  React.useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== preview) videoRef.current.srcObject = preview;
  }, [preview]);

  /**
   * P16 — the PLAYBACK group's `autoplayPreviews`. Off by default and said so
   * on the row: this opens a real media leg per tile, and the 15-second
   * contract that bounds a hovered preview bounds these too. Mount-only, so
   * flipping the setting does not retroactively start every tile on screen —
   * the next arrival is soon enough, and starting twenty legs at once because
   * somebody toggled a switch is the failure the default is guarding against.
   */
  const autoplay = useAmberxvidPrefs().autoplayPreviews;
  const autoplayRef = React.useRef(autoplay);
  autoplayRef.current = autoplay;
  React.useEffect(() => {
    if (autoplayRef.current) startPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const posterUrl = stream.hasThumbnail
    ? `/api/amberxvid/streams?thumb=${stream.id}&t=${encodeURIComponent(stream.thumbnailAt ?? "")}`
    : null;

  const media = (
    <Box
      data-el-id={`amberxvid:streams:thumb:${stream.id}`}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      onClick={onJoin}
      sx={{
        position: "relative",
        width: compact ? 128 : "100%",
        aspectRatio: "16/9",
        flexShrink: 0,
        bgcolor: "#000",
        borderRadius: 1,
        overflow: "hidden",
        cursor: "pointer",
        border: `1px solid ${preview ? GX.err : GX.edge}`,
      }}
    >
      {preview ? (
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posterUrl} alt={stream.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <SensorsIcon sx={{ color: GX.err, fontSize: compact ? 22 : 42, opacity: 0.6 }} />
        </Box>
      )}
      {/* live chip + countdown */}
      <Box sx={{ position: "absolute", top: 4, left: 4, display: "flex", gap: 0.4, alignItems: "center" }}>
        <Box sx={{ px: 0.6, borderRadius: 0.5, bgcolor: gxa(GX.err, "CC"), fontSize: 9.5, fontWeight: 800, fontFamily: GX.mono, color: "#fff" }}>
          LIVE
        </Box>
        {left !== null ? (
          <Box sx={{ px: 0.6, borderRadius: 0.5, bgcolor: "#000A", fontSize: 9.5, fontFamily: GX.mono, color: GX.warn }}>
            preview {left}s
          </Box>
        ) : null}
      </Box>
      {!preview ? (
        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: 0, transition: "opacity .15s", "&:hover": { opacity: 1 } }}>
          <PlayArrowIcon sx={{ fontSize: compact ? 26 : 48, color: "#fff", filter: "drop-shadow(0 0 6px #000)" }} />
        </Box>
      ) : null}
    </Box>
  );

  return media;
}

/* ----------------------------------- history ----------------------------------- */

const clock = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
};

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

/**
 * What this member broadcast and what they watched (P12).
 *
 * OWN HISTORY ONLY — the route takes no username, so there is no access rule
 * here to get wrong. Read on open rather than held in the hub: history changes
 * only when a stream ENDS, which is exactly when this dialog is not open.
 *
 * The recording link is the part worth having a dialog for at all: a hosted row
 * that left a server-side recording opens it in the Library, which is where the
 * viewer-side recording of the same broadcast is sitting too — both halves of
 * "both directions", playable, one click apart.
 */
function HistoryDialog({
  open,
  onClose,
  screennameFor,
  onOpenRecording,
}: {
  open: boolean;
  onClose: () => void;
  screennameFor: (user: string) => string;
  onOpenRecording?: (recordingId: string) => void;
}) {
  const [hosted, setHosted] = React.useState<StreamHistoryEntry[]>([]);
  const [watched, setWatched] = React.useState<WatchHistoryEntry[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/amberxvid/streams?history=1");
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; hosted?: StreamHistoryEntry[]; watched?: WatchHistoryEntry[] }
          | null;
        if (cancelled || !json?.ok) return;
        setHosted(json.hosted ?? []);
        setWatched(json.watched ?? []);
      } catch {
        /* an unreadable history renders as an empty one, honestly */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * The declared `amberxvid.history` area's behaviour, for BROADCASTS (P15).
   *
   * The same area as the call history, and deliberately: both answer "something
   * that happened, and what can I do about it now". This is the surface where
   * *Open the recording* is genuinely live — a hosted broadcast leaves a
   * `recordingId` behind and a call leaves nothing.
   *
   * Registered before the early return below is reached, because a hook cannot
   * live after one.
   */
  useAxvSubjectResolver("history", (id) => {
    const h = hosted.find((x) => x.id === id);
    if (!h) return null;
    return {
      // A broadcast that has ended cannot be rejoined and there is nobody
      // specific to ring — the honest answer is what it left behind.
      callBack: () => h.recordingId && onOpenRecording?.(h.recordingId),
      openThread: () => undefined,
      openRecording: () => h.recordingId && onOpenRecording?.(h.recordingId),
    };
  });

  if (!open) return null;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <Box sx={{ bgcolor: GX.page, display: "flex", flexDirection: "column", minHeight: 380 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.4, py: 0.9, borderBottom: `1px solid ${GX.edge}` }}>
          <HistoryIcon sx={{ fontSize: 17, color: GX.accent }} />
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Stream history</Typography>
          {loading ? <GxChip label="loading…" kind="dim" /> : null}
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={onClose} data-el-id="amberxvid:streams:history-close">
            <CloseIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Box>

        <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* what I broadcast */}
          <Box sx={{ flex: 1, minWidth: 0, p: 1.2, overflowY: "auto", borderRight: `1px solid ${GX.edge}` }} data-el-id="amberxvid:streams:history-hosted">
            <Typography sx={{ fontSize: 10.5, fontFamily: GX.mono, letterSpacing: 0.6, color: GX.dim, pb: 0.6 }}>
              I STREAMED · {hosted.length}
            </Typography>
            {hosted.length === 0 ? (
              <Typography sx={{ fontSize: 11.5, color: GX.dim }}>
                You haven&apos;t streamed yet. Every broadcast you end lands here.
              </Typography>
            ) : (
              hosted.map((h) => (
                <Box
                  key={h.id}
                  // The declared `amberxvid.history` area (P15) — and the one
                  // place its *Open the recording* row can hold, which is why
                  // the flag is computed rather than pinned to "0".
                  data-axf-area="amberxvid.history"
                  data-axf-call={h.id}
                  data-axf-call-recording={h.recordingId ? "1" : "0"}
                  sx={{ border: `1px solid ${GX.edge}`, borderRadius: 1, p: 0.8, mb: 0.6, bgcolor: GX.panel }}
                >
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{h.title}</Typography>
                  {h.description ? (
                    <Typography sx={{ fontSize: 11, color: GX.dim, whiteSpace: "pre-wrap" }}>{h.description}</Typography>
                  ) : null}
                  <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono, pt: 0.3 }}>
                    {when(h.startedAt)} · {clock(h.durationS)} · peak {h.peakViewers} · {h.uniqueViewers} watcher
                    {h.uniqueViewers === 1 ? "" : "s"}
                  </Typography>
                  {h.recordingId ? (
                    <Button
                      size="small"
                      startIcon={<PlayArrowIcon sx={{ fontSize: 15 }} />}
                      onClick={() => onOpenRecording?.(h.recordingId as string)}
                      data-el-id={`amberxvid:streams:history-play:${h.recordingId}`}
                    >
                      Play the recording
                    </Button>
                  ) : (
                    <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono }}>no recording kept</Typography>
                  )}
                </Box>
              ))
            )}
          </Box>

          {/* what I watched */}
          <Box sx={{ flex: 1, minWidth: 0, p: 1.2, overflowY: "auto" }} data-el-id="amberxvid:streams:history-watched">
            <Typography sx={{ fontSize: 10.5, fontFamily: GX.mono, letterSpacing: 0.6, color: GX.dim, pb: 0.6 }}>
              I WATCHED · {watched.length}
            </Typography>
            {watched.length === 0 ? (
              <Typography sx={{ fontSize: 11.5, color: GX.dim }}>
                Nothing yet — every stream you sit in lands here when you leave it.
              </Typography>
            ) : (
              watched.map((w) => (
                <Box key={w.id} sx={{ border: `1px solid ${GX.edge}`, borderRadius: 1, p: 0.8, mb: 0.6, bgcolor: GX.panel }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{w.title}</Typography>
                  <Typography sx={{ fontSize: 11, color: GX.accent, fontFamily: GX.mono }}>
                    {screennameFor(w.hostDisplay || w.host)}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono }}>
                    {when(w.joinedAt)} · watched {clock(w.durationS)}
                  </Typography>
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}

/* ------------------------------------ view ------------------------------------- */

export default function Streams({
  hub,
  me,
  screennameFor,
  userMenu,
  openCtx,
  onGoLive,
  onOpenRecording,
}: {
  hub: StreamHub;
  me: string;
  screennameFor: (user: string) => string;
  userMenu: UserMenuFactory;
  openCtx: (e: React.MouseEvent, label: string, items: CtxItem[]) => void;
  onGoLive: () => void;
  /** Open a recording in the Library — how a history row plays what it left. */
  onOpenRecording?: (recordingId: string) => void;
}) {
  const [view, setView] = React.useState<"grid" | "list">("grid");
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const { ratings, refresh } = useRatings("stream", hub.streams.map((s) => s.id));
  // P11: the hub's health indicator reflects the media server's /health —
  // polled, never guessed — so "go live" being pointless is visible up front.
  const health = useMediaHealth(true);
  const toast = useToast();

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEW_KEY);
      if (stored === "grid" || stored === "list") setView(stored);
    } catch {
      /* default grid */
    }
  }, []);
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const setViewPersist = (v: "grid" | "list"): void => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* session-only then */
    }
  };

  /** One invitation, written by the route, copied here. */
  const copyStreamInvite = React.useCallback(
    async (s: StreamInfo): Promise<void> => {
      try {
        const res = await fetch("/api/amberxvid/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // `channel: "link"` with no handle is the bare-link case the invite
          // system already models: nothing is delivered, the inviter pastes it.
          body: JSON.stringify({
            action: "create",
            channel: "link",
            handle: null,
            targetKind: "stream",
            targetId: s.id,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; url?: string }
          | null;
        if (!res.ok || !json?.ok || !json.url) {
          toast(json?.error ?? "That invitation could not be created");
          return;
        }
        await navigator.clipboard.writeText(json.url);
        toast("Invite link copied — it opens straight into the broadcast");
      } catch {
        toast("The invitations service did not answer");
      }
    },
    [toast],
  );

  /**
   * The declared `amberxvid.stream` area's behaviour (P15).
   *
   * A resolver over `hub.streams` — the cards are a `.map()`. Every row calls
   * the hub, which is the same engine the buttons on the card call, so the menu
   * cannot end a broadcast by a route the End button does not know about.
   *
   * *Copy invite link* is a REAL invitation, not a URL assembled here: it posts
   * to the invitations route with `targetKind: "stream"` and copies the token
   * link it answers with. That link is redeemed, honours the social guard and
   * the policy, and lands the redeemer IN the broadcast through the arrival
   * parameter (`lib/inviteContract.ts`) — which is why it is a request and not
   * a string concatenation.
   */
  useAxvSubjectResolver("stream", (id) => {
    const s = hub.streams.find((x) => x.id === id);
    if (!s) return null;
    const mine = s.host.toLowerCase() === me.toLowerCase();
    return {
      join: () => (mine ? hub.openRoom() : void hub.watch(s.id).then((ok) => ok && refresh())),
      toggleFollow: () => void hub.setFollow(s.host, !hub.isFollowing(s.host)),
      copyLink: () => void copyStreamInvite(s),
      end: () => void hub.endLive(),
      toggleRecording: () => {
        if (!hub.recordingAvailable) {
          toast(hub.recordingReason ?? "Recording is not available for this broadcast");
          return;
        }
        void hub.setRecording(!hub.recording);
      },
    };
  });

  const streamMenu = (s: StreamInfo): CtxItem[] => [
    ...(s.host.toLowerCase() === me.toLowerCase()
      ? ([
          { label: "Open my room", onClick: () => hub.openRoom() },
          { label: "End stream", danger: true, onClick: () => void hub.endLive() },
        ] as CtxItem[])
      : ([
          { label: `Join · ${s.title}`, onClick: () => void hub.watch(s.id) },
          {
            label: hub.isFollowing(s.host)
              ? `Unfollow ${screennameFor(s.host)}`
              : `Follow ${screennameFor(s.host)}`,
            onClick: () => void hub.setFollow(s.host, !hub.isFollowing(s.host)),
          },
        ] as CtxItem[])),
    "---",
    ...userMenu(s.host),
  ];

  const join = (s: StreamInfo): void => {
    if (s.host.toLowerCase() === me.toLowerCase()) hub.openRoom();
    else void hub.watch(s.id).then((ok) => ok && refresh());
  };

  const header = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
      <SensorsIcon sx={{ fontSize: 18, color: GX.err }} />
      <Typography sx={{ fontSize: 13, fontWeight: 700, fontFamily: GX.mono, letterSpacing: 0.5 }}>
        LIVE STREAMS
      </Typography>
      <GxChip label={`${hub.streams.length} live`} kind={hub.streams.length > 0 ? "err" : "dim"} />
      <Box data-el-id="amberxvid:streams:media-health" sx={{ display: "inline-flex" }}>
        {health === null ? (
          <GxChip label="media server · checking…" kind="dim" />
        ) : health.up ? (
          <GxChip label="media server · online" kind="ok" />
        ) : (
          <GxChip label="media server offline — calls & streams unavailable" kind="err" />
        )}
      </Box>
      <Box sx={{ flex: 1 }} />
      <Tooltip title="poster grid">
        <IconButton size="small" onClick={() => setViewPersist("grid")} data-el-id="amberxvid:streams:view-grid">
          <GridViewIcon sx={{ fontSize: 17, color: view === "grid" ? GX.accent : GX.dim }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="compact list — small thumbnails, scrollable">
        <IconButton size="small" onClick={() => setViewPersist("list")} data-el-id="amberxvid:streams:view-list">
          <ViewListIcon sx={{ fontSize: 17, color: view === "list" ? GX.accent : GX.dim }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="what you streamed, and what you watched">
        <IconButton size="small" onClick={() => setHistoryOpen(true)} data-el-id="amberxvid:streams:history">
          <HistoryIcon sx={{ fontSize: 17, color: GX.dim }} />
        </IconButton>
      </Tooltip>
      <Button size="small" variant="contained" color="error" startIcon={<SensorsIcon />} onClick={onGoLive} data-el-id="amberxvid:streams:go-live">
        {hub.myStream ? "My stream" : "Go live"}
      </Button>
    </Box>
  );

  /**
   * The alert strip — a `stream-alert` arrived for somebody this member
   * follows. It sits under the header rather than only in a toast because a
   * toast is gone in four seconds and the point of the alert is to offer a way
   * IN. Dismiss is explicit; joining dismisses it too.
   */
  const alert = hub.lastAlert;
  const alertStrip =
    alert && hub.streams.some((s) => s.id === alert.streamId) ? (
      <Box
        data-el-id="amberxvid:streams:alert"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.6,
          mb: 1,
          borderRadius: 1,
          border: `1px solid ${gxa(GX.accent, "66")}`,
          bgcolor: gxa(GX.accent, "18"),
        }}
      >
        <FollowIcon sx={{ fontSize: 16, color: GX.accent }} />
        <Typography sx={{ fontSize: 12 }}>
          <b>{screennameFor(alert.hostDisplay)}</b> went live — {alert.title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="contained"
          onClick={() => {
            hub.dismissAlert();
            void hub.watch(alert.streamId);
          }}
          data-el-id="amberxvid:streams:alert-watch"
        >
          Watch
        </Button>
        <IconButton size="small" onClick={hub.dismissAlert} data-el-id="amberxvid:streams:alert-dismiss">
          <CloseIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Box>
    ) : null;

  const history = (
    <HistoryDialog
      open={historyOpen}
      onClose={() => setHistoryOpen(false)}
      screennameFor={screennameFor}
      onOpenRecording={onOpenRecording}
    />
  );

  if (hub.streams.length === 0) {
    return (
      <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        {header}
        <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
          <Box sx={{ textAlign: "center" }}>
            <SensorsIcon sx={{ fontSize: 46, color: GX.dim, opacity: 0.5 }} />
            <Typography sx={{ color: GX.dim, fontSize: 13, pt: 1 }}>
              Nobody is live right now.
            </Typography>
            <Typography sx={{ color: GX.dim, fontSize: 11.5 }}>
              Go live yourself — every member sees your room the second it opens.
            </Typography>
            {hub.following.length > 0 ? (
              <Typography sx={{ color: GX.dim, fontSize: 11.5, pt: 0.6 }}>
                You follow {hub.following.length} member{hub.following.length === 1 ? "" : "s"} — we&apos;ll
                tell you the moment one of them goes on air.
              </Typography>
            ) : null}
          </Box>
        </Box>
        {history}
      </Box>
    );
  }

  const meta = (s: StreamInfo) => (
    <>
      <Typography sx={{ fontSize: compactFont(view), fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {s.title}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.7, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 11, color: GX.accent, fontFamily: GX.mono }}>{screennameFor(s.host)}</Typography>
        {/* P12 — why this tile is at the top of the list, said on the tile. */}
        {hub.isFollowing(s.host) ? <GxChip label="following" kind="accent" /> : null}
        <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono }}>
          {s.viewers.length} watching · {elapsed(s.startedAt, now)}
        </Typography>
        <RatingBadge summary={ratings[s.id]} />
      </Box>
      {s.description ? (
        <Typography
          sx={{ fontSize: 10.5, color: GX.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {s.description}
        </Typography>
      ) : null}
    </>
  );

  return (
    <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {header}
      {alertStrip}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-el-id="amberxvid:streams:pane">
        {view === "grid" ? (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 1.2 }}>
            {hub.streams.map((s) => (
              <Box
                key={s.id}
                onContextMenu={(e) => openCtx(e, `Stream · ${s.title}`, streamMenu(s))}
                // The declared `amberxvid.stream` area (P15). The two flags
                // are DOM facts because this card already knows them — a store
                // publishing them would be a second copy that can go stale.
                data-axf-area="amberxvid.stream"
                data-axf-stream={s.id}
                data-axf-stream-host={s.host}
                data-axf-stream-following={hub.isFollowing(s.host) ? "1" : "0"}
                data-axf-stream-recording={
                  s.host.toLowerCase() === me.toLowerCase() && hub.recording ? "1" : "0"
                }
                sx={{ border: `1px solid ${GX.edge}`, borderRadius: 1, p: 0.8, bgcolor: GX.panel, display: "flex", flexDirection: "column", gap: 0.6 }}
              >
                <StreamThumb stream={s} hub={hub} compact={false} onJoin={() => join(s)} />
                {meta(s)}
              </Box>
            ))}
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.6 }}>
            {hub.streams.map((s) => (
              <Box
                key={s.id}
                onContextMenu={(e) => openCtx(e, `Stream · ${s.title}`, streamMenu(s))}
                // The declared `amberxvid.stream` area (P15). The two flags
                // are DOM facts because this card already knows them — a store
                // publishing them would be a second copy that can go stale.
                data-axf-area="amberxvid.stream"
                data-axf-stream={s.id}
                data-axf-stream-host={s.host}
                data-axf-stream-following={hub.isFollowing(s.host) ? "1" : "0"}
                data-axf-stream-recording={
                  s.host.toLowerCase() === me.toLowerCase() && hub.recording ? "1" : "0"
                }
                sx={{ display: "flex", gap: 1, alignItems: "center", border: `1px solid ${GX.edge}`, borderRadius: 1, p: 0.6, bgcolor: GX.panel }}
              >
                <StreamThumb stream={s} hub={hub} compact onJoin={() => join(s)} />
                <Box sx={{ minWidth: 0, flex: 1 }}>{meta(s)}</Box>
                <Button size="small" variant="outlined" onClick={() => join(s)}>
                  {s.host.toLowerCase() === me.toLowerCase() ? "Open" : "Join"}
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      {history}
    </Box>
  );
}

const compactFont = (view: "grid" | "list"): number => (view === "grid" ? 12.5 : 12);
