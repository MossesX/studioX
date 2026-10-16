/**
 * @file AmberX Vid avatar engine — the deterministic `AvatarSpec → SVG`
 * renderer plus the axis catalogs the designer drives.
 *
 * ONE renderer for every consumer (profile card, profile viewer, buddy list,
 * chat, admin window): the same spec produces the byte-identical SVG string
 * everywhere, so an avatar can never look different on two surfaces. Pure
 * TS — no React, no node imports — usable from client surfaces and server
 * code alike.
 *
 * Catalog/palette sizes are dictated by `AVATAR_AXES` in the build contract
 * (`./contract`), asserted equal in
 * `test/amberxvid-profiles.test.ts`. Rendering never throws on junk: specs go
 * through {@link normalizeAvatar} (clamp, never crash), so any stored spec —
 * including one written by a future axis revision — still draws.
 */

import { AVATAR_AXES } from "./contract";
import { PORTRAIT_SVG_MAX, type AvatarSpec, type AvatarValue, type PortraitAvatar } from "./types";

/* --------------------------------- palettes ----------------------------------- */

/** 12 skin tones — deep to pale, plus two stylized play tones at the end. */
export const SKIN_TONES = [
  "#5c3a21", "#6f4529", "#835633", "#96663f", "#a9764c", "#bc8a5f",
  "#cd9d74", "#dcb08a", "#e8c39e", "#f1d2b1", "#c99b8f", "#9aa5b1",
] as const;

/** 16 hair colors — naturals first, dyes after. */
export const HAIR_COLORS = [
  "#0e0e10", "#2a1e17", "#3b2a1d", "#4f3826", "#6b4a2f", "#8a5f3a",
  "#a87a4a", "#c99e66", "#e0c28c", "#b0b4bc", "#e8e6e1", "#7d3020",
  "#b3402e", "#FF7A1A", "#7a4fd0", "#2e8b7a",
] as const;

/** 10 eye colors. */
export const EYE_COLORS = [
  "#2a1c12", "#4a2f1a", "#6b4526", "#3a5f3a", "#4a7a5a", "#3a5a7d",
  "#5a7fae", "#7d8fa6", "#8a6fae", "#b0722a",
] as const;

/** 16 outfit colors. */
export const OUTFIT_COLORS = [
  "#22262c", "#3a3f47", "#5a616b", "#8a94a2", "#e6e2da", "#f4f1ea",
  "#7d3020", "#b3402e", "#FF7A1A", "#c98a1e", "#3e6b3a", "#2e8b7a",
  "#2f5a8a", "#5a7fae", "#5a3f8a", "#8a4a6b",
] as const;

/* --------------------------------- catalogs ----------------------------------- */

export const HAIR_STYLES = [
  "Bald", "Buzz cut", "Crew cut", "Short crop", "Side part", "Curtains",
  "Spiky", "Mohawk", "Pompadour", "Quiff", "Bowl cut", "Undercut",
  "Afro", "Curly", "Waves", "Shag", "Bob", "Long straight",
  "Long wavy", "Ponytail", "Top bun", "Pigtails", "Braids", "Dreads",
] as const;

export const EYE_SHAPES = [
  "Round", "Almond", "Wide", "Narrow", "Upturned", "Droopy", "Sleepy", "Sharp",
] as const;

export const BROW_STYLES = [
  "Straight", "Arched", "Thick", "Thin", "Angled", "Worried", "Raised", "Bold",
] as const;

export const NOSE_STYLES = [
  "Button", "Straight", "Wide", "Pointed", "Round", "Aquiline", "Upturned", "Broad",
] as const;

export const MOUTH_STYLES = [
  "Smile", "Grin", "Neutral", "Smirk", "Frown", "Open", "Laugh", "Pout", "Whistle", "Serious",
] as const;

export const FACIAL_HAIR_STYLES = [
  "None", "Stubble", "Mustache", "Goatee", "Chin strap", "Full beard",
  "Big beard", "Handlebar", "Soul patch", "Mutton chops",
] as const;

export const GLASSES_STYLES = [
  "None", "Round", "Square", "Aviator", "Cat-eye", "Rimless", "Sunglasses", "Sport visor",
] as const;

export const ACCESSORY_STYLES = [
  "None", "Stud earrings", "Hoop earrings", "Headphones", "Ball cap", "Beanie",
  "Headband", "Nose ring", "Necklace", "Scarf", "Freckles", "Blush",
] as const;

export const OUTFIT_STYLES = [
  "Tee", "Hoodie", "Suit", "V-neck", "Tank top", "Turtleneck",
  "Jacket", "Flannel", "Polo", "Sweater", "Lab coat", "GizmoX tee",
] as const;

export const BACKDROP_STYLES = [
  "Slate", "Amber glow", "Dot grid", "Stripes", "Rings", "Blueprint",
  "Chevrons", "Orbit", "Facets", "Sparks",
] as const;

/** Catalog entry names per catalog axis id — the designer's option labels. */
const CATALOGS: Record<string, readonly string[]> = {
  hairStyle: HAIR_STYLES,
  eyeShape: EYE_SHAPES,
  brows: BROW_STYLES,
  nose: NOSE_STYLES,
  mouth: MOUTH_STYLES,
  facialHair: FACIAL_HAIR_STYLES,
  glasses: GLASSES_STYLES,
  accessories: ACCESSORY_STYLES,
  outfit: OUTFIT_STYLES,
  backdrop: BACKDROP_STYLES,
};

/** Swatch colors per swatch axis id — the designer's color dots. */
const SWATCHES: Record<string, readonly string[]> = {
  skinTone: SKIN_TONES,
  hairColor: HAIR_COLORS,
  eyeColor: EYE_COLORS,
  outfitColor: OUTFIT_COLORS,
};

export function axisCatalog(axisId: string): readonly string[] {
  return CATALOGS[axisId] ?? [];
}

export function axisSwatches(axisId: string): readonly string[] {
  return SWATCHES[axisId] ?? [];
}

/* ------------------------------- spec plumbing --------------------------------- */

export const DEFAULT_AVATAR: AvatarSpec = {
  version: 1,
  skinTone: 7,
  hairStyle: 3,
  hairColor: 2,
  eyeColor: 1,
  eyeShape: 1,
  brows: 0,
  nose: 1,
  mouth: 0,
  facialHair: 0,
  height: 175,
  build: 5,
  glasses: 0,
  accessories: 0,
  outfit: 0,
  outfitColor: 0,
  backdrop: 0,
};

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * Clamp anything into a valid spec — junk objects render the default, stray
 * indexes clamp into their catalog instead of crashing a surface. This is the
 * one door every consumer (designer save, store write, renderer) goes through,
 * which is what keeps "same spec, same pixels" true even for hostile data.
 */
