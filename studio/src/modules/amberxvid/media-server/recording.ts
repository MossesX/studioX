/**
 * @file Server-side stream recording (P10) — the capability peer-to-peer could
 * not have. The SFU already receives the host's ONE upstream
 * (`MEDIA_CONTRACT.topology`), so recording it is one more consumer on the
 * router: the host's producers are tapped through a `PlainTransport` into an
 * ffmpeg child that STREAM-COPIES (`-c copy`, no transcode — the browser
 * already encoded VP8/Opus) into a WebM/Matroska file in the host's vault. It
 * runs on hardware that is not the host's laptop, costs the host no CPU and no
 * upload, and the finished file goes through `lib/recordings.ts`'s own
 * manifest lifecycle, so the Library cannot tell it from a local capture.
 *
 * ── why WebM/Matroska, and why there is no finalisation step ────────────────
 *
 * The container is cluster-structured and crash-tolerant BY DESIGN: every few
 * hundred milliseconds ffmpeg appends a self-contained cluster, so a stream
 * that ends abruptly — host crash, media-server kill, ffmpeg SIGKILL — still
 * leaves a playable file. (v0.1.0 demanded "moov atom in place", an MP4
 * concept; the requirement is deleted, not solved.) The finalize that DOES run
 * on a clean stop is cosmetic repair, not rescue: `remuxForPlayback` gives the
 * file its Duration element and Cues so seeking works, and the thumbnail is
 * generated — both through the exact machinery the browser engine has used
 * since 2026-08-03. A crash skips both and the file still plays;
 * `recoverServerRecordings` closes the orphaned manifest at the next boot.
 *
 * ── the wire path, in order ─────────────────────────────────────────────────
 *
 *   1. preflight — ffmpeg resolvable AND disk headroom in the recordings
 *      store, checked BEFORE starting, never discovered halfway;
 *   2. one `PlainTransport` + one PAUSED consumer per tapped producer
 *      (host's live mic + camera; a producer paused at start is skipped —
 *      ffmpeg blocks its header on a stream that never sends probe data);
 *   3. container chosen from the consumer's real codec (VP8/VP9 → .webm;
 *      an H264 publisher → .mkv, which finalize remuxes to browser mp4);
 *   4. manifest opened in the host's vault (`beginServerRecording`), the SDP
 *      written beside it, ffmpeg spawned reading that SDP;
 *   5. transports connected to ffmpeg's loopback ports, consumers resumed,
 *      keyframes requested — media flows only after the recorder listens.
 *
 * ── orphan discipline (NOT optional) ────────────────────────────────────────
 *
 * The ffmpeg child dies when the room closes or the process exits — the same
 * three-layer posture `index.ts` documents for mediasoup workers, because a
 * leaked encoder is a machine-eating bug: (1) every stop path routes through
 * {@link RoomRecorder.stop}; (2) `index.ts`'s `process.on("exit")` calls the
 * registry's {@link RoomRegistry.killRecordersNow} synchronously; (3) an
 * external hard kill of THIS process takes ffmpeg's stdin pipe with it and a
 * `-nostdin`-less ffmpeg exits on the closed pipe — and even where it did not,
 * the file already on disk is the playable artefact, per the container choice.
 *
 * Server-only. Imports mediasoup types and spawns children; never in a client
 * bundle.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import dgram from "node:dgram";
import fsp from "node:fs/promises";
import path from "node:path";

import type { Consumer, PlainTransport, Producer, Router } from "mediasoup/types";

import type { MediaKind } from "../lib/mediaContract";
import {
  beginServerRecording,
  ffmpegAvailable,
  ffmpegPath,
  finalizeServerRecording,
  maxRecordingBytes,
} from "../lib/recordings";
import { usersDir } from "../lib/paths";

/* --------------------------------- preflight ----------------------------------- */

export interface RecorderPreflight {
  ok: boolean;
  /** The honest, user-facing sentence when `ok` is false — what the disabled
   *  record toggle SHOWS, so an absent ffmpeg is never a silent no-op. */
  reason: string | null;
}

/**
 * Everything that must be true BEFORE a recording starts. Read per call —
 * dropping an ffmpeg binary into place or freeing disk takes effect on the
 * next check, no restart.
 */
