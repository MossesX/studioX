/**
 * @file The AI portrait catalog — every axis a member composes their
 * photo-style portrait from, each option with a rendered EXAMPLE chip.
 *
 * 23 axes, ~160 options: identity (sex, age), color (skin/hair/eye/outfit
 * swatches), geometry (face shape, eye shape, brows, nose, lips), styling
 * (hair, facial hair, glasses, jewelry, headwear, outfit), body (height and
 * weight sliders, build), and scene (expression, lighting, backdrop).
 * Jewelry is multi-select — pile it on.
 *
 * Every option carries two renderings of itself:
 *   - `exampleSvg(axis, option)` — a small deterministic line-art exemplar
 *     (the "show examples of each" chips the picker renders). Pure function,
 *     no randomness, client-safe.
 *   - `prompt` — the phrase the generation prompt is composed from.
 *
 * `buildPortraitPrompt(selections)` assembles the Claude brief (an SVG-only
 * contract in the module's 200×220 viewBox so every existing avatar surface
 * and the round face-crop keep working), and `buildStages(selections)` turns
 * the SAME selections into the progress meter's stage script — the meter
 * narrates the actual choices ("Blending golden-tan skin…", "Fitting round
 * glasses…") while the model works.
 *
 * Shared by the builder dialog (client) and the portrait route (server):
 * pure data + string functions, no React, no node imports.
 */

export type PortraitValue = string | string[] | number;
export type PortraitSelections = Record<string, PortraitValue>;

export interface PortraitOption {
  id: string;
  label: string;
  /** Prompt fragment — what this choice tells the artist. */
  prompt: string;
  /** Swatch axes: the colour the chip and the prompt share. */
  hex?: string;
}

export interface PortraitAxis {
  id: string;
  label: string;
  kind: "chips" | "swatch" | "slider";
  /** chips / swatch axes */
  options?: PortraitOption[];
  /** slider axes */
  range?: { min: number; max: number; step: number; unit: string; fallback: number };
  /** Multiple options may be picked (jewelry). */
  multi?: boolean;
  /** Progress-meter verb for this axis ("Blending", "Fitting"…). */
  verb: string;
}

const o = (id: string, label: string, prompt: string, hex?: string): PortraitOption => ({ id, label, prompt, hex });

/* ------------------------------------ axes ------------------------------------ */

