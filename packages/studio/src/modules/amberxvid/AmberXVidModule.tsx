"use client";

/**
 * @file AmberX Vid — the video recording suite's module shell. Owns the whole
 * experience (mounted through AmberX's `BootedHost` at `/amberxvid`): the
 * branded 7–12 s splash on every load, the module login flow (password →
 * forced change → screenname), and then the suite — the capture stage,
 * profile column and the dockable branded quick-action toolbar around the
 * outside.
 *
 * Settings come from `./settings` (the adapter over the module's decl rows),
 * read through `useEffectiveValues`: `toolbar.*` drives the dock, `recorder.*`
 * seeds the quick actions, `appearance.animationIntensity` scales every
 * animation here and below.
 *
 * PORT NOTES (GizmoX → AmberX, 2026-08-13, per the 2026-08-13 port record in PLANNING-STATE.md):
 *   - **GizmoX's layout-theme arrangement did not port; the suite arranges
 *     itself with flex.** The original rendered through `ModuleSurface`
 *     against the bespoke `amberxvid` pilot registry, with a rollable
 *     `DEFAULT_TREE` of arranged regions. AmberX has no arranged-regions
 *     system, so the shipped arrangement is fixed here as plain flex in the
 *     same visual order: SuiteBanner on top, the toolbar wherever
 *     `toolbar.placement`/`toolbar.position` docks it, then the stage column
 *     (find → stage → status strip) beside the identity column (profile →
 *     glance → suite map).
 *   - The suite banner was drawn ABOVE the module by GizmoX's `AppShell` /
 *     `StandaloneHost`; AmberX's shell knows nothing of it, so the SUITE
 *     renders it as its own top row (the splash and login stay unbannered —
 *     honest, since the banner's hooks only exist once the shell is up).
 *   - `GizmoXMark` is the shim in `./Splash` (branding-pack `mark` glyph).
 *
 * The toolbar is deliberately OUTSIDE the arranged body — it docks to a
 * screen edge per its settings, so no rearrangement can ever strand the
 * record button.
 *
 * ## P14 — the platform's own face (2026-08-15)
 *
 *   - **Navigation is declared, not typed twice.** `AMBERXVID_NAV` on the decl
 *     is the one list of surfaces; `SuiteNav.tsx` draws the surface bar and the
 *     suite map from it, the peel carries it, and the module agent derives from
 *     it. The two hand-written lists it replaced had already drifted apart.
 *   - **Every surface is addressable** — `/amberxvid?view=<id>`. The parameter
 *     is read once on arrival and written back with `replaceState` as the stage
 *     changes; it is a parameter rather than a sub-route because the suite is
 *     ONE mounted screen and a real navigation would unmount the shell that
 *     owns the live call, the running capture and the open broadcast.
 *   - **The header row is gone.** Its brand mark, product name and identity
 *     chip were the banner's job repeated one row lower; Refresh and the admin
 *     window moved onto the surface bar; and "Close profile" was a second
 *     sign-out, which P1 had already made a single accounts-wide action.
 *
 * Honesty rule: every row and number on screen comes from the real accounts
 * store. The webcam recorder (P3, `./Recorder`) and the recording library
 * (P5, `./Library`) share the stage behind a two-way view switcher — the
 * engine hook runs HERE so the toolbar, status strip and both stage views
 * share it and neither a rearrangement nor a view switch can kill a capture.
 * The messenger engine (P7, `./Messenger`) mounts at the same level —
 * presence and mailbox alerts must run with its drawer closed. The video-chat
 * engine (P8, `./VideoChat`) mounts at the same level as the messenger link
 * and is fed by its SSE stream — an incoming call must ring with the drawer
 * closed, and no view switch can drop a live call. The admin control window
 * (P9, `./AdminWindow`) mounts here too, admin-role-gated, opened only by the
 * toolbar button.
 */

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Search as SearchIcon } from "./kit/icons";
import { Refresh as RefreshIcon } from "./kit/icons";
import { Person as ProfilesIcon } from "./kit/icons";
import { Security as AdminIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { useCtx, GxChip, StatTile, type CtxItem } from "./kit/ax";
import { useToast } from "./kit/Toast";
import { STREAM_DESCRIPTION_MAX } from "./lib/types";
import type { AccountMe, AccountPublic, AccountsSnapshot, CallSignal, MessengerEvent, Profile, ReportSubject, RoomRing, RecordingQuality } from "./lib/types";
import type { MediaRoomSnapshot } from "./lib/mediaContract";
import {
  AMBERXVID_ASSET_ID,
  bool,
  setSettingValue,
  str,
  useAmberxvidPrefs,
  useEffectiveValues
} from "./settings";
import ModuleLogin from "./ModuleLogin";
import AdminWindow from "./AdminWindow";
import InviteDialog from "./InviteDialog";
import ReportDialog from "./ReportDialog";
import { ARRIVAL_PARAM, decodeArrival } from "./lib/inviteContract";
import Messenger, { dmTarget, useMessengerLink } from "./Messenger";
import VideoChatWindow, { useVideoChat } from "./VideoChat";
import Splash, { GizmoXMark, useAnimationIntensity } from "./Splash";
import AmberXVidToolbar, { useToolbarPlacement } from "./Toolbar";
import RecorderPanel, { engineActive, fmtClock, useBrowserRecorder } from "./Recorder";
import Library from "./Library";
import Profiles from "./Profiles";
import ProfilePage from "./ProfilePage";
import Albums from "./Albums";
import { ALBUM_LINK_PARAM, parseAlbumLink } from "./lib/albumClient";
import Feed from "./Feed";
import CallHistory from "./CallHistory";
import SettingsSurface from "./SettingsSurface";
import type { WallIdentity } from "./Wall";
import type { BuddyCandidate } from "./Buddies";
import AvatarView from "./Avatar";
import { useTrayLink } from "./TrayLink";
import Streams from "./Streams";
import StreamRoomWindow from "./StreamRoom";
import { useStreamHub } from "./StreamHub";
import { GroupRoomWindow, Rooms, useGroupRooms } from "./GroupRoom";
import { buildUserMenu } from "./userMenu";
import SuiteBanner from "./SuiteBanner";
import { SuiteNav, SuiteMap, NAV_IDS, type SurfaceBadge } from "./SuiteNav";
import { AMBERXVID_VIEW_PARAM } from "./amberxvid.decl";
// `signOutAmberXVid` is deliberately NOT imported here any more: the banner is
// the one place the suite signs out (P14), and the module only hears that it
// happened, through the published `onSignedOut` hook.
import {
  publishAmberXVidAvatar,
  publishAmberXVidViewer,
  resetAmberXVidViewer
} from "./lib/viewer";
import {
  lower as axvLower,
  publishAxvFacts,
  publishAxvPlatform,
  resetAxvFacts,
  type AxvPlatform
} from "./ctxBridge";
import { publishAmberXVidBannerHooks } from "./lib/banner";

/* ----------------------------------- layout ---------------------------------- */

/*
 * The arrangement the screen ships with — in GizmoX a rollable `DEFAULT_TREE`
 * of arranged regions, here a fixed flex layout in the same order: the stage
 * column (find → stage → status strip, ~1080 weight) beside the identity
 * column (profile → glance → suite map, ~400 weight).
 */

/** The identity column's width — the 400 of the original 1080/400 split. */
const SIDE_COLUMN_WIDTH = 400;

/** Floor for the arranged body. */
const AMBERXVID_MIN_HEIGHT = 480;

/* ------------------------------------ gate ----------------------------------- */

type SnapState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snap: AccountsSnapshot };

