/**
 * @file **The credit METER** — where the platform's currency is spent, and the
 * honest half of buying more (P18 of `axf-amberxvid-social`, 2026-08-15).
 *
 * The split this file sits on either side of:
 *
 * | accounts (`accounts/lib/credits.ts`) | here |
 * |---|---|
 * | the append-only ledger, the fold, the lock | nothing — this file stores no balance |
 * | `spendCredits` / `recordPurchase` / `grantCredits` | the callers, and what each one is FOR |
 * | who a credit belongs to | what a credit BUYS, and how many |
 * | — | `canBuyCredits`: the policy row bites here, at the checkout |
 * | — | the meter table (`./creditsMeters`) and the point plugins contribute to |
 *
 * That is the same line `./policy` draws for the policy catalog and `./vault-
 * registration` draws for storage: identity's module owns the record, this
 * module owns where it bites. It is why nothing in `accounts` names a meter and
 * nothing here writes a ledger file.
 *
 * ## Metering is OFF until a deployment turns it on, and that is deliberate
 *
 * `AMBERXVID_CREDITS` (env, read per call). Absent → {@link creditsEnabled} is
 * false, every charge is a no-op that says so, and the assistant answers exactly
 * as it did the day before this phase landed.
 *
 * The permissive-default argument that governs `./policy` points the OTHER way
 * here, and the reason is worth writing down. A policy row defaults permissive
 * so that installing the cascade changes nothing; credits default OFF for the
 * same goal by the opposite setting, because nobody holds a balance yet. A
 * default-on meter would refuse the very first assistant turn in every existing
 * studio, for a currency that studio has never been offered. "Installing changes
 * nothing" is the invariant; which boolean achieves it depends on which way the
 * feature fails closed.
 *
 * An env var rather than a module setting for the reason `./membership` already
 * had to state: this module's settings adapter is a CLIENT hook over the core
 * store, and no route can read it. A gate a route cannot see is not a gate.
 *
 * ## Buying is a stub, and it says so
 *
 * There is no payment processor in this studio. `AMBERXVID_PAYMENTS_URL` absent
 * → {@link purchaseAvailability} answers `available: false` with a sentence, the
 * buy surface renders that sentence and offers **nothing clickable**. No card
 * form, no "coming soon" button that opens a dialog apologising, no fake
 * checkout that credits the ledger. A UI that looks like it takes money and does
 * not is worse than no UI: somebody eventually types a card number into it.
 *
 * Set, the flow is a hand-off: {@link startCheckout} mints a reference, gates it
 * on `canBuyCredits`, and hands back the processor's URL with that reference on
 * it. The credit lands on the RETURN leg ({@link completeCheckout}) and nowhere
 * else — a member who opens the payment page and closes it has bought nothing.
 *
 * Server-only.
 */

import {
  creditBalance,
  creditStatement,
  recordPurchase,
  refundCredits,
  spendCredits,
} from "@axs/modules/accounts/lib/credits";
import type { CreditStatement } from "@axs/modules/accounts/lib/types";

import { creditsMeter, creditsMeters, type CreditsMeter } from "./creditsMeters";
import { assertCanBuyCredits } from "./policy";

export { CREDITS_METER_POINT, registerCreditsMeter } from "./creditsMeters";
export type { CreditsMeter } from "./creditsMeters";

/* ================================ the switch ================================= */

/**
 * Is credit metering on for this deployment? `AMBERXVID_CREDITS`, read per call
 * so a test and a deploy env both bind without import-order games.
 */
export function creditsEnabled(): boolean {
  const raw = process.env.AMBERXVID_CREDITS?.trim().toLowerCase();
  if (raw === undefined || raw === "") return false;
  return raw !== "0" && raw !== "off" && raw !== "false" && raw !== "no";
}

/**
 * Where the credit system stands, as a fact a caller and a test can read rather
 * than a silence. `enabled: false` is not a pass — it is the honest statement
 * that no charge in this studio will ever be made, which is exactly the thing an
 * administrator wondering why nobody's balance moves needs to be told.
 */
export interface CreditsStatus {
  readonly enabled: boolean;
  /** Present when off — one sentence naming the env var and the consequence. */
  readonly why?: string;
  readonly meters: readonly CreditsMeter[];
}

export function creditsStatus(): CreditsStatus {
  const meters = creditsMeters();
  if (creditsEnabled()) return { enabled: true, meters };
  return {
    enabled: false,
    why:
      "credit metering is off for this deployment (AMBERXVID_CREDITS is unset), so no feature " +
      "charges anything and every balance stays where an administrator put it. The meters below " +
      "are declared and would charge the listed amounts the moment it is set.",
    meters,
  };
}

/* ================================= spending ================================== */

