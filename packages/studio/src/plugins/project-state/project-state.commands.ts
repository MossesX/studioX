"use client";

/**
 * @file The behaviour behind the project-state bar's one item — and the store
 * the screen reads the run's outcome from.
 *
 * The bar is DATA (`project-state-bar.ts`); the two meet only through the
 * command NAME `project-state.generate`. The handler POSTs
 * `/api/project-state` and parks the outcome — `{ sessionsDigested, fromCache,
 * generatedAt }` or the route's named error — in a one-value store the screen
 * subscribes to, so the result surfaces INLINE on the page that owns the
 * button. No `window.alert`, no toast dependency: a command fired from a bar
 * that might one day live on another surface must not assume any chrome
 * exists but its own store.
 *
 * The store is `selection.ts`'s shape (diff-browser): module-scope value,
 * listener set, `useSyncExternalStore` hook with a server snapshot pinned to
 * idle so SSR and the hydrating client agree.
 *
 * Registration is idempotent, and the command is an inline
 * `commands.register({ id: "…" })` literal — the shape
 * `test/ctx-conformance.test.ts` scans `*.commands.ts` files for.
 */
import * as React from "react";

import { commands } from "@axf/core";

/** What one run of the generator produced — the POST route's answer. */
export interface GenerateResult {
  readonly generatedAt: string;
  readonly sessionsDigested: number;
  readonly fromCache: number;
  readonly mdPath: string;
}

export type GenerateStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "running" }
  | { readonly phase: "done"; readonly result: GenerateResult }
  | { readonly phase: "error"; readonly message: string };

const IDLE: GenerateStatus = { phase: "idle" };

let status: GenerateStatus = IDLE;
const listeners = new Set<() => void>();

function setStatus(next: GenerateStatus): void {
  status = next;
  for (const l of listeners) l();
}

export const generateStatus = {
  get: (): GenerateStatus => status,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};

/** The run's status, as a hook. Idle on the server and the hydrating render. */
export function useGenerateStatus(): GenerateStatus {
  return React.useSyncExternalStore(
    generateStatus.subscribe,
    () => status,
    () => IDLE
  );
}

/**
 * The run itself. A second click while one is in flight is a no-op rather than
 * a second POST — the generator walks the whole session corpus, and two
 * concurrent walks writing the same two output files is a race nobody wins.
 */
async function generate(): Promise<void> {
  if (status.phase === "running") return;
  setStatus({ phase: "running" });
  try {
    const res = await fetch("/api/project-state", { method: "POST" });
    const body = (await res.json().catch(() => null)) as
      | (GenerateResult & { error?: string })
      | null;
    if (!res.ok || !body || typeof body.generatedAt !== "string") {
      setStatus({
        phase: "error",
        message: body?.error ?? `POST /api/project-state answered ${res.status}`
      });
      return;
    }
    setStatus({
      phase: "done",
      result: {
        generatedAt: body.generatedAt,
        sessionsDigested: body.sessionsDigested,
        fromCache: body.fromCache,
        mdPath: body.mdPath
      }
    });
  } catch (err) {
    setStatus({ phase: "error", message: (err as Error).message });
  }
}

let registered = false;

export function registerProjectStateCommands(): void {
  if (registered) return;
  registered = true;

  if (!commands.has("project-state.generate")) {
    commands.register({
      id: "project-state.generate",
      title: "Generate the project state files",
      run: () => {
        void generate();
      }
    });
  }
}
