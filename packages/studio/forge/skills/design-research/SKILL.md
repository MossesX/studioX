---
name: design-research
description: >
  Hunt live design references and prior art on the web, rank them by real quality, extract the
  principle rather than the picture, and report what was pulled and from where. Use when asked
  for references, inspiration, prior art, "what do the best ones do", a competitor/category
  scan, a trend check, or when a design decision needs evidence behind it.
allowed-tools: WebSearch, WebFetch, Read, Write, Glob, Grep
---

# Hunting references properly

Designing from memory means designing from whatever you happened to see last. This skill is the
opposite: go look, rank what you found, take the *principle*, and say where it came from.

## 1. Frame the hunt before searching

Write down three things first, or the search returns mush:

- **The category** — what kind of thing is this (fintech wordmark, developer-tool monogram,
  festival emblem, hardware brand)? Category convention is a real constraint; breaking it is a
  decision, not an accident.
- **The constraint** — where does it have to work? favicon-first, print one-ink, animated
  header, embroidered? That single answer eliminates most references immediately.
- **The question** — "how do the best X handle Y". Not "logo inspiration". A hunt without a
  question returns a mood board, and a mood board answers nothing.

## 2. Where to hunt, in priority order

| Tier | Sources | What you get |
| --- | --- | --- |
| 1 — primary | official **brand guideline** pages and press/brand kits (`brand.<company>.com`, `<company>.com/press`, `/brand`) | the actual rules, clear space, palette hexes, minimum sizes — the real thing, from the owner |
| 1 — archives | Logobook, LogoArchive, Identity Designed, BP&O, the design museum / archive collections | curated marks with the reasoning attached |
| 2 — awards | D&AD, Type Directors Club, Red Dot, Communication Arts, Awwwards (motion) | juried work; quality floor is high, dates are known |
| 2 — foundries | Klim, Commercial Type, Grilli, Dinamo, Google Fonts specimens | real typeface behaviour, weights, licensing, x-height data |
| 3 — motion | Awwwards / motion reels, Lottie/SVG animation galleries, studio case studies | timing and easing conventions, and whether an effect is even fashionable or already dead |
| 4 — noise | Pinterest, generic "top 50 logos" listicles, AI-generated galleries | last resort. Undated, unattributed, often re-drawn or fake. Use only to *find a name*, then go to tier 1 for the real artefact |

Practical technique: search for the **brand guideline PDF or page** rather than the logo image
(`"<brand>" brand guidelines clear space minimum size`). Fetch the page and read the rules. One
real guideline is worth thirty gallery thumbnails.

## 3. Rank what you find — quality has tells

Score each reference on five axes before it earns a place in the report:

1. **Provenance** — do you know who made it and when? An undated, unattributed image is
   unusable evidence.
2. **Reduction** — does it survive at 16 px and in one ink? Check it; do not assume.
3. **System** — is there a visible system (grid, weight rule, palette roles) or just one lucky
   drawing?
4. **Longevity** — has it survived a redesign cycle, or is it three months old and trend-shaped?
5. **Relevance** — does it answer *your* question, or is it merely nice?

Anything scoring low on provenance is out regardless of how good it looks. Prefer **5 strong
references with reasoning** over 30 thumbnails.

## 4. Extract the principle, never the picture

The output of a hunt is a **rule you can apply**, phrased so it constrains your next drawing:

- ✅ "Five of the six marks that hold at 16 px use exactly one counter and one stroke weight."
- ✅ "Fintech wordmarks in this set track −1.5% and use a single-storey `a` — the category reads
  it as 'modern' rather than 'legacy bank'."
- ✅ "Award-winning reveal animations in this set land between 500 and 800 ms and all ease-out;
  nothing linear, nothing over a second."
- ❌ "This logo is clean and modern." (Not a rule. Constrains nothing.)

**Never trace, never copy, never re-draw somebody's mark with a tweak.** If a reference is close
enough that the resemblance would be noticed, say so out loud and move away from it deliberately.
Note trademark risk when the category is crowded (shields, leaves, swooshes, abstract chevrons).

## 5. Report — the reference ledger

Every hunt ends with a ledger. Never present a conclusion without it:

```md
## References pulled — 2026-08-05

1. **Klim Type Foundry — Söhne specimen** · https://klim.co.nz/retail-fonts/soehne/
   *Pulled:* x-height 0.52 em, six weights, tabular figures in all of them.
   *Applied:* text face candidate; pairs with a geometric display without matching skeletons.
2. **Chermayeff & Geismar mark archive** · <url>
   *Pulled:* five marks, all single-weight, all one counter.
   *Applied:* the "one counter at favicon size" rule for the monogram rung.
3. **<Brand> brand guidelines (official)** · <url>
   *Pulled:* clear space = 1 cap height; minimum width 24 px for mark alone.
   *Applied:* our clear-space rule, stated in cap heights rather than px.
```

Rules for the ledger:

- **URL + what you took + how it's applied.** All three, or the line is decoration.
- **Say when a search found nothing.** "No official guideline exists for this brand; the palette
  below is sampled from their site and is therefore approximate" is real information.
- **Date the hunt.** Trend claims expire.
- **Never fabricate a source.** A plausible-looking URL you did not fetch is the worst possible
  output of this skill. If you could not reach it, write `unreachable` and say what you inferred
  instead.

## 6. Keeping the training loop honest

"Hunting day and night" means the ledger accumulates and gets reused, not that facts get
invented between sessions:

- When a hunt produces a durable rule, **write it down where it survives** — the brief, the pack's
  usage notes, or a `documentation/notes/` entry — not just the chat reply.
- Re-check any claim older than a few months before repeating it, especially motion and web-type
  conventions.
- Prefer to re-fetch a primary source over quoting your own summary of it.
- Contradictions are findings: when two tier-1 sources disagree on a convention, report both and
  say which one you are following and why.
