"use client";

/**
 * @file The AmberX Vid in-browser webcam engine (P3) — `useBrowserRecorder`,
 * the capture state machine the whole module shares, plus `RecorderPanel`, the
 * stage surface that renders it.
 *
 * The HOOK lives in the module component, not the panel, on purpose: the
 * toolbar's record quick action and the channel-status strip drive and read
 * the same engine, and a rolled layout theme rearranging the stage slot must
 * never kill a running capture.
 *
 * Engine: `getUserMedia` device selection (camera + mic, labels populated
 * after permission) with live preview; `MediaRecorder` at the sui/quick-action
 * resolution + quality presets (bitrate-mapped); live mic mute via track
 * enable (mid-recording safe); pause/resume; elapsed + size readouts on a
 * 250 ms tick. Media leaves as 3-second `ondataavailable` chunks PUT
 * sequentially to `/api/amberxvid/recordings` — each request stays small
 * enough for a real internet uplink, retries ride a backoff, and a lost
 * response is safe because the server treats a duplicate of the last chunk as
 * idempotent. Stop flushes the queue, finalizes (server stats the file and
 * generates the ffmpeg thumbnail) and the capture appears in the recent strip.
 * An unmount mid-capture aborts the open upload via `sendBeacon` so the store
 * never accumulates orphans.
 *
 * Honesty: the preview, readouts and recent strip only ever show real device
 * state and real store rows — no camera means an explicit enable step, no
 * captures means an empty state that says so.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { FiberManualRecord as RecordIcon } from "./kit/icons";
import { Stop as StopIcon } from "./kit/icons";
import { Pause as PauseIcon } from "./kit/icons";
import { PlayArrow as ResumeIcon } from "./kit/icons";
import { Videocam as CameraIcon } from "./kit/icons";
import { VideocamOff as CameraOffIcon } from "./kit/icons";
import { RecordVoiceOver as MicOnIcon } from "./kit/icons";
import { VolumeOff as MicOffIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip, useCtx, type CtxItem } from "./kit/ax";
import { GizmoXMark } from "./gizmox-kit";
import { useToast } from "./kit/Toast";
import type { RecordingManifest, RecordingQuality } from "./lib/types";
import { useAnimationIntensity } from "./Splash";

/* --------------------------------- contracts ---------------------------------- */

export type RecorderStatus =
  | "idle" // no camera yet — enabling is an explicit user step
  | "preview" // camera live, nothing recording
  | "starting" // begin handshake in flight
  | "recording"
  | "paused"
  | "finishing" // flushing chunks + finalize
  | "error";

/** True whenever the engine owns an active capture — the toolbar's "armed". */
export function engineActive(status: RecorderStatus): boolean {
  return status === "starting" || status === "recording" || status === "paused" || status === "finishing";
}

export interface RecorderConfig {
  micOn: boolean;
  /** `"1280x720"` — the sui/quick-action preset. */
  resolution: string;
  quality: RecordingQuality;
  /**
   * `recorder.saveTo` — `"library"` (server store only) or
   * `"library+download"` (also keep the capture in memory and hand the
   * browser a local copy on finalize). Latched per capture at start.
   */
  saveTo: string;
  /** Module-provided announcer (the toast) — every transition is visible. */
  notify: (message: string) => void;
}

export interface BrowserRecorderEngine {
  status: RecorderStatus;
  error: string | null;
  stream: MediaStream | null;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  videoDeviceId: string;
  audioDeviceId: string;
  setVideoDeviceId: (id: string) => void;
  setAudioDeviceId: (id: string) => void;
  /** False when the stream came up video-only (no mic / permission denied). */
  hasAudioTrack: boolean;
  elapsedMs: number;
  bytesRecorded: number;
  bytesUploaded: number;
  /** Bumps once per finalized capture — the recent strip's refresh key. */
  savedTick: number;
  enableCamera: () => Promise<void>;
  disableCamera: () => void;
  start: () => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

/* ---------------------------------- helpers ----------------------------------- */

function parseResolution(s: string): { w: number; h: number } {
  const m = /^(\d+)x(\d+)$/.exec(s);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1280, h: 720 };
}

