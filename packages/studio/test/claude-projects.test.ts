/**
 * PROJECTS — `axf-claude` P4. Its gate, verbatim: *"a project's instructions
 * and cwd demonstrably reach the CLI invocation"*.
 *
 * "Demonstrably" is why the transport is injected rather than spawned: the
 * seam (`ClaudeTransport`) hands back the exact `BrokerChatParams` the broker
 * would have turned into a command line, so `params.cwd` and `params.system`
 * are the invocation, read at the last point before `node:child_process` sees
 * them. Asserting on the record instead would prove the record, which is one
 * layer short of the claim.
 *
 * The same split `test/claude-subsystem.test.ts` states holds here: unit tests
 * must not depend on a subscription being logged in, and the live half is
 * `/api/claude/consumer-proof` on :3200.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Registry } from "@axf/core";

import { ClaudeService, type ClaudeTransport } from "@axs/claude/service";
import { ConversationStore } from "@axs/claude/store";
import {
  composeProjectSystem,
  KNOWLEDGE_LIMITS,
  loadKnowledge,
  ProjectStore,
  resolveKnowledge
} from "@axs/claude/projects";
import type { ProjectRecord } from "@axs/claude/types";
import type { BrokerChatParams } from "@axs/server/claudeBroker";

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "axs-claude-projects-"));

const SESSION = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

/** A transport that records its params and replays one successful turn. */
function scripted(calls: BrokerChatParams[]): ClaudeTransport {
  return async (p, emit) => {
    calls.push(p);
    emit({ type: "done", text: "ok", sessionId: p.sessionId ?? SESSION });
  };
}

interface Harness {
  service: ClaudeService;
  calls: BrokerChatParams[];
  /** A real directory a project can legally bind to. */
  repo: string;
  conversations: string;
  /** The project documents' root — how a test reaches PAST the service to
   *  simulate a project file vanishing on disk, which the service itself
   *  refuses to do. */
  projectsRoot: string;
}

function harness(): Harness {
  const root = tmpRoot();
  const repo = path.join(root, "repo");
  const conversations = path.join(root, "conversations");
  const projectsRoot = path.join(root, "projects");
  fs.mkdirSync(repo, { recursive: true });
  const calls: BrokerChatParams[] = [];
  return {
    service: new ClaudeService({
      store: new ConversationStore(conversations),
      projects: new ProjectStore(projectsRoot),
      transport: scripted(calls),
      points: new Registry()
    }),
    calls,
    repo,
    conversations,
    projectsRoot
  };
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------
test("GATE: a project's instructions, knowledge and cwd reach the CLI invocation", async () => {
  const { service, calls, repo } = harness();
  fs.writeFileSync(path.join(repo, "SPEC.md"), "THE-WIRE-FORMAT-IS-NDJSON", "utf8");

  const project = await service.createProject({
    name: "The repo",
    cwd: repo,
    instructions: "ALWAYS-RUN-THE-TYPECHECK",
    knowledge: [{ path: "SPEC.md", note: "the wire contract" }],
    model: "opus-5",
    effort: "high",
    permissionMode: "acceptEdits"
  });

  const conversation = await service.start({ projectId: project.id, title: "in the project" });
  await (await service.send(conversation.id, "go")).done;

  const params = calls[0];
  assert.ok(params, "the transport was never called");

  // 1 — the CWD reaches the invocation, as the process's working directory.
  assert.equal(params.cwd, repo, "the project's bound directory did not reach the CLI");

  // 2 — the INSTRUCTIONS reach it, in the system contract.
  assert.match(params.system, /ALWAYS-RUN-THE-TYPECHECK/);

  // 3 — and the cwd reaches it a second way, as a STATEMENT the model reads.
  //     Setting the process's cwd tells the CLI; naming it tells the model,
  //     which is the "surface it deliberately" half of the step.
  assert.ok(
    params.system.includes(repo),
    "the working directory is set on the process but never stated to the model"
  );
  assert.match(params.system, /# Project: The repo/);

  // 4 — the knowledge file's CONTENTS reach it, under its note.
  assert.match(params.system, /THE-WIRE-FORMAT-IS-NDJSON/);
  assert.match(params.system, /SPEC\.md — the wire contract/);

  // 5 — and the three inherited settings reached the command line too.
  assert.equal(params.model, "claude-opus-5");
  assert.equal(params.effort, "high");
  assert.equal(params.permissionMode, "acceptEdits");
});

test("RED: without a project, none of that is in the invocation", async () => {
  // The mutation half of the gate above. Every assertion there would pass
  // vacuously against a `system` that happened to contain the words, so the
  // same conversation started with no project must contain none of them —
  // otherwise the gate is measuring the fixture rather than the wiring.
  const { service, calls, repo } = harness();
  const conversation = await service.start({ cwd: repo });
  await (await service.send(conversation.id, "go")).done;

  assert.equal(calls[0]?.cwd, repo, "an explicit cwd is still honoured without a project");
  assert.equal(calls[0]?.system, "", "a project-less conversation carried a project contract");
});

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------
test("a project written by one store instance is read whole by a fresh one", async () => {
  const root = tmpRoot();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "axs-repo-"));
  const first = new ProjectStore(root);
  const created = await first.create({
    name: "Survivor",
    cwd: repo,
    instructions: "keep going",
    knowledge: [{ path: "a.md" }],
    model: "sonnet-5",
    effort: null,
    permissionMode: "default"
  });

  const second = new ProjectStore(root);
  const loaded = await second.load(created.id);
  assert.ok(loaded, "the project did not survive");
  assert.equal(loaded.name, "Survivor");
  assert.equal(loaded.cwd, repo);
  assert.deepEqual(loaded.knowledge, [{ path: "a.md" }]);
  assert.equal((await second.list()).length, 1);
});