export const PORTRAIT_AXES: PortraitAxis[] = [
  {
    id: "sex", label: "Sex", kind: "chips", verb: "Framing",
    options: [
      o("female", "Female", "a woman"),
      o("male", "Male", "a man"),
      o("androgynous", "Androgynous", "an androgynous person"),
    ],
  },
  {
    id: "age", label: "Age", kind: "chips", verb: "Aging",
    options: [
      o("18-25", "18–25", "aged 18-25, youthful skin"),
      o("26-35", "26–35", "aged 26-35"),
      o("36-45", "36–45", "aged 36-45, first fine lines"),
      o("46-60", "46–60", "aged 46-60, mature features"),
      o("60+", "60+", "over 60, aged gracefully with visible wrinkles"),
    ],
  },
  {
    id: "skinColor", label: "Skin color", kind: "swatch", verb: "Blending",
    options: [
      o("porcelain", "Porcelain", "porcelain skin", "#f6e3d5"),
      o("fair", "Fair", "fair skin", "#f0d0b8"),
      o("light", "Light", "light beige skin", "#e3b899"),
      o("golden", "Golden tan", "golden tan skin", "#cf9c72"),
      o("olive", "Olive", "olive skin", "#b98a5e"),
      o("caramel", "Caramel", "caramel skin", "#a06a42"),
      o("bronze", "Bronze", "bronze skin", "#8a5a36"),
      o("chestnut", "Chestnut", "deep chestnut skin", "#6f4527"),
      o("mahogany", "Mahogany", "rich mahogany skin", "#57331c"),
      o("ebony", "Ebony", "deep ebony skin", "#3c2415"),
    ],
  },
  {
    id: "faceShape", label: "Face shape", kind: "chips", verb: "Sculpting",
    options: [
      o("oval", "Oval", "an oval face"),
      o("round", "Round", "a round face with soft cheeks"),
      o("square", "Square", "a square face with a strong jaw"),
      o("heart", "Heart", "a heart-shaped face"),
      o("oblong", "Oblong", "a long oblong face"),
      o("diamond", "Diamond", "a diamond face with high cheekbones"),
    ],
  },
  {
    id: "hairStyle", label: "Hair style", kind: "chips", verb: "Styling",
    options: [
      o("bald", "Bald", "a cleanly shaved bald head"),
      o("buzz", "Buzz cut", "a short buzz cut"),
      o("crew", "Crew cut", "a neat crew cut, faded sides"),
      o("bob", "Bob", "a chin-length bob"),
      o("long-straight", "Long straight", "long straight hair past the shoulders"),
      o("long-waves", "Long waves", "long loose waves"),
      o("curls", "Curls", "a full head of springy curls"),
      o("coils", "Coils", "natural tight coils"),
      o("ponytail", "Ponytail", "hair pulled into a high ponytail"),
      o("bun", "Bun", "hair in a tidy bun"),
    ],
  },
  {
    id: "hairColor", label: "Hair color", kind: "swatch", verb: "Tinting",
    options: [
      o("black", "Black", "black hair", "#171412"),
      o("dark-brown", "Dark brown", "dark brown hair", "#3a2a1c"),
      o("brown", "Brown", "medium brown hair", "#5d4023"),
      o("chestnut-h", "Chestnut", "chestnut hair", "#7b4a2d"),
      o("auburn", "Auburn", "auburn hair", "#8a3b22"),
      o("ginger", "Ginger", "ginger red hair", "#b4552a"),
      o("blonde", "Blonde", "golden blonde hair", "#c9974d"),
      o("platinum", "Platinum", "platinum blonde hair", "#e4d8c2"),
      o("silver", "Silver", "silver gray hair", "#b9b9bd"),
      o("dyed-amber", "Dyed amber", "vividly dyed amber-orange hair", "#ff7a1a"),
    ],
  },
  {
    id: "eyeShape", label: "Eye shape", kind: "chips", verb: "Setting",
    options: [
      o("almond", "Almond", "almond eyes"),
      o("round-e", "Round", "large round eyes"),
      o("hooded", "Hooded", "hooded eyes"),
      o("monolid", "Monolid", "monolid eyes"),
      o("upturned", "Upturned", "upturned eyes"),
      o("downturned", "Downturned", "gently downturned eyes"),
      o("deep-set", "Deep-set", "deep-set eyes under a strong brow"),
    ],
  },
  {
    id: "eyeColor", label: "Eye color", kind: "swatch", verb: "Polishing",
    options: [
      o("brown-e", "Brown", "warm brown eyes", "#5a3a1e"),
      o("dark-e", "Dark", "nearly black eyes", "#2a1c10"),
      o("hazel", "Hazel", "hazel eyes", "#7a5a2a"),
      o("amber-e", "Amber", "striking amber eyes", "#b0762a"),
      o("green-e", "Green", "green eyes", "#4a7a4a"),
      o("blue-e", "Blue", "clear blue eyes", "#4a6d9a"),
      o("gray-e", "Gray", "steel gray eyes", "#7d8a94"),
      o("violet-e", "Violet", "unusual violet eyes", "#7a5a9a"),
    ],
  },
  {
    id: "brows", label: "Eyebrows", kind: "chips", verb: "Shaping",
    options: [
      o("straight-b", "Straight", "straight brows"),
      o("arched", "Arched", "high arched brows"),
      o("thick-b", "Thick", "thick bold brows"),
      o("thin-b", "Thin", "thin precise brows"),
      o("bushy", "Bushy", "bushy untamed brows"),
      o("feathered", "Feathered", "soft feathered brows"),
    ],
  },
  {
    id: "nose", label: "Nose", kind: "chips", verb: "Carving",
    options: [
      o("straight-n", "Straight", "a straight nose"),
      o("roman", "Roman", "a roman nose with a high bridge"),
      o("button", "Button", "a small button nose"),
      o("wide-n", "Wide", "a wide nose"),
      o("narrow-n", "Narrow", "a narrow nose"),
      o("snub", "Snub", "a short snub nose, tip turned up"),
      o("aquiline", "Aquiline", "an aquiline hooked nose"),
      o("bulbous", "Bulbous", "a rounded bulbous nose tip"),
    ],
  },
  {
    id: "lips", label: "Lips", kind: "chips", verb: "Drawing",
    options: [
      o("full", "Full", "full lips"),
      o("thin-l", "Thin", "thin lips"),
      o("wide-l", "Wide", "a wide mouth"),
      o("heart-l", "Heart", "a pronounced cupid's bow"),
      o("downturned-l", "Downturned", "slightly downturned mouth corners"),
      o("neutral-l", "Neutral", "balanced neutral lips"),
    ],
  },
  {
    id: "facialHair", label: "Facial hair", kind: "chips", verb: "Trimming",
    options: [
      o("none-fh", "None", "clean-shaven"),
      o("stubble", "Stubble", "two-day stubble"),
      o("mustache", "Mustache", "a groomed mustache"),
      o("goatee", "Goatee", "a goatee"),
      o("short-beard", "Short beard", "a short tidy beard"),
      o("full-beard", "Full beard", "a full beard"),
      o("mutton", "Mutton chops", "bold mutton chops"),
    ],
  },
  {
    id: "glasses", label: "Glasses", kind: "chips", verb: "Fitting",
    options: [
      o("none-g", "None", "no glasses"),
      o("round-g", "Round", "round wire-frame glasses"),
      o("rect-g", "Rectangle", "rectangular acetate glasses"),
      o("aviator", "Aviator", "aviator frames"),
      o("cat-eye", "Cat-eye", "cat-eye frames"),
      o("rimless", "Rimless", "rimless glasses"),
      o("sunglasses", "Sunglasses", "dark sunglasses"),
    ],
  },
  {
    id: "jewelry", label: "Jewelry", kind: "chips", multi: true, verb: "Hanging",
    options: [
      o("studs", "Stud earrings", "small stud earrings"),
      o("hoops", "Hoop earrings", "gold hoop earrings"),
      o("necklace", "Necklace", "a fine necklace"),
      o("chain", "Chain", "a heavy chain"),
      o("nose-ring", "Nose ring", "a subtle nose ring"),
      o("brow-piercing", "Brow piercing", "an eyebrow piercing"),
      o("rings", "Rings", "several finger rings (one hand visible at the collar)"),
      o("choker", "Choker", "a black choker"),
    ],
  },
  {
    id: "headwear", label: "Headwear", kind: "chips", verb: "Topping",
    options: [
      o("none-hw", "None", "no headwear"),
      o("beanie", "Beanie", "a knit beanie"),
      o("cap", "Cap", "a baseball cap"),
      o("headscarf", "Headscarf", "an elegant headscarf"),
      o("fedora", "Fedora", "a fedora"),
      o("headband", "Headband", "a slim headband"),
    ],
  },
  {
    id: "height", label: "Height", kind: "slider", verb: "Measuring",
    range: { min: 140, max: 210, step: 1, unit: "cm", fallback: 175 },
  },
  {
    id: "weight", label: "Weight", kind: "slider", verb: "Weighing",
    range: { min: 45, max: 160, step: 1, unit: "kg", fallback: 75 },
  },
  {
    id: "build", label: "Build", kind: "chips", verb: "Building",
    options: [
      o("slim", "Slim", "a slim build"),
      o("athletic", "Athletic", "an athletic build"),
      o("average", "Average", "an average build"),
      o("muscular", "Muscular", "a muscular build, broad shoulders"),
      o("curvy", "Curvy", "a curvy build"),
      o("heavyset", "Heavyset", "a heavyset build"),
    ],
  },
  {
    id: "outfit", label: "Outfit", kind: "chips", verb: "Dressing",
    options: [
      o("tee", "T-shirt", "a plain crew-neck t-shirt"),
      o("shirt", "Shirt", "a crisp button-up shirt"),
      o("blouse", "Blouse", "a soft blouse"),
      o("hoodie", "Hoodie", "a casual hoodie"),
      o("suit", "Suit", "a tailored suit jacket over a shirt"),
      o("dress", "Dress", "an elegant dress neckline"),
      o("leather", "Leather jacket", "a leather jacket"),
      o("turtleneck", "Turtleneck", "a fitted turtleneck"),
    ],
  },
  {
    id: "outfitColor", label: "Outfit color", kind: "swatch", verb: "Dyeing",
    options: [
      o("charcoal", "Charcoal", "in charcoal", "#33363b"),
      o("black-o", "Black", "in black", "#141416"),
      o("white-o", "White", "in white", "#e9e6df"),
      o("navy", "Navy", "in navy", "#243a5e"),
      o("forest", "Forest", "in forest green", "#2e4a35"),
      o("burgundy", "Burgundy", "in burgundy", "#5e2430"),
      o("amber-o", "Amber", "in amber orange", "#ff7a1a"),
      o("cream", "Cream", "in cream", "#d9c9a8"),
      o("denim", "Denim", "in denim blue", "#4a6485"),
      o("plum", "Plum", "in plum", "#5a3a5e"),
    ],
  },
  {
    id: "expression", label: "Expression", kind: "chips", verb: "Coaxing",
    options: [
      o("neutral-x", "Neutral", "a calm neutral expression"),
      o("soft-smile", "Soft smile", "a soft closed-mouth smile"),
      o("grin", "Grin", "a warm open grin"),
      o("serious", "Serious", "a serious, focused expression"),
      o("smirk", "Smirk", "a knowing smirk"),
      o("laugh", "Laughing", "caught mid-laugh"),
    ],
  },
  {
    id: "lighting", label: "Lighting", kind: "chips", verb: "Lighting",
    options: [
      o("studio", "Studio softbox", "soft even studio lighting"),
      o("golden", "Golden hour", "warm golden-hour side light"),
      o("window", "Window light", "diffuse window light from the left"),
      o("rim", "Dramatic rim", "dramatic rim lighting on a dark scene"),
      o("neon", "Neon", "cool neon accent lighting"),
    ],
  },
  {
    id: "backdrop", label: "Backdrop", kind: "chips", verb: "Painting",
    options: [
      o("gray-bg", "Studio gray", "a neutral studio gray backdrop"),
      o("tan-bg", "Warm tan", "a warm tan backdrop"),
      o("slate-bg", "Cool slate", "a cool slate backdrop"),
      o("amber-bg", "Amber gradient", "a subtle amber gradient backdrop"),
      o("bokeh", "City bokeh", "a softly blurred night-city bokeh"),
      o("white-bg", "Plain white", "a plain white backdrop"),
    ],
  },
];

