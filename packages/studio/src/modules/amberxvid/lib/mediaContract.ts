/**
 * @file AmberX Vid media-plane contract — the single document every phase of
 * the client/server conversion is written against. Pure data and types: NO
 * I/O, no mediasoup import, no import at all. It extends the posture of
 * `./contract.ts`'s ICE_CONTRACT (prose-bearing `as const` records a test can
 * pin and a reader can read) without touching that file's VALUES — they are
 * the captured build prompt's, verbatim. (P9 re-pointed the COMMENT above
 * contract.ts's ICE_CONTRACT at the SFU topology; the exported values remain
 * the frozen peer-era record.)
 *
 * ICE_CONTRACT is not replaced by this file: STUN/TURN still exist, but every
 * leg they traverse is now client ⇄ media server. The mesh-era clause "STUN
 * first for a direct P2P path" stops describing this module the day the SFU
 * carries a call.
 *
 * ---------------------------------------------------------------------------
 * ADR — why this architecture
 * ---------------------------------------------------------------------------
 *
 * **SFU, not mesh.** The mesh's cost lands on the worst-provisioned link in
 * the room: a stream host uploads one full copy of their media PER VIEWER
 * (P0 inventory, streams.ts — "the host's uplink scales with audience size"),
 * and a home connection's upload is the first thing to saturate. An SFU takes
 * exactly ONE upstream from every publisher and fans it out from a server
 * whose bandwidth we provision — the constant-uplink promise. It also
 * unlocks the two features a mesh structurally cannot offer: server-side
 * recording (the media plane terminates on a process we own) and rooms whose
 * membership is a server fact rather than N browsers' overlapping opinions.
 *
 * **SFU, not MCU.** An MCU decodes, mixes and re-encodes media server-side:
 * per-room transcoding CPU, added latency, one baked layout for every
 * subscriber, and a server that must process plaintext media as its job. An
 * SFU forwards RTP packets without decoding them — cheap per room, layout
 * stays a client concern, and the server handles ciphertext it *could* read
 * (see the loss paragraph below) but never needs to parse. For a small
 * private suite the MCU buys nothing and costs a transcoder farm.
 *
 * **mediasoup, not LiveKit.** mediasoup is a Node LIBRARY: it embeds in a
 * sidecar process exactly like the module's existing tray service (the
 * pattern P2 mirrors), installs from npm with a prebuilt win32-x64 worker,
 * and brings no opinion about rooms, auth or identity — which matters here
 * because this module already owns those (its session — `axv_session` when
 * this was written, the studio's `axs_session` since P1 of
 * `axf-amberxvid-social` unified identity — the P3 room store,
 * server-attested identity). LiveKit is an excellent standalone Go server,
 * but it arrives with its own room model, its own token semantics and its own
 * deployment shape — a second authority to reconcile with the store this
 * conversion exists to make authoritative. The P1–P11 vocabulary (router /
 * transport / producer / consumer) is mediasoup's own; never substitute a
 * different SFU under it.
 *
 * ---------------------------------------------------------------------------
 * THE SECURITY PROMISE, POST-P5 — what is promised, and what is not
 * ---------------------------------------------------------------------------
 *
 * P5 retired the peer verification ceremony: `lib/sas.ts` and
 * `lib/link-binding.ts` are DELETED, and `lib/calls.ts` no longer harvests
 * fingerprints, holds attestation state, or gates media behind
 * `attestBinding()`. The referee was a genuinely good design FOR PEER-TO-PEER
 * — three independent derivations of the DTLS material proved two browsers
 * were inside one direct DTLS session. Under an SFU the server terminates
 * DTLS on both legs, the SRTP keys of both legs are the server's, and the
 * same comparison would prove only that the server is the server. Keeping it
 * would have kept TELLING users their call was end-to-end verified when
 * nothing of the kind was true.
 *
 * What the product NOW PROMISES:
 *   - Transport encryption (DTLS-SRTP) on every leg, to and from a media
 *     server the user already trusts with their account, messages and
 *     recordings.
 *   - SERVER-ATTESTED IDENTITY: who is in a room comes from the
 *     authenticated session at join time and lives in the room record; the
 *     roster any UI renders comes from the server; a producer is labelled
 *     with the participant the server bound it to. No client-sent identity
 *     field is ever believed.
 *
 * What it NO LONGER PROMISES:
 *   - Any end-to-end guarantee against the operator. The server is in the
 *     media path and can technically see media — "no server can see the
 *     call" stopped being true the day the SFU carried one.
 *
 * The user-facing sentence is "calls and streams are relayed by the AmberX
 * Vid media server" — P5 writes it into the module's settings/help surface
 * (the decl summary), and P11's degradation copy must never imply more.
 *
 * ---------------------------------------------------------------------------
 * NO PEER-TO-PEER FALLBACK (P11) — decided, not forgotten
 * ---------------------------------------------------------------------------
 *
 * When the media server is down, calls and streams are UNAVAILABLE, said
 * honestly, and nothing else happens. There is no mesh path behind a flag, no
 * "degraded direct mode", no emergency RTCPeerConnection — see
 * {@link NO_FALLBACK_DECISION} for the reasoning as pinnable data. If you are
 * reading this because you are about to add one: the absence is a decision
 * made with the whole history in view, not an oversight.
 */