export function normalizeAvatar(v: unknown): AvatarSpec {
  const raw = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const cat = (id: string, val: unknown, fallback: number): number =>
    clampInt(val, 0, axisCatalog(id).length - 1, fallback);
  const swa = (id: string, val: unknown, fallback: number): number =>
    clampInt(val, 0, axisSwatches(id).length - 1, fallback);
  return {
    version: 1,
    skinTone: swa("skinTone", raw.skinTone, DEFAULT_AVATAR.skinTone),
    hairStyle: cat("hairStyle", raw.hairStyle, DEFAULT_AVATAR.hairStyle),
    hairColor: swa("hairColor", raw.hairColor, DEFAULT_AVATAR.hairColor),
    eyeColor: swa("eyeColor", raw.eyeColor, DEFAULT_AVATAR.eyeColor),
    eyeShape: cat("eyeShape", raw.eyeShape, DEFAULT_AVATAR.eyeShape),
    brows: cat("brows", raw.brows, DEFAULT_AVATAR.brows),
    nose: cat("nose", raw.nose, DEFAULT_AVATAR.nose),
    mouth: cat("mouth", raw.mouth, DEFAULT_AVATAR.mouth),
    facialHair: cat("facialHair", raw.facialHair, DEFAULT_AVATAR.facialHair),
    height: clampInt(raw.height, 140, 210, DEFAULT_AVATAR.height),
    build: clampInt(raw.build, 1, 10, DEFAULT_AVATAR.build),
    glasses: cat("glasses", raw.glasses, DEFAULT_AVATAR.glasses),
    accessories: cat("accessories", raw.accessories, DEFAULT_AVATAR.accessories),
    outfit: cat("outfit", raw.outfit, DEFAULT_AVATAR.outfit),
    outfitColor: swa("outfitColor", raw.outfitColor, DEFAULT_AVATAR.outfitColor),
    backdrop: cat("backdrop", raw.backdrop, DEFAULT_AVATAR.backdrop),
  };
}

/* ------------------------- the two-kind avatar value --------------------------- */

/** True for an AI portrait (P15) rather than a 16-axis spec. */
export function isPortrait(v: unknown): v is PortraitAvatar {
  return Boolean(v) && typeof v === "object" && (v as { version?: unknown }).version === 2;
}

/**
 * Tags that must never appear in a STORED portrait. The real gate is
 * `sanitizePortraitSvg` at the write door (`./portrait-svg`);
 * this is the cheap read-side backstop for a hand-edited or restored profile
 * file, so a tampered store degrades to "no avatar" instead of executing.
 */
const PORTRAIT_HOSTILE = /<\s*(script|foreignObject|use|image|a|animate|iframe|embed|object|style)\b|\son[a-z]+\s*=|javascript:/i;

/**
 * The chokepoint every consumer of `Profile.avatar` passes through.
 *
 * A v2 portrait is validated structurally and returned as-is; a v1 spec (or
 * any junk object) is clamped by {@link normalizeAvatar} exactly as before,
 * so nothing that existed before P15 changes behaviour. `null` in, `null` out
 * — "no avatar" is a real state (the initial-letter disc).
 */
export function normalizeAvatarValue(v: unknown): AvatarValue {
  if (v === null || v === undefined) return null;
  if (isPortrait(v)) {
    // Re-widened deliberately: `isPortrait` only proves `version === 2`, so
    // every other field is still untrusted and gets its own check below.
    const p = v as unknown as Record<string, unknown>;
    const svg = typeof p.svg === "string" ? p.svg : "";
    if (!svg || svg.length > PORTRAIT_SVG_MAX || PORTRAIT_HOSTILE.test(svg)) return null;
    return {
      version: 2,
      svg,
      selections:
        p.selections && typeof p.selections === "object"
          ? (p.selections as PortraitAvatar["selections"])
          : {},
      createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date(0).toISOString(),
      model: typeof p.model === "string" ? p.model : "claude",
    };
  }
  return normalizeAvatar(v);
}

/** A fully random spec — the designer's dice button. Caller supplies the rand
 *  source (the renderer itself stays 100% deterministic). */
export function randomAvatar(rand: () => number = Math.random): AvatarSpec {
  const pick = (n: number): number => Math.floor(rand() * n);
  return normalizeAvatar({
    version: 1,
    skinTone: pick(SKIN_TONES.length),
    hairStyle: pick(HAIR_STYLES.length),
    hairColor: pick(HAIR_COLORS.length),
    eyeColor: pick(EYE_COLORS.length),
    eyeShape: pick(EYE_SHAPES.length),
    brows: pick(BROW_STYLES.length),
    nose: pick(NOSE_STYLES.length),
    mouth: pick(MOUTH_STYLES.length),
    facialHair: pick(FACIAL_HAIR_STYLES.length),
    height: 140 + pick(71),
    build: 1 + pick(10),
    glasses: pick(GLASSES_STYLES.length),
    accessories: pick(ACCESSORY_STYLES.length),
    outfit: pick(OUTFIT_STYLES.length),
    outfitColor: pick(OUTFIT_COLORS.length),
    backdrop: pick(BACKDROP_STYLES.length),
  });
}

/* ------------------------------ color utilities -------------------------------- */

/** Darken/lighten a #rrggbb by a factor (−1..1) — feature lines derive from the
 *  skin/hair swatch so every tone keeps coherent contrast. */
