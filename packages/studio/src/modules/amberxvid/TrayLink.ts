"use client";

/**
 * @file `useTrayLink` — the module's live link to the Windows tray service
 * (the background recording engine, P4) over `/api/amberxvid/tray`.
 *
 * Every 4 s (and immediately when the browser engine's recording state flips)
 * it POSTs a `sync`: the loaded profile becomes the capture owner, the live
 * recorder settings ride along, and `browserRecording` is the double-capture
 * guard the tray honours — so the heartbeat and the guard are one request.
 * The response is real liveness (pid + fresh heartbeat, never a green light
 * that lies) plus the tray's own status: state, elapsed/size readouts, the
 * background-mode request a tray-menu toggle raises, and the last capture it
 * finalized into the library.
 *
 * `command()` queues record/background commands for the tray's next poll;
 * `startService()` spawns the process (Windows dev only — the route refuses
 * elsewhere, and the hook reports it honestly).
 */

import * as React from "react";
import type { TrayCommandKind, TrayServiceStatus } from "./lib/types";

export interface TrayLinkInput {
  resolution: string;
  quality: string;
  micOn: boolean;
  /** True while the BROWSER engine owns the device — the double-capture guard. */
  browserRecording: boolean;
  backgroundArmed: boolean;
  /** Module announcer (the toast) — command outcomes are always visible. */
  notify: (message: string) => void;
}

export interface TrayLink {
  /** Null until the first sync answers — render an honest "checking…". */
  running: boolean | null;
  /** Why the service is down, when it is (from the route's liveness call). */
  why: string | null;
  status: TrayServiceStatus | null;
  /** True while the tray owns an active capture (recording or paused). */
  trayActive: boolean;
  /** `text` belongs to the `alert` kind alone (P13) — the ring balloon. */
  command: (cmd: TrayCommandKind, text?: string) => Promise<boolean>;
  startService: () => Promise<void>;
  /** Bumps when the tray finalizes a capture — refresh keys hang off it. */
  finalizedTick: number;
}

interface TrayReply {
  ok: boolean;
  running?: boolean;
  why?: string | null;
  status?: TrayServiceStatus | null;
  error?: string;
}

const SYNC_MS = 4000;

export function useTrayLink(input: TrayLinkInput): TrayLink {
  const [running, setRunning] = React.useState<boolean | null>(null);
  const [why, setWhy] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<TrayServiceStatus | null>(null);
  const [finalizedTick, setFinalizedTick] = React.useState(0);

  const inputRef = React.useRef(input);
  inputRef.current = input;
  const lastFinalizedRef = React.useRef<string | null>(null);
  const aliveRef = React.useRef(true);

  const apply = React.useCallback((reply: TrayReply | null) => {
    if (!aliveRef.current || !reply || !reply.ok) return;
    setRunning(reply.running === true);
    setWhy(reply.why ?? null);
    const next = reply.status ?? null;
    setStatus(next);
    // Fire only on a CHANGE after the first observation — a capture finalized
    // before this page loaded is history, not news.
    const fin = next?.lastFinalized?.id ?? null;
    const prev = lastFinalizedRef.current;
    lastFinalizedRef.current = fin ?? "";
    if (prev !== null && fin && fin !== prev) {
      setFinalizedTick((t) => t + 1);
      inputRef.current.notify("A background capture landed in the library");
    }
  }, []);

  const post = React.useCallback(async (body: Record<string, unknown>): Promise<TrayReply | null> => {
    try {
      const res = await fetch("/api/amberxvid/tray", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await res.json().catch(() => null)) as TrayReply | null;
    } catch {
      return null;
    }
  }, []);

  const syncBody = React.useCallback((): Record<string, unknown> => {
    const cfg = inputRef.current;
    return {
      settings: { resolution: cfg.resolution, quality: cfg.quality, micOn: cfg.micOn },
      browserRecording: cfg.browserRecording,
      backgroundArmed: cfg.backgroundArmed,
    };
  }, []);

  const sync = React.useCallback(async () => {
    apply(await post({ action: "sync", ...syncBody() }));
  }, [apply, post, syncBody]);

  /* The heartbeat — ≥200 ms per house rule, cleared on unmount. */
  React.useEffect(() => {
    aliveRef.current = true;
    void sync();
    const t = window.setInterval(() => void sync(), SYNC_MS);
    return () => {
      aliveRef.current = false;
      window.clearInterval(t);
    };
  }, [sync]);

  /* The guard flag must reach the tray NOW, not a heartbeat later. */
  React.useEffect(() => {
    void sync();
  }, [input.browserRecording, input.backgroundArmed, sync]);

  const command = React.useCallback(
    async (cmd: TrayCommandKind, text?: string): Promise<boolean> => {
      const reply = await post({ action: "command", command: cmd, ...syncBody(), ...(text ? { text } : {}) });
      apply(reply);
      if (!reply?.ok) {
        // P13: an `alert` that cannot be delivered is NOT worth a toast. The
        // tray balloon exists because the tab is backgrounded, and the member
        // is not reading toasts either — telling them the tray is down would
        // only surface later, out of context, next to a ring they already
        // answered. Every other command still reports.
        if (cmd !== "alert") {
          inputRef.current.notify(reply?.error ?? "The tray service did not answer");
        }
        return false;
      }
      return true;
    },
    [apply, post, syncBody]
  );

  const startService = React.useCallback(async (): Promise<void> => {
    const reply = await post({ action: "start-service", ...syncBody() });
    if (!reply?.ok) {
      inputRef.current.notify(reply?.error ?? "The tray service could not be started");
      return;
    }
    inputRef.current.notify(reply.running ? "The tray service is already running" : "Tray service starting — watch for its icon");
    // Its first heartbeat lands within a poll; refresh a beat later.
    window.setTimeout(() => void sync(), 2500);
  }, [post, sync, syncBody]);

  const trayActive = status !== null && (status.state === "recording" || status.state === "paused");

  return { running, why, status, trayActive, command, startService, finalizedTick };
}
