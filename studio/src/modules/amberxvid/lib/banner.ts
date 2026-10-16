"use client";

/**
 * @file What the suite banner's account hook opens — the module's answer,
 * handed up to the chrome.
 *
 * The banner is drawn by `AppShell` / `StandaloneHost`, which render ABOVE
 * `AmberXVidModule` and therefore cannot see its state: which stage view is
 * open, whose profile is focused, or how a finished sign-out has to unwind the
 * module's own `entered` flag. So the module publishes those two actions and
 * the banner calls them — the same shape, and the same reason, as
 * `./viewer` publishing the identity.
 *
 * Sign-out itself is deliberately NOT here: `signOutAmberXVid` in the viewer
 * module already owns it, both chromes already called it before this file
 * existed, and a second copy would be a second thing to keep right. The module
 * only gets told it happened, through {@link AmberXVidBannerHooks.onSignedOut}.
 *
 * **Unpublished means absent, never dead.** Before the module's shell mounts —
 * the splash, the suite's login flow, an accounts-service error — there is no
 * profile to open, so the banner draws no account icon rather than one that
 * does nothing.
 */

import * as React from "react";

export interface AmberXVidBannerHooks {
  /** Open the signed-in member's own profile in the suite. */
  onAccount: () => void;
  /** A sign-out completed in the chrome — unwind the module's session state. */
  onSignedOut: () => void;
}

let current: AmberXVidBannerHooks | null = null;
const subscribers = new Set<() => void>();

function emit(next: AmberXVidBannerHooks | null): void {
  current = next;
  for (const fn of [...subscribers]) fn();
}

/**
 * Publish (or, with `null`, retract) the banner's actions. Called from an
 * effect in the module's shell — publishing during render would hand the
 * chrome a new object on every keystroke and re-render the banner for nothing.
 */
export function publishAmberXVidBannerHooks(hooks: AmberXVidBannerHooks | null): void {
  emit(hooks);
}

/**
 * The live hooks, or `null` when no suite shell is mounted. Pass `active:
 * false` off the suite's routes so the chrome on the other 30 routes pays
 * nothing.
 */
export function useAmberXVidBannerHooks(active: boolean): AmberXVidBannerHooks | null {
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
  return React.useSyncExternalStore(
    subscribe,
    () => (active ? current : null),
    () => null, // server render: no module has mounted yet, so no hooks
  );
}
