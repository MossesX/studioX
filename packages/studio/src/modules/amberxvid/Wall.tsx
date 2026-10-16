"use client";

/**
 * @file **The wall** — the composer, the post card, the reactions and the
 * one-level comment thread, drawn over P8's store (P9 of
 * `axf-amberxvid-social`, 2026-08-15).
 *
 * One component tree, two mount points: a member's profile mounts {@link Wall}
 * for one owner, and the feed mounts {@link PostCard} over a merged page. That
 * is why the card takes its `owner` as a prop rather than reading it from the
 * post — a feed item comes from somebody else's vault and every media URL,
 * every mutation and every link needs the wall it came from, which only the
 * page's `owners` map knows.
 *
 * ## What this surface refuses to guess
 *
 * **1. Visibility is stated in words, once.** The selector carries the three
 * values and ONE line of meaning underneath it — not a tooltip per option, and
 * not a repeat on every post. A member choosing who sees something is entitled
 * to read what the choice does; a member who has already read it is not helped
 * by reading it again on the next post.
 *
 * **2. Blocked-viewer behaviour gets NO hint.** A post that is not for you is
 * simply absent, and a refused reaction returns the store's "no such post" —
 * which this file renders as the post being gone, exactly as it would for one
 * that never existed. There is deliberately no "you can't see this" state, no
 * greyed placeholder and no count that hints at hidden items: `wall.ts`'s
 * decision (2) is that the silence must be indistinguishable, and a UI hint is
 * the one thing that can undo it.
 *
 * **3. The composer appears where a post would actually land.** The store's
 * gate is `resolveActor` — owner-or-administrator — so those are the two cases
 * that get a composer. The phase's "buddies with permission" resolves to
 * exactly that today: a buddy composing on somebody else's wall would be
 * refused by the store, and a button that offers a refused action is the
 * lying button rule (4) exists to forbid. Widen this when the store widens,
 * not before.
 *
 * **4. Every failure shows the route's own sentence.** The store writes refusal
 * lines that are careful about what they admit (a policy switch says so, a
 * block never does); rewording them here would either leak what they withhold
 * or bury what they explain.
 *
 * Menus are declared as DATA on the module decl (P16), so the per-post actions
 * here are an MUI overflow menu — a real control on the card, not a hand-rolled
 * `onContextMenu` the area walk cannot see.
 *
 * ## Since P10: the rail is shared, not the wall's
 *
 * The reaction buttons and the one-level comment thread moved to
 * `./SocialRail.tsx` when album items became the second subject that has them —
 * one comment system, two subjects, on screen as well as in the store
 * (`lib/social.ts`). Every rule above still holds; the markup that expresses
 * them is mounted rather than repeated, and the `data-el-id`s are unchanged
 * because the rail namespaces them by the slug this file passes it.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Menu from "@mui/material/Menu";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { AddPhotoAlternate as MediaIcon } from "./kit/icons";
import { Close as RemoveIcon } from "./kit/icons";
import { MoreVert as MoreIcon } from "./kit/icons";
import { Public as PublicIcon } from "./kit/icons";
import { Refresh as RefreshIcon } from "./kit/icons";
import { Send as SendIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip } from "./kit/ax";
import { useToast } from "./kit/Toast";
import AvatarView from "./Avatar";
import { useAnimationIntensity } from "./Splash";
import { WallComposerActions } from "./PointSlots";
import {
  CommentThread,
  ReactionBar,
  fmtWhen,
  lower,
  type SocialIdentity,
} from "./SocialRail";
import {
  WALL_MEDIA_PER_POST_MAX,
  WALL_TEXT_MAX,
  type WallMedia,
  type WallPost,
  type WallVisibility,
} from "./lib/types";
import {
  commentOnPost,
  createPost,
  deleteComment,
  deletePost,
  editPost,
  loadWall,
  reactToPost,
  uploadWallMedia,
  wallMediaUrl,
  type WallPage,
} from "./lib/wallClient";
import { axvPlatform, useAxvSubject } from "./ctxBridge";
import { useAmberxvidPrefs } from "./settings";

/* ---------------------------------- contracts ----------------------------------- */

