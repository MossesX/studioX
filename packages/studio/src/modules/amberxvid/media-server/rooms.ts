/**
 * @file Room lifecycle — the whole of the media server's state, expressed in
 * the P1 vocabulary and nothing else.
 *
 * `MEDIA_CONTRACT.topology` is the spec, clause by clause:
 *
 *  - **one Router per room**, created on demand and pinned to one worker at
 *    creation, so rooms are the unit of placement across the pool
 *    (`CAPACITY.roomsPerWorker`);
 *  - **one WebRTC transport per direction per participant** — a send transport
 *    and a recv transport, created on demand. There is no per-peer connection
 *    anywhere in this file, because the mesh's N×(N−1) graph is what the
 *    conversion exists to delete;
 *  - **ONE upstream per publisher**: at most one producer per `MediaKind`. That
 *    bound is structural here rather than policed — producers live in a
 *    `Map<MediaKind, Producer>`, which cannot hold two of a kind;
 *  - **N downstreams fanned by the server**: one consumer per (subscriber,
 *    producer) pair, on the subscriber's recv transport. A new viewer costs the
 *    server a consumer and costs the publisher nothing. That sentence is the
 *    constant-uplink promise, and this map is where it is kept.
 *
 * Identity is server-attested (`MEDIA_CONTRACT.identity`): a seat's `sub` and
 * `role` come from the verified token's claims, and a producer is labelled with
 * the participant the server bound it to. No client-sent identity field is read
 * anywhere below.
 *
 * Server-only. This file imports mediasoup; nothing here may reach a client
 * bundle.
 */

import { randomUUID } from "node:crypto";

import type {
  Consumer,
  DtlsParameters,
  MediaKind as MsKind,
  Producer,
  Router,
  RouterRtpCodecCapability,
  RtpCapabilities,
  RtpParameters,
  WebRtcTransport,
  Worker,
} from "mediasoup/types";

import { CAPACITY, MEDIA_TIMING, ROLE_RULES } from "../lib/mediaContract";
import { RoomRecorder, recordingPreflight } from "./recording";
import type {
  ConsumerId,
  MediaFailure,
  MediaKind,
  MediaRole,
  MediaTokenClaims,
  ParticipantId,
  ProducerId,
  RoomId,
} from "../lib/mediaContract";

/* ---------------------------------- errors ----------------------------------- */

/**
 * A refusal in the CLOSED `MediaFailure` vocabulary. Everything that can be
 * refused throws one of these, so `http.ts` maps a caught error to the wire
 * without a single stringly-typed decision of its own — which is exactly what
 * makes P11's degradation copy able to be honest.
 */
export class MediaError extends Error {
  readonly failure: MediaFailure;

  constructor(failure: MediaFailure, detail: string) {
    super(detail);
    this.name = "MediaError";
    this.failure = failure;
  }
}

/* --------------------------------- environment -------------------------------- */

/**
 * The media-plane config, read from `process.env` PER CALL — `MEDIA_ENV`'s
 * parity rule verbatim, so localhost dev and the VPS share one code path.
 *
 * It lives in this file rather than in `index.ts` because its consumer is the
 * transport layer below (announced IP and port range are WebRTC facts), and
 * because `http.ts` must be able to read it without importing the process
 * entry — which would be a cycle.
 */
export interface MediaConfig {
  port: number;
  announcedIp: string;
  rtcMinPort: number;
  rtcMaxPort: number;
  dev: boolean;
}

/**
 * Why `addr` cannot work as an SFU's announced address for remote clients —
 * or `null` when it can (a public IP, or a DNS name this process cannot
 * classify and therefore trusts). mediasoup copies the announced address into
 * every ICE candidate it hands a client, so a loopback/private value here
 * means every remote browser dials an address that exists only on somebody
 * else's LAN: signalling works, /health works, and there is no video — the
 * single most common failure of a deployed SFU, and invisible from the server.
 */
