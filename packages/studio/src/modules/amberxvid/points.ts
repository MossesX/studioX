"use client";

/**
 * @file **The platform's extension points, from the consuming side** (P19).
 *
 * The points themselves are DATA on `amberxvid.decl.ts` — they have to be, so
 * the closure resolver can read them under plain Node. This file is the runtime
 * half: the payload types, the narrow host surfaces a contribution is handed,
 * and the readers the screens use to draw whatever has been contributed.
 * `PointSlots.tsx` is the third piece — the JSX that renders them — split out
 * because this file must stay `.ts` for the same reason `amberart/host.ts` is.
 *
 * The arrow points one way and it matters: this file imports the ids from the
 * decl, and nothing in the decl imports this. A decl that reached the registry
 * would stop being importable as data, and the peel, the suite gate and
 * `test/ctx-conformance.test.ts` all depend on it being importable as data.
 *
 * ## `registry.contributionsTo()` is the ONLY link
 *
 * No module-owned map, no `installTool()`, no screen keeping its own list. The
 * module does not import a single contributor — not even its own contributions,
 * which are registered in `src/studio.subsystem.ts`'s one loop like everybody
 * else's. That indirection is what makes "what plugs in here" a question a
 * machine can answer, and therefore what makes the closure computable
 * (core `points.ts`).
 *
 * ## Two payload shapes, and the rule the decl states
 *
 * A **panel** carries a `load` THUNK and is mounted through `React.lazy` — the
 * shape that keeps a contributor's `plugin.ts` importable under plain Node, and
 * that buys code-splitting for free. A **decision** — a badge that either
 * applies to a tile or does not, an action that either offers itself on a
 * message or does not — carries plain functions and no component at all,
 * because the room grid's hot path may not grow a Suspense fence per tile.
 *
 * ## Why the readers are hooks that recompute per mount
 *
 * Contributions are registered during boot, before any route renders. A hook
 * memoised on `[]` is honest for that, cheap, and re-reads on remount, which is
 * what a dev reload does anyway — the same call the AmberArt rail makes, for the
 * same reasons, written out in `amberart/host.ts`.
 */

import * as React from "react";

import { registry } from "@axf/core";
import type { Contribution } from "@axf/core";

import {
  AMBERXVID_ADMIN_TOOL_POINT,
  AMBERXVID_MESSENGER_ACTION_POINT,
  AMBERXVID_PROFILE_RAIL_POINT,
  AMBERXVID_ROOM_TILE_BADGE_POINT,
  AMBERXVID_SETTINGS_SECTION_POINT,
  AMBERXVID_STREAM_TOOL_POINT,
  AMBERXVID_WALL_COMPOSER_ACTION_POINT
} from "./amberxvid.decl";

export {
  AMBERXVID_ADMIN_TOOL_POINT,
  AMBERXVID_MESSENGER_ACTION_POINT,
  AMBERXVID_PROFILE_RAIL_POINT,
  AMBERXVID_ROOM_TILE_BADGE_POINT,
  AMBERXVID_SETTINGS_SECTION_POINT,
  AMBERXVID_STREAM_TOOL_POINT,
  AMBERXVID_WALL_COMPOSER_ACTION_POINT
};

/** Raise a line through the surrounding surface's own status channel. Every
 *  host below offers exactly this and never a toast implementation, so a
 *  contribution cannot decide how the module talks to its members. */
export type Notify = (message: string) => void;

/** How the host paints a contributed badge or chip. Names, not colours: a
 *  contribution that could pass `#ff0000` would be a contribution that survives
 *  a theme roll unchanged, which is the one thing no surface here may do. */
export type PointTone = "accent" | "ok" | "warn" | "err" | "dim";

/* ══════════════════════════════════ profile rail ═════════════════════════ */

/** What a profile shelf may know. Whose profile, and whether it is the
 *  viewer's own — the two facts every shelf on that column already branches on.
 *  Deliberately no navigation callbacks; see the decl for why. */
export interface ProfileRailHost {
  readonly user: string;
  readonly screenname: string;
  readonly me: string;
  readonly mine: boolean;
}

export interface ProfileRailPayload {
  readonly id: string;
  readonly title: string;
  readonly glyph?: string;
  readonly load: () => Promise<{
    default: React.ComponentType<{ host: ProfileRailHost }>;
  }>;
}