/**
 * How a social surface turns a username into a face and a name.
 *
 * It is `SocialIdentity` (`./SocialRail`) — the wall and the photo surface pass
 * the SAME object, because they draw the same faces from the same roster. The
 * P9 name is kept as an alias so every call site that learned it keeps working.
 */
export type WallIdentity = SocialIdentity;

/** The three values, and the ONE place their meaning is written. */
export const VISIBILITY_MEANING: Record<WallVisibility, string> = {
  public: "every member of the studio",
  buddies: "your buddies only",
  private: "nobody but you",
};

const VISIBILITY_KIND: Record<WallVisibility, string> = {
  public: "info",
  buddies: "accent",
  private: "dim",
};

/* ------------------------------ visibility selector ------------------------------ */

export function VisibilityPicker({
  value,
  onChange,
  disabled = false,
  /** Draw the meaning line under the control — the composer does, the inline
   *  post editor does not (it is the same three words, one card lower). */
  explain = true,
}: {
  value: WallVisibility;
  onChange: (next: WallVisibility) => void;
  disabled?: boolean;
  explain?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <PublicIcon sx={{ fontSize: 15, color: GX.dim }} />
        <Select
          size="small"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as WallVisibility)}
          data-el-id="amberxvid:wall:visibility"
          sx={{ fontSize: 12, minWidth: 118, "& .MuiSelect-select": { py: 0.5 } }}
        >
          <MenuItem value="public" sx={{ fontSize: 12 }}>Public</MenuItem>
          <MenuItem value="buddies" sx={{ fontSize: 12 }}>Buddies</MenuItem>
          <MenuItem value="private" sx={{ fontSize: 12 }}>Private</MenuItem>
        </Select>
      </Box>
      {explain && (
        <Typography sx={{ fontSize: 10.5, color: GX.dim, pl: 2.75 }}>
          Visible to {VISIBILITY_MEANING[value]}.
        </Typography>
      )}
    </Box>
  );
}

/* -------------------------------- the composer ---------------------------------- */

export interface WallComposerProps {
  /** Whose wall the post lands on. */
  owner: string;
  me: string;
  identity: WallIdentity;
  onPosted: (post: WallPost) => void;
  /** Shown above the field — "What's new?" on your own, named on another's. */
  placeholder?: string;
}

/**
 * Text, attachments and a visibility choice.
 *
 * Bytes go up FIRST and the post names their ids (`wallClient`, note 2), so a
 * rejected image never takes a written paragraph with it — the rejection lands
 * as its own line and the text stays in the box.
 */