test("the project store refuses anything that is not a project id", async () => {
  const store = new ProjectStore(tmpRoot());
  await assert.rejects(() => store.load("../../etc/passwd"), /not a project id/);
  await assert.rejects(() => store.mutate("nope", (r) => r), /not a project id/);
  assert.equal(await store.load("22222222-3333-4444-8555-666666666666"), null);
});

test("projects list alphabetically, not by recency", async () => {
  // Deliberately unlike conversations: a project list is an index, and an index
  // that reorders itself every time you use an entry is one you re-scan.
  const { service, repo } = harness();
  for (const name of ["Zebra", "Alpha", "Mango"]) {
    await service.createProject({ name, cwd: repo });
  }
  assert.deepEqual(
    (await service.listProjects()).map((p) => p.name),
    ["Alpha", "Mango", "Zebra"]
  );
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
test("a project needs a name and a working directory that exists", async () => {
  const { service, repo } = harness();
  await assert.rejects(() => service.createProject({ name: "  ", cwd: repo }), /needs a name/);
  await assert.rejects(
    () => service.createProject({ name: "x".repeat(200), cwd: repo }),
    /cannot exceed/
  );
  await assert.rejects(
    () => service.createProject({ name: "No tree", cwd: "" }),
    /needs a working directory/
  );
  await assert.rejects(
    () => service.createProject({ name: "Ghost", cwd: path.join(repo, "nope") }),
    /not an existing directory/
  );
  // A FILE is not a directory, and the difference is the whole of the binding.
  const file = path.join(repo, "a-file.txt");
  fs.writeFileSync(file, "x", "utf8");
  await assert.rejects(
    () => service.createProject({ name: "A file", cwd: file }),
    /not an existing directory/
  );
});

test("the knowledge list is validated for what costs money to get wrong", async () => {
  const { service, repo } = harness();
  await assert.rejects(
    () => service.createProject({ name: "Blank", cwd: repo, knowledge: [{ path: "  " }] }),
    /non-empty path/
  );
  await assert.rejects(
    () =>
      service.createProject({
        name: "Twice",
        cwd: repo,
        knowledge: [{ path: "a.md" }, { path: "A.MD" }]
      }),
    /listed twice/
  );
  await assert.rejects(
    () =>
      service.createProject({
        name: "Too many",
        cwd: repo,
        knowledge: Array.from({ length: KNOWLEDGE_LIMITS.files + 1 }, (_, i) => ({
          path: `f${i}.md`
        }))
      }),
    /at most/
  );

  // A path that does not exist is ACCEPTED — a project is routinely written
  // before the file is. `projectKnowledge()` is what reports it, and the editor
  // shows that readout, which is where a typo is meant to be caught.
  const project = await service.createProject({
    name: "Planned",
    cwd: repo,
    knowledge: [{ path: "not-written-yet.md" }]
  });
  const status = await service.projectKnowledge(project.id);
  assert.equal(status.length, 1);
  assert.equal(status[0]?.exists, false);
  assert.equal(status[0]?.resolved, path.join(repo, "not-written-yet.md"));
});

test("an unknown model or effort on a project is refused, never silently defaulted", async () => {
  const { service, repo } = harness();
  await assert.rejects(
    () => service.createProject({ name: "Bad model", cwd: repo, model: "opus-9" }),
    /unknown model "opus-9"/
  );
  await assert.rejects(
    () => service.createProject({ name: "Bad effort", cwd: repo, effort: "colossal" }),
    /unknown effort/
  );
  // Omitted, they fall to the catalog default and "do not pass --effort".
  const plain = await service.createProject({ name: "Plain", cwd: repo });
  assert.equal(plain.model, "sonnet-5");
  assert.equal(plain.effort, null);
  assert.equal(plain.permissionMode, "default");
});

// ---------------------------------------------------------------------------
// Inheritance — what is copied, what is read live, and what is BOUND
// ---------------------------------------------------------------------------
test("a conversation copies the project's cwd, model, effort and permission mode", async () => {
  const { service, repo } = harness();
  const project = await service.createProject({
    name: "Defaults",
    cwd: repo,
    model: "haiku-4-5",
    effort: "low",
    permissionMode: "plan"
  });
  const conversation = await service.start({ projectId: project.id });
  assert.equal(conversation.projectId, project.id);
  assert.equal(conversation.cwd, repo);
  assert.equal(conversation.model, "haiku-4-5");
  assert.equal(conversation.effort, "low");
  assert.equal(conversation.permissionMode, "plan");
});

test("the three defaults are overridable per conversation; the cwd is BOUND", async () => {
  const { service, repo } = harness();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "axs-other-"));
  const project = await service.createProject({
    name: "Bound",
    cwd: repo,
    model: "haiku-4-5",
    effort: "low"
  });

  // A model genuinely varies turn to turn — the override is honoured.
  const custom = await service.start({ projectId: project.id, model: "opus-5", effort: "max" });
  assert.equal(custom.model, "opus-5");
  assert.equal(custom.effort, "max");
  assert.equal(custom.cwd, repo, "the bound directory was overridden by a model choice");

  // A repository does not. A conflicting cwd is REFUSED rather than either
  // silently winning or being silently dropped — a conversation filed under a
  // project but running elsewhere is a lie in the library's most useful column.
  await assert.rejects(
    () => service.start({ projectId: project.id, cwd: other }),
    /disagrees with project "Bound"/
  );
  // The same directory stated redundantly is not a conflict.
  const agreeing = await service.start({ projectId: project.id, cwd: repo });
  assert.equal(agreeing.cwd, repo);

  // …nor is the same directory in a different DIALECT. On Windows one tree has
  // several true spellings, and refusing a start that named the right one in
  // the wrong one produces a message whose two paths look identical to a
  // reader — the least actionable refusal available.
  // A real subdirectory, so the `..` case is a path the OS can stat rather
  // than one `path.join` would have flattened before anything looked.
  fs.mkdirSync(path.join(repo, "sub"), { recursive: true });
  for (const spelling of [
    `${repo}${path.sep}`,
    repo.replaceAll("\\", "/"),
    `${repo}${path.sep}sub${path.sep}..`
  ]) {
    const same = await service.start({ projectId: project.id, cwd: spelling });
    assert.equal(same.cwd, repo, `"${spelling}" was read as a different directory`);
  }
});

