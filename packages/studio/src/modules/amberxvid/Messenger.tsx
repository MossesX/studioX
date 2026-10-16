"use client";

/**
 * @file The AmberX Vid instant messenger — AIM-style, and since P6 of
 * `axf-amberxvid-social` (2026-08-15) **a skin over the accounts messaging
 * stack rather than a stack of its own**.
 *
 * ## The one sentence this file is built around
 *
 * *The skin is amberxvid's, the truth is accounts'.* Everything that makes it
 * feel like AIM is still here and still this module's: the drawer chrome, the
 * twenty themes with their generated backgrounds, the send/receive colour
 * fades, the receive chime, the buddy card, the away message. Everything that
 * is a FACT — who your buddies are, who is online, what was said, who has read
 * it — comes from `/api/accounts/*` and is stored once, for the whole studio.
 *
 * What retired with it: `lib/messages.ts` (the module's parallel thread store),
 * `/api/amberxvid/messages`, and the `message` frame on the module's own SSE
 * channel. Only `/api/amberxvid/messenger` (the skin's settings) and
 * `/api/amberxvid/profiles` (avatars and status lines) are still module-side,
 * because neither is messaging.
 *
 * ## Two streams, and why that is right rather than sloppy
 *
 * The link holds an EventSource on EACH channel:
 *
 *   - **`/api/accounts/presence`** — the studio roster, live message delivery,
 *     and the two payload-free nudges (`relations`, `threads`). This is the
 *     messaging truth: the accounts route stamps a message delivered from the
 *     accounts registry, so the stream that decides delivery is the stream that
 *     carries it.
 *   - **`/api/amberxvid/presence`** — call signalling, stream events and media
 *     server room announcements, plus the module roster that knows who is
 *     HOSTING a live stream. None of that exists platform-wide, and folding it
 *     into accounts would put the media plane inside the identity system.
 *
 * The roster the buddy list renders is the two merged: module membership and
 * `streamingId` from amberxvid, `online`/`away` from accounts. They answer
 * different questions and the list says so — somebody signed into the studio
 * with AmberX Vid closed can be MESSAGED right now and cannot be CALLED, and a
 * buddy row that pretended otherwise would offer a call that never rings.
 *
 * ## Two exports, same division of labour as before
 *
 *   `useMessengerLink` — the engine. The module shell mounts it ONCE (it must
 *   outlive the drawer: presence, delivery and mailbox alerts work with the
 *   messenger closed). Offline delivery is still the initial fetch:
 *   `deliveredNow > 0` means mail arrived while you were away.
 *
 *   `Messenger` (default) — the drawer over that link: buddy list → chat tabs →
 *   history → settings.
 *
 * ## What is keyed by what
 *
 * A chat tab is a THREAD, not a person — that is the groups change, and it is
 * the only change with teeth. `active` and `chats` hold thread ids;
 * `openChat(username)` survives unchanged for every other surface in the module
 * because a DM's id is `threadIdFor(pair)`, computable without a round trip.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Badge from "@mui/material/Badge";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Drawer from "@mui/material/Drawer";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { AccountTree as GroupIcon } from "./kit/icons";
import { Add as AddIcon } from "./kit/icons";
import { ArrowBack as BackIcon } from "./kit/icons";
import { Check as CheckIcon } from "./kit/icons";
import { Close as CloseIcon } from "./kit/icons";
import { EmojiEmotions as EmojiIcon } from "./kit/icons";
import { History as HistoryIcon } from "./kit/icons";
import { MoreVert as MoreIcon } from "./kit/icons";
import { Person as PersonIcon } from "./kit/icons";
import { Send as SendIcon } from "./kit/icons";
import { Settings as SettingsIcon } from "./kit/icons";
import { Videocam as VideocamIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { useCtx, GxChip, type CtxItem } from "./kit/ax";
import { useToast } from "./kit/Toast";
import { GizmoXLockup, GizmoXMark } from "./gizmox-kit";
import { MESSENGER_THEMES, type MessengerTheme } from "./lib/contract";
import { themeBackgroundCss, themeById, themeFontPx } from "./lib/messenger-themes";
import { useAmberxvidPrefs } from "./settings";
import type {
  AccountMe,
  BuddyPresence,
  BuddyRow,
  CallSignal,
  Message,
  MessengerEvent,
  MessengerSettings,
  RoomRing,
  Presence,
  Profile,
  Thread,
  ThreadSummary,
} from "./lib/types";
import { MESSAGE_MAX, STATUS_MAX, THREAD_TITLE_MAX, threadIdFor } from "./lib/types";
import type { MediaRoomSnapshot } from "./lib/mediaContract";
import AvatarView from "./Avatar";
import MessengerHistory from "./MessengerHistory";
import { useAnimationIntensity, type AnimationIntensity } from "./Splash";
import { MessageActions, MESSAGE_ACTIONS_HOVER_SX } from "./PointSlots";
import { useAxvSubjectResolver } from "./ctxBridge";

/* --------------------------------- the wire ---------------------------------- */

const lower = (u: string): string => u.trim().toLowerCase();

/** What the accounts presence channel carries. Declared here rather than
 *  imported because the client only ever narrows on `type`. */
type AccountsFrame =
  | { type: "roster"; roster: AccountsPresence[] }
  | { type: "message"; message: Message }
  | { type: "relations"; at: string }
  | { type: "threads"; at: string }
  | { type: "ping"; at: string };

interface AccountsPresence {
  username: string;
  online: boolean;
  away: boolean;
  lastSeenAt: string;
}

/** A conversation summary as the accounts route hands it over — the store's
 *  own `ThreadSummary` plus the DM `online` flag the route joins on. */
export type ThreadRow = ThreadSummary & { online?: boolean };

/** One open chat tab. A tab is a THREAD; `with` is only meaningful on a DM. */
export interface ChatTarget {
  id: string;
  kind: "dm" | "group";
  /** DM only — the other member. `""` on a group. */
  with: string;
  /** Group only — its name, or null when it was never given one. */
  title: string | null;
}

/** The social graph as the relations route returns it (rows carry presence). */
export interface RelationsSnapshot {
  buddies: BuddyPresence[];
  incoming: BuddyPresence[];
  outgoing: BuddyPresence[];
  blocked: BuddyRow[];
  buddiesOnly: boolean;
}

const EMPTY_RELATIONS: RelationsSnapshot = {
  buddies: [],
  incoming: [],
  outgoing: [],
  blocked: [],
  buddiesOnly: false,
};

export type MessengerView = "buddies" | "chat" | "settings" | "history";

/** Client-side settings until the store answers (same values as its default). */
function clientDefaultSettings(): MessengerSettings {
  return {
    version: 1,
    theme: MESSENGER_THEMES[0].id,
    notifications: true,
    sound: true,
    popupOnMessage: false,
    fontSize: "medium",
    showTimestamps: true,
    awayMessage: "I'm away from my computer right now.",
    statusBeforeAway: null,
  };
}

/** The DM tab for a member — no round trip, because the id IS the pair. */
export function dmTarget(me: string, other: string): ChatTarget {
  return { id: threadIdFor(me, other), kind: "dm", with: other, title: null };
}

/** The tab a summary describes. */
function targetOf(row: ThreadRow): ChatTarget {
  return { id: row.id, kind: row.kind, with: row.with, title: row.title };
}

export interface MessengerLink {
  /** Every module member, merged: membership + `streamingId` from amberxvid,
   *  `reachable`/`away` from accounts. */
  roster: Presence[];
  /** Profile per username (lowercased) — avatars + status lines. */
  profiles: Record<string, Profile>;
  /** The accounts social graph — buddies, both pending directions, blocks. */
  relations: RelationsSnapshot;
  /** Conversation summaries, newest first — the mailbox's truth. */
  summaries: ThreadRow[];
  /** Total unread — the toolbar badge. */
  unread: number;
  settings: MessengerSettings;
  /** My own self-declared away state, from the accounts registry. */
  away: boolean;
  open: boolean;
  view: MessengerView;
  /** The THREAD id whose chat window is up. */
  active: string | null;
  /** Open chat tabs, in open order. */
  chats: ChatTarget[];
  /** Loaded conversations by thread id. */
  threads: Record<string, Thread>;
  /** True while the accounts stream is up — the messaging channel's own health. */
  connected: boolean;
  openMessenger: () => void;
  closeMessenger: () => void;
  showBuddies: () => void;
  showSettings: () => void;
  showHistory: () => void;
  /** Open a DM with a member. The module's other surfaces call this. */
  openChat: (user: string) => void;
  /** Open any conversation by id — the groups door, and the mailbox's. */
  openThread: (id: string) => void;
  closeChat: (id: string) => void;
  send: (target: ChatTarget, text: string) => Promise<boolean>;
  saveSettings: (patch: Partial<MessengerSettings>) => Promise<void>;
  /** Go away (with the settings' away message) or come back. */
  setAway: (away: boolean) => Promise<void>;
  /** Any relations mutation — `request` | `accept` | `remove` | `block` |
   *  `unblock`. Returns whether it took. */
  relate: (action: string, user: string) => Promise<boolean>;
  /** "Only my buddies may reach me" — the ONE source of the platform guard's
   *  `not-buddy-required` verdict, so it is a relations write and not a
   *  messenger setting however much it looks like one on screen. */
  setBuddiesOnly: (on: boolean) => Promise<boolean>;
  /** Open a group with these members. Returns its id, or null. */
  createGroup: (title: string, members: string[]) => Promise<string | null>;
  /** `invite` | `leave` | `rename` on a group. */
  groupAction: (action: "invite" | "leave" | "rename", threadId: string, value: string) => Promise<boolean>;
  /**
   * Load a group thread into {@link threads} WITHOUT opening the messenger
   * (P11). Once a thread is loaded, live delivery on the accounts stream
   * appends to it like any other — so a surface that owns its own chat rail
   * (the group-room grid) gets the whole messaging stack, offline queue and
   * dedupe included, for one call and no second EventSource.
   *
   * Idempotent, and a `null` id is a no-op: a room with nobody in it yet has no
   * thread, and asking for one would be asking for a conversation that has
   * correctly not been created.
   */
  watchThread: (threadId: string | null) => void;
  screennameFor: (user: string) => string;
  /** What a conversation is called on screen — a person, or a group's name. */
  labelForThread: (target: ChatTarget) => string;
  /** Re-read the conversation list (the `threads` nudge, and every mutation). */
  refreshThreads: () => void;
}

