/**
 * @file The Forge's Node half — writers over the Claude CLI's on-disk
 * vocabulary, and the tool-definition store. `node:fs` lives here, behind the
 * `.server.ts` suffix; only API routes import it.
 *
 * The READ half is `plugins/agent-forge/forge.ts` — the scanner that already
 * knows the `.claude/{agents,skills}` shapes — reused rather than re-derived.
 * What was missing framework-wide was the WRITE half, and this is it:
 *
 *   - agents: `.claude/agents/<slug>.md` — frontmatter (name, description,
 *     optional tools/model) + the body as the prompt.
 *   - skills:  `.claude/skills/<slug>/SKILL.md` — frontmatter (name,
 *     description) + the body as the skill.
 *   - the off switch is the `.md.disabled` RENAME, exactly as the scanner
 *     reads it — Claude Code globs `*.md`, so the rename is what disables.
 *
 * Slug fence: `SLUG_RE`, same posture as everywhere else — a client names a
 * slug, never a path, and a bad slug is refused rather than sanitised.
 *
 * Tool definitions are JSON documents in `data/assistant/tools/<name>.json`,
 * shaped like `ClaudeToolPayload` minus `run` — a tool as DATA. Nothing
 * executes them yet; they are the authored feed for the MCP bridge that
 * `claude/points.ts` deliberately deferred to its first real consumer.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { dataPath } from "../../server/dataRoot";
import { forgeRoots, scanPersonas, scanSkills } from "../../plugins/agent-forge/forge";
import type { ForgeScope, PersonaInfo, SkillInfo } from "../../plugins/agent-forge/forge";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function repoRoot(): string {
  // The studio runs from packages/studio; the repo root is two levels up.
  return path.resolve(process.cwd(), "..", "..");
}

function scopeDirs(scope: ForgeScope): { agents: string; skills: string } {
  return forgeRoots(repoRoot(), os.homedir())[scope];
}

function checkedSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`"${slug}" is not a valid slug`);
  return slug;
}

/* ── the roster (read) ────────────────────────────────────────────────────── */

export interface ClaudeRoster {
  personas: PersonaInfo[];
  skills: SkillInfo[];
}

export function claudeRoster(): ClaudeRoster {
  const personas: PersonaInfo[] = [];
  const skills: SkillInfo[] = [];
  // All three scopes, INCLUDING the house set the studio ships (`studio`,
  // 2026-08-13). The studio scope is read-only through this module's writers
  // — see the guard below — because its files are SOURCE, versioned under
  // `packages/studio/forge/`, and a designer that edits shipped source in
  // place is a designer that makes the working tree lie.
  for (const scope of ["project", "user", "studio"] as const) {
    const dirs = scopeDirs(scope);
    personas.push(...scanPersonas(scope, dirs.agents));
    skills.push(...scanSkills(scope, dirs.skills));
  }
  return { personas, skills };
}

function refuseStudioWrites(scope: ForgeScope): void {
  if (scope === "studio") {
    throw new Error(
      "the studio scope is the shipped house set — edit it in packages/studio/forge/ as source, " +
        "or shadow it from the project scope"
    );
  }
}

export function readClaudeFile(scope: ForgeScope, kind: "agent" | "skill", slug: string): string {
  const file = fileFor(scope, kind, checkedSlug(slug));
  if (!file) throw new Error(`no ${kind} "${slug}" in the ${scope} scope`);
  return fs.readFileSync(file, "utf8");
}