function unroutableReason(addr: string): string | null {
  const a = addr.toLowerCase();
  if (a === "localhost" || a === "0.0.0.0" || a === "::" || a === "::1") return "a loopback/unspecified";
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const o1 = Number(v4[1]);
    const o2 = Number(v4[2]);
    if (o1 === 127) return "a loopback (127.0.0.0/8)";
    if (o1 === 10) return "a private (10.0.0.0/8)";
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return "a private (172.16.0.0/12)";
    if (o1 === 192 && o2 === 168) return "a private (192.168.0.0/16)";
    if (o1 === 169 && o2 === 254) return "a link-local (169.254.0.0/16)";
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return "a carrier-grade-NAT (100.64.0.0/10)";
    return null;
  }
  if (a.includes(":")) {
    if (/^fe[89ab]/.test(a)) return "a link-local (fe80::/10)";
    if (/^f[cd]/.test(a)) return "a unique-local (fc00::/7)";
  }
  return null;
}

export function mediaConfig(): MediaConfig {
  const dev = process.env.AMBERXVID_MEDIA_DEV?.trim() === "1";
  const port = Number(process.env.AMBERXVID_MEDIA_PORT ?? "") || 3215;
  const announced = process.env.AMBERXVID_MEDIA_ANNOUNCED_IP?.trim() || "";
  // `MEDIA_ENV.AMBERXVID_MEDIA_ANNOUNCED_IP.absent`: loopback under dev,
  // REFUSED otherwise. Announcing a private address silently is "an hour of
  // debugging shaped like a working /health", so it is a start-time refusal.
  if (!announced && !dev) {
    throw new Error(
      "AMBERXVID_MEDIA_ANNOUNCED_IP is required outside dev — without it remote clients are handed an unroutable address and every call fails as 'transport-failed'. Set it to the machine's public IP, or set AMBERXVID_MEDIA_DEV=1 for loopback-only local work.",
    );
  }
  // P9: a SET-BUT-WRONG value is refused just as loudly as a missing one. An
  // operator who exports the VPS's eth0 address (10.x / 172.16-31.x /
  // 192.168.x) instead of its public IP gets 'connected but no video' with
  // nothing in any log — so the classification happens HERE, at start, with
  // the fix in the message. Dev keeps loopback on purpose (one-machine work).
  if (announced && !dev) {
    const reason = unroutableReason(announced);
    if (reason) {
      throw new Error(
        `AMBERXVID_MEDIA_ANNOUNCED_IP=${announced} is ${reason} address — mediasoup would announce it in every ICE candidate, remote clients would join and then get NO media ('connected but no video'). Set the machine's PUBLIC IP (the one in `
          + "`ICE_CONTRACT`'s VPS provisioning, e.g. 31.97.13.252), or set AMBERXVID_MEDIA_DEV=1 for loopback-only local work.",
      );
    }
  }
  return {
    port,
    announcedIp: announced || "127.0.0.1",
    rtcMinPort: Number(process.env.AMBERXVID_MEDIA_RTC_MIN_PORT ?? "") || 40000,
    rtcMaxPort: Number(process.env.AMBERXVID_MEDIA_RTC_MAX_PORT ?? "") || 40100,
    dev,
  };
}

/* ---------------------------------- codecs ------------------------------------ */

/**
 * The router's codec set. Opus + VP8 + H264 is the intersection every browser
 * this suite targets can both produce and consume; an SFU forwards RTP without
 * decoding it (`MEDIA_CONTRACT`'s SFU-not-MCU paragraph), so this list is a
 * negotiation vocabulary, not a transcoding menu.
 *
 * `RouterRtpCodecCapability` rather than `RtpCodecCapability` is mediasoup's
 * own distinction and not a convenience: a router's codec list leaves
 * `preferredPayloadType` unset and lets mediasoup assign one.
 */