/* ------------------------------ the transport model ------------------------------ */

/**
 * The whole client/server media model, as prose a test can pin and every
 * later phase can cite. Topology facts here are LOAD-BEARING: P2 builds the
 * router-per-room server, P4 exposes exactly this transport lifecycle, P6/P7
 * rewrite the clients against it.
 */
export const MEDIA_CONTRACT = {
  version: 1,
  purpose:
    "Replace the peer-to-peer media plane with a client/server one: a mediasoup SFU owns media, every participant publishes ONE upstream and subscribes to server-fanned downstreams, so a host's uplink is constant regardless of audience size and the server can record.",
  topology: {
    router:
      "One mediasoup Router per room. A router is pinned to one worker at creation, so rooms are the unit of placement across the worker pool (see CAPACITY.roomsPerWorker).",
    transports:
      "One WebRTC transport per direction per participant: a send transport and a recv transport, created on demand. Never a per-peer connection — the mesh's N×(N-1) connection graph is gone.",
    upstream:
      "ONE upstream per publisher: at most one producer per MediaKind (audio, video, screen) rides the send transport. Camera + mic + screen is therefore at most three producers, and that bound is structural, not policed.",
    downstream:
      "N downstreams fanned by the server: one consumer per (subscriber, producer) pair on the subscriber's recv transport. A new viewer costs the server a consumer, and costs the publisher nothing.",
  },
  signaling:
    "The app server authorises (axv_session, exactly the calls-route idiom), mints the participant token, forwards transport setup over the media server's WS channel and returns the answer. It never touches media bytes, and SDP never transits the app server again — the sdp/ice relay dies with the mesh (P6/P7 delete it surface by surface).",
  identity:
    "Server-attested: who is in a room comes from the authenticated session at join time and lives in the room record. A producer is labelled with the participant the server bound it to. No client-sent identity field is ever believed.",
  path:
    "Every leg is client ⇄ media server; coturn (lib/turn.ts, unchanged) still relays that leg when NAT demands it. The mesh-era 'direct vs relayed' badge distinction is retired — relayed-through-our-server IS the architecture, and the UI says so honestly.",
  recording:
    "Server-side recording becomes possible because media terminates on a process we own: a recorder is just one more consumer on the router, invisible to publishers' bandwidth. (Its access rules are product surface, defined where recording lands — not here.)",
} as const;

/* ------------------------------- room vocabulary --------------------------------- */

/**
 * What a producer carries. `screen` is a second video-class kind rather than
 * a flag on `video` so the one-producer-per-kind rule lets camera and screen
 * share coexist without ever allowing unbounded producers.
 */
export type MediaKind = "audio" | "video" | "screen";

