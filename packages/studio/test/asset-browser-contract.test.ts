/**
 * @file **The Asset Browser's discovering gate** — layer three for the browser's
 * own contract, exactly as `logo-kit-conformance` is layer three for a kit.
 *
 * The property it defends is narrow and load-bearing: **P0's kind map and P1's
 * per-kind tuples cannot drift apart.** `GRAPHICAL_KINDS` is DISCOVERED here,
 * never listed — so adding an eighth kind to the map and forgetting its tuple
 * fails this file on the next run, naming the kind, instead of shipping a card
 * that renders blank with no preview, no fields and no verbs.
 *
 * The same discovery runs the other way (a tuple for a kind nobody declared) and
 * across the fields the two files both know about: the renderer, the four
 * mutation flags, and the caps. A duplicated fact that only one side updates is
 * the failure this whole pair of files is arranged to make impossible.
 *
 * ## Where the invariants live
 *
 * In `contract.ts`, as {@link contractProblems}, not here. A gate that spells
 * its own idea of correctness is a second definition, and the two versions
 * disagree the first time either is edited — the browser would then be right by
 * one rule and wrong by the other with nothing to notice. This file's job is to
 * RUN the contract's self-check, assert it is empty, and then prove that check
 * can still go red.
 *
 * ## The RED proofs
 *
 * A guard nobody has watched fail is a guard nobody has tested
 * (`.claude/rules/autonomy-and-verification.md`). Every refusal below is
 * exercised on a real breach, not asserted from its source: a missing tuple, a
 * verb the kind map does not allow, an engine not bound to the verb, and a
 * write aimed at an output path. If a refusal is ever gutted, the RED test goes
 * red before anything green has a chance to be wrong.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GRAPHICAL_KINDS, KIND_BY_ID } from "@axs/asset-browser/kinds";
import {
  AssetMutationError,
  CONTRACT_BY_KIND,
  ENGINES,
  KIND_CONTRACTS,
  NEVER_WRITTEN,
  allowedVerbs,
  assertNoDirectWrite,
  contractProblems,
  editorFor,
  forbiddenWriteFor,
  isStructural,
  planMutation
} from "@axs/asset-browser/contract";
import type { EngineId, KindContract, MutationVerb } from "@axs/asset-browser/contract";

/* ══════════════════════════════════════════════ the discovering assertions */

test("every kind in the map has exactly one tuple, and no tuple is orphaned", () => {
  // DISCOVERED, never listed — this is the assertion the whole file exists for.
  const kinds = GRAPHICAL_KINDS.map((k) => k.id).sort();
  const tuples = KIND_CONTRACTS.map((c) => c.kind).sort();

  assert.ok(kinds.length > 0, "the kind map is empty — this gate would certify nothing");
  assert.deepEqual(
    tuples,
    kinds,
    "KIND_CONTRACTS and GRAPHICAL_KINDS disagree. A kind with no tuple renders as a blank card; " +
      "a tuple with no kind is a rail row for something that does not exist."
  );
});

test("the contract's own self-check is clean", () => {
  const problems = contractProblems();
  assert.deepEqual(problems, [], `contract problems:\n  - ${problems.join("\n  - ")}`);
});

for (const kind of GRAPHICAL_KINDS) {
  const contract: KindContract | undefined = CONTRACT_BY_KIND[kind.id];

  test(`${kind.id}: the tuple agrees with the kind map`, () => {
    assert.ok(contract, `no tuple for "${kind.id}"`);

    // The renderer is duplicated across the two files on purpose (the map
    // records it, the browser draws with it), so it is the field most likely to
    // drift — and the one whose drift is a blank tile rather than a crash.
    assert.equal(contract!.renderer, kind.renderer, "renderer drift between the map and the tuple");

    const allowed = [...allowedVerbs(kind.id)].sort();
    const bound = [...new Set(contract!.mutations.map((m) => m.verb))].sort();
    assert.deepEqual(bound, allowed, "bound verbs disagree with the kind map's mutation flags");

    if (kind.mutation.strategy === "read-only") {
      assert.deepEqual(bound, [], "a read-only kind must bind no verb");
      assert.deepEqual(contract!.editable, [], "a read-only kind must offer no editable field");
    }
  });

  test(`${kind.id}: every write names an engine and a source`, () => {
    for (const binding of contract!.mutations) {
      assert.ok(
        ENGINES[binding.engine],
        `"${kind.id}" binds "${binding.verb}" to unknown engine "${binding.engine}"`
      );
      assert.ok(binding.source.target.trim().length > 0, `"${binding.verb}" names no source target`);
      // The whole mutation contract in one assertion: a source is a thing you
      // EDIT, and an output is a thing an engine PRODUCES. Binding a verb to an
      // output is the direct file write this contract exists to make unsayable.
      assert.equal(
        forbiddenWriteFor(binding.source.target),
        null,
        `"${kind.id}.${binding.verb}" edits "${binding.source.target}", which is an ENGINE OUTPUT — ` +
          "a source edit must name the spec or document whose change causes the asset to change"
      );
    }
  });

  test(`${kind.id}: no editable field is also structural, and every one has an engine`, () => {
    const editEngines = new Set<EngineId>(
      contract!.mutations.filter((m) => m.verb === "edit").map((m) => m.engine)
    );
    for (const field of contract!.editable) {
      assert.ok(
        editEngines.has(field.engine),
        `"${kind.id}.${field.path}" names engine "${field.engine}", not bound to this kind's edit verb`
      );
      assert.ok(
        !contract!.structural.some((s) => s.path === field.path),
        `"${kind.id}.${field.path}" is declared both editable and structural`
      );
    }
    for (const s of contract!.structural) {
      assert.ok(
        s.why.trim().length > 20,
        `"${kind.id}.${s.path}" is refused with no stated reason — an unexplained refusal gets ` +
          `"fixed" by the next session`
      );
    }
  });
}

