/**
 * @file P12 — the client/server media plane, locked. No browser, no mediasoup
 * process: everything here runs against real files under a throwaway
 * `AMBERXVID_DATA_DIR` (the axf-kv idiom — node:test, a temp root, never a mock
 * of the thing under test) and, for the media server's door, against the REAL
 * `media-server/http.ts` WebSocket surface served in-process over fake
 * mediasoup workers. `mediasoup/types` imports are type-only throughout the
 * module, which is what makes that possible; anything that needs a real worker
 * (RTP, transports actually connecting, recording) belongs to P13's live
 * proof, not here.
 *
 * What is locked, bullet for bullet from the phase plan:
 *
 *  1. the participant token round-trip — mint, verify, expiry refused,
 *     tampered signature refused, and the constant-time compare in the verify
 *     path (behavioural: a wrong-LENGTH signature must be a refusal, never a
 *     `timingSafeEqual` throw; plus a source pin that the compare runs through
 *     `timingSafeEqual` BEFORE any claim is parsed);
 *  2. the P3 room store — two processes over one root (real spawned node
 *     children, each mutating the same room record through the shared lock),
 *     the heartbeat sweep clearing a dead process's participants, and the
 *     stale-lock break that keeps a crashed writer from wedging the store;
 *  3. the P3 outbox — process A's event drains through process B exactly
 *     once, ordering preserved, holder addressing respected, TTL expiry
 *     cleaning undelivered files;
 *  4. the P4 authorisation refusals at the media server's door — a viewer may
 *     not produce in a stream room, a socket that never joined may not consume,
 *     and a token for room A is refused in room B (both the forged-room splice,
 *     which dies on the signature, and the client-sent roomId, which the door
 *     ignores in favour of the token's own claim);
 *  5. exhaustive handling of the `MediaFailure` union by everything that maps
 *     reasons to messages. The COMPILE-time gate lives in the source, where
 *     `tsc --noEmit` can see it (test/ is outside tsconfig's include): the
 *     three maps carry `as const satisfies Record<MediaFailure, …>`, so adding
 *     a new reason fails compilation until every map handles it — this file
 *     PINS those clauses, and its own no-default switch re-walks the union at
 *     runtime so a new reason also fails HERE until it is added.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import type { AddressInfo } from "node:net";
import type { Worker } from "mediasoup/types";

import {
  MEDIA_FAILURE_MEANING,
  MEDIA_FAILURE_USER_COPY,
  MEDIA_TIMING,
  ROLE_RULES,
} from "@axs/modules/amberxvid/lib/mediaContract";
import type { CrossProcessEvent, MediaFailure } from "@axs/modules/amberxvid/lib/mediaContract";
import { MEDIA_FAILURE_STATUS } from "@axs/modules/amberxvid/lib/mediaBridge";
import { MediaApiError, failureCopy } from "@axs/modules/amberxvid/lib/mediaHealth";
import { drain, enqueue, ensureQueue } from "@axs/modules/amberxvid/lib/outbox";
import { locksDir, outboxDir, roomsDir } from "@axs/modules/amberxvid/lib/paths";
import {
  createRoom,
  mutateRoom,
  newParticipant,
  readRoom,
  sweepRooms,
} from "@axs/modules/amberxvid/lib/roomStore";
import { startMediaHttp } from "@axs/modules/amberxvid/media-server/http";
import { MediaError, RoomRegistry } from "@axs/modules/amberxvid/media-server/rooms";
import type { MediaConfig } from "@axs/modules/amberxvid/media-server/rooms";
import { mintMediaToken, verifyMediaToken } from "@axs/modules/amberxvid/media-server/tokens";

/* ------------------------------------ setup ------------------------------------- */

// Every path in the module is read from the environment PER CALL (the turn.ts
// parity rule), so setting the root after the hoisted imports is safe — nothing
// latches it at import time. The secret is set here for the same reason:
// `http.ts`'s join reads it per message.
const root = await mkdtemp(path.join(os.tmpdir(), "amberxvid-media-test-"));
process.env.AMBERXVID_DATA_DIR = root;
const TEST_SECRET = "p12-test-secret-0123456789abcdef";
process.env.AMBERXVID_MEDIA_SECRET = TEST_SECRET;

