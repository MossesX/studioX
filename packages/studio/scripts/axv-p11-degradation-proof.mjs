/**
 * P11 degradation proof — kill the media server, watch the named refusal,
 * restart it, watch the SAME room accept a rejoin.
 *
 *     node --import ./test/alias-hook.mjs scripts/axv-p11-degradation-proof.mjs
 *
 * What it proves, at the seams the UI is built on (the browser rig with fake
 * media devices is P13's phase; the sentences printed here are the exact
 * strings the P11 surfaces render, by import, not by copy):
 *
 *   1. UP      — the media server boots, /health answers, a seat joins a room
 *                minted from a P3 room record.
 *   2. KILLED  — a hard kill mid-session. /health refuses FAST (measured),
 *                a join attempt is the named `server-unreachable` refusal in
 *                bounded time (measured, never a hang), and the exact
 *                user-facing sentences for every MediaFailure are printed.
 *   3. RECORD  — the P3 room record is UNTOUCHED by the media server dying:
 *                same id, same createdAt, same seat. The record outlives the
 *                media plane, which is what makes reconnect a REJOIN.
 *   4. BACK    — the media server restarts, /health answers, and a FRESH
 *                token minted against the SAME record joins the SAME roomId
 *                (`ensureRoom` rebuilds the router on demand) — the exact
 *                sequence the P11 backoff loops run in VideoChat/StreamHub.
 *
 * Isolated on purpose: its own AMBERXVID_DATA_DIR temp root, its own port,
 * its own secret. It touches no live store and no running server.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3216; // clear of the default 3215 — never fight a real sidecar
const SECRET = "p11-degradation-proof-secret";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "axv-p11-"));

process.env.AMBERXVID_MEDIA_DEV = "1";
process.env.AMBERXVID_MEDIA_SECRET = SECRET;
process.env.AMBERXVID_MEDIA_PORT = String(PORT);
process.env.AMBERXVID_DATA_DIR = dataDir;

const { createRoom, newParticipant, readRoom } = await import("../src/modules/amberxvid/lib/roomStore.ts");
const { mintMediaToken } = await import("../src/modules/amberxvid/media-server/tokens.ts");
const { joinSeat, leaveSeat, mediaServerUrl, MediaPlaneError } = await import(
  "../src/modules/amberxvid/lib/mediaBridge.ts"
);
const { MEDIA_FAILURE_USER_COPY, NO_FALLBACK_DECISION } = await import(
  "../src/modules/amberxvid/lib/mediaContract.ts"
);

const log = (msg) => console.log(msg);
let failures = 0;
const check = (ok, label) => {
  log(`${ok ? "  ✓" : "  ✗ FAIL"} ${label}`);
  if (!ok) failures += 1;
};

function startServer() {
  const child = spawn(
    process.execPath,
    ["--import", "./test/alias-hook.mjs", "src/modules/amberxvid/media-server/index.ts"],
    { cwd: studioRoot, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", () => undefined);
  child.stderr.on("data", () => undefined);
  return child;
}

async function healthOnce(timeoutMs = 1500) {
  const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(timeoutMs) });
  return res.ok ? await res.json() : null;
}

async function waitHealthy(label, budgetMs = 30_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const h = await healthOnce();
      if (h?.ok === true) {
        log(`  ✓ ${label}: /health ok after ${Date.now() - t0}ms (pid ${h.pid}, workers ${h.workers})`);
        return h;
      }
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > budgetMs) throw new Error(`${label}: media server never became healthy`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/* ------------------------------- 1. UP ------------------------------- */

log("=== P11 degradation proof ===");
log(`data root: ${dataDir}`);
let child = startServer();
await waitHealthy("boot");

const HOST = "p11host";
const rec = createRoom({
  kind: "stream",
  host: HOST,
  participants: [newParticipant(HOST, "host")],
  stream: { title: "P11 proof stream", chat: [], thumbnailAt: null, hasThumbnail: false },
});
log(`  room record created: ${rec.id} (createdAt ${rec.createdAt})`);

const url = mediaServerUrl();
check(url === `http://127.0.0.1:${PORT}`, `mediaServerUrl() derives ${url}`);

const token1 = mintMediaToken({ sub: HOST, room: rec.id, role: "host" }, SECRET);
const first = await joinSeat(url, token1, HOST);
check(first.seat.roomId === rec.id && first.seat.role === "host", `joined room ${first.seat.roomId} as host (seat ${first.seat.participantId})`);
check(typeof first.joined.routerRtpCapabilities === "object", "joined reply carries routerRtpCapabilities");

/* ------------------------------ 2. KILLED ----------------------------- */

log("--- killing the media server mid-session (hard kill, like a crash) ---");
child.kill();
await new Promise((r) => setTimeout(r, 700)); // let the process actually die

let t0 = Date.now();
let healthDown = false;
try {
  const h = await healthOnce(2000);
  healthDown = h === null;
} catch {
  healthDown = true;
}
check(healthDown, `/health refuses in ${Date.now() - t0}ms — the probe is fast, never a hang`);

t0 = Date.now();
let refusal = null;
try {
  await joinSeat(url, mintMediaToken({ sub: HOST, room: rec.id, role: "host" }, SECRET), HOST);
} catch (err) {
  refusal = err;
}
const joinMs = Date.now() - t0;
check(refusal instanceof MediaPlaneError && refusal.failure === "server-unreachable",
  `join is the NAMED refusal '${refusal?.failure}' in ${joinMs}ms (bounded, < 5000ms: ${joinMs < 5000})`);

log("--- the exact sentences the UI shows for each MediaFailure (P11 copy, by import) ---");
for (const [failure, copy] of Object.entries(MEDIA_FAILURE_USER_COPY)) {
  log(`  [${failure}]`);
  log(`    "${copy}"`);
}

/* ------------------------------ 3. RECORD ----------------------------- */

const after = readRoom(rec.id);
check(
  after !== null && after.id === rec.id && after.createdAt === rec.createdAt && after.state === "live",
  "the P3 room record OUTLIVED the media server: same id, same createdAt, still live",
);
check(after.participants.some((p) => p.user === HOST && p.role === "host"), "the host's seat is still in the record");

/* ------------------------------- 4. BACK ------------------------------ */

log("--- restarting the media server ---");
child = startServer();
await waitHealthy("restart");

const token2 = mintMediaToken({ sub: HOST, room: rec.id, role: "host" }, SECRET);
const second = await joinSeat(url, token2, HOST);
check(
  second.seat.roomId === rec.id,
  `REJOINED the SAME room ${second.seat.roomId} after the restart — ensureRoom rebuilt the router; this is the P11 backoff loop's exact sequence`,
);
await leaveSeat(second.seat);

/* -------------------------------- done -------------------------------- */

log("--- the recorded decision (mediaContract.NO_FALLBACK_DECISION) ---");
log(`  ${NO_FALLBACK_DECISION.decision}`);

child.kill();
await new Promise((r) => setTimeout(r, 500));
try {
  fs.rmSync(dataDir, { recursive: true, force: true });
} catch {
  /* temp dir — the OS owns it eventually */
}

log(failures === 0 ? "=== PROOF PASSED — 0 failures ===" : `=== PROOF FAILED — ${failures} failure(s) ===`);
process.exit(failures === 0 ? 0 : 1);
