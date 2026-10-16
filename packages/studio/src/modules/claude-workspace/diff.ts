/**
 * @file Line diffs for file-edit tool calls — P3's *"file-edit diffs"*.
 *
 * ── where the two sides come from, and the honest limit ──────────────────────
 *
 * The captured transcript (`test/fixtures/claude-stream/`) shows what an edit
 * actually looks like on the wire:
 *
 *   `Edit`  → `{ file_path, old_string, new_string, replace_all }`
 *   `Write` → `{ file_path, content }`
 *
 * So an `Edit` carries BOTH sides and diffs exactly. A `Write` carries only the
 * new content — the transport never sends what the file held before — and this
 * file says so rather than inventing a before. A Write renders as an all-added
 * diff, labelled as a whole-file write, which is what it is.
 *
 * That is the limit worth stating up front, because the alternative (reading
 * the file off disk to reconstruct the before) would be the workspace reaching
 * around its own transport into the filesystem the CLI runs in — and it would
 * be wrong as often as it was right, since by the time anyone looks the file
 * has already been written.
 *
 * ── the algorithm, and why this one ──────────────────────────────────────────
 *
 * Myers would be the textbook answer. This is LCS over a dynamic-programming
 * table, which is O(n·m) in time and memory — deliberately, and bounded: past
 * {@link MAX_DIFF_LINES} the pair is reported as a REPLACEMENT rather than
 * diffed. A transcript is full of edits to 3-line hunks and occasionally
 * carries a 4,000-line generated file, and an unbounded quadratic diff inside a
 * render is a frozen tab. Refusing loudly at a stated size beats being slow at
 * an unstated one.
 *
 * PURE — no React, no DOM, no node builtins.
 */

/** Above this many lines on either side, the pair is not diffed at all. */
export const MAX_DIFF_LINES = 1500;
/** Unchanged lines kept either side of a change. */
export const CONTEXT_LINES = 3;

export type DiffRowKind = "context" | "add" | "del";

export interface DiffRow {
  readonly kind: DiffRowKind;
  readonly text: string;
  /** 1-based line number on the old side; null on an addition. */
  readonly oldLine: number | null;
  /** 1-based line number on the new side; null on a deletion. */
  readonly newLine: number | null;
}

export interface DiffHunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly rows: readonly DiffRow[];
}

export interface FileDiff {
  readonly path: string | null;
  /** What produced it: an `Edit`'s two strings, or a `Write`'s whole content. */
  readonly mode: "edit" | "write";
  readonly hunks: readonly DiffHunk[];
  readonly added: number;
  readonly removed: number;
  /**
   * Set when the pair was too large to diff. The rows are then a single
   * replacement hunk, and a renderer says so instead of implying a real diff.
   */
  readonly truncated: boolean;
  /** `Edit` with `replace_all` — the edit applied at every occurrence, which is
   *  a materially different act from the first-match default. */
  readonly replaceAll: boolean;
}

const splitLines = (text: string): string[] => text.replace(/\r\n?/g, "\n").split("\n");

/**
 * LCS lengths table, rows only — the full table is what makes the backtrack
 * possible, and at MAX_DIFF_LINES² of `Uint32Array` it is the bounded cost the
 * header describes.
 */
function lcsTable(a: readonly string[], b: readonly string[]): Uint32Array {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + (j + 1)]!);
    }
  }
  return table;
}

/** Every row of the diff, unhunked — deletions before additions at a change,
 *  which is how a reader expects to see "this became that". */
function diffRows(a: readonly string[], b: readonly string[]): DiffRow[] {
  const width = b.length + 1;
  const table = lcsTable(a, b);
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: "context", text: a[i]!, oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + (j + 1)]!) {
      rows.push({ kind: "del", text: a[i]!, oldLine: i + 1, newLine: null });
      i++;
    } else {
      rows.push({ kind: "add", text: b[j]!, oldLine: null, newLine: j + 1 });
      j++;
    }
  }
  while (i < a.length) {
    rows.push({ kind: "del", text: a[i]!, oldLine: i + 1, newLine: null });
    i++;
  }
  while (j < b.length) {
    rows.push({ kind: "add", text: b[j]!, oldLine: null, newLine: j + 1 });
    j++;
  }
  return rows;
}

