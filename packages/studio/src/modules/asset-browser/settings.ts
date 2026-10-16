"use client";

/**
 * @file The Asset Browser's settings — a typed ADAPTER over the core store.
 *
 * The two values, and the six candidates considered and refused, live on
 * `asset-browser.decl.ts` (`settings:` — core 0.0.20, settings as data on the
 * module contract). This file exists only so the screen and the command
 * handlers read `AssetBrowserSettings.showEmptyKinds` instead of a bare record,
 * and so the one write site is spelled once.
 *
 * The surface is the shell's one `SettingsDialog`, reached through the shell's
 * one affordance. There is no `AssetBrowserSui.tsx` and there must not be —
 * the minimal-sui ceiling, and the one-way-in rule.
 *
 * `expenses/settings.ts` is the shape this copies.
 */

import { getModuleSettings, settings as settingsRegistry, useModuleSettings } from "@axf/core";

export interface AssetBrowserSettings {
  /** Keep a kind in the rail when nothing of it is installed. */
  showEmptyKinds: boolean;
  /** Append the underlying manifest or asset object to the detail pane. */
  showRawJson: boolean;
}

/** Must match the `defaultValue` of each row on the decl — the decl is the
 *  contract, this is the typed read of it. */
export const DEFAULT_SETTINGS: AssetBrowserSettings = {
  showEmptyKinds: true,
  showRawJson: false
};

const OWNER = "asset-browser";

/** Read the settings outside React — what the command handlers use. */
export function getAssetBrowserSettings(): AssetBrowserSettings {
  return { ...DEFAULT_SETTINGS, ...getModuleSettings(OWNER) };
}

/** Live settings inside a component; safe under SSR (server sees defaults). */
export function useAssetBrowserSettings(): AssetBrowserSettings {
  const values = useModuleSettings(OWNER);
  return { ...DEFAULT_SETTINGS, ...values };
}

/** The write half, shaped like the store it stands in for. */
export const assetBrowserSettings = {
  getState: getAssetBrowserSettings,
  set<K extends keyof AssetBrowserSettings>(key: K, value: AssetBrowserSettings[K]): void {
    settingsRegistry.get(OWNER)?.set(key, value);
  },
  /**
   * Flip a switch. Used by the surface's context-menu row, which must land on
   * the SAME value the sui shows — a second flag in the view store would drift
   * from the dialog the moment either was set alone.
   */
  toggle(key: "showEmptyKinds" | "showRawJson"): boolean {
    const next = !getAssetBrowserSettings()[key];
    settingsRegistry.get(OWNER)?.set(key, next);
    return next;
  }
};
