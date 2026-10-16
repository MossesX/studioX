/**
 * @file The Firecrawl module's store — workflows and datasets, server-backed.
 *
 * The `/api/firecrawl/store` route's kv document is the source of truth (it
 * survives a browser wipe and is shared across tabs the way the expense
 * ledger is); this store is the client's one live copy of it, shared by the
 * module screen, the builder, the data panel and every context-menu command
 * through `useSyncExternalStore` — taskman's arrangement, with the transport
 * swapped from localStorage to the kv route because datasets are too big and
 * too valuable for a per-browser store.
 *
 * The server snapshot is EMPTY, for the reason taskman's docblock spells out:
 * the server cannot know this visitor's workflows, and a guess is a visible
 * flip when it is wrong. First subscribe kicks off the fetch; mutations are
 * optimistic (state first, POST after) with the failed-save flag surfaced
 * rather than swallowed, because a workflow that silently didn't save is a
 * run someone loses tomorrow.
 */
"use client";

import * as React from "react";

import { uid } from "./id";
import type {
  BrowserAction,
  Dataset,
  FirecrawlDoc,
  LinkList,
  Recording,
  Workflow,
  WorkflowStep
} from "./types";

export interface FirecrawlState {
  readonly loaded: boolean;
  readonly workflows: readonly Workflow[];
  readonly datasets: readonly Dataset[];
  readonly lists: readonly LinkList[];
  readonly recordings: readonly Recording[];
  /** Set when the last POST failed — the screen shows it, a retry clears it. */
  readonly saveError: string | null;
}

const SERVER_STATE: FirecrawlState = {
  loaded: false,
  workflows: [],
  datasets: [],
  lists: [],
  recordings: [],
  saveError: null
};

type Updater<T> = (prev: T) => T;

