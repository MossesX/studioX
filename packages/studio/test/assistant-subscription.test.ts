/**
 * @file The Anthropic *connection* — the assistant's two ways to reach Claude.
 *
 * Neither of the things pinned here is theoretical. Both are the kind of defect
 * that ships green and is discovered by a user whose chat stopped working, or
 * worse, by an invoice.
 *
 *   1. **The default is `subscription`** — owner decision, 2026-08-13: the
 *      studio lives beside a signed-in `claude` CLI, so an absent `authMode`
 *      must mean "works with no key stored", not "demand a key". The pin is
 *      here because flipping this default silently changes which ACCOUNT an
 *      install with no stored mode bills — that is a decision an owner makes,
 *      never a refactor.
 *
 *   2. **The three spellings of one model must all resolve.** `MODEL_CATALOG`
 *      is keyed on the builder's slug (`haiku-4-5`) and CLI id
 *      (`claude-haiku-4-5-20251001`); the assistant's own suggestion list uses
 *      the API id (`claude-haiku-4-5`), which is neither. On the subscription
 *      path that id reaches `claude --model` and an unresolved one is REFUSED,
 *      so a suggestion the resolver cannot map is a model the picker offers and
 *      the turn rejects. The catalog's own header opens on GizmoX and the
 *      builder disagreeing about exactly this model — this is that disagreement
 *      caught one layer up.
 *
 * Pure: no process, no network, no CLI. The parts that spawn (`runCliChat`,
 * `runBrokerTest`) are exercised live through `/api/assistant/claude-auth`, not
 * here — a unit test that shells out to a signed-in binary is a test that fails
 * on any machine but one.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MODEL_CATALOG } from "@axs/modules/buildmgr/models";
import { resolveCliModel, subscriptionModels } from "@axs/plugins/module-assistant/providers.server";
import {
  ANTHROPIC_AUTH_MODES,
  DEFAULT_ANTHROPIC_AUTH,
  MODEL_SUGGESTIONS,
  isAnthropicAuthMode
} from "@axs/plugins/module-assistant/types";

test("the connection defaults to the subscription, so a fresh install works with no key stored", () => {
  assert.equal(DEFAULT_ANTHROPIC_AUTH, "subscription");
});

test("both connections are offered, and nothing else is accepted", () => {
  assert.deepEqual(
    ANTHROPIC_AUTH_MODES.map((m) => m.id),
    ["api-key", "subscription"]
  );
  assert.ok(isAnthropicAuthMode("api-key"));
  assert.ok(isAnthropicAuthMode("subscription"));
  for (const bad of ["oauth", "", "API-KEY", null, undefined, 0, {}]) {
    assert.equal(isAnthropicAuthMode(bad), false, `${String(bad)} must not pass`);
  }
});

test("every model the picker suggests resolves to something the CLI will accept", () => {
  for (const suggested of MODEL_SUGGESTIONS.anthropic) {
    const info = resolveCliModel(suggested);
    assert.ok(info, `"${suggested}" is offered by the picker but resolves to no CLI model`);
    assert.ok(
      MODEL_CATALOG.some((m) => m.cliId === info.cliId),
      `"${suggested}" resolved to "${info.cliId}", which is not in the catalog`
    );
  }
});

test("the undated API spelling finds the catalog's dated CLI id", () => {
  // The one model where the two vocabularies genuinely differ. If this ever
  // starts passing for the wrong reason (the catalog dropping the date), the
  // exact-match assertion below goes red rather than the prefix rule quietly
  // becoming dead code.
  assert.equal(resolveCliModel("claude-haiku-4-5")?.cliId, "claude-haiku-4-5-20251001");
  assert.notEqual(resolveCliModel("claude-haiku-4-5")?.cliId, "claude-haiku-4-5");
});

test("a pinned dated id resolves by falling back to its undated form", () => {
  assert.equal(resolveCliModel("claude-opus-5-20260101")?.cliId, "claude-opus-5");
});

test("an unknown model resolves to nothing rather than to a plausible neighbour", () => {
  for (const bad of ["gpt-5.2", "claude-opus-9", "llama3.3", ""]) {
    assert.equal(resolveCliModel(bad), undefined, `"${bad}" must not resolve`);
  }
});

test("the subscription model list is the catalog's CLI ids, in catalog order", () => {
  assert.deepEqual(subscriptionModels(), MODEL_CATALOG.map((m) => m.cliId));
});