const studioDir = path.resolve(import.meta.dirname, "..");
const moduleDir = path.join(studioDir, "src", "modules", "amberxvid");

after(() => rm(root, { recursive: true, force: true }));

const nowS = (): number => Math.floor(Date.now() / 1000);

/* ------------------------- 1. the participant token ------------------------------ */

describe("participant token: mint and verify are the same forty lines", () => {
  it("round-trips: claims come back verbatim, sub normalized on the way in", () => {
    const token = mintMediaToken({ sub: "  Neo ", room: "room-a", role: "participant" }, TEST_SECRET);
    const verdict = verifyMediaToken(token, TEST_SECRET);
    assert.equal(verdict.ok, true);
    if (!verdict.ok) return;
    assert.equal(verdict.claims.sub, "neo");
    assert.equal(verdict.claims.room, "room-a");
    assert.equal(verdict.claims.role, "participant");
    // Default ttl is the contract's tokenTtlS.
    const drift = Math.abs(verdict.claims.exp - (nowS() + MEDIA_TIMING.tokenTtlS));
    assert.ok(drift <= 2, `exp drifted ${drift}s from tokenTtlS`);
  });

  it("a username may carry ':' and '.' — user is LAST in the payload on purpose", () => {
    const token = mintMediaToken({ sub: "we:ird.na:me", room: "room-a", role: "viewer" }, TEST_SECRET);
    const verdict = verifyMediaToken(token, TEST_SECRET);
    assert.equal(verdict.ok, true);
    if (verdict.ok) assert.equal(verdict.claims.sub, "we:ird.na:me");
  });

  it("a roomId carrying ':' is refused at mint — the parser depends on it", () => {
    assert.throws(() => mintMediaToken({ sub: "neo", room: "a:b", role: "host" }, TEST_SECRET), /':'/);
  });

  it("expiry is refused, inclusive at the boundary", () => {
    const token = mintMediaToken({ sub: "neo", room: "room-a", role: "viewer", ttlS: 60 }, TEST_SECRET);
    const live = verifyMediaToken(token, TEST_SECRET, nowS() + 30);
    assert.equal(live.ok, true);
    const atExp = verifyMediaToken(token, TEST_SECRET, nowS() + 60);
    assert.deepEqual(atExp, { ok: false, failure: "token-rejected", detail: "expired" });
    const past = verifyMediaToken(token, TEST_SECRET, nowS() + 61);
    assert.equal(past.ok, false);
  });

  it("a tampered signature is refused", () => {
    const token = mintMediaToken({ sub: "neo", room: "room-a", role: "viewer" }, TEST_SECRET);
    const cut = token.lastIndexOf(".");
    const sig = token.slice(cut + 1);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    const verdict = verifyMediaToken(`${token.slice(0, cut)}.${flipped}`, TEST_SECRET);
    assert.deepEqual(verdict, { ok: false, failure: "token-rejected", detail: "bad signature" });
  });

  it("a token for room A, spliced to claim room B, dies on the signature", () => {
    // THE forged-room attack: the holder of a legitimate room-a token edits the
    // room field to point at room-b. The payload is signed whole, so the splice
    // is a bad signature — refused before the room claim is even parsed.
    const token = mintMediaToken({ sub: "neo", room: "room-a", role: "viewer" }, TEST_SECRET);
    const spliced = token.replace(":room-a:", ":room-b:");
    assert.notEqual(spliced, token, "the splice must have changed the payload");
    const verdict = verifyMediaToken(spliced, TEST_SECRET);
    assert.deepEqual(verdict, { ok: false, failure: "token-rejected", detail: "bad signature" });
  });

  it("a token minted under a different secret is refused", () => {
    const token = mintMediaToken({ sub: "neo", room: "room-a", role: "viewer" }, "some-other-secret");
    assert.equal(verifyMediaToken(token, TEST_SECRET).ok, false);
  });

  it("the constant-time path never throws on a wrong-LENGTH signature", () => {
    // A naive `timingSafeEqual(a, b)` THROWS on unequal lengths — the classic
    // hole. The verify path must refuse, quietly, whatever the length.
    const token = mintMediaToken({ sub: "neo", room: "room-a", role: "viewer" }, TEST_SECRET);
    const payload = token.slice(0, token.lastIndexOf("."));
    for (const sig of ["x", "xx", "x".repeat(200)]) {
      const verdict = verifyMediaToken(`${payload}.${sig}`, TEST_SECRET);
      assert.deepEqual(verdict, { ok: false, failure: "token-rejected", detail: "bad signature" });
    }
    // Degenerate shapes are refusals too, never throws.
    assert.equal(verifyMediaToken(null, TEST_SECRET).ok, false);
    assert.equal(verifyMediaToken("", TEST_SECRET).ok, false);
    assert.equal(verifyMediaToken("no-dot-here", TEST_SECRET).ok, false);
    assert.equal(verifyMediaToken(`${"x".repeat(5000)}.sig`, TEST_SECRET).ok, false);
  });

  it("source pin: the compare is timingSafeEqual, and it runs BEFORE any claim is parsed", () => {
    const src = fs.readFileSync(path.join(moduleDir, "media-server", "tokens.ts"), "utf8");
    assert.match(src, /timingSafeEqual/, "the verify path no longer uses a constant-time compare");
    const compareAt = src.indexOf("constantTimeEqual(signature");
    const parseAt = src.indexOf("Number(expRaw)");
    assert.ok(compareAt > 0 && parseAt > 0, "the verify-order landmarks moved — re-pin this test");
    assert.ok(
      compareAt < parseAt,
      "MEDIA_TOKEN.verify is an ORDER: the signature compare must come before expiry/claims parsing",
    );
  });
});

