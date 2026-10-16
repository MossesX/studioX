/**
 * @file **The wall** — posts, reactions, comments and the merged feed, in the
 * member's vault and on the accounts social graph (P8 of
 * `axf-amberxvid-social`, 2026-08-15).
 *
 * ```
 * users/<vaultKey>/wall/index.json      the ordering + filtering index
 * users/<vaultKey>/wall/<postId>.json   one post, its reactions and comments
 * users/<vaultKey>/files/wall/<mediaId>.<ext>   the attached bytes
 * ```
 *
 * ## Three decisions worth reading before changing anything here
 *
 * **1. The index is what a reader opens, and it carries more than an order.**
 * The step's shape is postId → createdAt; it also carries `visibility` and the
 * post's `media` ids, and both are load-bearing rather than convenient. A feed
 * that knew only the order would still have to OPEN every candidate post to
 * discover whether this viewer may see it — which is exactly the scan the index
 * exists to abolish, merely moved one line later. And the media route has to
 * answer "does a post this viewer may see reference these bytes" before it
 * serves them; with the ids in the index that is one small read instead of
 * hydrating a wall. The index holds precisely what must be known BEFORE a post
 * is opened, and nothing else. It is rebuilt from the post files whenever it is
 * missing or junk, so it is a cache with a repair path and never a second
 * source of truth.
 *
 * **2. Visibility runs through `canInteract`, and a block is silent.**
 * This module does not keep its own idea of who may see whom — the wall joins
 * the consumer registry in `accounts/lib/relations.ts` and asks the one guard.
 * A viewer the guard refuses (blocked, or held off by the owner's `buddiesOnly`)
 * is treated as **a stranger**, which is byte-identical to any other non-buddy:
 * they see the public posts and nothing else, and the wall reads as sparse
 * rather than as hostile. That is rule 1 of the relations header applied to a
 * surface whose "no such subject" answer is an empty list. A reaction or a
 * comment they attempt gets the same 404 a post that does not exist gets —
 * never a distinct refusal, which would hand them the confirmation the silence
 * is built to withhold.
 *
 * Administrators do **not** get a read bypass, for the same reason the accounts
 * graph refuses them one: a member-facing read is member-facing whoever is
 * signed into it, and an admin who needs somebody's data uses the audited admin
 * surfaces. Moderation power is a MUTATION power here (delete a post, delete a
 * comment) and nothing more.
 *
 * **3. A post lands on its writer's own wall.** `author` is the vault's owner,
 * which is what makes the quota charge land on the person whose bytes they are;
 * it is stored in the document anyway so that a post which has come through a
 * feed merge still knows who wrote it. An administrator acting for a member
 * goes through `resolveActor` exactly as they do in the album store — the
 * "all member data is admin-manageable" rule, in one place, once.
 *
 * ## Bytes
 *
 * Uploads reuse the album store's signature sniffer verbatim (`sniffImage` from
 * `./albums`): the stored extension comes from the BYTES, never from a client
 * filename, so nothing executable can land in the store. Every byte is weighed
 * against the member's quota before it lands (`./vault`) and charged to the
 * ledger after — attachments against the `files` store, where a rescan will
 * find them, and post documents against `wall`.
 *
 * House posture throughout: degrade never crash, one cross-process lock around
 * each whole read-modify-write (`withStoreLock`, per
 * `.claude/rules/concurrent-builds.md`), atomic writes, every mutation
 * journaled by a journal that can never fail a save. Server-only.
 *
 * ## Since P10: the comment system is shared, not the wall's
 *
 * The viewer tiers, the visibility filter, the reaction toggle, the one-level
 * comment thread and the block-is-an-absence refusal all moved to
 * `./social.ts` when album items became the second subject that has them. Every
 * rule this header describes is still the rule; it is simply implemented once
 * and called from two stores instead of living here and being copied. The
 * re-exports below keep `viewerLevel`/`visibleTo`/`isModerator` reachable at
 * their P8 addresses, because they are wall vocabulary to every caller.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { sniffImage } from "./albums";
import { findAccount, isValidUsername } from "./accounts";
import { appendJournal, readJson, withStoreLock, writeJsonAtomic } from "./fsCore";
import { ensureVault, vaultFilesDir, vaultKey, vaultWallDir, vaultWallMediaDir } from "./paths";
import { assertCanComment, assertCanPostWall } from "./policy";
import { resolveActor } from "./profiles";
import {
  appendComment,
  buddiesOf,
  checkCommentText,
  interactionRefusal as socialInteractionRefusal,
  isCommentId,
  isModerator,
  isRefusal,
  mayDeleteComment,
  newCommentId,
  newSocialId,
  norm,
  normalizeComments,
  normalizeReactions,
  toggleReaction,
  viewerLevel,
  visibleTo,
  withoutComment,
  type ReactionKind,
  type SocialRefusal,
  type ViewerLevel,
} from "./social";
import { assertVaultQuota, chargeVault } from "./vault";
import {
  WALL_COMMENTS_MAX,
  WALL_COMMENT_MAX,
  WALL_MEDIA_PER_POST_MAX,
  WALL_PAGE,
  WALL_TEXT_MAX,
  type WallComment,
  type WallMedia,
  type WallPost,
  type WallVisibility,
} from "./types";

export type WallResult =
  | { ok: true; post: WallPost }
  | { ok: false; error: string; status: number };

export type WallMediaResult =
  | { ok: true; media: WallMedia }
  | { ok: false; error: string; status: number };

/** The failure half of {@link WallResult}, named so that {@link GONE} can be
 *  read field-by-field when it is handed to the shared social layer. */
