"use client";

/**
 * @file GROUP VIDEO ROOMS, the client half (P11) — the engine, the room window
 * and the rooms list.
 *
 * The transport half is lifted wholesale from `VideoChat.tsx`'s proven pattern
 * (P6): join the room the record already seats us in, load a mediasoup device,
 * one send transport and one recv transport, produce, consume what the server
 * announces, reconcile against whole snapshots rather than interpreting deltas,
 * and reconnect with backoff into the SAME room record when the media leg dies.
 * Everything in it that is not that is the two things a room of a hundred
 * people needs and a 1:1 call does not:
 *
 * 1. **CONSUMERS FOLLOW THE PAGE.** `RoomGrid` owns which 49 tiles are on
 *    screen and reports them; {@link reconcile} holds video consumers for those
 *    participants and nobody else. Read `RoomGrid.tsx`'s header for why an
 *    off-screen consumer is not free — it is the entire scale argument, and it
 *    is the one thing in this file that must not be "simplified".
 *
 *    The ordering is load-bearing and it is why the grid reports rather than
 *    manages: turning a page CLOSES the outgoing page's consumers before
 *    opening the incoming page's, in one pass, so the two pages' consumers
 *    never coexist. A component doing this in an effect would open the new page
 *    first and close the old one on cleanup — momentarily double.
 *
 * 2. **PUBLISH WITH SIMULCAST.** A call publishes one encoding because there is
 *    one subscriber looking at one big tile. Here the same camera is drawn at
 *    140 px on somebody's 49-up page and full-size on somebody else's maximised
 *    tile, so the upstream carries three spatial layers and every subscriber
 *    asks for the one that fits (`action: "layers"`). Without it, "the layer
 *    that fits the tile" has nothing to choose between and a 49-up page decodes
 *    49 full-resolution streams.
 *
 * AUDIO IS NOT PAGED, and that is a decision rather than an oversight — see
 * `RoomGridStats`'s docblock for the whole argument and the honest limitation
 * ({@link ROOM_AUDIO_CONSUMERS}). In one line: you must be able to hear the
 * person talking on page 2.
 *
 * THE CHAT RAIL IS THE MESSENGER'S. A room's chat is a real accounts group
 * thread (P5), bound to the room by `lib/groupRooms`, read and written through
 * the messenger link this module already mounts — so it arrives with live
 * delivery, the offline queue, the social guard, unread handling and the
 * message dedupe, and this file contains no chat transport at all.
 */

import * as React from "react";
// Type-only at module scope — the browser RTC library must never evaluate on
// the server; the Device implementation is imported inside `connectMedia`.
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
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Close as CloseIcon } from "./kit/icons";
import { GridView as RoomsIcon } from "./kit/icons";
import { RecordVoiceOver as MicIcon } from "./kit/icons";
import { VolumeOff as MicOffIcon } from "./kit/icons";
import { Videocam as VideocamIcon } from "./kit/icons";
import { VideocamOff as VideocamOffIcon } from "./kit/icons";
import { Send as SendIcon } from "./kit/icons";
import { Add as AddIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip, type CtxItem } from "./kit/ax";
import { GizmoXMark } from "./gizmox-kit";
import RoomGrid, { type RoomTileData, type TileState } from "./RoomGrid";
import {
  MEDIA_FAILURE_USER_COPY,
  type MediaKind,
  type MediaRoomSnapshot,
} from "./lib/mediaContract";
import {
  failureCopy,
  isPublishDenied,
  mediaApiPost,
  probeMediaHealth,
  reconnectDelayMs,
  sleep,
  useMediaHealth,
} from "./lib/mediaHealth";
import { ROOM_TITLE_MAX, type GroupRoomInfo, type MessengerEvent } from "./lib/types";
// The rail is the messenger's, so the composer honours the messages store's own
// cap rather than inventing a second one that could disagree with it.
import { MESSAGE_MAX } from "@axs/modules/accounts/lib/types";
import type { MessengerLink } from "./Messenger";
import { useAxvSubjectResolver } from "./ctxBridge";

/* --------------------------------- constants ------------------------------------ */

/**
 * How many audio downstreams one member holds at once, roster-scoped (never
 * page-scoped — see the file header). 64 is chosen against the arithmetic
 * rather than a feeling: audio is ~32 kbps against video's ~150–1500, so 64
 * audio consumers cost about the same bytes as two video tiles, and a room with
 * more than 64 people unmuted at once is a room where nobody can hear anybody
 * regardless of what this number is.
 *
 * Past the cap, the earliest joiners are the ones you hear. That is a real
 * limitation, stated here rather than hidden: the correct fix is server-side
 * dominant-speaker selection (the media server telling each client which few
 * audio streams matter right now), and it belongs in the media server, not in a
 * client heuristic guessing at what it cannot hear.
 */
export const ROOM_AUDIO_CONSUMERS = 64;

/** RMS above this counts as speaking. Low enough for a quiet talker, high
 *  enough that room noise does not light every tile. */
const SPEAKING_RMS = 0.045;
/** Speaking-level poll. 4 Hz reads as instant and costs one pass over the
 *  analysers; faster would light tiles on syllables. */
const SPEAKING_POLL_MS = 250;
/** How long a tile stays lit after the level drops — without it, a normal
 *  sentence's gaps make the ring flicker. */
const SPEAKING_HOLD_MS = 600;

/** Simulcast: three spatial layers, quarter / half / full. The bitrates are
 *  ceilings per layer, so a page of small tiles costs the lowest one. */
const SIMULCAST_ENCODINGS = [
  { scaleResolutionDownBy: 4, maxBitrate: 150_000 },
  { scaleResolutionDownBy: 2, maxBitrate: 500_000 },
  { scaleResolutionDownBy: 1, maxBitrate: 1_500_000 },
];

/* ---------------------------------- the engine ----------------------------------- */

export type RoomPhase = "idle" | "joining" | "live" | "ended";

/** What the media route answers — opaque vocabulary the client forwards. */
type MediaReply = Record<string, unknown>;

/** One held downstream, with the facts reconciliation needs about it. */
interface HeldConsumer {
  consumer: Consumer;
  /** Server-attested publisher — the roster key a tile is matched on. */
  sub: string;
  kind: MediaKind;
  /** The spatial layer last asked for, so an unchanged layer costs no request. */
  layer: number;
}

