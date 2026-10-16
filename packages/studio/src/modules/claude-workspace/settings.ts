/**
 * @file The Claude workspace's settings — a typed ADAPTER over the core store.
 *
 * The three values, their reasons, and the long considered-and-refused list
 * moved to `claude-workspace.decl.ts` (`settings:` field — core 0.0.20,
 * settings as data on the module contract). This file keeps the module's
 * typed API: the composer, the transcript and `claude-workspace.commands.ts`
 * read `ClaudeWorkspaceSettings` fields, and a command handler is a plain
 * function with no hooks. Persistence moved from localStorage to the kv
 * transport; the surface is the shell's one `SettingsDialog`
 * (`ClaudeWorkspaceSui.tsx` deleted). The minimal-sui ceiling stands.
 */
"use client";

import { getModuleSettings, settings as settingsRegistry, useModuleSettings } from "@axf/core";

export interface ClaudeWorkspaceSettings {
  /** Render thinking blocks at all. Folded either way; this is about presence. */
  showThinking: boolean;
  /** Tool cards start open. Off means a turn reads as prose with the work
   *  available on demand. */
  autoExpandTools: boolean;
  /** Enter sends; Shift+Enter inserts a newline. Off swaps the two. */
  sendOnEnter: boolean;
}

export const DEFAULT_SETTINGS: ClaudeWorkspaceSettings = {
  showThinking: true,
  autoExpandTools: false,
  sendOnEnter: true
};

const OWNER = "claude-workspace";

/** Read the settings outside React — what the command handlers use. */
export function getClaudeSettings(): ClaudeWorkspaceSettings {
  return { ...DEFAULT_SETTINGS, ...getModuleSettings(OWNER) };
}

export function useClaudeSettings(): ClaudeWorkspaceSettings {
  const values = useModuleSettings(OWNER);
  return { ...DEFAULT_SETTINGS, ...values };
}

/** The write half, shaped like the store it replaced (`toggle` included —
 *  the workspace's commands flip these by name). */
export const claudeSettings = {
  getState: getClaudeSettings,
  set<K extends keyof ClaudeWorkspaceSettings>(key: K, value: ClaudeWorkspaceSettings[K]): void {
    settingsRegistry.get(OWNER)?.set(key, value);
  },
  toggle(key: keyof ClaudeWorkspaceSettings): void {
    this.set(key, !getClaudeSettings()[key]);
  },
  reset(): void {
    settingsRegistry.get(OWNER)?.reset();
  },
  subscribe(fn: () => void): () => void {
    return settingsRegistry.get(OWNER)?.subscribe(fn) ?? (() => {});
  }
};
