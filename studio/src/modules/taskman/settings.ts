/**
 * @file The Task Manager's settings — a typed ADAPTER over the core store.
 *
 * The four values, their reasons, and everything considered-and-refused moved
 * to `taskman.decl.ts` (`settings:` field), where they are DATA on the module
 * contract (core 0.0.20). This file is what remains: the module's typed view
 * of the one framework store, so `taskman.commands.ts`, `TaskWindows.tsx` and
 * `BmpxSync.tsx` keep reading `TaskmanSettings` fields rather than a
 * `Record<string, SettingValue>`.
 *
 * The hand-rolled `SettingsStore` class this file used to hold — localStorage
 * key `axs:taskman-settings@1`, four booleans, its own dialog — is what the
 * framework replaced. Persistence is now the kv transport (per-user,
 * server-side, survives a restart); the surface is the shell's one
 * `SettingsDialog`, reached by the ModuleHost gear and the universal
 * "Module settings" row. `TaskmanSui.tsx` predicted its own deletion:
 * *"When AmberX grows a shell-owned sui affordance, this button is what gets
 * deleted."* It has been.
 *
 * The minimal-sui ceiling stands (owner, 2026-08-11): a setting earns its
 * place only when the surface cannot work properly without it.
 */
"use client";

import { getModuleSettings, settings as settingsRegistry, useModuleSettings } from "@axf/core";

export interface TaskmanSettings {
  /** Tight row height in the tree. Floating windows force this on regardless. */
  dense: boolean;
  /** Draw a coloured line through a completed item's title. */
  crossOutDone: boolean;
  /** Ask before deleting an item that has children, or a non-empty list. */
  confirmDelete: boolean;
  /** May the system create lists of its own? Turned off by a confirmed
   *  delete-all that includes the build lists — see the decl row's hint. */
  autoBuildLists: boolean;
  /** The same switch for the rail's Modules group: one empty list per
   *  registered module, kept in step by `plugins/modules-taskman`. */
  autoModuleLists: boolean;
}

export const DEFAULT_SETTINGS: TaskmanSettings = {
  dense: false,
  crossOutDone: true,
  confirmDelete: true,
  autoBuildLists: true,
  autoModuleLists: true
};

const OWNER = "taskman";

/** Read the settings outside React — what the command handlers use. Merged
 *  over the defaults so a read before registration (a bare unit test) still
 *  answers with the declared shape. */
export function getTaskmanSettings(): TaskmanSettings {
  return { ...DEFAULT_SETTINGS, ...getModuleSettings(OWNER) };
}

/** Live settings inside a component; safe under SSR (server sees defaults). */
export function useTaskmanSettings(): TaskmanSettings {
  const values = useModuleSettings(OWNER);
  return { ...DEFAULT_SETTINGS, ...values };
}

/** The write half, shaped like the store it replaced so call sites did not
 *  move: `taskmanSettings.set("dense", true)`. */
export const taskmanSettings = {
  getState: getTaskmanSettings,
  set<K extends keyof TaskmanSettings>(key: K, value: TaskmanSettings[K]): void {
    settingsRegistry.get(OWNER)?.set(key, value);
  },
  reset(): void {
    settingsRegistry.get(OWNER)?.reset();
  },
  subscribe(fn: () => void): () => void {
    return settingsRegistry.get(OWNER)?.subscribe(fn) ?? (() => {});
  }
};
