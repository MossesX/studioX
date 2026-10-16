/**
 * @file Agent Forge's pure layer — `axf-claude` P5.
 *
 * The plugin's whole job is reading somebody else's files and turning them into
 * one string, so the risk is not that a component renders wrong; it is that the
 * READER disagrees with the `claude` CLI about what those files say. Everything
 * below is therefore about the parse, the scan and the composition, against a
 * PLANTED tree rather than the real `.claude/` — a test that scanned the repo it
 * runs in would pass or fail depending on which personas happen to be installed
 * today, which is not a test.
 *
 * The mirror check at the foot is the one that would otherwise rot silently:
 * `client.ts` re-declares `PersonaInfo` and `SkillInfo` rather than importing
 * them, because `forge.ts` imports `node:fs` and a client component reaching it
 * for a TYPE pulls the module into the browser graph. Two declarations of one
 * shape drift; this pins them to each other.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CLAUDE_CONTEXT_PROVIDER_POINT } from "../src/claude/points";
import { boundPersona, withBinding } from "../src/plugins/agent-forge/bindings";
import { composePersonaContext, parseFrontmatter, scanSkills } from "../src/plugins/agent-forge/forge";
import { AGENT_FORGE_CONTEXT, personaContextFor } from "../src/plugins/agent-forge/plugin.server";
import { personaContext, scanRoster } from "../src/plugins/agent-forge/roster";

/* ------------------------------------------------------------- the fixture */

/**
 * A tree with all three scopes populated. `home` and `studio` are temp
 * directories, which is the whole reason `forgeRoots`/`scanRoster` take them:
 * pointing the user scope at the real `~/.claude` — or the studio scope at the
 * roster this repo actually ships — would make these results depend on which
 * personas happen to be installed the day the suite runs.
 *
 * The shipped roster gets its own test at the foot, where depending on it is
 * the entire point.
 */
function plant(): { repo: string; home: string; studio: string; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "axf-forge-"));
  const repo = path.join(base, "repo");
  const home = path.join(base, "home");
  const studio = path.join(base, "studio");

  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
  };

  write(
    path.join(repo, ".claude", "agents", "molly.md"),
    [
      "---",
      "name: Molly",
      "description: The framework expert.",
      "tools: Read, Bash",
      "skills:",
      "  - dx-topic",
      "  - /Not-Installed",
      "model: opus-5",
      "---",
      "",
      "You know the whole thing cold.",
      "Second line.",
      "Third line.",
      "Fourth line — must not reach the preview."
    ].join("\n")
  );
  write(
    path.join(repo, ".claude", "agents", "retired.md.disabled"),
    ["---", "name: Retired", "description: Off.", "---", "", "body"].join("\n")
  );
  write(
    path.join(home, ".claude", "agents", "amber.md"),
    ["---", "name: Amber", 'tools: ["Read", "Write"]', "---", "", "Narrator."].join("\n")
  );
  write(
    path.join(repo, ".claude", "skills", "dx-topic", "SKILL.md"),
    ["---", "name: DX Topic", "description: Add a docs topic.", "---", "", "steps"].join("\n")
  );
  write(
    path.join(home, ".claude", "skills", "make-hotkey", "SKILL.md.disabled"),
    ["---", "name: Make Hotkey", "description: Bind a chord.", "---"].join("\n")
  );

  // The studio scope: one slug the project also declares (so shadowing has
  // something to decide) and one it does not (so the scope is not only ever
  // the loser).
  write(
    path.join(studio, "agents", "molly.md"),
    ["---", "name: Molly (shipped)", "description: The bundled copy.", "---", "", "House body."].join("\n")
  );
  write(
    path.join(studio, "agents", "house.md"),
    ["---", "name: House", "description: Ships with the studio.", "skills: dx-topic", "---", "", "Body."].join(
      "\n"
    )
  );
  write(
    path.join(studio, "skills", "dx-topic", "SKILL.md"),
    ["---", "name: DX Topic (shipped)", "description: The bundled copy.", "---", "", "steps"].join("\n")
  );

  return {
    repo,
    home,
    studio,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true })
  };
}

/* ---------------------------------------------------------- the frontmatter */

