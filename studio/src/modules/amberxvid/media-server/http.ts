/**
 * @file The media server's ONE external surface: `GET /health`, and a
 * WebSocket channel carrying transport setup.
 *
 * `MEDIA_CONTRACT.signaling` is emphatic about the shape of this file, and it
 * is a deletion as much as a construction: **SDP never transits again**. The
 * mesh relayed offers, answers and ICE candidates through the app server; here
 * the client and the media server exchange mediasoup's own primitives — router
 * RTP capabilities, transport parameters, producer and consumer descriptions —
 * over this socket and nothing else. There is no SDP relay in this module any
 * more, and adding one back would be re-importing the architecture the
 * conversion exists to replace.
 *
 * ── why the WebSocket layer is hand-written ─────────────────────────────────
 *
 * No `ws` dependency was authorised for this phase — only mediasoup was, and
 * "never substitute a different SFU" is a sentence about not smuggling scope in
 * either direction. Node ships a WebSocket CLIENT (undici's global) but no
 * server, so the RFC 6455 server half is implemented below over `node:http`'s
 * `upgrade` event: the accept-key handshake, frame decode with unmasking and
 * fragment reassembly, frame encode, ping/pong and close. It is ~150 lines and
 * it is the same protocol every phase after this one will speak.
 *
 * Two things it deliberately enforces, because a permissive parser is where
 * WebSocket servers go wrong: a client frame that is not MASKED is a protocol
 * violation and closes the socket (1002), and a payload over `MAX_PAYLOAD` is
 * refused (1009) rather than buffered — nothing in this vocabulary is large,
 * and an unbounded reassembly buffer is a memory bomb an unauthenticated
 * socket can post.
 *
 * ── authorisation ───────────────────────────────────────────────────────────
 *
 * The socket is anonymous until `join` presents a participant token, and every
 * other message is refused until then. Identity comes from that token's claims
 * and nowhere else (`MEDIA_CONTRACT.identity`) — there is no message in this
 * file that reads a client-sent username, room or role.
 *
 * Server-only.
 */

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import type { DtlsParameters, RtpCapabilities, RtpParameters } from "mediasoup/types";

import { MEDIA_CONTRACT, ROLE_RULES } from "../lib/mediaContract";
import type { MediaFailure, ParticipantId, RoomId } from "../lib/mediaContract";
import { MediaError, isMediaKind } from "./rooms";
import type { Participant, Room, RoomRegistry } from "./rooms";
import { mediaSecret, verifyMediaToken } from "./tokens";

/* ------------------------------ the framing layer ------------------------------ */

/** RFC 6455 §1.3 — the fixed GUID the accept key is derived with. */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Nothing in this vocabulary approaches this; it is a bound, not a budget. */
const MAX_PAYLOAD = 1 << 20;

const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  header[0] = 0x80 | opcode; // FIN — the server never fragments its replies.
  return Buffer.concat([header, payload]);
}

/**
 * One upgraded socket. Emits parsed JSON messages; everything below the
 * protocol (masking, fragments, control frames) is handled here so the message
 * handler never sees a frame.
 */
class WsConnection {
  private buf: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentOp = 0;
  private closed = false;
  onMessage: (msg: Record<string, unknown>) => void = () => {};
  onClose: () => void = () => {};

  private readonly socket: Duplex;
  private readonly log: (msg: string) => void;

  constructor(socket: Duplex, log: (msg: string) => void) {
    this.socket = socket;
    this.log = log;
    socket.on("data", (chunk: Buffer) => {
      this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
      try {
        this.drain();
      } catch (err) {
        this.log(`ws parse error: ${err instanceof Error ? err.message : String(err)}`);
        this.close(1002, "protocol error");
      }
    });
    socket.on("error", () => this.destroy());
    socket.on("close", () => this.destroy());
  }