export const PORTRAIT_AXIS_BY_ID: Record<string, PortraitAxis> = Object.fromEntries(
  PORTRAIT_AXES.map((a) => [a.id, a]),
);

/** How many pickable options the catalog carries (the "shitload" number). */
export const PORTRAIT_OPTION_COUNT = PORTRAIT_AXES.reduce(
  (n, a) => n + (a.options?.length ?? 0),
  0,
);

/* --------------------------- default selections ------------------------------- */

export function defaultSelections(): PortraitSelections {
  const out: PortraitSelections = {};
  for (const axis of PORTRAIT_AXES) {
    if (axis.kind === "slider" && axis.range) out[axis.id] = axis.range.fallback;
    else if (axis.multi) out[axis.id] = [];
    else if (axis.options) out[axis.id] = axis.options[0].id;
  }
  return out;
}

/** Clamp junk into a valid selection set — the store-side door. */
export function normalizeSelections(raw: unknown): PortraitSelections {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = defaultSelections();
  for (const axis of PORTRAIT_AXES) {
    const v = src[axis.id];
    if (axis.kind === "slider" && axis.range) {
      const n = typeof v === "number" ? v : Number.NaN;
      if (Number.isFinite(n)) out[axis.id] = Math.min(axis.range.max, Math.max(axis.range.min, Math.round(n)));
    } else if (axis.multi && axis.options) {
      const ids = new Set(axis.options.map((x) => x.id));
      out[axis.id] = (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && ids.has(x));
    } else if (axis.options) {
      if (typeof v === "string" && axis.options.some((x) => x.id === v)) out[axis.id] = v;
    }
  }
  return out;
}

/* ------------------------------ example chips --------------------------------- */

const INK = "#e8e0d4";
const DIM = "#9c9083";

/** Head-and-shoulders context frame the feature exemplars draw into. */
const bust = (extra: string, skin = "#cf9c72"): string =>
  `<circle cx="32" cy="24" r="13" fill="${skin}"/>` +
  `<path d="M12 58 Q14 40 32 40 Q50 40 52 58 Z" fill="#4a4f57"/>` +
  extra;

