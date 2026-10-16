"use client";

/**
 * @file **The profile page** — the social face of a member: the ACCOUNTS
 * profile, with amberxvid's rails beside it (P9 of `axf-amberxvid-social`,
 * 2026-08-15).
 *
 * ## It composes onto the accounts profile; it does not duplicate it
 *
 * Display name, bio and presence come from `accounts/profileClient` and are
 * written back through it. That is the whole point of the phase: since P1 the
 * accounts module is this module's ONE identity system, so a bio edited here
 * is the same bio the accounts profile pane edits, the same one the messenger
 * header reads, and there is no amberxvid copy to fall out of step with it.
 * The old module-local `statusLine`/`aboutMe` pair is deliberately NOT drawn
 * here — a second "about me" beside the account's own bio is exactly the
 * duplication the identity merge exists to have ended.
 *
 * **The AVATAR is the one exception, and it is a deliberate one.** The module
 * keeps its 16-axis designed avatar (`AvatarDesigner` → `/api/amberxvid/profiles`)
 * because the accounts avatar is an initials disc or an uploaded image, and
 * neither can express a designed face. So the picture is amberxvid's and the
 * NAME under it is the account's — the designer remains its only editor, as the
 * phase requires, and everything else on the identity card is read from and
 * written to accounts.
 *
 * ## The rails
 *
 * - **The wall** ({@link Wall}) is the main column: the composer where one
 *   belongs, the posts, reactions, comments and one-level replies.
 * - **The albums strip** is a read-only shelf of the member's albums, and since
 *   P10 it LINKS INTO the photo surface (`./Albums`) by album: clicking a cover
 *   opens that album's justified grid rather than dropping the visitor on a
 *   shelf they then have to find it in. It still re-implements nothing — the
 *   strip is a shelf, the surface is the browser, and the albums it can show at
 *   all are whatever the store's visibility filter let through.
 * - **The streams / recordings strip** shows what genuinely exists TODAY: a
 *   live stream the member is hosting, and — on your own profile — your recent
 *   captures. A member's recordings are private to them (the recordings route's
 *   own rule), so on somebody else's profile the strip says that rather than
 *   showing an empty grid that implies they have none. P12 fills it with public
 *   streams and their recordings.
 *
 * ## Blocked viewers get NOTHING to read
 *
 * A blocked pair's profile 404s in the accounts store, identically to a member
 * who does not exist, and this page renders that as "no such member". There is
 * no separate blocked state and no hint anywhere on the page — the wall's
 * silence, the album strip's emptiness and this refusal are all
 * indistinguishable from absence on purpose (`lib/wall.ts`, decision 2).
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Collections as AlbumsIcon } from "./kit/icons";
import { FiberManualRecord as DotIcon } from "./kit/icons";
import { Palette as DesignIcon } from "./kit/icons";
import { PlayCircle as PlayIcon } from "./kit/icons";
import { Refresh as RefreshIcon } from "./kit/icons";
import { Save as SaveIcon } from "./kit/icons";
import { Sensors as StreamIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip } from "./kit/ax";
import SplitPane from "./kit/SplitPane";
import { useToast } from "./kit/Toast";
import { GizmoXMark } from "./gizmox-kit";
import AvatarView from "./Avatar";
import AvatarDesigner from "./AvatarDesigner";
import { useAnimationIntensity } from "./Splash";
import { isPortrait } from "./lib/avatar";
import type { Album, AvatarSpec, AvatarValue, RecordingManifest } from "./lib/types";
import Wall, { type WallIdentity } from "./Wall";
import { loadAlbums, photoUrl } from "./lib/albumClient";
import { BuddyControls } from "./Buddies";
import { ProfileRailSlot } from "./PointSlots";
import type { RelationsSnapshot } from "./Messenger";

import { BIO_MAX } from "@axs/modules/accounts/lib/types";
import type { Profile as AccountsProfile } from "@axs/modules/accounts/lib/types";
import { loadProfile, saveProfile } from "@axs/modules/accounts/profileClient";

/* ---------------------------------- contracts ---------------------------------- */

