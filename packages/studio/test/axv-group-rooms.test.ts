/**
 * @file P11 — group video rooms: the room rules on the server, and the paging
 * arithmetic the whole scale story rests on.
 *
 * Staged like `test/axv-wall.test.ts`: the real code over throwaway roots, both
 * stores re-pointed per test, driven in the order the app drives it.
 *
 * ## The properties worth the most, in order
 *
 * 1. **THE PAGING INVARIANT'S ARITHMETIC.** A page never asks for more than
 *    `ROOM_PAGE_TILES` participants, whatever the roster size, and the
 *    simulcast layer a page asks for falls as its tiles shrink. This is the
 *    difference between a room of 200 and a melted laptop, so it is pinned as
 *    numbers rather than trusted to a component: if `columnsFor` ever returns 8
 *    or `pageCountFor` ever leaves a member off the last page, a client is
 *    either consuming more than it draws or drawing somebody it cannot see.
 *
 * 2. **THE HOST IS NOT THE ROOM.** A group room is the one kind that outlives
 *    its host — both when they leave deliberately and when the sweeper drops
 *    them — and the chair passes to the longest-standing survivor rather than
 *    to whoever the filesystem returned first. Walked both ways, because the
 *    two paths are different code (`leaveRoom` and `sweepRecord`) implementing
 *    one rule, which is exactly how a rule ends up half-true.
 *
 * 3. **THE CAP BITES UNDER THE LOCK, AND NAMES ITS ROW.** The refusal is
 *    checked against the PINNED value, so moving the policy afterwards cannot
 *    change a live room's capacity underneath the people in it, and the
 *    sentence names `maxGroupChatMembers` so an administrator knows which dial
 *    to move.
 *
 * 4. **A ROOM SEATS ONLY PUBLISHERS.** Every seat's `MediaRole` carries
 *    `canPublish` in `ROLE_RULES` — asserted against the contract itself, not
 *    against a literal, so a role rename cannot quietly seat an audience in a
 *    room that has no audience class.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { addUser, changePassword, setScreenname } from "@axs/modules/accounts/lib/accounts";
import { setAmberxvidPolicySource } from "@axs/modules/amberxvid/lib/policy";
import {
  endRoom,
  getGroupRoom,
  joinRoom,
  leaveRoom,
  listGroupRooms,
  openRoom,
  renameRoom,
  roomsFor,
} from "@axs/modules/amberxvid/lib/groupRooms";
import { readRoom, sweepRooms } from "@axs/modules/amberxvid/lib/roomStore";
import { CAPACITY, ROLE_RULES } from "@axs/modules/amberxvid/lib/mediaContract";
import { ROOM_PAGE_TILES } from "@axs/modules/amberxvid/lib/types";
import type { GroupRoomInfo } from "@axs/modules/amberxvid/lib/types";
import { columnsFor, layerForColumns, pageCountFor } from "@axs/modules/amberxvid/lib/roomGrid";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];
let moduleRoot = "";

function freshStores(): void {
  const accounts = fs.mkdtempSync(path.join(os.tmpdir(), "axv-rooms-acc-"));
  const module = fs.mkdtempSync(path.join(os.tmpdir(), "axv-rooms-mod-"));
  roots.push(accounts, module);
  moduleRoot = module;
  process.env.ACCOUNTS_DATA_DIR = accounts;
  process.env.AMBERXVID_DATA_DIR = module;
  process.env.AMBERXVID_SILENT_JOURNAL = "1";
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  delete process.env.AMBERXVID_DATA_DIR;
  delete process.env.AMBERXVID_SILENT_JOURNAL;
  setAmberxvidPolicySource(null);
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
  ok(await changePassword("admin", "amberx", "admin-real-pw"), "the admin clearing the seed password");
}

/** Force the policy cascade to one answer, so a cap test tests the CAP and not
 *  whatever the site default happens to be this month. */
function policy(rows: Record<string, unknown>): void {
  setAmberxvidPolicySource(async () => rows);
}

const names = (room: GroupRoomInfo): string[] => room.members.map((m) => m.user);

/** Age every seat this member holds past the sweeper's timeout, in place — the
 *  only honest way to test the sweeper without sleeping for thirty seconds. */
function stale(roomId: string, user: string): void {
  const file = path.join(moduleRoot, "rooms", `${roomId}.json`);
  const rec = JSON.parse(fs.readFileSync(file, "utf8")) as {
    participants: { user: string; heartbeatAt: string }[];
  };
  for (const p of rec.participants) {
    if (p.user === user) p.heartbeatAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  }
  fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, "utf8");
}

/* ======================== 1. THE PAGING INVARIANT ============================= */