const eyePath: Record<string, string> = {
  almond: "M20 30 Q32 22 44 30 Q32 36 20 30 Z",
  "round-e": "M22 30 A10 8 0 1 0 42 30 A10 8 0 1 0 22 30 Z",
  hooded: "M20 30 Q32 24 44 30 Q32 33 20 30 Z M19 27 Q32 20 45 27",
  monolid: "M20 31 Q32 25 44 31 Q32 35 20 31 Z",
  upturned: "M20 32 Q32 24 44 27 Q33 35 20 32 Z",
  downturned: "M20 27 Q32 24 44 32 Q31 35 20 27 Z",
  "deep-set": "M20 31 Q32 25 44 31 Q32 36 20 31 Z M17 24 Q32 18 47 24",
};

const nosePath: Record<string, string> = {
  "straight-n": "M32 16 L32 38 Q36 42 30 44",
  roman: "M32 16 Q37 26 34 34 Q38 41 30 43",
  button: "M32 20 L32 34 Q37 40 29 41",
  "wide-n": "M32 16 L32 36 M24 42 Q32 47 40 42",
  "narrow-n": "M32 14 L32 40 Q34 43 30 44",
  snub: "M32 18 L32 34 Q38 36 33 30",
  aquiline: "M32 16 Q40 28 33 36 Q37 42 29 43",
  bulbous: "M32 16 L32 34 M32 42 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0",
};

const hairChip: Record<string, string> = {
  bald: "",
  buzz: `<path d="M20 20 A12 12 0 0 1 44 20 L44 22 L20 22 Z" fill="${INK}" opacity=".55"/>`,
  crew: `<path d="M19 21 A13 11 0 0 1 45 21 L45 24 L19 24 Z" fill="${INK}" opacity=".8"/>`,
  bob: `<path d="M18 22 A14 13 0 0 1 46 22 L46 36 L40 36 L40 26 L24 26 L24 36 L18 36 Z" fill="${INK}"/>`,
  "long-straight": `<path d="M18 22 A14 13 0 0 1 46 22 L46 52 L40 52 L40 26 L24 26 L24 52 L18 52 Z" fill="${INK}"/>`,
  "long-waves": `<path d="M18 22 A14 13 0 0 1 46 22 Q49 34 45 42 Q48 48 44 54 L40 52 Q42 44 40 30 L24 30 Q22 44 24 52 L20 54 Q16 48 19 42 Q15 34 18 22 Z" fill="${INK}"/>`,
  curls: `<g fill="${INK}"><circle cx="22" cy="18" r="5"/><circle cx="32" cy="14" r="6"/><circle cx="42" cy="18" r="5"/><circle cx="18" cy="26" r="4"/><circle cx="46" cy="26" r="4"/></g>`,
  coils: `<g fill="${INK}"><circle cx="21" cy="17" r="4"/><circle cx="28" cy="13" r="4"/><circle cx="36" cy="13" r="4"/><circle cx="43" cy="17" r="4"/><circle cx="18" cy="24" r="3.5"/><circle cx="46" cy="24" r="3.5"/></g>`,
  ponytail: `<path d="M20 20 A12 11 0 0 1 44 20 L44 23 L20 23 Z" fill="${INK}"/><path d="M44 18 Q54 22 50 42 L46 41 Q49 26 42 22 Z" fill="${INK}"/>`,
  bun: `<path d="M20 20 A12 11 0 0 1 44 20 L44 23 L20 23 Z" fill="${INK}"/><circle cx="32" cy="10" r="6" fill="${INK}"/>`,
};

const glassesChip: Record<string, string> = {
  "none-g": `<text x="32" y="36" font-size="10" fill="${DIM}" text-anchor="middle">none</text>`,
  "round-g": `<g stroke="${INK}" stroke-width="2.5" fill="none"><circle cx="22" cy="32" r="9"/><circle cx="42" cy="32" r="9"/><path d="M31 32 h2"/></g>`,
  "rect-g": `<g stroke="${INK}" stroke-width="2.5" fill="none"><rect x="12" y="25" width="18" height="13" rx="2"/><rect x="34" y="25" width="18" height="13" rx="2"/><path d="M30 31 h4"/></g>`,
  aviator: `<g stroke="${INK}" stroke-width="2.5" fill="none"><path d="M12 26 h18 l-2 12 q-7 5 -14 0 Z"/><path d="M34 26 h18 l-2 12 q-7 5 -14 0 Z"/><path d="M30 28 h4"/></g>`,
  "cat-eye": `<g stroke="${INK}" stroke-width="2.5" fill="none"><path d="M12 28 q8 -6 18 0 q-1 10 -9 9 q-8 -1 -9 -9 Z"/><path d="M34 28 q8 -6 18 0 q-1 10 -9 9 q-8 -1 -9 -9 Z"/></g>`,
  rimless: `<g stroke="${INK}" stroke-width="1.2" fill="none" opacity=".8"><circle cx="22" cy="32" r="9"/><circle cx="42" cy="32" r="9"/><path d="M31 32 h2"/></g>`,
  sunglasses: `<g fill="${INK}"><path d="M12 26 h18 l-2 13 q-7 4 -14 0 Z"/><path d="M34 26 h18 l-2 13 q-7 4 -14 0 Z"/><rect x="29" y="27" width="6" height="2.4"/></g>`,
};

