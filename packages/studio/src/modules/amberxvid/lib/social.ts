/**
 * @file **ONE COMMENT SYSTEM, TWO SUBJECTS** — the viewer tiers, the visibility
 * filter, the reaction toggle and the one-level comment thread that the WALL
 * (P8) and the ALBUM ITEM (P10) both run on, in one file.
 *
 * P8 wrote all of this inside `./wall.ts`, correctly: there was one subject, so
 * there was one place. P10 gave album items reactions and comments, and at that
 * moment the choice was to copy the rules or to move them. Copying would have
 * meant two `interactionRefusal`s to keep in step with
 * `accounts/lib/relations.ts`, two exclusivity rules for likes/dislikes, and two
 * chances to get the silence wrong — and the silence is the part where a bug is
 * invisible until somebody discovers they can probe a block. So the machinery
 * moved here, `./wall.ts` calls it, `./albums.ts` calls it, and there is exactly
 * one implementation of every rule below.
 *
 * **What lives here:** everything that is true of a SUBJECT (something people
 * react to and comment on) regardless of what the subject is.
 * **What does not:** anything about a post document, an album manifest, a vault
 * path, a quota charge or a journal line. Those are the stores' own, and the
 * split is what keeps this file free of node imports beyond the two accounts
 * lookups it delegates identity to.
 *
 * ## The three rules a caller must not re-derive
 *
 * **1. A refusal is byte-identical to an absence.** {@link interactionRefusal}
 * renders a BLOCK as the caller's own "no such thing" answer, and a viewer who
 * simply is not a buddy sees a subject the same way a stranger does. That is
 * rule 1 of the relations header: a probe that can tell "hidden from you" from
 * "never existed" has defeated the silence. The caller passes the sentence its
 * surface uses for absence, and both paths return exactly that object.
 *
 * **2. `buddiesOnly` may say so; a block never may.** The subject's owner set
 * `buddiesOnly` themselves and is entitled to have it explained; a block is the
 * one thing that must never be admitted. {@link interactionRefusal} is where
 * that distinction is made, once.
 *
 * **3. Reactions are exclusive AND toggling.** {@link toggleReaction} moves a
 * member between the two lists in one expression, so exclusivity cannot be half
 * applied by a later edit — which is what lets every counter be rendered from
 * `length` with nothing to reconcile.
 *
 * Server-only (it reaches the accounts stores), but node-free itself.
 */

import { canInteract, relationsFor } from "@axs/modules/accounts/lib/relations";
import { findAccount } from "./accounts";
import {
  SOCIAL_COMMENTS_MAX,
  SOCIAL_COMMENT_MAX,
  type SocialComment,
  type SocialReactions,
  type SocialVisibility,
} from "./types";

/** Lowercased and trimmed — the one normalisation every username goes through
 *  before it is compared or stored in a reaction list. */
export const norm = (u: string): string => u.trim().toLowerCase();

/* ---------------------------------- refusals ------------------------------------ */

/** What a store answers with when something is refused: a sentence and a code. */
export interface SocialRefusal {
  error: string;
  status: number;
}

/* ------------------------------- ids + normalising ------------------------------- */

/**
 * The id shape every social document uses: `<prefix>-<YYYYMMDD>-<HHMMSS>-<hex6>`.
 *
 * Sortable by construction and unique in practice, and — because the stamp is
 * local time in the same form the album and wall stores already minted — a file
 * listing reads chronologically without opening anything.
 */
export function newSocialId(prefix: string): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Array.from({ length: 6 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  return `${prefix}-${stamp}-${rand}`;
}

/**
 * Comment ids keep the `wc-` prefix on BOTH subjects.
 *
 * It reads as "wall comment" and it is now also an album item's — which is the
 * honest cost of unifying after the fact. The alternative was minting a second
 * prefix and teaching every reader both, or rewriting the id of every comment
 * already on disk. One prefix for one system is the cheaper truth; the letters
 * are historical, the system is not.
 */
const COMMENT_ID_RE = /^wc-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;

export const isCommentId = (id: string): boolean => COMMENT_ID_RE.test(id);

export const newCommentId = (): string => newSocialId("wc");

/** Normalize one stored comment, or drop it. Junk is dropped rather than
 *  trusted — a hand-edited document is repaired on read, never obeyed. */
export function normalizeComment(raw: unknown): SocialComment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isCommentId(r.id)) return null;
  if (typeof r.author !== "string" || typeof r.text !== "string") return null;
  return {
    id: r.id,
    author: r.author,
    text: r.text,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString(),
    ...(typeof r.editedAt === "string" ? { editedAt: r.editedAt } : {}),
    replyTo: typeof r.replyTo === "string" && isCommentId(r.replyTo) ? r.replyTo : null,
  };
}