function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number): number =>
    Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount);
  const r = ch((n >> 16) & 0xff);
  const g = ch((n >> 8) & 0xff);
  const b = ch(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const ACCENT = "#FF7A1A"; // the brand accent, baked into the deterministic art
const round1 = (v: number): number => Math.round(v * 10) / 10;

/* --------------------------------- rendering ----------------------------------- */

export interface AvatarRenderOptions {
  /** Output width/height in px (the viewBox stays 200×220). Default 96. */
  size?: number;
  /** Draw the backdrop panel (off for chips riding their own surface). */
  backdrop?: boolean;
}

/**
 * Render the spec to a complete inline-`<svg>` string. Deterministic: no
 * randomness, no dates, no counters — the same spec is the same string,
 * everywhere, forever. Junk specs are normalized first.
 */
export function avatarSvg(spec: AvatarSpec, opts: AvatarRenderOptions = {}): string {
  const s = normalizeAvatar(spec);
  const size = clampInt(opts.size, 8, 2048, 96);
  const withBackdrop = opts.backdrop !== false;

  const skin = SKIN_TONES[s.skinTone];
  const skinEdge = shade(skin, -0.25);
  const skinDeep = shade(skin, -0.4);
  const hair = HAIR_COLORS[s.hairColor];
  const eye = EYE_COLORS[s.eyeColor];
  const outfit = OUTFIT_COLORS[s.outfitColor];

  // Height fills the frame bottom-anchored; build widens shoulders + face.
  const hf = (s.height - 140) / 70; // 0..1
  const scale = round1((0.9 + hf * 0.18) * 100) / 100;
  const bw = 0.88 + ((s.build - 1) / 9) * 0.28;
  const fw = 1 + (bw - 1) * 0.45; // face takes a gentler share of build
  const rx = round1(33 * fw); // face half-width
  const cx = 100;
  const cy = 88; // face center

  const parts: string[] = [];

  if (withBackdrop) parts.push(backdropSvg(s.backdrop));

  const hairLayers = hairSvg(s.hairStyle, rx, hair);
  const body: string[] = [];

  if (hairLayers.back) body.push(hairLayers.back);

  // Torso + outfit (own layer group so accessories can ride above it).
  body.push(torsoSvg(s.outfit, bw, outfit, skin, hair));

  // Neck + head + ears.
  body.push(
    `<path d="M ${cx - 11} 116 L ${cx - 11} 138 L ${cx + 11} 138 L ${cx + 11} 116 Z" fill="${skinEdge}"/>`,
    `<ellipse cx="${cx - rx}" cy="${cy + 2}" rx="6.5" ry="9" fill="${skin}" stroke="${skinEdge}" stroke-width="1"/>`,
    `<ellipse cx="${cx + rx}" cy="${cy + 2}" rx="6.5" ry="9" fill="${skin}" stroke="${skinEdge}" stroke-width="1"/>`,
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="40" fill="${skin}"/>`,
  );

  body.push(facialHairSvg(s.facialHair, rx, hair, cx, cy));
  body.push(browsSvg(s.brows, hair, cx));
  body.push(eyesSvg(s.eyeShape, eye, skin, cx));
  body.push(noseSvg(s.nose, skinDeep, cx));
  body.push(mouthSvg(s.mouth, skinDeep, cx));

  if (hairLayers.front) body.push(hairLayers.front);
  body.push(glassesSvg(s.glasses, cx));
  body.push(accessorySvg(s.accessories, rx, cx, cy, hair, outfit));

  // The height/build transform anchors at the bottom center of the frame.
  parts.push(
    `<g transform="translate(${cx} 220) scale(${scale}) translate(${-cx} -220)">${body.join("")}</g>`,
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size * 1.1}" ` +
    `viewBox="0 0 200 220" role="img" aria-label="avatar">${parts.join("")}</svg>`
  );
}

/* --------------------------------- backdrops ----------------------------------- */

function backdropSvg(index: number): string {
  const base = `<rect width="200" height="220" fill="#171a20"/>`;
  const pid = `axvp${index}`; // same index → identical defs, so inline collisions are harmless
  switch (index) {
    case 1: // Amber glow
      return (
        `<rect width="200" height="220" fill="#1c1410"/>` +
        `<circle cx="100" cy="96" r="88" fill="${ACCENT}" opacity="0.14"/>` +
        `<circle cx="100" cy="96" r="54" fill="${ACCENT}" opacity="0.12"/>`
      );
    case 2: // Dot grid
      return (
        `<defs><pattern id="${pid}" width="18" height="18" patternUnits="userSpaceOnUse">` +
        `<circle cx="4" cy="4" r="1.6" fill="${ACCENT}" opacity="0.35"/></pattern></defs>` +
        base + `<rect width="200" height="220" fill="url(#${pid})"/>`
      );
    case 3: // Stripes
      return (
        `<defs><pattern id="${pid}" width="22" height="22" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">` +
        `<rect width="8" height="22" fill="${ACCENT}" opacity="0.12"/></pattern></defs>` +
        base + `<rect width="200" height="220" fill="url(#${pid})"/>`
      );
    case 4: // Rings
      return (
        base +
        [40, 70, 100, 130].map((r) => `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${ACCENT}" stroke-width="1.5" opacity="0.22"/>`).join("")
      );
    case 5: // Blueprint
      return (
        `<defs><pattern id="${pid}" width="20" height="20" patternUnits="userSpaceOnUse">` +
        `<path d="M 20 0 L 0 0 0 20" fill="none" stroke="#3a4a6b" stroke-width="1"/></pattern></defs>` +
        `<rect width="200" height="220" fill="#131a28"/><rect width="200" height="220" fill="url(#${pid})"/>`
      );
    case 6: // Chevrons
      return (
        `<defs><pattern id="${pid}" width="40" height="24" patternUnits="userSpaceOnUse">` +
        `<path d="M 0 16 L 20 4 L 40 16" fill="none" stroke="${ACCENT}" stroke-width="2.5" opacity="0.2"/></pattern></defs>` +
        base + `<rect width="200" height="220" fill="url(#${pid})"/>`
      );
    case 7: // Orbit
      return (
        base +
        `<ellipse cx="100" cy="104" rx="86" ry="34" fill="none" stroke="${ACCENT}" stroke-width="1.5" opacity="0.3" transform="rotate(-18 100 104)"/>` +
        `<ellipse cx="100" cy="104" rx="86" ry="34" fill="none" stroke="#5a7fae" stroke-width="1.5" opacity="0.3" transform="rotate(24 100 104)"/>` +
        `<circle cx="168" cy="62" r="4" fill="${ACCENT}" opacity="0.6"/>`
      );
    case 8: // Facets
      return (
        base +
        `<path d="M 0 0 L 96 0 L 0 128 Z" fill="#232936" opacity="0.9"/>` +
        `<path d="M 200 220 L 200 96 L 84 220 Z" fill="#20242e" opacity="0.9"/>` +
        `<path d="M 200 0 L 128 0 L 200 84 Z" fill="${ACCENT}" opacity="0.1"/>`
      );
    case 9: // Sparks
      return (
        base +
        [[26, 34], [168, 26], [182, 150], [30, 178], [154, 196], [104, 16]]
          .map(([x, y]) => `<path d="M ${x} ${y - 6} L ${x + 1.8} ${y - 1.8} L ${x + 6} ${y} L ${x + 1.8} ${y + 1.8} L ${x} ${y + 6} L ${x - 1.8} ${y + 1.8} L ${x - 6} ${y} L ${x - 1.8} ${y - 1.8} Z" fill="${ACCENT}" opacity="0.4"/>`)
          .join("")
      );
    default: // Slate
      return `<rect width="200" height="220" fill="#1c1f26"/>`;
  }
}

/* ------------------------------------ hair -------------------------------------- */

/** Top-of-head cap: half-ellipse over the skull, closed along a fringe line. */
function cap(rx: number, yF: number, grow = 1): string {
  const R = rx * grow + 2;
  const ry = 42 * grow;
  const t = (yF - 88) / ry;
  const dx = round1(R * Math.sqrt(Math.max(0, 1 - t * t)));
  return `M ${100 - dx} ${yF} A ${round1(R)} ${round1(ry)} 0 0 1 ${100 + dx} ${yF}`;
}

/** Side panels hugging the face down to `yEnd` — bobs and long styles. */
function sidePanels(rx: number, yEnd: number, w = 10): string {
  const l = 100 - rx - 3;
  const r = 100 + rx + 3;
  return (
    `M ${l} 70 Q ${l - 3} ${(70 + yEnd) / 2} ${l + 1} ${yEnd} L ${l + w} ${yEnd} Q ${l + w} 92 ${l + w + 2} 74 Z ` +
    `M ${r} 70 Q ${r + 3} ${(70 + yEnd) / 2} ${r - 1} ${yEnd} L ${r - w} ${yEnd} Q ${r - w} 92 ${r - w - 2} 74 Z`
  );
}

function hairSvg(index: number, rx: number, color: string): { back?: string; front?: string } {
  const F = (d: string, extra = ""): string => `<path d="${d}" fill="${color}"${extra}/>`;
  const capZ = (yF: number, grow = 1): string => `${cap(rx, yF, grow)} Z`;
  const edge = shade(color, -0.3);
  switch (index) {
    case 0: return {}; // Bald
    case 1: return { front: F(capZ(66, 1.0), ` opacity="0.55"`) }; // Buzz cut
    case 2: return { front: F(capZ(63, 1.02)) }; // Crew cut
    case 3: return { front: F(capZ(58, 1.04)) }; // Short crop
    case 4: // Side part — fringe sweeps down-left
      return { front: F(`${cap(rx, 60, 1.05)} L ${100 + rx * 0.7} 66 L ${100 - rx * 0.5} 56 L ${100 - rx - 2} 66 Z`) };
    case 5: // Curtains — middle part, two lobes
      return { front: F(`${cap(rx, 72, 1.06)} L ${100 + rx * 0.3} 52 L 100 68 L ${100 - rx * 0.3} 52 L ${100 - rx - 4} 72 Z`) };
    case 6: { // Spiky
      const spikes = [-3, -2, -1, 0, 1, 2, 3]
        .map((i) => `L ${100 + i * 9 + 4.5} 34 L ${100 + i * 9 + 9} 52`)
        .join(" ");
      return { front: F(`M ${100 - 31.5} 52 ${spikes} ${cap(rx, 60, 1.02).replace("M", "L").split("A")[0]} A ${rx + 2} 42 0 0 0 ${100 - 31.5} 52 Z`) };
    }
    case 7: // Mohawk
      return { front: F(`M 92 58 L 94 24 L 100 34 L 106 24 L 108 58 Q 100 50 92 58 Z`) };
    case 8: // Pompadour — tall volume tipped forward
      return { front: F(`M ${100 - rx - 2} 66 Q ${100 - rx} 30 100 28 Q ${100 + rx + 6} 26 ${100 + rx + 2} 62 A ${rx + 2} 42 0 0 0 ${100 - rx - 2} 66 Z`) };
    case 9: // Quiff — front bump
      return { front: F(`${cap(rx, 62, 1.03)} Z M ${100 - rx * 0.6} 54 Q ${100 - rx * 0.2} 34 ${100 + rx * 0.5} 44 Q ${100 + rx * 0.2} 54 ${100 - rx * 0.6} 54 Z`) };
    case 10: return { front: F(capZ(72, 1.1)) }; // Bowl cut
    case 11: // Undercut — tight sides drawn faded, solid top
      return { front: F(capZ(70, 1.0), ` opacity="0.35"`) + F(capZ(58, 1.04)) };
    case 12: return { back: `<circle cx="100" cy="66" r="${rx + 16}" fill="${color}"/>` }; // Afro
    case 13: { // Curly — bumped silhouette
      const bumps = [-2, -1, 0, 1, 2]
        .map((i) => `<circle cx="${100 + i * (rx / 2.1)}" cy="${i % 2 === 0 ? 52 : 46}" r="12" fill="${color}"/>`)
        .join("");
      return { front: `${bumps}${F(capZ(60, 1.05))}` };
    }
    case 14: // Waves — scalloped fringe
      return { front: F(`${cap(rx, 62, 1.05)} Q ${100 + rx * 0.5} 70 ${100 + rx * 0.25} 60 Q 100 70 ${100 - rx * 0.25} 60 Q ${100 - rx * 0.5} 70 ${100 - rx - 2} 62 Z`) };
    case 15: // Shag — jagged side pieces
      return {
        back: F(sidePanels(rx, 118, 12)),
        front: F(`${cap(rx, 62, 1.06)} L ${100 + rx * 0.5} 54 L ${100 + rx * 0.2} 62 L ${100 - rx * 0.2} 52 L ${100 - rx * 0.5} 62 L ${100 - rx - 2} 62 Z`),
      };
    case 16: // Bob — chin-length panels
      return { back: F(sidePanels(rx, 128, 13)), front: F(capZ(62, 1.07)) };
    case 17: // Long straight
      return {
        back: `<path d="M ${100 - rx - 8} 70 L ${100 - rx - 10} 186 L ${100 - rx + 8} 186 L ${100 - rx + 6} 100 L ${100 + rx - 6} 100 L ${100 + rx - 8} 186 L ${100 + rx + 10} 186 L ${100 + rx + 8} 70 Q 100 40 ${100 - rx - 8} 70 Z" fill="${color}"/>`,
        front: F(capZ(60, 1.06)),
      };
    case 18: // Long wavy
      return {
        back: `<path d="M ${100 - rx - 8} 70 Q ${100 - rx - 18} 120 ${100 - rx - 6} 182 L ${100 - rx + 10} 182 Q ${100 - rx} 130 ${100 - rx + 6} 100 L ${100 + rx - 6} 100 Q ${100 + rx} 130 ${100 + rx - 10} 182 L ${100 + rx + 6} 182 Q ${100 + rx + 18} 120 ${100 + rx + 8} 70 Q 100 40 ${100 - rx - 8} 70 Z" fill="${color}"/>`,
        front: F(capZ(60, 1.06)),
      };
    case 19: // Ponytail
      return {
        back: `<path d="M ${100 + rx - 2} 62 Q ${100 + rx + 22} 70 ${100 + rx + 14} 150 L ${100 + rx + 2} 148 Q ${100 + rx + 8} 84 ${100 + rx - 6} 70 Z" fill="${color}"/><circle cx="${100 + rx + 2}" cy="60" r="7" fill="${edge}"/>`,
        front: F(capZ(60, 1.05)),
      };
    case 20: // Top bun
      return { front: `<circle cx="100" cy="36" r="13" fill="${color}"/><rect x="88" y="46" width="24" height="5" rx="2.5" fill="${edge}"/>${F(capZ(60, 1.04))}` };
    case 21: // Pigtails
      return {
        back:
          `<path d="M ${100 - rx - 4} 64 Q ${100 - rx - 26} 78 ${100 - rx - 18} 148 L ${100 - rx - 4} 144 Q ${100 - rx - 12} 92 ${100 - rx} 74 Z" fill="${color}"/>` +
          `<path d="M ${100 + rx + 4} 64 Q ${100 + rx + 26} 78 ${100 + rx + 18} 148 L ${100 + rx + 4} 144 Q ${100 + rx + 12} 92 ${100 + rx} 74 Z" fill="${color}"/>`,
        front: F(capZ(62, 1.05)),
      };
    case 22: { // Braids — segmented side strands
      const strand = (sx: number): string =>
        `<path d="M ${sx - 5} 72 L ${sx - 6} 160 L ${sx + 6} 160 L ${sx + 5} 72 Z" fill="${color}"/>` +
        [90, 108, 126, 144].map((y) => `<line x1="${sx - 6}" y1="${y}" x2="${sx + 6}" y2="${y + 6}" stroke="${edge}" stroke-width="1.5"/>`).join("");
      return { back: strand(100 - rx - 6) + strand(100 + rx + 6), front: F(capZ(60, 1.05)) };
    }
    case 23: { // Dreads
      const locs = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]
        .map((i) => `<path d="M ${100 + i * 12 - 3} 56 L ${100 + i * 14 - 3} ${132 + Math.abs(i) * 10} L ${100 + i * 14 + 3} ${132 + Math.abs(i) * 10} L ${100 + i * 12 + 3} 56 Z" fill="${color}"/>`)
        .join("");
      return { back: locs, front: F(capZ(58, 1.06)) };
    }
    default: return {};
  }
}

