"use client";

/**
 * @file THE OTHER DIRECTION (P12) — recording a stream you are WATCHING.
 *
 * ---------------------------------------------------------------------------
 * TWO RECORDERS, ONE LIBRARY, AND WHY THEY ARE NOT THE SAME CODE
 * ---------------------------------------------------------------------------
 * A stream can now be recorded from both seats, and the two are genuinely
 * different machines rather than one machine with a flag:
 *
 *   HOST   → SERVER-SIDE (P10). The media server taps the SFU's own copy of the
 *            broadcast and writes it with ffmpeg into the host's vault. The
 *            host's machine spends no CPU and no uplink on it, everybody in the
 *            room sees `REC` because the fact rides the media snapshot, and the
 *            file exists even if the host's browser dies mid-stream.
 *   VIEWER → CLIENT-SIDE, this file. There is nothing on the server to tap on a
 *            viewer's behalf: the bytes they want are the bytes their own
 *            browser is already decoding. So `MediaRecorder` runs over the
 *            CONSUMED track and the result is chunk-uploaded into the VIEWER's
 *            own vault — their recording, their library, their quota.
 *
 * Trying to serve the second case from the first would mean the media server
 * writing a second file per interested viewer, all of them identical; and
 * trying to serve the first from the second would put a broadcaster's archive
 * at the mercy of their own tab. Two engines is the smaller answer.
 *
 * ---------------------------------------------------------------------------
 * IT IS THE SAME DOOR INTO THE STORE
 * ---------------------------------------------------------------------------
 * `begin` → seq-ordered `PUT` chunks → `finalize`, against
 * `/api/amberxvid/recordings` — the identical protocol the P3 webcam engine
 * uses, which is what makes this quota-charged, journaled, thumbnailed and
 * visible in the Library with no new server code at all. `appendChunk` calls
 * `assertVaultQuota` per chunk, so a viewer who is full is refused mid-capture
 * with the store's own sentence and the recorder stops honestly rather than
 * buffering into a wall.
 *
 * The manifest is written with `engine: "browser"`, and correctly: a browser is
 * exactly what recorded it. What it captured is named in the TITLE, which is
 * what the Library shows.
 *
 * ---------------------------------------------------------------------------
 * THE ONE HONEST LIMITATION
 * ---------------------------------------------------------------------------
 * A `MediaRecorder` is bound to the tracks it was handed. When the media leg
 * reconnects (P11), the viewer's consumers are rebuilt and the old tracks END —
 * the recorder cannot follow, because the thing it was recording no longer
 * exists. So a track ending STOPS the capture and finalizes what was collected,
 * with a toast that says so. What it never does is sit there apparently
 * recording a stream that stopped arriving: a file that silently ends is worse
 * than a message.
 *
 * This is a hook rather than a component so the room window can own the button
 * and the toolbar can read the state, exactly like `useBrowserRecorder`.
 */

import * as React from "react";
import { getAmberxvidPrefs } from "../settings";
import { resolveRecordMime } from "./prefs";
import type { RecordingManifest } from "./types";

/* --------------------------------- contracts ---------------------------------- */

export type IncomingStatus = "idle" | "starting" | "recording" | "finishing" | "error";

export interface IncomingRecorder {
  status: IncomingStatus;
  error: string | null;
  /** True while this engine owns a capture — what a button renders from. */
  active: boolean;
  elapsedMs: number;
  bytesRecorded: number;
  bytesUploaded: number;
  /** The finished manifest of the last capture, for a "saved" line. */
  lastSaved: RecordingManifest | null;
  /** Begin recording an incoming stream under `title`. */
  start: (stream: MediaStream, title: string) => Promise<void>;
  /** Stop, flush and finalize. Safe to call when idle. */
  stop: () => void;
}

/** One chunk every 3 s — the same timeslice the webcam engine uses, and for
 *  the same reason: each request stays inside a real uplink's patience. */
const TIMESLICE_MS = 3000;
const UPLOAD_RETRIES = 3;
/** A consumed stream is already encoded for the network; re-encoding it hard
 *  buys nothing, so this is deliberately the middle preset. */
const VIDEO_BITRATE = 2_500_000;
const AUDIO_BITRATE = 96_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Best-first, and the order is the point: VP9 is the smallest for the same
 * picture, VP8 is the widest, and MP4 is last because a browser that offers it
 * usually offers a WebM that costs less bandwidth.
 */
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
] as const;

