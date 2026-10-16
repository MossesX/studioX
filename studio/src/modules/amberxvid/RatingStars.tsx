/**
 * @file The 0–10 star system's UI — one interactive strip, one passive badge,
 * one batch hook, all over `/api/amberxvid/ratings`.
 *
 * `RatingStars` is the vote control: ten stars, hover previews, click casts
 * (server-validated — no self-votes, integers only), the × chip withdraws to
 * zero. Ratings are visible, never anonymous (decision 2026-08-04), so the
 * tooltip names the crowd. `RatingBadge` renders a summary someone else
 * already fetched — lists use `useRatings` (one batched request per surface,
 * not one per row) and hand each row its badge.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Star as StarIcon } from "./kit/icons";
import { StarBorder as StarBorderIcon } from "./kit/icons";
import { Close as CloseIcon } from "./kit/icons";
import { GX } from "./kit/gx";
import { RATING_MAX, type RatingKind, type RatingSummary } from "./lib/types";

/* ---------------------------------- fetching ----------------------------------- */

export async function fetchRating(kind: RatingKind, target: string): Promise<RatingSummary | null> {
  try {
    const res = await fetch(`/api/amberxvid/ratings?kind=${kind}&target=${encodeURIComponent(target)}`);
    const json = (await res.json().catch(() => null)) as { ok?: boolean; rating?: RatingSummary } | null;
    return res.ok && json?.ok && json.rating ? json.rating : null;
  } catch {
    return null;
  }
}

export async function castRating(kind: RatingKind, target: string, stars: number): Promise<RatingSummary | null> {
  try {
    const res = await fetch("/api/amberxvid/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, target, stars }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; rating?: RatingSummary; error?: string } | null;
    if (!res.ok || !json?.ok || !json.rating) throw new Error(json?.error ?? `HTTP ${res.status}`);
    return json.rating;
  } catch {
    return null;
  }
}

/**
 * Batched summaries for a list surface — one request per target-set change.
 * Returns the map plus a `refresh` the surface can call after casting a vote.
 */
export function useRatings(kind: RatingKind, targets: string[]): {
  ratings: Record<string, RatingSummary>;
  refresh: () => void;
} {
  const [ratings, setRatings] = React.useState<Record<string, RatingSummary>>({});
  const [tick, setTick] = React.useState(0);
  const key = targets
    .map((t) => t.toLowerCase())
    .sort()
    .join(",");

  React.useEffect(() => {
    if (!key) {
      setRatings({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const q = kind === "user" ? `users=${encodeURIComponent(key)}` : `streams=${encodeURIComponent(key)}`;
        const res = await fetch(`/api/amberxvid/ratings?${q}`);
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; users?: RatingSummary[]; streams?: RatingSummary[] }
          | null;
        if (cancelled || !res.ok || !json?.ok) return;
        const list = (kind === "user" ? json.users : json.streams) ?? [];
        setRatings(Object.fromEntries(list.map((r) => [r.target, r])));
      } catch {
        /* rows fall back to no badge */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, key, tick]);

  return { ratings, refresh: () => setTick((t) => t + 1) };
}

/* ----------------------------------- badge ------------------------------------- */

/** "7.4 ★ · 3" — the passive average, or a dim "unrated". */
export function RatingBadge({ summary, size = 12 }: { summary?: RatingSummary | null; size?: number }) {
  if (!summary || summary.count === 0) {
    return (
      <Typography component="span" sx={{ fontSize: size - 1, color: GX.dim, fontFamily: GX.mono }}>
        unrated
      </Typography>
    );
  }
  const names = summary.entries.map((e) => `${e.rater}: ${e.stars}`).join(" · ");
  return (
    <Tooltip title={names}>
      <Typography
        component="span"
        sx={{ fontSize: size - 1, color: GX.warn, fontFamily: GX.mono, fontWeight: 700, whiteSpace: "nowrap" }}
      >
        {summary.average?.toFixed(1)} <StarIcon sx={{ fontSize: size, verticalAlign: "-2px" }} /> · {summary.count}
      </Typography>
    </Tooltip>
  );
}

/* ----------------------------------- stars ------------------------------------- */

/**
 * The interactive strip. Self-sufficient when given only `kind`+`target`
 * (fetches its own summary); a parent that already holds the summary can pass
 * it and listen on `onRated` to keep list badges honest.
 */
export function RatingStars({
  kind,
  target,
  summary: given,
  onRated,
  notify,
  size = 16,
  disabled = false,
}: {
  kind: RatingKind;
  target: string;
  summary?: RatingSummary | null;
  onRated?: (summary: RatingSummary) => void;
  notify?: (msg: string, detail?: string) => void;
  size?: number;
  disabled?: boolean;
}) {
  const [fetched, setFetched] = React.useState<RatingSummary | null>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const summary = given ?? fetched;

  React.useEffect(() => {
    if (given !== undefined) return;
    let cancelled = false;
    void fetchRating(kind, target).then((r) => {
      if (!cancelled) setFetched(r);
    });
    return () => {
      cancelled = true;
    };
  }, [given, kind, target]);

  const cast = async (stars: number): Promise<void> => {
    if (busy || disabled) return;
    setBusy(true);
    const result = await castRating(kind, target, stars);
    setBusy(false);
    if (!result) {
      notify?.("Rating failed", "the server refused the vote");
      return;
    }
    setFetched(result);
    onRated?.(result);
    notify?.(`Rated ${stars}/10`);
  };

  const mine = summary?.mine ?? null;
  const shown = hover ?? mine ?? 0;

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }} onMouseLeave={() => setHover(null)}>
      <Box sx={{ display: "inline-flex", alignItems: "center", opacity: disabled ? 0.45 : 1 }}>
        {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => {
          const Icon = n <= shown ? StarIcon : StarBorderIcon;
          return (
            // The brand-icon shim exposes onClick but not hover events — the
            // span owns the pointer contract, the glyph just draws.
            <Box
              key={n}
              component="span"
              data-rating-star={n}
              onMouseEnter={() => !disabled && setHover(n)}
              onClick={() => void cast(n)}
              sx={{ display: "inline-flex", cursor: disabled ? "default" : "pointer", lineHeight: 0 }}
            >
              <Icon sx={{ fontSize: size, color: n <= shown ? GX.warn : GX.dim, transition: "color .1s" }} />
            </Box>
          );
        })}
      </Box>
      {mine !== null && !disabled ? (
        <Tooltip title="rate 0/10 — the scale starts at zero">
          <CloseIcon onClick={() => void cast(0)} sx={{ fontSize: size - 3, color: GX.dim, cursor: "pointer" }} />
        </Tooltip>
      ) : null}
      <RatingBadge summary={summary} size={size - 3} />
    </Box>
  );
}
