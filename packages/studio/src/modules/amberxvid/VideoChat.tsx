"use client";

/**
 * @file AmberX Vid 1:1 video chat on the MEDIA SERVER (P6) — the first client
 * surface rewritten onto the SFU, and the deletion of the call-side mesh in
 * the same motion.
 *
 * Two exports:
 *
 *   `useVideoChat` — the call engine. The module shell mounts it ONCE (above
 *   the messenger drawer — an incoming call must ring with everything closed)
 *   and feeds it the call signals the messenger's SSE stream delivers. The
 *   SESSION half is unchanged from the mesh era: ring in/out over the calls
 *   route (invite/accept/reject/hangup — which now rides the P3 outbox and
 *   therefore rings across processes), the ring timeout, accept/reject, mute
 *   and camera toggles, device pickers, hangup, the settings dialog. The
 *   TRANSPORT half is mediasoup-client against `/api/amberxvid/media` (P4):
 *   POST `join` mints the participant token against the P3 room record (the
 *   call id IS the room id), one send and one recv transport, ONE upstream
 *   per kind (camera + mic), and one consumer per producer the server
 *   announces — announcements arrive as `room-media` events on the same SSE
 *   stream, pushed by the media server, never polled.
 *
 *   Two things the SFU gives this surface that the mesh could not:
 *   - MUTE IS SERVER-KNOWN: the toggle pauses the PRODUCER (`action: "pause"`),
 *     the server stops fanning that upstream, and the far side reads the fact
 *     from the announced snapshot — not from a data channel the peer might
 *     not send.
 *   - RECONNECT-RESUME: a reloaded window finds its live call via GET
 *     `/api/amberxvid/calls` and joins the SAME P3 room record again (the
 *     media server holds the room through `MEDIA_TIMING.roomIdleCloseMs`),
 *     instead of renegotiating a new call from zero.
 *
 *   What is GONE, deliberately and completely: the `RTCPeerConnection`, the
 *   ICE candidate queue, the offer/answer dance, the TURN-credential fetch,
 *   the forced-relay dial and its loopback proof, the direct/relayed badge
 *   (every leg terminates on the media server — `MEDIA_CONTRACT.path` — and
 *   the badge now says so honestly), and the SAS/attestation UI whose referee
 *   P5 retired. Deleted outright, not flagged off; P11 owns the no-fallback
 *   statement.
 *
 *   `VideoChatWindow` (default) — the call surface over that engine: ring
 *   in/out, the in-call stage with local PiP + controls + the far side's
 *   server-known mute state, and the settings dialog. Branding + animations
 *   throughout, scaled by the module intensity knob (reduced-motion always
 *   wins via `useAnimationIntensity`).
 *
 * ---------------------------------------------------------------------------
 * P13 — THIS FILE OWNS RINGING, AND ONLY RINGING
 * ---------------------------------------------------------------------------
 * The ring ceremony grew three things and deliberately did not grow a fourth:
 *
 *  - **The chime** is `lib/chime` — the score and the player together, so the
 *    settings dialog's audition button plays the identical sound. What stays
 *    here is the repeat interval, the member's switch and volume, and the
 *    ONE-SHOT tray balloon raised only while the tab is hidden (`onRingAlert`,
 *    which the shell wires to the tray link — the engine does not know what a
 *    tray is).
 *  - **The room ring** (`roomRing` / `acceptRoomRing` / `declineRoomRing`) is
 *    here rather than on the rooms engine because ringing is what this file
 *    does; a second ring implementation next door is how the two would drift.
 *    Where an accepter LANDS belongs to the rooms engine and arrives as the
 *    `joinRoom` callback.
 *  - **The callee's ring deadline posts `hangup/timeout`**, not
 *    `reject/declined`. It always should have; since P13 writes call history
 *    from these reasons it now matters twice, because a decline and a miss are
 *    different rows and different words on both sides.
 *
 * The fourth thing — deciding WHETHER to ring — is not here and must not move
 * here. `canStartCalls`, the block guard and do-not-disturb are answered
 * server-side at the one ring door (`lib/ring`), before the callee's outbox is
 * written. A client-side check would be a client-side check.
 */

import * as React from "react";
// Type-only at module scope: this file is SSR-evaluated like any client
// component, and the browser RTC library must never run on the server —
// `connectMedia` imports the Device implementation dynamically, in the call.
import type { Device } from "mediasoup-client";
import type {
  Consumer,
  DtlsParameters,
  IceCandidate,
  IceParameters,
  Producer,
  RtpCapabilities,
  RtpParameters,
  Transport,
} from "mediasoup-client/types";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Close as CloseIcon } from "./kit/icons";
import { RecordVoiceOver as MicOnIcon } from "./kit/icons";
import { VolumeOff as MicOffIcon } from "./kit/icons";
import { Videocam as VideocamIcon } from "./kit/icons";
import { VideocamOff as VideocamOffIcon } from "./kit/icons";
import { Settings as SettingsIcon } from "./kit/icons";
import { CallMade as CallMadeIcon } from "./kit/icons";
import { VolumeUp as VolumeUpIcon } from "./kit/icons";
import { ForumRounded as RoomIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip } from "./kit/ax";
import { GizmoXLockup, GizmoXMark } from "./gizmox-kit";
import { playChime, playOutgoing, playRing, CHIME } from "./lib/chime";
import type { CallSession, CallSignal, Profile, RoomRing, VideoChatSettings } from "./lib/types";
import { MEDIA_FAILURE_USER_COPY } from "./lib/mediaContract";
import type { MediaKind, MediaRoomSnapshot } from "./lib/mediaContract";
import {
  failureCopy,
  isPublishDenied,
  mediaApiPost,
  probeMediaHealth,
  reconnectDelayMs,
  sleep,
  useMediaHealth,
} from "./lib/mediaHealth";
import AvatarView from "./Avatar";
import { useAnimationIntensity } from "./Splash";
import { amberxvidPrefs, useAmberxvidPrefs } from "./settings";
import type { AmberxvidPrefs, PrefKey } from "./lib/prefs";

/* ---------------------------------- settings ---------------------------------- */

/**
 * The call's six settings are the SETTINGS TREE's, as of P16 (2026-08-15).
 *
 * They used to be a `localStorage` document (`gx:amberxvid:videochat`) with its
 * own defaults, and that had to end the moment the tree grew a DEVICES group:
 * two stores holding one camera id is a picker that edits the copy the call
 * does not read. So `VideoChatSettings` is now a VIEW over the per-member
 * preferences — one document, per accounts user, on the accounts spine — and
 * this dialog and the Settings stage write the same six keys.
 *
 * The type is kept (rather than replaced with `AmberxvidPrefs` throughout)
 * because it is the vocabulary the engine, the dialog and the media
 * constraints all speak, and it names exactly the six values a call cares
 * about out of the nineteen the tree holds.
 */
const PREF_OF: Record<keyof Omit<VideoChatSettings, "version">, PrefKey> = {
  cameraId: "cameraId",
  micId: "micId",
  resolution: "callResolution",
  maxKbps: "uplinkCapKbps",
  alertSound: "ringAlerts",
  ringVolume: "ringVolume",
};

function settingsFrom(prefs: AmberxvidPrefs): VideoChatSettings {
  return {
    version: 1,
    cameraId: prefs.cameraId,
    micId: prefs.micId,
    resolution: prefs.callResolution,
    maxKbps: prefs.uplinkCapKbps,
    alertSound: prefs.ringAlerts,
    ringVolume: prefs.ringVolume,
  };
}

/* ----------------------------------- engine ------------------------------------ */

export type CallPhase =
  | "idle"
  | "incoming"
  | "outgoing"
  | "connecting"
  | "active"
  | "ended";

/** Neither side answered in this window — the ring gives up honestly. */
const RING_TIMEOUT_MS = 45_000;