/**
 * The container this recording is written in — the member's PLAYBACK setting
 * (P16) filtered through what this browser can actually encode.
 *
 * The choice and the capability are answered together in `resolveRecordMime`
 * (`./prefs`), because "Automatic" and "MP4 asked for on a browser with no MP4
 * encoder" are the same situation and both have to land on a container that
 * records rather than one that throws.
 */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  return resolveRecordMime(
    getAmberxvidPrefs().viewerRecordFormat,
    (m) => MediaRecorder.isTypeSupported(m),
    MIME_CANDIDATES,
  );
}

interface Job {
  id: string;
  nextSeq: number;
  queue: Blob[];
  sending: boolean;
  stopped: boolean;
  finalized: boolean;
  failed: boolean;
  finalDurationS: number;
}

/* ----------------------------------- engine ----------------------------------- */

export function useIncomingRecorder({
  notify,
}: {
  notify: (message: string, detail?: string) => void;
}): IncomingRecorder {
  const [status, setStatus] = React.useState<IncomingStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const [bytesRecorded, setBytesRecorded] = React.useState(0);
  const [bytesUploaded, setBytesUploaded] = React.useState(0);
  const [lastSaved, setLastSaved] = React.useState<RecordingManifest | null>(null);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const jobRef = React.useRef<Job | null>(null);
  const startedAtRef = React.useRef(0);
  const notifyRef = React.useRef(notify);
  notifyRef.current = notify;
  /** Track `ended` listeners, removed on every teardown path. */
  const detachRef = React.useRef<(() => void) | null>(null);

  /* the elapsed readout */
  React.useEffect(() => {
    if (status !== "recording") return;
    const t = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250);
    return () => clearInterval(t);
  }, [status]);

  const detach = React.useCallback(() => {
    detachRef.current?.();
    detachRef.current = null;
  }, []);

  /**
   * Drain the chunk queue in order. Sequential rather than parallel because
   * the store appends by `seq` and a duplicate of the LAST chunk is the only
   * retry it treats as idempotent — which is exactly what makes a lost
   * response safe and an out-of-order arrival not.
   */
  const pump = React.useCallback(async (): Promise<void> => {
    const job = jobRef.current;
    if (!job || job.sending || job.failed) return;
    job.sending = true;
    try {
      while (job.queue.length > 0) {
        const blob = job.queue[0];
        const seq = job.nextSeq;
        let sent = false;
        for (let attempt = 0; attempt < UPLOAD_RETRIES && !sent; attempt += 1) {
          try {
            const res = await fetch(`/api/amberxvid/recordings?id=${job.id}&seq=${seq}`, {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: blob,
            });
            if (res.ok) {
              sent = true;
              break;
            }
            // A refusal with a REASON (quota, size cap) is final — retrying it
            // three times just delays telling the viewer the truth.
            if (res.status === 413 || res.status === 409 || res.status === 403) {
              const json = (await res.json().catch(() => null)) as { error?: string } | null;
              throw new Error(json?.error ?? `the store refused the upload (${res.status})`);
            }
          } catch (err) {
            if (attempt === UPLOAD_RETRIES - 1) throw err;
            await sleep(400 * (attempt + 1));
          }
        }
        if (!sent) throw new Error("the chunk upload did not land");
        job.queue.shift();
        job.nextSeq = seq + 1;
        setBytesUploaded((b) => b + blob.size);
      }

      if (job.stopped && !job.finalized) {
        job.finalized = true;
        const res = await fetch("/api/amberxvid/recordings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "finalize", id: job.id, durationS: job.finalDurationS }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; manifest?: RecordingManifest; error?: string }
          | null;
        if (!res.ok || !json?.ok || !json.manifest) {
          throw new Error(json?.error ?? "the store could not finalize the recording");
        }
        jobRef.current = null;
        setLastSaved(json.manifest);
        setStatus("idle");
        notifyRef.current(
          "Saved to your library",
          `"${json.manifest.title}" — play it from the Library`,
        );
      }
    } catch (err) {
      job.failed = true;
      const message = err instanceof Error ? err.message : "the upload failed";
      setError(message);
      setStatus("error");
      notifyRef.current("Recording failed", message);
      // Give the half-written capture back rather than leaving an open
      // manifest in the store forever.
      void fetch("/api/amberxvid/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abort", id: job.id }),
      }).catch(() => undefined);
      jobRef.current = null;
    } finally {
      job.sending = false;
    }
  }, []);

  const stop = React.useCallback((): void => {
    const recorder = recorderRef.current;
    const job = jobRef.current;
    if (!recorder || !job || job.stopped) return;
    job.stopped = true;
    job.finalDurationS = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    setStatus("finishing");
    detach();
    try {
      // Flushes one last `dataavailable`, then `onstop` pumps and finalizes.
      recorder.stop();
    } catch {
      void pump();
    }
    recorderRef.current = null;
  }, [detach, pump]);

  const start = React.useCallback(
    async (stream: MediaStream, title: string): Promise<void> => {
      if (jobRef.current) return;
      if (typeof MediaRecorder === "undefined") {
        setStatus("error");
        setError("This browser has no MediaRecorder — recording is not possible here");
        notifyRef.current("Can't record", "this browser has no MediaRecorder");
        return;
      }
      const videoTrack = stream.getVideoTracks()[0] ?? null;
      if (!videoTrack) {
        notifyRef.current("Nothing to record yet", "wait for the picture to arrive");
        return;
      }

      setStatus("starting");
      setError(null);
      setBytesRecorded(0);
      setBytesUploaded(0);
      setElapsedMs(0);

      const settings = videoTrack.getSettings();
      const mimeType = pickMimeType();
      let id: string;
      try {
        const res = await fetch("/api/amberxvid/recordings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "begin",
            title,
            mimeType,
            width: Math.round(settings.width ?? 1280),
            height: Math.round(settings.height ?? 720),
            quality: "medium",
            micEnabled: stream.getAudioTracks().length > 0,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; manifest?: RecordingManifest; error?: string }
          | null;
        if (!res.ok || !json?.ok || !json.manifest) {
          throw new Error(json?.error ?? "the store refused a new recording");
        }
        id = json.manifest.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : "the store refused a new recording";
        setStatus("error");
        setError(message);
        notifyRef.current("Can't record", message);
        return;
      }

      const job: Job = {
        id,
        nextSeq: 0,
        queue: [],
        sending: false,
        stopped: false,
        finalized: false,
        failed: false,
        finalDurationS: 0,
      };
      jobRef.current = job;

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: VIDEO_BITRATE,
          audioBitsPerSecond: AUDIO_BITRATE,
        });
      } catch {
        jobRef.current = null;
        setStatus("error");
        setError("MediaRecorder refused this stream");
        notifyRef.current("Can't record", "MediaRecorder refused the incoming stream");
        void fetch("/api/amberxvid/recordings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "abort", id }),
        }).catch(() => undefined);
        return;
      }

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size === 0) return;
        job.queue.push(e.data);
        setBytesRecorded((b) => b + e.data.size);
        void pump();
      };
      recorder.onstop = () => void pump();
      recorder.onerror = () => {
        notifyRef.current("Recording stopped", "MediaRecorder failed mid-capture");
        stop();
      };

      // The honest limitation, wired: a consumer rebuilt by the P11 reconnect
      // ends these tracks, and a recorder cannot follow a track that ended.
      const onEnded = (): void => {
        notifyRef.current("Recording stopped", "the incoming stream ended — saving what was captured");
        stop();
      };
      for (const track of stream.getTracks()) track.addEventListener("ended", onEnded);
      detachRef.current = () => {
        for (const track of stream.getTracks()) track.removeEventListener("ended", onEnded);
      };

      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start(TIMESLICE_MS);
      setStatus("recording");
      notifyRef.current("Recording this stream", "it lands in YOUR library when you stop");
    },
    [pump, stop],
  );

  /* Unmount mid-capture: abort the open upload so the store keeps no orphan.
     `sendBeacon` because a fetch started in an unmount does not survive the
     page going away — the same trick the webcam engine uses. */
  React.useEffect(
    () => () => {
      detachRef.current?.();
      const job = jobRef.current;
      const recorder = recorderRef.current;
      try {
        recorder?.stop();
      } catch {
        /* already stopped */
      }
      if (job && !job.finalized) {
        navigator.sendBeacon?.(
          "/api/amberxvid/recordings",
          new Blob([JSON.stringify({ action: "abort", id: job.id })], { type: "application/json" }),
        );
      }
    },
    [],
  );

  return {
    status,
    error,
    active: status === "starting" || status === "recording" || status === "finishing",
    elapsedMs,
    bytesRecorded,
    bytesUploaded,
    lastSaved,
    start,
    stop,
  };
}
