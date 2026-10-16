/**
 * @file P3 — the amberxvid rows of the accounts policy catalog, and the places
 * they bite.
 *
 * The properties worth the most, in order:
 *
 * 1. **Every guard actually goes red.** A guard nobody has watched fail is a
 *    guard nobody has tested — and these are doubly worth watching, because the
 *    cascade that will supply the real values does not exist on disk yet (see
 *    `lib/policy.ts`'s header), so with no source installed every one of them
 *    passes. A test that only ever saw them pass would be testing nothing.
 * 2. **A refusal names the row and the effective value.** That is the whole
 *    difference between a policy and an admin ticket, so it is asserted on the
 *    `row`/`value` fields rather than by matching prose.
 * 3. **The site defaults equal the constants they replaced.** Installing the
 *    cascade must change NOTHING until an administrator moves a dial; the three
 *    numbers are duplicated across two files by necessity (a cycle otherwise)
 *    and this is what stops the duplication rotting.
 * 4. **A junk override becomes the default, not a policy.** The cascade is
 *    trusted to resolve precedence, not to have been typed correctly.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  AMBERXVID_POLICY_ROWS,
  amberxvidPolicyDefaults,
  amberxvidPolicyStatus,
  assertAlbumCount,
  assertAlbumItemBytes,
  assertCanBuyCredits,
  assertCanComment,
  assertCanHostStreams,
  assertCanJoinGroupRooms,
  assertCanPostWall,
  assertCanRecordServerSide,
  assertCanSendInvites,
  assertCanStartCalls,
  assertCanUploadAlbums,
  assertStreamViewerRoom,
  effectiveAmberxvidPolicy,
  hostStreamViewerLimit,
  setAmberxvidPolicySource,
} from "../src/modules/amberxvid/lib/policy";
import { ALBUMS_PER_OWNER_MAX, maxPhotoBytes } from "../src/modules/amberxvid/lib/albums";
import { THREAD_MEMBERS_MAX } from "../src/modules/accounts/lib/types";

/** Install a cascade that answers `values` for everybody, for one test. */
function withPolicy(values: Record<string, unknown>, fn: () => Promise<void>): Promise<void> {
  setAmberxvidPolicySource(() => values);
  return fn().finally(() => setAmberxvidPolicySource(null));
}

const MB = 1024 * 1024;

/* ------------------------------- the catalog ---------------------------------- */

test("the catalog contributes exactly the thirteen named rows", () => {
  assert.deepEqual(
    AMBERXVID_POLICY_ROWS.map((r) => r.key).sort(),
    [
      "canBuyCredits",
      "canComment",
      "canHostStreams",
      "canJoinGroupRooms",
      "canPostWall",
      "canRecordServerSide",
      "canSendInvites",
      "canStartCalls",
      "canUploadAlbums",
      "maxAlbumItemMB",
      "maxAlbums",
      "maxGroupChatMembers",
      "streamViewerLimit",
    ],
  );
});

test("every row uses a kind the generic editor already renders, and states its reason", () => {
  for (const row of AMBERXVID_POLICY_ROWS) {
    // `switch` and `number` only — the point of one catalog is that the admin
    // suite needs NO change, and a kind its editor lacks would need one.
    assert.ok(row.kind === "switch" || row.kind === "number", `${row.key}: ${row.kind}`);
    assert.equal(row.group, "AmberX Vid");
    assert.ok(row.label.trim().length > 0, `${row.key} has no label`);
    assert.ok(row.hint.trim().length > 0, `${row.key} has no hint`);
    if (row.kind === "switch") {
      assert.equal(typeof row.defaultValue, "boolean", row.key);
      assert.equal(row.min, undefined, `${row.key}: min belongs to number rows`);
    } else {
      assert.equal(typeof row.defaultValue, "number", row.key);
      // Both bounds together — an unbounded dial is a typo amplifier.
      assert.equal(typeof row.min, "number", `${row.key} has no min`);
      assert.equal(typeof row.max, "number", `${row.key} has no max`);
      const d = row.defaultValue as number;
      assert.ok(d >= (row.min as number) && d <= (row.max as number), `${row.key} default out of range`);
    }
  }
});