const MEDIA_CODECS: RouterRtpCodecCapability[] = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
  { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { "x-google-start-bitrate": 1000 } },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
      "x-google-start-bitrate": 1000,
    },
  },
];

/** `MediaKind` → the two kinds mediasoup itself knows. `screen` is a second
 *  video-class kind on OUR side so camera and screen share can coexist under
 *  the one-producer-per-kind rule; to the router it is video. */
function msKindOf(kind: MediaKind): MsKind {
  return kind === "audio" ? "audio" : "video";
}

const MEDIA_KINDS: readonly MediaKind[] = ["audio", "video", "screen"];

export function isMediaKind(v: unknown): v is MediaKind {
  return typeof v === "string" && (MEDIA_KINDS as readonly string[]).includes(v);
}

/* ----------------------------------- state ------------------------------------ */

export interface Participant {
  id: ParticipantId;
  /** From the token claims — server-attested, never client-sent. */
  sub: string;
  role: MediaRole;
  joinedAt: number;
  lastSeenAt: number;
  transports: Map<string, { transport: WebRtcTransport; direction: "send" | "recv" }>;
  /** At most one per kind — the ONE-upstream rule, structural. */
  producers: Map<MediaKind, Producer>;
  consumers: Map<ConsumerId, Consumer>;
}

export interface Room {
  id: RoomId;
  router: Router;
  /** Index into the pool. A router is pinned to its worker for its whole life. */
  workerIndex: number;
  createdAt: number;
  participants: Map<ParticipantId, Participant>;
  /** Armed when the last seat leaves, cancelled if someone rejoins inside the
   *  grace — which is what makes P6's reconnect-resume land in the SAME room. */
  idleTimer: NodeJS.Timeout | null;
  /** The live server-side recording (P10), when the host toggled one on.
   *  Null the rest of the time — a room does not record by default. */
  recorder: RoomRecorder | null;
}

/** What a client is told about a producer it may subscribe to. */
export interface ProducerInfo {
  producerId: ProducerId;
  participantId: ParticipantId;
  sub: string;
  kind: MediaKind;
  paused: boolean;
}

export interface RoomSnapshot {
  roomId: RoomId;
  participants: { id: ParticipantId; sub: string; role: MediaRole; listed: boolean }[];
  producers: ProducerInfo[];
  /** The server is writing this room to disk right now (P10) — in EVERY
   *  snapshot, so every seat's UI can say so on screen. */
  recording: boolean;
}

/* ---------------------------------- registry ----------------------------------- */

export type RoomEventListener = (roomId: RoomId) => void;

/**
 * Every room on this process, and the worker pool they are placed across.
 *
 * The registry owns creation, capacity refusal, the seat sweeper and idle
 * close. It deliberately owns NO signalling: `http.ts` calls these methods and
 * turns the results into wire messages, so the room model can be exercised
 * without a socket.
 */
export class RoomRegistry {
  private readonly rooms = new Map<RoomId, Room>();
  private readonly listeners = new Set<RoomEventListener>();
  private sweeper: NodeJS.Timeout | null = null;
  private closed = false;

  private readonly workers: Worker[];
  private readonly config: MediaConfig;
  private readonly log: (msg: string) => void;

  constructor(workers: Worker[], config: MediaConfig, log: (msg: string) => void = () => {}) {
    this.workers = workers;
    this.config = config;
    this.log = log;
  }

