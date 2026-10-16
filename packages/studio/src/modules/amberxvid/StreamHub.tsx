/**
 * @file The live-stream engine (client half) — one hook, mounted once in the
 * module shell like `useVideoChat`, and SINCE P7 a client of the media server
 * rather than a mesh of peer connections:
 *
 *   HOSTING   ONE upstream, whatever the audience (`MEDIA_CONTRACT.topology`):
 *             join the media room the stream id names, one send transport,
 *             produce mic audio plus SIMULCAST video — three spatial layers
 *             (¼, ½, full resolution) in one producer, so the server can fan
 *             each viewer the layer that fits them. The mesh's one-connection-
 *             per-viewer fan-out is DELETED; a new viewer costs the host
 *             nothing, which is the constant-uplink promise this whole
 *             conversion exists to keep. The 10 s poster timer is unchanged.
 *   WATCHING  one recv transport consuming the host's producers, keyed by
 *             streamId — so a full watch and a hover PREVIEW of a different
 *             stream can still run at the same time. New producers arrive as
 *             `room-media` snapshot announcements on the messenger SSE stream
 *             (the shell points `handleRoomMedia` here), reconciled the same
 *             way the P6 call engine does.
 *   PREVIEWS  `startPreview(streamId, onStream)` is now just a consumer with
 *             the `preview` role from the P1 vocabulary: video only, lowest
 *             simulcast layer (a thumbnail must not pull the host's full
 *             resolution), never listed, never chatting. The 15 s clock in
 *             the tile is a courtesy; the SEAT is leased server-side
 *             (`MEDIA_TIMING.previewLeaseMs`) and dies there whether or not
 *             this client behaves.
 *
 * What is GONE, deliberately and completely: the per-viewer
 * `RTCPeerConnection` map, the offer/answer dance, the ICE candidate queues,
 * the TURN-credential fetch, and every `viewer-join`/`viewer-leave`/`sdp`/
 * `ice` signal — the stream-side relay died with the mesh
 * (`MEDIA_CONTRACT.signaling`). Room chat still lives here — ephemeral,
 * arriving over `stream-chat` events, deduped by id, dead with the room.
 */
"use client";

import * as React from "react";
// Type-only at module scope: the browser RTC library must never run on the
// server — the Device implementation is imported dynamically, in the call
// (the P6 rule, kept).
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
import {
  STREAM_PREVIEW_S,
  type MessengerEvent,
  type StreamAlert,
  type StreamChatMessage,
  type StreamInfo,
  type VideoChatSettings,
} from "./lib/types";
import { MEDIA_FAILURE_USER_COPY } from "./lib/mediaContract";
import type { MediaKind, MediaRoomSnapshot } from "./lib/mediaContract";
import {
  failureCopy,
  mediaApiPost,
  probeMediaHealth,
  reconnectDelayMs,
  sleep,
} from "./lib/mediaHealth";

/* ---------------------------------- helpers ----------------------------------- */

const lower = (u: string): string => u.trim().toLowerCase();

/** The video-chat settings key — the stream capture honours the same camera/
 *  mic/resolution choices the user already made for calls. */
const VIDEOCHAT_SETTINGS_KEY = "gx:amberxvid:videochat";

const POSTER_EVERY_MS = 10_000;
const POSTER_WIDTH = 320;

/**
 * The host's three spatial layers — the first thing the SFU buys (P7). One
 * producer carries all three; the server fans each subscriber the layer they
 * asked for and the host's uplink is the SUM OF THESE, once, regardless of
 * audience size.
 */
const SIMULCAST_ENCODINGS = [
  { rid: "r0", scaleResolutionDownBy: 4, maxBitrate: 150_000 },
  { rid: "r1", scaleResolutionDownBy: 2, maxBitrate: 500_000 },
  { rid: "r2", scaleResolutionDownBy: 1, maxBitrate: 1_200_000 },
];

/** The spatial layer that FITS a display of `px` device pixels: the smallest
 *  layer that covers it. A phone viewer must not pull the host's full
 *  resolution — that sentence is this function. */
function fitSpatialLayer(px: number): 0 | 1 | 2 {
  if (px <= 480) return 0;
  if (px <= 960) return 1;
  return 2;
}

async function postStreams(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const res = await fetch("/api/amberxvid/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return ((await res.json().catch(() => null)) as Record<string, unknown> | null) ?? { ok: false, error: `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: "request failed" };
  }
}

/** What the media route answers — loosely typed on purpose: every field the
 *  client forwards to mediasoup-client is opaque vocabulary it never parses. */
type MediaReply = Record<string, unknown>;

/** One POST to the media API — the shared P11 helper, whose refusals carry
 *  the closed `MediaFailure` vocabulary and its user copy. */
const mediaPost = (body: Record<string, unknown>): Promise<MediaReply> => mediaApiPost(body);

/** Best-effort seat vacate — a dead server cannot stop a client from leaving,
 *  and the bridge's keepalive folds the seat anyway. */
function mediaLeave(participantId: string | null): void {
  if (!participantId) return;
  void fetch("/api/amberxvid/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "leave", participantId }),
  }).catch(() => undefined);
}

/* ------------------------------------ legs ------------------------------------- */

/** The host's media-plane state: one seat, one send transport, one producer
 *  per kind — there is no per-viewer anything here any more. */
interface HostLeg {
  streamId: string;
  participantId: string | null;
  sendTransport: Transport | null;
  producers: Partial<Record<MediaKind, Producer>>;
  closed: boolean;
}

/** One watched room's media-plane state — a full watch OR a hover preview. */
interface WatchLeg {
  streamId: string;
  preview: boolean;
  participantId: string | null;
  device: Device | null;
  recvTransport: Transport | null;
  /** producerId → consumer ("pending" while its consume round-trip is in
   *  flight, so a burst of announcements cannot double-subscribe). */
  consumers: Map<string, Consumer | "pending">;
  /** An announcement that arrived before the transport existed — played back
   *  once it is up. */
  pendingSnapshot: MediaRoomSnapshot | null;
  closed: boolean;
  onStream: (stream: MediaStream | null) => void;
}

/* ------------------------------------ hub -------------------------------------- */

