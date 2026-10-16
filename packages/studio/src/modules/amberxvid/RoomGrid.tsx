"use client";

/**
 * @file The group-room GRID (P11) — pages of up to 49 tiles (7×7), and the
 * invariant that is the whole difference between a room of 100 people and a
 * melted laptop.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT
 * ---------------------------------------------------------------------------
 * **A page consumes only its visible participants' video, at the simulcast
 * layer that fits the tile it will be drawn in, and turning a page closes the
 * outgoing page's consumers BEFORE opening the next one's.**
 *
 * Everything else in this file is presentation; that sentence is the design.
 * The reasoning, because a future session WILL be tempted to "simplify" it by
 * consuming the whole roster and just hiding the tiles:
 *
 *   - a video consumer is not free when it is off-screen. It is a decoder, a
 *     jitter buffer and a live downstream — the bytes arrive and the frames are
 *     decoded whether or not a `<video>` is painted with them;
 *   - so consuming a 200-member room costs 200 decoders on every laptop in it,
 *     and 200 downstreams per member on the server (40 000 fan-outs for the
 *     room). Consuming one page costs 49, and 49 does not grow with the room;
 *   - the simulcast layer matters for the same reason at a smaller scale: a
 *     140-px tile fed the top spatial layer is a 720p decode thrown away in the
 *     scaler. `LAYER_FOR_COLUMNS` picks the layer from the tile size, so a
 *     49-up page runs on the LOWEST layer and a maximised tile on the top.
 *
 * The grid does not manage consumers — it OWNS THE PAGE and reports it. It
 * calls `onVisibleChange(users, layer)` whenever the visible set or the fitting
 * layer changes, and the room engine reconciles: close what left, then open
 * what arrived. Keeping the two apart is what lets the engine make the closing
 * strictly precede the opening, which a component re-render could not promise.
 *
 * `RoomGridStats` renders the assertion as a DEV OVERLAY: video consumers
 * against visible tiles, red the moment the first exceeds the second. A guard
 * nobody can watch fail is a guard nobody has tested, and this one is cheap to
 * watch — it is on screen while you use the room.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TILE KNOWS
 * ---------------------------------------------------------------------------
 * Identity comes from the ROOM RECORD's roster and never from media
 * (`MEDIA_CONTRACT.identity`): the name chip, the host badge and the seat are
 * the server's answer to "who is here". The media snapshot supplies only what
 * their producers are doing — present, paused, gone — so a tile is the join of
 * two server facts and no client claim.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { NavigateBefore as PrevIcon } from "./kit/icons";
import { NavigateNext as NextIcon } from "./kit/icons";
import { Fullscreen as MaximiseIcon } from "./kit/icons";
import { FullscreenExit as RestoreIcon } from "./kit/icons";
import { VolumeOff as MutedIcon } from "./kit/icons";
import { VideocamOff as CamOffIcon } from "./kit/icons";
import { Warning as WarningIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip } from "./kit/ax";
import { VideoSurface } from "./VideoChat";
import { RoomTileBadges } from "./PointSlots";
import AvatarView from "./Avatar";
import { ROOM_PAGE_TILES } from "./lib/types";
import type { GroupRoomInfo, Profile, RoomMember } from "./lib/types";
// The arithmetic lives in `lib/` so a test can pin it — see its header. A
// component file cannot be loaded by the harness, and an invariant nothing can
// load is an invariant nothing checks.
import { columnsFor, layerForColumns, pageCountFor } from "./lib/roomGrid";

/* ----------------------------------- tiles ------------------------------------- */

/**
 * What a tile is doing, in the order of "how much does the viewer need to be
 * told". Each state is a DIFFERENT sentence on screen — the one thing this must
 * never do is render a frozen last frame and let it pass for live.
 */
export type TileState =
  /** Media is flowing. */
  | "live"
  /** Their video producer is PAUSED — server-known, from the snapshot. The
   *  tile drops to their avatar; it does not freeze on the last frame. */
  | "camera-off"
  /** Seated in the room record, but no video producer has appeared yet —
   *  joining, or publishing failed. Honest, and usually brief. */
  | "waiting"
  /** Our own media leg is down. Every tile says so rather than sitting on a
   *  still image that will never update again. */
  | "lost";