/* --------------------------- 2. the shared room store ---------------------------- */

describe("room store: one root, several processes, no ghosts", () => {
  it("round-trips a stream room record through the shared root", () => {
    const host = newParticipant("Hosta", "host");
    const viewer = newParticipant("Vera", "viewer");
    const rec = createRoom({
      kind: "stream",
      host: "Hosta",
      participants: [host, viewer],
      stream: { title: "launch day", chat: [], thumbnailAt: null, hasThumbnail: false },
    });
    const back = readRoom(rec.id);
    assert.ok(back, "the record did not land on disk");
    assert.equal(back.kind, "stream");
    assert.equal(back.host, "hosta"); // normalized
    assert.equal(back.hostDisplay, "Hosta"); // as supplied
    assert.deepEqual(back.participants.map((p) => p.user).sort(), ["hosta", "vera"]);
    assert.equal(back.state, "live");
  });

  it("the heartbeat sweep clears a dead process's participants and reports it", () => {
    const host = newParticipant("hosta", "host");
    const viewer = newParticipant("ghost-viewer", "viewer");
    const rec = createRoom({
      kind: "stream",
      host: "hosta",
      participants: [host, viewer],
      stream: { title: "t", chat: [], thumbnailAt: null, hasThumbnail: false },
    });

    // A crashed process stops refreshing its members' heartbeats — simulate the
    // aftermath by backdating the viewer's seat past participantTimeoutMs.
    const stale = new Date(Date.now() - MEDIA_TIMING.participantTimeoutMs - 10_000).toISOString();
    mutateRoom(rec.id, (r) => {
      const seat = r.participants.find((p) => p.user === "ghost-viewer");
      assert.ok(seat);
      seat.heartbeatAt = stale;
    });

    const outcomes = sweepRooms();
    const mine = outcomes.find((o) => o.roomId === rec.id);
    assert.ok(mine, "the sweep did not visit the room");
    assert.deepEqual(mine.dropped, ["ghost-viewer"]);
    assert.equal(mine.ended, false, "losing a viewer must not end a stream");

    const back = readRoom(rec.id);
    assert.ok(back);
    assert.equal(back.state, "live");
    assert.deepEqual(back.participants.map((p) => p.user), ["hosta"]);
  });

  it("a room whose HOST went stale is over; a call losing either seat is over", () => {
    const hostStale = createRoom({
      kind: "stream",
      host: "hosta",
      participants: [newParticipant("hosta", "host")],
      stream: { title: "t", chat: [], thumbnailAt: null, hasThumbnail: false },
    });
    const call = createRoom({
      kind: "call",
      host: "caller",
      participants: [newParticipant("caller", "host"), newParticipant("callee", "participant")],
      call: null,
    });
    const stale = new Date(Date.now() - MEDIA_TIMING.participantTimeoutMs - 10_000).toISOString();
    mutateRoom(hostStale.id, (r) => {
      r.participants[0].heartbeatAt = stale;
    });
    mutateRoom(call.id, (r) => {
      const callee = r.participants.find((p) => p.user === "callee");
      assert.ok(callee);
      callee.heartbeatAt = stale;
    });

    sweepRooms();

    const s = readRoom(hostStale.id);
    assert.ok(s);
    assert.equal(s.state, "ended", "a hostless stream must end");
    const c = readRoom(call.id);
    assert.ok(c);
    assert.equal(c.state, "ended", "a call is exactly two seats — losing either ends it");
  });

  it("lock discipline: two REAL processes append 12 seats each over one root, 24 land", async () => {
    const rec = createRoom({
      kind: "stream",
      host: "hosta",
      participants: [newParticipant("hosta", "host")],
      stream: { title: "contended", chat: [], thumbnailAt: null, hasThumbnail: false },
    });

    const roomStoreUrl = pathToFileURL(path.join(moduleDir, "lib", "roomStore.ts")).href;
    const hookUrl = pathToFileURL(path.join(studioDir, "test", "alias-hook.mjs")).href;
    const APPENDS = 12;

    const writer = (tag: string): Promise<void> => {
      const code = [
        `import { mutateRoom, newParticipant } from ${JSON.stringify(roomStoreUrl)};`,
        `for (let i = 0; i < ${APPENDS}; i += 1) {`,
        `  const r = mutateRoom(${JSON.stringify(rec.id)}, (room) => {`,
        `    room.participants.push(newParticipant(${JSON.stringify(tag)} + "-" + i, "viewer"));`,
        `  });`,
        `  if (!r) { console.error("room vanished"); process.exit(2); }`,
        `}`,
      ].join("\n");
      return new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", hookUrl, "--input-type=module", "-e", code],
          { env: { ...process.env, AMBERXVID_DATA_DIR: root }, stdio: ["ignore", "ignore", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
        child.on("error", reject);
        child.on("exit", (exitCode) => {
          if (exitCode === 0) resolve();
          else reject(new Error(`writer ${tag} exited ${exitCode}:\n${stderr}`));
        });
      });
    };

    await Promise.all([writer("proc-a"), writer("proc-b")]);

    const back = readRoom(rec.id);
    assert.ok(back);
    const viewers = back.participants.filter((p) => p.role === "viewer").map((p) => p.user);
    assert.equal(
      viewers.length,
      APPENDS * 2,
      `lost updates: ${APPENDS * 2 - viewers.length} of ${APPENDS * 2} appends vanished — the ` +
        `whole read-modify-write must run under the lock, never just the save`,
    );
    for (const tag of ["proc-a", "proc-b"]) {
      for (let i = 0; i < APPENDS; i += 1) {
        assert.ok(viewers.includes(`${tag}-${i}`), `missing seat ${tag}-${i}`);
      }
    }
  });

  it("a lock left by a dead process is broken, not waited on forever", () => {
    const rec = createRoom({
      kind: "stream",
      host: "hosta",
      participants: [newParticipant("hosta", "host")],
      stream: { title: "t", chat: [], thumbnailAt: null, hasThumbnail: false },
    });
    // A writer died holding the room's lock 15s ago (LOCK_STALE_MS is 10s).
    fs.mkdirSync(locksDir(), { recursive: true });
    const lock = path.join(locksDir(), `room-${rec.id}.lock`);
    fs.writeFileSync(lock, "99999 dead-process\n");
    const past = new Date(Date.now() - 15_000);
    fs.utimesSync(lock, past, past);

    const out = mutateRoom(rec.id, (r) => {
      r.participants.push(newParticipant("late-viewer", "viewer"));
      return r.participants.length;
    });
    assert.ok(out, "the stale lock wedged the store");
    assert.equal(out.value, 2);
  });
});