/**
 * The answer to "did that cost anything". `charged: false` covers BOTH the
 * metering-off case and a genuinely free meter, and they are distinguishable by
 * `why` — a caller that treats them the same is still correct, which is the
 * point of one shape.
 */
export type MeterCharge =
  | { ok: true; charged: false; why: string; balance: number }
  | { ok: true; charged: true; meter: string; cost: number; balance: number; ref: string }
  | { ok: false; error: string; status: number; balance: number; meter: string };

/**
 * **THE spend helper.** Every metered feature charges through this and nothing
 * else, so that there is exactly one place that knows metering can be off, one
 * place that resolves a price, and one place that shapes a refusal.
 *
 * `units` multiplies the meter's cost — a render of four images, a call of
 * twenty minutes. It rounds up rather than down: a fractional unit is still work
 * that was done, and rounding it to zero is how a meter quietly becomes free.
 *
 * The refusal is a 402, not a 403. They are different sentences to a member:
 * 403 means "you are not allowed to", which is a conversation with an
 * administrator about permissions, and 402 means "you are allowed to and cannot
 * afford it", which is a conversation about credits. Sending 403 for both is how
 * a member ends up asking for a grant they already have.
 */
export async function chargeMeter(
  username: string,
  meterId: string,
  units = 1,
  detail?: string,
): Promise<MeterCharge> {
  const balance = await creditBalance(username);

  if (!creditsEnabled()) {
    return {
      ok: true,
      charged: false,
      why: "credit metering is off for this deployment",
      balance,
    };
  }

  const meter = creditsMeter(meterId);
  if (!meter) {
    // Refused rather than defaulted. A default price is a price nobody chose,
    // and a typo in a meter id would become a real charge under one.
    return {
      ok: false,
      status: 400,
      error: `no credit meter is registered as "${meterId}"`,
      balance,
      meter: meterId,
    };
  }

  const n = Number.isFinite(units) && units > 0 ? units : 1;
  const cost = Math.ceil(meter.cost * n);
  if (cost <= 0) {
    return {
      ok: true,
      charged: false,
      why: `"${meter.title}" is declared free`,
      balance,
    };
  }

  const ref = detail ? `${meter.id} · ${detail}` : meter.id;
  const result = await spendCredits(username, cost, ref);
  if (!result.ok) {
    return {
      ok: false,
      status: 402,
      error: `${result.error} ("${meter.title}" costs ${cost})`,
      balance: result.balance,
      meter: meter.id,
    };
  }
  return { ok: true, charged: true, meter: meter.id, cost, balance: result.balance, ref };
}

/**
 * Give a charge back — the correction when the work a charge paid for did not
 * happen (a provider that errored after the turn was accepted, a cancelled
 * render). Takes the {@link MeterCharge} the charge produced, so a caller cannot
 * refund an amount that was never taken.
 *
 * A no-op for a charge that did not happen, which is what makes it safe to call
 * from a `finally` without re-deriving whether metering was on.
 */
export async function refundCharge(
  username: string,
  charge: MeterCharge,
  why: string,
): Promise<void> {
  if (!charge.ok || !charge.charged) return;
  await refundCredits(username, charge.cost, `${charge.ref} · refund: ${why}`, "system");
}

/* ============================== the assistant ================================ */

/**
 * **The one real consumer**, wired by this phase so the meter is proven rather
 * than merely declared: one AmberX Vid assistant turn, charged before the
 * provider is called.
 *
 * Before, not after, and that is the load-bearing half. Charging after a
 * successful answer means a member at zero credits gets the answer and then the
 * charge fails, which is a free turn for anyone who watches their balance.
 * Charging first and refunding on failure ({@link refundCharge}) is the only
 * order where the refusal happens before the money is spent on the provider's
 * side too.
 *
 * `moduleId` is the assistant window's own — the chat route relays it. This
 * function answers "not mine" for every other module rather than the route
 * branching on a module name, so that the scoping rule lives with the meter
 * that owns it and a second metered module is an edit here rather than in the
 * assistant.
 */
export async function chargeAssistantTurn(
  moduleId: string | undefined,
  username: string | null,
  detail?: string,
): Promise<MeterCharge | null> {
  if (moduleId !== "amberxvid") return null;
  if (!creditsEnabled()) return null;
  // Metering is on but nobody is signed in: there is no ledger to charge. The
  // turn proceeds — an anonymous assistant turn is a question about whether the
  // assistant is reachable at all, and it is not this file's to answer.
  if (!username) return null;
  return chargeMeter(username, "amberxvid.assistant-turn", 1, detail);
}

/* ================================== buying =================================== */

/** The processor hand-off URL, or null when no processor is configured. */
export function paymentsUrl(): string | null {
  const raw = process.env.AMBERXVID_PAYMENTS_URL?.trim();
  return raw ? raw : null;
}

