/**
 * The MODULE AGENT contract: every module ships with one agent, derived from
 * its own declaration, carried in its own directory.
 *
 * What this file is careful about, and why each property earns a test:
 *
 *   - **Derivation is from the DECLARATION.** The whole value of a module
 *     agent over the house persona is that its skills name the module's real
 *     commands, setting keys and points. A derivation that dropped them would
 *     still produce a plausible-looking bundle, so the assertions look for the
 *     actual identifiers, not for the shape.
 *   - **The round trip is lossless.** The bundle is written as frontmatter +
 *     markdown so a person can repair it in a text editor; that is only true
 *     if what the scanner reads back is what the builder wrote.
 *   - **Resolution order.** `agentForModule` decides who answers a turn: pin,
 *     then the module's own agent, then the configured default. Getting this
 *     wrong is silent — the wrong persona simply answers — which is exactly
 *     the kind of bug a test has to hold.
 *   - **The two format tags agree.** `types.ts` (the app) and
 *     `scripts/lib/module-agent.mjs` (build tooling under plain Node) cannot
 *     import each other, so the constant is stated twice and checked here.
 *
 * Every real module on disk is exercised too: each one derives without
 * throwing, and each bundle that exists reads back as its module's agent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AGENT_BUNDLE_FORMAT,
  agentIdFor,
  applyEdits,
  deriveDraft,
  nameSuggestions,
  readBundle,
  writeBundle
} from "../scripts/lib/module-agent.mjs";
import { listModuleDirs, loadModuleDecl } from "../scripts/lib/closure.mjs";
import { agentForModule, DEFAULT_AGENT, MODULE_AGENT_FORMAT } from "../src/plugins/module-assistant/types.ts";
import type { AssistantAgent } from "../src/plugins/module-assistant/types.ts";

const STUDIO = path.resolve(import.meta.dirname, "..");
const CORE = path.resolve(STUDIO, "..", "core");

/** A declaration with one of everything the derivation reads, so a missing
 *  cluster is a failed assertion rather than an empty section nobody noticed. */
const FIXTURE = {
  id: "fixture",
  title: "Fixture Module",
  summary: "A module that exists to be derived from.",
  route: "/fixture",
  glyph: "icon-layers",
  points: [
    {
      id: "fixture.panel",
      title: "Fixture panel",
      description: "A pane in the fixture.",
      kind: "ui-surface",
      cardinality: "many",
      requires: ["title", "render"]
    }
  ],
  menus: {
    areas: [
      { id: "fixture.row", title: "Fixture row", description: "One row." },
      { id: "fixture.surface", title: "Fixture surface", description: "The screen." }
    ],
    items: {
      "fixture.row": [
        { id: "open", label: "Open row", command: "fixture.row.open", order: 10 },
        { id: "sep", label: "", role: "separator", order: 20 },
        { id: "delete", label: "Delete row", command: "fixture.row.delete", role: "danger", order: 30 }
      ],
      "fixture.surface": [{ id: "new", label: "New row", command: "fixture.new", order: 10 }]
    }
  },
  settings: {
    ns: "fixture-settings",
    rows: [
      {
        key: "compact",
        label: "Compact rows",
        hint: "Tighter row height.",
        kind: "switch",
        defaultValue: false
      }
    ]
  }
};

test("the two format tags agree — build tooling and app cannot import each other", () => {
  assert.equal(AGENT_BUNDLE_FORMAT, MODULE_AGENT_FORMAT);
});

test("derivation reads the declaration, not a template", () => {
  const draft = deriveDraft(FIXTURE);

  assert.equal(draft.module, "fixture");
  assert.equal(draft.id, "fixture-agent");
  assert.ok(draft.name, "a draft always proposes a name");

  // One skill per functional cluster: overview, each area WITH rows, settings,
  // points. The fixture declares no nav, so there is no navigation skill.
  const slugs = draft.skills.map((s: { slug: string }) => s.slug);
  assert.deepEqual(slugs, [
    "fixture-overview",
    "fixture-row",
    "fixture-surface",
    "fixture-settings",
    "fixture-extensions"
  ]);

  // The real command names reach the skill body, and the destructive row is
  // marked — an agent that cannot tell delete from open is worse than none.
  const rowSkill = draft.skills.find((s: { slug: string }) => s.slug === "fixture-row");
  assert.match(rowSkill.body, /fixture\.row\.open/);
  assert.match(rowSkill.body, /fixture\.row\.delete/);
  assert.match(rowSkill.body, /destructive/);

  // The settings skill carries the key, kind, default and the row's own hint.
  const settingsSkill = draft.skills.find((s: { slug: string }) => s.slug === "fixture-settings");
  assert.match(settingsSkill.body, /compact/);
  assert.match(settingsSkill.body, /Tighter row height\./);

  // The module's run tool enumerates the declared commands — an enum is what
  // stops a model inventing one — and the separator row is not a command.
  const run = draft.tools.find((t: { name: string }) => t.name === "fixture-run");
  assert.deepEqual(run.input_schema.properties.command.enum, [
    "fixture.row.open",
    "fixture.row.delete",
    "fixture.new"
  ]);

  // House tools ride along with the module's own.
  const toolNames = draft.tools.map((t: { name: string }) => t.name);
  for (const expected of ["fixture-open", "fixture-settings", "list-modules", "capture-task"]) {
    assert.ok(toolNames.includes(expected), `${expected} missing from the tool set`);
  }

  // The persona names the module and its route, and defaults to read-only CLI
  // tools — a chat window that can write files is an explicit choice.
  assert.match(draft.persona, /Fixture Module/);
  assert.match(draft.persona, /\/fixture/);
  assert.deepEqual(draft.cliTools, ["Read", "Grep", "Glob", "WebFetch", "WebSearch"]);
});

