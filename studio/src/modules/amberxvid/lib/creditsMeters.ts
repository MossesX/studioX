/**
 * @file **`amberxvid.credits-meter`** — what a metered thing IS, and the table
 * of them (P18 of `axf-amberxvid-social`, 2026-08-15).
 *
 * The ledger lives in accounts because credit is a property of a person
 * (`accounts/lib/credits.ts`). The SPENDING lives here because a price is a
 * property of a feature, and this module is the one that has features to price.
 * A meter is the join: an id, what it is called, and what one unit of it costs.
 *
 * ## Why this is an extension point and not a switch statement
 *
 * The set of things that cost credits is exactly the set of things that do AI
 * work, and that set is not knowable from here — the whole point of
 * `amberart.tool`, `claude.tool` and the workspace's panels is that a plugin
 * arrives later with a feature nobody planned. A `switch (meter)` in a route
 * would mean every such plugin needs an edit to THIS module before it can
 * charge for anything, which is the fork-the-host shape the declared points
 * exist to have ended.
 *
 * So `amberxvid.credits-meter` is declared on the module (`amberxvid.decl.ts`),
 * data-only, `requires: ["id", "title", "cost"]` — a malformed meter is refused
 * at registration BY NAME rather than turning up as a charge of `NaN`.
 *
 * ## Two readers, and why the table is here rather than in the registry
 *
 * The core registry is a client-graph singleton (the same two-module-graph fact
 * `PacksSeed` exists for). A charge happens on the SERVER, in a route, where
 * `registry.contributionsTo()` answers with nothing at all — so a server that
 * resolved prices from the registry would silently price every contributed
 * meter at zero, which is the worst possible failure mode for a currency.
 *
 * Hence: **this module-scoped table is the pricing authority**, seeded with the
 * built-ins below and extended by {@link registerCreditsMeter}, which a
 * contributing plugin's SERVER code calls. The registry contribution is what
 * makes "what plugs in here" answerable — the peel and the UI read it — and the
 * two are pinned to each other by {@link CREDITS_METER_POINT} being one
 * constant. A meter contributed to the point but never registered here is
 * visible and unchargeable, which is a loud failure; the reverse is chargeable
 * and invisible, which is why the built-ins are also contributed.
 *
 * Deliberately dependency-free — no node, no React, no `@axf/core`. A route, a
 * client pane and a plain-Node script all import this file, and any one of
 * those imports going heavy is how the point stops being usable from somewhere.
 */

/**
 * The point id, spelled once. `amberxvid.decl.ts` repeats it as a literal
 * because a decl may import nothing but types — the registry pins the two
 * together by refusing a contribution to an id the decl does not declare.
 */
export const CREDITS_METER_POINT = "amberxvid.credits-meter";

/** One metered feature. Data only: no thunk, no component, nothing to call. */
export interface CreditsMeter {
  /** Stable id. Dotted, namespaced by whoever owns the feature. */
  readonly id: string;
  /** What a member sees on their ledger and in the meter list. */
  readonly title: string;
  /** Why it costs — shown beside the price, so a charge is never a surprise. */
  readonly hint?: string;
  /**
   * Credits per unit. Integer, ≥ 0. Zero is legal and means "declared but free"
   * — a real state for a feature whose paid tier has not shipped, and better
   * than leaving it unmetered, because an unmetered feature is invisible on the
   * meter list and a free one is not.
   */
  readonly cost: number;
  /** A branding-pack glyph id. Icons are never Material here. */
  readonly glyph?: string;
}

/**
 * The module's own meters.
 *
 * ONE for now, on purpose. The step that built this asked for the meter to be
 * *proven* by a real consumer rather than surrounded by speculative siblings,
 * and a table of meters nothing charges is exactly the false-green shape this
 * project keeps getting bitten by: a credits system that looks installed and
 * has never moved a credit.
 */
export const ASSISTANT_TURN_METER: CreditsMeter = {
  id: "amberxvid.assistant-turn",
  title: "Assistant turn",
  hint:
    "One answered turn from the AmberX Vid assistant. Charged when the turn is accepted, " +
    "before the provider is called — and refunded if the provider never answers.",
  cost: 1,
  glyph: "icon-chat",
};

/** Everything this module ships. Contributed meters land beside them. */
export const AMBERXVID_BUILTIN_METERS: readonly CreditsMeter[] = [ASSISTANT_TURN_METER];

/* ============================== the live table =============================== */

const registered = new Map<string, CreditsMeter>(
  AMBERXVID_BUILTIN_METERS.map((m) => [m.id, m]),
);

/** What a malformed meter is refused with — the field, by name. */
function validate(meter: CreditsMeter): string | null {
  if (!meter || typeof meter.id !== "string" || !meter.id.trim()) return "id";
  if (typeof meter.title !== "string" || !meter.title.trim()) return "title";
  if (typeof meter.cost !== "number" || !Number.isFinite(meter.cost) || meter.cost < 0) {
    return "cost";
  }
  return null;
}

/**
 * Register a meter so it can be CHARGED. Called by the server half of whatever
 * contributed it to the point.
 *
 * Throws on a malformed meter rather than dropping it: a meter that silently
 * failed to register is a feature that silently became free, and nobody
 * notices free.
 *
 * Re-registering the same id replaces it — a dev reload re-runs registration,
 * and refusing there would make HMR look like a conflict.
 */
export function registerCreditsMeter(meter: CreditsMeter): void {
  const bad = validate(meter);
  if (bad) {
    throw new Error(
      `${CREDITS_METER_POINT}: refused a meter with an invalid "${bad}" ` +
        `(${JSON.stringify(meter?.id ?? meter)})`,
    );
  }
  registered.set(meter.id, { ...meter, cost: Math.round(meter.cost) });
}

/** Every chargeable meter, sorted by id so a list is stable across processes. */
export function creditsMeters(): CreditsMeter[] {
  return [...registered.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** One meter by id, or null. A charge against an unknown id is refused rather
 *  than defaulted — a default price is a price nobody chose. */
export function creditsMeter(id: string): CreditsMeter | null {
  return registered.get(id) ?? null;
}

/** Drop everything a plugin added, back to the built-ins. Tests only. */
export function resetCreditsMeters(): void {
  registered.clear();
  for (const m of AMBERXVID_BUILTIN_METERS) registered.set(m.id, m);
}