/* ------------------------------------ torso ------------------------------------- */

function torsoSvg(index: number, bw: number, color: string, skin: string, hair: string): string {
  const cx = 100;
  const sh = round1(56 * bw); // shoulder half-width
  const hip = round1(62 * bw);
  const dark = shade(color, -0.28);
  const light = shade(color, 0.35);
  const base = (fill: string): string =>
    `<path d="M ${cx - 15} 130 Q ${cx - 44 * bw} 140 ${cx - sh} 172 L ${cx - hip} 220 L ${cx + hip} 220 L ${cx + sh} 172 Q ${cx + 44 * bw} 140 ${cx + 15} 130 Z" fill="${fill}"/>`;
  const crew = `<path d="M ${cx - 14} 131 Q ${cx} 143 ${cx + 14} 131 L ${cx + 11} 128 Q ${cx} 137 ${cx - 11} 128 Z" fill="${skin}"/>`;
  switch (index) {
    case 1: // Hoodie
      return (
        base(color) +
        `<path d="M ${cx - 20} 134 Q ${cx} 152 ${cx + 20} 134 Q ${cx} 144 ${cx - 20} 134 Z" fill="${dark}"/>` +
        `<line x1="${cx - 7}" y1="142" x2="${cx - 7}" y2="164" stroke="${light}" stroke-width="2.5"/>` +
        `<line x1="${cx + 7}" y1="142" x2="${cx + 7}" y2="164" stroke="${light}" stroke-width="2.5"/>`
      );
    case 2: // Suit
      return (
        base("#22262c") +
        `<path d="M ${cx - 13} 131 L ${cx} 150 L ${cx + 13} 131 L ${cx + 9} 128 L ${cx} 140 L ${cx - 9} 128 Z" fill="#f4f1ea"/>` +
        `<path d="M ${cx - 2.5} 140 L ${cx + 2.5} 140 L ${cx + 4} 170 L ${cx} 178 L ${cx - 4} 170 Z" fill="${color}"/>` +
        `<path d="M ${cx - 13} 131 L ${cx - 22} 158 L ${cx - 10} 150 Z M ${cx + 13} 131 L ${cx + 22} 158 L ${cx + 10} 150 Z" fill="#2e333b"/>`
      );
    case 3: // V-neck
      return base(color) + `<path d="M ${cx - 13} 130 L ${cx} 152 L ${cx + 13} 130 L ${cx + 9} 128 L ${cx} 144 L ${cx - 9} 128 Z" fill="${skin}"/>`;
    case 4: // Tank top
      return (
        base(skin) +
        `<path d="M ${cx - sh * 0.62} 220 L ${cx - sh * 0.62} 168 Q ${cx - 20} 152 ${cx - 14} 132 L ${cx + 14} 132 Q ${cx + 20} 152 ${cx + sh * 0.62} 168 L ${cx + sh * 0.62} 220 Z" fill="${color}"/>`
      );
    case 5: // Turtleneck
      return base(color) + `<rect x="${cx - 14}" y="118" width="28" height="18" rx="6" fill="${dark}"/>`;
    case 6: // Jacket — open over inner shirt
      return (
        base("#3a3f47") +
        `<path d="M ${cx - 12} 131 L ${cx - 8} 220 L ${cx + 8} 220 L ${cx + 12} 131 Q ${cx} 141 ${cx - 12} 131 Z" fill="${color}"/>` +
        `<path d="M ${cx - 13} 131 L ${cx - 26} 164 L ${cx - 13} 156 Z M ${cx + 13} 131 L ${cx + 26} 164 L ${cx + 13} 156 Z" fill="#2e333b"/>` +
        crew
      );
    case 7: // Flannel
      return (
        base(color) +
        [150, 172, 194].map((y) => `<line x1="${cx - hip}" y1="${y}" x2="${cx + hip}" y2="${y}" stroke="${dark}" stroke-width="3" opacity="0.7"/>`).join("") +
        [-30, 0, 30].map((dx) => `<line x1="${cx + dx}" y1="132" x2="${cx + dx}" y2="220" stroke="${dark}" stroke-width="3" opacity="0.7"/>`).join("") +
        crew
      );
    case 8: // Polo
      return (
        base(color) +
        `<path d="M ${cx - 14} 130 L ${cx - 6} 140 L ${cx - 3} 132 Z M ${cx + 14} 130 L ${cx + 6} 140 L ${cx + 3} 132 Z" fill="${dark}"/>` +
        `<circle cx="${cx}" cy="146" r="1.8" fill="${dark}"/><circle cx="${cx}" cy="154" r="1.8" fill="${dark}"/>`
      );
    case 9: // Sweater — ribbed crew
      return base(color) + `<path d="M ${cx - 15} 130 Q ${cx} 146 ${cx + 15} 130 L ${cx + 12} 126 Q ${cx} 138 ${cx - 12} 126 Z" fill="${dark}"/>`;
    case 10: // Lab coat
      return (
        base("#f4f1ea") +
        `<path d="M ${cx - 2} 142 L ${cx + 2} 142 L ${cx + 2} 220 L ${cx - 2} 220 Z" fill="#d8d4ca"/>` +
        `<path d="M ${cx - 13} 131 L ${cx - 20} 156 L ${cx - 9} 148 Z M ${cx + 13} 131 L ${cx + 20} 156 L ${cx + 9} 148 Z" fill="#e2ded4"/>` +
        `<path d="M ${cx - 12} 131 Q ${cx} 141 ${cx + 12} 131 L ${cx + 9} 128 Q ${cx} 136 ${cx - 9} 128 Z" fill="${skin}"/>`
      );
    case 11: // GizmoX tee — brand mark on the chest
      return (
        base(color) +
        crew +
        `<circle cx="${cx}" cy="172" r="13" fill="none" stroke="${ACCENT}" stroke-width="2.5"/>` +
        `<path d="M ${cx - 6} 166 L ${cx + 6} 178 M ${cx + 6} 166 L ${cx - 6} 178" stroke="${ACCENT}" stroke-width="2.5" stroke-linecap="round"/>`
      );
    default: // Tee
      return base(color) + crew;
  }
}