test("a taken name steps to the next suggestion, deterministically", () => {
  const first = nameSuggestions(FIXTURE)[0];
  const second = nameSuggestions(FIXTURE, new Set([first]))[0];
  assert.notEqual(first, second);
  assert.equal(nameSuggestions(FIXTURE)[0], first, "suggestions must not move between runs");
});

test("renaming re-derives an untouched persona and keeps an edited one", () => {
  const draft = deriveDraft(FIXTURE);

  const renamed = applyEdits(FIXTURE, draft, { name: "Sable" });
  assert.match(renamed.persona, /You are \*\*Sable\*\*/);

  const edited = applyEdits(FIXTURE, draft, { name: "Sable", persona: "# Mine\n\nHand written." });
  assert.equal(edited.persona, "# Mine\n\nHand written.");
});

test("a bundle round-trips through disk unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axs-agent-test-"));
  try {
    const draft = applyEdits(FIXTURE, deriveDraft(FIXTURE), { name: "Sable" });
    const files = writeBundle(dir, draft);
    assert.ok(files.length >= draft.skills.length + draft.tools.length + 1);

    const read = readBundle(dir);
    assert.equal(read.name, "Sable");
    assert.equal(read.module, "fixture");
    assert.equal(read.id, agentIdFor("fixture"));
    assert.deepEqual(read.cliTools, draft.cliTools);
    assert.deepEqual(
      read.skills.map((s: { slug: string }) => s.slug),
      draft.skills.map((s: { slug: string }) => s.slug)
    );
    assert.deepEqual(
      read.tools.map((t: { name: string }) => t.name).sort(),
      draft.tools.map((t: { name: string }) => t.name).sort()
    );
    assert.equal(read.persona.trim(), draft.persona.trim());

    // A regenerate DROPS what the owner removed: the second write must not
    // leave the first write's skills behind.
    writeBundle(dir, { ...draft, skills: draft.skills.slice(0, 1) });
    assert.equal(readBundle(dir).skills.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("agentForModule: pin, then the module's own agent, then the default", () => {
  const roster: AssistantAgent[] = [
    DEFAULT_AGENT,
    { id: "taskman-agent", name: "Cleo", description: "", source: "module", moduleId: "taskman" },
    { id: "chosen", name: "Chosen", description: "", source: "data" }
  ];

  // No pin, no bundle → the configured default.
  assert.equal(agentForModule({ agentId: "chosen", moduleAgents: {} }, "dashboard", roster), "chosen");

  // No pin, but the module ships its own → its own, with nothing configured.
  assert.equal(agentForModule({ agentId: "chosen", moduleAgents: {} }, "taskman", roster), "taskman-agent");

  // A pin beats the module's own agent — an explicit choice always wins.
  assert.equal(
    agentForModule({ agentId: "chosen", moduleAgents: { taskman: "amber" } }, "taskman", roster),
    "amber"
  );

  // A caller that passes no roster keeps the old two-step behaviour.
  assert.equal(agentForModule({ agentId: "chosen", moduleAgents: {} }, "taskman"), "chosen");

  // No module at all (the shell) → the default.
  assert.equal(agentForModule({ agentId: "", moduleAgents: {} }, undefined, roster), DEFAULT_AGENT.id);
});

test("every module on disk derives, and every bundle reads back as its module's", async () => {
  for (const id of listModuleDirs(STUDIO)) {
    // A directory whose declaration does not load yet is a module being
    // WRITTEN. That it must eventually declare itself is the suite gate's
    // assertion (suite.test.ts, both directions of drift); repeating it here
    // would only make this file fail for somebody else's reason.
    let loaded;
    try {
      loaded = await loadModuleDecl(STUDIO, id, CORE);
    } catch {
      continue;
    }
    const { decl, moduleDir } = loaded;
    const draft = deriveDraft(decl);
    assert.equal(draft.module, id);
    assert.ok(draft.skills.length >= 1, `${id} derived no skills`);
    assert.ok(draft.persona.trim().length > 200, `${id} derived a thin persona`);

    const bundle = readBundle(moduleDir);
    if (!bundle) continue; // A module built before its first agent build.
    assert.equal(bundle.module, id, `${id}'s bundle names another module`);
    assert.equal(bundle.id, agentIdFor(id));
    assert.ok(bundle.name.trim(), `${id}'s agent has no name`);
    assert.ok(bundle.persona.trim(), `${id}'s agent has no system prompt`);
  }
});
