/**
 * @file Click-to-locate, as a PURE function — "which tokens style this element?"
 *
 * The feature the Theme Manager exists for: click anything the app has drawn and
 * be taken to the row that controls its colour. The interesting half is not the
 * click, it is the answer, and the answer is a reverse lookup — the theme
 * publishes `token → value`, and a rendered element only knows its VALUE.
 *
 * So this module builds the map the other way round and matches against it. It
 * lives apart from the surface, with no DOM and no React, for the same reason
 * `saved-store.ts` does: it can then be reasoned about (and run under
 * `node --test`) without a browser, and the component keeps only the parts that
 * genuinely need one — `elementFromPoint`, `getComputedStyle`, `scrollIntoView`.
 *
 * ## Why NEAREST rather than exact
 *
 * An exact string match resolves almost nothing, and the reasons are all
 * ordinary rendering:
 *
 *   - **alpha compositing.** MUI paints hover states and dividers with
 *     `rgba(…, .08)`, so the computed colour is the token blended with whatever
 *     is behind it and shares no digits with the token's own value.
 *   - **anti-aliasing and colour management.** A browser reports a composited
 *     surface as the pixel it produced, which drifts a unit or two from the
 *     value that was asked for.
 *   - **derived tokens.** `--axf-shadow` and the size ramp are computed from
 *     dials, so their values are arithmetic on a dial rather than the dial.
 *
 * Nearest-match in RGB with a tolerance answers all three, and a distance is
 * reported alongside every match so a surface can say "this is the accent"
 * versus "this is close to the accent" rather than pretending both are the same
 * claim. A match beyond the tolerance is NOT returned at all — the footer saying
 * "nothing here is themed" is the honest outcome and the one the fence asks for,
 * where a nearest-of-anything match would confidently name the wrong dial.
 *
 * ## What is in the index
 *
 * `themeVariables()` — the whole published bag, so a dial added to the spec is
 * locatable the day it is added with no edit here — filtered to variables this
 * module can attribute to a DIAL, because the point of a match is the row it
 * scrolls to. That attribution has three sources, in order: a dial's own
 * `cssVar`, a derived token's first dial dependency (`DERIVED[].from`), and the
 * brand bridge's role variables, whose role names ARE palette dial ids.
 */
import { DERIVED, DIALS, DIALS_BY_ID, themeVariables } from "@axf/core";
import type { ThemeValues } from "@axf/core";

export type Rgb = readonly [number, number, number];

/** One published variable, with the dial a surface can send a person to. */
export interface TokenEntry {
  /** The published custom property, e.g. `--axf-accent`. */
  readonly cssVar: string;
  /** Its value in the theme in force, e.g. `#ff7a1a` or `8px`. */
  readonly value: string;
  /** Parsed, when the value is a colour. `null` for sizes, faces and ids. */
  readonly rgb: Rgb | null;
  /** Parsed leading number, when the value is a measurement. */
  readonly px: number | null;
  /** The dial whose row edits it. Never null — unattributable vars are dropped. */
  readonly dialId: string;
  /** True when the variable IS the dial's own, rather than derived from it. */
  readonly direct: boolean;
}

/** The five computed properties a click is resolved through. */
export interface ComputedSample {
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly borderColor?: string;
  readonly fontFamily?: string;
  readonly borderRadius?: string;
}

export type MatchProperty = "text" | "background" | "border" | "face" | "radius";

export interface TokenMatch {
  readonly property: MatchProperty;
  readonly cssVar: string;
  readonly dialId: string;
  readonly value: string;
  /** RGB distance, 0 for an exact hit. `0` for non-colour matches too. */
  readonly distance: number;
  readonly exact: boolean;
}

/**
 * How far a composited colour may sit from a token and still be called that
 * token. 0–441 is the full RGB diagonal; 30 is roughly "the same colour after a
 * hover overlay", and was chosen by measuring MUI's own `action.hover` blends
 * against the palette they are built from rather than by taste.
 */
export const COLOR_TOLERANCE = 30;

/* ------------------------------------------------------------------ parsing */

const HEX = /^#([0-9a-f]{3,8})$/i;
const RGB_FN = /^rgba?\(([^)]+)\)$/i;