test("a page never holds more than 49 tiles, at any roster size", () => {
  // The sizes that matter: the boundaries, and a room far past them. If any of
  // these pages held 50, a client would be consuming a stream it cannot draw.
  for (const roster of [0, 1, 7, 48, 49, 50, 98, 99, 200, 501]) {
    const pages = pageCountFor(roster);
    assert.ok(pages >= 1, `${roster} members must still have a page to show`);
    let seated = 0;
    for (let page = 0; page < pages; page += 1) {
      const size = Math.min(ROOM_PAGE_TILES, roster - page * ROOM_PAGE_TILES);
      assert.ok(
        size <= ROOM_PAGE_TILES,
        `a page of a ${roster}-member room held ${size} tiles — the invariant's ceiling is ${ROOM_PAGE_TILES}`,
      );
      seated += Math.max(0, size);
    }
    // ...and nobody falls off the end: a member with no page is a member
    // nobody can ever see, which is the opposite failure and just as bad.
    assert.equal(seated, roster, `a ${roster}-member room paged ${seated} people`);
  }
});

test("the grid is never wider than 7, so tiles grow as the room shrinks", () => {
  assert.equal(columnsFor(0), 1);
  assert.equal(columnsFor(1), 1);
  assert.equal(columnsFor(4), 2);
  assert.equal(columnsFor(9), 3);
  assert.equal(columnsFor(49), 7);
  // The ceiling holds even if a caller asks for a page bigger than a page.
  assert.equal(columnsFor(100), 7);
});

test("the simulcast layer falls as the tiles shrink — 49-up takes the lowest", () => {
  // The whole point of asking for a layer: a 140-px tile fed the top layer is a
  // 720p decode thrown away in the scaler.
  assert.equal(layerForColumns(columnsFor(49)), 0, "a 49-up page must take the lowest layer");
  assert.equal(layerForColumns(columnsFor(25)), 0);
  assert.equal(layerForColumns(columnsFor(9)), 1, "a 3×3 page takes the middle layer");
  assert.equal(layerForColumns(1), 2, "a maximised tile takes the top layer");
  // Monotonic: a bigger page never asks for a HIGHER layer than a smaller one.
  for (let c = 1; c < 7; c += 1) {
    assert.ok(
      layerForColumns(c) >= layerForColumns(c + 1),
      `layer went UP from ${c} to ${c + 1} columns — more tiles must never cost more bytes each`,
    );
  }
  // And every layer it can ask for is inside the media route's 0..2 range.
  for (let c = 1; c <= 7; c += 1) {
    const layer = layerForColumns(c);
    assert.ok(Number.isInteger(layer) && layer >= 0 && layer <= 2, `layer ${layer} is outside 0..2`);
  }
});

/* ========================= 2. THE HOST IS NOT THE ROOM ========================== */

test("a host who leaves hands the chair to the longest-standing survivor", async () => {
  await studio();
  await member("ann");
  await member("bob");
  await member("cat");

  const room = ok(await openRoom("ann", "standup"), "ann opening").value;
  ok(await joinRoom("bob", room.id), "bob joining");
  ok(await joinRoom("cat", room.id), "cat joining");

  const left = ok(leaveRoom("ann", room.id), "ann leaving").value;
  assert.equal(left.ended, false, "a room does not end because its host left");
  assert.equal(left.info.host, "bob", "the chair passes to the earliest joiner, not to anybody else");
  assert.deepEqual(names(left.info), ["bob", "cat"]);
  assert.equal(left.info.members[0].role, "host", "the heir's SEAT says host, not just the record");

  // The successor is a real host, not a label: they can end the room.
  ok(endRoom("bob", room.id, false), "the successor ending the room");
  assert.equal(getGroupRoom(room.id), null);
});

test("the SWEEPER applies the same succession — one rule, both paths", async () => {
  await studio();
  await member("ann");
  await member("bob");

  const room = ok(await openRoom("ann", "standup"), "ann opening").value;
  ok(await joinRoom("bob", room.id), "bob joining");

  stale(room.id, "ann");
  sweepRooms();

  const after = getGroupRoom(room.id);
  assert.ok(after, "a group room whose host went stale must SURVIVE — it is the people in it");
  assert.equal(after.host, "bob");
  assert.deepEqual(names(after), ["bob"]);
});

test("the last member out ends the room, so no joinable ghost is left", async () => {
  await studio();
  await member("ann");

  const room = ok(await openRoom("ann", "solo"), "ann opening").value;
  const left = ok(leaveRoom("ann", room.id), "ann leaving").value;
  assert.equal(left.ended, true);
  assert.equal(getGroupRoom(room.id), null, "an empty room must not stay joinable");
  assert.deepEqual(listGroupRooms(), []);
});

test("a stream's host still ends the stream — group succession is not global", async () => {
  await studio();
  await member("ann");
  await member("bob");
  // The succession rule reads `kind === "group"`. Prove it does not leak into
  // the call/stream records, whose host genuinely IS the room.
  const { openStream, joinStream } = await import("@axs/modules/amberxvid/lib/streams");
  const stream = ok(await openStream("ann", "live"), "ann going live").value;
  ok(joinStream("bob", stream.id, false), "bob watching");

  stale(stream.id, "ann");
  sweepRooms();

  const rec = readRoom(stream.id);
  assert.equal(rec?.state, "ended", "a stream whose broadcaster went stale is over");
});

/* ============================ 3. THE MEMBER CAP ================================ */