/**
 * A participant's seat in a room, assigned by the server at join and carried
 * in the participant token — never chosen by the client.
 *
 * - `host`        — owns the room's lifetime (a stream's broadcaster; a call's
 *                   creator). Publishes.
 * - `participant` — a full member of a call room. Publishes.
 * - `viewer`      — watches a stream: consumes, is listed, chats. Never
 *                   publishes.
 * - `preview`     — the 15 s hover preview (`STREAM_PREVIEW_S` in ./types
 *                   stays the time-box's source): consumes, is NOT listed,
 *                   no chat. Under the mesh a preview was a whole extra peer
 *                   connection on the host's uplink; here it is one cheap
 *                   server-side consumer, but it keeps its own role because
 *                   its visibility rules differ, not its cost.
 */
export type MediaRole = "host" | "participant" | "viewer" | "preview";

/**
 * What each role may do — the data behind the 'publish-denied' refusal, kept
 * here so the media server, the transport API and the UI enforce ONE matrix
 * instead of three habits.
 */
export const ROLE_RULES = {
  host: { canPublish: true, listed: true, canRecord: true },
  participant: { canPublish: true, listed: true, canRecord: false },
  viewer: { canPublish: false, listed: true, canRecord: false },
  preview: { canPublish: false, listed: false, canRecord: false },
} as const satisfies Record<MediaRole, { canPublish: boolean; listed: boolean; canRecord: boolean }>;

/** Minted by the app server when a room is created. One roomId = one router. */
export type RoomId = string;

/**
 * One seat in one room, assigned by the server at join. Distinct from the
 * username on purpose: a user with two tabs holds two seats, and a reconnect
 * resumes a seat (P6) rather than minting a new identity.
 */
export type ParticipantId = string;

/** mediasoup-minted, opaque — relayed verbatim, never parsed by this module. */
export type ProducerId = string;

/** mediasoup-minted, opaque — one per (subscriber, producer) pair. */
export type ConsumerId = string;

/* ------------------------------- the room snapshot -------------------------------- */

/**
 * What a client is told about one producer it may subscribe to. `paused` is
 * the server-known mute (P6): a publisher pauses their own producer, the
 * server stops fanning it, and every subscriber reads the fact from the next
 * snapshot — never from a data channel the peer might not send.
 */
export interface MediaProducerInfo {
  producerId: ProducerId;
  participantId: ParticipantId;
  /** Server-attested publisher (`MEDIA_CONTRACT.identity`), never client-sent. */
  sub: string;
  kind: MediaKind;
  paused: boolean;
}

/**
 * What a client is told the room looks like: the media server's answer to
 * `join`/`snapshot`, and the payload of every `room-media` announcement. The
 * producers list is always "everyone else's" — a client never consumes itself.
 * Declared HERE (the pure contract) so client surfaces can type it without
 * importing the media server, whose own `RoomSnapshot` must stay structurally
 * identical to this.
 */
export interface MediaRoomSnapshot {
  roomId: RoomId;
  participants: { id: ParticipantId; sub: string; role: MediaRole; listed: boolean }[];
  producers: MediaProducerInfo[];
  /**
   * The server is writing this room's media to disk RIGHT NOW (P10). In every
   * snapshot on purpose — a recording nobody on screen can see is a recording
   * nobody consented to, so the fact rides the same wire as the roster and
   * every seat (host, viewers, previews) renders it.
   */
  recording: boolean;
}

/* ------------------------------ the participant token ----------------------------- */

/**
 * The claims inside a participant token: WHO (the module user the app server
 * authenticated), WHERE (the room), AS WHAT (the server-assigned role), UNTIL
 * WHEN. The media server trusts nothing else about a joiner.
 */
export interface MediaTokenClaims {
  /** Subject — the module username, normalized (lowercased + trimmed). */
  sub: string;
  /** The room this token admits to — a token is minted per room, never global. */
  room: RoomId;
  /** The server-assigned seat role; the media server enforces ROLE_RULES from this. */
  role: MediaRole;
  /** Unix seconds after which the media server refuses the token. */
  exp: number;
}