  /** Notified whenever a room's shape changes — the in-process sibling of the
   *  P3 `room-updated` cross-process event, and deliberately just as coarse:
   *  the holder re-reads the room rather than trusting a payload. */
  onRoomUpdated(fn: RoomEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(roomId: RoomId): void {
    for (const fn of this.listeners) {
      try {
        fn(roomId);
      } catch (err) {
        this.log(`room listener threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /* -------------------------------- lifecycle -------------------------------- */

  /** Start the seat sweeper. Correctness, not optimisation: a crashed client
   *  leaves a seat holding capacity, and `room-full` is a refusal a live user
   *  would then hit because of a ghost. */
  startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), MEDIA_TIMING.heartbeatMs);
    this.sweeper.unref();
  }

  private sweep(): void {
    const cutoff = Date.now() - MEDIA_TIMING.participantTimeoutMs;
    for (const room of [...this.rooms.values()]) {
      for (const p of [...room.participants.values()]) {
        if (p.lastSeenAt < cutoff) {
          this.log(`sweeping stale seat ${p.id} (${p.sub}) from room ${room.id}`);
          this.leave(room.id, p.id);
        }
      }
    }
  }

  /**
   * The room, created on demand. Placement picks the worker holding the fewest
   * routers; `CAPACITY.roomsPerWorker` × pool size is the hard ceiling, and
   * exceeding it is a named `room-full` refusal rather than an OOM later.
   */
  async ensureRoom(roomId: RoomId): Promise<Room> {
    if (this.closed) throw new MediaError("server-unreachable", "the media server is shutting down");
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const load = new Array<number>(this.workers.length).fill(0);
    for (const room of this.rooms.values()) load[room.workerIndex] += 1;
    let pick = 0;
    for (let i = 1; i < load.length; i += 1) if (load[i] < load[pick]) pick = i;
    if (load[pick] >= CAPACITY.roomsPerWorker) {
      throw new MediaError(
        "room-full",
        `every worker is at its ${CAPACITY.roomsPerWorker}-room budget (${this.workers.length} workers)`,
      );
    }

    const router = await this.workers[pick].createRouter({ mediaCodecs: MEDIA_CODECS });
    const room: Room = {
      id: roomId,
      router,
      workerIndex: pick,
      createdAt: Date.now(),
      participants: new Map(),
      idleTimer: null,
      recorder: null,
    };
    this.rooms.set(roomId, room);
    this.log(`room ${roomId} → router ${router.id} on worker ${pick} (pid ${this.workers[pick].pid})`);
    // A router whose worker dies takes the room with it; drop the record so a
    // rejoin builds a fresh one rather than handing out a dead handle.
    router.on("workerclose", () => {
      if (this.rooms.get(roomId) === room) {
        this.rooms.delete(roomId);
        this.log(`room ${roomId} lost its worker`);
      }
    });
    return room;
  }

  getRoom(roomId: RoomId): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** Close a room now — its router, and with it every transport, producer and
   *  consumer mediasoup holds beneath it. A live recording stops FIRST (the
   *  orphan discipline): its ffmpeg child must never outlive the room. */
  closeRoom(roomId: RoomId): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.idleTimer) clearTimeout(room.idleTimer);
    if (room.recorder) {
      void room.recorder.stop("room closed");
      room.recorder = null;
    }
    this.rooms.delete(roomId);
    room.router.close();
    this.log(`room ${roomId} closed (router ${room.router.id})`);
  }

  private armIdleClose(room: Room): void {
    if (room.idleTimer) clearTimeout(room.idleTimer);
    room.idleTimer = setTimeout(() => {
      if (room.participants.size === 0) this.closeRoom(room.id);
    }, MEDIA_TIMING.roomIdleCloseMs);
    room.idleTimer.unref();
  }

  /* ---------------------------------- seats ---------------------------------- */

  /**
   * Seat a verified token in its room.
   *
   * Capacity uses the contract numbers against the seat being asked for, which
   * is what lets one registry serve call rooms, stream rooms and group rooms
   * without a room-type field P1 never defined: publishing seats (host,
   * participant) are capped by `membersPerGroupRoom`, watching seats (viewer,
   * preview) by `viewersPerStream`. Either way the refusal is `room-full`, at
   * the door.
   *
   * WHY THE PUBLISHING CAP IS THE GROUP NUMBER and not `participantsPerRoom`
   * (P11 of `axf-amberxvid-social`): this side is a MACHINE ceiling, and a
   * machine ceiling that cannot tell one room shape from another has to be the
   * largest shape or it silently refuses the biggest legitimate room — a group
   * room dying at its 9th camera, with `room-full` as the only clue.
   *
   * Nothing is loosened by that, because the per-shape cap has never lived
   * here. It lives at the APP SERVER, where the room record is: a call record
   * holds exactly two seats, a stream record holds its pinned
   * `streamViewerLimit`, a group record holds its pinned member limit, and
   * `/api/amberxvid/media`'s join refuses to mint a token for anybody the
   * record does not seat (`MEDIA_CONTRACT.identity` — the record is the
   * authority the media plane follows). A ninth publisher in a call room
   * therefore never reaches this check; it never gets a token.
   */
  async join(claims: MediaTokenClaims): Promise<{ room: Room; participant: Participant }> {
    const room = await this.ensureRoom(claims.room);
    const publishing = ROLE_RULES[claims.role].canPublish;
    let seats = 0;
    for (const p of room.participants.values()) {
      if (ROLE_RULES[p.role].canPublish === publishing) seats += 1;
    }
    const cap = publishing ? CAPACITY.membersPerGroupRoom : CAPACITY.viewersPerStream;
    if (seats >= cap) {
      throw new MediaError(
        "room-full",
        `room ${room.id} already holds ${seats} ${publishing ? "publishing" : "watching"} seat(s), cap ${cap}`,
      );
    }

    const participant: Participant = {
      id: randomUUID(),
      sub: claims.sub,
      role: claims.role,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    room.participants.set(participant.id, participant);
    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }
    this.log(`seat ${participant.id} (${participant.sub} as ${participant.role}) joined room ${room.id}`);
    this.emit(room.id);
    return { room, participant };
  }

  /** Vacate a seat, closing everything it held. Idempotent — a client that
   *  sends `leave` and then drops its socket must not double-close. */
  leave(roomId: RoomId, participantId: ParticipantId): void {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(participantId);
    if (!room || !participant) return;
    room.participants.delete(participantId);
    // Closing the transports cascades to their producers and consumers; the
    // maps are cleared so nothing holds a closed handle.
    for (const { transport } of participant.transports.values()) transport.close();
    participant.transports.clear();
    participant.producers.clear();
    participant.consumers.clear();
    this.log(`seat ${participantId} left room ${roomId}`);
    if (room.participants.size === 0) this.armIdleClose(room);
    this.emit(roomId);
  }

  heartbeat(roomId: RoomId, participantId: ParticipantId): void {
    const p = this.rooms.get(roomId)?.participants.get(participantId);
    if (p) p.lastSeenAt = Date.now();
  }

  /* -------------------------------- transports -------------------------------- */

  /**
   * One transport per direction, created on demand and remembered — a second
   * `create-transport` for a direction the seat already holds returns the
   * existing one rather than leaking a port pair.
   */
  async createTransport(
    room: Room,
    participant: Participant,
    direction: "send" | "recv",
  ): Promise<WebRtcTransport> {
    for (const held of participant.transports.values()) {
      if (held.direction === direction && !held.transport.closed) return held.transport;
    }
    if (direction === "send" && !ROLE_RULES[participant.role].canPublish) {
      throw new MediaError("publish-denied", `role ${participant.role} cannot publish`);
    }
    let transport: WebRtcTransport;
    try {
      transport = await room.router.createWebRtcTransport({
        listenInfos: [
          {
            protocol: "udp",
            ip: "0.0.0.0",
            announcedAddress: this.config.announcedIp,
            portRange: { min: this.config.rtcMinPort, max: this.config.rtcMaxPort },
          },
          {
            protocol: "tcp",
            ip: "0.0.0.0",
            announcedAddress: this.config.announcedIp,
            portRange: { min: this.config.rtcMinPort, max: this.config.rtcMaxPort },
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1_000_000,
      });
    } catch (err) {
      throw new MediaError("transport-failed", err instanceof Error ? err.message : String(err));
    }
    participant.transports.set(transport.id, { transport, direction });
    transport.on("dtlsstatechange", (state) => {
      if (state === "failed" || state === "closed") {
        this.log(`transport ${transport.id} dtls ${state} (seat ${participant.id})`);
      }
    });
    return transport;
  }

  private transportOf(participant: Participant, transportId: unknown): WebRtcTransport {
    const held = typeof transportId === "string" ? participant.transports.get(transportId) : undefined;
    if (!held || held.transport.closed) {
      throw new MediaError("transport-failed", "no such transport on this seat");
    }
    return held.transport;
  }

  async connectTransport(
    participant: Participant,
    transportId: unknown,
    dtlsParameters: DtlsParameters,
  ): Promise<void> {
    const transport = this.transportOf(participant, transportId);
    try {
      await transport.connect({ dtlsParameters });
    } catch (err) {
      throw new MediaError("transport-failed", err instanceof Error ? err.message : String(err));
    }
  }

  /* --------------------------------- producers -------------------------------- */

  /**
   * The seat's ONE upstream of this kind. `ROLE_RULES` is the only publish
   * authority — a `viewer` or `preview` is refused here with `publish-denied`,
   * which is what stops a watcher broadcasting into a stream room.
   *
   * A second producer of the same kind REPLACES the first (the old one is
   * closed): the map is the bound, so re-publishing a camera cannot accumulate.
   */
  async produce(
    room: Room,
    participant: Participant,
    transportId: unknown,
    kind: MediaKind,
    rtpParameters: RtpParameters,
  ): Promise<Producer> {
    if (!ROLE_RULES[participant.role].canPublish) {
      throw new MediaError("publish-denied", `role ${participant.role} cannot publish`);
    }
    const transport = this.transportOf(participant, transportId);
    let producer: Producer;
    try {
      producer = await transport.produce({
        kind: msKindOf(kind),
        rtpParameters,
        // Server-attested labelling: the seat the SERVER bound this to.
        appData: { mediaKind: kind, participantId: participant.id, sub: participant.sub },
      });
    } catch (err) {
      throw new MediaError("transport-failed", err instanceof Error ? err.message : String(err));
    }
    participant.producers.get(kind)?.close();
    participant.producers.set(kind, producer);
    producer.on("transportclose", () => {
      if (participant.producers.get(kind) === producer) participant.producers.delete(kind);
      this.emit(room.id);
    });
    this.emit(room.id);
    return producer;
  }

  /**
   * Server-known mute (P6): pause or resume the seat's OWN producer of a kind.
   * The server stops (or restarts) fanning that upstream, and the change is
   * announced room-wide via the room-updated push — every subscriber learns
   * from the server, never from a data channel the peer might not send.
   */
  async pauseProducer(room: Room, participant: Participant, kind: MediaKind, paused: boolean): Promise<void> {
    const producer = participant.producers.get(kind);
    if (!producer || producer.closed) {
      throw new MediaError("transport-failed", `no live ${kind} producer on this seat`);
    }
    try {
      if (paused) await producer.pause();
      else await producer.resume();
    } catch (err) {
      throw new MediaError("transport-failed", err instanceof Error ? err.message : String(err));
    }
    this.emit(room.id);
  }

  /** Every producer in the room a given seat may subscribe to — everyone
   *  else's. The fan-out list, and the only thing a subscriber needs. */
  producersFor(room: Room, exceptParticipantId: ParticipantId): ProducerInfo[] {
    const out: ProducerInfo[] = [];
    for (const p of room.participants.values()) {
      if (p.id === exceptParticipantId) continue;
      for (const [kind, producer] of p.producers) {
        if (producer.closed) continue;
        out.push({ producerId: producer.id, participantId: p.id, sub: p.sub, kind, paused: producer.paused });
      }
    }
    return out;
  }

  private findProducer(room: Room, producerId: unknown): Producer {
    if (typeof producerId === "string") {
      for (const p of room.participants.values()) {
        for (const producer of p.producers.values()) {
          if (producer.id === producerId && !producer.closed) return producer;
        }
      }
    }
    throw new MediaError("transport-failed", "no such producer in this room");
  }

  /* --------------------------------- consumers -------------------------------- */

  /**
   * One downstream, on the subscriber's recv transport. Created PAUSED — the
   * mediasoup rule: a consumer resumed before the client has handled its
   * parameters drops the first keyframe and shows a black tile. `resumeConsumer`
   * is the client saying it is ready.
   */
  async consume(
    room: Room,
    participant: Participant,
    transportId: unknown,
    producerId: unknown,
    rtpCapabilities: RtpCapabilities,
  ): Promise<{ consumer: Consumer; mediaKind: MediaKind }> {
    const transport = this.transportOf(participant, transportId);
    const producer = this.findProducer(room, producerId);
    if (!room.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
      throw new MediaError("transport-failed", "this client cannot consume that producer");
    }
    let consumer: Consumer;
    try {
      consumer = await transport.consume({ producerId: producer.id, rtpCapabilities, paused: true });
    } catch (err) {
      throw new MediaError("transport-failed", err instanceof Error ? err.message : String(err));
    }
    participant.consumers.set(consumer.id, consumer);
    consumer.on("transportclose", () => participant.consumers.delete(consumer.id));
    consumer.on("producerclose", () => {
      participant.consumers.delete(consumer.id);
      this.emit(room.id);
    });
    const appData = producer.appData as { mediaKind?: unknown };
    const mediaKind = isMediaKind(appData.mediaKind) ? appData.mediaKind : (producer.kind as MediaKind);
    return { consumer, mediaKind };
  }

  async resumeConsumer(participant: Participant, consumerId: unknown): Promise<void> {
    const consumer = typeof consumerId === "string" ? participant.consumers.get(consumerId) : undefined;
    if (!consumer || consumer.closed) throw new MediaError("transport-failed", "no such consumer on this seat");
    await consumer.resume();
  }

  /**
   * Pick the simulcast spatial layer this consumer is fed (P7): the subscriber
   * says what FITS its display and the server fans only that layer down — a
   * phone viewer must not pull the host's full resolution. A no-op on a
   * non-simulcast consumer (audio, or a single-layer producer): there is only
   * one layer to have, and refusing would make the call order load-bearing.
   */
  async preferLayers(participant: Participant, consumerId: unknown, spatialLayer: number): Promise<void> {
    const consumer = typeof consumerId === "string" ? participant.consumers.get(consumerId) : undefined;
    if (!consumer || consumer.closed) throw new MediaError("transport-failed", "no such consumer on this seat");
    if (consumer.type !== "simulcast") return;
    if (!Number.isInteger(spatialLayer) || spatialLayer < 0 || spatialLayer > 2) {
      throw new MediaError("transport-failed", `spatialLayer must be 0..2, got ${String(spatialLayer)}`);
    }
    try {
      // Highest temporal layer within the chosen spatial one — the spatial
      // pick is the bandwidth decision; temporal thinning is the encoder's.
      await consumer.setPreferredLayers({ spatialLayer, temporalLayer: 2 });
    } catch (err) {
      throw new MediaError("transport-failed", err instanceof Error ? err.message : String(err));
    }
  }

  /* --------------------------------- recording --------------------------------- */

  /**
   * Start recording this room server-side (P10). `ROLE_RULES[...].canRecord`
   * is the ONE access matrix — only a host seat reaches here, and `http.ts`
   * refuses everyone else at the message door with the same rule. Idempotent:
   * a second start while one is live returns quietly (the toggle is a state,
   * not a counter). Every refusal is `recording-failed` with the honest
   * sentence in the detail — preflight (ffmpeg, disk) runs INSIDE
   * `RoomRecorder.start`, before anything is opened.
   */
  async startRecording(room: Room, participant: Participant, title: string): Promise<void> {
    if (!ROLE_RULES[participant.role].canRecord) {
      throw new MediaError("recording-failed", `role ${participant.role} may not record this room`);
    }
    if (room.recorder?.active) return;
    let recorder: RoomRecorder;
    try {
      recorder = await RoomRecorder.start({
        router: room.router,
        producers: participant.producers,
        owner: participant.sub,
        title,
        log: this.log,
        // ffmpeg died on its own (disk full, crash): drop the reference and
        // re-announce, so every seat's REC indicator goes out honestly.
        onEnded: () => {
          if (this.rooms.get(room.id) === room && room.recorder === recorder) {
            room.recorder = null;
            this.emit(room.id);
          }
        },
      });
    } catch (err) {
      throw new MediaError("recording-failed", err instanceof Error ? err.message : String(err));
    }
    room.recorder = recorder;
    // Announced room-wide the moment it starts: nobody is recorded without it
    // being said on screen, so the fact and the tap share one transaction.
    this.emit(room.id);
  }

  /** Stop the room's recording and finalize its file. Idempotent. */
  async stopRecording(room: Room): Promise<void> {
    const recorder = room.recorder;
    if (!recorder) return;
    room.recorder = null;
    await recorder.stop("host stopped the recording");
    this.emit(room.id);
  }

  /** The capability the room UI's toggle renders from — see `recordingPreflight`. */
  recordingCapability(): Promise<{ ok: boolean; reason: string | null }> {
    return recordingPreflight();
  }

  /** Graceful-shutdown half: stop and finalize every live recording. Called by
   *  the process entry's `stop()` BEFORE rooms close, so finalize gets to run. */
  async stopAllRecordings(): Promise<void> {
    for (const room of [...this.rooms.values()]) {
      if (room.recorder) {
        const recorder = room.recorder;
        room.recorder = null;
        await recorder.stop("media server shutting down");
      }
    }
  }

  /** Last-ditch synchronous kill for `process.on("exit")` — the recorder twin
   *  of the worker-close net. No finalize; boot recovery closes the manifests. */
  killRecordersNow(): void {
    for (const room of this.rooms.values()) {
      room.recorder?.killNow();
      room.recorder = null;
    }
  }

  /* ---------------------------------- readout --------------------------------- */

  /** What a client is told the room looks like. `preview` seats are omitted
   *  from the roster per `ROLE_RULES[...].listed` — their producers are not,
   *  because a preview publishes nothing to omit. */
  snapshot(room: Room, forParticipantId: ParticipantId): RoomSnapshot {
    return {
      roomId: room.id,
      participants: [...room.participants.values()]
        .filter((p) => ROLE_RULES[p.role].listed)
        .map((p) => ({ id: p.id, sub: p.sub, role: p.role, listed: true })),
      producers: this.producersFor(room, forParticipantId),
      recording: room.recorder?.active === true,
    };
  }

  stats(): { rooms: number; participants: number; producers: number; consumers: number; recordings: number } {
    let participants = 0;
    let producers = 0;
    let consumers = 0;
    let recordings = 0;
    for (const room of this.rooms.values()) {
      participants += room.participants.size;
      if (room.recorder?.active) recordings += 1;
      for (const p of room.participants.values()) {
        producers += p.producers.size;
        consumers += p.consumers.size;
      }
    }
    return { rooms: this.rooms.size, participants, producers, consumers, recordings };
  }

  /** Close every room. Called by the process entry's shutdown, before the
   *  workers themselves are closed. */
  closeAll(): void {
    this.closed = true;
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
    for (const roomId of [...this.rooms.keys()]) this.closeRoom(roomId);
    this.listeners.clear();
  }
}