/* ------------------------------- 3. the outbox ----------------------------------- */

const ring = (callId: string, to: string): CrossProcessEvent => ({
  kind: "ring",
  callId,
  from: "caller",
  to,
  at: new Date().toISOString(),
});

describe("outbox: process A writes, process B drains, exactly once and in order", () => {
  it("delivers exactly once, ordering preserved, then the queue is empty", () => {
    ensureQueue("dave");
    const COUNT = 8;
    for (let i = 0; i < COUNT; i += 1) enqueue("dave", "proc-b", ring(`ring-${i}`, "dave"));

    const seen: string[] = [];
    const first = drain("dave", "proc-b", (event) => {
      if (event.kind === "ring") seen.push(event.callId);
    });
    assert.equal(first.delivered, COUNT);
    assert.equal(first.expired, 0);
    assert.deepEqual(seen, Array.from({ length: COUNT }, (_, i) => `ring-${i}`), "delivery order broke");

    const second = drain("dave", "proc-b", () => assert.fail("a drained event was re-delivered"));
    assert.deepEqual(second, { delivered: 0, expired: 0 });
  });

  it("holder addressing: another process's events are not ours to take", () => {
    ensureQueue("erin");
    enqueue("erin", "proc-x", ring("ring-x", "erin"));
    enqueue("erin", null, ring("ring-anyone", "erin"));

    const wrongHolder: string[] = [];
    const y = drain("erin", "proc-y", (e) => {
      if (e.kind === "ring") wrongHolder.push(e.callId);
    });
    // proc-y takes only the unaddressed event; proc-x's stays queued.
    assert.equal(y.delivered, 1);
    assert.deepEqual(wrongHolder, ["ring-anyone"]);

    const rightHolder: string[] = [];
    const x = drain("erin", "proc-x", (e) => {
      if (e.kind === "ring") rightHolder.push(e.callId);
    });
    assert.equal(x.delivered, 1);
    assert.deepEqual(rightHolder, ["ring-x"]);
  });

  it("TTL expiry deletes an undelivered event without delivering it", () => {
    ensureQueue("frank");
    enqueue("frank", "proc-b", ring("stale-ring", "frank"));

    // The event has been sitting undelivered past outboxTtlMs — a ring that
    // arrives that late is worse than none.
    const dir = path.join(outboxDir(), "frank");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1);
    const file = path.join(dir, files[0]);
    const rec = JSON.parse(fs.readFileSync(file, "utf8")) as { at: string };
    rec.at = new Date(Date.now() - MEDIA_TIMING.outboxTtlMs - 15_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(rec), "utf8");

    const out = drain("frank", "proc-b", () => assert.fail("an expired event was delivered"));
    assert.deepEqual(out, { delivered: 0, expired: 1 });
    assert.deepEqual(fs.readdirSync(dir), [], "the expired file must be cleaned up");
  });
});