/**
 * The token the app server mints and the media server verifies — the SAME
 * secret-handling idiom `lib/turn.ts` already uses for coturn (expiry-first
 * colon-joined payload, HMAC over a server-only env secret read per call),
 * so this module keeps ONE secret-handling pattern, not two. The digest is
 * SHA-256 rather than coturn's mandated SHA-1 only because both ends of THIS
 * pattern are ours.
 */
export const MEDIA_TOKEN = {
  /** `"<unix expiry>:<roomId>:<role>:<normalized user>"` — user LAST, so a
   *  parser splits on the first three `:` and takes the remainder verbatim.
   *  Expiry, roomId and role are server-minted and colon-free by
   *  construction; nothing about the user needs to be. */
  payload: "<exp>:<room>:<role>:<sub>",
  /** `payload + "." + base64url(HMAC-SHA256(secret, payload))`. base64url
   *  contains no `.`, so the SIGNATURE is everything after the LAST `.` —
   *  unambiguous even if a username carries one. */
  format: "<payload>.<signature>",
  /** Verification order, and it is an order: constant-time signature compare
   *  first, THEN expiry, THEN claims — a forged token learns nothing from
   *  which check refused it. Refusal is the 'token-rejected' MediaFailure,
   *  with no finer-grained reason on the wire. */
  verify: "constant-time HMAC compare, then exp > now, then room/role against the room record",
  /** The secret is `AMBERXVID_MEDIA_ENV.secret` — server-only, shared by the
   *  app server and media server environments, never in the client bundle,
   *  read per call and never latched at import (the turn.ts parity rule). */
  secretVar: "AMBERXVID_MEDIA_SECRET",
} as const;

/* ---------------------------------- environment ----------------------------------- */

/**
 * Every media-plane env var, in one place. The parity rule is turn.ts's,
 * verbatim in spirit: read `process.env` PER CALL, never latch a value at
 * import time — so localhost dev and the VPS share one code path and a
 * restarted env never serves a stale config. This table is data; nothing
 * here reads the environment.
 */
export const MEDIA_ENV = {
  parityRule:
    "Read per call, never latched at import — one code path for localhost dev and amberxai.com prod, exactly as lib/turn.ts states for the TURN vars.",
  vars: {
    AMBERXVID_MEDIA_URL: {
      what: "Base URL where the app server and browsers reach the media server's HTTP/WS channel.",
      example: "http://127.0.0.1:3215 (dev) · https://media.amberxai.com (prod)",
      absent: "Derived as http://127.0.0.1:<AMBERXVID_MEDIA_PORT> under AMBERXVID_MEDIA_DEV; otherwise the media plane is unconfigured (see AMBERXVID_MEDIA_SECRET.absent).",
    },
    AMBERXVID_MEDIA_SECRET: {
      what: "The HMAC secret behind MEDIA_TOKEN — shared by the app-server and media-server environments ONLY; never in the client bundle, never logged.",
      example: "(a long random string in the env, nowhere else)",
      absent:
        "The media plane is OFF, said honestly — the same posture as turn.ts's secret===null STUN-only honesty: joins fail fast as 'server-unreachable', the UI says calls/streams are unavailable, nothing hangs and nothing pretends.",
    },
    AMBERXVID_MEDIA_PORT: {
      what: "The media server's listen port for /health and the WS channel.",
      example: "3215",
      absent: "Defaults to 3215 (the module's slice of the 32xx service range: 3200 studio, 3211 account sync, 3212 deploy).",
    },
    AMBERXVID_MEDIA_ANNOUNCED_IP: {
      what: "The public IP mediasoup announces in its ICE candidates — the address clients actually dial for RTC. On the VPS this is the machine's public IP; without it remote clients are handed an unroutable address and fail as 'transport-failed'. A SET value that resolves to loopback/private/link-local/CGNAT is refused at start just like a missing one (P9) — the eth0 address is the classic wrong answer, and it fails as 'connected but no video' with nothing in any log.",
      example: "31.97.13.252",
      absent: "127.0.0.1 under AMBERXVID_MEDIA_DEV (loopback-only, correct for one-machine dev); refused at media-server start otherwise, because silently announcing a private IP is an hour of debugging shaped like a working /health.",
    },
    AMBERXVID_MEDIA_RTC_MIN_PORT: {
      what: "Lower bound (inclusive) of the UDP/TCP range mediasoup transports bind — opened in the VPS firewall exactly like coturn's bounded relay range in ICE_CONTRACT.",
      example: "40000",
      absent: "Defaults to 40000.",
    },
    AMBERXVID_MEDIA_RTC_MAX_PORT: {
      what: "Upper bound (inclusive) of that range. Bounded on purpose: a firewall rule you can write down beats 'all high ports'.",
      example: "40100",
      absent: "Defaults to 40100.",
    },
    AMBERXVID_FFMPEG: {
      what: "Absolute path of the ffmpeg binary the media server's recorder (P10) stream-copies through. Optional: without it the resolver falls back to node_modules/ffmpeg-static, then bare `ffmpeg` on PATH. When none of the three runs, the record toggle is DISABLED with that reason shown — never a silent no-op.",
      example: "C:/Home/Projects/GizmoX/node_modules/ffmpeg-static/ffmpeg.exe",
      absent: "ffmpeg-static in the media server's cwd, else PATH; recording is honestly unavailable when neither resolves.",
    },
    AMBERXVID_MEDIA_DEV: {
      what: "\"1\" = dev posture: loopback announced IP allowed, plain http allowed, verbose worker logging. Never set in prod.",
      example: "1",
      absent: "Prod posture: announced IP required, https/wss expected.",
    },
  },
} as const;

