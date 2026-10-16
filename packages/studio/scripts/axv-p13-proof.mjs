/**
 * axv-p13-proof.mjs — P13: the real-browser proof. Every phase before this
 * one is a claim until this file has run.
 *
 * Topology it stands up (then tears down):
 *   - the mediasoup media server on :3215 (spawned as a killable child — the
 *     FAILURE leg hard-kills and restarts it mid-stream);
 *   - app PROCESS A on :3217 and app PROCESS B on :3218 — two instances of
 *     axv-p13-proof-server.mjs sharing ONE scratch AMBERXVID_DATA_DIR, one
 *     AMBERXVID_AUTH_SECRET and one AMBERXVID_MEDIA_SECRET (UI proxied to the
 *     long-running :3200 dev server, API served from the real route handlers);
 *   - four real Chromium instances: alice + dave on A, bob + carol on B.
 *
 * What it proves, in the step's own order:
 *   1. 1:1 CALL — alice (A) calls bob (B): camera both ways, server-known
 *      mute seen from the far side, clean hangup; screenshots each state.
 *   2. CROSS-PROCESS RING — alice's session lives on process A, bob's
 *      presence SSE on process B; bob's window must RING — audibly, which
 *      headless automation asserts as: the WebAudio ring path really played
 *      (OscillatorNode.start called by the ring loop, AudioContext state
 *      recorded). The v0.1.0 gap made into a gate.
 *   3. THE MEASUREMENT — alice hosts a stream; host outbound video bitrate
 *      from getStats at 0, 1 and 3 viewers. 1 vs 3 within noise or fail.
 *   4. FAILURE — the media server is HARD-killed mid-stream (recording live):
 *      both sides must show the specific server-unreachable message;
 *      restarting it must let the room reconnect (bytes flow again).
 *   5. RECORDING — the recording the kill ended ABRUPTLY is finalized by
 *      boot recovery on restart and must PLAY from the Library UI.
 *
 * Run from packages/studio (plain node; children get the alias hook):
 *   node scripts/axv-p13-proof.mjs
 *
 * Artifacts → logs/build/axf-amberxvid-client-server/ :
 *   p13-*.png screenshots, p13-proof-transcript.txt, p13-summary.json,
 *   p13-media-server.log, p13-sidecar-a.log, p13-sidecar-b.log
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const STUDIO = process.cwd();
const AMBERX_ROOT = path.resolve(STUDIO, "..", "..");
const LOGS = process.env.AXV_P13_SHOTS
  || path.join(AMBERX_ROOT, "logs", "build", "axf-amberxvid-client-server");
fs.mkdirSync(LOGS, { recursive: true });

const MEDIA_PORT = 3215;
const PORT_A = 3217;
const PORT_B = 3218;
const BASE_A = `http://localhost:${PORT_A}`;
const BASE_B = `http://localhost:${PORT_B}`;
const FFMPEG = "C:/Home/Projects/GizmoX/node_modules/ffmpeg-static/ffmpeg.exe";

const transcript = [];
const summary = { startedAt: new Date().toISOString() };
const log = (msg) => {
  const line = `[p13 ${new Date().toISOString().slice(11, 23)}] ${msg}`;
  transcript.push(line);
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const el = (id) => `[data-el-id="${id}"]`;

const children = [];
const browsers = [];
let failed = null;

function flushArtifacts() {
  fs.writeFileSync(path.join(LOGS, "p13-proof-transcript.txt"), `${transcript.join("\n")}\n`, "utf8");
  fs.writeFileSync(path.join(LOGS, "p13-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}
async function teardown() {
  for (const b of browsers) await b.close().catch(() => {});
  for (const c of children) if (c && c.exitCode === null) c.kill();
  flushArtifacts();
}
function fail(msg) {
  failed = msg;
  transcript.push(`[p13] FAIL: ${msg}`);
  console.error(`[p13] FAIL: ${msg}`);
  void teardown().then(() => process.exit(1));
  // give teardown a beat, then hard-exit either way
  setTimeout(() => process.exit(1), 15_000).unref();
  throw new Error(msg);
}

/* ----------------------------- shared environment ----------------------------- */

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "axv-p13-"));
const AUTH_SECRET = crypto.randomBytes(24).toString("hex");
const MEDIA_SECRET = crypto.randomBytes(24).toString("hex");
const SHARED_ENV = {
  ...process.env,
  AMBERXVID_DATA_DIR: DATA_ROOT,
  AMBERXVID_AUTH_SECRET: AUTH_SECRET,
  AMBERXVID_MEDIA_SECRET: MEDIA_SECRET,
  AMBERXVID_MEDIA_DEV: "1",
  AMBERXVID_MEDIA_PORT: String(MEDIA_PORT),
  AMBERXVID_FFMPEG: FFMPEG,
  AMBERXVID_SILENT_JOURNAL: "1",
};
summary.env = {
  AMBERXVID_DATA_DIR: DATA_ROOT,
  AMBERXVID_MEDIA_DEV: "1",
  AMBERXVID_MEDIA_PORT: String(MEDIA_PORT),
  AMBERXVID_FFMPEG: FFMPEG,
  AMBERXVID_AUTH_SECRET: "<random 48 hex>",
  AMBERXVID_MEDIA_SECRET: "<random 48 hex, shared app<->media>",
};
summary.ports = { media: MEDIA_PORT, processA: PORT_A, processB: PORT_B, devServerUi: 3200, rtcRange: "40000-40100" };
log(`scratch data root ${DATA_ROOT}`);