/* ---------------------------------- features ------------------------------------ */

function eyesSvg(index: number, iris: string, skin: string, cx: number): string {
  const ey = 84;
  const dx = 14;
  // Per-shape white geometry: [rx, ry, tilt°] — tilt mirrors across the face.
  const shapes: [number, number, number][] = [
    [5, 4.8, 0],   // Round
    [5.8, 3.6, 0], // Almond
    [6.4, 4.6, 0], // Wide
    [5.6, 2.4, 0], // Narrow
    [5.6, 3.4, -9], // Upturned
    [5.6, 3.4, 9],  // Droopy
    [5.2, 3.2, 0],  // Sleepy
    [5.8, 3.0, -4], // Sharp
  ];
  const [erx, ery, tilt] = shapes[index] ?? shapes[1];
  const one = (x: number, mirror: number): string => {
    const rot = tilt ? ` transform="rotate(${tilt * mirror} ${x} ${ey})"` : "";
    let svg =
      `<g${rot}><ellipse cx="${x}" cy="${ey}" rx="${erx}" ry="${ery}" fill="#f6f4ef"/>` +
      `<circle cx="${x}" cy="${ey}" r="${Math.min(ery, 2.8)}" fill="${iris}"/>` +
      `<circle cx="${x}" cy="${ey}" r="1.2" fill="#101014"/>` +
      `<circle cx="${x + 1}" cy="${ey - 1}" r="0.6" fill="#ffffff"/>`;
    if (index === 6) svg += `<path d="M ${x - erx} ${ey - 1} A ${erx} ${ery} 0 0 1 ${x + erx} ${ey - 1} L ${x + erx} ${ey - ery - 1} L ${x - erx} ${ey - ery - 1} Z" fill="${skin}"/>`;
    if (index === 7) svg += `<path d="M ${x - erx} ${ey - ery} L ${x + erx} ${ey - ery + 1.5} L ${x + erx} ${ey - ery - 2} L ${x - erx} ${ey - ery - 2} Z" fill="${skin}"/>`;
    return `${svg}</g>`;
  };
  return one(cx - dx, 1) + one(cx + dx, -1);
}