type WallFailure = Extract<WallResult, { ok: false }>;

const fail = (status: number, error: string): WallFailure => ({ ok: false, error, status });

/**
 * The refusal a viewer gets for a post they may not see — the SAME one a post
 * that does not exist gets. Rule 1 of the relations header: a probe that can
 * tell "hidden from you" from "never existed" has defeated the silence.
 */
const GONE = fail(404, "no such post");

/** Re-exported so a client editor can import the caps without this node file. */
export { WALL_COMMENTS_MAX, WALL_COMMENT_MAX, WALL_MEDIA_PER_POST_MAX, WALL_PAGE, WALL_TEXT_MAX };

/** Per-attachment byte cap, env-tunable for prod storage reality — the same
 *  shape (and the same default) as the album store's `maxPhotoBytes()`. */
export function maxWallMediaBytes(): number {
  const mb = Number.parseInt(process.env.AMBERXVID_MAX_WALL_MEDIA_MB ?? "", 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 25) * 1024 * 1024;
}

/** An attachment nobody has claimed after this long is an abandoned upload. */
const ORPHAN_MEDIA_MS = 24 * 60 * 60 * 1000;

/* --------------------------------- plumbing ------------------------------------ */

const fwd = (p: string): string => p.replace(/\\/g, "/");

function ledgerPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return fwd(rel.startsWith("..") ? abs : rel);
}

async function journal(op: "create" | "edit" | "delete", abs: string, summary: string): Promise<void> {
  if (process.env.AMBERXVID_SILENT_JOURNAL === "1") return;
  try {
    await appendJournal(op, ledgerPath(abs), { summary });
  } catch {
    /* ignore — accounting must never fail a save */
  }
}

/**
 * Exactly the bytes {@link writeJsonAtomic} puts on disk. Serializing once and
 * measuring THAT string is what lets the quota check and the write agree about
 * the size of the same document (the profile store's lesson, same reason).
 */
const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/* ----------------------------- ids + path safety ------------------------------- */

const POST_ID_RE = /^wp-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;
const MEDIA_ID_RE = /^wm-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;

export const isPostId = (id: string): boolean => POST_ID_RE.test(id);
export const isWallMediaId = (id: string): boolean => MEDIA_ID_RE.test(id);

/** Comment ids, the viewer tiers and the moderator rule are the SOCIAL layer's
 *  (`./social.ts`) and are re-exported here at the addresses P8 gave them. */
export { isCommentId, isModerator, viewerLevel, visibleTo };
export type { ReactionKind, ViewerLevel };

/** One id, minted in the shape both stores use. */
const newId = newSocialId;

// Per-user paths resolve through `./paths` and are never built here (P2).
const wallDir = (owner: string): string => vaultWallDir(owner);
const postFile = (owner: string, postId: string): string => path.join(wallDir(owner), `${postId}.json`);
/** `index.json` cannot collide with a post file — `POST_ID_RE` refuses it. */
const indexFile = (owner: string): string => path.join(wallDir(owner), "index.json");

/** Absolute path of one attachment. `file` is FILES-store-relative. */
export const wallMediaPathOf = (owner: string, media: WallMedia): string =>
  path.join(vaultFilesDir(owner), media.file);

const lockName = (owner: string): string => `wall-${vaultKey(owner)}`;

/* ----------------------------------- the index ---------------------------------- */

/**
 * One index row: everything a reader must know BEFORE opening a post. See
 * decision (1) in the file header for why it is these three fields and not
 * only `createdAt`.
 */
export interface WallIndexEntry {
  id: string;
  createdAt: string;
  visibility: WallVisibility;
  /** The attachment ids this post holds — the media route's ownership check. */
  media: string[];
}

interface WallIndex {
  version: 1;
  author: string;
  /** Newest first — the order every read wants, paid for once per write. */
  posts: WallIndexEntry[];
  updatedAt: string;
}

const emptyIndex = (owner: string): WallIndex => ({
  version: 1,
  author: owner,
  posts: [],
  updatedAt: new Date(0).toISOString(),
});

const VISIBILITIES: readonly WallVisibility[] = ["public", "buddies", "private"];

const isVisibility = (v: unknown): v is WallVisibility =>
  typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v);

/** Normalize one stored row, or reject it. A junk row is dropped rather than
 *  trusted — an unreadable index is repaired, never obeyed. */
function normalizeEntry(raw: unknown): WallIndexEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isPostId(r.id)) return null;
  if (typeof r.createdAt !== "string" || !r.createdAt) return null;
  if (!isVisibility(r.visibility)) return null;
  const media = Array.isArray(r.media)
    ? r.media.filter((m): m is string => typeof m === "string" && isWallMediaId(m))
    : [];
  return { id: r.id, createdAt: r.createdAt, visibility: r.visibility, media };
}

const byNewest = (a: WallIndexEntry, b: WallIndexEntry): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

const entryOf = (post: WallPost): WallIndexEntry => ({
  id: post.id,
  createdAt: post.createdAt,
  visibility: post.visibility,
  media: post.media.map((m) => m.id),
});

/**
 * Rebuild the index by reading every post file. The repair path — called when
 * the index is absent or unreadable, which is what makes it a cache rather
 * than a second source of truth. Caller holds the lock.
 */