/* ------------------------------- failure vocabulary -------------------------------- */

/**
 * The CLOSED set of ways the media plane refuses or breaks. P11's honest
 * degradation can only be honest because the reasons are named here, once —
 * every route, server refusal and UI banner speaks THIS union, and a new
 * failure mode is a change to this file, visible in review, never a
 * stringly-typed local invention.
 */
export type MediaFailure =
  | "server-unreachable"
  | "token-rejected"
  | "room-full"
  | "transport-failed"
  | "publish-denied"
  | "recording-failed";

/**
 * What each failure MEANS — the one source for P11's user-facing copy, so
 * degradation is worded once and worded honestly.
 */
export const MEDIA_FAILURE_MEANING = {
  "server-unreachable":
    "The media server is down or unreachable (or no AMBERXVID_MEDIA_SECRET is configured). Surfaced immediately by the transport API — a dead media server is a fast, named refusal, never a hang.",
  "token-rejected":
    "The participant token failed verification at the media server door: bad signature, expired, or claims that do not match the room record. Deliberately un-granular on the wire.",
  "room-full":
    "The join would exceed a CAPACITY target (participantsPerRoom / viewersPerStream). A named refusal at the door, not a degradation inside the room.",
  "transport-failed":
    "The client ⇄ media-server WebRTC leg failed after a successful join — ICE or DTLS could not establish or died. The one failure that can arrive mid-session.",
  "publish-denied":
    "A produce was refused because ROLE_RULES says this seat's role cannot publish — what stops a viewer or preview broadcasting into a stream room.",
  "recording-failed":
    "The server could not start (or keep) recording this room: no ffmpeg on the media-server machine, not enough free disk in the recordings store, no live media to tap, or the recorder died. The stream itself continues, unrecorded.",
} as const satisfies Record<MediaFailure, string>;

/**
 * What each failure SAYS ON SCREEN — the P11 user-facing copy, one sentence
 * naming what is wrong and one naming what to do, worded once here so every
 * surface (call window, stream room, hub, admin) degrades with the same
 * honest words. `MEDIA_FAILURE_MEANING` above is the engineering meaning;
 * this is the product sentence. Note `publish-denied` is deliberately NOT an
 * error sentence: in a stream room it simply describes being a viewer.
 */
