/**
 * @file DO NOT DISTURB — the one place the module asks "may I interrupt this
 * member right now?", written in P12 and INSTALLED in P13.
 *
 * ---------------------------------------------------------------------------
 * P13 INSTALLED THE MODEL — READ THIS FIRST
 * ---------------------------------------------------------------------------
 * The seam below is unchanged and still overridable, but it is no longer
 * EMPTY: `./availability` is the model, and it is the DEFAULT source rather
 * than something a registration pass has to remember to install.
 *
 * That is a deliberate departure from the `setVaultQuotaSource` shape this file
 * was written against, and the reason is that the shape does not fit. A vault
 * quota source is installed by the ACCOUNTS module when it arrives, from
 * outside; DND has no outside — the model is this module's own, in this
 * module's own store, and `installVaultStorage()` (the one registration pass
 * that exists) is not called by any app code yet. A source that has to be
 * installed by a pass nobody runs is a source that is never installed, which is
 * exactly the false-green this file's own honesty rule forbids.
 *
 * So: the default is the real model, and {@link setDndSource} remains for the
 * two callers that genuinely need to substitute one — tests, and P16 if its
 * settings rows end up wanting to answer the question themselves. Passing
 * `null` restores the model rather than disabling the check.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CHECK EXISTED BEFORE THE SETTINGS DID
 * ---------------------------------------------------------------------------
 * P12 ships the thing that interrupts people — a follower alert that fires
 * whenever somebody they follow goes live — and P13 ships the settings that
 * silence it. Building them in that order is only safe if the CHECK is written
 * now, at the one chokepoint, rather than left as a TODO for the phase that
 * adds the switch: a notify path written without the question in it is a path
 * somebody has to remember to go back and gate, and the phase that adds the
 * setting would then have to find every caller. There is one caller, it is
 * {@link mayInterrupt}, and it is already asked.
 *
 * So this file is a SEAM in the shape the module already uses for exactly this
 * problem — `setVaultQuotaSource` / `setStorageLedger` in `./vault`, installed
 * by `./vault-registration`. P13 calls {@link setDndSource} once with whatever
 * its model turns out to be (a schedule, a switch, a per-kind matrix), and
 * every alert in the module is gated by it from that moment with no edit here
 * and no edit at the call site.
 *
 * ---------------------------------------------------------------------------
 * THE HONESTY RULE THIS FILE HAS TO OBEY
 * ---------------------------------------------------------------------------
 * A seam with nothing plugged into it that answers "allowed" is the false-green
 * shape `./vault`'s header warns about: the guard runs, the guard passes, and
 * nothing is actually being enforced. Two things keep that from happening here:
 *
 *  1. {@link dndStatus} reports `installed: false` and says so in words. The
 *     absence of a source is a REPORTABLE state, not a silent yes — P13's proof
 *     is that this flips to `installed: true` and that a live alert then stops
 *     arriving.
 *
 *  2. **The check is not vacuous today.** `MessengerSettings.notifications` is
 *     a real per-member switch, on disk, that a member can already turn off,
 *     and it means "do not pop things at me". Honouring it is not a stand-in
 *     for DND — it is a narrower question that is already answered — so an
 *     alert IS suppressed today for anybody who turned notifications off.
 *
 * The default for an unanswerable question is INTERRUPT, deliberately. A
 * follower who asked to be told when somebody goes live and was not told has
 * lost the feature silently; a follower who is told when they would rather not
 * have been has a switch. Failing closed here would make P13 look like it broke
 * alerts rather than like it added a setting.
 *
 * Server-only.
 */

import { availabilityDndSource, dndVerdictFor } from "./availability";
import { getMessengerSettings } from "./messengerSettings";
import type { DndVerdict } from "./types";

const norm = (u: string): string => u.trim().toLowerCase();

/* ----------------------------------- the seam ----------------------------------- */

/**
 * P13's answer: is this member on do-not-disturb right now?
 *
 * `true` means "do not interrupt". Async because a real model will read a
 * document (and possibly a schedule with a clock in it), and a source that
 * throws is treated as no answer rather than as a refusal — a broken settings
 * read must not silently mute a member's alerts.
 */
