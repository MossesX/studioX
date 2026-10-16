/**
 * @file project-state generator — compose and write the PROJECT-STATE.md /
 * PROJECT-STATE.json pair at the AmberX root, per the contract fixed in
 * `axf-project-state.bmpx`'s manifest notes.
 *
 * The md file carries five sections, in order:
 *   1. header — generated stamp, generator version, source counts;
 *   2. RESUME PROMPT — a fenced block under 1,500 tokens (chars/4 heuristic)
 *      a new session pastes verbatim: module slots filled, the build queue,
 *      open issues, the standing rules that bite, and pointers instead of
 *      prose. Zero history. When the budget is exceeded the recent-sessions
 *      block is trimmed out of the prompt FIRST; the budget is then asserted.
 *   3. STANDING SNAPSHOT — the same facts in full table form;
 *   4. SESSION INDEX — one line per digested session;
 *   5. SOURCES & CACHE — what was read, what was skipped, cache hits.
 *
 * PROJECT-STATE.json carries the same data machine-shaped:
 * `{ generatedAt, resumePrompt, snapshot, sessions, sources }`.
 *
 * The standing snapshot is read from disk at generation time — module dirs
 * counted, `.bmpx` manifests parsed for `manifest.status` ONLY (the plan half
 * is never touched), open issues parsed from issues.md `## I-` headers with
 * ~~struck~~ entries excluded. Degrade never crash: every faulty read costs a
 * note in `snapshot.notes` or the sources report, never a throw. Both output
 * files are written atomically (same-dir tmp + rename). Server-only.
 */
import fsp from "node:fs/promises";

import { readCached, writeCached } from "./cache.server";
import { digestSession, type SessionDigest } from "./digest.server";
import {
  AMBERX_ROOT,
  countSessionZips,
  enumerateSources,
  stateFamily,
  type SessionSourceKind,
  type StateFileRef,
} from "./sources.server";

/* ------------------------------- constants ------------------------------------ */

export const GENERATOR_VERSION = "0.1.0";
export const MD_PATH = `${AMBERX_ROOT}/PROJECT-STATE.md`;
export const JSON_PATH = `${AMBERX_ROOT}/PROJECT-STATE.json`;

/** The studio suite has 12 module slots (see `.newx.` prompt / module cap). */
const MODULE_SLOT_CAP = 12;
const MODULES_DIR = `${AMBERX_ROOT}/packages/studio/src/modules`;
const ISSUES_PATH = `${AMBERX_ROOT}/issues.md`;

/** Resume-prompt hard ceiling, tokens by the est.py heuristic (chars / 4). */
const PROMPT_TOKEN_BUDGET = 1500;
/** Sessions shown in the prompt's trimmable recent-sessions block. */
const PROMPT_RECENT_SESSIONS = 8;

/* --------------------------------- types ------------------------------------- */

export interface BuildQueueEntry {
  id: string;
  status: string;
}

export interface OpenIssue {
  id: string;
  title: string;
}

export interface StandingSnapshot {
  moduleSlotCap: number;
  moduleCount: number;
  modules: string[];
  buildQueue: BuildQueueEntry[];
  openIssues: OpenIssue[];
  /** Degrade notes — every read that failed, named, never thrown. */
  notes: string[];
}

export type IndexedSession = SessionDigest & { kind: SessionSourceKind };

export interface SourcesReport {
  counts: { transcriptAmberx: number; transcriptGizmox: number; archiveDir: number };
  sessionZips: { amberx: number; gizmox: number };
  digested: number;
  fromCache: number;
  skipped: string[];
  stateFiles: StateFileRef[];
  bmpxCount: number;
}

export interface ProjectStateJson {
  generatedAt: string;
  generatorVersion: string;
  resumePrompt: string;
  snapshot: StandingSnapshot;
  sessions: IndexedSession[];
  sources: SourcesReport;
}

export interface GenerateResult {
  generatedAt: string;
  sessionsDigested: number;
  fromCache: number;
  mdPath: string;
  jsonPath: string;
}

/* -------------------------------- helpers ------------------------------------ */

const estTokens = (s: string): number => Math.ceil(s.length / 4);

function oneLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function fmtKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, content, "utf8");
  await fsp.rename(tmp, file);
}

/* --------------------------- standing snapshot -------------------------------- */

