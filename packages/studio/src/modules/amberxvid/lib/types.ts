/**
 * @file AmberX Vid type spine — the shared contracts every phase of the module
 * binds to: accounts (module login), profiles + avatars, photo albums, the
 * messenger's threads/messages, the versioned edit-ready recording manifest,
 * presence, and P2P call sessions.
 *
 * Pure types + tiny pure helpers, NO node imports — imported by client
 * surfaces, API routes and the store alike. Persistence lives in
 * `./accounts` (and later stores) under the env-driven root in
 * `./paths`. Both imports below are type-only, from files that are equally
 * pure: the media contract, and — since P6 — the ACCOUNTS type spine, which
 * owns the message model this module used to declare for itself.
 */

import type { MediaRoomSnapshot } from "./mediaContract";
import type { AdminThreadInfo } from "@axs/modules/accounts/lib/types";

/* --------------------------------- accounts --------------------------------- */

export type AccountRole = "administrator" | "member";

/**
 * An AmberX Vid MEMBER — a studio account that holds the `amberxvid` grant.
 *
 * **It carries no credential.** Since P1 of `axf-amberxvid-social`
 * (2026-08-14) this module has no account store, no password store and no
 * session of its own: `lib/accounts.ts` is a read adapter that projects a
 * studio `Account` (`accounts/lib/types.ts`) into this shape, and the
 * `passwordHash` field that used to sit here is gone with the store that held
 * it. Anything wanting to verify, change or issue a password is asking the
 * accounts module, at `/api/accounts/session`.
 *
 * The remaining fields are what the suite's own surfaces render — roster,
 * buddy list, admin table — and `role` is the STUDIO role, re-read per
 * request, never taken from a token.
 */
export interface AmberXVidAccount {
  username: string;
  role: AccountRole;
  /** True while an admin-issued temp password is in force: the next sign-in is
   *  forced through change-password before a screenname can be chosen. */
  mustChangePassword: boolean;
  /**
   * True for a member migrated off the retired module store who has no studio
   * password yet. Passwords did NOT migrate (the two scrypt ladders differ,
   * and silently weakening auth is worse than being honest about it), so this
   * account cannot be signed into until an administrator issues a temp
   * password. Set by P1's migration, cleared by that reset.
   */
  forcePasswordReset?: boolean;
  /** Chosen once, after the (temp) password step; null until then. */
  screenname: string | null;
  createdAt: string;
  updatedAt: string;
  /** "seed" for the bootstrapped administrator, else the issuing admin. */
  createdBy: string;
  disabled?: boolean;
  lastLoginAt?: string;
}

/** What any signed-in module user may see of any account (no credentials). */
export interface AccountPublic {
  username: string;
  role: AccountRole;
  screenname: string | null;
  createdAt: string;
  disabled: boolean;
}

/** The caller's own account, with the flags that drive the entry flow. */
export interface AccountMe extends AccountPublic {
  mustChangePassword: boolean;
  /** True until a screenname is chosen — the last gate before module entry. */
  needsScreenname: boolean;
  lastLoginAt: string | null;
}

/** `GET /api/amberxvid/accounts` — everything the entry experience needs. */
export interface AccountsSnapshot {
  /**
   * Is a STUDIO session (`axs_session`) riding this request? Since P1 that is
   * no longer the whole question — see `notMember` below. `./viewer` reads
   * both, because "signed in" and "may see the suite" stopped being the same
   * fact the moment there was one login for the whole studio.
   */
  signedIn?: boolean;
  /** The member record for that session, or null when the viewer is not one. */
  me: AccountMe | null;
  accounts: AccountPublic[];

  /**
   * Signed in, but WITHOUT the `amberxvid` grant. A state that could not exist
   * before P1: one cookie could only answer yes or no, so "not you" and "not
   * yet a member" were the same screen. They are different problems with
   * different fixes, and the login surface now shows a different card for each.
   */
  notMember?: boolean;
  /** True when a non-member may join themselves — the module's open-membership
   *  policy, resolved server-side. Only meaningful with `notMember`. */
  canJoin?: boolean;
  /**
   * How many studio accounts are waiting on an administrator to issue their
   * first password (migrated members, in practice). A COUNT and never a list:
   * see `countForcedResets` for why a per-username answer here would be an
   * enumeration oracle.
   */
  pendingResets?: number;

  /* ---- pre-split fields, optional: still read, no longer always sent ----
   *
   * These date from when the suite rode a GizmoX session. `accounts/route.ts`
   * stopped sending them at the split; `AmberXVidModule.tsx` still reads them.
   * They are optional rather than deleted so both sides typecheck while that
   * screen is reconciled — see the note in this file's header. A reader that
   * finds them `undefined` is looking at a post-split response, which is the
   * normal case now. */

  /** The verified GizmoX session's username (the pre-split binding key). */
  gizmoxUser?: string;
  /** True when a valid module-profile token is riding the request. */
  profileLoaded?: boolean;
  /** Pre-split confinement flag. The mechanism it named was retired
   *  2026-08-04 with the GizmoX account it fenced. */
  confined?: boolean;
}

/* ------------------------------ profiles + avatar ---------------------------- */

/**
 * Every dial of the avatar designer, per the capture's `AVATAR_AXES`. Catalog
 * and swatch axes are zero-based indexes into their per-axis catalogs; height
 * is cm (140–210), build is 1–10. The spec is deterministic on purpose: one
 * shared `AvatarSpec → SVG` renderer draws the identical avatar on the
 * profile, buddy list, chat and admin surfaces.
 */
export interface AvatarSpec {
  version: 1;
  skinTone: number;
  hairStyle: number;
  hairColor: number;
  eyeColor: number;
  eyeShape: number;
  brows: number;
  nose: number;
  mouth: number;
  facialHair: number;
  /** cm, 140–210. */
  height: number;
  /** 1–10. */
  build: number;
  glasses: number;
  accessories: number;
  outfit: number;
  outfitColor: number;
  backdrop: number;
}

/**
 * An AI-drawn portrait (P15) — the second kind of avatar. Version 2 is the
 * discriminant `isPortrait()` tests; `svg` is the sanitized document
 * (`./portrait-svg` is the write door), `selections` the
 * `PortraitSelections` the drawing was generated from, kept so the builder can
 * reopen and re-roll it.
 */
