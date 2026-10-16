/**
 * @file The AmberX Vid media server — process entry.
 *
 *     npm --prefix packages/studio run media
 *     # or: AMBERXVID_MEDIA_DEV=1 AMBERXVID_MEDIA_SECRET=... node --import ./test/alias-hook.mjs \
 *     #       src/modules/amberxvid/media-server/index.ts
 *
 * A sidecar, and deliberately the SAME KIND of sidecar this module already
 * runs: `service/__main__.py` is the tray recorder, and its lifecycle posture is
 * mirrored here rather than reinvented —
 *
 *   - **start** boots its state, then announces itself once, with its pid;
 *   - **health** is a heartbeat something else can read without asking a human
 *     (there it is `tray/status.json`; here it is `GET /health`);
 *   - **graceful stop** finalises work in flight and reports a CLEAN exit — the
 *     tray writes `pid: null` so a reader can tell "stopped" from "crashed";
 *     this process closes every room and every worker before exiting 0;
 *   - **`--once`** boots, reports one health document as JSON, stops, exits.
 *     The tray service has exactly this flag for exactly this reason: it is how
 *     you check the thing works without leaving anything running.
 *
 * ── running TypeScript with no build step ───────────────────────────────────
 *
 * This is a plain Node process, not a Next route, so it runs the `.ts` files
 * directly: Node strips the types, and `test/alias-hook.mjs` teaches the loader
 * the bundler-style extensionless relative imports the rest of this package
 * uses (the same trick `npm test` and `check:rolls` already run on). One
 * consequence binds every file in this directory — **strip-only mode rejects
 * TypeScript that has runtime meaning**: no enums, no namespaces, and no
 * constructor parameter properties (`constructor(private readonly x: T)`),
 * which is why the classes here declare their fields and assign them. It is a
 * runtime error at import, not a type error, so `tsc --noEmit` will not catch
 * a reintroduction — `npm run media -- --once` will.
 *
 * ── the orphan trap ─────────────────────────────────────────────────────────
 *
 * `src/server/claudeBroker.ts` documents this trap for spawned children on
 * win32, and it applies to mediasoup workers exactly: every `createWorker()`
 * spawns a real `mediasoup-worker.exe` child, so a media server that exits
 * without closing them leaves N orphaned processes each holding a slice of the
 * RTC port range — the same shape as that file's "a CLI left running after the
 * user hits stop is a cost leak with no UI".
 *
 * The broker's lesson is the important half, and it is a warning against
 * assuming: its kill cascade works *because of the spawn options it uses*, not
 * because Windows guarantees anything. **We do not own this spawn** — mediasoup
 * does — so that cascade cannot be assumed here at all. Three layers instead,
 * outermost last:
 *
 *   1. `shutdown()` closes every worker explicitly, and it is the ONE exit path
 *      — signals, `--once`, a dead worker and a failed boot all route through
 *      it, so there is a single function to check rather than five.
 *   2. `process.on("exit")` closes them again, synchronously, as a last-ditch
 *      net for a path that reached exit without calling `shutdown()`.
 *   3. The backstop for what neither can catch: on win32 an external
 *      `process.kill()` or `taskkill /F` is a `TerminateProcess` — no handler
 *      runs, and no amount of care in this file changes that. What saves it is
 *      that a mediasoup worker exits when its channel pipes to the parent
 *      close. That is a property of mediasoup, not of this code, so it is
 *      VERIFIED rather than trusted: the P2 evidence hard-kills this process
 *      mid-call and shows the process table empty of workers afterwards.
 *
 * Nothing here is spawned `detached`, and nothing is given its own console —
 * the two changes the broker names as what would bring the leak back.
 */

import os from "node:os";

import * as mediasoup from "mediasoup";
import type { Worker } from "mediasoup/types";

import { CAPACITY, MEDIA_CONTRACT } from "../lib/mediaContract";
import { recoverServerRecordings } from "../lib/recordings";
import { startMediaHttp, type MediaHttpHandle } from "./http";
import { RoomRegistry, mediaConfig, type MediaConfig } from "./rooms";
import { mediaSecret } from "./tokens";

/**
 * The worker-pool ceiling, and the arithmetic behind it.
 *
 * mediasoup's own rule is one worker per core: a worker is single-threaded and
 * pinned to roughly one core. "Sized to cores" is therefore the rule — but
 * `CAPACITY.roomsPerWorker` is 4, so 4 workers already buys 16 concurrent
 * rooms, which at `participantsPerRoom` is 128 publishing seats, or 16
 * simultaneous streams at `viewersPerStream` each. That is an order of
 * magnitude past this suite's roster, and every worker past the ceiling is an
 * idle child process holding memory for rooms that will never exist. So the
 * pool is `min(cores, 4)` — genuinely sized to cores on the 2-core VPS, and
 * not 24 processes on a developer's workstation.
 */
const MAX_WORKERS = 4;