export interface RoomTileData {
  /** Normalized username — the roster key, and the React key. */
  user: string;
  displayName: string;
  role: RoomMember["role"];
  /** True for the local participant: their own camera, mirrored and muted. */
  me: boolean;
  state: TileState;
  /** The consumed (or, for `me`, captured) media. Null in every state but
   *  `live` — a tile with a stream it must not show is how a frozen frame
   *  survives a state change. */
  stream: MediaStream | null;
  /** Their audio producer is paused — server-known, same source as the video
   *  pause. Muted is a badge, not a state: a muted person is still live. */
  micMuted: boolean;
  /** Audio energy over the last few hundred ms crossed the speaking threshold. */
  speaking: boolean;
}

function tileSentence(state: TileState): string {
  switch (state) {
    case "camera-off":
      return "camera off";
    case "waiting":
      return "joining…";
    case "lost":
      return "media link down";
    default:
      return "";
  }
}

/**
 * One tile. Memoised on purpose and it is not a micro-optimisation: a page of
 * 49 tiles re-renders on every roster read, every speaking-level tick and every
 * snapshot, and a `<video>` whose element identity churns re-attaches its
 * `srcObject` — which is a visible black flash on a live call. The memo is what
 * makes "join/leave reflows without disturbing unaffected tiles" true in the
 * DOM as well as in the transport.
 */
const RoomTile = React.memo(function RoomTile({
  tile,
  profile,
  screenname,
  compact,
  onMaximise,
  onContextMenu,
}: {
  tile: RoomTileData;
  profile: Profile | undefined;
  screenname: string;
  /** 5+ columns: badges shrink to icons and the name chip loses its detail. */
  compact: boolean;
  onMaximise: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const showVideo = tile.state === "live" && tile.stream !== null;
  const sentence = tileSentence(tile.state);

  /**
   * What a contributed badge is told about this participant (P19) — the
   * roster's facts, restated as the point's own vocabulary rather than the
   * grid's internal record. Two reasons for the copy: `RoomTileData` carries a
   * live `MediaStream`, which no contribution has any business holding, and
   * widening this component's internal tile shape should not silently widen a
   * public contract.
   *
   * Memoised on the fields it reads, not on `tile` — the tile object is rebuilt
   * on every roster read while these six values change rarely, so this is what
   * keeps `appliesTo` off the speaking-tick path.
   */
  const badgeFacts = React.useMemo(
    () => ({
      user: tile.user,
      displayName: screenname,
      role: tile.role,
      me: tile.me,
      speaking: tile.speaking,
      micMuted: tile.micMuted,
      cameraOff: tile.state === "camera-off",
      lost: tile.state === "lost",
    }),
    [tile.user, screenname, tile.role, tile.me, tile.speaking, tile.micMuted, tile.state],
  );

  return (
    <Box
      onDoubleClick={onMaximise}
      onContextMenu={onContextMenu}
      /**
       * A tile is a MEMBER inside a ROOM, and the declared map is built out of
       * exactly that nesting (P15): the tile marks `amberxvid.member`, the grid
       * around it marks `amberxvid.room`, and one right-click therefore composes
       * the member's rows, the room's and the suite's — in that order, with no
       * area repeating another's.
       *
       * `data-axf-room-user` rather than reusing `data-axf-member`: *Remove from
       * room* is a ROOM row that needs to know which participant, and giving it
       * its own name keeps it unambiguous when a member chip is nested inside
       * something else that also names a person.
       */
      data-axf-area="amberxvid.member"
      data-axf-member={tile.user}
      data-axf-member-name={screenname}
      data-axf-room-user={tile.user}
      data-el-id={`amberxvid:room:tile:${tile.user}`}
      sx={{
        position: "relative",
        aspectRatio: "16 / 9",
        minHeight: 0,
        bgcolor: "#000",
        borderRadius: 0.8,
        overflow: "hidden",
        cursor: "pointer",
        // The speaking ring is a border rather than a glow so it costs no
        // repaint of anything underneath it at 4 Hz across 49 tiles.
        border: `2px solid ${
          tile.speaking ? GX.accent : tile.state === "lost" ? gxa(GX.err, "88") : gxa(GX.edge, "88")
        }`,
      }}
    >
      {showVideo ? (
        <VideoSurface stream={tile.stream} muted={tile.me} mirror={tile.me} />
      ) : (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.6,
            px: 1,
          }}
        >
          <AvatarView spec={profile?.avatar ?? null} name={screenname} size={compact ? 34 : 54} />
          {!compact && sentence ? (
            <Typography
              sx={{
                fontFamily: GX.mono,
                fontSize: 10,
                color: tile.state === "lost" ? GX.err : GX.dim,
                display: "flex",
                alignItems: "center",
                gap: 0.4,
              }}
            >
              {tile.state === "lost" ? <WarningIcon sx={{ fontSize: 12 }} /> : null}
              {sentence}
            </Typography>
          ) : null}
        </Box>
      )}

      {/* name chip — from the ROSTER, never from the media */}
      <Box
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          gap: 0.4,
          px: 0.6,
          py: 0.3,
          background: "linear-gradient(to top, #000c, #0000)",
        }}
      >
        <Typography
          sx={{
            fontSize: compact ? 9.5 : 11,
            fontWeight: 600,
            color: tile.me ? GX.accent : GX.ink,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {screenname}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {/**
         * P19 — contributed badges (`amberxvid.room-tile-badge`). The HOST
         * badge used to be the string `" · host"` concatenated onto the name
         * above, and dropped entirely in compact mode, so a five-column page
         * said nothing about who called the meeting. It is now a contribution
         * like any other and survives compact mode as its glyph.
         *
         * The point carries no component on purpose: this strip redraws with
         * every roster read, speaking tick and media snapshot across up to 49
         * tiles, and a `Suspense` fence per badge per tile inside that path is
         * exactly what the tile memo exists to avoid. A badge answers with a
         * label or null; the host draws it.
         */}
        <RoomTileBadges tile={badgeFacts} compact={compact} />
        {tile.micMuted ? <MutedIcon sx={{ fontSize: compact ? 11 : 13, color: GX.err }} /> : null}
        {tile.state === "camera-off" ? (
          <CamOffIcon sx={{ fontSize: compact ? 11 : 13, color: GX.dim }} />
        ) : null}
      </Box>
    </Box>
  );
});

