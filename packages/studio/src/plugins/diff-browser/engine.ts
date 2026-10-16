/**
 * @file The N-way diff engine. Pure — no DOM, no React, no fetch.
 *
 * **Restored VERBATIM** by `axf-claude` P5 from
 * `assets/archive/build-archive/2026-08-09_19-15_axf-mui-v030-p0-prestrip.zip`,
 * where the v0.3.0 "strip to the frame" run archived it. Not one line changed,
 * and that is the point: the strip deleted the browser because its SCREEN was
 * written against the pre-MUI era, and a pure engine has no era. The `.tsx`
 * beside it was rebuilt; this was copied. Anything else would have re-earned
 * the verification the original already has (`axf-diff-browser.bmpx` P1).
 *
 * The problem this solves is not "diff two files". It is: given N historical
 * instances of one file, show each as a column and let a reader see, per column,
 * **what that revision introduced**. That needs two different comparisons and
 * they answer different questions:
 *
 *   - **vs previous** — what changed in this step. The normal reading.
 *   - **vs all earlier** — what appears here that has never appeared in ANY
 *     earlier instance. Different, and the one that matters when content moves
 *     around: a paragraph cut in revision 3 and pasted back in revision 5 is
 *     "added" against revision 4, but is not new to the document. Only the
 *     union comparison tells you that, and it is why the second filter exists.
 *
 * Alignment is the other half. Columns must scroll together with matching lines
 * on the same visual row, so the engine emits a shared row grid rather than N
 * independent line lists. Rows are built from the LAST column's line sequence
 * anchored back through the chain, with unmatched lines from earlier revisions
 * inserted at their nearest anchor — which keeps the newest revision readable
 * top to bottom (the common case) without dropping history.
 */

export interface Instance {
  /** Stable id — the history filename, or "live" for the current document. */
  readonly id: string;
  /** Display label, e.g. the timestamp. */
  readonly label: string;
  readonly text: string;
  /**
   * True for the current file rather than a snapshot. The rightmost column is
   * always this one, and it is styled differently — reading left to right should
   * arrive somewhere that is visibly "now" rather than at another backup.
   */
  readonly live?: boolean;
}

export type LineStatus =
  /** Present here and in the comparison base, unchanged. */
  | "same"
  /** Present here, absent from the comparison base. */
  | "added"
  /** Absent here, present in the base — rendered as a gap marker. */
  | "removed"
  /** No line occupies this row in this column. */
  | "empty";

export interface Cell {
  readonly text: string;
  /** 1-based line number within that instance, or null for a spacer row. */
  readonly lineNo: number | null;
  readonly vsPrev: LineStatus;
  readonly vsAll: LineStatus;
}

export interface Row {
  readonly key: number;
  /** One cell per instance, index-aligned with the instance list. */
  readonly cells: readonly Cell[];
}

export interface DiffModel {
  readonly instances: readonly Instance[];
  readonly rows: readonly Row[];
  /** Per column: how many lines it introduced, under each comparison. */
  readonly stats: readonly { added: number; removed: number; addedVsAll: number }[];
}

/* ------------------------------------------------------------------ diffing */

type Op = { tag: "same" | "add" | "del"; a: number; b: number };

/**
 * Longest-common-subsequence diff over lines.
 *
 * Hashing lines to integers first makes the inner loop integer comparisons
 * instead of string comparisons, which matters at 8 columns × 500 lines where
 * this runs on every filter change. Falls back to a cheap prefix/suffix trim
 * before the matrix, because consecutive revisions of a document usually share
 * long identical heads and tails and the matrix is O(n·m).
 */
function diffLines(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ tag: "same", a: i, b: i });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length && midB.length) {
    // LCS table over the trimmed middle only.
    const n = midA.length;
    const m = midB.length;
    const table: Uint32Array = new Uint32Array((n + 1) * (m + 1));
    const at = (i: number, j: number) => i * (m + 1) + j;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[at(i, j)] =
          midA[i] === midB[j]
            ? table[at(i + 1, j + 1)] + 1
            : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ tag: "same", a: start + i, b: start + j });
        i++;
        j++;
      } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
        ops.push({ tag: "del", a: start + i, b: -1 });
        i++;
      } else {
        ops.push({ tag: "add", a: -1, b: start + j });
        j++;
      }
    }
    while (i < n) ops.push({ tag: "del", a: start + i++, b: -1 });
    while (j < m) ops.push({ tag: "add", a: -1, b: start + j++ });
  } else {
    for (let i = start; i < endA; i++) ops.push({ tag: "del", a: i, b: -1 });
    for (let j = start; j < endB; j++) ops.push({ tag: "add", a: -1, b: j });
  }

  for (let k = 0; k < a.length - endA; k++) {
    ops.push({ tag: "same", a: endA + k, b: endB + k });
  }
  return ops;
}

const splitLines = (text: string): string[] => text.replace(/\r\n/g, "\n").split("\n");

/** Normalised form used for "have I ever seen this line" membership. */
const norm = (line: string): string => line.trim();

/**
 * Build the aligned model.
 *
 * The row grid is anchored on the NEWEST instance because that is what a reader
 * is actually reading; earlier-only lines are placed at the position where they
 * diverged. The alternative — aligning on the oldest — produces a grid where the
 * current document is full of holes, which reads as damage.
 */
