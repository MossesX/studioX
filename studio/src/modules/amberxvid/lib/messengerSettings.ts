/**
 * @file Per-profile messenger settings — the AIM skin's own knobs, and the one
 * half of the retired `lib/messages.ts` that did NOT move to accounts.
 *
 * ## Why this file exists at all (P6 of `axf-amberxvid-social`, 2026-08-15)
 *
 * P6 made accounts the only messaging store. `lib/messages.ts` held two
 * unrelated things behind one door: the message store (gone — it is
 * `@axs/modules/accounts/lib/messages` now) and these settings, which were
 * never messaging data. They are what the messenger LOOKS AND SOUNDS like to
 * one member: which of the twenty themes, whether it chimes, how big the text
 * is, what their away message says.
 *
 * Those are the module's skin, and the skin is amberxvid's — accounts has no
 * opinion about a chat bubble's colour and should not grow one. So they stay
 * here, in their own file, on the same disk path they always used
 * (`<root>/messenger/<user>.json`), and the settings survive the store's
 * retirement byte-for-byte.
 *
 * ## Where they are NOT
 *
 * Not in the sui — explicit build directive, unchanged since P7 of the
 * original build: the messenger's settings live inside the messenger, reached
 * by the drawer's own gear, because they are per-profile and change while you
 * are looking at the thing they restyle.
 *
 * ## The away split
 *
 * `awayMessage` and `statusBeforeAway` (both new in P6) are the module's half
 * of AIM away. The away FLAG is platform state and lives in the accounts
 * presence registry, which is what makes a buddy list anywhere in the studio
 * show it; the TEXT is a skin decision and lives here. `statusBeforeAway`
 * parks the profile status line that going away overwrote, so coming back
 * restores it — in the document rather than in component state, because a
 * reload while away must not lose what it replaced.
 *
 * House store posture: degrade never crash (junk file → defaults), atomic
 * writes, every save journaled. Server-only.
 */

import fs from "node:fs";
import path from "node:path";
import { appendJournal } from "./fsCore";
import { MESSENGER_THEMES } from "./contract";
import { messengerSettingsDir } from "./paths";
import { STATUS_MAX, type MessengerSettings } from "./types";

/* --------------------------------- plumbing ----------------------------------- */

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

/** Journaling must never fail a save (same posture + mute switch as accounts). */
async function journal(op: "create" | "edit", abs: string, summary: string): Promise<void> {
  if (process.env.AMBERXVID_SILENT_JOURNAL === "1") return;
  try {
    await appendJournal(op, ledgerPath(abs), { summary });
  } catch {
    /* ignore */
  }
}

function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

const settingsFile = (user: string): string =>
  path.join(messengerSettingsDir(), `${user.toLowerCase()}.json`);

/* --------------------------------- the shape ----------------------------------- */

const FONT_SIZES = new Set(["small", "medium", "large"]);

/** The AIM default, which is the AIM default on purpose. */
export const DEFAULT_AWAY_MESSAGE = "I'm away from my computer right now.";

export function defaultMessengerSettings(): MessengerSettings {
  return {
    version: 1,
    theme: MESSENGER_THEMES[0].id,
    notifications: true,
    sound: true,
    popupOnMessage: false,
    fontSize: "medium",
    showTimestamps: true,
    awayMessage: DEFAULT_AWAY_MESSAGE,
    statusBeforeAway: null,
  };
}

/**
 * Normalize whatever is on disk (or arrives in a patch) — junk falls back to
 * `base`: the defaults on a read, the STORED settings on a save (so a bad
 * patch value keeps what the member had, never resets them).
 */
function normalizeSettings(
  raw: unknown,
  base: MessengerSettings = defaultMessengerSettings(),
): MessengerSettings {
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;
  return {
    version: 1,
    theme: MESSENGER_THEMES.some((t) => t.id === r.theme) ? (r.theme as string) : base.theme,
    notifications: typeof r.notifications === "boolean" ? r.notifications : base.notifications,
    sound: typeof r.sound === "boolean" ? r.sound : base.sound,
    popupOnMessage: typeof r.popupOnMessage === "boolean" ? r.popupOnMessage : base.popupOnMessage,
    fontSize: FONT_SIZES.has(r.fontSize as string)
      ? (r.fontSize as MessengerSettings["fontSize"])
      : base.fontSize,
    showTimestamps: typeof r.showTimestamps === "boolean" ? r.showTimestamps : base.showTimestamps,
    // Capped to the SAME limit the profile status line is, because that is
    // where it lands — a message this file accepted and the profile store then
    // refused would be an away state that half-applied.
    awayMessage:
      typeof r.awayMessage === "string" ? r.awayMessage.slice(0, STATUS_MAX) : base.awayMessage,
    statusBeforeAway:
      typeof r.statusBeforeAway === "string"
        ? r.statusBeforeAway.slice(0, STATUS_MAX)
        : r.statusBeforeAway === null
          ? null
          : base.statusBeforeAway,
  };
}

/* ---------------------------------- the store ----------------------------------- */

export function getMessengerSettings(user: string): MessengerSettings {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsFile(user), "utf8")));
  } catch {
    return defaultMessengerSettings();
  }
}

/** Merge a patch over the stored settings — unknown keys and junk drop out. */
export async function saveMessengerSettings(
  user: string,
  patch: Record<string, unknown>,
): Promise<MessengerSettings> {
  const current = getMessengerSettings(user);
  const next = normalizeSettings({ ...current, ...patch }, current);
  const isNew = !fs.existsSync(settingsFile(user));
  writeAtomic(settingsFile(user), next);
  await journal(
    isNew ? "create" : "edit",
    settingsFile(user),
    `AmberX Vid messenger: ${user} saved their messenger settings (theme "${next.theme}")`,
  );
  return next;
}
