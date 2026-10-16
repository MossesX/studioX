/**
 * @file The four gauges, and the roll that honours them — pure, no DOM.
 *
 * A gauge is not a dial. `spec.ts` already carries every dial the engine can
 * turn, and the Theme Manager's token editor edits them one by one. What the
 * gauges are is the small set of INTENTIONS a person has before they have an
 * opinion about any individual token: *make it light*, *put it in the greens*,
 * *push the contrast up*, *round the corners*. Each one constrains a whole
 * palette, which is precisely what a per-dial editor cannot express.
 *
 * ## How each gauge reaches the engine
 *
 * Two of them the roller already understands and they go straight through as
 * `RollOptions` — `mode` and `hue`. The other two it does not, and they are
 * applied as a POST-PASS over the rolled values:
 *
 *   - **contrast** is a TARGET, and it took a measurement to get that right.
 *     The first cut used the generator's own `clampContrast`, which raises a
 *     colour that fails a minimum and returns it untouched when it passes — a
 *     FLOOR. Measured: a rolled dark theme's ink already sits at **16.6:1**, so
 *     the gauge did nothing at all anywhere below 16, which is nearly its whole
 *     range. A gauge that quietly does nothing is the exact failure
 *     `generate.ts` records for an optionless dial, and "I moved it and the app
 *     looked the same" cannot be told apart from "the feature is broken". So
 *     {@link toContrast} moves lightness in BOTH directions and lands ON the
 *     ratio asked for, never below the minimum the dial itself declares.
 *
 *     The declared minima keep their RELATIVE hierarchy (ink is 4.5, dim and
 *     the accents are 3), so asking for 7 asks ink for 7 and dim for 7 × 3/4.5
 *     — a gauge that flattened them would put every colour the same distance
 *     from the page, which is the look of an app with no hierarchy.
 *   - **radius** is a plain dial value, set directly.
 *
 * The post-pass is why {@link gaugedRoll} hands back the ROLLED values as well
 * as the gauged ones. The surface applies the seed through `ThemeStore.apply`
 * (the engine's own path, which is also what records the seed in history) and
 * then writes only the differences through `setValue` — so a gauged theme is an
 * ordinary roll with a handful of visible, revertable overrides rather than a
 * second kind of theme the rest of the engine has never heard of.
 *
 * ## Reading the gauges BACK off a theme
 *
 * {@link gaugesFrom} exists because the gauges must not lie. The theme in force
 * can change under this surface — a saved look is applied, Revert is pressed,
 * another tab rolls — and a gauge showing a stale position is worse than no
 * gauge, because the next press of Roll would silently honour it.
 */
import { clampContrast, contrast, DIALS, hexToHsl, hslToHex, rollTheme } from "@axf/core";
import type { ColorDial, Mode, RollOptions, ThemeValues } from "@axf/core";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface Gauges {
  readonly mode: Mode;
  /** Base hue in degrees, 0–359. The accent's, and the whole palette's. */
  readonly hue: number;
  /** Demanded ink-on-page contrast ratio. The floor every colour scales from. */
  readonly contrast: number;
  /** Corner radius in px — the `radius` dial, promoted to a gauge. */
  readonly radius: number;
}

/** The reference ratio the other minima scale against — `ink`'s declared 4.5. */
const REFERENCE_CONTRAST = 4.5;

/**
 * The gauge's own range.
 *
 * `min` is 4.5 because that is `ink`'s declared floor and the gauge may not go
 * under a legibility contract the engine clamps to anyway — a slider whose
 * bottom third does nothing is the defect this file was written twice to avoid.
 * `max` is 18 because a rolled dark theme lands near 16.6 unaided, and a ceiling
 * BELOW what the app already shows would make the gauge read as a lie the moment
 * the page opened.
 */
export const CONTRAST_RANGE = { min: 4.5, max: 18, step: 0.1 } as const;
export const RADIUS_RANGE = { min: 0, max: 20, step: 1 } as const;

export const DEFAULT_GAUGES: Gauges = {
  mode: "dark",
  hue: 26,
  contrast: REFERENCE_CONTRAST,
  radius: 8
};

