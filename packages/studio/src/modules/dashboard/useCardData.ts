/**
 * @file `useCardData(cardId)` — the ONE seam between the card screen and its
 * data.
 *
 * The seam survives from the pre-strip dashboard (MASTER §4.3) but the data
 * behind it is REAL now. The old module replicated GizmoX's twelve cards over a
 * seed file that described a different application — its VPS, its web server,
 * its sandbox files. The rebuild keeps only cards with a live source in THIS
 * tree, plus the welcome card, whose "data" is copy, not rows:
 *
 *   - `welcome`      — seed copy (title, tagline, chips). Text, not data.
 *   - `quick-launch` — tiles derived from the STUDIO NAV asset. The nav's own
 *     rule ("a row that navigates nowhere is not a row") is what makes every
 *     tile live by construction — no seed faces, no inert tiles.
 *   - `modules`      — the live module registry, plus the suite cap.
 *   - `theme`        — the live theme store + the resolved pack identity.
 *   - `packs`        — the live pack registry and its active selections.
 *   - `clock`        — the system, ticking; null until the first client tick so
 *     the server render and the first client paint agree.
 *
 * Wiring a card to a richer source later changes that card's arm of this hook —
 * never the card component.
 */
"use client";

import * as React from "react";

import { packs as packRegistry, registry, useResolvedStyle, useTheme } from "@axf/core";
import type { ResolvedStyle, ThemeState } from "@axf/core";

import { SUITE_MODULE_CAP } from "../../suite.manifest";
import { STUDIO_NAV } from "../../nav/studio-nav";
import seedJson from "./seed/dashboard-seed.json";
import type { CardConfig } from "./types";

/* ------------------------------------------------------------ seed typing */

export interface WelcomeChip {
  id: string;
  label: string;
  tone: string;
}
export interface WelcomeData {
  titleLead: string;
  titleAccent: string;
  tagline: string;
  chips: WelcomeChip[];
}

interface DashboardSeed {
  authoredAt: string;
  cards: CardConfig[];
  welcome: WelcomeData;
}

const SEED = seedJson as unknown as DashboardSeed;

/** The default card configs — the seed's arrangement. The screen resets to
 *  this. */
export const SEED_CARDS: readonly CardConfig[] = SEED.cards;

/* ------------------------------------------------------------- data map */

export interface QuickLaunchTile {
  id: string;
  label: string;
  glyph: string;
  route: string;
}
export interface ModuleRow {
  id: string;
  title: string;
  route: string;
  glyph: string;
}

export interface CardDataMap {
  welcome: WelcomeData;
  /** Derived from the STUDIO NAV asset — every tile navigates, by the nav's
   *  own no-dead-rows rule. */
  "quick-launch": { tiles: QuickLaunchTile[] };
  /** LIVE — the module registry and the suite cap. */
  modules: { rows: ModuleRow[]; cap: number };
  /** LIVE — the theme store plus the resolved pack identity. */
  theme: { state: ThemeState; style: ResolvedStyle };
  /** LIVE — the pack registry: what is registered, what is active. */
  packs: { style: ResolvedStyle; counts: { branding: number; logos: number } };
  /** LIVE — ticking; `now` is null until the first client tick. */
  clock: { now: Date | null };
}

export type CardId = keyof CardDataMap;

/**
 * The one hook. Hooks run unconditionally (React's rule); the switch below
 * only decides which already-subscribed source a card reads.
 */
export function useCardData<K extends CardId>(cardId: K): CardDataMap[K] {
  // Live source 1: the theme store. One subscription shared by whichever cards
  // read it; for the rest it is a cheap snapshot read.
  const themeState = useTheme();

  // Live source 2: the pack registry, through the same hook every brand
  // surface uses — it also re-renders this hook when packs change, which is
  // what keeps the modules/packs cards honest after a swap.
  const style = useResolvedStyle();

  // Live source 3: the system clock. The interval only runs for the card that
  // asked for it — the id is stable per mounted card, so the effect's
  // condition never flips within one component's lifetime.
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    if (cardId !== "clock") return;
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [cardId]);

  switch (cardId) {
    case "welcome":
      return SEED.welcome as CardDataMap[K];
    case "quick-launch": {
      // The nav asset owns the destinations; the tiles are its link rows.
      // `/` is excluded because the dashboard IS `/` — a tile that navigates
      // to itself is the dead-row rule with extra steps.
      const tiles: QuickLaunchTile[] = [];
      for (const item of STUDIO_NAV.items) {
        if (item.kind !== "link" || item.route === "/") continue;
        tiles.push({ id: item.id, label: item.label, glyph: item.glyph, route: item.route });
      }
      return { tiles } as CardDataMap[K];
    }
    case "modules": {
      const rows: ModuleRow[] = registry
        .modules()
        .map((m) => ({ id: m.id, title: m.title, route: m.route, glyph: m.glyph ?? "icon-grid" }));
      return { rows, cap: SUITE_MODULE_CAP } as CardDataMap[K];
    }
    case "theme":
      return { state: themeState, style } as CardDataMap[K];
    case "packs":
      return {
        style,
        counts: {
          branding: packRegistry.packs("branding-package").length,
          logos: packRegistry.packs("logo-package").length
        }
      } as CardDataMap[K];
    case "clock":
      return { now } as CardDataMap[K];
  }
  // Exhaustive above; TypeScript narrows `cardId` to never here.
  throw new Error(`useCardData: unknown card "${String(cardId)}"`);
}