test("an unknown project is refused before any conversation is created", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.start({ projectId: "22222222-3333-4444-8555-666666666666" }),
    /does not exist/
  );
  assert.deepEqual(await service.list(), [], "a refusal left a conversation behind");
});

test("editing the instructions reaches the next first turn; editing the cwd does not move a live one", async () => {
  const { service, calls, repo } = harness();
  const moved = fs.mkdtempSync(path.join(os.tmpdir(), "axs-moved-"));
  const project = await service.createProject({
    name: "Edited",
    cwd: repo,
    instructions: "FIRST-VERSION"
  });
  const first = await service.start({ projectId: project.id });
  await (await service.send(first.id, "one")).done;
  assert.match(calls[0]!.system, /FIRST-VERSION/);

  await service.updateProject(project.id, { instructions: "SECOND-VERSION", cwd: moved });

  // The existing conversation keeps its own copied cwd — a --resume whose
  // working directory moved is a session whose remembered tool calls no longer
  // describe the tree it is standing in.
  assert.equal((await service.get(first.id))?.cwd, repo);
  await (await service.send(first.id, "two")).done;
  assert.equal(calls[1]!.cwd, repo, "an edit moved a live conversation's working directory");

  // A NEW conversation gets both edits.
  const second = await service.start({ projectId: project.id });
  await (await service.send(second.id, "three")).done;
  assert.equal(calls[2]!.cwd, moved);
  assert.match(calls[2]!.system, /SECOND-VERSION/);
  assert.doesNotMatch(calls[2]!.system, /FIRST-VERSION/);
});