/* ══════════════════════════════════ stream tool ══════════════════════════ */

/** Which side of a broadcast a control belongs to. Declared on the payload
 *  rather than decided by the component, because a control that renders and
 *  then returns null has already taken the space in the bar. */
export type StreamToolAudience = "host" | "viewer" | "both";

export interface StreamToolHost {
  /** The live room's id. */
  readonly streamId: string;
  /** The broadcaster's username — the subject of the page. */
  readonly streamer: string;
  readonly title: string;
  /** The signed-in member. */
  readonly me: string;
  /** True when the signed-in member IS the broadcaster. */
  readonly hosting: boolean;
  /** Live follow state for the broadcaster, as the hub knows it. */
  readonly following: boolean;
  /** Follow or unfollow the broadcaster. One verb, because the UI is one
   *  toggle — the hub's own contract, unchanged. */
  readonly setFollow: (on: boolean) => void;
  readonly notify: Notify;
}

export interface StreamToolPayload {
  readonly id: string;
  readonly title: string;
  readonly glyph: string;
  /** Default `both`. */
  readonly audience?: StreamToolAudience;
  readonly load: () => Promise<{
    default: React.ComponentType<{ host: StreamToolHost }>;
  }>;
}

/* ═════════════════════════════════ room tile badge ═══════════════════════ */

/**
 * What a badge is told about one participant. A structural subset of the
 * grid's own `RoomTileData`, restated here rather than imported so that
 * `RoomGrid.tsx` can import this file without a cycle — and so that widening
 * the grid's internal tile record is not automatically a widening of a public
 * contract.
 */
export interface RoomTileFacts {
  readonly user: string;
  readonly displayName: string;
  readonly role: "host" | "participant";
  /** True for the local participant's own tile. */
  readonly me: boolean;
  readonly speaking: boolean;
  readonly micMuted: boolean;
  readonly cameraOff: boolean;
  /** True while the tile's media link is down. */
  readonly lost: boolean;
}

export interface RoomTileBadgePayload {
  readonly id: string;
  /** A contract glyph id (`icon-*`). The host draws it; a badge never returns
   *  an element. */
  readonly glyph: string;
  readonly tone?: PointTone;
  /** This badge's label for THIS tile, or null for "not on this one". Called
   *  inside a memoised tile on a live call — it must be cheap and pure. */
  readonly appliesTo: (tile: RoomTileFacts) => string | null;
}

/* ═══════════════════════════════ wall composer action ════════════════════ */

export interface WallComposerHost {
  /** Whose wall the post being written will land on. */
  readonly owner: string;
  readonly me: string;
  /** What is in the box right now. */
  readonly draft: string;
  readonly notify: Notify;
}

export interface WallComposerActionPayload {
  readonly id: string;
  readonly label: string;
  readonly glyph?: string;
  /**
   * Do the work. A returned string is appended to the draft; returning nothing
   * means the action did its work elsewhere. It cannot attach media and it
   * cannot post — see the decl for why those are a different permission.
   */
  readonly run: (host: WallComposerHost) => string | undefined | Promise<string | undefined>;
}

/* ═════════════════════════════════ messenger action ══════════════════════ */

/** One message, as an action is told about it. */
export interface MessageFacts {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly text: string;
  readonly sentAt: string;
  /** True when the signed-in member wrote it. */
  readonly mine: boolean;
}

export interface MessengerActionHost {
  readonly me: string;
  readonly notify: Notify;
  /** Put text in the composer's draft — the widest thing an action may do to a
   *  conversation. It cannot send; a contribution that could speak as the
   *  member is a different permission from one that can offer them a sentence. */
  readonly compose: (text: string) => void;
}

export interface MessengerActionPayload {
  readonly id: string;
  readonly label: string;
  readonly glyph: string;
  /** Absent means "every message". */
  readonly appliesTo?: (message: MessageFacts) => boolean;
  readonly run: (message: MessageFacts, host: MessengerActionHost) => void | Promise<void>;
}

/* ════════════════════════════════ settings section ═══════════════════════ */

export interface SettingsSectionPayload {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly glyph?: string;
  readonly load: () => Promise<{ default: React.ComponentType<{ notify: Notify }> }>;
}