export const MEDIA_FAILURE_USER_COPY = {
  "server-unreachable":
    "The media server is unreachable — calls and streams are unavailable right now. Everything else in AmberX Vid still works; try again once it is back.",
  "token-rejected":
    "The media server refused your pass for this room. Rejoin the call or stream for a fresh one; if it keeps happening, sign out and back in.",
  "room-full":
    "This room is full. Wait for a seat to free up, or ask the host.",
  "transport-failed":
    "The media link to the server dropped — reconnecting automatically. If it does not come back, check your network.",
  "publish-denied":
    "You are watching as a viewer — only the host broadcasts here. Chat is your voice in this room.",
  "recording-failed":
    "The server could not record this stream (no recorder or no disk space on the media server). The stream itself continues, unrecorded.",
} as const satisfies Record<MediaFailure, string>;

/**
 * THE P11 DECISION, recorded where the code lives so nobody re-adds a mesh
 * path believing its absence was an oversight. Pure data a test can pin and a
 * future session must read before "helpfully" restoring peer-to-peer.
 */
export const NO_FALLBACK_DECISION = {
  decidedIn: "P11",
  decision:
    "There is NO peer-to-peer fallback when the media server is down. Calls and streams become unavailable, the UI says so in the closed MediaFailure vocabulary, and room-level reconnect-with-backoff resumes the same P3 room record when the server returns.",
  reasoning: [
    "A mesh path kept alive 'just in case' is a SECOND media architecture: two transport stacks, two sets of bugs, both needing tests, forever.",
    "It is also a second SECURITY MODEL: P5 retired the DTLS-fingerprint peer referee because it could not be honest under an SFU — a fallback mesh would need it back, and the product would promise end-to-end verification on some calls and not others, which is worse than promising it on none.",
    "The failure case a fallback would cover is one a health probe can report honestly instead: 'the media server is unreachable; calls are unavailable right now' is a better product than a spinner that never resolves — and far better than silently switching architectures mid-call.",
    "The server going away is survivable without a fallback: the P3 room record outlives the media server (its heartbeats ride the presence SSE stream, an app-server concern), and the media server rebuilds a room on demand at join (`ensureRoom`) — so reconnect-with-backoff rejoins the SAME room and a viewer's player resumes without the host doing anything.",
  ],
  insteadOfFallback:
    "Honest refusal at the door (the join path probes /health first), MEDIA_FAILURE_USER_COPY on every surface, reconnect-with-backoff into the same room record, and a /health-driven indicator in the Stream Hub, the call UI and the admin window.",
} as const;

/* --------------------------- cross-process event vocabulary ------------------------- */

/**
 * The events the P3 outbox carries between app processes — typed HERE so the
 * outbox is a dumb pipe that defines no shapes of its own. The design rule:
 * the SHARED STORE is the truth and these events are small, id-bearing nudges
 * to look at it — the receiving process (the one holding the user's SSE
 * socket) re-reads the store and synthesizes the client-facing MessengerEvent
 * itself, so no payload here ever becomes a second copy of a schema that
 * lives in ./types.
 *
 * If P3 finds a signal that must cross processes and does not fit these
 * kinds, the kind is added to THIS union, in this file — never as a parallel
 * shape inside outbox.ts. One schema, one home.
 */