function rebuildIndexLocked(owner: string): WallIndex {
  let names: string[] = [];
  try {
    names = fs.readdirSync(wallDir(owner));
  } catch {
    names = [];
  }
  const posts: WallIndexEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!isPostId(id)) continue;
    const post = readPostFile(owner, id);
    if (post) posts.push(entryOf(post));
  }
  posts.sort(byNewest);
  const doc: WallIndex = { version: 1, author: owner, posts, updatedAt: new Date().toISOString() };
  writeJsonAtomic(indexFile(owner), doc);
  return doc;
}

/** Parse the index, or `null` when it is absent/junk and must be rebuilt. */
function parseIndex(owner: string): WallIndex | null {
  const raw = readJson<Record<string, unknown> | null>(indexFile(owner), null);
  if (!raw || raw.version !== 1 || !Array.isArray(raw.posts)) return null;
  const posts = raw.posts.map(normalizeEntry).filter((e): e is WallIndexEntry => e !== null);
  return {
    version: 1,
    author: owner,
    // Same de-duplication the write path does, for the same reason — a
    // hand-edited file must not make a post render twice.
    posts: [...new Map(posts.map((e) => [e.id, e])).values()].sort(byNewest),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
  };
}

/**
 * One member's index. The hot path is a single small read with no lock; only
 * the repair takes one, because a repair writes.
 */
export function wallIndex(owner: string): WallIndex {
  if (!isValidUsername(owner.trim())) return emptyIndex(owner);
  const parsed = parseIndex(owner);
  if (parsed) return parsed;
  if (!fs.existsSync(wallDir(owner))) return emptyIndex(owner);
  try {
    return withStoreLock(lockName(owner), () => parseIndex(owner) ?? rebuildIndexLocked(owner));
  } catch {
    // A lock we could not take must not take a read down with it.
    return emptyIndex(owner);
  }
}

/**
 * Index-in, index-out. Caller holds the lock.
 *
 * **The de-duplication is not defensive tidying — it is the correctness of the
 * write path.** A mutation writes the post file first and then folds its row
 * into the index, and if the index needed REBUILDING at that moment the rebuild
 * scans the directory and already finds the row it is about to be handed. The
 * last row for an id wins, so the caller's freshly-built entry is the one kept.
 * Hydration walks the index, so a duplicated row is a post rendered twice.
 */
function saveIndexLocked(owner: string, entries: WallIndexEntry[]): void {
  const byId = new Map<string, WallIndexEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  const doc: WallIndex = {
    version: 1,
    author: owner,
    posts: [...byId.values()].sort(byNewest),
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(indexFile(owner), doc);
}

/** The index as the mutation paths need it: parsed, or rebuilt. Holds lock. */
const indexLocked = (owner: string): WallIndex => parseIndex(owner) ?? rebuildIndexLocked(owner);

/* ------------------------------------ posts -------------------------------------- */

function normalizeMedia(raw: unknown): WallMedia | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isWallMediaId(r.id)) return null;
  if (typeof r.file !== "string" || !r.file.startsWith("wall/")) return null;
  return {
    id: r.id,
    file: r.file,
    mime: typeof r.mime === "string" ? r.mime : "application/octet-stream",
    sizeBytes: typeof r.sizeBytes === "number" && r.sizeBytes >= 0 ? r.sizeBytes : 0,
    uploadedAt: typeof r.uploadedAt === "string" ? r.uploadedAt : new Date(0).toISOString(),
  };
}

/**
 * One post off disk, normalized. Junk reads as `null` — a wall with an
 * unreadable post is a wall missing one post, never a wall that 500s.
 */
