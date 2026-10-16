/**
 * @file PROJECTS — the bound working directory, the instructions and the
 * knowledge files. `axf-claude` P4, verbatim:
 *
 *   *"A project holds instructions, knowledge files, default model/effort AND a
 *   bound working directory on disk; conversations belong to a project and
 *   inherit all of it. The bound repo is what makes this better than the
 *   desktop app — the CLI already runs with a cwd, so surface it deliberately
 *   rather than leaving it implicit."*
 *
 * INTERNAL to the Claude subsystem, exactly as `./store` is: consumers go
 * through the service API in `./service`, and nothing outside `src/claude/` may
 * import this file. The consumer proof greps for the violation.
 *
 * ── what "inherit" means, precisely, and where it stops ──────────────────────
 *
 * A conversation inherits a project's settings in two different ways, and
 * conflating them is the bug this section exists to prevent.
 *
 *   **Copied once, at `start()`** — `cwd`, `model`, `effort`, `permissionMode`.
 *   They become fields on the `ConversationRecord` and stay authoritative. The
 *   reason is `--resume`: the CLI holds a session's history, and that history
 *   was produced by a process running in a particular directory. Re-reading the
 *   project at turn time would let an edit move a live session's working
 *   directory out from under it, so the next resumed turn's tool calls would
 *   read a different tree than the ones the model already remembers making.
 *   Editing a project therefore changes what its NEXT conversation starts with,
 *   never what an existing one is already running under.
 *
 *   **Read live, on the first turn** — `instructions` and `knowledge`. These
 *   are the system contract, which is composed once per CLI session (a resumed
 *   session already carries it), so "live" costs one read and buys the property
 *   a knowledge file exists for: the file on disk IS the knowledge. A project
 *   that copied file contents at add-time would be a snapshot silently
 *   disagreeing with the file sitting next to it.
 *
 * The one asymmetry worth naming out loud: `cwd` is **bound**, not defaulted.
 * `start()` refuses a `cwd` option that disagrees with the project's, while it
 * happily accepts a different model. That is not fussiness — "which tree" is
 * the project's whole identity, and a conversation filed under a project but
 * running somewhere else is a lie in the library's most useful column. A model
 * genuinely does vary turn to turn; a repository does not.
 *
 * **Node-only** — the kv driver and the knowledge reader both import
 * `node:fs`. Never reaches a client bundle; the isomorphic half (the record
 * types, the resolution status) is in `./types`.
 */
import { randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import { KvStore } from "@axf/core";
import type { KvDoc } from "@axf/core";

import { nodeKvIo } from "../server/axfKv";
import { CLAUDE_PROJECTS_ROOT } from "../server/claudePaths";
import type { KnowledgeFile, KnowledgeStatus, ProjectRecord } from "./types";

/** Beside `data/claude/conversations/`, its own root for the same reason: a
 *  project id can never collide with a conversation id or a kv namespace.
 *  Defined in `../server/claudePaths` (P2 of `default-state`) so the accounts
 *  factory reset can name a user's subtree without importing this file. */
export const PROJECTS_ROOT = CLAUDE_PROJECTS_ROOT;

export const PROJECT_FORMAT = "axs-claude-project/1";

/* ---------------------------------- limits ----------------------------------- */

/**
 * The knowledge caps.
 *
 * Not tidiness: every byte here is prepended to the system contract of every
 * first turn in the project, and the system contract is BILLED. An accidental
 * `node_modules/**` in a knowledge list is a five-figure token bill per
 * conversation, arriving silently. So the caps are real, they are stated to the
 * model when they bite (see {@link composeProjectSystem}), and the editor shows
 * which files would be cut before a turn is ever run.
 */
export const KNOWLEDGE_LIMITS = {
  /** Files per project. */
  files: 24,
  /** Bytes read from one file. */
  bytesPerFile: 128 * 1024,
  /** Bytes across all of them. */
  bytesTotal: 512 * 1024
} as const;

/** Project names become row labels and headings in a system prompt. */
export const MAX_PROJECT_NAME = 120;

/* ------------------------------------ ids ------------------------------------ */

/** Same alphabet and same argument as `isConversationId`: an id becomes a file
 *  name, so the grammar is a traversal fence. */
export function isProjectId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
}

function checkedId(id: string): string {
  if (!isProjectId(id)) throw new Error(`"${id}" is not a project id`);
  return id;
}