export default function AmberXVidModule() {
  const [splashDone, setSplashDone] = React.useState(false);
  const [entered, setEntered] = React.useState(false);
  const [state, setState] = React.useState<SnapState>({ kind: "loading" });

  // A refresh must never unmount the suite: dropping back to `loading` remounts
  // Shell from scratch, which closes the admin window mid-CRUD and would tear
  // down a live recording or call. So the spinner (and the error screen) are
  // for the FIRST load only — once a snapshot is on screen, a refresh swaps it
  // in place and a failed one leaves what the user is looking at alone.
  const load = React.useCallback(async (): Promise<boolean> => {
    let hadSnapshot = false;
    setState((s) => {
      hadSnapshot = s.kind === "ready";
      return hadSnapshot ? s : { kind: "loading" };
    });
    const fail = (message: string): boolean => {
      if (!hadSnapshot) setState({ kind: "error", message });
      return false;
    };
    try {
      const res = await fetch("/api/amberxvid/accounts");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return fail(body?.error ?? `accounts service answered ${res.status}`);
      }
      const snap = (await res.json()) as AccountsSnapshot;
      setState({ kind: "ready", snap });
      // The chrome around this module draws itself from the role, and it
      // renders ABOVE us — hand it the snapshot rather than making it fetch
      // again. A promotion or demotion lands on the bar the moment the module
      // hears about it.
      // `suiteOnly` is "signed into the suite AS A MEMBER". A signed-in
      // non-member is not looking at the suite yet (they are on the join
      // card), so handing the chrome `true` here would draw them the suite's
      // bar around a screen that is not the suite.
      publishAmberXVidViewer(snap.me, snap.signedIn === true && snap.notMember !== true);
      return true;
    } catch {
      return fail("the accounts service did not answer");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const onMe = React.useCallback((me: AccountMe) => {
    setState((s) => (s.kind === "ready" ? { kind: "ready", snap: { ...s.snap, me } } : s));
  }, []);

  // The splash always plays out its full random duration, every load — the
  // snapshot fetch above runs in parallel, so the wait is never wasted.
  if (!splashDone) return <Splash onDone={() => setSplashDone(true)} />;

  if (state.kind === "loading") {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", p: 6 }}>
        <CircularProgress size={22} />
      </Box>
    );
  }

  if (state.kind === "error") {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
          <Alert severity="error" variant="outlined">{state.message}</Alert>
          <Button variant="outlined" onClick={() => void load()}>Try again</Button>
        </Box>
      </Box>
    );
  }

  const { snap } = state;
  const flowComplete =
    snap.me !== null &&
    // P1: signed in is no longer the same question as "is a member". A studio
    // session with the amberxvid grant revoked reaches here with `me: null`
    // and `notMember`, and belongs on the join card, not in the suite.
    snap.notMember !== true &&
    !snap.me.disabled &&
    !snap.me.mustChangePassword &&
    snap.me.screenname !== null &&
    // The studio's `axs_session` IS the entry token — there is no second
    // module token left to have been "loaded".
    (entered || snap.signedIn === true);

  if (!flowComplete) {
    return (
      <ModuleLogin
        me={snap.me}
        signedIn={snap.signedIn === true}
        notMember={snap.notMember === true}
        canJoin={snap.canJoin === true}
        pendingResets={snap.pendingResets ?? 0}
        onMe={onMe}
        onEntered={() => setEntered(true)}
        onRefresh={() => void load()}
      />
    );
  }

  return (
    <Shell
      snap={snap}
      onRefresh={load}
      onProfileClosed={() => {
        setEntered(false);
        void load();
      }}
    />
  );
}

/* ----------------------------------- shell ----------------------------------- */

/**
 * The stage views the suite's body can show. `messenger` is deliberately NOT
 * one: it is a drawer that opens over whatever stage is up, so it is a
 * navigable SURFACE without being a stage — which is exactly why the nav's
 * `onOpen` takes a surface id and this type stays the smaller set.
 */
type StageView =
  | "recorder"
  | "library"
  | "profiles"
  | "streams"
  | "rooms"
  | "profile"
  | "feed"
  | "albums"
  | "calls"
  /** P16 — the settings tree. A stage rather than a dialog because two of its
   *  six groups are per-member documents with their own fetches, and a screen
   *  the member can link to, bookmark and leave open is the right home for
   *  something they read as much as they edit. */
  | "settings";

const STAGE_VIEWS: readonly StageView[] = [
  "recorder",
  "library",
  "profiles",
  "streams",
  "rooms",
  "profile",
  "feed",
  "albums",
  "calls",
  "settings"
];

const isStageView = (v: string): v is StageView => (STAGE_VIEWS as readonly string[]).includes(v);

