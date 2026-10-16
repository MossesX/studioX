/**
 * @file THE PER-MEMBER PREFERENCES — the typed face of the module's declared
 * settings, and the one place their defaults are read from (P16, 2026-08-15).
 *
 * ---------------------------------------------------------------------------
 * ONE TRUTH, AND THE DIRECTION IT HAS TO RUN IN
 * ---------------------------------------------------------------------------
 * The decl (`../amberxvid.decl`) is the source. Every default below is READ off
 * its rows rather than restated here, and the reason the dependency runs this
 * way round — rather than the decl importing constants from this file, which is
 * the shape you would write first — is the decl's own hard rule: it is a NODE
 * LEAF, imported by the closure resolver under plain Node with native type
 * stripping, where an extensionless relative RUNTIME import does not resolve.
 * A decl may import types and nothing else.
 *
 * So the arrow points here. `DEFAULT_PREFS` is `settingsDefaults(decl)` with a
 * typed face, and {@link assertPrefsMatchDecl} makes the face and the rows
 * disagree LOUDLY rather than silently: a key renamed in the decl and not here
 * would otherwise read back as `undefined` at every call site and land as the
 * value `false`.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT IN HERE
 * ---------------------------------------------------------------------------
 * The kv half of the tree only. Two of the six groups the settings surface
 * shows are per-member DOCUMENTS with their own stores, because that is where
 * the code that enforces them reads:
 *
 *  - **DND** — `./availability`, read by `./dnd` on every ring.
 *  - **MESSENGER's chime / timestamps / popup** — `./messengerSettings`, read
 *    by `mayInterrupt`.
 *
 * Mirroring either into a kv row would give a member a control that edits one
 * copy while the server obeys the other. `Settings.tsx` renders all six groups;
 * only four of them come from here.
 *
 * ---------------------------------------------------------------------------
 * ISOMORPHIC — no `node:` imports, deliberately
 * ---------------------------------------------------------------------------
 * The client reads these through core's settings store and the SERVER reads the
 * same document through `./prefsServer` (kv on disk). Both need the defaults,
 * so this file must be importable from a client component; `./prefsServer` is
 * the half that touches the filesystem and is server-only.
 */

import { AMBERXVID_DECL } from "../amberxvid.decl";

/* ============================ the typed face ================================ */

export type SocialVisibilityPref = "public" | "buddies" | "private";
export type AudiencePref = "everyone" | "buddies";
export type CallResolutionPref = "640x480" | "1280x720" | "1920x1080";
export type ViewerRecordFormatPref = "auto" | "video/webm" | "video/mp4";

/**
 * Every kv-backed preference, in the decl's own order. The pre-P16 four are at
 * the foot because that is where the decl keeps them.
 */
export interface AmberxvidPrefs {
  /* notifications */
  ringAlerts: boolean;
  ringVolume: number;
  trayAlerts: boolean;
  followedLiveAlerts: boolean;
  /* privacy defaults */
  defaultPostVisibility: SocialVisibilityPref;
  defaultAlbumVisibility: SocialVisibilityPref;
  whoMayCall: AudiencePref;
  whoMayInvite: AudiencePref;
  /* devices */
  cameraId: string;
  micId: string;
  callResolution: CallResolutionPref;
  uplinkCapKbps: number;
  /* messenger (kv half) */
  messengerEnterToSend: boolean;
  /* playback */
  autoplayPreviews: boolean;
  viewerRecordFormat: ViewerRecordFormatPref;
  /* recorder + module-wide, pre-P16 */
  recorderResolution: string;
  recorderQuality: string;
  animationIntensity: string;
  backgroundArmed: boolean;
}

export type PrefKey = keyof AmberxvidPrefs;

/** The kv namespace the decl claims — restated as a read, never as a literal. */
export const PREFS_NS: string = AMBERXVID_DECL.settings?.ns ?? "amberxvid-settings";

/**
 * The decl's rows, or an empty list if the decl ever drops its settings section
 * (which {@link assertPrefsMatchDecl} then reports rather than tolerates).
 */
const ROWS = AMBERXVID_DECL.settings?.rows ?? [];

/**
 * Every declared default, keyed. The one cast in this file: the rows are
 * `SettingValue`s and the interface is their narrower face. It is checked at
 * import by {@link assertPrefsMatchDecl} rather than trusted.
 */
export const DEFAULT_PREFS: AmberxvidPrefs = Object.freeze(
  Object.fromEntries(ROWS.map((r) => [r.key, r.defaultValue] as const))
) as unknown as AmberxvidPrefs;

/**
 * The keys this file's interface claims, listed once so the check below has
 * something to compare the rows against. Yes, this repeats the interface's
 * property names — a TypeScript interface is erased, so a runtime check cannot
 * read them, and the alternative (no check) is the failure mode described in
 * the header.
 */
export const PREF_KEYS: readonly PrefKey[] = [
  "ringAlerts",
  "ringVolume",
  "trayAlerts",
  "followedLiveAlerts",
  "defaultPostVisibility",
  "defaultAlbumVisibility",
  "whoMayCall",
  "whoMayInvite",
  "cameraId",
  "micId",
  "callResolution",
  "uplinkCapKbps",
  "messengerEnterToSend",
  "autoplayPreviews",
  "viewerRecordFormat",
  "recorderResolution",
  "recorderQuality",
  "animationIntensity",
  "backgroundArmed"
];

/**
 * Do the decl's rows and this file's face still describe the same document?
 *
 * Returns the problems rather than throwing, so a test can print them and the
 * import-time check can decide how loud to be. Empty means they agree.
 */
