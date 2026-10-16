/**
 * @file P8 — the wall: who sees what, reactions, comments, and the merged feed.
 *
 * Staged like `test/axv-invites.test.ts` — the real code over throwaway roots,
 * both stores re-pointed per test, driven in the order the app drives it. The
 * wall straddles them by nature: the posts are in the amberxvid vault and the
 * question "may this person see them" is answered by the ACCOUNTS social graph.
 *
 * ## The properties worth the most, in order
 *
 * 1. **A blocked viewer and a stranger are byte-identical.** Not "both see
 *    less" — the two results are compared FIELD BY FIELD against each other,
 *    because a wall that let a blocked member tell "blocked" from "we were
 *    never buddies" hands them exactly the confirmation the silence in
 *    `accounts/lib/relations.ts` is built to withhold, and nothing looks wrong
 *    on screen. The same comparison covers their refusals: a react and a
 *    comment they attempt must answer what a post that never existed answers.
 *
 * 2. **Exclusivity is a property of the document, not of a code path.** One
 *    member appears in at most ONE of `likes`/`dislikes` after every sequence
 *    of toggles, so a client can render counts from `length` with nothing to
 *    reconcile. The sequence is walked rather than sampled: like → like off →
 *    dislike → switch back.
 *
 * 3. **The feed merges by time across vaults and pages without repeating.**
 *    Posts are BACKDATED on disk and the index is deleted, which tests the
 *    merge order and the index's repair path in one motion — a rebuilt index
 *    that lost a post would show up as a missing feed row.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  addUser,
  changePassword,
  setScreenname,
} from "@axs/modules/accounts/lib/accounts";
import {
  acceptBuddy,
  blockUser,
  requestBuddy,
  setBuddiesOnly,
} from "@axs/modules/accounts/lib/relations";
import { setAmberxvidPolicySource } from "@axs/modules/amberxvid/lib/policy";
import {
  comment,
  createPost,
  deleteComment,
  deletePost,
  editPost,
  feedFor,
  react,
  readPost,
  reply,
  resolveWallMedia,
  uploadWallMedia,
  wallFor,
  wallIndex,
} from "@axs/modules/amberxvid/lib/wall";
import type { WallPost, WallVisibility } from "@axs/modules/amberxvid/lib/types";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];
/** The amberxvid store of the test currently running — the backdating helper
 *  reaches into it, and only it. */
let moduleRoot = "";

