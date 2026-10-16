/**
 * @file The SERVER's read of the member's preferences (P16) — the same kv
 * document the settings tree writes, read from disk by the code that enforces
 * it. Server-only.
 *
 * ---------------------------------------------------------------------------
 * WHY A SERVER READ EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * Four of the tree's rows are not the client's business to obey:
 *
 *  - `whoMayCall` — the ring door refuses the ring, in `./ring`. A client that
 *    decided this would be a doorbell with the wire cut on the caller's side.
 *  - `whoMayInvite` — the invitation door, same reason.
 *  - `followedLiveAlerts` — the go-live fan-out picks its audience in
 *    `app/api/amberxvid/streams/route.ts`; a member who turned it off should
 *    not have the alert delivered and then discarded by their own browser.
 *  - `defaultPostVisibility` / `defaultAlbumVisibility` — these two ARE the
 *    client's, and are listed here only to say so: they seed a composer, and a
 *    composer that has not opened yet has nothing to enforce.
 *
 * ---------------------------------------------------------------------------
 * THE DOCUMENT IS THE SPINE'S, NOT THIS MODULE'S
 * ---------------------------------------------------------------------------
 * `data/axf/kv/<user>/amberxvid-settings.json`, written by core's settings
 * store through `/api/axf/kv`, whose user is the verified `axs_session` cookie
 * (`src/server/axfKv.ts`). This file does not own the path, the envelope or the
 * scoping — it asks `axfKv` for the same namespace the decl claims. That is the
 * whole reason the tree rides the accounts spine instead of growing a
 * per-member store of its own: there is one document, one writer, one reader.
 *
 * ---------------------------------------------------------------------------
 * DEGRADE TO THE DEFAULTS, NEVER TO A REFUSAL
 * ---------------------------------------------------------------------------
 * A member who has never opened the tree has NO document, and that is the
 * common case rather than an error. An absent or unreadable document answers
 * with `DEFAULT_PREFS` — which is `everyone` for both audience rows and `true`
 * for the alert. Failing the other way would make a kv hiccup look exactly like
 * a member blocking their own buddies, and nobody would think to look here.
 */

import { axfKv } from "@axs/server/axfKv";

import { DEFAULT_PREFS, PREFS_NS, normalizePrefs } from "./prefs";
import type { AmberxvidPrefs } from "./prefs";

/**
 * One member's preferences as the server sees them.
 *
 * The envelope is core's settings-store shape — `{ v: 1, settings: {...} }` —
 * and a document with any other `v` is treated as absent rather than guessed
 * at, which is the same rule `ModuleSettingsStore` applies on the client.
 */
export async function readPrefs(user: string): Promise<AmberxvidPrefs> {
  const key = user.trim().toLowerCase();
  if (!key) return DEFAULT_PREFS;
  try {
    const doc = await axfKv.read(key, PREFS_NS);
    if (!doc || doc.v !== 1) return DEFAULT_PREFS;
    return normalizePrefs(doc.settings);
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * May `from` reach `to` through a door `to` governs?
 *
 * One function for both audience rows because they ask the identical question
 * of two different keys, and because the two answers that are NOT a preference
 * belong in one place: a member may always reach themselves, and a caller the
 * relations layer has already refused never gets here at all (`./ring` and the
 * invite door consult the block list first — this is the narrower "and do they
 * want to hear from strangers" question, asked after).
 */
export async function mayReach(
  to: string,
  from: string,
  door: "whoMayCall" | "whoMayInvite",
  isBuddy: (a: string, b: string) => boolean | Promise<boolean>,
): Promise<boolean> {
  const target = to.trim().toLowerCase();
  const caller = from.trim().toLowerCase();
  if (!target || !caller) return false;
  if (target === caller) return true;
  const prefs = await readPrefs(target);
  if (prefs[door] !== "buddies") return true;
  try {
    return (await isBuddy(target, caller)) === true;
  } catch {
    // The relations store could not answer. Refusing here would silently mute a
    // member's buddies on a read error; the block list has already been applied
    // by the caller, so letting it through is the smaller failure.
    return true;
  }
}