export interface StreamHub {
  /**
   * Every live room, **ordered followed-live first** (P12).
   *
   * The ordering is the hub's rather than each list's on purpose: three
   * surfaces render this array (the streams stage, the toolbar count, the
   * social rail), and an ordering applied per surface is an ordering that
   * disagrees between them. Inside each group the server's own order is kept —
   * newest first — so the rule reads "the people you follow, then everybody
   * else, each newest first".
   */
  streams: StreamInfo[];
  /** The room I am hosting, when live. */
  myStream: StreamInfo | null;
  /** The room I am watching full-size, when any. */
  watching: StreamInfo | null;
  /** The room the window shows (my own when hosting, the watched one else). */
  room: StreamInfo | null;
  roomOpen: boolean;
  chat: StreamChatMessage[];
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  busy: boolean;
  goLive: (title: string, description?: string) => Promise<boolean>;
  endLive: () => Promise<void>;
  /* ------------------------------ P12: follows ------------------------------ */
  /** Normalized usernames I follow — guard-filtered by the server. */
  following: string[];
  /** Follower counts by normalized username, for the names on screen. */
  followerCounts: Record<string, number>;
  isFollowing: (user: string) => boolean;
  /** Follow or unfollow. One verb, because the UI is one toggle. */
  setFollow: (user: string, on: boolean) => Promise<boolean>;
  /** Pull one member's follower count (and my own follow state for them) into
   *  `followerCounts` / `following`. The boot read only covers people I already
   *  follow, so the identity row of a stranger's room asks for theirs. */
  refreshFollowInfo: (user: string) => void;
  /** The last "somebody you follow went live" alert, so a surface can offer a
   *  way IN rather than only a toast that scrolls away. */
  lastAlert: StreamAlert | null;
  dismissAlert: () => void;
  /* ---------------------------- P12: host tools ---------------------------- */
  /** Retitle / re-describe MY live stream. Either field alone. */
  describe: (patch: { title?: string; description?: string }) => Promise<boolean>;
  /** Remove a viewer from my room. Their seat goes, the removal sticks, and
   *  the media bridge's keepalive closes their consumers server-side. */
  removeViewer: (user: string) => Promise<boolean>;
  watch: (streamId: string) => Promise<boolean>;
  leaveWatch: () => Promise<void>;
  sendChat: (text: string) => Promise<boolean>;
  openRoom: () => void;
  closeRoom: () => void;
  /** Host mic/camera toggle — SERVER-KNOWN since P7: pauses the producer, so
   *  the SFU stops fanning that upstream; disabling the local track is just
   *  the local echo of the same fact (the P6 mute rule, applied here). */
  setTrackEnabled: (kind: "audio" | "video", on: boolean) => void;
  /** P11: the media leg (host upstream or full watch) died and the backoff
   *  loop is rejoining the SAME P3 room record. The room stays open and the
   *  UI says which — there is no peer-to-peer fallback to fall to. */
  mediaReconnecting: boolean;
  /** The server is writing this room to disk right now (P10) — true for the
   *  host AND for watchers, straight from the room snapshot, so the room UI
   *  can say so on screen for everyone being recorded. */
  recording: boolean;
  /** Host only, told at join: whether the server CAN record at all. */
  recordingAvailable: boolean;
  /** The honest sentence behind a disabled record toggle (no ffmpeg on the
   *  media-server machine, no disk headroom). Null when available. */
  recordingReason: string | null;
  /** Host toggle for the server-side recording (P10). The flip everyone sees
   *  comes back through the snapshot announcement — server truth, not local
   *  optimism alone. */
  setRecording: (on: boolean) => Promise<void>;
  /** Hidden hover player: attaches, feeds `onStream`, returns a stopper. The
   *  15 s clock belongs to the caller (the tile); the SEAT's lease belongs to
   *  the server. */
  startPreview: (streamId: string, onStream: (s: MediaStream | null) => void) => Promise<() => void>;
  /** The SSE dispatcher — the shell points the messenger link here. */
  handleEvent: (event: MessengerEvent) => void;
  /** `room-media` announcements — the shell fans them here as well as to the
   *  call engine; snapshots for rooms this hub is not attached to are ignored. */
  handleRoomMedia: (roomId: string, snapshot: MediaRoomSnapshot) => void;
  /** Live stream hosted by a user, if any — badge/menu convenience. */
  streamOf: (user: string) => StreamInfo | null;
}

