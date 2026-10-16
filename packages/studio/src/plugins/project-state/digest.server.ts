/**
 * @file project-state digester — turn ONE session source into a small,
 * cacheable digest. The transcripts are the hazard (tens of MB each), so the
 * discipline from `axf-project-state.bmpx`'s notes is hard-coded here:
 *
 * - A `.jsonl` transcript is streamed line-by-line via `node:readline`, NEVER
 *   read whole. Junk lines are tolerated (skipped, not fatal). Only what the
 *   digest needs is kept: first user ask (trimmed to 400 chars), first/last
 *   entry timestamps, tool_use file paths (deduped, capped at 40), entry
 *   count, model ids seen.
 * - An archive-dir source is digested from the directory's OWN files: only
 *   `*.md` / `*.mdx` / `*.json` members under 64KB each, at most 10 members.
 *   (`summary.mdx` is the archiver's own summary document — the reason the
 *   markdown class includes `.mdx` — and `manifest.json` carries the stamp.)
 *   `session.json` is typically >64KB and is deliberately never read.
 *
 * Degrade never crash: a stream error mid-file returns the partial digest
 * accumulated so far; an unreadable member is skipped. Server-only.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import type { SessionSource } from "./sources.server";

/* --------------------------------- types ------------------------------------- */

export interface SessionDigest {
  id: string;
  title: string;
  /** ISO stamp of the first entry seen (or the archive's created stamp). */
  startedAt: string | null;
  /** ISO stamp of the last entry seen (or the archive dir's mtime). */
  lastActiveAt: string | null;
  /** First user-role text, trimmed to 400 chars. */
  firstAsk: string | null;
  /** tool_use file paths, deduped, capped at 40. */
  filesTouched: string[];
  /** Parsed transcript entries — or, for an archive, members digested. */
  entryCount: number;
  /** Distinct model ids seen on assistant entries. */
  models: string[];
}

const FIRST_ASK_MAX = 400;
const FILES_CAP = 40;
const ARCHIVE_MEMBER_CAP = 10;
const ARCHIVE_MEMBER_MAX_BYTES = 64 * 1024;

/* -------------------------------- helpers ------------------------------------ */

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}

function trimAsk(text: string): string {
  const t = text.trim();
  return t.length > FIRST_ASK_MAX ? `${t.slice(0, FIRST_ASK_MAX)}…` : t;
}

/** First plain-text payload of a message content (string or block array). */
function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const b = asRec(block);
      if (b?.type === "text" && typeof b.text === "string") return b.text;
    }
  }
  return null;
}

/**
 * A user entry that reads as the session's actual ask — not a sidechain
 * prompt, not a `<command-…>` / `<local-command-…>` / system-reminder wrapper,
 * not the resume caveat line.
 */
function isRealAsk(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && !t.startsWith("<") && !t.startsWith("Caveat:");
}

/* --------------------------- transcript digestion ----------------------------- */

async function digestTranscript(source: SessionSource): Promise<SessionDigest> {
  let startedAt: string | null = null;
  let lastActiveAt: string | null = null;
  let firstAsk: string | null = null;
  let entryCount = 0;
  const files = new Set<string>();
  const models = new Set<string>();

  const stream = fs.createReadStream(source.path, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry: Rec | null;
      try {
        entry = asRec(JSON.parse(line));
      } catch {
        continue; // junk line — tolerated
      }
      if (!entry) continue;
      entryCount++;

      if (typeof entry.timestamp === "string") {
        startedAt ??= entry.timestamp;
        lastActiveAt = entry.timestamp; // transcripts are append-ordered
      }

      const msg = asRec(entry.message);
      if (!msg) continue;

      if (firstAsk === null && entry.type === "user" && entry.isSidechain !== true) {
        const text = textOf(msg.content);
        if (text !== null && isRealAsk(text)) firstAsk = trimAsk(text);
      }

      if (entry.type === "assistant") {
        if (typeof msg.model === "string" && msg.model !== "<synthetic>") models.add(msg.model);
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            const b = asRec(block);
            if (b?.type !== "tool_use") continue;
            const input = asRec(b.input);
            const p = input?.file_path ?? input?.path ?? input?.notebook_path;
            if (typeof p === "string" && files.size < FILES_CAP) files.add(p);
          }
        }
      }
    }
  } catch {
    /* stream fault mid-file — the partial digest below is the honest result */
  } finally {
    rl.close();
    stream.destroy();
  }

  return {
    id: source.id,
    title: source.title,
    startedAt,
    lastActiveAt,
    firstAsk,
    filesTouched: [...files],
    entryCount,
    models: [...models],
  };
}