/** How often the chime repeats. Longer than the chime's own tail, so a ring
 *  reads as one continuous thing rather than a run of unrelated beeps. */
const RING_REPEAT_MS = 3_000;

export interface VideoChatEngine {
  phase: CallPhase;
  /** The other participant's username (null when idle). */
  peer: string | null;
  /** P11: the media leg died mid-call and the backoff loop is rejoining the
   *  SAME P3 room record — the call is not over, and the UI says which. */
  reconnecting: boolean;
  isCaller: boolean;
  micMuted: boolean;
  camOff: boolean;
  /** The far side's SERVER-KNOWN state: their producer is paused on the SFU,
   *  read from the announced snapshot — never from a peer data channel. */
  peerMicMuted: boolean;
  peerCamOff: boolean;
  elapsedS: number;
  endInfo: { reason: string; peer: string } | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  settings: VideoChatSettings;
  settingsOpen: boolean;
  startCall: (user: string) => Promise<void>;
  accept: () => Promise<void>;
  reject: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  saveSettings: (patch: Partial<VideoChatSettings>) => void;
  dismissEnd: () => void;
  /**
   * P13 — the "join my room" ring currently on screen, or null.
   *
   * It is held on the CALL engine rather than on the rooms engine on purpose:
   * this is the surface that owns ringing, the chime, the timeout and the tray
   * balloon, and a second ring implementation living next door is how the two
   * would drift. What the accepter is landed IN belongs to the rooms engine,
   * and reaches this one as the `joinRoom` callback and nothing else.
   */
  roomRing: RoomRing | null;
  acceptRoomRing: () => Promise<void>;
  declineRoomRing: () => void;
  /** Feed one SSE room-ring in — wired by the module shell. */
  handleRoomRing: (ring: RoomRing) => void;
  /** Feed one SSE call signal in — wired by the module shell. */
  handleSignal: (signal: CallSignal) => void;
  /** Feed one SSE `room-media` announcement in — wired by the module shell.
   *  Snapshots for rooms other than the live call are ignored. */
  handleRoomMedia: (roomId: string, snapshot: MediaRoomSnapshot) => void;
}

/** What the media route answers — loosely typed on purpose: every field the
 *  client forwards to mediasoup-client is opaque vocabulary it never parses. */
type MediaReply = Record<string, unknown>;