/**
 * A CSS colour to RGBA, or null when it is not one this module can read.
 *
 * `null` rather than a guess: `color(srgb …)` and `oklch()` are real values a
 * modern engine can report, and inventing an RGB for them would produce
 * confident wrong matches. An unreadable colour simply does not resolve, which
 * the footer already has a sentence for.
 */
export function parseColor(css: string | undefined): readonly [number, number, number, number] | null {
  const text = (css ?? "").trim();
  if (!text) return null;

  const hex = HEX.exec(text);
  if (hex) {
    const digits = hex[1];
    const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16);
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b, a] = digits.split("");
      return [expand(r), expand(g), expand(b), a === undefined ? 1 : expand(a) / 255];
    }
    if (digits.length === 6 || digits.length === 8) {
      const pair = (i: number) => parseInt(digits.slice(i, i + 2), 16);
      return [pair(0), pair(2), pair(4), digits.length === 8 ? pair(6) / 255 : 1];
    }
    return null;
  }

  const fn = RGB_FN.exec(text);
  if (!fn) return null;
  // Both spellings: legacy `rgb(1, 2, 3)` and modern `rgb(1 2 3 / .5)`.
  const parts = fn[1].replace("/", " ").split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
  return [parts[0], parts[1], parts[2], alpha];
}

/** Composite a translucent colour over a background, so it can be compared. */
export function composite(
  fg: readonly [number, number, number, number],
  bg: Rgb | null
): Rgb | null {
  if (fg[3] >= 0.999) return [fg[0], fg[1], fg[2]];
  // Fully transparent carries no colour information at all — a `rgba(0,0,0,0)`
  // background is "no background", not "black", and matching it against the
  // palette is how every dark theme would resolve to `page`.
  if (fg[3] <= 0.001 || !bg) return null;
  const over = (i: number) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3]));
  return [over(0), over(1), over(2)];
}

const distance = (a: Rgb, b: Rgb): number =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/**
 * The leading number of a PIXEL measurement (`"8px"` → 8), or null.
 *
 * The unit is checked rather than stripped, and that is not pedantry: the theme
 * publishes `--axf-motion: 140ms` and `--axf-tracking: 0.01em` beside the sizes,
 * so a bare `parseFloat` makes a transition duration a candidate for "which
 * token gives this element its corners". A 140px radius is implausible; a
 * confident wrong answer is the failure mode this whole module is written to
 * avoid.
 */