function Shell({
  snap,
  onRefresh,
  onProfileClosed
}: {
  snap: AccountsSnapshot;
  /** Resolves true when the snapshot really refreshed (see `load`). */
  onRefresh: () => Promise<boolean>;
  onProfileClosed: () => void;
}) {
  const me = snap.me!;
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const { openCtx, ctxMenu } = useCtx();
  const values = useEffectiveValues(AMBERXVID_ASSET_ID);
  /** P16 — the settings tree, typed. `values` above is the ported GizmoX
   *  adapter over the same store and stays for the ~30 call sites that read by
   *  dotted id; new reads go through this. */
  const prefs = useAmberxvidPrefs();
  const { position, autohide } = useToolbarPlacement();

  /* ------------------------------ session state ----------------------------- */

  // Mic follows `recorder.micDefault` until the quick action overrides it for
  // this session. Never seed useState from a setting — the spec-defaults-on-
  // first-render trap would latch the wrong value.
  const [micOverride, setMicOverride] = React.useState<boolean | null>(null);
  const micOn = micOverride ?? bool(values, "recorder.micDefault", true);
  const [adminOpen, setAdminOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  /* P17 — what a *Report to moderators* row is currently composing about. The
   * subject comes from the surface that was right-clicked; the REASON is typed
   * in the dialog, because it has to be the reporter's own words. */
  const [reportSubject, setReportSubject] = React.useState<ReportSubject | null>(null);
  const [find, setFind] = React.useState("");
  // The stage hosts nine views behind the declared nav; the engine hook stays
  // up here so flipping views can never kill a running capture.
  const [stageView, setStageView] = React.useState<StageView>("recorder");
  const [libraryFocus, setLibraryFocus] = React.useState<string | null>(null);
  const [profileFocus, setProfileFocus] = React.useState<string | null>(null);
  /* P10 — whose photo surface the Photos stage is showing, and (from a deep
   * link or an album cover on a profile) which album and item to open on
   * arrival. A separate cursor from the two above for the same reason they are
   * separate from each other: three stages, three screens, and a shared cursor
   * would make a link into one of them move the others. */
  const [albumOwner, setAlbumOwner] = React.useState<string>(me.username);
  const [albumFocus, setAlbumFocus] = React.useState<{ albumId: string; photoId: string | null } | null>(
    null,
  );
  /* P9 — whose social face the Profile stage is showing. It is a separate
   * cursor from `profileFocus` (the Profiles stage's member selection) on
   * purpose: the two stages are different screens and sharing one cursor would
   * make a deep-link into either of them move the other. */
  const [socialUser, setSocialUser] = React.useState<string>(me.username);

  // My own profile feeds the identity card; `profileTick` bumps on any save in
  // the profiles surface so the card and the avatar never lag a design.
  const [profileTick, setProfileTick] = React.useState(0);
  const [myProfile, setMyProfile] = React.useState<Profile | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/amberxvid/profiles?user=${encodeURIComponent(me.username)}`);
        const json = (await res.json().catch(() => null)) as { ok?: boolean; profile?: Profile } | null;
        if (!cancelled && res.ok && json?.ok && json.profile) setMyProfile(json.profile);
      } catch {
        /* the identity card degrades to the initial disc */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me.username, profileTick]);

  // The messenger engine (P7): SSE presence + live delivery + the offline
  // queue's at-login flush. Mounted HERE, not in the drawer, so presence and
  // mailbox alerts run with the messenger closed. Call signals ride the same
  // stream; the ref breaks the mount-order knot (the link opens the stream
  // before the call engine below exists).
  const callSignalRef = React.useRef<(signal: CallSignal) => void>(() => undefined);
  const streamEventRef = React.useRef<(event: MessengerEvent) => void>(() => undefined);
  const roomMediaRef = React.useRef<(roomId: string, snapshot: MediaRoomSnapshot) => void>(() => undefined);
  const roomRingRef = React.useRef<(ring: RoomRing) => void>(() => undefined);
  const messenger = useMessengerLink({
    me,
    notify: toast,
    onCallSignal: (signal) => callSignalRef.current(signal),
    onRoomRing: (ring) => roomRingRef.current(ring),
    onStreamEvent: (event) => streamEventRef.current(event),
    onRoomMedia: (roomId, snapshot) => roomMediaRef.current(roomId, snapshot)
  });
  const unread = messenger.unread;

  // The SFU video-chat engine (P6) — mounted at shell level for the same
  // reason as the messenger link: an incoming call rings with everything
  // closed, and no view switch can drop a live call.
  //
  // P13 gives it two shell-owned callbacks, and both are refs for the same
  // mount-order reason the SSE callbacks above are: `onRingAlert` reaches the
  // tray link, which is declared further down beside the recorder it belongs
  // to, and `joinRoom` reaches the rooms engine, which is declared below this
  // one. The engine knows neither — it decides that a ring happened and that
  // somebody said yes, and hands both facts outward.
  const trayAlertRef = React.useRef<(text: string) => void>(() => undefined);
  const joinRoomRef = React.useRef<(roomId: string) => Promise<void>>(async () => undefined);
  const videoChat = useVideoChat({
    me: me.username,
    notify: toast,
    onRingAlert: (text) => trayAlertRef.current(text),
    joinRoom: (roomId) => joinRoomRef.current(roomId)
  });
  callSignalRef.current = videoChat.handleSignal;
  roomRingRef.current = videoChat.handleRoomRing;

  // The live-stream engine (P14, on the SFU since P7) — same altitude, same
  // reasoning: hosting survives view switches, and "Live" badges update with
  // every surface closed. Fed by the messenger link's SSE stream via the ref.
  const streamHub = useStreamHub({ me: me.username, notify: toast });

  // The group-room engine (P11) — the N-way video room. Same altitude as the
  // other two for the same reason: a meeting must survive a view switch, and
  // the rooms list has to stay current with every surface closed.
  const groupRooms = useGroupRooms({ me: me.username, notify: toast });
  joinRoomRef.current = (roomId) => groupRooms.join(roomId);

  /**
   * P13 — a call-history row asking to go back into a room. `false` means the
   * room is gone, which is what turns the row's action into a call-back; the
   * rooms engine's own `join` throws or refuses for a room that has ended, and
   * translating that into a boolean here keeps the history surface free of any
   * idea of what a room record is.
   */
  const rejoinRoom = React.useCallback(
    async (roomId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/amberxvid/rooms?room=${encodeURIComponent(roomId)}`);
        const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (!res.ok || !json?.ok) return false;
        await groupRooms.join(roomId);
        return true;
      } catch {
        return false;
      }
    },
    [groupRooms]
  );

  /**
   * P13 — ring a member into the room this member is currently in.
   *
   * The whole authorisation story is the server's (`lib/ring` + the rooms
   * route's seat check), so this reports rather than decides: an
   * `unavailable` answer is the callee's do-not-disturb and is said as such,
   * and everything else is the route's own sentence. Nothing here re-derives
   * who may ring whom.
   */
  const ringIntoRoom = React.useCallback(
    async (user: string): Promise<void> => {
      const room = groupRooms.room;
      if (!room) return;
      try {
        const res = await fetch("/api/amberxvid/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ring", roomId: room.id, to: user })
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; unavailable?: boolean }
          | null;
        if (!res.ok || !json?.ok) {
          toast(json?.error ?? "That invite didn't send");
          return;
        }
        toast(`Ringing ${messenger.screennameFor(user)} into "${room.title}"`);
      } catch {
        toast("The rooms service did not answer");
      }
    },
    [groupRooms.room, messenger, toast]
  );

  /**
   * P13 — the missed-call count behind the Calls tab's badge.
   *
   * Polled rather than pushed, and deliberately so: a missed call ALREADY
   * announced itself over the wire the member cares about (the DM note lands
   * in the messenger's live stream), so this number is a convenience on a tab
   * label and not the notification. A minute is slow enough to be free and
   * quick enough that the badge is right by the time somebody looks at it, and
   * the poll pauses with the tab hidden for the same reason the feed's does.
   */
  const [missedCalls, setMissedCalls] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    const read = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/amberxvid/calls/history");
        const json = (await res.json().catch(() => null)) as { ok?: boolean; missed?: number } | null;
        if (alive && json?.ok && typeof json.missed === "number") setMissedCalls(json.missed);
      } catch {
        /* the badge is a convenience, never an error */
      }
    };
    void read();
    const t = window.setInterval(() => void read(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
    // Re-read whenever the call surface settles: a call that just ended is the
    // most likely reason this number moved.
  }, [videoChat.phase, stageView]);

  // Module-stream events fan to BOTH the stream hub and the rooms engine: the
  // hub reads `streams`/`stream-*`, the rooms engine reads `rooms`/`room-signal`,
  // and each ignores what is not its own. One wire, two consumers.
  streamEventRef.current = (event) => {
    streamHub.handleEvent(event);
    groupRooms.handleEvent(event);
  };

  // `room-media` announcements fan to ALL THREE engines (P7, extended P11):
  // each ignores rooms it is not attached to, so one wire serves calls,
  // streams and group rooms alike.
  roomMediaRef.current = (roomId, snapshot) => {
    videoChat.handleRoomMedia(roomId, snapshot);
    streamHub.handleRoomMedia(roomId, snapshot);
    groupRooms.handleRoomMedia(roomId, snapshot);
  };

  // Go-live is a two-step (title, then camera) — the dialog owns step one.
  const [goLiveOpen, setGoLiveOpen] = React.useState(false);
  const [goLiveTitle, setGoLiveTitle] = React.useState("");
  /** P12 — the blurb, set at go-live and editable live from host tools. */
  const [goLiveDesc, setGoLiveDesc] = React.useState("");
  const openGoLive = React.useCallback(() => {
    if (streamHub.myStream) streamHub.openRoom();
    else setGoLiveOpen(true);
  }, [streamHub]);

  // THE user menu (P14) — one builder, every member surface. New actions land
  // here once and appear on the members list, profiles, buddies, stream tiles
  // and room chips together.
  const userMenu = React.useMemo(
    () =>
      buildUserMenu({
        me: me.username,
        screennameFor: messenger.screennameFor,
        roster: messenger.roster,
        streamOf: streamHub.streamOf,
        openChat: messenger.openChat,
        startCall: (u) => void videoChat.startCall(u),
        viewProfile: (u) => {
          setProfileFocus(u);
          setStageView("profiles");
        },
        watchStream: (id) => void streamHub.watch(id),
        // P13 — the row exists only while the viewer is IN a room, which is
        // also the only case the server accepts a ring for: "join the room
        // before inviting anyone into it" is enforced there, and this simply
        // does not offer what would be refused.
        ringToRoom: groupRooms.room
          ? { title: groupRooms.room.title, invite: (u) => void ringIntoRoom(u) }
          : null,
        notify: toast
      }),
    [me.username, messenger.screennameFor, messenger.roster, messenger.openChat, streamHub, videoChat, groupRooms.room, ringIntoRoom, toast]
  );

  /* ----------------------- the DECLARED context-menu map (P15) ---------------
   *
   * `userMenu` above is the same set of member actions, and the two are NOT a
   * duplication: this is the one place they meet the declared map, and it is
   * built from the same engines rather than from a second idea of what a member
   * row does. When AmberX's menu manager can edit these rows, it edits the
   * DECLARATION — which is exactly why the behaviour had to stop living inside
   * a `CtxItem` literal.
   *
   * Everything below is shell-owned by necessity: a member chip is drawn in six
   * places and none of them holds the messenger, the video engine and the room
   * engine at once. Per-instance subjects (a post, a photo, a stream card)
   * register their own actions from the component that draws them — see
   * `ctxBridge.ts`.
   */
  const platform: AxvPlatform = React.useMemo(
    () => ({
      member: (user: string) => ({
        viewProfile: () => {
          setProfileFocus(user);
          setStageView("profiles");
        },
        message: () => messenger.openChat(user),
        call: () => void videoChat.startCall(user),
        inviteToRoom: () => void ringIntoRoom(user),
        addBuddy: () => {
          void messenger
            .relate("request", user)
            .then((ok) =>
              toast(
                ok
                  ? `Buddy request sent to ${messenger.screennameFor(user)}`
                  : "That request didn't send"
              )
            );
        },
        /**
         * The confirm lives HERE rather than in the menu, per the map's own
         * rule — the row summons a flow, it does not become one. It is the
         * only member action that asks, because a block is silent and
         * one-sided: the person blocked is never told, so there is no moment
         * afterwards in which a mistake announces itself.
         */
        block: () => {
          const name = messenger.screennameFor(user);
          if (!window.confirm(`Block ${name}? They are not told, and it stops messages both ways.`)) {
            return;
          }
          void messenger
            .relate("block", user)
            .then((ok) => toast(ok ? `${name} blocked — they are not told` : "That block didn't take"));
        }
      }),
      surface: {
        // Both of these OPEN THE SURFACE that owns the composer rather than
        // inventing a second one. A room is named in the Rooms bar's own field
        // and a post is written in the wall's own composer, and a menu row that
        // grew a parallel dialog would be a second place for the length limits
        // and the visibility picker to drift.
        newRoom: () => setStageView("rooms"),
        newPost: () => {
          setSocialUser(me.username);
          setStageView("profile");
        },
        openMyProfile: () => {
          setSocialUser(me.username);
          setStageView("profile");
        },
        goLive: openGoLive,
        openVideoSettings: () => videoChat.openSettings()
      },
      /**
       * Reporting opens the composer, which files into the MODERATION QUEUE
       * (P17, `lib/reports.ts`) — read by the wing inside the accounts admin
       * suite. It used to DM every administrator, because a report filing into
       * a table nobody had built would report into nothing; the table exists
       * now, and the DM path is gone rather than kept beside it.
       */
      report: (subject: ReportSubject) => setReportSubject(subject),
      copy: (text: string, said: string) => {
        void navigator.clipboard.writeText(text);
        toast(said);
      },
      share: (text: string, said: string) => {
        void navigator.clipboard.writeText(text);
        messenger.openMessenger();
        toast(said);
      },
      notify: toast
    }),
    [
      me.username,
      snap.accounts,
      messenger,
      videoChat,
      ringIntoRoom,
      openGoLive,
      toast
    ]
  );

  React.useEffect(() => {
    publishAxvPlatform(platform);
    return () => publishAxvPlatform(null);
  }, [platform]);

  /**
   * The facts a PREDICATE may ask about the viewer.
   *
   * Only what a marking surface cannot answer for itself: the members list has
   * no idea who your buddies are, and making it fetch them so that a menu row
   * could decide whether to render is how a menu starts costing a request.
   * Anything a surface does know is marked on the element instead.
   */
  React.useEffect(() => {
    publishAxvFacts({
      me: axvLower(me.username),
      moderator: me.role === "administrator",
      buddies: messenger.relations.buddies.map((b) => axvLower(b.username)),
      blocked: messenger.relations.blocked.map((b) => axvLower(b.username)),
      online: messenger.roster.filter((p) => p.online).map((p) => axvLower(p.username)),
      room: groupRooms.room
        ? {
            id: groupRooms.room.id,
            title: groupRooms.room.title,
            hosting: axvLower(groupRooms.room.host) === axvLower(me.username)
          }
        : null
    });
  }, [
    me.username,
    me.role,
    messenger.relations.buddies,
    messenger.relations.blocked,
    messenger.roster,
    groupRooms.room
  ]);

  // A stale viewer must not decide the NEXT person's rows — the same duty
  // `resetAmberXVidViewer` has for the chrome.
  React.useEffect(() => () => resetAxvFacts(), []);

  /* ------------------------------- arrival --------------------------------
   *
   * An invitation lands here (P7). The landing has already created the
   * account, applied the grant through the matrix and honoured the buddy
   * request; all that is left is the last few feet — putting the newcomer in
   * the room they were invited to — and that is a MODULE decision, which is
   * exactly why the server hands over one data value instead of three
   * redirects it would have to know this file to compose.
   *
   * Three properties, and each one is a bug it prevents:
   *
   *  - **It runs once.** The ref, not the dependency array: `streamHub` and
   *    `messenger` are new objects most renders, and a re-run would re-ring
   *    the caller every time the roster changed.
   *  - **The parameter is stripped immediately**, with `replaceState` so no
   *    history entry is left behind. A reload must not re-enter the room, and
   *    a shared URL must not carry somebody else's arrival.
   *  - **It only runs once the suite is up.** This effect lives below the
   *    entry gate, so a newcomer who still has a forced step (no screenname,
   *    say) completes it first and arrives afterwards — rather than having a
   *    call placed on their behalf from behind a login card.
   */
  /*
   * A shared ALBUM LINK lands here too (P10), on the same terms and for the
   * same reasons: once, parameter stripped with `replaceState`, and only once
   * the suite is up. It is deliberately a separate effect from the invitation
   * arrival above — an invite performs an ACTION on somebody's behalf (rings a
   * call, joins a room) and an album link only moves the stage, so folding
   * them together would put a navigation behind the "did this run once" ref of
   * something far more consequential.
   *
   * The link is an ADDRESS, never a grant: the album's own visibility decides
   * what the recipient sees, so forwarding one to a stranger shows them exactly
   * what browsing to it would have.
   */
  const albumArrived = React.useRef(false);
  React.useEffect(() => {
    if (albumArrived.current) return;
    const url = new URL(window.location.href);
    const link = parseAlbumLink(url.search);
    if (!link) return;
    albumArrived.current = true;
    url.searchParams.delete(ALBUM_LINK_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setAlbumOwner(link.owner);
    setAlbumFocus({ albumId: link.albumId, photoId: link.photoId });
    setStageView("albums");
  }, []);

  const arrived = React.useRef(false);
  React.useEffect(() => {
    if (arrived.current) return;
    const url = new URL(window.location.href);
    const arrival = decodeArrival(url.searchParams.get(ARRIVAL_PARAM));
    if (!arrival) return;
    arrived.current = true;
    url.searchParams.delete(ARRIVAL_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

    if (arrival.kind === "stream") {
      setStageView("streams");
      void streamHub.watch(arrival.id).then((ok) => {
        toast(ok ? "You are in the stream you were invited to" : "That stream has ended — welcome anyway");
      });
    } else if (arrival.kind === "chat") {
      messenger.openMessenger();
      messenger.openThread(arrival.id);
      toast("You are in the group chat you were invited to");
    } else if (arrival.kind === "call") {
      toast(`Ringing ${messenger.screennameFor(arrival.with)}…`);
      void videoChat.startCall(arrival.with);
    }
  }, [messenger, streamHub, videoChat, toast]);

  const quality = str(values, "recorder.quality", "high");
  const resolution = str(values, "recorder.resolution", "1280x720");
  const saveTo = str(values, "recorder.saveTo", "library");
  const backgroundArmed = bool(values, "background.armed", false);

  // The capture engine lives HERE, not in the stage panel: the toolbar's
  // record action and the status strip drive the same instance, and a
  // rearranged stage must never kill a running capture.
  const engine = useBrowserRecorder({
    micOn,
    resolution,
    quality: quality as RecordingQuality,
    saveTo,
    notify: toast
  });
  const armed = engineActive(engine.status);
  // "The browser owns the camera" includes the PREVIEW hold — dshow needs the
  // device exclusively, so an open stream blocks the tray as surely as a
  // running capture does.
  const browserRecording = armed || engine.stream !== null;

  // The tray-service link (P4): heartbeat sync + real liveness + commands.
  // `browserRecording` riding the sync is the tray-side double-capture guard.
  const tray = useTrayLink({
    resolution,
    quality,
    micOn,
    browserRecording,
    backgroundArmed,
    notify: toast
  });
  // P13 — the ring balloon. Fire-and-forget: a tray that is not running
  // answers 409 and the ring is still on screen, which is the honest outcome.
  trayAlertRef.current = (text) => {
    // P16 — the settings tree's `trayAlerts` row. The gate is here rather than
    // in the engine because the engine deliberately does not know what a tray
    // is: it decides a ring happened and hands the fact outward, and THIS is
    // the shell's decision about what to do with it.
    if (!prefs.trayAlerts) return;
    void tray.command("alert", text);
  };

  // Handoff browser → tray: arming background mode mid-capture stops the
  // browser engine first, so the device is never open in two engines at once.
  const prevBackgroundArmed = React.useRef(backgroundArmed);
  React.useEffect(() => {
    const rose = backgroundArmed && !prevBackgroundArmed.current;
    prevBackgroundArmed.current = backgroundArmed;
    if (rose && engineActive(engine.status)) {
      engine.stop();
      toast("Capture handed off — the browser recording is saving, the tray service owns record now");
    }
  }, [backgroundArmed, engine, toast]);

  // While background mode is armed the tray owns the device: release the
  // browser's preview hold whenever the engine is not actively capturing —
  // covers arming during preview AND the return to preview after a handoff
  // stop finishes saving.
  React.useEffect(() => {
    if (backgroundArmed && engine.status === "preview") {
      engine.disableCamera();
      toast("Camera released — background mode reserves it for the tray service");
    }
  }, [backgroundArmed, engine, engine.status, toast]);

  // A tray-menu background toggle raises a request; the `background.armed`
  // setting stays the single source of truth, so the web adopts it here (the
  // next sync acks it and the tray drops the request).
  const appliedBgRequestAt = React.useRef<string | null>(null);
  const bgRequest = tray.status?.backgroundRequest ?? null;
  React.useEffect(() => {
    if (!bgRequest || appliedBgRequestAt.current === bgRequest.at) return;
    appliedBgRequestAt.current = bgRequest.at;
    if (bgRequest.value !== backgroundArmed) {
      setSettingValue(AMBERXVID_ASSET_ID, "background.armed", bgRequest.value);
      toast(bgRequest.value ? "Background mode armed from the tray" : "Background mode turned off from the tray");
    }
  }, [bgRequest, backgroundArmed, toast]);

  /**
   * The suite banner cannot see which stage view is open or how a sign-out
   * has to unwind `entered`. Publish the two actions it needs and retract
   * them on unmount — unpublished means the banner's account chip is not a
   * button, which is the honest state before the shell mounts rather than a
   * control that does nothing.
   *
   * P14 re-pointed `onAccount` at the ACCOUNTS SURFACE. It used to focus the
   * member in the Profiles directory — the module's own member browser, which
   * was the right answer while amberxvid had its own identity. Since P1 there
   * is one identity system, and clicking your own face should land on your
   * accounts profile: the page with your wall, your albums and your buddy
   * requests on it, which is the same page every other member's name opens.
   */
  React.useEffect(() => {
    publishAmberXVidBannerHooks({
      onAccount: () => {
        setSocialUser(me.username);
        setStageView("profile");
      },
      onSignedOut: () => {
        resetAmberXVidViewer();
        onProfileClosed();
      }
    });
    return () => publishAmberXVidBannerHooks(null);
  }, [me.username, onProfileClosed]);

  /* The banner's account chip draws the accounts FACE, and the accounts
     snapshot does not carry one — the profile is a second fetch. Publish it as
     it arrives (and on every save, via `profileTick`), so the chip catches up
     rather than the whole bar waiting on it. */
  React.useEffect(() => {
    publishAmberXVidAvatar(myProfile?.avatar ?? null);
  }, [myProfile]);

  const toggleRecord = React.useCallback(() => {
    if (backgroundArmed) {
      // The record quick action belongs to the tray service while armed.
      if (tray.trayActive) {
        void tray.command("record-stop");
        return;
      }
      if (tray.running !== true) {
        toast(tray.why ?? "The tray service is not running — start it from the status strip");
        return;
      }
      if (browserRecording) {
        toast("The browser engine still owns the camera — stop that capture first");
        return;
      }
      void tray.command("record-start");
      return;
    }
    if (tray.trayActive) {
      // The reverse double-capture guard: one device, one engine.
      toast("The tray service owns the camera — stop the background capture first");
      return;
    }
    if (engine.status === "recording" || engine.status === "paused") engine.stop();
    else if (!engineActive(engine.status)) void engine.start();
  }, [backgroundArmed, browserRecording, engine, toast, tray]);

  const toggleMic = React.useCallback(() => {
    setMicOverride(() => {
      const next = !micOn;
      toast(next ? "Mic live" : "Mic muted");
      return next;
    });
  }, [micOn, toast]);

  const refresh = React.useCallback(async () => {
    const ok = await onRefresh();
    toast(ok ? "Accounts refreshed" : "Could not reach the accounts service — showing the last known state");
  }, [onRefresh, toast]);

  const screennameOf = React.useCallback(
    (u: string) =>
      snap.accounts.find((a) => a.username.toLowerCase() === u.toLowerCase())?.screenname ?? u,
    [snap.accounts]
  );

  const openInLibrary = React.useCallback((id: string) => {
    setLibraryFocus(id);
    setStageView("library");
  }, []);

  /* ------------------------------ the social face (P9) ----------------------
   * Open somebody's profile page. Every wall author, comment author and search
   * row routes through this one callback, so a name is clickable everywhere the
   * social surfaces draw one and lands in the same place. */
  const openProfilePage = React.useCallback((user: string) => {
    setSocialUser(user);
    setStageView("profile");
  }, []);

  /* ------------------------------ the photo surface (P10) -------------------
   * One door into the albums, whether it is opened by the stage button, by an
   * album cover on a profile, or by a link somebody pasted into a DM. The
   * focus is handed over as data and CONSUMED by the surface, so returning to
   * the stage later does not re-open the album a link once named. */
  const openAlbums = React.useCallback(
    (user: string, albumId?: string, photoId?: string | null) => {
      setAlbumOwner(user);
      setAlbumFocus(albumId ? { albumId, photoId: photoId ?? null } : null);
      setStageView("albums");
    },
    [],
  );

  /*
   * How the wall turns a username into a face and a name.
   *
   * It reads the MESSENGER LINK's roster and profile map rather than fetching
   * identity of its own: that map is already live on the presence stream, and a
   * second copy refreshed on a different clock is exactly the drift the
   * accounts identity merge exists to have ended.
   */
  const wallIdentity: WallIdentity = React.useMemo(
    () => ({
      screennameFor: messenger.screennameFor,
      avatarOf: (u: string) => messenger.profiles[u.trim().toLowerCase()]?.avatar ?? null,
      onOpenProfile: openProfilePage
    }),
    [messenger.profiles, messenger.screennameFor, openProfilePage]
  );

  /** Every member the caller can see — what the empty feed's buddy search
   *  offers. Accounts with no screenname have not finished entry yet. */
  const buddyCandidates: BuddyCandidate[] = React.useMemo(
    () =>
      snap.accounts
        .filter((a) => !a.disabled && a.screenname)
        .map((a) => ({ username: a.username, screenname: a.screenname ?? a.username })),
    [snap.accounts]
  );

  /**
   * Live presence for one member. `reachable` (signed into the STUDIO) is what
   * a profile shows — a member can be reachable without having AmberX Vid open,
   * and the profile is an accounts surface. `online` is the module's own
   * channel and is what gates a CALL, which is a different question.
   */
  const presenceOf = React.useCallback(
    (user: string): { online: boolean; away: boolean } | null => {
      const row = messenger.roster.find((p) => p.username.toLowerCase() === user.toLowerCase());
      if (!row) return null;
      return { online: row.reachable ?? row.online, away: row.away === true };
    },
    [messenger.roster]
  );

  /* -------------------------------- the regions ----------------------------- */

  const needle = find.trim().toLowerCase();
  const roster = snap.accounts.filter(
    (a) =>
      !needle ||
      a.username.toLowerCase().includes(needle) ||
      (a.screenname ?? "").toLowerCase().includes(needle)
  );

  /* ------------------------------ navigation -------------------------------
   *
   * P14: there is ONE list of surfaces and it lives in the declaration
   * (`AMBERXVID_NAV`). The bar, the suite map, the peel and the module agent
   * all read it, so a surface cannot exist on one and be missing from another
   * — which is the drift that had already happened here twice (the map offered
   * "Video chat" while the bar offered "Calls"; Rooms was on the bar and absent
   * from the map).
   *
   * `openSurface` is the whole of what the declaration cannot say: what a
   * surface id MEANS. Eight of the ten are stage views and open the same way;
   * three of those clear a cursor first, because a stage button always means
   * MY profile / MY photos and a stale focus left by a deep link would open
   * somebody else's; and `messenger` is a drawer, not a stage. */
  const openSurface = React.useCallback(
    (id: string) => {
      if (id === "messenger") {
        messenger.openMessenger();
        return;
      }
      if (id === "albums") {
        openAlbums(me.username);
        return;
      }
      if (id === "profile") {
        setSocialUser(me.username);
        setStageView("profile");
        return;
      }
      if (isStageView(id)) setStageView(id);
    },
    [messenger, openAlbums, me.username]
  );

  /**
   * The live numbers beside the surfaces. Every one of them is a count some
   * engine in this shell already holds — nothing here starts a second poll to
   * put a badge on a button.
   *
   * The tones are the module kit's, and they mean something: `err` is what
   * happened while nobody was looking (missed calls) or what is happening right
   * now (rooms on air), `accent` is what is waiting on this member, `info` is
   * merely informative.
   */
  const navBadges: Record<string, SurfaceBadge | undefined> = React.useMemo(
    () => ({
      feed:
        messenger.relations.incoming.length > 0
          ? {
              count: messenger.relations.incoming.length,
              tone: "accent",
              title: `${messenger.relations.incoming.length} buddy request(s) waiting on you`
            }
          : undefined,
      profile:
        messenger.relations.incoming.length > 0
          ? {
              count: messenger.relations.incoming.length,
              tone: "accent",
              title: "Buddy requests are answered on your profile"
            }
          : undefined,
      messenger:
        unread > 0 ? { count: unread, tone: "accent", title: `${unread} unread message(s)` } : undefined,
      streams:
        streamHub.streams.length > 0
          ? { count: streamHub.streams.length, tone: "err", title: `${streamHub.streams.length} member(s) live now` }
          : undefined,
      rooms:
        groupRooms.rooms.length > 0
          ? {
              count: groupRooms.rooms.length,
              // The room you are IN outranks rooms that merely exist — it is
              // the one you might have lost behind another surface.
              tone: groupRooms.room ? "accent" : "info",
              title: groupRooms.room
                ? `You are in "${groupRooms.room.title}"`
                : `${groupRooms.rooms.length} room(s) open`
            }
          : undefined,
      calls:
        missedCalls > 0 ? { count: missedCalls, tone: "err", title: `${missedCalls} missed call(s)` } : undefined
    }),
    [
      messenger.relations.incoming.length,
      unread,
      streamHub.streams.length,
      groupRooms.rooms.length,
      groupRooms.room,
      missedCalls
    ]
  );

  /**
   * The declared nav is addressable — every link is `/amberxvid?view=<id>`, so
   * a peeled app's nav menu, a pasted URL and a bookmark all land on a real
   * surface. Two halves, and the split matters:
   *
   *  - **Arrival reads the parameter once** (the ref, not a dependency), for
   *    the same reason the invitation and album-link effects do: re-running it
   *    would drag the member back to the link's surface every time an engine
   *    re-rendered.
   *  - **The stage writes it back** with `replaceState`, never `push`. The
   *    suite is one mounted screen — a history entry per stage would turn Back
   *    into "undo my last click" and, worse, a real navigation would unmount
   *    the shell that owns the live call.
   *
   * `messenger` is a link but not a stage, so it is honoured on arrival and
   * never written back: the URL says which STAGE you are on, and the drawer is
   * over the top of one.
   */
  const viewArrived = React.useRef(false);
  React.useEffect(() => {
    if (viewArrived.current) return;
    viewArrived.current = true;
    // An album link and an invitation arrival both CHOSE a surface already, in
    // effects declared above this one and therefore run before it. `?view=` is
    // the weakest of the three — it says where to start, they say what to do —
    // so it yields rather than dragging the member off the album somebody
    // shared with them.
    if (albumArrived.current || arrived.current) return;
    const wanted = new URL(window.location.href).searchParams.get(AMBERXVID_VIEW_PARAM);
    if (!wanted || !NAV_IDS.includes(wanted)) return;
    openSurface(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, by design
  }, []);

  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(AMBERXVID_VIEW_PARAM) === stageView) return;
    url.searchParams.set(AMBERXVID_VIEW_PARAM, stageView);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [stageView]);

  const memberMenu = (a: AccountPublic): CtxItem[] => [
    ...(a.username.toLowerCase() !== me.username.toLowerCase()
      ? ([
          { label: "Message", onClick: () => messenger.openChat(a.username) },
          { label: "Video call", onClick: () => void videoChat.startCall(a.username) }
        ] as CtxItem[])
      : []),
    {
      label: "Copy screenname",
      onClick: () => {
        void navigator.clipboard.writeText(a.screenname ?? a.username);
        toast("Screenname copied");
      }
    },
    {
      label: "Copy username",
      onClick: () => {
        void navigator.clipboard.writeText(a.username);
        toast("Username copied");
      }
    },
    "---",
    {
      label: "View profile",
      onClick: () => {
        setProfileFocus(a.username);
        setStageView("profiles");
      }
    }
  ];

  // ONE toolbar element, docked per its settings around the flex body below
  // (in GizmoX this could also ride a rolled layout's `toolbar` region — that
  // system did not port; the edge dock is the arrangement).
  const toolbar = (
    <AmberXVidToolbar
      me={me}
      micOn={micOn}
      onMicToggle={toggleMic}
      armed={backgroundArmed ? tray.trayActive : armed}
      onRecordToggle={toggleRecord}
      unread={unread}
      mailbox={messenger.summaries
        .filter((s) => s.unread > 0)
        .map((s) => ({
          threadId: s.id,
          // A DM is named by the person, a group by itself — `labelForThread`
          // is the one place that decision is made, so the mailbox and the
          // chat tabs can never disagree about what a conversation is called.
          screenname: messenger.labelForThread({
            id: s.id,
            kind: s.kind,
            with: s.with,
            title: s.title
          }),
          unread: s.unread,
          preview: s.lastMessage?.text ?? "",
        }))}
      onOpenMail={(threadId) => messenger.openThread(threadId)}
      onMessenger={() => messenger.openMessenger()}
      onInvite={() => setInviteOpen(true)}
      onAdmin={() => setAdminOpen(true)}
      streaming={streamHub.myStream !== null}
      onStream={openGoLive}
    />
  );

  /* ------------------------------ region content ----------------------------
   * In GizmoX these were `defineModuleRegions("amberxvid", {...})` slots a
   * layout theme arranged; here they are plain JSX placed by the flex body. */

  const stageRegion = (
    <Panel>
      {/* `minHeight: min-content` (never `height: 100%`) is what keeps a
          short window honest: the stack fills the panel when there is room
          and grows past it when there is not, so the Panel scrolls instead
          of squeezing the recorder's sections on top of the member list. */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          flex: "1 1 auto",
          minHeight: "min-content",
        }}
      >
        {/* The surface bar — drawn from the DECLARATION (`AMBERXVID_NAV`), so
            every surface this platform has is on it, in declared order, with
            the live counts the shell's own engines already hold. */}
        <SuiteNav
          active={stageView}
          onOpen={openSurface}
          badges={navBadges}
          trailing={
            <>
              {/* A capture that is still running while you are looking at
                  something else is the one piece of state a surface change can
                  hide, so it rides the bar rather than the stage. */}
              {stageView !== "recorder" && engineActive(engine.status) && (
                <GxChip label={`capture ${engine.status} — ${fmtClock(engine.elapsedMs)}`} kind="err" />
              )}
              {me.role === "administrator" && (
                <Tooltip title="Admin control window" disableInteractive>
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    startIcon={<AdminIcon />}
                    onClick={() => setAdminOpen(true)}
                    data-el-id="amberxvid:nav:admin"
                    sx={{ py: 0.25, fontSize: 11.5 }}
                  >
                    Admin
                  </Button>
                </Tooltip>
              )}
              <Tooltip title="Re-read the accounts snapshot" disableInteractive>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={() => void refresh()}
                  data-el-id="amberxvid:nav:refresh"
                  sx={{ py: 0.25, fontSize: 11.5 }}
                >
                  Refresh
                </Button>
              </Tooltip>
            </>
          }
        />

        {stageView === "streams" ? (
          <Streams
            hub={streamHub}
            me={me.username}
            screennameFor={messenger.screennameFor}
            userMenu={userMenu}
            openCtx={openCtx}
            onGoLive={openGoLive}
            onOpenRecording={openInLibrary}
          />
        ) : stageView === "rooms" ? (
          <Rooms
            engine={groupRooms}
            me={me.username}
            screennameFor={messenger.screennameFor}
            openCtx={openCtx}
            userMenu={userMenu}
          />
        ) : stageView === "profile" ? (
          <ProfilePage
            key={socialUser}
            me={me.username}
            isAdmin={me.role === "administrator"}
            user={socialUser}
            identity={wallIdentity}
            relations={messenger.relations}
            relate={messenger.relate}
            onMessage={(u) => messenger.openChat(u)}
            presence={presenceOf(socialUser)}
            liveStream={(() => {
              // The hub is the one place a live room is known — the roster's
              // `streamingId` says THAT somebody is live, the hub says what
              // they are streaming, and only the hub can be watched.
              const stream = streamHub.streamOf(socialUser);
              return stream ? { id: stream.id, title: stream.title } : null;
            })()}
            onJoinStream={(id) => void streamHub.watch(id)}
            onOpenAlbums={(u, albumId) => openAlbums(u, albumId)}
            onOpenRecording={openInLibrary}
            onProfileChanged={() => setProfileTick((t) => t + 1)}
          />
        ) : stageView === "feed" ? (
          <Feed
            me={me.username}
            isAdmin={me.role === "administrator"}
            identity={wallIdentity}
            relations={messenger.relations}
            relate={messenger.relate}
            candidates={buddyCandidates}
            // A new buddy changes what the feed merges, so the graph's own
            // size is the reload signal — no extra channel needed.
            refreshTick={messenger.relations.buddies.length}
          />
        ) : stageView === "albums" ? (
          <Albums
            key={albumOwner}
            me={me.username}
            isAdmin={me.role === "administrator"}
            owner={albumOwner}
            ownerName={messenger.screennameFor(albumOwner)}
            identity={wallIdentity}
            focus={albumFocus}
            onFocusConsumed={() => setAlbumFocus(null)}
            onOpenOwner={(u) => openAlbums(u)}
          />
        ) : stageView === "calls" ? (
          <CallHistory
            screennameFor={messenger.screennameFor}
            profiles={messenger.profiles}
            onCall={(u) => void videoChat.startCall(u)}
            onRejoinRoom={rejoinRoom}
            notify={toast}
            openCtx={openCtx}
            userMenu={(u) => userMenu(u)}
          />
        ) : stageView === "settings" ? (
          <SettingsSurface
            meDisplay={messenger.screennameFor(me.username)}
            notify={toast}
            // The device preview opens a real camera, and doing that underneath
            // a live call either fails or steals the device. The stage says so
            // rather than trying and reporting a driver error.
            callActive={videoChat.phase !== "idle" && videoChat.phase !== "ended"}
            onOpenMessenger={() => messenger.openMessenger()}
          />
        ) : stageView === "profiles" ? (
          <Profiles
            meUsername={me.username}
            isAdmin={me.role === "administrator"}
            focusUser={profileFocus}
            onFocusConsumed={() => setProfileFocus(null)}
            onProfileChanged={() => setProfileTick((t) => t + 1)}
          />
        ) : stageView === "library" ? (
          <Library
            meUsername={me.username}
            isAdmin={me.role === "administrator"}
            screennameOf={screennameOf}
            refreshTick={engine.savedTick + tray.finalizedTick}
            focusId={libraryFocus}
            onFocusConsumed={() => setLibraryFocus(null)}
          />
        ) : (
          <>
        <RecorderPanel
          engine={engine}
          micOn={micOn}
          onMicToggle={toggleMic}
          quality={quality}
          resolution={resolution}
          backgroundArmed={backgroundArmed}
          trayActive={tray.trayActive}
          refreshTick={tray.finalizedTick}
          onPlay={openInLibrary}
        />

        <Typography sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: GX.dim, flexShrink: 0 }}>
          Members · {roster.length}{needle ? ` of ${snap.accounts.length}` : ""}
        </Typography>
        <Box sx={{ flexShrink: 0, maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 0.5 }}>
          {roster.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: GX.dim, p: 1 }}>
              {needle
                ? "No member matches that search."
                : "No accounts exist yet — the administrator adds users with temp passwords."}
            </Typography>
          ) : (
            roster.map((a) => (
              <Box
                key={a.username}
                onContextMenu={(e) => openCtx(e, `Member · ${a.screenname ?? a.username}`, memberMenu(a))}
                // The declared `amberxvid.member` area (P15). The row marks who
                // it is ABOUT and nothing else — the rows themselves are data on
                // the decl and their behaviour is the shell's published factory,
                // so a member surface never has to know what a member menu says.
                data-axf-area="amberxvid.member"
                data-axf-member={a.username}
                data-axf-member-name={a.screenname ?? a.username}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  p: 0.75,
                  borderRadius: 1,
                  border: `1px solid transparent`,
                  transition: intensity === "off" ? "none" : "border-color 150ms, background-color 150ms",
                  "&:hover": { bgcolor: gxa(GX.accent, "0d"), borderColor: gxa(GX.accent, "33") }
                }}
              >
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    bgcolor: gxa(GX.accent, "22"),
                    color: GX.accent,
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0
                  }}
                >
                  {(a.screenname ?? a.username).slice(0, 1).toUpperCase()}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                    {a.screenname ?? `${a.username} (no screenname yet)`}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: GX.dim }}>{a.username}</Typography>
                </Box>
                <Box sx={{ flex: 1 }} />
                {(() => {
                  // P14: a hosting member's row says so, and the chip joins.
                  const s = streamHub.streamOf(a.username);
                  return s && a.username !== me.username ? (
                    <Box
                      component="span"
                      title={`streaming · ${s.title} — click to join`}
                      onClick={() => void streamHub.watch(s.id)}
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
                        flexShrink: 0
                      }}
                    >
                      LIVE
                    </Box>
                  ) : s ? (
                    <GxChip label="on air" kind="err" />
                  ) : null;
                })()}
                {a.username === me.username && <GxChip label="you" kind="accent" />}
                {a.role === "administrator" && <GxChip label="admin" kind="warn" />}
                {a.disabled && <GxChip label="disabled" kind="err" />}
              </Box>
            ))
          )}
        </Box>
          </>
        )}
      </Box>
    </Panel>
  );

  const profileRegion = (
    <Panel title="Profile">
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
        <Box sx={{ border: `2px solid ${gxa(GX.accent, "55")}`, borderRadius: "50%", flexShrink: 0, display: "flex" }}>
          <AvatarView spec={myProfile?.avatar ?? null} name={me.screenname ?? me.username} size={44} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>{me.screenname}</Typography>
          <Typography sx={{ fontSize: 11, color: GX.dim }}>
            bound to GizmoX account <b>{snap.gizmoxUser}</b>
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 1 }}>
        <GxChip label={me.role} kind={me.role === "administrator" ? "warn" : "dim"} />
        <GxChip label={`since ${new Date(me.createdAt).toLocaleDateString()}`} kind="dim" />
      </Box>
      {myProfile?.statusLine && (
        <Typography sx={{ fontSize: 12, color: GX.ink, mb: 1, fontStyle: "italic" }}>
          “{myProfile.statusLine}”
        </Typography>
      )}
      <Button
        size="small"
        variant="outlined"
        startIcon={<ProfilesIcon />}
        onClick={() => setStageView("profiles")}
        data-el-id="amberxvid:profile:open-profiles"
        sx={{ alignSelf: "flex-start" }}
      >
        {myProfile?.avatar ? "Profiles & albums" : "Design your avatar"}
      </Button>
    </Panel>
  );

  /* The suite map — the SAME declared list as the bar, grouped by its declared
     sections and carrying one line about each surface. It is the bar's index
     rather than a copy of it: the bar answers "where am I", this answers "what
     is here", which is a question somebody has on their first day. */
  const suiteMapRegion = (
    <Panel title="Suite map">
      <SuiteMap active={stageView} onOpen={openSurface} badges={navBadges} />
    </Panel>
  );

  const quickFindRegion = (
    <Panel>
      <TextField
        fullWidth
        size="small"
        placeholder="Find a member — screenname or username"
        value={find}
        onChange={(e) => setFind(e.target.value)}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: GX.dim }} />
              </InputAdornment>
            )
          }
        }}
      />
    </Panel>
  );

  const glanceRegion = (
    <Panel title="At a glance">
      {/* wraps rather than scrolling sideways — the third tile fell off the
          edge of a non-maximized window */}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <StatTile value={String(snap.accounts.length)} label="members" />
        <StatTile
          value={String(snap.accounts.filter((a) => a.screenname !== null).length)}
          label="screennames"
        />
        <StatTile
          value={String(snap.accounts.filter((a) => a.role === "administrator").length)}
          label="admins"
        />
      </Box>
    </Panel>
  );

  const channelStatusRegion = (
    <Panel>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontFamily: GX.mono,
            fontSize: 10.5,
            color: GX.dim,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0
          }}
        >
          dock {position}
          {autohide ? " · autohide" : ""} · mic{" "}
          <Box component="span" sx={{ color: micOn ? GX.ok : GX.err }}>{micOn ? "live" : "muted"}</Box> ·{" "}
          {quality} · {resolution} · background{" "}
          <Box component="span" sx={{ color: backgroundArmed ? GX.warn : GX.dim }}>
            {backgroundArmed ? "armed" : "off"}
          </Box>{" "}
          · engine{" "}
          <Box component="span" sx={{ color: armed ? GX.err : engine.status === "error" ? GX.err : GX.dim }}>
            {engine.status === "recording" || engine.status === "paused"
              ? `${engine.status} ${fmtClock(engine.elapsedMs)}`
              : engine.status}
          </Box>{" "}
          · tray{" "}
          <Box
            component="span"
            sx={{
              color:
                tray.running === null
                  ? GX.dim
                  : !tray.running
                    ? GX.dim
                    : tray.trayActive
                      ? GX.err
                      : tray.status?.lastError
                        ? GX.warn
                        : GX.ok
            }}
            title={tray.why ?? tray.status?.lastError ?? undefined}
          >
            {tray.running === null
              ? "checking…"
              : !tray.running
                ? "offline"
                : tray.trayActive
                  ? `${tray.status!.state} ${fmtClock((tray.status?.elapsedS ?? 0) * 1000)}`
                  : tray.status?.lastError
                    ? "idle (error)"
                    : "idle"}
          </Box>
        </Typography>
        <Box sx={{ flex: 1 }} />
        {tray.running === false && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => void tray.startService()}
            data-el-id="amberxvid:tray:start-service"
            sx={{ flexShrink: 0, py: 0, fontSize: 10.5 }}
          >
            Start tray service
          </Button>
        )}
      </Box>
    </Panel>
  );

  /* ---------------------------------- header ---------------------------------
   *
   * There isn't one any more, and its deletion is the density pass (P14).
   *
   * The suite used to draw a header row directly under the banner carrying the
   * house mark at 24px, the words "AmberX Vid", a chip with the viewer's
   * screenname, an administrator chip, Refresh, and "Close profile". Five of
   * those six were the banner's job repeated one row lower — the banner has the
   * brand lockup, the product name, and the account chip with the same
   * screenname on it — and the sixth was a second sign-out.
   *
   * So: the brand and the identity belong to the banner and appear once;
   * Refresh and the admin window moved onto the surface bar, where the rest of
   * the actions already were; and "Close profile" is gone outright. It called
   * the same accounts sign-out the banner's button calls, and no module-local
   * session UI survived P1.
   */

  /* --------------------------------- render ---------------------------------- */

  const inFlow = !autohide;

  return (
    <Box
      data-axf-area="amberxvid.surface"
      onContextMenu={(e) =>
        openCtx(e, "AmberX Vid", [
          streamHub.myStream
            ? { label: "My stream (on air)", onClick: () => streamHub.openRoom() }
            : { label: "Go live…", onClick: openGoLive },
          {
            label: streamHub.streams.length > 0 ? `Live streams · ${streamHub.streams.length}` : "Live streams",
            onClick: () => setStageView("streams")
          },
          "---",
          { label: "Refresh accounts", onClick: () => void refresh() },
          { label: "Video-chat settings", onClick: () => videoChat.openSettings() }
          // "Close profile" stood here and is gone with the header button it
          // duplicated: sign-out is the banner's, once, and it is the accounts
          // sign-out (P14).
        ])
      }
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 0
      }}
    >
      {/* The suite banner — GizmoX's chrome drew this above the module; here
          the suite owns its own top row (see the PORT NOTES). */}
      <SuiteBanner />

      <Box
        sx={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 1.25,
          p: 1.5,
          flex: "1 1 auto",
          minHeight: 0
        }}
      >
        {/* watermark — once per page, static (the shell owns the animated logo) */}
        <Box sx={{ position: "absolute", right: 24, bottom: 40, opacity: 0.05, pointerEvents: "none" }} aria-hidden>
          <GizmoXMark size={340} glow={false} />
        </Box>

        {autohide && toolbar}
        {inFlow && position === "top" && (
          <Box sx={{ display: "flex", justifyContent: "center", flexShrink: 0 }}>{toolbar}</Box>
        )}

        <Box sx={{ display: "flex", gap: 1.25, flex: 1, minHeight: 0 }}>
          {inFlow && position === "left" && (
            <Box sx={{ display: "flex", alignItems: "flex-start", flexShrink: 0 }}>{toolbar}</Box>
          )}
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1.25 }}>
            {/* The flex body — the arranged 1080/400 split, fixed (see the
                PORT NOTES: GizmoX's layout-theme arrangement did not port). */}
            <Box sx={{ display: "flex", gap: 1.25, flex: 1, minHeight: AMBERXVID_MIN_HEIGHT }}>
              {/* stage column: find → stage → status strip */}
              <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1.25 }}>
                <Box sx={{ flexShrink: 0, display: "flex" }}>{quickFindRegion}</Box>
                <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>{stageRegion}</Box>
                <Box sx={{ flexShrink: 0, display: "flex" }}>{channelStatusRegion}</Box>
              </Box>
              {/* identity column: profile → glance → suite map */}
              <Box
                sx={{
                  width: SIDE_COLUMN_WIDTH,
                  maxWidth: "38%",
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.25
                }}
              >
                <Box sx={{ flexShrink: 0, display: "flex" }}>{profileRegion}</Box>
                <Box sx={{ flexShrink: 0, display: "flex" }}>{glanceRegion}</Box>
                <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>{suiteMapRegion}</Box>
              </Box>
            </Box>
          </Box>
          {inFlow && position === "right" && (
            <Box sx={{ display: "flex", alignItems: "flex-start", flexShrink: 0 }}>{toolbar}</Box>
          )}
        </Box>

        {inFlow && position === "bottom" && (
          <Box sx={{ display: "flex", justifyContent: "center", flexShrink: 0 }}>{toolbar}</Box>
        )}

        {/* The AIM-style messenger (P7) — buddy list, chat windows, themes. */}
        <Messenger
          link={messenger}
          me={me}
          onViewProfile={(u) => {
            setProfileFocus(u);
            setStageView("profiles");
          }}
          onVideoCall={(u) => void videoChat.startCall(u)}
          userMenu={userMenu}
          streamOf={streamHub.streamOf}
          onJoinStream={(id) => void streamHub.watch(id)}
        />

        {/* The video-chat surface — ring ceremony + the SFU in-call stage (P6). */}
        <VideoChatWindow
          engine={videoChat}
          meScreenname={me.screenname ?? me.username}
          screennameFor={messenger.screennameFor}
          profiles={messenger.profiles}
        />

        {/* The P14 stream room — live broadcast stage + the room's group chat.
            Mounted at shell level like the call window: hosting survives every
            view switch, and closing the window never kills the broadcast. */}
        <StreamRoomWindow
          hub={streamHub}
          link={messenger}
          me={me.username}
          notify={toast}
          openCtx={openCtx}
          userMenu={(u) => userMenu(u)}
        />

        {/* The P11 group room — the 49-tile grid and its chat rail. Mounted at
            shell level like the two above, and for the stronger version of the
            same reason: a meeting must not end because somebody clicked
            "Library". Closing THIS window does leave the room, though — a
            broadcast is shell-owned, a meeting you have closed is a meeting you
            have left. */}
        <GroupRoomWindow
          engine={groupRooms}
          link={messenger}
          me={me.username}
          notify={toast}
          openCtx={openCtx}
          userMenu={(u) => userMenu(u)}
        />

        {/* Go-live step one: name the room. Step two (camera) runs in the hub. */}
        <GoLiveDialog
          open={goLiveOpen}
          busy={streamHub.busy}
          title={goLiveTitle}
          onTitle={setGoLiveTitle}
          description={goLiveDesc}
          onDescription={setGoLiveDesc}
          onCancel={() => setGoLiveOpen(false)}
          onGo={() => {
            void streamHub.goLive(goLiveTitle, goLiveDesc).then((ok) => {
              if (ok) {
                setGoLiveOpen(false);
                setGoLiveTitle("");
                setGoLiveDesc("");
              }
            });
          }}
        />

        {/* Invitations (P7) — compose one, hand it over, revoke the unused.
            Mounted at shell level with the other windows so the target picker
            can read the live stream and the real group list, and so closing
            the messenger never takes the dialog with it. */}
        <InviteDialog
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          myStream={streamHub.myStream ? { id: streamHub.myStream.id, title: streamHub.myStream.title } : null}
          groupChats={messenger.summaries
            .filter((s) => s.kind === "group")
            .map((s) => ({ id: s.id, label: s.title ?? "Group" }))}
        />

        {/* The report composer (P17) — mounted at shell level so any surface's
            Report row can open it, and so closing that surface cannot take a
            half-written report with it. */}
        {reportSubject && (
          <ReportDialog
            subject={reportSubject}
            onClose={() => setReportSubject(null)}
            onSaid={toast}
          />
        )}

        {/* The P9 admin control window — draggable/resizable, admin-only, opened
            ONLY by the toolbar button / suite map. */}
        {me.role === "administrator" && (
          <AdminWindow
            open={adminOpen}
            me={me}
            onClose={() => setAdminOpen(false)}
            onAccountsChanged={() => void onRefresh()}
          />
        )}

        {ctxMenu}
      </Box>
    </Box>
  );
}

