/**
 * @file The assistant's agent scanner and writer — Node-only (`node:fs`), so
 * it lives behind the `.server.ts` suffix and is imported by API routes alone.
 * The browser bundle sees `types.ts` and nothing else.
 *
 * Three scanned roots plus one built-in:
 *
 *   1. `DEFAULT_AGENT` — ships in code, cannot be deleted or edited.
 *   2. The CONFIGURED agent directories (`AssistantConfig.agentDirs`, edited
 *      in the settings tab) — by default the `.claude/agents` pair Claude
 *      Code reads, `~/.claude/agents` and `<repo>/.claude/agents`. Imported
 *      live, not copied: add an agent for Claude Code and the assistant's
 *      roster grows with it. Read-only from this plugin's side — they are
 *      edited where they live (a data-root file with the same slug shadows).
 *   3. `<cwd>/data/assistant/agents/*.md` — user-authored; the Forge module's
 *      Agents tab writes here.
 *   4. `<cwd>/src/modules/<id>/agent/agent.md` — the agent a MODULE ships with,
 *      written by `npm run agent <id>` and regenerated whenever the module is
 *      built. It carries its own skills and tool definitions beside it, it is
 *      pinned to its module without configuration (`agentForModule`), and it
 *      travels into a peeled app because it lives inside the module's source.
 *   5. `<assets root>/installed/add-on/<id>/agents/*.md` — agents that arrived
 *      as INSTALLED ADD-ON ASSETS (`npm run pack <id>` with a manifest of
 *      kind "add-on"). This is the seam that makes "add agents to a compiled
 *      app as assets" real: drop a zip, run the installer, the roster grows.
 *
 * The frontmatter dialect is deliberately tiny — `key: value` scalars only,
 * parsed line-by-line rather than through a YAML library, the same trade
 * GizmoX's `persona-format.ts` made: a format a person can repair with a text
 * editor beats one that needs a parser to explain its error messages.
 *
 * Slug rule mirrors GizmoX's persona path guard: a client can never name a
 * file, only a slug that must match `SLUG_RE` — the traversal fence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { axfKv, kvUser } from "@axs/server/axfKv";
import { dataPath } from "@axs/server/dataRoot";

import { ASSISTANT_CONFIG_NS, DEFAULT_AGENT, DEFAULT_AGENT_DIRS, parseAgentDirs } from "./types";
import type { AssistantAgent, AssistantConfig, ProviderId } from "./types";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const PROVIDER_IDS = new Set<string>(["anthropic", "openai", "xai", "ollama"]);

/**
 * Claude Code's model ALIASES, mapped to ids the providers actually serve. A
 * GizmoX agent file says `model: opus-5` because the `claude` CLI resolves
 * aliases; the Messages API does not, so an alias that crossed over unmapped
 * would be an agent that errors on its first turn. An alias not listed here
 * simply drops the pin — the configured model answers, which is the same
 * fallback an agent with no `model:` line gets.
 */
const CLAUDE_MODEL_ALIASES: Readonly<Record<string, string>> = {
  opus: "claude-opus-5",
  "opus-5": "claude-opus-5",
  sonnet: "claude-sonnet-5",
  "sonnet-5": "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5",
  "fable-5": "claude-fable-5"
};

export function agentsRoot(): string {
  return dataPath("assistant", "agents");
}

/**
 * The MODULE bundles — `src/modules/<id>/agent/agent.md`, one per module that
 * has been built with `npm run agent` (or peeled, which runs the same step).
 *
 * The path is relative to the cwd and mentions nothing about Studio, which is
 * the whole trick: the dev tree has `packages/studio/src/modules/<id>/` and a
 * peeled app has `<app>/src/modules/<id>/`, so the same scanner finds the same
 * bundle in both, and a compiled module app ships with its agent because the
 * agent is part of the module's source. No install step, no copy, nothing to
 * forget.
 */
function moduleBundles(): { moduleId: string; file: string }[] {
  const root = path.join(process.cwd(), "src", "modules");
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  const found: { moduleId: string; file: string }[] = [];
  for (const moduleId of entries.sort()) {
    if (!SLUG_RE.test(moduleId)) continue;
    const file = path.join(root, moduleId, "agent", "agent.md");
    try {
      if (fs.statSync(file).isFile()) found.push({ moduleId, file });
    } catch {
      // A module with no bundle is the normal case before its first build.
    }
  }
  return found;
}

