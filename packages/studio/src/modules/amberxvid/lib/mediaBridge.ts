/**
 * @file The APP SERVER's end of the media server's WS channel (P4).
 *
 * `MEDIA_CONTRACT.signaling` names the division of labour: the app server
 * authorises, mints the participant token, **forwards transport setup over the
 * media server's WS channel and returns the answer**. This file is that
 * forwarding half — a WebSocket RPC client against `media-server/http.ts`'s
 * protocol, plus the registry of live seats it holds on behalf of signed-in
 * members. It never touches media bytes; every message here is small JSON
 * setup vocabulary (capabilities, transport parameters, ids).
 *
 * One socket per SEAT, not per request: the media server binds a seat to the
 * socket that presented its token (`http.ts` — the socket is anonymous until
 * `join`, and closing it vacates the seat). So `joinSeat()` opens a socket,
 * joins it, and keeps it; every later action for that seat rides the same
 * socket, and the socket dying IS the seat dying — the registry drops it, and
 * the client's next action gets a named refusal rather than a ghost.
 *
 * The seat map is pinned to `globalThis` (the module's long-standing dev-server
 * idiom) and is deliberately PROCESS-LOCAL: a WebSocket cannot live in the P3
 * shared store, and the store's own vocabulary already covers what must cross
 * processes (the room records). A media session simply lives and dies on the
 * app process that joined it — P6's reconnect-resume owns the client-side story
 * when that process goes away.
 *
 * **Never a hang** (`MEDIA_FAILURE_MEANING["server-unreachable"]`): connecting
 * is time-boxed, every request is time-boxed, and a dead socket fails all of
 * its callers immediately. A media server that is down surfaces as the
 * `server-unreachable` MediaFailure in bounded time, every time.
 *
 * Server-only. Node ≥ 22 ships the WebSocket CLIENT globally (undici), which
 * is why this file imports nothing to speak the protocol `http.ts` serves.
 */

import { MEDIA_TIMING, ROLE_RULES } from "./mediaContract";
import type { MediaFailure, MediaRole, ParticipantId, RoomId } from "./mediaContract";
import { norm, readRoom } from "./roomStore";

/* --------------------------------- failures ---------------------------------- */

/** A refusal in the closed `MediaFailure` vocabulary, thrown by the bridge so
 *  the route maps it to the wire without stringly-typed decisions of its own —
 *  the same shape as the media server's own `MediaError`. */
export class MediaPlaneError extends Error {
  readonly failure: MediaFailure;

  constructor(failure: MediaFailure, detail: string) {
    super(detail);
    this.name = "MediaPlaneError";
    this.failure = failure;
  }
}

/** The HTTP status each failure travels under. One map, used by every action. */
export const MEDIA_FAILURE_STATUS = {
  "server-unreachable": 503,
  "token-rejected": 403,
  "room-full": 409,
  "transport-failed": 502,
  "publish-denied": 403,
  "recording-failed": 503,
} as const satisfies Record<MediaFailure, number>;

const FAILURES = Object.keys(MEDIA_FAILURE_STATUS) as MediaFailure[];

function isMediaFailure(v: unknown): v is MediaFailure {
  return typeof v === "string" && (FAILURES as readonly string[]).includes(v);
}

const unreachable = (detail: string): MediaPlaneError => new MediaPlaneError("server-unreachable", detail);

/* -------------------------------- configuration ------------------------------- */

/**
 * Where the media server is — `MEDIA_ENV.AMBERXVID_MEDIA_URL` verbatim,
 * including the per-call parity rule: explicit URL, else derived loopback
 * under dev, else `null` = the media plane is OFF, said honestly.
 */
export function mediaServerUrl(): string | null {
  const explicit = process.env.AMBERXVID_MEDIA_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.AMBERXVID_MEDIA_DEV?.trim() === "1") {
    const port = Number(process.env.AMBERXVID_MEDIA_PORT ?? "") || 3215;
    return `http://127.0.0.1:${port}`;
  }
  return null;
}

/** `http(s)://host` → `ws(s)://host/ws` — the one upgrade path `http.ts` serves. */
function wsUrlOf(base: string): string {
  return `${base.replace(/^http/, "ws").replace(/\/+$/, "")}/ws`;
}

/** A media server that is down must be a fast refusal, never a hang. */
const CONNECT_TIMEOUT_MS = 4_000;
const RPC_TIMEOUT_MS = 10_000;

/* --------------------------------- the channel --------------------------------- */

type Reply = Record<string, unknown>;