/* ---------------------------------- helpers ----------------------------------- */

/** Go-live step one — name the room before the camera wakes up. */
function GoLiveDialog({
  open,
  busy,
  title,
  onTitle,
  description,
  onDescription,
  onCancel,
  onGo,
}: {
  open: boolean;
  busy: boolean;
  title: string;
  onTitle: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  onCancel: () => void;
  onGo: () => void;
}) {
  if (!open) return null;
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: (t) => t.zIndex.modal,
        display: "grid",
        placeItems: "center",
        bgcolor: "#0009"
      }}
      onClick={onCancel}
    >
      <Box
        onClick={(e) => e.stopPropagation()}
        sx={{
          width: 380,
          bgcolor: GX.panel,
          border: `1px solid ${GX.edge}`,
          borderRadius: 1.5,
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 1.4
        }}
      >
        <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Go live</Typography>
        <Typography sx={{ fontSize: 11.5, color: GX.dim }}>
          Every member sees your room the moment it opens — on their roster, in the Streams tab, and
          on your name everywhere. Your camera and mic start when you go live.
        </Typography>
        <TextField
          size="small"
          autoFocus
          fullWidth
          label="Stream title"
          placeholder="What are you showing?"
          value={title}
          slotProps={{ htmlInput: { maxLength: 80, "data-el-id": "amberxvid:go-live:title" } }}
          onChange={(e) => onTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onGo();
          }}
        />
        {/* P12 — optional at the door, and editable live once you are on air:
            most people write the blurb after they see what they are doing. */}
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          label="Description (optional)"
          placeholder="What's happening? You can change this while you're live."
          value={description}
          slotProps={{ htmlInput: { maxLength: STREAM_DESCRIPTION_MAX, "data-el-id": "amberxvid:go-live:description" } }}
          onChange={(e) => onDescription(e.target.value)}
        />
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button size="small" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="small" variant="contained" color="error" disabled={busy} onClick={onGo} data-el-id="amberxvid:go-live:start">
            {busy ? "Starting…" : "Go live"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

/** The house panel every region renders inside — panel surface, edge, padding. */
function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "auto",
        bgcolor: GX.panel,
        border: `1px solid ${GX.edge}`,
        borderRadius: 1.5,
        p: 1.25,
        display: "flex",
        flexDirection: "column"
      }}
    >
      {title && (
        <Typography
          sx={{
            fontFamily: GX.mono,
            fontSize: 10,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: GX.dim,
            mb: 1,
            flexShrink: 0
          }}
        >
          {title}
        </Typography>
      )}
      {children}
    </Box>
  );
}