export interface PortraitAvatar {
  version: 2;
  svg: string;
  /** Structurally `PortraitSelections` from `./portrait-options`,
   *  spelled inline so this pure type spine imports nothing. */
  selections: Record<string, string | string[] | number>;
  createdAt: string;
  /** Which model drew it. */
  model: string;
}

/**
 * What `Profile.avatar` actually holds: the 16-axis spec, an AI portrait, or
 * nothing. Every consumer goes through `normalizeAvatarValue()` rather than
 * switching on this union by hand.
 */
export type AvatarValue = AvatarSpec | PortraitAvatar | null;

/** Hard character cap on a stored portrait document — the sanitizer refuses
 *  anything larger, so a runaway generation cannot fill the store. */
export const PORTRAIT_SVG_MAX = 90_000;

/** Status-line cap — shared by the editor UI and the store's validation. */
export const STATUS_MAX = 120;
/** About-me cap — shared by the editor UI and the store's validation. */
export const ABOUT_MAX = 2000;

/** A module user's public face — everything the profile viewer shows. */
export interface Profile {
  version: 1;
  /** Owning account (= GizmoX username). */
  username: string;
  screenname: string;
  /** Either kind — a 16-axis spec or an AI portrait. Read it through
   *  `normalizeAvatarValue()`, never by switching on `version` at the call site. */
  avatar: AvatarValue;
  statusLine: string;
  aboutMe: string;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------- albums ----------------------------------- */

/** Album title cap — shared by the create/rename UI and the store. */
export const ALBUM_TITLE_MAX = 80;
/** Per-item caption cap. Shorter than a comment: a caption that wants a
 *  paragraph wants to be a comment on the item. */
export const ALBUM_CAPTION_MAX = 300;

/**
 * One album item.
 *
 * **`width`/`height` are the pixel dimensions read out of the uploaded BYTES**
 * (P10), not from anything a client claimed, and they are what the justified-
 * rows grid lays out with. They stay optional because every photo uploaded
 * before P10 has none: the grid falls back to the browser's own
 * `naturalWidth`/`naturalHeight` once the image decodes, so a legacy item lands
 * in the same true-aspect row one beat later rather than being square-cropped.
 *
 * `reactions` and `comments` are the WALL'S — one comment system, two subjects
 * (`lib/social.ts`). They are stored on the item rather than in a side file
 * because the album manifest is already the document every read of this item
 * opens, and a second store would be a second thing to keep in step.
 */
export interface Photo {
  id: string;
  /** Store-relative media path under the album's directory. */
  file: string;
  caption: string;
  uploadedAt: string;
  /** Pixel width, sniffed from the bytes at upload. */
  width?: number;
  /** Pixel height, sniffed from the bytes at upload. */
  height?: number;
  sizeBytes?: number;
  /** Likes and dislikes — the same shape, rules and toggle as a wall post's. */
  reactions: SocialReactions;
  /** The same one-level thread a wall post carries. */
  comments: SocialComment[];
}

export interface Album {
  version: 1;
  id: string;
  /** Owning account (= GizmoX username). */
  owner: string;
  title: string;
  coverPhotoId: string | null;
  /**
   * Who may see this album — resolved through the SAME `canInteract` filter the
   * wall runs on, never a list kept here (P10). An album a viewer may not see
   * is absent, exactly as a post they may not see is: the silence is
   * indistinguishable from the album never having existed.
   */
  visibility: SocialVisibility;
  /** In display order — the array IS the order (P10's `reorder` rewrites it). */
  photos: Photo[];
  createdAt: string;
  updatedAt: string;
}

/* ------------------------- the social spine (wall + albums) ------------------- */

/*
 * ONE COMMENT SYSTEM, TWO SUBJECTS (P10, 2026-08-15).
 *
 * The three shapes below — a visibility, a reaction pair and a comment — were
 * declared for the wall in P8 and are now equally the ALBUM ITEM's. They are
 * named `Social*` because that is what they are, and the `Wall*` names are kept
 * as aliases rather than renamed away: a type alias erases, so every P8/P9 call
 * site keeps compiling and no stored document changes shape. The machinery that
 * operates on them lives in `lib/social.ts`, and both stores call it.
 */

/** Post body cap — shared by the composer UI and the store's validation. */
export const WALL_TEXT_MAX = 8000;
/** Comment/reply cap. Shorter than a post on purpose: a comment that wants an
 *  essay wants to be a post. Wall posts and album items share it, because they
 *  share the comment system. */
export const SOCIAL_COMMENT_MAX = 2000;
/** Attachments on one post. */
export const WALL_MEDIA_PER_POST_MAX = 8;
/**
 * Comments one subject retains. Structural, not policy: a post — and an album
 * manifest — is ONE document rewritten on every comment, so an uncapped thread
 * is a document that grows without bound and a write that gets slower forever.
 * The oldest are never trimmed — the cap refuses the 501st instead, because
 * silently dropping somebody's comment is worse than telling them it is full.
 */
export const SOCIAL_COMMENTS_MAX = 500;
/** One page of a wall or a feed. */
export const WALL_PAGE = 20;

/** The P8 names, kept so nothing that learned them has to be rewritten. */
export const WALL_COMMENT_MAX = SOCIAL_COMMENT_MAX;
export const WALL_COMMENTS_MAX = SOCIAL_COMMENTS_MAX;

/**
 * Who may see a subject — a wall post, or an album.
 *
 * `buddies` is resolved against the ACCOUNTS social graph, never a list kept
 * here — see `accounts/lib/relations.ts`, which is the one answer to "may these
 * two interact" and which this module asks rather than re-implements.
 */
export type SocialVisibility = "public" | "buddies" | "private";
/** The P8 name for {@link SocialVisibility}. */
export type WallVisibility = SocialVisibility;

/** One attachment. The bytes live in the FILES store (`files/wall/`), so the
 *  storage ledger counts them where they actually are. */
export interface WallMedia {
  id: string;
  /** Path under the owner's `files/` store — always `wall/<id>.<ext>`. The
   *  extension comes from the signature sniff, never from a client filename. */
  file: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
}

/** A comment, or — when `replyTo` is set — a reply to one. Exactly one level:
 *  a reply to a reply is refused, so a thread can be rendered without
 *  recursion and cannot be nested into unreadability. Carried by wall posts
 *  and album items alike. */
export interface SocialComment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  editedAt?: string;
  /** The top-level comment this answers, or null when it IS one. */
  replyTo: string | null;
}

/** Likes and dislikes, as the usernames that cast them — mutually exclusive
 *  (a name appears in at most one list) and toggling. */
