"use client";

/**
 * @file **The social rail — ONE comment system, TWO subjects, on screen too**
 * (P10 of `axf-amberxvid-social`, 2026-08-15).
 *
 * `lib/social.ts` made the wall's reactions and comments a shared engine that
 * both the wall store and the album store call. This is the other half of that
 * sentence: the reaction buttons, the one-level thread, the reply box and the
 * composer are drawn ONCE and mounted by both surfaces — `Wall.tsx`'s post card
 * and `Albums.tsx`'s lightbox. P9 wrote them inside the post card, correctly,
 * because there was one subject; the moment album items got the same rail the
 * choice was to copy the markup or to move it, and a copied thread is two places
 * for "delete takes its replies with it" to be true in only one.
 *
 * ## What the components take, and what they refuse to know
 *
 * They take a **subject id, a slug and callbacks**, never a post or an album.
 * That is deliberate: the rail must not learn what it is attached to, or it
 * grows a `kind` prop and then a branch per kind, which is a copy again with
 * extra steps. The slug is what keeps the `data-el-id`s honest per surface —
 * `amberxvid:wall:comment-box:<postId>` and
 * `amberxvid:albums:comment-box:<photoId>` are the same control on two
 * surfaces, and automation addresses each by its own name.
 *
 * Every callback answers `Promise<boolean>`: **the caller's store answer is what
 * clears a draft**, never an optimistic guess. A comment the store refused
 * leaves the member's text exactly where they typed it.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Chat as CommentIcon } from "./kit/icons";
import { Favorite as LikeIcon } from "./kit/icons";
import { SubdirectoryArrowRight as ReplyIcon } from "./kit/icons";
// The pack is a brand vocabulary, not a Material clone — there is no thumb
// glyph, so a dislike is the down-chevron beside the sparkle a like is.
import { ArrowDownward as DislikeIcon } from "./kit/icons";
import { GX } from "./kit/gx";
import AvatarView from "./Avatar";
import {
  SOCIAL_COMMENTS_MAX,
  SOCIAL_COMMENT_MAX,
  type AvatarValue,
  type SocialComment,
  type SocialReactions,
} from "./lib/types";

/* ---------------------------------- contracts ----------------------------------- */

/**
 * How a social surface turns a username into a face and a name. Every surface
 * that mounts a rail already holds this (the messenger engine's roster and
 * profile map), so nothing here fetches identity of its own — a second copy of
 * who somebody is, refreshed on a different clock, is the drift the accounts
 * profile engine was built to end.
 */
export interface SocialIdentity {
  screennameFor: (user: string) => string;
  avatarOf: (user: string) => AvatarValue;
  /** Clicking a name opens that member's profile, where one exists to open. */
  onOpenProfile?: (user: string) => void;
}

export const lower = (u: string): string => u.trim().toLowerCase();

/** Relative for the recent past, absolute once "3 days ago" stops helping. */
export function fmtWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Comments arrive flat with a `replyTo`; exactly one level, so this is a
 *  group-by and never a recursion. */
export function threadComments(
  comments: SocialComment[],
): { top: SocialComment; replies: SocialComment[] }[] {
  const tops = comments.filter((c) => !c.replyTo);
  const byParent = new Map<string, SocialComment[]>();
  for (const c of comments) {
    if (!c.replyTo) continue;
    const bucket = byParent.get(c.replyTo);
    if (bucket) bucket.push(c);
    else byParent.set(c.replyTo, [c]);
  }
  return tops.map((top) => ({ top, replies: byParent.get(top.id) ?? [] }));
}

/* -------------------------------- the reactions ---------------------------------- */