test("the site posture is permissive, matching the default-allow matrix it extends", () => {
  const d = amberxvidPolicyDefaults();
  assert.equal(d.canHostStreams, true);
  assert.equal(d.canJoinGroupRooms, true);
  assert.equal(d.canStartCalls, true);
  assert.equal(d.canPostWall, true);
  assert.equal(d.canComment, true);
  assert.equal(d.canUploadAlbums, true);
  assert.equal(d.canRecordServerSide, true);
  assert.equal(d.canSendInvites, true);
  assert.equal(d.canBuyCredits, true);
  // 0 is this catalog's spelling of "no cap" — today's behaviour exactly.
  assert.equal(d.streamViewerLimit, 0);
});

test("the four duplicated numbers still equal the constants they mirror", () => {
  const d = amberxvidPolicyDefaults();
  assert.equal(d.maxAlbums, ALBUMS_PER_OWNER_MAX);
  assert.equal(d.maxAlbumItemMB, maxPhotoBytes() / MB);
  // P5: installing the cascade must not change the group size a studio
  // already has, so the row's default IS the thread store's site default.
  assert.equal(d.maxGroupChatMembers, THREAD_MEMBERS_MAX);
});

/* ------------------------------ honest absence -------------------------------- */

test("with no cascade installed the absence is STATED, and every row is its default", async () => {
  const status = amberxvidPolicyStatus();
  assert.equal(status.installed, false);
  assert.match(status.installed === false ? status.why : "", /site defaults/i);
  assert.deepEqual(await effectiveAmberxvidPolicy("nobody"), amberxvidPolicyDefaults());
  // And, being permissive, everything passes — which is exactly why the
  // refusals below have to be watched against an installed source.
  assert.equal((await assertCanHostStreams("nobody")).ok, true);
});

/* -------------------------------- the switches --------------------------------- */

test("every switch guard refuses when its row is off, naming the row", async () => {
  const cases: Array<[string, (u: string) => Promise<{ ok: boolean }>]> = [
    ["canHostStreams", assertCanHostStreams],
    ["canJoinGroupRooms", assertCanJoinGroupRooms],
    ["canStartCalls", assertCanStartCalls],
    ["canPostWall", assertCanPostWall],
    ["canComment", assertCanComment],
    ["canUploadAlbums", assertCanUploadAlbums],
    ["canRecordServerSide", assertCanRecordServerSide],
    ["canSendInvites", assertCanSendInvites],
    ["canBuyCredits", assertCanBuyCredits],
  ];
  for (const [key, guard] of cases) {
    await withPolicy({ [key]: false }, async () => {
      const verdict = (await guard("mo")) as {
        ok: boolean;
        status?: number;
        row?: string;
        value?: unknown;
        error?: string;
      };
      assert.equal(verdict.ok, false, `${key} did not refuse`);
      assert.equal(verdict.status, 403, `${key} wrong status`);
      assert.equal(verdict.row, key, `${key} did not name itself`);
      assert.equal(verdict.value, false);
      // The reason has to be IN the sentence — that is the difference between
      // a policy refusal and an admin ticket.
      assert.match(verdict.error ?? "", new RegExp(key));
      assert.match(verdict.error ?? "", /administrator/i);
    });
    // …and passes when the row is on, so the test is not just asserting "no".
    await withPolicy({ [key]: true }, async () => {
      assert.equal((await guard("mo")).ok, true, `${key} refused while allowed`);
    });
  }
});

/* --------------------------------- the limits ---------------------------------- */

