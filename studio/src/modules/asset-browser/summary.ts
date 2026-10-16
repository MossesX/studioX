"use client";

/**
 * @file What a card says about an asset in WORDS, under its live preview.
 *
 * `AssetPreview` (P5) draws each kind through its real renderer — a logo kit
 * through `LogoKitLogo`, a bar through core's `Toolbar` — because a preview
 * that is a picture of a logo cannot show that the logo animates. That drawing
 * landed ABOVE these facts rather than instead of them, which was the plan
 * while this file was the whole card face and is still the right split: a
 * drawing says which asset you are looking at, and it cannot say that a kit
 * holds nine animated logos of ten, or which surface a bar declares.
 *
 * So a card carries FACTS read off the asset itself — how many logos, how many
 * items, which surface, which route. Those are the things a person browsing a
 * catalog is actually looking for, and no renderer shows them.
 *
 * Every read is defensive. `AssetCard.raw` is typed `unknown` on purpose (the
 * contract), and a manifest half-written by an interrupted generator is exactly
 * the input a browser meets. A fact that cannot be read is omitted; nothing
 * here throws and nothing here guesses.
 */

import type { AssetCard } from "../../asset-browser/contract";

/** One `label: value` pair on a card. */
export interface Fact {
  readonly label: string;
  readonly value: string;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * The facts for one card, in the order they should be read.
 *
 * Kept to at most four: a card that lists everything is a card nobody scans,
 * and the detail pane is where the rest lives.
 */
export function factsFor(card: AssetCard): Fact[] {
  const raw = rec(card.raw);
  const out: Fact[] = [];

  switch (card.kind) {
    case "logo_kit": {
      const logos = arr(raw.logos).map(rec);
      const animated = logos.filter((l) => l.kind === "animated").length;
      out.push({ label: "Logos", value: plural(logos.length, "logo") });
      if (logos.length > 0) out.push({ label: "Animated", value: `${animated} of ${logos.length}` });
      const motions = new Set(logos.map((l) => str(l.motion)).filter(Boolean));
      if (motions.size > 0) out.push({ label: "Motions", value: plural(motions.size, "motion") });
      break;
    }

    case "x_landing": {
      const route = str(raw.route);
      if (route) out.push({ label: "Route", value: route });
      const role = str(raw.role);
      if (role) out.push({ label: "Role", value: role });
      const logo = str(rec(raw.assets).logo);
      if (logo) out.push({ label: "Logo", value: logo });
      const opacity = raw.cardOpacity;
      if (typeof opacity === "number") {
        out.push({ label: "Card opacity", value: `${Math.round(opacity * 100)}%` });
      }
      break;
    }

    case "branding-package": {
      const entries = arr(rec(raw.payload).entries).map(rec);
      out.push({ label: "Drawings", value: plural(entries.length, "drawing") });
      const animated = entries.filter((e) => e.animated === true).length;
      if (animated > 0) out.push({ label: "Animated", value: `${animated} of ${entries.length}` });
      const categories = new Set(entries.map((e) => str(e.category)).filter(Boolean));
      if (categories.size > 0) out.push({ label: "Categories", value: String(categories.size) });
      const palette = Object.keys(rec(rec(raw.payload).palette));
      if (palette.length > 0) out.push({ label: "Palette", value: plural(palette.length, "role") });
      break;
    }

    case "logo-package": {
      const payload = rec(raw.payload);
      const document = str(payload.document);
      if (document) out.push({ label: "Document", value: document });
      out.push({ label: "Variants", value: plural(arr(payload.variants).length, "variant") });
      const files = arr(payload.files).length;
      const inline = arr(payload.entries).length;
      // A pack ships EITHER files or inline SVG — saying which is the fact that
      // decides whether it renders without a filesystem.
      if (files > 0) out.push({ label: "Files", value: plural(files, "file") });
      if (inline > 0) out.push({ label: "Inline", value: plural(inline, "drawing") });
      break;
    }

    case "toolbar": {
      const role = str(raw.role);
      if (role) out.push({ label: "Role", value: role });
      const surface = str(raw.surface);
      if (surface) out.push({ label: "Surface", value: surface });
      const items = arr(raw.items).map(rec);
      out.push({ label: "Items", value: plural(items.length, "item") });
      const actions = items.filter((i) => i.kind === "action" || i.kind === "menu").length;
      if (actions > 0) out.push({ label: "Actions", value: String(actions) });
      break;
    }

    case "nav-menu": {
      const surface = str(raw.surface);
      if (surface) out.push({ label: "Surface", value: surface });
      const items = arr(raw.items).map(rec);
      const links = items.filter((i) => i.kind === "link").length;
      const sections = items.filter((i) => i.kind === "section").length;
      out.push({ label: "Links", value: plural(links, "destination") });
      if (sections > 0) out.push({ label: "Sections", value: String(sections) });
      break;
    }

    case "dashboard": {
      // A wrapper is a render function — there is nothing countable on it, and
      // inventing a number here would be inventing a fact. Its description is
      // the whole of what it says about itself, and the card already shows it.
      break;
    }

    default:
      break;
  }

  return out.slice(0, 4);
}
