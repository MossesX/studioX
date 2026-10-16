/**
 * @file AmberArt's settings — a typed ADAPTER over the core store.
 *
 * The two values (`undoDepth`, `checkerboard`), their reasons, and the
 * considered-and-refused list moved to `amberart.decl.ts` (`settings:` field
 * — core 0.0.20, settings as data on the module contract). The undo-depth
 * bounds ride the decl row (`min: 5, max: 80` — a depth of 400 is an
 * out-of-memory tab) and are enforced by the shell dialog's number control.
 * Persistence moved from localStorage to the kv transport; `AmberArtSui.tsx`
 * deleted in favour of the shell's one `SettingsDialog`. The minimal-sui
 * ceiling stands.
 */
"use client";

import { getModuleSettings, settings as settingsRegistry, useModuleSettings } from "@axf/core";

export interface AmberArtSettings {
  /** How many undo snapshots to hold. Each is ~6.4 MB of pixels. */
  undoDepth: number;
  /** Draw transparency as a checkerboard rather than as the page colour. */
  checkerboard: boolean;
}

export const DEFAULT_SETTINGS: AmberArtSettings = {
  undoDepth: 30,
  checkerboard: true
};

/** The bounds the decl row enforces — kept exported for the canvas code. */
export const UNDO_DEPTH_MIN = 5;
export const UNDO_DEPTH_MAX = 80;

const OWNER = "amberart";

export function getAmberArtSettings(): AmberArtSettings {
  return { ...DEFAULT_SETTINGS, ...getModuleSettings(OWNER) };
}

export function useAmberArtSettings(): AmberArtSettings {
  const values = useModuleSettings(OWNER);
  return { ...DEFAULT_SETTINGS, ...values };
}

/** The write half, shaped like the store it replaced. */
export const amberArtSettings = {
  getState: getAmberArtSettings,
  set<K extends keyof AmberArtSettings>(key: K, value: AmberArtSettings[K]): void {
    settingsRegistry.get(OWNER)?.set(key, value);
  },
  reset(): void {
    settingsRegistry.get(OWNER)?.reset();
  },
  subscribe(fn: () => void): () => void {
    return settingsRegistry.get(OWNER)?.subscribe(fn) ?? (() => {});
  }
};