export async function recordingPreflight(): Promise<RecorderPreflight> {
  if (!(await ffmpegAvailable())) {
    return {
      ok: false,
      reason:
        "no runnable ffmpeg on the media-server machine (checked AMBERXVID_FFMPEG, node_modules/ffmpeg-static, then PATH) — server recording needs it",
    };
  }
  // Disk pressure: require headroom for one whole max-size recording, so the
  // failure is a refusal at the door, not ENOSPC halfway through a broadcast.
  try {
    // P2: recordings live per member now, so the headroom question is about
    // the VOLUME the vaults sit on rather than one shared directory — which is
    // what `statfs` was really answering all along.
    await fsp.mkdir(usersDir(), { recursive: true });
    const s = await fsp.statfs(usersDir());
    const free = s.bsize * s.bavail;
    const need = maxRecordingBytes();
    if (free < need) {
      const mb = (n: number): number => Math.round(n / 1024 / 1024);
      return {
        ok: false,
        reason: `only ${mb(free)} MB free in the recordings store — ${mb(need)} MB headroom is required before a recording may start`,
      };
    }
  } catch {
    // statfs unavailable on this volume: the check cannot run, and blocking a
    // provable feature on an unmeasurable guard would be a false refusal. The
    // recorder's ffmpeg-exit path still ends a recording that hits a full disk.
  }
  return { ok: true, reason: null };
}

/* ---------------------------------- plumbing ----------------------------------- */

/** A free loopback UDP port, found by binding port 0 and letting the OS pick.
 *  The socket is closed before ffmpeg re-binds the port — a small race, and
 *  the standard one every mediasoup recording recipe accepts. */
function freeUdpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    sock.on("error", reject);
    sock.bind(0, "127.0.0.1", () => {
      const { port } = sock.address();
      sock.close(() => resolve(port));
    });
  });
}

/** One tapped producer: its transport, its consumer, and the loopback ports
 *  ffmpeg receives its RTP/RTCP on. */
interface Tap {
  kind: MediaKind;
  transport: PlainTransport;
  consumer: Consumer;
  rtpPort: number;
  rtcpPort: number;
}

/** One SDP media section, written from the consumer's REAL negotiated codec —
 *  never a hardcoded payload type, so a router remap cannot desync the file. */
function mediaSection(tap: Tap): string {
  const codec = tap.consumer.rtpParameters.codecs[0];
  const name = codec.mimeType.split("/")[1];
  const rtpmap = `${name}/${codec.clockRate}${codec.channels ? `/${codec.channels}` : ""}`;
  const fmtp = Object.entries(codec.parameters ?? {})
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(";");
  const lines = [
    `m=${tap.consumer.kind} ${tap.rtpPort} RTP/AVP ${codec.payloadType}`,
    "c=IN IP4 127.0.0.1",
    `a=rtcp:${tap.rtcpPort}`,
    `a=rtpmap:${codec.payloadType} ${rtpmap}`,
  ];
  if (fmtp) lines.push(`a=fmtp:${codec.payloadType} ${fmtp}`);
  lines.push("a=recvonly");
  return lines.join("\n");
}

function buildSdp(taps: Tap[]): string {
  return [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=AmberX Vid server recording",
    "t=0 0",
    ...taps.map(mediaSection),
    "",
  ].join("\n");
}

/* ---------------------------------- recorder ----------------------------------- */

export interface RecorderStartOpts {
  router: Router;
  /** The host's live producers, by kind. The recorder taps `audio` + `video`
   *  that are neither closed nor paused; `screen` is deliberately not tapped
   *  in v1 — a second video track in one Matroska is legal but no browser
   *  `<video>` plays it, and an unplayable "recording" would be a lie. */
  producers: ReadonlyMap<MediaKind, Producer>;
  /** Normalized host username — the vault the file lands in. */
  owner: string;
  /** The stream's title, passed down from the app server's room record. */
  title: string;
  log: (msg: string) => void;
  /** Fired when the recording ends WITHOUT `stop()` being asked — ffmpeg died
   *  (disk full, crash). The holder drops its reference and re-announces. */
  onEnded: (reason: string) => void;
}

/**
 * One live recording of one room. Constructed only through {@link RoomRecorder.start};
 * every teardown path funnels into {@link RoomRecorder.stop}, which is
 * idempotent and always finalizes the manifest exactly once.
 */