function asRecord(doc: KvDoc | null, id: string): ProjectRecord | null {
  if (!doc) return null;
  const record = doc as unknown as ProjectRecord;
  if (record.format !== PROJECT_FORMAT || record.id !== id) return null;
  return record;
}

/* ----------------------------------- store ----------------------------------- */

/** What `create()` is given: the record minus everything the store mints. */
export type ProjectInit = Omit<ProjectRecord, "format" | "id" | "createdAt" | "updatedAt">;

/**
 * The project store — a facade over core's kv primitive, for the same reasons
 * `./store` is one and with the same layout (`<root>/<user>/<uuid>.json`).
 * Nothing that can be wrong about a store is re-implemented here.
 */
export class ProjectStore {
  readonly #kv: KvStore;
  readonly #user: string;
  readonly root: string;

  constructor(root?: string, user = "local") {
    this.root = root ?? PROJECTS_ROOT;
    this.#user = user;
    this.#kv = new KvStore(nodeKvIo(this.root), `claude-projects:${this.root}`);
  }

  async create(init: ProjectInit): Promise<ProjectRecord> {
    const now = new Date().toISOString();
    const record: ProjectRecord = {
      format: PROJECT_FORMAT,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...init
    };
    await this.save(record);
    return record;
  }

  async load(id: string): Promise<ProjectRecord | null> {
    return asRecord(await this.#kv.read(this.#user, checkedId(id)), id);
  }

  /** `async` so the id guard arrives as a rejection rather than a synchronous
   *  throw that escapes the caller's `.catch()` — `./store` argues it at length. */
  async save(record: ProjectRecord): Promise<void> {
    return this.#kv.write(this.#user, checkedId(record.id), {
      ...record,
      updatedAt: new Date().toISOString()
    } as unknown as KvDoc);
  }

  /** Read-modify-write, the whole of it inside core's chain. */
  async mutate(id: string, fn: (record: ProjectRecord) => ProjectRecord): Promise<ProjectRecord> {
    checkedId(id);
    return this.#kv.mutate(this.#user, id, (doc) => {
      const current = asRecord(doc, id);
      if (!current) throw new Error(`project "${id}" does not exist`);
      return { ...fn(current), updatedAt: new Date().toISOString() } as unknown as KvDoc;
    }) as Promise<unknown> as Promise<ProjectRecord>;
  }

  async remove(id: string): Promise<void> {
    return this.#kv.remove(this.#user, checkedId(id));
  }

  /**
   * Every project, alphabetically by name.
   *
   * Whole records rather than a meta shape, unlike conversations: a project is
   * its instructions and a list of paths, which is kilobytes, while a
   * conversation is a transcript. Inventing a `ProjectMeta` here would be a
   * second shape to keep in step for no saved bytes.
   *
   * By NAME rather than by recency, also unlike conversations. A project list
   * is a set of places you work and it is read as an index — an index that
   * reorders itself every time you use one of its entries is an index you have
   * to re-scan every time.
   */
  async list(): Promise<ProjectRecord[]> {
    const out: ProjectRecord[] = [];
    for (const id of await this.#kv.list(this.#user)) {
      if (!isProjectId(id)) continue;
      // Skipped rather than fatal, as in the conversation store: one unreadable
      // document must not make every project unreachable.
      const record = await this.load(id);
      if (record) out.push(record);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt));
  }
}

/* --------------------------------- knowledge ---------------------------------- */

/** An authored path against the project's bound directory. Relative resolves
 *  inside it; absolute is taken as written. */
export function resolveKnowledgePath(project: ProjectRecord, file: KnowledgeFile): string {
  return path.resolve(project.cwd, file.path);
}

/**
 * What each knowledge file resolves to right now, without reading any of them.
 *
 * `stat` only — the editor calls this on every keystroke-completed edit and on
 * every open, and reading half a megabyte to answer "does this exist" would
 * make a settings screen do a project's worth of I/O.
 */