export type DndSource = (user: string) => boolean | Promise<boolean>;

/** `null` means "use the model" — see the P13 note in the header. It does NOT
 *  mean "nothing is enforced" any more. */
let source: DndSource | null = null;

/** Substitute the DND source, or restore the `./availability` model with
 *  `null`. Tests use this; nothing in the app does. */
export function setDndSource(next: DndSource | null): void {
  source = next;
}

/** Whatever is answering the question right now. */
const activeSource = (): DndSource => source ?? availabilityDndSource;

export interface DndStatus {
  /** True whenever a real model is answering — which, since P13, is always. */
  installed: boolean;
  /** What is actually being enforced right now, in a sentence a report can
   *  print without re-deriving it. */
  why: string;
}

export function dndStatus(): DndStatus {
  return {
    installed: true,
    why: source
      ? "A substituted do-not-disturb source is installed — every ring and alert is filtered through it."
      : "The availability model (explicit switch + quiet hours, `./availability`) is answering. Rings are filtered through it; broadcast alerts are filtered through it AND the member's own messenger notifications switch.",
  };
}

/* ---------------------------------- the check ----------------------------------- */

/** Is this member on do-not-disturb? */
export async function isDoNotDisturb(user: string): Promise<boolean> {
  try {
    return (await activeSource()(norm(user))) === true;
  } catch {
    // A source that cannot answer has not said "do not disturb" — it has said
    // nothing, and silence is not a refusal.
    return false;
  }
}

/**
 * The same answer WITH its reason, for the two places that have to say
 * something to a human: the caller who is told the member is unavailable, and
 * the member's own availability surface.
 *
 * A substituted source has no reason to give, so it reports as the toggle —
 * the honest generic, rather than a schedule it may not have.
 */
export function dndVerdict(user: string): DndVerdict {
  if (source) {
    let flagged = false;
    try {
      const answer = source(norm(user));
      // Only a synchronous substitute can be reported on here; an async one
      // falls back to "available", which is this file's default for a question
      // nobody answered in time.
      flagged = answer === true;
    } catch {
      flagged = false;
    }
    return flagged
      ? { dnd: true, source: "toggle", why: "Do not disturb is on." }
      : { dnd: false, source: null, why: "Available." };
  }
  return dndVerdictFor(norm(user));
}

/**
 * MAY THIS MEMBER BE RUNG? The ring path's question, and deliberately a
 * NARROWER one than {@link mayInterrupt}.
 *
 * A ring is one person asking for this person, now. The messenger's
 * `notifications` switch means "do not pop things at me" — it governs the
 * broadcast alerts {@link mayInterrupt} gates (somebody you follow went live),
 * and it must not double as an unlisted phone number: a member who turned chat
 * popups off has not said their buddies may no longer call them, and would have
 * no idea that is what the switch did.
 *
 * So a ring asks the DND model and nothing else. The member who genuinely wants
 * no calls has the switch and the schedule, both of which say so out loud.
 */
export async function mayRing(user: string): Promise<boolean> {
  const key = norm(user);
  if (!key) return false;
  return !(await isDoNotDisturb(key));
}

/**
 * THE chokepoint: may the module interrupt this member with an alert?
 *
 * Every interrupting notification in the module goes through here, and the
 * point of it being one function is that P13's model lands in one place rather
 * than in every caller. Today it answers two questions; tomorrow it answers
 * three, and no caller changes.
 */
export async function mayInterrupt(user: string): Promise<boolean> {
  const key = norm(user);
  if (!key) return false;
  // The member's own switch, which exists today and means exactly this.
  if (getMessengerSettings(key).notifications !== true) return false;
  return !(await isDoNotDisturb(key));
}

/** Filter a list of members down to the ones who may be interrupted — the
 *  fan-out shape every alert audience actually needs. Order is preserved. */
export async function interruptible(users: string[]): Promise<string[]> {
  const verdicts = await Promise.all(users.map((u) => mayInterrupt(u)));
  return users.filter((_, i) => verdicts[i]);
}