interface Pending {
  resolve: (reply: Reply) => void;
  reject: (err: MediaPlaneError) => void;
  timer: NodeJS.Timeout;
}

/**
 * One WS connection speaking `http.ts`'s request/reply protocol: every request
 * carries an `id`, every reply echoes it. Unsolicited pushes (the server's
 * `room-updated` announcements carry no `id`) surface through {@link onPush} —
 * P4 dropped them because no client channel existed yet; P6 wired them
 * through: the media route forwards each one to the seat's user as a
 * `room-media` MessengerEvent over the presence SSE stream, which is how a
 * subscriber learns a producer appeared, paused or vanished.
 */
class MediaChannel {
  private readonly ws: WebSocket;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private dead = false;
  /** Fired once, when the socket dies for any reason. The registry uses it to
   *  drop the seat this channel carried. */
  onDead: () => void = () => {};
  /** Fired per unsolicited (id-less) server push — the `room-updated`
   *  announcements. Set by the media route at join; default drops. */
  onPush: (msg: Reply) => void = () => {};

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev: MessageEvent) => this.handleMessage(ev.data as unknown));
    ws.addEventListener("close", () => this.die("the media channel closed"));
    ws.addEventListener("error", () => this.die("the media channel errored"));
  }

  /** Open and await the socket, time-boxed. Refusal is `server-unreachable`. */
  static connect(base: string): Promise<MediaChannel> {
    return new Promise<MediaChannel>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrlOf(base));
      } catch (err) {
        reject(unreachable(err instanceof Error ? err.message : String(err)));
        return;
      }
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* never opened */
        }
        reject(unreachable(`no answer from ${base} within ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);
      ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve(new MediaChannel(ws));
        },
        { once: true },
      );
      ws.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(unreachable(`could not reach the media server at ${base}`));
        },
        { once: true },
      );
    });
  }

  /** Send one request, await its id-matched reply, time-boxed. A media-server
   *  refusal (`ok: false`) rejects with its own `MediaFailure`, relayed
   *  verbatim — the closed vocabulary crosses this bridge untranslated. */
  request(msg: Record<string, unknown>): Promise<Reply> {
    if (this.dead) return Promise.reject(unreachable("the media channel is closed"));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(unreachable(`media server did not answer within ${RPC_TIMEOUT_MS}ms`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ ...msg, id }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(unreachable(err instanceof Error ? err.message : String(err)));
      }
    });
  }

  close(): void {
    this.dead = true;
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return; // the whole vocabulary is JSON text
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const msg = parsed as Reply;
    const id = typeof msg.id === "number" ? msg.id : null;
    if (id === null) {
      // Unsolicited push (room-updated) — hand to the seat's push handler.
      try {
        this.onPush(msg);
      } catch {
        /* a push handler must never take the channel down */
      }
      return;
    }
    const waiter = this.pending.get(id);
    if (!waiter) return;
    this.pending.delete(id);
    clearTimeout(waiter.timer);
    if (msg.ok === true) waiter.resolve(msg);
    else {
      const failure = isMediaFailure(msg.failure) ? msg.failure : "transport-failed";
      waiter.reject(new MediaPlaneError(failure, `media server refused ${String(msg.type ?? "request")}`));
    }
  }

  private die(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(unreachable(reason));
    }
    this.pending.clear();
    this.onPush = () => {};
    this.onDead();
    this.onDead = () => {};
  }
}

/* ---------------------------------- the seats ----------------------------------- */

export interface BridgeSeat {
  participantId: ParticipantId;
  /** Normalized owner — every later action must arrive from the same session. */
  user: string;
  roomId: RoomId;
  /** Server-assigned at join (`MEDIA_CONTRACT.identity`) — echoed from the
   *  media server's `joined` reply, never from anything a client sent. */
  role: MediaRole;
  canPublish: boolean;
  channel: MediaChannel;
  /** The keepalive tick (P7) — see {@link startKeepalive}. Held on the seat so
   *  every teardown path can clear it. */
  keepalive: NodeJS.Timeout | null;
}

const ROLES = Object.keys(ROLE_RULES) as MediaRole[];

function isRole(v: unknown): v is MediaRole {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

const normUser = (u: string): string => u.trim().toLowerCase();

/** Pinned to `globalThis` so a dev-server module reload does not orphan live
 *  sockets — the same idiom the pre-P3 registries used, correct here because a
 *  socket genuinely IS process-local state. */
type BridgeState = { seats: Map<ParticipantId, BridgeSeat> };

function seats(): Map<ParticipantId, BridgeSeat> {
  const g = globalThis as typeof globalThis & { __axvMediaBridge?: BridgeState };
  g.__axvMediaBridge ??= { seats: new Map() };
  return g.__axvMediaBridge.seats;
}

/**
 * The seat keepalive (P7), and it is deliberately CONDITIONAL: every
 * `MEDIA_TIMING.heartbeatMs` the tick re-reads the P3 ROOM RECORD, and only a
 * seat the record still holds is kept warm. The record is the authority
 * (`MEDIA_CONTRACT.identity`), and its own heartbeats ride the member's
 * presence SSE socket — so this tick is exactly the browser-liveness relay the
 * media server needs, without inventing a second liveness channel:
 *
 *   - record seat alive              → heartbeat the media seat (a stream or
 *     call now survives past `participantTimeoutMs`, which nothing did before
 *     this tick existed — the seats only spoke during setup);
 *   - record gone / room ended /
 *     seat swept / role changed      → VACATE the media seat: transports and
 *     consumers close, media stops at the source;
 *   - `preview` past `previewLeaseMs` → the same vacate. THIS is the
 *     server-enforced hover lease — the client's 15 s timer is a courtesy,
 *     not the mechanism.
 *
 * A heartbeat the media server refuses (`seat vacated` — its sweeper got
 * there first) folds the seat the same way.
 */
function startKeepalive(seat: BridgeSeat): void {
  const tick = (): void => {
    const rec = readRoom(seat.roomId);
    const recordSeat = rec?.participants.find((p) => p.user === norm(seat.user) && p.role === seat.role);
    const leaseExpired =
      recordSeat?.role === "preview" &&
      Date.now() - Date.parse(recordSeat.joinedAt) > MEDIA_TIMING.previewLeaseMs;
    if (!rec || rec.state !== "live" || !recordSeat || leaseExpired) {
      void leaveSeat(seat);
      return;
    }
    seat.channel.request({ type: "heartbeat" }).catch(() => void leaveSeat(seat));
  };
  seat.keepalive = setInterval(tick, MEDIA_TIMING.heartbeatMs);
  seat.keepalive.unref?.();
}

/**
 * Open a channel, present the minted token, keep the seat. The `joined` reply
 * is returned whole so the route can hand the client the router RTP
 * capabilities and snapshot without this file re-declaring their shapes.
 */
export async function joinSeat(baseUrl: string, token: string, user: string): Promise<{ seat: BridgeSeat; joined: Reply }> {
  const channel = await MediaChannel.connect(baseUrl);
  let joined: Reply;
  try {
    joined = await channel.request({ type: "join", token });
  } catch (err) {
    channel.close();
    throw err;
  }
  const participantId = typeof joined.participantId === "string" ? joined.participantId : "";
  const roomId = typeof joined.roomId === "string" ? joined.roomId : "";
  if (!participantId || !roomId || !isRole(joined.role)) {
    channel.close();
    throw new MediaPlaneError("transport-failed", "malformed joined reply from the media server");
  }
  const seat: BridgeSeat = {
    participantId,
    user: normUser(user),
    roomId,
    role: joined.role,
    canPublish: joined.canPublish === true,
    channel,
    keepalive: null,
  };
  channel.onDead = () => {
    if (seat.keepalive) clearInterval(seat.keepalive);
    seat.keepalive = null;
    seats().delete(participantId);
  };
  seats().set(participantId, seat);
  startKeepalive(seat);
  return { seat, joined };
}

/** The caller's live seat, or null — a seat is only ever handed back to the
 *  session that joined it, which is what makes `participantId` safe to carry
 *  in a request body. */
export function seatOf(user: string, participantId: unknown): BridgeSeat | null {
  if (typeof participantId !== "string" || !participantId) return null;
  const seat = seats().get(participantId);
  return seat && seat.user === normUser(user) ? seat : null;
}

/** Tell the media server, then drop the seat. The vacate is best-effort — a
 *  dead server cannot stop a client from leaving. */
export async function leaveSeat(seat: BridgeSeat): Promise<void> {
  if (seat.keepalive) clearInterval(seat.keepalive);
  seat.keepalive = null;
  try {
    await seat.channel.request({ type: "leave" });
  } catch {
    /* leaving anyway — closing the socket vacates the seat server-side too */
  }
  seats().delete(seat.participantId);
  seat.channel.onDead = () => {};
  seat.channel.onPush = () => {};
  seat.channel.close();
}