test("the project contract is composed on the first turn only, and the conversation's own system follows it", async () => {
  const { service, calls, repo } = harness();
  const project = await service.createProject({
    name: "Framed",
    cwd: repo,
    instructions: "PROJECT-RULE"
  });
  const conversation = await service.start({ projectId: project.id, system: "CONVERSATION-RULE" });
  await (await service.send(conversation.id, "one")).done;

  const system = calls[0]!.system;
  assert.ok(
    system.indexOf("PROJECT-RULE") < system.indexOf("CONVERSATION-RULE"),
    "the conversation's own contract came before the frame it narrows"
  );

  // Turn two resumes, and the broker ignores `system` under --resume anyway —
  // so re-reading the project there would spend the knowledge read on nothing.
  await (await service.send(conversation.id, "two")).done;
  assert.equal(calls[1]!.system, "CONVERSATION-RULE");
});

test("a conversation whose project VANISHED still runs, without its contract", async () => {
  // Not reachable through the service — `removeProject` refuses exactly this,
  // and the test below watches it refuse. What IS reachable is somebody
  // deleting the document on disk, or restoring a conversations directory
  // beside a projects directory that does not match. The degradation must be a
  // warned-about missing contract, never a turn that dies.
  const { service, calls, repo, projectsRoot } = harness();
  const project = await service.createProject({
    name: "Doomed",
    cwd: repo,
    instructions: "GONE-SOON"
  });
  const conversation = await service.start({ projectId: project.id });
  await new ProjectStore(projectsRoot).remove(project.id);
  assert.equal(await service.getProject(project.id), null, "the project is still readable");

  const result = await (await service.send(conversation.id, "still works?")).done;
  assert.equal(result.ok, true, "losing a project killed the conversation");
  assert.equal(calls[0]!.cwd, repo, "the conversation lost its own copied working directory");
  assert.doesNotMatch(calls[0]!.system, /GONE-SOON/);
});

// ---------------------------------------------------------------------------
// Deleting a project
// ---------------------------------------------------------------------------
test("deleting a project is refused while conversations belong to it, and counts them", async () => {
  const { service, repo } = harness();
  const project = await service.createProject({ name: "Populated", cwd: repo });
  await service.start({ projectId: project.id });
  await service.start({ projectId: project.id });

  await assert.rejects(
    () => service.removeProject(project.id),
    /still holds 2 conversations/,
    "a project was deleted out from under its conversations, orphaning their projectId"
  );

  // `detach` unfiles them and keeps them: they come back as project-less
  // conversations rather than pointing at nothing, which would hide them from
  // every filter INCLUDING "none".
  assert.equal(await service.removeProject(project.id, { detach: true }), true);
  const metas = await service.list();
  assert.equal(metas.length, 2);
  assert.deepEqual(
    metas.map((m) => m.projectId),
    [null, null]
  );
  // Deleting the deleted is an answer, not a failure.
  assert.equal(await service.removeProject(project.id), false);
});

