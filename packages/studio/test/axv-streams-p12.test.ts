/**
 * @file P12 — the streaming room's server halves: follows, the alert gate,
 * removal, live edits and history.
 *
 * Staged like `test/axv-group-rooms.test.ts`: the real code over throwaway
 * roots, both stores re-pointed per test, driven in the order the app drives
 * it. Nothing here mocks a store.
 *
 * ## The properties worth the most, in order
 *
 * 1. **A REMOVAL STICKS.** `removeViewer` drops the seat AND remembers the
 *    removal, so the join path refuses them — as a viewer and as a hover
 *    preview. Without the second half, "remove" ejects somebody for exactly as
 *    long as it takes them to click Join again, which is a feature that looks
 *    like it works every time you test it by hand once.
 *
 * 2. **THE ALERT GATE IS TWO QUESTIONS, ANSWERED SERVER-SIDE.** The audience
 *    for "somebody you follow went live" is `followers ∩ interruptible`. Both
 *    halves are asserted.
 *
 *    *(Updated by P13.)* This used to pin the seam's honest ABSENCE —
 *    `dndStatus().installed === false`, with the reason in words. P13 shipped
 *    the model (`lib/availability`) and made it the DEFAULT source rather than
 *    something a registration pass installs, so the absence is gone and the
 *    assertion now pins what replaced it: a real model answering, defaulting to
 *    "available", with the member's own notifications switch still biting on
 *    the broadcast-alert path.
 *
 * 3. **A BLOCK BEATS A FOLLOW, WITHOUT ADMITTING IT.** Following is
 *    consent-free, so the only thing keeping it out of the relations model's
 *    way is that a blocked edge is invisible on READ — asserted after the block
 *    lands, on an edge that already existed, because that is the case a
 *    write-time-only check would miss.
 *
 * 4. **THE TWO HISTORY NUMBERS ARE COUNTED LIVE.** `peakViewers` and the
 *    distinct-watcher set cannot be reconstructed after a room ends — the
 *    record is swept. So they are counted on join and copied out at close, and
 *    this walks a room UP to three viewers and back DOWN to one to prove the
 *    peak is a peak rather than a current count.
 *
 * 5. **EVERY WAY OUT WRITES A ROW.** Leaving writes the leaver's; ending the
 *    room writes the host's plus one per watcher still attached; and the
 *    presence-drop path (`detachEverywhere`) writes one too — which is the way
 *    most people actually leave a stream.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { addUser, changePassword, setScreenname } from "@axs/modules/accounts/lib/accounts";
import { blockUser } from "@axs/modules/accounts/lib/relations";
import { setAmberxvidPolicySource } from "@axs/modules/amberxvid/lib/policy";
import { saveMessengerSettings } from "@axs/modules/amberxvid/lib/messengerSettings";
import {
  dndStatus,
  interruptible,
  mayInterrupt,
  setDndSource,
} from "@axs/modules/amberxvid/lib/dnd";
import {
  followerCounts,
  followersOf,
  followsFor,
  isFollowing,
  setFollow,
} from "@axs/modules/amberxvid/lib/follows";
import {
  archiveClosure,
  closeStream,
  describeStream,
  detachEverywhere,
  joinStream,
  leaveStream,
  listStreams,
  openStream,
  removeViewer,
} from "@axs/modules/amberxvid/lib/streams";
import {
  streamHistoryFor,
  watchHistoryFor,
} from "@axs/modules/amberxvid/lib/streamHistory";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];

function freshStores(): void {
  const accounts = fs.mkdtempSync(path.join(os.tmpdir(), "axv-p12-acc-"));
  const module = fs.mkdtempSync(path.join(os.tmpdir(), "axv-p12-mod-"));
  roots.push(accounts, module);
  process.env.ACCOUNTS_DATA_DIR = accounts;
  process.env.AMBERXVID_DATA_DIR = module;
  process.env.AMBERXVID_SILENT_JOURNAL = "1";
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  delete process.env.AMBERXVID_DATA_DIR;
  delete process.env.AMBERXVID_SILENT_JOURNAL;
  setAmberxvidPolicySource(null);
  setDndSource(null);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function ok<T extends { ok: boolean }>(result: T | { ok: false; error: string }, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${(result as { error: string }).error}`);
  return result as T;
}

async function member(username: string): Promise<string> {
  ok(await addUser("admin", username, "temp-pass", "member"), `adding ${username}`);
  ok(await changePassword(username, "temp-pass", `${username}-real-pw`), `${username}'s password`);
  ok(await setScreenname(username, username.toUpperCase()), `${username}'s screenname`);
  return username;
}

async function studio(): Promise<void> {
  freshStores();
  setAmberxvidPolicySource(null);
  setDndSource(null);
  ok(await changePassword("admin", "amberx", "admin-real-pw"), "the admin clearing the seed password");
}

/** Force the policy cascade to one answer, so a cap test tests the CAP. */
function policy(rows: Record<string, unknown>): void {
  setAmberxvidPolicySource(async () => rows);
}