const jewelryChip: Record<string, string> = {
  studs: `<circle cx="22" cy="32" r="3.4" fill="${INK}"/><circle cx="42" cy="32" r="3.4" fill="${INK}"/>`,
  hoops: `<g stroke="${INK}" stroke-width="2.4" fill="none"><circle cx="22" cy="34" r="7"/><circle cx="42" cy="34" r="7"/></g>`,
  necklace: `<path d="M16 24 Q32 44 48 24" stroke="${INK}" stroke-width="2" fill="none"/><circle cx="32" cy="35" r="3" fill="${INK}"/>`,
  chain: `<path d="M14 24 Q32 46 50 24" stroke="${INK}" stroke-width="4.5" fill="none" stroke-dasharray="4 2.4"/>`,
  "nose-ring": `<path d="M28 26 L36 26 L32 36 Z" fill="none" stroke="${DIM}" stroke-width="1.4"/><circle cx="34" cy="35" r="3" stroke="${INK}" stroke-width="2" fill="none"/>`,
  "brow-piercing": `<path d="M18 26 Q28 20 38 25" stroke="${DIM}" stroke-width="2.4" fill="none"/><circle cx="36" cy="27" r="2.4" fill="${INK}"/><circle cx="40" cy="24" r="2.4" fill="${INK}"/>`,
  rings: `<g stroke="${INK}" stroke-width="2.2" fill="none"><circle cx="20" cy="34" r="5"/><circle cx="33" cy="34" r="5"/><circle cx="46" cy="34" r="5"/></g>`,
  choker: `<path d="M16 28 Q32 38 48 28" stroke="${INK}" stroke-width="5" fill="none"/>`,
};

const headwearChip: Record<string, string> = {
  "none-hw": `<text x="32" y="36" font-size="10" fill="${DIM}" text-anchor="middle">none</text>`,
  beanie: `<path d="M16 34 A16 15 0 0 1 48 34 L48 40 L16 40 Z" fill="${INK}"/><rect x="16" y="38" width="32" height="5" rx="2" fill="${DIM}"/>`,
  cap: `<path d="M16 34 A16 14 0 0 1 48 34 L48 38 L16 38 Z" fill="${INK}"/><path d="M46 36 Q60 36 58 42 L46 40 Z" fill="${INK}"/>`,
  headscarf: `<path d="M14 36 A18 17 0 0 1 50 36 L50 44 Q42 40 32 40 Q22 40 14 44 Z" fill="${INK}"/><path d="M46 42 Q52 50 46 56 L42 52 Q46 48 44 44 Z" fill="${INK}"/>`,
  fedora: `<path d="M18 32 A14 11 0 0 1 46 32 L46 36 L18 36 Z" fill="${INK}"/><rect x="10" y="35" width="44" height="4" rx="2" fill="${INK}"/><rect x="18" y="30" width="28" height="3.4" fill="${DIM}"/>`,
  headband: `<path d="M16 30 A16 15 0 0 1 48 30" stroke="${INK}" stroke-width="5" fill="none"/>`,
};

const outfitChip: Record<string, string> = {
  tee: `<path d="M18 26 L26 20 Q32 24 38 20 L46 26 L42 34 L40 30 L40 52 L24 52 L24 30 L22 34 Z" fill="${INK}"/>`,
  shirt: `<path d="M18 26 L26 18 L32 26 L38 18 L46 26 L42 34 L40 30 L40 52 L24 52 L24 30 L22 34 Z" fill="${INK}"/><path d="M32 26 L32 52" stroke="${DIM}" stroke-width="1.6"/><circle cx="32" cy="33" r="1.2" fill="${DIM}"/><circle cx="32" cy="40" r="1.2" fill="${DIM}"/>`,
  blouse: `<path d="M18 28 Q24 18 32 24 Q40 18 46 28 L42 36 L40 31 L40 52 L24 52 L24 31 L22 36 Z" fill="${INK}"/><path d="M27 24 Q32 30 37 24" stroke="${DIM}" stroke-width="1.6" fill="none"/>`,
  hoodie: `<path d="M18 30 Q20 18 32 18 Q44 18 46 30 L42 38 L40 32 L40 52 L24 52 L24 32 L22 38 Z" fill="${INK}"/><path d="M24 22 Q32 30 40 22" stroke="${DIM}" stroke-width="2.4" fill="none"/><path d="M29 34 L29 44 M35 34 L35 44" stroke="${DIM}" stroke-width="1.6"/>`,
  suit: `<path d="M18 26 L28 20 L32 30 L36 20 L46 26 L42 36 L40 30 L40 52 L24 52 L24 30 L22 36 Z" fill="${INK}"/><path d="M28 20 L24 34 L32 30 L40 34 L36 20" fill="${DIM}"/><path d="M32 30 L32 52" stroke="#000" stroke-width="1" opacity=".4"/>`,
  dress: `<path d="M22 22 Q32 34 42 22 L40 30 L44 52 L20 52 L24 30 Z" fill="${INK}"/>`,
  leather: `<path d="M18 26 L28 20 L32 28 L36 20 L46 26 L42 38 L40 31 L40 52 L24 52 L24 31 L22 38 Z" fill="${INK}"/><path d="M26 24 L26 50 M38 24 L38 50" stroke="#000" stroke-width="1.6" opacity=".5"/><circle cx="29" cy="28" r="1.4" fill="#000" opacity=".5"/>`,
  turtleneck: `<path d="M20 28 L44 28 L42 52 L22 52 Z" fill="${INK}"/><rect x="26" y="20" width="12" height="9" rx="3" fill="${INK}"/><path d="M26 24 h12" stroke="${DIM}" stroke-width="1.4"/>`,
};

