"use client";

/**
 * @file **The photo surface** — a member's albums as a justified-rows grid, a
 * keyboard-driven lightbox, and the wall's own social rail on every item (P10
 * of `axf-amberxvid-social`, 2026-08-15).
 *
 * This replaces the album browser that lived inside `Profiles.tsx` since P6.
 * There is ONE album UI now, mounted by three places — the Photos stage, the
 * Profiles stage, and the profile page's shelf, which links here rather than
 * growing a second copy (P9 said this phase would decide which of the two
 * survives; this is that decision).
 *
 * ## Three decisions worth reading before changing anything here
 *
 * **1. The grid is JUSTIFIED, and it never square-crops.** {@link justifyRows}
 * is the Flickr-style greedy fill: take items until the row is wider than the
 * container at the target height, then solve the row's height so the widths add
 * up EXACTLY, gaps included. A photo therefore appears in its own proportions —
 * a panorama reads as a panorama. That is only possible because the store reads
 * real pixel dimensions out of the uploaded bytes (`lib/albums.ts`,
 * {@link imageSize}); an item that predates P10 has none, so it is laid out at a
 * neutral 3:2 and RE-laid-out the instant the browser reports its natural size
 * ({@link useRatios}). The alternative — a square crop — is a lie about somebody
 * else's photograph, and the last row is left at its natural height rather than
 * stretched, because stretching four items across a full row is the same lie
 * told about their importance.
 *
 * **2. The lightbox is keyboard-first.** ← → step through the album, Escape
 * closes, and the step wraps at neither end (running off the last photo would
 * make "where am I" unanswerable). Arrow keys are bound on the window while it
 * is open and released when it closes, and the handler ignores the event while
 * a text field has focus — a caption or a comment containing an arrow key must
 * not navigate away from the photo it is about.
 *
 * **3. The rail in the lightbox IS the wall's.** `ReactionBar` and
 * `CommentThread` (`./SocialRail`) are the same components the post card
 * mounts, pointed at a photo instead of a post — one comment system, two
 * subjects, the same sentence the stores make true (`lib/social.ts`). Nothing
 * about comments is implemented in this file.
 *
 * ## What it refuses to do
 *
 * **No affordance that the store would refuse.** Edit controls (upload, cover,
 * caption, reorder, visibility, delete) appear for the owner and for an
 * administrator, which is exactly `resolveActor`'s gate — a button that offers
 * a refused action is the lying-button rule. And a viewer who cannot see an
 * album is shown NOTHING about it: no greyed card, no "3 hidden", no hint. The
 * silence is indistinguishable from absence on purpose.
 *
 * **The right-click menus are declared, not yet live.** `kit/ax`'s `useCtx` is
 * a no-op stub in this module until P15 builds the context-menu map, and the
 * menus below are written against it exactly as the P6 browser's were. Every
 * action they offer therefore also has a REAL control on screen — cover, move,
 * caption and copy-link in the lightbox, upload / visibility / delete in the
 * album header — so nothing here is reachable only through a menu that does not
 * open yet.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Add as AddIcon } from "./kit/icons";
import { ArrowBack as BackIcon } from "./kit/icons";
import { ChevronLeft as PrevIcon } from "./kit/icons";
import { ChevronRight as NextIcon } from "./kit/icons";
import { Close as CloseIcon } from "./kit/icons";
import { Delete as DeleteIcon } from "./kit/icons";
import { Edit as EditIcon } from "./kit/icons";
import { Link as LinkIcon } from "./kit/icons";
import { Lock as PrivateIcon } from "./kit/icons";
import { Person as BuddiesIcon } from "./kit/icons";
import { Public as PublicIcon } from "./kit/icons";
import { Refresh as RefreshIcon } from "./kit/icons";
import { Star as CoverIcon } from "./kit/icons";
import { SwapHoriz as ReorderIcon } from "./kit/icons";
import { Upload as UploadIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip, useCtx, type CtxItem } from "./kit/ax";
import { useToast } from "./kit/Toast";
import { GizmoXMark } from "./gizmox-kit";
import { useAnimationIntensity } from "./Splash";
import { CommentThread, ReactionBar, fmtWhen, lower, type SocialIdentity } from "./SocialRail";
import {
  ALBUM_CAPTION_MAX,
  ALBUM_TITLE_MAX,
  type Album,
  type Photo,
  type SocialVisibility,
} from "./lib/types";
import {
  albumItemUrl,
  commentOnPhoto,
  createAlbum,
  deleteAlbum,
  deletePhoto,
  deletePhotoComment,
  loadAlbumFeed,
  loadAlbums,
  photoUrl,
  reactToPhoto,
  renameAlbum,
  reorderPhotos,
  setAlbumVisibility,
  setCaption,
  setCover,
  type AlbumOne,
  uploadPhotos,
} from "./lib/albumClient";
import { axvPlatform, useAxvSubjectResolver } from "./ctxBridge";
import { useAmberxvidPrefs } from "./settings";

/* ---------------------------------- contracts ----------------------------------- */

