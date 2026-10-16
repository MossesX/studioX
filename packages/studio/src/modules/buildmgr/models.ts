/**
 * @file The model catalog — ONE source for what a step may name, what it costs,
 * and what it actually runs as.
 *
 * Ported from GizmoX's `src/modules/buildmgr/models.ts` (2026-08-11), but the
 * port is deliberately NOT a copy, for a reason worth writing down: GizmoX's
 * file is a UI catalog that drives badges and a picker, and it had drifted from
 * the builder. It spells Haiku's id `claude-haiku-4-5`; `bmpx_builder.py`
 * invokes `claude-haiku-4-5-20251001`. Both files were "right" because nothing
 * compared them.
 *
 * So the authority here is **`build/tools/bmpx_builder.py`**, because that is
 * the process that spends the money: `MODEL_CLI_IDS`, `IN_RATES`/`OUT_RATES`,
 * `TIER_ORDER`, `DEFAULT_TIER`, `PROJECT_FACTOR` and `SESSION_OVERHEAD_TOK` are
 * mirrored below field for field, and `test/model-catalog.test.ts` parses those
 * constants out of the Python and fails on any disagreement. A catalog that can
 * disagree with the runner is a catalog that will.
 *
 * ── the defect this closes ───────────────────────────────────────────────────
 *
 * The builder resolves a step's model through
 * `MODEL_CLI_IDS.get(self.model, MODEL_CLI_IDS[DEFAULT_TIER])`. A step naming a
 * model that does not exist therefore does not fail — it **silently runs on
 * sonnet-5**, and its cost is projected at `OUT_RATES.get(model, 25.0)`, a rate
 * belonging to no model in particular. A typo in a plan is invisible until the
 * output is wrong, and then it looks like the model underperformed.
 *
 * `isKnownModel()` is the answer to that, and it is used at the two places that
 * can actually stop it: the review screen (before a run) and `/api/bmpx/plan`
 * (before a write). Reading it in the badge only would make the problem visible
 * without making it refusable.
 *
 * ── what is NOT ported ───────────────────────────────────────────────────────
 *
 * - `color` (hex) and `MODEL_LOGO` (`/assets/model-logos/<slug>.svg`). Both are
 *   GizmoX-shaped: this app has no `public/` at all, and a shipped hex is
 *   exactly what `.claude/rules/no-hand-rolled-ui.md` excludes icons for — a
 *   colour no theme can reach. `tone` names a THEME TOKEN instead, so a model
 *   badge recolours with the rest of the app. The tones are the ones the Build
 *   Manager's `MODEL_TONE` map already painted, so nothing on screen moves.
 * - `plan.model_switches` handling lives in `/api/bmpx/switches` as well, which
 *   is a second implementation of `effectiveModel()` and is left alone on
 *   purpose: that route also GENERATES the fable-redo group from the same rule,
 *   and merging the two is a change to a working write path, not a port. The
 *   test pins both against the builder's version, which is what actually keeps
 *   them honest.
 */

/** A step's `model` field spells the SLUG (`"opus-5"`); a plan's own top-level
 *  `model` field spells the CLI id (`"claude-opus-5"`). Both spellings resolve
 *  here — `resolveModel()` — because both appear in real `.bmpx` files. */
export interface ModelInfo {
  /** What a `.bmpx` step's `model` field spells. */
  slug: string;
  /** What `bmpx_builder.py` passes to `claude -p --model`. */
  cliId: string;
  label: string;
  /** Theme token name, NOT a hex — the badge recolours with the theme. */
  tone: string;
  inPerMTok: number;
  outPerMTok: number;
  /** One-line "use this for". */
  fit: string;
  /** Benefit of picking this tier. */
  why: string;
  /** Consequence, or when to avoid it. */
  whyNot: string;
}

/**
 * Ordered by CAPABILITY, which is the builder's `TIER_ORDER` and is NOT price
 * order: `opus-5` sits last — above `fable-5` — while costing half as much.
 * Index into this array IS the rank; `model_override` and every rank-by-index
 * call site read it that way.
 */
export const MODEL_CATALOG: ModelInfo[] = [
  {
    slug: "haiku-4-5",
    cliId: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    tone: "dim",
    inPerMTok: 1,
    outPerMTok: 5,
    fit: "Mechanical, low-reasoning steps and parallel subagents",
    why: "Cheapest and fastest tier — ideal for parallel, low-judgment steps.",
    whyNot:
      "Weakest reasoning in the lineup — risky on anything needing real judgment or long-horizon planning."
  },
  {
    slug: "sonnet-5",
    cliId: "claude-sonnet-5",
    label: "Sonnet 5",
    tone: "accent2",
    inPerMTok: 3,
    outPerMTok: 15,
    fit: "The default balance for most build steps",
    why: "Near-Opus quality at roughly a third of Opus cost — the safe default.",
    whyNot: "Can under-think the hardest architecture and design calls."
  },
  {
    slug: "opus-4-8",
    cliId: "claude-opus-4-8",
    label: "Opus 4.8",
    tone: "accent3",
    inPerMTok: 5,
    outPerMTok: 25,
    fit: "Superseded by opus-5 at the same price — do not assign to new steps",
    why: "Strong on long-horizon agentic work, but opus-5 is stronger for the same money.",
    whyNot:
      "There is no case for it any more: opus-5 costs the same and outranks it. `.claude/rules/model-selection.md` forbids assigning it to a new step."
  },
  {
    slug: "fable-5",
    cliId: "claude-fable-5",
    label: "Fable 5",
    tone: "accent",
    inPerMTok: 10,
    outPerMTok: 50,
    fit: "Hardest long-horizon reasoning ONLY — at most one step per plan",
    why: "Deepest single-step reasoning available; reserve it for the one hardest step.",
    whyNot:
      "Most expensive tier by a factor of two — a budget risk anywhere but the step that genuinely needs it."
  },
  {
    // Last by CAPABILITY, not by price. The flagship outranks every tier above
    // it while costing the Opus tier's $5/$25 rather than Fable's $10/$50, so
    // a rank-by-index call site gets "highest tier" — which is the intent —
    // and the cheaper rate is a bonus rather than a reason to demote it.
    slug: "opus-5",
    cliId: "claude-opus-5",
    label: "Opus 5",
    tone: "accent3",
    inPerMTok: 5,
    outPerMTok: 25,
    fit: "Flagship — hard or critical steps, core contracts, whole-project analysis",
    why: "The strongest reasoning available, at Opus-tier pricing rather than Fable's.",
    whyNot: "Still 5× Haiku on input — wasted on genuinely mechanical steps."
  }
];

