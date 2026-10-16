/**
 * @file Installed modules → Task Manager, the LIVE half.
 *
 * Renders nothing, mounted once by `StudioShell`, and — unlike its Build
 * Manager sibling — **it does not poll**. The registry is not a directory on
 * disk; it is an in-process store that says when it changed
 * (`registry.subscribe` / `registry.version`, added 2026-08-13 for exactly this
 * class of reader). A timer here would be asking a question whose answer is
 * pushed.
 *
 * That is also why this file is short. Everything that can be wrong about the
 * merge lives in `sync.ts` and is a pure function of its inputs; what remains is
 * "when does it run", and the honest answer is "when the registry changes, and
 * once at mount because the registry filled during an async boot that may have
 * finished before this ever subscribed".
 */
"use client";

import * as React from "react";

import { registry } from "@axf/core";

import { registerManagedLists } from "../../modules/taskman/managed";
import { useTaskmanSettings } from "../../modules/taskman/settings";
import { taskStore, TASKMAN_REFRESH_EVENT } from "../../modules/taskman/store";
import { isManagedList, mergeModules } from "./sync";
import type { InstalledModule } from "./sync";

/**
 * Tell the Task Manager which lists are this engine's, at import time.
 *
 * Module scope rather than an effect, for the reason `BmpxSync` states: the
 * delete-all command can fire before this component has ever mounted, and a
 * delete-all that could not name the managed lists would spare them silently.
 */
registerManagedLists("modules", "module", isManagedList);

export default function ModulesSync() {
  const { autoModuleLists } = useTaskmanSettings();

  // The registry's change counter — a number, because `contributionsTo()` and
  // `modules()` both allocate per call and handing one of those to
  // `useSyncExternalStore` is an infinite render loop. Same pattern the shell's
  // own strip reader uses.
  const version = React.useSyncExternalStore(
    registry.subscribe,
    registry.version,
    // The server has no registry worth reading and never mutates a store.
    () => 0
  );

  React.useEffect(() => {
    if (!autoModuleLists) return;
    // No taskman, nothing to sync into — the same inertness this plugin owes a
    // host that may not have the module it extends.
    const modules = registry.modules();
    if (!modules.some((m) => m.id === "taskman")) return;

    const sync = () => {
      const installed: InstalledModule[] = modules.map((m) => ({ id: m.id, title: m.title }));
      // `mergeModules` returns the same instance when nothing moved and
      // `setLists` ignores an identical reference, so a re-render with no
      // registry change writes nothing and re-renders nobody.
      taskStore.setLists((lists) => mergeModules(lists, installed));
    };

    sync();
    // A manual Refresh answers now rather than never: nothing else would fire
    // this again until the registry itself changed, which on a settled app is
    // never.
    window.addEventListener(TASKMAN_REFRESH_EVENT, sync);
    return () => window.removeEventListener(TASKMAN_REFRESH_EVENT, sync);
  }, [autoModuleLists, version]);

  return null;
}