function freshStores(): void {
  const accounts = fs.mkdtempSync(path.join(os.tmpdir(), "axv-wall-acc-"));
  const module = fs.mkdtempSync(path.join(os.tmpdir(), "axv-wall-mod-"));
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

/** Narrow an engine answer to its success shape, with the reason in the
 *  message when it is not — a bare `assert(result.ok)` throws the reason away. */
function ok<T extends { ok: boolean }>(result: T | { ok: false; error: string }, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${(result as { error: string }).error}`);
  return result as T;
}

/** A member through the whole entry flow — `createPost`'s gate needs a live
 *  account with a screenname, exactly as the album store's does. */
async function member(username: string, screenname: string): Promise<string> {
  ok(await addUser("admin", username, "temp-pass", "member"), `adding ${username}`);
  ok(await changePassword(username, "temp-pass", `${username}-real-pw`), `${username}'s password`);
  ok(await setScreenname(username, screenname), `${username}'s screenname`);
  return username;
}

/** The seeded admin through their own forced entry, so `addUser` opens. */
async function studio(): Promise<void> {
  freshStores();
  ok(await changePassword("admin", "amberx", "admin-real-pw"), "the admin clearing the seed password");
}

async function buddies(a: string, b: string): Promise<void> {
  ok(await requestBuddy(a, b), `${a} asking ${b}`);
  ok(await acceptBuddy(b, a), `${b} accepting ${a}`);
}

async function post(owner: string, text: string, visibility: WallVisibility): Promise<WallPost> {
  return ok(await createPost(owner, owner, { text, visibility }), `${owner} posting`).post;
}

/**
 * Rewrite a post's `createdAt` and DELETE the index, so the next read rebuilds
 * it from the post files. Two things at once on purpose: it gives the merge
 * tests a deterministic order (real creates land inside one millisecond of each
 * other) and it walks the index's repair path, which nothing else would.
 */
function backdate(owner: string, postId: string, createdAt: string): void {
  const dir = path.join(moduleRoot, "users", owner, "wall");
  const file = path.join(dir, `${postId}.json`);
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as WallPost;
  doc.createdAt = createdAt;
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  fs.rmSync(path.join(dir, "index.json"), { force: true });
}

const ids = (page: { posts: WallPost[] }): string[] => page.posts.map((p) => p.text);

/* =========================== THE VISIBILITY MATRIX ============================ */

test("the visibility matrix: self, buddy, stranger — and a block that cannot be felt", async () => {
  await studio();
  const alice = await member("alice", "Alice");
  const bob = await member("bob", "Bob");
  const carol = await member("carol", "Carol");
  const dave = await member("dave", "Dave");

  await buddies(alice, bob);
  // Dave WAS a buddy, and is blocked afterwards — the case that matters, since
  // a block severs the edge and must leave nothing behind that hints at it.
  await buddies(alice, dave);
  ok(await blockUser(alice, dave), "alice blocking dave");

  await post(alice, "public", "public");
  await post(alice, "buddies", "buddies");
  await post(alice, "private", "private");

  /* Every tier, against the same wall. */
  assert.deepEqual(ids(wallFor(alice, alice)).sort(), ["buddies", "private", "public"], "the owner sees all three");
  assert.deepEqual(ids(wallFor(bob, alice)).sort(), ["buddies", "public"], "a buddy sees public + buddies");
  assert.deepEqual(ids(wallFor(carol, alice)), ["public"], "a stranger sees public only");

  /* PROPERTY 1: blocked is byte-identical to stranger, whole page. */
  assert.deepEqual(
    wallFor(dave, alice),
    wallFor(carol, alice),
    "a blocked viewer's page must be indistinguishable from any other non-buddy's",
  );

  /* A single post reads the same way. */
  const buddiesPost = wallFor(alice, alice).posts.find((p) => p.text === "buddies")!;
  assert.equal(readPost(bob, alice, buddiesPost.id)?.text, "buddies");
  assert.equal(readPost(carol, alice, buddiesPost.id), null, "a stranger cannot open a buddies post");
  assert.equal(readPost(dave, alice, buddiesPost.id), null, "and neither can a blocked viewer");

  /* And so do the refusals: hidden and never-existed answer identically. */
  const hidden = await react(dave, alice, buddiesPost.id, "like");
  const invented = await react(dave, alice, "wp-20260815-101010-abcdef", "like");
  assert.deepEqual(hidden, invented, "a blocked react must answer what a missing post answers");
  assert.deepEqual(hidden, { ok: false, error: "no such post", status: 404 });

  const hiddenComment = await comment(dave, alice, buddiesPost.id, "hello?");
  const inventedComment = await comment(dave, alice, "wp-20260815-101010-abcdef", "hello?");
  assert.deepEqual(hiddenComment, inventedComment, "and so must a comment");

  /* A stranger CAN still touch a public post — the block is the difference,
   * and it is only ever visible as an absence. */
  const publicPost = wallFor(carol, alice).posts[0]!;
  assert.equal(ok(await react(carol, alice, publicPost.id, "like"), "carol liking").ok, true);
  assert.deepEqual(
    await react(dave, alice, publicPost.id, "like"),
    { ok: false, error: "no such post", status: 404 },
    "a blocked viewer cannot react even to a public post — and is told nothing",
  );

  /* `buddiesOnly` narrows interaction, not a post's own statement: a member who
   * published something publicly published it. Pinned so a later change to the
   * guard's mapping shows up here rather than as a silent unpublish. */
  ok(await setBuddiesOnly(alice, true), "alice restricting interaction to buddies");
  assert.deepEqual(ids(wallFor(carol, alice)), ["public"]);
  assert.deepEqual(ids(wallFor(bob, alice)).sort(), ["buddies", "public"]);

  /* It DOES stop the interaction, and — rule 2 — it is allowed to say why,
   * because it is the subject's own stated policy. A block, rule 1, still says
   * nothing at all. The two refusals must not be the same shape. */
  const stated = await react(carol, alice, publicPost.id, "like");
  assert.equal(stated.ok, false);
  assert.equal((stated as { status: number }).status, 403, "a stated policy may name itself");
  assert.deepEqual(
    await react(dave, alice, publicPost.id, "like"),
    { ok: false, error: "no such post", status: 404 },
    "a block still says nothing",
  );
});

/* ============================ REACTION EXCLUSIVITY ============================ */

test("a like and a dislike are one vote: toggling, mutually exclusive, per member", async () => {
  await studio();
  const alice = await member("alice", "Alice");
  const bob = await member("bob", "Bob");
  const carol = await member("carol", "Carol");

  const p = await post(alice, "hello", "public");
  const at = (result: { ok: true; post: WallPost } | { ok: false; error: string }) =>
    ok(result, "reacting").post.reactions;

  let r = at(await react(bob, alice, p.id, "like"));
  assert.deepEqual(r, { likes: ["bob"], dislikes: [] }, "a like lands");

  r = at(await react(bob, alice, p.id, "like"));
  assert.deepEqual(r, { likes: [], dislikes: [] }, "the same reaction again toggles it off");

  r = at(await react(bob, alice, p.id, "dislike"));
  assert.deepEqual(r, { likes: [], dislikes: ["bob"] }, "a dislike lands");

  r = at(await react(bob, alice, p.id, "like"));
  assert.deepEqual(r, { likes: ["bob"], dislikes: [] }, "the other reaction MOVES the vote, never doubles it");

  r = at(await react(carol, alice, p.id, "dislike"));
  assert.deepEqual(r, { likes: ["bob"], dislikes: ["carol"] }, "two members are two independent votes");

  /* The property, stated over the document itself. */
  const stored = readPost(alice, alice, p.id)!;
  const both = stored.reactions.likes.filter((u) => stored.reactions.dislikes.includes(u));
  assert.deepEqual(both, [], "nobody may appear in both lists");
});

/* ================================== COMMENTS ================================== */

test("comments are one level deep, and three people may delete one", async () => {
  await studio();
  const alice = await member("alice", "Alice");
  const bob = await member("bob", "Bob");
  const carol = await member("carol", "Carol");

  const p = await post(alice, "hello", "public");
  const top = ok(await comment(bob, alice, p.id, "nice one"), "bob commenting").post.comments[0]!;
  assert.equal(top.replyTo, null);

  const withReply = ok(await reply(carol, alice, p.id, top.id, "agreed"), "carol replying").post;
  const replyRow = withReply.comments.find((c) => c.replyTo === top.id)!;
  assert.equal(replyRow.author, "carol");

  /* One level: a reply to a reply is refused by name, never flattened. */
  const nested = await reply(bob, alice, p.id, replyRow.id, "and again");
  assert.equal(nested.ok, false);
  assert.match((nested as { error: string }).error, /one level deep/);

  /* An empty comment, and one over the cap. */
  assert.equal((await comment(bob, alice, p.id, "   ")).ok, false);
  assert.equal((await comment(bob, alice, p.id, "x".repeat(2001))).ok, false);
  assert.equal(ok(await comment(bob, alice, p.id, "x".repeat(2000)), "the cap itself").ok, true);

  /* A stranger to the comment cannot delete it; the wall's owner can, and
   * deleting a top-level comment takes its reply with it. */
  const foreign = await deleteComment(bob, alice, p.id, replyRow.id);
  assert.equal(foreign.ok, false, "bob wrote neither the reply nor the wall");
  const swept = ok(await deleteComment(alice, alice, p.id, top.id), "the wall owner deleting").post;
  assert.equal(swept.comments.some((c) => c.id === top.id), false);
  assert.equal(swept.comments.some((c) => c.id === replyRow.id), false, "the orphaned reply goes too");
});

/* ================================= THE FEED =================================== */

test("the feed merges the viewer's wall with each buddy's, newest first, and pages", async () => {
  await studio();
  const alice = await member("alice", "Alice");
  const bob = await member("bob", "Bob");
  const carol = await member("carol", "Carol");

  await buddies(alice, bob);
  // Carol is nobody's buddy — her wall must not appear in alice's feed at all,
  // public posts included. A feed is a buddy list, not a firehose.
  await post(carol, "carol-public", "public");

  const stamps: Record<string, string> = {
    "alice-1": "2026-08-15T10:00:00.000Z",
    "bob-1": "2026-08-15T10:01:00.000Z",
    "alice-2": "2026-08-15T10:02:00.000Z",
    "bob-buddies": "2026-08-15T10:03:00.000Z",
    "bob-private": "2026-08-15T10:04:00.000Z",
    "alice-3": "2026-08-15T10:05:00.000Z",
  };
  const owners: Record<string, string> = {
    "alice-1": alice,
    "bob-1": bob,
    "alice-2": alice,
    "bob-buddies": bob,
    "bob-private": bob,
    "alice-3": alice,
  };
  for (const [text, stamp] of Object.entries(stamps)) {
    const owner = owners[text]!;
    const visibility: WallVisibility = text.endsWith("private")
      ? "private"
      : text.endsWith("buddies")
        ? "buddies"
        : "public";
    const made = await post(owner, text, visibility);
    backdate(owner, made.id, stamp);
  }

  /* The index rebuilt itself from the post files after every backdate. */
  assert.equal(wallIndex(bob).posts.length, 3, "bob's index came back from disk");

  const feed = feedFor(alice);
  assert.deepEqual(
    ids(feed),
    ["alice-3", "bob-buddies", "alice-2", "bob-1", "alice-1"],
    "newest first across both vaults; bob's private post is not alice's to see, and carol is not a buddy",
  );
  assert.equal(feed.owners["" + feed.posts[1]!.id], bob, "a feed row names the wall it came from");
  assert.equal(feed.nextCursor, null, "one page held everything");

  /* Paging: two at a time, walking the cursor, never repeating a row. */
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const chunk = feedFor(alice, cursor, 2);
    seen.push(...ids(chunk));
    cursor = chunk.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(seen, ids(feed), "the paged walk reproduces the feed exactly, in order");
  assert.equal(new Set(seen).size, seen.length, "no row appears twice");

  /* Bob's own feed sees his private post; alice's never did. */
  assert.equal(ids(feedFor(bob)).includes("bob-private"), true);
});

/* ================================ ATTACHMENTS ================================= */

test("attachments are sniffed, claimed once, and never served past a post's visibility", async () => {
  await studio();
  const alice = await member("alice", "Alice");
  const bob = await member("bob", "Bob");

  /* The bytes are what decide the extension — a .png name on a text file is
   * refused, exactly as the album store refuses it. */
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 7),
  ]);
  assert.equal((await uploadWallMedia(alice, alice, Buffer.from("not an image"))).ok, false);
  assert.equal((await uploadWallMedia(alice, alice, Buffer.alloc(0))).ok, false);

  const media = ok(await uploadWallMedia(alice, alice, png), "uploading").media;
  assert.equal(media.mime, "image/png");
  assert.equal(media.file, `wall/${media.id}.png`);
  assert.equal(fs.existsSync(path.join(moduleRoot, "users", alice, "files", media.file)), true);

  /* An attachment nobody uploaded, and one somebody else's post already holds,
   * both fail to resolve — that is the whole ownership check. */
  const invented = await createPost(alice, alice, { text: "x", media: ["wm-20260815-101010-abcdef"] });
  assert.equal(invented.ok, false);

  const held = ok(
    await createPost(alice, alice, { text: "with a picture", media: [media.id], visibility: "private" }),
    "posting with the attachment",
  ).post;
  assert.equal(held.media[0]!.id, media.id);
  const twice = await createPost(alice, alice, { text: "again", media: [media.id] });
  assert.equal(twice.ok, false, "an attachment already claimed by a post cannot be claimed again");

  /* The serve path follows the POST's visibility, not the file's existence. */
  assert.equal(resolveWallMedia(alice, alice, media.id)?.media.id, media.id);
  assert.equal(resolveWallMedia(bob, alice, media.id), null, "a private post's bytes stay private");
  ok(await editPost(alice, alice, held.id, { visibility: "public" }), "publishing it");
  assert.equal(resolveWallMedia(bob, alice, media.id)?.media.id, media.id, "and follow it when it opens");

  /* Deleting the post takes the bytes with it — nothing references them. */
  ok(await deletePost(alice, alice, held.id), "deleting the post");
  assert.equal(fs.existsSync(path.join(moduleRoot, "users", alice, "files", media.file)), false);
  assert.equal(resolveWallMedia(alice, alice, media.id), null);
});

