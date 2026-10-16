/**
 * @file The N-way diff engine — `axf-claude` P5.
 *
 * The engine was restored VERBATIM from the pre-strip archive, and it arrived
 * with no unit test: `axf-diff-browser.bmpx` records that it was verified LIVE,
 * on the real `.history/PLANNING-STATE` instances (*"changes-only cut 1611 rows
 * to 1135"*), which is a genuine verification and an unrepeatable one. Three
 * checklist rows in that file are explicitly marked *"NOT RE-VERIFIED IN ANY
 * RECORD"*. So the engine's behaviour was, until now, held entirely by a
 * screenshot somebody took once.
 *
 * These are the properties the engine EXISTS for, held against fixtures small
 * enough to read:
 *
 *   1. the two comparisons genuinely differ — the paragraph cut in one revision
 *      and pasted back in a later one is "added" against its neighbour and NOT
 *      new to the document. That case is the entire argument for the second
 *      filter, and nothing checked it;
 *   2. the row grid is anchored on the NEWEST instance, so the current document
 *      reads top to bottom without holes;
 *   3. find is stable and ordered; the changes-only filter answers per column
 *      and per base.
 *
 * Pure — no DOM, no fetch, no filesystem, exactly as the engine is.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildModel, changedRowKeys, findHits } from "../src/plugins/diff-browser/engine";
import type { Instance } from "../src/plugins/diff-browser/engine";

const inst = (id: string, text: string, live = false): Instance => ({
  id,
  label: id,
  text,
  ...(live ? { live: true } : {})
});

/** Column `col`'s text, in row order, holes included as empty strings. */
const column = (model: ReturnType<typeof buildModel>, col: number): string[] =>
  model.rows.map((r) => r.cells[col]?.text ?? "");

test("an empty instance list is an empty model, not a crash", () => {
  const model = buildModel([]);
  assert.deepEqual(model.rows, []);
  assert.deepEqual(model.stats, []);
});

test("the newest column reads top to bottom with no holes", () => {
  const model = buildModel([
    inst("r1", "alpha\nbeta\ngamma"),
    inst("r2", "alpha\nbeta\ndelta\ngamma", true)
  ]);
  assert.deepEqual(
    column(model, 1).filter(Boolean),
    ["alpha", "beta", "delta", "gamma"],
    "the current document is the anchor — a grid full of holes reads as damage"
  );
  // The older column keeps its lines aligned to the ones that survived.
  const older = column(model, 0);
  assert.deepEqual(older.filter(Boolean), ["alpha", "beta", "gamma"]);
});

test("vs-previous marks what this revision introduced", () => {
  const model = buildModel([inst("r1", "a\nb"), inst("r2", "a\nNEW\nb")]);
  const added = model.rows
    .map((r) => r.cells[1])
    .filter((c) => c?.vsPrev === "added")
    .map((c) => c!.text);
  assert.deepEqual(added, ["NEW"]);
  assert.equal(model.stats[1]!.added, 1);
  assert.equal(model.stats[0]!.added, 0, "the first column introduces nothing — there is no base");
});

test("THE CASE THE SECOND FILTER EXISTS FOR: cut, then pasted back", () => {
  // "gamma" is present in r1, cut in r2, and pasted back in r3. Against its
  // neighbour it is an addition; against the union of everything earlier it is
  // not new to the document at all. Only the second comparison says so, and
  // that difference is the whole reason the base toggle exists.
  const model = buildModel([
    inst("r1", "alpha\ngamma"),
    inst("r2", "alpha"),
    inst("r3", "alpha\ngamma", true)
  ]);
  const gamma = model.rows.map((r) => r.cells[2]).find((c) => c?.text === "gamma")!;
  assert.equal(gamma.vsPrev, "added", "it IS new relative to the revision before it");
  assert.equal(gamma.vsAll, "same", "and it is NOT new to the document");
  assert.equal(model.stats[2]!.added, 1);
  assert.equal(model.stats[2]!.addedVsAll, 0);
});

test("changedRowKeys answers per column and per base", () => {
  const model = buildModel([
    inst("r1", "alpha\ngamma"),
    inst("r2", "alpha"),
    inst("r3", "alpha\ngamma", true)
  ]);
  const vsPrev = changedRowKeys(model.rows, 2, "prev");
  const vsAll = changedRowKeys(model.rows, 2, "all");
  assert.equal(vsPrev.size, 1, "one line came back");
  assert.equal(vsAll.size, 0, "and none of it is new to the document");

  // THE OLDEST COLUMN IS A DELIBERATE ASYMMETRY, and it is worth pinning
  // because it looks like a bug until you say it out loud. `cellFor` marks
  // every cell of column 0 as "added": there is no earlier revision, so
  // everything in the oldest snapshot IS new, and filtering it to changes-only
  // correctly shows the whole file rather than an empty column. Its STATS say 0
  // for the same reason from the other side — "this revision introduced 2
  // lines" would be a meaningless number against no base. Two different
  // questions, two different right answers.
  assert.equal(changedRowKeys(model.rows, 0, "prev").size, 2, "the oldest revision is all new");
  assert.equal(model.stats[0]!.added, 0, "but it is credited with introducing nothing");
});

test("find returns every match in reading order, scoped to the column asked for", () => {
  const model = buildModel([inst("r1", "one two\nthree"), inst("r2", "one two two\nthree", true)]);
  const hits = findHits(model.rows, "two", [1]);
  assert.equal(hits.length, 2, "both occurrences on one line are separate hits");
  assert.ok(hits.every((h) => h.col === 1));
  assert.ok(hits[0]!.start < hits[1]!.start, "in reading order within the line");

  assert.equal(findHits(model.rows, "TWO", [1]).length, 2, "case-insensitive");
  assert.deepEqual(findHits(model.rows, "   ", [0, 1]), [], "a blank query matches nothing");
  assert.equal(findHits(model.rows, "two", [0]).length, 1, "column 0 has only the one");
  assert.equal(
    findHits(model.rows, "two", [0, 1]).length,
    3,
    "global mode is the same call over more columns"
  );
});

test("windows line endings do not become part of the lines", () => {
  const model = buildModel([inst("r1", "a\r\nb"), inst("r2", "a\r\nb\r\nc", true)]);
  assert.deepEqual(column(model, 1).filter(Boolean), ["a", "b", "c"]);
  assert.equal(model.stats[1]!.added, 1, "not three, which is what a stray \\r would produce");
});
