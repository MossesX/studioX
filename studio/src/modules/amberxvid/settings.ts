/**
 * @file AmberX Vid settings — the module's CLIENT-side view of its per-member
 * preferences, plus the GizmoX-shaped adapter the ported screens still call.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, SINCE P16
 * ---------------------------------------------------------------------------
 * Two halves that used to be one:
 *
 *  1. **The tree's client accessors** — {@link useAmberxvidPrefs} and
 *     {@link amberxvidPrefs}, a typed read/write pair over core's module
 *     settings store, in the same shape `accounts/settings.ts` and taskman's
 *     use. The values, the defaults and the group layout live in `lib/prefs.ts`
 *     (isomorphic, derived from the decl) so the SERVER reads the same
 *     constants through `lib/prefsServer.ts`. One truth, three readers.
 *  2. **The GizmoX adapter**, unchanged in shape — `useEffectiveValues` /
 *     `str` / `bool` / `setSettingValue` — because ~30 ported call sites read
 *     values by their original dotted ids and a rename is not what P16 is for.
 *
 * Persistence is per accounts user and none of it is this module's doing: a
 * decl's rows ride core's kv transport, and the studio host resolves the kv
 * user from the verified `axs_session` cookie. A signed-in member's tree is
 * `data/axf/kv/<username>/amberxvid-settings.json`.
 *
 * ---------------------------------------------------------------------------
 * WHAT DID NOT EARN A ROW — the refusals, written down on purpose
 * ---------------------------------------------------------------------------
 * The minimal-sui ceiling is a standing owner directive (2026-08-11) and it
 * applies to a module tree exactly as it applies to a two-knob sui: a setting
 * earns its place only when the surface **cannot work properly without it**.
 * These were proposed during P16 and refused, and they are listed so the next
 * session does not re-propose them one reasonable-sounding knob at a time:
 *
 *  - **A per-member timezone for quiet hours.** `lib/availability.ts` compares
 *    against the SERVER's clock and says so in words on the surface. Storing an
 *    IANA zone means keeping it correct across travel and reconciling it with
 *    the browser's guess, for a feature whose failure mode is a ring arriving
 *    fifteen minutes early. The caveat is cheaper than the machinery.
 *  - **A "show me as offline" switch.** Presence IS the SSE connection
 *    (`lib/presence.ts`); a switch would make "online" a preference and every
 *    buddy list in the studio a polite fiction. Do-not-disturb is the honest
 *    version of what people want here, and it exists.
 *  - **Messenger theme, font size and away text in the tree.** They are in the
 *    messenger's own drawer gear by explicit build directive, because they
 *    restyle the thing you are looking at while you look at it. The tree links
 *    to that surface rather than growing a second editor for one document.
 *  - **A separate "sounds" row in the MESSENGER group.** The messenger document
 *    has exactly one sound field, and the tree already shows it as *Chime on
 *    message* under NOTIFICATIONS, where a member looks for it. Two controls on
 *    one value is the drift this file exists to prevent.
 *  - **Notification volume per KIND** (ring vs chime vs alert). One volume is
 *    the thing a member actually adjusts; three is a mixing desk for an app
 *    that makes two noises.
 *  - **An unread-badge toggle**, borrowed from the accounts refusal list for
 *    the same reason: an unread count you can hide is a message you lose.
 *  - **Autoplay for the FEED and the wall**, as a sibling of the stream-preview
 *    row. Nothing in the feed autoplays today, so the row would configure a
 *    behaviour that does not exist — and would read as a promise that it does.
 *  - **A default recording folder / vault path.** The vault layout is
 *    `lib/paths.ts`'s and a member choosing their own path breaks the storage
 *    ledger, the quota and the admin view in one click. Operator surface, not
 *    a preference.
 *  - **Anything the theme engine owns** — accent, density, font. AmberX has one
 *    theme engine and a module that grows its own appearance knobs is a module
 *    that stops following it.
 *  - The whole tail of GizmoX's 21-value spec: banner height / surface / tint /
 *    logos / signet / identity / clock / clock format / clock seconds /
 *    version, toolbar placement / position / autohide / icon size / labels.
 *    Those describe chrome AmberX draws from its own theme and toolbar assets;
 *    they ride below as constants at their GizmoX defaults so the ported
 *    screens still read a value, and no control offers to change one.
 */
"use client";

import { getModuleSettings, settings, useModuleSettings } from "@axf/core";

import { DEFAULT_PREFS, normalizePrefs } from "./lib/prefs";
import type { AmberxvidPrefs, PrefKey } from "./lib/prefs";

export const AMBERXVID_ASSET_ID = "amberxvid";
export const AMBERXVID_ASSET_NAME = "AmberX Vid";

export type { AmberxvidPrefs, PrefKey };
export { DEFAULT_PREFS };

/* ======================== the tree's client accessors ======================== */

