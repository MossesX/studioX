/**
 * @file **The photo surface's store** (P10 of `axf-amberxvid-social`) — the
 * album model as a platform surface rather than a shared folder.
 *
 * Five properties, each of which was a real decision in `lib/albums.ts` and
 * each of which is silently reversible without a test:
 *
 *  1. **Visibility is the wall's filter, and a block cannot be felt.** An album
 *     a viewer may not see is absent from their list, 404s by id, and refuses a
 *     reaction with the SAME answer a photo that never existed gets. This is
 *     the property the whole `lib/social.ts` extraction exists to keep true in
 *     both stores at once, so it is asserted here as literally as the wall test
 *     asserts it: two refusals compared with `deepEqual`.
 *  2. **The bytes obey the filter too.** `resolvePhoto` is what the image route
 *     goes through; a visibility that stopped at the JSON would be no
 *     visibility at all.
 *  3. **One comment system.** The toggle is exclusive, the thread is one level,
 *     and the commenter / the owner / a moderator are the three who may delete
 *     — the same three the wall has, because it is the same code.
 *  4. **Policy narrows the module's caps** and the refusal names WHICH limit
 *     bit (`maxAlbums`, `maxAlbumItemMB`).
 *  5. **Dimensions come from the bytes, and a reorder cannot lose a photo.**
 *     The justified grid is only honest if the store read real pixels, and the
 *     reorder contract is "keep what you were not told about".
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { addUser, changePassword, setScreenname } from "@axs/modules/accounts/lib/accounts";
import { acceptBuddy, blockUser, requestBuddy } from "@axs/modules/accounts/lib/relations";
import { setAmberxvidPolicySource } from "@axs/modules/amberxvid/lib/policy";
import {
  addPhoto,
  commentOnPhoto,
  createAlbum,
  deletePhotoComment,
  imageSize,
  listAlbumsFor,
  reactToPhoto,
  readAlbumFor,
  reorderPhotos,
  resolvePhoto,
  setAlbumVisibility,
} from "@axs/modules/amberxvid/lib/albums";
import type { Album, SocialVisibility } from "@axs/modules/amberxvid/lib/types";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];

function freshStores(): void {
  const accounts = fs.mkdtempSync(path.join(os.tmpdir(), "axv-alb-acc-"));
  const module = fs.mkdtempSync(path.join(os.tmpdir(), "axv-alb-mod-"));
  roots.push(accounts, module);
  process.env.ACCOUNTS_DATA_DIR = accounts;
  process.env.AMBERXVID_DATA_DIR = module;
  process.env.AMBERXVID_SILENT_JOURNAL = "1";
  setAmberxvidPolicySource(null);
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  delete process.env.AMBERXVID_DATA_DIR;
  delete process.env.AMBERXVID_SILENT_JOURNAL;
  setAmberxvidPolicySource(null);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** Narrow an engine answer to its success shape, with the reason in the
 *  message when it is not — a bare `assert(result.ok)` throws the reason away. */
function ok<T extends { ok: boolean }>(result: T | { ok: false; error: string }, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${(result as { error: string }).error}`);
  return result as T;
}

async function member(username: string, screenname: string): Promise<string> {
  ok(await addUser("admin", username, "temp-pass", "member"), `adding ${username}`);
  ok(await changePassword(username, "temp-pass", `${username}-real-pw`), `${username}'s password`);
  ok(await setScreenname(username, screenname), `${username}'s screenname`);
  return username;
}

async function studio(): Promise<void> {
  freshStores();
  ok(await changePassword("admin", "amberx", "admin-real-pw"), "the admin clearing the seed password");
}

async function buddies(a: string, b: string): Promise<void> {
  ok(await requestBuddy(a, b), `${a} asking ${b}`);
  ok(await acceptBuddy(b, a), `${b} accepting ${a}`);
}

/* ------------------------------- image fixtures ------------------------------- */

/** A PNG that is a real signature and a real IHDR, and nothing else — the store
 *  sniffs and measures headers, it never decodes. */