/** What a theme's values imply about where the gauges are standing. */
export function gaugesFrom(values: ThemeValues): Gauges {
  const page = String(values.page ?? "");
  const ink = String(values.ink ?? "");
  const accent = String(values.accent ?? "");

  const mode: Mode =
    HEX6.test(page) && hexToHsl(page).l > 0.5 ? "light" : DEFAULT_GAUGES.mode;
  const hue = HEX6.test(accent) ? Math.round(hexToHsl(accent).h) : DEFAULT_GAUGES.hue;
  const ratio =
    HEX6.test(page) && HEX6.test(ink) ? contrast(ink, page) : DEFAULT_GAUGES.contrast;
  const radius = Number(values.radius);

  return {
    mode,
    hue: ((hue % 360) + 360) % 360,
    // Clamped into the gauge's own range: a hand-edited theme can legally sit
    // outside it, and a slider handed a value past its max renders pinned to the
    // end while reporting the real number — which reads as a broken control.
    contrast: Math.min(
      CONTRAST_RANGE.max,
      Math.max(CONTRAST_RANGE.min, Math.round(ratio * 10) / 10)
    ),
    radius: Number.isFinite(radius)
      ? Math.min(RADIUS_RANGE.max, Math.max(RADIUS_RANGE.min, radius))
      : DEFAULT_GAUGES.radius
  };
}

/**
 * Move a colour to LAND ON a contrast ratio against a background — up or down.
 *
 * Up is `clampContrast`'s job and is delegated to it, so a raised colour is
 * moved by exactly the code the generator uses. Down is what the generator has
 * no reason to own: it only ever enforces minima, and a theme whose ink already
 * passes is a theme it leaves alone.
 *
 * Lightness only, keeping the hue and saturation the roll chose — the same rule
 * `clampContrast` states, for the same reason. Contrast is monotonic in
 * lightness between the colour and its background, so a binary search on the
 * fraction of the way toward the background finds the closest passing value
 * without banding.
 */
export function toContrast(colour: string, against: string, target: number): string {
  if (!HEX6.test(colour) || !HEX6.test(against)) return colour;
  if (contrast(colour, against) < target) return clampContrast(colour, against, target);

  const hsl = hexToHsl(colour);
  const backgroundL = hexToHsl(against).l;
  const at = (t: number) => hslToHex({ ...hsl, l: hsl.l + t * (backgroundL - hsl.l) });

  // Largest `t` (nearest the background, i.e. lowest contrast) still passing.
  let lo = 0;
  let hi = 1;
  let best = colour;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = at(mid);
    if (contrast(candidate, against) >= target) {
      best = candidate;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

export interface GaugedRoll {
  /** What goes to `ThemeStore.apply` — the two gauges the roller understands. */
  readonly options: RollOptions;
  /** The seeded roll, before the post-pass. */
  readonly rolled: ThemeValues;
  /** The roll with the contrast and radius gauges applied. */
  readonly values: ThemeValues;
  /** Only what the post-pass changed — the surface's `setValue` list. */
  readonly overrides: ThemeValues;
}

/**
 * Roll a full theme from a seed, honouring all four gauges.
 *
 * Every dial in the spec gets a value, because `rollTheme` rolls the whole spec
 * — the gauges narrow the palette, they do not narrow the token set.
 */
export function gaugedRoll(seed: string, gauges: Gauges): GaugedRoll {
  const options: RollOptions = { mode: gauges.mode, hue: gauges.hue };
  const rolled = rollTheme(seed, options).values;
  const values: ThemeValues = { ...rolled };

  for (const dial of DIALS) {
    if (dial.kind !== "color") continue;
    const colour = dial as ColorDial;
    if (!colour.contrastAgainst || !colour.minContrast) continue;
    const value = String(values[colour.id] ?? "");
    const against = String(values[colour.contrastAgainst] ?? "");
    if (!HEX6.test(value) || !HEX6.test(against)) continue;
    // Never under the dial's own contract, whatever the gauge says — the gauge
    // designs a look, it does not get to make the app illegible.
    const target = Math.max(
      colour.minContrast,
      (gauges.contrast * colour.minContrast) / REFERENCE_CONTRAST
    );
    values[colour.id] = toContrast(value, against, target);
  }

  values.radius = gauges.radius;

  const overrides: ThemeValues = {};
  for (const [id, value] of Object.entries(values)) {
    if (rolled[id] !== value) overrides[id] = value;
  }

  return { options, rolled, values, overrides };
}
