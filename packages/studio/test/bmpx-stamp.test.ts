/**
 * @file `manifest.revised` must be the day the write actually happened.
 *
 * All three `.bmpx` write routes stamped `new Date().toISOString().slice(0, 10)`
 * — UTC. This machine is behind UTC, so every write made after about 8pm local
 * recorded TOMORROW's date. Found on 2026-08-11 by a round-trip probe of
 * `/api/bmpx/plan`: the probe restored a step to its original values, expected
 * the file to come back unchanged, and found `"revised": "2026-08-12"` on a
 * save made at 20:08 on the 11th.
 *
 * The test pins the fix at the boundary that produced the bug rather than at a
 * convenient midday time, because a stamp function tested at noon passes while
 * being wrong for four hours a day.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { bmpxDateStamp } from "@axs/server/bmpxLocks";

test("the stamp is the LOCAL date, including late evening", () => {
  // The exact moment the defect was caught: 20:08 local on the 11th.
  const caught = new Date(2026, 7, 11, 20, 8, 0);
  assert.equal(bmpxDateStamp(caught), "2026-08-11");
});

test("it disagrees with the UTC stamp exactly where the bug lived", () => {
  const caught = new Date(2026, 7, 11, 20, 8, 0);
  const utc = caught.toISOString().slice(0, 10);
  if (caught.getTimezoneOffset() > 0) {
    // Behind UTC — the machine this was found on. The two MUST differ, or the
    // regression this test exists for would pass unnoticed.
    assert.notEqual(bmpxDateStamp(caught), utc, "local and UTC agree — this test proves nothing here");
  }
  // Whatever the zone, the stamp always describes the local calendar day.
  assert.equal(bmpxDateStamp(caught), `2026-08-${String(caught.getDate()).padStart(2, "0")}`);
});

test("month and day are zero-padded, so the stamps sort lexically", () => {
  assert.equal(bmpxDateStamp(new Date(2026, 0, 5, 12, 0, 0)), "2026-01-05");
  assert.equal(bmpxDateStamp(new Date(2026, 11, 31, 23, 59, 59)), "2026-12-31");
});

test("midnight local is the new day, not the old one", () => {
  assert.equal(bmpxDateStamp(new Date(2026, 7, 12, 0, 0, 0)), "2026-08-12");
  assert.equal(bmpxDateStamp(new Date(2026, 7, 11, 23, 59, 59)), "2026-08-11");
});