/** Bitrates per quality preset — what "quality" concretely means here. */
const QUALITY_BITRATES: Record<RecordingQuality, { video: number; audio: number }> = {
  low: { video: 1_200_000, audio: 64_000 },
  medium: { video: 2_500_000, audio: 96_000 },
  high: { video: 5_000_000, audio: 128_000 },
  max: { video: 12_000_000, audio: 192_000 },
};

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "video/webm";
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mm}` : mm;
}

/** MediaRecorder timeslice — one chunk every 3 s keeps requests uplink-sized. */
const TIMESLICE_MS = 3000;
const UPLOAD_RETRIES = 3;

/** Per-capture upload bookkeeping (refs — event handlers mutate it directly). */
interface UploadJob {
  id: string;
  nextSeq: number;
  queue: Blob[];
  sending: boolean;
  stopped: boolean;
  finalized: boolean;
  failed: boolean;
  finalDurationS: number;
  /** Chunk copies for `saveTo: "library+download"`; null = library only. */
  localParts: Blob[] | null;
}

/* ----------------------------------- engine ----------------------------------- */

export function useBrowserRecorder(config: RecorderConfig): BrowserRecorderEngine {
  const [status, setStatus] = React.useState<RecorderStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [videoDevices, setVideoDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = React.useState("");
  const [audioDeviceId, setAudioDeviceId] = React.useState("");
  const [hasAudioTrack, setHasAudioTrack] = React.useState(false);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const [bytesRecorded, setBytesRecorded] = React.useState(0);
  const [bytesUploaded, setBytesUploaded] = React.useState(0);
  const [savedTick, setSavedTick] = React.useState(0);

  const statusRef = React.useRef(status);
  statusRef.current = status;
  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const jobRef = React.useRef<UploadJob | null>(null);
  const configRef = React.useRef(config);
  configRef.current = config;
  // Elapsed accounting survives pause: accumulated + the running segment start.
  const accumMsRef = React.useRef(0);
  const segStartRef = React.useRef(0);

  /* mic mute is a live track flip — safe mid-recording, no renegotiation */
  React.useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = config.micOn;
    });
  }, [config.micOn, stream]);

  /* elapsed readout tick (≥200 ms per house rule), cleared on unmount */
  React.useEffect(() => {
    const tick = window.setInterval(() => {
      const s = statusRef.current;
      if (s === "recording") setElapsedMs(accumMsRef.current + (Date.now() - segStartRef.current));
      else if (s === "paused" || s === "finishing") setElapsedMs(accumMsRef.current);
    }, 250);
    return () => window.clearInterval(tick);
  }, []);

  /* ------------------------------ camera control ----------------------------- */

  const acquire = React.useCallback(async (videoId: string, audioId: string): Promise<void> => {
    const { w, h } = parseResolution(configRef.current.resolution);
    const video: MediaTrackConstraints = {
      width: { ideal: w },
      height: { ideal: h },
      ...(videoId ? { deviceId: { exact: videoId } } : {}),
    };
    const audio: MediaTrackConstraints | boolean = audioId ? { deviceId: { exact: audioId } } : true;

    let next: MediaStream;
    try {
      next = await navigator.mediaDevices.getUserMedia({ video, audio });
    } catch {
      // No mic (or mic permission denied) must not cost the camera.
      next = await navigator.mediaDevices.getUserMedia({ video });
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    next.getAudioTracks().forEach((t) => {
      t.enabled = configRef.current.micOn;
    });
    streamRef.current = next;
    setStream(next);
    setHasAudioTrack(next.getAudioTracks().length > 0);

    // Labels only exist after permission — refresh the pickers now.
    const devices = await navigator.mediaDevices.enumerateDevices();
    setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
    setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
  }, []);

  const enableCamera = React.useCallback(async (): Promise<void> => {
    if (engineActive(statusRef.current)) return;
    setError(null);
    try {
      await acquire(videoDeviceId, audioDeviceId);
      setStatus("preview");
    } catch (e) {
      setStatus("error");
      const msg = e instanceof DOMException && e.name === "NotAllowedError"
        ? "Camera permission denied — allow it in the browser and try again"
        : "No camera could be opened";
      setError(msg);
      configRef.current.notify(msg);
    }
  }, [acquire, audioDeviceId, videoDeviceId]);

  const disableCamera = React.useCallback((): void => {
    if (engineActive(statusRef.current)) return;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setHasAudioTrack(false);
    setStatus("idle");
  }, []);

  /* Re-acquire on device/resolution change, but ONLY while previewing — a
     running capture keeps the tracks it started with. */
  const firstConfigRun = React.useRef(true);
  React.useEffect(() => {
    if (firstConfigRun.current) {
      firstConfigRun.current = false;
      return;
    }
    if (statusRef.current !== "preview") return;
    void acquire(videoDeviceId, audioDeviceId).catch(() => {
      configRef.current.notify("Could not switch device — the previous stream was lost");
      setStatus("idle");
      setStream(null);
      streamRef.current = null;
    });
  }, [acquire, videoDeviceId, audioDeviceId, config.resolution]);

  /* -------------------------------- upload pump ------------------------------- */

  const failCapture = React.useCallback((message: string): void => {
    const job = jobRef.current;
    if (job) {
      job.failed = true;
      jobRef.current = null;
      // Best-effort discard of the server-side partial — never keep orphans.
      void fetch("/api/amberxvid/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abort", id: job.id }),
      }).catch(() => undefined);
    }
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* already gone */
      }
    }
    setStatus("error");
    setError(message);
    configRef.current.notify(message);
  }, []);

  const pump = React.useCallback(async (): Promise<void> => {
    const job = jobRef.current;
    if (!job || job.sending || job.failed) return;
    job.sending = true;
    try {
      // Single-threaded truth: events only land at the awaits, and both the
      // queue and the stopped flag are re-checked after every one — so the
      // final chunk can never race past finalize.
      while (true) {
        if (job.failed) return;
        if (job.queue.length > 0) {
          const blob = job.queue[0];
          const seq = job.nextSeq;
          let done = false;
          for (let attempt = 0; attempt < UPLOAD_RETRIES && !done; attempt++) {
            try {
              const res = await fetch(`/api/amberxvid/recordings?id=${job.id}&seq=${seq}`, {
                method: "PUT",
                headers: { "Content-Type": "application/octet-stream" },
                body: blob,
              });
              if (res.ok) {
                done = true;
              } else if (res.status >= 400 && res.status !== 429 && res.status < 500) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                failCapture(`Upload rejected — ${body?.error ?? `status ${res.status}`}`);
                return;
              } else {
                await sleep(600 * (attempt + 1));
              }
            } catch {
              await sleep(600 * (attempt + 1));
            }
          }
          if (!done) {
            failCapture("Upload failed after retries — capture discarded");
            return;
          }
          job.queue.shift();
          job.nextSeq = seq + 1;
          setBytesUploaded((p) => p + blob.size);
          continue;
        }
        if (job.stopped && !job.finalized) {
          job.finalized = true;
          const res = await fetch("/api/amberxvid/recordings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "finalize", id: job.id, durationS: job.finalDurationS }),
          });
          const body = (await res.json().catch(() => null)) as
            | { ok?: boolean; manifest?: RecordingManifest; error?: string }
            | null;
          if (!res.ok || !body?.ok || !body.manifest) {
            failCapture(`Save failed — ${body?.error ?? `status ${res.status}`}`);
            return;
          }
          jobRef.current = null;
          setStatus(streamRef.current ? "preview" : "idle");
          setSavedTick((t) => t + 1);
          configRef.current.notify(
            `Capture saved — ${fmtClock(job.finalDurationS * 1000)} · ${fmtBytes(body.manifest.sizeBytes)}`
          );
          if (job.localParts && job.localParts.length > 0) {
            const m = body.manifest;
            const blob = new Blob(job.localParts, { type: m.mimeType || "video/webm" });
            job.localParts = null;
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${(m.title || m.id).replace(/[^\w.-]+/g, "_")}.${m.mimeType.includes("mp4") ? "mp4" : "webm"}`;
            a.click();
            // The click only borrows the URL; give the save dialog a grace window.
            window.setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
            configRef.current.notify("Local copy downloaded");
          }
          break;
        }
        break;
      }
    } finally {
      job.sending = false;
    }
  }, [failCapture]);

  /* --------------------------------- controls -------------------------------- */

  const start = React.useCallback(async (): Promise<void> => {
    if (engineActive(statusRef.current)) return;
    if (typeof MediaRecorder === "undefined") {
      setStatus("error");
      setError("This browser has no MediaRecorder — recording is not possible here");
      configRef.current.notify("This browser has no MediaRecorder");
      return;
    }
    setError(null);
    setStatus("starting");

    try {
      if (!streamRef.current) await acquire(videoDeviceId, audioDeviceId);
    } catch {
      setStatus("error");
      setError("No camera could be opened");
      configRef.current.notify("No camera could be opened");
      return;
    }
    const media = streamRef.current!;
    const cfg = configRef.current;
    const mimeType = pickMimeType();
    const bitrates = QUALITY_BITRATES[cfg.quality] ?? QUALITY_BITRATES.high;
    // Report what the camera actually granted, not what was asked for.
    const trackSettings = media.getVideoTracks()[0]?.getSettings() ?? {};
    const { w, h } = parseResolution(cfg.resolution);
    const micLive = cfg.micOn && media.getAudioTracks().length > 0;

    let recordingId: string;
    try {
      const res = await fetch("/api/amberxvid/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "begin",
          title: "",
          mimeType,
          width: trackSettings.width ?? w,
          height: trackSettings.height ?? h,
          quality: cfg.quality,
          micEnabled: micLive,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; manifest?: RecordingManifest; error?: string }
        | null;
      if (!res.ok || !body?.ok || !body.manifest) {
        throw new Error(body?.error ?? `status ${res.status}`);
      }
      recordingId = body.manifest.id;
    } catch (e) {
      setStatus(streamRef.current ? "preview" : "idle");
      configRef.current.notify(`Could not start — ${e instanceof Error ? e.message : "store unreachable"}`);
      return;
    }

    const job: UploadJob = {
      id: recordingId,
      nextSeq: 0,
      queue: [],
      sending: false,
      stopped: false,
      finalized: false,
      failed: false,
      finalDurationS: 0,
      localParts: cfg.saveTo === "library+download" ? [] : null,
    };
    jobRef.current = job;
    setBytesRecorded(0);
    setBytesUploaded(0);
    setElapsedMs(0);
    accumMsRef.current = 0;
    segStartRef.current = Date.now();

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(media, {
        mimeType,
        videoBitsPerSecond: bitrates.video,
        audioBitsPerSecond: bitrates.audio,
      });
    } catch {
      failCapture("MediaRecorder refused the configuration");
      return;
    }
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0 && jobRef.current === job && !job.failed) {
        job.queue.push(e.data);
        job.localParts?.push(e.data);
        setBytesRecorded((p) => p + e.data.size);
        void pump();
      }
    };
    recorder.onstop = () => {
      if (jobRef.current === job && !job.failed) {
        job.stopped = true;
        void pump();
      }
    };
    recorder.onerror = () => failCapture("MediaRecorder failed mid-capture");
    recorderRef.current = recorder;
    recorder.start(TIMESLICE_MS);
    setStatus("recording");
    cfg.notify(`Recording — ${trackSettings.width ?? w}×${trackSettings.height ?? h} · ${cfg.quality}${micLive ? "" : " · no mic"}`);
  }, [acquire, audioDeviceId, failCapture, pump, videoDeviceId]);

  const stop = React.useCallback((): void => {
    const recorder = recorderRef.current;
    const job = jobRef.current;
    if (!recorder || !job || recorder.state === "inactive") return;
    if (statusRef.current === "recording") {
      accumMsRef.current += Date.now() - segStartRef.current;
    }
    job.finalDurationS = accumMsRef.current / 1000;
    setStatus("finishing");
    recorderRef.current = null;
    recorder.stop(); // flushes the final dataavailable, then onstop → pump → finalize
  }, []);

  const pause = React.useCallback((): void => {
    const recorder = recorderRef.current;
    if (!recorder || statusRef.current !== "recording") return;
    recorder.pause();
    accumMsRef.current += Date.now() - segStartRef.current;
    setStatus("paused");
    configRef.current.notify("Recording paused");
  }, []);

  const resume = React.useCallback((): void => {
    const recorder = recorderRef.current;
    if (!recorder || statusRef.current !== "paused") return;
    recorder.resume();
    segStartRef.current = Date.now();
    setStatus("recording");
    configRef.current.notify("Recording resumed");
  }, []);

  /* Unmount: kill tracks, and abort any open upload so the store stays clean.
     sendBeacon because a fetch would be cancelled with the page. */
  React.useEffect(() => {
    return () => {
      const job = jobRef.current;
      if (job && !job.finalized) {
        navigator.sendBeacon(
          "/api/amberxvid/recordings",
          new Blob([JSON.stringify({ action: "abort", id: job.id })], { type: "application/json" })
        );
      }
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* already gone */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    status,
    error,
    stream,
    videoDevices,
    audioDevices,
    videoDeviceId,
    audioDeviceId,
    setVideoDeviceId,
    setAudioDeviceId,
    hasAudioTrack,
    elapsedMs,
    bytesRecorded,
    bytesUploaded,
    savedTick,
    enableCamera,
    disableCamera,
    start,
    stop,
    pause,
    resume,
  };
}

/* ----------------------------------- panel ------------------------------------ */

export interface RecorderPanelProps {
  engine: BrowserRecorderEngine;
  micOn: boolean;
  onMicToggle: () => void;
  quality: string;
  resolution: string;
  /** True hands the record action to the tray service — shown honestly. */
  backgroundArmed: boolean;
  /** True while the TRAY service owns an active background capture. */
  trayActive: boolean;
  /** Bumps when the tray finalizes a capture — refreshes the recent strip. */
  refreshTick: number;
  /** Opens a capture in the library player (P5) — the recent strip's play action. */
  onPlay: (id: string) => void;
}

type RecordingsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; recordings: RecordingManifest[] };