export interface AlbumsProps {
  /** The signed-in member. */
  me: string;
  isAdmin: boolean;
  /** Whose shelf is on screen. */
  owner: string;
  ownerName: string;
  identity: SocialIdentity;
  /** A deep link to open on arrival — an album, and optionally one item. */
  focus?: { albumId: string; photoId: string | null } | null;
  onFocusConsumed?: () => void;
  /** Open another member's shelf — what a buddy's album in the shared view
   *  does when there is somewhere for it to go. */
  onOpenOwner?: (user: string) => void;
}

/** The three values and the ONE place their meaning is written — the wall's
 *  own wording, because it is the same choice about the same graph. */
export const ALBUM_VISIBILITY_MEANING: Record<SocialVisibility, string> = {
  public: "every member of the studio",
  buddies: "your buddies only",
  private: "nobody but you",
};

const VISIBILITY_KIND: Record<SocialVisibility, string> = {
  public: "info",
  buddies: "accent",
  private: "dim",
};

const VisibilityIcon = ({ value, size = 13 }: { value: SocialVisibility; size?: number }) => {
  const sx = { fontSize: size, color: GX.dim };
  if (value === "private") return <PrivateIcon sx={sx} />;
  if (value === "buddies") return <BuddiesIcon sx={sx} />;
  return <PublicIcon sx={sx} />;
};

/* ------------------------------ the justified grid ------------------------------- */

/** One item, placed. */
export interface JustifiedTile {
  photo: Photo;
  width: number;
  height: number;
}

/** The neutral shape an item with no known dimensions is drawn at until the
 *  browser reports its real one. 3:2 rather than 1:1 because most photographs
 *  are, and a wrong guess that re-flows once is cheaper than a crop that never
 *  corrects. */
export const FALLBACK_RATIO = 1.5;

/**
 * Justified rows: fill greedily at the target height, then solve each full row's
 * height so its widths and gaps add up to the container EXACTLY.
 *
 * The last row keeps the target height instead of being stretched — a trailing
 * row of two photos blown up to full width is the classic tell of a grid that
 * cares about its own edges more than about the pictures.
 */
export function justifyRows(
  items: { photo: Photo; ratio: number }[],
  containerWidth: number,
  targetHeight: number,
  gap: number,
): JustifiedTile[][] {
  if (containerWidth <= 0 || items.length === 0) return [];
  const rows: JustifiedTile[][] = [];
  let run: { photo: Photo; ratio: number }[] = [];
  let ratioSum = 0;

  const flush = (justify: boolean) => {
    if (run.length === 0) return;
    const gaps = gap * (run.length - 1);
    const height = justify
      ? Math.max(48, (containerWidth - gaps) / ratioSum)
      : targetHeight;
    rows.push(run.map((it) => ({ photo: it.photo, width: it.ratio * height, height })));
    run = [];
    ratioSum = 0;
  };

  for (const item of items) {
    const ratio = item.ratio > 0 && Number.isFinite(item.ratio) ? item.ratio : FALLBACK_RATIO;
    run.push({ photo: item.photo, ratio });
    ratioSum += ratio;
    const gaps = gap * (run.length - 1);
    if (ratioSum * targetHeight + gaps >= containerWidth) flush(true);
  }
  // Whatever is left is the last row, and it is NOT justified.
  flush(false);
  return rows;
}

/**
 * The aspect ratio of every item on screen: the store's sniffed dimensions
 * where they exist, and the browser's `naturalWidth`/`naturalHeight` for the
 * items that predate P10.
 *
 * `note` is handed to each `<img>`'s `onLoad`. Measuring in an effect against
 * the DOM would be the same information one paint later and a layout read in
 * render; letting the image tell us when it decodes is both cheaper and
 * correct on a slow connection.
 */
function useRatios(): {
  ratioOf: (photo: Photo) => number;
  note: (photo: Photo, img: HTMLImageElement) => void;
} {
  const [measured, setMeasured] = React.useState<Record<string, number>>({});

  const note = React.useCallback((photo: Photo, img: HTMLImageElement) => {
    if (photo.width && photo.height) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setMeasured((m) => (m[photo.id] === ratio ? m : { ...m, [photo.id]: ratio }));
  }, []);

  const ratioOf = React.useCallback(
    (photo: Photo): number => {
      if (photo.width && photo.height) return photo.width / photo.height;
      return measured[photo.id] ?? FALLBACK_RATIO;
    },
    [measured],
  );

  return { ratioOf, note };
}

/** The container's live width, without reading layout during render. */
function useMeasuredWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((w) => (Math.abs(w - next) < 1 ? w : next));
    });
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/* ==================================== surface ==================================== */

type ShelfState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; albums: Album[] };