/** Every readable comment of a stored list, in order. */
export function normalizeComments(raw: unknown): SocialComment[] {
  return Array.isArray(raw)
    ? raw.map(normalizeComment).filter((c): c is SocialComment => c !== null)
    : [];
}

const normNames = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const key = norm(v);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
};

/**
 * Normalize a stored reaction pair.
 *
 * Exclusivity is re-imposed on the way IN as well as on the way out: a
 * hand-edited file that lists somebody in both becomes one vote, not a subject
 * whose two counters both include them.
 */
export function normalizeReactions(raw: unknown): SocialReactions {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const likes = normNames(r.likes);
  return { likes, dislikes: normNames(r.dislikes).filter((u) => !likes.includes(u)) };
}

export const emptyReactions = (): SocialReactions => ({ likes: [], dislikes: [] });

/* --------------------------------- who sees what --------------------------------- */

/**
 * How much of `owner`'s material `viewer` may see.
 *
 * Three tiers, and the collapse of every refusal into `stranger` is the point:
 * a blocked viewer and a member who simply has not been added are the same
 * tier, and neither can tell which they are.
 */
export type ViewerLevel = "self" | "buddy" | "stranger";

export function viewerLevel(viewer: string, owner: string): ViewerLevel {
  const v = norm(viewer);
  const o = norm(owner);
  if (!v || !o) return "stranger";
  if (v === o) return "self";
  // THE one guard — no surface in this module keeps its own idea of who may
  // see whom.
  if (!canInteract(v, o).ok) return "stranger";
  return relationsFor(o).buddies.includes(v) ? "buddy" : "stranger";
}

/** May this tier see something of this visibility? */
export function visibleTo(level: ViewerLevel, visibility: SocialVisibility): boolean {
  if (level === "self") return true;
  if (visibility === "public") return true;
  return level === "buddy" && visibility === "buddies";
}

/** The buddies of `viewer`, as the feed merge and the album shelf both want
 *  them: normalised, and never including the viewer themselves. */
export function buddiesOf(viewer: string): string[] {
  const me = norm(viewer);
  if (!me) return [];
  return relationsFor(me).buddies.filter((b) => b !== me);
}

/**
 * May `actor` ACT on `owner`'s material — react, comment, reply? `null` means
 * yes; otherwise the refusal to answer with, verbatim.
 *
 * Seeing and touching are two questions, and collapsing them is a defect the P8
 * test caught: a stranger's view of a public post is the whole point of a public
 * post, but a member who has been BLOCKED must not be able to like or comment on
 * one. Reads therefore go through {@link viewerLevel} (which degrades a refusal
 * into "stranger") and every mutation goes through here (which refuses outright).
 *
 * `gone` is the caller's own absence answer — "no such post" for a wall, "no
 * such photo" for an album item — and a block is rendered AS it, byte for byte.
 */
export function interactionRefusal(
  actor: string,
  owner: string,
  gone: SocialRefusal,
): SocialRefusal | null {
  const a = norm(actor);
  const o = norm(owner);
  if (!a) return { status: 401, error: "sign in first" };
  if (!o) return gone;
  if (a === o) return null;
  const verdict = canInteract(a, o);
  if (verdict.ok) return null;
  if (verdict.reason === "blocked") return gone;
  return { status: 403, error: "that member takes reactions and comments from their buddies only" };
}