const expressionChip: Record<string, string> = {
  "neutral-x": `<path d="M24 40 h16" stroke="${INK}" stroke-width="2.6"/>`,
  "soft-smile": `<path d="M24 39 Q32 45 40 39" stroke="${INK}" stroke-width="2.6" fill="none"/>`,
  grin: `<path d="M22 38 Q32 50 42 38 Z" fill="${INK}"/>`,
  serious: `<path d="M24 41 h16" stroke="${INK}" stroke-width="3.2"/><path d="M20 26 L28 24 M44 26 L36 24" stroke="${INK}" stroke-width="2.4"/>`,
  smirk: `<path d="M24 41 Q34 44 40 37" stroke="${INK}" stroke-width="2.6" fill="none"/>`,
  laugh: `<path d="M22 36 Q32 52 42 36 Z" fill="${INK}"/><path d="M20 28 Q24 24 28 28 M36 28 Q40 24 44 28" stroke="${INK}" stroke-width="2.2" fill="none"/>`,
};

const browChip: Record<string, string> = {
  "straight-b": `<path d="M16 30 h14 M34 30 h14" stroke="${INK}" stroke-width="3.4"/>`,
  arched: `<path d="M16 32 Q23 24 30 31 M34 31 Q41 24 48 32" stroke="${INK}" stroke-width="3.2" fill="none"/>`,
  "thick-b": `<path d="M16 30 h14 M34 30 h14" stroke="${INK}" stroke-width="6"/>`,
  "thin-b": `<path d="M16 30 Q23 27 30 30 M34 30 Q41 27 48 30" stroke="${INK}" stroke-width="1.6" fill="none"/>`,
  bushy: `<path d="M16 31 q4 -4 7 -1 q4 -4 7 0 M34 30 q4 -4 7 0 q4 -3 7 1" stroke="${INK}" stroke-width="4.6" fill="none"/>`,
  feathered: `<g stroke="${INK}" stroke-width="1.4"><path d="M16 31 L20 27 M20 30 L24 26 M24 30 L28 27 M28 30 L31 28"/><path d="M35 28 L38 31 M38 27 L42 30 M42 26 L46 30 M45 27 L48 31"/></g>`,
};

const lipChip: Record<string, string> = {
  full: `<path d="M22 36 Q32 30 42 36 Q32 46 22 36 Z" fill="${INK}"/>`,
  "thin-l": `<path d="M22 36 Q32 34 42 36 Q32 39 22 36 Z" fill="${INK}"/>`,
  "wide-l": `<path d="M16 36 Q32 31 48 36 Q32 43 16 36 Z" fill="${INK}"/>`,
  "heart-l": `<path d="M22 36 Q28 30 32 34 Q36 30 42 36 Q32 45 22 36 Z" fill="${INK}"/>`,
  "downturned-l": `<path d="M22 34 Q32 32 42 34 Q40 40 32 40 Q24 40 22 34 Z" fill="${INK}" transform="rotate(3 32 36)"/><path d="M21 35 L18 39 M43 35 L46 39" stroke="${INK}" stroke-width="1.6"/>`,
  "neutral-l": `<path d="M23 36 Q32 33 41 36 Q32 41 23 36 Z" fill="${INK}"/>`,
};

const facialHairChip: Record<string, string> = {
  "none-fh": `<text x="32" y="36" font-size="10" fill="${DIM}" text-anchor="middle">clean</text>`,
  stubble: `<g fill="${INK}" opacity=".65">${[...Array(24)].map((_, i) => `<circle cx="${18 + (i % 8) * 4}" cy="${34 + Math.floor(i / 8) * 5}" r="0.9"/>`).join("")}</g>`,
  mustache: `<path d="M20 32 Q32 26 44 32 Q38 36 32 33 Q26 36 20 32 Z" fill="${INK}"/>`,
  goatee: `<path d="M26 34 Q32 32 38 34 L36 46 Q32 50 28 46 Z" fill="${INK}"/>`,
  "short-beard": `<path d="M18 28 Q18 46 32 48 Q46 46 46 28 L42 30 Q42 42 32 43 Q22 42 22 30 Z" fill="${INK}"/>`,
  "full-beard": `<path d="M16 26 Q14 52 32 56 Q50 52 48 26 L42 30 Q44 46 32 49 Q20 46 22 30 Z" fill="${INK}"/>`,
  mutton: `<path d="M16 24 L26 26 L26 44 L16 40 Z M48 24 L38 26 L38 44 L48 40 Z" fill="${INK}"/>`,
};

const faceShapeChip: Record<string, string> = {
  oval: `<ellipse cx="32" cy="32" rx="13" ry="17" fill="none" stroke="${INK}" stroke-width="2.6"/>`,
  round: `<circle cx="32" cy="32" r="15" fill="none" stroke="${INK}" stroke-width="2.6"/>`,
  square: `<rect x="18" y="16" width="28" height="32" rx="7" fill="none" stroke="${INK}" stroke-width="2.6"/>`,
  heart: `<path d="M18 22 Q32 12 46 22 Q46 38 32 50 Q18 38 18 22 Z" fill="none" stroke="${INK}" stroke-width="2.6"/>`,
  oblong: `<ellipse cx="32" cy="32" rx="11" ry="19" fill="none" stroke="${INK}" stroke-width="2.6"/>`,
  diamond: `<path d="M32 12 L48 32 L32 52 L16 32 Z" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`,
};

const sexChip: Record<string, string> = {
  female: `<circle cx="32" cy="26" r="11" fill="none" stroke="${INK}" stroke-width="3"/><path d="M32 37 V52 M25 45 h14" stroke="${INK}" stroke-width="3"/>`,
  male: `<circle cx="28" cy="36" r="11" fill="none" stroke="${INK}" stroke-width="3"/><path d="M36 28 L48 16 M48 16 h-9 M48 16 v9" stroke="${INK}" stroke-width="3"/>`,
  androgynous: `<circle cx="32" cy="32" r="10" fill="none" stroke="${INK}" stroke-width="3"/><path d="M32 42 V54 M32 22 V12 M27 15 L37 15" stroke="${INK}" stroke-width="3"/>`,
};

