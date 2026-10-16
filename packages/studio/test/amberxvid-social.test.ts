/**
 * @file P21 — the platform lock. The six claims the social platform rests on,
 * asserted ACROSS the phases that built them rather than inside any one of
 * them.
 *
 * Every phase from P4 to P18 already has its own file, and this one does not
 * repeat them. It exists for the properties that live in the SEAMS — the places
 * where a phase's test cannot see the defect because the defect is somewhere
 * else:
 *
 * 1. **THE GUARD'S ONE ANSWER, AT EVERY WIRED PATH, PARAMETRISED OVER THE
 *    CONSUMER REGISTRY.** `canInteract` is one function and the whole silence
 *    guarantee is that its `blocked` verdict comes out of every surface looking
 *    exactly like that surface's own "there is no such subject". Nine wired
 *    paths across six consumer files are driven here in one table, and each is
 *    compared FIELD BY FIELD against its own cover story — never pattern
 *    matched, because a wording that drifts apart is the failure being asserted
 *    against and a regex would not see it.
 *
 *    The table is then checked against what is ACTUALLY on disk: every file
 *    under `src/` that imports `canInteract` must appear in it. A seventh
 *    consumer wired without a test does not quietly pass — it fails the registry
 *    count, by name. This is the discovering-test doctrine
 *    (`.claude/rules/asset-types.md`, "How a sui rule is enforced"): the
 *    guarantee sits on the chokepoint, not on a habit of remembering.
 *
 *    Each path also carries an OPEN case whose answer must NOT equal the cover.
 *    A thunk that refused everything — or a path wired to a function that no
 *    longer runs the guard — would otherwise pass the whole table by agreeing
 *    with itself. A guard nobody has watched pass AND fail is a guard nobody
 *    has tested.
 *
 * 2. **THREADS.** The pre-P5 two-member document still reads, unchanged, with
 *    no migration; unread is per member, not per thread; and `deliveredAt` is
 *    the AGGREGATE, which waits for the last member rather than the first.
 *
 * 3. **WALL.** Visibility × block as a full matrix (a blocked viewer is
 *    byte-identical to a stranger), reaction exclusivity as a property of the
 *    document after a walked sequence, and the merged feed's order and cursor
 *    stability across two vaults.
 *
 * 4. **INVITES.** Single use, expiry at the token gate, and the blocked-inviter
 *    refusal at BOTH ends — create and redeem — because a bare link has no
 *    handle to check at creation and a block can land in the days between.
 *
 * 5. **CREDITS.** The fold equals the sum of the entries on disk after
 *    concurrent appends of both signs, and a spend below zero is refused with
 *    the number that caused it.
 *
 * 6. **POLICY.** Three rows driven at their real ENFORCEMENT POINTS — not at
 *    the `assert*` helper, which `axv-policy.test.ts` already covers, but
 *    through `createPost`, `openRoom` and `createInvite` — because a row that
 *    refuses correctly and is never asked is a row that does nothing.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { addUser, changePassword, setScreenname } from "@axs/modules/accounts/lib/accounts";
import {
  acceptBuddy,
  blockUser,
  requestBuddy,
} from "@axs/modules/accounts/lib/relations";
import {
  createGroup,
  getThread,
  getThreadById,
  listThreads,
  markThreadReadById,
  sendMessage,
  sendToThread,
} from "@axs/modules/accounts/lib/messages";
import { getProfile } from "@axs/modules/accounts/lib/profiles";
import { messagesDir } from "@axs/modules/accounts/lib/paths";
import { threadIdFor, type Message } from "@axs/modules/accounts/lib/types";
import {
  creditBalance,
  creditStatement,
  grantCredits,
  invalidateCreditBalance,
  refundCredits,
  spendCredits,
} from "@axs/modules/accounts/lib/credits";
import { creditsFile } from "@axs/modules/accounts/lib/paths";

import { setFollow } from "@axs/modules/amberxvid/lib/follows";
import { openRoom } from "@axs/modules/amberxvid/lib/groupRooms";
import {
  createInvite,
  describeInvite,
  listInvites,
  readToken,
  redeemInvite,
} from "@axs/modules/amberxvid/lib/invites";
import { INVITE_DEAD, INVITE_LIMITS } from "@axs/modules/amberxvid/lib/inviteContract";
import { setAmberxvidPolicySource } from "@axs/modules/amberxvid/lib/policy";
import { BLOCKED_COVER, openRing } from "@axs/modules/amberxvid/lib/ring";
import { createPost, feedFor, react, readPost, wallFor } from "@axs/modules/amberxvid/lib/wall";
import type { WallPost, WallVisibility } from "@axs/modules/amberxvid/lib/types";

/* ================================== staging =================================== */