export interface GroupRoomEngine {
  /** Every live room in the studio — the list surface's truth. */
  rooms: GroupRoomInfo[];
  /** The room this member is in, or null. */
  room: GroupRoomInfo | null;
  /** Is the room window up? Closing it LEAVES — a room is not a recording. */
  open: boolean;
  phase: RoomPhase;
  reconnecting: boolean;
  /** Whatever the chat side had to say about the last seat change — a note,
   *  never a refusal (`lib/groupRooms`). */
  chatNote: string | null;
  micMuted: boolean;
  camOff: boolean;
  /** One entry per SEAT in roster order — the grid pages this. */
  tiles: RoomTileData[];
  videoConsumers: number;
  audioConsumers: number;
  /** Hidden audio elements' streams, one per audible participant. */
  audioStreams: { sub: string; stream: MediaStream }[];
  openRoom: (title: string) => Promise<void>;
  join: (roomId: string) => Promise<void>;
  leave: () => Promise<void>;
  end: () => Promise<void>;
  /** P15 — the HOST closes somebody else's seat. Refused server-side for
   *  anybody but the host, so this is an offer and not a decision. */
  removeParticipant: (user: string) => Promise<void>;
  rename: (title: string) => Promise<void>;
  toggleMic: () => void;
  toggleCam: () => void;
  /** The grid reporting its page — see the file header for the ordering rule. */
  setVisible: (users: string[], layer: number) => void;
  /** Feed one module SSE event in — wired by the shell. */
  handleEvent: (event: MessengerEvent) => void;
  /** Feed one `room-media` announcement in — wired by the shell. */
  handleRoomMedia: (roomId: string, snapshot: MediaRoomSnapshot) => void;
}