function readPostFile(owner: string, postId: string): WallPost | null {
  if (!isValidUsername(owner.trim()) || !isPostId(postId)) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(postFile(owner, postId), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (raw?.version !== 1 || raw.id !== postId) return null;
  return {
    version: 1,
    id: postId,
    author: typeof raw.author === "string" ? raw.author : owner,
    text: typeof raw.text === "string" ? raw.text : "",
    media: Array.isArray(raw.media)
      ? raw.media.map(normalizeMedia).filter((m): m is WallMedia => m !== null)
      : [],
    visibility: isVisibility(raw.visibility) ? raw.visibility : "private",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    ...(typeof raw.editedAt === "string" ? { editedAt: raw.editedAt } : {}),
    reactions: normalizeReactions(raw.reactions),
    comments: normalizeComments(raw.comments),
  };
}

/* --------------------------------- who sees what ---------------------------------- */

/**
 * May `actor` ACT on `owner`'s wall — react, comment, reply? `null` means yes.
 *
 * The rule and its two mapping cases live in `./social.ts`; this is the wall's
 * absence sentence handed to it, so a block is rendered as {@link GONE} —
 * byte-identical to a post that never existed.
 */
function interactionRefusal(actor: string, owner: string): WallResult | null {
  const refusal: SocialRefusal | null = socialInteractionRefusal(actor, owner, {
    status: GONE.status,
    error: GONE.error,
  });
  return refusal ? fail(refusal.status, refusal.error) : null;
}

/**
 * One post, if this viewer may see it. `null` covers "no such post" and "not
 * for you" identically, and every caller renders both as {@link GONE}.
 */
export function readPost(viewer: string, owner: string, postId: string): WallPost | null {
  const post = readPostFile(owner, postId);
  if (!post) return null;
  return visibleTo(viewerLevel(viewer, owner), post.visibility) ? post : null;
}

/* --------------------------------- paging --------------------------------------- */

/**
 * The sort key a cursor is: `createdAt|owner|id`, descending.
 *
 * Comparing strings rather than dates keeps a merged feed totally ordered even
 * when two members post in the same millisecond — the tie breaks on owner then
 * id, which are stable, so a cursor can never skip or repeat an item.
 */
const sortKey = (owner: string, entry: WallIndexEntry): string =>
  `${entry.createdAt}|${norm(owner)}|${entry.id}`;

export interface WallPage {
  /** Newest first, hydrated. */
  posts: WallPost[];
  /** Pass back as `cursor` for the next page; `null` at the end. */
  nextCursor: string | null;
  /** Which wall each post came from, by post id — a merged feed's items are
   *  from several vaults, and a client needs the owner to build a link. */
  owners: Record<string, string>;
}

interface Candidate {
  owner: string;
  entry: WallIndexEntry;
  key: string;
}

/** Order, cut at the cursor, hydrate exactly one page. Posts that vanished
 *  between the index read and the hydrate are skipped; the next mutation
 *  rewrites the index and the row goes with it. */
function hydratePage(candidates: Candidate[], cursor: string | null, limit: number): WallPage {
  const ordered = candidates
    .filter((c) => cursor === null || c.key < cursor)
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

  const posts: WallPost[] = [];
  const owners: Record<string, string> = {};
  let last: Candidate | null = null;
  let consumed = 0;
  for (const candidate of ordered) {
    if (posts.length >= limit) break;
    consumed += 1;
    const post = readPostFile(candidate.owner, candidate.entry.id);
    if (!post) continue;
    posts.push(post);
    owners[post.id] = candidate.owner;
    last = candidate;
  }
  const more = ordered.length > consumed;
  return { posts, nextCursor: more && last ? last.key : null, owners };
}

/**
 * One member's wall as `viewer` sees it — visibility filtered through the
 * accounts guard, newest first, one page at a time.
 *
 * A viewer the guard refuses gets the stranger's view rather than an error:
 * public posts, and a wall that looks sparse.
 */
export function wallFor(
  viewer: string,
  owner: string,
  cursor: string | null = null,
  limit = WALL_PAGE,
): WallPage {
  if (!isValidUsername(owner.trim())) return { posts: [], nextCursor: null, owners: {} };
  const level = viewerLevel(viewer, owner);
  const candidates = wallIndex(owner)
    .posts.filter((entry) => visibleTo(level, entry.visibility))
    .map((entry) => ({ owner, entry, key: sortKey(owner, entry) }));
  return hydratePage(candidates, cursor, limit);
}

/**
 * The merged feed: the viewer's own wall plus each buddy's, newest first.
 *
 * Indexes first — every candidate's order and visibility comes out of the
 * index, and exactly one page of post documents is opened. A feed that
 * hydrated first and filtered afterwards would read every buddy's whole wall
 * to show twenty rows.
 *
 * Each buddy is still put through {@link viewerLevel} rather than assumed
 * visible. A mutual buddy always passes today (blocking severs the edge), but
 * asking is what keeps this file on the ONE guard instead of on a belief about
 * what the graph guarantees.
 */
export function feedFor(
  viewer: string,
  cursor: string | null = null,
  limit = WALL_PAGE,
): WallPage {
  const me = norm(viewer);
  if (!me) return { posts: [], nextCursor: null, owners: {} };
  const walls = [me, ...buddiesOf(me)];
  const candidates: Candidate[] = [];
  for (const owner of walls) {
    const level = viewerLevel(me, owner);
    for (const entry of wallIndex(owner).posts) {
      if (!visibleTo(level, entry.visibility)) continue;
      candidates.push({ owner, entry, key: sortKey(owner, entry) });
    }
  }
  return hydratePage(candidates, cursor, limit);
}

/* ------------------------------------ gates -------------------------------------- */

/** Owner-or-administrator, plus the owner must be a live entered member —
 *  the album store's gate, verbatim in shape. */
async function gate(actor: string, owner: string): Promise<WallResult | null> {
  const access = await resolveActor(actor, owner);
  if (!access.ok) return fail(access.status, access.error);
  const account = await findAccount(owner);
  if (!account || account.disabled === true || !account.screenname) {
    return fail(404, "no such module member");
  }
  return null;
}

/* --------------------------------- attachments ------------------------------------ */

/**
 * Every attachment id any of this member's posts references. The media route's
 * ownership check and the orphan sweep both ask it, out of the index — never by
 * opening posts.
 */
function claimedMedia(owner: string): Set<string> {
  const claimed = new Set<string>();
  for (const entry of wallIndex(owner).posts) for (const id of entry.media) claimed.add(id);
  return claimed;
}

/**
 * Delete attachments nobody claimed and nobody is about to — an upload the
 * composer abandoned. Best-effort, and deliberately generous with time: a file
 * younger than {@link ORPHAN_MEDIA_MS} is a composer still being typed in, not
 * an orphan.
 *
 * Run at the END of an upload rather than on a timer: that is the one moment
 * this directory is already being touched, so the sweep costs one `readdir`
 * that would otherwise never happen. Returns the bytes reclaimed.
 */
export async function sweepOrphanWallMedia(owner: string): Promise<number> {
  const dir = vaultWallMediaDir(owner);
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return 0;
  }
  const claimed = claimedMedia(owner);
  const cutoff = Date.now() - ORPHAN_MEDIA_MS;
  let freed = 0;
  for (const name of names) {
    const id = name.replace(/\.[a-z0-9]+$/i, "");
    if (!isWallMediaId(id) || claimed.has(id)) continue;
    const abs = path.join(dir, name);
    try {
      const stat = await fsp.stat(abs);
      if (stat.mtimeMs > cutoff) continue;
      await fsp.rm(abs, { force: true });
      freed += stat.size;
    } catch {
      /* vanished underneath us — nothing to reclaim */
    }
  }
  if (freed > 0) {
    await chargeVault(owner, "files", -freed, "swept abandoned wall attachments");
  }
  return freed;
}