test("a conversation's projectId reaches the meta, so a library can filter without loading bodies", async () => {
  const { service, repo } = harness();
  const project = await service.createProject({ name: "Filterable", cwd: repo });
  const inside = await service.start({ projectId: project.id });
  const outside = await service.start({ cwd: repo });

  const metas = await service.list();
  assert.equal(metas.find((m) => m.id === inside.id)?.projectId, project.id);
  assert.equal(
    metas.find((m) => m.id === outside.id)?.projectId,
    null,
    "an absent projectId did not read as 'no project'"
  );
});

// ---------------------------------------------------------------------------
// Knowledge files
// ---------------------------------------------------------------------------
test("knowledge paths resolve relative to the bound directory, and absolute paths are taken as written", async () => {
  const root = tmpRoot();
  const repo = path.join(root, "repo");
  const outside = path.join(root, "outside");
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "in.md"), "INSIDE", "utf8");
  const absolute = path.join(outside, "style-guide.md");
  fs.writeFileSync(absolute, "OUTSIDE", "utf8");

  const project: ProjectRecord = {
    format: "axs-claude-project/1",
    id: "00000000-0000-4000-8000-000000000000",
    name: "Paths",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    cwd: repo,
    instructions: "",
    knowledge: [{ path: "docs/in.md" }, { path: absolute }, { path: "missing.md" }],
    model: "sonnet-5",
    effort: null,
    permissionMode: "default"
  };

  const status = await resolveKnowledge(project);
  assert.equal(status[0]?.resolved, path.join(repo, "docs", "in.md"));
  assert.equal(status[0]?.exists, true);
  assert.equal(status[1]?.resolved, absolute);
  assert.equal(status[1]?.exists, true);
  assert.equal(status[2]?.exists, false);

  // The missing one is SKIPPED, not thrown on and not announced to the model:
  // a turn must not fail because a note was renamed, and the model cannot act
  // on the operator's typo. The readout above is what can.
  const loaded = await loadKnowledge(project);
  assert.deepEqual(
    loaded.map((f) => f.text),
    ["INSIDE", "OUTSIDE"]
  );
});

test("an oversized knowledge file is truncated, and the cut is stated to the model", async () => {
  // Silent truncation is a model answering confidently from a document's first
  // half. The cap itself is not the interesting part; saying so is.
  const root = tmpRoot();
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const big = "x".repeat(KNOWLEDGE_LIMITS.bytesPerFile + 5000);
  fs.writeFileSync(path.join(repo, "big.md"), big, "utf8");

  const project: ProjectRecord = {
    format: "axs-claude-project/1",
    id: "00000000-0000-4000-8000-000000000001",
    name: "Big",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    cwd: repo,
    instructions: "",
    knowledge: [{ path: "big.md" }],
    model: "sonnet-5",
    effort: null,
    permissionMode: "default"
  };

  assert.equal((await resolveKnowledge(project))[0]?.truncated, true);

  const loaded = await loadKnowledge(project);
  assert.equal(loaded[0]?.truncated, true);
  assert.equal(loaded[0]?.text.length, KNOWLEDGE_LIMITS.bytesPerFile);
  assert.match(composeProjectSystem(project, loaded), /TRUNCATED/);
});

test("the composed contract survives a knowledge file that contains code fences", async () => {
  // Every README in this repo has ``` in it. A three-backtick fence around the
  // contents would be closed by the first one, and the rest of the file would
  // read to the model as prose outside the block.
  const project: ProjectRecord = {
    format: "axs-claude-project/1",
    id: "00000000-0000-4000-8000-000000000002",
    name: "Fenced",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    cwd: path.sep === "\\" ? "C:\\tmp" : "/tmp",
    instructions: "",
    knowledge: [],
    model: "sonnet-5",
    effort: null,
    permissionMode: "default"
  };
  const text = "before\n```js\nconst a = 1;\n```\nafter";
  const composed = composeProjectSystem(project, [{ path: "r.md", text, truncated: false }]);
  const fence = "``````";
  assert.equal(
    composed.split(fence).length - 1,
    2,
    "the wrapper fence is not longer than the fences inside the file it wraps"
  );
  assert.ok(composed.includes(text), "the file's own fences were mangled");
});