/** What `bmpx_builder.py` falls back to for a model it does not recognise —
 *  the reason an unknown model is silent rather than loud. */
export const DEFAULT_TIER = "sonnet-5";

/** Blended $/tok factor the builder applies to a model's OUTPUT rate when
 *  projecting a step's cost from its token estimate (~70/30 in/out mix, fitted
 *  from the original hand-made plan estimates). */
export const PROJECT_FACTOR = 0.4359;

/** One-time cost of spinning up a fresh claude session (system prompt + tool
 *  specs + contract read), in tokens. */
export const SESSION_OVERHEAD_TOK = 2500;

/** The fallback output rate the builder prices an UNKNOWN model at — a rate
 *  belonging to no model in the lineup, which is why an unknown model's cost
 *  estimate is meaningless rather than merely wrong. */
export const UNKNOWN_OUT_RATE = 25.0;

const BY_SLUG = new Map(MODEL_CATALOG.map((m) => [m.slug, m]));
const BY_CLI_ID = new Map(MODEL_CATALOG.map((m) => [m.cliId, m]));

export const modelBySlug = (slug: string): ModelInfo | undefined => BY_SLUG.get(slug);

/** Accepts EITHER spelling — a step's slug or a plan's CLI id. Real `.bmpx`
 *  files carry both, in different fields, and a resolver that only knows one
 *  reports half the file as unknown. */
export const resolveModel = (name: string): ModelInfo | undefined =>
  BY_SLUG.get(name) ?? BY_CLI_ID.get(name);

/** The check the builder does not do. An empty model is NOT unknown — the
 *  builder documents `steps missing a 'model' field default to sonnet-5`, so
 *  omission is a stated default and a typo is a defect. */
export const isKnownModel = (name: string): boolean => name === "" || resolveModel(name) !== undefined;

/** Capability rank; `-1` for anything not in the lineup. */
export const modelRank = (name: string): number => {
  const m = resolveModel(name);
  return m ? MODEL_CATALOG.indexOf(m) : -1;
};

/** The model a step RUNS on once `plan.model_switches` applies. Mirrors
 *  `bmpx_builder.py::effective_model` (switch half; `agents.model_override` is
 *  a run-time concern the screen does not set). */
export function effectiveModel(
  stored: string,
  switches: { opus_everywhere?: boolean; fable_everywhere?: boolean } | null | undefined
): string {
  if (!stored) return stored;
  if (switches?.fable_everywhere) return "fable-5";
  if (switches?.opus_everywhere && stored !== "fable-5") return "opus-5";
  return stored;
}

/**
 * Projected $ for one step, using the builder's own arithmetic
 * (`projected_usd`): `tok / 1e6 × OUT_RATE × PROJECT_FACTOR × risk_buffer`.
 *
 * This is the point of the catalog. The Build Manager previously priced a
 * project from each `.bmpx`'s own `plan.rates` block with a 35/65 split — a
 * different formula, per-project, that could not agree with the builder even
 * when the numbers in it were right.
 *
 * An unknown model is priced at the builder's `25.0` fallback so the estimate
 * matches what a run would actually report, and `unknown` is returned beside
 * it so a caller can say the number is not trustworthy rather than print it
 * plain.
 */
export function projectedUsd(tok: number, model: string, riskBuffer = 1): { usd: number; unknown: boolean } {
  const info = resolveModel(model);
  const rate = info ? info.outPerMTok : UNKNOWN_OUT_RATE;
  return {
    usd: (tok / 1e6) * rate * PROJECT_FACTOR * riskBuffer,
    unknown: !info && model !== ""
  };
}

/** Benefit/risk summary for moving a step from one tier to another — what the
 *  review screen shows the moment a model is changed, so the trade is stated
 *  rather than left to be remembered. */
export function modelChangeImpact(
  fromName: string,
  toName: string
): { costPct: number; benefit: string; risk: string } {
  const a = resolveModel(fromName);
  const b = resolveModel(toName);
  if (!a || !b) return { costPct: 0, benefit: "", risk: "" };
  const costPct = Math.round(((b.inPerMTok + b.outPerMTok) / (a.inPerMTok + a.outPerMTok) - 1) * 100);
  const downgrading = MODEL_CATALOG.indexOf(b) < MODEL_CATALOG.indexOf(a);
  return {
    costPct,
    benefit: downgrading
      ? `${Math.abs(costPct)}% cheaper per token than ${a.label} — ${b.fit.toLowerCase()}.`
      : `Stronger reasoning tier than ${a.label} — ${b.fit.toLowerCase()}.`,
    risk: downgrading
      ? `Lower tier than ${a.label} — may under-perform if this step is not actually mechanical. ${b.whyNot}`
      : `${costPct > 0 ? "+" : ""}${costPct}% cost vs ${a.label} — worth it only if this step needs ${b.label}'s depth.`
  };
}