const roots: string[] = [];
/** The amberxvid store of the test currently running — the backdating helper
 *  reaches into it, and only it. */
let moduleRoot = "";
const ORIGIN = "http://localhost:3200";
const GHOST = "nobody-at-all";

function freshStores(): void {
  const accounts = fs.mkdtempSync(path.join(os.tmpdir(), "axv-p21-acc-"));
  const module = fs.mkdtempSync(path.join(os.tmpdir(), "axv-p21-mod-"));
  roots.push(accounts, module);
  moduleRoot = module;
  process.env.ACCOUNTS_DATA_DIR = accounts;
  process.env.AMBERXVID_DATA_DIR = module;
  process.env.AMBERXVID_SILENT_JOURNAL = "1";
  // Fixed per store, so a token minted in one test can never verify in another.
  process.env.AMBERXVID_AUTH_SECRET = `axv-p21-secret-${roots.length}`;
  // The ledger caches its fold in module scope; a new root must drop it or the
  // next test reads the previous one's balance.
  invalidateCreditBalance();
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  delete process.env.AMBERXVID_DATA_DIR;
  delete process.env.AMBERXVID_SILENT_JOURNAL;
  delete process.env.AMBERXVID_AUTH_SECRET;
  setAmberxvidPolicySource(null);
  invalidateCreditBalance();
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** Narrow an engine answer to its success shape, with the reason in the message
 *  when it is not — a bare `assert(result.ok)` throws the reason away. */
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

/** Fresh stores plus the seeded admin through their own forced entry, so
 *  `addUser` opens. */
async function studio(): Promise<void> {
  freshStores();
  setAmberxvidPolicySource(null);
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
 * it from the post files. Two things at once on purpose: real creates land
 * inside one millisecond of each other, so the merge order needs stamping, and
 * the rebuild walks the index's repair path at the same time.
 */
function backdate(owner: string, postId: string, createdAt: string): void {
  const dir = path.join(moduleRoot, "users", owner, "wall");
  const file = path.join(dir, `${postId}.json`);
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as WallPost;
  doc.createdAt = createdAt;
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  fs.rmSync(path.join(dir, "index.json"), { force: true });
}

const texts = (page: { posts: WallPost[] }): string[] => page.posts.map((p) => p.text);

/* ======================= 1. RELATIONS — the one answer ======================== */

/**
 * The four members every guard path is driven with.
 *
 * - `ann` is the SUBJECT, and the one who blocked.
 * - `bob` is BLOCKED by ann — every path is driven as bob against ann.
 * - `cal` is a stranger: no edge either way, refused by nothing.
 * - `dave` is ann's buddy, so an open answer can differ from a stranger's.
 */
interface Cast {
  ann: string;
  bob: string;
  cal: string;
  dave: string;
}

/** The three answers one wired path produces, for one cast. */
interface PathProbes {
  /** Somebody the guard does not refuse. Must NOT equal `cover`. */
  open: () => Promise<unknown>;
  /** The blocked member, driving the same path. Must equal `cover`. */
  blocked: () => Promise<unknown>;
  /** This surface's OWN answer for a subject that is not there. */
  cover: () => Promise<unknown>;
}

interface GuardPath {
  /** The consumer on disk, repo-relative. THE REGISTRY KEY — the count below
   *  is taken over this field, so a new consumer file needs an entry here. */
  file: string;
  /** The wired path, as a person would name it. */
  path: string;
  drive: (c: Cast) => PathProbes;
}

/**
 * THE REGISTRY. One entry per wired interaction path, keyed by the consumer
 * file that asks the guard. `test/amberxvid-social.test.ts` is the reason
 * `relations.ts`'s header table is a claim rather than a comment.
 */
const GUARD_PATHS: GuardPath[] = [
  {
    file: "src/modules/accounts/lib/messages.ts",
    path: "DM send",
    drive: ({ ann, bob, cal }) => ({
      open: () => sendMessage(cal, ann, "hello", false),
      blocked: () => sendMessage(bob, ann, "hello?", false),
      cover: () => sendMessage(bob, GHOST, "hello?", false),
    }),
  },
  {
    file: "src/modules/accounts/lib/profiles.ts",
    path: "profile read",
    drive: ({ ann, bob, cal }) => ({
      open: () => getProfile(cal, ann),
      blocked: () => getProfile(bob, ann),
      cover: () => getProfile(bob, GHOST),
    }),
  },
  {
    file: "src/modules/amberxvid/lib/ring.ts",
    path: "call ring",
    drive: ({ ann, bob, cal }) => ({
      open: () =>
        openRing({ from: cal, fromDisplay: "Cal", to: ann, toDisplay: "Ann", kind: "call" }),
      blocked: () =>
        openRing({ from: bob, fromDisplay: "Bob", to: ann, toDisplay: "Ann", kind: "call" }),
      // The ring door is asked BEFORE the callee is resolved (that is the whole
      // point — a prober must not read presence or busyness off an earlier
      // answer), so its cover story is a shared CONSTANT rather than a call
      // this layer can make. The routes that do resolve the account are held to
      // the same wording by the companion test below.
      cover: async () => ({ ok: false, ...BLOCKED_COVER }),
    }),
  },
  {
    file: "src/modules/amberxvid/lib/ring.ts",
    path: "room join (the invitation into a room)",
    drive: ({ ann, bob, cal }) => ({
      open: () =>
        openRing({
          from: cal,
          fromDisplay: "Cal",
          to: ann,
          toDisplay: "Ann",
          kind: "room",
          roomId: "r_probe",
          roomTitle: "Video room",
        }),
      blocked: () =>
        openRing({
          from: bob,
          fromDisplay: "Bob",
          to: ann,
          toDisplay: "Ann",
          kind: "room",
          roomId: "r_probe",
          roomTitle: "Video room",
        }),
      cover: async () => ({ ok: false, ...BLOCKED_COVER }),
    }),
  },
  {
    file: "src/modules/amberxvid/lib/social.ts",
    path: "wall view",
    drive: ({ ann, bob, cal, dave }) => ({
      // A buddy sees the buddies-only post; a stranger does not. Without this
      // the whole matrix could be satisfied by a wall that showed nobody
      // anything.
      open: async () => wallFor(dave, ann),
      blocked: async () => wallFor(bob, ann),
      cover: async () => wallFor(cal, ann),
    }),
  },
  {
    file: "src/modules/amberxvid/lib/social.ts",
    path: "wall reaction",
    drive: ({ ann, bob, cal }) => ({
      open: () => react(cal, ann, publicPostId, "like"),
      blocked: () => react(bob, ann, publicPostId, "like"),
      cover: () => react(bob, ann, "wp_not_a_real_post", "like"),
    }),
  },
  {
    file: "src/modules/amberxvid/lib/follows.ts",
    path: "follow",
    drive: ({ ann, bob, cal }) => ({
      open: () => setFollow(cal, ann, true),
      blocked: () => setFollow(bob, ann, true),
      cover: () => setFollow(bob, GHOST, true),
    }),
  },
  {
    file: "src/modules/amberxvid/lib/invites.ts",
    path: "invite create",
    drive: ({ ann, bob, cal }) => ({
      open: () => createInvite(cal, ORIGIN, { channel: "internal", handle: ann }),
      blocked: () => createInvite(bob, ORIGIN, { channel: "internal", handle: ann }),
      cover: () => createInvite(bob, ORIGIN, { channel: "internal", handle: GHOST }),
    }),
  },
  {
    file: "src/modules/amberxvid/lib/invites.ts",
    path: "invite redeem",
    drive: ({ ann, bob, cal }) => ({
      open: async () =>
        redeemInvite({
          token: await linkFrom(ann),
          mode: "signin",
          username: cal,
          password: `${cal}-real-pw`,
        }),
      blocked: async () =>
        redeemInvite({
          token: await linkFrom(ann),
          mode: "signin",
          username: bob,
          password: `${bob}-real-pw`,
        }),
      // A forged token: the same INVITE_DEAD every other dead link answers.
      cover: () => describeInvite("1893456000:deadbeef:ann.notasignature"),
    }),
  },
];

/** Ann's public post, staged by {@link stageCast} — the reaction path needs a
 *  real id, and a missing one would make its cover indistinguishable for the
 *  wrong reason. */
let publicPostId = "";

/** A fresh bare link from `inviter`, for the redeem probes. */
async function linkFrom(inviter: string): Promise<string> {
  const made = ok(await createInvite(inviter, ORIGIN, { channel: "link" }), "minting a link");
  return (made as { invite: { token: string } }).invite.token;
}

/**
 * The cast, staged: ann blocked bob, dave is ann's buddy, cal is nobody to
 * anybody, and ann's wall carries one post of each visibility so a viewer level
 * has something to differ about.
 */
async function stageCast(): Promise<Cast> {
  await studio();
  const ann = await member("ann", "Ann");
  const bob = await member("bob", "Bob");
  const cal = await member("cal", "Cal");
  const dave = await member("dave", "Dave");

  await buddies(ann, dave);
  publicPostId = (await post(ann, "for everyone", "public")).id;
  await post(ann, "for my buddies", "buddies");
  await post(ann, "for me", "private");

  ok(await blockUser(ann, bob), "ann blocking bob");
  return { ann, bob, cal, dave };
}

test("the guard's ONE answer, at every wired path: blocked is that surface's own 'not there'", async () => {
  const cast = await stageCast();

  for (const entry of GUARD_PATHS) {
    const probes = entry.drive(cast);
    const blocked = await probes.blocked();
    const cover = await probes.cover();

    // Whole objects, never a pattern. A test that matched the wording would
    // still pass on the day the two wordings drift, which is the day the block
    // starts leaking.
    assert.deepEqual(
      blocked,
      cover,
      `${entry.path} (${entry.file}): a probe that can tell 'blocked' from 'never existed' ` +
        "has defeated the silence",
    );

    const open = await probes.open();
    assert.notDeepEqual(
      open,
      cover,
      `${entry.path} (${entry.file}): the OPEN case answers the cover story too — this path ` +
        "refuses everybody, so its blocked/cover agreement proves nothing",
    );
  }
});

/* --------------------------- the registry count ------------------------------- */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Everything importing `canInteract` from the relations store, discovered on
 *  disk. Multi-line import lists included — `[^}]*` crosses newlines. */
const IMPORTS_THE_GUARD = /import\s*\{[^}]*\bcanInteract\b[^}]*\}\s*from\s*["'][^"']*relations["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(abs);
  }
  return out;
}