test("the stream viewer cap is the HOST's row, resolved once and pinned", async () => {
  await withPolicy({ streamViewerLimit: 3 }, async () => {
    assert.equal(await hostStreamViewerLimit("host"), 3);
  });
  // 0 means uncapped, and must never become a zero-seat stream.
  await withPolicy({ streamViewerLimit: 0 }, async () => {
    assert.equal(await hostStreamViewerLimit("host"), null);
  });

  // The join-side check takes the PINNED number, so it is synchronous.
  assert.equal(assertStreamViewerRoom(null, 9_999).ok, true);
  assert.equal(assertStreamViewerRoom(3, 2).ok, true);
  const full = assertStreamViewerRoom(3, 3);
  assert.equal(full.ok, false);
  assert.equal(full.ok === false && full.status, 409);
  assert.equal(full.ok === false && full.row, "streamViewerLimit");
  assert.equal(full.ok === false && full.value, 3);
  assert.match(full.ok === false ? full.error : "", /3 viewers/);
});

test("the album count refuses AT the limit, naming the number", async () => {
  await withPolicy({ maxAlbums: 2 }, async () => {
    assert.equal((await assertAlbumCount("mo", 1)).ok, true);
    const denied = await assertAlbumCount("mo", 2);
    assert.equal(denied.ok, false);
    assert.equal(denied.ok === false && denied.status, 409);
    assert.equal(denied.ok === false && denied.row, "maxAlbums");
    assert.equal(denied.ok === false && denied.value, 2);
    assert.match(denied.ok === false ? denied.error : "", /limit of 2/);
  });
});

test("the per-photo cap names WHICH limit bit — policy or the deployment", async () => {
  // Policy tighter than the deployment: the row is the one to raise.
  await withPolicy({ maxAlbumItemMB: 5 }, async () => {
    assert.equal((await assertAlbumItemBytes("mo", 4 * MB, 25 * MB)).ok, true);
    const denied = await assertAlbumItemBytes("mo", 6 * MB, 25 * MB);
    assert.equal(denied.ok, false);
    assert.equal(denied.ok === false && denied.status, 413);
    assert.equal(denied.ok === false && denied.row, "maxAlbumItemMB");
    assert.equal(denied.ok === false && denied.value, 5);
    assert.match(denied.ok === false ? denied.error : "", /your per-photo limit is 5 MB/);
  });

  // Deployment tighter than policy: raising the row would NOT help, and the
  // refusal has to say so rather than sending an admin to the wrong dial.
  await withPolicy({ maxAlbumItemMB: 100 }, async () => {
    const denied = await assertAlbumItemBytes("mo", 30 * MB, 25 * MB);
    assert.equal(denied.ok, false);
    assert.match(denied.ok === false ? denied.error : "", /server limit/);
    assert.match(denied.ok === false ? denied.error : "", /will not help/);
  });
});

/* ------------------------------ hostile answers -------------------------------- */

test("a junk or out-of-range override becomes the default or the bound, never a policy", async () => {
  await withPolicy(
    {
      canHostStreams: "yes", // not a boolean
      maxAlbums: -5, // below min
      maxAlbumItemMB: 99_999, // above max
      streamViewerLimit: Number.NaN,
    },
    async () => {
      const p = await effectiveAmberxvidPolicy("mo");
      assert.equal(p.canHostStreams, true, "a junk switch must fall back to its default");
      assert.equal(p.maxAlbums, 0, "below-min clamps to min");
      assert.equal(p.maxAlbumItemMB, 512, "above-max clamps to max");
      assert.equal(p.streamViewerLimit, 0, "NaN falls back to the default");
    },
  );
});

test("a cascade that throws does not take the feature down with it", async () => {
  setAmberxvidPolicySource(() => {
    throw new Error("policy store on fire");
  });
  try {
    assert.deepEqual(await effectiveAmberxvidPolicy("mo"), amberxvidPolicyDefaults());
    assert.equal((await assertCanHostStreams("mo")).ok, true);
  } finally {
    setAmberxvidPolicySource(null);
  }
});

test("an unanswered key follows the site default rather than becoming undefined", async () => {
  await withPolicy({ canComment: false }, async () => {
    const p = await effectiveAmberxvidPolicy("mo");
    assert.equal(p.canComment, false);
    assert.equal(p.canPostWall, true, "an absent key follows the default");
    assert.equal(p.maxAlbums, ALBUMS_PER_OWNER_MAX);
  });
});
