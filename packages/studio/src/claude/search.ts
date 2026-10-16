/**
 * @file Full-text search across message bodies — the matcher, as a pure
 * function. `axf-claude` P3: *"full-text search across message bodies"*.
 *
 * Separate from `./service` and from the route on purpose: this is the only
 * part of search that can be WRONG in an interesting way, and it is the part
 * with no filesystem, no request and no clock in it. The service loads records
 * and this decides what a hit is.
 *
 * **Isomorphic** — no node imports. The library pane runs the same matcher over
 * a record it already has in hand (an open conversation, filtered live as you
 * type) rather than round-tripping to the server for a body it is holding, and
 * a second implementation there would be a second definition of "matches".
 *
 * ── what a query means, and why it is not a regex ────────────────────────────
 *
 * A query is TERMS, split on whitespace, and every term must appear (AND),
 * case-insensitively, as a substring. `"quoted phrases"` are one term. That is
 * it — no operators, no fuzzy matching, no stemming.
 *
 * Three things ruled out and why, so nobody re-proposes them cheaply:
 *
 *   - **A user-supplied regex** is a denial of service against the server that
 *     runs it (catastrophic backtracking is one `(a+)+$` away), and the library
 *     is searched on every keystroke.
 *   - **Ranking by relevance** implies a scoring function nobody can explain
 *     when it puts the wrong conversation first. Ordering is by RECENCY, which
 *     is the order the library already shows and therefore the order the reader
 *     is expecting; pinned conversations lead, as everywhere else.
 *   - **An index** is a second copy of the corpus that goes stale. A linear
 *     scan over some hundreds of JSON documents is milliseconds, and when it
 *     stops being, an index can be added behind this exact signature.
 */
import type { ConversationRecord, SearchHit, SearchMatch } from "./types";
import { toMeta } from "./types";

/** Characters either side of a match in an excerpt. */
const EXCERPT_PAD = 90;
/** Matches reported per message. Beyond this the count still tells the truth. */
const MAX_RANGES_PER_MESSAGE = 8;
/** Messages reported per conversation, newest-in-transcript-order first. */
export const MAX_MATCHES_PER_CONVERSATION = 6;

/**
 * Split a raw query into terms. `"a phrase"` stays whole; everything else
 * splits on whitespace. Empty and whitespace-only queries produce no terms,
 * which callers read as "not a search" rather than as "matches nothing".
 */
export function parseQuery(query: string): string[] {
  const terms: string[] = [];
  for (const m of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = (m[1] ?? m[2] ?? "").trim().toLowerCase();
    if (term) terms.push(term);
  }
  return terms;
}

/** Every `[start, end)` of `term` in `haystack`, already lowercased by the
 *  caller so a long body is lowercased once rather than once per term. */
function rangesOf(lowerHaystack: string, term: string): [number, number][] {
  const out: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = lowerHaystack.indexOf(term, from);
    if (at < 0) return out;
    out.push([at, at + term.length]);
    from = at + term.length;
    if (out.length >= MAX_RANGES_PER_MESSAGE * 4) return out; // pathological input
  }
}

/** Merge overlapping/adjacent ranges so a renderer never nests two marks. */
function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * A window of `text` around the first match, with the ranges rebased into it.
 *
 * The window is trimmed to whole-ish words at both ends and marked with an
 * ellipsis where it was cut, so an excerpt reads as an excerpt rather than as a
 * message that starts mid-word.
 */
function excerptAround(
  text: string,
  ranges: [number, number][]
): { excerpt: string; ranges: [number, number][] } {
  const first = ranges[0]!;
  let start = Math.max(0, first[0] - EXCERPT_PAD);
  let end = Math.min(text.length, first[1] + EXCERPT_PAD);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < first[0]) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > first[1]) end = space;
  }
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  const shift = head.length - start;
  const inWindow = ranges
    .filter(([s, e]) => s >= start && e <= end)
    .slice(0, MAX_RANGES_PER_MESSAGE)
    .map(([s, e]) => [s + shift, e + shift] as [number, number]);
  return {
    excerpt: `${head}${text.slice(start, end).replace(/\s*\n\s*/g, " ")}${tail}`,
    ranges: inWindow
  };
}

/** Does every term appear in `lower`? The AND rule, in one place. */
export function matchesAll(lower: string, terms: readonly string[]): boolean {
  return terms.every((term) => lower.includes(term));
}

/**
 * Search one record. Returns null when it does not match at all, so a caller
 * filters with `.filter(Boolean)` rather than checking a count — the two are
 * the same fact and one of them is easier to get wrong.
 *
 * A message matches when it contains EVERY term; the conversation matches when
 * its title does, or when any single message does. Terms spread across two
 * different messages deliberately do NOT match: "the words are both in here
 * somewhere" is a claim about a transcript nobody can act on.
 */
export function searchRecord(record: ConversationRecord, terms: readonly string[]): SearchHit | null {
  if (!terms.length) return null;
  const titleMatched = matchesAll(record.title.toLowerCase(), terms);

  const matches: SearchMatch[] = [];
  let matchCount = 0;
  // Newest first: in a long transcript the recent turns are what the reader is
  // looking for, and the cap below would otherwise spend itself on the opening.
  for (let i = record.messages.length - 1; i >= 0; i--) {
    const message = record.messages[i]!;
    const lower = message.text.toLowerCase();
    if (!matchesAll(lower, terms)) continue;
    matchCount++;
    if (matches.length >= MAX_MATCHES_PER_CONVERSATION) continue;
    const ranges = mergeRanges(terms.flatMap((term) => rangesOf(lower, term)));
    if (!ranges.length) continue; // unreachable while matchesAll holds; cheap to be sure
    const window = excerptAround(message.text, ranges);
    matches.push({
      index: i,
      role: message.role,
      at: message.at,
      excerpt: window.excerpt,
      ranges: window.ranges
    });
  }

  if (!titleMatched && !matchCount) return null;
  return { meta: toMeta(record), titleMatched, matches, matchCount };
}

/**
 * Order hits the way the library orders everything: pinned first, then by most
 * recent activity. Stated once, here, because a search result list that sorts
 * differently from the list it replaces makes the reader re-find their place.
 */
export function orderHits(hits: readonly SearchHit[]): SearchHit[] {
  return [...hits].sort(
    (a, b) =>
      Number(b.meta.pinned) - Number(a.meta.pinned) ||
      b.meta.updatedAt.localeCompare(a.meta.updatedAt)
  );
}
