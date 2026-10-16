/**
 * `npm run agent <moduleId>` — build the agent that ships with a module.
 *
 *     npm run agent taskman            one module, prompting for the name
 *     npm run agent -- --all           every module in src/modules
 *     npm run agent taskman -- --yes   accept the derivation, ask nothing
 *     npm run agent taskman -- --refresh   re-derive skill bodies, dropping edits
 *
 * The peel runs this too (`scripts/peel.mjs`, step 6a), which is what makes the
 * owner's sentence true: *every module gets an agent, every time it is built*,
 * and a compiled app ships with it because the bundle lives inside the module's
 * own directory.
 *
 * ## What it does
 *
 *   1. Loads `src/modules/<id>/<id>.decl.ts` through the SHARED closure
 *      resolver — the same data-only import the peel and the suite use, so an
 *      agent is derived from exactly the declaration the runtime registers.
 *   2. Derives a full draft (scripts/lib/module-agent.mjs): a name, a persona
 *      written from the module's real commands/settings/points, one skill per
 *      function of the module, and its tool definitions.
 *   3. **Asks the owner.** The name is the one field derivation cannot know,
 *      and while they are answering they can edit everything else.
 *   4. Writes `src/modules/<id>/agent/`.
 *
 * ## Three prompt surfaces, in order — owner's call, 2026-08-13
 *
 *   1. **The studio's own dialog.** If a dev server is up, the draft is posted
 *      to `/api/assistant/agent-inbox` and this script waits while the owner
 *      edits it in the app, in the app's own theme, with the persona in a real
 *      text area. Best surface, and the only one that can show the roster it is
 *      joining.
 *   2. **PyQt6.** No server, or nobody answered: a desktop window
 *      (`scripts/agent-prompt.py`) with the same fields. Same reason GizmoX's
 *      capture has one — a build is not always run beside a browser.
 *   3. **The terminal.** No Python either: a readline form with every value
 *      pre-filled and editable in place.
 *
 * Each tier falls through on absence, never on refusal: a CANCEL in any surface
 * cancels the build step (leaving any existing bundle alone) rather than
 * dropping to the next one and asking again.
 *
 * `--yes` skips the prompt entirely — for CI, and for the peel when it is run
 * non-interactively. A build that cannot ask still gets an agent; what it does
 * not get is a name somebody chose.
 *
 * Zero dependencies, Node ≥ 23 (native type stripping for the decl import).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";

import { listModuleDirs, loadModuleDecl } from "./lib/closure.mjs";
import {
  applyEdits,
  bundleDir,
  deriveDraft,
  readBundle,
  writeBundle
} from "./lib/module-agent.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const CORE = path.resolve(STUDIO, "..", "core");

/* ── arguments ────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
const opts = new Map(
  argv.filter((a) => a.startsWith("--") && a.includes("=")).map((a) => a.slice(2).split("=", 2))
);
const positional = argv.filter((a) => !a.startsWith("--"));

const ALL = flags.has("--all");
const YES = flags.has("--yes");
const REFRESH = flags.has("--refresh");
const NO_UI = flags.has("--no-ui");
const NO_QT = flags.has("--no-qt");
const PORT = Number(opts.get("port") ?? process.env.AXS_PORT ?? 3200) || 3200;
const SOURCE = opts.get("source") ?? "agent";
/** How long the studio dialog gets before the build tries another surface. */
const UI_WAIT_MS = Number(opts.get("wait") ?? 300) * 1000;

function fail(message) {
  console.error(`\nagent: ${message}`);
  process.exit(1);
}

if (!ALL && positional.length === 0) {
  fail("usage: npm run agent <moduleId> [-- --all --yes --refresh --no-ui --port=3200]");
}

/* ── the studio dialog ────────────────────────────────────────────────────── */

const inboxUrl = `http://127.0.0.1:${PORT}/api/assistant/agent-inbox`;