class FirecrawlStore {
  #state: FirecrawlState = SERVER_STATE;
  #listeners = new Set<() => void>();
  #loading = false;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (fn: () => void): (() => void) => {
    void this.#ensureLoaded();
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): FirecrawlState => this.#state;
  getServerState = (): FirecrawlState => SERVER_STATE;

  async #ensureLoaded(): Promise<void> {
    if (this.#state.loaded || this.#loading || typeof window === "undefined") return;
    this.#loading = true;
    try {
      const res = await fetch("/api/firecrawl/store");
      const doc = (await res.json()) as Partial<FirecrawlDoc>;
      this.#state = {
        ...this.#state,
        loaded: true,
        workflows: Array.isArray(doc.workflows) ? (doc.workflows as Workflow[]) : [],
        datasets: Array.isArray(doc.datasets) ? (doc.datasets as Dataset[]) : [],
        lists: Array.isArray(doc.lists) ? (doc.lists as LinkList[]) : [],
        recordings: Array.isArray(doc.recordings) ? (doc.recordings as Recording[]) : []
      };
    } catch {
      // The route being down degrades to an empty-but-editable store; the
      // first successful save writes what is on screen.
      this.#state = { ...this.#state, loaded: true };
    } finally {
      this.#loading = false;
      this.#emit();
    }
  }

  /** Re-read the persisted document — the surface's Refresh command. */
  async reload(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      const res = await fetch("/api/firecrawl/store");
      const doc = (await res.json()) as Partial<FirecrawlDoc>;
      if (!Array.isArray(doc.workflows) || !Array.isArray(doc.datasets)) return;
      this.#state = {
        ...this.#state,
        loaded: true,
        workflows: doc.workflows as Workflow[],
        datasets: doc.datasets as Dataset[],
        lists: Array.isArray(doc.lists) ? (doc.lists as LinkList[]) : [],
        recordings: Array.isArray(doc.recordings) ? (doc.recordings as Recording[]) : []
      };
      this.#emit();
    } catch {
      // Unreadable — keep what is on screen (taskman's reload rule).
    }
  }

  #persistSoon(): void {
    if (typeof window === "undefined") return;
    // Debounced, because the builder mutates per keystroke through
    // `updateStep` — one POST per pause, not one per character.
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => void this.#persist(), 600);
  }

  async #persist(): Promise<void> {
    const doc: FirecrawlDoc = {
      v: 2,
      workflows: this.#state.workflows,
      datasets: this.#state.datasets,
      lists: this.#state.lists,
      recordings: this.#state.recordings
    };
    try {
      const res = await fetch("/api/firecrawl/store", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(doc)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (this.#state.saveError) {
        this.#state = { ...this.#state, saveError: null };
        this.#emit();
      }
    } catch (err) {
      this.#state = { ...this.#state, saveError: `Save failed: ${String(err)}` };
      this.#emit();
    }
  }

  #emit(): void {
    for (const fn of this.#listeners) fn();
  }

  setWorkflows(update: Updater<readonly Workflow[]>): void {
    const workflows = update(this.#state.workflows);
    if (workflows === this.#state.workflows) return;
    this.#state = { ...this.#state, workflows };
    this.#persistSoon();
    this.#emit();
  }

  setDatasets(update: Updater<readonly Dataset[]>): void {
    const datasets = update(this.#state.datasets);
    if (datasets === this.#state.datasets) return;
    this.#state = { ...this.#state, datasets };
    this.#persistSoon();
    this.#emit();
  }

  setLists(update: Updater<readonly LinkList[]>): void {
    const lists = update(this.#state.lists);
    if (lists === this.#state.lists) return;
    this.#state = { ...this.#state, lists };
    this.#persistSoon();
    this.#emit();
  }

  setRecordings(update: Updater<readonly Recording[]>): void {
    const recordings = update(this.#state.recordings);
    if (recordings === this.#state.recordings) return;
    this.#state = { ...this.#state, recordings };
    this.#persistSoon();
    this.#emit();
  }

  /** Immediate save — what a retry button calls. */
  saveNow(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    void this.#persist();
  }
}

export const firecrawlStore = new FirecrawlStore();

/** Live store state; safe under SSR (server renders empty). */
export function useFirecrawlStore(): FirecrawlState {
  return React.useSyncExternalStore(
    firecrawlStore.subscribe,
    firecrawlStore.getState,
    firecrawlStore.getServerState
  );
}

/* ── mutation helpers — plain functions so commands can call them too ────── */

export function newWorkflow(name?: string): Workflow {
  const now = Date.now();
  const wf: Workflow = {
    id: uid("wf"),
    name: name ?? "New workflow",
    description: "",
    steps: [],
    createdAt: now,
    updatedAt: now
  };
  firecrawlStore.setWorkflows((prev) => [...prev, wf]);
  return wf;
}

export function updateWorkflow(id: string, patch: Partial<Omit<Workflow, "id">>): void {
  firecrawlStore.setWorkflows((prev) =>
    prev.map((wf) => (wf.id === id ? { ...wf, ...patch, updatedAt: Date.now() } : wf))
  );
}

export function deleteWorkflow(id: string): void {
  firecrawlStore.setWorkflows((prev) => prev.filter((wf) => wf.id !== id));
}

export function duplicateWorkflow(id: string): Workflow | null {
  const source = firecrawlStore.getState().workflows.find((wf) => wf.id === id);
  if (!source) return null;
  const now = Date.now();
  const copy: Workflow = {
    ...source,
    id: uid("wf"),
    name: `${source.name} (copy)`,
    steps: source.steps.map((s) => reId(s)),
    createdAt: now,
    updatedAt: now
  };
  firecrawlStore.setWorkflows((prev) => [...prev, copy]);
  return copy;
}

/** Fresh ids all the way down, so two copies never share a step id. */
function reId(step: WorkflowStep): WorkflowStep {
  if (step.kind === "loop") {
    return { ...step, id: uid("step"), steps: step.steps.map((s) => ({ ...s, id: uid("step") })) };
  }
  return { ...step, id: uid("step") };
}

export function setSteps(workflowId: string, update: Updater<readonly WorkflowStep[]>): void {
  firecrawlStore.setWorkflows((prev) =>
    prev.map((wf) =>
      wf.id === workflowId ? { ...wf, steps: update(wf.steps), updatedAt: Date.now() } : wf
    )
  );
}

export function saveDataset(dataset: Omit<Dataset, "id" | "createdAt">): Dataset {
  const full: Dataset = { ...dataset, id: uid("ds"), createdAt: Date.now() };
  firecrawlStore.setDatasets((prev) => [full, ...prev]);
  return full;
}

export function renameDataset(id: string, name: string): void {
  firecrawlStore.setDatasets((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
}

export function deleteDataset(id: string): void {
  firecrawlStore.setDatasets((prev) => prev.filter((d) => d.id !== id));
}

/* ── link lists ──────────────────────────────────────────────────────────── */

/**
 * File a list produced by a run's `list` event (or the recorder's harvest):
 * upsert by NAME — replace swaps the urls out, append unions them in.
 */
export function upsertList(
  name: string,
  urls: readonly string[],
  listMode: "replace" | "append",
  source?: string
): LinkList {
  const now = Date.now();
  const existing = firecrawlStore.getState().lists.find((l) => l.name === name);
  if (!existing) {
    const list: LinkList = { id: uid("list"), name, urls: [...new Set(urls)], createdAt: now, updatedAt: now, source };
    firecrawlStore.setLists((prev) => [list, ...prev]);
    return list;
  }
  const merged =
    listMode === "append" ? [...new Set([...existing.urls, ...urls])] : [...new Set(urls)];
  const updated: LinkList = { ...existing, urls: merged, updatedAt: now, source: source ?? existing.source };
  firecrawlStore.setLists((prev) => prev.map((l) => (l.id === existing.id ? updated : l)));
  return updated;
}

export function renameList(id: string, name: string): void {
  firecrawlStore.setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
}

export function deleteList(id: string): void {
  firecrawlStore.setLists((prev) => prev.filter((l) => l.id !== id));
}

/* ── recordings ──────────────────────────────────────────────────────────── */

export function saveRecording(name: string, startUrl: string, actions: readonly BrowserAction[]): Recording {
  const recording: Recording = { id: uid("rec"), name, startUrl, actions, createdAt: Date.now() };
  firecrawlStore.setRecordings((prev) => [recording, ...prev]);
  return recording;
}

export function renameRecording(id: string, name: string): void {
  firecrawlStore.setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
}

export function deleteRecording(id: string): void {
  firecrawlStore.setRecordings((prev) => prev.filter((r) => r.id !== id));
}
