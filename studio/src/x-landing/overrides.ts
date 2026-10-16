/**
 * @file **Landing overrides** — the user-authored layer over an `x_landing`
 * asset, and the reason the designer can edit a landing without breaking the
 * anti-hand-write contract.
 *
 * ## Why this is a separate document and not an edit to the asset
 *
 * A logo kit or landing asset must be authored by the framework and never by
 * hand (owner directive, 2026-08-15). Three layers enforce it, the last of them
 * a content signature the generator writes and `--check` recomputes. A designer
 * tab that wrote into `assets/installed/x_landing/xl001/manifest.json` would
 * break that signature on the first click and turn a real guard into a nuisance
 * everybody learns to re-run past.
 *
 * So the ASSET stays exactly what the generator produced, and a choice made in
 * the UI lands HERE instead — a small, separate, user-owned document. The same
 * split the studio already uses twice: `chrome-assets.json` holds user-built
 * toolbars beside the shipped ones, and `toolbar-prefs.json` holds per-user bar
 * settings without touching any bar's definition.
 *
 * **Which means precedence has to be stated, not inferred:** the asset is the
 * DEFAULT and the override WINS while it exists. `resolveLanding` is the one
 * place that decides, so no surface can answer differently — and clearing an
 * override is a real operation, not "set it back to what you think the asset
 * said".
 *
 * ## What may be overridden
 *
 * Only the fields a person can meaningfully change by looking at the screen:
 * the composed logo and the card's translucency. NOT `id`, `route` or `role` —
 * those are structural. Letting a UI move a landing's route or hand it the
 * `login` role would let a click repoint the session gate, which is the
 * lock-out `publicPaths.ts` warns about, reachable from a colour picker.
 */

import { resolveLogo } from "../logo-kits/catalog";
import type { XLanding } from "./types";

/** The kv namespace this document lives in (`data/axf/kv/local/<ns>.json`). */
export const LANDING_OVERRIDES_NS = "landing-overrides";

const ENDPOINT = `/api/axf/kv/${LANDING_OVERRIDES_NS}`;

/** One landing's user-authored changes. Every field optional — absent means
 *  "the asset's value stands". */
export interface LandingOverride {
  /** A logo id from any kit, e.g. `lk002-orbit`. */
  logo?: string;
  /** 0 … 1. */
  cardOpacity?: number;
}

export interface LandingOverridesDoc {
  /** landing id (`xl001`) → its override. */
  byId: Record<string, LandingOverride>;
}

export const EMPTY_OVERRIDES: LandingOverridesDoc = { byId: {} };

/**
 * Parse an unknown value into a document, dropping anything malformed.
 *
 * Silent dropping rather than throwing, because this runs on a stored document
 * that a previous version may have written differently, and a landing that
 * fails to render because its OPTIONAL customisation is stale would be a worse
 * outcome than losing the customisation. A dropped field falls back to the
 * asset, which is always valid — that is the property the whole split buys.
 */
export function parseOverridesDoc(value: unknown): LandingOverridesDoc {
  if (!value || typeof value !== "object") return EMPTY_OVERRIDES;
  const raw = (value as { byId?: unknown }).byId;
  if (!raw || typeof raw !== "object") return EMPTY_OVERRIDES;

  const byId: Record<string, LandingOverride> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { logo?: unknown; cardOpacity?: unknown };
    const out: LandingOverride = {};
    // A logo id is kept only if it RESOLVES. A stale id — a kit deleted, a slug
    // renamed — would otherwise render an empty hero, which is exactly the
    // dangling-reference failure `defineXLanding` exists to make impossible.
    if (typeof e.logo === "string" && resolveLogo(e.logo)) out.logo = e.logo;
    if (typeof e.cardOpacity === "number" && e.cardOpacity >= 0 && e.cardOpacity <= 1) {
      out.cardOpacity = e.cardOpacity;
    }
    if (Object.keys(out).length > 0) byId[id] = out;
  }
  return { byId };
}

/**
 * The landing as it should RENDER: the asset, with any override applied.
 *
 * The single decision point. Every surface that draws a landing goes through
 * this, so the designer's preview and the real page cannot disagree about what
 * the page currently looks like.
 */
export function resolveLanding(landing: XLanding, doc: LandingOverridesDoc | null): XLanding {
  const o = doc?.byId?.[landing.id];
  if (!o) return landing;
  return {
    ...landing,
    ...(o.logo ? { assets: { ...landing.assets, logo: o.logo } } : {}),
    ...(typeof o.cardOpacity === "number" ? { cardOpacity: o.cardOpacity } : {})
  };
}

/** Is this landing currently showing something other than its asset? */
export function isOverridden(landing: XLanding, doc: LandingOverridesDoc | null): boolean {
  const o = doc?.byId?.[landing.id];
  if (!o) return false;
  return (o.logo !== undefined && o.logo !== landing.assets.logo) || o.cardOpacity !== undefined;
}

/** GET the stored document. A 404 means "nothing overridden", not an error. */
export async function loadOverrides(): Promise<LandingOverridesDoc> {
  try {
    const r = await fetch(ENDPOINT);
    if (!r.ok) return EMPTY_OVERRIDES;
    const body = (await r.json()) as { doc?: unknown };
    return parseOverridesDoc(body.doc);
  } catch {
    return EMPTY_OVERRIDES;
  }
}

/** PUT the whole document — it is a handful of tiny records. */
export async function saveOverrides(doc: LandingOverridesDoc): Promise<boolean> {
  try {
    const r = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc })
    });
    return r.ok;
  } catch {
    return false;
  }
}
