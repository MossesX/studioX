/**
 * @file AmberArt generative-art contract — the types both engines share.
 *
 * The whole design turns on one split:
 *
 * - an {@link ArtDirective} is the SMALL, human-and-model-readable description
 *   of a piece (base hue, harmony, symmetry, how dense, how swirled);
 * - {@link ArtParams} is the FULL parameter set the renderer actually needs
 *   (every sine frequency and phase of the vector field, the resolved palette,
 *   the exact element counts).
 *
 * `buildParams(directive, seed)` expands the first into the second, filling
 * everything the directive does not mention from the seeded PRNG. That is what
 * lets three very different producers drive one renderer:
 *
 * | producer            | writes             | AI? |
 * |---------------------|--------------------|-----|
 * | `deriveDirective()` | hash of the prompt | no  |
 * | AI-directed mode    | a JSON directive   | yes |
 * | the tool's sliders  | a directive        | no  |
 *
 * A fourth producer, AI-direct mode, bypasses the renderer entirely and hands
 * back its own SVG — which is why that one alone needs the sanitizer.
 *
 * Every numeric field is clamped on the way in (`normalizeDirective`), so a
 * model that answers `symmetry: 9000` degrades to a legal piece instead of
 * hanging the renderer.
 */

/** Canvas geometry. Fixed per piece and echoed in the saved SVG's viewBox. */
export const ART_WIDTH = 1600;
export const ART_HEIGHT = 1000;

/** Hard cap on any SVG we will accept or emit (characters of markup). */
export const ART_SVG_MAX = 1_400_000;

/** The colour-harmony schemes a directive may name. */
export const HARMONIES = {
  analogous: [0, 18, 36, -18, 54],
  triad: [0, 120, 240, 20, 140],
  splitComplement: [0, 150, 210, 30, 180],
  tetrad: [0, 90, 180, 270, 45],
  duotone: [0, 12, 190, 202, 24],
} as const;

export type Harmony = keyof typeof HARMONIES;

export const HARMONY_NAMES = Object.keys(HARMONIES) as Harmony[];

/** How the art was produced. The module's toolbar tool exposes all three. */
export type EngineMode =
  /** Prompt → hash → directive → render. No model in the loop, fully deterministic. */
  | "seeded"
  /** Prompt → Claude writes a directive → render. Model taste, our renderer. */
  | "ai-directed"
  /** Prompt → Claude writes the SVG itself → sanitize. Wildest, least predictable. */
  | "ai-direct";

export const ENGINE_MODES: EngineMode[] = ["seeded", "ai-directed", "ai-direct"];

/** An HSL colour. Kept as components so the renderer can shift lightness freely. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/**
 * The compact description of a piece. This is the object Claude is asked to
 * write in `ai-directed` mode, and the object the tool's sliders edit — small
 * enough that a model gets it right, expressive enough to change the art a lot.
 */
export interface ArtDirective {
  /** 0–359. The anchor hue every other colour is derived from. */
  baseHue: number;
  /** Which offsets are taken from `baseHue` to build the ramp. */
  harmony: Harmony;
  /** 0–100. Colour intensity of the ramp. */
  saturation: number;
  /** 0–100. Mid lightness of the ramp; the renderer varies around it. */
  lightness: number;
  /** 3–24. Fold count of the central mandala. */
  symmetry: number;
  /** 0–9. Concentric petal rings. 0 removes the mandala entirely. */
  rings: number;
  /** 0–1. How many flow-field streamlines are traced. */
  streamDensity: number;
  /** 0–1. How many bright thin filaments overlay them. */
  filamentDensity: number;
  /** 0–1. How much small confetti (dots, triangles, rings) is scattered. */
  markDensity: number;
  /** 0–2. Strength of the rotational pull around the centre. */
  swirl: number;
  /** 0–1. How chaotic the underlying vector field is. */
  turbulence: number;
  /** 0–1. Film-grain overlay strength. */
  grain: number;
  /** 0–1. Corner darkening. */
  vignette: number;
  /** Optional one-line note from the model about its reading of the prompt. */
  note?: string;
}

/** The fully-resolved parameter set the renderer consumes. */
export interface ArtParams {
  width: number;
  height: number;
  seed: number;
  prompt: string;
  directive: ArtDirective;
  palette: Hsl[];
  ink: Hsl;
  flare: Hsl;
  cx: number;
  cy: number;
  field: {
    a1: number; f1: number; p1: number;
    a2: number; f2: number; p2: number;
    a3: number; f3: number; p3: number;
    swirl: number; fall: number; drift: number;
  };
  counts: { blobs: number; streamlines: number; filaments: number; marks: number };
}

/** What `/api/amberart/generate` answers with. */
export interface GenerateResult {
  ok: boolean;
  mode: EngineMode;
  svg?: string;
  seed?: string;
  directive?: ArtDirective;
  /** Attributes the sanitizer dropped (ai-direct only) — surfaced, never hidden. */
  stripped?: string[];
  /** Set when the first model answer failed and the retry produced this one. */
  retried?: boolean;
  error?: string;
}