/**
 * The messenger engine — mount once in the module shell, after entry (both
 * streams need the signed-in session riding them).
 */
export function useMessengerLink({
  me,
  notify,
  onCallSignal,
  onRoomRing,
  onStreamEvent,
  onRoomMedia,
}: {
  me: AccountMe;
  notify: (msg: string) => void;
  /** Call signals ride the MODULE stream — the shell points this at the
   *  video-chat engine's `handleSignal` (via a ref, so ringing works with the
   *  messenger closed and the stream never re-opens). */
  onCallSignal?: (signal: CallSignal) => void;
  /** P13 — an incoming "join my room" ring. Same ref reasoning as
   *  `onCallSignal`: the link opens the stream before the call engine exists. */
  onRoomRing?: (ring: RoomRing) => void;
  /** Stream events ride the same module stream — the shell points this at the
   *  stream hub's `handleEvent`, same ref reasoning as `onCallSignal`. */
  onStreamEvent?: (event: MessengerEvent) => void;
  /** Media-server room announcements, likewise. */
  onRoomMedia?: (roomId: string, snapshot: MediaRoomSnapshot) => void;
}): MessengerLink {
  const [vidRoster, setVidRoster] = React.useState<Presence[]>([]);
  const [accountsRoster, setAccountsRoster] = React.useState<AccountsPresence[]>([]);
  const [profiles, setProfiles] = React.useState<Record<string, Profile>>({});
  const [relations, setRelations] = React.useState<RelationsSnapshot>(EMPTY_RELATIONS);
  const [summaries, setSummaries] = React.useState<ThreadRow[]>([]);
  const [settings, setSettings] = React.useState<MessengerSettings>(clientDefaultSettings);
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<MessengerView>("buddies");
  const [active, setActive] = React.useState<string | null>(null);
  const [chats, setChats] = React.useState<ChatTarget[]>([]);
  const [threads, setThreads] = React.useState<Record<string, Thread>>({});
  const [connected, setConnected] = React.useState(false);

  const meKey = lower(me.username);

  // The conversation list, readable SYNCHRONOUSLY from the SSE handler. The
  // state itself is what renders; this mirror is what answers "do I already
  // know this thread?" at the moment a message lands, which a `useState` value
  // captured in a mount-once closure cannot.
  const summariesRef = React.useRef<ThreadRow[]>([]);
  summariesRef.current = summaries;

  /* -------------------------------- the roster -------------------------------- */

  /**
   * ONE roster from two channels. The module's list is the base because it is
   * the MEMBERSHIP truth (grant-filtered, and the only one that knows who is
   * hosting a stream); the accounts rows decorate it with studio presence.
   *
   * A member the module has not seen yet (the accounts stream answers first on
   * a cold load) is not invented here — a row with no membership behind it
   * would put a non-member in a buddy list.
   */
  const roster = React.useMemo<Presence[]>(() => {
    const byUser = new Map(accountsRoster.map((p) => [lower(p.username), p]));
    return vidRoster.map((p) => {
      const acc = byUser.get(lower(p.username));
      return { ...p, reachable: acc?.online ?? false, away: acc?.away ?? false };
    });
  }, [vidRoster, accountsRoster]);

  const away = React.useMemo(
    () => accountsRoster.find((p) => lower(p.username) === meKey)?.away === true,
    [accountsRoster, meKey],
  );

  // The SSE handlers run outside React's render loop — they read live state
  // through this ref so a long-lived stream never acts on a stale closure.
  const live = React.useRef({
    open,
    view,
    active,
    settings,
    profiles,
    me: me.username,
    onCallSignal,
    onRoomRing,
    onStreamEvent,
    onRoomMedia,
  });
  live.current = {
    open,
    view,
    active,
    settings,
    profiles,
    me: me.username,
    onCallSignal,
    onRoomRing,
    onStreamEvent,
    onRoomMedia,
  };

  /* ------------------------------- receive chime ------------------------------ */

  const audioRef = React.useRef<AudioContext | null>(null);
  const chime = React.useCallback(() => {
    try {
      const ctx = (audioRef.current ??= new AudioContext());
      const at = ctx.currentTime;
      for (const [freq, start] of [
        [880, 0],
        [1174.7, 0.09],
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.0001, at + start);
        gain.gain.exponentialRampToValueAtTime(0.06, at + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + start + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at + start);
        osc.stop(at + start + 0.2);
      }
    } catch {
      /* no audio — the toast still lands */
    }
  }, []);

  /* --------------------------------- fetching --------------------------------- */

  const refreshThreads = React.useCallback(() => {
    void (async () => {
      try {
        const res = await fetch("/api/accounts/messages");
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          threads?: ThreadRow[];
        } | null;
        if (res.ok && json?.ok && json.threads) setSummaries(json.threads);
      } catch {
        /* the list keeps what it had — honest, and never empties on a blip */
      }
    })();
  }, []);

  const refreshRelations = React.useCallback(() => {
    void (async () => {
      try {
        const res = await fetch("/api/accounts/relations");
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          relations?: RelationsSnapshot;
        } | null;
        if (res.ok && json?.ok && json.relations) setRelations(json.relations);
      } catch {
        /* the buddy list keeps what it had */
      }
    })();
  }, []);

  /* --------------------------------- helpers ---------------------------------- */

  const appendMessage = React.useCallback((message: Message) => {
    setThreads((t) => {
      const thread = t[message.threadId];
      if (!thread) return t; // not loaded — the summary update covers it
      if (thread.messages.some((m) => m.id === message.id)) return t; // SSE + POST dedupe
      return {
        ...t,
        [message.threadId]: {
          ...thread,
          messages: [...thread.messages, message],
          updatedAt: message.sentAt,
        },
      };
    });
  }, []);

  /**
   * Move a summary to the top with a new last message. Returns whether the
   * thread was already known — a message on an UNKNOWN thread cannot be
   * summarised from the message alone (a group's name and membership are not in
   * it), so the caller refetches instead of inventing a row.
   *
   * The verdict is read from `summariesRef`, NOT from inside the state updater.
   * React does not promise an updater runs synchronously at the call site — it
   * may run during the next render — so a flag set in there is `false` by the
   * time the caller looks at it, and this would refetch the whole list on every
   * single message.
   */
  const upsertSummary = React.useCallback(
    (message: Message, unreadDelta: number): boolean => {
      const known = summariesRef.current.some((x) => x.id === message.threadId);
      if (!known) return false;
      setSummaries((s) => {
        const existing = s.find((x) => x.id === message.threadId);
        if (!existing) return s;
        const next: ThreadRow = {
          ...existing,
          lastMessage: message,
          unread: Math.max(0, existing.unread + unreadDelta),
          updatedAt: message.sentAt,
        };
        return [next, ...s.filter((x) => x.id !== message.threadId)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        );
      });
      return true;
    },
    [],
  );

  const zeroUnread = React.useCallback((threadId: string) => {
    setSummaries((s) => s.map((x) => (x.id === threadId ? { ...x, unread: 0 } : x)));
  }, []);

  const markRead = React.useCallback((threadId: string) => {
    void fetch("/api/accounts/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark-read", threadId }),
    }).catch(() => undefined);
  }, []);

  /**
   * Load one conversation.
   *
   * A DM goes through `?with=`, which SYNTHESIZES an empty thread for a pair
   * that has never spoken; `?thread=` deliberately does not (an id nobody is in
   * must not confirm it exists). So a first-ever chat window opens honest
   * rather than 404, exactly as it did before groups.
   */
  const loadThread = React.useCallback(
    async (target: ChatTarget) => {
      const query =
        target.kind === "dm"
          ? `with=${encodeURIComponent(target.with)}`
          : `thread=${encodeURIComponent(target.id)}`;
      try {
        const res = await fetch(`/api/accounts/messages?${query}&markRead=1`);
        const json = (await res.json().catch(() => null)) as { ok?: boolean; thread?: Thread } | null;
        if (res.ok && json?.ok && json.thread) {
          const thread = json.thread;
          setThreads((t) => ({ ...t, [thread.id]: thread }));
          zeroUnread(thread.id);
        }
      } catch {
        /* the window shows the load failure state */
      }
    },
    [zeroUnread],
  );

  /**
   * P11 — load one group thread in the background, for a surface that renders
   * its own rail. Guarded against the obvious loop: the room's roster changes
   * often and its rail re-renders with it, so a `watchThread` that refetched on
   * every render would hammer the messages route. It loads a given id ONCE per
   * mount; every later message arrives on the stream.
   */
  const watchedThreads = React.useRef(new Set<string>());
  const watchThread = React.useCallback(
    (threadId: string | null) => {
      if (!threadId || watchedThreads.current.has(threadId)) return;
      watchedThreads.current.add(threadId);
      void loadThread({ id: threadId, kind: "group", with: "", title: null });
    },
    [loadThread],
  );

  /* ------------------------------- initial fetch ------------------------------ */

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/accounts/messages");
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          threads?: ThreadRow[];
          deliveredNow?: number;
        } | null;
        if (cancelled || !res.ok || !json?.ok) return;
        setSummaries(json.threads ?? []);
        // The offline queue just drained — the "you've got mail" moment.
        if ((json.deliveredNow ?? 0) > 0) {
          notify(
            json.deliveredNow === 1
              ? "You've got mail — 1 message arrived while you were away"
              : `You've got mail — ${json.deliveredNow} messages arrived while you were away`,
          );
        }
      } catch {
        /* the messenger opens empty and honest */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  React.useEffect(() => {
    refreshRelations();
  }, [refreshRelations]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/amberxvid/messenger");
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          settings?: MessengerSettings;
        } | null;
        if (!cancelled && res.ok && json?.ok && json.settings) setSettings(json.settings);
      } catch {
        /* the defaults are a working skin */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* -------------------------------- profiles ---------------------------------- */

  const rosterSize = vidRoster.length;
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/amberxvid/profiles");
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          profiles?: Profile[];
        } | null;
        if (cancelled || !res.ok || !json?.ok || !json.profiles) return;
        const map: Record<string, Profile> = {};
        for (const p of json.profiles) map[lower(p.username)] = p;
        setProfiles(map);
      } catch {
        /* avatars degrade to initial discs */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rosterSize]);

  /* --------------------------- the module SSE stream --------------------------- */

  // Both openers are reached from the SSE handlers (popup-on-message), which
  // run outside the render loop — the refs are what let a mount-once stream
  // call a callback that is rebuilt every render.
  const openChatRef = React.useRef<(user: string) => void>(() => undefined);
  const openThreadRef = React.useRef<(id: string) => void>(() => undefined);

  React.useEffect(() => {
    const es = new EventSource("/api/amberxvid/presence");
    es.onmessage = (raw) => {
      let event: MessengerEvent;
      try {
        event = JSON.parse(raw.data as string) as MessengerEvent;
      } catch {
        return;
      }
      if (event.type === "hello" || event.type === "roster") {
        setVidRoster(event.roster);
        return;
      }
      if (event.type === "call") {
        live.current.onCallSignal?.(event.signal);
        return;
      }
      // P13 — "join my room" rings, and the thing that owns ringing is the call
      // engine. It rides the call callback's sibling rather than the rooms
      // channel above for exactly that reason: what this event needs is a
      // chime, a window and a timeout, not a rooms-list reconcile.
      if (event.type === "room-ring") {
        live.current.onRoomRing?.(event.ring);
        return;
      }
      if (
        event.type === "streams" ||
        event.type === "stream-signal" ||
        event.type === "stream-chat" ||
        // P11 — group rooms ride the same channel. The shell fans this to the
        // stream hub AND the rooms engine; each ignores what is not its own.
        event.type === "rooms" ||
        event.type === "room-signal"
      ) {
        live.current.onStreamEvent?.(event);
        return;
      }
      if (event.type === "room-media") {
        live.current.onRoomMedia?.(event.roomId, event.snapshot);
      }
    };
    return () => es.close();
    // Mount-once by design: the stream reads live state through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------- the accounts SSE stream -------------------------- */

  React.useEffect(() => {
    const es = new EventSource("/api/accounts/presence");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (raw) => {
      let event: AccountsFrame;
      try {
        event = JSON.parse(raw.data as string) as AccountsFrame;
      } catch {
        return;
      }
      if (event.type === "roster") {
        setConnected(true);
        setAccountsRoster(event.roster);
        return;
      }
      if (event.type === "relations") {
        // Payload-free by design: "your graph moved, ask again".
        refreshRelations();
        return;
      }
      if (event.type === "threads") {
        refreshThreads();
        return;
      }
      if (event.type !== "message") return;

      const { me: meUser, open: isOpen, view: v, active: act, settings: st } = live.current;
      const m = event.message;
      const mine = lower(m.from) === lower(meUser);
      appendMessage(m);

      if (mine) {
        // My own send echoing back — this window appended it optimistically,
        // another of my tabs learns of it here.
        if (!upsertSummary(m, 0)) refreshThreads();
        return;
      }

      const watching = isOpen && v === "chat" && act === m.threadId;
      // A message on a thread the list has never seen (a group somebody just
      // added me to, or a first DM) cannot be summarised from the message —
      // refetch rather than invent a row with no members and no name.
      if (!upsertSummary(m, watching ? 0 : 1)) refreshThreads();

      if (watching) {
        markRead(m.threadId);
      } else {
        if (st.notifications) {
          const name = live.current.profiles[lower(m.from)]?.screenname ?? m.from;
          notify(`New message · ${name}: ${m.text.length > 60 ? `${m.text.slice(0, 60)}…` : m.text}`);
        }
        // Popup lands on the SENDER's DM for a direct message; for a group
        // there is no single person to open, so the thread is opened by id.
        if (st.popupOnMessage) {
          if (m.threadId.includes("--")) openChatRef.current(m.from);
          else openThreadRef.current(m.threadId);
        }
      }
      if (st.sound) chime();
    };
    return () => es.close();
    // Mount-once by design, same reasoning as the module stream above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------------- actions ---------------------------------- */

  const openTarget = React.useCallback(
    (target: ChatTarget) => {
      setOpen(true);
      setView("chat");
      setActive(target.id);
      setChats((c) => (c.some((x) => x.id === target.id) ? c : [...c, target]));
      void loadThread(target);
    },
    [loadThread],
  );

  const openChat = React.useCallback(
    (user: string) => openTarget(dmTarget(me.username, user)),
    [me.username, openTarget],
  );
  openChatRef.current = openChat;

  const openThread = React.useCallback(
    (id: string) => {
      const row = summaries.find((s) => s.id === id);
      if (row) {
        openTarget(targetOf(row));
        return;
      }
      // A DM id carries both usernames, so a tab can be opened for one the list
      // has not caught up with; a group id carries nothing and needs the list.
      if (id.includes("--")) {
        const other = id.split("--").find((u) => u !== meKey);
        if (other) openTarget(dmTarget(me.username, other));
        return;
      }
      openTarget({ id, kind: "group", with: "", title: null });
    },
    [summaries, me.username, meKey, openTarget],
  );
  openThreadRef.current = openThread;

  const closeChat = React.useCallback(
    (id: string) => {
      const next = chats.filter((x) => x.id !== id);
      setChats(next);
      if (active === id) setActive(next.length > 0 ? next[next.length - 1].id : null);
      if (next.length === 0) setView("buddies");
    },
    [chats, active],
  );

  const send = React.useCallback(
    async (target: ChatTarget, text: string): Promise<boolean> => {
      // A DM addresses the PERSON and a group the THREAD: a DM's file may not
      // exist yet, and the id-addressed path deliberately refuses to synthesize.
      const body =
        target.kind === "dm"
          ? { action: "send", to: target.with, text }
          : { action: "send", threadId: target.id, text };
      try {
        const res = await fetch("/api/accounts/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          message?: Message;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok || !json.message) {
          notify(json?.error ?? "The message didn't send");
          return false;
        }
        appendMessage(json.message);
        if (!upsertSummary(json.message, 0)) refreshThreads();
        return true;
      } catch {
        notify("The message didn't send — the service did not answer");
        return false;
      }
    },
    [appendMessage, notify, refreshThreads, upsertSummary],
  );

  const saveSettings = React.useCallback(
    async (patch: Partial<MessengerSettings>) => {
      // Hot-apply, then persist — the house no-confirm settings posture.
      setSettings((s) => ({ ...s, ...patch }));
      try {
        const res = await fetch("/api/amberxvid/messenger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          settings?: MessengerSettings;
        } | null;
        if (res.ok && json?.ok && json.settings) setSettings(json.settings);
      } catch {
        notify("Settings change didn't save — it still applies until you leave");
      }
    },
    [notify],
  );

  /**
   * AIM away, in two halves that belong to two systems.
   *
   * The FLAG is platform state: `POST /api/accounts/presence` sets it on the
   * connection registry, which broadcasts a roster to every stream in the
   * studio — so a buddy list anywhere flips, not only this one. The MESSAGE is
   * this module's, and it lands in the profile status line, which is the field
   * buddies already see on a roster row.
   *
   * The status line it replaced is parked in the settings document (not in
   * component state) so a reload while away can still put it back.
   */
  const setAwayState = React.useCallback(
    async (next: boolean) => {
      try {
        const res = await fetch("/api/accounts/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ away: next }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          away?: boolean;
        } | null;
        if (!res.ok || !json?.ok) {
          notify("Away didn't take — the service did not answer");
          return;
        }
        if (next && json.away !== true) {
          // `setAway` refuses a member with no live stream, and says so rather
          // than letting the client believe a state nobody is holding.
          notify("Away needs a live connection — the messenger is not connected");
          return;
        }
      } catch {
        notify("Away didn't take — the service did not answer");
        return;
      }

      const current = profiles[meKey]?.statusLine ?? "";
      const statusLine = next
        ? settings.awayMessage.slice(0, STATUS_MAX)
        : (settings.statusBeforeAway ?? "");
      await saveSettings({ statusBeforeAway: next ? current : null });
      try {
        const res = await fetch("/api/amberxvid/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statusLine }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          profile?: Profile;
        } | null;
        if (res.ok && json?.ok && json.profile) {
          const profile = json.profile;
          setProfiles((p) => ({ ...p, [lower(profile.username)]: profile }));
        }
      } catch {
        notify("You're away, but your away message didn't reach your profile");
      }
    },
    [meKey, notify, profiles, saveSettings, settings.awayMessage, settings.statusBeforeAway],
  );

  const relate = React.useCallback(
    async (action: string, user: string): Promise<boolean> => {
      try {
        const res = await fetch("/api/accounts/relations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, user }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          relations?: RelationsSnapshot;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok) {
          notify(json?.error ?? "That didn't take");
          return false;
        }
        if (json.relations) setRelations(json.relations);
        return true;
      } catch {
        notify("That didn't take — the service did not answer");
        return false;
      }
    },
    [notify],
  );

  const setBuddiesOnly = React.useCallback(
    async (on: boolean): Promise<boolean> => {
      try {
        const res = await fetch("/api/accounts/relations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "buddies-only", on }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          relations?: RelationsSnapshot;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok) {
          notify(json?.error ?? "That didn't take");
          return false;
        }
        if (json.relations) setRelations(json.relations);
        return true;
      } catch {
        notify("That didn't take — the service did not answer");
        return false;
      }
    },
    [notify],
  );

  const createGroup = React.useCallback(
    async (title: string, members: string[]): Promise<string | null> => {
      try {
        const res = await fetch("/api/accounts/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create-group", title, members }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          thread?: Thread;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok || !json.thread) {
          notify(json?.error ?? "The group didn't open");
          return null;
        }
        refreshThreads();
        return json.thread.id;
      } catch {
        notify("The group didn't open — the service did not answer");
        return null;
      }
    },
    [notify, refreshThreads],
  );

  const groupAction = React.useCallback(
    async (action: "invite" | "leave" | "rename", threadId: string, value: string): Promise<boolean> => {
      const body: Record<string, unknown> = { action, threadId };
      if (action === "invite") body.username = value;
      if (action === "rename") body.title = value;
      try {
        const res = await fetch("/api/accounts/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !json?.ok) {
          notify(json?.error ?? "That didn't take");
          return false;
        }
        refreshThreads();
        return true;
      } catch {
        notify("That didn't take — the service did not answer");
        return false;
      }
    },
    [notify, refreshThreads],
  );

  const screennameFor = React.useCallback(
    (user: string): string => {
      const key = lower(user);
      const profile = profiles[key];
      if (profile) return profile.screenname;
      const row =
        relations.buddies.find((b) => lower(b.username) === key) ??
        relations.incoming.find((b) => lower(b.username) === key) ??
        relations.outgoing.find((b) => lower(b.username) === key);
      return row?.screenname ?? user;
    },
    [profiles, relations],
  );

  const labelForThread = React.useCallback(
    (target: ChatTarget): string => {
      if (target.kind === "dm") return screennameFor(target.with);
      // The LIVE summary wins over the tab's captured title: a tab is opened
      // once and a group can be renamed while it is open, so trusting the
      // capture would leave the old name on screen until the tab is closed.
      const row = summaries.find((s) => s.id === target.id);
      const title = row?.title ?? target.title;
      if (title) return title;
      const others = (row?.members ?? []).filter((u) => lower(u) !== meKey);
      return others.length > 0 ? others.map(screennameFor).join(", ") : "Group";
    },
    [meKey, screennameFor, summaries],
  );

  const unread = React.useMemo(() => summaries.reduce((n, s) => n + s.unread, 0), [summaries]);

  return {
    roster,
    profiles,
    relations,
    summaries,
    unread,
    settings,
    away,
    open,
    view,
    active,
    chats,
    threads,
    connected,
    openMessenger: () => {
      setOpen(true);
      setView((v) => (v === "settings" || v === "history" ? "buddies" : v));
    },
    closeMessenger: () => setOpen(false),
    showBuddies: () => setView("buddies"),
    showSettings: () => setView("settings"),
    showHistory: () => {
      setOpen(true);
      setView("history");
    },
    openChat,
    openThread,
    closeChat,
    send,
    saveSettings,
    setAway: setAwayState,
    relate,
    setBuddiesOnly,
    createGroup,
    groupAction,
    watchThread,
    screennameFor,
    labelForThread,
    refreshThreads,
  };
}

/* --------------------------------- emoji picker -------------------------------- */

const EMOJI: readonly { label: string; list: readonly string[] }[] = [
  {
    label: "Smileys",
    list: ["😀", "😄", "😁", "😆", "😅", "😂", "🙂", "😉", "😊", "😍", "😘", "😜", "🤔", "😐", "😴", "🥳", "😎", "🤯", "😢", "😭", "😡", "🤗", "🫡", "🤫"],
  },
  {
    label: "Gestures",
    list: ["👍", "👎", "👋", "🙌", "👏", "🤝", "✌️", "🤞", "💪", "🫶", "👉", "👈", "☝️", "🖖", "🤘", "🙏"],
  },
  {
    label: "Hearts",
    list: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💯", "💕", "💖", "💔"],
  },
  {
    label: "Fun",
    list: ["🔥", "⭐", "✨", "🎉", "🎊", "🎈", "🎁", "🏆", "🚀", "📹", "🎬", "🎥", "📸", "🎙️", "🎧", "☕", "🍕", "🌮", "🕹️", "💡", "⚡", "🌈", "🐱", "🐶"],
  },
];

function EmojiPicker({
  anchor,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "left" }}
      transformOrigin={{ vertical: "bottom", horizontal: "left" }}
    >
      <Box sx={{ p: 1.25, width: 300, maxHeight: 320, overflowY: "auto" }}>
        {EMOJI.map((group) => (
          <Box key={group.label} sx={{ mb: 0.75 }}>
            <Typography
              sx={{ fontFamily: GX.mono, fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase", color: GX.dim, mb: 0.25 }}
            >
              {group.label}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap" }}>
              {group.list.map((e) => (
                <Box
                  key={e}
                  component="button"
                  onClick={() => onPick(e)}
                  sx={{
                    all: "unset",
                    cursor: "pointer",
                    fontSize: 20,
                    lineHeight: 1,
                    p: 0.5,
                    borderRadius: 1,
                    "&:hover": { bgcolor: gxa(GX.accent, "22"), transform: "scale(1.2)" },
                  }}
                >
                  {e}
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Popover>
  );
}

/* ---------------------------------- presence ------------------------------------ */

/** The AIM dot. Three states now, because there are three: in the suite, signed
 *  into the studio, and gone. */
function PresenceDot({
  status,
  size = 9,
}: {
  status: "online" | "away" | "reachable" | "offline";
  size?: number;
}) {
  const color =
    status === "online" ? GX.ok : status === "away" ? GX.warn : status === "reachable" ? GX.info : GX.dim;
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        bgcolor: color,
        opacity: status === "offline" ? 0.45 : 1,
        boxShadow: status === "offline" ? "none" : `0 0 6px ${gxa(color, "88")}`,
        flexShrink: 0,
      }}
    />
  );
}

type PresenceStatus = "online" | "away" | "reachable" | "offline";

function statusOf(p: Presence | undefined): PresenceStatus {
  if (!p) return "offline";
  if (p.online) return p.away === true ? "away" : "online";
  if (p.reachable === true) return p.away === true ? "away" : "reachable";
  return "offline";
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* --------------------------------- the drawer ---------------------------------- */

export interface MessengerProps {
  link: MessengerLink;
  me: AccountMe;
  onViewProfile: (username: string) => void;
  /** Start a P2P video call with this buddy (the shell owns the engine). */
  onVideoCall: (username: string) => void;
  /** THE user menu (userMenu.tsx) — buddies get the same right-click as every
   *  other member surface, Join-stream row included. */
  userMenu?: (user: string) => CtxItem[];
  /** The live stream a buddy is hosting, for the LIVE badge + row jump. */
  streamOf?: (user: string) => { id: string; title: string } | null;
  onJoinStream?: (streamId: string) => void;
}

export default function Messenger({
  link,
  me,
  onViewProfile,
  onVideoCall,
  userMenu,
  streamOf,
  onJoinStream,
}: MessengerProps) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const { openCtx, ctxMenu } = useCtx();
  const theme = themeById(link.settings.theme);
  const dur = intensity === "off" ? 0 : intensity === "subtle" ? 250 : intensity === "maximum" ? 700 : 450;

  const [addOpen, setAddOpen] = React.useState(false);
  const [groupOpen, setGroupOpen] = React.useState(false);
  const [rowMenu, setRowMenu] = React.useState<{ anchor: HTMLElement; user: string } | null>(null);

  const presenceOf = (user: string): Presence | undefined =>
    link.roster.find((p) => lower(p.username) === lower(user));

  const online = link.relations.buddies.filter(
    (b) => statusOf(presenceOf(b.username)) !== "offline",
  ).length;

  const groups = link.summaries.filter((s) => s.kind === "group");

  const unreadForThread = (id: string): number =>
    link.summaries.find((s) => s.id === id)?.unread ?? 0;

  const unreadForUser = (user: string): number => unreadForThread(threadIdFor(me.username, user));

  /* --------------------------------- header ----------------------------------- */

  const title =
    link.view === "settings"
      ? "Messenger settings"
      : link.view === "history"
        ? "Chat history"
        : link.view === "chat"
          ? "Chat"
          : "Messenger";

  const header = (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        p: 1.25,
        borderBottom: `1px solid ${GX.edge}`,
        flexShrink: 0,
        // The messenger chrome is where the branding directive lands hardest.
        background: `linear-gradient(135deg, ${GX.panel} 0%, ${theme.accent}14 100%)`,
      }}
    >
      {link.view !== "buddies" ? (
        <Tooltip title="Buddy list">
          <IconButton size="small" onClick={link.showBuddies} data-el-id="amberxvid:messenger:back">
            <BackIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      ) : (
        <GizmoXMark size={22} glow={false} ring="transparent" />
      )}
      <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{title}</Typography>
      {link.view === "buddies" && (
        <GxChip label={`${online} online`} kind={online > 0 ? "ok" : "dim"} />
      )}
      <Box sx={{ flex: 1 }} />
      {link.view !== "history" && (
        <Tooltip title="Chat history — every conversation, page by page, searchable">
          <IconButton size="small" onClick={link.showHistory} data-el-id="amberxvid:messenger:history">
            <HistoryIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
      {link.view !== "settings" && (
        <Tooltip title="Messenger settings — alerts, style, the 20 themes, your away message (per-profile, lives here, not the sui)">
          <IconButton size="small" onClick={link.showSettings} data-el-id="amberxvid:messenger:settings">
            <SettingsIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Close">
        <IconButton size="small" onClick={link.closeMessenger} data-el-id="amberxvid:messenger:close">
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );

  /* -------------------------------- buddy rows --------------------------------- */

  const sectionLabel = (text: string) => (
    <Typography
      sx={{
        fontFamily: GX.mono,
        fontSize: 9.5,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: GX.dim,
        mt: 0.75,
      }}
    >
      {text}
    </Typography>
  );

  const buddyRow = (b: BuddyPresence) => {
    const presence = presenceOf(b.username);
    const status = statusOf(presence);
    const profile = link.profiles[lower(b.username)];
    const unread = unreadForUser(b.username);
    const streaming = presence?.streamingId ?? null;
    return (
      <Box
        key={b.username}
        data-el-id={`amberxvid:messenger:buddy:${b.username}`}
        // The declared `amberxvid.member` area (P15). A buddy row gets the same
        // rows every other member chip gets — *Add buddy* simply does not
        // render, because the predicate can see they already are one.
        data-axf-area="amberxvid.member"
        data-axf-member={b.username}
        data-axf-member-name={link.screennameFor(b.username)}
        onClick={() => link.openChat(b.username)}
        onContextMenu={(e: React.MouseEvent) =>
          openCtx(e, `Buddy · ${link.screennameFor(b.username)}`, userMenu?.(b.username) ?? [])
        }
        sx={{
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          p: 0.75,
          borderRadius: 1,
          border: "1px solid transparent",
          transition: dur ? "background-color 150ms, border-color 150ms" : "none",
          "&:hover": { bgcolor: `${theme.accent}0f`, borderColor: `${theme.accent}33` },
        }}
      >
        <Badge
          badgeContent={unread}
          color="error"
          overlap="circular"
          sx={{ "& .MuiBadge-badge": { fontSize: 9, height: 14, minWidth: 14 } }}
        >
          <AvatarView spec={profile?.avatar ?? null} name={link.screennameFor(b.username)} size={32} />
        </Badge>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
            <Typography sx={{ fontSize: 13, fontWeight: unread > 0 ? 700 : 600, lineHeight: 1.2 }}>
              {link.screennameFor(b.username)}
            </Typography>
            {streaming ? (
              // Hosting right now — the badge is a door, not a label.
              <Box
                component="span"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onJoinStream?.(streaming);
                }}
                sx={{
                  px: 0.5,
                  borderRadius: 0.5,
                  bgcolor: gxa(GX.err, "CC"),
                  color: "#fff",
                  fontSize: 8.5,
                  fontWeight: 800,
                  fontFamily: GX.mono,
                  letterSpacing: 0.5,
                  cursor: "pointer",
                }}
              >
                LIVE
              </Box>
            ) : null}
          </Box>
          <Typography
            sx={{ fontSize: 10.5, color: GX.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {streaming
              ? `streaming · ${streamOf?.(b.username)?.title ?? "live now"}`
              : status === "away"
                ? profile?.statusLine || "away"
                : status === "online"
                  ? profile?.statusLine || "online"
                  : status === "reachable"
                    ? "signed in — not in AmberX Vid"
                    : b.lastSeenAt
                      ? `last seen ${fmtWhen(b.lastSeenAt)}`
                      : "never signed in"}
          </Typography>
        </Box>
        <PresenceDot status={status} />
        <Tooltip title="Buddy actions">
          <IconButton
            size="small"
            onClick={(e: React.MouseEvent<HTMLElement>) => {
              e.stopPropagation();
              setRowMenu({ anchor: e.currentTarget, user: b.username });
            }}
            data-el-id={`amberxvid:messenger:buddy-menu:${b.username}`}
            sx={{ p: 0.25 }}
          >
            <MoreIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
    );
  };

  const pendingRow = (b: BuddyPresence, kind: "incoming" | "outgoing") => (
    <Box
      key={`${kind}:${b.username}`}
      sx={{ display: "flex", alignItems: "center", gap: 1, p: 0.75, borderRadius: 1, bgcolor: gxa(GX.panel2, "88") }}
    >
      <AvatarView spec={link.profiles[lower(b.username)]?.avatar ?? null} name={b.screenname ?? b.username} size={26} />
      <Typography noWrap sx={{ fontSize: 12, flex: 1, minWidth: 0 }}>
        {b.screenname ?? b.username}
      </Typography>
      {kind === "incoming" ? (
        <>
          <Tooltip title="Accept">
            <IconButton
              size="small"
              sx={{ p: 0.25, color: GX.ok }}
              data-el-id={`amberxvid:messenger:accept:${b.username}`}
              onClick={() => {
                void link.relate("accept", b.username).then((ok) => ok && toast(`${b.screenname ?? b.username} is a buddy`));
              }}
            >
              <CheckIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Decline">
            <IconButton
              size="small"
              sx={{ p: 0.25, color: GX.err }}
              data-el-id={`amberxvid:messenger:decline:${b.username}`}
              onClick={() => void link.relate("remove", b.username).then((ok) => ok && toast("Request declined"))}
            >
              <CloseIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        </>
      ) : (
        <Tooltip title="Cancel the request">
          <IconButton
            size="small"
            sx={{ p: 0.25, color: GX.dim }}
            data-el-id={`amberxvid:messenger:cancel:${b.username}`}
            onClick={() => void link.relate("remove", b.username).then((ok) => ok && toast("Request cancelled"))}
          >
            <CloseIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );

  /* -------------------------------- buddy list --------------------------------- */

  const myProfile = link.profiles[lower(me.username)];
  const myStatus: PresenceStatus = link.away ? "away" : link.connected ? "online" : "offline";

  const buddyList = (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 1.25, display: "flex", flexDirection: "column", gap: 0.5 }}>
      {/* me — the AIM top card, with the away control right on it */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          p: 1,
          mb: 0.75,
          borderRadius: 1.5,
          border: `1px solid ${theme.accent}44`,
          background: `linear-gradient(135deg, ${GX.panel2} 0%, ${theme.accent}11 100%)`,
        }}
      >
        <AvatarView spec={myProfile?.avatar ?? null} name={me.screenname ?? me.username} size={36} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.2 }}>
            {me.screenname ?? me.username}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            <PresenceDot status={myStatus} />
            <Typography noWrap sx={{ fontSize: 10.5, color: GX.dim }}>
              {link.away
                ? myProfile?.statusLine || link.settings.awayMessage
                : link.connected
                  ? `online${myProfile?.statusLine ? ` · ${myProfile.statusLine}` : ""}`
                  : "connecting…"}
            </Typography>
          </Box>
        </Box>
        <Tooltip
          title={
            link.away
              ? "Come back — your status line goes back to what it was"
              : `Go away — buddies see "${link.settings.awayMessage}"`
          }
        >
          <span>
            <Button
              size="small"
              variant={link.away ? "contained" : "outlined"}
              color={link.away ? "warning" : "inherit"}
              disabled={!link.connected}
              onClick={() => void link.setAway(!link.away)}
              data-el-id="amberxvid:messenger:away"
              sx={{ py: 0.1, px: 0.9, fontSize: 10.5, minWidth: 0 }}
            >
              {link.away ? "I'm back" : "Away"}
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* the two doors: add a buddy, open a group */}
      <Box sx={{ display: "flex", gap: 0.75 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon sx={{ fontSize: 14 }} />}
          onClick={() => setAddOpen(true)}
          data-el-id="amberxvid:messenger:add-buddy"
          sx={{ flex: 1, py: 0.2, fontSize: 11 }}
        >
          Add buddy
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<GroupIcon sx={{ fontSize: 14 }} />}
          disabled={link.relations.buddies.length === 0}
          onClick={() => setGroupOpen(true)}
          data-el-id="amberxvid:messenger:new-group"
          sx={{ flex: 1, py: 0.2, fontSize: 11 }}
        >
          New group
        </Button>
      </Box>

      {link.relations.incoming.length > 0 && (
        <>
          {sectionLabel(`Buddy requests · ${link.relations.incoming.length}`)}
          {link.relations.incoming.map((b) => pendingRow(b, "incoming"))}
        </>
      )}

      {sectionLabel(`Buddies · ${link.relations.buddies.length}`)}
      {link.relations.buddies.length === 0 ? (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, py: 3, opacity: 0.85 }}>
          <GizmoXLockup mark={34} />
          <Typography sx={{ fontSize: 12, color: GX.dim, textAlign: "center", maxWidth: 260 }}>
            No buddies yet. Add one by username — they accept, and from then on you see each other's
            presence everywhere in the studio, not only here.
          </Typography>
        </Box>
      ) : (
        link.relations.buddies.map(buddyRow)
      )}

      {link.relations.outgoing.length > 0 && (
        <>
          {sectionLabel(`Waiting on them · ${link.relations.outgoing.length}`)}
          {link.relations.outgoing.map((b) => pendingRow(b, "outgoing"))}
        </>
      )}

      {groups.length > 0 && (
        <>
          {sectionLabel(`Groups · ${groups.length}`)}
          {groups.map((g) => {
            const target = targetOf(g);
            return (
              <Box
                key={g.id}
                onClick={() => link.openThread(g.id)}
                data-el-id={`amberxvid:messenger:group:${g.id}`}
                sx={{
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  p: 0.75,
                  borderRadius: 1,
                  border: "1px solid transparent",
                  "&:hover": { bgcolor: `${theme.accent}0f`, borderColor: `${theme.accent}33` },
                }}
              >
                <Badge
                  badgeContent={g.unread}
                  color="error"
                  overlap="circular"
                  sx={{ "& .MuiBadge-badge": { fontSize: 9, height: 14, minWidth: 14 } }}
                >
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: gxa(theme.accent, "22"),
                      border: `1px solid ${theme.accent}55`,
                    }}
                  >
                    <GroupIcon sx={{ fontSize: 16, color: theme.accent }} />
                  </Box>
                </Badge>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontSize: 13, fontWeight: g.unread > 0 ? 700 : 600, lineHeight: 1.2 }}>
                    {link.labelForThread(target)}
                  </Typography>
                  <Typography
                    noWrap
                    sx={{ fontSize: 10.5, color: GX.dim }}
                  >
                    {g.members.length} members
                    {g.lastMessage ? ` · ${g.lastMessage.text.slice(0, 40)}` : " · no messages yet"}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );

  /* --------------------------------- chat view ---------------------------------- */

  const activeTarget = link.chats.find((c) => c.id === link.active) ?? null;

  const chatView = activeTarget && (
    <ChatWindow
      key={activeTarget.id}
      link={link}
      me={me}
      target={activeTarget}
      theme={theme}
      dur={dur}
      intensity={intensity}
      onViewProfile={onViewProfile}
      onVideoCall={onVideoCall}
    />
  );

  const chatTabs = link.chats.length > 0 && link.view === "chat" && (
    <Box sx={{ display: "flex", gap: 0.5, px: 1.25, pt: 1, flexShrink: 0, overflowX: "auto" }}>
      {link.chats.map((c) => {
        const activeTab = link.active === c.id;
        const unread = unreadForThread(c.id);
        return (
          <Box
            key={c.id}
            onClick={() => link.openThread(c.id)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 1,
              py: 0.4,
              borderRadius: "8px 8px 0 0",
              cursor: "pointer",
              bgcolor: activeTab ? theme.bubble : GX.panel2,
              border: `1px solid ${activeTab ? `${theme.accent}55` : gxa(GX.edge, "55")}`,
              borderBottom: "none",
              flexShrink: 0,
            }}
          >
            <Badge variant="dot" color="error" invisible={unread === 0}>
              <Typography sx={{ fontSize: 11.5, fontWeight: activeTab ? 700 : 500, color: activeTab ? theme.text : GX.ink }}>
                {link.labelForThread(c)}
              </Typography>
            </Badge>
            <Box
              component="button"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                link.closeChat(c.id);
              }}
              sx={{ all: "unset", cursor: "pointer", display: "flex", color: GX.dim, "&:hover": { color: GX.err } }}
            >
              <CloseIcon sx={{ fontSize: 11 }} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );

  /* ---------------------------------- render ------------------------------------ */

  const menuUser = rowMenu?.user ?? "";
  const menuName = menuUser ? link.screennameFor(menuUser) : "";

  return (
    <>
      <Drawer
        anchor="right"
        open={link.open}
        onClose={link.closeMessenger}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 460 }, bgcolor: GX.bg } } }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
          {header}
          {link.view === "settings" ? (
            <MessengerSettingsPane link={link} theme={theme} dur={dur} />
          ) : link.view === "history" ? (
            <MessengerHistory link={link} me={me} theme={theme} />
          ) : link.view === "chat" && activeTarget ? (
            <>
              {chatTabs}
              {chatView}
            </>
          ) : (
            buddyList
          )}
        </Box>
      </Drawer>

      {/* Buddy row actions. A real menu rather than a right-click: the module's
          `useCtx` is a no-op until the declared context map lands, and an
          affordance that silently does nothing is worse than none. */}
      <Menu
        open={rowMenu !== null}
        anchorEl={rowMenu?.anchor ?? null}
        onClose={() => setRowMenu(null)}
      >
        <MenuItem
          onClick={() => {
            link.openChat(menuUser);
            setRowMenu(null);
          }}
        >
          Message
        </MenuItem>
        <MenuItem
          onClick={() => {
            onViewProfile(menuUser);
            setRowMenu(null);
          }}
        >
          View profile
        </MenuItem>
        <MenuItem
          onClick={() => {
            const p = presenceOf(menuUser);
            if (p?.online) onVideoCall(menuUser);
            else toast("Calls need both sides in AmberX Vid — they're not in it");
            setRowMenu(null);
          }}
        >
          Video call
        </MenuItem>
        <MenuItem
          onClick={() => {
            void link.relate("remove", menuUser).then((ok) => ok && toast(`${menuName} removed`));
            setRowMenu(null);
          }}
        >
          Remove buddy
        </MenuItem>
        <MenuItem
          sx={{ color: GX.err }}
          onClick={() => {
            void link
              .relate("block", menuUser)
              .then((ok) => ok && toast(`${menuName} blocked — they are not told`));
            setRowMenu(null);
          }}
        >
          Block
        </MenuItem>
      </Menu>

      <AddBuddyDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={async (username) => {
          const ok = await link.relate("request", username);
          if (ok) toast(`Buddy request sent to ${username}`);
          return ok;
        }}
      />
      <NewGroupDialog
        open={groupOpen}
        buddies={link.relations.buddies}
        screennameFor={link.screennameFor}
        onClose={() => setGroupOpen(false)}
        onCreate={async (groupTitle, members) => {
          const id = await link.createGroup(groupTitle, members);
          if (id) {
            toast(`Group "${groupTitle || "unnamed"}" opened`);
            link.openThread(id);
          }
          return id !== null;
        }}
      />
      {ctxMenu}
    </>
  );
}