export function useGroupRooms({
  me,
  notify,
}: {
  me: string;
  notify: (msg: string, detail?: string) => void;
}): GroupRoomEngine {
  const [rooms, setRooms] = React.useState<GroupRoomInfo[]>([]);
  const [room, setRoom] = React.useState<GroupRoomInfo | null>(null);
  const [open, setOpen] = React.useState(false);
  const [phase, setPhase] = React.useState<RoomPhase>("idle");
  const [reconnecting, setReconnecting] = React.useState(false);
  const [chatNote, setChatNote] = React.useState<string | null>(null);
  const [micMuted, setMicMuted] = React.useState(false);
  const [camOff, setCamOff] = React.useState(false);
  const [localStream, setLocalStream] = React.useState<MediaStream | null>(null);
  const [snapshot, setSnapshot] = React.useState<MediaRoomSnapshot | null>(null);
  /** producer-sub → the video-only stream its tile renders. */
  const [videoStreams, setVideoStreams] = React.useState<Record<string, MediaStream>>({});
  const [audioStreams, setAudioStreams] = React.useState<{ sub: string; stream: MediaStream }[]>([]);
  const [speaking, setSpeaking] = React.useState<Record<string, boolean>>({});
  const [counts, setCounts] = React.useState({ video: 0, audio: 0 });

  /* --------- live refs: async media handlers must never act on stale state -------- */

  const roomIdRef = React.useRef<string | null>(null);
  const participantIdRef = React.useRef<string | null>(null);
  const deviceRef = React.useRef<Device | null>(null);
  const sendTransportRef = React.useRef<Transport | null>(null);
  const recvTransportRef = React.useRef<Transport | null>(null);
  const producersRef = React.useRef<Partial<Record<MediaKind, Producer>>>({});
  /** producerId → held consumer, or "pending" while its round-trip is in
   *  flight so a burst of announcements cannot double-subscribe. */
  const consumersRef = React.useRef<Map<string, HeldConsumer | "pending">>(new Map());
  const pendingSnapshotRef = React.useRef<MediaRoomSnapshot | null>(null);
  const localStreamRef = React.useRef<MediaStream | null>(null);
  /** The page, as the grid last reported it. */
  const visibleRef = React.useRef<{ users: string[]; layer: number }>({ users: [], layer: 0 });
  const snapshotRef = React.useRef<MediaRoomSnapshot | null>(null);
  const reconnectSeq = React.useRef(0);
  const reconnectingRef = React.useRef(false);
  /** Serialises reconciliation: two overlapping passes would each see the
   *  other's half-built consumer map and both decide to open the same one. */
  const reconcileChain = React.useRef<Promise<void>>(Promise.resolve());

  const live = React.useRef({ room, micMuted, camOff });
  live.current = { room, micMuted, camOff };

  /* ---------------------------------- the list ------------------------------------ */

  const refreshRooms = React.useCallback(async () => {
    try {
      const res = await fetch("/api/amberxvid/rooms");
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        rooms?: GroupRoomInfo[];
        mine?: GroupRoomInfo[];
      } | null;
      if (!res.ok || !json?.ok) return;
      setRooms(json.rooms ?? []);
    } catch {
      /* the list shows what it last knew — never a fabricated empty */
    }
  }, []);

  React.useEffect(() => {
    void refreshRooms();
  }, [refreshRooms]);

  /* --------------------------------- media plumbing -------------------------------- */

  const mediaPost = React.useCallback(
    (body: Record<string, unknown>): Promise<MediaReply> => mediaApiPost(body),
    [],
  );

  /** Rebuild the per-participant streams from the held consumers. One state
   *  write per change, so a `<video>` re-attaches exactly when its track set
   *  changes and not once per snapshot. */
  const syncStreams = React.useCallback(() => {
    const video: Record<string, MediaStream> = {};
    const audio: { sub: string; stream: MediaStream }[] = [];
    let videoCount = 0;
    let audioCount = 0;
    for (const held of consumersRef.current.values()) {
      if (held === "pending" || held.consumer.closed) continue;
      if (held.kind === "audio") {
        audio.push({ sub: held.sub, stream: new MediaStream([held.consumer.track]) });
        audioCount += 1;
      } else {
        // Video-only by construction: a tile's element must never carry audio,
        // or every visible participant is heard twice — once from its tile and
        // once from the hidden audio element that is meant to own playback.
        video[held.sub] = new MediaStream([held.consumer.track]);
        videoCount += 1;
      }
    }
    setVideoStreams(video);
    setAudioStreams(audio);
    setCounts({ video: videoCount, audio: audioCount });
  }, []);

  const closeConsumer = React.useCallback((producerId: string) => {
    const held = consumersRef.current.get(producerId);
    consumersRef.current.delete(producerId);
    if (held && held !== "pending") {
      try {
        held.consumer.close();
      } catch {
        /* already closed */
      }
    }
  }, []);

  /**
   * Reconcile the held consumers against the server's announced truth AND the
   * page the grid is showing. The snapshot is the whole truth per announcement,
   * so this never interprets deltas — a missed event costs nothing once the
   * next one lands.
   *
   * The order inside is the invariant: **close, then open.** Every pass first
   * drops everything no longer wanted (a page turned, a producer vanished, a
   * member left) and only then opens what is missing, so an outgoing page's
   * consumers are gone before an incoming page's exist.
   */
  const reconcile = React.useCallback(
    async (snap: MediaRoomSnapshot) => {
      const recv = recvTransportRef.current;
      const device = deviceRef.current;
      const pid = participantIdRef.current;
      if (!recv || !device || !pid) {
        pendingSnapshotRef.current = snap;
        return;
      }

      const meKey = me.toLowerCase();
      const visible = new Set(visibleRef.current.users);
      const layer = visibleRef.current.layer;

      // ---- what we want, and why each half is scoped the way it is ----------
      //
      // VIDEO: only the visible page's, at the fitting layer. Paused producers
      // are consumed too — the tile draws the avatar from the snapshot's
      // `paused` flag either way, and holding the consumer means a camera
      // coming back on is instant instead of a fresh consume round-trip. It
      // costs nothing against the invariant: the bound is the page, not the
      // number of cameras that happen to be on.
      //
      // AUDIO: roster-scoped to a cap, visible participants first (their tiles
      // are what the speaking ring is drawn on), then join order. See
      // ROOM_AUDIO_CONSUMERS.
      const wanted = new Map<string, { sub: string; kind: MediaKind }>();
      const audioCandidates: { producerId: string; sub: string; preferred: boolean }[] = [];
      for (const p of snap.producers) {
        if (p.sub.toLowerCase() === meKey) continue; // never consume ourselves
        if (p.kind === "audio") {
          audioCandidates.push({ producerId: p.producerId, sub: p.sub, preferred: visible.has(p.sub) });
          continue;
        }
        if (visible.has(p.sub)) wanted.set(p.producerId, { sub: p.sub, kind: p.kind });
      }
      audioCandidates.sort((a, b) => Number(b.preferred) - Number(a.preferred));
      for (const a of audioCandidates.slice(0, ROOM_AUDIO_CONSUMERS)) {
        wanted.set(a.producerId, { sub: a.sub, kind: "audio" });
      }

      // ---- CLOSE FIRST -----------------------------------------------------
      let changed = false;
      for (const producerId of [...consumersRef.current.keys()]) {
        if (wanted.has(producerId)) continue;
        closeConsumer(producerId);
        changed = true;
      }

      // ---- THEN OPEN -------------------------------------------------------
      for (const [producerId, info] of wanted) {
        const held = consumersRef.current.get(producerId);
        if (held) {
          // Already ours. A page whose tiles changed SIZE (the last page holds
          // four, so its tiles are big) needs a different layer on the same
          // consumers — one cheap request, no renegotiation.
          if (held !== "pending" && info.kind !== "audio" && held.layer !== layer) {
            held.layer = layer;
            void mediaPost({ action: "layers", participantId: pid, consumerId: held.consumer.id, spatialLayer: layer })
              .catch(() => undefined);
          }
          continue;
        }
        consumersRef.current.set(producerId, "pending");
        try {
          const reply = await mediaPost({
            action: "consume",
            participantId: pid,
            transportId: recv.id,
            producerId,
            rtpCapabilities: device.rtpCapabilities,
          });
          // Torn down, or the page turned again, while the round-trip was in
          // flight: the "pending" marker is gone exactly when that happened.
          if (recvTransportRef.current !== recv || consumersRef.current.get(producerId) !== "pending") {
            continue;
          }
          const consumer = await recv.consume({
            id: String(reply.consumerId),
            producerId,
            kind: reply.kind as "audio" | "video",
            rtpParameters: reply.rtpParameters as RtpParameters,
          });
          if (consumersRef.current.get(producerId) !== "pending") {
            // Turned pages while `consume` resolved — this downstream belongs
            // to nobody, and an orphan consumer is exactly the leak the
            // invariant exists to prevent.
            try {
              consumer.close();
            } catch {
              /* already closed */
            }
            continue;
          }
          consumersRef.current.set(producerId, { consumer, sub: info.sub, kind: info.kind, layer });
          changed = true;
          // Created paused server-side (the black-tile rule) — resume now the
          // client holds the track, then ask for the layer that fits.
          await mediaPost({ action: "resume", participantId: pid, consumerId: consumer.id });
          if (info.kind !== "audio") {
            void mediaPost({ action: "layers", participantId: pid, consumerId: consumer.id, spatialLayer: layer })
              .catch(() => undefined);
          }
        } catch {
          consumersRef.current.delete(producerId);
        }
      }

      if (changed) syncStreams();
    },
    [closeConsumer, me, mediaPost, syncStreams],
  );

  /** Queue a reconciliation behind any in flight (see `reconcileChain`). */
  const queueReconcile = React.useCallback(
    (snap: MediaRoomSnapshot) => {
      snapshotRef.current = snap;
      setSnapshot(snap);
      reconcileChain.current = reconcileChain.current.then(() => reconcile(snap)).catch(() => undefined);
    },
    [reconcile],
  );

  const setVisible = React.useCallback(
    (users: string[], layer: number) => {
      const prev = visibleRef.current;
      if (prev.layer === layer && prev.users.join(",") === users.join(",")) return;
      visibleRef.current = { users, layer };
      const snap = snapshotRef.current;
      if (snap) queueReconcile(snap);
    },
    [queueReconcile],
  );

  /* -------------------------------- speaking levels -------------------------------- */

  // One AudioContext, one analyser per audible participant, one 4 Hz pass. The
  // analysers hang off the CONSUMED tracks, so a participant nobody is
  // consuming has no analyser and no cost — the same scoping as the audio
  // consumers themselves.
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  // `Float32Array<ArrayBuffer>`, not the bare alias: lib.dom types
  // `getFloatTimeDomainData` against a non-shared buffer, and the default
  // `Float32Array` is `ArrayBufferLike` (which admits `SharedArrayBuffer`).
  const analysersRef = React.useRef<
    Map<string, { node: AnalyserNode; buf: Float32Array<ArrayBuffer>; until: number }>
  >(new Map());

  React.useEffect(() => {
    if (audioStreams.length === 0) {
      analysersRef.current.clear();
      setSpeaking({});
      return;
    }
    let ctx = audioCtxRef.current;
    try {
      ctx = audioCtxRef.current ??= new AudioContext();
    } catch {
      return; // no Web Audio — tiles simply never light up
    }
    const keep = new Set(audioStreams.map((a) => a.sub));
    for (const sub of [...analysersRef.current.keys()]) {
      if (!keep.has(sub)) analysersRef.current.delete(sub);
    }
    for (const { sub, stream } of audioStreams) {
      if (analysersRef.current.has(sub)) continue;
      try {
        const node = ctx.createAnalyser();
        node.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(node);
        analysersRef.current.set(sub, { node, buf: new Float32Array(node.fftSize), until: 0 });
      } catch {
        /* this one stream refuses analysis — the others still work */
      }
    }

    const timer = setInterval(() => {
      const now = Date.now();
      const next: Record<string, boolean> = {};
      for (const [sub, a] of analysersRef.current) {
        a.node.getFloatTimeDomainData(a.buf);
        let sum = 0;
        for (let i = 0; i < a.buf.length; i += 1) sum += a.buf[i] * a.buf[i];
        if (Math.sqrt(sum / a.buf.length) >= SPEAKING_RMS) a.until = now + SPEAKING_HOLD_MS;
        if (a.until > now) next[sub] = true;
      }
      setSpeaking((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        // Same set means the same object — a new object every 250 ms would
        // re-render 49 memoised tiles four times a second for nothing.
        if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k])) return prev;
        return next;
      });
    }, SPEAKING_POLL_MS);
    return () => clearInterval(timer);
  }, [audioStreams]);

  /* ---------------------------------- teardown -------------------------------------- */

  const teardownMedia = React.useCallback(() => {
    for (const producerId of [...consumersRef.current.keys()]) closeConsumer(producerId);
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
    setVideoStreams({});
    setAudioStreams([]);
    setCounts({ video: 0, audio: 0 });
    if (pid) {
      void fetch("/api/amberxvid/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave", participantId: pid }),
      }).catch(() => undefined);
    }
  }, [closeConsumer]);

  /** Fold everything: media handles, the camera, and the room state. The SEAT
   *  is given back by the caller (`leave`) — this is the local half only, so a
   *  reconnect can use it without vacating the record's seat. */
  const teardownLocal = React.useCallback(() => {
    reconnectSeq.current += 1;
    reconnectingRef.current = false;
    setReconnecting(false);
    teardownMedia();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    snapshotRef.current = null;
    setSnapshot(null);
    setSpeaking({});
    visibleRef.current = { users: [], layer: 0 };
    setMicMuted(false);
    setCamOff(false);
  }, [teardownMedia]);

  const acquireMedia = React.useCallback(async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  /* ------------------------------- the media plane ---------------------------------- */

  const connectMediaRef = React.useRef<() => Promise<void>>(async () => undefined);

  /**
   * The media leg died. NOT the end of the room: the record outlives the media
   * server, so this folds the media handles only and rejoins the SAME room with
   * backoff, unbounded by design. There is no peer-to-peer fallback
   * (`NO_FALLBACK_DECISION`).
   */
  const beginReconnect = React.useCallback(() => {
    const roomId = roomIdRef.current;
    if (!roomId || reconnectingRef.current) return;
    reconnectingRef.current = true;
    setReconnecting(true);
    teardownMedia();
    const seq = ++reconnectSeq.current;
    const cancelled = (): boolean => reconnectSeq.current !== seq || roomIdRef.current !== roomId;
    void (async () => {
      for (let attempt = 0; ; attempt += 1) {
        await sleep(reconnectDelayMs(attempt));
        if (cancelled()) return;
        // The record is the authority: a room that ended while the media server
        // was away is an ended room, not a retry target.
        try {
          const res = await fetch(`/api/amberxvid/rooms?room=${encodeURIComponent(roomId)}`);
          if (res.status === 404) {
            if (cancelled()) return;
            notify("The room ended while the media server was away");
            roomIdRef.current = null;
            setRoom(null);
            setOpen(false);
            setPhase("ended");
            teardownLocal();
            return;
          }
        } catch {
          /* the app server hiccupped — the record may be fine, keep trying */
        }
        if (cancelled()) return;
        const health = await probeMediaHealth();
        if (cancelled() || !health.up) continue;
        try {
          await connectMediaRef.current();
          if (cancelled()) return;
          reconnectingRef.current = false;
          setReconnecting(false);
          notify("Reconnected — you are back in the room");
          return;
        } catch {
          if (!cancelled()) teardownMedia();
        }
      }
    })();
  }, [notify, teardownLocal, teardownMedia]);

  /**
   * The whole transport half, in join order — VideoChat's `connectMedia` with
   * the two group-room differences (simulcast on publish, page-scoped consume).
   */
  const connectMedia = React.useCallback(async () => {
    const roomId = roomIdRef.current;
    if (!roomId) return;

    const joined = await mediaPost({ action: "join", roomId });
    if (roomIdRef.current !== roomId) return; // left while joining
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
        if (roomIdRef.current !== roomId) return;
        if (state === "failed") {
          notify(MEDIA_FAILURE_USER_COPY["transport-failed"]);
          beginReconnect();
        } else if (state === "disconnected") {
          // Might be a blip — ask /health rather than guessing, so a dead
          // server starts the loop now instead of after ICE's slow clock.
          void probeMediaHealth().then((h) => {
            if (!h.up && roomIdRef.current === roomId) {
              notify(MEDIA_FAILURE_USER_COPY["transport-failed"]);
              beginReconnect();
            }
          });
        }
      });
    };

    const sendReply = await mediaPost({ action: "transport", participantId: pid, direction: "send" });
    if (roomIdRef.current !== roomId) return;
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
    if (roomIdRef.current !== roomId) return;
    const recvTransport = device.createRecvTransport(transportParams(recvReply));
    wireTransport(recvTransport);
    recvTransportRef.current = recvTransport;

    // ONE upstream per kind, and the video one carries three spatial layers —
    // see the file header for why a room needs what a call did not.
    const stream = localStreamRef.current ?? (await acquireMedia());
    if (roomIdRef.current !== roomId) return;
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    try {
      if (videoTrack) {
        producersRef.current.video = await sendTransport.produce({
          track: videoTrack,
          encodings: SIMULCAST_ENCODINGS,
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
      // A group room has no audience class, so `publish-denied` here means the
      // record's seat says something this client did not expect — say it and
      // continue consume-only rather than dropping the person out of a meeting.
      if (!isPublishDenied(err)) throw err;
      notify(MEDIA_FAILURE_USER_COPY["publish-denied"]);
    }

    // A reconnect resumes with the toggles it left with: a muted member must
    // come back muted, server-known, not hot.
    for (const [kind, wasOff] of [["audio", live.current.micMuted], ["video", live.current.camOff]] as const) {
      if (!wasOff) continue;
      const tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
      for (const t of tracks) t.enabled = false;
      if (producersRef.current[kind]) {
        void mediaPost({ action: "pause", participantId: pid, kind, paused: true }).catch(() => undefined);
      }
    }

    queueReconcile(joined.snapshot as MediaRoomSnapshot);
    const fresh = await mediaPost({ action: "snapshot", participantId: pid });
    if (roomIdRef.current !== roomId) return;
    queueReconcile(fresh.snapshot as MediaRoomSnapshot);
    if (pendingSnapshotRef.current) {
      const pending = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
      queueReconcile(pending);
    }
    if (roomIdRef.current === roomId) setPhase("live");
  }, [acquireMedia, beginReconnect, mediaPost, notify, queueReconcile]);
  connectMediaRef.current = connectMedia;

  /* ----------------------------------- actions -------------------------------------- */

  /** Give the seat back on the record. Best-effort by design: the sweeper and
   *  the presence registry both clear a seat this never reached. */
  const releaseSeat = React.useCallback(async (roomId: string) => {
    try {
      const res = await fetch("/api/amberxvid/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave", roomId }),
      });
      const json = (await res.json().catch(() => null)) as { chat?: string } | null;
      if (json?.chat) setChatNote(json.chat);
    } catch {
      /* the seat goes stale and is swept — the room does not keep a ghost */
    }
  }, []);

  /** Enter a room whose seat this member already holds: camera, then media. */
  const enter = React.useCallback(
    async (info: GroupRoomInfo) => {
      roomIdRef.current = info.id;
      setRoom(info);
      setOpen(true);
      setPhase("joining");
      try {
        await acquireMedia();
      } catch (err) {
        const why = err instanceof Error ? err.message : "camera/mic unavailable";
        notify("Couldn't join the room", why);
        await releaseSeat(info.id);
        roomIdRef.current = null;
        setRoom(null);
        setOpen(false);
        setPhase("idle");
        teardownLocal();
        return;
      }
      try {
        await connectMedia();
      } catch (err) {
        notify("Couldn't join the room", failureCopy(err));
        await releaseSeat(info.id);
        roomIdRef.current = null;
        setRoom(null);
        setOpen(false);
        setPhase("idle");
        teardownLocal();
      }
    },
    [acquireMedia, connectMedia, notify, releaseSeat, teardownLocal],
  );

  /** One POST to the rooms route, with the chat note picked up. */
  const roomPost = React.useCallback(
    async (body: Record<string, unknown>): Promise<GroupRoomInfo | null> => {
      try {
        const res = await fetch("/api/amberxvid/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          room?: GroupRoomInfo;
          chat?: string;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok || !json.room) {
          notify(json?.error ?? "The room service did not answer");
          return null;
        }
        setChatNote(json.chat ?? null);
        return json.room;
      } catch {
        notify("The room service did not answer");
        return null;
      }
    },
    [notify],
  );

  const openRoom = React.useCallback(
    async (title: string) => {
      if (live.current.room) {
        notify("You're already in a room", "leave it first");
        return;
      }
      // Probe the media server BEFORE opening: a dead server should be a fast
      // named refusal, not an empty room nobody can join.
      const health = await probeMediaHealth();
      if (!health.up) {
        notify(MEDIA_FAILURE_USER_COPY["server-unreachable"]);
        return;
      }
      const info = await roomPost({ action: "open", title });
      if (!info) return;
      await refreshRooms();
      await enter(info);
    },
    [enter, notify, refreshRooms, roomPost],
  );

  const join = React.useCallback(
    async (roomId: string) => {
      if (live.current.room) {
        if (live.current.room.id === roomId) {
          setOpen(true);
          return;
        }
        notify("You're already in a room", "leave it first");
        return;
      }
      const health = await probeMediaHealth();
      if (!health.up) {
        notify(MEDIA_FAILURE_USER_COPY["server-unreachable"]);
        return;
      }
      const info = await roomPost({ action: "join", roomId });
      if (!info) return;
      await enter(info);
    },
    [enter, notify, roomPost],
  );

  const leave = React.useCallback(async () => {
    const roomId = roomIdRef.current;
    roomIdRef.current = null;
    setOpen(false);
    setRoom(null);
    setPhase("idle");
    teardownLocal();
    if (roomId) await releaseSeat(roomId);
    await refreshRooms();
  }, [refreshRooms, releaseSeat, teardownLocal]);

  /**
   * P15 — the host closes somebody else's seat.
   *
   * Nothing local is torn down here, deliberately: the removed member's own
   * client acts on the `removed` signal, and this client learns the tile is
   * gone from the `rooms` list the route broadcasts behind it. A host that
   * optimistically dropped the tile would be asserting an outcome the server
   * has not confirmed — and the server is the one that decides whether the host
   * is still the host.
   */
  const removeParticipant = React.useCallback(
    async (user: string) => {
      const roomId = roomIdRef.current;
      if (!roomId) return;
      try {
        const res = await fetch("/api/amberxvid/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove", roomId, user }),
        });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !json?.ok) {
          notify(json?.error ?? "That removal did not take");
          return;
        }
        notify(`${user} was removed from the room`);
      } catch {
        notify("The room service did not answer");
      }
      await refreshRooms();
    },
    [notify, refreshRooms],
  );

  const end = React.useCallback(async () => {
    const roomId = roomIdRef.current;
    if (!roomId) return;
    roomIdRef.current = null;
    setOpen(false);
    setRoom(null);
    setPhase("idle");
    teardownLocal();
    try {
      await fetch("/api/amberxvid/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", roomId }),
      });
    } catch {
      notify("The room service did not answer — the room may still be open");
    }
    await refreshRooms();
  }, [notify, refreshRooms, teardownLocal]);

  const rename = React.useCallback(
    async (title: string) => {
      const roomId = roomIdRef.current;
      if (!roomId) return;
      const info = await roomPost({ action: "rename", roomId, title });
      if (info) setRoom(info);
    },
    [roomPost],
  );

  // Leaving the module mid-room must give the seat back, not orphan the camera.
  React.useEffect(() => {
    return () => {
      const roomId = roomIdRef.current;
      roomIdRef.current = null;
      if (roomId) {
        void fetch("/api/amberxvid/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "leave", roomId }),
        }).catch(() => undefined);
      }
      teardownLocal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Server-known mute: pause the PRODUCER; disabling the local track is the
   *  local echo of the same fact. */
  const setProducerPaused = React.useCallback(
    (kind: MediaKind, paused: boolean) => {
      const pid = participantIdRef.current;
      if (!pid || !producersRef.current[kind]) return;
      void mediaPost({ action: "pause", participantId: pid, kind, paused }).catch(() => {
        notify("The server didn't take that — it may not have applied");
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
  }, [setProducerPaused]);

  const toggleCam = React.useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !live.current.camOff;
    for (const t of stream.getVideoTracks()) t.enabled = !next;
    setProducerPaused("video", next);
    setCamOff(next);
  }, [setProducerPaused]);

  /* ------------------------------- the event handlers -------------------------------- */

  const handleEvent = React.useCallback(
    (event: MessengerEvent) => {
      if (event.type === "rooms") {
        setRooms(event.rooms);
        // The record is the roster's truth: keep the room we are in in step
        // with it, so joins and departures reflow the grid without a fetch.
        const mine = roomIdRef.current;
        if (mine) {
          const fresh = event.rooms.find((r) => r.id === mine);
          if (fresh) setRoom(fresh);
        }
        return;
      }
      if (event.type === "room-signal" && event.signal.kind === "ended") {
        if (event.signal.roomId !== roomIdRef.current) return;
        notify("The room ended", `${event.signal.from} closed it`);
        roomIdRef.current = null;
        setRoom(null);
        setOpen(false);
        setPhase("ended");
        teardownLocal();
      }
      /**
       * P15 — the host removed somebody.
       *
       * The signal reaches the whole audience, so this fires on every client in
       * the room and only ONE of them was removed: the `to` check is what keeps
       * the other tiles from tearing their own media down. Everybody else picks
       * the departure up through the `rooms` list that rides along behind it,
       * which is the same way they learn about a voluntary leave.
       */
      if (event.type === "room-signal" && event.signal.kind === "removed") {
        if (event.signal.roomId !== roomIdRef.current) return;
        if (event.signal.to.toLowerCase() !== me.toLowerCase()) return;
        notify("You were removed from the room", `${event.signal.from} closed your seat`);
        roomIdRef.current = null;
        setRoom(null);
        setOpen(false);
        setPhase("ended");
        teardownLocal();
      }
    },
    [me, notify, teardownLocal],
  );

  const handleRoomMedia = React.useCallback(
    (roomId: string, snap: MediaRoomSnapshot) => {
      if (roomId !== roomIdRef.current) return;
      queueReconcile(snap);
    },
    [queueReconcile],
  );

  /* ----------------------------------- the tiles -------------------------------------- */

  /**
   * One tile per SEAT, in roster order — the join of the record (who is here)
   * and the snapshot (what their producers are doing). Identity comes only from
   * the first (`MEDIA_CONTRACT.identity`).
   */
  const tiles = React.useMemo<RoomTileData[]>(() => {
    if (!room) return [];
    const meKey = me.toLowerCase();
    const byKind = new Map<string, { video: boolean; videoPaused: boolean; audioPaused: boolean }>();
    for (const p of snapshot?.producers ?? []) {
      const key = p.sub.toLowerCase();
      const entry = byKind.get(key) ?? { video: false, videoPaused: false, audioPaused: false };
      if (p.kind === "audio") entry.audioPaused = p.paused;
      else {
        entry.video = true;
        entry.videoPaused = entry.videoPaused || p.paused;
      }
      byKind.set(key, entry);
    }

    return room.members.map((m) => {
      const mine = m.user === meKey;
      const media = byKind.get(m.user);
      const stream = mine ? localStreamRef.current : videoStreams[m.user] ?? null;
      let state: TileState;
      if (reconnecting) {
        // Our own leg is down. Every remote tile is stale, and saying so beats
        // a still frame that will never update again.
        state = mine ? (camOff ? "camera-off" : "live") : "lost";
      } else if (mine) {
        state = camOff ? "camera-off" : "live";
      } else if (media?.videoPaused) {
        state = "camera-off";
      } else if (stream && media?.video) {
        state = "live";
      } else {
        state = "waiting";
      }
      return {
        user: m.user,
        displayName: m.displayName,
        role: m.role,
        me: mine,
        state,
        stream: state === "live" ? stream : null,
        micMuted: mine ? micMuted : media?.audioPaused === true,
        speaking: mine ? false : speaking[m.user] === true,
      };
    });
    // `localStream` is in the deps although the body reads the REF: the ref is
    // what stays current inside async handlers, the state is what tells React a
    // re-render is due when the camera arrives.
  }, [room, me, snapshot, videoStreams, localStream, camOff, micMuted, speaking, reconnecting]);

  return {
    rooms,
    room,
    open,
    phase,
    reconnecting,
    chatNote,
    micMuted,
    camOff,
    tiles,
    videoConsumers: counts.video,
    audioConsumers: counts.audio,
    audioStreams,
    openRoom,
    join,
    leave,
    end,
    removeParticipant,
    rename,
    toggleMic,
    toggleCam,
    setVisible,
    handleEvent,
    handleRoomMedia,
  };
}

/* ---------------------------------- the room window --------------------------------- */

/**
 * The room: grid left, rail right (roster over chat). Closing the window
 * LEAVES — unlike a stream, whose broadcast is shell-owned and keeps running,
 * a meeting you have closed is a meeting you have left, and leaving a camera
 * publishing behind a closed window would be the worse surprise by far.
 */
export function GroupRoomWindow({
  engine,
  link,
  me,
  notify,
  openCtx,
  userMenu,
}: {
  engine: GroupRoomEngine;
  link: MessengerLink;
  me: string;
  notify: (msg: string, detail?: string) => void;
  openCtx: (e: React.MouseEvent, label: string, items: CtxItem[]) => void;
  userMenu: (user: string) => CtxItem[];
}) {
  const room = engine.room;
  const [draft, setDraft] = React.useState("");
  const chatEnd = React.useRef<HTMLDivElement | null>(null);
  const health = useMediaHealth(engine.open);

  /**
   * The declared `amberxvid.room` area's behaviour, for the LIVE room (P15).
   *
   * This is the surface that can remove somebody, so it is the one that offers
   * the capability; the rooms LIST stands down for this id (see its resolver).
   * `join` is still offered because a room you are in is a room you can be
   * asked to open, and `join` on the room you already hold a seat in is what
   * every Join button on that card already does.
   */
  useAxvSubjectResolver("room", (id) =>
    room && id === room.id
      ? {
          join: () => void engine.join(id),
          removeParticipant: (user: string) => void engine.removeParticipant(user),
        }
      : null,
  );

  // The rail is the messenger's own thread — one call, then live delivery on
  // the stream the module already holds. See `MessengerLink.watchThread`.
  const threadId = room?.threadId ?? null;
  // On `watchThread` rather than on `link`: the link is a fresh object most
  // renders (the roster moves constantly in a room), and depending on it would
  // re-run this on every one of them.
  const { watchThread } = link;
  React.useEffect(() => {
    watchThread(threadId);
  }, [watchThread, threadId]);
  const thread = threadId ? link.threads[threadId] : undefined;
  const messages = thread?.messages ?? [];

  React.useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [messages.length, engine.open]);

  if (!room || !engine.open) return null;

  const hosting = room.host === me.toLowerCase();

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || !threadId) return;
    setDraft("");
    await link.send({ id: threadId, kind: "group", with: "", title: room.title }, text);
  };

  return (
    <Dialog open onClose={() => void engine.leave()} maxWidth={false} fullWidth
      slotProps={{ paper: { sx: { width: "96vw", height: "92vh", maxWidth: "none", bgcolor: GX.page } } }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* header */}
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.4, py: 0.8, borderBottom: `1px solid ${GX.edge}` }}
          onContextMenu={(e) =>
            openCtx(e, `Room · ${room.title}`, [
              { label: "Leave room", onClick: () => void engine.leave() },
              ...(hosting
                ? ([{ label: "End room for everybody", danger: true, onClick: () => void engine.end() }] as CtxItem[])
                : []),
            ])
          }
        >
          <GizmoXMark size={20} glow={false} ring="transparent" />
          <Typography sx={{ fontSize: 14.5, fontWeight: 700 }}>{room.title}</Typography>
          <GxChip
            label={`${room.members.length}${room.memberLimit ? `/${room.memberLimit}` : ""} in the room`}
            kind="info"
          />
          <GxChip label={hosting ? "you are the host" : `host · ${link.screennameFor(room.host)}`} kind="accent" />
          {engine.reconnecting ? (
            <GxChip label="media server unreachable — reconnecting…" kind="err" />
          ) : health !== null && !health.up ? (
            <GxChip label="media server offline" kind="err" />
          ) : engine.phase === "joining" ? (
            <GxChip label="joining…" kind="dim" />
          ) : null}
          {engine.chatNote ? <GxChip label={engine.chatNote} kind="warn" /> : null}
          <Box sx={{ flex: 1 }} />
          {hosting ? (
            <Button size="small" color="error" variant="contained" onClick={() => void engine.end()} data-el-id="amberxvid:room:end">
              End room
            </Button>
          ) : null}
          <IconButton size="small" onClick={() => void engine.leave()} data-el-id="amberxvid:room:close">
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        {/* body: grid + rail */}
        <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <RoomGrid
              room={room}
              tiles={engine.tiles}
              profiles={link.profiles}
              screennameFor={link.screennameFor}
              onVisibleChange={engine.setVisible}
              videoConsumers={engine.videoConsumers}
              audioConsumers={engine.audioConsumers}
              onTileContextMenu={(e, tile) =>
                openCtx(
                  e,
                  `Member · ${link.screennameFor(tile.user)}`,
                  tile.me ? [{ label: "That's you", onClick: () => notify("That's you") }] : userMenu(tile.user),
                )
              }
            />

            {engine.reconnecting ? (
              <Typography
                sx={{ px: 1.2, py: 0.6, color: GX.warn, fontSize: 12 }}
                data-el-id="amberxvid:room:media-down"
              >
                {MEDIA_FAILURE_USER_COPY["transport-failed"]} You are still in the room — the tiles
                come back by themselves when the media server does.
              </Typography>
            ) : null}

            {/* controls */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.2, py: 0.8, borderTop: `1px solid ${GX.edge}` }}>
              <Tooltip title={engine.micMuted ? "unmute mic" : "mute mic"}>
                <IconButton size="small" onClick={engine.toggleMic} data-el-id="amberxvid:room:mic">
                  {engine.micMuted ? <MicOffIcon sx={{ fontSize: 18, color: GX.err }} /> : <MicIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </Tooltip>
              <Tooltip title={engine.camOff ? "camera on" : "camera off"}>
                <IconButton size="small" onClick={engine.toggleCam} data-el-id="amberxvid:room:cam">
                  {engine.camOff ? <VideocamOffIcon sx={{ fontSize: 18, color: GX.err }} /> : <VideocamIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </Tooltip>
              <Typography sx={{ fontSize: 11, color: GX.dim, fontFamily: GX.mono }}>
                everybody here publishes — mute and camera are server-known
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="outlined" onClick={() => void engine.leave()} data-el-id="amberxvid:room:leave">
                Leave
              </Button>
            </Box>
          </Box>

          {/* rail: roster over chat */}
          <Box sx={{ width: 320, borderLeft: `1px solid ${GX.edge}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <Box sx={{ px: 1.2, py: 0.7, borderBottom: `1px solid ${GX.edge}`, maxHeight: 160, overflowY: "auto" }}>
              <Typography sx={{ fontSize: 10.5, fontFamily: GX.mono, letterSpacing: 0.6, color: GX.dim }}>
                IN THE ROOM
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, pt: 0.5 }}>
                {room.members.map((m) => (
                  <Box
                    key={m.user}
                    onContextMenu={(e) =>
                      m.user === me.toLowerCase()
                        ? undefined
                        : openCtx(e, `Member · ${link.screennameFor(m.user)}`, userMenu(m.user))
                    }
                  >
                    <GxChip
                      label={`${link.screennameFor(m.user)}${m.role === "host" ? " · host" : ""}`}
                      kind={m.user === me.toLowerCase() ? "ok" : m.role === "host" ? "accent" : "dim"}
                    />
                  </Box>
                ))}
              </Box>
            </Box>

            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1.2, py: 0.8, display: "flex", flexDirection: "column", gap: 0.6 }}>
              {!threadId ? (
                <Typography sx={{ fontSize: 11.5, color: GX.dim, textAlign: "center", pt: 2 }}>
                  Chat opens when somebody else joins — a group of one is not a group.
                </Typography>
              ) : messages.length === 0 ? (
                <Typography sx={{ fontSize: 11.5, color: GX.dim, textAlign: "center", pt: 2 }}>
                  Say hello. This room's chat is a group conversation in your messenger — it goes
                  when the last person leaves the room.
                </Typography>
              ) : (
                messages.map((m) => {
                  const mine = m.from.toLowerCase() === me.toLowerCase();
                  return (
                    <Box
                      key={m.id}
                      onContextMenu={(e) =>
                        openCtx(e, `Message · ${link.screennameFor(m.from)}`, [
                          {
                            label: "Copy text",
                            onClick: () => {
                              void navigator.clipboard.writeText(m.text);
                              notify("Copied");
                            },
                          },
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
                      <Typography sx={{ fontSize: 10, color: GX.dim, fontFamily: GX.mono }}>
                        {link.screennameFor(m.from)}
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {m.text}
                      </Typography>
                    </Box>
                  );
                })
              )}
              <div ref={chatEnd} />
            </Box>

            <Box sx={{ display: "flex", gap: 0.6, p: 0.8, borderTop: `1px solid ${GX.edge}` }}>
              <TextField
                size="small"
                fullWidth
                disabled={!threadId}
                placeholder={threadId ? "message the room…" : "no chat yet"}
                value={draft}
                slotProps={{ htmlInput: { maxLength: MESSAGE_MAX, "data-el-id": "amberxvid:room:composer" } }}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <IconButton size="small" onClick={() => void send()} disabled={!draft.trim() || !threadId} data-el-id="amberxvid:room:send">
                <SendIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          </Box>
        </Box>
      </Box>

      {/*
        Audio playback lives here, OUTSIDE the grid, and that is the whole
        reason you can hear somebody on page 2: a tile only exists while its
        page is visible, so audio attached to a tile would stop when the page
        turned. One hidden element per audible participant rather than one
        element with a rebuilt stream — swapping `srcObject` on a live element
        glitches every voice in the room, and churn is constant.
      */}
      {engine.audioStreams.map(({ sub, stream }) => (
        <HiddenAudio key={sub} stream={stream} />
      ))}
    </Dialog>
  );
}

function HiddenAudio({ stream }: { stream: MediaStream }) {
  const ref = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay style={{ display: "none" }} />;
}

/* ----------------------------------- the list ---------------------------------------- */

/** The Rooms stage: what is open, who is in it, and one button to open one. */
export function Rooms({
  engine,
  me,
  screennameFor,
  openCtx,
  userMenu,
}: {
  engine: GroupRoomEngine;
  me: string;
  screennameFor: (user: string) => string;
  openCtx: (e: React.MouseEvent, label: string, items: CtxItem[]) => void;
  userMenu: (user: string) => CtxItem[];
}) {
  const [title, setTitle] = React.useState("");
  const meKey = me.toLowerCase();

  /**
   * The declared `amberxvid.room` area's behaviour, for the LIST (P15).
   *
   * A resolver over `engine.rooms` — the cards are a `.map()`. It offers `join`
   * and deliberately no `removeParticipant`: a card has no participant under
   * the pointer and no engine seated in that room, and the row's predicate asks
   * the subject for the capability precisely so that it stays off a surface
   * that cannot honour it.
   */
  useAxvSubjectResolver("room", (id) => {
    // The room the viewer is SITTING IN belongs to the live surface, which
    // offers more than this card can (the removal). Two resolvers of one kind
    // are asked in mount order, so the one that can do less has to stand down
    // rather than race to answer first.
    if (id === engine.room?.id) return null;
    return engine.rooms.some((r) => r.id === id) ? { join: () => void engine.join(id) } : null;
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.2, minHeight: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
        <RoomsIcon sx={{ fontSize: 18, color: GX.accent }} />
        <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Video rooms</Typography>
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          placeholder="room name…"
          value={title}
          slotProps={{ htmlInput: { maxLength: ROOM_TITLE_MAX, "data-el-id": "amberxvid:rooms:title" } }}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void engine.openRoom(title);
              setTitle("");
            }
          }}
          sx={{ width: 200 }}
        />
        <Button
          size="small"
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            void engine.openRoom(title);
            setTitle("");
          }}
          data-el-id="amberxvid:rooms:open"
        >
          Open a room
        </Button>
      </Box>

      <Typography sx={{ fontSize: 11, color: GX.dim }}>
        Everybody in a room is on camera — there is no audience seat here. Your screen shows up to{" "}
        49 people at a time and turns the page for the rest; only the page you are looking at is
        streamed to you, which is what lets a room hold a crowd.
      </Typography>

      {engine.rooms.length === 0 ? (
        <Box sx={{ py: 4, textAlign: "center" }}>
          <GizmoXMark size={44} glow={false} />
          <Typography sx={{ fontSize: 12.5, color: GX.dim, pt: 1 }}>
            No rooms are open. Name one above and everybody can walk in.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.6 }}>
          {engine.rooms.map((r) => {
            const inIt = r.members.some((m) => m.user === meKey);
            const full = r.memberLimit !== null && r.members.length >= r.memberLimit;
            return (
              <Box
                key={r.id}
                // The declared `amberxvid.room` area (P15).
                data-axf-area="amberxvid.room"
                data-axf-room={r.id}
                data-axf-room-host={r.host}
                onContextMenu={(e) =>
                  openCtx(e, `Room · ${r.title}`, [
                    { label: inIt ? "Open the room" : "Join the room", onClick: () => void engine.join(r.id) },
                    ...userMenu(r.host),
                  ])
                }
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 1.2,
                  py: 0.8,
                  border: `1px solid ${inIt ? gxa(GX.accent, "66") : GX.edge}`,
                  borderRadius: 1,
                  bgcolor: GX.panel,
                }}
              >
                <RoomsIcon sx={{ fontSize: 16, color: inIt ? GX.accent : GX.dim }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{r.title}</Typography>
                  <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono }}>
                    host {screennameFor(r.host)} · {r.members.length}
                    {r.memberLimit ? `/${r.memberLimit}` : ""} in the room
                  </Typography>
                </Box>
                <Box sx={{ flex: 1 }} />
                {r.members.slice(0, 6).map((m) => (
                  <GxChip key={m.user} label={screennameFor(m.user)} kind={m.role === "host" ? "accent" : "dim"} />
                ))}
                {r.members.length > 6 ? <GxChip label={`+${r.members.length - 6}`} kind="dim" /> : null}
                <Button
                  size="small"
                  variant={inIt ? "contained" : "outlined"}
                  disabled={full && !inIt}
                  onClick={() => void engine.join(r.id)}
                  data-el-id={`amberxvid:rooms:join:${r.id}`}
                >
                  {inIt ? "Open" : full ? "Full" : "Join"}
                </Button>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