/** `["a", "b"]`, `a, b` or `a` → `["a","b"]` — the tolerant form the Forge's
 *  scanner reads, because a hand-edited frontmatter uses whichever it
 *  remembers. `"*"` is left as the single entry `*`; the CLI understands it. */
function parseList(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function addOnRoots(): string[] {
  // Installed add-on assets: <repo assets root>/installed/add-on/<id>/agents.
  // The studio runs from packages/studio, the assets root is at the repo root
  // — two levels up — matching scripts/pack.mjs's layout.
  const installed = path.join(process.cwd(), "..", "..", "assets", "installed", "add-on");
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(installed);
  } catch {
    return [];
  }
  return entries
    .map((id) => path.join(installed, id, "agents"))
    .filter((dir) => {
      try {
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

/**
 * Resolve one configured agent-directory spelling to an absolute path — the
 * server half of the portable convention `AssistantConfig.agentDirs` states:
 * `~`/`~/…` is the user's home, an absolute path is itself, anything else is
 * relative to the repo root (two levels up from `packages/studio`, matching
 * `addOnRoots`). The defaults resolve to the `.claude/agents` pair Claude Code
 * itself reads.
 */
function resolveAgentDir(spec: string): string {
  if (spec === "~") return os.homedir();
  if (spec.startsWith("~/") || spec.startsWith("~\\")) {
    return path.join(os.homedir(), spec.slice(2));
  }
  if (path.isAbsolute(spec)) return spec;
  return path.join(process.cwd(), "..", "..", spec);
}

interface Parsed {
  readonly front: Record<string, string>;
  readonly body: string;
}

/** `---` fenced `key: value` scalars, then the body. Tolerant: a file with no
 *  frontmatter is a body with no metadata, not an error.
 *
 *  One block form is understood beyond plain scalars: a value of `>` or `|`
 *  (with an optional chomping `-`/`+`) folds the following indented lines into
 *  one space-joined string — the shape every GizmoX `.claude/agents` file
 *  writes its multi-line `description:` in. Still parsed line-by-line, still
 *  repairable with a text editor; anything fancier than that stays refused. */
export function parseAgentFile(text: string): Parsed {
  const normalised = text.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) return { front: {}, body: normalised.trim() };
  const end = normalised.indexOf("\n---", 4);
  if (end < 0) return { front: {}, body: normalised.trim() };
  const front: Record<string, string> = {};
  let folded: { key: string; lines: string[] } | null = null;
  for (const line of normalised.slice(4, end).split("\n")) {
    if (folded) {
      // Indented lines continue the block; the first flush-left line ends it.
      if (/^\s+\S/.test(line)) {
        folded.lines.push(line.trim());
        continue;
      }
      front[folded.key] = folded.lines.join(" ");
      folded = null;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (/^[>|][-+]?$/.test(value)) folded = { key, lines: [] };
    else front[key] = value;
  }
  if (folded) front[folded.key] = folded.lines.join(" ");
  const body = normalised.slice(end + 4).replace(/^-*\n?/, "").trim();
  return { front, body };
}

export function serialiseAgent(agent: {
  name: string;
  description: string;
  provider?: string;
  model?: string;
  system: string;
}): string {
  const lines = ["---", `name: ${agent.name.trim()}`, `description: ${agent.description.trim()}`];
  if (agent.provider) lines.push(`provider: ${agent.provider}`);
  if (agent.model) lines.push(`model: ${agent.model}`);
  lines.push("---", "");
  return lines.join("\n") + agent.system.trim() + "\n";
}

function agentFrom(
  file: string,
  source: "gizmox" | "data" | "add-on" | "module",
  moduleId?: string
): AssistantAgent | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  // A module bundle's file is always `agent.md`; its ID comes from the module
  // it ships with, so renaming the persona never moves the id a pin points at.
  const slug = moduleId ? `${moduleId}-agent` : path.basename(file, ".md");
  if (!SLUG_RE.test(slug)) return null;
  const { front, body } = parseAgentFile(text);
  let provider = PROVIDER_IDS.has(front.provider ?? "") ? (front.provider as ProviderId) : undefined;
  let model = front.model?.trim() || undefined;
  if (source === "gizmox" && model) {
    // A GizmoX file's `model:` is a Claude Code alias or id, never another
    // provider's — so a model pin that survives the mapping implies the
    // provider pin that makes it runnable.
    model = model.startsWith("claude-") ? model : CLAUDE_MODEL_ALIASES[model];
    if (model && !provider) provider = "anthropic";
  }
  const skills = parseList(front.skills);
  const tools = parseList(front.tools);
  const moduleTools = parseList(front.moduleTools);
  return {
    id: slug,
    name: front.name?.trim() || slug,
    description: front.description?.trim() ?? "",
    provider,
    model,
    system: body,
    source,
    file,
    ...(moduleId ? { moduleId } : {}),
    ...(skills.length ? { skills } : {}),
    ...(tools.length ? { tools } : {}),
    ...(moduleTools.length ? { moduleTools } : {})
  };
}

/** The full roster: built-in first, then the configured agent directories,
 *  then data/, then installed add-ons. A file-backed agent may SHADOW the
 *  built-in by reusing its id — deliberate, so a user can restyle Amber
 *  without touching code — and later sources win on id collision for the same
 *  reason.
 *
 *  `agentDirs` is the stored `AssistantConfig.agentDirs` list (callers parse
 *  it with `parseAgentDirs`); absent means the defaults, the `.claude/agents`
 *  pair Claude Code itself reads. These directories are the one exception to
 *  the shadowing rule: their files exist for Claude Code first and this
 *  roster second, so a slug that collides with an id already present is
 *  imported under `<slug>-gizmox` instead of replacing it. Concretely:
 *  `.claude/agents/amber.md` is the Polo Recorder X narrator, and letting it
 *  shadow the built-in would swap the persona of every module's DEFAULT
 *  assistant as a side effect of a directory scan. Both Ambers list; neither
 *  is silently the other. */
export function scanAgents(agentDirs?: readonly string[]): AssistantAgent[] {
  const byId = new Map<string, AssistantAgent>();
  byId.set(DEFAULT_AGENT.id, DEFAULT_AGENT);
  const gizmox = new Map<string, AssistantAgent>();
  for (const dir of (agentDirs ?? DEFAULT_AGENT_DIRS).map(resolveAgentDir)) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files.sort()) {
      const agent = agentFrom(path.join(dir, f), "gizmox");
      if (agent) gizmox.set(agent.id, agent);
    }
  }
  for (const agent of gizmox.values()) {
    const id = byId.has(agent.id) ? `${agent.id}-gizmox` : agent.id;
    if (!byId.has(id)) byId.set(id, { ...agent, id });
  }
  // The modules' own bundles, before the data root and the add-ons so both can
  // still SHADOW one by id — the same override every other source gets.
  for (const { moduleId, file } of moduleBundles()) {
    const agent = agentFrom(file, "module", moduleId);
    if (agent) byId.set(agent.id, agent);
  }
  const dirs: { dir: string; source: "data" | "add-on" }[] = [
    { dir: agentsRoot(), source: "data" },
    ...addOnRoots().map((dir) => ({ dir, source: "add-on" as const }))
  ];
  for (const { dir, source } of dirs) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files.sort()) {
      const agent = agentFrom(path.join(dir, f), source);
      if (agent) byId.set(agent.id, agent);
    }
  }
  return [...byId.values()];
}

