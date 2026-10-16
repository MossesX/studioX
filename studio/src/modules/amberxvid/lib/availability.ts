/**
 * @file DO NOT DISTURB, the MODEL (P13) — what `./dnd`'s seam was waiting for.
 *
 * ---------------------------------------------------------------------------
 * TWO SOURCES, NOT ONE TRI-STATE
 * ---------------------------------------------------------------------------
 * A member is undisturbable for one of two unrelated reasons:
 *
 *  - **The switch.** "Not now." Flipped by hand, cleared by hand.
 *  - **Quiet hours.** A weekly window they set once and stopped thinking about.
 *
 * They are stored as two independent fields because they overlap in the one
 * case that matters: a member inside their quiet window who ALSO flips the
 * switch expects the switch to still be on when 07:00 arrives. A single
 * tri-state ("available / dnd / scheduled") cannot express that, and every
 * implementation of it eventually clears the manual flag at the window's edge —
 * which reads, to the member, as the app turning their DND off behind their
 * back.
 *
 * ---------------------------------------------------------------------------
 * THE CLOCK IS THE SERVER'S, AND THAT IS A DECISION
 * ---------------------------------------------------------------------------
 * {@link isQuietAt} compares against the SERVER's local time. This is a studio
 * suite whose members and whose app server sit in one place; introducing a
 * per-member timezone would mean storing an IANA zone, keeping it correct
 * across a member's travel, and reconciling it with the browser's guess — for a
 * feature whose failure mode is a ring arriving fifteen minutes early.
 *
 * The honest consequence is recorded rather than hidden: `quietHours` means
 * server-local hours, {@link availabilitySummary} says so in words, and the
 * surface that renders it says so too. A member on another continent gets the
 * wrong window, and would rather be told that than discover it.
 *
 * ---------------------------------------------------------------------------
 * WRAPPING WINDOWS
 * ---------------------------------------------------------------------------
 * 22:00 → 07:00 is the normal case, not the exotic one, so the comparison is
 * written for it: when `start > end` the window is the UNION of `[start, 1440)`
 * and `[0, end)`. `start === end` is an EMPTY window rather than a whole-day
 * one — a member who set both ends to the same minute has not asked to be
 * silenced forever, and reading it as "always" would be the surprise this file
 * is otherwise built to avoid.
 *
 * The DAY of a wrapping window is the day it STARTED. A Friday-night quiet
 * window that runs to 07:00 covers Saturday morning; asking Saturday's box to
 * be ticked as well is a rule nobody would guess.
 *
 * House store posture (`./fsCore`): junk on disk reads as "available" rather
 * than as "silenced" — an unreadable document must never mute a member's
 * phone. Atomic writes, every save journaled. Server-only.
 */

import path from "node:path";

import { appendJournal, readJson, withStoreLock, writeJsonAtomic } from "./fsCore";
import { availabilityFile } from "./paths";
import type { AvailabilityDoc, DndVerdict, QuietHours } from "./types";

const norm = (u: string): string => u.trim().toLowerCase();

const MINUTES_PER_DAY = 1440;

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

/* --------------------------------- the shape ----------------------------------- */

export function defaultQuietHours(): QuietHours {
  // 22:00 → 07:00, off. The default window is the one most people would set,
  // so turning the feature on is one click rather than three fields.
  return { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60, days: [] };
}

export function defaultAvailability(user: string): AvailabilityDoc {
  return {
    version: 1,
    user: norm(user),
    dnd: false,
    quietHours: defaultQuietHours(),
    updatedAt: new Date(0).toISOString(),
  };
}

/** Clamp anything to a legal minute-of-day. Junk becomes `fallback`, never 0 —
 *  silently rewriting a corrupt start time to midnight would move a member's
 *  quiet window rather than leave it alone. */
function minute(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const n = Math.trunc(raw);
  return n >= 0 && n < MINUTES_PER_DAY ? n : fallback;
}

/** Weekday list: integers 0–6, de-duplicated, sorted. Anything else drops. */
function days(raw: unknown, fallback: number[]): number[] {
  if (!Array.isArray(raw)) return fallback;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isInteger(v)) continue;
    if (v < 0 || v > 6 || out.includes(v)) continue;
    out.push(v);
  }
  return out.sort((a, b) => a - b);
}

/** Normalize whatever is on disk (or arrives in a patch) against `base` — the
 *  defaults on a read, the STORED document on a save, so a bad patch value
 *  keeps what the member had rather than resetting them. */
function normalize(raw: unknown, base: AvailabilityDoc): AvailabilityDoc {
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const q = (typeof r.quietHours === "object" && r.quietHours !== null
    ? r.quietHours
    : {}) as Record<string, unknown>;
  return {
    version: 1,
    user: base.user,
    dnd: typeof r.dnd === "boolean" ? r.dnd : base.dnd,
    quietHours: {
      enabled: typeof q.enabled === "boolean" ? q.enabled : base.quietHours.enabled,
      startMinute: minute(q.startMinute, base.quietHours.startMinute),
      endMinute: minute(q.endMinute, base.quietHours.endMinute),
      days: days(q.days, base.quietHours.days),
    },
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : base.updatedAt,
  };
}