export interface ProfilePageProps {
  /** The signed-in member. */
  me: string;
  isAdmin: boolean;
  /** Whose profile is on screen. */
  user: string;
  identity: WallIdentity;
  relations: RelationsSnapshot;
  relate: (action: string, user: string) => Promise<boolean>;
  /** Open a DM with this member — the messenger engine's own door. */
  onMessage?: (user: string) => void;
  /** Live presence for `user`, when the caller holds a roster. Falls back to
   *  the profile load's own `online` flag, which is a snapshot rather than a
   *  stream. */
  presence?: { online: boolean; away: boolean } | null;
  /** A stream this member is hosting right now (P12 widens this rail). */
  liveStream?: { id: string; title: string } | null;
  onJoinStream?: (streamId: string) => void;
  /** Open the photo surface on this member — and, when the strip knows which
   *  cover was clicked, on that album (P10). */
  onOpenAlbums?: (user: string, albumId?: string) => void;
  /** Play one of my own captures in the library. */
  onOpenRecording?: (recordingId: string) => void;
  /** Fired after any own-profile save — the shell's profile card refetches. */
  onProfileChanged?: () => void;
}

const lower = (u: string): string => u.trim().toLowerCase();

function fmtLastSeen(iso: string | null): string {
  if (!iso) return "never signed in";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return new Date(then).toLocaleDateString();
}

/** Save one patch of the module's OWN profile document — the avatar and
 *  nothing else, now that identity lives in accounts. */
async function saveModuleAvatar(spec: AvatarSpec): Promise<string | null> {
  try {
    const res = await fetch("/api/amberxvid/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: spec }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !json?.ok) return json?.error ?? `profiles answered ${res.status}`;
    return null;
  } catch {
    return "the profile service did not answer";
  }
}

/* ------------------------------------ page -------------------------------------- */

type PageState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; profile: AccountsProfile; online: boolean; own: boolean };