function browsSvg(index: number, color: string, cx: number): string {
  const by = 73;
  const dx = 14;
  // [half-length, stroke, y-offset, arch(+)/angle spec]
  const stroke = shade(color, -0.2);
  const one = (x: number, m: number): string => {
    switch (index) {
      case 1: return `<path d="M ${x - 6 * m} ${by + 1} Q ${x} ${by - 4} ${x + 6 * m} ${by + 1}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>`; // Arched
      case 2: return `<path d="M ${x - 6.5 * m} ${by} L ${x + 6.5 * m} ${by}" fill="none" stroke="${stroke}" stroke-width="3.6" stroke-linecap="round"/>`; // Thick
      case 3: return `<path d="M ${x - 6 * m} ${by} L ${x + 6 * m} ${by}" fill="none" stroke="${stroke}" stroke-width="1.2" stroke-linecap="round"/>`; // Thin
      case 4: return `<path d="M ${x - 6 * m} ${by - 2} L ${x + 6 * m} ${by + 2}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round"/>`; // Angled
      case 5: return `<path d="M ${x - 6 * m} ${by + 2} L ${x + 6 * m} ${by - 2}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round"/>`; // Worried
      case 6: return `<path d="M ${x - 6 * m} ${by - 2} Q ${x} ${by - 7} ${x + 6 * m} ${by - 2}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>`; // Raised
      case 7: return `<path d="M ${x - 7 * m} ${by + 0.5} Q ${x} ${by - 3.5} ${x + 7 * m} ${by + 0.5}" fill="none" stroke="${stroke}" stroke-width="4.2" stroke-linecap="round"/>`; // Bold
      default: return `<path d="M ${x - 6 * m} ${by} L ${x + 6 * m} ${by}" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round"/>`; // Straight
    }
  };
  // Inner ends face the nose: mirror by drawing outer→inner on each side.
  return one(cx - 14, 1) + one(cx + 14, -1);
}

function noseSvg(index: number, line: string, cx: number): string {
  const s = (d: string, w = 2): string =>
    `<path d="${d}" fill="none" stroke="${line}" stroke-width="${w}" stroke-linecap="round"/>`;
  switch (index) {
    case 1: return s(`M ${cx - 1} 88 L ${cx - 1} 99 Q ${cx} 102 ${cx + 4} 99`); // Straight
    case 2: return s(`M ${cx - 6} 99 Q ${cx} 105 ${cx + 6} 99`, 2.4); // Wide
    case 3: return s(`M ${cx} 88 L ${cx + 3.5} 100 L ${cx - 2} 100`); // Pointed
    case 4: return s(`M ${cx - 4.5} 97 A 4.5 4.5 0 1 0 ${cx + 4.5} 97`); // Round
    case 5: return s(`M ${cx - 1} 87 Q ${cx + 5} 93 ${cx + 1} 100 Q ${cx} 101 ${cx - 2} 100`); // Aquiline
    case 6: return s(`M ${cx - 1} 90 L ${cx - 1} 98 L ${cx + 3} 96`); // Upturned
    case 7: return s(`M ${cx - 7} 98 Q ${cx} 106 ${cx + 7} 98`, 3); // Broad
    default: return s(`M ${cx - 3} 98 Q ${cx} 101 ${cx + 3} 98`, 2.2); // Button
  }
}