/* ---------------------------------- the grid ------------------------------------ */

export interface RoomGridProps {
  room: GroupRoomInfo;
  /** One entry per SEAT, roster order — the grid pages this, the engine
   *  supplies the media state for whichever slice is visible. */
  tiles: RoomTileData[];
  profiles: Record<string, Profile>;
  screennameFor: (user: string) => string;
  /**
   * The page changed: these are the users whose VIDEO should be consumed, and
   * the simulcast layer their tiles fit. The engine closes what left before
   * opening what arrived — see the header.
   */
  onVisibleChange: (users: string[], layer: number) => void;
  /** Live counters for the dev overlay's assertion. */
  videoConsumers: number;
  audioConsumers: number;
  onTileContextMenu?: (e: React.MouseEvent, tile: RoomTileData) => void;
}

/**
 * The paginated grid. Pagination is click (the arrows), keyboard (←/→ and
 * PageUp/PageDown, Home/End) and double-click to maximise one tile.
 *
 * MAXIMISING IS A PAGE OF ONE, not an overlay on top of a page: it reports a
 * single visible user at the top layer, so the other 48 consumers close while
 * one tile is being looked at closely. An overlay would have kept all 49 open
 * to show one — the invariant applies to what you are LOOKING at, not to what
 * the grid happens to have laid out.
 */
