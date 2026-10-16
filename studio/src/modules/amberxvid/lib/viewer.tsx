"use client";

/**
 * @file Who is looking at AmberX Vid, as the CHROME around it needs to know.
 *
 * The suite gets its own bar rather than the workbench chrome. That decision has
 * to be made by `AppShell` and `StandaloneHost`, which render ABOVE the module
 * and therefore cannot see its state; hence this tiny shared store rather than
 * a prop drilled through the shell.
 *
 * The rule used to be role-shaped (2026-08-03): a *confined* member got the bar
 * and an administrator got the whole workbench, because both held GizmoX
 * accounts and only some of them were fenced in. The P7 split (2026-08-04)
 * collapsed that distinction — an `axv_session` is not a GizmoX identity at all,
 * so every signed-in viewer of the suite gets the suite and nothing else.
 *
 * Two sources feed it, and both matter:
 *   - the module publishes its own snapshot as it loads
 *     ({@link publishAmberXVidViewer}), so a role change lands without a fetch;
 *   - the hook fetches `/api/amberxvid/accounts` itself the first time a
 *     surface asks, so the chrome is right during the 7–12 s splash, before the
 *     module has published anything.
 *
 * The role is advisory chrome only. Every API re-verifies it server-side per
 * request — nothing here grants or withholds access to data.
 */

import * as React from "react";
import type { AccountMe, AccountsSnapshot, AvatarValue } from "./types";

/* --------------------------------- contract --------------------------------- */

export type AmberXVidRole =
  /** Not resolved yet — render the chrome you would render anyway. */
  | "unknown"
  /** Signed out, or signed in as an account that has since been disabled. */
  | "none"
  | "member"
  | "administrator";

export interface AmberXVidViewer {
  role: AmberXVidRole;
  username: string | null;
  screenname: string | null;
  /**
   * True when an AmberX Vid session is signed in on this browser — the server's
   * own answer (`AccountsSnapshot.signedIn`), never re-derived here.
   *
   * It is what decides the chrome, and it is deliberately not the module role:
   * an AmberX Vid administrator administers the *suite*, and holds nothing in
   * GizmoX either. Drawing them a nav rail to modules their session cannot open
   * would be a lie.
   */
  suiteOnly: boolean;
  /**
   * The viewer's designed avatar or AI portrait, for the banner's account chip
   * (P14). It lives on the VIEWER rather than on the banner's action hooks
   * because it is identity, and identity is what this store is for — the same
   * reason the screenname is here. It arrives on its own channel
   * ({@link publishAmberXVidAvatar}) because the accounts snapshot does not
   * carry it: the profile is a second fetch, so the chip draws the initial disc
   * for a beat and then the face, rather than holding the whole bar back.
   */
  avatar: AvatarValue;
  /** True once a fetch or a publish has answered — the fields are honest from here. */
  resolved: boolean;
}

const UNKNOWN: AmberXVidViewer = {
  role: "unknown",
  username: null,
  screenname: null,
  suiteOnly: false,
  avatar: null,
  resolved: false,
};

/** The suite's own routes — where this chrome rule applies. */
export function isAmberXVidSurface(pathname: string): boolean {
  return pathname === "/amberxvid" || pathname.startsWith("/amberxvid/") || pathname === "/amberx_vid";
}

/* ----------------------------------- store ---------------------------------- */

let current: AmberXVidViewer = UNKNOWN;
let inflight: Promise<void> | null = null;
const subscribers = new Set<() => void>();

function emit(next: AmberXVidViewer): void {
  current = next;
  for (const fn of [...subscribers]) fn();
}

function fromSnapshot(me: AccountMe | null, suiteOnly: boolean): AmberXVidViewer {
  // A signed-out snapshot is a different PERSON, so the face goes with the
  // name. A signed-in one keeps whatever the profile channel last published
  // — the accounts snapshot has no avatar in it, and clearing on every refresh
  // would flicker the chip back to the initial disc once a minute.
  if (!me) {
    return { role: "none", username: null, screenname: null, suiteOnly, avatar: null, resolved: true };
  }
  const sameViewer = current.username !== null && current.username === me.username;
  return {
    role: me.disabled ? "none" : me.role === "administrator" ? "administrator" : "member",
    username: me.username,
    screenname: me.screenname,
    suiteOnly,
    avatar: sameViewer ? current.avatar : null,
    resolved: true,
  };
}