/* --------------------------------- chat window --------------------------------- */

function ChatWindow({
  link,
  me,
  target,
  theme,
  dur,
  intensity,
  onViewProfile,
  onVideoCall,
}: {
  link: MessengerLink;
  me: AccountMe;
  target: ChatTarget;
  theme: MessengerTheme;
  dur: number;
  intensity: AnimationIntensity;
  onViewProfile: (username: string) => void;
  onVideoCall: (username: string) => void;
}) {
  const toast = useToast();
  // `ctxMenu` only — this window's last `openCtx` call site went away with the
  // dead copy-text menu (P19); the live right-click is the declared
  // `amberxvid.message` map, and the visible action is a contribution.
  const { ctxMenu } = useCtx();
  const thread = link.threads[target.id];
  // The tab's own row in the live conversation list — a group's name and
  // membership move while the tab is open, and the capture in `target` does not.
  const row = link.summaries.find((s) => s.id === target.id);
  const isDm = target.kind === "dm";
  const presence = isDm ? link.roster.find((p) => lower(p.username) === lower(target.with)) : undefined;
  const status = statusOf(presence);
  const profile = isDm ? link.profiles[lower(target.with)] : undefined;
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  /** P16 — the settings tree's MESSENGER row. Live, so flipping it in another
   *  tab changes this composer without a reload. */
  const { messengerEnterToSend: enterToSend } = useAmberxvidPrefs();
  const [emojiAnchor, setEmojiAnchor] = React.useState<HTMLElement | null>(null);
  const [roomMenu, setRoomMenu] = React.useState<HTMLElement | null>(null);
  const [invite, setInvite] = React.useState(false);
  const [rename, setRename] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Messages that exist when the window opens render still; only messages
  // appended AFTER that play the themed send/receive fade. Seeding waits for
  // the thread itself — seeding from the loading state's empty list would
  // mark the entire history as fresh and animate all of it at once.
  const seenIds = React.useRef<Set<string> | null>(null);
  const messages = thread?.messages ?? [];
  if (seenIds.current === null && thread) {
    seenIds.current = new Set(messages.map((m) => m.id));
  }

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: dur ? "smooth" : "auto" });
  }, [messages.length, dur]);

  /**
   * The declared `amberxvid.message` area's behaviour (P15).
   *
   * A resolver rather than a hook per bubble: a conversation is a `.map()` and
   * a hook cannot live inside one. It reads `messages`, which is the same array
   * the bubbles render from, so *Reply* always quotes what is actually on
   * screen.
   *
   * Reply QUOTES into the composer rather than sending anything: it prefixes
   * the message in `>` lines and focuses the caret after them, which is the
   * behaviour of every chat that has this row. The composer is the one place
   * text is sent from, and a Reply that sent would be a second one.
   */
  useAxvSubjectResolver("message", (id) => {
    const message = messages.find((m) => m.id === id);
    if (!message) return null;
    return {
      reply: () => {
        const quoted = message.text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        setDraft((d) => `${quoted}\n${d}`.slice(0, MESSAGE_MAX));
        inputRef.current?.focus();
      },
      copy: () => {
        void navigator.clipboard.writeText(message.text);
        toast("Message copied");
      }
    };
  });

  const doSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await link.send(target, text);
    setSending(false);
    if (ok) {
      setDraft("");
      inputRef.current?.focus();
    }
  };

  /**
   * The narrow surface a contributed message action (`amberxvid.messenger-action`,
   * P19) is handed. `compose` puts text in the DRAFT and focuses the box — the
   * widest thing an action may do to a conversation. There is deliberately no
   * `send`: a contribution that could speak as the member is a different and
   * much larger permission than one that can offer them a sentence, and the
   * module's own *Reply* (the ctx map's row) is built on exactly this verb.
   */
  const messengerActionHost = React.useMemo(
    () => ({
      me: me.username,
      notify: (message: string) => toast(message),
      compose: (text: string) => {
        setDraft((d) => (d ? `${d}\n${text}` : text).slice(0, MESSAGE_MAX));
        inputRef.current?.focus();
      },
    }),
    [me.username, toast],
  );

  const label = link.labelForThread(target);
  const fontPx = themeFontPx(link.settings.fontSize);
  const fadeName = `gxvFade${theme.id.replace(/[^a-z0-9]/gi, "")}`;

  /**
   * The line under the name. It says which of the three presences the other
   * side is in, because they mean different things for what happens next: a
   * message is delivered live to anybody signed into the studio, and a call
   * only reaches somebody who has AmberX Vid open.
   */
  const subtitle = isDm
    ? status === "online"
      ? "in AmberX Vid — messages and calls land now"
      : status === "away"
        ? `away — ${profile?.statusLine || "messages still deliver"}`
        : status === "reachable"
          ? "signed in elsewhere — messages deliver now, calls do not"
          : "offline — messages queue for their next sign-in"
    : `${thread?.members.length ?? row?.members.length ?? 0} members · everyone offline gets it at their next sign-in`;

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* conversation header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.25,
          py: 0.75,
          borderBottom: `1px solid ${GX.edge}`,
          flexShrink: 0,
        }}
      >
        {isDm ? (
          <AvatarView spec={profile?.avatar ?? null} name={label} size={30} />
        ) : (
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: gxa(theme.accent, "22"),
              border: `1px solid ${theme.accent}55`,
            }}
          >
            <GroupIcon sx={{ fontSize: 15, color: theme.accent }} />
          </Box>
        )}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.2 }}>
            {label}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            {isDm && <PresenceDot status={status} size={7} />}
            <Typography noWrap sx={{ fontSize: 10, color: GX.dim }}>
              {subtitle}
            </Typography>
          </Box>
        </Box>
        {isDm ? (
          <>
            <Tooltip title="View profile">
              <IconButton
                size="small"
                onClick={() => onViewProfile(target.with)}
                data-el-id="amberxvid:messenger:chat:profile"
              >
                <PersonIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            <Tooltip
              title={
                presence?.online
                  ? "Video call — relayed by the AmberX Vid media server"
                  : "Video calls need both sides in AmberX Vid"
              }
            >
              <IconButton
                size="small"
                onClick={() =>
                  presence?.online
                    ? onVideoCall(target.with)
                    : toast("Calls need both sides in AmberX Vid — they're not in it")
                }
                data-el-id="amberxvid:messenger:chat:call"
                sx={{ color: presence?.online ? theme.accent : undefined }}
              >
                <VideocamIcon sx={{ fontSize: 15, opacity: presence?.online ? 1 : 0.55 }} />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <Tooltip title="Group actions">
            <IconButton
              size="small"
              onClick={(e: React.MouseEvent<HTMLElement>) => setRoomMenu(e.currentTarget)}
              data-el-id="amberxvid:messenger:chat:group-menu"
            >
              <MoreIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* message scroll — the themed, brand-watermarked surface */}
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          p: 1.25,
          display: "flex",
          flexDirection: "column",
          gap: 0.75,
          bgcolor: theme.bg,
          backgroundImage: themeBackgroundCss(theme),
          position: "relative",
        }}
      >
        {!thread ? (
          <Typography sx={{ fontSize: 12, color: theme.text, opacity: 0.6, textAlign: "center", py: 3 }}>
            Loading the conversation…
          </Typography>
        ) : messages.length === 0 ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, py: 4, opacity: 0.75 }}>
            <GizmoXMark size={40} glow={false} accent={theme.accent} />
            <Typography sx={{ fontSize: 12, color: theme.text, opacity: 0.75, textAlign: "center" }}>
              No messages yet — say hi. History is kept by the studio, and anything sent while{" "}
              {isDm ? label : "somebody"} is signed out delivers at their next sign-in.
            </Typography>
          </Box>
        ) : (
          messages.map((m) => {
            const mine = lower(m.from) === lower(me.username);
            const fresh = !seenIds.current!.has(m.id);
            if (fresh) seenIds.current!.add(m.id);
            const animate = fresh && intensity !== "off";
            return (
              <Box
                key={m.id}
                // The declared `amberxvid.message` area (P15). `messageFrom` is
                // marked even though no row reads it today — the delete rows
                // that would have are not declared (see the decl), and marking
                // the author is what makes adding them later a decl-only edit.
                data-axf-area="amberxvid.message"
                data-axf-message={m.id}
                data-axf-message-from={m.from}
                sx={{
                  position: "relative",
                  alignSelf: mine ? "flex-end" : "flex-start",
                  maxWidth: "82%",
                  px: 1.25,
                  py: 0.75,
                  ...MESSAGE_ACTIONS_HOVER_SX,
                  borderRadius: mine ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                  bgcolor: theme.bubble,
                  border: `1px solid ${mine ? theme.accent : theme.fade[1]}${mine ? "66" : "33"}`,
                  ...(animate && {
                    [`@keyframes ${fadeName}`]: {
                      "0%": {
                        backgroundColor: theme.fade[0],
                        transform: mine ? "translateX(14px)" : "translateX(-14px)",
                        opacity: 0.2,
                      },
                      "45%": { backgroundColor: theme.fade[1], opacity: 1 },
                      "100%": { backgroundColor: theme.bubble, transform: "none" },
                    },
                    animation: `${fadeName} ${dur}ms ease-out`,
                  }),
                }}
              >
                {/**
                 * P19 — contributed actions on this message
                 * (`amberxvid.messenger-action`), as icon buttons that fade in
                 * on the side the bubble is not aligned to.
                 *
                 * This replaces a dead inline menu. The bubble used to carry an
                 * `onContextMenu` opening `openCtx(…, [{ label: "Copy text" }])`,
                 * and `openCtx` is the port's explicit no-op (`kit/ax.tsx`), so
                 * that row had never been reachable: a right-click here runs the
                 * DECLARED `amberxvid.message` map above. The action is now a
                 * contribution and is visible without a right-click.
                 */}
                <MessageActions
                  message={{
                    id: m.id,
                    threadId: target.id,
                    from: m.from,
                    text: m.text,
                    sentAt: m.sentAt,
                    mine,
                  }}
                  host={messengerActionHost}
                  mine={mine}
                />
                {/* A group needs the sender's name on the bubble; a DM has
                    exactly one other person and would just repeat the header. */}
                {!isDm && !mine && (
                  <Typography
                    sx={{ fontSize: 9.5, fontWeight: 700, color: theme.accent, mb: 0.15, fontFamily: GX.mono }}
                  >
                    {link.screennameFor(m.from)}
                  </Typography>
                )}
                <Typography sx={{ fontSize: fontPx, color: theme.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {m.text}
                </Typography>
                {link.settings.showTimestamps && (
                  <Typography sx={{ fontSize: 9, color: theme.text, opacity: 0.5, mt: 0.25, textAlign: mine ? "right" : "left" }}>
                    {fmtWhen(m.sentAt)}
                    {mine && m.deliveredAt === null && " · queued"}
                  </Typography>
                )}
              </Box>
            );
          })
        )}
      </Box>

      {/* composer */}
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.5, p: 1, borderTop: `1px solid ${GX.edge}`, flexShrink: 0 }}>
        <Tooltip title="Emoji">
          <IconButton
            size="small"
            onClick={(e) => setEmojiAnchor(e.currentTarget)}
            data-el-id="amberxvid:messenger:chat:emoji"
          >
            <EmojiIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={4}
          placeholder={`Message ${label}…`}
          value={draft}
          inputRef={inputRef}
          onChange={(e) => setDraft(e.target.value.slice(0, MESSAGE_MAX))}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // P16 — the member's `messengerEnterToSend` row decides which of
            // Enter and Shift+Enter sends. Read here rather than lifted into
            // the component's props because it is one boolean the composer
            // owns entirely, and threading it through four callers would make
            // the setting look like state.
            const send = enterToSend ? !e.shiftKey : e.shiftKey;
            if (!send) return;
            e.preventDefault();
            void doSend();
          }}
          data-el-id="amberxvid:messenger:chat:input"
        />
        <Tooltip title={enterToSend ? "Send (Enter)" : "Send (Shift+Enter)"}>
          <span>
            <IconButton
              size="small"
              onClick={() => void doSend()}
              disabled={!draft.trim() || sending}
              data-el-id="amberxvid:messenger:chat:send"
              sx={{
                color: theme.accent,
                "&:active": intensity === "off" ? undefined : { transform: "scale(0.85)" },
              }}
            >
              <SendIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <EmojiPicker
        anchor={emojiAnchor}
        onClose={() => setEmojiAnchor(null)}
        onPick={(e) => {
          setDraft((d) => (d.length + e.length <= MESSAGE_MAX ? d + e : d));
          inputRef.current?.focus();
        }}
      />

      <Menu open={roomMenu !== null} anchorEl={roomMenu} onClose={() => setRoomMenu(null)}>
        <MenuItem
          onClick={() => {
            setInvite(true);
            setRoomMenu(null);
          }}
        >
          Invite somebody
        </MenuItem>
        <MenuItem
          onClick={() => {
            setRename(true);
            setRoomMenu(null);
          }}
        >
          Rename group
        </MenuItem>
        <MenuItem
          sx={{ color: GX.err }}
          onClick={() => {
            void link.groupAction("leave", target.id, "").then((ok) => {
              if (ok) {
                toast("You left the group");
                link.closeChat(target.id);
              }
            });
            setRoomMenu(null);
          }}
        >
          Leave group
        </MenuItem>
      </Menu>

      <PromptDialog
        open={invite}
        title="Invite somebody to this group"
        help="Their username. Everybody already in the room has to be able to interact with them — a block anywhere in the room refuses the invitation."
        placeholder="username"
        confirm="Invite"
        onClose={() => setInvite(false)}
        onSubmit={async (value) => {
          const ok = await link.groupAction("invite", target.id, value);
          if (ok) toast(`${value} is in the group`);
          return ok;
        }}
      />
      <PromptDialog
        open={rename}
        title="Rename this group"
        help="Only the group's owner can rename it. An empty name clears it back to unnamed."
        placeholder="group name"
        initial={row?.title ?? target.title ?? ""}
        max={THREAD_TITLE_MAX}
        allowEmpty
        confirm="Rename"
        onClose={() => setRename(false)}
        onSubmit={async (value) => {
          const ok = await link.groupAction("rename", target.id, value);
          if (ok) toast("Group renamed");
          return ok;
        }}
      />
      {ctxMenu}
    </Box>
  );
}