/** The route's own audience arithmetic, in one place: who is told that `host`
 *  went live. If this ever disagrees with `alertFollowers` in the route, the
 *  route is telling the wrong people. */
const alertAudience = (host: string): Promise<string[]> => interruptible(followersOf(host));

/* ---------------------------------- follows ---------------------------------- */

test("a follow writes both sides, and unfollowing takes both back", async () => {
  await studio();
  const [ann, bo] = [await member("ann"), await member("bob")];

  ok(await setFollow(ann, bo, true), "ann follows bo");
  assert.deepEqual(followsFor(ann).following, [bo]);
  assert.deepEqual(followsFor(bo).followers, [ann]);
  assert.equal(isFollowing(ann, bo), true);
  // One-directional: bo does not follow ann back by having been followed.
  assert.equal(isFollowing(bo, ann), false);
  assert.deepEqual(followerCounts([bo]), { [bo]: 1 });

  // Idempotent — a double-click is one edge, not two.
  ok(await setFollow(ann, bo, true), "ann follows bo again");
  assert.deepEqual(followsFor(bo).followers, [ann]);

  ok(await setFollow(ann, bo, false), "ann unfollows bo");
  assert.deepEqual(followsFor(ann).following, []);
  assert.deepEqual(followsFor(bo).followers, []);
});

test("you cannot follow yourself, or somebody who is not a member", async () => {
  await studio();
  const ann = await member("ann");

  const self = await setFollow(ann, ann, true);
  assert.equal(self.ok, false);
  assert.match((self as { error: string }).error, /yourself/);

  const ghost = await setFollow(ann, "nobody", true);
  assert.equal(ghost.ok, false);
  assert.equal((ghost as { status: number }).status, 404);
});

test("a block hides an EXISTING follow edge on read, and refuses a new one as 'no such member'", async () => {
  await studio();
  const [ann, bo] = [await member("ann"), await member("bob")];
  ok(await setFollow(ann, bo, true), "ann follows bo");
  assert.deepEqual(followersOf(bo), [ann]);

  ok(await blockUser(bo, ann), "bo blocks ann");

  // The edge is on disk and is invisible from both ends — the filter is on
  // READ, so the block bites the instant it lands with no sweep anywhere.
  assert.deepEqual(followersOf(bo), []);
  assert.deepEqual(followsFor(ann).following, []);
  assert.equal(isFollowing(ann, bo), false);

  // And a fresh follow is refused with the ABSENCE sentence, never "blocked".
  const again = await setFollow(ann, bo, true);
  assert.equal(again.ok, false);
  assert.equal((again as { error: string }).error, "no such member");
});

/* ------------------------------- the alert gate ------------------------------- */

test("the DND model is installed by default, and the member's own switch still bites", async () => {
  await studio();
  const ann = await member("ann");

  // P13 replaced the empty seam with the availability model. There is no
  // "installed: false" state left to report — a source that has to be installed
  // by a registration pass nobody calls is a source that is never installed.
  const status = dndStatus();
  assert.equal(status.installed, true);
  assert.match(status.why, /availability model/);
  assert.equal(await mayInterrupt(ann), true); // the default: available

  // The messenger switch governs BROADCAST alerts and still does.
  await saveMessengerSettings(ann, { notifications: false });
  assert.equal(await mayInterrupt(ann), false);
  await saveMessengerSettings(ann, { notifications: true });
  assert.equal(await mayInterrupt(ann), true);
});

test("P13's source, once installed, silences the alert through the one chokepoint", async () => {
  await studio();
  const [ann, bo] = [await member("ann"), await member("bob")];
  setDndSource((u) => u === bo);

  assert.equal(dndStatus().installed, true);
  assert.equal(await mayInterrupt(ann), true);
  assert.equal(await mayInterrupt(bo), false);
  assert.deepEqual(await interruptible([ann, bo]), [ann]);

  // A source that throws has said NOTHING, which is not a refusal — a broken
  // settings read must not silently mute somebody's alerts.
  setDndSource(() => {
    throw new Error("the settings store is on fire");
  });
  assert.equal(await mayInterrupt(bo), true);
  setDndSource(null);
});