function png(width: number, height: number, padTo = 64): Buffer {
  const b = Buffer.alloc(Math.max(24, padTo), 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** A JPEG whose first start-of-frame carries the dimensions. */
function jpeg(width: number, height: number): Buffer {
  const b = Buffer.alloc(32, 0);
  b.writeUInt16BE(0xffd8, 0); // SOI
  b.writeUInt16BE(0xffc0, 2); // SOF0
  b.writeUInt16BE(17, 4); // segment length
  b[6] = 8; // sample precision
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  return b;
}

const titles = (albums: Album[]): string[] => albums.map((a) => a.title).sort();

async function album(owner: string, title: string, visibility: SocialVisibility): Promise<Album> {
  return ok(await createAlbum(owner, owner, title, visibility), `${owner} creating "${title}"`).album;
}

/* ========================== 1 + 2. THE VISIBILITY MATRIX ======================= */

test("albums answer the wall's visibility filter — and a block cannot be felt, JSON or bytes", async () => {
  await studio();
  const alice = await member("alice", "Alice");
  const bob = await member("bob", "Bob");
  const carol = await member("carol", "Carol");
  const dave = await member("dave", "Dave");

  await buddies(alice, bob);
  // Dave WAS a buddy and is blocked afterwards — the case that matters, since a
  // block severs the edge and must leave nothing behind that hints at it.
  await buddies(alice, dave);
  ok(await blockUser(alice, dave), "alice blocking dave");

  const open = await album(alice, "public", "public");
  const inner = await album(alice, "buddies", "buddies");
  await album(alice, "private", "private");

  assert.deepEqual(titles(await listAlbumsFor(alice, alice)), ["buddies", "private", "public"], "the owner sees all three");
  assert.deepEqual(titles(await listAlbumsFor(bob, alice)), ["buddies", "public"], "a buddy sees public + buddies");
  assert.deepEqual(titles(await listAlbumsFor(carol, alice)), ["public"], "a stranger sees public only");

  /* PROPERTY 1: blocked is byte-identical to stranger, whole shelf. */
  assert.deepEqual(
    await listAlbumsFor(dave, alice),
    await listAlbumsFor(carol, alice),
    "a blocked viewer's shelf must be indistinguishable from any other non-buddy's",
  );

  assert.equal((await readAlbumFor(bob, alice, inner.id))?.title, "buddies");
  assert.equal(await readAlbumFor(carol, alice, inner.id), null, "a stranger cannot open a buddies album");
  assert.equal(await readAlbumFor(dave, alice, inner.id), null, "and neither can a blocked viewer");

  /* Bytes obey the same filter (property 2). */
  const withPhoto = ok(await addPhoto(alice, alice, inner.id, png(800, 600)), "alice uploading").album;
  const photoId = withPhoto.photos[0].id;
  assert.ok(await resolvePhoto(bob, alice, inner.id, photoId), "a buddy may fetch the bytes");
  assert.equal(await resolvePhoto(carol, alice, inner.id, photoId), null, "a stranger may not");
  assert.equal(await resolvePhoto(dave, alice, inner.id, photoId), null, "and neither may a blocked viewer");

  /* And so do the refusals: hidden and never-existed answer identically. */
  const hidden = await reactToPhoto(dave, alice, inner.id, photoId, "like");
  const invented = await reactToPhoto(
    dave,
    alice,
    "alb-20260815-101010-abcdef",
    "ph-20260815-101010-abcdef",
    "like",
  );
  assert.deepEqual(hidden, invented, "a blocked react must answer what a missing photo answers");
  assert.deepEqual(hidden, { ok: false, error: "no such photo", status: 404 });

  /* A stranger CAN still touch a PUBLIC album's photo — the block is the
   * difference, and it is only ever visible as an absence. */
  const shared = ok(await addPhoto(alice, alice, open.id, png(400, 400)), "alice uploading a public photo").album;
  const publicPhoto = shared.photos[0].id;
  ok(await reactToPhoto(carol, alice, open.id, publicPhoto, "like"), "carol liking a public photo");
  assert.deepEqual(
    await reactToPhoto(dave, alice, open.id, publicPhoto, "like"),
    { ok: false, error: "no such photo", status: 404 },
    "a blocked viewer cannot react even on a public album — and is told nothing",
  );

  /* Narrowing is retroactive and total, and it keeps the thread. */
  ok(await commentOnPhoto(carol, alice, open.id, publicPhoto, "nice one"), "carol commenting");
  ok(await setAlbumVisibility(alice, alice, open.id, "private"), "alice hiding the album");
  assert.equal(await readAlbumFor(carol, alice, open.id), null, "narrowing hides it from the commenter too");
  const back = ok(await setAlbumVisibility(alice, alice, open.id, "public"), "alice widening it again").album;
  assert.equal(
    back.photos[0].comments[0]?.text,
    "nice one",
    "hiding an album must not throw anybody's comment away",
  );
});

/* ============================ 3. ONE COMMENT SYSTEM ============================ */

test("the rail on a photo is the wall's: exclusive toggling, one level, three deleters", async () => {
  await studio();
  const alice = await member("alice", "Alice");
  const bob = await member("bob", "Bob");
  const carol = await member("carol", "Carol");

  const shelf = await album(alice, "trip", "public");
  const withPhoto = ok(await addPhoto(alice, alice, shelf.id, jpeg(1200, 800)), "uploading").album;
  const photoId = withPhoto.photos[0].id;
  const item = (a: Album) => a.photos.find((p) => p.id === photoId)!;

  /* Exclusive and toggling — one member is in at most one list, always. */
  let now = ok(await reactToPhoto(bob, alice, shelf.id, photoId, "like"), "bob liking").album;
  assert.deepEqual(item(now).reactions, { likes: ["bob"], dislikes: [] });
  now = ok(await reactToPhoto(bob, alice, shelf.id, photoId, "dislike"), "bob switching").album;
  assert.deepEqual(item(now).reactions, { likes: [], dislikes: ["bob"] }, "the other vote moves, never doubles");
  now = ok(await reactToPhoto(bob, alice, shelf.id, photoId, "dislike"), "bob clearing").album;
  assert.deepEqual(item(now).reactions, { likes: [], dislikes: [] }, "the same vote twice clears it");

  /* One level deep: a reply to a reply is refused, never flattened. */
  now = ok(await commentOnPhoto(carol, alice, shelf.id, photoId, "where is this?"), "carol commenting").album;
  const top = item(now).comments[0];
  now = ok(
    await commentOnPhoto(alice, alice, shelf.id, photoId, "the coast road", top.id),
    "alice replying",
  ).album;
  const reply = item(now).comments.find((c) => c.replyTo === top.id)!;
  assert.ok(reply, "the reply hangs off the top-level comment");
  assert.deepEqual(await commentOnPhoto(bob, alice, shelf.id, photoId, "nope", reply.id), {
    ok: false,
    status: 400,
    error: "replies go one level deep — reply to the comment instead",
  });

  /* Three may delete: the commenter, the album's owner, and a moderator. */
  assert.deepEqual(
    await deletePhotoComment(bob, alice, shelf.id, photoId, top.id),
    {
      ok: false,
      status: 403,
      error: "only the commenter, the album's owner or a moderator may delete that",
    },
    "a bystander may not delete somebody else's comment",
  );
  now = ok(
    await deletePhotoComment(alice, alice, shelf.id, photoId, top.id),
    "the album's owner deleting a comment",
  ).album;
  assert.deepEqual(
    item(now).comments,
    [],
    "deleting a top-level comment takes its replies with it — an orphan has nowhere to draw",
  );

  /* An administrator is the moderator today, and moderation is a MUTATION
   * power: they may delete, and they get there through the same one rule. */
  now = ok(await commentOnPhoto(carol, alice, shelf.id, photoId, "again"), "carol re-commenting").album;
  ok(
    await deletePhotoComment("admin", alice, shelf.id, photoId, item(now).comments[0].id),
    "the administrator moderating",
  );
});

/* ========================== 4. POLICY NARROWS THE CAPS ========================= */

test("policy narrows the module's own caps, and the refusal names which limit bit", async () => {
  await studio();
  const alice = await member("alice", "Alice");

  setAmberxvidPolicySource(() => ({ maxAlbums: 1, maxAlbumItemMB: 1 }));

  const first = await album(alice, "one", "public");
  const second = await createAlbum(alice, alice, "two");
  assert.equal(second.ok, false);
  assert.match(
    (second as { error: string }).error,
    /album limit of 1 .*maxAlbums/,
    "the count refusal quotes the row and its value",
  );

  const big = await addPhoto(alice, alice, first.id, png(10, 10, 2 * 1024 * 1024));
  assert.equal(big.ok, false);
  assert.equal((big as { status: number }).status, 413);
  assert.match(
    (big as { error: string }).error,
    /per-photo limit is 1 MB.*maxAlbumItemMB/,
    "the size refusal names the POLICY when policy is the tighter of the two",
  );

  // With the cascade absent every row is its site default again — the honest
  // fallback `amberxvidPolicyStatus()` explains, and the same upload lands.
  setAmberxvidPolicySource(null);
  ok(await addPhoto(alice, alice, first.id, png(10, 10, 2 * 1024 * 1024)), "the same upload without a cascade");
});

/* ==================== 5. REAL PIXELS, AND A SAFE REORDER ====================== */

test("dimensions are read from the bytes, and a reorder keeps what it was not told about", async () => {
  await studio();
  const alice = await member("alice", "Alice");

  /* The header parsers, directly — the grid is only honest if these are. */
  assert.deepEqual(imageSize(png(1920, 1080)), { width: 1920, height: 1080 }, "PNG IHDR");
  assert.deepEqual(imageSize(jpeg(640, 480)), { width: 640, height: 480 }, "JPEG start-of-frame");
  assert.equal(imageSize(Buffer.from("not an image at all")), null, "junk measures as unknown, never throws");

  const shelf = await album(alice, "shapes", "public");
  ok(await addPhoto(alice, alice, shelf.id, png(1000, 250), "a panorama"), "wide");
  ok(await addPhoto(alice, alice, shelf.id, jpeg(300, 900)), "tall");
  const full = ok(await addPhoto(alice, alice, shelf.id, png(500, 500)), "square").album;

  assert.deepEqual(
    full.photos.map((p) => [p.width, p.height]),
    [
      [1000, 250],
      [300, 900],
      [500, 500],
    ],
    "every item carries the pixels its own bytes declared — no square-crop lie needed",
  );
  assert.equal(full.coverPhotoId, full.photos[0].id, "the first photo becomes the cover");

  /* The reorder contract: name a subset, keep the rest, ignore inventions. */
  const [wide, tall, square] = full.photos.map((p) => p.id);
  const moved = ok(
    await reorderPhotos(alice, alice, shelf.id, [square, "ph-20260815-101010-abcdef"]),
    "reordering with a stale list",
  ).album;
  assert.deepEqual(
    moved.photos.map((p) => p.id),
    [square, wide, tall],
    "an id the album does not hold is ignored, and an item the caller forgot keeps its place",
  );
});