const STATUS_CHIP: Record<RecorderStatus, { label: string; kind: "dim" | "ok" | "warn" | "err" | "accent" }> = {
  idle: { label: "camera off", kind: "dim" },
  preview: { label: "preview", kind: "ok" },
  starting: { label: "starting", kind: "warn" },
  recording: { label: "recording", kind: "err" },
  paused: { label: "paused", kind: "warn" },
  finishing: { label: "saving", kind: "accent" },
  error: { label: "error", kind: "err" },
};

export default function RecorderPanel({
  engine,
  micOn,
  onMicToggle,
  quality,
  resolution,
  backgroundArmed,
  trayActive,
  refreshTick,
  onPlay,
}: RecorderPanelProps) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const { openCtx, ctxMenu } = useCtx();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [recState, setRecState] = React.useState<RecordingsState>({ kind: "loading" });

  const active = engineActive(engine.status);

  /* live preview attachment */
  React.useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== engine.stream) {
      el.srcObject = engine.stream;
    }
  }, [engine.stream, engine.status]);

  /* recent captures — refetched on every finalized save */
  const loadRecordings = React.useCallback(async () => {
    try {
      const res = await fetch("/api/amberxvid/recordings");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setRecState({ kind: "error", message: body?.error ?? `library answered ${res.status}` });
        return;
      }
      const body = (await res.json()) as { recordings: RecordingManifest[] };
      setRecState({ kind: "ready", recordings: body.recordings.filter((r) => r.endedAt !== null) });
    } catch {
      setRecState({ kind: "error", message: "the library store did not answer" });
    }
  }, []);

  React.useEffect(() => {
    void loadRecordings();
  }, [loadRecordings, engine.savedTick, refreshTick]);

  const captureMenu = (r: RecordingManifest): CtxItem[] => [
    { label: "Play in the library", onClick: () => onPlay(r.id) },
    "---",
    {
      label: "Copy recording id",
      onClick: () => {
        void navigator.clipboard.writeText(r.id);
        toast("Recording id copied");
      },
    },
  ];

  const chip = STATUS_CHIP[engine.status];
  const recPulse =
    engine.status === "recording" && intensity !== "off"
      ? {
          "@keyframes gxvRecDot": { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.35 } },
          animation: `gxvRecDot ${intensity === "maximum" ? 0.7 : 1.2}s ease-in-out infinite`,
        }
      : {};

  const uploadPct =
    engine.bytesRecorded > 0 ? Math.min(100, (engine.bytesUploaded / engine.bytesRecorded) * 100) : 0;

  // Background armed hands record to the tray; a live tray capture owns the
  // device outright (the browser must not open it — the double-capture guard).
  const recordDisabled =
    backgroundArmed || trayActive || engine.status === "starting" || engine.status === "finishing";

  return (
    // `minHeight: min-content` rather than 0: squeezed into a short window the
    // panel used to shrink below its own sections, which then overflowed and
    // painted over whatever the stage rendered underneath (the member list).
    // Now it keeps its content height and the stage panel scrolls instead.
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, flex: "1 1 auto", minHeight: "min-content" }}>
      {/* header row: status + readouts */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, flexWrap: "wrap", rowGap: 0.5 }}>
        <Typography sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: GX.dim }}>
          Webcam recorder
        </Typography>
        <GxChip label={chip.label} kind={chip.kind} />
        {backgroundArmed && <GxChip label="background armed — tray owns record" kind="warn" />}
        {trayActive && <GxChip label="tray capture running" kind="err" />}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontFamily: GX.mono, fontSize: 12, color: active ? GX.ink : GX.dim, fontVariantNumeric: "tabular-nums" }}>
          {fmtClock(engine.elapsedMs)} · {fmtBytes(engine.bytesRecorded)}
        </Typography>
      </Box>

      {/* preview stage */}
      <Box
        sx={{
          position: "relative",
          flex: 1,
          minHeight: 180,
          borderRadius: 1.5,
          overflow: "hidden",
          bgcolor: "#000",
          border: `1px solid ${engine.status === "recording" ? gxa(GX.err, "88") : GX.edge}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Box
          component="video"
          ref={videoRef}
          autoPlay
          muted
          playsInline
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            transform: "scaleX(-1)", // mirror — what a webcam preview should feel like
            display: engine.stream ? "block" : "none",
          }}
        />
        {!engine.stream && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.25, p: 3, textAlign: "center" }}>
            <GizmoXMark size={44} glow={false} />
            <Typography sx={{ fontSize: 12.5, color: GX.dim, maxWidth: 380 }}>
              {engine.status === "error" && engine.error
                ? engine.error
                : "The camera is off. Enable it for a live preview — recording asks the browser for permission the first time."}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<CameraIcon />}
              onClick={() => void engine.enableCamera()}
              data-el-id="amberxvid:recorder:enable-camera"
            >
              {engine.status === "error" ? "Try again" : "Enable camera"}
            </Button>
          </Box>
        )}
        {active && (
          <Box
            sx={{
              position: "absolute",
              top: 10,
              left: 10,
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 1,
              py: 0.4,
              borderRadius: 1,
              bgcolor: "rgba(0,0,0,0.55)",
            }}
          >
            <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: engine.status === "paused" ? GX.warn : GX.err, ...recPulse }} />
            <Typography sx={{ fontFamily: GX.mono, fontSize: 11, color: "#fff", letterSpacing: 1 }}>
              {engine.status === "paused" ? "PAUSED" : engine.status === "finishing" ? "SAVING" : "REC"}{" "}
              {fmtClock(engine.elapsedMs)}
            </Typography>
          </Box>
        )}
        {engine.stream && (
          <Box sx={{ position: "absolute", bottom: 8, right: 10, opacity: 0.5, pointerEvents: "none" }} aria-hidden>
            <GizmoXMark size={20} glow={false} ring="transparent" />
          </Box>
        )}
      </Box>

      {/* upload progress — only meaningful while chunks are in flight */}
      {(active || engine.status === "error") && engine.bytesRecorded > 0 && (
        <Box sx={{ flexShrink: 0 }}>
          <LinearProgress
            variant="determinate"
            value={uploadPct}
            sx={{ height: 4, borderRadius: 2, "& .MuiLinearProgress-bar": { transition: intensity === "off" ? "none" : undefined } }}
          />
          <Typography sx={{ fontFamily: GX.mono, fontSize: 10, color: GX.dim, mt: 0.25 }}>
            uploaded {fmtBytes(engine.bytesUploaded)} of {fmtBytes(engine.bytesRecorded)}
          </Typography>
        </Box>
      )}

      {/* controls */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", flexShrink: 0 }}>
        {!active ? (
          <Tooltip
            title={
              backgroundArmed
                ? "Background mode is armed — the record action belongs to the tray service"
                : trayActive
                  ? "The tray service owns the camera — stop the background capture first"
                  : `Record at ${resolution} · ${quality}`
            }
          >
            <span>
              <Button
                size="small"
                variant="contained"
                color="error"
                startIcon={<RecordIcon />}
                disabled={recordDisabled}
                onClick={() => void engine.start()}
                data-el-id="amberxvid:recorder:record"
              >
                Record
              </Button>
            </span>
          </Tooltip>
        ) : (
          <>
            <Button
              size="small"
              variant="contained"
              color="error"
              startIcon={<StopIcon />}
              disabled={engine.status === "finishing" || engine.status === "starting"}
              onClick={engine.stop}
              data-el-id="amberxvid:recorder:stop"
            >
              Stop
            </Button>
            {engine.status === "paused" ? (
              <Button size="small" variant="outlined" startIcon={<ResumeIcon />} onClick={engine.resume}>
                Resume
              </Button>
            ) : (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PauseIcon />}
                disabled={engine.status !== "recording"}
                onClick={engine.pause}
              >
                Pause
              </Button>
            )}
          </>
        )}

        <Tooltip title={micOn ? "Mic is live — click to mute" : "Mic is muted — click to unmute"}>
          <Button
            size="small"
            variant="outlined"
            color={micOn ? "primary" : "warning"}
            startIcon={micOn ? <MicOnIcon /> : <MicOffIcon />}
            onClick={onMicToggle}
          >
            {micOn ? "Mic on" : "Muted"}
          </Button>
        </Tooltip>
        {engine.stream && !engine.hasAudioTrack && <GxChip label="no mic on this stream" kind="warn" />}

        {engine.stream && !active && (
          <Button size="small" variant="outlined" startIcon={<CameraOffIcon />} onClick={engine.disableCamera}>
            Camera off
          </Button>
        )}

        <Box sx={{ flex: 1 }} />

        <TextField
          select
          size="small"
          label="Camera"
          value={engine.videoDevices.some((d) => d.deviceId === engine.videoDeviceId) ? engine.videoDeviceId : ""}
          onChange={(e) => engine.setVideoDeviceId(e.target.value)}
          disabled={active || engine.videoDevices.length === 0}
          sx={{ minWidth: 150, flex: "0 1 190px" }}
          // `displayEmpty` renders "Default camera" for the empty value, but the
          // label only shrinks for a non-empty one — without this it sat ON TOP
          // of the value text ("Defaultacamera").
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">Default camera</MenuItem>
          {engine.videoDevices.map((d, i) => (
            <MenuItem key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Camera ${i + 1}`}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Microphone"
          value={engine.audioDevices.some((d) => d.deviceId === engine.audioDeviceId) ? engine.audioDeviceId : ""}
          onChange={(e) => engine.setAudioDeviceId(e.target.value)}
          disabled={active || engine.audioDevices.length === 0}
          sx={{ minWidth: 150, flex: "0 1 190px" }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">Default microphone</MenuItem>
          {engine.audioDevices.map((d, i) => (
            <MenuItem key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {/* recent captures — real store rows or an honest empty state */}
      <Box sx={{ flexShrink: 0 }}>
        <Typography sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: GX.dim, mb: 0.5 }}>
          Recent captures{recState.kind === "ready" ? ` · ${recState.recordings.length}` : ""}
        </Typography>
        {recState.kind === "loading" ? (
          <Typography sx={{ fontSize: 11.5, color: GX.dim }}>Loading the library…</Typography>
        ) : recState.kind === "error" ? (
          <Typography sx={{ fontSize: 11.5, color: GX.err }}>{recState.message}</Typography>
        ) : recState.recordings.length === 0 ? (
          <Typography sx={{ fontSize: 11.5, color: GX.dim }}>
            No captures yet — record one above and it lands here and in the library, ready to
            replay. Click any capture to play it.
          </Typography>
        ) : (
          <Box sx={{ display: "flex", gap: 1, overflowX: "auto", pb: 0.5 }}>
            {recState.recordings.slice(0, 12).map((r) => (
              <Box
                key={r.id}
                onClick={() => onPlay(r.id)}
                onContextMenu={(e) => openCtx(e, `Capture · ${r.title}`, captureMenu(r))}
                sx={{
                  cursor: "pointer",
                  flexShrink: 0,
                  width: 132,
                  borderRadius: 1,
                  border: `1px solid ${GX.edge}`,
                  overflow: "hidden",
                  bgcolor: GX.panel2,
                  transition: intensity === "off" ? "none" : "border-color 150ms, transform 150ms",
                  "&:hover": {
                    borderColor: gxa(GX.accent, "66"),
                    transform: intensity === "maximum" ? "translateY(-2px)" : undefined,
                  },
                }}
              >
                {r.thumbnail ? (
                  <Box
                    component="img"
                    src={`/api/amberxvid/recordings/${r.id}/file?kind=thumb`}
                    alt={r.title}
                    sx={{ width: "100%", height: 74, objectFit: "cover", display: "block", bgcolor: "#000" }}
                  />
                ) : (
                  <Box sx={{ width: "100%", height: 74, display: "grid", placeItems: "center", bgcolor: "#000" }}>
                    <GizmoXMark size={26} glow={false} />
                  </Box>
                )}
                <Box sx={{ p: 0.75 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.title}
                  </Typography>
                  <Typography sx={{ fontFamily: GX.mono, fontSize: 9.5, color: GX.dim }}>
                    {fmtClock(r.durationS * 1000)} · {fmtBytes(r.sizeBytes)}
                    {r.micEnabled ? "" : " · no mic"}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {ctxMenu}
    </Box>
  );
}