test("the live alert goes to followers who may be interrupted, and to nobody else", async () => {
  await studio();
  const host = await member("host");
  const [ann, bo, cy] = [await member("ann"), await member("bob"), await member("cyd")];

  ok(await setFollow(ann, host, true), "ann follows host");
  ok(await setFollow(bo, host, true), "bo follows host");
  // cy does not follow anybody.

  assert.deepEqual((await alertAudience(host)).sort(), [ann, bo]);

  // bo turns notifications off; ann still hears about it.
  await saveMessengerSettings(bo, { notifications: false });
  assert.deepEqual(await alertAudience(host), [ann]);

  // And P13's model can silence the rest without touching this call site.
  setDndSource((u) => u === ann);
  assert.deepEqual(await alertAudience(host), []);
  setDndSource(null);
  assert.equal(followerCounts([cy])[cy], 0);
});

/* ---------------------------------- removal ----------------------------------- */

test("a removed viewer loses the seat AND cannot rejoin — as a viewer or as a preview", async () => {
  await studio();
  const host = await member("host");
  const pest = await member("pest");
  const stream = ok(await openStream(host, "on air", "the blurb"), "opening").value;

  ok(joinStream(pest, stream.id, false), "pest joins");
  assert.deepEqual(listStreams()[0].viewers, [pest]);

  const removed = ok(removeViewer(host, stream.id, pest), "the host removes pest").value;
  assert.deepEqual(removed.info.viewers, []);
  assert.equal(removed.seat !== null, true); // the seat is handed back for the history row

  const rejoin = joinStream(pest, stream.id, false);
  assert.equal(rejoin.ok, false);
  assert.match((rejoin as { error: string }).error, /removed you/);

  // The hover preview is the same door — a removed member who can still watch
  // a live thumbnail has not been removed from anything that matters.
  const peek = joinStream(pest, stream.id, true);
  assert.equal(peek.ok, false);
});

test("only the host (or an administrator) removes anybody, and never the host themselves", async () => {
  await studio();
  const host = await member("host");
  const [ann, bo] = [await member("ann"), await member("bob")];
  const stream = ok(await openStream(host, "on air"), "opening").value;
  ok(joinStream(ann, stream.id, false), "ann joins");
  ok(joinStream(bo, stream.id, false), "bo joins");

  const byViewer = removeViewer(ann, stream.id, bo);
  assert.equal(byViewer.ok, false);
  assert.equal((byViewer as { status: number }).status, 403);

  const selfHarm = removeViewer(host, stream.id, host);
  assert.equal(selfHarm.ok, false);

  ok(removeViewer(ann, stream.id, bo, true), "an administrator removes bo");
  assert.deepEqual(listStreams()[0].viewers, [ann]);
});

/* --------------------------------- live edits ---------------------------------- */

test("the host retitles and re-describes LIVE, and the two fields are independent", async () => {
  await studio();
  const host = await member("host");
  const ann = await member("ann");
  const stream = ok(await openStream(host, "first title", "first blurb"), "opening").value;
  assert.equal(stream.description, "first blurb");

  ok(describeStream(host, stream.id, { title: "second title" }), "retitling");
  assert.equal(listStreams()[0].title, "second title");
  assert.equal(listStreams()[0].description, "first blurb"); // untouched

  ok(describeStream(host, stream.id, { description: "second blurb" }), "re-describing");
  assert.equal(listStreams()[0].title, "second title");
  assert.equal(listStreams()[0].description, "second blurb");

  const byViewer = describeStream(ann, stream.id, { title: "hijacked" });
  assert.equal(byViewer.ok, false);
  assert.equal((byViewer as { status: number }).status, 403);

  const blank = describeStream(host, stream.id, { title: "   " });
  assert.equal(blank.ok, false); // a stream with no title is not a tidier stream
});

/* --------------------------------- the numbers ---------------------------------- */