/* ------------------------------ process management ----------------------------- */

function spawnLogged(args, logFile, extraEnv = {}) {
  const out = fs.createWriteStream(path.join(LOGS, logFile), { flags: "a" });
  const child = spawn(process.execPath, args, {
    cwd: STUDIO,
    env: { ...SHARED_ENV, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  children.push(child);
  return child;
}

async function waitHttp(url, label, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return res;
    } catch {
      /* not yet */
    }
    if (Date.now() - t0 > timeoutMs) fail(`${label} did not answer at ${url} within ${timeoutMs}ms`);
    await sleep(300);
  }
}

let mediaChild = null;
async function startMediaServer(phase) {
  mediaChild = spawnLogged(
    ["--import", "./test/alias-hook.mjs", "src/modules/amberxvid/media-server/index.ts"],
    "p13-media-server.log",
  );
  const res = await waitHttp(`http://127.0.0.1:${MEDIA_PORT}/health`, "media server");
  const health = await res.json();
  log(`media server up (${phase}): pid ${mediaChild.pid}, workers ${health.workers}, mediasoup ${health.mediasoupVersion}`);
  return health;
}

const mediaHealth = () =>
  fetch(`http://127.0.0.1:${MEDIA_PORT}/health`).then((r) => r.json());

/* --------------------------------- browsers --------------------------------- */

/** A browser per ACCOUNT, pinned to ONE app process. WebAudio is instrumented
 *  before any page script runs, so the ring's oscillator starts are counted —
 *  the closest automation gets to "rings audibly". */
async function launchAs(user, base, viewport = { width: 1440, height: 900 }) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  browsers.push(browser);
  const context = await browser.newContext({ viewport });
  await context.grantPermissions(["camera", "microphone"], { origin: base });
  await context.addInitScript(() => {
    window.__axvBeeps = { oscStarts: 0, ctxCreated: 0, lastCtxState: "none" };
    const OrigStart = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...a) {
      window.__axvBeeps.oscStarts += 1;
      window.__axvBeeps.lastCtxState = this.context?.state ?? "unknown";
      return OrigStart.apply(this, a);
    };
    const OrigAC = window.AudioContext;
    window.AudioContext = class extends OrigAC {
      constructor(...a) {
        super(...a);
        window.__axvBeeps.ctxCreated += 1;
      }
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => log(`${user} pageerror: ${err.message}`));
  const signin = await page.goto(`${base}/__proof/signin?u=${user}`);
  if (!signin?.ok()) fail(`${user} signin endpoint answered ${signin?.status()}`);
  const { token } = await signin.json();
  await page.goto(`${base}/amberxvid`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(el("amberxvid:banner"), { timeout: 120_000 });
  log(`${user}: signed in on ${base} (process ${base === BASE_A ? "A" : "B"}), /amberxvid booted`);
  return { user, base, browser, page, token };
}

async function waitRemoteFrames(page, who, minFrames = 5) {
  await page.waitForFunction(
    (min) => {
      const v = [...document.querySelectorAll("video")].find((x) => !x.muted);
      if (!v || v.videoWidth === 0) return false;
      const q = v.getVideoPlaybackQuality?.();
      return (q ? q.totalVideoFrames : 0) >= min;
    },
    minFrames,
    { timeout: 90_000 },
  );
  const stats = await page.evaluate(() => {
    const v = [...document.querySelectorAll("video")].find((x) => !x.muted);
    const q = v.getVideoPlaybackQuality?.();
    return { w: v.videoWidth, h: v.videoHeight, frames: q?.totalVideoFrames ?? -1 };
  });
  log(`${who}: REMOTE video ${stats.w}x${stats.h}, ${stats.frames} frames decoded`);
  return stats;
}

/** Sum of the host's outbound-rtp video bytesSent across simulcast layers. */
async function hostStats(page) {
  const layers = await page.evaluate(async () => await window.__axvHostVideoStats?.());
  if (!layers || layers.length === 0) fail("host stats hook returned nothing — is the host producing?");
  let bytes = 0;
  let ts = 0;
  for (const l of layers) {
    bytes += l.bytesSent ?? 0;
    ts = Math.max(ts, l.timestamp ?? 0);
  }
  return { layers, bytes, ts };
}

async function measureUplink(page, ms, label) {
  const a = await hostStats(page);
  await sleep(ms);
  const b = await hostStats(page);
  const kbps = Math.round(((b.bytes - a.bytes) * 8) / ((b.ts - a.ts) / 1000) / 1000);
  const perLayer = b.layers.map((l) => {
    const before = a.layers.find((x) => x.rid === l.rid);
    const kb = before ? Math.round(((l.bytesSent - before.bytesSent) * 8) / ((b.ts - a.ts) / 1000) / 1000) : -1;
    return `${l.rid}:${kb}kbps`;
  });
  log(`MEASURE ${label}: host outbound video ${kbps} kbps (${perLayer.join(" ")}) over ${Math.round(b.ts - a.ts)}ms`);
  return { kbps, perLayer: perLayer.join(" ") };
}

const apiAs = (side, pathname, init = {}) =>
  fetch(`${side.base}${pathname}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: `axs_session=${side.token}` },
  }).then((r) => r.json());

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(LOGS, name) });
  log(`screenshot ${name}`);
};

/* =============================== the run =============================== */

try {
  /* --- stand the world up --- */
  const bootHealth = await startMediaServer("initial boot");
  summary.mediasoup = { version: bootHealth.mediasoupVersion, workers: bootHealth.workers, workerOrigin: "prebuilt download (npm postinstall, win32-x64) — P2 evidence, re-confirmed running here" };

  spawnLogged(["--import", "./test/alias-hook.mjs", "scripts/axv-p13-proof-server.mjs"], "p13-sidecar-a.log", { AXV_PROOF_PORT: String(PORT_A), AXV_PROOF_SEED: "1" });
  await waitHttp(`${BASE_A}/__proof/ready`, "app process A");
  spawnLogged(["--import", "./test/alias-hook.mjs", "scripts/axv-p13-proof-server.mjs"], "p13-sidecar-b.log", { AXV_PROOF_PORT: String(PORT_B) });
  await waitHttp(`${BASE_B}/__proof/ready`, "app process B");
  log(`TWO app processes up against one data root: A=:${PORT_A} (seeded), B=:${PORT_B}`);

  /* --- (1)+(2): 1:1 call with the ring crossing processes --- */
  // bob boots FIRST on process B, so his presence SSE is held by B before
  // alice (on A) rings him — the exact v0.1.0 failure case.
  const bob = await launchAs("bob", BASE_B);
  const alice = await launchAs("alice", BASE_A);

  await alice.page.click(el("amberxvid:toolbar:messenger"));
  await alice.page.waitForSelector(el("amberxvid:messenger:buddy:bob"), { timeout: 30_000 });
  await alice.page.click(el("amberxvid:messenger:buddy:bob"));
  await alice.page.waitForSelector(el("amberxvid:messenger:chat:call"), { timeout: 30_000 });
  await alice.page.waitForSelector("text=online — delivery is live", { timeout: 30_000 });
  log("alice (process A): chat with bob open, presence shows him online (their SSEs live on different processes)");
  await alice.page.click(el("amberxvid:messenger:chat:call"));
  log("alice: call placed on process A — the ring must cross the outbox to reach bob's SSE on process B");

  await bob.page.waitForSelector(el("amberxvid:call:accept"), { timeout: 30_000 });
  log("bob (process B): incoming ring rendered — CROSS-PROCESS DELIVERY WORKS");
  await sleep(5_500); // two ring-loop tones' worth
  const beeps = await bob.page.evaluate(() => window.__axvBeeps);
  summary.ring = beeps;
  if (!beeps || beeps.oscStarts < 2) {
    fail(`ring not audible: OscillatorNode.start called ${beeps?.oscStarts ?? 0} times (need ≥2)`);
  }
  log(`bob: ring is AUDIBLE — ${beeps.oscStarts} oscillator starts from the ring loop, AudioContext state '${beeps.lastCtxState}'`);
  await shot(bob.page, "p13-01-ring-bob-processB.png");

  await bob.page.click(el("amberxvid:call:accept"));
  log("bob: answered");
  const bobSees = await waitRemoteFrames(bob.page, "bob (sees alice)");
  const aliceSees = await waitRemoteFrames(alice.page, "alice (sees bob)");
  summary.call = { bobDecoded: bobSees, aliceDecoded: aliceSees };
  await alice.page.waitForSelector("text=AmberX media server", { timeout: 30_000 });
  await shot(alice.page, "p13-02-call-active-alice.png");
  await shot(bob.page, "p13-03-call-active-bob.png");

  await alice.page.click(el("amberxvid:call:mic"));
  await bob.page.waitForSelector("text=Alice muted", { timeout: 30_000 });
  await shot(bob.page, "p13-04-mute-seen-by-bob.png");
  log('bob: "Alice muted" chip rendered from the server-announced snapshot');
  await alice.page.click(el("amberxvid:call:mic"));
  await bob.page.waitForSelector("text=Alice muted", { state: "detached", timeout: 30_000 });
  log("bob: chip cleared after alice unmuted — the snapshot round-trips both ways");

  await alice.page.click(el("amberxvid:call:hangup"));
  await bob.page.waitForSelector("text=Call ended", { timeout: 30_000 });
  await shot(bob.page, "p13-05-call-ended-bob.png");
  await bob.page.click(el("amberxvid:call:dismiss"));
  for (const side of [alice, bob]) {
    const json = await apiAs(side, "/api/amberxvid/calls");
    if (!json.ok || json.call !== null) fail(`calls route still reports a live call for ${side.user}`);
  }
  log("clean hangup: end screen shown, no live call server-side on either process");

  /* --- (3): THE MEASUREMENT — 0, 1, 3 viewers --- */
  await alice.page.click(el("amberxvid:stage:view-streams"));
  await alice.page.waitForSelector(el("amberxvid:streams:go-live"), { timeout: 30_000 });
  await alice.page.click(el("amberxvid:streams:go-live"));
  await alice.page.waitForSelector(el("amberxvid:go-live:title"), { timeout: 30_000 });
  await alice.page.fill(el("amberxvid:go-live:title"), "P13 — the whole project in three numbers");
  await alice.page.click(el("amberxvid:go-live:start"));
  await alice.page.waitForSelector(el("amberxvid:stream-room:end"), { timeout: 60_000 });
  const streams = await apiAs(alice, "/api/amberxvid/streams");
  if (!streams.ok || streams.streams.length !== 1) fail(`expected 1 live stream, got ${JSON.stringify(streams.streams?.length)}`);
  const streamId = streams.streams[0].id;
  log(`alice: LIVE (stream ${streamId}) — one simulcast upstream to the SFU`);

  await sleep(8_000); // encoder + bandwidth estimation steady state before the first sample
  const first = await hostStats(alice.page);
  if (first.layers.length !== 3) fail(`expected 3 simulcast layers, saw ${first.layers.length}`);
  log(`simulcast confirmed: 3 outbound-rtp layers (${first.layers.map((l) => l.rid).sort().join(", ")})`);
  const zero = await measureUplink(alice.page, 10_000, "ZERO viewers");

  const joinStream = async (side, who) => {
    await side.page.click(el("amberxvid:stage:view-streams"));
    await side.page.waitForSelector(el(`amberxvid:streams:thumb:${streamId}`), { timeout: 30_000 });
    await side.page.click(el(`amberxvid:streams:thumb:${streamId}`));
    await side.page.waitForSelector(el("amberxvid:stream-room:leave"), { timeout: 60_000 });
    await waitRemoteFrames(side.page, who);
  };
  await joinStream(bob, "bob (viewer 1, process B)");
  await sleep(4_000);
  const one = await measureUplink(alice.page, 10_000, "ONE viewer");

  const carol = await launchAs("carol", BASE_B);
  const dave = await launchAs("dave", BASE_A);
  await joinStream(carol, "carol (viewer 2, process B)");
  await joinStream(dave, "dave (viewer 3, process A)");
  await sleep(4_000);
  const three = await measureUplink(alice.page, 10_000, "THREE viewers");

  const ratio = three.kbps / Math.max(1, one.kbps);
  summary.bitrateTable = {
    zeroViewers: zero, oneViewer: one, threeViewers: three,
    ratioThreeOverOne: Number(ratio.toFixed(2)),
    meshWouldBe: "≈3.0 — the host would upload one copy per viewer",
  };
  log(`BITRATE TABLE: 0 viewers ${zero.kbps} kbps · 1 viewer ${one.kbps} kbps · 3 viewers ${three.kbps} kbps — ratio 3/1 = ${ratio.toFixed(2)}`);
  if (ratio > 1.3) fail(`host uplink grew with the audience (${one.kbps} → ${three.kbps} kbps) — still fanning out`);
  log("CONSTANT UPLINK HOLDS — one viewer versus three is within noise");

  /* --- (5a): server-side recording, started through the room UI --- */
  await alice.page.click(el("amberxvid:stream-room:record"));
  await alice.page.waitForSelector("text=REC · recorded on server", { timeout: 30_000 });
  await bob.page.waitForSelector("text=REC · recorded on server", { timeout: 30_000 });
  log("recording LIVE on the server — REC chip visible to the host AND to a viewer (nobody is recorded silently)");
  await shot(alice.page, "p13-06-recording-host.png");
  await sleep(8_000); // let the recorder write real clusters

  /* --- (4): kill the media server mid-stream, recording still running --- */
  const killedPid = mediaChild.pid;
  mediaChild.kill("SIGKILL"); // TerminateProcess on win32 — no handler runs
  log(`media server pid ${killedPid} HARD-KILLED mid-stream (recording was live — this is also the abrupt end of (5))`);

  await bob.page.waitForSelector(el("amberxvid:stream-room:media-down"), { timeout: 90_000 });
  await shot(bob.page, "p13-07-media-down-viewer.png");
  const viewerMsg = await bob.page.evaluate(
    (sel) => document.querySelector(sel)?.textContent ?? "",
    el("amberxvid:stream-room:media-down"),
  );
  log(`viewer sees the SPECIFIC failure: "${viewerMsg.trim().slice(0, 160)}…"`);
  await alice.page.waitForSelector(el("amberxvid:stream-room:media-down-host"), { timeout: 90_000 });
  await shot(alice.page, "p13-08-media-down-host.png");
  const hostMsg = await alice.page.evaluate(
    (sel) => document.querySelector(sel)?.textContent ?? "",
    el("amberxvid:stream-room:media-down-host"),
  );
  summary.failure = { viewerMessage: viewerMsg.trim(), hostMessage: hostMsg.trim() };
  log(`host sees the SPECIFIC failure: "${hostMsg.trim().slice(0, 160)}…"`);

  await startMediaServer("restart after kill");
  await bob.page.waitForSelector(el("amberxvid:stream-room:media-down"), { state: "detached", timeout: 120_000 });
  await alice.page.waitForSelector(el("amberxvid:stream-room:media-down-host"), { state: "detached", timeout: 120_000 });
  log("both failure banners cleared — the backoff loop rejoined the same room");

  const watchStats = (page) => page.evaluate(async () => await window.__axvWatchVideoStats?.());
  const w0 = await watchStats(bob.page);
  const s0 = await hostStats(alice.page);
  await sleep(4_000);
  const w1 = await watchStats(bob.page);
  const s1 = await hostStats(alice.page);
  const rx = (w1?.[0]?.bytesReceived ?? 0) - (w0?.[0]?.bytesReceived ?? 0);
  const tx = s1.bytes - s0.bytes;
  if (rx <= 0) fail(`after the restart bob's inbound video is not flowing (${w0?.[0]?.bytesReceived} → ${w1?.[0]?.bytesReceived})`);
  if (tx <= 0) fail(`after the restart alice's outbound video is not flowing`);
  summary.reconnect = { hostTxBytesOver4s: tx, viewerRxBytesOver4s: rx };
  log(`RECONNECTED: alice sending again (+${Math.round(tx / 1024)} KiB/4s), bob receiving again (+${Math.round(rx / 1024)} KiB/4s) — no rejoin click, no new session`);
  await shot(bob.page, "p13-09-reconnected-viewer.png");

  /* --- (5b): the abruptly-ended recording plays from the Library --- */
  await alice.page.click(el("amberxvid:stream-room:end"));
  await bob.page.waitForSelector(el("amberxvid:stream-room:leave"), { state: "detached", timeout: 30_000 });
  log("alice ended the stream cleanly — watchers released");

  await alice.page.click(el("amberxvid:stage:view-library"));
  await alice.page.waitForSelector('[data-el-id^="amberxvid:library:card:"]', { timeout: 30_000 });
  const cardId = await alice.page.evaluate(() => {
    const card = document.querySelector('[data-el-id^="amberxvid:library:card:"]');
    return card?.getAttribute("data-el-id")?.split(":").pop() ?? null;
  });
  log(`library shows the server recording (id ${cardId}) — the crash-recovered manifest surfaced`);
  await alice.page.click('[data-el-id^="amberxvid:library:card:"]');
  await alice.page.waitForSelector(el("amberxvid:library:player-video"), { timeout: 30_000 });
  await alice.page.waitForFunction(
    (sel) => {
      const v = document.querySelector(sel);
      return v && v.readyState >= 2 && v.videoWidth > 0;
    },
    el("amberxvid:library:player-video"),
    { timeout: 60_000 },
  );
  await alice.page.evaluate((sel) => document.querySelector(sel)?.play(), el("amberxvid:library:player-video"));
  const t0 = await alice.page.evaluate((sel) => document.querySelector(sel)?.currentTime ?? -1, el("amberxvid:library:player-video"));
  await sleep(2_500);
  const t1 = await alice.page.evaluate((sel) => {
    const v = document.querySelector(sel);
    return { t: v?.currentTime ?? -1, w: v?.videoWidth, h: v?.videoHeight, dur: v?.duration };
  }, el("amberxvid:library:player-video"));
  if (!(t1.t > t0)) fail(`library playback is not advancing (${t0} → ${t1.t})`);
  summary.recording = { cardId, playback: t1, endedBy: "media-server SIGKILL mid-recording; finalized by boot recovery on restart" };
  log(`LIBRARY PLAYBACK: ${t1.w}x${t1.h}, duration ${t1.dur?.toFixed?.(1)}s, currentTime ${t0.toFixed(2)} → ${t1.t.toFixed(2)} — the abruptly-ended WebM plays`);
  await shot(alice.page, "p13-10-library-playback.png");

  // the file on disk, for the record
  const vaultFiles = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".webm")) vaultFiles.push({ path: p, bytes: fs.statSync(p).size });
    }
  };
  walk(DATA_ROOT);
  summary.recordingFiles = vaultFiles;
  log(`recording on disk: ${vaultFiles.map((f) => `${f.path} (${f.bytes} bytes)`).join("; ")}`);

  /* --- the world after --- */
  const finalHealth = await mediaHealth();
  summary.finalHealth = finalHealth;
  log(`media server /health at the end: ${JSON.stringify(finalHealth)}`);

  await teardown();
  summary.result = "PASS";
  flushArtifacts();
  console.log("\nP13 PROOF PASSED:");
  console.log(`  1:1 call across processes (alice on A, bob on B): camera both ways, mute server-known, clean hangup`);
  console.log(`  cross-process ring: bob's SSE on B rang for a call placed on A — ${summary.ring.oscStarts} audible beeps`);
  console.log(`  THE TABLE: 0 viewers ${zero.kbps} kbps · 1 viewer ${one.kbps} kbps · 3 viewers ${three.kbps} kbps (ratio ${ratio.toFixed(2)}; mesh ≈ 3.0)`);
  console.log(`  kill mid-stream → specific message both sides; restart → same room reconnected, bytes flowing`);
  console.log(`  server recording ended ABRUPTLY by the kill → recovered → played from the Library`);
  process.exit(0);
} catch (err) {
  if (!failed) {
    transcript.push(`[p13] ERROR: ${err?.stack ?? err}`);
    console.error(err);
    await teardown();
  }
  process.exit(1);
}