test("the composed contract states the working directory even with no instructions", async () => {
  // The minimum a project is: a bound tree. It must still reach the model, or
  // an instruction-less project would be indistinguishable from none.
  const cwd = path.sep === "\\" ? "C:\\Home\\Projects\\thing" : "/home/projects/thing";
  const project: ProjectRecord = {
    format: "axs-claude-project/1",
    id: "00000000-0000-4000-8000-000000000003",
    name: "Bare",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    cwd,
    instructions: "",
    knowledge: [],
    model: "sonnet-5",
    effort: null,
    permissionMode: "default"
  };
  const composed = composeProjectSystem(project, []);
  assert.ok(composed.includes(cwd));
  assert.doesNotMatch(composed, /## Project instructions/);
  assert.doesNotMatch(composed, /## Project knowledge/);
});

// ---------------------------------------------------------------------------
// The routes go through the front door, like every other consumer
// ---------------------------------------------------------------------------
test("the conversations route forwards every StartOptions field", () => {
  /*
   * A source pin, and it exists because the bug it prevents actually shipped
   * for the length of one probe run.
   *
   * `projectId` was added to `StartOptions`, to the service, to the browser
   * client and to the start dialog — and `app/api/claude/conversations/route.ts`
   * was not touched, so it kept destructuring the six fields it already knew.
   * Every conversation started from the UI came back filed under NO project,
   * with a correct-looking record and a 201. Nothing detected it: the unit
   * tests call `service.start()` directly and the type system cannot see a
   * missing OPTIONAL property in an object literal.
   *
   * So the pin is on the one thing that would have caught it — the two lists
   * agreeing — and it is a source scan for the same reason
   * `ctx-conformance`'s registrar scan is: the route's parameter object is not
   * reachable at runtime without a service, and a runtime probe of the route
   * needs a filesystem the singleton owns.
   *
   * It refuses to answer emptily on both sides, because a scanner that finds
   * nothing certifies everything.
   */
  const strip = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join("\n");

  const serviceSource = strip(
    fs.readFileSync(path.resolve(import.meta.dirname, "..", "src", "claude", "service.ts"), "utf8")
  );
  const declared = /export interface StartOptions \{([\s\S]*?)\n\}/.exec(serviceSource);
  assert.ok(declared, "StartOptions is not declared in the shape this scanner reads");
  const fields = [...declared[1]!.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => m[1]!).sort();
  assert.ok(fields.length >= 5, `StartOptions scan found only ${fields.length} field(s)`);

  const routeSource = strip(
    fs.readFileSync(
      path.resolve(import.meta.dirname, "..", "app", "api", "claude", "conversations", "route.ts"),
      "utf8"
    )
  );
  // `claudeServiceFor(request)` since P2 of `default-state` (2026-08-14): the
  // route goes through the request-scoped front door so conversations land in
  // the signed-in user's tree. The pin is exactly as strict as before — one
  // literal call shape — it just names the current front door.
  const call = /claudeServiceFor\(request\)\.start\(\{([\s\S]*?)\n\s*\}\)/.exec(routeSource);
  assert.ok(call, "the conversations route no longer calls start() in the shape this scanner reads");
  const forwarded = [...call[1]!.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]!).sort();

  assert.deepEqual(
    forwarded,
    fields,
    "the conversations POST route does not forward every StartOptions field — a field added to " +
      "the service and not to the route is silently dropped on the wire, with a 201 and a " +
      "correct-looking record"
  );
});

test("the project routes touch no subsystem internals", () => {
  const files = [
    path.resolve(import.meta.dirname, "..", "app", "api", "claude", "projects", "route.ts"),
    path.resolve(import.meta.dirname, "..", "app", "api", "claude", "projects", "[id]", "route.ts")
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";$/gm)].map((m) => m[1]!);
    assert.ok(imports.length >= 1, `${path.basename(file)}: the import scan found nothing`);
    for (const forbidden of ["claude/store", "claude/projects", "claudeBroker", "axfKv"]) {
      assert.ok(
        !imports.some((i) => i.includes(forbidden)),
        `${path.relative(process.cwd(), file)} reached past the service API into "${forbidden}"`
      );
    }
  }
});