test("the frontmatter parser handles the shapes agent files actually use", () => {
  const { data, body } = parseFrontmatter(
    [
      "---",
      "name: Thing",
      "description: >",
      "  folded across",
      "  two lines",
      "tools:",
      "  - Read",
      '  - "Bash"',
      "skills: a, b",
      "inline: [x, 'y']",
      "---",
      "body text"
    ].join("\n")
  );
  assert.equal(data.name, "Thing");
  assert.equal(data.description, "folded across two lines", "a folded block joins with spaces");
  assert.deepEqual(data.tools, ["Read", "Bash"], "quotes are stripped from list items");
  assert.equal(data.skills, "a, b", "a comma list stays a string until toolList normalises it");
  assert.deepEqual(data.inline, ["x", "y"]);
  assert.equal(body, "body text");
});

test("a file with no frontmatter is all body, not an error", () => {
  const { data, body } = parseFrontmatter("just prose\n");
  assert.deepEqual(data, {});
  assert.equal(body, "just prose\n");
});

/* ----------------------------------------------------------------- the scan */

test("the roster reads all three scopes, both kinds, and honours the off switch", () => {
  const { repo, home, studio, cleanup } = plant();
  try {
    const roster = scanRoster(repo, home, studio);
    assert.deepEqual(
      roster.personas.map((p) => p.id).sort(),
      [
        "project:persona:molly",
        "project:persona:retired",
        "studio:persona:house",
        "studio:persona:molly",
        "user:persona:amber"
      ],
      "a disabled persona is LISTED — it is off, not absent"
    );

    const molly = roster.personas.find((p) => p.id === "project:persona:molly")!;
    assert.equal(molly.disabled, false);
    assert.deepEqual(molly.tools, ["Read", "Bash"]);
    assert.deepEqual(molly.skills, ["dx-topic", "/Not-Installed"]);
    assert.equal(molly.model, "opus-5");
    assert.equal(
      molly.bodyPreview.split("\n").length,
      3,
      "the preview is a roster row, not the prompt"
    );

    const retired = roster.personas.find((p) => p.slug === "retired")!;
    assert.equal(retired.disabled, true, ".md.disabled is the CLI's own off switch");

    // `skills` is absent rather than empty when the file declares none — a key
    // nobody asked for is a key the next writer round-trips into their file.
    const amber = roster.personas.find((p) => p.slug === "amber")!;
    assert.equal("skills" in amber, false);
    assert.deepEqual(amber.tools, ["Read", "Write"], "an inline array parses too");

    assert.deepEqual(
      roster.skills.map((s) => `${s.id}:${s.disabled}`).sort(),
      ["project:skill:dx-topic:false", "studio:skill:dx-topic:false", "user:skill:make-hotkey:true"]
    );
  } finally {
    cleanup();
  }
});

test("a nearer scope shadows a farther one, and nothing is dropped", () => {
  const { repo, home, studio, cleanup } = plant();
  try {
    const roster = scanRoster(repo, home, studio);
    const flagged = (id: string) => roster.personas.find((p) => p.id === id)!.shadowed;

    assert.equal(flagged("project:persona:molly"), false, "project is the nearest scope");
    assert.equal(flagged("studio:persona:molly"), true, "the shipped copy loses to the repo's");
    assert.equal(flagged("studio:persona:house"), false, "a slug nobody else declares wins");

    // Kept, not filtered. This repo's `.claude/` is a MIRROR of the shipped
    // roster, so shadowed entries are the normal case here — a reader who saw
    // only winners could not tell that mirror from a hand-written override.
    assert.equal(
      roster.personas.filter((p) => p.slug === "molly").length,
      2,
      "the loser is flagged, never dropped"
    );
    assert.equal(
      roster.skills.find((s) => s.id === "studio:skill:dx-topic")!.shadowed,
      true,
      "skills shadow on the same rule"
    );
  } finally {
    cleanup();
  }
});