export function useVideoChat({
  me,
  notify,
  onRingAlert,
  joinRoom,
}: {
  me: string;
  notify: (msg: string) => void;
  /**
   * P13 — raise a DESKTOP notification for an incoming ring, used only when
   * the tab is backgrounded. The shell wires it to the tray link; the engine
   * deliberately does not know what a tray is, so a second implementation
   * (a browser Notification, a title-bar flash) is a shell change and not an
   * engine change.
   */
  onRingAlert?: (text: string) => void;
  /** P13 — land the member in a P11 group room after they accept its ring.
   *  Owned by the rooms engine; this one only decides that they said yes. */
  joinRoom?: (roomId: string) => Promise<void> | void;
}): VideoChatEngine {
  const [phase, setPhase] = React.useState<CallPhase>("idle");
  const [peer, setPeer] = React.useState<string | null>(null);
  const [isCaller, setIsCaller] = React.useState(false);
  const [micMuted, setMicMuted] = React.useState(false);
  const [camOff, setCamOff] = React.useState(false);
  const [peerMicMuted, setPeerMicMuted] = React.useState(false);
  const [peerCamOff, setPeerCamOff] = React.useState(false);
  const [elapsedS, setElapsedS] = React.useState(0);
  const [endInfo, setEndInfo] = React.useState<VideoChatEngine["endInfo"]>(null);
  const [localStream, setLocalStream] = React.useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = React.useState<MediaStream | null>(null);
  const prefs = useAmberxvidPrefs();
  const settings = React.useMemo(() => settingsFrom(prefs), [prefs]);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [reconnecting, setReconnecting] = React.useState(false);
  const [roomRing, setRoomRing] = React.useState<RoomRing | null>(null);

  // No hydration effect any more: the settings store's own lazy kv read lands
  // as an ordinary notification, and `useAmberxvidPrefs` re-renders on it. The
  // first frame is the DECLARED defaults on both server and client, which is
  // what keeps hydration from tearing (`ModuleSettingsStore.getServerState`).

  /* ------- live refs: async media handlers must never act on stale state -------- */

  const callIdRef = React.useRef<string | null>(null);
  const participantIdRef = React.useRef<string | null>(null);
  const deviceRef = React.useRef<Device | null>(null);
  const sendTransportRef = React.useRef<Transport | null>(null);
  const recvTransportRef = React.useRef<Transport | null>(null);
  /** Our own upstreams, by kind — what the mute toggles pause. */
  const producersRef = React.useRef<Partial<Record<MediaKind, Producer>>>({});
  /** producerId → consumer ("pending" while its consume round-trip is in
   *  flight, so a burst of announcements cannot double-subscribe). */
  const consumersRef = React.useRef<Map<string, Consumer | "pending">>(new Map());
  /** An announcement that arrived before the recv transport existed — played
   *  back once the transport is up. */
  const pendingSnapshotRef = React.useRef<MediaRoomSnapshot | null>(null);
  const localStreamRef = React.useRef<MediaStream | null>(null);
  const ringTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const ringDeadline = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  /** The room ring's own deadline — a separate clock from the call's, because
   *  the two can be live at once and each has to give up on its own schedule. */
  const roomRingDeadline = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped to cancel a running reconnect loop; truthy flag while one runs. */
  const reconnectSeq = React.useRef(0);
  const reconnectingRef = React.useRef(false);

  const live = React.useRef({ phase, peer, isCaller, micMuted, camOff, settings });
  live.current = { phase, peer, isCaller, micMuted, camOff, settings };

  // The two shell-owned callbacks, held as refs so the engine's own callbacks
  // never re-create themselves when the shell re-renders around them.
  const onRingAlertRef = React.useRef<((text: string) => void) | undefined>(onRingAlert);
  onRingAlertRef.current = onRingAlert;
  const joinRoomRef = React.useRef<((roomId: string) => Promise<void> | void) | undefined>(joinRoom);
  joinRoomRef.current = joinRoom;
  /** The room ring's chime loop — its own, so a room ring arriving during a
   *  call ring cannot silence the one that was already going. */
  const roomRingTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  /* ----------------------------------- sounds ----------------------------------- */

  /**
   * P13 — the audible ring, and the desktop alert that goes with it.
   *
   * The chime itself lives in `lib/chime` (the score AND the player), so the
   * settings dialog's test button plays the identical sound rather than an
   * approximation of it. What stays here is the CEREMONY: the repeat, the
   * member's own switch and volume, and the one-shot tray balloon.
   *
   * The balloon fires ONCE per ring and only while the tab is hidden. Once,
   * because a notification that re-fires every three seconds is a notification
   * a member turns off at the OS; and only while hidden, because a member
   * looking at the ringing window does not need Windows to tell them about it.
   */
  const startRing = React.useCallback(
    (incoming: boolean, alertText?: string) => {
      if (ringTimer.current) clearInterval(ringTimer.current);
      const play = () => {
        const s = live.current.settings;
        if (!incoming) {
          playOutgoing();
          return;
        }
        if (!s.alertSound) return;
        playRing(s.ringVolume);
      };
      play();
      ringTimer.current = setInterval(play, RING_REPEAT_MS);
      if (incoming && alertText && typeof document !== "undefined" && document.hidden) {
        onRingAlertRef.current?.(alertText);
      }
    },
    [],
  );

  const stopRing = React.useCallback(() => {
    if (ringTimer.current) {
      clearInterval(ringTimer.current);
      ringTimer.current = null;
    }
    if (ringDeadline.current) {
      clearTimeout(ringDeadline.current);
      ringDeadline.current = null;
    }
  }, []);

  /* --------------------------------- plumbing ------------------------------------ */

  const postSignal = React.useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch("/api/amberxvid/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "signal", callId: callIdRef.current, ...body }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  /** One POST to the media API — the shared helper (P11), whose refusals
   *  carry the closed `MediaFailure` vocabulary, so callers can tell
   *  `publish-denied` from a fault and pick the honest sentence. */
  const mediaPost = React.useCallback(
    (body: Record<string, unknown>): Promise<MediaReply> => mediaApiPost(body),
    [],
  );

  /** Tear down every media-plane handle and vacate the seat (best-effort —
   *  closing the WS channel vacates it server-side anyway). */
  const teardownMedia = React.useCallback(() => {
    for (const c of consumersRef.current.values()) {
      if (typeof c !== "string") {
        try {
          c.close();
        } catch {
          /* already closed */
        }
      }
    }
    consumersRef.current.clear();
    producersRef.current = {};
    try {
      sendTransportRef.current?.close();
    } catch {
      /* already closed */
    }
    try {
      recvTransportRef.current?.close();
    } catch {
      /* already closed */
    }
    sendTransportRef.current = null;
    recvTransportRef.current = null;
    deviceRef.current = null;
    pendingSnapshotRef.current = null;
    const pid = participantIdRef.current;
    participantIdRef.current = null;
    if (pid) {
      void fetch("/api/amberxvid/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave", participantId: pid }),
      }).catch(() => undefined);
    }
  }, []);

  const teardown = React.useCallback(
    (end: { reason: string; peer: string } | null) => {
      stopRing();
      reconnectSeq.current += 1; // cancel any running reconnect loop
      reconnectingRef.current = false;
      setReconnecting(false);
      if (elapsedTimer.current) {
        clearInterval(elapsedTimer.current);
        elapsedTimer.current = null;
      }
      teardownMedia();
      callIdRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setMicMuted(false);
      setCamOff(false);
      setPeerMicMuted(false);
      setPeerCamOff(false);
      setElapsedS(0);
      setEndInfo(end);
      setPhase(end ? "ended" : "idle");
      if (!end) setPeer(null);
    },
    [stopRing, teardownMedia],
  );

  // Leaving the module mid-call must hang up, not orphan the camera or the seat.
  React.useEffect(() => {
    return () => {
      if (callIdRef.current) {
        void fetch("/api/amberxvid/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "signal", callId: callIdRef.current, kind: "hangup", reason: "hangup" }),
        }).catch(() => undefined);
      }
      teardown(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acquireMedia = React.useCallback(async (): Promise<MediaStream> => {
    const s = live.current.settings;
    const [w, h] = s.resolution.split("x").map(Number);
    const video: MediaTrackConstraints = { width: { ideal: w }, height: { ideal: h } };
    // `ideal`, not `exact`, since P16 moved the device ids onto the per-ACCOUNT
    // store: a deviceId is a machine's, so a member signing in on a second
    // machine carries an id that resolves to nothing there. `exact` turns that
    // into `OverconstrainedError` and a call that will not start; `ideal` turns
    // it into the default camera, which is what they would have picked anyway.
    if (s.cameraId !== "default") video.deviceId = { ideal: s.cameraId };
    const audio: MediaTrackConstraints = {};
    if (s.micId !== "default") audio.deviceId = { ideal: s.micId };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  /* ------------------------------ the media plane -------------------------------- */

  /** Rebuild the remote MediaStream from every live consumer's track — one
   *  state write per change, so the <video> re-attaches exactly when the track
   *  set changes. */
  const syncRemoteStream = React.useCallback(() => {
    const tracks: MediaStreamTrack[] = [];
    for (const c of consumersRef.current.values()) {
      if (typeof c !== "string" && !c.closed) tracks.push(c.track);
    }
    setRemoteStream(tracks.length > 0 ? new MediaStream(tracks) : null);
  }, []);

  /**
   * Reconcile against the server's announced truth: consume producers we do
   * not hold, drop consumers whose producer vanished, and read the far side's
   * server-known pause state. The snapshot is the WHOLE truth per announcement
   * — this never interprets deltas, so a missed event costs nothing once the
   * next one lands.
   */
  const reconcile = React.useCallback(
    async (snapshot: MediaRoomSnapshot) => {
      const recv = recvTransportRef.current;
      const device = deviceRef.current;
      const pid = participantIdRef.current;
      if (!recv || !device || !pid) {
        pendingSnapshotRef.current = snapshot;
        return;
      }

      // In a 1:1 room every announced producer is the peer's — their paused
      // flags ARE the far side's mute state, straight from the server.
      setPeerMicMuted(snapshot.producers.some((p) => p.kind === "audio" && p.paused));
      setPeerCamOff(snapshot.producers.some((p) => p.kind === "video" && p.paused));

      const wanted = new Set(snapshot.producers.map((p) => p.producerId));
      let changed = false;
      for (const [producerId, consumer] of [...consumersRef.current]) {
        if (wanted.has(producerId)) continue;
        consumersRef.current.delete(producerId);
        if (typeof consumer !== "string") {
          try {
            consumer.close();
          } catch {
            /* already closed */
          }
          changed = true;
        }
      }

      for (const info of snapshot.producers) {
        if (consumersRef.current.has(info.producerId)) continue;
        consumersRef.current.set(info.producerId, "pending");
        try {
          const reply = await mediaPost({
            action: "consume",
            participantId: pid,
            transportId: recv.id,
            producerId: info.producerId,
            rtpCapabilities: device.rtpCapabilities,
          });
          // Torn down (or superseded) while the round-trip was in flight.
          if (recvTransportRef.current !== recv || !consumersRef.current.has(info.producerId)) continue;
          const consumer = await recv.consume({
            id: String(reply.consumerId),
            producerId: info.producerId,
            kind: reply.kind as "audio" | "video",
            rtpParameters: reply.rtpParameters as RtpParameters,
          });
          consumersRef.current.set(info.producerId, consumer);
          changed = true;
          // Created paused server-side (the black-tile rule) — resume now that
          // the client holds the consumer and its track.
          await mediaPost({ action: "resume", participantId: pid, consumerId: consumer.id });
        } catch {
          consumersRef.current.delete(info.producerId);
        }
      }
      if (changed) syncRemoteStream();
    },
    [mediaPost, syncRemoteStream],
  );

  const handleRoomMedia = React.useCallback(
    (roomId: string, snapshot: MediaRoomSnapshot) => {
      if (roomId !== callIdRef.current) return;
      void reconcile(snapshot);
    },
    [reconcile],
  );

  /**
   * P11 — the media leg died mid-call. NOT the end of the call: the P3 room
   * record outlives the media server (its heartbeats ride the presence SSE
   * stream), so this folds the media handles only and rejoins the SAME room
   * with backoff. The loop is unbounded by design — it ends when the call
   * record ends, the user hangs up, or the rejoin succeeds; a server that
   * comes back after two minutes still gets its room back. There is no
   * peer-to-peer fallback (`NO_FALLBACK_DECISION`).
   */
  const connectMediaRef = React.useRef<() => Promise<void>>(async () => undefined);
  const beginReconnect = React.useCallback(() => {
    const callId = callIdRef.current;
    if (!callId || reconnectingRef.current) return;
    reconnectingRef.current = true;
    setReconnecting(true);
    setPhase((p) => (p === "active" ? "connecting" : p));
    teardownMedia();
    const seq = ++reconnectSeq.current;
    const cancelled = (): boolean => reconnectSeq.current !== seq || callIdRef.current !== callId;
    void (async () => {
      for (let attempt = 0; ; attempt += 1) {
        await sleep(reconnectDelayMs(attempt));
        if (cancelled()) return;
        // The record is the authority: a call that ended while the media
        // server was away is an ended call, not a retry target.
        try {
          const res = await fetch("/api/amberxvid/calls");
          const json = (await res.json().catch(() => null)) as { ok?: boolean; call?: CallSession | null } | null;
          if (res.ok && json?.ok) {
            const call = json.call;
            const alive = call && call.id === callId && (call.state === "active" || call.state === "connecting");
            if (!alive) {
              if (cancelled()) return;
              notify("The call ended while the media server was away");
              teardown({ reason: "ended", peer: live.current.peer ?? "" });
              return;
            }
          }
        } catch {
          /* the app server hiccupped — keep trying, the record may be fine */
        }
        if (cancelled()) return;
        const health = await probeMediaHealth();
        if (cancelled()) return;
        if (!health.up) continue;
        try {
          await connectMediaRef.current();
          if (cancelled()) return;
          reconnectingRef.current = false;
          setReconnecting(false);
          notify("Reconnected — the call is back on the media server");
          return;
        } catch {
          // It answered /health but the rejoin failed partway — fold any
          // half-built handles so the next attempt starts clean.
          if (!cancelled()) teardownMedia();
        }
      }
    })();
  }, [notify, teardown, teardownMedia]);

  /**
   * The whole transport half, in call order: join the room the ring ceremony
   * agreed on (the call id IS the P3 room id), load the device, build the send
   * and recv transports, publish ONE upstream per kind, and consume everything
   * announced so far. Replaces the mesh's offer/answer dance entirely.
   */
  const connectMedia = React.useCallback(async () => {
    const callId = callIdRef.current;
    if (!callId) return;

    const joined = await mediaPost({ action: "join", roomId: callId });
    if (callIdRef.current !== callId) return; // torn down while joining
    const pid = String(joined.participantId);
    participantIdRef.current = pid;

    const { Device: MediaDevice } = await import("mediasoup-client");
    const device = new MediaDevice();
    await device.load({ routerRtpCapabilities: joined.routerRtpCapabilities as RtpCapabilities });
    deviceRef.current = device;

    const transportParams = (reply: MediaReply) => ({
      id: String(reply.transportId),
      iceParameters: reply.iceParameters as IceParameters,
      iceCandidates: reply.iceCandidates as IceCandidate[],
      dtlsParameters: reply.dtlsParameters as DtlsParameters,
    });
    const wireTransport = (transport: Transport) => {
      transport.on("connect", ({ dtlsParameters }: { dtlsParameters: DtlsParameters }, callback, errback) => {
        mediaPost({ action: "connect", participantId: pid, transportId: transport.id, dtlsParameters })
          .then(() => callback())
          .catch((err: Error) => errback(err));
      });
      transport.on("connectionstatechange", (state) => {
        if (callIdRef.current !== callId) return;
        // P11: a dead media leg is a RECONNECT, not a hangup — the room
        // record is still live and the server rebuilds the room at rejoin.
        if (state === "failed") {
          notify(MEDIA_FAILURE_USER_COPY["transport-failed"]);
          beginReconnect();
        } else if (state === "disconnected") {
          // Might be a blip. Ask /health instead of guessing: a down server
          // starts the loop now rather than after ICE's slow failure clock.
          void probeMediaHealth().then((h) => {
            if (!h.up && callIdRef.current === callId) {
              notify(MEDIA_FAILURE_USER_COPY["transport-failed"]);
              beginReconnect();
            }
          });
        }
      });
    };

    const sendReply = await mediaPost({ action: "transport", participantId: pid, direction: "send" });
    if (callIdRef.current !== callId) return;
    const sendTransport = device.createSendTransport(transportParams(sendReply));
    wireTransport(sendTransport);
    sendTransport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
      const mediaKind = typeof appData?.mediaKind === "string" ? appData.mediaKind : kind;
      mediaPost({ action: "produce", participantId: pid, transportId: sendTransport.id, kind: mediaKind, rtpParameters })
        .then((reply) => callback({ id: String(reply.producerId) }))
        .catch((err: Error) => errback(err));
    });
    sendTransportRef.current = sendTransport;

    const recvReply = await mediaPost({ action: "transport", participantId: pid, direction: "recv" });
    if (callIdRef.current !== callId) return;
    const recvTransport = device.createRecvTransport(transportParams(recvReply));
    wireTransport(recvTransport);
    recvTransportRef.current = recvTransport;

    // ONE upstream per kind (MEDIA_CONTRACT.topology.upstream): the camera and
    // the mic. The bandwidth cap is an encoding parameter now — set at
    // produce, no renegotiation to apply it through.
    const stream = localStreamRef.current ?? (await acquireMedia());
    if (callIdRef.current !== callId) return;
    const kbps = live.current.settings.maxKbps;
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    try {
      if (videoTrack) {
        producersRef.current.video = await sendTransport.produce({
          track: videoTrack,
          encodings: kbps > 0 ? [{ maxBitrate: kbps * 1000 }] : undefined,
          appData: { mediaKind: "video" },
        });
      }
      if (audioTrack) {
        producersRef.current.audio = await sendTransport.produce({
          track: audioTrack,
          appData: { mediaKind: "audio" },
        });
      }
    } catch (err) {
      // P11: `publish-denied` is not an error — this seat's role does not
      // broadcast, so the call continues consume-only with the honest words.
      if (!isPublishDenied(err)) throw err;
      notify(MEDIA_FAILURE_USER_COPY["publish-denied"]);
    }

    // A reconnect resumes into the same room record WITH its old toggles: a
    // muted participant must come back muted, server-known, not hot.
    for (const [kind, wasOff] of [["audio", live.current.micMuted], ["video", live.current.camOff]] as const) {
      if (!wasOff) continue;
      const tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
      for (const t of tracks) t.enabled = false;
      if (producersRef.current[kind]) {
        void mediaPost({ action: "pause", participantId: pid, kind, paused: true }).catch(() => undefined);
      }
    }

    // Consume what the join snapshot announced, then re-pull once: anything
    // announced between the join reply and the push wire coming up is caught
    // here, so the gap costs one request instead of a black tile.
    await reconcile(joined.snapshot as MediaRoomSnapshot);
    const fresh = await mediaPost({ action: "snapshot", participantId: pid });
    if (callIdRef.current !== callId) return;
    await reconcile(fresh.snapshot as MediaRoomSnapshot);
    if (pendingSnapshotRef.current) {
      const pending = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
      await reconcile(pending);
    }

    if (callIdRef.current === callId) setPhase((p) => (p === "connecting" ? "active" : p));
  }, [acquireMedia, beginReconnect, mediaPost, notify, reconcile]);
  connectMediaRef.current = connectMedia;

  /** connectMedia with the one shared failure path: say WHICH failure in the
   *  P11 vocabulary, tell the peer, tear down. */
  const startMedia = React.useCallback(() => {
    void connectMedia().catch((err) => {
      notify(`Couldn't connect — ${failureCopy(err)}`);
      void postSignal({ kind: "hangup", reason: "failed" });
      teardown({ reason: "failed", peer: live.current.peer ?? "" });
    });
  }, [connectMedia, notify, postSignal, teardown]);

  /* ---------------------------------- actions ----------------------------------- */

  const startCall = React.useCallback(
    async (user: string) => {
      if (live.current.phase !== "idle") {
        notify("You're already in a call");
        return;
      }
      // P11: probe the media server BEFORE ringing anyone. A dead server is a
      // fast named refusal here — not a ring, a camera prompt and a spinner.
      const health = await probeMediaHealth();
      if (!health.up) {
        notify(MEDIA_FAILURE_USER_COPY["server-unreachable"]);
        return;
      }
      try {
        const res = await fetch("/api/amberxvid/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "invite", to: user }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; callId?: string; error?: string; unavailable?: boolean }
          | null;
        if (!res.ok || !json?.ok || !json.callId) {
          // P13: `unavailable` is the do-not-disturb answer, and it is not a
          // failure — the ring was never written, the missed call is already in
          // their inbox, and the caller is told so in one sentence instead of
          // being left listening to a ring nobody can hear.
          notify(json?.error ?? "The call didn't start");
          return;
        }
        callIdRef.current = json.callId;
        setPeer(user);
        setIsCaller(true);
        setEndInfo(null);
        setPhase("outgoing");
        startRing(false);
        ringDeadline.current = setTimeout(() => {
          void postSignal({ kind: "hangup", reason: "timeout" });
          notify("No answer");
          teardown({ reason: "timeout", peer: user });
        }, RING_TIMEOUT_MS);
      } catch {
        notify("The call service did not answer");
      }
    },
    [notify, postSignal, startRing, teardown],
  );

  const accept = React.useCallback(async () => {
    // P11: the same door probe as startCall — answering onto a dead media
    // server would grab the camera and hang. The ring keeps ringing; the
    // caller learns nothing false.
    const health = await probeMediaHealth();
    if (!health.up) {
      notify(MEDIA_FAILURE_USER_COPY["server-unreachable"]);
      return;
    }
    stopRing();
    setPhase("connecting");
    try {
      await acquireMedia();
    } catch (err) {
      const why = err instanceof Error ? err.message : "camera/mic unavailable";
      notify(`Couldn't answer — ${why}`);
      void postSignal({ kind: "hangup", reason: "failed" });
      teardown({ reason: "failed", peer: live.current.peer ?? "" });
      return;
    }
    await postSignal({ kind: "accept" });
    startMedia();
  }, [acquireMedia, notify, postSignal, startMedia, stopRing, teardown]);

  const reject = React.useCallback(() => {
    void postSignal({ kind: "reject", reason: "declined" });
    teardown(null);
  }, [postSignal, teardown]);

  const hangup = React.useCallback(() => {
    void postSignal({ kind: "hangup", reason: "hangup" });
    teardown(null);
  }, [postSignal, teardown]);

  /** Server-known mute: pause the PRODUCER — the server stops fanning the
   *  upstream and announces it; disabling the local track is just the local
   *  echo of the same fact. */
  const setProducerPaused = React.useCallback(
    (kind: MediaKind, paused: boolean) => {
      const pid = participantIdRef.current;
      if (!pid || !producersRef.current[kind]) return;
      void mediaPost({ action: "pause", participantId: pid, kind, paused }).catch(() => {
        notify("The server didn't take the mute — it may not have applied");
      });
    },
    [mediaPost, notify],
  );

  const toggleMic = React.useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !live.current.micMuted;
    for (const t of stream.getAudioTracks()) t.enabled = !next;
    setProducerPaused("audio", next);
    setMicMuted(next);
    notify(next ? "Mic muted" : "Mic live");
  }, [notify, setProducerPaused]);

  const toggleCam = React.useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !live.current.camOff;
    for (const t of stream.getVideoTracks()) t.enabled = !next;
    setProducerPaused("video", next);
    setCamOff(next);
    notify(next ? "Camera off — audio continues" : "Camera on");
  }, [notify, setProducerPaused]);

  /**
   * Write straight through to the per-member store, one key at a time — it is
   * optimistic (state and listeners first, the PUT after), so the dialog is as
   * responsive as the `setState` this replaced and the value survives the tab.
   * `version` is not a setting and is dropped rather than translated.
   */
  const saveSettings = React.useCallback((patch: Partial<VideoChatSettings>) => {
    for (const [field, value] of Object.entries(patch)) {
      if (field === "version" || value === undefined) continue;
      const key = PREF_OF[field as keyof typeof PREF_OF];
      if (key) amberxvidPrefs.set(key, value as never);
    }
  }, []);

  const dismissEnd = React.useCallback(() => {
    setEndInfo(null);
    setPeer(null);
    setPhase("idle");
  }, []);

  /* ------------------------- P13: the "join my room" ring ------------------------- */

  /** Stop the room ring's chime and its deadline. Idempotent — the accept, the
   *  decline and the timeout all end up here. */
  const stopRoomRing = React.useCallback(() => {
    if (roomRingTimer.current) {
      clearInterval(roomRingTimer.current);
      roomRingTimer.current = null;
    }
    if (roomRingDeadline.current) {
      clearTimeout(roomRingDeadline.current);
      roomRingDeadline.current = null;
    }
  }, []);

  /**
   * Close the ring's history row. `timeout` is what turns it into a MISSED
   * invite and posts the note — which is why the client reports its own
   * deadline rather than letting the server guess: the server cannot tell an
   * unanswered ring from a browser that was closed.
   */
  const answerRoomRing = React.useCallback((ring: RoomRing, answer: "accept" | "decline" | "timeout") => {
    void fetch("/api/amberxvid/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ring-answer", ringId: ring.ringId, from: ring.from, answer }),
    }).catch(() => undefined);
  }, []);

  const handleRoomRing = React.useCallback(
    (ring: RoomRing) => {
      // One ring at a time. A second invitation while the first is on screen is
      // declined rather than queued: a stack of ring windows is how a member
      // ends up in a room they did not read the name of.
      if (roomRing) {
        answerRoomRing(ring, "decline");
        return;
      }
      setRoomRing(ring);
      const play = () => {
        const s = live.current.settings;
        if (s.alertSound) playRing(s.ringVolume);
      };
      play();
      roomRingTimer.current = setInterval(play, RING_REPEAT_MS);
      if (typeof document !== "undefined" && document.hidden) {
        onRingAlertRef.current?.(`${ring.fromDisplay} wants you in "${ring.title}"`);
      }
      roomRingDeadline.current = setTimeout(() => {
        stopRoomRing();
        setRoomRing(null);
        answerRoomRing(ring, "timeout");
        notify(`Missed room invite from ${ring.fromDisplay}`);
      }, RING_TIMEOUT_MS);
    },
    [answerRoomRing, notify, roomRing, stopRoomRing],
  );

  const acceptRoomRing = React.useCallback(async () => {
    const ring = roomRing;
    if (!ring) return;
    stopRoomRing();
    setRoomRing(null);
    // The row closes as ANSWERED before the join is attempted: the member did
    // answer, and a room that has since ended is a failed join, not a missed
    // invite. Conflating the two would put a "missed" row in front of somebody
    // who was looking right at it and clicked.
    answerRoomRing(ring, "accept");
    try {
      await joinRoomRef.current?.(ring.roomId);
    } catch {
      notify("That room is no longer open");
    }
  }, [answerRoomRing, notify, roomRing, stopRoomRing]);

  const declineRoomRing = React.useCallback(() => {
    const ring = roomRing;
    if (!ring) return;
    stopRoomRing();
    setRoomRing(null);
    answerRoomRing(ring, "decline");
  }, [answerRoomRing, roomRing, stopRoomRing]);

  // A member who navigates away mid-ring has not declined it — but they have
  // stopped hearing it, so the chime must not outlive the engine.
  React.useEffect(() => stopRoomRing, [stopRoomRing]);

  /* ------------------------------ the signal handler ----------------------------- */

  const handleSignal = React.useCallback(
    (signal: CallSignal) => {
      const p = live.current.phase;

      if (signal.kind === "invite") {
        if (p !== "idle") {
          // Already busy — decline this one without disturbing the live call.
          void fetch("/api/amberxvid/calls", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "signal", callId: signal.callId, kind: "reject", reason: "busy" }),
          }).catch(() => undefined);
          return;
        }
        callIdRef.current = signal.callId;
        setPeer(signal.from);
        setIsCaller(false);
        setEndInfo(null);
        setPhase("incoming");
        startRing(true, `Incoming video call from ${signal.from}`);
        ringDeadline.current = setTimeout(() => {
          // P13: a ring that ran out is a TIMEOUT, not a decline. It used to
          // post `reject/declined`, which told the caller "they said no" about
          // a member who was not at their desk — and, since P13 writes history
          // from these reasons, would have filed a missed call as a refusal on
          // both sides. `hangup/timeout` is the honest kind, and it is what
          // turns the callee's own row into a missed one with a note.
          void postSignal({ kind: "hangup", reason: "timeout" });
          notify(`Missed video call from ${signal.from}`);
          teardown(null);
        }, RING_TIMEOUT_MS);
        return;
      }

      if (signal.callId !== callIdRef.current) return;

      switch (signal.kind) {
        case "accept": {
          // The callee answered — the ceremony is done, the media plane takes
          // over. No offer to build, no SDP to relay: both sides simply join
          // the room the call id names.
          stopRing();
          setPhase("connecting");
          startMedia();
          break;
        }
        case "reject": {
          stopRing();
          notify(signal.reason === "busy" ? `${signal.from} is in another call` : `${signal.from} declined the call`);
          teardown({ reason: signal.reason, peer: signal.from });
          break;
        }
        case "hangup": {
          stopRing();
          notify(`${signal.from} ended the call`);
          teardown({ reason: signal.reason, peer: signal.from });
          break;
        }
      }
    },
    [notify, postSignal, startMedia, startRing, stopRing, teardown],
  );

  /* -------------------- re-learn a ring, or RESUME, after reload ------------------ */

  // A reloaded window re-learns of the live call it missed — the GET half of
  // the calls route exists for exactly this. An unanswered incoming ring rings
  // again; a call already past accept is RESUMED: the P3 room record survived
  // the reload (and the media server holds the room through its idle grace),
  // so this window joins the SAME room with a fresh seat instead of
  // renegotiating a call from zero. That resume is the second thing the SFU
  // gives this surface that the mesh could not.
  const handleSignalRef = React.useRef<(signal: CallSignal) => void>(() => undefined);
  handleSignalRef.current = handleSignal;
  const startMediaRef = React.useRef<() => void>(() => undefined);
  startMediaRef.current = startMedia;

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/amberxvid/calls");
        const json = (await res.json().catch(() => null)) as { ok?: boolean; call?: CallSession | null } | null;
        if (cancelled || !res.ok || !json?.ok || !json.call) return;
        const call = json.call;
        const meKey = me.toLowerCase();
        if (call.state === "ringing" && call.to.toLowerCase() === meKey) {
          handleSignalRef.current({ kind: "invite", callId: call.id, from: call.from, to: call.to, at: call.createdAt });
          return;
        }
        const mine = call.from.toLowerCase() === meKey || call.to.toLowerCase() === meKey;
        if (mine && (call.state === "active" || call.state === "connecting")) {
          const amCaller = call.from.toLowerCase() === meKey;
          callIdRef.current = call.id;
          setPeer(amCaller ? call.to : call.from);
          setIsCaller(amCaller);
          setEndInfo(null);
          setPhase("connecting");
          startMediaRef.current();
        }
      } catch {
        /* no live call to re-learn */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me]);

  /* ------------------------------ the elapsed clock ------------------------------- */

  React.useEffect(() => {
    if (phase !== "active") return;
    stopRing();
    elapsedTimer.current = setInterval(() => setElapsedS((s) => s + 1), 1_000);
    return () => {
      if (elapsedTimer.current) {
        clearInterval(elapsedTimer.current);
        elapsedTimer.current = null;
      }
    };
  }, [phase, stopRing]);

  return {
    phase,
    peer,
    reconnecting,
    isCaller,
    micMuted,
    camOff,
    peerMicMuted,
    peerCamOff,
    elapsedS,
    endInfo,
    localStream,
    remoteStream,
    settings,
    settingsOpen,
    startCall,
    accept,
    reject,
    hangup,
    toggleMic,
    toggleCam,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    saveSettings,
    dismissEnd,
    roomRing,
    acceptRoomRing,
    declineRoomRing,
    handleRoomRing,
    handleSignal,
    handleRoomMedia,
  };
}