export interface SocialReactions {
  likes: string[];
  dislikes: string[];
}

/** The P8 names for the two shapes above. */
export type WallComment = SocialComment;
export type WallReactions = SocialReactions;

/**
 * One wall post — `users/<vaultKey>/wall/<postId>.json`.
 *
 * `author` IS the wall's owner: a post lands on its writer's own wall, which
 * is what makes the quota charge land on the person whose bytes they are. The
 * field is stored rather than implied by the path so that a post which has
 * travelled through a FEED MERGE is still self-describing — a feed item out of
 * context has to know who wrote it.
 */
export interface WallPost {
  version: 1;
  id: string;
  author: string;
  text: string;
  media: WallMedia[];
  visibility: WallVisibility;
  createdAt: string;
  editedAt?: string;
  reactions: WallReactions;
  comments: WallComment[];
}

/* --------------------------------- messenger --------------------------------- */

/*
 * THE MESSAGE MODEL LIVES IN ACCOUNTS (P6 of `axf-amberxvid-social`,
 * 2026-08-15) and this file only re-exports it.
 *
 * These were the module's OWN definitions until P6: a `Message` with two
 * per-message stamps, a `Thread` with exactly two participants, and a
 * `ThreadSummary` counting messages addressed to the caller. All three were
 * true statements about a store that no longer exists — amberxvid's
 * `lib/messages.ts` retired the same phase, and accounts is the only messaging
 * store now. Re-exporting rather than re-declaring is the whole point: a second
 * definition of a message is a second thing to update when groups, cursors or
 * paging change, and the second one is the one that gets forgotten.
 *
 * What the module gains by the swap, and what its surfaces must now handle:
 *   - `Thread.kind` is `"dm" | "group"` — a group is the N-member case of the
 *     same document, so `participants` can hold more than two and a summary's
 *     `with` is `""` for a group (it is named by `title` instead);
 *   - unread is a per-member CURSOR (`ThreadMember.readThrough`), not a scan of
 *     who each message was addressed to;
 *   - `Message.seq` is what the history pager seeks by (`MessagePage`).
 */
export type {
  Message,
  MessagePage,
  Thread,
  ThreadMember,
  ThreadRole,
  ThreadSummary,
} from "@axs/modules/accounts/lib/types";
/*
 * The SOCIAL GRAPH is accounts' too (P4), and the messenger's buddy list is
 * its first consumer in this module. `BuddyPresence` is what the relations
 * ROUTE returns — the store stays a pure graph and the route joins presence on,
 * so the decorated row is the shape a client actually receives.
 */
export type { BuddyPresence, BuddyRow, RelationsView } from "@axs/modules/accounts/lib/types";
export {
  MESSAGE_MAX,
  THREAD_MEMBERS_MAX,
  THREAD_MESSAGES_MAX,
  THREAD_TITLE_MAX,
  threadIdFor,
} from "@axs/modules/accounts/lib/types";

/**
 * Per-profile messenger settings — they live INSIDE the messenger (explicit
 * build directive; the sui carries none of this). `theme` is a
 * `MESSENGER_THEMES` id; the store validates and falls back rather than
 * crashing on junk.
 */
export interface MessengerSettings {
  version: 1;
  /** A `MESSENGER_THEMES` id. */
  theme: string;
  /** Toast alert on a message received outside the open chat. */
  notifications: boolean;
  /** Short receive chime (generated in code, no asset). */
  sound: boolean;
  /** Auto-open the messenger on an incoming message. */
  popupOnMessage: boolean;
  fontSize: "small" | "medium" | "large";
  showTimestamps: boolean;
  /**
   * The AIM away message (P6). The FLAG is platform state and lives in the
   * accounts presence registry (`POST /api/accounts/presence`); the TEXT is
   * this module's skin and lives here, because nothing platform-wide has an
   * opinion about what your away message says.
   */
  awayMessage: string;
  /**
   * The status line to put back when you come back. Going away overwrites the
   * module profile's `statusLine` (which is what buddies actually see), so the
   * one it replaced is parked here rather than in component state — a reload
   * while away must not lose it.
   */
  statusBeforeAway: string | null;
}

/**
 * One event on the module's SSE channel (`/api/amberxvid/presence`): `hello`
 * opens every stream with the caller + full roster, `roster` re-sends on any
 * online/offline flip, the call/stream/room frames carry the media plane, and
 * `ping` keeps proxies from reaping the idle stream.
 *
 * **There is no `message` frame any more (P6).** It was live DM delivery, and
 * messages moved to the accounts store the same phase — they ride
 * `/api/accounts/presence` now, which is the stream that knows who is a
 * recipient. This channel keeps what only this module knows: who is hosting a
 * stream, who is ringing whom, and what the media server is doing.
 */
export type MessengerEvent =
  | { type: "hello"; you: string; roster: Presence[] }
  | { type: "roster"; roster: Presence[] }
  | { type: "call"; signal: CallSignal }
  | { type: "streams"; streams: StreamInfo[] }
  | { type: "stream-signal"; signal: StreamSignal }
  | { type: "stream-chat"; streamId: string; message: StreamChatMessage }
  /** P12: somebody this member FOLLOWS just went live. Addressed (never
   *  broadcast) and filtered server-side against the DND seam, so a client
   *  never has to decide whether it was allowed to be told. */
  | { type: "stream-alert"; alert: StreamAlert }
  /** P6: the media server announced a room change (a producer appeared,
   *  paused, or vanished; a seat came or went). The snapshot is the server's
   *  whole current truth — a client reconciles against it rather than
   *  interpreting deltas. */
  | { type: "room-media"; roomId: string; snapshot: MediaRoomSnapshot }
  /** P11: the group-room list moved — somebody opened, joined, left or ended
   *  one. The whole list rides along for the reason `streams` does: it is
   *  small, it is what every surface renders, and a client that reconciles
   *  against a whole list cannot drift the way one applying deltas can. */
  | { type: "rooms"; rooms: GroupRoomInfo[] }
  | { type: "room-signal"; signal: RoomSignal }
  /** P13: "join my room" — a group-room invitation that RINGS. Addressed, and
   *  through the same door a call invite is (`./ring`), so a blocked inviter
   *  cannot reach the device and a member on do-not-disturb is not woken by
   *  the one ring the call path refuses. */
  | { type: "room-ring"; ring: RoomRing }
  | { type: "ping"; at: string };

/* ------------------------------ recording manifest ---------------------------- */