test("a missing .claude directory is empty, never a throw", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "axf-forge-bare-"));
  try {
    const roster = scanRoster(
      path.join(base, "repo"),
      path.join(base, "home"),
      path.join(base, "studio")
    );
    assert.deepEqual(roster.personas, []);
    assert.deepEqual(roster.skills, []);
    assert.deepEqual(scanSkills("project", path.join(base, "nope")), []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

/* ------------------------------------------------- the roster we SHIP ----- */

/**
 * The one place depending on the real directory is the point: since 2026-08-13
 * `packages/studio/forge/` is product content, versioned like source, and "the
 * personas AmberX ships" is a claim a test may hold. Everything above plants a
 * fixture precisely so that this can be the only test that would notice
 * somebody deleting `molly.md`.
 */
test("the shipped studio roster loads, and every skill a shipped persona declares resolves", () => {
  // A repo and a home that carry nothing, so what is left is the studio scope
  // alone — otherwise this asserts on whatever `~/.claude` holds today.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "axf-forge-ship-"));
  try {
    const roster = scanRoster(path.join(base, "repo"), path.join(base, "home"));

    assert.deepEqual(
      roster.personas.map((p) => p.slug).sort(),
      ["amber", "logo-lenny", "molly"],
      "the three personas imported from GizmoX"
    );
    assert.equal(roster.skills.length, 8, "the eight skill bundles imported with them");
    assert.ok(
      roster.personas.every((p) => p.scope === "studio" && !p.shadowed && !p.disabled),
      "the shipped set is studio-scope, enabled, and shadowed by nothing when no other scope exists"
    );
    assert.ok(
      roster.personas.every((p) => p.name && p.description),
      "every shipped persona parses a name and a description out of its frontmatter"
    );

    // The join, against the real files. A persona declaring a bundle nobody
    // shipped compiles to `(UNRESOLVED)` — visible only in the brief, which is
    // exactly the typo-that-vanishes this is here to catch. `logo-lenny`
    // declares five.
    for (const persona of roster.personas) {
      const text = personaContext(path.join(base, "repo"), persona.id, path.join(base, "home"));
      assert.ok(text, `${persona.slug} compiles`);
      assert.doesNotMatch(
        text!,
        /\(UNRESOLVED\)/,
        `${persona.slug} declares a skill the studio does not ship`
      );
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------- the composition */

test("a declared skill that resolves is named; one that does not is REPORTED", () => {
  const skills = [
    {
      id: "project:skill:dx-topic",
      scope: "project" as const,
      slug: "dx-topic",
      file: "x",
      name: "DX Topic",
      description: "",
      disabled: false
    }
  ];
  const text = composePersonaContext(
    ["---", "name: Molly", "description: Expert.", "skills: /DX-Topic, ghost", "---", "", "Body."].join(
      "\n"
    ),
    "fallback",
    skills
  );
  assert.match(text, /^## Persona: Molly/);
  assert.match(text, /Expert\./);
  assert.match(text, /DX Topic \(dx-topic\)/, "a slug matches case- and slash-insensitively");
  assert.match(text, /ghost \(UNRESOLVED\)/, "a typo that vanishes is the failure this prevents");
  assert.match(text, /Body\.$/);
});

test("personaContext compiles the bound persona and refuses a disabled one", () => {
  const { repo, home, studio, cleanup } = plant();
  try {
    const text = personaContext(repo, "project:persona:molly", home, studio);
    assert.ok(text);
    assert.match(text!, /## Persona: Molly/);
    assert.match(text!, /Not-Installed \(UNRESOLVED\)/);

    assert.equal(
      personaContext(repo, "project:persona:retired", home, studio),
      null,
      "a disabled persona must not reach a prompt"
    );
    assert.equal(personaContext(repo, "project:persona:ghost", home, studio), null);

    // A SHADOWED persona still compiles, and compiles ITS OWN file. Shadowing
    // decides where a fresh pick lands; an id already bound names one file, and
    // quietly compiling a different one would be the surprise.
    const shipped = personaContext(repo, "studio:persona:molly", home, studio);
    assert.match(shipped!, /## Persona: Molly \(shipped\)/);
    assert.match(shipped!, /House body\./);

    // The declared-skill join takes the NEAREST bundle of a shadowed pair —
    // same precedence, one rule.
    assert.match(
      personaContext(repo, "studio:persona:house", home, studio)!,
      /DX Topic \(dx-topic\)/,
      "the project's dx-topic wins over the studio's, so its name is the one reported"
    );
  } finally {
    cleanup();
  }
});

/* -------------------------------------------------------------- the binding */

test("a binding survives a hostile document without throwing", () => {
  assert.equal(boundPersona(null, "c1"), null);
  assert.equal(boundPersona({}, "c1"), null);
  assert.equal(boundPersona({ personas: "nope" }, "c1"), null);
  assert.equal(boundPersona({ personas: { c1: 7 } }, "c1"), null);
  assert.equal(boundPersona({ personas: { c1: "" } }, "c1"), null);
  assert.equal(boundPersona({ personas: { c1: "user:persona:amber" } }, "c1"), "user:persona:amber");
});

test("withBinding sets, clears, and never mutates its input", () => {
  const doc = { personas: { c1: "a" } };
  const added = withBinding(doc, "c2", "b");
  assert.deepEqual(added.personas, { c1: "a", c2: "b" });
  assert.deepEqual(doc.personas, { c1: "a" }, "an optimistic redraw must not share the object");

  const cleared = withBinding(added, "c1", null);
  assert.deepEqual(cleared.personas, { c2: "b" });
  assert.deepEqual(withBinding(undefined, "c1", "a").personas, { c1: "a" });
});

/* ------------------------------------------------- the context provider ---- */

test("the provider answers with the bound persona, and with '' for every ordinary miss", async () => {
  const { repo, home, cleanup } = plant();
  try {
    const conversation = { id: "c1", cwd: repo };
    const resolve = (r: string, id: string) => personaContext(r, id, home);

    const bound = await personaContextFor(conversation, {
      readDoc: async () => ({ personas: { c1: "project:persona:molly" } }),
      resolve
    });
    assert.match(bound, /## Persona: Molly/);

    // Every one of these is ORDINARY, not exceptional, and each must cost the
    // turn its context and nothing else. The service logs a thrower and carries
    // on, which is a silent degradation — so none of them throws.
    for (const [what, doc] of [
      ["no document at all", null],
      ["a document with no binding for this conversation", { personas: { other: "x" } }],
      ["a binding naming a persona that is gone", { personas: { c1: "project:persona:ghost" } }],
      ["a binding naming a DISABLED persona", { personas: { c1: "project:persona:retired" } }]
    ] as const) {
      assert.equal(
        await personaContextFor(conversation, { readDoc: async () => doc, resolve }),
        "",
        what
      );
    }

    // And the store itself failing — the default wraps the real read in a
    // catch, so this is the shape the provider must survive.
    assert.equal(
      await personaContextFor(conversation, {
        readDoc: async () => null,
        resolve: () => {
          throw new Error("scan exploded");
        }
      }).catch(() => "threw"),
      "",
      "a resolve that would throw is never reached when there is no binding"
    );
  } finally {
    cleanup();
  }
});

test("the contribution names the point it is registered against", () => {
  assert.equal(AGENT_FORGE_CONTEXT.from, "agent-forge");
  assert.equal(AGENT_FORGE_CONTEXT.point, CLAUDE_CONTEXT_PROVIDER_POINT);
  assert.equal(AGENT_FORGE_CONTEXT.payload.id, "agent-forge.persona");
});

/* --------------------------------------------------- the client type mirror */

test("client.ts's PersonaInfo/SkillInfo still match forge.ts's", () => {
  const fields = (file: string, name: string): string[] => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", file), "utf8");
    const at = src.indexOf(`interface ${name} {`);
    assert.ok(at >= 0, `${file} declares no interface ${name}`);
    const body = src.slice(at, src.indexOf("\n}", at));
    return [...body.matchAll(/^\s*(?:readonly\s+)?([A-Za-z][A-Za-z0-9]*)\??:/gm)]
      .map((m) => m[1]!)
      .sort();
  };
  for (const name of ["PersonaInfo", "SkillInfo"]) {
    assert.deepEqual(
      fields("src/plugins/agent-forge/client.ts", name),
      fields("src/plugins/agent-forge/forge.ts", name),
      `${name} has drifted between the server reader and the client mirror`
    );
  }
});