const buildChip: Record<string, string> = {
  slim: `<path d="M28 14 h8 M30 14 L29 34 L27 54 M34 14 L35 34 L37 54" stroke="${INK}" stroke-width="3" fill="none"/>`,
  athletic: `<path d="M22 16 h20 L38 34 L40 54 M26 16 L26 34 L24 54 M26 34 h12" stroke="${INK}" stroke-width="3.4" fill="none"/>`,
  average: `<path d="M25 15 h14 M27 15 L26 36 L26 54 M37 15 L38 36 L38 54" stroke="${INK}" stroke-width="3" fill="none"/>`,
  muscular: `<path d="M18 18 h28 M22 18 Q18 30 26 36 L24 54 M42 18 Q46 30 38 36 L40 54 M26 36 h12" stroke="${INK}" stroke-width="4" fill="none"/>`,
  curvy: `<path d="M26 14 h12 M28 14 Q22 28 28 36 Q22 46 26 54 M36 14 Q42 28 36 36 Q42 46 38 54" stroke="${INK}" stroke-width="3" fill="none"/>`,
  heavyset: `<path d="M24 16 h16 M26 16 Q16 34 22 54 M38 16 Q48 34 42 54" stroke="${INK}" stroke-width="4.4" fill="none"/>`,
};

const lightingChip: Record<string, string> = {
  studio: `<rect x="12" y="12" width="40" height="40" rx="4" fill="url(#lgStudio)"/><defs><linearGradient id="lgStudio" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8d2c8"/><stop offset="1" stop-color="#8a857c"/></linearGradient></defs>`,
  golden: `<rect x="12" y="12" width="40" height="40" rx="4" fill="url(#lgGold)"/><defs><linearGradient id="lgGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3b56a"/><stop offset="1" stop-color="#8a4b1e"/></linearGradient></defs>`,
  window: `<rect x="12" y="12" width="40" height="40" rx="4" fill="url(#lgWin)"/><rect x="18" y="18" width="12" height="28" fill="#efe9dd" opacity=".7"/><defs><linearGradient id="lgWin" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#cfc9bd"/><stop offset="1" stop-color="#6f6a61"/></linearGradient></defs>`,
  rim: `<rect x="12" y="12" width="40" height="40" rx="4" fill="#17141a"/><path d="M40 16 Q50 32 40 48" stroke="#e8e0d4" stroke-width="3" fill="none" opacity=".9"/>`,
  neon: `<rect x="12" y="12" width="40" height="40" rx="4" fill="#101018"/><path d="M18 20 h28" stroke="#4f8ef7" stroke-width="3"/><path d="M18 44 h28" stroke="#b06df7" stroke-width="3"/>`,
};

const backdropChip: Record<string, string> = {
  "gray-bg": `<rect x="12" y="12" width="40" height="40" rx="4" fill="#7a7a7e"/>`,
  "tan-bg": `<rect x="12" y="12" width="40" height="40" rx="4" fill="#b08d64"/>`,
  "slate-bg": `<rect x="12" y="12" width="40" height="40" rx="4" fill="#5a6a78"/>`,
  "amber-bg": `<rect x="12" y="12" width="40" height="40" rx="4" fill="url(#bgAm)"/><defs><linearGradient id="bgAm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a1a"/><stop offset="1" stop-color="#5a2c0a"/></linearGradient></defs>`,
  bokeh: `<rect x="12" y="12" width="40" height="40" rx="4" fill="#141420"/><g opacity=".8"><circle cx="22" cy="24" r="4" fill="#f3b56a"/><circle cx="40" cy="20" r="3" fill="#4f8ef7"/><circle cx="34" cy="40" r="5" fill="#e86a6a"/><circle cx="46" cy="34" r="3" fill="#7ad48a"/></g>`,
  "white-bg": `<rect x="12" y="12" width="40" height="40" rx="4" fill="#e9e6df" stroke="#9c9083" stroke-width="1"/>`,
};

const ageChip: Record<string, string> = {
  "18-25": bust(""),
  "26-35": bust(`<path d="M26 30 q2 2 4 0" stroke="#7a5a3a" stroke-width="1" fill="none" opacity=".0"/>`),
  "36-45": bust(`<path d="M24 28 h4 M36 28 h4" stroke="#7a5a3a" stroke-width="1" opacity=".6"/>`),
  "46-60": bust(`<path d="M24 28 h4 M36 28 h4 M27 33 q5 3 10 0" stroke="#7a5a3a" stroke-width="1" fill="none" opacity=".8"/>`),
  "60+": bust(`<path d="M24 27 h4 M36 27 h4 M27 33 q5 3 10 0 M25 21 h14" stroke="#6a4a2a" stroke-width="1.2" fill="none"/>`),
};

/**
 * Render one option's example chip (a 64×64 SVG string). Deterministic and
 * total: an unknown pair falls back to a labeled tile rather than throwing.
 */
