"use client";

/**
 * @file **The slots** — where contributions actually reach the screen (P19).
 *
 * `points.ts` holds the payload types and the readers; this holds the JSX,
 * because that file must stay `.ts` (the same split `amberart/host.ts` and
 * `claude-workspace/points.ts` make, for the same reason). Every screen edit in
 * this phase is therefore one import and one element — the mounting rules, the
 * boundaries, the empty cases and the ordering all live here rather than being
 * re-decided in seven files.
 *
 * ## Every slot renders NOTHING when nothing is contributed
 *
 * Not an empty box, not a divider, not a heading with no body. Three of the
 * eight points ship with no in-tree consumer on purpose (see the decl), so
 * "empty" is the normal state for them and it must cost no pixels. That is also
 * what makes adding these slots to seven live screens a safe edit: on a tree
 * with no plugins installed, six of the seven draw exactly what they drew
 * before.
 *
 * ## Every mounted contribution is fenced
 *
 * A `load`ed component is somebody else's code inside this module's screen, so
 * each one gets core's `Boundary` at `contribution` tier, named with the
 * contributor and the point. A plugin that throws loses its own pane and takes
 * nothing else with it — the property the three-tier boundary work
 * (core 0.0.4) exists to provide, applied at the tier it was built for.
 *
 * `Suspense` is per contribution rather than per slot for the same reason: one
 * slow chunk must not hold up its neighbours.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Boundary, Glyph } from "@axf/core";

import { GX, gxa } from "./kit/gx";
import { GxCard } from "./kit/ax";
import {
  useAdminTools,
  useMessengerActions,
  useProfileRails,
  useRoomTileBadges,
  useSettingsSections,
  useStreamTools,
  useWallComposerActions,
  type AdminToolHost,
  type MessageFacts,
  type MessengerActionHost,
  type Notify,
  type PointTone,
  type ProfileRailHost,
  type RoomTileFacts,
  type StreamToolHost,
  type WallComposerHost
} from "./points";

/** Tone name → the live theme variable. A contribution names a role; the theme
 *  owns the colour. This is the whole reason `tone` is a union of names rather
 *  than a string a plugin could put a hex in. */
const TONE: Record<PointTone, string> = {
  accent: GX.accent,
  ok: GX.ok,
  warn: GX.warn,
  err: GX.err,
  dim: GX.dim
};

/** One mounted contribution, fenced and suspended. Written once; every
 *  `load`-carrying slot below goes through it. */
function Mount({
  from,
  point,
  children
}: {
  from: string;
  point: string;
  children: React.ReactNode;
}) {
  return (
    <Boundary tier="contribution" source={`${from} → ${point}`} compact>
      <React.Suspense fallback={null}>{children}</React.Suspense>
    </Boundary>
  );
}

/* ═════════════════════════════════ profile rail ══════════════════════════ */

/**
 * Contributed shelves, under the albums and media shelves on a profile's
 * Shelves column. Each is wrapped in the same `GxCard` the built-in shelves
 * use, so a plugin's pane reads as part of the column rather than as a guest
 * in it — the pane supplies the body, the host supplies the frame.
 */
export function ProfileRailSlot({ host }: { host: ProfileRailHost }) {
  const rails = useProfileRails();
  if (rails.length === 0) return null;
  return (
    <>
      {rails.map(({ id, title, glyph, from, Component }) => (
        <GxCard
          key={`${from}:${id}`}
          title={title}
          meta={glyph ? <Glyph id={glyph} size={14} /> : undefined}
          collapsible
          storageKey={`amberxvid.profile-rail.${id}`}
        >
          <Mount from={from} point="amberxvid.profile-rail">
            <Component host={host} />
          </Mount>
        </GxCard>
      ))}
    </>
  );
}

/* ══════════════════════════════════ stream tool ══════════════════════════ */