/**
 * Store one attachment's bytes. Two-step by design: the composer uploads, then
 * names the returned ids on the post. That is what lets an upload be
 * byte-capped, sniffed and quota-charged on its own request instead of inside
 * a JSON body, and what makes a failed attachment a failed attachment rather
 * than a failed post.
 *
 * Bytes land in the FILES store and are charged there — see
 * `vaultWallMediaDir`'s note on why the charge follows the bytes.
 */
export async function uploadWallMedia(
  actor: string,
  owner: string,
  bytes: Buffer,
): Promise<WallMediaResult> {
  const denied = await gate(actor, owner);
  // `gate` answers in the post shape; an upload answers in the media one, so
  // the refusal is re-wrapped rather than cast.
  if (denied && !denied.ok) return { ok: false, error: denied.error, status: denied.status };
  if (bytes.length === 0) return { ok: false, error: "empty upload", status: 400 };

  const may = await assertCanPostWall(owner);
  if (!may.ok) return { ok: false, error: may.error, status: may.status };

  const cap = maxWallMediaBytes();
  if (bytes.length > cap) {
    return {
      ok: false,
      status: 413,
      error:
        `that attachment is ${(bytes.length / 1024 / 1024).toFixed(1)} MB and this deployment ` +
        `caps wall attachments at ${Math.round(cap / 1024 / 1024)} MB.`,
    };
  }
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, error: "not a recognized image (JPEG, PNG, WebP or GIF)", status: 415 };

  const room = await assertVaultQuota(owner, bytes.length);
  if (!room.ok) return { ok: false, error: room.error, status: room.status };

  const id = newId("wm");
  const media: WallMedia = {
    id,
    file: `wall/${id}.${kind.ext}`,
    mime: kind.mime,
    sizeBytes: bytes.length,
    uploadedAt: new Date().toISOString(),
  };
  ensureVault(owner);
  const abs = wallMediaPathOf(owner, media);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, bytes);
  await chargeVault(owner, "files", bytes.length, "wall attachment uploaded");
  await journal(
    "create",
    abs,
    `AmberX Vid: ${actor} uploaded a ${kind.ext.toUpperCase()} (${(bytes.length / 1024).toFixed(0)} KB) to ${owner}'s wall`,
  );
  await sweepOrphanWallMedia(owner);
  return { ok: true, media };
}

/**
 * Serve-time resolution: the attachment `viewer` asked for, if a post they may
 * see references it. Index-only — no post document is opened, which is why
 * this is cheap enough to sit on a media route.
 */
export function resolveWallMedia(
  viewer: string,
  owner: string,
  mediaId: string,
): { post: WallPost; media: WallMedia; abs: string } | null {
  if (!isValidUsername(owner.trim()) || !isWallMediaId(mediaId)) return null;
  const level = viewerLevel(viewer, owner);
  const entry = wallIndex(owner).posts.find(
    (e) => e.media.includes(mediaId) && visibleTo(level, e.visibility),
  );
  if (!entry) return null;
  const post = readPostFile(owner, entry.id);
  const media = post?.media.find((m) => m.id === mediaId);
  if (!post || !media) return null;
  const abs = wallMediaPathOf(owner, media);
  return fs.existsSync(abs) ? { post, media, abs } : null;
}

/** Resolve the ids a composer named into real, unclaimed attachments of this
 *  member's. An id that is claimed by another post, missing on disk, or simply
 *  invented does not resolve — which is the whole ownership check. */
function resolveClaimed(
  owner: string,
  ids: string[],
  keep: WallMedia[],
): { ok: true; media: WallMedia[] } | { ok: false; error: string; status: number } {
  const claimed = claimedMedia(owner);
  for (const held of keep) claimed.delete(held.id);
  const out: WallMedia[] = [];
  for (const id of ids) {
    if (out.some((m) => m.id === id)) continue;
    const held = keep.find((m) => m.id === id);
    if (held) {
      out.push(held);
      continue;
    }
    if (!isWallMediaId(id) || claimed.has(id)) {
      return { ok: false, error: "no such attachment", status: 404 };
    }
    const dir = vaultWallMediaDir(owner);
    let name: string | undefined;
    try {
      name = fs.readdirSync(dir).find((n) => n.replace(/\.[a-z0-9]+$/i, "") === id);
    } catch {
      name = undefined;
    }
    if (!name) return { ok: false, error: "no such attachment", status: 404 };
    const abs = path.join(dir, name);
    const ext = path.extname(name).toLowerCase();
    const mime =
      ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
    let uploadedAt = new Date().toISOString();
    try {
      uploadedAt = new Date(fs.statSync(abs).mtimeMs).toISOString();
    } catch {
      /* the file was resolved a line ago; a race here is not worth failing a post over */
    }
    out.push({ id, file: `wall/${name}`, mime, sizeBytes: fileBytes(abs), uploadedAt });
  }
  return { ok: true, media: out };
}

/* ---------------------------------- post CRUD ------------------------------------- */

export interface NewPost {
  text: string;
  /** Attachment ids from `uploadWallMedia`, in display order. */
  media?: string[];
  visibility?: WallVisibility;
}