export function buildModel(instances: readonly Instance[]): DiffModel {
  if (instances.length === 0) return { instances, rows: [], stats: [] };

  const lines = instances.map((i) => splitLines(i.text));

  // "Seen before" sets, for the vs-all comparison.
  const seenBefore: Set<string>[] = [];
  const running = new Set<string>();
  for (const set of lines) {
    seenBefore.push(new Set(running));
    for (const line of set) running.add(norm(line));
  }

  // Ops for each consecutive pair, used for vsPrev status.
  const pairOps = lines.slice(1).map((cur, k) => diffLines(lines[k], cur));

  const statusVsPrev: LineStatus[][] = lines.map((set, col) =>
    set.map(() => (col === 0 ? "same" : "same"))
  );
  pairOps.forEach((ops, k) => {
    const col = k + 1;
    for (const op of ops) {
      if (op.tag === "add") statusVsPrev[col][op.b] = "added";
    }
  });

  /* Row alignment: walk the newest column and thread earlier columns onto it.
     A full N-way alignment is exponential; threading pairwise from the newest
     backwards is linear and produces the same grid for the overwhelmingly
     common case of a document edited in place. */
  const last = lines.length - 1;
  const rows: Row[] = [];
  // For each column, the index of the line that maps to each row of the newest.
  const mapToNewest: (number | null)[][] = lines.map(() => []);

  // Map every column onto the newest by chaining the pair ops backwards.
  const chain: (number | null)[][] = lines.map((set) => set.map((_, i) => i));
  for (let col = last - 1; col >= 0; col--) {
    const ops = pairOps[col];
    const nextOf = new Map<number, number>();
    for (const op of ops) if (op.tag === "same") nextOf.set(op.a, op.b);
    chain[col] = lines[col].map((_, i) => {
      const inNext = nextOf.get(i);
      if (inNext === undefined) return null;
      return chain[col + 1][inNext] ?? null;
    });
  }
  for (let col = 0; col <= last; col++) mapToNewest[col] = chain[col];

  const orphanRowsByCol: Map<number, { line: string; index: number }[]>[] = lines.map(
    () => new Map()
  );
  for (let col = 0; col < last; col++) {
    let anchor = -1;
    lines[col].forEach((line, i) => {
      const target = mapToNewest[col][i];
      if (target !== null && target !== undefined) {
        anchor = target;
      } else {
        const bucket = orphanRowsByCol[col].get(anchor) ?? [];
        bucket.push({ line, index: i });
        orphanRowsByCol[col].set(anchor, bucket);
      }
    });
  }

  const cellFor = (col: number, index: number | null): Cell => {
    if (index === null) {
      return { text: "", lineNo: null, vsPrev: "empty", vsAll: "empty" };
    }
    const text = lines[col][index];
    const isNewVsAll = !seenBefore[col].has(norm(text)) && norm(text) !== "";
    return {
      text,
      lineNo: index + 1,
      vsPrev: col === 0 ? "added" : statusVsPrev[col][index],
      vsAll: col === 0 ? "added" : isNewVsAll ? "added" : "same"
    };
  };

  let key = 0;
  const emitOrphans = (anchor: number) => {
    const depth = Math.max(
      0,
      ...orphanRowsByCol.map((m) => m.get(anchor)?.length ?? 0)
    );
    for (let d = 0; d < depth; d++) {
      rows.push({
        key: key++,
        cells: lines.map((_, col) => {
          const bucket = orphanRowsByCol[col]?.get(anchor);
          const entry = bucket?.[d];
          return entry ? cellFor(col, entry.index) : cellFor(col, null);
        })
      });
    }
  };

  emitOrphans(-1);
  lines[last].forEach((_, newestIndex) => {
    const cells = lines.map((_, col) => {
      if (col === last) return cellFor(last, newestIndex);
      const found = mapToNewest[col].findIndex((t) => t === newestIndex);
      return cellFor(col, found === -1 ? null : found);
    });
    rows.push({ key: key++, cells });
    emitOrphans(newestIndex);
  });

  const stats = lines.map((set, col) => {
    let added = 0;
    let addedVsAll = 0;
    set.forEach((line, i) => {
      if (col > 0 && statusVsPrev[col][i] === "added") added++;
      if (col > 0 && !seenBefore[col].has(norm(line)) && norm(line) !== "") addedVsAll++;
    });
    const removed =
      col === 0 ? 0 : pairOps[col - 1].filter((o) => o.tag === "del").length;
    return { added, removed, addedVsAll };
  });

  return { instances, rows, stats };
}

/* -------------------------------------------------------------------- find */

export interface Hit {
  readonly rowKey: number;
  readonly col: number;
  readonly start: number;
  readonly end: number;
}

/**
 * All matches for a query, in reading order (row, then column).
 *
 * Case-insensitive substring rather than regex: a find bar that throws on an
 * unbalanced bracket while you are still typing the pattern is worse than one
 * that cannot do regex at all.
 */
export function findHits(
  rows: readonly Row[],
  query: string,
  columns: readonly number[]
): Hit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: Hit[] = [];
  for (const row of rows) {
    for (const col of columns) {
      const cell = row.cells[col];
      if (!cell || !cell.text) continue;
      const hay = cell.text.toLowerCase();
      let from = 0;
      for (;;) {
        const at = hay.indexOf(needle, from);
        if (at === -1) break;
        hits.push({ rowKey: row.key, col, start: at, end: at + needle.length });
        from = at + needle.length;
      }
    }
  }
  return hits;
}

/** Rows a column should show under the changes-only filter. */
export function changedRowKeys(
  rows: readonly Row[],
  col: number,
  base: "prev" | "all"
): Set<number> {
  const keys = new Set<number>();
  for (const row of rows) {
    const cell = row.cells[col];
    if (!cell) continue;
    const status = base === "prev" ? cell.vsPrev : cell.vsAll;
    if (status === "added" || status === "removed") keys.add(row.key);
  }
  return keys;
}