async function readModules(notes: string[]): Promise<string[]> {
  try {
    const entries = await fsp.readdir(MODULES_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch (err) {
    notes.push(`modules: cannot read ${MODULES_DIR}: ${(err as Error).message}`);
    return [];
  }
}

/**
 * `{ id, status }` per `.bmpx`, from `manifest.status` ONLY. The whole file
 * has to pass through JSON.parse, but nothing of `plan` is read, summarised
 * or kept — the manifest object is the entire surface.
 */
async function readBuildQueue(bmpxPaths: string[], notes: string[]): Promise<BuildQueueEntry[]> {
  const out: BuildQueueEntry[] = [];
  for (const file of bmpxPaths) {
    const stem = file.slice(file.lastIndexOf("/") + 1).replace(/\.bmpx$/, "");
    try {
      const parsed = JSON.parse(await fsp.readFile(file, "utf8")) as {
        manifest?: { id?: unknown; status?: unknown };
      };
      const manifest = parsed?.manifest;
      out.push({
        id: typeof manifest?.id === "string" && manifest.id.length > 0 ? manifest.id : stem,
        status: typeof manifest?.status === "string" ? manifest.status : "unknown",
      });
    } catch (err) {
      notes.push(`build-queue: cannot parse ${file}: ${(err as Error).message}`);
    }
  }
  return out;
}

/**
 * Open issues from issues.md `## I-<n>` headers. A struck (fixed) entry's
 * header carries `~~` (`## ~~I-1 · …~~ — FIXED …`), so it both fails the
 * leading match and is excluded explicitly.
 */
export function parseOpenIssues(md: string): OpenIssue[] {
  const out: OpenIssue[] = [];
  for (const raw of md.split(/\r?\n/)) {
    if (raw.includes("~~")) continue;
    const m = /^##\s+(I-\d+)\b\s*(?:[·:—–-]\s*)?(.*)$/.exec(raw.trim());
    if (m) out.push({ id: m[1], title: m[2].trim() });
  }
  return out;
}

async function readOpenIssues(notes: string[]): Promise<OpenIssue[]> {
  try {
    return parseOpenIssues(await fsp.readFile(ISSUES_PATH, "utf8"));
  } catch (err) {
    notes.push(`issues: cannot read ${ISSUES_PATH}: ${(err as Error).message}`);
    return [];
  }
}

/* ----------------------------- resume prompt ---------------------------------- */

function sessionIndexLine(s: IndexedSession, askMax: number): string {
  const when = (s.lastActiveAt ?? s.startedAt ?? "").slice(0, 10) || "undated";
  const ask = s.firstAsk ? ` — ${oneLine(s.firstAsk, askMax)}` : "";
  return `- ${when} · ${oneLine(s.title, 60)} · ${s.kind}${ask}`;
}

function buildResumePrompt(
  generatedAt: string,
  snapshot: StandingSnapshot,
  sessions: IndexedSession[],
  includeRecentSessions: boolean
): string {
  const byStatus = new Map<string, string[]>();
  for (const e of snapshot.buildQueue) {
    const ids = byStatus.get(e.status) ?? [];
    ids.push(e.id);
    byStatus.set(e.status, ids);
  }
  const queueLine =
    [...byStatus.entries()].map(([status, ids]) => `${status}: ${ids.join(", ")}`).join(" · ") ||
    "empty";
  const issuesLine =
    snapshot.openIssues.map((i) => `${i.id} ${oneLine(i.title, 80)}`).join(" · ") || "none open";

  const lines = [
    `AMBERX RESUME — generated ${generatedAt.slice(0, 10)} by the project-state plugin,`,
    "facts read from disk, zero AI, zero history. Pointers below say where the",
    "detail lives — open them on demand, not up front.",
    "",
    "TARGET — everything is for C:\\Home\\Projects\\amberx-ai-studio (AmberX AI",
    "Studio): packages/core = @axf/core, packages/studio = @axs/studio, its own",
    "Next app on port 3200. GizmoX (C:\\Home\\Projects\\GizmoX) is the build",
    "environment only, never the thing being built.",
    "",
    "WHERE IT STANDS",
    `- Module slots: ${snapshot.moduleCount} of ${snapshot.moduleSlotCap} filled — ${
      snapshot.modules.join(", ") || "none"
    }.`,
    `- Build queue (build/projects/*.bmpx, manifest.status): ${queueLine}.`,
    `- Open issues (issues.md): ${issuesLine}.`,
    "",
    "RULES THAT BITE",
    "- The :3200 dev server may belong to another session — attach, never",
    "  restart or kill it.",
    "- One writer per path; shared files (studio.subsystem.ts, registries) are",
    "  edited additively and re-read from disk immediately before editing.",
    "- amberx_bound builds run with GizmoX as cwd but write ONLY under",
    "  C:\\Home\\Projects\\amberx-ai-studio — absolute paths in every write.",
    "",
    "POINTERS",
    "- PROJECT-STATE.md — standing snapshot tables, the full session index, and",
    "  the sources report (this prompt is its head section).",
    "- issues.md — the fix list; the .issues. trigger lists it and asks.",
    "- PLANNING-STATE.md — history only; never read it to orient.",
    "- C:\\Home\\Projects\\GizmoX\\.claude\\rules\\amberx-session-triggers.md — the",
    "  full .newx. context prompt when this one is not enough. It is in the",
    "  GIZMOX tree, not this one; the bare relative path this line used to",
    "  carry read as AmberX-relative and made the rule look deleted.",
  ];

  if (includeRecentSessions && sessions.length > 0) {
    lines.push("", "RECENT SESSIONS (newest last)");
    for (const s of sessions.slice(-PROMPT_RECENT_SESSIONS)) {
      lines.push(sessionIndexLine(s, 90));
    }
  }

  return lines.join("\n");
}

/* ----------------------------- md composition --------------------------------- */

function composeMd(state: ProjectStateJson): string {
  const { generatedAt, snapshot, sessions, sources } = state;
  const md: string[] = [];

  // 1 · header
  md.push(
    "# PROJECT-STATE — AmberX AI Studio",
    "",
    `> Generated ${generatedAt} · project-state generator v${state.generatorVersion} ·`,
    "> deterministic extraction from disk, zero AI calls. Regenerate via",
    "> `POST /api/project-state` or the Generate button on `/project-state`.",
    "",
    `Sources this run: ${sources.counts.transcriptAmberx} AmberX transcripts · ` +
      `${sources.counts.transcriptGizmox} GizmoX transcripts (marker-matched) · ` +
      `${sources.counts.archiveDir} archived session dirs · ` +
      `${sources.sessionZips.amberx + sources.sessionZips.gizmox} session zips counted, never opened. ` +
      `${sources.digested} sessions digested, ${sources.fromCache} served from cache.`,
    ""
  );

  // 2 · resume prompt
  md.push(
    "## Resume prompt",
    "",
    "Paste the block below verbatim as the FIRST message of a new session.",
    `~${estTokens(state.resumePrompt)} tokens (chars/4).`,
    "",
    "```",
    state.resumePrompt,
    "```",
    ""
  );

  // 3 · standing snapshot
  md.push(
    "## Standing snapshot",
    "",
    `### Modules — ${snapshot.moduleCount} of ${snapshot.moduleSlotCap} suite slots filled`,
    "",
    snapshot.modules.join(" · ") || "_none found_",
    "",
    "### Build queue — `build/projects/*.bmpx`",
    ""
  );
  if (snapshot.buildQueue.length > 0) {
    md.push("| project | status |", "|---|---|");
    for (const e of snapshot.buildQueue) {
      md.push(`| ${e.id} | ${e.status} |`);
    }
  } else {
    md.push("_no `.bmpx` projects found_");
  }
  md.push("", "### Open issues — `issues.md`", "");
  if (snapshot.openIssues.length > 0) {
    md.push("| id | title |", "|---|---|");
    for (const i of snapshot.openIssues) {
      md.push(`| ${i.id} | ${i.title.replace(/\|/g, "\\|")} |`);
    }
  } else {
    md.push("_none open_");
  }
  md.push("", "### State files", "", "| file | exists | size | modified |", "|---|---|---|---|");
  for (const f of sources.stateFiles) {
    md.push(
      `| ${f.id} | ${f.exists ? "yes" : "NO"} | ${f.exists ? fmtKb(f.size) : "—"} | ${
        f.exists ? new Date(f.mtimeMs).toISOString().slice(0, 10) : "—"
      } |`
    );
  }
  if (snapshot.notes.length > 0) {
    md.push("", "Snapshot degrade notes:", "");
    for (const n of snapshot.notes) md.push(`- ${n}`);
  }
  md.push("");

  // 4 · session index
  md.push("## Session index", "", `${sessions.length} sessions, oldest first.`, "");
  for (const s of sessions) md.push(sessionIndexLine(s, 140));
  md.push("");

  // 5 · sources & cache
  md.push(
    "## Sources & cache",
    "",
    `- AmberX transcripts: ${sources.counts.transcriptAmberx}`,
    `- GizmoX transcripts matching the AmberX markers: ${sources.counts.transcriptGizmox}`,
    `- Archived session dirs (deduped across both trees): ${sources.counts.archiveDir}`,
    `- Session zips counted, never opened: ${sources.sessionZips.amberx} AmberX + ${sources.sessionZips.gizmox} GizmoX`,
    `- \`.bmpx\` manifests read for status: ${sources.bmpxCount}`,
    `- Digested this run: ${sources.digested - sources.fromCache} fresh · ${sources.fromCache} from cache`,
    ""
  );
  if (sources.skipped.length > 0) {
    md.push("Skipped (degraded, never fatal):", "");
    for (const n of sources.skipped) md.push(`- ${n}`);
  } else {
    md.push("Nothing skipped.");
  }
  md.push("");

  return md.join("\n");
}

/* -------------------------------- generation ---------------------------------- */

/**
 * Run sources → cache → digest over the whole corpus, read the standing
 * snapshot from disk, compose both output files and write them atomically to
 * the AmberX root. Returns the summary the API route answers POST with.
 */
export async function generateProjectState(): Promise<GenerateResult> {
  const generatedAt = new Date().toISOString();

  // Corpus — cache first, digest only what is new or changed.
  const { sources, skipped } = await enumerateSources();
  let fromCache = 0;
  const sessions: IndexedSession[] = [];
  for (const source of sources) {
    const cached = readCached(source);
    if (cached) {
      fromCache++;
      sessions.push({ ...cached, kind: source.kind });
      continue;
    }
    const digest = await digestSession(source);
    await writeCached(source, digest);
    sessions.push({ ...digest, kind: source.kind });
  }

  // Standing snapshot — every fact read from disk now, faults become notes.
  const notes: string[] = [];
  const family = await stateFamily();
  const [modules, buildQueue, openIssues, sessionZips] = await Promise.all([
    readModules(notes),
    readBuildQueue(family.bmpx, notes),
    readOpenIssues(notes),
    countSessionZips(),
  ]);
  const snapshot: StandingSnapshot = {
    moduleSlotCap: MODULE_SLOT_CAP,
    moduleCount: modules.length,
    modules,
    buildQueue,
    openIssues,
    notes,
  };

  const sourcesReport: SourcesReport = {
    counts: {
      transcriptAmberx: sources.filter((s) => s.kind === "transcript-amberx").length,
      transcriptGizmox: sources.filter((s) => s.kind === "transcript-gizmox").length,
      archiveDir: sources.filter((s) => s.kind === "archive-dir").length,
    },
    sessionZips,
    digested: sessions.length,
    fromCache,
    skipped,
    stateFiles: family.files,
    bmpxCount: family.bmpx.length,
  };

  // The resume prompt is the deliverable: under budget or the session block
  // goes first; a prompt still over budget without it is a contract breach.
  let resumePrompt = buildResumePrompt(generatedAt, snapshot, sessions, true);
  if (estTokens(resumePrompt) >= PROMPT_TOKEN_BUDGET) {
    resumePrompt = buildResumePrompt(generatedAt, snapshot, sessions, false);
  }
  if (estTokens(resumePrompt) >= PROMPT_TOKEN_BUDGET) {
    throw new Error(
      `resume prompt is ${estTokens(resumePrompt)} tokens (chars/4) even without ` +
        `the session block — budget is ${PROMPT_TOKEN_BUDGET}`
    );
  }

  const state: ProjectStateJson = {
    generatedAt,
    generatorVersion: GENERATOR_VERSION,
    resumePrompt,
    snapshot,
    sessions,
    sources: sourcesReport,
  };

  await writeAtomic(MD_PATH, composeMd(state));
  await writeAtomic(JSON_PATH, `${JSON.stringify(state, null, 2)}\n`);

  return {
    generatedAt,
    sessionsDigested: sessions.length,
    fromCache,
    mdPath: MD_PATH,
    jsonPath: JSON_PATH,
  };
}