/** `server` = recorded on the media server from the SFU's copy of a live
 *  stream (P10) — the host's machine spent no CPU and no upload on it. */
export type RecordingEngine = "browser" | "tray" | "server";
export type RecordingQuality = "low" | "medium" | "high" | "max";

/**
 * One future edit operation applied to a recording. v1 writes none — the
 * array is the edit-ready seam: trim/annotate/composite features append here
 * (open `kind` union) without a manifest migration.
 */
export interface RecordingEdit {
  id: string;
  kind: string;
  appliedAt: string;
  params: Record<string, unknown>;
}

/**
 * The versioned, edit-ready recording manifest (v1) — one per recording,
 * written by whichever engine captured it and read by the library, the
 * player, and every future editing surface.
 */
export interface RecordingManifest {
  version: 1;
  id: string;
  /** Owning account (= GizmoX username). */
  owner: string;
  title: string;
  engine: RecordingEngine;
  /** Store-relative media path under the recording's directory. */
  file: string;
  mimeType: string;
  startedAt: string;
  /** Null while a capture is still running. */
  endedAt: string | null;
  durationS: number;
  sizeBytes: number;
  width: number;
  height: number;
  fps?: number;
  micEnabled: boolean;
  quality: RecordingQuality;
  /** Store-relative thumbnail path, when one has been generated. */
  thumbnail: string | null;
  notes: string;
  tags: string[];
  /** Always [] in v1 — see {@link RecordingEdit}. */
  edits: RecordingEdit[];
  /** Provenance when a future edit derives this recording from another. */
  sourceId?: string;
}

/* --------------------------------- tray sync ---------------------------------- */

/**
 * The browser↔tray sync rides two files under `<root>/tray/` (both processes
 * live on the same Windows machine — background recording is a local-Windows
 * feature by design; prod users record in-browser):
 *
 *   `status.json`   — written ONLY by the tray service ({@link TrayServiceStatus})
 *   `commands.json` — written ONLY by the web app ({@link TrayCommandsFile})
 *
 * Single-writer per file is what makes the channel race-free without locks.
 * The web reads status through `/api/amberxvid/tray`; the tray polls commands
 * every second and only executes seqs above the highest it has seen (boot
 * initialises past the file's max seq, so stale commands are never replayed).
 */

export type TrayState = "idle" | "recording" | "paused";

/** Commands the web can queue for the tray service. */
export type TrayCommandKind =
  | "record-start"
  | "record-stop"
  | "record-pause"
  | "record-resume"
  | "background-on"
  | "background-off"
  | "reload"
  /**
   * P13: show a tray balloon. The ONE command that carries text, and the only
   * one that does nothing to the recorder — it exists because a ring that
   * arrives while the browser tab is backgrounded is a ring nobody sees, and
   * this module already owns a always-running desktop process with a
   * notification area icon. Reusing that channel is what "through the existing
   * tray link" means: no second transport, no browser notification permission
   * prompt, and it works with the tab minimised.
   */
  | "alert"
  | "quit";

export interface TrayCommand {
  seq: number;
  cmd: TrayCommandKind;
  issuedAt: string;
  /**
   * Balloon text for `alert`, absent on every other kind. Capped and stripped
   * of newlines by the route before it lands here — the tray renders it into a
   * Windows notification, so it is display text, never markup.
   */
  text?: string;
}

/** The recorder settings the tray honours — mirrored from the sui/quick actions. */
export interface TraySettingsSync {
  resolution: string;
  quality: RecordingQuality;
  micOn: boolean;
}

/**
 * The web-owned half of the channel. `context` is the module's heartbeat: it
 * names the capture owner (the loaded profile), carries the live recorder
 * settings, and — the double-capture guard — reports whether the BROWSER
 * engine currently owns the device. `browserRecording` only counts while
 * `updatedAt` is fresh ({@link TRAY_FRESH_MS}), so a closed browser can never
 * block the tray.
 */
export interface TrayContext {
  owner: string | null;
  settings: TraySettingsSync;
  browserRecording: boolean;
  backgroundArmed: boolean;
  updatedAt: string;
  /** Last tray-finalized recording already written to the activity ledger. */
  lastJournaledId: string | null;
}

export interface TrayCommandsFile {
  version: 1;
  seq: number;
  commands: TrayCommand[];
  context: TrayContext | null;
}

/** A capture the tray finished — how the web learns it landed in the library. */
export interface TrayFinalized {
  id: string;
  at: string;
  durationS: number;
  sizeBytes: number;
}

/**
 * The tray-owned half: heartbeat + live capture state, what the painted icon
 * tints from, and `backgroundRequest` — a tray-menu background toggle the web
 * adopts into the `background.armed` setting (the setting stays the single
 * source of truth; the tray only requests).
 */
export interface TrayServiceStatus {
  version: 1;
  pid: number | null;
  serviceVersion: string;
  heartbeatAt: string;
  state: TrayState;
  backgroundMode: boolean;
  backgroundRequest: { value: boolean; at: string } | null;
  recordingId: string | null;
  recordingOwner: string | null;
  startedAt: string | null;
  elapsedS: number;
  sizeBytes: number;
  lastFinalized: TrayFinalized | null;
  lastError: string | null;
  devices: { video: string[]; audio: string[] };
}

/** A context/heartbeat older than this is ignored (the browser is gone). */
export const TRAY_FRESH_MS = 12_000;

/* ---------------------------------- presence --------------------------------- */

export interface Presence {
  username: string;
  /** A live stream on `/api/amberxvid/presence` — i.e. this member has AmberX
   *  Vid open. It is what gates a CALL, because a ring can only land where the
   *  module's own channel is held. */
  online: boolean;
  lastSeenAt: string;
  /** The live stream this member is HOSTING right now, or null. What makes a
   *  roster row say "Live" and gives every right-click menu a stream to join. */
  streamingId: string | null;
  /**
   * Signed into the STUDIO — a live stream on `/api/accounts/presence`. Set
   * client-side by the messenger link (P6) by overlaying the accounts roster;
   * the module's own registry never fills it in, which is why it is optional.
   *
   * `online` and `reachable` are genuinely different facts and the buddy list
   * shows both: somebody reachable but not online can be MESSAGED right now
   * (accounts delivers it live) and cannot be CALLED.
   */
  reachable?: boolean;
  /** Self-declared away, from the accounts registry. Same provenance and same
   *  reason for being optional as {@link Presence.reachable}. */
  away?: boolean;
}