function checkBody(text: string, media: string[]): { error: string; status: number } | null {
  if (text.length > WALL_TEXT_MAX) {
    return { error: `a post is capped at ${WALL_TEXT_MAX} characters`, status: 400 };
  }
  if (media.length > WALL_MEDIA_PER_POST_MAX) {
    return { error: `a post is capped at ${WALL_MEDIA_PER_POST_MAX} attachments`, status: 400 };
  }
  if (!text.trim() && media.length === 0) {
    return { error: "a post needs text or an attachment", status: 400 };
  }
  return null;
}

/**
 * Write a post to `owner`'s wall. The author IS the owner (header, decision 3);
 * an administrator may act for them through {@link gate}, exactly as they may
 * in the album store.
 */
export async function createPost(actor: string, owner: string, input: NewPost): Promise<WallResult> {
  const denied = await gate(actor, owner);
  if (denied) return denied;

  const may = await assertCanPostWall(owner);
  if (!may.ok) return fail(may.status, may.error);

  const text = typeof input.text === "string" ? input.text : "";
  const mediaIds = Array.isArray(input.media) ? input.media : [];
  const bad = checkBody(text, mediaIds);
  if (bad) return fail(bad.status, bad.error);

  const resolved = resolveClaimed(owner, mediaIds, []);
  if (!resolved.ok) return fail(resolved.status, resolved.error);

  const now = new Date().toISOString();
  const post: WallPost = {
    version: 1,
    id: newId("wp"),
    author: owner,
    text: text.trim(),
    media: resolved.media,
    visibility: isVisibility(input.visibility) ? input.visibility : "public",
    createdAt: now,
    reactions: { likes: [], dislikes: [] },
    comments: [],
  };

  // The document's own bytes, weighed before they land. The attachments were
  // charged at upload — charging them again here would double-count a member
  // out of their own quota.
  const body = serialize(post);
  const room = await assertVaultQuota(owner, Buffer.byteLength(body));
  if (!room.ok) return fail(room.status, room.error);

  ensureVault(owner);
  withStoreLock(lockName(owner), () => {
    writeJsonAtomic(postFile(owner, post.id), post);
    saveIndexLocked(owner, [...indexLocked(owner).posts, entryOf(post)]);
  });
  await chargeVault(owner, "wall", Buffer.byteLength(body), "wall post created");
  await journal("create", postFile(owner, post.id), `AmberX Vid: ${actor} posted to ${owner}'s wall`);
  return { ok: true, post };
}

export interface PostPatch {
  text?: string;
  media?: string[];
  visibility?: WallVisibility;
}

/**
 * Edit a post's body, attachments or visibility — the author, or a moderator.
 *
 * An attachment dropped by an edit is deleted and credited back: the bytes are
 * unreachable the moment nothing references them, and a store that kept them
 * would charge a member for files no surface can show.
 */
export async function editPost(
  actor: string,
  owner: string,
  postId: string,
  patch: PostPatch,
): Promise<WallResult> {
  const existing = readPostFile(owner, postId);
  if (!existing) return GONE;
  if (norm(actor) !== norm(existing.author) && !(await isModerator(actor))) {
    return fail(403, "only the author or a moderator may edit that post");
  }

  const text = patch.text !== undefined ? patch.text : existing.text;
  const mediaIds =
    patch.media !== undefined ? patch.media : existing.media.map((m) => m.id);
  const bad = checkBody(text, mediaIds);
  if (bad) return fail(bad.status, bad.error);

  const resolved = resolveClaimed(owner, mediaIds, existing.media);
  if (!resolved.ok) return fail(resolved.status, resolved.error);
  const dropped = existing.media.filter((m) => !resolved.media.some((k) => k.id === m.id));

  const next: WallPost = {
    ...existing,
    text: text.trim(),
    media: resolved.media,
    visibility: isVisibility(patch.visibility) ? patch.visibility : existing.visibility,
    editedAt: new Date().toISOString(),
  };
  const before = fileBytes(postFile(owner, postId));
  const after = Buffer.byteLength(serialize(next));
  if (after > before) {
    const room = await assertVaultQuota(owner, after - before);
    if (!room.ok) return fail(room.status, room.error);
  }

  withStoreLock(lockName(owner), () => {
    writeJsonAtomic(postFile(owner, postId), next);
    const posts = indexLocked(owner).posts.filter((e) => e.id !== postId);
    saveIndexLocked(owner, [...posts, entryOf(next)]);
  });

  let freed = 0;
  for (const media of dropped) {
    const abs = wallMediaPathOf(owner, media);
    freed += media.sizeBytes || fileBytes(abs);
    await fsp.rm(abs, { force: true });
  }
  await chargeVault(owner, "wall", after - before, "wall post edited");
  if (freed > 0) await chargeVault(owner, "files", -freed, "wall attachments removed by an edit");
  await journal("edit", postFile(owner, postId), `AmberX Vid: ${actor} edited a post on ${owner}'s wall`);
  return { ok: true, post: next };
}

/** Delete a post, its comments and its attachments — the author, or a moderator. */
export async function deletePost(actor: string, owner: string, postId: string): Promise<WallResult> {
  const existing = readPostFile(owner, postId);
  if (!existing) return GONE;
  if (norm(actor) !== norm(existing.author) && !(await isModerator(actor))) {
    return fail(403, "only the author or a moderator may delete that post");
  }

  const docBytes = fileBytes(postFile(owner, postId));
  withStoreLock(lockName(owner), () => {
    try {
      fs.rmSync(postFile(owner, postId), { force: true });
    } catch {
      /* already gone */
    }
    saveIndexLocked(owner, indexLocked(owner).posts.filter((e) => e.id !== postId));
  });

  let freed = 0;
  for (const media of existing.media) {
    const abs = wallMediaPathOf(owner, media);
    freed += media.sizeBytes || fileBytes(abs);
    await fsp.rm(abs, { force: true });
  }
  await chargeVault(owner, "wall", -docBytes, "wall post deleted");
  if (freed > 0) await chargeVault(owner, "files", -freed, "attachments of a deleted wall post");
  await journal(
    "delete",
    postFile(owner, postId),
    `AmberX Vid: ${actor} deleted a post on ${owner}'s wall (${existing.media.length} attachment(s))`,
  );
  return { ok: true, post: existing };
}