export function WallComposer({ owner, me, identity, onPosted, placeholder }: WallComposerProps) {
  const toast = useToast();
  const [text, setText] = React.useState("");
  const [media, setMedia] = React.useState<WallMedia[]>([]);
  /**
   * P16 — the PRIVACY DEFAULTS group's `defaultPostVisibility`.
   *
   * NOT seeded from the setting with `useState(pref)`, deliberately: the module
   * settings store answers the FIRST render with the declared defaults and the
   * member's real document lands a moment later, so a seed would give everybody
   * "public" no matter what they chose. The effect below follows the setting
   * until the member touches the picker, and never after — a composer that
   * changed its own visibility mid-typing would be worse than a wrong default.
   */
  const defaultVisibility = useAmberxvidPrefs().defaultPostVisibility as WallVisibility;
  const [visibility, setVisibility] = React.useState<WallVisibility>(defaultVisibility);
  const touched = React.useRef(false);
  React.useEffect(() => {
    if (!touched.current) setVisibility(defaultVisibility);
  }, [defaultVisibility]);
  const pickVisibility = React.useCallback((v: WallVisibility) => {
    touched.current = true;
    setVisibility(v);
  }, []);
  const [uploading, setUploading] = React.useState(false);
  const [posting, setPosting] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  const full = media.length >= WALL_MEDIA_PER_POST_MAX;
  const empty = text.trim().length === 0 && media.length === 0;

  const pick = React.useCallback(
    async (files: FileList) => {
      const room = WALL_MEDIA_PER_POST_MAX - media.length;
      const chosen = Array.from(files).slice(0, Math.max(0, room));
      if (chosen.length < files.length) {
        toast(`A post carries at most ${WALL_MEDIA_PER_POST_MAX} attachments`);
      }
      if (chosen.length === 0) return;
      setUploading(true);
      try {
        const result = await uploadWallMedia(owner, chosen);
        if (!result.ok) {
          toast(result.error);
          return;
        }
        setMedia((m) => [...m, ...result.media]);
        for (const bad of result.rejected) toast(`${bad.name}: ${bad.error}`);
      } finally {
        setUploading(false);
      }
    },
    [media.length, owner, toast],
  );

  const submit = React.useCallback(async () => {
    setPosting(true);
    try {
      const result = await createPost(owner, {
        text,
        media: media.map((m) => m.id),
        visibility,
      });
      if (!result.ok) {
        toast(result.error);
        return;
      }
      onPosted(result.post);
      setText("");
      setMedia([]);
      toast(`Posted — visible to ${VISIBILITY_MEANING[visibility]}`);
    } finally {
      setPosting(false);
    }
  }, [media, onPosted, owner, text, toast, visibility]);

  return (
    <Box
      data-el-id="amberxvid:wall:composer"
      sx={{
        display: "flex",
        gap: 1.25,
        p: 1.25,
        borderRadius: 1.5,
        border: `1px solid ${GX.edge}`,
        bgcolor: GX.panel2,
        flexShrink: 0,
      }}
    >
      <AvatarView spec={identity.avatarOf(me)} name={identity.screennameFor(me)} size={36} />
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={10}
          size="small"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, WALL_TEXT_MAX))}
          placeholder={placeholder ?? "What's new?"}
          data-el-id="amberxvid:wall:composer-text"
        />

        {media.length > 0 && (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 0.75 }}>
            {media.map((m) => (
              <Box
                key={m.id}
                sx={{
                  position: "relative",
                  borderRadius: 1,
                  overflow: "hidden",
                  border: `1px solid ${GX.edge}`,
                  aspectRatio: "1 / 1",
                }}
              >
                <Box
                  component="img"
                  src={wallMediaUrl(owner, m.id)}
                  alt="attachment"
                  sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
                <Tooltip title="Remove from this post">
                  <IconButton
                    size="small"
                    onClick={() => setMedia((list) => list.filter((x) => x.id !== m.id))}
                    aria-label="remove attachment"
                    sx={{ position: "absolute", top: 2, right: 2, bgcolor: "#000a", "&:hover": { bgcolor: "#000d" } }}
                  >
                    <RemoveIcon sx={{ fontSize: 13, color: "#fff" }} />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}

        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, flexWrap: "wrap", rowGap: 1 }}>
          {/* Hidden through MUI's own element rather than a raw <input>, the
              same shape the album uploader uses. */}
          <Box
            component="input"
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            sx={{ display: "none" }}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              if (e.target.files?.length) void pick(e.target.files);
              e.target.value = "";
            }}
          />
          <Tooltip title={full ? `${WALL_MEDIA_PER_POST_MAX} attachments is the limit` : "Add photos"}>
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<MediaIcon />}
                disabled={uploading || full}
                onClick={() => fileInput.current?.click()}
                data-el-id="amberxvid:wall:composer-media"
                sx={{ fontSize: 11.5 }}
              >
                {uploading ? "Uploading…" : "Photos"}
              </Button>
            </span>
          </Tooltip>
          <VisibilityPicker value={visibility} onChange={pickVisibility} disabled={posting} />
          {/**
           * P19 — contributed composer actions
           * (`amberxvid.wall-composer-action`). Nothing in the tree contributes
           * one; the slot draws nothing when the registry is empty. The two
           * candidates for a move are argued down in the decl: reporting is an
           * act against an EXISTING post and has no subject here, and Photos
           * would have meant widening `run` into an attachment API for a button
           * that is already in the box.
           *
           * An action may only APPEND to the draft — never attach, never post.
           */}
          <WallComposerActions
            host={{ owner, me, draft: text, notify: toast }}
            onInsert={(extra) =>
              setText((t) => (t ? `${t}\n${extra}` : extra).slice(0, WALL_TEXT_MAX))
            }
            disabled={posting || uploading}
          />
          <Box sx={{ flex: 1, minWidth: 8 }} />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {text.length > WALL_TEXT_MAX - 500 && (
              <Typography sx={{ fontSize: 10.5, color: text.length >= WALL_TEXT_MAX ? GX.err : GX.dim }}>
                {WALL_TEXT_MAX - text.length} left
              </Typography>
            )}
            <Button
              size="small"
              variant="contained"
              startIcon={<SendIcon />}
              disabled={empty || posting || uploading}
              onClick={() => void submit()}
              data-el-id="amberxvid:wall:composer-post"
            >
              {posting ? "Posting…" : "Post"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/* --------------------------------- the post card -------------------------------- */

export interface PostCardProps {
  post: WallPost;
  /** The wall this post came from — a feed item's owner is not its reader. */
  owner: string;
  me: string;
  isAdmin: boolean;
  identity: WallIdentity;
  /** The store rewrote the post — replace it wherever it is held. */
  onChanged: (post: WallPost) => void;
  /** It is gone; drop it from the page. */
  onRemoved: (postId: string) => void;
  /** Feed only: a line naming which wall this came from. */
  showOwner?: boolean;
}

export function PostCard({
  post,
  owner,
  me,
  isAdmin,
  identity,
  onChanged,
  onRemoved,
  showOwner = false,
}: PostCardProps) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const animate = intensity !== "off";

  const [menu, setMenu] = React.useState<HTMLElement | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(post.text);
  const [draftVisibility, setDraftVisibility] = React.useState<WallVisibility>(post.visibility);
  const [lightbox, setLightbox] = React.useState<WallMedia | null>(null);
  const [showComments, setShowComments] = React.useState(false);

  const mine = lower(post.author) === lower(me);
  /** An administrator is the moderator today (`social.ts` `isModerator`), and
   *  moderation is a MUTATION power — delete, never read. */
  const mayModerate = mine || isAdmin;

  /** Every mutation lands here: run it, and let the store's answer — never a
   *  local guess — be what redraws. A 404 means the post is gone for us. */
  const run = React.useCallback(
    async (
      action: () => Promise<{ ok: true; post: WallPost } | { ok: false; error: string }>,
      done?: string,
    ): Promise<boolean> => {
      setBusy(true);
      try {
        const result = await action();
        if (!result.ok) {
          toast(result.error);
          if (/no such post/i.test(result.error)) onRemoved(post.id);
          return false;
        }
        onChanged(result.post);
        if (done) toast(done);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [onChanged, onRemoved, post.id, toast],
  );

  const saveEdit = React.useCallback(async () => {
    const ok = await run(
      () => editPost(owner, post.id, { text: draft, visibility: draftVisibility }),
      "Post updated",
    );
    if (ok) setEditing(false);
  }, [draft, draftVisibility, owner, post.id, run]);

  const removePost = React.useCallback(async () => {
    setMenu(null);
    setBusy(true);
    try {
      const result = await deletePost(owner, post.id);
      // A delete answers with the post it removed; either way it is gone from
      // this page, and a 404 means somebody beat us to it.
      if (!result.ok && !/no such post/i.test(result.error)) {
        toast(result.error);
        return;
      }
      onRemoved(post.id);
      toast("Post deleted");
    } finally {
      setBusy(false);
    }
  }, [onRemoved, owner, post.id, toast]);

  /**
   * The declared `amberxvid.post` area's behaviour (P15).
   *
   * A card IS one subject, so it registers directly rather than through a
   * resolver. Every row here calls the work this component already does —
   * `run`, `removePost`, `setEditing` — so the menu has no delete of its own and
   * cannot drift from the one behind the ⋮ button.
   *
   * `report` names the SUBJECT and the SHELL opens the composer, because a
   * report needs a reason the reporter types and this card has no dialog to
   * type it in. Since P17 it files into the moderation queue rather than
   * DM-ing the administrators. See `ctxBridge.ts`.
   */
  useAxvSubject("post", post.id, {
    react: () => void run(() => reactToPost(owner, post.id, "like")),
    // Opening the rail is the whole of it: the comment field lives there, and a
    // second field on this card would be a second place for the length limit.
    comment: () => setShowComments(true),
    copyLink: () => {
      void navigator.clipboard.writeText(post.text);
      toast("Post text copied");
    },
    edit: () => {
      setDraft(post.text);
      setDraftVisibility(post.visibility);
      setEditing(true);
    },
    remove: () => void removePost(),
    report: () =>
      axvPlatform()?.report({
        kind: "post",
        owner,
        id: post.id,
        // What the reporter is looking at, carried with the reference: the
        // queue has to survive the author deleting the post, which is the
        // likeliest thing to happen between the report and a moderator opening
        // it (`lib/reports.ts`, decision 1).
        excerpt: post.text.slice(0, 800),
      }),
  });

  /** The rail clears its own draft on a `true` — the store's answer, never an
   *  optimistic guess. */
  const sendComment = React.useCallback(
    async (text: string, parent: string | null): Promise<boolean> => {
      const ok = await run(() => commentOnPost(owner, post.id, text, parent));
      if (ok) setShowComments(true);
      return ok;
    },
    [owner, post.id, run],
  );

  const authorName = identity.screennameFor(post.author);
  const ownerName = identity.screennameFor(owner);

  return (
    <Box
      data-el-id={`amberxvid:wall:post:${post.id}`}
      // The declared `amberxvid.post` area (P15). The AUTHOR is what the
      // ownership predicates read — not the wall's owner, because a post on
      // somebody else's wall is still the author's to edit and delete.
      data-axf-area="amberxvid.post"
      data-axf-post={post.id}
      data-axf-post-author={post.author}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        p: 1.25,
        borderRadius: 1.5,
        border: `1px solid ${GX.edge}`,
        bgcolor: GX.panel,
        opacity: busy ? 0.75 : 1,
        transition: animate ? "opacity 150ms, border-color 150ms" : "none",
        "&:hover": { borderColor: gxa(GX.accent, "33") },
      }}
    >
      {/* header */}
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.25 }}>
        <AvatarView spec={identity.avatarOf(post.author)} name={authorName} size={36} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, flexWrap: "wrap" }}>
            <Typography
              onClick={() => identity.onOpenProfile?.(post.author)}
              sx={{
                fontSize: 13,
                fontWeight: 700,
                cursor: identity.onOpenProfile ? "pointer" : "default",
                "&:hover": identity.onOpenProfile ? { color: GX.accent } : undefined,
              }}
            >
              {authorName}
            </Typography>
            {showOwner && lower(owner) !== lower(post.author) && (
              <Typography sx={{ fontSize: 11, color: GX.dim }}>on {ownerName}&apos;s wall</Typography>
            )}
            <Typography sx={{ fontSize: 10.5, color: GX.dim }}>{fmtWhen(post.createdAt)}</Typography>
            {post.editedAt && <Typography sx={{ fontSize: 10.5, color: GX.dim }}>· edited</Typography>}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25 }}>
            <GxChip label={post.visibility} kind={VISIBILITY_KIND[post.visibility]} />
          </Box>
        </Box>
        {mayModerate && (
          <>
            <IconButton
              size="small"
              onClick={(e) => setMenu(e.currentTarget)}
              aria-label="post actions"
              data-el-id={`amberxvid:wall:post-menu:${post.id}`}
            >
              <MoreIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
              {mine && (
                <MenuItem
                  onClick={() => {
                    setMenu(null);
                    setDraft(post.text);
                    setDraftVisibility(post.visibility);
                    setEditing(true);
                  }}
                >
                  Edit post
                </MenuItem>
              )}
              <MenuItem onClick={() => void removePost()} sx={{ color: GX.err }}>
                {mine ? "Delete post" : "Delete post (moderator)"}
              </MenuItem>
            </Menu>
          </>
        )}
      </Box>

      {/* body */}
      {editing ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={12}
            size="small"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, WALL_TEXT_MAX))}
            data-el-id={`amberxvid:wall:edit:${post.id}`}
          />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <VisibilityPicker value={draftVisibility} onChange={setDraftVisibility} explain={false} />
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="small" variant="contained" disabled={busy} onClick={() => void saveEdit()}>
              Save
            </Button>
          </Box>
        </Box>
      ) : (
        post.text && (
          <Typography sx={{ fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {post.text}
          </Typography>
        )
      )}

      {post.media.length > 0 && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns:
              post.media.length === 1 ? "1fr" : "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 0.75,
          }}
        >
          {post.media.map((m) => (
            <Box
              key={m.id}
              onClick={() => setLightbox(m)}
              sx={{
                borderRadius: 1,
                overflow: "hidden",
                border: `1px solid ${GX.edge}`,
                cursor: "pointer",
                ...(post.media.length === 1 ? { maxHeight: 420 } : { aspectRatio: "1 / 1" }),
                transition: animate ? "transform 150ms" : "none",
                "&:hover": animate ? { transform: "scale(1.01)" } : { borderColor: GX.accent },
              }}
            >
              <Box
                component="img"
                src={wallMediaUrl(owner, m.id)}
                alt="post attachment"
                loading="lazy"
                sx={{
                  width: "100%",
                  height: "100%",
                  objectFit: post.media.length === 1 ? "contain" : "cover",
                  display: "block",
                }}
              />
            </Box>
          ))}
        </Box>
      )}

      <Divider sx={{ borderColor: GX.edge }} />

      {/* reactions + comment toggle — the shared rail (`./SocialRail`) */}
      <ReactionBar
        reactions={post.reactions}
        me={me}
        identity={identity}
        slug="amberxvid:wall"
        subjectId={post.id}
        busy={busy}
        onReact={(kind) => void run(() => reactToPost(owner, post.id, kind))}
        comments={{
          count: post.comments.length,
          open: showComments,
          onToggle: () => setShowComments((s) => !s),
        }}
      />

      {showComments && (
        <CommentThread
          comments={post.comments}
          me={me}
          identity={identity}
          mayModerate={mayModerate}
          slug="amberxvid:wall"
          subjectId={post.id}
          busy={busy}
          onComment={sendComment}
          onDeleteComment={(commentId) =>
            void run(() => deleteComment(owner, post.id, commentId), "Comment deleted")
          }
          subjectWord="post"
        />
      )}

      <Dialog open={lightbox !== null} onClose={() => setLightbox(null)} maxWidth="lg">
        {lightbox && (
          <Box
            component="img"
            src={wallMediaUrl(owner, lightbox.id)}
            alt="post attachment"
            sx={{ maxWidth: "88vw", maxHeight: "84vh", objectFit: "contain", display: "block" }}
          />
        )}
      </Dialog>
    </Box>
  );
}