export function exampleSvg(axis: PortraitAxis, option: PortraitOption): string {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">`;
  const close = `</svg>`;
  if (axis.kind === "swatch" && option.hex) {
    const iris =
      axis.id === "eyeColor"
        ? `<circle cx="32" cy="32" r="20" fill="#f4efe6"/><circle cx="32" cy="32" r="12" fill="${option.hex}"/><circle cx="32" cy="32" r="5" fill="#17130e"/><circle cx="28" cy="28" r="2.4" fill="#fff" opacity=".85"/>`
        : `<circle cx="32" cy="32" r="18" fill="${option.hex}"/>`;
    return open + iris + close;
  }
  const table: Record<string, Record<string, string>> = {
    sex: sexChip,
    age: ageChip,
    faceShape: faceShapeChip,
    hairStyle: hairChip,
    eyeShape: {},
    brows: browChip,
    nose: {},
    lips: lipChip,
    facialHair: facialHairChip,
    glasses: glassesChip,
    jewelry: jewelryChip,
    headwear: headwearChip,
    build: buildChip,
    outfit: outfitChip,
    expression: expressionChip,
    lighting: lightingChip,
    backdrop: backdropChip,
  };
  let body = table[axis.id]?.[option.id] ?? "";
  if (axis.id === "eyeShape") {
    const d = eyePath[option.id] ?? eyePath.almond;
    body = `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.4"/><circle cx="32" cy="30" r="4" fill="${INK}"/>`;
  }
  if (axis.id === "nose") {
    const d = nosePath[option.id] ?? nosePath["straight-n"];
    body = `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  if (axis.id === "hairStyle") {
    body = `<circle cx="32" cy="28" r="12" fill="none" stroke="${DIM}" stroke-width="1.4"/>` + (hairChip[option.id] ?? "");
  }
  if (!body) {
    body = `<text x="32" y="36" font-size="9" fill="${INK}" text-anchor="middle">${option.label}</text>`;
  }
  return open + body + close;
}

/* --------------------------- prompt + progress script --------------------------- */

/** Human line per selection ("Hair style — Long waves"), for summaries. */
export function describeSelections(sel: PortraitSelections): { axis: string; value: string }[] {
  const out: { axis: string; value: string }[] = [];
  for (const axis of PORTRAIT_AXES) {
    const v = sel[axis.id];
    if (axis.kind === "slider") {
      out.push({ axis: axis.label, value: `${v}${axis.range?.unit ?? ""}` });
    } else if (axis.multi) {
      const ids = Array.isArray(v) ? v : [];
      const labels = ids
        .map((id) => axis.options?.find((x) => x.id === id)?.label)
        .filter((x): x is string => Boolean(x));
      out.push({ axis: axis.label, value: labels.length ? labels.join(", ") : "none" });
    } else {
      const opt = axis.options?.find((x) => x.id === v);
      if (opt) out.push({ axis: axis.label, value: opt.label });
    }
  }
  return out;
}

/** The generation brief — strict SVG-only contract in the avatar viewBox. */
export function buildPortraitPrompt(rawSel: unknown): string {
  const sel = normalizeSelections(rawSel);
  const parts: string[] = [];
  for (const axis of PORTRAIT_AXES) {
    const v = sel[axis.id];
    if (axis.kind === "slider") {
      parts.push(`${axis.label.toLowerCase()}: ${v}${axis.range?.unit ?? ""}`);
    } else if (axis.multi && axis.options) {
      const ids = Array.isArray(v) ? v : [];
      const prompts = ids
        .map((id) => axis.options?.find((x) => x.id === id)?.prompt)
        .filter((x): x is string => Boolean(x));
      if (prompts.length) parts.push(`jewelry: ${prompts.join(", ")}`);
    } else if (axis.options) {
      const opt = axis.options.find((x) => x.id === v);
      if (opt) parts.push(opt.prompt + (opt.hex ? ` (${opt.hex})` : ""));
    }
  }
  return [
    "You are a master portrait artist working in layered vector art.",
    "Draw a PHOTO-STYLE, realistic head-and-shoulders portrait as a single SVG.",
    "",
    "THE SUBJECT:",
    parts.map((p) => `- ${p}`).join("\n"),
    "",
    "HARD REQUIREMENTS — every one is checked mechanically:",
    '- Output ONLY the SVG document. No markdown, no code fences, no prose before or after.',
    '- Root element exactly: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 220">',
    "- The FACE center must sit near x=100, y=88 and the head span roughly y=30..145,",
    "  shoulders filling the bottom edge — the app crops a circle around that face point.",
    "- Realistic proportions and shading: build depth with layered paths, subtle radial/linear",
    "  gradients, soft highlight and shadow shapes — NOT flat cartoon fills, no outlines around",
    "  facial features, no stick figures, no emoji style.",
    "- Respect every listed trait: height/weight/build inform neck, shoulder width and jaw fullness.",
    "- Use <defs> gradients freely; ids must be unique and start with 'p14x'.",
    "- FORBIDDEN anywhere: <script>, <foreignObject>, <image>, <use>, <animate>, event handlers",
    "  (onload etc), external hrefs, CSS url() to anything outside the document, base64 payloads.",
    "- Keep it under 60000 characters total.",
  ].join("\n");
}

/**
 * The progress meter's stage script, built from the SAME selections — the
 * meter narrates what was actually asked for. Percentages are the display
 * pace only; the last stage holds until the model really answers.
 */
export function buildStages(rawSel: unknown): string[] {
  const sel = normalizeSelections(rawSel);
  const label = (axisId: string): string | null => {
    const axis = PORTRAIT_AXIS_BY_ID[axisId];
    const v = sel[axisId];
    if (!axis) return null;
    if (axis.kind === "slider") return `${axis.verb} ${v}${axis.range?.unit ?? ""}`;
    if (axis.multi && axis.options) {
      const ids = Array.isArray(v) ? v : [];
      if (ids.length === 0) return null;
      const names = ids.map((id) => axis.options?.find((x) => x.id === id)?.label?.toLowerCase()).filter(Boolean);
      return `${axis.verb} ${names.join(" + ")}`;
    }
    const opt = axis.options?.find((x) => x.id === v);
    return opt ? `${axis.verb} ${opt.label.toLowerCase()}` : null;
  };
  const stages = [
    "Warming up the studio",
    "Sketching bone structure",
    ...PORTRAIT_AXES.map((a) => label(a.id)).filter((x): x is string => Boolean(x)),
    "Layering skin shading",
    "Balancing highlights",
    "Final varnish pass",
  ];
  return stages;
}
