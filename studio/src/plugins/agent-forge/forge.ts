/**
 * @file Agent Forge's scan/compile core — the reader half of GizmoX's Agent
 * Forge (`src/modules/agentforge/forge-core.ts`), ported as the data layer of
 * the `agent-forge` PLUGIN (`axf-claude` P5).
 *
 * **Restored from the archive, ONE LINE CHANGED** —
 * `assets/archive/build-archive/2026-08-09_19-15_axf-mui-v030-p0-prestrip.zip`,
 * where the v0.3.0 "strip to the frame" run archived it. It was already written
 * for this phase — the strip caught it mid-flight — and it is pure string and
 * filesystem work with no era to be written against, so it was copied rather
 * than rewritten. `roster.ts` beside it is the new part: the two operations the
 * route and the context provider actually need, composed from these functions.
 *
 * The exception is marked at its site, in {@link parseFrontmatter}'s
 * inline-array branch: it stripped quotes before trimming, so `[x, 'y']` parsed
 * as `["x", "'y"]`. `test/agent-forge.test.ts` found it on the first run and
 * now pins the input. Restoring a bug verbatim is still shipping it.
 *
 * It is a port by copy, not by
 * import: the one GizmoX dependency the original had (`gizmoxRoot()`) is
 * replaced by an explicit repo argument, because here the repo is the
 * CONVERSATION'S working directory — the bound repo a Claude project carries —
 * not a constant this package could know.
 *
 * What it reads is the `claude` CLI's own on-disk vocabulary, unchanged:
 *
 *   `<repo>/.claude/agents/<slug>.md`        project-scope personas
 *   `<repo>/.claude/skills/<slug>/SKILL.md`  project-scope skill bundles
 *   `~/.claude/{agents,skills}/…`            the user scope, same shapes
 *   `<studio>/forge/{agents,skills}/…`       the STUDIO scope (2026-08-13)
 *
 * ── the studio scope, and why a third one was needed ────────────────────────
 *
 * The first two scopes are the CLI's. The third is AmberX's own: the personas
 * and skills that SHIP WITH THE PRODUCT, imported from GizmoX on 2026-08-13
 * and versioned under `packages/studio/forge/` like any other source.
 *
 * Before it, the house roster existed only as loose files in this repo's
 * untracked `.claude/` — so it was in no build, in no diff, and visible only to
 * a conversation whose working directory happened to BE this tree. A
 * conversation opened anywhere else got an empty Forge. That is the difference
 * between an asset a project uses and an asset a project OWNS, and the studio
 * scope is the second thing.
 *
 * `.claude/{agents,skills}` in this repo is now a GENERATED MIRROR of that
 * directory (`npm run sync:forge`, gated by `npm run check:forge`), because the
 * `claude` CLI reads `.claude/` and nothing else. The mirror is byte-identical
 * by construction, which is what makes the shadowing below a no-op here.
 *
 * A `.md.disabled` suffix is the off switch (the CLI only loads files matching
 * its glob, so the rename is what actually disables the asset), and a disabled
 * persona is listed but never compiled into a prompt.
 *
 * **Server-only** (`node:fs`); the panel UI reaches this through
 * `/api/agent-forge`, never by import. The parser and compiler are pure
 * functions on strings so the round-trip stays testable under `node --test`
 * with no filesystem in the assertion path.
 */

import fs from "node:fs";
import path from "node:path";

export type ForgeScope = "project" | "user" | "studio";

export interface PersonaInfo {
  /** `<scope>:persona:<slug>` — stable across rescans. */
  id: string;
  scope: ForgeScope;
  slug: string;
  /** Absolute path of the .md (or .md.disabled) file. */
  file: string;
  name: string;
  description: string;
  tools: string[];
  /** Skill slugs the persona declares. Absent, never `[]` — an empty key
   *  would be one the next writer adds to a file that never asked for it. */
  skills?: string[];
  model: string | null;
  disabled: boolean;
  /**
   * A NEARER scope declares this same slug, so this entry is not the one a
   * fresh pick should get. Set by `markShadowed` in `roster.ts` — a single
   * scan cannot know, and `false` here is "not yet compared" as much as it is
   * "not shadowed". Listed rather than dropped: the studio ships a `molly` and
   * this repo mirrors it, so a reader who cannot see BOTH is a reader who
   * cannot tell an override from a duplicate.
   */
  shadowed: boolean;
  /** First lines of the body — enough for a roster row, not the prompt. */
  bodyPreview: string;
}

