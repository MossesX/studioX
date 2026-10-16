/**
 * @file P16 — the settings tree, locked. Pure layer only: the decl's rows, the
 * typed face derived from them, the group layout that renders them, and the two
 * pure answers the tree's rows feed (the record-format resolver and the reach
 * check's decision table). No browser and no kv server — the store itself is
 * core's and is already covered there.
 *
 * What this exists to catch is the ONE failure mode the design cannot see for
 * itself: the decl is the single source of every default, and `lib/prefs.ts`
 * puts a TypeScript face on it that is erased at runtime. Rename a row in the
 * decl and nothing complains — the face keeps compiling, `DEFAULT_PREFS` loses
 * a key, and every call site silently reads `undefined`. So the first test is
 * that the two agree, by discovery, in both directions.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { AMBERXVID_DECL } from "@axs/modules/amberxvid/amberxvid.decl";
import {
  DEFAULT_PREFS,
  PREFS_NS,
  PREF_GROUPS,
  PREF_KEYS,
  assertPrefsMatchDecl,
  clockHHMM,
  normalizePrefs,
  resolveRecordMime,
} from "@axs/modules/amberxvid/lib/prefs";

test("the typed face and the decl's rows describe the same document", () => {
  assert.deepEqual(assertPrefsMatchDecl(), []);
});

test("every default is READ off the decl, never restated", () => {
  const rows = AMBERXVID_DECL.settings?.rows ?? [];
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(
      (DEFAULT_PREFS as Record<string, unknown>)[row.key],
      row.defaultValue,
      `default for "${row.key}" drifted from its declaration`,
    );
  }
  assert.equal(PREFS_NS, AMBERXVID_DECL.settings?.ns);
});

test("every kv row lands in exactly one group of the tree", () => {
  const grouped = PREF_GROUPS.flatMap((g) => g.keys);
  const seen = new Set<string>();
  for (const key of grouped) {
    assert.ok(!seen.has(key), `"${key}" appears in two groups — two controls, one value`);
    seen.add(key);
  }
  // The four pre-P16 rows are deliberately NOT in a group: they are the
  // recorder and module-wide knobs, edited from the toolbar and the framework
  // dialog. Everything the tree claims to show, it shows.
  const ungrouped = PREF_KEYS.filter((k) => !seen.has(k));
  assert.deepEqual(
    [...ungrouped].sort(),
    ["animationIntensity", "backgroundArmed", "recorderQuality", "recorderResolution"],
    "a row was added to the decl and left out of every group — it would be invisible in the tree",
  );
  for (const key of grouped) {
    assert.ok(PREF_KEYS.includes(key), `group names "${key}", which is not a declared row`);
  }
});

test("the two document groups declare no kv keys, and the kv groups declare some", () => {
  for (const group of PREF_GROUPS) {
    if (group.source === "availability") assert.equal(group.keys.length, 0);
    if (group.source === "kv") assert.ok(group.keys.length > 0);
    assert.ok(group.blurb.trim().length > 0, `group "${group.id}" has no blurb`);
  }
  // MESSENGER is the mixed one on purpose — its document holds the chime and
  // the timestamps, and enter-to-send is genuinely a client behaviour.
  const messenger = PREF_GROUPS.find((g) => g.id === "messenger");
  assert.deepEqual(messenger?.keys, ["messengerEnterToSend"]);
});

test("every row states its reason — the ceiling's own rule", () => {
  for (const row of AMBERXVID_DECL.settings?.rows ?? []) {
    assert.ok(row.hint.trim().length > 20, `row "${row.key}" has no real hint`);
    assert.ok(row.label.trim().length > 0);
  }
});

test("normalizePrefs degrades junk to the DECLARED default, never to a zero value", () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs("nonsense"), DEFAULT_PREFS);
  assert.equal(normalizePrefs({ whoMayCall: 7 }).whoMayCall, DEFAULT_PREFS.whoMayCall);
  assert.equal(normalizePrefs({ ringAlerts: "yes" }).ringAlerts, DEFAULT_PREFS.ringAlerts);
  // A real value survives.
  assert.equal(normalizePrefs({ whoMayCall: "buddies" }).whoMayCall, "buddies");
});

test("the two numeric rows are clamped, not merely type-checked", () => {
  assert.equal(normalizePrefs({ ringVolume: 5000 }).ringVolume, 100);
  assert.equal(normalizePrefs({ ringVolume: -40 }).ringVolume, 0);
  assert.equal(normalizePrefs({ uplinkCapKbps: 99_999 }).uplinkCapKbps, 5000);
  assert.equal(
    normalizePrefs({ ringVolume: Number.NaN }).ringVolume,
    DEFAULT_PREFS.ringVolume,
    "NaN must land on the default rather than on silence",
  );
});

test("resolveRecordMime honours the choice, then the browser, then never throws", () => {
  const CANDIDATES = ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"];
  const all = () => true;
  const webmOnly = (m: string) => m.startsWith("video/webm");
  const none = () => false;

  // A named format that works is used verbatim.
  assert.equal(resolveRecordMime("video/mp4", all, CANDIDATES), "video/mp4");
  // A named format this browser cannot encode falls through to the best it can.
  assert.equal(resolveRecordMime("video/mp4", webmOnly, CANDIDATES), "video/webm;codecs=vp9,opus");
  // Automatic is that same fall-through.
  assert.equal(resolveRecordMime("auto", webmOnly, CANDIDATES), "video/webm;codecs=vp9,opus");
  // A browser that claims to support nothing still gets a container rather than
  // an exception — the recorder's own last resort.
  assert.equal(resolveRecordMime("auto", none, CANDIDATES), "video/webm");
});

test("clockHHMM spells a window the way the server's ledger does", () => {
  assert.equal(clockHHMM(0), "00:00");
  assert.equal(clockHHMM(510), "08:30");
  assert.equal(clockHHMM(22 * 60), "22:00");
  assert.equal(clockHHMM(1439), "23:59");
});