/* --------------------------------- reactions -------------------------------------- */

/**
 * Like or dislike — {@link toggleReaction}'s rule (toggling, mutually
 * exclusive), applied to a post document under the wall's lock.
 *
 * A viewer who cannot see the post gets {@link GONE}, the same answer a post
 * that never existed gets.
 */
export async function react(
  actor: string,
  owner: string,
  postId: string,
  kind: ReactionKind,
): Promise<WallResult> {
  if (kind !== "like" && kind !== "dislike") return fail(400, "react with a like or a dislike");
  const me = norm(actor);
  const refused = interactionRefusal(me, owner);
  if (refused) return refused;
  if (!readPost(me, owner, postId)) return GONE;

  const outcome = withStoreLock(lockName(owner), (): WallPost | null => {
    const post = readPostFile(owner, postId);
    if (!post) return null;
    const next: WallPost = { ...post, reactions: toggleReaction(post.reactions, me, kind) };
    writeJsonAtomic(postFile(owner, postId), next);
    return next;
  });
  if (!outcome) return GONE;

  // Reactions do not move the index (order and visibility are unchanged) and
  // they move the document by a username's worth of bytes, which the ledger
  // does not need to hear about. Journaled, though — moderation reads it.
  await journal("edit", postFile(owner, postId), `AmberX Vid: ${actor} reacted (${kind}) on ${owner}'s wall`);
  return { ok: true, post: outcome };
}

/* ---------------------------------- comments -------------------------------------- */

/**
 * Comment on a post, or reply to a comment — ONE level deep. The cap, the
 * parent lookup and the refusal to nest a reply under a reply are
 * {@link appendComment}'s, shared with the album store; this file's job is the
 * post document, the lock and the byte charge.
 */
export async function comment(
  actor: string,
  owner: string,
  postId: string,
  text: string,
  replyTo: string | null = null,
): Promise<WallResult> {
  const me = norm(actor);
  const refused = interactionRefusal(me, owner);
  if (refused) return refused;
  if (!readPost(me, owner, postId)) return GONE;

  const may = await assertCanComment(actor);
  if (!may.ok) return fail(may.status, may.error);

  const checked = checkCommentText(text);
  if (isRefusal(checked)) return fail(checked.status, checked.error);

  const entry: WallComment = {
    id: newCommentId(),
    author: me,
    text: checked.clean,
    createdAt: new Date().toISOString(),
    replyTo: null,
  };

  const before = fileBytes(postFile(owner, postId));
  const outcome = withStoreLock(
    lockName(owner),
    (): WallPost | SocialRefusal | null => {
      const post = readPostFile(owner, postId);
      if (!post) return null;
      const folded = appendComment(post.comments, entry, replyTo, "this post");
      if (isRefusal(folded)) return folded;
      const next: WallPost = { ...post, comments: folded.comments };
      writeJsonAtomic(postFile(owner, postId), next);
      return next;
    },
  );
  if (!outcome) return GONE;
  if (isRefusal(outcome)) return fail(outcome.status, outcome.error);

  await chargeVault(owner, "wall", fileBytes(postFile(owner, postId)) - before, "wall comment added");
  await journal(
    "edit",
    postFile(owner, postId),
    `AmberX Vid: ${actor} ${replyTo ? "replied to a comment" : "commented"} on ${owner}'s wall`,
  );
  return { ok: true, post: outcome };
}

/** `comment(...)` with the parent named — the reply half, spelled out so a
 *  caller cannot forget which argument the parent is. */
export const reply = (
  actor: string,
  owner: string,
  postId: string,
  parentId: string,
  text: string,
): Promise<WallResult> => comment(actor, owner, postId, text, parentId);

/**
 * Remove a comment — its author, the wall's owner, or a moderator.
 *
 * Deleting a top-level comment takes its replies with it: a reply whose parent
 * is gone is an orphan the one-level model has nowhere to draw.
 */
export async function deleteComment(
  actor: string,
  owner: string,
  postId: string,
  commentId: string,
): Promise<WallResult> {
  const me = norm(actor);
  const refused = interactionRefusal(me, owner);
  if (refused) return refused;
  const visible = readPost(me, owner, postId);
  if (!visible) return GONE;
  const target = visible.comments.find((c) => c.id === commentId);
  if (!target) return fail(404, "no such comment");

  if (!(await mayDeleteComment(actor, owner, target))) {
    return fail(403, "only the commenter, the wall's owner or a moderator may delete that");
  }

  const before = fileBytes(postFile(owner, postId));
  const outcome = withStoreLock(lockName(owner), (): WallPost | null => {
    const post = readPostFile(owner, postId);
    if (!post) return null;
    const next: WallPost = { ...post, comments: withoutComment(post.comments, commentId) };
    writeJsonAtomic(postFile(owner, postId), next);
    return next;
  });
  if (!outcome) return GONE;

  await chargeVault(owner, "wall", fileBytes(postFile(owner, postId)) - before, "wall comment deleted");
  await journal("edit", postFile(owner, postId), `AmberX Vid: ${actor} deleted a comment on ${owner}'s wall`);
  return { ok: true, post: outcome };
}

