"use client";

/**
 * @file The browser's transport — `/api/history`, and nothing else.
 *
 * Separate from `history.ts` for the reason every server/client split in this
 * tree is separate: `history.ts` imports `node:fs`, and a client component that
 * imported it would drag the filesystem into the browser bundle with tsc saying
 * nothing (the trap `gizmox-unarchived-tab` was written up for). The two halves
 * share the shape below and no code.
 */
import type { Instance } from "./engine";

export interface TrackedFile {
  readonly name: string;
  readonly live: string | null;
  readonly snapshots: number;
}

export interface HistoryAnswer {
  readonly root: string;
  readonly file?: string;
  readonly tracked: readonly TrackedFile[];
  readonly instances?: readonly Instance[];
  readonly error?: string;
}

async function get(url: string): Promise<HistoryAnswer> {
  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json()) as HistoryAnswer & { error?: string };
  // A 400 carries `error` and no roster; a "no snapshots" answer carries both.
  // Throwing only on the former keeps the empty state reachable.
  if (!response.ok && !body.tracked) {
    throw new Error(body.error ?? `history request failed (${response.status})`);
  }
  return body;
}

/** What history folders exist, and how deep each one is. */
export const fetchTracked = (): Promise<HistoryAnswer> => get("/api/history");

/** Every instance of one tracked file, oldest first, live last. */
export const fetchInstances = (file: string): Promise<HistoryAnswer> =>
  get(`/api/history?file=${encodeURIComponent(file)}`);