export default function ProfilePage({
  me,
  isAdmin,
  user,
  identity,
  relations,
  relate,
  onMessage,
  presence,
  liveStream,
  onJoinStream,
  onOpenAlbums,
  onOpenRecording,
  onProfileChanged,
}: ProfilePageProps) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const animate = intensity !== "off";

  const [state, setState] = React.useState<PageState>({ kind: "loading" });
  const [bio, setBio] = React.useState("");
  const [savingBio, setSavingBio] = React.useState(false);
  const [designerOpen, setDesignerOpen] = React.useState(false);
  const [wallTick, setWallTick] = React.useState(0);

  const mine = lower(user) === lower(me);

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    // `mine` still goes through the named form: the route resolves your own
    // username to your own profile, and passing it keeps one code path.
    const result = await loadProfile(user);
    if (!result.ok) {
      setState({ kind: "error", message: result.error });
      return;
    }
    setBio(result.profile.bio);
    setState({ kind: "ready", profile: result.profile, online: result.online, own: result.own });
  }, [user]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const saveBio = React.useCallback(async () => {
    setSavingBio(true);
    try {
      const result = await saveProfile({ bio });
      if (!result.ok) {
        toast(result.error);
        return;
      }
      setState((s) => (s.kind === "ready" ? { ...s, profile: result.profile } : s));
      toast("Bio saved");
      onProfileChanged?.();
    } finally {
      setSavingBio(false);
    }
  }, [bio, onProfileChanged, toast]);

  const saveAvatar = React.useCallback(
    async (spec: AvatarSpec): Promise<boolean> => {
      const error = await saveModuleAvatar(spec);
      if (error) {
        toast(error);
        return false;
      }
      toast("Avatar saved — it now follows you everywhere in the module");
      onProfileChanged?.();
      // The wall draws every author through `identity`, which the shell owns;
      // bumping the tick is what redraws the faces already on screen.
      setWallTick((t) => t + 1);
      return true;
    },
    [onProfileChanged, toast],
  );

  if (state.kind === "loading") {
    return (
      <Box sx={{ flex: 1, display: "grid", placeItems: "center", p: 4 }}>
        <CircularProgress size={22} />
      </Box>
    );
  }

  if (state.kind === "error") {
    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.5, p: 4 }}>
        <Typography sx={{ fontSize: 13, color: GX.err }}>{state.message}</Typography>
        <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={() => void load()}>
          Try again
        </Button>
      </Box>
    );
  }

  const { profile } = state;
  const avatar: AvatarValue = identity.avatarOf(profile.username);
  const online = presence?.online ?? state.online;
  const away = presence?.away ?? false;
  const dirtyBio = mine && bio !== profile.bio;

  const presenceColor = online ? (away ? GX.warn : GX.ok) : GX.dim;
  const presenceWord = online ? (away ? "away" : "online") : "offline";

  /* ------------------------------ identity card ----------------------------- */

  const identityCard = (
    <Box
      data-el-id={`amberxvid:profile:identity:${profile.username}`}
      sx={{
        display: "flex",
        gap: 1.75,
        alignItems: "flex-start",
        p: 1.5,
        borderRadius: 1.5,
        border: `1px solid ${GX.edge}`,
        bgcolor: GX.panel2,
        flexShrink: 0,
      }}
    >
      <Box
        sx={{
          borderRadius: 1.5,
          overflow: "hidden",
          border: `1px solid ${GX.edge}`,
          flexShrink: 0,
          transition: animate ? "box-shadow 250ms" : "none",
          "&:hover": animate ? { boxShadow: `0 0 18px ${gxa(GX.accent, "33")}` } : undefined,
        }}
      >
        <AvatarView spec={avatar} name={profile.screenname} size={104} round={false} />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.75 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 19, fontWeight: 700, lineHeight: 1.2 }}>
            {profile.screenname}
          </Typography>
          <Tooltip title={online ? `${presenceWord} now` : `Last seen ${fmtLastSeen(profile.lastSeenAt)}`}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
              <DotIcon sx={{ fontSize: 11, color: presenceColor }} />
              <Typography sx={{ fontSize: 11, color: presenceColor }}>{presenceWord}</Typography>
            </Box>
          </Tooltip>
          {mine && <GxChip label="you" kind="accent" />}
        </Box>
        <Typography sx={{ fontSize: 11, color: GX.dim }}>
          {profile.username}
          {!online && ` · last seen ${fmtLastSeen(profile.lastSeenAt)}`}
        </Typography>

        {/* The bio is the ACCOUNTS bio — one field, one store, both panes. */}
        {mine ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={6}
              size="small"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
              placeholder="Tell the studio about yourself…"
              data-el-id="amberxvid:profile:bio"
            />
            <Typography sx={{ fontSize: 10, color: GX.dim, alignSelf: "flex-end" }}>
              {bio.length} / {BIO_MAX}
            </Typography>
          </Box>
        ) : (
          <Typography
            sx={{
              fontSize: 12.5,
              whiteSpace: "pre-wrap",
              color: profile.bio ? GX.ink : GX.dim,
              fontStyle: profile.bio ? "normal" : "italic",
            }}
          >
            {profile.bio || `${profile.screenname} hasn't written a bio yet.`}
          </Typography>
        )}

        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center", mt: 0.25 }}>
          {mine ? (
            <>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DesignIcon />}
                onClick={() => setDesignerOpen(true)}
                data-el-id="amberxvid:profile:design-avatar"
              >
                {avatar ? "Edit avatar" : "Design avatar"}
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<SaveIcon />}
                disabled={!dirtyBio || savingBio}
                onClick={() => void saveBio()}
                data-el-id="amberxvid:profile:save-bio"
              >
                {savingBio ? "Saving…" : "Save bio"}
              </Button>
            </>
          ) : (
            <BuddyControls
              me={me}
              user={profile.username}
              relations={relations}
              relate={relate}
              onMessage={onMessage}
            />
          )}
        </Box>
      </Box>
    </Box>
  );

  /* ---------------------------------- page ---------------------------------- */

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 1.25 }}>
      {identityCard}

      <SplitPane
        direction="row"
        initial={300}
        min={220}
        max={480}
        primary="second"
        storageKey="gx:amberxvid.profile.split"
        firstTitle="Wall"
        secondTitle="Shelves"
        first={
          <Box sx={{ height: "100%", minWidth: 0, overflowY: "auto", pr: 1 }}>
            <Wall
              key={profile.username}
              owner={profile.username}
              me={me}
              isAdmin={isAdmin}
              identity={identity}
              refreshTick={wallTick}
            />
          </Box>
        }
        second={
          <Box
            sx={{
              height: "100%",
              minWidth: 0,
              overflowY: "auto",
              pl: 1.25,
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
            }}
          >
            <AlbumsStrip
              owner={profile.username}
              ownerName={profile.screenname}
              mine={mine}
              onOpenAlbums={onOpenAlbums}
            />
            <MediaStrip
              owner={profile.username}
              ownerName={profile.screenname}
              mine={mine}
              liveStream={liveStream ?? null}
              onJoinStream={onJoinStream}
              onOpenRecording={onOpenRecording}
            />
            {/**
             * P19 — contributed shelves (`amberxvid.profile-rail`), under the
             * module's own two. Nothing in the tree contributes one; the slot
             * draws nothing when the registry is empty.
             *
             * The two shelves above were considered for the move and stayed:
             * both take the SHELL's stage-changing callbacks (`onOpenAlbums`,
             * `onJoinStream`, `onOpenRecording`), and widening `ProfileRailHost`
             * to carry them would make the first contribution's needs the
             * contract for every later one. A pane is told whose profile it is
             * and whether it is the viewer's own, and nothing more.
             */}
            <ProfileRailSlot
              host={{
                user: profile.username,
                screenname: profile.screenname,
                me,
                mine,
              }}
            />
          </Box>
        }
      />

      <AvatarDesigner
        open={designerOpen}
        // An AI portrait has none of the 16 axes, so the designer opens at its
        // defaults rather than being force-cast into a spec it cannot read; the
        // stored portrait survives until a spec is actually saved over it.
        initial={isPortrait(avatar) ? null : avatar}
        onClose={() => setDesignerOpen(false)}
        onSave={saveAvatar}
      />
    </Box>
  );
}

