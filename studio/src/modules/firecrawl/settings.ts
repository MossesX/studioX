/**
 * @file The Firecrawl module's settings — a typed adapter over the core
 * store, taskman's pattern verbatim. The rows and their reasons are DATA on
 * `firecrawl.decl.ts`; this is the module's typed view of the one framework
 * store, so the engine client, the builder and the data panel read fields
 * rather than a `Record<string, SettingValue>`.
 */
"use client";

import { getModuleSettings, settings as settingsRegistry, useModuleSettings } from "@axf/core";

export interface FirecrawlSettings {
  /** Save every finished run's final output as a dataset automatically. */
  autosaveDatasets: boolean;
  /** How much scraped text an Analyze step feeds the model, in characters. */
  analyzeBudget: number;
  /** How many links a NEW loop step follows by default. */
  loopLimit: number;
  /** The format the Data panel opens a dataset in. */
  defaultView: string;
  /** Slow-motion delay between live-browser actions, ms — a run's opening
   *  speed; the Run tab's slider adjusts it live. */
  stepDelayMs: number;
}

export const DEFAULT_SETTINGS: FirecrawlSettings = {
  autosaveDatasets: true,
  analyzeBudget: 24000,
  loopLimit: 10,
  defaultView: "auto",
  stepDelayMs: 500
};

const OWNER = "firecrawl";

/** Read outside React — what the command handlers use. */
export function getFirecrawlSettings(): FirecrawlSettings {
  return { ...DEFAULT_SETTINGS, ...getModuleSettings(OWNER) };
}

/** Live settings inside a component; safe under SSR (server sees defaults). */
export function useFirecrawlSettings(): FirecrawlSettings {
  const values = useModuleSettings(OWNER);
  return { ...DEFAULT_SETTINGS, ...values };
}

export const firecrawlSettings = {
  getState: getFirecrawlSettings,
  set<K extends keyof FirecrawlSettings>(key: K, value: FirecrawlSettings[K]): void {
    settingsRegistry.get(OWNER)?.set(key, value);
  }
};
