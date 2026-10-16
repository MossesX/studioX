/**
 * @file **The module's own contributions to its own points** (P19, 2026-08-15).
 *
 * Data only — payloads, `load` thunks and plain functions, no component and no
 * JSX. That is what keeps this file importable by plain Node, the rule
 * `adminTab.ts` and `creditsMeterContributions.ts` explain at length and the one
 * `amberart.tool` learned the hard way: a field holding a component drags a
 * `.tsx` into a data import, and Node's type stripping does not transform JSX.
 *
 * ## Why a module contributes to points it declares
 *
 * The owner's standing model, applied to surfaces: **one default ships; the
 * rest install as plugins**. So the built-ins go through the door a plugin
 * would use rather than being wired in behind it. That buys three things:
 *
 *   - **The points are proven.** Five of the eight are rendered through by
 *     something real. A point nobody has rendered through is a guess, and a
 *     guess is where the missing field is.
 *   - **"What is on this screen" is answerable.** The registry lists the
 *     built-in follow control and the built-in host badge next to a plugin's,
 *     which is what the peel and any future "what plugs in here" surface need.
 *   - **A built-in cannot quietly be more privileged than a plugin.** It gets
 *     the same narrow host, validated by the same `requires`.
 *
 * Each of these MOVED an existing inline piece rather than adding a feature —
 * the follow button, the host badge, the credits card and the (dead) copy-text
 * row. Nothing on screen is new; what changed is which door it comes through.
 *
 * Registered in `src/studio.subsystem.ts`'s one contributions loop, alongside
 * every other contribution in the app. The module imports none of this — the
 * registry is the only link, which is the property that makes the closure
 * computable.
 */
import type { Contribution } from "@axf/core";

import {
  AMBERXVID_MESSENGER_ACTION_POINT,
  AMBERXVID_ROOM_TILE_BADGE_POINT,
  AMBERXVID_SETTINGS_SECTION_POINT,
  AMBERXVID_STREAM_TOOL_POINT
} from "./amberxvid.decl";
import type {
  MessengerActionPayload,
  RoomTileBadgePayload,
  SettingsSectionPayload,
  StreamToolPayload
} from "./points";

/**
 * **Follow the streamer** → `amberxvid.stream-tool`.
 *
 * `audience: "viewer"`: a follow button on your own broadcast is a control with
 * no meaning. See `FollowTool.tsx` for why it left the identity row.
 */
export const AMBERXVID_FOLLOW_TOOL: Contribution<StreamToolPayload> = {
  from: "amberxvid",
  point: AMBERXVID_STREAM_TOOL_POINT,
  priority: 10,
  payload: {
    id: "amberxvid-follow",
    title: "Follow the streamer",
    glyph: "icon-sparkle",
    audience: "viewer",
    load: () => import("./FollowTool")
  }
};

/**
 * **The host badge** → `amberxvid.room-tile-badge`.
 *
 * Previously the string `" · host"` concatenated onto the screenname in
 * `RoomGrid.tsx`, and dropped entirely in compact mode — so on a five-column
 * page nothing said who called the meeting. As a badge it survives compact mode
 * as the glyph alone, exactly like the mute and camera indicators beside it.
 *
 * `appliesTo` is called inside a memoised tile on a live call, once per tile per
 * render, so it is one comparison and nothing else. The point carries no
 * component precisely so that this stays true no matter who contributes next.
 */
export const AMBERXVID_HOST_TILE_BADGE: Contribution<RoomTileBadgePayload> = {
  from: "amberxvid",
  point: AMBERXVID_ROOM_TILE_BADGE_POINT,
  priority: 10,
  payload: {
    id: "amberxvid-host",
    glyph: "icon-bolt",
    tone: "accent",
    appliesTo: (tile) => (tile.role === "host" ? "host" : null)
  }
};

/**
 * **AI credits** → `amberxvid.settings-section`.
 *
 * `CreditsPane`'s own docblock had already argued itself onto this point before
 * the point existed: it is deliberately not a `PREF_GROUP`, because those are
 * keys in one of the three settings stores and a balance is a fact about the
 * account rather than a preference. It was expressed as a hard-coded element
 * after the group loop — one line of "and also this", which is the shape a
 * point replaces.
 *
 * Its props are `{ notify }`, which is the whole `SettingsSectionPayload` host.
 * The pane needed no edit at all to move; only its call site did.
 */
export const AMBERXVID_CREDITS_SECTION: Contribution<SettingsSectionPayload> = {
  from: "amberxvid",
  point: AMBERXVID_SETTINGS_SECTION_POINT,
  priority: 10,
  payload: {
    id: "amberxvid-credits",
    title: "AI credits",
    summary: "The balance, what spends it, and the ledger behind it",
    glyph: "icon-sparkle",
    load: () => import("./CreditsPane")
  }
};

/**
 * **Copy text** → `amberxvid.messenger-action`.
 *
 * The repair, not a refactor. This action existed in `Messenger.tsx` as an
 * inline `openCtx(e, …, [{ label: "Copy text", … }])` on every bubble — and
 * `openCtx` is the PORT'S STUB (`kit/ax.tsx`, an explicit no-op), so the row had
 * been unreachable since the import: right-clicking a message ran the declared
 * `amberxvid.message` map instead, and this second menu was never seen by
 * anybody. Moving it deleted the dead call site and made the action live.
 *
 * The clipboard write is the contribution's, and the sentence a member reads is
 * the module's — `host.notify` rather than a toast implementation, so a
 * contribution cannot decide how this module talks to its members.
 */
export const AMBERXVID_COPY_MESSAGE_ACTION: Contribution<MessengerActionPayload> = {
  from: "amberxvid",
  point: AMBERXVID_MESSENGER_ACTION_POINT,
  priority: 10,
  payload: {
    id: "amberxvid-copy-text",
    label: "Copy text",
    glyph: "icon-compare",
    run: (message, host) => {
      void navigator.clipboard.writeText(message.text);
      host.notify("Message copied");
    }
  }
};

/** Every contribution this module makes to its own points, in one list — what
 *  `src/studio.subsystem.ts` spreads into its loop. A list rather than four
 *  named imports there, so adding the fifth is an edit to this file only. */
export const AMBERXVID_POINT_CONTRIBUTIONS = [
  AMBERXVID_FOLLOW_TOOL,
  AMBERXVID_HOST_TILE_BADGE,
  AMBERXVID_CREDITS_SECTION,
  AMBERXVID_COPY_MESSAGE_ACTION
] as const;
