/**
 * @file The module's own credit meters, as CONTRIBUTIONS to its own point
 * (P18, 2026-08-15).
 *
 * Data only — no thunk, no component — so this file stays importable by plain
 * Node, which the closure resolver requires and which `adminTab.ts` explains at
 * length for the same reason.
 *
 * ## Why a module contributes to a point it declares
 *
 * `amberxvid.credits-meter` is the pricing surface plugins extend, and the
 * assistant turn is the module's own built-in meter. It could have lived only
 * in the server table (`lib/creditsMeters.ts`) and been chargeable without ever
 * appearing in the registry — and that is precisely the state worth avoiding:
 * a price that charges real credits and that nothing in the system can
 * enumerate. "What plugs in here" has to be answerable for the peel to be
 * computable and for a meter list to be complete, so the built-in goes through
 * the same door a plugin's would.
 *
 * The two halves are pinned to each other by `CREDITS_METER_POINT` being one
 * constant, and by the payload being the SAME object the server table is seeded
 * with — not a copy of its fields. A price stated twice is a price that drifts,
 * and this one is denominated in money.
 *
 * Registered in `src/studio.subsystem.ts`'s one contributions loop.
 */
import type { Contribution } from "@axf/core";

import {
  ASSISTANT_TURN_METER,
  CREDITS_METER_POINT,
  type CreditsMeter
} from "./lib/creditsMeters";

export const AMBERXVID_ASSISTANT_TURN_METER: Contribution<CreditsMeter> = {
  from: "amberxvid",
  point: CREDITS_METER_POINT,
  priority: 10,
  payload: ASSISTANT_TURN_METER
};