export function assertPrefsMatchDecl(): string[] {
  const problems: string[] = [];
  if (!AMBERXVID_DECL.settings) return ["the amberxvid decl declares no settings section"];
  const declared = new Set(ROWS.map((r) => r.key));
  for (const key of PREF_KEYS) {
    if (!declared.has(key)) problems.push(`prefs key "${key}" has no row in the decl`);
  }
  for (const row of ROWS) {
    if (!(PREF_KEYS as readonly string[]).includes(row.key)) {
      problems.push(`decl row "${row.key}" is not in AmberxvidPrefs`);
    }
  }
  return problems;
}

/* ============================== the groups =================================== */

/**
 * How the settings surface lays the tree out. Declared as data beside the keys
 * rather than as JSX in `Settings.tsx`, so a row added to the decl and left out
 * of a group is visible here as an absence rather than being invisible on a
 * screen nobody scrolled to the bottom of.
 *
 * `kind: "document"` groups have no kv keys at all — their rows are the
 * availability and messenger documents, and the surface renders them from
 * their own fetches. They are listed here so the tree's SHAPE is one list.
 */
export interface PrefGroup {
  readonly id: string;
  readonly title: string;
  /** One line under the heading — what this group is for. */
  readonly blurb: string;
  /** kv rows, in render order. Empty for a document group. */
  readonly keys: readonly PrefKey[];
  /** Which store answers this group. */
  readonly source: "kv" | "availability" | "messenger";
}

export const PREF_GROUPS: readonly PrefGroup[] = [
  {
    id: "notifications",
    title: "Notifications",
    blurb: "What is allowed to interrupt you, and how loudly.",
    keys: ["ringAlerts", "ringVolume", "trayAlerts", "followedLiveAlerts"],
    source: "kv"
  },
  {
    id: "dnd",
    title: "Do not disturb",
    blurb:
      "The switch and the weekly window. Every ring and every alert is filtered through these, " +
      "server-side — quiet hours are the app server's local time.",
    keys: [],
    source: "availability"
  },
  {
    id: "privacy",
    title: "Privacy defaults",
    blurb: "What new things start as, and who is allowed to reach you.",
    keys: ["defaultPostVisibility", "defaultAlbumVisibility", "whoMayCall", "whoMayInvite"],
    source: "kv"
  },
  {
    id: "devices",
    title: "Devices",
    blurb: "The camera and microphone a call uses, and how much uplink it is allowed.",
    keys: ["cameraId", "micId", "callResolution", "uplinkCapKbps"],
    source: "kv"
  },
  {
    id: "messenger",
    title: "Messenger",
    blurb: "How the messenger sounds and reads. These are per profile, in the messenger's own document.",
    keys: ["messengerEnterToSend"],
    source: "messenger"
  },
  {
    id: "playback",
    title: "Playback",
    blurb: "How streams behave when you are watching rather than hosting.",
    keys: ["autoplayPreviews", "viewerRecordFormat"],
    source: "kv"
  }
];

/* ============================== normalisation ================================ */

/**
 * Coerce a raw kv document into the typed face. Junk falls back to the DECLARED
 * default, never to a zero value — the house posture everywhere else in this
 * module (`./availability`, `./messengerSettings`): an unreadable preference
 * must land a member on the default, not on silence or on "public".
 */
export function normalizePrefs(raw: unknown): AmberxvidPrefs {
  const out = { ...DEFAULT_PREFS };
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, unknown>;
  for (const key of PREF_KEYS) {
    const v = r[key];
    if (v === undefined) continue;
    if (typeof v !== typeof DEFAULT_PREFS[key]) continue;
    (out as Record<string, unknown>)[key] = v;
  }
  // Two numbers earn a clamp rather than a type check, because an out-of-range
  // ring volume is audible and an out-of-range uplink cap is a broken call.
  out.ringVolume = clamp(out.ringVolume, 0, 100, DEFAULT_PREFS.ringVolume);
  out.uplinkCapKbps = clamp(out.uplinkCapKbps, 0, 5000, DEFAULT_PREFS.uplinkCapKbps);
  return out;
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/* ======================= quiet-hours vocabulary (client) ===================== */

/**
 * The DND group's rows are the availability document's, but the SPELLING of a
 * window is shared: `./availability` prints it into the ledger line and the
 * summary sentence server-side, and two surfaces print it on screen. The
 * server copy stays where it is (that file is `node:`-bound and a client cannot
 * import it); this is the client's one copy rather than its second and third.
 *
 * `510` → `"08:30"`.
 */
export function clockHHMM(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Every quarter hour of the day — what a start/end picker offers. A finer
 *  grain would be a scrolling list of 1,440 items for a window nobody sets to
 *  22:07. */
export const QUARTER_MINUTES: readonly number[] = Array.from({ length: 96 }, (_, i) => i * 15);

/** Sunday-first, matching `Date.getDay()` — which is what `isQuietAt` compares
 *  a stored day against. */
export const DAY_LABELS: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ============================= derived answers =============================== */

/**
 * The mime type a viewer recording is written in, given the member's choice and
 * what this browser will actually accept.
 *
 * Lives here rather than in `./streamRecorder` so that the setting and the
 * capability question are answered in one place: "Automatic" and "MP4 on a
 * browser with no MP4 encoder" are the same situation, and both have to end on
 * a container that records rather than on one that throws.
 */
export function resolveRecordMime(
  choice: ViewerRecordFormatPref,
  supported: (mime: string) => boolean,
  candidates: readonly string[],
): string {
  if (choice !== "auto" && supported(choice)) return choice;
  return candidates.find(supported) ?? "video/webm";
}