export type CrossProcessEvent =
  /** A call invite must ring a user whichever process holds their socket.
   *  Ids only — the holder reads the call session from the store and rings
   *  from that truth. Stale rings die by OUTBOX_TTL, not by delivery. */
  | { kind: "ring"; callId: string; from: string; to: string; at: string }
  /** A user came online or went offline on SOME process. Holders recompute
   *  the roster from the shared store (the union across processes — never
   *  one process's opinion) and rebroadcast it to their clients. */
  | { kind: "presence-flip"; user: string; online: boolean; at: string }
  /** A room record changed — join, leave, producer added or paused, room
   *  ended. Holders re-read the room and push a fresh snapshot to attached
   *  clients. One deliberately coarse kind instead of six fine ones: the
   *  store is cheap to re-read and a coarse nudge cannot drift from it. */
  | { kind: "room-updated"; roomId: RoomId; at: string }
  /**
   * ADDED IN P3, and it is meant to SHRINK. The three kinds above are nudges
   * because the store holds the truth they point at. The mesh's relay frames
   * — a call's `sdp`/`ice`, a stream's per-viewer `sdp`/`ice`, the
   * `viewer-join`/`viewer-leave`/`ended` signals — are held by NOTHING: they
   * are forwarded byte-for-byte and never stored, so there is no record for a
   * receiving process to re-read. They still have to cross a process boundary
   * while the mesh is alive, and this kind is how.
   *
   * `frame` is typed `unknown` ON PURPOSE. Naming its shape here would copy
   * `MessengerEvent` out of ./types into this file — the exact second home the
   * comment above forbids — so the drainer hands it to the socket unparsed and
   * the only file that knows the shape stays the one that defines it. The
   * messenger's live message push rides here too: text messaging is out of
   * this project's scope fence, and inventing a media-contract kind for it
   * would be scope creep in the shape of a type.
   *
   * P6 and P7 delete the sdp/ice relay surface by surface; every deletion
   * takes traffic OFF this kind. If it ever reaches zero users, delete it.
   */
  | { kind: "passthrough"; to: string; at: string; frame: unknown };

/* -------------------------------- capacity targets --------------------------------- */

/**
 * Capacity targets, with the reasoning attached to the numbers — these are
 * REFUSAL thresholds ('room-full'), sized for a small private suite and
 * deliberately generous so the cap is an engineering guarantee, not a
 * user-visible feature.
 */
export const CAPACITY = {
  /**
   * Call-room ceiling. 8 seats, each publishing audio+video and consuming
   * every other seat, costs the server 8×7×2 = 112 consumers — comfortable
   * inside one worker's budget (see roomsPerWorker) — while the roster for
   * this suite is a handful of accounts, so 8 is already headroom.
   */
  participantsPerRoom: 8,
  /**
   * GROUP-ROOM ceiling (P11 of `axf-amberxvid-social`) — the largest number of
   * PUBLISHING seats one room may hold, and therefore the machine ceiling the
   * media server enforces on every publishing join (see the note below).
   *
   * Why a second number instead of raising {@link participantsPerRoom}: 8 is
   * the honest CALL number and its reasoning above is still true — a call room
   * has no paging, so every seat consumes every other seat and the consumer
   * count is N×(N-1)×2. A group room is a different shape, and the difference
   * is the P11 paging invariant: a client holds VIDEO consumers only for the
   * page it is looking at, at most 49. So the room's cost is not quadratic in
   * N, it is N×49×(video) + N×audio, and the arithmetic that sizes this number
   * is:
   *
   *   200 members, each looking at one 49-tile page  ≈ 200 × 49  ≈ 9 800 video
   *   consumers, plus audio. At the community rule of thumb of ~500 consumers
   *   per worker (see roomsPerWorker) that is ~20 workers for ONE full room —
   *   which is exactly the point of stating it: this ceiling is a promise about
   *   the ROOM SHAPE the client can render, not a promise that any given
   *   deployment has the workers to fill it. A deployment that means to run
   *   rooms this large sizes its pool from this arithmetic; one that does not
   *   caps members far lower through the policy row below.
   *
   * THE PRODUCT CAP IS NOT THIS NUMBER. Exactly as `viewersPerStream` (50) is
   * the machine ceiling under the `streamViewerLimit` policy row, this is the
   * machine ceiling under the group room's own policy cap — which is pinned
   * onto the room record when the room opens (`GroupRoomData.memberLimit`) and
   * enforced at the app server, where the room record lives and where a
   * refusal can name the row that caused it.
   */
  membersPerGroupRoom: 200,
  /**
   * Stream-room ceiling, previews included. Host publishes ≤3 producers
   * (camera, mic, screen); 50 viewers × 2 consumed kinds ≈ 100 consumers.
   * An order of magnitude beyond the suite's roster ON PURPOSE: the constant
   * exists so an overload is a named 'room-full' refusal at the door instead
   * of a mystery OOM, not because 50 is expected.
   */
  viewersPerStream: 50,
  /**
   * A mediasoup worker is one single-threaded process pinned to ~one core,
   * with a community rule of thumb of roughly 500 consumers before it
   * saturates. Four worst-case rooms (4 × ~112–128 consumers ≈ 450–512)
   * sits at that ceiling, so 4 is the honest per-worker room budget.
   * Routers are pinned to workers at creation — rooms are the placement
   * unit, and P2 sizes the worker pool to cores.
   */
  roomsPerWorker: 4,
} as const;