export default function RoomGrid({
  room,
  tiles,
  profiles,
  screennameFor,
  onVisibleChange,
  videoConsumers,
  audioConsumers,
  onTileContextMenu,
}: RoomGridProps) {
  const [page, setPage] = React.useState(0);
  const [maximised, setMaximised] = React.useState<string | null>(null);
  const frameRef = React.useRef<HTMLDivElement | null>(null);

  const pages = pageCountFor(tiles.length);
  // Clamp rather than reset: people leaving while you are on page 3 of 3 should
  // land you on the new last page, not back at page 1 mid-conversation.
  const current = Math.min(page, pages - 1);
  React.useEffect(() => {
    if (page !== current) setPage(current);
  }, [page, current]);

  // A maximised member who leaves the room has to release the stage, or the
  // grid stays stuck on a tile for somebody who is gone.
  React.useEffect(() => {
    if (maximised && !tiles.some((t) => t.user === maximised)) setMaximised(null);
  }, [maximised, tiles]);

  const pageTiles = React.useMemo(
    () => tiles.slice(current * ROOM_PAGE_TILES, current * ROOM_PAGE_TILES + ROOM_PAGE_TILES),
    [tiles, current],
  );
  const maxTile = maximised ? tiles.find((t) => t.user === maximised) ?? null : null;
  const shown = maxTile ? [maxTile] : pageTiles;
  const columns = maxTile ? 1 : columnsFor(shown.length);
  const layer = layerForColumns(columns);

  /* ------------------------- the invariant, reported ------------------------- */

  // Effect, not render: this is a message to the transport, and a transport
  // message sent during render is a message sent for every discarded render
  // too. The join key is what keeps it from firing on unrelated roster reads —
  // a member's NAME changing must not turn 49 consumers over.
  const visibleUsers = React.useMemo(() => shown.map((t) => t.user), [shown]);
  const visibleKey = visibleUsers.join(",");
  React.useEffect(() => {
    onVisibleChange(visibleKey ? visibleKey.split(",") : [], layer);
    // `visibleKey` IS the identity of `visibleUsers`; depending on the array
    // itself would fire on every render that rebuilt it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, layer, onVisibleChange]);

  /* -------------------------------- keyboard --------------------------------- */

  const turn = React.useCallback(
    (delta: number) => {
      setMaximised(null);
      setPage((p) => Math.min(Math.max(p + delta, 0), pages - 1));
    },
    [pages],
  );

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      turn(1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      turn(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setMaximised(null);
      setPage(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setMaximised(null);
      setPage(pages - 1);
    } else if (e.key === "Escape" && maximised) {
      e.preventDefault();
      setMaximised(null);
    }
  };

  const compact = columns >= 5;

  return (
    <Box
      // The declared `amberxvid.room` area (P15) wraps the WHOLE grid, pager
      // included, so a right-click on the empty space between tiles still knows
      // which room it is in. The tiles inside mark themselves as members.
      data-axf-area="amberxvid.room"
      data-axf-room={room.id}
      data-axf-room-host={room.host}
      sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}
    >
      <Box
        ref={frameRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-el-id="amberxvid:room:grid"
        sx={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          bgcolor: "#000",
          p: 0.6,
          outline: "none",
          "&:focus-visible": { boxShadow: `inset 0 0 0 2px ${gxa(GX.accent, "88")}` },
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 0.6,
          alignContent: "center",
        }}
      >
        {shown.length === 0 ? (
          <Typography sx={{ color: GX.dim, fontFamily: GX.mono, fontSize: 12, textAlign: "center" }}>
            nobody in the room yet
          </Typography>
        ) : (
          shown.map((tile) => (
            <RoomTile
              key={tile.user}
              tile={tile}
              profile={profiles[tile.user]}
              screenname={screennameFor(tile.user)}
              compact={compact && !maxTile}
              onMaximise={() => setMaximised((m) => (m === tile.user ? null : tile.user))}
              onContextMenu={(e) => onTileContextMenu?.(e, tile)}
            />
          ))
        )}

        {maxTile ? (
          <Tooltip title="back to the grid (Esc)">
            <IconButton
              size="small"
              onClick={() => setMaximised(null)}
              data-el-id="amberxvid:room:restore"
              sx={{ position: "absolute", right: 8, top: 8, bgcolor: "#000a" }}
            >
              <RestoreIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>

      {/* pager + the invariant's own readout */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.8,
          px: 1,
          py: 0.5,
          borderTop: `1px solid ${GX.edge}`,
        }}
      >
        <Tooltip title="previous page (←)">
          <span>
            <IconButton
              size="small"
              disabled={current === 0 || maxTile !== null}
              onClick={() => turn(-1)}
              data-el-id="amberxvid:room:page-prev"
            >
              <PrevIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Typography
          sx={{ fontFamily: GX.mono, fontSize: 11, color: GX.dim, fontVariantNumeric: "tabular-nums" }}
          data-el-id="amberxvid:room:page-label"
        >
          {maxTile
            ? `${screennameFor(maxTile.user)} · maximised`
            : `page ${current + 1}/${pages} · ${shown.length} of ${tiles.length} in view`}
        </Typography>
        <Tooltip title="next page (→)">
          <span>
            <IconButton
              size="small"
              disabled={current >= pages - 1 || maxTile !== null}
              onClick={() => turn(1)}
              data-el-id="amberxvid:room:page-next"
            >
              <NextIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
        {!maxTile && shown.length > 1 ? (
          <Tooltip title="double-click a tile to maximise it">
            <MaximiseIcon sx={{ fontSize: 14, color: GX.dim }} />
          </Tooltip>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <RoomGridStats
          visibleTiles={shown.length}
          videoConsumers={videoConsumers}
          audioConsumers={audioConsumers}
          members={room.members.length}
        />
      </Box>
    </Box>
  );
}

/* --------------------------------- dev overlay ---------------------------------- */

/**
 * The invariant, asserted where a person can see it fail.
 *
 * `video ≤ visible` is the assertion the step asks for, and it is stated as an
 * inequality rather than an equality on purpose: a tile whose producer has not
 * appeared yet (`waiting`) legitimately has no consumer, so fewer is fine and
 * MORE is the bug. When it goes red, something is opening consumers the page
 * did not ask for — which is the failure that scales into a melted laptop.
 *
 * AUDIO IS COUNTED SEPARATELY AND DELIBERATELY IS NOT BOUND BY THE PAGE.
 * Consuming only the visible page's audio would silence everybody on another
 * page, and a meeting where you cannot hear the person talking because they are
 * on page 2 is not a meeting. Audio is roster-scoped up to its own cap
 * (`ROOM_AUDIO_CONSUMERS` in `./GroupRoom`) — it is a fraction of a percent of
 * the bytes and none of the decode cost that the video invariant exists to
 * bound. The honest limitation, stated rather than hidden: past that cap you
 * hear the earliest joiners, and the real fix is server-side dominant-speaker
 * selection, which belongs in the media server.
 *
 * Shown in development by default, and toggleable anywhere: the counter is
 * exactly as useful on a real deployment with a real room in it, and the
 * cheapest possible way to answer "is it actually doing that?".
 */
export function RoomGridStats({
  visibleTiles,
  videoConsumers,
  audioConsumers,
  members,
}: {
  visibleTiles: number;
  videoConsumers: number;
  audioConsumers: number;
  members: number;
}) {
  const [shown, setShown] = React.useState(process.env.NODE_ENV !== "production");
  const held = videoConsumers <= visibleTiles;

  if (!shown) {
    return (
      <Typography
        onClick={() => setShown(true)}
        data-el-id="amberxvid:room:stats-show"
        sx={{ fontFamily: GX.mono, fontSize: 9.5, color: GX.dim, cursor: "pointer", opacity: 0.6 }}
      >
        consumers
      </Typography>
    );
  }

  return (
    <Box
      onClick={() => setShown(false)}
      data-el-id="amberxvid:room:stats"
      sx={{ display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer" }}
    >
      <GxChip
        label={`video ${videoConsumers} ${held ? "≤" : ">"} ${visibleTiles} visible`}
        kind={held ? "ok" : "err"}
      />
      <GxChip label={`audio ${audioConsumers}/${members}`} kind="dim" />
    </Box>
  );
}