/* -------------------------------- video surface -------------------------------- */

/** The module's one `<video>` implementation — the call window AND the stream
 *  room (`StreamRoom.tsx`) render through this. Exported for reuse, not for
 *  new bespoke video elements. */
export function VideoSurface({
  stream,
  muted,
  mirror,
  style,
}: {
  stream: MediaStream | null;
  muted: boolean;
  mirror?: boolean;
  style?: React.CSSProperties;
}) {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: mirror ? "scaleX(-1)" : undefined,
        ...style,
      }}
    />
  );
}

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/* --------------------------------- the window ---------------------------------- */

export interface VideoChatWindowProps {
  engine: VideoChatEngine;
  meScreenname: string;
  screennameFor: (user: string) => string;
  profiles: Record<string, Profile>;
}

export default function VideoChatWindow({ engine, meScreenname, screennameFor, profiles }: VideoChatWindowProps) {
  const intensity = useAnimationIntensity();
  const dur = intensity === "off" ? 0 : intensity === "subtle" ? 300 : intensity === "maximum" ? 900 : 550;
  const peerName = engine.peer ? screennameFor(engine.peer) : "";
  const peerProfile = engine.peer ? profiles[engine.peer.toLowerCase()] : undefined;
  const open = engine.phase !== "idle";
  const inCall = engine.phase === "connecting" || engine.phase === "active";
  // P11: the indicator reflects the media server's /health, never a guess —
  // polled while the window is open, so a dead server shows before a join.
  const health = useMediaHealth(open);

  /* ------------------------------- phase content -------------------------------- */

  const ringPulse = intensity !== "off" && {
    "@keyframes gxvRing": {
      "0%": { boxShadow: `0 0 0 0 ${gxa(GX.accent, "55")}` },
      "70%": { boxShadow: `0 0 0 ${intensity === "maximum" ? 26 : 16}px ${gxa(GX.accent, "00")}` },
      "100%": { boxShadow: `0 0 0 0 ${gxa(GX.accent, "00")}` },
    },
    animation: "gxvRing 1.6s ease-out infinite",
  };

  const ringing = (engine.phase === "incoming" || engine.phase === "outgoing") && (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, py: 5, px: 3 }}>
      <Box sx={{ borderRadius: "50%", ...(ringPulse || {}) }}>
        <AvatarView spec={peerProfile?.avatar ?? null} name={peerName} size={84} />
      </Box>
      <Box sx={{ textAlign: "center" }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700 }}>{peerName}</Typography>
        <Typography sx={{ fontSize: 12.5, color: GX.dim }}>
          {engine.phase === "incoming" ? "Incoming video call" : "Calling…"}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", gap: 1.5 }}>
        {engine.phase === "incoming" ? (
          <>
            <Button
              variant="contained"
              color="success"
              startIcon={<VideocamIcon />}
              onClick={() => void engine.accept()}
              data-el-id="amberxvid:call:accept"
            >
              Answer
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<CloseIcon />}
              onClick={engine.reject}
              data-el-id="amberxvid:call:decline"
            >
              Decline
            </Button>
          </>
        ) : (
          <Button
            variant="outlined"
            color="error"
            startIcon={<CloseIcon />}
            onClick={engine.hangup}
            data-el-id="amberxvid:call:cancel"
          >
            Cancel
          </Button>
        )}
      </Box>
      <GizmoXLockup mark={22} />
    </Box>
  );

  // Honest by design (MEDIA_CONTRACT.path): every leg terminates on the media
  // server, so the badge names the architecture — and since P11 it reflects
  // the server's /health rather than assuming it: down is said, in red.
  const badge = engine.reconnecting ? (
    <GxChip label="media server unreachable — reconnecting…" kind="err" />
  ) : health !== null && !health.up ? (
    <GxChip label="media server offline" kind="err" />
  ) : engine.phase === "active" ? (
    <GxChip label="AmberX media server" kind="ok" />
  ) : (
    <GxChip label="connecting…" kind="dim" />
  );

  const connectSweep = engine.phase === "active" && intensity !== "off" && (
    <Box
      aria-hidden
      sx={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        "@keyframes gxvSweep": {
          "0%": { transform: "translateX(-100%)", opacity: 0.9 },
          "100%": { transform: "translateX(100%)", opacity: 0 },
        },
        "&::after": {
          content: '""',
          position: "absolute",
          inset: 0,
          background: `linear-gradient(105deg, transparent 30%, ${gxa(GX.accent, "44")} 50%, transparent 70%)`,
          animation: `gxvSweep ${dur * 2}ms ease-out 1`,
        },
      }}
    />
  );

  const stage = inCall && (
    <Box sx={{ position: "relative", height: 460, bgcolor: "#000", overflow: "hidden" }}>
      {/* remote — the star of the stage */}
      {engine.remoteStream ? (
        <VideoSurface stream={engine.remoteStream} muted={false} />
      ) : (
        <Box sx={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.5, px: 4 }}>
          <GizmoXMark size={54} glow={intensity !== "off"} />
          <CircularProgress size={18} />
          {engine.reconnecting ? (
            // P11: the specific sentence, not a spinner that never resolves —
            // what is wrong, and that the rejoin is automatic.
            <Typography
              sx={{ fontSize: 12, color: GX.warn, textAlign: "center", maxWidth: 420 }}
              data-el-id="amberxvid:call:media-down"
            >
              {MEDIA_FAILURE_USER_COPY["transport-failed"]} Your call rejoins the room by itself when
              the media server is back.
            </Typography>
          ) : (
            <Typography sx={{ fontSize: 11.5, color: GX.dim, fontFamily: GX.mono }}>
              connecting to the media server…
            </Typography>
          )}
        </Box>
      )}

      {/* local PiP */}
      {engine.localStream && (
        <Box
          sx={{
            position: "absolute",
            right: 12,
            bottom: 12,
            width: 168,
            height: 96,
            borderRadius: 1.5,
            overflow: "hidden",
            border: `1px solid ${gxa(GX.accent, "66")}`,
            boxShadow: `0 4px 18px #000a`,
            opacity: engine.camOff ? 0.35 : 1,
          }}
        >
          <VideoSurface stream={engine.localStream} muted mirror />
        </Box>
      )}

      {/* brand watermark on the live stage */}
      <Box sx={{ position: "absolute", left: 12, top: 10, display: "flex", alignItems: "center", gap: 1, opacity: 0.85 }}>
        <GizmoXMark size={18} glow={false} ring="transparent" />
        <Typography sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.2, color: GX.ink }}>
          AMBERX VID · {peerName}
        </Typography>
      </Box>

      {/* the far side's SERVER-KNOWN state — read from the announced snapshot,
          which is what makes a mute visible without the peer sending a word */}
      {(engine.peerMicMuted || engine.peerCamOff) && (
        <Box sx={{ position: "absolute", right: 12, top: 10, display: "flex", gap: 0.75 }}>
          {engine.peerMicMuted && <GxChip label={`${peerName} muted`} kind="warn" />}
          {engine.peerCamOff && <GxChip label="camera off" kind="dim" />}
        </Box>
      )}

      {connectSweep}
    </Box>
  );

  const controls = inCall && (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderTop: `1px solid ${GX.edge}` }}>
      {badge}
      {engine.phase === "active" && (
        <Typography sx={{ fontFamily: GX.mono, fontSize: 11, color: GX.dim, fontVariantNumeric: "tabular-nums" }}>
          {fmtElapsed(engine.elapsedS)}
        </Typography>
      )}
      <Box sx={{ flex: 1 }} />
      <Tooltip title={engine.micMuted ? "Unmute mic" : "Mute mic"}>
        <IconButton size="small" onClick={engine.toggleMic} data-el-id="amberxvid:call:mic" sx={{ color: engine.micMuted ? GX.err : GX.ink }}>
          {engine.micMuted ? <MicOffIcon sx={{ fontSize: 18 }} /> : <MicOnIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Tooltip>
      <Tooltip title={engine.camOff ? "Camera on" : "Camera off"}>
        <IconButton size="small" onClick={engine.toggleCam} data-el-id="amberxvid:call:cam" sx={{ color: engine.camOff ? GX.err : GX.ink }}>
          {engine.camOff ? <VideocamOffIcon sx={{ fontSize: 18 }} /> : <VideocamIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Tooltip>
      <Tooltip title="Video-chat settings">
        <IconButton size="small" onClick={engine.openSettings} data-el-id="amberxvid:call:settings">
          <SettingsIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Button
        size="small"
        variant="contained"
        color="error"
        startIcon={<CallMadeIcon style={{ transform: "rotate(135deg)" }} />}
        onClick={engine.hangup}
        data-el-id="amberxvid:call:hangup"
      >
        End call
      </Button>
    </Box>
  );

  const ended = engine.phase === "ended" && engine.endInfo && (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, py: 4, px: 3, textAlign: "center" }}>
      <GizmoXMark size={40} glow={false} />
      <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
        {engine.endInfo.reason === "timeout"
          ? "No answer"
          : engine.endInfo.reason === "busy"
            ? `${screennameFor(engine.endInfo.peer)} is in another call`
            : engine.endInfo.reason === "declined"
              ? "Call declined"
              : engine.endInfo.reason === "failed"
                ? "The media link failed"
                : "Call ended"}
      </Typography>
      <Button variant="outlined" onClick={engine.dismissEnd} data-el-id="amberxvid:call:dismiss">
        Close
      </Button>
    </Box>
  );

  return (
    <>
      <Dialog
        open={open}
        maxWidth="md"
        fullWidth
        onClose={engine.phase === "ended" ? engine.dismissEnd : undefined}
        slotProps={{ paper: { sx: { bgcolor: GX.bg, border: `1px solid ${gxa(GX.accent, "44")}`, overflow: "hidden" } } }}
      >
        {/* branded header strip */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 0.75,
            borderBottom: `1px solid ${GX.edge}`,
            background: `linear-gradient(135deg, ${GX.panel} 0%, ${gxa(GX.accent, "18")} 100%)`,
          }}
        >
          <GizmoXMark size={20} glow={false} ring="transparent" />
          <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>Video chat</Typography>
          <Typography sx={{ fontFamily: GX.mono, fontSize: 10, color: GX.dim }}>
            {meScreenname} ↔ {peerName || "…"}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {inCall && badge}
        </Box>
        {ringing}
        {stage}
        {controls}
        {ended}
      </Dialog>

      <RoomRingDialog engine={engine} intensity={intensity} />
      <VideoChatSettingsDialog engine={engine} />
    </>
  );
}