/**
 * A MODERATOR is a studio administrator, today.
 *
 * P17 builds the amberxvid moderation wing inside the accounts admin suite, and
 * this is the one function it changes: the wing's moderator role is answered
 * here and every "author or moderator" check in the module follows it, with no
 * second copy of the rule to find. The entry-flow condition matches
 * `resolveActor`'s, so an administrator who has not finished their own entry
 * cannot moderate anybody.
 */
export async function isModerator(user: string): Promise<boolean> {
  const account = await findAccount(user);
  return (
    account !== null &&
    account.disabled !== true &&
    account.role === "administrator" &&
    !account.mustChangePassword &&
    account.screenname !== null
  );
}

/* --------------------------------- reactions ------------------------------------- */

export type ReactionKind = "like" | "dislike";

export const isReactionKind = (kind: string): kind is ReactionKind =>
  kind === "like" || kind === "dislike";

/**
 * Like or dislike, TOGGLING and mutually exclusive: reacting the same way twice
 * removes the reaction, and reacting the other way moves it. One member appears
 * in at most one of the two lists, always.
 *
 * Both halves are in one expression on purpose — see rule 3 in the header.
 */
export function toggleReaction(
  reactions: SocialReactions,
  actor: string,
  kind: ReactionKind,
): SocialReactions {
  const me = norm(actor);
  const mine = kind === "like" ? reactions.likes : reactions.dislikes;
  const other = kind === "like" ? reactions.dislikes : reactions.likes;
  const nextMine = mine.includes(me) ? mine.filter((u) => u !== me) : [...mine, me];
  const nextOther = other.filter((u) => u !== me);
  return kind === "like"
    ? { likes: nextMine, dislikes: nextOther }
    : { likes: nextOther, dislikes: nextMine };
}

/* ---------------------------------- comments ------------------------------------- */

/** The text checks a comment must pass before anything is opened for writing. */
export function checkCommentText(text: unknown): { clean: string } | SocialRefusal {
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) return { status: 400, error: "a comment cannot be empty" };
  if (clean.length > SOCIAL_COMMENT_MAX) {
    return { status: 400, error: `a comment is capped at ${SOCIAL_COMMENT_MAX} characters` };
  }
  return { clean };
}

export const isRefusal = (v: unknown): v is SocialRefusal =>
  typeof v === "object" && v !== null && "error" in v && "status" in v;

/**
 * Fold one comment into a subject's thread — the cap, the one-level rule and
 * the parent lookup, in the one place both stores call.
 *
 * A reply to a reply is REFUSED rather than silently flattened, because a
 * client that thought it was nesting would draw a thread the store does not
 * have. `whatIsFull` names the subject in the cap's sentence ("this post",
 * "this photo") — the only thing about this function that differs per subject.
 */
export function appendComment(
  comments: SocialComment[],
  entry: SocialComment,
  replyTo: string | null,
  whatIsFull: string,
): { comments: SocialComment[] } | SocialRefusal {
  if (comments.length >= SOCIAL_COMMENTS_MAX) {
    return { status: 409, error: `${whatIsFull} is at its ${SOCIAL_COMMENTS_MAX}-comment limit` };
  }
  let parentId: string | null = null;
  if (replyTo !== null) {
    const parent = comments.find((c) => c.id === replyTo);
    if (!parent) return { status: 404, error: "no such comment" };
    if (parent.replyTo !== null) {
      return { status: 400, error: "replies go one level deep — reply to the comment instead" };
    }
    parentId = parent.id;
  }
  return { comments: [...comments, { ...entry, replyTo: parentId }] };
}

/**
 * Remove a comment and, when it is a top-level one, its replies with it — a
 * reply whose parent is gone is an orphan the one-level model has nowhere to
 * draw.
 */
export function withoutComment(comments: SocialComment[], commentId: string): SocialComment[] {
  return comments.filter((c) => c.id !== commentId && c.replyTo !== commentId);
}

/**
 * May `actor` delete this comment? The commenter, the material's owner, or a
 * moderator — the same three everywhere, asked once.
 */
export async function mayDeleteComment(
  actor: string,
  owner: string,
  comment: SocialComment,
): Promise<boolean> {
  const me = norm(actor);
  return norm(comment.author) === me || norm(owner) === me || (await isModerator(actor));
}