export default function Albums({
  me,
  isAdmin,
  owner,
  ownerName,
  identity,
  focus = null,
  onFocusConsumed,
  onOpenOwner,
}: AlbumsProps) {
  const toast = useToast();
  const { openCtx, ctxMenu } = useCtx();

  const [state, setState] = React.useState<ShelfState>({ kind: "loading" });
  /** `own` is this member's shelf; `shared` merges their buddies' — the same
   *  merge the wall's feed does, so the one social surface that is not social
   *  is not this one. */
  const [scope, setScope] = React.useState<"own" | "shared">("own");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  /** P16 — the PRIVACY DEFAULTS group's `defaultAlbumVisibility`. Applied when
   *  the dialog OPENS rather than seeded into `useState`, because the settings
   *  store's first frame is the declared defaults and the member's real
   *  document lands after it; re-reading at open also means the last album's
   *  choice does not leak into the next one. */
  const defaultAlbumVisibility = useAmberxvidPrefs().defaultAlbumVisibility as SocialVisibility;
  const [newVisibility, setNewVisibility] = React.useState<SocialVisibility>(defaultAlbumVisibility);
  const openNewAlbum = React.useCallback(() => {
    setNewVisibility(defaultAlbumVisibility);
    setNewOpen(true);
  }, [defaultAlbumVisibility]);
  const [busy, setBusy] = React.useState(false);
  /**
   * The item a deep link named, held HERE rather than read straight off the
   * `focus` prop — the shelf consumes the focus the moment it opens the album,
   * so by the time the album view mounts the prop is already null and the
   * lightbox would never open. Cleared by the view once it has used it.
   */
  const [pendingItem, setPendingItem] = React.useState<{ albumId: string; photoId: string | null } | null>(
    null,
  );

  const mine = lower(owner) === lower(me);
  /** The store's gate, exactly: `resolveActor` is owner-or-administrator. It is
   *  asked PER ALBUM, never per shelf — in the shared view the albums on screen
   *  are buddies', and "this is my shelf" would offer edit controls the store
   *  refuses. */
  const mayEditAlbum = React.useCallback(
    (album: Album): boolean => lower(album.owner) === lower(me) || isAdmin,
    [isAdmin, me],
  );
  const mayCreate = mine || isAdmin;
  const shared = scope === "shared" && mine;

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    const result = shared ? await loadAlbumFeed() : await loadAlbums(owner);
    setState(
      result.ok ? { kind: "ready", albums: result.albums } : { kind: "error", message: result.error },
    );
  }, [owner, shared]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // A deep link lands on one album (and, when it names one, one item) — the
  // shell hands it over once and this consumes it, exactly as the Profiles
  // stage consumes its member focus.
  React.useEffect(() => {
    if (!focus) return;
    setScope("own");
    setOpenId(focus.albumId);
    setPendingItem(focus);
    onFocusConsumed?.();
  }, [focus, onFocusConsumed]);

  const patch = React.useCallback((album: Album) => {
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", albums: s.albums.map((a) => (a.id === album.id ? album : a)) }
        : s,
    );
  }, []);

  const drop = React.useCallback((albumId: string) => {
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", albums: s.albums.filter((a) => a.id !== albumId) } : s,
    );
  }, []);

  /** Every mutation lands here: run it, and let the STORE's answer — never a
   *  local guess — be what redraws. */
  const run = React.useCallback(
    async (action: () => Promise<AlbumOne>, done?: string): Promise<boolean> => {
      setBusy(true);
      try {
        const result = await action();
        if (!result.ok) {
          toast(result.error);
          return false;
        }
        patch(result.album);
        if (done) toast(done);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [patch, toast],
  );

  const create = React.useCallback(async () => {
    setBusy(true);
    try {
      const result = await createAlbum(owner, newTitle, newVisibility);
      if (!result.ok) {
        toast(result.error);
        return;
      }
      setState((s) =>
        s.kind === "ready" ? { kind: "ready", albums: [result.album, ...s.albums] } : s,
      );
      setNewOpen(false);
      setNewTitle("");
      setOpenId(result.album.id);
      toast(`Album "${result.album.title}" created — visible to ${ALBUM_VISIBILITY_MEANING[result.album.visibility]}`);
    } finally {
      setBusy(false);
    }
  }, [newTitle, newVisibility, owner, toast]);

  if (state.kind === "loading") {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 3 }}>
        <CircularProgress size={18} />
      </Box>
    );
  }
  if (state.kind === "error") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1 }}>
        <Typography sx={{ fontSize: 12, color: GX.err }}>{state.message}</Typography>
        <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={() => void load()}>
          Retry
        </Button>
      </Box>
    );
  }

  const { albums } = state;
  const open = openId ? (albums.find((a) => a.id === openId) ?? null) : null;

  /* ------------------------------ one open album ------------------------------ */

  if (open) {
    return (
      <>
        <AlbumView
          album={open}
          me={me}
          identity={identity}
          mayEdit={mayEditAlbum(open)}
          busy={busy}
          openCtx={openCtx}
          focusPhotoId={pendingItem?.albumId === open.id ? pendingItem.photoId : null}
          onFocusUsed={() => setPendingItem(null)}
          onBack={() => setOpenId(null)}
          onChanged={patch}
          onDeleted={(albumId) => {
            drop(albumId);
            setOpenId(null);
          }}
          run={run}
        />
        {ctxMenu}
      </>
    );
  }

  /* -------------------------------- the shelf --------------------------------- */

  const albumMenu = (album: Album): CtxItem[] => {
    const items: CtxItem[] = [
      { label: "Open album", onClick: () => setOpenId(album.id) },
      {
        label: "Copy link to album",
        onClick: () => {
          void navigator.clipboard.writeText(albumItemUrl(album.owner, album.id));
          toast("Link copied — paste it into a chat");
        },
      },
    ];
    if (lower(album.owner) !== lower(me) && onOpenOwner) {
      items.push({ label: `Open ${identity.screennameFor(album.owner)}'s shelf`, onClick: () => onOpenOwner(album.owner) });
    }
    if (mayEditAlbum(album)) {
      items.push(
        "---",
        {
          label: "Delete album",
          danger: true,
          onClick: () => {
            void (async () => {
              const result = await deleteAlbum(album.owner, album.id);
              if (!result.ok) {
                toast(result.error);
                return;
              }
              drop(album.id);
              toast(`Album "${album.title}" deleted`);
            })();
          },
        },
      );
    }
    return items;
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, flexWrap: "wrap" }}>
        <Typography
          sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: GX.dim }}
        >
          {shared ? "Buddies' albums" : "Photo albums"} · {albums.length}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {mine && (
          <Button
            size="small"
            variant={shared ? "contained" : "outlined"}
            onClick={() => setScope((s) => (s === "shared" ? "own" : "shared"))}
            data-el-id="amberxvid:albums:scope"
            sx={{ fontSize: 11 }}
          >
            {shared ? "Mine" : "Buddies"}
          </Button>
        )}
        <Tooltip title="Reload">
          <IconButton size="small" onClick={() => void load()} aria-label="reload albums">
            <RefreshIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        {mayCreate && !shared && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={openNewAlbum}
            data-el-id="amberxvid:albums:new"
          >
            New album
          </Button>
        )}
      </Box>

      {albums.length === 0 ? (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, py: 2.5, opacity: 0.8 }}>
          <GizmoXMark size={36} glow={false} />
          <Typography sx={{ fontSize: 12, color: GX.dim }}>
            {shared
              ? "None of your buddies have shared an album with you."
              : mayCreate
                ? "No albums yet — create one and upload photos."
                : `${ownerName} has no albums.`}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 1 }}>
          {albums.map((album) => (
            <AlbumCard
              key={album.id}
              album={album}
              showOwner={shared && lower(album.owner) !== lower(me)}
              ownerLabel={identity.screennameFor(album.owner)}
              onOpen={() => setOpenId(album.id)}
              onContext={(e) => openCtx(e, `Album · ${album.title}`, albumMenu(album))}
            />
          ))}
        </Box>
      )}

      {/* new-album dialog — the visibility is chosen HERE, at the moment the
          album is named, rather than defaulted and discovered later. */}
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} maxWidth="xs" fullWidth>
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>New photo album</Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value.slice(0, ALBUM_TITLE_MAX))}
            placeholder="Album title"
            data-el-id="amberxvid:albums:new-title"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTitle.trim()) void create();
            }}
          />
          <AlbumVisibilityPicker value={newVisibility} onChange={setNewVisibility} disabled={busy} />
          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            <Button size="small" variant="outlined" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button
              size="small"
              variant="contained"
              disabled={!newTitle.trim() || busy}
              onClick={() => void create()}
              data-el-id="amberxvid:albums:new-create"
            >
              Create album
            </Button>
          </Box>
        </Box>
      </Dialog>

      {ctxMenu}
    </Box>
  );
}