export class RoomRecorder {
  readonly recordingId: string;
  private readonly taps: Tap[];
  private readonly child: ChildProcess;
  private readonly startedMs: number;
  private readonly log: (msg: string) => void;
  private stopping = false;
  private finalized = false;

  /** Still writing — the fact `RoomSnapshot.recording` announces. */
  get active(): boolean {
    return !this.stopping;
  }

  private constructor(recordingId: string, taps: Tap[], child: ChildProcess, log: (msg: string) => void) {
    this.recordingId = recordingId;
    this.taps = taps;
    this.child = child;
    this.startedMs = Date.now();
    this.log = log;
  }

  static async start(opts: RecorderStartOpts): Promise<RoomRecorder> {
    const pre = await recordingPreflight();
    if (!pre.ok) throw new Error(pre.reason ?? "recording preflight failed");

    // Tap the host's LIVE mic + camera. A producer paused at start is skipped
    // rather than waited on: ffmpeg holds the whole file's header hostage to a
    // stream that never sends probe data, so a muted mic would stall the video
    // too. Pausing AFTER the start merely stops that track's packets — the
    // clusters already on disk stay playable, which is the container's job.
    const taps: Tap[] = [];
    const wanted: MediaKind[] = ["audio", "video"];
    for (const kind of wanted) {
      const producer = opts.producers.get(kind);
      if (!producer || producer.closed || producer.paused) continue;
      const transport = await opts.router.createPlainTransport({
        listenInfo: { protocol: "udp", ip: "127.0.0.1" },
        rtcpMux: false,
        comedia: false,
      });
      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: opts.router.rtpCapabilities,
        paused: true,
      });
      taps.push({ kind, transport, consumer, rtpPort: await freeUdpPort(), rtcpPort: await freeUdpPort() });
    }
    if (taps.length === 0) {
      throw new Error("no live media to record — the host is publishing nothing that is not paused");
    }

    // Container from the REAL negotiated video codec: VP8/VP9 → webm; an H264
    // publisher → mkv, which finalize remuxes to browser mp4 (the tray path).
    const video = taps.find((t) => t.consumer.kind === "video");
    const videoCodec = video?.consumer.rtpParameters.codecs[0]?.mimeType.toLowerCase() ?? "";
    const container = videoCodec.includes("h264") ? "mkv" : "webm";

    const begun = await beginServerRecording(opts.owner, {
      title: opts.title,
      container,
      hasAudio: taps.some((t) => t.consumer.kind === "audio"),
    });
    if (!begun.ok) {
      for (const t of taps) t.transport.close();
      throw new Error(`could not open the recording in the store: ${begun.error}`);
    }
    const { handle } = begun;

    const sdpPath = path.join(handle.dir, "input.sdp");
    await fsp.writeFile(sdpPath, buildSdp(taps), "utf8");

    // Stream-copy, nothing else: the browser already encoded this. `-flush_packets 1`
    // keeps the on-disk file current, which is what makes the crash story true
    // in practice as well as in container theory. stdin stays a pipe on
    // purpose — 'q' is the graceful stop, and a closed pipe ends an orphan.
    const args = [
      "-hide_banner",
      "-loglevel", "warning",
      "-protocol_whitelist", "file,udp,rtp",
      "-fflags", "+genpts",
      "-analyzeduration", "5000000",
      "-probesize", "5000000",
      "-i", sdpPath,
      "-map", "0",
      "-c", "copy",
      "-flush_packets", "1",
      "-f", container === "webm" ? "webm" : "matroska",
      "-y", handle.mediaPath,
    ];
    const child = spawn(ffmpegPath(), args, {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderrTail = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString("utf8")).slice(-2000);
    });

    const recorder = new RoomRecorder(handle.manifest.id, taps, child, opts.log);

    child.on("error", (err) => {
      opts.log(`recorder ${recorder.recordingId}: ffmpeg failed to spawn — ${err.message}`);
      void recorder.stop("ffmpeg failed to spawn").then(() => opts.onEnded("ffmpeg failed to spawn"));
    });
    child.on("exit", (code, signal) => {
      if (recorder.stopping) return; // stop() asked for this exit
      const why = `ffmpeg exited on its own (code ${String(code)}, signal ${String(signal)})${stderrTail ? ` — ${stderrTail.trim().split("\n").pop()}` : ""}`;
      opts.log(`recorder ${recorder.recordingId}: ${why}`);
      void recorder.stop(why).then(() => opts.onEnded(why));
    });

    // Point each transport at ffmpeg's ports, then open the taps. Resume-after
    // -listen ordering matters less than it reads — UDP loss is survivable —
    // but the keyframe request only helps once ffmpeg can hear the answer.
    try {
      for (const t of taps) {
        await t.transport.connect({ ip: "127.0.0.1", port: t.rtpPort, rtcpPort: t.rtcpPort });
        if (t.consumer.type === "simulcast") {
          await t.consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
        }
        await t.consumer.resume();
        if (t.consumer.kind === "video") await t.consumer.requestKeyFrame();
      }
    } catch (err) {
      await recorder.stop("could not connect the recording taps");
      throw err instanceof Error ? err : new Error(String(err));
    }
    // A second keyframe ask, after ffmpeg has certainly bound its ports: the
    // first frames of the file must be decodable, not mid-GOP deltas.
    setTimeout(() => {
      for (const t of taps) {
        if (t.consumer.kind === "video" && !t.consumer.closed) void t.consumer.requestKeyFrame();
      }
    }, 2_000).unref();

    opts.log(
      `recorder ${recorder.recordingId}: recording room media for ${opts.owner} — ${taps.map((t) => t.kind).join("+")} → ${handle.manifest.file} (ffmpeg pid ${child.pid})`,
    );
    return recorder;
  }

  /**
   * End the recording and finalize its manifest. Idempotent — the room
   * closing, the host toggling off, ffmpeg dying and process shutdown may all
   * arrive; the first one wins and the rest return quietly.
   */
  async stop(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.log(`recorder ${this.recordingId}: stopping — ${reason}`);

    for (const t of this.taps) {
      try {
        t.transport.close(); // cascades to the consumer
      } catch {
        /* router already closed it */
      }
    }

    // Graceful first: 'q' (honoured on POSIX — the VPS) then stdin EOF, which
    // is what ends ffmpeg on win32, where console commands never arrive over a
    // pipe — the P10 proof watched EOF do exactly that. Kill after 3 s either
    // way, and then WAIT FOR THE REAL EXIT: finalize must never race a dying
    // process that still holds the media file and the SDP open (the EBUSY the
    // first proof run caught). A killed ffmpeg still leaves a playable file —
    // the container choice.
    if (this.child.exitCode === null) {
      const exited = new Promise<void>((resolve) => {
        if (this.child.exitCode !== null) resolve();
        else this.child.once("exit", () => resolve());
      });
      const wait = (ms: number): Promise<void> =>
        Promise.race([exited, new Promise<void>((r) => setTimeout(r, ms))]);
      try {
        this.child.stdin?.write("q\n");
        this.child.stdin?.end();
      } catch {
        /* pipe already gone */
      }
      await wait(3_000);
      if (this.child.exitCode === null) {
        try {
          this.child.kill();
        } catch {
          /* already dead */
        }
        await wait(2_000);
      }
    }

    if (this.finalized) return;
    this.finalized = true;
    const durationS = (Date.now() - this.startedMs) / 1000;
    // A finalize that trips on the filesystem must not turn a SUCCESSFUL stop
    // into a wire error — the file is on disk and playable regardless, and
    // boot recovery closes a manifest this leaves open.
    try {
      const done = await finalizeServerRecording(this.recordingId, durationS);
      if (done.ok) {
        this.log(
          `recorder ${this.recordingId}: finalized — ${done.manifest.durationS}s, ${(done.manifest.sizeBytes / 1024 / 1024).toFixed(1)} MB, ${done.manifest.file}`,
        );
      } else {
        this.log(`recorder ${this.recordingId}: finalize refused (${done.status}): ${done.error}`);
      }
    } catch (err) {
      this.log(`recorder ${this.recordingId}: finalize threw — ${err instanceof Error ? err.message : String(err)} (boot recovery will close the manifest)`);
    }
  }

  /** Synchronous last-ditch kill for `process.on("exit")` — no awaiting, no
   *  finalize. The file stays playable; the manifest is recovered next boot. */
  killNow(): void {
    this.stopping = true;
    try {
      this.child.kill();
    } catch {
      /* exiting anyway */
    }
  }
}