export interface ReactionBarProps {
  reactions: SocialReactions;
  me: string;
  identity: SocialIdentity;
  /** `amberxvid:wall` or `amberxvid:albums` — the `data-el-id` namespace. */
  slug: string;
  /** The post or photo id the controls are addressed by. */
  subjectId: string;
  busy?: boolean;
  onReact: (kind: "like" | "dislike") => void;
  /** Omit the comment toggle where comments are always on screen (the album
   *  lightbox draws its rail open). */
  comments?: { count: number; open: boolean; onToggle: () => void };
}

/**
 * Like, dislike and the comment toggle.
 *
 * The counts render from `length` with nothing to reconcile, which is only safe
 * because the store's toggle is exclusive — see `lib/social.ts`, rule 3.
 */
export function ReactionBar({
  reactions,
  me,
  identity,
  slug,
  subjectId,
  busy = false,
  onReact,
  comments,
}: ReactionBarProps) {
  const liked = reactions.likes.some((u) => lower(u) === lower(me));
  const disliked = reactions.dislikes.some((u) => lower(u) === lower(me));
  const names = (list: string[]): string =>
    list.map((u) => identity.screennameFor(u)).join(", ") || "Nobody yet";

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
      <Tooltip title={names(reactions.likes)}>
        <span>
          <Button
            size="small"
            variant={liked ? "contained" : "text"}
            startIcon={<LikeIcon sx={{ fontSize: 14 }} />}
            disabled={busy}
            onClick={() => onReact("like")}
            data-el-id={`${slug}:like:${subjectId}`}
            sx={{ fontSize: 11.5, py: 0.25 }}
          >
            {reactions.likes.length}
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={names(reactions.dislikes)}>
        <span>
          <Button
            size="small"
            variant={disliked ? "contained" : "text"}
            color={disliked ? "error" : "primary"}
            startIcon={<DislikeIcon sx={{ fontSize: 14 }} />}
            disabled={busy}
            onClick={() => onReact("dislike")}
            data-el-id={`${slug}:dislike:${subjectId}`}
            sx={{ fontSize: 11.5, py: 0.25 }}
          >
            {reactions.dislikes.length}
          </Button>
        </span>
      </Tooltip>
      {comments && (
        <Button
          size="small"
          variant="text"
          startIcon={<CommentIcon sx={{ fontSize: 14 }} />}
          onClick={comments.onToggle}
          data-el-id={`${slug}:comments:${subjectId}`}
          sx={{ fontSize: 11.5, py: 0.25 }}
        >
          {comments.count === 0
            ? "Comment"
            : `${comments.count} comment${comments.count === 1 ? "" : "s"}`}
        </Button>
      )}
    </Box>
  );
}

/* --------------------------------- the thread ------------------------------------ */

export interface CommentThreadProps {
  comments: SocialComment[];
  me: string;
  identity: SocialIdentity;
  /** The owner or a moderator may delete anybody's comment here. */
  mayModerate: boolean;
  slug: string;
  subjectId: string;
  busy?: boolean;
  /** `true` means the store accepted it — that is what clears the box. */
  onComment: (text: string, replyTo: string | null) => Promise<boolean>;
  onDeleteComment: (commentId: string) => void;
  /** Named in the "thread is full" line: "post", "photo". */
  subjectWord?: string;
}

/**
 * The one-level thread and its composer.
 *
 * A reply answers a top-level comment and nothing answers a reply — the model's
 * own rule, which is why there is no Reply affordance on a reply and no
 * recursion in this component.
 */