test("the registry counts: a consumer wired without a test fails HERE, by name", () => {
  const discovered = walk(SRC)
    .filter((abs) => IMPORTS_THE_GUARD.test(fs.readFileSync(abs, "utf8")))
    .map((abs) => `src/${path.relative(SRC, abs).replace(/\\/g, "/")}`)
    .sort();

  const registered = [...new Set(GUARD_PATHS.map((p) => p.file))].sort();

  assert.deepEqual(
    discovered,
    registered,
    "every file that asks `canInteract` is a wired interaction path, and every wired path is " +
      "driven by the table above. A file on the left and not the right is a path with no test; " +
      "one on the right and not the left is a stale entry",
  );
  // The count itself, stated: a regex that silently stopped matching would
  // otherwise agree with an empty registry.
  assert.equal(discovered.length, 6, "six consumer files ask the guard today");
  assert.ok(GUARD_PATHS.length >= discovered.length, "at least one wired path per consumer file");
});

test("the ring's cover story is the same sentence the routes use for an absent member", () => {
  // The ring door refuses before the callee is resolved, so the ROUTES answer
  // for a member who does not exist — and the two must be one string, or a
  // prober tells them apart at the layer the guard cannot reach.
  for (const route of ["app/api/amberxvid/calls/route.ts", "app/api/amberxvid/rooms/route.ts"]) {
    const abs = fileURLToPath(new URL(`../${route}`, import.meta.url));
    const source = fs.readFileSync(abs, "utf8");
    assert.ok(
      source.includes(`"${BLOCKED_COVER.error}"`),
      `${route} must refuse an absent member with exactly ${JSON.stringify(BLOCKED_COVER.error)} ` +
        "— the ring's blocked cover story is that string",
    );
    assert.ok(source.includes("404"), `${route} must refuse it with 404, as the cover does`);
  }
  assert.equal(BLOCKED_COVER.status, 404);
});