function workerCount(): number {
  return Math.max(1, Math.min(os.availableParallelism(), MAX_WORKERS));
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function makeLog(): (msg: string) => void {
  return (msg: string) => console.log(`[media ${stamp()}] ${msg}`);
}

export interface MediaServerHandle {
  registry: RoomRegistry;
  workers: Worker[];
  http: MediaHttpHandle;
  config: MediaConfig;
  port: number;
  /** Idempotent. Closes rooms, then workers, then the listener. */
  stop: () => Promise<void>;
  health: () => Promise<Record<string, unknown>>;
}

/**
 * Boot the whole thing: worker pool, room registry, HTTP/WS listener.
 *
 * Exported rather than kept private to `main()` so the graceful shutdown path
 * is testable in-process. On win32 an external signal cannot reach a handler at
 * all (see the orphan trap above), so a proof that drives `stop()` directly is
 * the only way to watch the graceful path actually run — and it is the path the
 * VPS uses, where signals are real.
 */
export async function startMediaServer(): Promise<MediaServerHandle> {
  const log = makeLog();
  // Refuses here, at start, if the announced IP is missing — or resolves to a
  // loopback/private address (P9) — outside dev.
  const config = mediaConfig();

  if (!mediaSecret()) {
    // The turn.ts honesty posture: an unconfigured media plane says so at the
    // top of the log rather than accepting joins it will refuse one by one.
    log("WARNING: AMBERXVID_MEDIA_SECRET is unset — every join will be refused as 'server-unreachable'.");
  }

  const count = workerCount();
  const workers: Worker[] = [];
  let stopping = false;

  /** The ONE exit path. Idempotent; safe to call from a signal, from a dead
   *  worker, and from a failed boot. */
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log("shutting down…");
    // Recordings first, AWAITED: stop() must let each ffmpeg child quit and
    // each manifest finalize before the rooms (and their routers) go away —
    // the graceful half of the recorder's orphan discipline (P10).
    try {
      await registry.stopAllRecordings();
    } catch (err) {
      log(`recording stop threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      registry.closeAll();
    } catch (err) {
      log(`registry close threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const worker of workers) {
      try {
        if (!worker.closed) worker.close();
      } catch (err) {
        log(`worker close threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      await http?.close();
    } catch (err) {
      log(`listener close threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    log(`stopped cleanly — ${workers.length} worker(s) closed`);
  };

  const registry = new RoomRegistry(workers, config, log);

  for (let i = 0; i < count; i += 1) {
    const worker = await mediasoup.createWorker({
      // `MEDIA_ENV.AMBERXVID_MEDIA_DEV`: verbose worker logging in dev.
      logLevel: config.dev ? "debug" : "warn",
      logTags: config.dev
        ? ["info", "ice", "dtls", "rtp", "srtp", "rtcp", "bwe", "score", "simulcast", "svc"]
        : ["ice", "dtls"],
      rtcMinPort: config.rtcMinPort,
      rtcMaxPort: config.rtcMaxPort,
    });
    // A dead worker is unrecoverable by mediasoup's own contract — its routers
    // are gone with it. Take the whole process down rather than serving a pool
    // that silently lost a quarter of its capacity.
    worker.on("died", (error: Error) => {
      log(`FATAL: worker ${worker.pid} died: ${error.message}`);
      void stop().then(() => process.exit(1));
    });
    workers.push(worker);
  }
  log(`${workers.length} worker(s) up — pids ${workers.map((w) => w.pid).join(", ")}`);

  registry.startSweeper();

  // P10 boot recovery: a previous media server that died mid-recording left a
  // playable file (the WebM crash-tolerance promise) under a manifest still
  // open. Close each one honestly before serving — counted, never silent.
  try {
    const recovered = await recoverServerRecordings();
    if (recovered > 0) log(`recovered ${recovered} interrupted server recording(s) from a previous run`);
  } catch (err) {
    log(`recording recovery threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  const http = await startMediaHttp({
    registry,
    port: config.port,
    info: () => ({ workers: workers.length, mediasoupVersion: mediasoup.version }),
    log,
  });

  const health = async (): Promise<Record<string, unknown>> => {
    const res = await fetch(`http://127.0.0.1:${config.port}/health`);
    return (await res.json()) as Record<string, unknown>;
  };

  log(
    `listening on http://127.0.0.1:${config.port} — /health and ws://…/ws · announcing ${config.announcedIp} · rtc ${config.rtcMinPort}-${config.rtcMaxPort} · mediasoup ${mediasoup.version} · contract v${MEDIA_CONTRACT.version} · ${CAPACITY.roomsPerWorker} rooms/worker`,
  );

  return { registry, workers, http, config, port: config.port, stop, health };
}

/* ------------------------------- process entry -------------------------------- */

/** True when this module was run as the process entry rather than imported. */
function isEntry(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.replace(/\\/g, "/").endsWith("media-server/index.ts");
}

async function main(): Promise<void> {
  const log = makeLog();
  const once = process.argv.includes("--once");

  let handle: MediaServerHandle;
  try {
    handle = await startMediaServer();
  } catch (err) {
    log(`FATAL: could not start — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Layer 2 of the orphan trap: synchronous, last-ditch, runs on every exit
  // path including one that skipped `stop()`. Recorders first — an ffmpeg
  // child is exactly the leak the P10 discipline exists to forbid.
  process.on("exit", () => {
    try {
      handle.registry.killRecordersNow();
    } catch {
      /* exiting anyway */
    }
    for (const worker of handle.workers) {
      try {
        if (!worker.closed) worker.close();
      } catch {
        /* exiting anyway */
      }
    }
  });

  if (once) {
    const health = await handle.health();
    await handle.stop();
    console.log(JSON.stringify(health, null, 2));
    process.exit(0);
  }

  let signalled = false;
  const bye = (signal: string) => {
    if (signalled) return;
    signalled = true;
    log(`${signal} received`);
    void handle.stop().then(() => process.exit(0));
  };
  // SIGTERM/SIGHUP are the real mechanism on the VPS. On win32 they can be
  // listened for but are never delivered — see the orphan trap's layer 3.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
    process.on(signal, () => bye(signal));
  }
  process.on("uncaughtException", (err) => {
    log(`FATAL: uncaught — ${err.stack ?? err.message}`);
    void handle.stop().then(() => process.exit(1));
  });
}

if (isEntry()) {
  void main();
}