/* --------------------------------- timing contract ---------------------------------- */

/**
 * The liveness numbers later phases enforce — defined here because P3's
 * sweeper explicitly drops participants "older than the contract timeout",
 * and a timeout that lives next to its sweeper is a timeout the next reader
 * re-invents.
 */
export const MEDIA_TIMING = {
  /** Participant heartbeat cadence into the room record (P3). */
  heartbeatMs: 10_000,
  /**
   * A participant whose heartbeat is older than this is swept from the room.
   * 3× the cadence: rides out one slow write or GC pause without flapping,
   * while a crashed process's ghosts clear in under half a minute — the
   * sweeper is correctness, not optimisation (P0 carry-forward #5).
   */
  participantTimeoutMs: 30_000,
  /**
   * Grace after the last seat empties before the room's router is closed —
   * long enough for P6's reconnect-resume into the same room record, short
   * enough that abandoned routers do not accumulate against roomsPerWorker.
   */
  roomIdleCloseMs: 60_000,
  /**
   * The hover-preview SEAT lease (P7): a `preview` seat older than this is
   * treated as expired by every server-side reader — the room-record sweep
   * drops it, and the media bridge's keepalive vacates its media seat, which
   * closes its consumers and stops the media at the source. 15 s is
   * `STREAM_PREVIEW_S` (lib/types.ts — the client's own hover clock); the
   * extra 5 s rides out a slow join so an honest preview never dies mid-play.
   * Under the mesh this was a 60 s client-honour grace; the SFU makes it a
   * lease the server enforces.
   */
  previewLeaseMs: 20_000,
  /**
   * An undelivered CrossProcessEvent older than this is dropped by the
   * drainer, not delivered: a stale ring is worse than none (real phones
   * stop ringing when the caller gives up), and presence/room nudges are
   * superseded by any fresher read of the store anyway.
   */
  outboxTtlMs: 45_000,
  /** Outbox poll fallback cadence — fs.watch on win32 is best-effort (P3). */
  outboxPollMs: 1_500,
  /**
   * Participant-token lifetime. The token authorises exactly one WS join;
   * after that the session IS the connection plus the room record, so five
   * minutes covers a slow join without leaving long-lived bearer strings
   * lying around.
   */
  tokenTtlS: 300,
  /**
   * P11 reconnect-with-backoff: the delay before attempt N is
   * `reconnectBackoffMs[min(N, length-1)]` — quick first retries for a
   * bounced process, then a steady 15 s so a long outage costs four probes a
   * minute, not a hammering. Retrying is UNBOUNDED by design: the loop ends
   * when the room record ends or the user leaves, never by giving up on a
   * server that might come back.
   */
  reconnectBackoffMs: [2_000, 4_000, 8_000, 15_000],
  /** A /health probe that has not answered in this window counts as down —
   *  the join-path probe must refuse faster than the bridge's own 4 s
   *  connect box, or probing first would buy nothing. */
  healthProbeTimeoutMs: 3_000,
  /** The UI health indicator's poll cadence (Stream Hub, call window, admin
   *  status line) — frequent enough that the indicator is honest, rare
   *  enough that an idle hub costs four requests a minute. */
  healthPollMs: 15_000,
} as const;