export async function resolveKnowledge(project: ProjectRecord): Promise<KnowledgeStatus[]> {
  const out: KnowledgeStatus[] = [];
  for (const file of project.knowledge) {
    const resolved = resolveKnowledgePath(project, file);
    try {
      const info = await stat(resolved);
      if (!info.isFile()) {
        out.push({
          path: file.path,
          resolved,
          exists: false,
          bytes: 0,
          truncated: false,
          error: "not a file"
        });
        continue;
      }
      out.push({
        path: file.path,
        resolved,
        exists: true,
        bytes: info.size,
        truncated: info.size > KNOWLEDGE_LIMITS.bytesPerFile
      });
    } catch (err) {
      out.push({
        path: file.path,
        resolved,
        exists: false,
        bytes: 0,
        truncated: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return out;
}

/** One knowledge file, read and ready to be folded into a system contract. */
export interface LoadedKnowledge {
  readonly path: string;
  readonly note?: string;
  readonly text: string;
  /** True when the per-file or the total cap cut it short. */
  readonly truncated: boolean;
}

/**
 * Read the knowledge files, in order, honouring the caps.
 *
 * A file that cannot be read is SKIPPED and warned about on the server, not
 * thrown on and not announced to the model. Three reasons, in order of weight:
 * a turn must not fail because a note was renamed; the model cannot act on the
 * operator's typo; and the readout that CAN act on it — `resolveKnowledge`,
 * shown in the editor — is already in front of the person who made it.
 *
 * The cut is announced INSIDE the composed text where it happens (see
 * {@link composeProjectSystem}), because a truncated file the model believes it
 * has read whole is a model confidently answering from a document's first half.
 */
export async function loadKnowledge(project: ProjectRecord): Promise<LoadedKnowledge[]> {
  const out: LoadedKnowledge[] = [];
  let budget = KNOWLEDGE_LIMITS.bytesTotal;

  for (const file of project.knowledge.slice(0, KNOWLEDGE_LIMITS.files)) {
    if (budget <= 0) break;
    const resolved = resolveKnowledgePath(project, file);
    const cap = Math.min(KNOWLEDGE_LIMITS.bytesPerFile, budget);
    let handle: FileHandle | undefined;
    try {
      handle = await open(resolved, "r");
      const info = await handle.stat();
      if (!info.isFile()) throw new Error("not a file");
      // A bounded read rather than readFile-then-slice: the point of a cap is
      // that a 900 MB file never becomes a 900 MB buffer on the way to being
      // rejected.
      const buffer = Buffer.alloc(Math.min(cap, info.size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const text = buffer.subarray(0, bytesRead).toString("utf8");
      budget -= bytesRead;
      out.push({
        path: file.path,
        note: file.note,
        text,
        truncated: info.size > bytesRead
      });
    } catch (err) {
      console.warn(
        `[claude] project "${project.name}" knowledge file "${file.path}" was skipped: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      await handle?.close().catch(() => {
        /* already closed, or never opened */
      });
    }
  }
  return out;
}

/* -------------------------- the system contract itself ------------------------ */

/**
 * The project's half of a conversation's system contract — PURE, so the shape
 * of what reaches the CLI is testable without a filesystem, and so the gate
 * (*"a project's instructions and cwd demonstrably reach the CLI invocation"*)
 * can be asserted on the exact string.
 *
 * ── why the working directory is STATED and not merely set ───────────────────
 *
 * `params.cwd` already puts the CLI in the right tree; the model finds out by
 * running a tool and looking. Naming it in the contract is the *"surface it
 * deliberately rather than leaving it implicit"* half of the step, and it earns
 * its tokens: without it, a model asked about "the config" hunts for one, and a
 * model told which repository it is standing in answers about that repository's
 * config on the first attempt.
 */
export function composeProjectSystem(
  project: ProjectRecord,
  files: readonly LoadedKnowledge[]
): string {
  const parts: string[] = [];

  parts.push(
    `# Project: ${project.name}`,
    "",
    `Working directory: ${project.cwd}`,
    "",
    "Every command and file path in this conversation is relative to that directory unless " +
      "stated otherwise. It is the tree your tools read and write."
  );

  if (project.instructions.trim()) {
    parts.push("", "## Project instructions", "", project.instructions.trim());
  }

  if (files.length) {
    parts.push(
      "",
      "## Project knowledge",
      "",
      `${files.length} file${files.length === 1 ? "" : "s"} carried by this project, included ` +
        "verbatim below. They are on disk at the paths given and may have changed since; read " +
        "the file itself when precision matters."
    );
    for (const file of files) {
      parts.push("", `### ${file.path}${file.note ? ` — ${file.note}` : ""}`);
      if (file.truncated) {
        parts.push(
          "",
          `> TRUNCATED — only the first ${KNOWLEDGE_LIMITS.bytesPerFile / 1024} KB of this file ` +
            "is included. Read the rest from disk before relying on it being complete."
        );
      }
      // Fenced with a long fence so a knowledge file that itself contains ```
      // blocks — every README in this project does — cannot close it early.
      parts.push("", "``````", file.text.replace(/\s+$/, ""), "``````");
    }
  }

  return parts.join("\n");
}