/* --------------------------- archive-dir digestion ---------------------------- */

/** Parse the archiver's `YYYY-MM-DD_HH-MM_` stamp off a dir basename. */
function slugStamp(basename: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})_/.exec(basename);
  return m ? `${m[1]}T${m[2]}:${m[3]}:00` : null;
}

/** The `## Summary` section's first paragraph, else the first plain line. */
function summaryParagraph(md: string): string | null {
  const lines = md.split(/\r?\n/);
  let inSummary = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^##\s+Summary\b/i.test(line)) {
      inSummary = true;
      continue;
    }
    if (!inSummary) continue;
    if (line.startsWith("#")) break;
    if (!line || line.startsWith(">")) continue;
    return line;
  }
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^[#>*[]/.test(line)) continue;
    return line;
  }
  return null;
}

async function digestArchiveDir(source: SessionSource): Promise<SessionDigest> {
  let startedAt: string | null = slugStamp(source.id);
  let lastActiveAt: string | null =
    source.mtimeMs > 0 ? new Date(source.mtimeMs).toISOString() : null;
  let firstAsk: string | null = null;
  let title = source.title;
  let entryCount = 0;
  const models = new Set<string>();

  let names: string[] = [];
  try {
    const entries = await fsp.readdir(source.path, { withFileTypes: true });
    names = entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    /* unreadable dir — digest from the slug alone */
  }

  // Deterministic member order, the informative pair first.
  const preferred = ["manifest.json", "summary.mdx"];
  const members = names
    .filter((n) => /\.(md|mdx|json)$/i.test(n))
    .sort((a, b) => {
      const pa = preferred.indexOf(a);
      const pb = preferred.indexOf(b);
      if (pa !== pb) return (pa === -1 ? preferred.length : pa) - (pb === -1 ? preferred.length : pb);
      return a.localeCompare(b);
    })
    .slice(0, ARCHIVE_MEMBER_CAP);

  for (const name of members) {
    const file = path.join(source.path, name).replace(/\\/g, "/");
    try {
      const st = await fsp.stat(file);
      if (st.size >= ARCHIVE_MEMBER_MAX_BYTES) continue; // e.g. session.json
      const content = await fsp.readFile(file, "utf8");
      entryCount++;
      if (name.endsWith(".json")) {
        const parsed = asRec(JSON.parse(content));
        if (parsed) {
          if (typeof parsed.created === "string") {
            startedAt = parsed.created;
            lastActiveAt ??= parsed.created;
          }
          if (typeof parsed.name === "string" && parsed.name.length > 0) title = parsed.name;
          if (typeof parsed.model === "string") models.add(parsed.model);
        }
      } else if (firstAsk === null) {
        const para = summaryParagraph(content);
        if (para) firstAsk = trimAsk(para);
      }
    } catch {
      continue; // unreadable or junk member — skipped, never fatal
    }
  }

  // The bundle's files/ dir holds copies of every file the session touched —
  // listing the names is enumeration, not a content read, and stays capped.
  let filesTouched: string[] = [];
  try {
    const copies = await fsp.readdir(path.join(source.path, "files"), { withFileTypes: true });
    filesTouched = copies
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .slice(0, FILES_CAP);
  } catch {
    /* no files/ dir — fine */
  }

  return {
    id: source.id,
    title,
    startedAt,
    lastActiveAt,
    firstAsk,
    filesTouched,
    entryCount,
    models: [...models],
  };
}

/* -------------------------------- dispatch ------------------------------------ */

/** Digest one session source. Never throws; never reads a transcript whole. */
export async function digestSession(source: SessionSource): Promise<SessionDigest> {
  return source.kind === "archive-dir" ? digestArchiveDir(source) : digestTranscript(source);
}
