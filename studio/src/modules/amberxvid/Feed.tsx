"use client";

/**
 * @file **The feed** — the merged wall of the member and everyone they are
 * buddies with, paged twenty at a time (P9 of `axf-amberxvid-social`,
 * 2026-08-15).
 *
 * The merge, the ordering and the visibility filter are all P8's
 * (`lib/wall.ts` `feedFor`); this file is the reader, and it makes exactly
 * three decisions of its own.
 *
 * **1. There is no spinner into nothing.** A feed with no posts is the NORMAL
 * first-run state — a member with no buddies has only their own wall to merge —
 * so the empty state is the fix for the emptiness rather than a shrug. It says
 * what is missing (buddies) and puts the member search right there, so the one
 * screen that would otherwise be a dead end is the one that ends it. A
 * spinner that resolves into blank space is the failure this replaces: it
 * reads as broken, and the member has no idea what to do next.
 *
 * **2. Newest-check is a BUTTON and a banner, not an auto-scroll.** The feed
 * polls for a newer first page and, when there is one, offers it — it never
 * inserts posts under a reader mid-sentence. That is the pull-to-refresh
 * gesture translated honestly to a mouse: the reader asks, the list moves.
 * Polling is paused while the tab is hidden, because a background tab asking
 * every half minute is a cost nobody is reading.
 *
 * **3. Paging is by CURSOR, never by offset.** `nextCursor` is the store's
 * `createdAt|owner|id` key and it is totally ordered, so a post written while
 * somebody reads page 2 cannot make page 3 repeat or skip a row — which is
 * exactly what an offset would do here, since the merge is time-ordered across
 * several vaults.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";

import { ArrowUpward as NewestIcon } from "./kit/icons";
import { Refresh as RefreshIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip } from "./kit/ax";
import { GizmoXMark } from "./gizmox-kit";
import type { WallPost } from "./lib/types";
import { loadFeed, type WallPage } from "./lib/wallClient";
import { PostCard, WallComposer, type WallIdentity } from "./Wall";
import { BuddySearch, type BuddyCandidate } from "./Buddies";
import type { RelationsSnapshot } from "./Messenger";

/** How often the feed asks whether a newer first page exists. Half a minute is
 *  slow enough to be free and quick enough that a live conversation feels it. */
const NEWEST_CHECK_MS = 30_000;

export interface FeedProps {
  me: string;
  isAdmin: boolean;
  identity: WallIdentity;
  relations: RelationsSnapshot;
  relate: (action: string, user: string) => Promise<boolean>;
  /** Every member the caller can see — feeds the empty state's search. */
  candidates: BuddyCandidate[];
  /** Reload when the graph moves: a new buddy changes what the feed merges. */
  refreshTick?: number;
}

type FeedState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; page: WallPage };