/* ------------------------------- live streams --------------------------------- */

export const STREAM_TITLE_MAX = 80;
/**
 * The stream's DESCRIPTION cap (P12) — a paragraph, not a title.
 *
 * Both are editable while the stream is live, which is the whole reason the
 * description is a second field rather than a longer title: a broadcaster
 * retitles when the topic changes and rewrites the description when what they
 * are doing changes, and one field would make the second edit destroy the
 * first.
 */
export const STREAM_DESCRIPTION_MAX = 600;
/** Per-message text cap in a stream room (rooms are chatter, not essays). */
export const STREAM_CHAT_MAX = 500;
/** Messages a room keeps in memory — room chat is ephemeral by decision
 *  (2026-08-04): it dies with the stream, like live chat everywhere. */
export const STREAM_CHAT_KEEP = 500;
/** How long a hovered thumbnail plays live before it detaches. */
export const STREAM_PREVIEW_S = 15;

/** One message in a stream room's group chat (in-memory only, never on disk). */
export interface StreamChatMessage {
  id: string;
  streamId: string;
  from: string;
  text: string;
  sentAt: string;
}

/**
 * The public face of one live stream — what tiles, lists and roster badges
 * render. The poster frame itself is NOT carried here (it would bloat every
 * SSE broadcast): clients fetch `/api/amberxvid/streams?thumb=<id>` and use
 * `thumbnailAt` as the cache-buster.
 */
export interface StreamInfo {
  id: string;
  /** Hosting member (= GizmoX username). */
  host: string;
  title: string;
  /** The host's live-editable blurb (P12). Empty string when unset — never
   *  null, so every renderer treats "no description" the same way. */
  description: string;
  startedAt: string;
  /** Watching members (usernames) — hover previews excluded. */
  viewers: string[];
  /** Hidden 15 s hover previews currently attached. */
  previews: number;
  /**
   * The most simultaneous real viewers this room has held (P12) — the number
   * the stream's history entry keeps, so it is counted while the room is live
   * rather than reconstructed afterwards from a roster nobody kept.
   */
  peakViewers: number;
  hasThumbnail: boolean;
  thumbnailAt: string | null;
}

/**
 * Stream signaling over the presence SSE stream — SINCE P7, exactly one kind.
 * The mesh-era `viewer-join`/`viewer-leave`/`sdp`/`ice` relays died with the
 * per-viewer peer connections they wired: the host publishes ONE upstream to
 * the media server and viewers consume from it (`MEDIA_CONTRACT.topology`),
 * so there is nothing left to relay and no host-side reaction to a joiner.
 * `ended` remains because it is a room fact, minted server-side: it tells
 * every attached watcher the room is gone, promptly, whichever process holds
 * their socket.
 */
export type StreamSignal = { kind: "ended"; streamId: string; from: string };

/* --------------------------------- follows ------------------------------------ */

/**
 * One member's follow graph, as the wire describes it (P12).
 *
 * FOLLOWING IS NOT BUDDYING, and keeping them apart is the point of a second
 * graph rather than a flag on the first. A buddy relation is mutual, consented
 * and pairwise-guarded — it is what gates DMs and `buddies` visibility. A
 * follow is one-directional and needs no consent: it is a subscription to
 * somebody's broadcasts, and its only power is that it orders their room to the
 * top of your list and rings you when they go live. It grants no visibility a
 * stranger does not already have, which is why it can be one-sided without
 * being a hole in the relations model.
 *
 * A BLOCK still wins: `lib/follows` refuses a follow the relations guard
 * refuses, and drops the pair on both sides when a block lands.
 */
export interface FollowGraph {
  /** Normalized usernames this member follows. */
  following: string[];
  /** Normalized usernames who follow this member. */
  followers: string[];
}

/**
 * The alert a follower gets when somebody they follow goes live (P12) — the
 * "ring-style" notify, carried on the presence SSE channel and across
 * processes through the outbox like every other reachability event.
 *
 * It carries the room's identity ONLY. What it deliberately does not carry is
 * anything a client could act on without re-reading the store: a follower who
 * receives this and clicks through joins the room through the same door
 * everybody else does, and a room that ended while the alert sat in a queue
 * simply refuses the join with `no such live stream`.
 */
export interface StreamAlert {
  streamId: string;
  /** Normalized username of the streamer. */
  host: string;
  /** As typed — what a toast shows before profiles resolve. */
  hostDisplay: string;
  title: string;
  at: string;
}

/* ================================ P13: ringing ================================= */

/**
 * "Join my room" — the group-room invitation, shaped as a RING rather than as
 * a notification (P13).
 *
 * It carries its own `ringId` rather than reusing `roomId` because the ring and
 * the room have different lifetimes: two members may be rung into the same room
 * at once, each ring is answered (or missed) separately, and each closes its own
 * history row. A room id could not tell those two rings apart.
 */
export interface RoomRing {
  /** Unique per invitation — the history row's key, not the room's. */
  ringId: string;
  /** The P11 room the accepter lands in. */
  roomId: string;
  title: string;
  /** Normalized inviter. */
  from: string;
  /** As typed — what the ring window shows before profiles resolve. */
  fromDisplay: string;
  at: string;
}

/** How a ring was answered. `timeout` is the client's own deadline giving up,
 *  and is what turns the callee's row into a MISSED one. */
export type RingAnswer = "accept" | "decline" | "timeout";

/* ------------------------------- call history ---------------------------------- */

/** How many call rows a member keeps. Same posture as the stream histories:
 *  the cap is applied on write, so the document cannot grow past it. */
export const CALL_HISTORY_KEEP = 300;

/**
 * Which side of the call this row is, from ITS OWNER's point of view.
 *
 * `missed` is not a fourth state layered on `received` — it REPLACES it, once,
 * when the ring ends without an answer. A row is never both, which is what lets
 * the surface count missed calls by filtering rather than by re-deriving what
 * "unanswered" means in two places.
 */
export type CallDirection = "placed" | "received" | "missed";

/**
 * Why a ring never became a conversation. `null` on every answered call.
 *
 * `dnd` is the one worth keeping distinct: from the callee's side a
 * do-not-disturb miss and a miss they slept through look identical in a list,
 * and only one of them is something they chose.
 */
export type MissedReason = "no-answer" | "declined" | "busy" | "dnd" | "failed";

/** A 1:1 call and a group-room ring share one history — they are the same act
 *  from the member's side ("somebody rang me"), and splitting them would make
 *  the surface ask twice. */