/* --------------------------------- small dialogs -------------------------------- */

/** One text field, one verb — invite, rename, add a buddy. */
function PromptDialog({
  open,
  title,
  help,
  placeholder,
  initial = "",
  max = 64,
  allowEmpty = false,
  confirm,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  help: string;
  placeholder: string;
  initial?: string;
  max?: number;
  allowEmpty?: boolean;
  confirm: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  const go = async () => {
    if (busy || (!allowEmpty && !value.trim())) return;
    setBusy(true);
    const ok = await onSubmit(value.trim());
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 11.5, color: GX.dim, mb: 1 }}>{help}</Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, max))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void go();
            }
          }}
          data-el-id="amberxvid:messenger:prompt:input"
        />
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={busy || (!allowEmpty && !value.trim())}
          onClick={() => void go()}
          data-el-id="amberxvid:messenger:prompt:go"
        >
          {confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AddBuddyDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (username: string) => Promise<boolean>;
}) {
  return (
    <PromptDialog
      open={open}
      title="Add a buddy"
      help="Their username. They get a request and you are buddies once they accept — and if they already asked you, this accepts theirs."
      placeholder="username"
      confirm="Send request"
      onClose={onClose}
      onSubmit={onAdd}
    />
  );
}

/** Open a group: a name and the buddies in it. Only BUDDIES are offered — the
 *  store gates the room pairwise anyway, and offering the whole roster would
 *  invite refusals nobody can explain from a picker. */