export interface SkillInfo {
  /** `<scope>:skill:<slug>`. */
  id: string;
  scope: ForgeScope;
  slug: string;
  /** Absolute path of SKILL.md (or SKILL.md.disabled). */
  file: string;
  name: string;
  description: string;
  disabled: boolean;
  /** As `PersonaInfo.shadowed`. */
  shadowed: boolean;
}

interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

/** Tolerant frontmatter parser for the YAML subset agent/skill files use:
 *  `key: value`, folded `>` / literal `|` blocks, nested `- item` lists,
 *  inline arrays, plain comma lists. Anything weirder stays a raw string. */
export function parseFrontmatter(raw: string): Frontmatter {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: raw };
  const body = raw.slice(m[0].length);
  const data: Record<string, unknown> = {};
  const lines = m[1].split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1];
    const value = kv[2].trim();
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block: string[] = [];
      i += 1;
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].trim() === "")) {
        block.push(lines[i].trim());
        i += 1;
      }
      data[key] = block.join(value.startsWith(">") ? " " : "\n").trim();
      continue;
    }
    if (value === "") {
      // nested list form: "tools:\n  - Read\n  - Bash"
      const items: string[] = [];
      i += 1;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s+-\s+/, "").replace(/^["']|["']$/g, "").trim());
        i += 1;
      }
      data[key] = items.length ? items : "";
      continue;
    }
    if (value.startsWith("[")) {
      try {
        data[key] = JSON.parse(value.replace(/'/g, '"'));
      } catch {
        data[key] = value
          .slice(1, -1)
          .split(",")
          // TRIM FIRST — the one deviation from the verbatim restore, and it
          // is a bug fix. Stripping quotes before trimming meant `[x, 'y']`
          // parsed as `["x", "'y"]`: the space after the comma stopped `^["']`
          // matching, so only the CLOSING quote came off and the value kept a
          // stray apostrophe. Found by `test/agent-forge.test.ts`, which pins
          // this exact input.
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
      i += 1;
      continue;
    }
    data[key] = value.replace(/^["']|["']$/g, "");
    i += 1;
  }
  return { data, body };
}

/** Normalise a frontmatter tools value (array, "*", comma list) to a list. */
function toolList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

/** `skills` through the same tolerant reader as `tools`, with "no entries"
 *  collapsed to `undefined` so absent stays absent through a round trip. */
function skillList(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const list = toolList(v);
  return list.length ? list : undefined;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Compare form for a skill slug: `/dx-topic`, `dx-topic ` and `DX-Topic` all
 *  name the same bundle. */
const skillKey = (s: string): string => s.trim().replace(/^\/+/, "").toLowerCase();

/**
 * Where the studio's OWN roster lives — `packages/studio/forge/`, resolved off
 * `process.cwd()` like `KV_ROOT` in `server/axfKv.ts`, because the studio's cwd
 * is `packages/studio` under `next dev`, `next start` and `node --test` alike.
 *
 * No `.claude` segment in it, deliberately. This directory is not a CLI
 * directory that AmberX happens to read; it is AmberX's own content, and giving
 * it the CLI's layout would invite the next reader to point the `claude` CLI at
 * it and expect two writers to stay in step. The mirror script goes the other
 * way — from here, to `.claude/` — and only ever that way.
 */
export const STUDIO_FORGE_ROOT = path.join(process.cwd(), "forge");

/**
 * The six directories a repo + a home directory + the studio imply. `home` and
 * `studio` are arguments (defaulting at the call sites that have one) so tests
 * can point either at a fixture instead of at the real `~/.claude` or the real
 * shipped roster.
 */
export function forgeRoots(
  repo: string,
  home: string,
  studio: string = STUDIO_FORGE_ROOT
): Record<ForgeScope, { agents: string; skills: string }> {
  return {
    project: {
      agents: path.join(repo, ".claude", "agents"),
      skills: path.join(repo, ".claude", "skills")
    },
    user: {
      agents: path.join(home, ".claude", "agents"),
      skills: path.join(home, ".claude", "skills")
    },
    studio: {
      agents: path.join(studio, "agents"),
      skills: path.join(studio, "skills")
    }
  };
}

export function scanPersonas(scope: ForgeScope, dir: string): PersonaInfo[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: PersonaInfo[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const disabled = e.name.endsWith(".md.disabled");
    if (!e.name.endsWith(".md") && !disabled) continue;
    const file = path.join(dir, e.name);
    const slug = e.name.replace(/\.md(\.disabled)?$/, "");
    try {
      const raw = fs.readFileSync(file, "utf8");
      const { data, body } = parseFrontmatter(raw);
      const info: PersonaInfo = {
        id: `${scope}:persona:${slug}`,
        scope,
        slug,
        file,
        name: str(data.name) || slug,
        description: str(data.description),
        tools: toolList(data.tools),
        model: str(data.model) || null,
        disabled,
        // One scan, one scope — shadowing is a question about the OTHER scopes,
        // and `roster.ts` is the only caller that has them all.
        shadowed: false,
        bodyPreview: body.trim().split("\n").slice(0, 3).join("\n").slice(0, 240)
      };
      // Assigned only when there is something to assign — `"skills" in p` is
      // what the GizmoX round trip is asserted on, and the rule ports intact.
      const skills = skillList(data.skills);
      if (skills) info.skills = skills;
      out.push(info);
    } catch {
      // unreadable file: skip rather than fail the whole scan
    }
  }
  return out;
}

export function scanSkills(scope: ForgeScope, dir: string): SkillInfo[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SkillInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const skillDir = path.join(dir, e.name);
    let file = path.join(skillDir, "SKILL.md");
    let disabled = false;
    if (!fs.existsSync(file)) {
      const off = path.join(skillDir, "SKILL.md.disabled");
      if (!fs.existsSync(off)) continue;
      file = off;
      disabled = true;
    }
    try {
      const raw = fs.readFileSync(file, "utf8");
      const { data } = parseFrontmatter(raw);
      out.push({
        id: `${scope}:skill:${e.name}`,
        scope,
        slug: e.name,
        file,
        name: str(data.name) || e.name,
        description: str(data.description),
        disabled,
        shadowed: false
      });
    } catch {
      // skip unreadable skill
    }
  }
  return out;
}

/**
 * Compose the context text a selected persona contributes to a session's
 * system contract — the pure half of the `claude.context-provider` payload.
 *
 * Takes the persona file's RAW text (the caller owns the read) so the
 * composition is a string function a test can hold without a filesystem.
 * Declared skills are resolved against the scanned roster the same way the
 * GizmoX join worked: an unmatched slug is REPORTED as unresolved rather than
 * silently dropped, because a typo that vanishes is the failure mode the join
 * exists to prevent.
 */
export function composePersonaContext(raw: string, fallbackName: string, skills: readonly SkillInfo[]): string {
  const { data, body } = parseFrontmatter(raw);
  const name = str(data.name) || fallbackName;
  const description = str(data.description);
  const declared = skillList(data.skills) ?? [];
  const lines: string[] = [`## Persona: ${name}`];
  if (description) lines.push("", description);
  if (declared.length) {
    const resolved = declared.map((slug) => {
      const hit = skills.find((s) => skillKey(s.slug) === skillKey(slug));
      return hit ? `${hit.name} (${hit.slug})` : `${slug} (UNRESOLVED)`;
    });
    lines.push("", `Declared skills: ${resolved.join(", ")}`);
  }
  if (body.trim()) lines.push("", body.trim());
  return lines.join("\n");
}