/**
 * Contributed controls in the stream room's control bar. The `audience` filter
 * is already applied by `useStreamTools` — this only draws what belongs on the
 * side of the broadcast the caller is on.
 */
export function StreamToolSlot({ host }: { host: StreamToolHost }) {
  const tools = useStreamTools(host.hosting);
  if (tools.length === 0) return null;
  return (
    <>
      {tools.map(({ id, from, Component }) => (
        <Mount key={`${from}:${id}`} from={from} point="amberxvid.stream-tool">
          <Component host={host} />
        </Mount>
      ))}
    </>
  );
}

/* ═══════════════════════════════ room tile badge ═════════════════════════ */

/**
 * Badges on one participant tile, drawn into the name strip.
 *
 * No `Boundary` and no `Suspense`, and that is the point of this point: there
 * is no contributed component to fence. `appliesTo` is a pure function the host
 * calls; a badge that returns null is not drawn, and one that returns a label
 * gets a `Glyph` and (outside compact mode) a word, both painted by the host.
 *
 * `compact` — five or more columns — drops the words and keeps the icons,
 * matching what the tile's own mute and camera indicators already do.
 */
export function RoomTileBadges({ tile, compact }: { tile: RoomTileFacts; compact: boolean }) {
  const badges = useRoomTileBadges();
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((badge) => {
        const label = badge.appliesTo(tile);
        if (label === null) return null;
        const colour = TONE[badge.tone ?? "dim"];
        return (
          <Tooltip key={badge.id} title={label}>
            <Box
              data-el-id={`amberxvid:room:tile-badge:${badge.id}`}
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, color: colour }}
            >
              <Glyph id={badge.glyph} size={compact ? 11 : 13} />
              {!compact && (
                <Typography sx={{ fontSize: 9.5, fontWeight: 700, color: colour, fontFamily: GX.mono }}>
                  {label}
                </Typography>
              )}
            </Box>
          </Tooltip>
        );
      })}
    </>
  );
}

/* ═════════════════════════════ wall composer action ══════════════════════ */

/**
 * Contributed actions in the wall composer's button row.
 *
 * `run` may be async, so each button disables itself while its own action is in
 * flight — a contribution that opens a dialog or calls a route must not be
 * clickable four times on the way there. A returned string is handed back to
 * the composer through `onInsert`; the composer, not the contribution, decides
 * what appending means.
 */
export function WallComposerActions({
  host,
  onInsert,
  disabled
}: {
  host: WallComposerHost;
  onInsert: (text: string) => void;
  disabled?: boolean;
}) {
  const actions = useWallComposerActions();
  const [busy, setBusy] = React.useState<string | null>(null);
  if (actions.length === 0) return null;
  return (
    <>
      {actions.map(({ payload, from }) => (
        <Button
          key={`${from}:${payload.id}`}
          size="small"
          variant="outlined"
          disabled={disabled || busy === payload.id}
          startIcon={payload.glyph ? <Glyph id={payload.glyph} size={14} /> : undefined}
          onClick={() => {
            setBusy(payload.id);
            void (async () => {
              try {
                const text = await payload.run(host);
                if (text) onInsert(text);
              } finally {
                setBusy(null);
              }
            })();
          }}
          data-el-id={`amberxvid:wall:composer-action:${payload.id}`}
          sx={{ fontSize: 11.5 }}
        >
          {payload.label}
        </Button>
      ))}
    </>
  );
}

/* ══════════════════════════════ messenger action ═════════════════════════ */

/**
 * The action strip on one message bubble — icon buttons, appearing on hover.
 *
 * Absolutely positioned OUTSIDE the bubble's own padding so it never reflows
 * the text: a strip that pushed a paragraph around as the pointer crossed it
 * would make a conversation twitch. It sits on the side the bubble is not
 * aligned to, so it never covers the timestamp.
 *
 * Hidden by `opacity` rather than unmounted, because mounting a control under
 * the pointer is how a click lands on the thing that was there a frame ago.
 */