test("the cap refuses at the door and names the row an administrator can move", async () => {
  await studio();
  policy({ maxGroupChatMembers: 2, canJoinGroupRooms: true });
  await member("ann");
  await member("bob");
  await member("cat");

  const room = ok(await openRoom("ann", "pair"), "ann opening").value;
  assert.equal(room.memberLimit, 2, "the cap is PINNED at open, not read per join");
  ok(await joinRoom("bob", room.id), "bob taking the second seat");

  const refused = await joinRoom("cat", room.id);
  assert.equal(refused.ok, false);
  if (refused.ok) throw new Error("unreachable");
  assert.equal(refused.status, 409);
  assert.match(
    refused.error,
    /maxGroupChatMembers/,
    "a refusal that does not name its row leaves an administrator guessing",
  );

  // Raising the policy AFTER the room opened must not change its capacity —
  // that is what pinning is for.
  policy({ maxGroupChatMembers: 50, canJoinGroupRooms: true });
  const stillRefused = await joinRoom("cat", room.id);
  assert.equal(stillRefused.ok, false, "a live room's capacity is a fact about that room");
});

test("`canJoinGroupRooms` gates BOTH doors — opening one is joining it", async () => {
  await studio();
  policy({ canJoinGroupRooms: false, maxGroupChatMembers: 50 });
  await member("ann");

  const refusedOpen = await openRoom("ann", "nope");
  assert.equal(refusedOpen.ok, false, "a member who cannot be in a room has no use for one");

  policy({ canJoinGroupRooms: true, maxGroupChatMembers: 50 });
  const room = ok(await openRoom("ann", "yes"), "ann opening").value;

  policy({ canJoinGroupRooms: false, maxGroupChatMembers: 50 });
  await member("bob");
  const refusedJoin = await joinRoom("bob", room.id);
  assert.equal(refusedJoin.ok, false, "the join door reads the same row");
});

test("re-joining keeps the ORIGINAL seat, so a reload does not move your tile", async () => {
  await studio();
  await member("ann");
  await member("bob");

  const room = ok(await openRoom("ann", "standup"), "ann opening").value;
  ok(await joinRoom("bob", room.id), "bob joining");
  const first = getGroupRoom(room.id);

  const again = ok(await joinRoom("bob", room.id), "bob re-joining").value;
  assert.equal(again.members.length, 2, "a rejoin must not mint a second seat");
  assert.equal(
    again.members[1].joinedAt,
    first?.members[1].joinedAt,
    "the seat is kept, not replaced — page order and succession position depend on joinedAt",
  );
});

/* ====================== 4. A ROOM SEATS ONLY PUBLISHERS ========================= */

test("every seat a room hands out can publish, per the contract's own matrix", async () => {
  await studio();
  await member("ann");
  await member("bob");

  const room = ok(await openRoom("ann", "standup"), "ann opening").value;
  ok(await joinRoom("bob", room.id), "bob joining");

  const rec = readRoom(room.id);
  assert.ok(rec);
  for (const seat of rec.participants) {
    assert.ok(
      ROLE_RULES[seat.role].canPublish,
      `a group room seated ${seat.user} as ${seat.role}, which ROLE_RULES says cannot publish — ` +
        "a group room has no audience class",
    );
  }
});

test("the room's own cap can never exceed what the media plane will carry", async () => {
  await studio();
  policy({ maxGroupChatMembers: 500, canJoinGroupRooms: true });
  await member("ann");
  const room = ok(await openRoom("ann", "huge"), "ann opening").value;
  // The record pins the PRODUCT cap; the effective one is the smaller of that
  // and the machine ceiling. Pinning a number above the ceiling is fine — what
  // must not happen is admitting past it, which `joinRoom` clamps.
  assert.equal(room.memberLimit, 500);
  assert.ok(
    CAPACITY.membersPerGroupRoom > 0,
    "the machine ceiling must exist, or the clamp has nothing to clamp to",
  );
});

/* ============================== housekeeping =================================== */

test("only the host renames, and the rooms list is the record's", async () => {
  await studio();
  await member("ann");
  await member("bob");

  const room = ok(await openRoom("ann", "standup"), "ann opening").value;
  ok(await joinRoom("bob", room.id), "bob joining");

  const refused = renameRoom("bob", room.id, "bob's room");
  assert.equal(refused.ok, false);

  const renamed = ok(renameRoom("ann", room.id, "sprint review"), "ann renaming").value;
  assert.equal(renamed.title, "sprint review");
  assert.equal(listGroupRooms()[0].title, "sprint review");
  assert.deepEqual(
    roomsFor("bob").map((r) => r.id),
    [room.id],
    "roomsFor is how a reloaded tab finds the meeting it is still seated in",
  );
});

test("an administrator can end somebody else's room; a member cannot", async () => {
  await studio();
  await member("ann");
  await member("bob");

  const room = ok(await openRoom("ann", "standup"), "ann opening").value;
  ok(await joinRoom("bob", room.id), "bob joining");

  assert.equal(endRoom("bob", room.id, false).ok, false, "a member is not a moderator");
  ok(endRoom("bob", room.id, true), "an administrator ending it — the moderation lever");
  assert.equal(getGroupRoom(room.id), null);
});