/** The module's own snapshot, handed to the chrome. Cheap and idempotent. */
export function publishAmberXVidViewer(me: AccountMe | null, suiteOnly: boolean): void {
  const next = fromSnapshot(me, suiteOnly);
  if (
    next.role === current.role &&
    next.username === current.username &&
    next.screenname === current.screenname &&
    next.suiteOnly === current.suiteOnly &&
    current.resolved
  ) {
    return;
  }
  emit(next);
}

/**
 * The viewer's face, from the module's own profile fetch (P14).
 *
 * Separate from {@link publishAmberXVidViewer} because it arrives later and
 * from a different route: the accounts snapshot answers who you are, the
 * profile answers what you look like, and the banner must not wait for the
 * second to draw the first. Ignored before a viewer is known, so a stray
 * publish cannot invent an identity out of an avatar.
 */
export function publishAmberXVidAvatar(avatar: AvatarValue): void {
  if (current.username === null || current.avatar === avatar) return;
  emit({ ...current, avatar });
}

/** Forget the cached viewer — a sign-out or a profile close must not leave a
 *  stale role deciding what chrome the NEXT person sees. */
export function resetAmberXVidViewer(): void {
  inflight = null;
  emit(UNKNOWN);
}

/**
 * Sign out, from the chrome that draws the button.
 *
 * **This is a STUDIO sign-out now** (P1, 2026-08-14), and that is a real change
 * in meaning rather than a re-pointed URL. There is one session, so ending it
 * ends it everywhere — including the operator's other tabs. The old comment
 * here promised the opposite, and it was true only while the suite had a second
 * cookie of its own to drop; keeping the promise would now require inventing
 * one back.
 *
 * The button that calls this is labelled for the whole studio, not the suite,
 * so the person clicking it is told what it does before they do it.
 *
 * Best-effort — a failed POST still returns the surface to the login card,
 * because the module re-reads the (now unusable) session on its next load.
 */
export async function signOutAmberXVid(): Promise<void> {
  try {
    await fetch("/api/accounts/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
  } catch {
    /* clearing the cookie is best-effort */
  }
  resetAmberXVidViewer();
}

function load(): void {
  if (inflight || current.resolved) return;
  inflight = fetch("/api/amberxvid/accounts")
    .then(async (res) => {
      if (!res.ok) {
        // The route answers 200 for an anonymous caller, so a failure here is
        // the service being unreachable, not a signed-out visitor: claim
        // nothing rather than draw a bar with no way out of it.
        emit({
          role: "none",
          username: null,
          screenname: null,
          suiteOnly: false,
          avatar: null,
          resolved: true,
        });
        return;
      }
      const snap = (await res.json()) as AccountsSnapshot;
      // A signed-in NON-member is not a suite viewer: they are on the join
      // card. Drawing them the suite's own bar would frame a screen that is
      // not the suite. Same rule the module applies when it publishes.
      emit(fromSnapshot(snap.me, snap.signedIn === true && snap.notMember !== true));
    })
    .catch(() => {
      // Degrade to "unknown": full chrome beats a bar with no way out of it.
      emit(UNKNOWN);
    })
    .finally(() => {
      inflight = null;
    });
}

/* ----------------------------------- hook ----------------------------------- */

/**
 * The current viewer. Pass `active: false` on every surface that is not AmberX
 * Vid — the hook then subscribes to nothing and never fetches, so the shell
 * pays nothing on the other 30 routes.
 */
export function useAmberXVidViewer(active: boolean): AmberXVidViewer {
  const subscribe = React.useCallback(
    (fn: () => void) => {
      if (!active) return () => undefined;
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    [active],
  );
  const viewer = React.useSyncExternalStore(
    subscribe,
    () => (active ? current : UNKNOWN),
    () => UNKNOWN, // server render: never assume a role before the client knows
  );

  React.useEffect(() => {
    if (active) load();
  }, [active]);

  return viewer;
}
