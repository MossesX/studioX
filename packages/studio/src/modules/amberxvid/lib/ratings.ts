/**
 * @file AmberX Vid ratings store — 0–10 stars on members AND on streams.
 *
 * One JSON per target under `<root>/ratings/`: `user--<username>.json`,
 * `stream--<id>.json`. Each holds every rater's current vote — one entry per
 * rater, updatable in place, visible to everyone (decision 2026-08-04: a
 * small private suite rates in the open, no anonymity to moderate).
 *
 * House store posture (same as `accounts.ts`): atomic writes, degrade never
 * crash (junk file → treated as empty), validation in the STORE so every
 * caller shares one truth: integer 0–10, no rating yourself, no rating your
 * own stream, raters and user-targets must be entered members. Stream
 * targets keep a `{host, title}` snapshot so a rating outlives the ephemeral
 * room it was cast in. Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { findAccount } from "./accounts";
import { ratingsDir } from "./paths";
import {
  RATING_MAX,
  RATING_MIN,
  type RatingEntry,
  type RatingKind,
  type RatingSummary,
} from "./types";

interface RatingsFile {
  version: 1;
  kind: RatingKind;
  target: string;
  context?: { host: string; title: string };
  entries: RatingEntry[];
}

export type RatingResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

const fail = (error: string, status: number): { ok: false; error: string; status: number } => ({
  ok: false,
  error,
  status,
});

const norm = (u: string): string => u.trim().toLowerCase();

/** Stream ids are uuids and usernames are account-validated, but the value
 *  still lands in a filename — same guard idea as the messages store. */
const TARGET_RE = /^[a-z0-9._-]{1,64}$/;

const fileFor = (kind: RatingKind, target: string): string =>
  path.join(ratingsDir(), `${kind}--${norm(target)}.json`);

function readFile(kind: RatingKind, target: string): RatingsFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(fileFor(kind, target), "utf8")) as RatingsFile;
    if (raw?.version !== 1 || !Array.isArray(raw.entries)) return null;
    return raw;
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, value: RatingsFile): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tmp, file);
}

function summarize(kind: RatingKind, target: string, doc: RatingsFile | null, viewer?: string): RatingSummary {
  const entries = doc?.entries ?? [];
  const count = entries.length;
  const average = count === 0 ? null : Math.round((entries.reduce((a, e) => a + e.stars, 0) / count) * 10) / 10;
  const mine = viewer ? (entries.find((e) => norm(e.rater) === norm(viewer))?.stars ?? null) : null;
  return { kind, target: norm(target), average, count, mine, entries, context: doc?.context };
}

/** One target's summary — `viewer` fills in `mine`. */
export function ratingSummary(kind: RatingKind, target: string, viewer?: string): RatingSummary {
  if (!TARGET_RE.test(norm(target))) return summarize(kind, "invalid", null, viewer);
  return summarize(kind, target, readFile(kind, target), viewer);
}

/** Batch summaries — one call fills a member list or a streams grid. */
export function ratingSummaries(kind: RatingKind, targets: string[], viewer?: string): RatingSummary[] {
  return targets.slice(0, 100).map((t) => ratingSummary(kind, t, viewer));
}

/**
 * Cast (or update) a vote. `streamContext` must come from the LIVE stream
 * registry when kind is `stream` — its presence is the proof the stream is
 * real and current, and its `host` is who self-rating is checked against.
 */
export async function rateTarget(
  rater: string,
  kind: RatingKind,
  target: string,
  starsRaw: unknown,
  streamContext?: { host: string; title: string },
): Promise<RatingResult<RatingSummary>> {
  const stars = typeof starsRaw === "number" ? starsRaw : Number.NaN;
  if (!Number.isInteger(stars) || stars < RATING_MIN || stars > RATING_MAX) {
    return fail(`stars must be an integer ${RATING_MIN}-${RATING_MAX}`, 400);
  }
  if (!TARGET_RE.test(norm(target))) return fail("malformed target", 400);

  let context: { host: string; title: string } | undefined;
  if (kind === "user") {
    if (norm(target) === norm(rater)) return fail("you can't rate yourself", 400);
    const account = await findAccount(target);
    if (!account || account.disabled === true || account.screenname === null) {
      return fail("no such member", 404);
    }
  } else {
    // A stream is ratable while it is live (context supplied by the route
    // from the registry) or after, once anyone rated it live (file exists).
    const existing = readFile(kind, target);
    if (!streamContext && !existing) return fail("no such stream", 404);
    context = streamContext ?? existing?.context;
    if (context && norm(context.host) === norm(rater)) return fail("you can't rate your own stream", 400);
  }

  const doc: RatingsFile = readFile(kind, target) ?? { version: 1, kind, target: norm(target), entries: [] };
  if (context) doc.context = context;
  const entry: RatingEntry = { rater, stars, updatedAt: new Date().toISOString() };
  const ix = doc.entries.findIndex((e) => norm(e.rater) === norm(rater));
  if (ix >= 0) doc.entries[ix] = entry;
  else doc.entries.push(entry);

  await writeAtomic(fileFor(kind, target), doc);
  return { ok: true, value: summarize(kind, target, doc, rater) };
}
