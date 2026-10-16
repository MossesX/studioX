/**
 * @file Task-manager integration registry — the port of GizmoX's
 * `integrations.tsx` (MASTER §5). Any module, plugin or extension can register
 * a provider that feeds candidate items into the task manager; the
 * Integrations pane renders them all and one click turns a candidate into a
 * tracked item.
 *
 * The MECHANISM ports verbatim (a provider is a React hook, so it can read a
 * store or fetch from an API route). The PROVIDERS cannot: GizmoX's five read
 * its files journal, agents, snippets, logo packs and sandbox files, and none
 * of those modules exist in this suite. Registering them anyway would have
 * produced a pane full of permanently-empty sections — the "real > fake" rule
 * cuts both ways, and an integration with nothing behind it is fake.
 *
 * So the built-ins here read what this suite actually has: the real `.bmpx`
 * build projects behind `/api/bmpx`, which is the same data the Build Manager
 * renders. When a module lands that owns candidates of its own, it calls
 * `registerTaskProvider` at import time — no edit to this pane.
 */
"use client";

import * as React from "react";

import type { TaskItem } from "./types";

export interface IntegrationCandidate {
  id: string;
  label: string;
  sublabel?: string;
  /** Partial used when the user adds this candidate as a task item. */
  item: Partial<TaskItem>;
}

export interface TaskProvider {
  id: string;
  title: string;
  /** Palette key — colours the section header and the candidates it makes. */
  color: string;
  /** Hook returning the current candidates (called inside the pane). */
  useCandidates: () => IntegrationCandidate[];
}

const providers: TaskProvider[] = [];

/** Register a provider (idempotent by id) — the dynamic integration point. */
export function registerTaskProvider(p: TaskProvider): void {
  const i = providers.findIndex((x) => x.id === p.id);
  if (i >= 0) providers[i] = p;
  else providers.push(p);
}

export function getTaskProviders(): TaskProvider[] {
  return providers;
}

/* ------------------------------ shared source ----------------------------- */

interface BmpxProject {
  file: string;
  id: string;
  name: string;
  status: string;
  amberxBound: boolean;
  checklist: string[];
}

/**
 * One fetch shared by both built-in providers. Module scope so the two sections
 * do not each hit the route: they render side by side and would otherwise
 * duplicate every request.
 */
let cache: BmpxProject[] | null = null;
let inflight: Promise<BmpxProject[]> | null = null;

function useBmpxProjects(): BmpxProject[] {
  const [projects, setProjects] = React.useState<BmpxProject[]>(cache ?? []);

  React.useEffect(() => {
    if (cache) return;
    let alive = true;
    inflight ??= fetch("/api/bmpx")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects?: BmpxProject[] }) => {
        cache = d.projects ?? [];
        return cache;
      })
      .catch(() => {
        // A failed read is not an empty build directory. Leave the cache unset
        // so the next mount retries instead of latching "there is nothing".
        inflight = null;
        return [];
      });
    void inflight.then((p) => {
      if (alive) setProjects(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  return projects;
}

/* ------------------------- built-in suite providers ------------------------ */

registerTaskProvider({
  id: "bmpx-projects",
  title: "Build projects",
  color: "orange",
  useCandidates: () =>
    useBmpxProjects()
      .filter((p) => p.status !== "done" && p.status !== "superseded")
      .map((p) => ({
        id: p.file,
        label: `Track build: ${p.name}`,
        sublabel: `${p.status}${p.amberxBound ? " · amberx-bound" : ""}`,
        item: {
          title: `Build: ${p.name}`,
          type: "milestone",
          action: "build",
          category: "build",
          color: "orange",
          icon: "milestone",
          source: { module: "buildmgr", ref: p.file }
        }
      }))
});

registerTaskProvider({
  id: "bmpx-checklists",
  title: "Build checklists",
  color: "cyan",
  useCandidates: () =>
    useBmpxProjects().flatMap((p) =>
      p.checklist.map((line, i) => ({
        id: `${p.file}#${i}`,
        label: line,
        sublabel: p.name,
        item: {
          title: line,
          type: "task",
          action: "build",
          category: p.id,
          color: "cyan",
          icon: "task",
          source: { module: "buildmgr", ref: `${p.file}#checklist:${i}` }
        }
      }))
    )
});