/* ---------------------------------- the store ----------------------------------- */

const lockName = (user: string): string => `availability-${norm(user)}`;

/** This member's document. A member who never touched DND has no file, and
 *  gets the defaults — which say "available". */
export function getAvailability(user: string): AvailabilityDoc {
  const key = norm(user);
  const base = defaultAvailability(key);
  return normalize(readJson<unknown>(availabilityFile(key), null), base);
}

/**
 * Merge a patch over the stored document. Unknown keys and junk drop out; the
 * whole write happens under the member's own lock, so two tabs flipping the
 * switch and editing the window in the same instant cannot lose one of them.
 */
export async function saveAvailability(
  user: string,
  patch: Record<string, unknown>,
): Promise<AvailabilityDoc> {
  const key = norm(user);
  const next = withStoreLock(lockName(key), () => {
    const current = getAvailability(key);
    const merged = normalize({ ...current, ...patch }, current);
    // A quiet-hours patch arrives as a whole object; merge it field-wise so a
    // client sending only `{ quietHours: { enabled: true } }` does not silently
    // reset the window to the defaults.
    if (typeof patch.quietHours === "object" && patch.quietHours !== null) {
      merged.quietHours = normalize(
        { quietHours: { ...current.quietHours, ...(patch.quietHours as object) } },
        current,
      ).quietHours;
    }
    merged.updatedAt = new Date().toISOString();
    writeJsonAtomic(availabilityFile(key), merged);
    return merged;
  });
  try {
    await appendJournal("edit", ledgerPath(availabilityFile(key)), {
      summary: `AmberX Vid availability: ${key} is now ${next.dnd ? "on do-not-disturb" : "available"}${
        next.quietHours.enabled ? ` (quiet hours ${clock(next.quietHours.startMinute)}–${clock(next.quietHours.endMinute)})` : ""
      }`,
    });
  } catch {
    /* the ledger can never fail a save */
  }
  return next;
}

/* ---------------------------------- the clock ----------------------------------- */

/** `510` → `"08:30"`. Exported because the surface, the toast copy and the
 *  ledger line must all spell a window the same way. */
export function clock(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Is `at` inside this window? See the header for the wrapping and same-minute
 * rules — both live here rather than at any call site.
 */
export function isQuietAt(q: QuietHours, at: Date = new Date()): boolean {
  if (!q.enabled) return false;
  if (q.startMinute === q.endMinute) return false; // an empty window, not a whole day
  const nowMinute = at.getHours() * 60 + at.getMinutes();
  const today = at.getDay();
  const wraps = q.startMinute > q.endMinute;
  const inside = wraps
    ? nowMinute >= q.startMinute || nowMinute < q.endMinute
    : nowMinute >= q.startMinute && nowMinute < q.endMinute;
  if (!inside) return false;
  if (q.days.length === 0) return true;
  // The window belongs to the day it STARTED, so the pre-midnight tail of a
  // wrapping window is checked against YESTERDAY's box.
  const owningDay = wraps && nowMinute < q.endMinute ? (today + 6) % 7 : today;
  return q.days.includes(owningDay);
}

/* --------------------------------- the verdict ----------------------------------- */

/**
 * THE answer the ring path needs: may this member be rung right now, and if
 * not, which of the two sources refused.
 *
 * The switch is checked first, so a member inside their quiet window who also
 * flipped it is told the truth they would say themselves ("I turned it on"),
 * not the one the schedule happens to agree with.
 */
export function dndVerdictFor(user: string, at: Date = new Date()): DndVerdict {
  const doc = getAvailability(user);
  if (doc.dnd) {
    return { dnd: true, source: "toggle", why: "Do not disturb is on." };
  }
  if (isQuietAt(doc.quietHours, at)) {
    return {
      dnd: true,
      source: "quiet-hours",
      why: `Quiet hours (${clock(doc.quietHours.startMinute)}–${clock(doc.quietHours.endMinute)}).`,
    };
  }
  return { dnd: false, source: null, why: "Available." };
}

/**
 * The `DndSource` shape `./dnd` installs. Kept as its own tiny export rather
 * than passing `dndVerdictFor` directly, so the seam's contract (a boolean)
 * stays the seam's contract even though this file has more to say.
 */
export function availabilityDndSource(user: string): boolean {
  return dndVerdictFor(user).dnd;
}

/** One sentence describing a member's whole availability, for a chip or a
 *  report — including the timezone caveat, which is the header's honest
 *  consequence and therefore has to be visible. */
export function availabilitySummary(user: string): string {
  const doc = getAvailability(user);
  const parts: string[] = [doc.dnd ? "Do not disturb is ON" : "Do not disturb is off"];
  if (doc.quietHours.enabled) {
    const when =
      doc.quietHours.days.length === 0
        ? "every day"
        : doc.quietHours.days.map((d) => DAY_NAMES[d]).join(", ");
    parts.push(
      `quiet hours ${clock(doc.quietHours.startMinute)}–${clock(doc.quietHours.endMinute)} ${when} (server time)`,
    );
  } else {
    parts.push("no quiet hours");
  }
  return `${parts.join(" · ")}.`;
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
