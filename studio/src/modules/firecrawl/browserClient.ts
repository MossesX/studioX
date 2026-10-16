/**
 * @file The browser-session wire's client half.
 *
 * `streamSession` walks the NDJSON `BrowserEvent` stream (frames, navs,
 * actions, recording state) exactly the way `runClient` walks a run; `op`
 * posts one `BrowserOpRequest` and returns the JSON answer. The viewer pane
 * and the recorder are both built out of just these two calls.
 */
"use client";

import type { BrowserAction, BrowserEvent, BrowserOpRequest } from "./types";

export async function streamSession(
  sessionId: string,
  signal: AbortSignal,
  onEvent: (event: BrowserEvent) => void
): Promise<void> {
  const res = await fetch(`/api/firecrawl/browser?session=${encodeURIComponent(sessionId)}`, { signal });
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `HTTP ${res.status}` });
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
          onEvent(JSON.parse(line) as BrowserEvent);
        } catch {
          // A malformed frame is skipped; the stream continues.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface BrowserOpResult {
  readonly ok?: boolean;
  readonly error?: string;
  readonly sessionId?: string;
  readonly url?: string;
  readonly action?: BrowserAction;
  readonly actions?: readonly BrowserAction[];
  readonly startUrl?: string;
  readonly urls?: readonly string[];
}

export async function browserOp(body: BrowserOpRequest): Promise<BrowserOpResult> {
  try {
    const res = await fetch("/api/firecrawl/browser", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return (await res.json()) as BrowserOpResult;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Fire-and-forget action post — pointer/keyboard forwarding's fast path. */
export function sendAction(sessionId: string, action: BrowserAction): void {
  void browserOp({ op: "act", sessionId, action });
}