  private drain(): void {
    for (;;) {
      if (this.closed || this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) {
          this.close(1009, "message too big");
          return;
        }
        len = Number(big);
        offset = 10;
      }
      // A client frame MUST be masked (RFC 6455 §5.1). Accepting an unmasked
      // one is the classic permissive-parser hole.
      if (!masked) {
        this.close(1002, "unmasked client frame");
        return;
      }
      if (len > MAX_PAYLOAD) {
        this.close(1009, "message too big");
        return;
      }
      if (this.buf.length < offset + 4 + len) return;

      const mask = this.buf.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i += 1) payload[i] = this.buf[offset + i] ^ mask[i & 3];
      this.buf = this.buf.subarray(offset + len);

      // Control frames are never fragmented and cap at 125 bytes.
      if (opcode >= 0x8) {
        if (!fin || len > 125) {
          this.close(1002, "bad control frame");
          return;
        }
        if (opcode === OP_PING) this.raw(OP_PONG, payload);
        else if (opcode === OP_CLOSE) this.close(1000, "");
        continue;
      }

      if (opcode === OP_CONTINUATION) {
        if (this.fragmentOp === 0) {
          this.close(1002, "continuation without start");
          return;
        }
        this.fragments.push(payload);
      } else {
        if (this.fragmentOp !== 0) {
          this.close(1002, "interleaved message");
          return;
        }
        if (!fin) {
          this.fragmentOp = opcode;
          this.fragments = [payload];
          continue;
        }
        this.deliver(opcode, payload);
        continue;
      }

      if (fin) {
        const op = this.fragmentOp;
        const whole = Buffer.concat(this.fragments);
        this.fragments = [];
        this.fragmentOp = 0;
        this.deliver(op, whole);
      } else if (this.fragments.reduce((n, f) => n + f.length, 0) > MAX_PAYLOAD) {
        this.close(1009, "message too big");
        return;
      }
    }
  }

  private deliver(opcode: number, payload: Buffer): void {
    if (opcode === OP_BINARY) {
      // The whole vocabulary is JSON text; a binary frame is a client bug.
      this.close(1003, "binary frames are not accepted");
      return;
    }
    if (opcode !== OP_TEXT) return;
    let msg: unknown;
    try {
      msg = JSON.parse(payload.toString("utf8"));
    } catch {
      this.send({ ok: false, type: "error", failure: "token-rejected", detail: "malformed json" });
      return;
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
    this.onMessage(msg as Record<string, unknown>);
  }

  private raw(opcode: number, payload: Buffer): void {
    if (this.closed || this.socket.destroyed) return;
    this.socket.write(encodeFrame(opcode, payload));
  }

  send(msg: Record<string, unknown>): void {
    this.raw(OP_TEXT, Buffer.from(JSON.stringify(msg), "utf8"));
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.raw(OP_CLOSE, body);
    this.closed = true;
    this.socket.end();
    this.onClose();
    this.onClose = () => {};
  }

  private destroy(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.destroy();
    } catch {
      /* already gone */
    }
    this.onClose();
    this.onClose = () => {};
  }
}

/** The RFC 6455 opening handshake. Returns false (and answers 400) if this is
 *  not a well-formed v13 upgrade. */
function handshake(req: IncomingMessage, socket: Duplex): boolean {
  const key = req.headers["sec-websocket-key"];
  const version = req.headers["sec-websocket-version"];
  if (typeof key !== "string" || String(req.headers.upgrade ?? "").toLowerCase() !== "websocket" || version !== "13") {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return false;
  }
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  // `upgrade` types its socket as a plain Duplex; the real one is a net.Socket
  // and Nagle would add up to 40ms to every small setup message.
  if ("setNoDelay" in socket) (socket as Duplex & { setNoDelay(v: boolean): void }).setNoDelay(true);
  return true;
}

/* ------------------------------- the session layer ------------------------------ */

