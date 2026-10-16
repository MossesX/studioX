/**
 * @file The run wire's client half — POST the workflow, walk the NDJSON
 * stream, hand each `RunEvent` to the caller. The abort controller is the
 * caller's, so a Stop button and an unmount both end the stream the same
 * way — and the server's engine sees the abort and stops scraping/billing.
 *
 * The client CHOOSES the run id and rides it with the request: pause /
 * resume / speed post to `/api/firecrawl/control` addressed by that id, so a
 * control can land before the stream's first event has come back. Stored
 * lists and recordings ride along too — `foreach` reads lists by name and
 * `record` replays recordings by id, and the client store is where both live.
 */
"use client";

import type { LinkList, Recording, RunEvent, Workflow } from "./types";

export interface RunOptions {
  readonly runId: string;
  readonly analyzeBudget: number;
  readonly startAt?: number;
  readonly stepDelayMs?: number;
  readonly sessionId?: string;
  readonly lists?: readonly LinkList[];
  readonly recordings?: readonly Recording[];
}

export async function streamRun(
  workflow: Workflow,
  opts: RunOptions,
  signal: AbortSignal,
  onEvent: (event: RunEvent) => void
): Promise<void> {
  const res = await fetch("/api/firecrawl/run", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workflow,
      analyzeBudget: opts.analyzeBudget,
      runId: opts.runId,
      startAt: opts.startAt ?? 0,
      stepDelayMs: opts.stepDelayMs ?? 0,
      sessionId: opts.sessionId,
      lists: opts.lists ?? [],
      recordings: opts.recordings ?? []
    })
  });
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body — the status is what we know.
    }
    onEvent({ type: "error", message });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line) as RunEvent);
        } catch {
          // A malformed frame is skipped; the stream continues.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Steer a live run — pause / resume / stop / speed(value ms). */
export async function controlRun(
  runId: string,
  op: "pause" | "resume" | "stop" | "speed",
  value?: number
): Promise<boolean> {
  try {
    const res = await fetch("/api/firecrawl/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, op, value })
    });
    return res.ok;
  } catch {
    return false;
  }
}