export function MessageActions({
  message,
  host,
  mine
}: {
  message: MessageFacts;
  host: MessengerActionHost;
  mine: boolean;
}) {
  const actions = useMessengerActions();
  const shown = actions.filter((a) => (a.appliesTo ? a.appliesTo(message) : true));
  if (shown.length === 0) return null;
  return (
    <Box
      className="axv-msg-actions"
      sx={{
        position: "absolute",
        top: 2,
        ...(mine ? { left: -6, transform: "translateX(-100%)" } : { right: -6, transform: "translateX(100%)" }),
        display: "flex",
        gap: 0.15,
        opacity: 0,
        transition: "opacity 120ms",
        pointerEvents: "none"
      }}
    >
      {shown.map((action) => (
        <Tooltip key={action.id} title={action.label}>
          <IconButton
            size="small"
            onClick={() => void action.run(message, host)}
            aria-label={action.label}
            data-el-id={`amberxvid:messenger:action:${action.id}`}
            sx={{ p: 0.3, color: GX.dim, "&:hover": { color: GX.accent } }}
          >
            <Glyph id={action.glyph} size={13} />
          </IconButton>
        </Tooltip>
      ))}
    </Box>
  );
}

/** The `sx` a message bubble adds to reveal its strip on hover. Exported so the
 *  bubble and the strip agree on the class name in one place rather than two. */
export const MESSAGE_ACTIONS_HOVER_SX = {
  "&:hover .axv-msg-actions": { opacity: 1, pointerEvents: "auto" }
} as const;

/* ═════════════════════════════ settings section ══════════════════════════ */

/**
 * Contributed cards at the foot of the settings stage.
 *
 * A section draws its OWN card, unlike a profile shelf. That is not an
 * inconsistency — it follows from what the point is for: a section owns its own
 * DOCUMENT (a balance, a device, a licence) and therefore its own header, its
 * own empty state and its own refusals. The built-in credits pane is a `GxCard`
 * already and says in its docblock exactly why it cannot be a preference group.
 *
 * `title`, `summary` and `glyph` are declared anyway, and deliberately not
 * rendered here: they let the stage — and the framework's own settings dialog —
 * say what is on this screen without loading every contributed chunk to find
 * out. Metadata a host can read without executing the contribution is the point
 * of declaring a point at all.
 */
export function SettingsSections({ notify }: { notify: Notify }) {
  const sections = useSettingsSections();
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map(({ id, from, Component }) => (
        <Mount key={`${from}:${id}`} from={from} point="amberxvid.settings-section">
          <Component notify={notify} />
        </Mount>
      ))}
    </>
  );
}

/* ═══════════════════════════════════ admin tool ══════════════════════════ */

/**
 * Contributed moderation tools, as cards in the wing's Tools tab. The tab
 * itself only exists when this returns something — the wing asks
 * `useAdminTools().length` for that, so the tab's presence and its contents can
 * never disagree.
 */
export function AdminTools({ host }: { host: AdminToolHost }) {
  const tools = useAdminTools();
  if (tools.length === 0) return null;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      {tools.map(({ id, title, summary, glyph, from, Component }) => (
        <GxCard
          key={`${from}:${id}`}
          title={title}
          meta={
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              {glyph ? <Glyph id={glyph} size={13} /> : null}
              <Typography sx={{ fontSize: 10, color: GX.dim, fontFamily: GX.mono }}>{from}</Typography>
            </Box>
          }
          sx={{ borderColor: gxa(GX.edge, "88") }}
        >
          {summary && <Typography sx={{ fontSize: 10.5, color: GX.dim, pb: 0.75 }}>{summary}</Typography>}
          <Mount from={from} point="amberxvid.admin-tool">
            <Component host={host} />
          </Mount>
        </GxCard>
      ))}
    </Box>
  );
}

export { useAdminTools };