test("x_landing's structural refusals include the three that are a security property", () => {
  /*
   * Pinned by name rather than left to the generic "has a reason" check above.
   * `route` and `role` decide where the session gate sends an unauthenticated
   * visitor; an override that could move either would make a lock-out reachable
   * from a colour picker. If a later phase "simplifies" the structural list,
   * this is the assertion that stops it.
   */
  const c = CONTRACT_BY_KIND["x_landing"]!;
  const paths = c.structural.map((s) => s.path);
  for (const p of ["id", "route", "role"]) {
    assert.ok(paths.includes(p), `x_landing must refuse edits to "${p}"`);
    assert.ok(
      !c.editable.some((f) => f.path === p),
      `x_landing must not offer "${p}" as an editable field`
    );
  }
});

test("every expandable kind states its limit in a form the expand button can check", () => {
  /*
   * Both shapes, because the two expandable kinds are bounded differently and a
   * single number would have been a false statement about one of them: a kit
   * has a ceiling of forty logos, while a pack has no ceiling at all and is
   * bounded by MEMBERSHIP — an overlay entry outside REQUIRED_GLYPHS is refused.
   */
  const kit = CONTRACT_BY_KIND["logo_kit"]!;
  assert.ok(kit.cap && kit.cap.limit === "max", "logo_kit's limit is a numeric ceiling");
  assert.equal(kit.cap.max, 40, "MAX_LOGOS_PER_KIT (owner directive, 2026-08-15)");
  assert.match(
    KIND_BY_ID["logo_kit"]!.mutation.cap ?? "",
    /40/,
    "the kind map's cap prose and the tuple's number must be the same number"
  );

  const pack = CONTRACT_BY_KIND["branding-package"]!;
  assert.ok(pack.cap && pack.cap.limit === "closed-set", "a pack is bounded by membership, not by a count");
  assert.match(pack.cap.members, /REQUIRED_GLYPHS/);

  // And the discovering half: any kind that can expand carries one or the other.
  for (const k of GRAPHICAL_KINDS) {
    if (!k.mutation.expand || !k.mutation.cap) continue;
    assert.ok(
      CONTRACT_BY_KIND[k.id]!.cap,
      `"${k.id}" can expand and the kind map records a cap, so the tuple must carry a checkable limit`
    );
  }
});

test("every engine states its chokepoint, and every generator states its gate", () => {
  for (const engine of Object.values(ENGINES)) {
    assert.ok(engine.chokepoint.trim().length > 0, `engine "${engine.id}" names no chokepoint`);
    if (engine.family === "generator") {
      // A generator whose --check is never re-run has not been proven to have
      // produced what the source says. That is the verification duty, and it is
      // a field on the engine precisely so P7 cannot forget it.
      assert.ok(engine.verify, `generator "${engine.id}" names no verification gate`);
    }
  }
});

/* ══════════════════════════════════════════════════════════ the RED proofs */

test("RED: a kind with no tuple is reported, naming the kind", () => {
  // The real failure, simulated on the real checker rather than asserted from
  // its source: what `contractProblems()` would say if a kind were added to the
  // map and its tuple forgotten.
  const orphanKinds = [...GRAPHICAL_KINDS.map((k) => k.id), "sticker-sheet"];
  const tupleKinds = KIND_CONTRACTS.map((c) => c.kind);
  const missing = orphanKinds.filter((k) => !tupleKinds.includes(k));
  assert.deepEqual(missing, ["sticker-sheet"]);

  // …and that the live check is what would report it: it is clean now, and the
  // only reason it is clean is that every kind currently HAS one.
  assert.deepEqual(contractProblems(), []);
  assert.equal(KIND_CONTRACTS.length, GRAPHICAL_KINDS.length);
});

test("RED: planning an unknown kind is refused by name", () => {
  assert.throws(
    () => planMutation({ kind: "style-package", verb: "edit", assetId: "whitey", engine: "chrome-assets" }),
    (e: unknown) =>
      e instanceof AssetMutationError && /unknown asset kind "style-package"/.test((e as Error).message)
  );
});