interface Seat {
  room: Room;
  participant: Participant;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export interface MediaHttpOptions {
  registry: RoomRegistry;
  port: number;
  /** Reported by /health; supplied by the process entry so this file need not
   *  import mediasoup for a version string. */
  info: () => { workers: number; mediasoupVersion: string };
  log: (msg: string) => void;
}

export interface MediaHttpHandle {
  server: Server;
  /** Stop listening and close every live socket. Resolves when the listener is
   *  down — a shutdown that waits on a client's socket is a shutdown that
   *  hangs, so open sockets are closed rather than drained. */
  close: () => Promise<void>;
}

export function startMediaHttp(opts: MediaHttpOptions): Promise<MediaHttpHandle> {
  const { registry, info, log } = opts;
  const sockets = new Set<WsConnection>();

  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url?.startsWith("/health?"))) {
      const stats = registry.stats();
      const { workers, mediasoupVersion } = info();
      const body = JSON.stringify(
        {
          ok: true,
          service: "amberxvid-media-server",
          contractVersion: MEDIA_CONTRACT.version,
          mediasoupVersion,
          workers,
          rooms: stats.rooms,
          participants: stats.participants,
          producers: stats.producers,
          consumers: stats.consumers,
          recordings: stats.recordings,
          sockets: sockets.size,
          pid: process.pid,
          uptimeS: Math.round(process.uptime()),
        },
        null,
        2,
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("amberxvid media server — GET /health, or WebSocket /ws\n");
  });

  server.on("upgrade", (req, socket) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    if (!handshake(req, socket)) return;

    const conn = new WsConnection(socket, log);
    sockets.add(conn);
    let seat: Seat | null = null;

    // The in-process room-updated nudge: coarse on purpose, exactly like the
    // P3 cross-process event — the client re-reads the room rather than
    // trusting a payload to be a second copy of the truth.
    const unsubscribe = registry.onRoomUpdated((roomId: RoomId) => {
      if (seat && seat.room.id === roomId) {
        conn.send({ type: "room-updated", roomId, snapshot: registry.snapshot(seat.room, seat.participant.id) });
      }
    });

    conn.onClose = () => {
      unsubscribe();
      sockets.delete(conn);
      if (seat) {
        registry.leave(seat.room.id, seat.participant.id);
        seat = null;
      }
    };

    conn.onMessage = (msg) => {
      const id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
      const type = typeof msg.type === "string" ? msg.type : "";
      const fail = (failure: MediaFailure, detail: string) => {
        // `detail` is the server's own word for its log; the FAILURE is the
        // whole of what the wire carries, per the closed vocabulary.
        log(`ws ${type} refused: ${failure} (${detail})`);
        conn.send({ id, ok: false, type: "error", failure });
      };

      void (async () => {
        try {
          if (type === "join") {
            if (seat) return fail("token-rejected", "already joined on this socket");
            const secret = mediaSecret();
            if (!secret) return fail("server-unreachable", "AMBERXVID_MEDIA_SECRET is not configured");
            const verdict = verifyMediaToken(msg.token, secret);
            if (!verdict.ok) return fail("token-rejected", verdict.detail);
            const joined = await registry.join(verdict.claims);
            seat = joined;
            // P10: a seat that MAY record (the host) is told at the door
            // whether it CAN — so an absent ffmpeg or a full disk renders as
            // a disabled toggle with the reason shown, never a silent no-op.
            const recCap = ROLE_RULES[joined.participant.role].canRecord
              ? await registry.recordingCapability()
              : null;
            conn.send({
              id,
              ok: true,
              type: "joined",
              roomId: joined.room.id,
              participantId: joined.participant.id,
              sub: joined.participant.sub,
              role: joined.participant.role,
              canPublish: ROLE_RULES[joined.participant.role].canPublish,
              recordingAvailable: recCap ? recCap.ok : false,
              recordingReason: recCap ? recCap.reason : null,
              routerRtpCapabilities: joined.room.router.rtpCapabilities,
              snapshot: registry.snapshot(joined.room, joined.participant.id),
            });
            return;
          }

          // Everything else needs a seat. An anonymous socket learns nothing.
          if (!seat) return fail("token-rejected", "not joined");
          const { room, participant } = seat;
          registry.heartbeat(room.id, participant.id);

          switch (type) {
            case "heartbeat": {
              // Honest liveness both ways: a seat the registry has swept or
              // vacated must not be kept warm by a socket that outlived it —
              // the refusal is what tells the app-server bridge to fold.
              const still = registry.getRoom(room.id)?.participants.get(participant.id);
              if (!still) return fail("token-rejected", "seat vacated");
              conn.send({ id, ok: true, type: "alive" });
              return;
            }

            case "snapshot":
              conn.send({ id, ok: true, type: "snapshot", snapshot: registry.snapshot(room, participant.id) });
              return;

            case "create-transport": {
              const direction = msg.direction === "send" ? "send" : "recv";
              const transport = await registry.createTransport(room, participant, direction);
              conn.send({
                id,
                ok: true,
                type: "transport",
                direction,
                transportId: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
              });
              return;
            }

            case "connect-transport": {
              await registry.connectTransport(
                participant,
                msg.transportId,
                asObject(msg.dtlsParameters) as unknown as DtlsParameters,
              );
              conn.send({ id, ok: true, type: "connected", transportId: msg.transportId });
              return;
            }

            case "produce": {
              if (!isMediaKind(msg.kind)) return fail("publish-denied", `unknown media kind ${String(msg.kind)}`);
              const producer = await registry.produce(
                room,
                participant,
                msg.transportId,
                msg.kind,
                asObject(msg.rtpParameters) as unknown as RtpParameters,
              );
              conn.send({ id, ok: true, type: "produced", producerId: producer.id, kind: msg.kind });
              return;
            }

            case "consume": {
              const { consumer, mediaKind } = await registry.consume(
                room,
                participant,
                msg.transportId,
                msg.producerId,
                asObject(msg.rtpCapabilities) as unknown as RtpCapabilities,
              );
              conn.send({
                id,
                ok: true,
                type: "consumed",
                consumerId: consumer.id,
                producerId: consumer.producerId,
                kind: consumer.kind,
                mediaKind,
                rtpParameters: consumer.rtpParameters,
                // Created paused — resume only once the client has handled it.
                paused: true,
              });
              return;
            }

            case "pause-producer": {
              // Server-known mute (P6): pause/resume the seat's OWN upstream.
              if (!isMediaKind(msg.kind)) return fail("publish-denied", `unknown media kind ${String(msg.kind)}`);
              await registry.pauseProducer(room, participant, msg.kind, msg.paused === true);
              conn.send({ id, ok: true, type: "producer-paused", kind: msg.kind, paused: msg.paused === true });
              return;
            }

            case "resume-consumer": {
              await registry.resumeConsumer(participant, msg.consumerId);
              conn.send({ id, ok: true, type: "resumed", consumerId: msg.consumerId });
              return;
            }

            case "prefer-layers": {
              // P7: the subscriber names the simulcast spatial layer that fits
              // its display; the server fans only that layer down.
              await registry.preferLayers(participant, msg.consumerId, Number(msg.spatialLayer));
              conn.send({ id, ok: true, type: "layers", consumerId: msg.consumerId, spatialLayer: msg.spatialLayer });
              return;
            }

            case "start-recording": {
              // P10: `ROLE_RULES[...].canRecord` at the message door — the
              // same matrix the registry re-checks, one rule at both doors,
              // exactly the publish-denied posture.
              if (!ROLE_RULES[participant.role].canRecord) {
                return fail("recording-failed", `role ${participant.role} may not record`);
              }
              await registry.startRecording(room, participant, typeof msg.title === "string" ? msg.title : "");
              conn.send({ id, ok: true, type: "recording", recording: true });
              return;
            }

            case "stop-recording": {
              if (!ROLE_RULES[participant.role].canRecord) {
                return fail("recording-failed", `role ${participant.role} may not record`);
              }
              await registry.stopRecording(room);
              conn.send({ id, ok: true, type: "recording", recording: false });
              return;
            }

            case "leave": {
              const roomId: RoomId = room.id;
              const participantId: ParticipantId = participant.id;
              seat = null;
              registry.leave(roomId, participantId);
              conn.send({ id, ok: true, type: "left" });
              return;
            }

            default:
              return fail("token-rejected", `unknown message type ${type}`);
          }
        } catch (err) {
          if (err instanceof MediaError) return fail(err.failure, err.message);
          log(`ws ${type} threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
          return fail("transport-failed", "internal error");
        }
      })();
    };
  });

  return new Promise<MediaHttpHandle>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, () => {
      server.removeListener("error", reject);
      resolve({
        server,
        close: () =>
          new Promise<void>((done) => {
            for (const conn of [...sockets]) conn.close(1001, "server shutting down");
            sockets.clear();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
