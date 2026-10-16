"use client";

/**
 * @file The browser half of the credit meter — one hook over
 * `GET /api/amberxvid/credits` (P18).
 *
 * Named `creditsClient` after the `wallClient` / `albumClient` precedent, and it
 * exists for the same reason those do: `./credits` is server-only (it reaches
 * the accounts ledger through node), so a component that imported it would drag
 * `node:fs` into the browser bundle and typecheck cleanly while doing it. The
 * types cross by `import type`, which is erased; nothing else does.
 *
 * The fetch is per mount with a manual `refresh`, not a poll. A balance moves
 * when the member spends or an administrator grants, and both of those already
 * have a moment where a refresh belongs — an interval would be a request every
 * few seconds, forever, for a number that changes a handful of times a day.
 */

import * as React from "react";

import type { CreditStatement } from "@axs/modules/accounts/lib/types";

import type { CreditsMeter } from "./creditsMeters";
import type { CreditsStatus, PurchaseAvailability } from "./credits";

export interface CreditsSnapshot {
  /** Null until the first answer — a chip renders nothing rather than a zero it
   *  has not been told, which would flicker the wrong number on every mount. */
  readonly statement: CreditStatement | null;
  readonly status: CreditsStatus | null;
  readonly purchase: PurchaseAvailability | null;
  readonly meters: readonly CreditsMeter[];
  readonly loading: boolean;
  /** Set when the meter could not be read. The surface says so rather than
   *  showing a balance of zero, which is a different and much worse lie. */
  readonly error: string | null;
}

const EMPTY: CreditsSnapshot = {
  statement: null,
  status: null,
  purchase: null,
  meters: [],
  loading: true,
  error: null,
};

interface CreditsResponse {
  ok?: boolean;
  error?: string;
  statement?: CreditStatement;
  status?: CreditsStatus;
  purchase?: PurchaseAvailability;
}

/**
 * The caller's credit standing. `enabled` gates whether a surface should show
 * anything at all: with metering off and a zero balance there is nothing to
 * say, and a chip reading "0 credits" beside a feature that charges nothing is
 * chrome for a system that is not running.
 */
export function useAmberXVidCredits(enabled = true): CreditsSnapshot & { refresh: () => void } {
  const [snap, setSnap] = React.useState<CreditsSnapshot>(EMPTY);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) {
      setSnap({ ...EMPTY, loading: false });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/amberxvid/credits");
        const json = (await res.json().catch(() => null)) as CreditsResponse | null;
        if (cancelled) return;
        if (!res.ok || !json?.ok || !json.statement || !json.status) {
          // A 401/403 is not an error worth showing — it means this viewer is
          // not an AmberX Vid member, and the surface asking has already got a
          // login or join card of its own.
          setSnap({
            ...EMPTY,
            loading: false,
            error: res.status === 401 || res.status === 403 ? null : json?.error ?? "the credit meter could not be read",
          });
          return;
        }
        setSnap({
          statement: json.statement,
          status: json.status,
          purchase: json.purchase ?? null,
          meters: json.status.meters ?? [],
          loading: false,
          error: null,
        });
      } catch {
        if (!cancelled) setSnap({ ...EMPTY, loading: false, error: "the credit meter is unreachable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  const refresh = React.useCallback(() => setTick((n) => n + 1), []);
  return { ...snap, refresh };
}

/**
 * Should a surface draw the credit affordance at all?
 *
 * True when metering is on (the member will be charged, so they need to see the
 * number) or when they hold a balance (an administrator granted credits ahead
 * of switching metering on, and hiding them would look like the grant failed).
 */
export function creditsWorthShowing(snap: CreditsSnapshot): boolean {
  if (snap.status?.enabled) return true;
  return (snap.statement?.balance ?? 0) !== 0;
}