export type CallHistoryKind = "call" | "room";

/** One row of one member's call history. */
export interface CallHistoryEntry {
  id: string;
  /** The call id, or the ring id for a room invitation. The upsert key. */
  callId: string;
  kind: CallHistoryKind;
  direction: CallDirection;
  /** Normalized other party. */
  peer: string;
  /** Their screenname at the time — kept so a row still reads after a rename. */
  peerDisplay: string;
  /** For `kind: "room"`: which room, so click-to-call-back rejoins it. */
  roomId: string | null;
  /** Room title at ring time, for the same reason `peerDisplay` is kept. */
  roomTitle: string | null;
  /** When the ring started. */
  at: string;
  /** When it was answered, or null if it never was. */
  answeredAt: string | null;
  endedAt: string | null;
  /** Answered wall-clock seconds; 0 for anything that never connected. */
  durationS: number;
  missedReason: MissedReason | null;
  /**
   * True once the missed-call DM note has been written into the thread with
   * the peer. The idempotency mark: `recordCallState` runs on every signal, and
   * a hangup arriving twice must not post the note twice.
   */
  noteSent: boolean;
}

/* -------------------------------- availability --------------------------------- */

/**
 * Minutes past local midnight, 0–1439. Quiet hours are stored as two of these
 * rather than as clock strings so the comparison is arithmetic and the wrapping
 * case (22:00 → 07:00) is one `if` rather than a parser.
 */
export type MinuteOfDay = number;

/** A weekly quiet window. `days` is `0`=Sunday … `6`=Saturday; an empty list
 *  means EVERY day, which is what a member who never opened the day picker
 *  meant. */
export interface QuietHours {
  enabled: boolean;
  startMinute: MinuteOfDay;
  endMinute: MinuteOfDay;
  days: number[];
}

/**
 * One member's do-not-disturb state (P13) — the model behind the `./dnd` seam.
 *
 * Two independent sources, deliberately: an explicit switch a member flips for
 * the next twenty minutes, and a schedule they set once. Folding them into one
 * tri-state would make "I am in quiet hours AND I flipped the switch" ambiguous
 * when the quiet window ends.
 *
 * P16 renders these as settings rows; nothing here is a setting-store value,
 * because DND has to be readable by the SERVER on the ring path, and the sui's
 * values live in the browser.
 */
export interface AvailabilityDoc {
  version: 1;
  /** Normalized owner. */
  user: string;
  /** The explicit toggle. On means "do not ring me", full stop. */
  dnd: boolean;
  quietHours: QuietHours;
  updatedAt: string;
}

/** What the ring path asks, and what a surface renders. */
export interface DndVerdict {
  /** True = do not interrupt. */
  dnd: boolean;
  /** Which source said so — `null` when nothing did. */
  source: "toggle" | "quiet-hours" | null;
  /** One sentence, already written, for a toast or a chip. */
  why: string;
}

/* ----------------------------- stream + watch history ------------------------- */

/** How many rows of each history half a member keeps. Old rows fall off the
 *  end rather than growing a document every process re-reads. */
export const STREAM_HISTORY_KEEP = 200;

/**
 * One stream this member HOSTED, written when the room ends (P12).
 *
 * `recordingId` is resolved at write time by matching the host's server-side
 * recordings against the room's own window — it is `null` both when nothing
 * was recorded and when the recording has since been deleted, which is the
 * honest answer for a link that would 404 either way ("if kept").
 */
export interface StreamHistoryEntry {
  id: string;
  streamId: string;
  title: string;
  description: string;
  startedAt: string;
  endedAt: string;
  durationS: number;
  /** The most simultaneous viewers the room ever held. */
  peakViewers: number;
  /** How many DISTINCT members watched at any point — a different question
   *  from the peak, and the one "how did it go" is usually asking. */
  uniqueViewers: number;
  /** The server-side recording this stream left in the library, if any. */
  recordingId: string | null;
}

/** One stream this member WATCHED, written when they leave or the room ends. */
export interface WatchHistoryEntry {
  id: string;
  streamId: string;
  title: string;
  /** Normalized username of the streamer. */
  host: string;
  hostDisplay: string;
  joinedAt: string;
  leftAt: string;
  durationS: number;
}

/* ------------------------------- group rooms ---------------------------------- */

/** A room name is a label, not a description — same budget as a stream title. */
export const ROOM_TITLE_MAX = 80;

/**
 * How many tiles one page of the room grid holds at most: 7×7 (P11).
 *
 * Exported as a CONSTANT the client and the server both cite because it is the
 * unit the whole scale story is written in — the client consumes video for one
 * page's worth of participants and no more, so this number is the ceiling on a
 * member's video consumers and therefore the ceiling on what one laptop is
 * asked to decode. Changing it changes the load model, which is why it is not
 * a magic 49 sitting in a grid component.
 */
export const ROOM_PAGE_TILES = 49;

/** One seat in a group room, as the wire describes it. */
export interface RoomMember {
  /** Normalized username — the key everything matches on. */
  user: string;
  /** As they typed it — what a chip shows before profiles resolve. */
  displayName: string;
  /** `host` owns the room's lifetime and its title; `participant` is a member.
   *  Both PUBLISH (`ROLE_RULES`) — a group room has no audience class. */
  role: "host" | "participant";
  joinedAt: string;
}

/**
 * The public face of one group room — what the rooms list, the roster rail and
 * the grid's name chips render. The roster here is the RECORD's, which is what
 * makes it server-attested (`MEDIA_CONTRACT.identity`): the media snapshot says
 * which producers exist, this says who the people are, and a tile is the join
 * of the two. A client never learns a participant's identity from media.
 */
export interface GroupRoomInfo {
  id: string;
  title: string;
  /** Normalized username of the current host — successors included. */
  host: string;
  hostDisplay: string;
  startedAt: string;
  members: RoomMember[];
  /** The cap pinned at open; null is uncapped. Rendered so "full" is legible
   *  before somebody bounces off it. */
  memberLimit: number | null;
  /** The accounts group thread this room chats in, or null until the first
   *  member joins (a group of one is not a group — see `./groupRooms`). */
  threadId: string | null;
}

/**
 * Group-room signalling over the presence SSE stream. Exactly one kind, for
 * exactly the reason `StreamSignal` has one: every other change to a room is
 * already carried by the room list broadcast or by the media server's
 * `room-media` snapshot, and a second way to learn the same fact is a second
 * thing to keep in step. `ended` is a room fact minted server-side — it tells
 * everybody still in the grid that the room is gone rather than leaving them
 * looking at tiles that will never update again.
 */
