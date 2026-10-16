/**
 * @file The model catalog must agree with the process that spends the money.
 *
 * `src/modules/buildmgr/models.ts` exists to be ONE source for model ids, rates
 * and capability rank. That claim is only true while it matches
 * `build/tools/bmpx_builder.py`, and the port that created it found the two
 * copies it replaced had ALREADY drifted — GizmoX's UI catalog spelled Haiku
 * `claude-haiku-4-5` while the builder invoked `claude-haiku-4-5-20251001`.
 * Nothing compared them, so both were "right" for months.
 *
 * This test is the comparison. It parses the builder's own constants out of the
 * Python source rather than restating them here, because a test that restates
 * the numbers is a third copy that can drift in its own right — it would go
 * green on a catalog that matched IT and disagreed with the runner.
 *
 * It is deliberately a HARD failure when the Python cannot be read. The builder
 * lives in the GizmoX tree, which is scheduled to move (open work item 3); a
 * skip-if-missing would let that move silently retire the only thing keeping
 * these numbers honest. When the toolchain moves, this path moves with it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_TIER,
  MODEL_CATALOG,
  PROJECT_FACTOR,
  SESSION_OVERHEAD_TOK,
  UNKNOWN_OUT_RATE,
  effectiveModel,
  isKnownModel,
  modelRank,
  projectedUsd,
  resolveModel
} from "@axs/modules/buildmgr/models";

/** studio → packages → amberx-ai-studio → Projects → GizmoX. */
const BUILDER = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "GizmoX",
  "build",
  "tools",
  "bmpx_builder.py"
);

const src = readFileSync(BUILDER, "utf8");

/** Pull a `NAME = { "k": v, ... }` dict literal out of the Python. */
function pyDict(name: string): Record<string, string> {
  const m = new RegExp(`^${name}\\s*=\\s*\\{([\\s\\S]*?)\\}`, "m").exec(src);
  assert.ok(m, `${name} not found in ${BUILDER} — the builder's shape changed`);
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1].matchAll(/"([^"]+)"\s*:\s*("?[^,"}\n]+"?)/g)) {
    out[k] = v.trim().replace(/^"|"$/g, "");
  }
  return out;
}

/** Pull a `NAME = <number>` scalar out of the Python. */
function pyNum(name: string): number {
  const m = new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, "m").exec(src);
  assert.ok(m, `${name} not found in ${BUILDER}`);
  return Number(m[1]);
}

test("every model's CLI id is the one the builder actually invokes", () => {
  const cliIds = pyDict("MODEL_CLI_IDS");
  assert.equal(
    MODEL_CATALOG.length,
    Object.keys(cliIds).length,
    `catalog has ${MODEL_CATALOG.length} models, the builder knows ${Object.keys(cliIds).length}`
  );
  for (const m of MODEL_CATALOG) {
    assert.equal(
      m.cliId,
      cliIds[m.slug],
      `"${m.slug}" resolves to "${m.cliId}" here and "${cliIds[m.slug]}" in the builder`
    );
  }
});

test("in/out rates match the builder's projection rates", () => {
  const inRates = pyDict("IN_RATES");
  const outRates = pyDict("OUT_RATES");
  for (const m of MODEL_CATALOG) {
    assert.equal(m.inPerMTok, Number(inRates[m.slug]), `${m.slug} input rate`);
    assert.equal(m.outPerMTok, Number(outRates[m.slug]), `${m.slug} output rate`);
  }
});

test("catalog order IS the builder's capability rank", () => {
  // Not price order — opus-5 is last and costs half what fable-5 does. Every
  // rank-by-index call site depends on this being capability.
  const tiers = pyDict("TIER_ORDER");
  for (const m of MODEL_CATALOG) {
    assert.equal(modelRank(m.slug), Number(tiers[m.slug]), `${m.slug} rank`);
  }
  assert.equal(MODEL_CATALOG[MODEL_CATALOG.length - 1].slug, "opus-5", "the flagship must rank top");
});

test("the silent-fallback constants match, so an unknown model is priced as the builder would price it", () => {
  const dt = /^DEFAULT_TIER\s*=\s*"([^"]+)"/m.exec(src);
  assert.ok(dt, "DEFAULT_TIER not found");
  assert.equal(DEFAULT_TIER, dt[1]);
  assert.equal(PROJECT_FACTOR, pyNum("PROJECT_FACTOR"));
  assert.equal(SESSION_OVERHEAD_TOK, pyNum("SESSION_OVERHEAD_TOK"));
  // The literal in `OUT_RATES.get(effective_model(...), 25.0)` — the rate an
  // unknown model is charged at, belonging to no model in the lineup.
  assert.match(
    src,
    /OUT_RATES\.get\(effective_model\([^)]*\),\s*25\.0\)/,
    "the builder's unknown-model fallback rate changed"
  );
  assert.equal(UNKNOWN_OUT_RATE, 25.0);
});

test("projectedUsd reproduces the builder's arithmetic", () => {
  // tok / 1e6 * OUT_RATE * PROJECT_FACTOR * risk_buffer
  const { usd } = projectedUsd(120_000, "opus-5", 1.2);
  assert.equal(usd, (120_000 / 1e6) * 25 * PROJECT_FACTOR * 1.2);
  // An unknown model is priced at the fallback AND flagged.
  const bad = projectedUsd(120_000, "opus-6", 1);
  assert.equal(bad.usd, (120_000 / 1e6) * UNKNOWN_OUT_RATE * PROJECT_FACTOR);
  assert.equal(bad.unknown, true);
  // An omitted model is a documented default, not a defect.
  assert.equal(projectedUsd(1000, "").unknown, false);
});

test("both spellings resolve; a typo does not", () => {
  assert.equal(resolveModel("opus-5")?.slug, "opus-5");
  assert.equal(resolveModel("claude-opus-5")?.slug, "opus-5");
  assert.equal(resolveModel("claude-haiku-4-5-20251001")?.slug, "haiku-4-5");
  // The exact drift this catalog was created by: GizmoX's UI id for Haiku is
  // NOT a spelling the builder accepts, and must not resolve here either.
  assert.equal(resolveModel("claude-haiku-4-5"), undefined);
  assert.equal(isKnownModel("claude-haiku-4-5"), false);
  assert.equal(isKnownModel("sonnet-5"), true);
  assert.equal(isKnownModel(""), true, "an omitted model defaults to sonnet-5 by contract");
  assert.equal(isKnownModel("opus5"), false);
});

test("effectiveModel matches the builder's switch rule", () => {
  const fableAll = { fable_everywhere: true };
  const opusAll = { opus_everywhere: true };
  assert.equal(effectiveModel("haiku-4-5", fableAll), "fable-5");
  assert.equal(effectiveModel("fable-5", fableAll), "fable-5");
  // opus_everywhere lifts everything EXCEPT fable-5, which is left alone.
  assert.equal(effectiveModel("haiku-4-5", opusAll), "opus-5");
  assert.equal(effectiveModel("fable-5", opusAll), "fable-5");
  assert.equal(effectiveModel("sonnet-5", null), "sonnet-5");
  assert.equal(effectiveModel("", opusAll), "", "an omitted model stays omitted");
});