/**
 * Can this member buy, right now, and if not — why. Two independent reasons and
 * they are kept apart: no processor is a DEPLOYMENT fact (nobody can buy), the
 * policy row is a MEMBER fact (this one cannot). Collapsing them into one
 * "purchases unavailable" would send an administrator looking for a member's
 * setting when the studio has no payment processor at all.
 */
export type PurchaseAvailability =
  | { available: true; url: string }
  | { available: false; reason: "no-processor" | "not-permitted"; why: string };

export async function purchaseAvailability(username: string): Promise<PurchaseAvailability> {
  const url = paymentsUrl();
  if (!url) {
    return {
      available: false,
      reason: "no-processor",
      why:
        "buying credits is not enabled in this studio — no payment processor is configured " +
        "(AMBERXVID_PAYMENTS_URL is unset). An administrator can grant credits from the accounts " +
        "admin suite in the meantime.",
    };
  }
  // The policy row bites HERE, once, at the chokepoint — see the header table.
  const verdict = await assertCanBuyCredits(username);
  if (!verdict.ok) {
    return { available: false, reason: "not-permitted", why: verdict.error };
  }
  return { available: true, url };
}

/** How many credits one checkout may be for. A bound, because an unbounded
 *  number posted from a client is a typo amplifier on the one path that
 *  eventually touches money. */
export const CHECKOUT_MIN = 1;
export const CHECKOUT_MAX = 100_000;

export type CheckoutStart =
  | { ok: true; ref: string; url: string; credits: number }
  | { ok: false; error: string; status: number };

const checkoutRef = (username: string): string =>
  `checkout:${username.trim().toLowerCase()}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;

/**
 * Begin a purchase — mint a reference and hand back the processor's URL with it
 * attached. **Credits nothing.** The ledger hears about this only if
 * {@link completeCheckout} is called on the return leg.
 */
export async function startCheckout(username: string, credits: number): Promise<CheckoutStart> {
  const n = Math.round(credits);
  if (!Number.isFinite(n) || n < CHECKOUT_MIN || n > CHECKOUT_MAX) {
    return {
      ok: false,
      status: 400,
      error: `a purchase is between ${CHECKOUT_MIN} and ${CHECKOUT_MAX} credits`,
    };
  }
  const availability = await purchaseAvailability(username);
  if (!availability.available) {
    return {
      ok: false,
      // 501 for "this studio has no processor" and 403 for "this member may
      // not" — the client shows two different screens, and a single status
      // would make it guess which.
      status: availability.reason === "no-processor" ? 501 : 403,
      error: availability.why,
    };
  }

  const ref = checkoutRef(username);
  const url = new URL(availability.url);
  url.searchParams.set("ref", ref);
  url.searchParams.set("credits", String(n));
  url.searchParams.set("user", username.trim().toLowerCase());
  return { ok: true, ref, url: url.toString(), credits: n };
}

/**
 * The return leg: money arrived, credit the ledger.
 *
 * This is the function a real processor's webhook or redirect handler calls, and
 * it is deliberately the ONLY path that writes a `purchase` entry. It takes the
 * reference the checkout minted so the ledger row can be matched against the
 * processor's own record later, which is the first thing anybody asks for when a
 * payment is disputed.
 *
 * It does NOT verify the payment — there is no processor to verify against. That
 * verification is the missing half, and it is named here rather than faked: the
 * route in front of this one is gated to the signed-in member and to a
 * configured processor, and when a real processor lands, its signature check
 * goes at that route before this call.
 */
export async function completeCheckout(
  username: string,
  credits: number,
  ref: string,
): Promise<{ ok: true; balance: number } | { ok: false; error: string; status: number }> {
  const n = Math.round(credits);
  if (!Number.isFinite(n) || n < CHECKOUT_MIN || n > CHECKOUT_MAX) {
    return { ok: false, status: 400, error: "that is not a purchasable number of credits" };
  }
  if (!paymentsUrl()) {
    return {
      ok: false,
      status: 501,
      error: "no payment processor is configured, so no purchase can have been made",
    };
  }
  const result = await recordPurchase(username, n, ref || "checkout");
  if (!result.ok) return { ok: false, status: 409, error: result.error };
  return { ok: true, balance: result.balance };
}

/* ================================ the surface ================================ */

/** Everything a credits surface (the banner chip, the settings pane) needs, in
 *  one fetch — the balance and its history, the meters and their prices, and
 *  whether either half of the system is switched on. */
export interface CreditsView {
  readonly statement: CreditStatement;
  readonly status: CreditsStatus;
  readonly purchase: PurchaseAvailability;
}

export async function creditsView(username: string): Promise<CreditsView> {
  const [statement, purchase] = await Promise.all([
    creditStatement(username, 50),
    purchaseAvailability(username),
  ]);
  return { statement, status: creditsStatus(), purchase };
}