export default function Feed({
  me,
  isAdmin,
  identity,
  relations,
  relate,
  candidates,
  refreshTick = 0,
}: FeedProps) {
  const [state, setState] = React.useState<FeedState>({ kind: "loading" });
  const [more, setMore] = React.useState(false);
  /** A fresher first page, held back until the reader asks for it. */
  const [waiting, setWaiting] = React.useState<WallPage | null>(null);
  const [checking, setChecking] = React.useState(false);

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    setWaiting(null);
    const result = await loadFeed();
    setState(result.ok ? { kind: "ready", page: result.page } : { kind: "error", message: result.error });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, refreshTick]);

  /* -------------------------- the newest check --------------------------- */

  // Held in a ref so the poll can read the current head without re-arming the
  // interval on every post — an interval that restarts on each render never
  // actually fires at its own cadence.
  const headRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    headRef.current = state.kind === "ready" ? (state.page.posts[0]?.id ?? null) : null;
  }, [state]);

  const checkNewest = React.useCallback(async () => {
    setChecking(true);
    try {
      const result = await loadFeed();
      if (!result.ok) return;
      const head = result.page.posts[0]?.id ?? null;
      // Identical head means nothing arrived — and an EMPTY fresh page means
      // the same thing, not "everything vanished": show it only when it has
      // something the reader has not got.
      if (head !== null && head !== headRef.current) setWaiting(result.page);
      else setWaiting(null);
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    if (state.kind !== "ready") return;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void checkNewest();
    };
    const id = window.setInterval(tick, NEWEST_CHECK_MS);
    return () => window.clearInterval(id);
  }, [checkNewest, state.kind]);

  /** Taking the waiting page RESETS to page one, dropping any older pages the
   *  reader had loaded. That is what a pull-to-refresh does and it is the
   *  honest thing here too: the cursor of the fresh page is the only one that
   *  is still valid, so splicing new posts on top of an old tail would leave a
   *  `nextCursor` that skips whatever landed in between. */
  const showWaiting = React.useCallback(() => {
    if (!waiting) return;
    setState({ kind: "ready", page: waiting });
    setWaiting(null);
  }, [waiting]);

  /* ----------------------------- page + patch ---------------------------- */

  const loadMore = React.useCallback(async () => {
    if (state.kind !== "ready" || !state.page.nextCursor) return;
    setMore(true);
    try {
      const result = await loadFeed(state.page.nextCursor);
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
  }, [state]);

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
        ? {
            kind: "ready",
            page: { ...s.page, posts: [post, ...s.page.posts], owners: { ...s.page.owners, [post.id]: me } },
          }
        : s,
    );
  }, [me]);

  /* -------------------------------- header -------------------------------- */

  const header = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
      <Typography
        sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: GX.dim }}
      >
        Feed
      </Typography>
      <GxChip label={`${relations.buddies.length} buddies`} kind="dim" />
      <Box sx={{ flex: 1 }} />
      <Button
        size="small"
        variant="text"
        startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}
        disabled={checking}
        onClick={() => void checkNewest()}
        data-el-id="amberxvid:feed:check"
        sx={{ fontSize: 11.5 }}
      >
        {checking ? "Checking…" : "Check for new"}
      </Button>
    </Box>
  );

  if (state.kind === "loading") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, minWidth: 0 }}>
        {header}
        <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
          <CircularProgress size={20} />
        </Box>
      </Box>
    );
  }

  if (state.kind === "error") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, minWidth: 0 }}>
        {header}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 2 }}>
          <Typography sx={{ fontSize: 12.5, color: GX.err }}>{state.message}</Typography>
          <Button size="small" variant="outlined" onClick={() => void load()}>Try again</Button>
        </Box>
      </Box>
    );
  }

  const { posts, nextCursor, owners } = state.page;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, minWidth: 0 }}>
      {header}

      {/* Composing from the feed writes to your OWN wall — the only wall the
          store lets you post to, so there is nothing to choose here. */}
      <WallComposer owner={me} me={me} identity={identity} onPosted={prepend} />

      {waiting && (
        <Button
          size="small"
          variant="contained"
          startIcon={<NewestIcon sx={{ fontSize: 14 }} />}
          onClick={showWaiting}
          data-el-id="amberxvid:feed:show-new"
          sx={{ alignSelf: "center" }}
        >
          New posts — show them
        </Button>
      )}

      {posts.length === 0 ? (
        <Box
          data-el-id="amberxvid:feed:empty"
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
            p: 2,
            borderRadius: 1.5,
            border: `1px solid ${GX.edge}`,
            bgcolor: gxa(GX.accent, "08"),
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            <GizmoXMark size={34} glow={false} />
            <Box>
              <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>Add buddies to fill this</Typography>
              <Typography sx={{ fontSize: 12, color: GX.dim }}>
                Your feed merges your wall with your buddies&apos;. Find somebody below, or write the
                first post above.
              </Typography>
            </Box>
          </Box>
          <BuddySearch
            me={me}
            relations={relations}
            relate={relate}
            candidates={candidates}
            onOpenProfile={identity.onOpenProfile}
            title="Find members to add"
          />
        </Box>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            owner={owners[post.id] ?? post.author}
            me={me}
            isAdmin={isAdmin}
            identity={identity}
            onChanged={patch}
            onRemoved={drop}
            showOwner
          />
        ))
      )}

      {nextCursor && (
        <Button
          size="small"
          variant="outlined"
          disabled={more}
          onClick={() => void loadMore()}
          data-el-id="amberxvid:feed:more"
          sx={{ alignSelf: "center" }}
        >
          {more ? "Loading…" : "Older posts"}
        </Button>
      )}
    </Box>
  );
}