/* ============================= 2. THREADS ==================================== */

/**
 * The document the store wrote before groups existed, byte for byte — its own
 * type on purpose, because it deliberately is NOT the current shape.
 */
interface LegacyThread {
  version: 1;
  id: string;
  participants: [string, string];
  messages: Array<Omit<Message, "seq">>;
  createdAt: string;
  updatedAt: string;
}

test("a pre-existing two-member thread reads UNCHANGED after generalisation", async () => {
  await studio();
  await member("ann", "Ann");
  await member("bob", "Bob");

  const id = threadIdFor("ann", "bob");
  const at = (s: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
  const legacy: LegacyThread = {
    version: 1,
    id,
    participants: ["ann", "bob"],
    messages: [
      { id: "old-1", threadId: id, from: "ann", to: "bob", text: "one", sentAt: at(1), deliveredAt: at(2), readAt: at(3) },
      { id: "old-2", threadId: id, from: "ann", to: "bob", text: "two", sentAt: at(4), deliveredAt: at(5), readAt: null },
      { id: "old-3", threadId: id, from: "ann", to: "bob", text: "three", sentAt: at(6), deliveredAt: null, readAt: null },
    ],
    createdAt: at(1),
    updatedAt: at(6),
  };
  fs.mkdirSync(messagesDir(), { recursive: true });
  fs.writeFileSync(path.join(messagesDir(), `${id}.json`), JSON.stringify(legacy), "utf8");

  const opened = await getThread("bob", "ann");
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  assert.equal(opened.thread.kind, "dm", "a two-member thread is still a DM");
  assert.deepEqual(
    opened.thread.messages.map((m) => m.text),
    ["one", "two", "three"],
    "every message survives, in order, with nobody having run a migration",
  );
  assert.deepEqual(opened.thread.messages.map((m) => m.seq), [1, 2, 3], "seqs assigned by position");
  assert.equal(opened.deliveredNow, 1, "only the message that was never delivered arrives");

  const listed = await listThreads("bob");
  assert.equal(listed.unread, 2, "the same number the pre-groups per-message scan produced");
  assert.equal(listed.deliveredNow, 0, "and nothing is delivered a second time");

  // The rewritten file is the NEW shape, and the conversation is unchanged.
  const onDisk = JSON.parse(fs.readFileSync(path.join(messagesDir(), `${id}.json`), "utf8")) as {
    members?: unknown[];
    nextSeq?: number;
  };
  assert.ok(Array.isArray(onDisk.members), "the rewritten file carries members");
  assert.equal(onDisk.nextSeq, 4);
  ok(await sendMessage("bob", "ann", "four", false), "the legacy DM still sends");
});

test("unread is PER MEMBER, and one member reading does not read for the others", async () => {
  await studio();
  await member("ann", "Ann");
  await member("bob", "Bob");
  await member("cal", "Cal");

  const made = ok(await createGroup("ann", "The Garage", ["bob", "cal"]), "opening the group");
  const threadId = (made as { thread: { id: string } }).thread.id;

  for (const text of ["one", "two", "three"]) {
    ok(await sendToThread("ann", threadId, text, []), `ann sending ${text}`);
  }

  assert.equal((await listThreads("bob")).unread, 3, "bob has three waiting");
  assert.equal((await listThreads("cal")).unread, 3, "so does cal");
  assert.equal((await listThreads("ann")).unread, 0, "your own messages are not unread to you");

  const stamped = await markThreadReadById("bob", threadId);
  assert.equal(stamped, 3, "bob's read stamps his three");

  assert.equal((await listThreads("bob")).unread, 0);
  assert.equal(
    (await listThreads("cal")).unread,
    3,
    "cal's count is HIS cursor — a shared read stamp would silently empty everybody's inbox at once",
  );
});

test("deliveredAt is the AGGREGATE: it waits for the last member, not the first", async () => {
  await studio();
  await member("ann", "Ann");
  await member("bob", "Bob");
  await member("cal", "Cal");

  const made = ok(await createGroup("ann", "The Garage", ["bob", "cal"]), "opening the group");
  const threadId = (made as { thread: { id: string } }).thread.id;

  // Bob is online at send time; cal is not.
  const sent = ok(await sendToThread("ann", threadId, "gate went green", ["bob"]), "ann sending");
  assert.equal(
    (sent as { message: { deliveredAt: string | null } }).message.deliveredAt,
    null,
    "one of three having it is not delivery",
  );

  // Cal's own fetch IS his delivery, and it is the one that completes the set.
  const calRead = await getThreadById("cal", threadId);
  assert.equal(calRead.ok, true);
  if (!calRead.ok) return;
  assert.equal(calRead.deliveredNow, 1, "the queued message arrives on cal's fetch");

  const annView = await getThreadById("ann", threadId);
  assert.equal(annView.ok, true);
  if (!annView.ok) return;
  const message = annView.thread.messages.find((m) => m.text === "gate went green");
  assert.ok(message, "the message is still there");
  assert.notEqual(
    message.deliveredAt,
    null,
    "with every recipient stamped, the aggregate stamp lands — the sender's tick is honest",
  );
});

/* ================================ 3. WALL ==================================== */

test("the visibility × block matrix: a blocked viewer is byte-identical to a stranger", async () => {
  await studio();
  const ann = await member("ann", "Ann");
  const dave = await member("dave", "Dave");
  const cal = await member("cal", "Cal");
  const bob = await member("bob", "Bob");

  await buddies(ann, dave);
  // Bob WAS a buddy and is blocked afterwards — the case that matters, because
  // a block severs the edge and must leave nothing behind that hints at it.
  await buddies(ann, bob);
  const open = await post(ann, "for everyone", "public");
  await post(ann, "for my buddies", "buddies");
  await post(ann, "for me", "private");
  ok(await blockUser(ann, bob), "ann blocking bob");

  assert.deepEqual(texts(wallFor(ann, ann)), ["for me", "for my buddies", "for everyone"], "self sees all three");
  assert.deepEqual(texts(wallFor(dave, ann)), ["for my buddies", "for everyone"], "a buddy sees two");
  assert.deepEqual(texts(wallFor(cal, ann)), ["for everyone"], "a stranger sees the public one");

  assert.deepEqual(
    wallFor(bob, ann),
    wallFor(cal, ann),
    "the blocked viewer's page and the stranger's page are ONE object — a wall that let bob tell " +
      "'blocked' from 'we were never buddies' hands him what the silence exists to withhold",
  );

  // Reading one post, and touching it, answer the same way too.
  assert.deepEqual(readPost(bob, ann, open.id), readPost(cal, ann, open.id), "a public post is public to both");
  const buddiesPost = wallFor(ann, ann).posts.find((p) => p.text === "for my buddies");
  assert.ok(buddiesPost);
  assert.equal(readPost(bob, ann, buddiesPost.id), null, "and the buddies-only one is gone to both");
  assert.equal(readPost(cal, ann, buddiesPost.id), null);
});

test("a reaction is exclusive by DOCUMENT, walked toggle by toggle", async () => {
  await studio();
  const ann = await member("ann", "Ann");
  const cal = await member("cal", "Cal");
  const made = await post(ann, "for everyone", "public");

  const reactions = (r: { ok: boolean }): { likes: string[]; dislikes: string[] } =>
    (r as { post: { reactions: { likes: string[]; dislikes: string[] } } }).post.reactions;

  const liked = reactions(ok(await react(cal, ann, made.id, "like"), "liking"));
  assert.deepEqual(liked, { likes: [cal], dislikes: [] });

  const unliked = reactions(ok(await react(cal, ann, made.id, "like"), "un-liking"));
  assert.deepEqual(unliked, { likes: [], dislikes: [] }, "the same reaction twice is a toggle off");

  const disliked = reactions(ok(await react(cal, ann, made.id, "dislike"), "disliking"));
  assert.deepEqual(disliked, { likes: [], dislikes: [cal] });

  const switched = reactions(ok(await react(cal, ann, made.id, "like"), "switching back"));
  assert.deepEqual(
    switched,
    { likes: [cal], dislikes: [] },
    "switching MOVES the member — a client renders counts from `length`, so a name in both lists " +
      "is a count that is permanently wrong and nothing goes red",
  );
});

test("the feed merges two vaults by time, and its cursor never skips or repeats", async () => {
  await studio();
  const ann = await member("ann", "Ann");
  const dave = await member("dave", "Dave");
  const cal = await member("cal", "Cal");
  await buddies(ann, dave);

  const stamps: Record<string, string> = {
    "ann-1": "2026-08-15T10:00:00.000Z",
    "dave-1": "2026-08-15T10:01:00.000Z",
    "ann-2": "2026-08-15T10:02:00.000Z",
    "dave-buddies": "2026-08-15T10:03:00.000Z",
    "dave-private": "2026-08-15T10:04:00.000Z",
    "ann-3": "2026-08-15T10:05:00.000Z",
  };
  for (const [text, stamp] of Object.entries(stamps)) {
    const owner = text.startsWith("ann") ? ann : dave;
    const visibility: WallVisibility = text.endsWith("private")
      ? "private"
      : text.endsWith("buddies")
        ? "buddies"
        : "public";
    backdate(owner, (await post(owner, text, visibility)).id, stamp);
  }

  const feed = feedFor(ann);
  assert.deepEqual(
    texts(feed),
    ["ann-3", "dave-buddies", "ann-2", "dave-1", "ann-1"],
    "newest first across both vaults; dave's private post is not ann's to see",
  );
  assert.equal(feed.owners[feed.posts[1]!.id], dave, "a feed row names the wall it came from");
  assert.equal(feed.nextCursor, null, "one page held everything");

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 6; page += 1) {
    const chunk = feedFor(ann, cursor, 2);
    seen.push(...texts(chunk));
    cursor = chunk.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(seen, texts(feed), "the paged walk reproduces the feed exactly, in order");
  assert.equal(new Set(seen).size, seen.length, "no row appears twice");

  assert.deepEqual(texts(feedFor(cal)), [], "a member with no wall and no buddies has an honest empty feed");
});

/* ============================== 4. INVITES =================================== */

test("an invitation is single-use, and the second presentation is the same dead sentence", async () => {
  await studio();
  const ann = await member("ann", "Ann");
  const made = ok(await createInvite(ann, ORIGIN, { channel: "link" }), "creating");
  const token = (made as { invite: { token: string } }).invite.token;

  ok(await redeemInvite({ token, mode: "signup", username: "first", password: "first-pw" }), "the first redemption");

  const second = await redeemInvite({ token, mode: "signup", username: "second", password: "second-pw" });
  assert.equal(second.ok, false);
  assert.equal((second as { error: string }).error, INVITE_DEAD);
  assert.deepEqual(
    { ok: second.ok, error: (second as { error: string }).error, status: (second as { status: number }).status },
    await (async () => {
      const forged = await describeInvite("1893456000:deadbeef:ann.notasignature");
      return { ok: forged.ok, error: (forged as { error: string }).error, status: (forged as { status: number }).status };
    })(),
    "spent and forged are ONE refusal",
  );
});

test("expiry lives under the signature, and both readers go through the same gate", async () => {
  await studio();
  const ann = await member("ann", "Ann");
  const made = ok(await createInvite(ann, ORIGIN, { channel: "link" }), "creating");
  const token = (made as { invite: { token: string } }).invite.token;

  assert.ok(readToken(token), "the real token verifies now");
  assert.equal(
    readToken(token, Math.floor(Date.now() / 1000) + INVITE_LIMITS.ttlHours * 3600 + 60),
    null,
    "past its expiry the signature is still good and the token is still dead",
  );
  // The expiry is the first field of the signed payload, so moving it is
  // forgery — which is why a genuinely expired token cannot be minted without
  // the module secret, and why the gate is asserted here rather than by
  // fabricating one.
  const moved = token.replace(/^\d+/, "9999999999");
  assert.equal(readToken(moved), null, "an expiry moved forward under the signature");

  for (const [what, answer] of [
    ["describe", await describeInvite(moved)],
    ["redeem", await redeemInvite({ token: moved, mode: "signup", username: "late", password: "late-pw" })],
  ] as const) {
    assert.equal(answer.ok, false, `${what} must consult the token gate`);
    assert.equal((answer as { error: string }).error, INVITE_DEAD, `${what} answers the one dead sentence`);
  }
});

test("a blocked inviter is refused at BOTH ends — at create, and at redeem", async () => {
  await studio();
  const ann = await member("ann", "Ann");
  const carol = await member("carol", "Carol");

  /* Create: carol has blocked ann, so ann cannot even address her. */
  ok(await blockUser(carol, ann), "carol blocking ann");
  const addressed = await createInvite(ann, ORIGIN, { channel: "internal", handle: carol });
  const ghosted = await createInvite(ann, ORIGIN, { channel: "internal", handle: GHOST });
  assert.equal(addressed.ok, false);
  assert.deepEqual(addressed, ghosted, "a blocked handle answers exactly what a handle nobody holds answers");

  /* Redeem: the bare link had no handle to check, and the block lands after. */
  await studio();
  const brett = await member("brett", "Brett");
  const dana = await member("dana", "Dana");
  const link = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating a bare link");
  const token = (link as { invite: { token: string } }).invite.token;

  ok(await blockUser(dana, brett), "dana blocking brett after the link went out");
  const refused = await redeemInvite({ token, mode: "signin", username: dana, password: "dana-real-pw" });
  assert.equal(refused.ok, false);
  assert.equal(
    (refused as { error: string }).error,
    INVITE_DEAD,
    "the SECOND check is the one that always runs — a bare link has no handle at creation",
  );
  assert.equal(
    listInvites(brett)[0]!.state,
    "open",
    "and a refused redemption does not spend the link: the guard runs before consumption",
  );
});

/* ============================== 5. CREDITS =================================== */

/** Every delta in the ledger file on disk, summed — the fold's ONLY authority. */
function entrySum(user: string): number {
  const doc = JSON.parse(fs.readFileSync(creditsFile(user), "utf8")) as {
    entries?: { delta?: unknown }[];
  };
  return (doc.entries ?? []).reduce((n, e) => n + (typeof e.delta === "number" ? e.delta : 0), 0);
}

test("the fold equals the entry sum under concurrent appends of both signs", async () => {
  await studio();
  const ann = await member("ann", "Ann");
  ok(await grantCredits("admin", ann, 500, "seed"), "seeding");

  // Spends, refunds and grants, all racing. Under last-writer-wins this ends
  // with a balance that is simply wrong, forever, with nothing red anywhere.
  await Promise.all([
    ...Array.from({ length: 12 }, (_, i) => spendCredits(ann, 3, `render-${i}`)),
    ...Array.from({ length: 5 }, (_, i) => refundCredits(ann, 2, `undo-${i}`)),
    ...Array.from({ length: 3 }, (_, i) => grantCredits("admin", ann, 10, `bonus-${i}`)),
  ]);

  const sum = entrySum(ann);
  assert.equal(sum, 500 - 36 + 10 + 30, "every append landed: nothing was lost to a concurrent writer");

  invalidateCreditBalance(ann);
  assert.equal(await creditBalance(ann), sum, "the fold from a COLD cache equals the entries on disk");
  assert.equal((await creditStatement(ann)).balance, sum, "and so does the statement's");

  const file = JSON.parse(fs.readFileSync(creditsFile(ann), "utf8")) as Record<string, unknown>;
  assert.ok(Array.isArray(file.entries), "the ledger is entries");
  for (const key of ["balance", "total", "sum"]) {
    assert.equal(key in file, false, `nothing stores a ${key} — a cached total a crash could desync is the silent bug`);
  }
});

test("a spend below zero is refused, and it names the balance that refused it", async () => {
  await studio();
  const ann = await member("ann", "Ann");
  ok(await grantCredits("admin", ann, 5, "seed"), "seeding");

  const over = await spendCredits(ann, 6, "one too many");
  assert.equal(over.ok, false);
  assert.equal(over.balance, 5, "the number is a FIELD — 'insufficient credits' with no number is a support ticket");
  assert.equal(await creditBalance(ann), 5, "and a refused spend costs nothing");

  // Ten racing single-credit spends against five: exactly five may win.
  const raced = await Promise.all(Array.from({ length: 10 }, (_, i) => spendCredits(ann, 1, `race-${i}`)));
  assert.equal(raced.filter((r) => r.ok).length, 5, "five spends, not ten — free work given away is silent");
  assert.equal(await creditBalance(ann), 0);
  assert.equal(entrySum(ann), 0, "the entries agree with the fold at the boundary too");

  const broke = await spendCredits(ann, 1, "at zero");
  assert.equal(broke.ok, false);
  assert.equal(broke.balance, 0);
});

/* ============================== 6. POLICY ==================================== */

/** Force the cascade to one answer for everybody, for one test. */
function policy(rows: Record<string, unknown>): void {
  setAmberxvidPolicySource(() => rows);
}

test("three rows, driven at their real ENFORCEMENT points, refuse with the row named", async () => {
  await studio();
  const ann = await member("ann", "Ann");

  /* canPostWall → createPost */
  policy({ canPostWall: false });
  const posted = await createPost(ann, ann, { text: "hello" });
  assert.equal(posted.ok, false);
  assert.equal((posted as { status: number }).status, 403);
  assert.match(
    (posted as { error: string }).error,
    /`canPostWall`/,
    "the sentence is for the member; the row name is for the administrator who gets asked",
  );

  /* canJoinGroupRooms → openRoom (opening a room IS joining it) */
  policy({ canJoinGroupRooms: false });
  const opened = await openRoom(ann, "Friday night");
  assert.equal(opened.ok, false);
  assert.equal((opened as { status: number }).status, 403);
  assert.match((opened as { error: string }).error, /`canJoinGroupRooms`/);

  /* canSendInvites → createInvite */
  policy({ canSendInvites: false });
  const invited = await createInvite(ann, ORIGIN, { channel: "link" });
  assert.equal(invited.ok, false);
  assert.equal((invited as { status: number }).status, 403);
  assert.match((invited as { error: string }).error, /`canSendInvites`/);

  /* ...and with the cascade removed, all three go green again — a guard that
   * refuses under every condition is a guard that is not reading the row. */
  setAmberxvidPolicySource(null);
  ok(await createPost(ann, ann, { text: "hello" }), "posting with the row back on");
  ok(await openRoom(ann, "Friday night"), "opening a room with the row back on");
  ok(await createInvite(ann, ORIGIN, { channel: "link" }), "inviting with the row back on");
});
