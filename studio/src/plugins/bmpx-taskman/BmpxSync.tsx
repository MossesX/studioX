/**
 * @file Build Manager → Task Manager, the LIVE half: the poll loop that keeps
 * managed lists in step with what is on disk, and reports what is building.
 *
 * Renders nothing. It is mounted once by `StudioShell`, so it runs on every
 * route — which is the point: steps tick off while you are watching the Build
 * Manager, and the lists are already current when you arrive at `/taskman`.
 *
 * ── "if task manager is installed" ───────────────────────────────────────────
 *
 * The owner's condition, and it is checked against the REGISTRY rather than
 * assumed: no `taskman` module registered, no lists, no polling, no requests.
 * That check is also what keeps this honest as a plugin — it adds a capability
 * to a host that may or may not be there, and it must be inert when it is not.
 *
 * ── why two endpoints ───────────────────────────────────────────────────────
 *
 * `/api/bmpx` gives the done-flags, and the builder is the single writer of
 * those (`/api/bmpx/run`'s docblock: real runs "WRITE THE .bmpx themselves").
 * So re-reading it IS the real-time check-off — no event stream needed, and no
 * second source of truth to disagree with the file.
 *
 * `/api/bmpx/run` answers the one thing the project file cannot: whether a run
 * is happening RIGHT NOW. A half-built project looks identical on disk whether
 * its builder is mid-step or was killed last week, and glowing at a dead run is
 * exactly the kind of claim nothing checked that this codebase keeps refusing
 * to ship. It is asked about ONE project per tick — the likeliest candidate —
 * so liveness costs one request rather than one per project.
 *
 * ── cadence ─────────────────────────────────────────────────────────────────
 *
 * 3s while a run is live, 15s otherwise, and STOPPED while the tab is hidden.
 * A background tab polling a build server forever is the kind of thing that is
 * invisible until it is a support question.
 */
"use client";

import * as React from "react";

import { registry } from "@axf/core";

import { taskActivity } from "../../modules/taskman/activity";
import { registerManagedLists } from "../../modules/taskman/managed";
import { useTaskmanSettings } from "../../modules/taskman/settings";
import { taskStore, TASKMAN_REFRESH_EVENT } from "../../modules/taskman/store";
import { buildingItemId, isManagedList, likeliestRunning, listIdFor, mergeProjects } from "./sync";
import type { BmpxProject } from "./sync";

const LIVE_MS = 3_000;
const IDLE_MS = 15_000;

/**
 * Tell the Task Manager which lists are this engine's, at import time.
 *
 * Module scope rather than an effect: `taskman.delete-all` is a plain command
 * that can fire before this component has ever mounted (from the palette, or
 * from a right-click on a route where the shell has not rendered it yet), and a
 * delete-all that could not name the managed lists would spare them silently.
 */
registerManagedLists("bmpx", "build project", isManagedList);

export default function BmpxSync() {
  // The kill switch the owner asked for (2026-08-13): "if confirmed delete
  // permanently and dont allow it to be auto added again by the system".
  // `taskman.delete-all` writes this setting; reading it through the hook is
  // what makes the effect below tear down the moment it is written, rather than
  // one poll later.
  const { autoBuildLists } = useTaskmanSettings();

  React.useEffect(() => {
    // The registry is populated by boot, which has run by the time any client
    // effect fires. No taskman, nothing to sync into.
    if (!registry.modules().some((m) => m.id === "taskman")) return;
    // Switched off means OFF: no lists, no polling, no requests — the same
    // inertness this plugin already promises when there is no taskman at all.
    // Anything less and "don't add them again" would still be one fetch a
    // second answering a question nobody asked.
    if (!autoBuildLists) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<number> => {
      const res = await fetch("/api/bmpx", { cache: "no-store" });
      if (!res.ok) return IDLE_MS;
      const body = (await res.json()) as { projects?: BmpxProject[] };
      const projects = body.projects ?? [];
      if (!projects.length) return IDLE_MS;

      // 1 — the lists. `mergeProjects` returns the same instance when nothing
      // moved, and `setLists` ignores an identical reference, so a quiet tick
      // writes nothing and re-renders nobody.
      taskStore.setLists((lists) => mergeProjects(lists, projects));

      // 2 — the glow. Only a CONFIRMED live run lights anything up.
      const candidate = likeliestRunning(projects);
      if (!candidate) {
        taskActivity.clear();
        return IDLE_MS;
      }
      const runRes = await fetch(
        `/api/bmpx/run?file=${encodeURIComponent(candidate.file)}&offset=0`,
        { cache: "no-store" }
      );
      const run = runRes.ok ? ((await runRes.json()) as { running?: boolean }) : { running: false };
      if (!run.running) {
        taskActivity.clear();
        return IDLE_MS;
      }
      taskActivity.set({
        activeListIds: [listIdFor(candidate.id)],
        buildingItemId: buildingItemId(candidate)
      });
      return LIVE_MS;
    };

    const loop = async () => {
      if (stopped) return;
      let next = IDLE_MS;
      try {
        next = await tick();
      } catch {
        // A failed read is not an empty build directory — leave the lists and
        // the glow exactly as they are and try again on the idle cadence.
        next = IDLE_MS;
      }
      if (!stopped) timer = setTimeout(loop, next);
    };

    const start = () => {
      if (timer) clearTimeout(timer);
      void loop();
    };
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    // A manual Refresh (the lists bar's first action) is answered NOW rather
    // than on the next cadence — 15s of nothing after pressing refresh reads as
    // a button that does not work.
    const onRefresh = () => start();

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(TASKMAN_REFRESH_EVENT, onRefresh);

    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(TASKMAN_REFRESH_EVENT, onRefresh);
      // A glow nobody switched off is a lie about a build that is not running.
      taskActivity.clear();
    };
  }, [autoBuildLists]);

  return null;
}