function fileFor(scope: ForgeScope, kind: "agent" | "skill", slug: string): string | null {
  const dirs = scopeDirs(scope);
  const candidates =
    kind === "agent"
      ? [path.join(dirs.agents, `${slug}.md`), path.join(dirs.agents, `${slug}.md.disabled`)]
      : [
          path.join(dirs.skills, slug, "SKILL.md"),
          path.join(dirs.skills, slug, "SKILL.md.disabled")
        ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/* ── the writers ──────────────────────────────────────────────────────────── */

/** Write a Claude agent or skill file, whole. `text` is the FULL file —
 *  frontmatter included — because the designer edits the real artifact, and a
 *  writer that recomposes frontmatter is a writer that eats hand edits. */
export function writeClaudeFile(
  scope: ForgeScope,
  kind: "agent" | "skill",
  slug: string,
  text: string
): void {
  refuseStudioWrites(scope);
  checkedSlug(slug);
  if (!text.trim()) throw new Error("an empty file is a delete, and delete is its own operation");
  const dirs = scopeDirs(scope);
  const existing = fileFor(scope, kind, slug);
  const target =
    existing ??
    (kind === "agent"
      ? path.join(dirs.agents, `${slug}.md`)
      : path.join(dirs.skills, slug, "SKILL.md"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text.endsWith("\n") ? text : text + "\n", "utf8");
}

/** The off switch: rename `.md` ↔ `.md.disabled`. Idempotent per direction. */
export function setClaudeDisabled(
  scope: ForgeScope,
  kind: "agent" | "skill",
  slug: string,
  disabled: boolean
): void {
  refuseStudioWrites(scope);
  const file = fileFor(scope, kind, checkedSlug(slug));
  if (!file) throw new Error(`no ${kind} "${slug}" in the ${scope} scope`);
  const isDisabled = file.endsWith(".disabled");
  if (isDisabled === disabled) return;
  const next = disabled ? `${file}.disabled` : file.replace(/\.disabled$/, "");
  fs.renameSync(file, next);
}

export function deleteClaudeEntry(scope: ForgeScope, kind: "agent" | "skill", slug: string): void {
  refuseStudioWrites(scope);
  const file = fileFor(scope, kind, checkedSlug(slug));
  if (!file) throw new Error(`no ${kind} "${slug}" in the ${scope} scope`);
  if (kind === "skill") {
    // A skill is its DIRECTORY — SKILL.md plus whatever references it carries.
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  } else {
    fs.unlinkSync(file);
  }
}

/* ── tool definitions as data ─────────────────────────────────────────────── */

export interface ToolDefinition {
  /** lower-kebab — the name a model would see. */
  readonly name: string;
  /** The model reads this; it decides when the tool is called. */
  readonly description: string;
  /** A JSON Schema for the input. Stored verbatim. */
  readonly input_schema: Record<string, unknown>;
}

const TOOL_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

function toolsRoot(): string {
  return dataPath("assistant", "tools");
}

export function listTools(): ToolDefinition[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(toolsRoot()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const tools: ToolDefinition[] = [];
  for (const f of files.sort()) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(toolsRoot(), f), "utf8")) as ToolDefinition;
      if (TOOL_NAME_RE.test(doc.name ?? "")) tools.push(doc);
    } catch {
      // A corrupt definition is skipped, not fatal — the Forge lists what parses.
    }
  }
  return tools;
}

export function writeTool(tool: ToolDefinition): void {
  if (!TOOL_NAME_RE.test(tool.name)) throw new Error(`"${tool.name}" is not a valid tool name (lower-kebab)`);
  if (!tool.description?.trim()) throw new Error("a tool needs a description — the model reads it");
  if (!tool.input_schema || typeof tool.input_schema !== "object") {
    throw new Error("input_schema must be a JSON object");
  }
  fs.mkdirSync(toolsRoot(), { recursive: true });
  fs.writeFileSync(
    path.join(toolsRoot(), `${tool.name}.json`),
    JSON.stringify(tool, null, 2) + "\n",
    "utf8"
  );
}

export function deleteTool(name: string): boolean {
  if (!TOOL_NAME_RE.test(name)) throw new Error(`"${name}" is not a valid tool name`);
  try {
    fs.unlinkSync(path.join(toolsRoot(), `${name}.json`));
    return true;
  } catch {
    return false;
  }
}