export function getAgent(id: string, agentDirs?: readonly string[]): AssistantAgent | null {
  if (!SLUG_RE.test(id)) return null;
  return scanAgents(agentDirs).find((a) => a.id === id) ?? null;
}

/**
 * The requesting user's stored agent-directory list — the scan roots are a
 * SETTING now, so every route that scans resolves them through this one read
 * (absent config, absent field, malformed field all land on the defaults via
 * `parseAgentDirs`).
 */
export async function storedAgentDirs(request: Request): Promise<string[]> {
  const doc = (await axfKv.read(kvUser(request), ASSISTANT_CONFIG_NS)) as
    | Partial<AssistantConfig>
    | null;
  return parseAgentDirs(doc?.agentDirs);
}

/* ── skills, loaded ───────────────────────────────────────────────────────── */

/**
 * The bodies of the skills a MODULE agent declares, read from its own bundle.
 *
 * Only module agents: their skills sit beside them in `agent/skills/<slug>/`
 * and nothing else can load them, whereas a GizmoX agent's `skills:` names a
 * `.claude/skills/` bundle the `claude` CLI resolves itself — reading those in
 * here would paste a skill into the prompt that the CLI is also about to load.
 *
 * A declared slug with no directory is SKIPPED silently rather than reported,
 * because the frontmatter is hand-editable by design and a typo there must
 * cost that one skill, not the turn.
 */