/* --------------------------------- the visibility -------------------------------- */

export function AlbumVisibilityPicker({
  value,
  onChange,
  disabled = false,
  explain = true,
}: {
  value: SocialVisibility;
  onChange: (next: SocialVisibility) => void;
  disabled?: boolean;
  explain?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <VisibilityIcon value={value} size={15} />
        <Select
          size="small"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as SocialVisibility)}
          data-el-id="amberxvid:albums:visibility"
          sx={{ fontSize: 12, minWidth: 118, "& .MuiSelect-select": { py: 0.5 } }}
        >
          <MenuItem value="public" sx={{ fontSize: 12 }}>Public</MenuItem>
          <MenuItem value="buddies" sx={{ fontSize: 12 }}>Buddies</MenuItem>
          <MenuItem value="private" sx={{ fontSize: 12 }}>Private</MenuItem>
        </Select>
      </Box>
      {explain && (
        <Typography sx={{ fontSize: 10.5, color: GX.dim, pl: 2.75 }}>
          Visible to {ALBUM_VISIBILITY_MEANING[value]}.
        </Typography>
      )}
    </Box>
  );
}

/* ---------------------------------- album card ----------------------------------- */

function AlbumCard({
  album,
  showOwner,
  ownerLabel,
  onOpen,
  onContext,
}: {
  album: Album;
  showOwner: boolean;
  ownerLabel: string;
  onOpen: () => void;
  onContext: (e: React.MouseEvent) => void;
}) {
  const intensity = useAnimationIntensity();
  const animate = intensity !== "off";
  const cover = album.coverPhotoId
    ? album.photos.find((p) => p.id === album.coverPhotoId)
    : album.photos[0];

  return (
    <Box
      onClick={onOpen}
      onContextMenu={onContext}
      data-el-id={`amberxvid:albums:album:${album.id}`}
      sx={{
        borderRadius: 1.5,
        overflow: "hidden",
        border: `1px solid ${GX.edge}`,
        cursor: "pointer",
        bgcolor: GX.panel2,
        transition: animate ? "transform 150ms, border-color 150ms" : "none",
        "&:hover": animate
          ? { transform: "translateY(-2px)", borderColor: gxa(GX.accent, "66") }
          : { borderColor: GX.accent },
      }}
    >
      <Box sx={{ aspectRatio: "4 / 3", display: "grid", placeItems: "center", bgcolor: gxa(GX.accent, "0a") }}>
        {cover ? (
          <Box
            component="img"
            src={photoUrl(album.owner, album.id, cover.id)}
            alt={album.title}
            loading="lazy"
            sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <GizmoXMark size={30} glow={false} />
        )}
      </Box>
      <Box sx={{ px: 1, py: 0.75 }}>
        <Typography
          sx={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {album.title}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25, flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 10, color: GX.dim }}>{album.photos.length} photo(s)</Typography>
          <GxChip label={album.visibility} kind={VISIBILITY_KIND[album.visibility]} />
          {showOwner && <Typography sx={{ fontSize: 10, color: GX.dim }}>· {ownerLabel}</Typography>}
        </Box>
      </Box>
    </Box>
  );
}