function mouthSvg(index: number, line: string, cx: number): string {
  const my = 112;
  const lip = "#a84a50";
  const s = (d: string, w = 2.4): string =>
    `<path d="${d}" fill="none" stroke="${line}" stroke-width="${w}" stroke-linecap="round"/>`;
  switch (index) {
    case 1: // Grin
      return `<path d="M ${cx - 11} ${my - 1} Q ${cx} ${my + 11} ${cx + 11} ${my - 1} Z" fill="#7d2f34"/><path d="M ${cx - 8} ${my} Q ${cx} ${my + 4} ${cx + 8} ${my} L ${cx + 8} ${my - 0.5} L ${cx - 8} ${my - 0.5} Z" fill="#f6f4ef"/>`;
    case 2: return s(`M ${cx - 8} ${my} L ${cx + 8} ${my}`); // Neutral
    case 3: return s(`M ${cx - 8} ${my + 1} Q ${cx + 2} ${my + 4} ${cx + 9} ${my - 3}`); // Smirk
    case 4: return s(`M ${cx - 9} ${my + 3} Q ${cx} ${my - 4} ${cx + 9} ${my + 3}`); // Frown
    case 5: return `<ellipse cx="${cx}" cy="${my + 1}" rx="5.5" ry="7" fill="#7d2f34"/>`; // Open
    case 6: // Laugh
      return `<path d="M ${cx - 12} ${my - 2} Q ${cx} ${my + 16} ${cx + 12} ${my - 2} Z" fill="#7d2f34"/><path d="M ${cx - 9} ${my - 1} L ${cx + 9} ${my - 1} L ${cx + 7} ${my + 2} L ${cx - 7} ${my + 2} Z" fill="#f6f4ef"/>`;
    case 7: return `<ellipse cx="${cx}" cy="${my - 1}" rx="5" ry="2.6" fill="${lip}"/><ellipse cx="${cx}" cy="${my + 2.4}" rx="4" ry="2.2" fill="${shade(lip, -0.2)}"/>`; // Pout
    case 8: return `<circle cx="${cx}" cy="${my}" r="3.2" fill="none" stroke="${line}" stroke-width="2"/>`; // Whistle
    case 9: return s(`M ${cx - 6} ${my} L ${cx + 6} ${my}`, 3.4); // Serious
    default: return s(`M ${cx - 9} ${my - 2} Q ${cx} ${my + 6} ${cx + 9} ${my - 2}`); // Smile
  }
}

function facialHairSvg(index: number, rx: number, color: string, cx: number, cy: number): string {
  const jaw = (yTop: number, yBot: number, fill: string, opacity = 1): string =>
    `<path d="M ${cx - rx} ${cy + 4} Q ${cx - rx} ${yBot} ${cx} ${yBot} Q ${cx + rx} ${yBot} ${cx + rx} ${cy + 4} L ${cx + rx} ${yTop} Q ${cx} ${yTop + 14} ${cx - rx} ${yTop} Z" fill="${fill}" opacity="${opacity}"/>`;
  const mus = (w: number, curl = false): string =>
    `<path d="M ${cx - w} 108 Q ${cx} 102 ${cx + w} 108 Q ${cx} 106.5 ${cx - w} 108 Z" fill="${color}"/>` +
    (curl
      ? `<path d="M ${cx - w} 108 Q ${cx - w - 4} 108 ${cx - w - 3} 103 M ${cx + w} 108 Q ${cx + w + 4} 108 ${cx + w + 3} 103" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`
      : "");
  switch (index) {
    case 1: return jaw(98, 132, color, 0.22); // Stubble
    case 2: return mus(9); // Mustache
    case 3: return `<path d="M ${cx - 7} 118 Q ${cx} 115 ${cx + 7} 118 Q ${cx + 7} 130 ${cx} 131 Q ${cx - 7} 130 ${cx - 7} 118 Z" fill="${color}"/>${mus(7)}`; // Goatee
    case 4: // Chin strap
      return `<path d="M ${cx - rx} ${cy + 2} Q ${cx - rx} 130 ${cx} 130 Q ${cx + rx} 130 ${cx + rx} ${cy + 2} L ${cx + rx - 4} ${cy + 2} Q ${cx + rx - 4} 125 ${cx} 125 Q ${cx - rx + 4} 125 ${cx - rx + 4} ${cy + 2} Z" fill="${color}"/>`;
    case 5: return jaw(102, 134, color) + mus(9); // Full beard
    case 6: return jaw(100, 148, color) + mus(10); // Big beard
    case 7: return mus(10, true); // Handlebar
    case 8: return `<rect x="${cx - 3}" y="118" width="6" height="4" rx="2" fill="${color}"/>`; // Soul patch
    case 9: // Mutton chops
      return `<path d="M ${cx - rx} ${cy - 2} L ${cx - rx} 122 Q ${cx - rx + 10} 124 ${cx - rx + 12} 112 L ${cx - rx + 8} ${cy - 2} Z" fill="${color}"/><path d="M ${cx + rx} ${cy - 2} L ${cx + rx} 122 Q ${cx + rx - 10} 124 ${cx + rx - 12} 112 L ${cx + rx - 8} ${cy - 2} Z" fill="${color}"/>`;
    default: return "";
  }
}