test("peak is a PEAK, unique watchers accumulate, and previews count for neither", async () => {
  await studio();
  const host = await member("host");
  const [ann, bo, cy, nosy] = [
    await member("ann"),
    await member("bob"),
    await member("cyd"),
    await member("nosy"),
  ];
  const stream = ok(await openStream(host, "on air"), "opening").value;

  ok(joinStream(ann, stream.id, false), "ann joins");
  ok(joinStream(bo, stream.id, false), "bo joins");
  ok(joinStream(cy, stream.id, false), "cy joins");
  assert.equal(listStreams()[0].peakViewers, 3);

  // Down to one, and the peak does NOT follow it down.
  ok(leaveStream(bo, stream.id), "bo leaves");
  ok(leaveStream(cy, stream.id), "cy leaves");
  assert.equal(listStreams()[0].viewers.length, 1);
  assert.equal(listStreams()[0].peakViewers, 3);

  // A hover preview is not a viewer, in either number.
  ok(joinStream(nosy, stream.id, true), "nosy hovers");
  assert.equal(listStreams()[0].peakViewers, 3);
  assert.deepEqual(listStreams()[0].viewers, [ann]);

  const closed = ok(closeStream(host, stream.id, false), "the host ends it").value;
  assert.equal(closed.closure.peakViewers, 3);
  assert.deepEqual([...closed.closure.watchers].sort(), [ann, bo, cy]); // nosy is not one
});

/* ---------------------------------- history ------------------------------------- */

test("ending a stream writes the host's row — duration, peak, unique — and one row per watcher", async () => {
  await studio();
  const host = await member("host");
  const [ann, bo] = [await member("ann"), await member("bob")];
  const stream = ok(await openStream(host, "the show", "what it is about"), "opening").value;

  ok(joinStream(ann, stream.id, false), "ann joins");
  ok(joinStream(bo, stream.id, false), "bo joins");
  ok(leaveStream(bo, stream.id), "bo leaves early");

  const closed = ok(closeStream(host, stream.id, false), "the host ends it").value;
  await archiveClosure(closed.closure);

  const hosted = streamHistoryFor(host);
  assert.equal(hosted.length, 1);
  assert.equal(hosted[0].streamId, stream.id);
  assert.equal(hosted[0].title, "the show");
  assert.equal(hosted[0].description, "what it is about");
  assert.equal(hosted[0].peakViewers, 2);
  assert.equal(hosted[0].uniqueViewers, 2); // bo counts even though he left first
  // Nothing was recorded, so there is nothing to link — the honest value for a
  // link that would 404 ("if kept").
  assert.equal(hosted[0].recordingId, null);

  // Ann was still in the room at close; bo's row was written when he left.
  assert.equal(watchHistoryFor(ann).length, 1);
  assert.equal(watchHistoryFor(ann)[0].host, host);
  assert.equal(watchHistoryFor(bo).length, 1);
  assert.equal(watchHistoryFor(bo)[0].streamId, stream.id);
  // The host does not appear in their own watch history.
  assert.equal(watchHistoryFor(host).length, 0);
});

test("closing twice leaves ONE row — the sweeper racing the button must not double-write", async () => {
  await studio();
  const host = await member("host");
  const stream = ok(await openStream(host, "the show"), "opening").value;
  const closed = ok(closeStream(host, stream.id, false), "ending").value;

  await archiveClosure(closed.closure);
  await archiveClosure(closed.closure);
  assert.equal(streamHistoryFor(host).length, 1);
});

test("a watcher whose connection drops still gets their row — the way most people leave", async () => {
  await studio();
  const host = await member("host");
  const ann = await member("ann");
  const stream = ok(await openStream(host, "the show"), "opening").value;
  ok(joinStream(ann, stream.id, false), "ann joins");

  // No leave, no close: the presence registry's own path.
  const changed = detachEverywhere(ann);
  assert.deepEqual(changed, [stream.id]);
  assert.equal(watchHistoryFor(ann).length, 1);
  assert.equal(watchHistoryFor(ann)[0].streamId, stream.id);
});

/* ------------------------------ the catalog rows -------------------------------- */

test("canHostStreams and streamViewerLimit are enforced from the catalog, by name", async () => {
  await studio();
  const host = await member("host");
  const [ann, bo] = [await member("ann"), await member("bob")];

  policy({ canHostStreams: false });
  const refused = await openStream(host, "not today");
  assert.equal(refused.ok, false);
  assert.match((refused as { error: string }).error, /canHostStreams/);

  policy({ canHostStreams: true, streamViewerLimit: 1 });
  const stream = ok(await openStream(host, "capped at one"), "opening").value;
  ok(joinStream(ann, stream.id, false), "ann takes the only seat");

  const full = joinStream(bo, stream.id, false);
  assert.equal(full.ok, false);
  assert.equal((full as { status: number }).status, 409);
  assert.match((full as { error: string }).error, /streamViewerLimit/);

  // The cap is PINNED at open: raising it does not admit bo to a room that was
  // opened under the old number.
  policy({ canHostStreams: true, streamViewerLimit: 50 });
  assert.equal(joinStream(bo, stream.id, false).ok, false);
});