export function CommentThread({
  comments,
  me,
  identity,
  mayModerate,
  slug,
  subjectId,
  busy = false,
  onComment,
  onDeleteComment,
  subjectWord = "post",
}: CommentThreadProps) {
  const [draft, setDraft] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<string | null>(null);
  const [replyDraft, setReplyDraft] = React.useState("");

  const threads = React.useMemo(() => threadComments(comments), [comments]);
  const full = comments.length >= SOCIAL_COMMENTS_MAX;

  const send = React.useCallback(
    async (text: string, parent: string | null) => {
      if (!text.trim()) return;
      const ok = await onComment(text, parent);
      if (!ok) return;
      if (parent) {
        setReplyDraft("");
        setReplyTo(null);
      } else {
        setDraft("");
      }
    },
    [onComment],
  );

  const row = (c: SocialComment, isReply: boolean) => {
    const canDelete = lower(c.author) === lower(me) || mayModerate;
    return (
      <Box
        key={c.id}
        data-el-id={`${slug}:comment:${c.id}`}
        sx={{ display: "flex", gap: 1, pl: isReply ? 3.5 : 0, minWidth: 0 }}
      >
        {isReply && <ReplyIcon sx={{ fontSize: 14, color: GX.dim, mt: 0.4, flexShrink: 0 }} />}
        <AvatarView
          spec={identity.avatarOf(c.author)}
          name={identity.screennameFor(c.author)}
          size={isReply ? 20 : 24}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, flexWrap: "wrap" }}>
            <Typography
              onClick={() => identity.onOpenProfile?.(c.author)}
              sx={{
                fontSize: 11.5,
                fontWeight: 700,
                cursor: identity.onOpenProfile ? "pointer" : "default",
                "&:hover": identity.onOpenProfile ? { color: GX.accent } : undefined,
              }}
            >
              {identity.screennameFor(c.author)}
            </Typography>
            <Typography sx={{ fontSize: 10, color: GX.dim }}>{fmtWhen(c.createdAt)}</Typography>
            {c.editedAt && <Typography sx={{ fontSize: 10, color: GX.dim }}>· edited</Typography>}
          </Box>
          <Typography sx={{ fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {c.text}
          </Typography>
          <Box sx={{ display: "flex", gap: 1.5, mt: 0.25 }}>
            {!isReply && (
              <Typography
                onClick={() => {
                  setReplyTo(replyTo === c.id ? null : c.id);
                  setReplyDraft("");
                }}
                sx={{ fontSize: 10.5, color: GX.dim, cursor: "pointer", "&:hover": { color: GX.accent } }}
              >
                Reply
              </Typography>
            )}
            {canDelete && (
              <Typography
                onClick={() => onDeleteComment(c.id)}
                sx={{ fontSize: 10.5, color: GX.dim, cursor: "pointer", "&:hover": { color: GX.err } }}
              >
                Delete
              </Typography>
            )}
          </Box>
          {replyTo === c.id && (
            <Box sx={{ display: "flex", gap: 0.75, mt: 0.75 }}>
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value.slice(0, SOCIAL_COMMENT_MAX))}
                placeholder={`Reply to ${identity.screennameFor(c.author)}…`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(replyDraft, c.id);
                  }
                }}
                sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
              />
              <Button
                size="small"
                variant="contained"
                disabled={!replyDraft.trim() || busy}
                onClick={() => void send(replyDraft, c.id)}
              >
                Reply
              </Button>
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, pt: 0.5, minWidth: 0 }}>
      {threads.map(({ top, replies }) => (
        <Box key={top.id} sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          {row(top, false)}
          {replies.map((r) => row(r, true))}
        </Box>
      ))}
      {full ? (
        <Typography sx={{ fontSize: 11, color: GX.warn }}>
          This thread is full at {SOCIAL_COMMENTS_MAX} comments — start a {subjectWord} instead.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", gap: 0.75, alignItems: "flex-start" }}>
          <AvatarView spec={identity.avatarOf(me)} name={identity.screennameFor(me)} size={24} />
          <TextField
            fullWidth
            size="small"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, SOCIAL_COMMENT_MAX))}
            placeholder="Write a comment…"
            data-el-id={`${slug}:comment-box:${subjectId}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft, null);
              }
            }}
            sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
          />
          <Button
            size="small"
            variant="contained"
            disabled={!draft.trim() || busy}
            onClick={() => void send(draft, null)}
          >
            Send
          </Button>
        </Box>
      )}
    </Box>
  );
}