export function parsePx(css: string | undefined): number | null {
  const text = (css ?? "").trim();
  if (!/^-?[\d.]+px$/.test(text)) return null;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

/** Font stacks compare by their FIRST family, case- and quote-insensitively. */
export function firstFamily(stack: string | undefined): string {
  return (stack ?? "")
    .split(",")[0]
    .replace(/["']/g, "")
    .trim()
    .toLowerCase();
}

/* -------------------------------------------------------------- the index */

/**
 * Which dial a published variable belongs to.
 *
 * Built once per call from the spec rather than hand-listed, so the day a dial
 * or a derived token is added it is attributable with no edit here — the same
 * property `DialControl` has and for the same reason.
 */
function dialOfVariable(): Map<string, { dialId: string; direct: boolean }> {
  const out = new Map<string, { dialId: string; direct: boolean }>();
  for (const dial of DIALS) out.set(dial.cssVar, { dialId: dial.id, direct: true });
  for (const token of DERIVED) {
    if (out.has(token.cssVar)) continue;
    const source = token.from.find((id) => DIALS_BY_ID.has(id));
    if (source) out.set(token.cssVar, { dialId: source, direct: false });
  }
  // The brand bridge republishes the palette under two more vocabularies, and
  // the role names ARE palette dial ids — which is what makes a click on a pack
  // drawing resolve to the dial that paints it rather than to nothing.
  for (const dial of DIALS) {
    if (dial.kind !== "color") continue;
    for (const spelling of [`--axf-brand-${dial.id}`, `--gxb-${dial.id}`]) {
      if (!out.has(spelling)) out.set(spelling, { dialId: dial.id, direct: false });
    }
  }
  return out;
}

/** The value→token map, rebuilt whenever the theme's values change. */
export function buildTokenIndex(values: ThemeValues): TokenEntry[] {
  const attribution = dialOfVariable();
  const published = themeVariables(values);
  const out: TokenEntry[] = [];
  for (const [cssVar, value] of Object.entries(published)) {
    const owner = attribution.get(cssVar);
    if (!owner) continue;
    const parsed = parseColor(value);
    out.push({
      cssVar,
      value,
      // A token's own value is never translucent in this engine, so alpha is
      // dropped rather than composited: the index is what things are compared
      // AGAINST, and a half-transparent yardstick is not one.
      rgb: parsed && parsed[3] >= 0.999 ? [parsed[0], parsed[1], parsed[2]] : null,
      px: parsed ? null : parsePx(value),
      dialId: owner.dialId,
      direct: owner.direct
    });
  }
  return out;
}

/** The page colour, used to composite translucent samples. */
export function pageRgb(index: readonly TokenEntry[]): Rgb | null {
  return index.find((e) => e.cssVar === "--axf-page")?.rgb ?? null;
}

/* -------------------------------------------------------------- the lookup */

function nearestColour(
  css: string | undefined,
  index: readonly TokenEntry[],
  background: Rgb | null
): { entry: TokenEntry; distance: number } | null {
  const parsed = parseColor(css);
  if (!parsed) return null;
  const sample = composite(parsed, background);
  if (!sample) return null;

  let best: { entry: TokenEntry; distance: number } | null = null;
  for (const entry of index) {
    if (!entry.rgb) continue;
    const d = distance(sample, entry.rgb);
    if (!best || d < best.distance) best = { entry, distance: d };
  }
  // Beyond the tolerance the honest answer is "nothing", not "the closest of
  // forty-odd colours". See the docblock.
  return best && best.distance <= COLOR_TOLERANCE ? best : null;
}

/**
 * Resolve which tokens style an element, best first.
 *
 * At most one match per dial: `--axf-accent` and `--gxb-accent` are the same
 * knob under two names, and listing both would make one click read as two
 * findings.
 */
export function matchTokens(
  sample: ComputedSample,
  index: readonly TokenEntry[],
  background: Rgb | null = pageRgb(index)
): TokenMatch[] {
  const found: TokenMatch[] = [];

  const colour = (property: MatchProperty, css: string | undefined) => {
    const hit = nearestColour(css, index, background);
    if (!hit) return;
    found.push({
      property,
      cssVar: hit.entry.cssVar,
      dialId: hit.entry.dialId,
      value: hit.entry.value,
      distance: Math.round(hit.distance * 10) / 10,
      exact: hit.distance < 0.5
    });
  };

  colour("text", sample.color);
  colour("background", sample.backgroundColor);
  colour("border", sample.borderColor);

  const family = firstFamily(sample.fontFamily);
  if (family) {
    const face = index.find((e) => e.rgb === null && firstFamily(e.value) === family);
    if (face) {
      found.push({
        property: "face",
        cssVar: face.cssVar,
        dialId: face.dialId,
        value: face.value,
        distance: 0,
        exact: true
      });
    }
  }

  const radius = parsePx(sample.borderRadius);
  if (radius !== null && radius > 0) {
    const hit = index.find((e) => e.px !== null && Math.abs(e.px - radius) < 0.51);
    if (hit) {
      found.push({
        property: "radius",
        cssVar: hit.cssVar,
        dialId: hit.dialId,
        value: hit.value,
        distance: 0,
        exact: true
      });
    }
  }

  const seen = new Set<string>();
  return found
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.distance - b.distance)
    .filter((m) => (seen.has(m.dialId) ? false : (seen.add(m.dialId), true)));
}

const PROPERTY_WORD: Record<MatchProperty, string> = {
  text: "its text",
  background: "its background",
  border: "its border",
  face: "its typeface",
  radius: "its corners"
};

/** The footer sentence for a set of matches — or for the absence of any. */
export function describeMatches(matches: readonly TokenMatch[]): string {
  if (matches.length === 0) {
    return "Nothing there resolves to a theme token — that element is painted by something the theme does not own.";
  }
  return matches
    .map((m) => `${PROPERTY_WORD[m.property]} is ${m.cssVar}${m.exact ? "" : ` (≈${m.distance})`}`)
    .join(" · ");
}
