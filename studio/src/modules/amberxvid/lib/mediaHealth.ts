"use client";

/**
 * @file P11 — the client's honest view of the media plane's availability.
 *
 * One shared POST helper whose refusals carry the closed `MediaFailure`
 * vocabulary (so a surface can tell `publish-denied` from a real fault), one
 * /health probe (via the app server's GET proxy — browsers never dial the
 * media server's HTTP port directly), one polling hook for the health
 * indicators (Stream Hub, call window, admin status line), and the backoff
 * schedule the reconnect loops share.
 *
 * THE DECISION this file implements the honest half of: there is NO
 * peer-to-peer fallback (`NO_FALLBACK_DECISION` in ./mediaContract). A down
 * media server is a named refusal and a reconnect loop — never a spinner
 * that does not resolve, and never a second media architecture.
 */

import * as React from "react";
import { MEDIA_FAILURE_USER_COPY, MEDIA_TIMING } from "./mediaContract";
import type { MediaFailure } from "./mediaContract";

/* ---------------------------------- failures ----------------------------------- */

const FAILURES = Object.keys(MEDIA_FAILURE_USER_COPY) as MediaFailure[];

function isMediaFailure(v: unknown): v is MediaFailure {
  return typeof v === "string" && (FAILURES as readonly string[]).includes(v);
}

/** A media-route refusal with its wire failure attached — what lets a caller
 *  treat `publish-denied` as information and everything else as a fault. */
export class MediaApiError extends Error {
  readonly failure: MediaFailure | null;

  constructor(message: string, failure: MediaFailure | null) {
    super(message);
    this.name = "MediaApiError";
    this.failure = failure;
  }
}

/** The P11 sentence for an error: the user copy when the failure is named in
 *  the closed vocabulary, the raw message otherwise. */
export function failureCopy(err: unknown): string {
  if (err instanceof MediaApiError && err.failure) return MEDIA_FAILURE_USER_COPY[err.failure];
  return err instanceof Error ? err.message : "the media service did not answer";
}

export function isPublishDenied(err: unknown): boolean {
  return err instanceof MediaApiError && err.failure === "publish-denied";
}

/** True for the two failures a reconnect loop can outlive — the server being
 *  away, or the media leg dying. Everything else is a refusal to respect. */
export function isReconnectable(err: unknown): boolean {
  return (
    err instanceof MediaApiError &&
    (err.failure === "server-unreachable" || err.failure === "transport-failed")
  );
}

/* ---------------------------------- the POST ------------------------------------ */

/**
 * The module's ONE media-route POST (the P6/P7 per-file copies now delegate
 * here). Throws `MediaApiError` on any refusal, carrying the route's
 * `failure` when it named one — the closed vocabulary crosses this helper
 * untranslated, exactly as it crosses the bridge.
 */
export async function mediaApiPost(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch("/api/amberxvid/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // The APP server did not answer — indistinguishable from the media plane
    // being off, and honestly reported the same way.
    throw new MediaApiError(MEDIA_FAILURE_USER_COPY["server-unreachable"], "server-unreachable");
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !json || json.ok !== true) {
    const failureRaw = json?.failure;
    const failure = isMediaFailure(failureRaw) ? failureRaw : null;
    const message =
      failure !== null
        ? MEDIA_FAILURE_USER_COPY[failure]
        : typeof json?.error === "string"
          ? json.error
          : "the media service did not answer";
    throw new MediaApiError(message, failure);
  }
  return json;
}

/* ---------------------------------- the probe ----------------------------------- */

export interface MediaHealth {
  up: boolean;
  /** The honest sentence when down; null while up. */
  message: string | null;
  /** Selected /health facts while up (rooms, participants, producers,
   *  consumers, recordings, pid, uptimeS) — what the admin line renders. */
  stats: Record<string, number> | null;
}

const DOWN: MediaHealth = {
  up: false,
  message: MEDIA_FAILURE_USER_COPY["server-unreachable"],
  stats: null,
};

/**
 * Ask the app server to ask the media server. Never throws and never hangs:
 * a probe that cannot answer inside `MEDIA_TIMING.healthProbeTimeoutMs` IS
 * the answer. This is what the join paths call FIRST, so a dead media server
 * costs one fast named refusal instead of a camera prompt and a spinner.
 */
export async function probeMediaHealth(): Promise<MediaHealth> {
  try {
    const res = await fetch("/api/amberxvid/media", {
      method: "GET",
      signal: AbortSignal.timeout(MEDIA_TIMING.healthProbeTimeoutMs + 2_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const media = json?.media as Record<string, unknown> | undefined;
    if (!res.ok || !media || media.up !== true) return DOWN;
    const stats: Record<string, number> = {};
    for (const key of ["rooms", "participants", "producers", "consumers", "recordings", "pid", "uptimeS"]) {
      const v = media[key];
      if (typeof v === "number") stats[key] = v;
    }
    return { up: true, message: null, stats };
  } catch {
    return DOWN;
  }
}

/* --------------------------------- the backoff ---------------------------------- */

/** Delay before reconnect attempt N — quick first retries, steady 15 s tail. */
export function reconnectDelayMs(attempt: number): number {
  const steps = MEDIA_TIMING.reconnectBackoffMs;
  return steps[Math.min(Math.max(attempt, 0), steps.length - 1)];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------- the hook ------------------------------------ */

/**
 * The health indicator's engine: probes on mount, then every
 * `MEDIA_TIMING.healthPollMs` while `active`, and again when the window
 * regains focus (the moment a person looks is the moment the answer should
 * be fresh). `health` is null until the first probe answers — an indicator
 * must render "checking…" honestly, never guess "online".
 */
export function useMediaHealth(active: boolean): MediaHealth | null {
  const [health, setHealth] = React.useState<MediaHealth | null>(null);

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const probe = (): void => {
      void probeMediaHealth().then((h) => {
        if (!cancelled) setHealth(h);
      });
    };
    probe();
    const timer = setInterval(probe, MEDIA_TIMING.healthPollMs);
    window.addEventListener("focus", probe);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", probe);
    };
  }, [active]);

  return health;
}