/* ------------------------------ one member's wall -------------------------------- */

export interface WallProps {
  /** Whose wall. */
  owner: string;
  me: string;
  isAdmin: boolean;
  identity: WallIdentity;
  /** Reload when the outside says the graph or the member moved. */
  refreshTick?: number;
}

type WallState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; page: WallPage };

/**
 * A member's wall: the composer where one belongs, then the posts.
 *
 * A wall the viewer may see nothing of is EMPTY, never "restricted" — see the
 * file header, point 2. The empty line says the wall has nothing on it, which
 * is exactly what a stranger's view of a private wall is, and says nothing
 * about whether more exists.
 */
export default function Wall({ owner, me, isAdmin, identity, refreshTick = 0 }: WallProps) {
  const [state, setState] = React.useState<WallState>({ kind: "loading" });
  const [more, setMore] = React.useState(false);

  const mine = lower(owner) === lower(me);
  // The store's gate is owner-or-administrator (header, point 3).
  const mayCompose = mine || isAdmin;

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    const result = await loadWall(owner);
    setState(result.ok ? { kind: "ready", page: result.page } : { kind: "error", message: result.error });
  }, [owner]);

  React.useEffect(() => {
    void load();
  }, [load, refreshTick]);

  const loadMore = React.useCallback(async () => {
    if (state.kind !== "ready" || !state.page.nextCursor) return;
    setMore(true);
    try {
      const result = await loadWall(owner, state.page.nextCursor);
      if (!result.ok) return;
      setState((s) =>
        s.kind === "ready"
          ? {
              kind: "ready",
              page: {
                posts: [...s.page.posts, ...result.page.posts],
                nextCursor: result.page.nextCursor,
                owners: { ...s.page.owners, ...result.page.owners },
              },
            }
          : s,
      );
    } finally {
      setMore(false);
    }
  }, [owner, state]);

  const patch = React.useCallback((post: WallPost) => {
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", page: { ...s.page, posts: s.page.posts.map((p) => (p.id === post.id ? post : p)) } }
        : s,
    );
  }, []);

  const drop = React.useCallback((postId: string) => {
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", page: { ...s.page, posts: s.page.posts.filter((p) => p.id !== postId) } }
        : s,
    );
  }, []);

  const prepend = React.useCallback((post: WallPost) => {
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", page: { ...s.page, posts: [post, ...s.page.posts] } }
        : s,
    );
  }, []);

  const composer = mayCompose ? (
    <WallComposer
      owner={owner}
      me={me}
      identity={identity}
      onPosted={prepend}
      placeholder={mine ? "What's new?" : `Post to ${identity.screennameFor(owner)}'s wall…`}
    />
  ) : null;

  if (state.kind === "loading") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, minWidth: 0 }}>
        {composer}
        <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
          <CircularProgress size={20} />
        </Box>
      </Box>
    );
  }

  if (state.kind === "error") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, minWidth: 0 }}>
        {composer}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 2 }}>
          <Typography sx={{ fontSize: 12.5, color: GX.err }}>{state.message}</Typography>
          <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={() => void load()}>
            Try again
          </Button>
        </Box>
      </Box>
    );
  }

  const { posts, nextCursor } = state.page;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, minWidth: 0 }}>
      {composer}

      {posts.length === 0 ? (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.75, py: 3.5, opacity: 0.85 }}>
          <Typography sx={{ fontSize: 12.5, color: GX.dim }}>
            {mine ? "Your wall is empty — write the first post." : "Nothing on this wall."}
          </Typography>
        </Box>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            owner={state.page.owners[post.id] ?? owner}
            me={me}
            isAdmin={isAdmin}
            identity={identity}
            onChanged={patch}
            onRemoved={drop}
          />
        ))
      )}

      {nextCursor && (
        <Button size="small" variant="outlined" disabled={more} onClick={() => void loadMore()} sx={{ alignSelf: "center" }}>
          {more ? "Loading…" : "Older posts"}
        </Button>
      )}
    </Box>
  );
}