/* =================================== one album =================================== */

function AlbumView({
  album,
  me,
  identity,
  mayEdit,
  busy,
  openCtx,
  focusPhotoId,
  onFocusUsed,
  onBack,
  onChanged,
  onDeleted,
  run,
}: {
  album: Album;
  me: string;
  identity: SocialIdentity;
  /** Owner-or-administrator FOR THIS ALBUM — the store's own gate. */
  mayEdit: boolean;
  busy: boolean;
  openCtx: (e: React.MouseEvent, title: string, items: CtxItem[]) => void;
  focusPhotoId: string | null;
  onFocusUsed: () => void;
  onBack: () => void;
  onChanged: (album: Album) => void;
  onDeleted: (albumId: string) => void;
  run: (action: () => Promise<AlbumOne>, done?: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const animate = intensity !== "off";

  const [uploading, setUploading] = React.useState(false);
  const [lightboxId, setLightboxId] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(album.title);
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  const [gridRef, gridWidth] = useMeasuredWidth();
  const { ratioOf, note } = useRatios();

  // A deep link that named an item opens it ONCE: the shelf is told the focus
  // has been used, which clears it, and this effect re-runs with `null` and
  // does nothing. Without that hand-back, closing the lightbox and editing a
  // caption would re-open it on the next render.
  React.useEffect(() => {
    if (!focusPhotoId) return;
    if (album.photos.some((p) => p.id === focusPhotoId)) setLightboxId(focusPhotoId);
    onFocusUsed();
  }, [album.photos, focusPhotoId, onFocusUsed]);

  const rows = React.useMemo(
    () =>
      justifyRows(
        album.photos.map((photo) => ({ photo, ratio: ratioOf(photo) })),
        gridWidth,
        190,
        6,
      ),
    [album.photos, gridWidth, ratioOf],
  );

  const upload = React.useCallback(
    async (files: FileList) => {
      setUploading(true);
      try {
        const result = await uploadPhotos(album.owner, album.id, Array.from(files));
        if (!result.ok) {
          toast(result.error);
          return;
        }
        onChanged(result.album);
        toast(
          result.rejected.length === 0
            ? `${result.added} photo(s) uploaded`
            : `${result.added} uploaded · ${result.rejected.length} rejected (${result.rejected[0].error})`,
        );
      } finally {
        setUploading(false);
      }
    },
    [album.id, album.owner, onChanged, toast],
  );

  const move = React.useCallback(
    (photoId: string, delta: number) => {
      const ids = album.photos.map((p) => p.id);
      const from = ids.indexOf(photoId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      void run(() => reorderPhotos(album.owner, album.id, ids), "Order saved");
    },
    [album.id, album.owner, album.photos, run],
  );

  const copyItemLink = React.useCallback(
    (photoId: string) => {
      void navigator.clipboard.writeText(albumItemUrl(album.owner, album.id, photoId));
      toast("Link copied — paste it into a chat to share this photo");
    },
    [album.id, album.owner, toast],
  );

  /**
   * The declared `amberxvid.photo` area's behaviour (P15).
   *
   * A resolver, not a hook per tile: the justified grid is a `.map()` inside a
   * `.map()` and a hook cannot live in either. It reads `album.photos`, which
   * is what the tiles are drawn from.
   *
   * *Caption* opens the LIGHTBOX rather than growing an editor of its own —
   * the inline caption field lives there, owner-only, and a second one on the
   * tile would be a second place for `ALBUM_CAPTION_MAX` to be forgotten.
   */
  useAxvSubjectResolver("photo", (id) => {
    const photo = album.photos.find((p) => p.id === id);
    if (!photo) return null;
    return {
      open: () => setLightboxId(photo.id),
      caption: () => setLightboxId(photo.id),
      setCover: () =>
        void run(() => setCover(album.owner, album.id, photo.id), "Cover updated"),
      share: () =>
        axvPlatform()?.share(
          albumItemUrl(album.owner, album.id, photo.id),
          "Photo link copied — pick who to send it to",
        ),
      remove: () =>
        void run(() => deletePhoto(album.owner, album.id, photo.id), "Photo deleted"),
    };
  });

  const photoMenu = (photo: Photo): CtxItem[] => {
    const items: CtxItem[] = [
      { label: "View photo", onClick: () => setLightboxId(photo.id) },
      { label: "Copy link to photo", onClick: () => copyItemLink(photo.id) },
    ];
    if (mayEdit) {
      items.push(
        { label: "Set as album cover", onClick: () => void run(() => setCover(album.owner, album.id, photo.id), "Cover updated") },
        { label: "Move earlier", onClick: () => move(photo.id, -1) },
        { label: "Move later", onClick: () => move(photo.id, 1) },
        "---",
        {
          label: "Delete photo",
          danger: true,
          onClick: () => void run(() => deletePhoto(album.owner, album.id, photo.id), "Photo deleted"),
        },
      );
    }
    return items;
  };

  const lightboxIndex = lightboxId ? album.photos.findIndex((p) => p.id === lightboxId) : -1;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
      {/* header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, flexWrap: "wrap", rowGap: 0.75 }}>
        <IconButton size="small" onClick={onBack} aria-label="back to albums">
          <BackIcon sx={{ fontSize: 16 }} />
        </IconButton>
        {renaming ? (
          <TextField
            autoFocus
            size="small"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value.slice(0, ALBUM_TITLE_MAX))}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenaming(false);
              if (e.key === "Enter") {
                void run(() => renameAlbum(album.owner, album.id, titleDraft), "Album renamed").then(
                  (ok) => ok && setRenaming(false),
                );
              }
            }}
            data-el-id={`amberxvid:albums:title:${album.id}`}
            sx={{ "& .MuiInputBase-input": { fontSize: 13.5, fontWeight: 700 } }}
          />
        ) : (
          <Typography
            onDoubleClick={() => {
              if (!mayEdit) return;
              setTitleDraft(album.title);
              setRenaming(true);
            }}
            sx={{ fontSize: 13.5, fontWeight: 700, cursor: mayEdit ? "text" : "default" }}
          >
            {album.title}
          </Typography>
        )}
        <GxChip label={`${album.photos.length} photo(s)`} kind="dim" />
        <Box sx={{ flex: 1 }} />
        {mayEdit ? (
          <AlbumVisibilityPicker
            value={album.visibility}
            disabled={busy}
            explain={false}
            onChange={(next) =>
              void run(
                () => setAlbumVisibility(album.owner, album.id, next),
                `Album is now visible to ${ALBUM_VISIBILITY_MEANING[next]}`,
              )
            }
          />
        ) : (
          <GxChip label={album.visibility} kind={VISIBILITY_KIND[album.visibility]} />
        )}
        {mayEdit && (
          <>
            {/* The picker itself is never seen — the Button beside it is the
                control. `Box component="input"` rather than a raw <input> so
                the hidden field is still MUI's. */}
            <Box
              component="input"
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              sx={{ display: "none" }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                if (e.target.files?.length) void upload(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              size="small"
              variant="contained"
              startIcon={<UploadIcon />}
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              data-el-id="amberxvid:albums:upload"
            >
              {uploading ? "Uploading…" : "Upload photos"}
            </Button>
            <Tooltip title="Delete this album and every photo in it">
              <IconButton
                size="small"
                aria-label="delete album"
                onClick={() => {
                  void (async () => {
                    const result = await deleteAlbum(album.owner, album.id);
                    if (!result.ok) {
                      toast(result.error);
                      return;
                    }
                    onDeleted(album.id);
                    toast(`Album "${album.title}" deleted`);
                  })();
                }}
              >
                <DeleteIcon sx={{ fontSize: 15, color: GX.err }} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>

      {/* the justified grid */}
      <Box ref={gridRef} sx={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
        {album.photos.length === 0 ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, py: 3, opacity: 0.8 }}>
            <GizmoXMark size={40} glow={false} />
            <Typography sx={{ fontSize: 12, color: GX.dim }}>
              {mayEdit ? "No photos yet — upload some." : "Nothing in this album yet."}
            </Typography>
          </Box>
        ) : (
          rows.map((row, i) => (
            <Box key={i} sx={{ display: "flex", gap: "6px", minWidth: 0 }}>
              {row.map(({ photo, width, height }) => (
                <Box
                  key={photo.id}
                  onClick={() => setLightboxId(photo.id)}
                  onContextMenu={(e) => openCtx(e, `Photo · ${photo.caption || photo.file}`, photoMenu(photo))}
                  // The declared `amberxvid.photo` area (P15). The ALBUM's
                  // owner is what the ownership predicate reads — an album is
                  // one person's, and `lib/albums.ts` gives its owner the
                  // caption, the cover and the delete.
                  data-axf-area="amberxvid.photo"
                  data-axf-photo={photo.id}
                  data-axf-photo-owner={album.owner}
                  data-el-id={`amberxvid:albums:photo:${photo.id}`}
                  sx={{
                    position: "relative",
                    width,
                    height,
                    flexShrink: 0,
                    borderRadius: 1,
                    overflow: "hidden",
                    border: `1px solid ${album.coverPhotoId === photo.id ? gxa(GX.accent, "88") : GX.edge}`,
                    cursor: "pointer",
                    transition: animate ? "box-shadow 150ms, border-color 150ms" : "none",
                    "&:hover": animate ? { boxShadow: "0 4px 14px #0008" } : { borderColor: GX.accent },
                  }}
                >
                  <Box
                    component="img"
                    src={photoUrl(album.owner, album.id, photo.id)}
                    alt={photo.caption || "album photo"}
                    loading="lazy"
                    onLoad={(e: React.SyntheticEvent<HTMLImageElement>) => note(photo, e.currentTarget)}
                    sx={{
                      width: "100%",
                      height: "100%",
                      // `cover` inside a box already cut to the photo's OWN
                      // ratio crops nothing — it only absorbs the sub-pixel
                      // rounding the row solver leaves behind.
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                  {album.coverPhotoId === photo.id && (
                    <Box sx={{ position: "absolute", top: 4, right: 4, color: GX.accent, display: "flex" }}>
                      <CoverIcon sx={{ fontSize: 15 }} />
                    </Box>
                  )}
                  {(photo.caption || photo.comments.length > 0 || photo.reactions.likes.length > 0) && (
                    <Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, px: 0.75, py: 0.4, bgcolor: "#000a", display: "flex", gap: 0.75, alignItems: "center" }}>
                      <Typography
                        sx={{ fontSize: 10, color: "#fff", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {photo.caption}
                      </Typography>
                      {photo.reactions.likes.length > 0 && (
                        <Typography sx={{ fontSize: 10, color: "#fff" }}>♥ {photo.reactions.likes.length}</Typography>
                      )}
                      {photo.comments.length > 0 && (
                        <Typography sx={{ fontSize: 10, color: "#fff" }}>💬 {photo.comments.length}</Typography>
                      )}
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          ))
        )}
      </Box>

      <Lightbox
        album={album}
        index={lightboxIndex}
        me={me}
        identity={identity}
        mayEdit={mayEdit}
        busy={busy}
        onClose={() => setLightboxId(null)}
        onStep={(next) => setLightboxId(album.photos[next]?.id ?? null)}
        onCopyLink={copyItemLink}
        run={run}
      />
    </Box>
  );
}

/* =================================== lightbox ==================================== */

function Lightbox({
  album,
  index,
  me,
  identity,
  mayEdit,
  busy,
  onClose,
  onStep,
  onCopyLink,
  run,
}: {
  album: Album;
  /** `-1` when nothing is open. */
  index: number;
  me: string;
  identity: SocialIdentity;
  mayEdit: boolean;
  busy: boolean;
  onClose: () => void;
  onStep: (nextIndex: number) => void;
  onCopyLink: (photoId: string) => void;
  run: (action: () => Promise<AlbumOne>, done?: string) => Promise<boolean>;
}) {
  const photo = index >= 0 ? (album.photos[index] ?? null) : null;
  const [captionDraft, setCaptionDraft] = React.useState("");
  const [editingCaption, setEditingCaption] = React.useState(false);

  // A new photo on screen means the caption editor is about a different photo;
  // carrying a half-typed caption across would save it onto the wrong one.
  React.useEffect(() => {
    setEditingCaption(false);
    setCaptionDraft(photo?.caption ?? "");
  }, [photo?.id, photo?.caption]);

  /**
   * Arrows step, Escape closes — bound while the lightbox is open and released
   * when it is not. The typing guard matters: a caption or a comment with an
   * arrow key in it must not navigate away from the photo it is about.
   */
  React.useEffect(() => {
    if (!photo) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        // Escape leaves the caption box first and the lightbox second — one
        // key, the innermost thing it can close.
        if (typing) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (typing) return;
      if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        onStep(index - 1);
      }
      if (e.key === "ArrowRight" && index < album.photos.length - 1) {
        e.preventDefault();
        onStep(index + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [album.photos.length, index, onClose, onStep, photo]);

  if (!photo) return null;

  /** The album's owner and an administrator may delete anybody's comment —
   *  `mayEdit` is already exactly those two, so there is nothing to add. */
  const canDeleteComments = mayEdit;

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth data-el-id={`amberxvid:albums:lightbox:${photo.id}`}>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, minHeight: 0 }}>
        {/* the picture */}
        <Box
          sx={{
            position: "relative",
            flex: "1 1 auto",
            minWidth: 0,
            bgcolor: "#000",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Box
            component="img"
            src={photoUrl(album.owner, album.id, photo.id)}
            alt={photo.caption || "photo"}
            sx={{ maxWidth: "100%", maxHeight: "78vh", objectFit: "contain", display: "block" }}
          />
          {index > 0 && (
            <IconButton
              size="small"
              aria-label="previous photo"
              onClick={() => onStep(index - 1)}
              data-el-id="amberxvid:albums:lightbox-prev"
              sx={{ position: "absolute", left: 6, top: "50%", bgcolor: "#000a", "&:hover": { bgcolor: "#000d" } }}
            >
              <PrevIcon sx={{ fontSize: 20, color: "#fff" }} />
            </IconButton>
          )}
          {index < album.photos.length - 1 && (
            <IconButton
              size="small"
              aria-label="next photo"
              onClick={() => onStep(index + 1)}
              data-el-id="amberxvid:albums:lightbox-next"
              sx={{ position: "absolute", right: 6, top: "50%", bgcolor: "#000a", "&:hover": { bgcolor: "#000d" } }}
            >
              <NextIcon sx={{ fontSize: 20, color: "#fff" }} />
            </IconButton>
          )}
          <Typography
            sx={{ position: "absolute", left: 8, bottom: 6, fontSize: 10.5, color: "#fff9", fontFamily: GX.mono }}
          >
            {index + 1} / {album.photos.length} · ← → to step, Esc to close
          </Typography>
        </Box>

        {/* the social rail */}
        <Box
          sx={{
            width: { xs: "auto", md: 340 },
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 1,
            p: 1.5,
            maxHeight: "78vh",
            overflowY: "auto",
            bgcolor: GX.panel,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, flex: 1, minWidth: 0 }}>
              {album.title}
            </Typography>
            <Tooltip title="Copy a link to this photo">
              <IconButton size="small" aria-label="copy photo link" onClick={() => onCopyLink(photo.id)}>
                <LinkIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            <IconButton size="small" aria-label="close" onClick={onClose}>
              <CloseIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Box>
          <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
            {identity.screennameFor(album.owner)} · {fmtWhen(photo.uploadedAt)}
            {photo.width && photo.height ? ` · ${photo.width}×${photo.height}` : ""}
          </Typography>

          {/* caption — inline for the owner, plain text for everybody else */}
          {editingCaption ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
              <TextField
                autoFocus
                fullWidth
                multiline
                minRows={2}
                maxRows={5}
                size="small"
                value={captionDraft}
                onChange={(e) => setCaptionDraft(e.target.value.slice(0, ALBUM_CAPTION_MAX))}
                placeholder="Say something about this photo…"
                data-el-id={`amberxvid:albums:caption:${photo.id}`}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditingCaption(false);
                    setCaptionDraft(photo.caption);
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void run(
                      () => setCaption(album.owner, album.id, photo.id, captionDraft),
                      "Caption saved",
                    ).then((ok) => ok && setEditingCaption(false));
                  }
                }}
              />
              <Box sx={{ display: "flex", gap: 0.75, justifyContent: "flex-end" }}>
                <Button size="small" variant="outlined" onClick={() => setEditingCaption(false)}>
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => setCaption(album.owner, album.id, photo.id, captionDraft),
                      "Caption saved",
                    ).then((ok) => ok && setEditingCaption(false))
                  }
                >
                  Save caption
                </Button>
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
              <Typography
                onDoubleClick={() => mayEdit && setEditingCaption(true)}
                sx={{
                  flex: 1,
                  fontSize: 12.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: photo.caption ? GX.ink : GX.dim,
                  fontStyle: photo.caption ? "normal" : "italic",
                  cursor: mayEdit ? "text" : "default",
                }}
              >
                {photo.caption || (mayEdit ? "No caption — double-click to add one." : "No caption.")}
              </Typography>
              {mayEdit && (
                <Tooltip title="Edit caption">
                  <IconButton size="small" aria-label="edit caption" onClick={() => setEditingCaption(true)}>
                    <EditIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )}

          {mayEdit && (
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              <Button
                size="small"
                variant="text"
                startIcon={<CoverIcon sx={{ fontSize: 14 }} />}
                disabled={busy || album.coverPhotoId === photo.id}
                onClick={() => void run(() => setCover(album.owner, album.id, photo.id), "Cover updated")}
                sx={{ fontSize: 11 }}
              >
                {album.coverPhotoId === photo.id ? "Cover" : "Make cover"}
              </Button>
              <Button
                size="small"
                variant="text"
                startIcon={<ReorderIcon sx={{ fontSize: 14 }} />}
                disabled={busy || index <= 0}
                onClick={() =>
                  void run(
                    () =>
                      reorderPhotos(
                        album.owner,
                        album.id,
                        (() => {
                          const ids = album.photos.map((p) => p.id);
                          ids.splice(index - 1, 0, ids.splice(index, 1)[0]);
                          return ids;
                        })(),
                      ),
                    "Order saved",
                  )
                }
                sx={{ fontSize: 11 }}
              >
                Move earlier
              </Button>
            </Box>
          )}

          {/* THE WALL'S RAIL, pointed at a photo — one comment system, two
              subjects. Nothing about comments is implemented here. */}
          <ReactionBar
            reactions={photo.reactions}
            me={me}
            identity={identity}
            slug="amberxvid:albums"
            subjectId={photo.id}
            busy={busy}
            onReact={(kind) => void run(() => reactToPhoto(album.owner, album.id, photo.id, kind))}
          />
          <CommentThread
            comments={photo.comments}
            me={me}
            identity={identity}
            mayModerate={canDeleteComments}
            slug="amberxvid:albums"
            subjectId={photo.id}
            busy={busy}
            onComment={(text, replyTo) =>
              run(() => commentOnPhoto(album.owner, album.id, photo.id, text, replyTo))
            }
            onDeleteComment={(commentId) =>
              void run(
                () => deletePhotoComment(album.owner, album.id, photo.id, commentId),
                "Comment deleted",
              )
            }
            subjectWord="photo"
          />
        </Box>
      </Box>
    </Dialog>
  );
}