export type RoomSignal =
  | { kind: "ended"; roomId: string; from: string }
  /**
   * P15 — the host removed somebody. `to` is who was removed; `from` is the
   * host who did it.
   *
   * Addressed to the whole audience AND to the person leaving, because both
   * halves need it and for different reasons: the room's grid has a tile to
   * drop, and the removed member's client has a window to close. A removal
   * they only learned about from a tile that stopped updating would be
   * indistinguishable from the media server dying.
   */
  | { kind: "removed"; roomId: string; from: string; to: string };

/* ---------------------------------- ratings ----------------------------------- */

export const RATING_MIN = 0;
export const RATING_MAX = 10;

export type RatingKind = "user" | "stream";

/** One member's rating of one target — visible, never anonymous (decision
 *  2026-08-04: a small private suite rates in the open). */
export interface RatingEntry {
  rater: string;
  /** Integer 0–10. */
  stars: number;
  updatedAt: string;
}

/** What rating displays render: the average, the crowd size, your own vote. */
export interface RatingSummary {
  kind: RatingKind;
  target: string;
  /** Mean stars rounded to one decimal, or null with zero ratings. */
  average: number | null;
  count: number;
  /** The caller's own entry, when they have rated this target. */
  mine: number | null;
  entries: RatingEntry[];
  /** For `stream` targets: display snapshot that outlives the live room. */
  context?: { host: string; title: string };
}

/* --------------------------------- admin (P9) --------------------------------- */

/** One account row as the admin control window sees it — flags and provenance,
 *  still never a credential. */
export interface AdminAccountRow extends AccountPublic {
  mustChangePassword: boolean;
  createdBy: string;
  lastLoginAt: string | null;
  updatedAt: string;
}

/** One conversation's stats in the admin window's message-pruning view —
 *  counts and sizes only, never message text (admins prune data, not read it).
 *
 *  Re-exported from accounts since P6: the threads being summarised ARE the
 *  accounts threads, so a second shape here could only be a stale copy of this
 *  one. It is why `participants` is a plain list rather than the pair it used
 *  to be — a group has more than two. */
export type { AdminThreadInfo };

/** Per-member photo-album totals for the admin window. */
export interface AdminAlbumStats {
  owner: string;
  albums: number;
  photos: number;
  bytes: number;
}

/**
 * Per-member recording totals for the admin window. Only an administrator ever
 * sees another member's captures, so this is the one place the whole library
 * is summarised.
 */
export interface AdminRecordingStats {
  owner: string;
  recordings: number;
  bytes: number;
  durationS: number;
  /** Captures still uploading — excluded from bulk deletes. */
  open: number;
  /** Newest capture's `startedAt`, or null when the member has none. */
  lastAt: string | null;
}

/** `GET /api/amberxvid/admin` — everything the P9 control window shows. */
export interface AdminOverview {
  accounts: AdminAccountRow[];
  presence: Presence[];
  threads: AdminThreadInfo[];
  albums: AdminAlbumStats[];
  recordings: AdminRecordingStats[];
  generatedAt: string;
}

/* --------------------------------- video calls -------------------------------- */

export type CallState =
  | "offering"
  | "ringing"
  | "connecting"
  | "active"
  | "ended"
  | "rejected"
  | "failed";

/* `IceCandidatePayload` and `SdpPayload` were deleted in P7, exactly as their
 * comments promised since P6: they rode only the mesh-era stream relay, and
 * the relay is gone. SDP and ICE are mediasoup vocabulary on the media
 * server's own channel now — no serialized form of either crosses the app
 * server (`MEDIA_CONTRACT.signaling`). */

/**
 * One signal on the call channel (POST `/api/amberxvid/calls` → relayed to
 * the peer over the presence SSE stream). The calls route relays exclusively
 * these whitelisted shapes — unknown fields are dropped server-side, and
 * `from` is stamped from the authenticated session, which since P5 is the
 * whole of the identity story: the mesh-era `sas` / `verify` kinds (the
 * DTLS-fingerprint verification ceremony) were retired with lib/sas.ts and
 * lib/link-binding.ts, because an SFU terminates DTLS server-side and the
 * ceremony could no longer prove what it claimed.
 *
 * SINCE P6 THIS CHANNEL IS SESSION SEMANTICS ONLY — ring, accept, reject,
 * hangup. The `sdp`/`ice` kinds are DELETED with the call-side relay: media
 * setup is mediasoup vocabulary over `/api/amberxvid/media`, and SDP never
 * transits the app server for a call again (`MEDIA_CONTRACT.signaling`).
 */
export type CallSignal =
  | { kind: "invite"; callId: string; from: string; to: string; at: string }
  | { kind: "accept"; callId: string; from: string }
  | { kind: "reject"; callId: string; from: string; reason: "declined" | "busy" }
  | { kind: "hangup"; callId: string; from: string; reason: string };

/**
 * An ICE server entry as `/api/amberxvid/turn-credentials` returns it —
 * structurally what `RTCIceServer` wants, defined here so the pure type spine
 * never imports DOM lib types.
 */
export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

/** `GET /api/amberxvid/turn-credentials` — the per-call ICE configuration. */
export interface TurnCredentialsResponse {
  ok: true;
  iceServers: IceServerConfig[];
  /** False when no TURN secret is configured (dev without coturn): STUN-only,
   *  said honestly — the client badge and settings dialog surface it. */
  turnConfigured: boolean;
  /** Seconds the minted TURN credential stays valid. */
  ttlS: number;
  expiresAt: string;
}

/**
 * The dedicated video-chat settings (P8) — the six values a CALL cares about.
 *
 * **P16 moved where they live.** They were a `localStorage` document per
 * browser (`gx:amberxvid:videochat`); they are now a view over the member's
 * per-account preferences (`./prefs`, the settings tree's kv half), because the
 * tree grew a DEVICES group and two stores holding one camera id is a picker
 * that edits the copy the call does not read. The video-chat DIALOG still
 * exists and is still the fast way to change them mid-call — it and the
 * Settings stage now write the same six keys.
 *
 * P6 removed the mesh-era dials with the transport they proved things about:
 * `requireSasConfirm` (inert since P5 — no pins exist to confirm) and
 * `forceRelay` (the ICE_CONTRACT relay proof; every call leg now terminates
 * on the media server, so there is no direct path to force away from).
 */