/* ═══════════════════════════════════ admin tool ══════════════════════════ */

export interface AdminToolHost {
  readonly notify: Notify;
  /** Re-read the wing's snapshot. A tool acts through the module's API and then
   *  asks for the truth back, rather than being handed a state to mutate. */
  readonly reload: () => void;
}

export interface AdminToolPayload {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly glyph?: string;
  readonly load: () => Promise<{
    default: React.ComponentType<{ host: AdminToolHost }>;
  }>;
}

/* ═══════════════════════════════════ the readers ═════════════════════════ */

/** A `load`-carrying payload, flattened with its contributor and its component
 *  already wrapped once. The host mounts `Component` inside a `Suspense`. */
export type Mounted<P extends { load: unknown }, C> = Omit<P, "load"> & {
  /** The contributing asset's id — shown so a pane is attributable. */
  readonly from: string;
  readonly Component: React.LazyExoticComponent<React.ComponentType<C>>;
};

/** The one place a `load` payload becomes a mountable component. Written once
 *  rather than five times so that "a contribution is lazy" is a property of the
 *  reader layer and not a thing each screen remembers to do. */
function mount<P extends { load: () => Promise<{ default: React.ComponentType<C> }> }, C>(
  contributions: readonly Contribution<P>[]
): Mounted<P, C>[] {
  return contributions.map(({ payload, from }) => {
    const { load, ...rest } = payload;
    return { ...rest, from, Component: React.lazy(load) } as Mounted<P, C>;
  });
}

export function useProfileRails(): Mounted<ProfileRailPayload, { host: ProfileRailHost }>[] {
  return React.useMemo(
    () => mount(registry.contributionsTo<ProfileRailPayload>(AMBERXVID_PROFILE_RAIL_POINT)),
    []
  );
}

/**
 * Stream controls for one side of the broadcast. The `audience` filter is
 * applied HERE rather than in the bar, so that "does this control belong on
 * this screen" is answered once, by the reader that knows the point's
 * vocabulary, instead of by every surface that renders one.
 */
export function useStreamTools(
  hosting: boolean
): Mounted<StreamToolPayload, { host: StreamToolHost }>[] {
  return React.useMemo(() => {
    const wanted: StreamToolAudience = hosting ? "host" : "viewer";
    return mount(
      registry
        .contributionsTo<StreamToolPayload>(AMBERXVID_STREAM_TOOL_POINT)
        .filter((c) => (c.payload.audience ?? "both") === "both" || c.payload.audience === wanted)
    );
  }, [hosting]);
}

/**
 * Contributed badges, as PAYLOADS — no lazy, no wrapper, nothing per tile. The
 * grid calls `appliesTo` inside a memoised tile at speaking-detection rate; see
 * the decl for why this point deliberately carries no component.
 */
export function useRoomTileBadges(): readonly RoomTileBadgePayload[] {
  return React.useMemo(
    () =>
      registry
        .contributionsTo<RoomTileBadgePayload>(AMBERXVID_ROOM_TILE_BADGE_POINT)
        .map((c) => c.payload),
    []
  );
}

export function useWallComposerActions(): readonly Contribution<WallComposerActionPayload>[] {
  return React.useMemo(
    () =>
      registry.contributionsTo<WallComposerActionPayload>(AMBERXVID_WALL_COMPOSER_ACTION_POINT),
    []
  );
}

export function useMessengerActions(): readonly MessengerActionPayload[] {
  return React.useMemo(
    () =>
      registry
        .contributionsTo<MessengerActionPayload>(AMBERXVID_MESSENGER_ACTION_POINT)
        .map((c) => c.payload),
    []
  );
}

export function useSettingsSections(): Mounted<SettingsSectionPayload, { notify: Notify }>[] {
  return React.useMemo(
    () => mount(registry.contributionsTo<SettingsSectionPayload>(AMBERXVID_SETTINGS_SECTION_POINT)),
    []
  );
}

export function useAdminTools(): Mounted<AdminToolPayload, { host: AdminToolHost }>[] {
  return React.useMemo(
    () => mount(registry.contributionsTo<AdminToolPayload>(AMBERXVID_ADMIN_TOOL_POINT)),
    []
  );
}