/* --------------- 4. P4 authorisation refusals at the media server door ------------ */

/**
 * A stand-in mediasoup worker: enough surface for room creation and every
 * AUTHORISATION path, and a hard throw the moment anything asks for real
 * media. The refusals under test must all fire BEFORE that line — the point
 * of server-side authorisation is that an unauthorised request never reaches
 * the media plane at all.
 */
function fakeWorker(): Worker {
  let routers = 0;
  return {
    pid: 424242,
    createRouter: async () => ({
      id: `fake-router-${(routers += 1)}`,
      rtpCapabilities: { codecs: [], headerExtensions: [] },
      close: () => {},
      on: () => {},
      canConsume: () => false,
      createWebRtcTransport: async () => {
        throw new Error("this test must never reach real transport creation");
      },
    }),
  } as unknown as Worker;
}

const config: MediaConfig = {
  port: 0,
  announcedIp: "127.0.0.1",
  rtcMinPort: 40000,
  rtcMaxPort: 40100,
  dev: true,
};

describe("media server door: server-side authorisation, no mediasoup process", () => {
  const registry = new RoomRegistry([fakeWorker()], config);
  let closeHttp: (() => Promise<void>) | null = null;
  let port = 0;
  const open: WebSocket[] = [];
  let nextId = 1;

  after(async () => {
    for (const ws of open) {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    await closeHttp?.();
    registry.closeAll();
  });

  async function connect(): Promise<WebSocket> {
    if (!closeHttp) {
      const handle = await startMediaHttp({
        registry,
        port: 0,
        info: () => ({ workers: 1, mediasoupVersion: "none (P12 fake)" }),
        log: () => {},
      });
      closeHttp = handle.close;
      port = (handle.server.address() as AddressInfo).port;
    }
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("ws did not open")), { once: true });
    });
    open.push(ws);
    return ws;
  }

  function request(ws: WebSocket, msg: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${String(msg.type)}`)), 5_000);
      const onMessage = (ev: MessageEvent): void => {
        const parsed = JSON.parse(String(ev.data)) as Record<string, unknown>;
        if (parsed.id !== id) return;
        ws.removeEventListener("message", onMessage);
        clearTimeout(timer);
        resolve(parsed);
      };
      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  it("a socket that never joined may not consume — or anything else", async () => {
    const ws = await connect();
    const consumed = await request(ws, { type: "consume", transportId: "t1", producerId: "p1", rtpCapabilities: {} });
    assert.deepEqual(
      { ok: consumed.ok, failure: consumed.failure },
      { ok: false, failure: "token-rejected" },
      "an anonymous socket consumed — the never-joined hole is open",
    );
    const produced = await request(ws, { type: "produce", transportId: "t1", kind: "video", rtpParameters: {} });
    assert.equal(produced.ok, false);
    assert.equal(produced.failure, "token-rejected");
  });

  it("a viewer may not produce in a stream room — publish-denied at both layers", async () => {
    const ws = await connect();
    const token = mintMediaToken({ sub: "vera", room: "aaaa1111-view-room", role: "viewer" }, TEST_SECRET);
    const joined = await request(ws, { type: "join", token });
    assert.equal(joined.ok, true, `viewer join failed: ${JSON.stringify(joined)}`);
    assert.equal(joined.role, "viewer");
    assert.equal(joined.canPublish, false, "the door told a viewer it can publish");

    const produced = await request(ws, { type: "produce", transportId: "t1", kind: "video", rtpParameters: {} });
    assert.deepEqual(
      { ok: produced.ok, failure: produced.failure },
      { ok: false, failure: "publish-denied" },
      "a viewer produced into a stream room",
    );
    const sendTransport = await request(ws, { type: "create-transport", direction: "send" });
    assert.deepEqual(
      { ok: sendTransport.ok, failure: sendTransport.failure },
      { ok: false, failure: "publish-denied" },
      "a viewer was handed a SEND transport",
    );

    // The same rule, straight at the registry (the matrix is ONE authority):
    const room = registry.getRoom("aaaa1111-view-room");
    assert.ok(room);
    const seat = room.participants.get(String(joined.participantId));
    assert.ok(seat);
    await assert.rejects(
      registry.produce(room, seat, "t1", "video", {} as never),
      (err: unknown) => err instanceof MediaError && err.failure === "publish-denied",
    );
    assert.equal(ROLE_RULES.viewer.canPublish, false);
    assert.equal(ROLE_RULES.preview.canPublish, false);
  });

  it("a token for room A is refused in room B", async () => {
    // Splice attack at the door: a room-a token edited to say room-b.
    const ws = await connect();
    const tokenA = mintMediaToken({ sub: "neo", room: "room-aaaa-1111", role: "participant" }, TEST_SECRET);
    const spliced = tokenA.replace(":room-aaaa-1111:", ":room-bbbb-2222:");
    const refused = await request(ws, { type: "join", token: spliced });
    assert.deepEqual(
      { ok: refused.ok, failure: refused.failure },
      { ok: false, failure: "token-rejected" },
      "a re-roomed token was seated",
    );

    // And the door's room comes from the TOKEN, never from the client: a join
    // that claims roomId room-b while presenting a room-a token lands in room a.
    const ws2 = await connect();
    const joined = await request(ws2, { type: "join", token: tokenA, roomId: "room-bbbb-2222" });
    assert.equal(joined.ok, true);
    assert.equal(
      joined.roomId,
      "room-aaaa-1111",
      "the door believed a client-sent roomId over the token's claim",
    );
    assert.equal(registry.getRoom("room-bbbb-2222"), undefined, "room B must not even exist");
  });

  it("/health answers honestly with zero mediasoup behind it", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const health = (await res.json()) as Record<string, unknown>;
    assert.equal(health.ok, true);
    assert.equal(health.service, "amberxvid-media-server");
    assert.equal(typeof health.rooms, "number");
  });
});

/* ------------------- 5. the MediaFailure union, handled exhaustively -------------- */

describe("MediaFailure: a closed vocabulary, mapped exhaustively", () => {
  /**
   * The union, re-walked by a switch with NO default. The compile-time gate
   * for the SOURCE maps is their `as const satisfies Record<MediaFailure, …>`
   * clauses (pinned below — tsconfig does not include test/, so a gate in this
   * file alone would enforce nothing under `tsc --noEmit`). This switch makes
   * the same demand at RUNTIME: `Object.keys(MEDIA_FAILURE_MEANING)` walks the
   * real union, and a reason this switch does not handle lands in `unhandled`
   * and fails the test until it is added here too.
   */
  function userSentenceFor(failure: MediaFailure): string {
    switch (failure) {
      case "server-unreachable":
      case "token-rejected":
      case "room-full":
      case "transport-failed":
      case "publish-denied":
      case "recording-failed":
        return MEDIA_FAILURE_USER_COPY[failure];
    }
    return unhandled(failure);
  }

  function unhandled(x: never): never {
    throw new Error(`MediaFailure reason ${String(x)} is not handled — add it to every map AND this switch`);
  }

  const EVERY_FAILURE = Object.keys(MEDIA_FAILURE_MEANING) as MediaFailure[];

  it("every reason has a meaning, a user sentence and an HTTP status — and nothing extra", () => {
    assert.equal(EVERY_FAILURE.length, 6);
    assert.deepEqual(Object.keys(MEDIA_FAILURE_USER_COPY).sort(), [...EVERY_FAILURE].sort());
    assert.deepEqual(Object.keys(MEDIA_FAILURE_STATUS).sort(), [...EVERY_FAILURE].sort());
    for (const failure of EVERY_FAILURE) {
      assert.equal(userSentenceFor(failure), MEDIA_FAILURE_USER_COPY[failure]);
      assert.ok(MEDIA_FAILURE_MEANING[failure].length > 20, `${failure} has no real meaning text`);
      assert.ok(MEDIA_FAILURE_USER_COPY[failure].length > 20, `${failure} has no real user copy`);
      const status = MEDIA_FAILURE_STATUS[failure];
      assert.ok(status >= 400 && status < 600, `${failure} maps to a non-error status ${status}`);
    }
    // Six reasons, six distinct product sentences — one wording per failure.
    assert.equal(new Set(Object.values(MEDIA_FAILURE_USER_COPY)).size, EVERY_FAILURE.length);
  });

  it("failureCopy speaks the closed vocabulary and falls back honestly", () => {
    for (const failure of EVERY_FAILURE) {
      assert.equal(failureCopy(new MediaApiError("raw wire text", failure)), MEDIA_FAILURE_USER_COPY[failure]);
    }
    assert.equal(failureCopy(new Error("boom")), "boom");
    assert.equal(failureCopy(undefined), "the media service did not answer");
  });

  it("source pin: the compile-time exhaustiveness gate exists where tsc can see it", () => {
    // `tsc --noEmit` covers src/** and app/**, not test/** — so the clause that
    // makes 'adding a reason fails compilation until it is handled' TRUE must
    // live in the source maps. Pin all three.
    const contract = fs.readFileSync(path.join(moduleDir, "lib", "mediaContract.ts"), "utf8");
    const bridge = fs.readFileSync(path.join(moduleDir, "lib", "mediaBridge.ts"), "utf8");
    const satisfies = /as const satisfies Record<MediaFailure, string>/g;
    assert.equal(
      (contract.match(satisfies) ?? []).length >= 2,
      true,
      "MEDIA_FAILURE_MEANING / MEDIA_FAILURE_USER_COPY lost their satisfies clause — a new reason would compile unmapped",
    );
    assert.match(
      bridge,
      /satisfies Record<MediaFailure, number>/,
      "MEDIA_FAILURE_STATUS lost its satisfies clause — a new reason would ride the wire with no status",
    );
  });
});