export interface VideoChatSettings {
  version: 1;
  /** `deviceId` or "default". */
  cameraId: string;
  /** `deviceId` or "default". */
  micId: string;
  resolution: "640x480" | "1280x720" | "1920x1080";
  /** Outbound video bandwidth cap in kbps; 0 = uncapped. */
  maxKbps: number;
  /** Ring sound on an incoming call. */
  alertSound: boolean;
  /**
   * Ring loudness, 0–100 (P13). Separate from `alertSound` rather than folded
   * into it as "0 = off": a member who drags this to zero to silence one noisy
   * evening keeps the volume they had when they flip the switch back, which a
   * single control would have thrown away.
   */
  ringVolume: number;
}

/**
 * One call between two module users. Identity here is SERVER-ATTESTED (P5):
 * `from`/`to` are the authenticated participants the server bound at invite
 * time, the room record built from this session is the authority on who is in
 * the call, and no client-sent identity field is ever believed. The mesh-era
 * attestation state (SAS confirmations, link bindings, harvested DTLS
 * fingerprints, the `verified` flag) was retired with the ceremony it served.
 */
export interface CallSession {
  id: string;
  from: string;
  to: string;
  state: CallState;
  createdAt: string;
  answeredAt?: string;
  endedAt?: string;
  /**
   * Mesh-era field, RETIRED in P6 with the direct/relayed badge it fed: every
   * leg is client ⇄ media server now, so there is no path distinction left to
   * report (`MEDIA_CONTRACT.path`). Optional so old persisted records still
   * parse; nothing writes or reads it any more.
   */
  path?: "direct" | "relayed" | "unknown";
  endReason?: string;
}

/* ============================ moderation (P17) ================================ */

/**
 * What a report is ABOUT. Five kinds, because those are the five things a
 * member can be looking at when they decide somebody has gone too far — and
 * the ctx map's *Report* rows resolve to exactly these.
 */
export type ReportSubjectKind = "post" | "comment" | "album-item" | "stream" | "profile";

/**
 * The subject, as a REFERENCE rather than a copy.
 *
 * `owner` is whose material it is (the wall's owner, the album's owner, the
 * stream's host, the profile's member) and is what the wing acts on; `id` is
 * the thing itself, empty only for a profile, which IS its member. `parent`
 * carries the container a nested subject cannot be found without — a comment's
 * post, an album item's album.
 *
 * `excerpt` is the one COPIED field, and it is the reason the queue survives
 * its own success: a moderator opening a report an hour after the author
 * deleted the post still has to be able to see what was reported. A reference
 * alone would leave them with an id and nothing else.
 */
export interface ReportSubject {
  kind: ReportSubjectKind;
  /** Normalized username of the member whose material this is. */
  owner: string;
  /** The subject's own id; `""` for a profile. */
  id: string;
  /** A comment's post id, an album item's album id. Absent otherwise. */
  parent?: string;
  /** What the reporter was looking at, kept verbatim and capped. */
  excerpt?: string;
}

export type ReportState = "open" | "actioned" | "dismissed";

/** One row of the moderation queue. */
export interface ReportEntry {
  version: 1;
  id: string;
  subject: ReportSubject;
  /** Normalized username of whoever filed it. */
  reporter: string;
  reason: string;
  state: ReportState;
  createdAt: string;
  /** Set together, or all three null — a resolved report names its moderator. */
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string;
}

/** What the wing's queue tab counts across the whole store. */
export interface ReportCounts {
  open: number;
  actioned: number;
  dismissed: number;
}

/** One thing the vault integrity scan found. */
export interface VaultFinding {
  /** The member whose vault it is. */
  owner: string;
  kind:
    /** A file in the store that no index, manifest or document claims. */
    | "orphan-file"
    /** An index row or manifest whose bytes are gone. */
    | "missing-file"
    /** A post that references an attachment nothing can serve. */
    | "dangling-media"
    /** An index row whose document is gone. */
    | "stale-index-row"
    /** A room or thread whose owner no longer has an account. */
    | "orphan-room"
    | "orphan-thread"
    /** A whole vault whose account no longer exists. */
    | "orphan-vault";
  /** Store-relative address of the thing found — a path, an id, a room id. */
  subject: string;
  /** One line a person can act on. */
  detail: string;
  /** Bytes a fix would reclaim; 0 when a fix reclaims nothing. */
  bytes: number;
  /** False when only a person can decide (an orphan vault, for instance). */
  fixable: boolean;
  /** Set by the fix pass: what it actually did, or why it did not. */
  fixed?: boolean;
}

/** The scan's whole answer. */
export interface VaultScan {
  findings: VaultFinding[];
  /** Vaults walked — so "0 findings" is distinguishable from "walked nothing". */
  vaults: number;
  rooms: number;
  threads: number;
  bytes: number;
  generatedAt: string;
  /** True when this was a FIX pass rather than a read-only scan. */
  repaired: boolean;
}

/**
 * One subject, resolved LIVE for the queue's preview-in-place.
 *
 * `found: false` is a first-class answer rather than an error: between a report
 * being filed and a moderator opening it, the most likely thing to have happened
 * is that the author deleted the thing. The row's stored `excerpt` is what the
 * wing shows then, which is the whole reason the excerpt is kept.
 */
export interface ModerationPreview {
  found: boolean;
  kind: ReportSubjectKind;
  /** Where it lives, in one line — "Post on gizmox's wall". */
  title: string;
  /** The text of it: the post, the comment, the caption, the blurb, the bio. */
  body: string;
  author: string | null;
  at: string | null;
  /** Attachment ids, for a post the wing can render thumbnails of. */
  media?: string[];
  visibility?: SocialVisibility;
}

/** Everything the wing's GET returns — one round trip per tab open. The vault
 *  scan is deliberately absent: it is IO-heavy and lives behind its button. */
export interface ModerationSnapshot {
  reports: ReportEntry[];
  counts: ReportCounts;
  /** Live streams, right now. */
  streams: StreamInfo[];
  /** The WHOLE recording library — the admin is the only role that sees past
   *  the per-owner visibility rule. */
  recordings: RecordingManifest[];
  /** Every member's username, so the wing's owner pickers do not need a second
   *  round trip to the roster. Usernames only: the wing acts on material, and
   *  the person behind it is the admin suite's own table one tab to the left. */
  members: string[];
  generatedAt: string;
}