async function fetchJson(url, init, timeoutMs = 4000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Is a studio listening, and does it know this route? A 404 means an older
 *  build without the inbox — that is an absence, so fall through. */
async function studioIsUp() {
  if (NO_UI) return false;
  const res = await fetchJson(inboxUrl, { method: "GET" }, 2000);
  return Boolean(res?.ok);
}

/**
 * Post the draft and wait for the dialog. Returns the accepted draft, `null`
 * when the owner cancelled (the caller must NOT try another surface), or
 * `undefined` when nobody answered in time (fall through).
 */
async function promptInStudio(draft) {
  const opened = await fetchJson(inboxUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft, module: draft.module, source: SOURCE })
  });
  if (!opened?.ok || !opened.body?.id) return undefined;
  const id = opened.body.id;
  console.log(
    `  waiting for the studio dialog on :${PORT} — the "Name this module's agent" window is open in the app`
  );
  const deadline = Date.now() + UI_WAIT_MS;
  let dot = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetchJson(`${inboxUrl}?id=${encodeURIComponent(id)}`, { method: "GET" }, 3000);
    const entry = res?.body?.request;
    if (!entry) continue;
    if (entry.status === "resolved" && entry.result) {
      await fetchJson(`${inboxUrl}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      process.stdout.write("\n");
      return entry.result;
    }
    if (entry.status === "cancelled") {
      await fetchJson(`${inboxUrl}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      process.stdout.write("\n");
      return null;
    }
    if (++dot % 10 === 0) process.stdout.write(".");
  }
  // Nobody looked at the tab. Withdraw the request so a later glance does not
  // open a dialog for a build that has already moved on.
  await fetchJson(`${inboxUrl}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  console.log("\n  the studio dialog was not answered — trying the desktop prompt");
  return undefined;
}

/* ── the PyQt6 dialog ─────────────────────────────────────────────────────── */

/** The first interpreter on this machine that can `import PyQt6`. Checked
 *  rather than assumed: an absent Qt is a fall-through, not a crash. */
function findPython() {
  const candidates = [process.env.AXS_PYTHON, "python", "python3", "py"].filter(Boolean);
  for (const exe of candidates) {
    const probe = spawnSync(exe, ["-c", "import PyQt6"], { stdio: "ignore", shell: true });
    if (probe.status === 0) return exe;
  }
  return null;
}

/** Same three answers as the studio tier: draft, `null` (cancelled), or
 *  `undefined` (no Qt here — fall through). */
function promptInQt(draft) {
  if (NO_QT) return undefined;
  const python = findPython();
  if (!python) return undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axs-agent-"));
  const inFile = path.join(dir, "draft.json");
  const outFile = path.join(dir, "result.json");
  fs.writeFileSync(inFile, JSON.stringify(draft, null, 2), "utf8");
  const script = path.join(import.meta.dirname, "agent-prompt.py");
  const run = spawnSync(python, [script, inFile, outFile], { stdio: "inherit", shell: true });
  try {
    if (run.status === 0 && fs.existsSync(outFile)) {
      return JSON.parse(fs.readFileSync(outFile, "utf8"));
    }
    // 2 is the dialog's own "cancelled"; anything else is a Qt that failed to
    // open, which is an absence and falls through.
    return run.status === 2 ? null : undefined;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ── the terminal form ────────────────────────────────────────────────────── */

/** Ask with the current value already typed in, so Enter accepts and the owner
 *  edits in place. `rl.write` is what puts it in the buffer; without a TTY
 *  there is nobody to edit it, so the value is simply kept. */
function ask(rl, question, value) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim() === "" ? value : answer.trim()));
    if (value) rl.write(value);
  });
}

async function promptInTerminal(draft) {
  if (!process.stdin.isTTY) {
    console.log("  not a terminal and no other surface — keeping the derived draft");
    return draft;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("");
    console.log(`  Naming the agent for "${draft.module}". Enter accepts what is shown.`);
    if (draft.nameOptions?.length) {
      console.log(`  suggestions: ${draft.nameOptions.join(" · ")}`);
    }
    const name = await ask(rl, "  name        ", draft.name);
    const description = await ask(rl, "  description ", draft.description);
    const cliTools = (await ask(rl, "  tools       ", draft.cliTools.join(", ")))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(`  skills      ${draft.skills.map((s) => s.slug).join(", ")}`);
    const keep = (await ask(rl, "  keep skills ", draft.skills.map((s) => s.slug).join(", ")))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const skills = draft.skills.filter((s) => keep.includes(s.slug));
    console.log(`  module tools ${draft.tools.map((t) => t.name).join(", ")}`);
    const persona = await editPersona(rl, draft.persona);
    return { ...draft, name, description, cliTools, skills, persona };
  } finally {
    rl.close();
  }
}

/** The persona is thirty lines of markdown; a readline field is the wrong shape
 *  for it, so the terminal tier opens $EDITOR on request and otherwise keeps
 *  the derived text (which is the whole point of deriving it). */
async function editPersona(rl, persona) {
  const editor = process.env.VISUAL || process.env.EDITOR;
  const answer = await ask(
    rl,
    `  persona     [${persona.split("\n").length} lines] edit in ${editor || "an editor"}? y/N `,
    ""
  );
  if (!/^y(es)?$/i.test(answer)) return persona;
  if (!editor) {
    console.log("  no $EDITOR set — keeping the derived persona");
    return persona;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axs-persona-"));
  const file = path.join(dir, "persona.md");
  fs.writeFileSync(file, persona, "utf8");
  await new Promise((resolve) => {
    const child = spawn(editor, [file], { stdio: "inherit", shell: true });
    child.on("close", resolve);
    child.on("error", resolve);
  });
  try {
    return fs.readFileSync(file, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ── the merge ────────────────────────────────────────────────────────────── */

/**
 * Fold an existing bundle into a fresh derivation.
 *
 * The rule, and the reason for each half:
 *
 *   - **The owner's words win.** Name, description, persona, provider/model and
 *     the CLI tool list come from the existing bundle. They were chosen; a
 *     rebuild that reset them would make the prompt pointless and would rename
 *     somebody's agent every time they touched the module. `--refresh` re-derives
 *     the description and the persona — that is what the flag is for — but even
 *     it keeps the NAME, because renaming an agent people talk to should never
 *     be a side effect of a flag about staleness.
 *   - **The FACTS refresh.** Tool definitions are re-derived every time,
 *     because their enums are the module's real command names and setting keys
 *     — a stale enum is a tool that offers a command that no longer exists.
 *   - **Skill bodies are kept, and drift is REPORTED.** A skill body may have
 *     been edited by hand, so it survives; but when the derivation no longer
 *     matches what is on disk the build says so and names `--refresh`. Silent
 *     staleness and silent overwriting are both worse than a printed line.
 */
function merge(fresh, existing, notes) {
  if (!existing) return fresh;
  const skills = fresh.skills.map((derived) => {
    const prior = existing.skills.find((s) => s.slug === derived.slug);
    if (!prior) return derived;
    if (REFRESH) return derived;
    if (prior.body.trim() !== derived.body.trim()) {
      notes.push(`skill "${derived.slug}" differs from the declaration — keeping yours (--refresh takes the new one)`);
    }
    return prior;
  });
  // A skill the owner added by hand has no derived counterpart; it is theirs,
  // so it stays. One whose subject left the declaration also stays — dropping
  // it is what `--refresh` is for.
  for (const prior of existing.skills) {
    if (!skills.some((s) => s.slug === prior.slug)) {
      if (REFRESH) notes.push(`dropped skill "${prior.slug}" — no longer derived from the declaration`);
      else skills.push(prior);
    }
  }
  return {
    ...fresh,
    // The NAME is a choice, not a derivation, so it survives even a --refresh:
    // an agent people talk to should not be renamed by a flag about staleness.
    name: existing.name || fresh.name,
    provider: existing.provider ?? fresh.provider,
    model: existing.model ?? fresh.model,
    cliTools: existing.cliTools.length ? existing.cliTools : fresh.cliTools,
    description: REFRESH ? fresh.description : existing.description || fresh.description,
    persona: REFRESH ? fresh.persona : existing.persona || fresh.persona,
    skills
  };
}

/* ── one module ───────────────────────────────────────────────────────────── */

/**
 * The names the OTHER modules' agents already answer to, so a suggestion never
 * proposes a second Hazel. Read off disk each time rather than tracked across
 * the run, because a single-module build has to see the same set an `--all`
 * build does.
 */
function takenNames(exceptModuleId) {
  const taken = new Set();
  for (const id of listModuleDirs(STUDIO)) {
    if (id === exceptModuleId) continue;
    const bundle = readBundle(path.join(STUDIO, "src", "modules", id));
    if (bundle?.name) taken.add(bundle.name);
  }
  return taken;
}

async function buildOne(moduleId) {
  let decl, moduleDir;
  try {
    ({ decl, moduleDir } = await loadModuleDecl(STUDIO, moduleId, CORE));
  } catch (err) {
    return { moduleId, skipped: String(err?.message ?? err) };
  }

  const notes = [];
  const existing = readBundle(moduleDir);
  const draft = merge(deriveDraft(decl, takenNames(moduleId)), existing, notes);

  console.log("");
  console.log(`▸ ${decl.title} (${moduleId}) — ${existing ? "rebuilding" : "first build"}`);
  console.log(`  skills      ${draft.skills.length}: ${draft.skills.map((s) => s.slug).join(", ")}`);
  console.log(`  tools       ${draft.tools.length}: ${draft.tools.map((t) => t.name).join(", ")}`);
  for (const note of notes) console.log(`  note        ${note}`);

  let accepted = draft;
  if (!YES) {
    let answer;
    if (await studioIsUp()) answer = await promptInStudio(draft);
    if (answer === undefined) answer = promptInQt(draft);
    if (answer === undefined) answer = await promptInTerminal(draft);
    if (answer === null) {
      console.log("  cancelled — the bundle on disk is unchanged");
      return { moduleId, cancelled: true };
    }
    accepted = applyEdits(decl, draft, answer);
  }

  const files = writeBundle(moduleDir, accepted);
  console.log(`  wrote       ${accepted.name} → ${path.relative(STUDIO, bundleDir(moduleDir))} (${files.length} files)`);
  return { moduleId, name: accepted.name, files: files.length };
}

/* ── run ──────────────────────────────────────────────────────────────────── */

const targets = ALL ? listModuleDirs(STUDIO) : positional;
if (!targets.length) fail("no modules to build");

const results = [];
for (const moduleId of targets) {
  results.push(await buildOne(moduleId));
}

console.log("");
const built = results.filter((r) => r.files);
const skipped = results.filter((r) => r.skipped);
console.log(`agents built: ${built.length}/${targets.length}`);
for (const r of built) console.log(`  ${r.moduleId.padEnd(18)} ${r.name}`);
for (const r of results.filter((r) => r.cancelled)) console.log(`  ${r.moduleId.padEnd(18)} (cancelled)`);
for (const r of skipped) console.log(`  ${r.moduleId.padEnd(18)} SKIPPED — ${r.skipped}`);
if (skipped.length && !ALL) process.exit(1);