/* ============================ EDIT, DELETE, MODERATION ======================== */

test("a post is the author's or a moderator's; a stranger's edit is refused", async () => {
  await studio();
  const alice = await member("alice", "Alice");
  const bob = await member("bob", "Bob");
  ok(await addUser("admin", "mod", "temp-pass", "administrator"), "adding a moderator");
  ok(await changePassword("mod", "temp-pass", "mod-real-pw"), "the moderator's password");
  ok(await setScreenname("mod", "Mod"), "the moderator's screenname");

  const p = await post(alice, "first draft", "public");

  const foreign = await editPost(bob, alice, p.id, { text: "vandalised" });
  assert.equal(foreign.ok, false);
  assert.equal((foreign as { status: number }).status, 403);

  const edited = ok(await editPost(alice, alice, p.id, { text: "second draft" }), "the author editing").post;
  assert.equal(edited.text, "second draft");
  assert.equal(typeof edited.editedAt, "string");

  /* Visibility is editable, and the index follows it — a post narrowed to
   * private must leave the stranger's view in the same write. */
  ok(await editPost(alice, alice, p.id, { visibility: "private" }), "narrowing it");
  assert.deepEqual(ids(wallFor(bob, alice)), [], "the index carries the new visibility");

  /* A moderator may delete what they did not write. */
  const removed = ok(await deletePost("mod", alice, p.id), "the moderator deleting");
  assert.equal(removed.post.id, p.id);
  assert.deepEqual(wallIndex(alice).posts, [], "the index lost the row with the file");
  assert.equal(readPost(alice, alice, p.id), null);

  /* A body must carry something. */
  const empty = await createPost(alice, alice, { text: "   " });
  assert.equal(empty.ok, false);
  const huge = await createPost(alice, alice, { text: "x".repeat(8001) });
  assert.equal(huge.ok, false);
});