/* ---------------------------- store integrity (P17) ------------------------------ */

/**
 * What an integrity scan found in ONE member's wall store.
 *
 * The three kinds are the three ways a document store and a byte store can
 * disagree, and each has a different repair:
 *
 * - **`staleIndexRows`** — the index names a post whose document is gone. The
 *   read path already skips these (see {@link hydratePage}), so they are
 *   invisible rather than harmful; they are still worth clearing, because every
 *   feed merge pays for them and a member's post count reads high.
 * - **`danglingMedia`** — a post references an attachment whose bytes are not
 *   on disk. This one IS visible: it renders as a broken image.
 * - **`orphanFiles`** — attachment bytes no post claims. Silent, and the
 *   expensive one: they are charged to the member's quota forever.
 *
 * `young` marks a file inside {@link ORPHAN_MEDIA_MS}, which is a composer
 * still being typed in rather than an orphan — reported so the number adds up,
 * never deleted. That is {@link sweepOrphanWallMedia}'s rule, and the repair
 * below goes through that function precisely so the rule has one home.
 */
export interface WallStoreAudit {
  owner: string;
  staleIndexRows: string[];
  danglingMedia: { postId: string; mediaId: string }[];
  orphanFiles: { file: string; bytes: number; young: boolean }[];
  /** Bytes a repair reclaimed. Zero on a read-only scan. */
  freedBytes: number;
}

const emptyAudit = (owner: string): WallStoreAudit => ({
  owner,
  staleIndexRows: [],
  danglingMedia: [],
  orphanFiles: [],
  freedBytes: 0,
});

/**
 * Read-only integrity scan of one member's wall. Opens every post document —
 * this is the deliberately expensive path the maintenance tab runs on demand,
 * never the read path.
 */
export function auditWall(owner: string): WallStoreAudit {
  const audit = emptyAudit(owner);
  if (!isValidUsername(owner.trim())) return audit;

  for (const entry of wallIndex(owner).posts) {
    const post = readPostFile(owner, entry.id);
    if (!post) {
      audit.staleIndexRows.push(entry.id);
      continue;
    }
    for (const media of post.media) {
      if (!fs.existsSync(wallMediaPathOf(owner, media))) {
        audit.danglingMedia.push({ postId: post.id, mediaId: media.id });
      }
    }
  }

  const dir = vaultWallMediaDir(owner);
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [];
  }
  const claimed = claimedMedia(owner);
  const cutoff = Date.now() - ORPHAN_MEDIA_MS;
  for (const name of names) {
    const id = name.replace(/\.[a-z0-9]+$/i, "");
    if (!isWallMediaId(id) || claimed.has(id)) continue;
    const abs = path.join(dir, name);
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    audit.orphanFiles.push({ file: `wall/${name}`, bytes: stat.size, young: stat.mtimeMs > cutoff });
  }
  return audit;
}

/**
 * The fix pass — same scan, then each finding repaired through the store's own
 * rules.
 *
 * Deliberately NOT a separate implementation of "delete an orphan": the byte
 * half goes through {@link sweepOrphanWallMedia}, which owns the age rule and
 * the quota credit. What is left here is the two DOCUMENT repairs, both under
 * the wall's one lock, both re-reading inside it — a post that vanished between
 * the scan and the fix is a row that repairs itself.
 *
 * Every byte moved is credited back to the member: a repair that silently kept
 * charging for what it deleted would make the ledger drift, which is the exact
 * failure the scan exists to find.
 */
export async function repairWall(owner: string): Promise<WallStoreAudit> {
  const audit = auditWall(owner);
  if (!isValidUsername(owner.trim())) return audit;

  if (audit.staleIndexRows.length > 0) {
    const stale = new Set(audit.staleIndexRows);
    withStoreLock(lockName(owner), () => {
      saveIndexLocked(
        owner,
        indexLocked(owner).posts.filter((e) => !stale.has(e.id) || readPostFile(owner, e.id) !== null),
      );
    });
    await journal(
      "edit",
      indexFile(owner),
      `AmberX Vid maintenance: dropped ${stale.size} stale index row(s) from ${owner}'s wall`,
    );
  }

  const byPost = new Map<string, Set<string>>();
  for (const { postId, mediaId } of audit.danglingMedia) {
    const set = byPost.get(postId) ?? new Set<string>();
    set.add(mediaId);
    byPost.set(postId, set);
  }
  for (const [postId, missing] of byPost) {
    const before = fileBytes(postFile(owner, postId));
    const done = withStoreLock(lockName(owner), (): boolean => {
      const post = readPostFile(owner, postId);
      if (!post) return false;
      const next: WallPost = { ...post, media: post.media.filter((m) => !missing.has(m.id)) };
      writeJsonAtomic(postFile(owner, postId), next);
      saveIndexLocked(owner, [
        ...indexLocked(owner).posts.filter((e) => e.id !== postId),
        entryOf(next),
      ]);
      return true;
    });
    if (!done) continue;
    await chargeVault(
      owner,
      "wall",
      fileBytes(postFile(owner, postId)) - before,
      "wall post repaired (attachment references with no bytes)",
    );
    await journal(
      "edit",
      postFile(owner, postId),
      `AmberX Vid maintenance: dropped ${missing.size} dangling attachment ref(s) from ${owner}'s post ${postId}`,
    );
  }

  audit.freedBytes = await sweepOrphanWallMedia(owner);
  return audit;
}