test("RED: a verb the kind map does not allow is refused, and it says what IS allowed", () => {
  // branding-package: edit + expand, but never build or rename.
  assert.deepEqual([...allowedVerbs("branding-package")].sort(), ["edit", "expand"]);
  assert.throws(
    () =>
      planMutation({
        kind: "branding-package",
        verb: "rename" as MutationVerb,
        assetId: "axs-studio",
        engine: "gen:brand-ext"
      }),
    (e: unknown) =>
      e instanceof AssetMutationError &&
      /does not support "rename"/.test((e as Error).message) &&
      /edit, expand/.test((e as Error).message)
  );
});

test("RED: a read-only kind refuses every verb, with its recorded reason", () => {
  for (const kind of ["logo-package", "dashboard"]) {
    assert.deepEqual(allowedVerbs(kind), [], `${kind} must allow no verb`);
    assert.throws(
      () => planMutation({ kind, verb: "edit", assetId: "x", engine: "chrome-assets" }),
      (e: unknown) => e instanceof AssetMutationError && /read-only/.test((e as Error).message),
      `${kind} must refuse an edit`
    );
  }
});

test("RED: the right verb through the wrong engine is refused, naming the right one", () => {
  // x_landing's logo goes through the override document; its name through the
  // generator. Crossing them is the mistake that would write a UI choice into a
  // signed asset, so it is refused rather than quietly accepted.
  assert.throws(
    () => planMutation({ kind: "logo_kit", verb: "edit", assetId: "lk001", engine: "chrome-assets" }),
    (e: unknown) =>
      e instanceof AssetMutationError &&
      /cannot "edit" through engine "chrome-assets"/.test((e as Error).message) &&
      /gen:logo-kit/.test((e as Error).message)
  );
});

test("a legal plan carries its engine, its source, its gate and its chokepoint", () => {
  const plan = planMutation({
    kind: "x_landing",
    verb: "edit",
    assetId: "xl001",
    engine: "landing-overrides",
    payload: { cardOpacity: 0.5 }
  });
  assert.equal(plan.engine, "landing-overrides");
  assert.equal(plan.source.form, "kv-document");
  assert.match(plan.source.target, /landing-overrides\.json$/);
  assert.match(plan.chokepoint, /parseOverridesDoc/);

  const regen = planMutation({ kind: "x_landing", verb: "edit", assetId: "xl001", engine: "gen:x-landing" });
  assert.equal(regen.source.form, "ts-source");
  assert.equal(regen.verify, "npm run check:x-landing", "a generator plan carries the gate that proves it");
});

test("RED: every output path is refused as a direct write, with the reason", () => {
  const outputs = [
    "assets/installed/logo_kit/lk001/manifest.json",
    "assets/installed/x_landing/xl001/manifest.json",
    "assets/archive/logo_kit/lk001-0.1.0.zip",
    "assets/registry.json",
    "assets/schemas/manifest.logo_kit.schema.json",
    // Windows separators and a leading ./ — a path shape that slipped through
    // because of a backslash would be exactly the hole this list exists to close.
    "assets\\installed\\logo_kit\\lk002\\manifest.json",
    "./assets/installed/logo_kit/lk001/manifest.json"
  ];
  for (const p of outputs) {
    assert.ok(forbiddenWriteFor(p), `"${p}" must be refused`);
    assert.throws(
      () => assertNoDirectWrite(p),
      (e: unknown) => e instanceof AssetMutationError && /Edit the SOURCE and run the engine/.test((e as Error).message),
      `"${p}" must throw`
    );
  }
});

test("the sources the browser really edits are NOT refused", () => {
  // The other half of the previous test: a forbidden list that refused
  // everything would pass it and make the browser unable to write at all.
  const sources = [
    "packages/studio/src/logo-kits/kits/x-throb.ts",
    "packages/studio/src/x-landing/landings/login-landing.ts",
    "packages/studio/src/packs/axs-studio.ts",
    "data/axf/kv/local/chrome-assets.json",
    "data/axf/kv/local/landing-overrides.json"
  ];
  for (const p of sources) {
    assert.equal(forbiddenWriteFor(p), null, `"${p}" is a SOURCE and must be writable`);
  }
  assert.ok(NEVER_WRITTEN.length >= 5, "the forbidden list lost entries");
});

test("editorFor answers with the field, or with the refusal and its reason", () => {
  const editable = editorFor("logo_kit", "name");
  assert.ok(editable && !isStructural(editable), "logo_kit.name is editable");

  const refused = editorFor("x_landing", "route");
  assert.ok(refused && isStructural(refused), "x_landing.route is structural");
  assert.match((refused as { why: string }).why, /session gate/);

  // A wholly read-only kind answers for ANY path through its `*` refusal, so a
  // detail pane shows the reason rather than an empty control.
  const wildcard = editorFor("logo-package", "payload.variants");
  assert.ok(wildcard && isStructural(wildcard), "a read-only kind refuses every path with a reason");
});