/* ------------------------------ the room-ring window ---------------------------- */

/**
 * "Join my room" (P13) — the same ceremony as a call's ring, on its own dialog.
 *
 * Its own rather than a mode of the call window, because the two can be live at
 * the same moment: somebody may ring you into a meeting while a call is
 * connecting, and a shared dialog would have had to pick one to show. Two
 * dialogs stack, and MUI puts the newer one on top, which is the right answer
 * for the ring that just started making a noise.
 */
function RoomRingDialog({
  engine,
  intensity,
}: {
  engine: VideoChatEngine;
  intensity: ReturnType<typeof useAnimationIntensity>;
}) {
  const ring = engine.roomRing;
  const pulse = intensity !== "off" && {
    "@keyframes gxvRoomRing": {
      "0%": { boxShadow: `0 0 0 0 ${gxa(GX.accent, "55")}` },
      "70%": { boxShadow: `0 0 0 ${intensity === "maximum" ? 26 : 16}px ${gxa(GX.accent, "00")}` },
      "100%": { boxShadow: `0 0 0 0 ${gxa(GX.accent, "00")}` },
    },
    animation: "gxvRoomRing 1.6s ease-out infinite",
  };

  return (
    <Dialog
      open={ring !== null}
      maxWidth="xs"
      fullWidth
      // No backdrop dismissal: closing this by clicking beside it would leave
      // the ring's history row open until its own timeout, and the member would
      // have "missed" a call they deliberately waved away.
      onClose={() => undefined}
      slotProps={{ paper: { sx: { bgcolor: GX.bg, border: `1px solid ${gxa(GX.accent, "44")}` } } }}
    >
      {ring && (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.75, py: 4, px: 3 }}>
          <Box
            sx={{
              borderRadius: "50%",
              width: 84,
              height: 84,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${gxa(GX.accent, "66")}`,
              ...(pulse || {}),
            }}
          >
            <RoomIcon sx={{ fontSize: 38, color: GX.accent }} />
          </Box>
          <Box sx={{ textAlign: "center" }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700 }}>{ring.fromDisplay}</Typography>
            <Typography sx={{ fontSize: 12.5, color: GX.dim }}>wants you in a room</Typography>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: GX.accent, mt: 0.75 }}>
              {ring.title}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1.5 }}>
            <Button
              variant="contained"
              color="success"
              startIcon={<VideocamIcon />}
              onClick={() => void engine.acceptRoomRing()}
              data-el-id="amberxvid:roomring:accept"
            >
              Join
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<CloseIcon />}
              onClick={engine.declineRoomRing}
              data-el-id="amberxvid:roomring:decline"
            >
              Not now
            </Button>
          </Box>
          <GizmoXLockup mark={22} />
        </Box>
      )}
    </Dialog>
  );
}

/* ------------------------------- settings dialog -------------------------------- */

/**
 * The dedicated video-chat settings dialog — its own surface by explicit
 * directive (not sui bloat): devices, resolution and the bandwidth cap, and
 * the ring sound. The mesh-era dials (pin confirmation, forced relay and its
 * loopback proof) died with the transport they proved things about — see the
 * file header.
 */
function VideoChatSettingsDialog({ engine }: { engine: VideoChatEngine }) {
  const s = engine.settings;
  const [devices, setDevices] = React.useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({
    cams: [],
    mics: [],
  });

  React.useEffect(() => {
    if (!engine.settingsOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setDevices({
          cams: all.filter((d) => d.kind === "videoinput"),
          mics: all.filter((d) => d.kind === "audioinput"),
        });
      } catch {
        /* the "default device" options still work */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine.settingsOpen]);

  const row = (label: string, help: string, control: React.ReactNode) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.75, borderBottom: `1px solid ${gxa(GX.edge, "44")}` }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{label}</Typography>
        <Typography sx={{ fontSize: 10.5, color: GX.dim }}>{help}</Typography>
      </Box>
      {control}
    </Box>
  );

  const deviceLabel = (d: MediaDeviceInfo, i: number, kind: string) =>
    d.label || `${kind} ${i + 1}`;

  return (
    <Dialog
      open={engine.settingsOpen}
      onClose={engine.closeSettings}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { bgcolor: GX.bg, border: `1px solid ${GX.edge}` } } }}
    >
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <VideocamIcon sx={{ fontSize: 18, color: GX.accent }} />
          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Video-chat settings</Typography>
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={engine.closeSettings} data-el-id="amberxvid:vcset:close">
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
        <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
          These apply from the next call, and they are yours on this account — the same values the
          Settings stage shows, where the camera preview and the level meter are. Calls are relayed
          by the AmberX Vid media server.
        </Typography>

        {row(
          "Camera",
          "Which camera joins the call",
          <TextField
            select
            size="small"
            value={s.cameraId}
            onChange={(e) => engine.saveSettings({ cameraId: e.target.value })}
            data-el-id="amberxvid:vcset:camera"
            sx={{ width: 170 }}
          >
            <MenuItem value="default">System default</MenuItem>
            {devices.cams.map((d, i) => (
              <MenuItem key={d.deviceId} value={d.deviceId}>
                {deviceLabel(d, i, "Camera")}
              </MenuItem>
            ))}
          </TextField>,
        )}
        {row(
          "Microphone",
          "Which mic joins the call",
          <TextField
            select
            size="small"
            value={s.micId}
            onChange={(e) => engine.saveSettings({ micId: e.target.value })}
            data-el-id="amberxvid:vcset:mic"
            sx={{ width: 170 }}
          >
            <MenuItem value="default">System default</MenuItem>
            {devices.mics.map((d, i) => (
              <MenuItem key={d.deviceId} value={d.deviceId}>
                {deviceLabel(d, i, "Mic")}
              </MenuItem>
            ))}
          </TextField>,
        )}
        {row(
          "Resolution",
          "Capture size requested from the camera",
          <TextField
            select
            size="small"
            value={s.resolution}
            onChange={(e) => engine.saveSettings({ resolution: e.target.value as VideoChatSettings["resolution"] })}
            data-el-id="amberxvid:vcset:resolution"
            sx={{ width: 130 }}
          >
            <MenuItem value="640x480">640×480</MenuItem>
            <MenuItem value="1280x720">1280×720</MenuItem>
            <MenuItem value="1920x1080">1920×1080</MenuItem>
          </TextField>,
        )}
        {row(
          "Bandwidth cap",
          "Outbound video bitrate ceiling — kind to slow uplinks",
          <TextField
            select
            size="small"
            value={String(s.maxKbps)}
            onChange={(e) => engine.saveSettings({ maxKbps: Number(e.target.value) })}
            data-el-id="amberxvid:vcset:bandwidth"
            sx={{ width: 130 }}
          >
            <MenuItem value="0">Uncapped</MenuItem>
            <MenuItem value="500">500 kbps</MenuItem>
            <MenuItem value="1000">1 Mbps</MenuItem>
            <MenuItem value="2500">2.5 Mbps</MenuItem>
          </TextField>,
        )}
        {row(
          "Call alert sound",
          "Ring on an incoming call or room invite",
          <Switch
            size="small"
            checked={s.alertSound}
            onChange={(e) => engine.saveSettings({ alertSound: e.target.checked })}
            data-el-id="amberxvid:vcset:sound"
          />,
        )}
        {row(
          "Ring volume",
          // Says what it does AND how to hear it: a volume slider you cannot
          // audition is a slider people drag twice and give up on.
          "How loud the chime is — click the speaker to hear it",
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: 170 }}>
            <Tooltip title="Play the chime at this volume">
              <span>
                <IconButton
                  size="small"
                  disabled={!s.alertSound}
                  onClick={() => playChime(CHIME, s.ringVolume)}
                  data-el-id="amberxvid:vcset:ring-test"
                >
                  {s.alertSound && s.ringVolume > 0 ? (
                    <VolumeUpIcon sx={{ fontSize: 17 }} />
                  ) : (
                    <MicOffIcon sx={{ fontSize: 17, color: GX.dim }} />
                  )}
                </IconButton>
              </span>
            </Tooltip>
            <Slider
              size="small"
              min={0}
              max={100}
              step={5}
              disabled={!s.alertSound}
              value={s.ringVolume}
              // Committed rather than continuous: dragging the slider would
              // otherwise write localStorage on every pixel.
              onChange={(_, v) => engine.saveSettings({ ringVolume: Array.isArray(v) ? v[0] : v })}
              onChangeCommitted={(_, v) => playChime(CHIME, Array.isArray(v) ? v[0] : v)}
              data-el-id="amberxvid:vcset:ring-volume"
              sx={{ flex: 1 }}
            />
          </Box>,
        )}

        <Box sx={{ display: "flex", justifyContent: "center", pt: 1, opacity: 0.55 }}>
          <GizmoXLockup mark={22} />
        </Box>
      </Box>
    </Dialog>
  );
}