function glassesSvg(index: number, cx: number): string {
  const gy = 84;
  const dx = 14;
  const frame = "#20242c";
  const bridge = (w = 1.8): string => `<path d="M ${cx - 5} ${gy - 1} Q ${cx} ${gy - 4} ${cx + 5} ${gy - 1}" fill="none" stroke="${frame}" stroke-width="${w}"/>`;
  const temples = `<path d="M ${cx - dx - 9} ${gy - 1} L ${cx - 33} ${gy - 3} M ${cx + dx + 9} ${gy - 1} L ${cx + 33} ${gy - 3}" stroke="${frame}" stroke-width="1.6"/>`;
  switch (index) {
    case 1: return `<circle cx="${cx - dx}" cy="${gy}" r="8.5" fill="none" stroke="${frame}" stroke-width="2"/><circle cx="${cx + dx}" cy="${gy}" r="8.5" fill="none" stroke="${frame}" stroke-width="2"/>${bridge()}${temples}`;
    case 2: return `<rect x="${cx - dx - 8.5}" y="${gy - 7}" width="17" height="14" rx="2.5" fill="none" stroke="${frame}" stroke-width="2"/><rect x="${cx + dx - 8.5}" y="${gy - 7}" width="17" height="14" rx="2.5" fill="none" stroke="${frame}" stroke-width="2"/>${bridge()}${temples}`;
    case 3: // Aviator
      return `<path d="M ${cx - dx - 9} ${gy - 6} L ${cx - dx + 9} ${gy - 6} Q ${cx - dx + 8} ${gy + 8} ${cx - dx} ${gy + 8} Q ${cx - dx - 9} ${gy + 7} ${cx - dx - 9} ${gy - 6} Z" fill="#8a94a6" opacity="0.35" stroke="#c9a227" stroke-width="1.6"/><path d="M ${cx + dx + 9} ${gy - 6} L ${cx + dx - 9} ${gy - 6} Q ${cx + dx - 8} ${gy + 8} ${cx + dx} ${gy + 8} Q ${cx + dx + 9} ${gy + 7} ${cx + dx + 9} ${gy - 6} Z" fill="#8a94a6" opacity="0.35" stroke="#c9a227" stroke-width="1.6"/>${bridge(1.4)}${temples}`;
    case 4: // Cat-eye
      return `<path d="M ${cx - dx - 10} ${gy - 6} Q ${cx - dx} ${gy - 8} ${cx - dx + 8} ${gy - 4} Q ${cx - dx + 8} ${gy + 6} ${cx - dx} ${gy + 6} Q ${cx - dx - 8} ${gy + 6} ${cx - dx - 10} ${gy - 6} Z" fill="none" stroke="${frame}" stroke-width="2.2"/><path d="M ${cx + dx + 10} ${gy - 6} Q ${cx + dx} ${gy - 8} ${cx + dx - 8} ${gy - 4} Q ${cx + dx - 8} ${gy + 6} ${cx + dx} ${gy + 6} Q ${cx + dx + 8} ${gy + 6} ${cx + dx + 10} ${gy - 6} Z" fill="none" stroke="${frame}" stroke-width="2.2"/>${bridge()}${temples}`;
    case 5: // Rimless
      return `<rect x="${cx - dx - 8}" y="${gy - 6}" width="16" height="12" rx="3" fill="#c9d4e6" opacity="0.18"/><rect x="${cx + dx - 8}" y="${gy - 6}" width="16" height="12" rx="3" fill="#c9d4e6" opacity="0.18"/>${bridge(1.2)}${temples}`;
    case 6: // Sunglasses
      return `<rect x="${cx - dx - 9}" y="${gy - 6.5}" width="18" height="13" rx="4" fill="#101014"/><rect x="${cx + dx - 9}" y="${gy - 6.5}" width="18" height="13" rx="4" fill="#101014"/><circle cx="${cx - dx - 3}" cy="${gy - 2}" r="1.6" fill="#3a3f47"/><circle cx="${cx + dx - 3}" cy="${gy - 2}" r="1.6" fill="#3a3f47"/>${bridge(2.2)}${temples}`;
    case 7: // Sport visor
      return `<path d="M ${cx - 30} ${gy - 7} Q ${cx} ${gy - 12} ${cx + 30} ${gy - 7} L ${cx + 26} ${gy + 6} Q ${cx} ${gy + 11} ${cx - 26} ${gy + 6} Z" fill="#101014" opacity="0.85"/><path d="M ${cx - 26} ${gy - 4} Q ${cx} ${gy - 8} ${cx + 26} ${gy - 4}" fill="none" stroke="${ACCENT}" stroke-width="1.6" opacity="0.8"/>`;
    default: return "";
  }
}

function accessorySvg(index: number, rx: number, cx: number, cy: number, hair: string, outfit: string): string {
  const earY = cy + 6;
  switch (index) {
    case 1: return `<circle cx="${cx - rx - 1}" cy="${earY}" r="2" fill="#e8c547"/><circle cx="${cx + rx + 1}" cy="${earY}" r="2" fill="#e8c547"/>`; // Studs
    case 2: return `<circle cx="${cx - rx - 1}" cy="${earY + 7}" r="4.5" fill="none" stroke="#e8c547" stroke-width="1.8"/><circle cx="${cx + rx + 1}" cy="${earY + 7}" r="4.5" fill="none" stroke="#e8c547" stroke-width="1.8"/>`; // Hoops
    case 3: // Headphones
      return `<path d="M ${cx - rx - 6} ${cy} Q ${cx} ${cy - 62} ${cx + rx + 6} ${cy}" fill="none" stroke="#22262c" stroke-width="5"/><rect x="${cx - rx - 10}" y="${cy - 6}" width="9" height="18" rx="4" fill="#22262c"/><rect x="${cx + rx + 1}" y="${cy - 6}" width="9" height="18" rx="4" fill="#22262c"/><circle cx="${cx - rx - 5.5}" cy="${cy + 3}" r="2" fill="${ACCENT}"/><circle cx="${cx + rx + 5.5}" cy="${cy + 3}" r="2" fill="${ACCENT}"/>`;
    case 4: // Ball cap
      return `<path d="${cap(rx, 62, 1.12)} Z" fill="#2e333b"/><path d="M ${cx - rx - 4} 62 L ${cx + 6} 62 L ${cx + 14} 70 L ${cx - rx - 8} 70 Z" fill="#22262c"/><circle cx="${cx}" cy="44" r="3" fill="${ACCENT}"/>`;
    case 5: // Beanie
      return `<path d="${cap(rx, 68, 1.14)} Z" fill="${ACCENT}"/><rect x="${cx - rx - 6}" y="62" width="${(rx + 6) * 2}" height="9" rx="4" fill="${shade(ACCENT, -0.35)}"/>`;
    case 6: return `<rect x="${cx - rx - 3}" y="60" width="${(rx + 3) * 2}" height="7" rx="3.5" fill="${ACCENT}"/>`; // Headband
    case 7: return `<circle cx="${cx + 5}" cy="101" r="2" fill="none" stroke="#e8c547" stroke-width="1.4"/>`; // Nose ring
    case 8: return `<path d="M ${cx - 13} 138 Q ${cx} 150 ${cx + 13} 138" fill="none" stroke="#e8c547" stroke-width="1.8"/><circle cx="${cx}" cy="149" r="3" fill="${ACCENT}"/>`; // Necklace
    case 9: return `<path d="M ${cx - 17} 132 Q ${cx} 146 ${cx + 17} 132 L ${cx + 15} 144 Q ${cx} 156 ${cx - 15} 144 Z" fill="${shade(outfit, 0.25)}"/><rect x="${cx + 4}" y="146" width="9" height="22" rx="3" fill="${shade(outfit, 0.25)}"/>`; // Scarf
    case 10: // Freckles
      return [-1, 1].map((m) => [0, 1, 2].map((i) => `<circle cx="${cx + m * (18 + i * 4)}" cy="${cy + 12 + (i % 2) * 3}" r="1.1" fill="${shade(hair, -0.1)}" opacity="0.5"/>`).join("")).join("");
    case 11: return `<ellipse cx="${cx - 19}" cy="${cy + 14}" rx="6" ry="3.5" fill="#e8748c" opacity="0.35"/><ellipse cx="${cx + 19}" cy="${cy + 14}" rx="6" ry="3.5" fill="#e8748c" opacity="0.35"/>`; // Blush
    default: return "";
  }
}