/**
 * Live preferences inside a component; safe under SSR (the server frame sees
 * the declared defaults, which is what keeps hydration from tearing).
 *
 * Normalised on the way out rather than trusted: the store merges a stored
 * document over the defaults by type, but the two numeric rows also have
 * RANGES, and a document written before a range narrowed would otherwise reach
 * a `<Slider>` as an out-of-bounds value.
 */
export function useAmberxvidPrefs(): AmberxvidPrefs {
  return normalizePrefs(useModuleSettings(AMBERXVID_ASSET_ID));
}

/** The same read outside React — what a command handler or an engine callback
 *  uses. Returns the declared defaults before the module registers. */
export function getAmberxvidPrefs(): AmberxvidPrefs {
  return normalizePrefs(getModuleSettings(AMBERXVID_ASSET_ID));
}

/** The write half, shaped like accounts' and taskman's so call sites read the
 *  same: `amberxvidPrefs.set("ringVolume", 40)`. */
export const amberxvidPrefs = {
  getState: getAmberxvidPrefs,
  set<K extends PrefKey>(key: K, value: AmberxvidPrefs[K]): void {
    settings.get(AMBERXVID_ASSET_ID)?.set(key, value as string | number | boolean);
  },
  reset(): void {
    settings.get(AMBERXVID_ASSET_ID)?.reset();
  },
  subscribe(fn: () => void): () => void {
    return settings.get(AMBERXVID_ASSET_ID)?.subscribe(fn) ?? (() => {});
  }
};

/* ===================== the ported GizmoX adapter (unchanged) ================== */

export type EffectiveValues = Record<string, string | boolean>;

/**
 * Every key the GizmoX spec carried, at its GizmoX default.
 *
 * The four that P16 did NOT promote to real rows are still here as constants,
 * and the refusals section above says why. The promoted ones read through
 * {@link useEffectiveValues} instead, so this map is their FLOOR and never
 * their answer.
 */
export const SETTING_DEFAULTS: EffectiveValues = {
  "banner.height": "standard",
  "banner.surface": "solid",
  "banner.tint": "",
  "banner.logos": "both",
  "banner.signet": "hex",
  "banner.identity": "screenname",
  "banner.clock": true,
  "banner.clockFormat": "24h",
  "banner.clockSeconds": false,
  "banner.version": true,
  "recorder.resolution": DEFAULT_PREFS.recorderResolution,
  "recorder.quality": DEFAULT_PREFS.recorderQuality,
  "recorder.micDefault": true,
  "recorder.saveTo": "library",
  "toolbar.placement": "layout",
  "toolbar.position": "top",
  "toolbar.autohide": false,
  "toolbar.iconSize": "26",
  "toolbar.labels": "icons-only",
  "appearance.animationIntensity": DEFAULT_PREFS.animationIntensity,
  "background.armed": DEFAULT_PREFS.backgroundArmed
};

/**
 * The live values map, same shape the GizmoX cascade returned. The `assetId`
 * parameter is kept so ported call sites do not change; only this module's id
 * is meaningful here.
 */
export function useEffectiveValues(_assetId: string = AMBERXVID_ASSET_ID): EffectiveValues {
  const prefs = useAmberxvidPrefs();
  return {
    ...SETTING_DEFAULTS,
    "recorder.resolution": prefs.recorderResolution,
    "recorder.quality": prefs.recorderQuality,
    "appearance.animationIntensity": prefs.animationIntensity,
    "background.armed": prefs.backgroundArmed
  };
}

/** Dotted GizmoX setting id → the decl row key the module promotes. */
const PROMOTED_KEYS: Record<string, PrefKey> = {
  "recorder.resolution": "recorderResolution",
  "recorder.quality": "recorderQuality",
  "appearance.animationIntensity": "animationIntensity",
  "background.armed": "backgroundArmed"
};

/**
 * GizmoX's `setSettingValue(assetId, id, value)`, adapted. Only this module's
 * asset id is meaningful; unpromoted ids are no-ops (constants, see above).
 * GizmoX returned the updated values bag — no ported call site reads it, so
 * this returns void.
 */
export function setSettingValue(_assetId: string, id: string, value: unknown): void {
  const key = PROMOTED_KEYS[id];
  if (!key) return; // not promoted to a setting — the GizmoX default is a constant here
  if (typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") return;
  settings.get(AMBERXVID_ASSET_ID)?.set(key, value);
}

/** GizmoX's `bool()` — typed read with a fallback. */
export function bool(v: EffectiveValues, id: string, fallback: boolean): boolean {
  const x = v[id];
  return typeof x === "boolean" ? x : fallback;
}

/** GizmoX's `str()` — typed read with a fallback. */
export function str(v: EffectiveValues, id: string, fallback: string): string {
  const x = v[id];
  return typeof x === "string" ? x : fallback;
}