export function useStreamHub({
  me,
  notify,
}: {
  me: string;
  notify: (msg: string, detail?: string) => void;
}): StreamHub {
  const [streams, setStreams] = React.useState<StreamInfo[]>([]);
  const [myStreamId, setMyStreamId] = React.useState<string | null>(null);
  const [watchingId, setWatchingId] = React.useState<string | null>(null);
  const [roomOpen, setRoomOpen] = React.useState(false);
  const [chat, setChat] = React.useState<StreamChatMessage[]>([]);
  const [localStream, setLocalStream] = React.useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = React.useState<MediaStream | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [recording, setRecordingState] = React.useState(false);
  const [recordingAvailable, setRecordingAvailable] = React.useState(false);
  const [recordingReason, setRecordingReason] = React.useState<string | null>(null);
  const [mediaReconnecting, setMediaReconnecting] = React.useState(false);
  // P12 — the follow graph, held here because the ORDERING of `streams` is
  // computed from it and the ordering belongs to the hub (see `StreamHub`).
  const [following, setFollowing] = React.useState<string[]>([]);
  const [followerCounts, setFollowerCounts] = React.useState<Record<string, number>>({});
  const [lastAlert, setLastAlert] = React.useState<StreamAlert | null>(null);

  /** Host side: the ONE media leg (was: one peer connection per viewer). */
  const hostLeg = React.useRef<HostLeg | null>(null);
  /** Viewer side: one leg per attached room (full watch AND previews). */
  const watchLegs = React.useRef<Map<string, WatchLeg>>(new Map());
  const localRef = React.useRef<MediaStream | null>(null);
  const posterTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const posterVideo = React.useRef<HTMLVideoElement | null>(null);
  /** P11 reconnect loops — bumped to cancel; assigned-late refs break the
   *  connect-handler → reconnect → connect cycle without stale closures. */
  const hostReconnectSeq = React.useRef(0);
  const watchReconnectSeq = React.useRef(0);
  const beginHostReconnectRef = React.useRef<(streamId: string) => void>(() => undefined);
  const beginWatchReconnectRef = React.useRef<(streamId: string) => void>(() => undefined);

  // SSE handlers act on live state through this ref, never a stale closure.
  const live = React.useRef({ me, myStreamId, watchingId, streams });
  live.current = { me, myStreamId, watchingId, streams };

  /* ------------------------------- host plumbing ------------------------------- */

  const stopLocal = React.useCallback(() => {
    for (const track of localRef.current?.getTracks() ?? []) track.stop();
    localRef.current = null;
    setLocalStream(null);
  }, []);

  /** Fold the host's MEDIA leg only (P11): transports, producers, seat and
   *  the stats hook go; camera, poster pipeline and the room record stay —
   *  which is exactly what lets a reconnect republish into the same room. */
  const foldHostMedia = React.useCallback(() => {
    const leg = hostLeg.current;
    if (leg) {
      leg.closed = true;
      try {
        leg.sendTransport?.close();
      } catch {
        /* already closed */
      }
      leg.producers = {};
      mediaLeave(leg.participantId);
      hostLeg.current = null;
    }
    delete (window as unknown as Record<string, unknown>).__axvHostVideoStats;
  }, []);

  const teardownHost = React.useCallback(() => {
    hostReconnectSeq.current += 1; // cancel any running host reconnect loop
    setMediaReconnecting(false);
    foldHostMedia();
    if (posterTimer.current) {
      clearInterval(posterTimer.current);
      posterTimer.current = null;
    }
    if (posterVideo.current) {
      posterVideo.current.srcObject = null;
      posterVideo.current = null;
    }
    stopLocal();
    setMyStreamId(null);
    setRecordingState(false);
    setRecordingAvailable(false);
    setRecordingReason(null);
  }, [foldHostMedia, stopLocal]);

  const teardownWatch = React.useCallback((streamId: string) => {
    const leg = watchLegs.current.get(streamId);
    if (!leg) return;
    if (!leg.preview) {
      watchReconnectSeq.current += 1; // cancel any running watch reconnect loop
      setMediaReconnecting(false);
    }
    leg.closed = true;
    for (const c of leg.consumers.values()) {
      if (typeof c !== "string") {
        try {
          c.close();
        } catch {
          /* already closed */
        }
      }
    }
    leg.consumers.clear();
    try {
      leg.recvTransport?.close();
    } catch {
      /* already closed */
    }
    mediaLeave(leg.participantId);
    leg.onStream(null);
    if (!leg.preview) {
      delete (window as unknown as Record<string, unknown>).__axvWatchVideoStats;
      setRecordingState(false);
    }
    watchLegs.current.delete(streamId);
    setWatchingId((w) => (w === streamId ? null : w));
  }, []);

  /** Paint the current outgoing frame and post it as the room's poster. */
  const capturePoster = React.useCallback(async (streamId: string) => {
    const video = posterVideo.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    const scale = POSTER_WIDTH / video.videoWidth;
    canvas.width = POSTER_WIDTH;
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.55);
    await postStreams({ action: "thumbnail", streamId, dataUrl });
  }, []);

  /** Wire the transport's `connect` handshake and its failure path. On a
   *  `disconnected` wobble the /health probe decides (P11): a down server
   *  starts recovery now instead of after ICE's slow failure clock; a blip
   *  with a healthy server is left to recover by itself. */
  const wireTransport = React.useCallback(
    (transport: Transport, participantId: string, onFailed: () => void) => {
      transport.on("connect", ({ dtlsParameters }: { dtlsParameters: DtlsParameters }, callback, errback) => {
        mediaPost({ action: "connect", participantId, transportId: transport.id, dtlsParameters })
          .then(() => callback())
          .catch((err: Error) => errback(err));
      });
      transport.on("connectionstatechange", (state) => {
        if (state === "failed") onFailed();
        else if (state === "disconnected") {
          void probeMediaHealth().then((h) => {
            if (!h.up) onFailed();
          });
        }
      });
    },
    [],
  );

  const transportParams = (reply: MediaReply) => ({
    id: String(reply.transportId),
    iceParameters: reply.iceParameters as IceParameters,
    iceCandidates: reply.iceCandidates as IceCandidate[],
    dtlsParameters: reply.dtlsParameters as DtlsParameters,
  });

  /**
   * The host's whole transport half: join the media room the stream id names,
   * one send transport, produce mic audio + simulcast video. Replaces the
   * mesh's per-viewer offer dance entirely — nothing here ever hears about a
   * viewer again.
   */
  const connectHostMedia = React.useCallback(
    async (streamId: string, stream: MediaStream) => {
      const leg: HostLeg = { streamId, participantId: null, sendTransport: null, producers: {}, closed: false };
      hostLeg.current = leg;

      const joined = await mediaPost({ action: "join", roomId: streamId });
      if (leg.closed) {
        mediaLeave(String(joined.participantId));
        return;
      }
      leg.participantId = String(joined.participantId);

      // P10: told at the door whether the server can record — an absent
      // ffmpeg or a full disk renders as a disabled toggle WITH the reason.
      setRecordingAvailable(joined.recordingAvailable === true);
      setRecordingReason(typeof joined.recordingReason === "string" ? joined.recordingReason : null);
      const joinSnap = joined.snapshot as MediaRoomSnapshot | undefined;
      setRecordingState(joinSnap?.recording === true);

      const { Device: MediaDevice } = await import("mediasoup-client");
      const device = new MediaDevice();
      await device.load({ routerRtpCapabilities: joined.routerRtpCapabilities as RtpCapabilities });
      if (leg.closed) return;

      const sendReply = await mediaPost({ action: "transport", participantId: leg.participantId, direction: "send" });
      if (leg.closed) return;
      const sendTransport = device.createSendTransport(transportParams(sendReply));
      wireTransport(sendTransport, leg.participantId, () => {
        // P11: a dead media leg is a RECONNECT, not the end of the broadcast.
        // The room record is still live (its heartbeats ride the presence SSE
        // stream) and the media server rebuilds the room at rejoin — so the
        // room stays open, says why the picture stopped, and republishes by
        // itself when the server is back.
        if (hostLeg.current !== leg || leg.closed) return;
        notify("Media link to the server lost", "your room stays open — reconnecting automatically");
        beginHostReconnectRef.current(streamId);
      });
      sendTransport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
        const mediaKind = typeof appData?.mediaKind === "string" ? appData.mediaKind : kind;
        mediaPost({
          action: "produce",
          participantId: leg.participantId,
          transportId: sendTransport.id,
          kind: mediaKind,
          rtpParameters,
        })
          .then((reply) => callback({ id: String(reply.producerId) }))
          .catch((err: Error) => errback(err));
      });
      leg.sendTransport = sendTransport;

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      if (videoTrack) {
        leg.producers.video = await sendTransport.produce({
          track: videoTrack,
          encodings: SIMULCAST_ENCODINGS,
          codecOptions: { videoGoogleStartBitrate: 1000 },
          appData: { mediaKind: "video" },
        });
      }
      if (audioTrack) {
        leg.producers.audio = await sendTransport.produce({
          track: audioTrack,
          appData: { mediaKind: "audio" },
        });
      }

      // Diagnostics hook, deliberately tiny: the host's outbound-rtp stats by
      // simulcast layer. This is what the P7 gate MEASURES — host uplink with
      // one viewer vs three must be within noise — and what a session debugs
      // a broadcast with. Removed on teardown.
      (window as unknown as Record<string, unknown>).__axvHostVideoStats = async () => {
        const producer = hostLeg.current?.producers.video;
        if (!producer || producer.closed) return null;
        const stats = await producer.getStats();
        const out: Record<string, unknown>[] = [];
        stats.forEach((s: Record<string, unknown> & { type?: string }) => {
          if (s.type === "outbound-rtp") {
            out.push({ rid: s.rid, ssrc: s.ssrc, bytesSent: s.bytesSent, timestamp: s.timestamp });
          }
        });
        return out;
      };
    },
    [notify, wireTransport],
  );

  /* ------------------------------ viewer plumbing ------------------------------- */

  /** Rebuild the leg's MediaStream from every live consumer's track — one
   *  callback per change, so the <video> re-attaches exactly when the track
   *  set changes. */
  const syncLegStream = React.useCallback((leg: WatchLeg) => {
    const tracks: MediaStreamTrack[] = [];
    for (const c of leg.consumers.values()) {
      if (typeof c !== "string" && !c.closed) tracks.push(c.track);
    }
    leg.onStream(tracks.length > 0 ? new MediaStream(tracks) : null);
  }, []);

  /**
   * Reconcile one leg against the server's announced truth: consume producers
   * we do not hold, drop consumers whose producer vanished. The snapshot is
   * the WHOLE truth per announcement — no deltas, so a missed event costs
   * nothing once the next one lands. A preview consumes VIDEO ONLY, at the
   * lowest layer; a full watch consumes everything at the layer that fits
   * this window.
   */
  const reconcileLeg = React.useCallback(
    async (leg: WatchLeg, snapshot: MediaRoomSnapshot) => {
      const recv = leg.recvTransport;
      const device = leg.device;
      const pid = leg.participantId;
      if (!recv || !device || !pid) {
        leg.pendingSnapshot = snapshot;
        return;
      }

      // P10: the on-screen consent fact rides every snapshot. A full watch
      // surfaces it; a hover preview has no room UI to say it in, and its
      // seat is not part of the room's roster either.
      if (!leg.preview) setRecordingState(snapshot.recording === true);

      const wanted = snapshot.producers.filter((p) => !leg.preview || p.kind === "video");
      const wantedIds = new Set(wanted.map((p) => p.producerId));
      let changed = false;
      for (const [producerId, consumer] of [...leg.consumers]) {
        if (wantedIds.has(producerId)) continue;
        leg.consumers.delete(producerId);
        if (typeof consumer !== "string") {
          try {
            consumer.close();
          } catch {
            /* already closed */
          }
          changed = true;
        }
      }

      for (const info of wanted) {
        if (leg.consumers.has(info.producerId)) continue;
        leg.consumers.set(info.producerId, "pending");
        try {
          const reply = await mediaPost({
            action: "consume",
            participantId: pid,
            transportId: recv.id,
            producerId: info.producerId,
            rtpCapabilities: device.rtpCapabilities,
          });
          // Torn down (or superseded) while the round-trip was in flight.
          if (leg.closed || leg.recvTransport !== recv || !leg.consumers.has(info.producerId)) continue;
          const consumer = await recv.consume({
            id: String(reply.consumerId),
            producerId: info.producerId,
            kind: reply.kind as "audio" | "video",
            rtpParameters: reply.rtpParameters as RtpParameters,
          });
          leg.consumers.set(info.producerId, consumer);
          changed = true;
          if (!leg.preview && info.kind === "video") {
            // The watch-side twin of the host's diagnostics hook: this full
            // watch's inbound video stats (bytes received, decoded size) —
            // what the P7 gate reads to prove media still flows and the
            // fitted layer is the one arriving. Removed on teardown.
            (window as unknown as Record<string, unknown>).__axvWatchVideoStats = async () => {
              if (consumer.closed) return null;
              const stats = await consumer.getStats();
              const out: Record<string, unknown>[] = [];
              stats.forEach((s: Record<string, unknown> & { type?: string }) => {
                if (s.type === "inbound-rtp") {
                  out.push({
                    bytesReceived: s.bytesReceived,
                    framesDecoded: s.framesDecoded,
                    frameWidth: s.frameWidth,
                    frameHeight: s.frameHeight,
                    timestamp: s.timestamp,
                  });
                }
              });
              return out;
            };
          }
          // Created paused server-side (the black-tile rule) — resume now that
          // the client holds the consumer and its track.
          await mediaPost({ action: "resume", participantId: pid, consumerId: consumer.id });
          if (info.kind === "video") {
            // The simulcast pick (P7): a preview is a thumbnail and takes the
            // bottom layer; a full watch takes the smallest layer covering
            // this window's device pixels.
            const spatialLayer = leg.preview
              ? 0
              : fitSpatialLayer(Math.round(window.innerWidth * (window.devicePixelRatio || 1)));
            await mediaPost({ action: "layers", participantId: pid, consumerId: consumer.id, spatialLayer });
          }
        } catch {
          leg.consumers.delete(info.producerId);
        }
      }
      if (changed) syncLegStream(leg);
    },
    [syncLegStream],
  );

  /** Join the media room for a registered watch leg and consume what is
   *  already there. The `join` reply carries the first snapshot; a re-pull
   *  closes the gap to the announcement wire, exactly as the call engine does. */
  const connectWatchMedia = React.useCallback(
    async (leg: WatchLeg) => {
      const joined = await mediaPost({ action: "join", roomId: leg.streamId });
      if (leg.closed) {
        mediaLeave(String(joined.participantId));
        return;
      }
      leg.participantId = String(joined.participantId);

      const { Device: MediaDevice } = await import("mediasoup-client");
      const device = new MediaDevice();
      await device.load({ routerRtpCapabilities: joined.routerRtpCapabilities as RtpCapabilities });
      if (leg.closed) return;
      leg.device = device;

      const recvReply = await mediaPost({ action: "transport", participantId: leg.participantId, direction: "recv" });
      if (leg.closed) return;
      const recvTransport = device.createRecvTransport(transportParams(recvReply));
      wireTransport(recvTransport, leg.participantId, () => {
        if (watchLegs.current.get(leg.streamId) !== leg || leg.closed) return;
        if (leg.preview) {
          // A hover preview earns no reconnect — it folds quietly.
          teardownWatch(leg.streamId);
          return;
        }
        // P11: the viewer STAYS in the room. The record seat is still held,
        // so the loop rejoins the same room and the player resumes without
        // the host doing anything.
        notify("Media link to the server lost", "reconnecting — the stream resumes by itself");
        beginWatchReconnectRef.current(leg.streamId);
      });
      leg.recvTransport = recvTransport;

      await reconcileLeg(leg, joined.snapshot as MediaRoomSnapshot);
      const fresh = await mediaPost({ action: "snapshot", participantId: leg.participantId });
      if (leg.closed) return;
      await reconcileLeg(leg, fresh.snapshot as MediaRoomSnapshot);
      if (leg.pendingSnapshot) {
        const pending = leg.pendingSnapshot;
        leg.pendingSnapshot = null;
        await reconcileLeg(leg, pending);
      }
    },
    [notify, reconcileLeg, teardownWatch, wireTransport],
  );

  /* --------------------------- P11 reconnect loops ------------------------------- */

  /** Fold a full watch's MEDIA only: consumers, transport and seat go; the leg
   *  stays registered and the room stays open, so a rejoin lands in place. */
  const foldWatchMedia = React.useCallback((leg: WatchLeg) => {
    for (const c of leg.consumers.values()) {
      if (typeof c !== "string") {
        try {
          c.close();
        } catch {
          /* already closed */
        }
      }
    }
    leg.consumers.clear();
    try {
      leg.recvTransport?.close();
    } catch {
      /* already closed */
    }
    leg.recvTransport = null;
    leg.device = null;
    leg.pendingSnapshot = null;
    mediaLeave(leg.participantId);
    leg.participantId = null;
    leg.onStream(null);
    delete (window as unknown as Record<string, unknown>).__axvWatchVideoStats;
  }, []);

  /**
   * The host's reconnect (P11): rejoin the SAME room record with backoff and
   * republish the SAME capture — viewers' players resume from the announced
   * snapshot without the host doing anything. Unbounded on purpose; it ends
   * when the room ends, the host ends it, or the rejoin lands. No mesh
   * fallback exists to fall to (`NO_FALLBACK_DECISION`).
   */
  const beginHostReconnect = React.useCallback(
    (streamId: string) => {
      if (live.current.myStreamId !== streamId) return;
      foldHostMedia();
      setMediaReconnecting(true);
      const seq = ++hostReconnectSeq.current;
      const cancelled = (): boolean =>
        hostReconnectSeq.current !== seq || live.current.myStreamId !== streamId;
      void (async () => {
        for (let attempt = 0; ; attempt += 1) {
          await sleep(reconnectDelayMs(attempt));
          if (cancelled()) return;
          const health = await probeMediaHealth();
          if (cancelled()) return;
          if (!health.up) continue;
          const stream = localRef.current;
          if (!stream) {
            // The capture is gone — nothing to republish. End honestly rather
            // than leaving a LIVE badge over nothing, ever again.
            void postStreams({ action: "close", streamId });
            teardownHost();
            setRoomOpen(false);
            return;
          }
          try {
            await connectHostMedia(streamId, stream);
            if (cancelled()) return;
            setMediaReconnecting(false);
            notify("Reconnected", "your stream is publishing to the media server again");
            return;
          } catch {
            // Rejoin failed partway — fold the half-built leg so the next
            // attempt starts clean.
            if (!cancelled()) foldHostMedia();
          }
        }
      })();
    },
    [connectHostMedia, foldHostMedia, notify, teardownHost],
  );
  beginHostReconnectRef.current = beginHostReconnect;

  /** The viewer's reconnect (P11): same loop, consuming side — the record
   *  seat is still held, so the rejoin consumes the announced producers and
   *  the player resumes in place. */
  const beginWatchReconnect = React.useCallback(
    (streamId: string) => {
      const leg = watchLegs.current.get(streamId);
      if (!leg || leg.preview) return;
      foldWatchMedia(leg);
      setMediaReconnecting(true);
      const seq = ++watchReconnectSeq.current;
      const cancelled = (): boolean =>
        watchReconnectSeq.current !== seq || watchLegs.current.get(streamId) !== leg || leg.closed;
      void (async () => {
        for (let attempt = 0; ; attempt += 1) {
          await sleep(reconnectDelayMs(attempt));
          if (cancelled()) return;
          const health = await probeMediaHealth();
          if (cancelled()) return;
          if (!health.up) continue;
          try {
            await connectWatchMedia(leg);
            if (cancelled()) return;
            setMediaReconnecting(false);
            notify("Reconnected", "the stream resumed");
            return;
          } catch {
            // Rejoin failed partway — fold the leg's half-built media so the
            // next attempt starts clean (the leg itself stays registered).
            if (!cancelled()) foldWatchMedia(leg);
          }
        }
      })();
    },
    [connectWatchMedia, foldWatchMedia, notify],
  );
  beginWatchReconnectRef.current = beginWatchReconnect;

  /* ------------------------------- SSE dispatch --------------------------------- */

  const handleRoomMedia = React.useCallback(
    (roomId: string, snapshot: MediaRoomSnapshot) => {
      // The host consumes nothing — but the recording fact (P10) is theirs to
      // see too: the REC state in their own room UI follows the server's
      // announcement, the same truth every viewer renders.
      if (live.current.myStreamId === roomId) {
        setRecordingState(snapshot.recording === true);
        return;
      }
      const leg = watchLegs.current.get(roomId);
      if (leg) void reconcileLeg(leg, snapshot);
    },
    [reconcileLeg],
  );

  const handleEvent = React.useCallback(
    (event: MessengerEvent) => {
      if (event.type === "stream-signal") {
        // The one stream signal left (P7): the room ended out from under its
        // watchers. sdp/ice/viewer-join/viewer-leave died with the mesh.
        const leg = watchLegs.current.get(event.signal.streamId);
        if (leg) {
          const wasFull = !leg.preview;
          teardownWatch(event.signal.streamId);
          if (wasFull) {
            notify("Stream ended", "the host went off air");
            setRoomOpen(false);
          }
        }
        return;
      }
      if (event.type === "stream-alert") {
        // P12 — somebody I follow went live. The server decided I was allowed
        // to be told (the follow graph AND the do-not-disturb chokepoint), so
        // there is nothing to filter here: ring, and leave a way in.
        setLastAlert(event.alert);
        notify(`${event.alert.hostDisplay} is live`, event.alert.title);
        return;
      }
      if (event.type === "stream-chat") {
        const { myStreamId: hosting, watchingId: watchingNow } = live.current;
        if (event.streamId === hosting || event.streamId === watchingNow) {
          setChat((c) => (c.some((m) => m.id === event.message.id) ? c : [...c, event.message]));
        }
        return;
      }
      if (event.type !== "streams") return;

      setStreams(event.streams);
      const { myStreamId: hosting, watchingId: watchingNow } = live.current;
      const ids = new Set(event.streams.map((s) => s.id));
      if (hosting && !ids.has(hosting)) {
        // Ended out from under us (an administrator, or the server bounced).
        teardownHost();
        setRoomOpen(false);
        notify("Your stream was ended");
      }
      if (watchingNow && !ids.has(watchingNow)) {
        teardownWatch(watchingNow);
        setRoomOpen(false);
      }
      // Previews of vanished rooms fold quietly.
      for (const id of [...watchLegs.current.keys()]) {
        if (!ids.has(id)) teardownWatch(id);
      }
    },
    [notify, teardownHost, teardownWatch],
  );

  /* --------------------------------- actions ------------------------------------ */

  const goLive = React.useCallback(
    async (title: string, description?: string): Promise<boolean> => {
      if (live.current.myStreamId) {
        setRoomOpen(true);
        return true;
      }
      setBusy(true);
      try {
        // P11: probe the media server BEFORE touching the camera. A dead
        // server is a fast named refusal, not a permission prompt, an open
        // room and a spinner.
        const health = await probeMediaHealth();
        if (!health.up) {
          notify("Can't go live", MEDIA_FAILURE_USER_COPY["server-unreachable"]);
          return false;
        }
        // Honour the camera/mic/resolution the member already picked for calls.
        let settings: Partial<VideoChatSettings> = {};
        try {
          settings = JSON.parse(localStorage.getItem(VIDEOCHAT_SETTINGS_KEY) ?? "{}") as Partial<VideoChatSettings>;
        } catch {
          /* defaults */
        }
        const [w, h] = (settings.resolution ?? "1280x720").split("x").map(Number);
        const video: MediaTrackConstraints = { width: { ideal: w || 1280 }, height: { ideal: h || 720 } };
        if (settings.cameraId && settings.cameraId !== "default") video.deviceId = { exact: settings.cameraId };
        const audio: MediaTrackConstraints = {};
        if (settings.micId && settings.micId !== "default") audio.deviceId = { exact: settings.micId };
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio });
        } catch {
          notify("Camera/microphone unavailable", "going live needs both permissions");
          return false;
        }

        const json = await postStreams({ action: "open", title, description: description ?? "" });
        if (json.ok !== true) {
          for (const t of stream.getTracks()) t.stop();
          notify("Could not go live", String(json.error ?? "unknown error"));
          return false;
        }
        const info = json.stream as StreamInfo;
        localRef.current = stream;
        setLocalStream(stream);

        // The ONE upstream. If the media plane refuses, the room must not sit
        // there as a LIVE badge over nothing — close it and say why.
        try {
          await connectHostMedia(info.id, stream);
        } catch (err) {
          await postStreams({ action: "close", streamId: info.id });
          teardownHost();
          notify("Could not go live", failureCopy(err));
          return false;
        }

        setMyStreamId(info.id);
        setChat([]);
        setRoomOpen(true);

        // The poster pipeline: a hidden element playing the capture, painted
        // every 10 s (first frame ASAP so the tile is never a grey box).
        const v = document.createElement("video");
        v.muted = true;
        v.srcObject = stream;
        void v.play().catch(() => undefined);
        posterVideo.current = v;
        setTimeout(() => void capturePoster(info.id), 1200);
        posterTimer.current = setInterval(() => void capturePoster(info.id), POSTER_EVERY_MS);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [capturePoster, connectHostMedia, notify, teardownHost],
  );

  const endLive = React.useCallback(async () => {
    const id = live.current.myStreamId;
    if (!id) return;
    await postStreams({ action: "close", streamId: id });
    teardownHost();
    setRoomOpen(false);
    notify("Stream ended");
  }, [notify, teardownHost]);

  const leaveWatchInner = React.useCallback(async () => {
    const id = live.current.watchingId;
    if (!id) return;
    await postStreams({ action: "leave", streamId: id });
    teardownWatch(id);
    setChat([]);
  }, [teardownWatch]);

  const watch = React.useCallback(
    async (streamId: string): Promise<boolean> => {
      if (live.current.myStreamId === streamId) {
        setRoomOpen(true);
        return true;
      }
      const existing = watchLegs.current.get(streamId);
      if (existing && !existing.preview) {
        setRoomOpen(true);
        return true;
      }
      // P11: the door probe — joining a room on a dead media server is a fast
      // named refusal, not a spinner over a black stage.
      const health = await probeMediaHealth();
      if (!health.up) {
        notify("Can't join", MEDIA_FAILURE_USER_COPY["server-unreachable"]);
        return false;
      }
      // A hover preview of this room upgrades by REPLACEMENT: the preview leg
      // (and its media seat) folds, the roster join swaps the record seat's
      // role to `viewer`, and a fresh media join is minted against that seat —
      // the token follows the record, so an upgrade is a re-join, not a
      // mutation.
      if (existing) teardownWatch(streamId);
      // One full watch at a time — leaving the previous room first.
      if (live.current.watchingId && live.current.watchingId !== streamId) await leaveWatchInner();

      const leg: WatchLeg = {
        streamId,
        preview: false,
        participantId: null,
        device: null,
        recvTransport: null,
        consumers: new Map(),
        pendingSnapshot: null,
        closed: false,
        onStream: (s) => setRemoteStream(s),
      };
      watchLegs.current.set(streamId, leg);
      const json = await postStreams({ action: "join", streamId });
      if (json.ok !== true) {
        watchLegs.current.delete(streamId);
        notify("Could not join", String(json.error ?? "unknown error"));
        return false;
      }
      try {
        await connectWatchMedia(leg);
      } catch (err) {
        void postStreams({ action: "leave", streamId });
        teardownWatch(streamId);
        notify("Could not join", failureCopy(err));
        return false;
      }
      setWatchingId(streamId);
      setChat(Array.isArray(json.chat) ? (json.chat as StreamChatMessage[]) : []);
      setRoomOpen(true);
      return true;
    },
    [connectWatchMedia, leaveWatchInner, notify, teardownWatch],
  );

  const leaveWatch = React.useCallback(async () => {
    await leaveWatchInner();
    setRoomOpen(false);
  }, [leaveWatchInner]);

  const sendChat = React.useCallback(async (text: string): Promise<boolean> => {
    const id = live.current.myStreamId ?? live.current.watchingId;
    if (!id) return false;
    const json = await postStreams({ action: "chat", streamId: id, text });
    return json.ok === true;
  }, []);

  /* --------------------------------- P12 follows -------------------------------- */

  /** Fold a `/api/amberxvid/follows` answer into state. One shape, two callers
   *  (the boot read and every toggle), so the two cannot drift. */
  const applyFollows = React.useCallback((json: Record<string, unknown> | null): void => {
    if (!json || json.ok !== true) return;
    if (Array.isArray(json.following)) setFollowing(json.following as string[]);
    if (json.counts && typeof json.counts === "object") {
      setFollowerCounts((c) => ({ ...c, ...(json.counts as Record<string, number>) }));
    }
  }, []);

  const setFollow = React.useCallback(
    async (user: string, on: boolean): Promise<boolean> => {
      try {
        const res = await fetch("/api/amberxvid/follows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: on ? "follow" : "unfollow", user }),
        });
        const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!res.ok || json?.ok !== true) {
          notify(on ? "Could not follow" : "Could not unfollow", String(json?.error ?? "the store refused it"));
          return false;
        }
        applyFollows(json);
        notify(on ? `Following ${user}` : `Unfollowed ${user}`, on ? "their streams come to the top of your list, and you get an alert when they go live" : undefined);
        return true;
      } catch {
        notify("Could not reach the follow store");
        return false;
      }
    },
    [applyFollows, notify],
  );

  const isFollowing = React.useCallback(
    (user: string): boolean => following.includes(lower(user)),
    [following],
  );

  const refreshFollowInfo = React.useCallback((user: string): void => {
    const key = lower(user);
    if (!key) return;
    void (async () => {
      try {
        const res = await fetch(`/api/amberxvid/follows?user=${encodeURIComponent(key)}`);
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; following?: boolean; followerCount?: number }
          | null;
        if (!res.ok || json?.ok !== true) return;
        if (typeof json.followerCount === "number") {
          setFollowerCounts((c) => ({ ...c, [key]: json.followerCount as number }));
        }
        // Reconcile my own edge from the server rather than assuming the boot
        // read is still complete — this is the one answer that knows.
        setFollowing((f) =>
          json.following === true
            ? f.includes(key)
              ? f
              : [...f, key]
            : f.filter((u) => u !== key),
        );
      } catch {
        /* the identity row simply shows no count */
      }
    })();
  }, []);

  /* ------------------------------- P12 host tools ------------------------------- */

  const describe = React.useCallback(
    async (patch: { title?: string; description?: string }): Promise<boolean> => {
      const id = live.current.myStreamId;
      if (!id) return false;
      const json = await postStreams({ action: "describe", streamId: id, ...patch });
      if (json.ok !== true) {
        notify("Edit refused", String(json.error ?? "the room did not take it"));
        return false;
      }
      // No local state to set: the route re-broadcasts the whole `streams`
      // list, and this hub renders the room from that. One truth, arriving the
      // same way it does for everybody else watching.
      return true;
    },
    [notify],
  );

  const removeViewer = React.useCallback(
    async (user: string): Promise<boolean> => {
      const id = live.current.myStreamId;
      if (!id) return false;
      const json = await postStreams({ action: "remove", streamId: id, user });
      if (json.ok !== true) {
        notify("Could not remove them", String(json.error ?? "the room refused it"));
        return false;
      }
      notify(`Removed ${String(json.removed ?? user)}`, "their player closes and they cannot rejoin this stream");
      return true;
    },
    [notify],
  );

  const setTrackEnabled = React.useCallback((kind: "audio" | "video", on: boolean): void => {
    for (const track of localRef.current?.getTracks() ?? []) {
      if (track.kind === kind) track.enabled = on;
    }
    // Server-known (P7): pause the producer and the SFU stops fanning it —
    // every viewer's tile reflects the server's truth, not a frozen frame.
    const leg = hostLeg.current;
    const producer = leg?.producers[kind];
    if (leg?.participantId && producer && !producer.closed) {
      void mediaPost({ action: "pause", participantId: leg.participantId, kind, paused: !on }).catch(() => {
        notify("The server didn't take the toggle", "it may not have applied");
      });
    }
  }, [notify]);

  /** P10 — start/stop the SERVER-side recording of my stream. The state flip
   *  is set optimistically on an ok (the server DID it) and confirmed by the
   *  room-updated announcement; a refusal surfaces the route's honest copy. */
  const setRecording = React.useCallback(
    async (on: boolean): Promise<void> => {
      const leg = hostLeg.current;
      if (!leg?.participantId) return;
      try {
        await mediaPost({ action: "record", participantId: leg.participantId, on });
        setRecordingState(on);
        notify(
          on ? "Recording on the server" : "Recording stopped",
          on
            ? "the room shows REC to everyone; the file lands in your library when you stop"
            : "the file is in your library",
        );
      } catch (err) {
        notify("Recording toggle failed", err instanceof Error ? err.message : "the media server refused");
      }
    },
    [notify],
  );

  const startPreview = React.useCallback(
    async (streamId: string, onStream: (s: MediaStream | null) => void): Promise<() => void> => {
      const { myStreamId: hosting, watchingId: watchingNow } = live.current;
      // Already piping this room full-size (or it is ours) — nothing to attach.
      if (hosting === streamId || watchingNow === streamId || watchLegs.current.has(streamId)) {
        return () => undefined;
      }
      const leg: WatchLeg = {
        streamId,
        preview: true,
        participantId: null,
        device: null,
        recvTransport: null,
        consumers: new Map(),
        pendingSnapshot: null,
        closed: false,
        onStream,
      };
      watchLegs.current.set(streamId, leg);
      const json = await postStreams({ action: "join", streamId, preview: true });
      if (json.ok !== true) {
        watchLegs.current.delete(streamId);
        return () => undefined;
      }
      // The stopper is returned BEFORE the media connect finishes, on purpose:
      // the tile registers it against its hover token, and the first frames
      // swap the tile's <img> for a <video> under the pointer — a swap Chrome
      // answers with a spurious leave/enter pair. A stopper that arrives after
      // media (as an awaited connect would) loses that race and folds a
      // healthy preview; the mesh code resolved early by accident, this
      // resolves early by decision. A failed connect still folds quietly — a
      // hover preview earns no error dialog.
      void connectWatchMedia(leg).catch(() => {
        if (watchLegs.current.get(streamId) === leg) {
          void postStreams({ action: "leave", streamId });
          teardownWatch(streamId);
        }
      });
      return () => {
        // Only fold what is still OUR preview leg — the member may have
        // clicked in and upgraded it to the full watch meanwhile. (This is a
        // courtesy: the server's seat lease folds it regardless.)
        const current = watchLegs.current.get(streamId);
        if (current?.preview) {
          void postStreams({ action: "leave", streamId });
          teardownWatch(streamId);
        }
      };
    },
    [connectWatchMedia, teardownWatch],
  );

  /* ----------------------------------- boot ------------------------------------- */

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/amberxvid/streams");
        const json = (await res.json().catch(() => null)) as { ok?: boolean; streams?: StreamInfo[] } | null;
        if (!cancelled && res.ok && json?.ok && Array.isArray(json.streams)) setStreams(json.streams);
      } catch {
        /* the first SSE broadcast will fill it in */
      }
      // P12 — the follow graph, read once at mount. It only changes when THIS
      // member toggles a follow, and every toggle answers with the fresh graph,
      // so there is nothing to poll and nothing to invalidate.
      try {
        const res = await fetch("/api/amberxvid/follows");
        const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!cancelled) applyFollows(json);
      } catch {
        /* an unreadable follow graph orders the list the server's way */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyFollows]);

  // Unmount = the page is going away; presence teardown on the server ends
  // hosted rooms and the bridge keepalive folds orphaned media seats, but
  // closing local hardware and handles is on us.
  React.useEffect(
    () => () => {
      hostReconnectSeq.current += 1; // cancel the P11 loops with the page
      watchReconnectSeq.current += 1;
      const leg = hostLeg.current;
      if (leg) {
        leg.closed = true;
        try {
          leg.sendTransport?.close();
        } catch {
          /* gone */
        }
        mediaLeave(leg.participantId);
      }
      for (const [id] of watchLegs.current) {
        const w = watchLegs.current.get(id);
        if (!w) continue;
        w.closed = true;
        try {
          w.recvTransport?.close();
        } catch {
          /* gone */
        }
        mediaLeave(w.participantId);
      }
      if (posterTimer.current) clearInterval(posterTimer.current);
      for (const track of localRef.current?.getTracks() ?? []) track.stop();
    },
    [],
  );

  const myStream = streams.find((s) => s.id === myStreamId) ?? null;
  const watching = streams.find((s) => s.id === watchingId) ?? null;

  /**
   * P12 — followed-live first, everything else after, each group keeping the
   * server's newest-first order.
   *
   * A STABLE sort, and that matters more than it looks: this array keys the
   * tiles, and a tile that reorders under the pointer tears down and rebuilds
   * its hover-preview leg for no reason. `Array.prototype.sort` has been
   * required to be stable since ES2019, so ranking by one number is enough.
   */
  const orderedStreams = React.useMemo(() => {
    if (following.length === 0) return streams;
    const rank = (s: StreamInfo): number => (following.includes(lower(s.host)) ? 0 : 1);
    return [...streams].sort((a, b) => rank(a) - rank(b));
  }, [streams, following]);

  const streamOf = React.useCallback(
    (user: string): StreamInfo | null => streams.find((s) => lower(s.host) === lower(user)) ?? null,
    [streams],
  );

  return {
    streams: orderedStreams,
    myStream,
    watching,
    room: myStream ?? watching,
    roomOpen,
    chat,
    localStream,
    remoteStream,
    busy,
    goLive,
    endLive,
    watch,
    leaveWatch,
    sendChat,
    openRoom: () => setRoomOpen(true),
    closeRoom: () => setRoomOpen(false),
    setTrackEnabled,
    following,
    followerCounts,
    isFollowing,
    setFollow,
    refreshFollowInfo,
    lastAlert,
    dismissAlert: () => setLastAlert(null),
    describe,
    removeViewer,
    mediaReconnecting,
    recording,
    recordingAvailable,
    recordingReason,
    setRecording,
    startPreview,
    handleEvent,
    handleRoomMedia,
    streamOf,
  };
}

export { STREAM_PREVIEW_S };
