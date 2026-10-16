/**
 * @file THE user context menu — one builder for every surface in the module
 * that shows a member: the shell members list, Profiles rows, messenger
 * buddies, stream tiles, room viewer chips, chat bubbles.
 *
 * One builder means one truth: when a member goes live, "Join stream" appears
 * on their name EVERYWHERE at once (fed by the same roster/streams state),
 * and a new action added here lands on every surface without a second edit.
 * Options let a host surface trim what cannot apply (a buddy row inside the
 * messenger doesn't need "Message").
 *
 * Menu shape per member:
 *   Join stream ▸ <title>        only while they are live — the headline act
 *   Message / Video call         not for yourself; call gated on presence
 *   Ring into "<room>"           only while YOU are in a group room (P13)
 *   Rate <n>/10 ▸ 0…10           the 0–10 star system, right where the name is
 *   Copy screenname / username
 *   ─────
 *   View profile
 */
"use client";

import type { CtxItem } from "./kit/ax";
import { RATING_MAX, RATING_MIN, type Presence, type StreamInfo } from "./lib/types";
import { castRating } from "./RatingStars";

export interface UserMenuDeps {
  me: string;
  screennameFor: (user: string) => string;
  roster: Presence[];
  streamOf: (user: string) => StreamInfo | null;
  openChat: (user: string) => void;
  startCall: (user: string) => void | Promise<unknown>;
  /**
   * P13 — "join my room": ring this member into the group room the viewer is
   * currently sitting in. Null whenever the viewer is not in one, which is what
   * keeps the row off the menu rather than showing a disabled item nobody can
   * explain. The room's title rides along so the row NAMES the room — an
   * invitation to an unnamed meeting is one nobody accepts.
   */
  ringToRoom: { title: string; invite: (user: string) => void | Promise<unknown> } | null;
  viewProfile: (user: string) => void;
  watchStream: (streamId: string) => void | Promise<unknown>;
  notify: (msg: string, detail?: string) => void;
}

export interface UserMenuOptions {
  /** Surfaces that already ARE the chat can drop the Message row. */
  message?: boolean;
  call?: boolean;
  profile?: boolean;
}

const lower = (u: string): string => u.trim().toLowerCase();

/**
 * Build the menu factory once per render in the shell, hand the resulting
 * `(user) => CtxItem[]` to every surface.
 */
export function buildUserMenu(deps: UserMenuDeps) {
  return (user: string, opts: UserMenuOptions = {}): CtxItem[] => {
    const self = lower(user) === lower(deps.me);
    const presence = deps.roster.find((p) => lower(p.username) === lower(user));
    const online = presence?.online === true;
    const stream = deps.streamOf(user);
    const items: CtxItem[] = [];

    // The headline act: a live member is joinable from anywhere their name is.
    if (stream && !self) {
      items.push({
        label: `Join stream · ${stream.title}`,
        onClick: () => void deps.watchStream(stream.id),
      });
      items.push("---");
    }

    if (!self) {
      if (opts.message !== false) {
        items.push({ label: "Message", onClick: () => deps.openChat(user) });
      }
      if (opts.call !== false) {
        items.push(
          online
            ? { label: "Video call", onClick: () => void deps.startCall(user) }
            : { label: "Video call (offline)", onClick: () => deps.notify("They're offline", "calls need both sides online") },
        );
        // A room invite RINGS, so it needs them online for the same reason a
        // call does — and says so in the same words, rather than inventing a
        // second explanation for one fact.
        if (deps.ringToRoom) {
          const room = deps.ringToRoom;
          items.push(
            online
              ? { label: `Ring into "${room.title}"`, onClick: () => void room.invite(user) }
              : { label: `Ring into "${room.title}" (offline)`, onClick: () => deps.notify("They're offline", "a room invite rings, so it needs them online") },
          );
        }
      }
      items.push({
        label: "Rate member",
        sub: Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MAX - i).map((n) => ({
          label: `${n} / 10${n === 10 ? " — flawless" : n === 0 ? " — harsh" : ""}`,
          onClick: () => {
            void castRating("user", user, n).then((r) =>
              deps.notify(
                r ? `Rated ${deps.screennameFor(user)} ${n}/10` : "Rating failed",
                r?.average != null ? `average now ${r.average.toFixed(1)}★ of ${r.count}` : undefined,
              ),
            );
          },
        })),
      });
    }

    items.push(
      {
        label: "Copy screenname",
        onClick: () => {
          void navigator.clipboard.writeText(deps.screennameFor(user));
          deps.notify("Screenname copied");
        },
      },
      {
        label: "Copy username",
        onClick: () => {
          void navigator.clipboard.writeText(user);
          deps.notify("Username copied");
        },
      },
    );

    if (opts.profile !== false) {
      items.push("---", { label: "View profile", onClick: () => deps.viewProfile(user) });
    }
    return items;
  };
}

export type UserMenuFactory = ReturnType<typeof buildUserMenu>;