/* -------------------------------- albums strip ---------------------------------- */

/**
 * A read-only shelf of the member's albums, each cover a link INTO the photo
 * surface at that album (P10). It draws only what the store's visibility filter
 * returned for this viewer — an album they may not see is simply not in the
 * list, with nothing on screen to suggest it exists.
 */
function AlbumsStrip({
  owner,
  ownerName,
  mine,
  onOpenAlbums,
}: {
  owner: string;
  ownerName: string;
  mine: boolean;
  onOpenAlbums?: (user: string, albumId?: string) => void;
}) {
  const [albums, setAlbums] = React.useState<Album[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Through the album client (P10), not a hand-written fetch: the shelf, the
  // photo surface and the Profiles stage all read the same payload, and three
  // copies of the parse is three places for it to drift.
  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await loadAlbums(owner);
      if (!live) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setAlbums(result.albums);
    })();
    return () => {
      live = false;
    };
  }, [owner]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <AlbumsIcon sx={{ fontSize: 14, color: GX.dim }} />
        <Typography
          sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: GX.dim }}
        >
          Albums{albums ? ` · ${albums.length}` : ""}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {onOpenAlbums && (
          <Button size="small" variant="text" sx={{ fontSize: 10.5 }} onClick={() => onOpenAlbums(owner)}>
            Open
          </Button>
        )}
      </Box>

      {error ? (
        <Typography sx={{ fontSize: 11.5, color: GX.err }}>{error}</Typography>
      ) : albums === null ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 1.5 }}>
          <CircularProgress size={16} />
        </Box>
      ) : albums.length === 0 ? (
        <Typography sx={{ fontSize: 11.5, color: GX.dim }}>
          {mine ? "No albums yet — the Photos stage creates them." : `${ownerName} has no albums.`}
        </Typography>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 0.75 }}>
          {albums.map((album) => {
            const cover = album.coverPhotoId
              ? album.photos.find((p) => p.id === album.coverPhotoId)
              : album.photos[0];
            return (
              <Box
                key={album.id}
                onClick={() => onOpenAlbums?.(owner, album.id)}
                data-el-id={`amberxvid:profile:album:${album.id}`}
                sx={{
                  borderRadius: 1,
                  overflow: "hidden",
                  border: `1px solid ${GX.edge}`,
                  cursor: onOpenAlbums ? "pointer" : "default",
                  bgcolor: GX.panel2,
                  "&:hover": { borderColor: gxa(GX.accent, "66") },
                }}
              >
                <Box sx={{ aspectRatio: "1 / 1", display: "grid", placeItems: "center", bgcolor: gxa(GX.accent, "0a") }}>
                  {cover ? (
                    <Box
                      component="img"
                      src={photoUrl(owner, album.id, cover.id)}
                      alt={album.title}
                      loading="lazy"
                      sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <GizmoXMark size={22} glow={false} />
                  )}
                </Box>
                <Typography
                  sx={{
                    fontSize: 10.5,
                    px: 0.5,
                    py: 0.4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {album.title}
                  {/* Non-public albums say so — a member sharing their own
                      screen is entitled to know which of these a visitor could
                      see. It is only ever drawn for an album this viewer is
                      already looking at, so it reveals nothing. */}
                  {album.visibility !== "public" && (
                    <Typography component="span" sx={{ fontSize: 9.5, color: GX.dim }}>
                      {" "}· {album.visibility}
                    </Typography>
                  )}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/* ------------------------- streams / recordings strip ---------------------------- */

/**
 * What this member has on air and on tape.
 *
 * Today that is: a live stream (the hub knows it, so the shell passes it in)
 * and — on your OWN profile — your recent captures. The recordings route serves
 * a member only their own, so on somebody else's profile the strip states that
 * rather than drawing an empty grid, which would read as "they have none". P12
 * is what turns this into public streams and their recordings.
 */
function MediaStrip({
  owner,
  ownerName,
  mine,
  liveStream,
  onJoinStream,
  onOpenRecording,
}: {
  owner: string;
  ownerName: string;
  mine: boolean;
  liveStream: { id: string; title: string } | null;
  onJoinStream?: (streamId: string) => void;
  onOpenRecording?: (recordingId: string) => void;
}) {
  const [recordings, setRecordings] = React.useState<RecordingManifest[] | null>(null);

  React.useEffect(() => {
    if (!mine) {
      setRecordings(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/amberxvid/recordings");
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; recordings?: RecordingManifest[] }
          | null;
        if (!live) return;
        const rows = (json?.recordings ?? [])
          .filter((r) => lower(r.owner) === lower(owner) && r.endedAt !== null)
          .slice(0, 6);
        setRecordings(rows);
      } catch {
        if (live) setRecordings([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [mine, owner]);

  const thumbUrl = (id: string): string => `/api/amberxvid/recordings/${id}/file?kind=thumb`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <StreamIcon sx={{ fontSize: 14, color: GX.dim }} />
        <Typography
          sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: GX.dim }}
        >
          Streams &amp; recordings
        </Typography>
      </Box>

      {liveStream && (
        <Box
          onClick={() => onJoinStream?.(liveStream.id)}
          data-el-id={`amberxvid:profile:live:${liveStream.id}`}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            p: 0.75,
            borderRadius: 1,
            border: `1px solid ${gxa(GX.err, "66")}`,
            bgcolor: gxa(GX.err, "12"),
            cursor: onJoinStream ? "pointer" : "default",
          }}
        >
          <GxChip label="live" kind="err" />
          <Typography
            sx={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {liveStream.title}
          </Typography>
        </Box>
      )}

      {!mine ? (
        <Typography sx={{ fontSize: 11.5, color: GX.dim }}>
          {liveStream
            ? `${ownerName} is on air now.`
            : `${ownerName}'s recordings are private to them.`}
        </Typography>
      ) : recordings === null ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 1.5 }}>
          <CircularProgress size={16} />
        </Box>
      ) : recordings.length === 0 ? (
        <Typography sx={{ fontSize: 11.5, color: GX.dim }}>
          No finished captures yet — the Recorder stage makes them.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {recordings.map((r) => (
            <Box
              key={r.id}
              onClick={() => onOpenRecording?.(r.id)}
              data-el-id={`amberxvid:profile:recording:${r.id}`}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                p: 0.5,
                borderRadius: 1,
                border: `1px solid ${GX.edge}`,
                cursor: onOpenRecording ? "pointer" : "default",
                "&:hover": { borderColor: gxa(GX.accent, "66") },
              }}
            >
              <Box
                sx={{
                  width: 44,
                  height: 30,
                  borderRadius: 0.5,
                  overflow: "hidden",
                  flexShrink: 0,
                  bgcolor: gxa(GX.accent, "12"),
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {r.thumbnail ? (
                  <Box
                    component="img"
                    src={thumbUrl(r.id)}
                    alt={r.title}
                    loading="lazy"
                    sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <PlayIcon sx={{ fontSize: 15, color: GX.accent }} />
                )}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  sx={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {r.title}
                </Typography>
                <Typography sx={{ fontSize: 9.5, color: GX.dim }}>
                  {new Date(r.startedAt).toLocaleDateString()} · {Math.round(r.durationS)}s
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