export function agentSkillDocs(agent: AssistantAgent): { slug: string; name: string; body: string }[] {
  if (agent.source !== "module" || !agent.file || !agent.skills?.length) return [];
  const root = path.join(path.dirname(agent.file), "skills");
  const docs: { slug: string; name: string; body: string }[] = [];
  for (const slug of agent.skills) {
    if (!SLUG_RE.test(slug)) continue;
    try {
      const { front, body } = parseAgentFile(fs.readFileSync(path.join(root, slug, "SKILL.md"), "utf8"));
      if (body.trim()) docs.push({ slug, name: front.name?.trim() || slug, body });
    } catch {
      // Declared but not present — see the docblock.
    }
  }
  return docs;
}

/**
 * The full system prompt for a turn: the persona, then the agent's skills, then
 * the module context block.
 *
 * Skills are INLINED rather than offered, because there is no tool loop on most
 * of these provider paths to fetch one with — an agent that "has" a skill it
 * cannot load is an agent that hallucinates its contents. The set is bounded by
 * construction (one bundle, a handful of skills derived from one module's
 * declaration), which is what makes inlining affordable here and would not make
 * it affordable for a general skill library.
 */
export function composeAgentSystem(agent: AssistantAgent, moduleContext?: string): string {
  const parts: string[] = [agent.system ?? ""];
  const skills = agentSkillDocs(agent);
  for (const skill of skills) {
    parts.push(`## Skill: ${skill.name}\n\n${skill.body}`);
  }
  if (agent.moduleTools?.length) {
    parts.push(
      `## Tools declared for this agent\n\n${agent.moduleTools
        .map((t) => `- \`${t}\``)
        .join("\n")}\n\nThese are declared, not yet callable from this window. Do not claim to have ` +
        `run one — describe what you would do and let the user act.`
    );
  }
  if (moduleContext) parts.push(`## Current module\n${moduleContext}`);
  return parts.filter((p) => p.trim()).join("\n\n");
}

/** Create or replace an agent file under `data/assistant/agents/`. Refuses a
 *  bad slug (the traversal fence) rather than sanitising one. */
export function writeAgent(
  id: string,
  agent: { name: string; description: string; provider?: string; model?: string; system: string }
): AssistantAgent {
  if (!SLUG_RE.test(id)) throw new Error(`"${id}" is not a valid agent id`);
  if (agent.provider && !PROVIDER_IDS.has(agent.provider)) {
    throw new Error(`"${agent.provider}" is not a known provider`);
  }
  if (!agent.name.trim()) throw new Error("an agent needs a name");
  if (!agent.system.trim()) throw new Error("an agent needs a system prompt — the body IS the agent");
  const root = agentsRoot();
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, `${id}.md`);
  fs.writeFileSync(file, serialiseAgent(agent), "utf8");
  const written = agentFrom(file, "data");
  if (!written) throw new Error("the written agent failed to read back");
  return written;
}

/** Delete a data-root agent. Add-on agents are removed by uninstalling their
 *  asset; the built-in cannot be removed (shadow it instead). */
export function removeAgent(id: string): boolean {
  if (!SLUG_RE.test(id)) throw new Error(`"${id}" is not a valid agent id`);
  if (id === DEFAULT_AGENT.id) {
    // Deleting a shadowing FILE for the default id is fine; the built-in
    // itself survives underneath it.
  }
  const file = path.join(agentsRoot(), `${id}.md`);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}