/** Cut the row list down to changes plus {@link CONTEXT_LINES} either side. */
function toHunks(rows: readonly DiffRow[]): DiffHunk[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, index) => {
    if (row.kind === "context") return;
    for (let k = Math.max(0, index - CONTEXT_LINES); k <= Math.min(rows.length - 1, index + CONTEXT_LINES); k++) {
      keep[k] = true;
    }
  });

  const hunks: DiffHunk[] = [];
  let current: DiffRow[] = [];
  let oldStart = 0;
  let newStart = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (!current.length) {
        oldStart = row.oldLine ?? oldStart;
        newStart = row.newLine ?? newStart;
      }
      current.push(row);
      return;
    }
    if (current.length) {
      hunks.push({ oldStart, newStart, rows: current });
      current = [];
    }
  });
  if (current.length) hunks.push({ oldStart, newStart, rows: current });
  return hunks;
}

function tally(hunks: readonly DiffHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const row of hunk.rows) {
      if (row.kind === "add") added++;
      else if (row.kind === "del") removed++;
    }
  }
  return { added, removed };
}

/** The whole pair as one replacement — the over-size answer, honestly shaped. */
function replacement(a: readonly string[], b: readonly string[]): DiffHunk[] {
  const rows: DiffRow[] = [
    ...a.map((text, index): DiffRow => ({ kind: "del", text, oldLine: index + 1, newLine: null })),
    ...b.map((text, index): DiffRow => ({ kind: "add", text, oldLine: null, newLine: index + 1 }))
  ];
  return rows.length ? [{ oldStart: 1, newStart: 1, rows }] : [];
}

export function diffStrings(
  before: string,
  after: string,
  opts: { path?: string | null; mode?: "edit" | "write"; replaceAll?: boolean } = {}
): FileDiff {
  const a = before ? splitLines(before) : [];
  const b = after ? splitLines(after) : [];
  const truncated = a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES;
  const hunks = truncated ? replacement(a, b) : toHunks(diffRows(a, b));
  return {
    path: opts.path ?? null,
    mode: opts.mode ?? "edit",
    hunks,
    ...tally(hunks),
    truncated,
    replaceAll: opts.replaceAll === true
  };
}

/* ------------------------- recognising a file edit -------------------------- */

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * A file diff out of a tool call's input, or null when the call is not an edit.
 *
 * Keyed on the INPUT SHAPE rather than on the tool name, and that is a
 * deliberate reversal of the obvious design. A name check (`name === "Edit"`)
 * breaks the moment a tool is renamed or an MCP server exposes its own editor,
 * and it breaks SILENTLY — the card just stops showing a diff, which reads as
 * "this edit did nothing visible". The shape `{file_path, old_string,
 * new_string}` is what an edit IS, and anything carrying it can be diffed
 * whatever it calls itself. The name is still passed so a caller can label it.
 */
export function fileDiffOf(name: string, input: unknown): FileDiff | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const fields = input as Record<string, unknown>;
  const path = str(fields.file_path) ?? str(fields.path) ?? str(fields.filePath);

  const oldString = str(fields.old_string) ?? str(fields.oldString);
  const newString = str(fields.new_string) ?? str(fields.newString);
  if (oldString !== null && newString !== null) {
    return diffStrings(oldString, newString, {
      path,
      mode: "edit",
      replaceAll: fields.replace_all === true || fields.replaceAll === true
    });
  }

  // A whole-file write: only the after side exists, and the diff says so.
  const content = str(fields.content) ?? str(fields.new_content);
  if (content !== null && path !== null) {
    return diffStrings("", content, { path, mode: "write" });
  }

  // `name` is unused for recognition on purpose (see the docblock) but is kept
  // in the signature: a caller labels the card with it, and dropping the
  // parameter would make every call site look it up again.
  void name;
  return null;
}

/** `@@ -a,b +c,d @@`, for the copy-as-patch affordance. */
export function hunkHeader(hunk: DiffHunk): string {
  const oldCount = hunk.rows.filter((r) => r.kind !== "add").length;
  const newCount = hunk.rows.filter((r) => r.kind !== "del").length;
  return `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
}

/** The whole diff as a unified patch — what the "copy diff" button writes. */
export function toUnifiedPatch(diff: FileDiff): string {
  const name = diff.path ?? "file";
  const lines = [`--- a/${name}`, `+++ b/${name}`];
  for (const hunk of diff.hunks) {
    lines.push(hunkHeader(hunk));
    for (const row of hunk.rows) {
      lines.push(`${row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}${row.text}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