function NewGroupDialog({
  open,
  buddies,
  screennameFor,
  onClose,
  onCreate,
}: {
  open: boolean;
  buddies: BuddyPresence[];
  screennameFor: (user: string) => string;
  onClose: () => void;
  onCreate: (title: string, members: string[]) => Promise<boolean>;
}) {
  const [title, setTitle] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle("");
      setPicked([]);
    }
  }, [open]);

  const toggle = (username: string) =>
    setPicked((p) => (p.includes(username) ? p.filter((u) => u !== username) : [...p, username]));

  const go = async () => {
    if (busy || picked.length === 0) return;
    setBusy(true);
    const ok = await onCreate(title.trim(), picked);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Open a group</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="group name (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, THREAD_TITLE_MAX))}
          data-el-id="amberxvid:messenger:group:title"
          sx={{ mb: 1 }}
        />
        <Typography sx={{ fontSize: 11.5, color: GX.dim, mb: 0.5 }}>
          Who is in it? Everybody in the room has to be able to interact with everybody else — a
          block between any two of them refuses the whole group.
        </Typography>
        <Box sx={{ maxHeight: 240, overflowY: "auto" }}>
          {buddies.map((b) => (
            <FormControlLabel
              key={b.username}
              sx={{ display: "flex", ml: 0 }}
              control={
                <Checkbox
                  size="small"
                  checked={picked.includes(b.username)}
                  onChange={() => toggle(b.username)}
                  data-el-id={`amberxvid:messenger:group:pick:${b.username}`}
                />
              }
              label={<Typography sx={{ fontSize: 12.5 }}>{screennameFor(b.username)}</Typography>}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={busy || picked.length === 0}
          onClick={() => void go()}
          data-el-id="amberxvid:messenger:group:go"
        >
          Open group
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* -------------------------------- settings pane -------------------------------- */

function MessengerSettingsPane({
  link,
  theme,
  dur,
}: {
  link: MessengerLink;
  theme: MessengerTheme;
  dur: number;
}) {
  const s = link.settings;
  const [awayDraft, setAwayDraft] = React.useState(s.awayMessage);
  React.useEffect(() => setAwayDraft(s.awayMessage), [s.awayMessage]);

  const row = (label: string, help: string, control: React.ReactNode) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.75, borderBottom: `1px solid ${gxa(GX.edge, "44")}` }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{label}</Typography>
        <Typography sx={{ fontSize: 10.5, color: GX.dim }}>{help}</Typography>
      </Box>
      {control}
    </Box>
  );

  const heading = (text: string) => (
    <Typography sx={{ fontFamily: GX.mono, fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: GX.dim }}>
      {text}
    </Typography>
  );

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 1.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
      {heading("Alerts — this profile only")}
      <Box>
        {row(
          "Notification alerts",
          "Toast when a message arrives outside the open chat",
          <Switch
            size="small"
            checked={s.notifications}
            onChange={(e) => void link.saveSettings({ notifications: e.target.checked })}
            data-el-id="amberxvid:messenger:set:notifications"
          />,
        )}
        {row(
          "Receive sound",
          "A short chime on every incoming message",
          <Switch
            size="small"
            checked={s.sound}
            onChange={(e) => void link.saveSettings({ sound: e.target.checked })}
            data-el-id="amberxvid:messenger:set:sound"
          />,
        )}
        {row(
          "Popup on message",
          "Open the messenger straight to the conversation",
          <Switch
            size="small"
            checked={s.popupOnMessage}
            onChange={(e) => void link.saveSettings({ popupOnMessage: e.target.checked })}
            data-el-id="amberxvid:messenger:set:popup"
          />,
        )}
      </Box>

      {heading("Away message")}
      <Box>
        <Typography sx={{ fontSize: 10.5, color: GX.dim, mb: 0.5 }}>
          What buddies see while you are away. Going away puts it on your profile status line and
          flips your presence for the whole studio, not only for AmberX Vid; coming back restores
          the status line you had.
        </Typography>
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={3}
          value={awayDraft}
          onChange={(e) => setAwayDraft(e.target.value.slice(0, STATUS_MAX))}
          onBlur={() => {
            if (awayDraft !== s.awayMessage) void link.saveSettings({ awayMessage: awayDraft });
          }}
          data-el-id="amberxvid:messenger:set:away-message"
        />
      </Box>

      {heading("Chat style")}
      <Box>
        {row(
          "Message size",
          "Text size inside chat bubbles",
          <TextField
            select
            size="small"
            value={s.fontSize}
            onChange={(e) => void link.saveSettings({ fontSize: e.target.value as MessengerSettings["fontSize"] })}
            data-el-id="amberxvid:messenger:set:fontsize"
            sx={{ width: 110 }}
          >
            <MenuItem value="small">Small</MenuItem>
            <MenuItem value="medium">Medium</MenuItem>
            <MenuItem value="large">Large</MenuItem>
          </TextField>,
        )}
        {row(
          "Timestamps",
          "Show when each message was sent",
          <Switch
            size="small"
            checked={s.showTimestamps}
            onChange={(e) => void link.saveSettings({ showTimestamps: e.target.checked })}
            data-el-id="amberxvid:messenger:set:timestamps"
          />,
        )}
      </Box>

      {heading("Privacy — studio-wide")}
      <Box>
        {row(
          "Only buddies may reach me",
          "Refuses messages, calls and invitations from anybody who is not a buddy. It is a statement about YOU and it holds everywhere in the studio, not only here.",
          <Switch
            size="small"
            checked={link.relations.buddiesOnly}
            onChange={(e) => void link.setBuddiesOnly(e.target.checked)}
            data-el-id="amberxvid:messenger:set:buddies-only"
          />,
        )}
        {link.relations.blocked.length > 0 && (
          <Box sx={{ pt: 0.75 }}>
            <Typography sx={{ fontSize: 10.5, color: GX.dim, mb: 0.5 }}>
              Blocked · {link.relations.blocked.length}. They are never told, and unblocking does not
              give the buddy edge back.
            </Typography>
            {link.relations.blocked.map((b) => (
              <Box key={b.username} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}>
                <Typography sx={{ fontSize: 12, flex: 1 }}>{b.screenname ?? b.username}</Typography>
                <Button
                  size="small"
                  sx={{ py: 0, fontSize: 10.5 }}
                  onClick={() => void link.relate("unblock", b.username)}
                  data-el-id={`amberxvid:messenger:unblock:${b.username}`}
                >
                  Unblock
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {heading(`Theme · ${MESSENGER_THEMES.length} preinstalled`)}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 0.75 }}>
        {MESSENGER_THEMES.map((t) => {
          const selected = t.id === s.theme;
          return (
            <Box
              key={t.id}
              component="button"
              onClick={() => void link.saveSettings({ theme: t.id })}
              data-el-id={`amberxvid:messenger:theme:${t.id}`}
              sx={{
                all: "unset",
                cursor: "pointer",
                borderRadius: 1.5,
                overflow: "hidden",
                border: `2px solid ${selected ? t.accent : GX.edge}`,
                transition: dur ? "border-color 150ms, transform 150ms" : "none",
                "&:hover": { transform: dur ? "scale(1.02)" : "none", borderColor: t.accent },
              }}
            >
              {/* live mini-preview: the theme's own bg, pattern and bubbles */}
              <Box
                sx={{
                  bgcolor: t.bg,
                  backgroundImage: themeBackgroundCss(t),
                  p: 0.75,
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.4,
                  minHeight: 54,
                }}
              >
                <Box sx={{ alignSelf: "flex-start", bgcolor: t.bubble, border: `1px solid ${t.fade[1]}44`, borderRadius: "6px 6px 6px 2px", px: 0.75, py: 0.2 }}>
                  <Typography sx={{ fontSize: 8.5, color: t.text }}>hey!</Typography>
                </Box>
                <Box sx={{ alignSelf: "flex-end", bgcolor: t.bubble, border: `1px solid ${t.accent}66`, borderRadius: "6px 6px 2px 6px", px: 0.75, py: 0.2 }}>
                  <Typography sx={{ fontSize: 8.5, color: t.text }}>sup 👋</Typography>
                </Box>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 0.75, py: 0.4, bgcolor: GX.panel2 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: t.accent, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 10, fontWeight: selected ? 700 : 500, color: selected ? GX.ink : GX.dim }}>
                  {t.label}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box sx={{ display: "flex", justifyContent: "center", py: 1, opacity: 0.55 }}>
        <GizmoXLockup mark={26} accent={theme.accent} />
      </Box>
    </Box>
  );
}
