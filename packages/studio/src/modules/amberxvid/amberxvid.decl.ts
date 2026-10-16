/**
 * @file AmberX Vid's DECLARATION — data only, importable by plain Node.
 *
 * Same hard rule as every other decl: **nothing but `import type`**.
 *
 * The module is GizmoX's `amberxvid` — the video suite (branded splash,
 * module login, recorder, library, messenger, P2P video chat, streams,
 * profiles, avatars, admin window, and the Windows tray hand-off) — imported
 * on 2026-08-13 per the owner's "import amberx vid as a module". Slot 9/12.
 * The port was declared done on 2026-08-13; `PORTING.md`, the brief every
 * porting agent followed, was deleted with it as its own header required. What
 * outlived it — the accepted degradations and what was deliberately left
 * undone — is recorded in `PLANNING-STATE.md`, "AmberX Vid lands as slot 9/12".
 *
 * ── settings: the GizmoX spec did NOT port, per standing rule ────────────────
 *
 * GizmoX's `amberxvid` shipped a 21-value settings spec through
 * `registerSettingsSource()`. None of that CONTRACT crosses (owner directive,
 * `amberx-bound-builds.md`) — no `chromeGroup()`, no cui, no override cascade,
 * no level machinery. What crossed is the shape a decl already has: rows.
 *
 * The port landed four of them, and P16 (2026-08-15) grew the tree the
 * platform actually needs on top — see the long note on `settings` below for
 * where each group lives and why two of them are not kv rows at all. The
 * original four, still here and still earning their place:
 *
 *   - `recorderResolution` / `recorderQuality` — what a fresh capture starts
 *     as; the toolbar quick actions cycle them live, so a wrong default is
 *     re-picked before every recording.
 *   - `animationIntensity` — one knob every animation in the module respects
 *     (splash, toolbar, messenger, calls); it exists because "reduced motion"
 *     is a real accessibility need, not a taste.
 *   - `backgroundArmed` — arms the Windows tray service to keep recording
 *     with the browser closed. A hand-off to a native process is a MODE, not
 *     a preference.
 *
 * Everything the old GizmoX spec carried that P16 did NOT promote still rides
 * as a constant at its GizmoX default (`settings.ts`, the adapter), and the
 * refusals are written down there rather than left to be re-proposed.
 */
import type { ModuleDecl, NavMenuAsset } from "@axf/core";

/**
 * The query parameter every declared nav link carries, and the one the module
 * reads on arrival. It is `?view=` rather than a sub-route because the suite is
 * ONE mounted screen with ten stages — a live call, a running capture and an
 * open broadcast all survive a stage change precisely because nothing
 * remounts, and a real route per surface would unmount the shell that owns
 * them. Declared here, beside the links that build it, so the writer of a link
 * and the reader of the parameter cannot drift.
 */
export const AMBERXVID_VIEW_PARAM = "view";

/**
 * **The platform's extension-point ids** (P19, 2026-08-15), in one place.
 *
 * Exported as constants rather than left as literals in the `points` array
 * below because three files cite each one — this declaration, the host reader
 * (`points.ts`) and the contribution — and a point id spelled three times is a
 * point id that eventually disagrees with itself. The decl is the single source
 * precisely because it is the file the closure resolver reads.
 *
 * They live HERE and not in `points.ts` for the reason every `<id>.decl.ts` in
 * this tree exists at all: this file must stay importable by plain Node, and
 * `points.ts` imports React and core's registry. The arrow therefore points
 * this way — `points.ts` imports these; nothing here imports `points.ts`.
 *
 * `amberxvid.credits-meter` (P18) keeps its literal in its own declaration and
 * its constant in `lib/creditsMeters.ts`, where the server table that prices it
 * lives. Pulling it up here would make this file the source of a string the
 * SERVER is the authority on, which is the wrong way round for money.
 */
export const AMBERXVID_PROFILE_RAIL_POINT = "amberxvid.profile-rail";
export const AMBERXVID_STREAM_TOOL_POINT = "amberxvid.stream-tool";
export const AMBERXVID_ROOM_TILE_BADGE_POINT = "amberxvid.room-tile-badge";
export const AMBERXVID_WALL_COMPOSER_ACTION_POINT = "amberxvid.wall-composer-action";
export const AMBERXVID_MESSENGER_ACTION_POINT = "amberxvid.messenger-action";
export const AMBERXVID_SETTINGS_SECTION_POINT = "amberxvid.settings-section";
export const AMBERXVID_ADMIN_TOOL_POINT = "amberxvid.admin-tool";

/**
 * **The suite's navigation, declared as data** (P14).
 *
 * One list, three consumers, and that is the whole point of putting it here:
 *
 *  - the **peel** carries it (`ModuleDecl.nav`) and the peeled app's generated
 *    boot registers it on `app.nav`, which is how the platform ships with its
 *    own navigation instead of inheriting the SDK's;
 *  - the **suite itself** renders it — `SuiteNav.tsx` draws both the surface
 *    bar and the suite map from these items, so a surface that exists is a
 *    surface both of them list;
 *  - the **module agent** derives its navigation skill from it.
 *
 * Before this the suite had two hand-written lists (a row of `<Button>`s and a
 * `SuiteEntry[]`) that had already disagreed — the map offered "Video chat"
 * while the bar offered "Calls", and Rooms was on the bar and missing from the
 * map. Two lists of the same thing is one list plus a bug waiting.
 *
 * Icons are contract glyph ids (`REQUIRED_GLYPH_IDS`), never inline drawings,
 * so the menu recolours with the brand pack like every other surface.
 */
export const AMBERXVID_NAV: NavMenuAsset = {
  id: "amberxvid-nav",
  title: "AmberX Vid navigation",
  surface: "app.nav",
  description:
    "Every surface of the AmberX Vid platform — capture, the social face, and the live rooms — " +
    "as one declared list. Links carry ?view=<id>; the suite reads it on arrival and writes it " +
    "back as the stage changes, so every surface is addressable without remounting the shell.",
  items: [
    { kind: "section", id: "sec-create", label: "Create" },
    { kind: "link", id: "recorder", label: "Recorder", glyph: "icon-ellipse", route: "/amberxvid?view=recorder" },
    { kind: "link", id: "library", label: "Library", glyph: "icon-layers", route: "/amberxvid?view=library" },

    { kind: "divider", id: "div-social" },
    { kind: "section", id: "sec-social", label: "Social" },
    { kind: "link", id: "feed", label: "Feed", glyph: "icon-book", route: "/amberxvid?view=feed" },
    { kind: "link", id: "profile", label: "Profile", glyph: "icon-account", route: "/amberxvid?view=profile" },
    { kind: "link", id: "albums", label: "Photos", glyph: "icon-rect", route: "/amberxvid?view=albums" },
    { kind: "link", id: "profiles", label: "Members", glyph: "icon-globe", route: "/amberxvid?view=profiles" },

    { kind: "divider", id: "div-live" },
    { kind: "section", id: "sec-live", label: "Live" },
    { kind: "link", id: "messenger", label: "Messenger", glyph: "icon-chat", route: "/amberxvid?view=messenger" },
    { kind: "link", id: "rooms", label: "Rooms", glyph: "icon-grid", route: "/amberxvid?view=rooms" },
    { kind: "link", id: "streams", label: "Streams", glyph: "icon-bolt", route: "/amberxvid?view=streams" },
    { kind: "link", id: "calls", label: "History", glyph: "icon-history", route: "/amberxvid?view=calls" },

    { kind: "divider", id: "div-you" },
    { kind: "section", id: "sec-you", label: "You" },
    /**
     * P16's settings tree. It is a NAV LINK rather than a gear because it is a
     * stage like any other: the shell's own gear opens the decl rows below in
     * the framework dialog, and this opens the same values with the chrome the
     * dialog structurally cannot host — a live camera preview, a microphone
     * level meter, and the two groups whose documents are not kv at all.
     */
    { kind: "link", id: "settings", label: "Settings", glyph: "icon-gear", route: "/amberxvid?view=settings" }
  ]
};

export const AMBERXVID_DECL: ModuleDecl = {
  id: "amberxvid",
  title: "AmberX Vid",
  summary:
    "The social video platform, on the accounts module as its one identity system: a wall and " +
    "a merged feed, albums, buddies, blocks and group chats in accounts messaging, 1:1 calls " +
    "and N-way group rooms, member broadcasting with both-direction recording, invitations " +
    "that land straight in a room, the recorder and its library, and an AmberX Vid moderation " +
    "wing inside the accounts admin suite. Calls, rooms and streams are relayed by the AmberX " +
    "Vid media server.",
  route: "/amberxvid",
  glyph: "icon-play",
  nav: AMBERXVID_NAV,
  /**
   * **The context-menu map** (P15) — every surface right-clicks, and what it
   * offers depends on what is under the pointer.
   *
   * ## Why this is data and not forty handlers
   *
   * The GizmoX original reached for context menus constantly, through
   * `useCtx` + a hand-written `onContextMenu` per surface. The port kept the
   * call sites and stubbed the hook (`kit/ax.tsx` — `openCtx` is a no-op), so
   * until this phase the whole module right-clicked into nothing. Rebuilding
   * that mechanism was never the option: GizmoX's own post-mortem is that its
   * menus were never bad, the COVERAGE was, because a habit repeated in forty
   * files has holes. Declared areas do not: `test/ctx-conformance.test.ts`
   * fails a declared area nobody marks and a marker nobody declares, in both
   * directions, by discovery rather than by a list.
   *
   * ## Nesting is the whole design
   *
   * Areas compose up the DOM, innermost first, so a right-click gets the rows
   * of everything it is inside. That is what makes this map rich without
   * repeating a row:
   *
   * ```
   *   amberxvid.surface            the suite — New room, Go live, New post
   *     amberxvid.room             the room list card / the live grid
   *       amberxvid.member         a participant tile
   *     amberxvid.post             a wall post
   *     amberxvid.message          a chat bubble
   * ```
   *
   * Right-click a participant tile and you get the member's rows *and* the
   * room's *and* the suite's — one menu, three subjects, in that order. No
   * area repeats another's rows to achieve it.
   *
   * ## Presence, not greying
   *
   * Rows gate on `when` (absent) rather than `enabledWhen` (greyed) wherever
   * the reason is who the viewer IS — ownership, moderator role, buddy state.
   * A greyed *Delete post* on somebody else's post tells a reader they have
   * been refused something they never had. `enabledWhen` is kept for the one
   * shape it is right for: a row that is yours and simply cannot run *now*
   * — calling somebody who is not in the suite.
   *
   * ## What is deliberately NOT declared here
   *
   * - **Sign out.** Core's default menu already appends it to every menu, in
   *   red, naming the signed-in user (`ctx/default-menu.ts`), and since P1
   *   the suite's sign-out IS the accounts sign-out. Declaring a second one is
   *   the three-logos-on-one-screen failure, one band lower.
   * - **A row for the settings tree.** There are three ways to reach a
   *   preference already — the nav's *Settings* link, the universal band's
   *   *Module settings* (the framework dialog over the kv half), and the
   *   `settings` row below, which opens the video-chat dialog mid-call because
   *   that is when a camera turns out to be the wrong one. All three write the
   *   SAME store, which is what makes three doors acceptable rather than three
   *   copies; a fourth row saying "Settings…" would be a menu describing itself.
   * - **Report on anything but a wall post.** The queue itself now exists
   *   (P17: `lib/reports.ts`, and the wing inside the accounts admin suite),
   *   and it accepts all five subject kinds — post, comment, album item,
   *   stream, profile. What has not been added is the ROWS: a *Report* row on
   *   a photo or a stream needs its own command, its own predicate and a
   *   `report()` on that surface's actions, which is the context-map phase's
   *   work and not a line here. One reporting row against one subject stays
   *   honest either way; the difference since P17 is that the row it already
   *   has files into a table a moderator reads rather than into a DM.
   *
   * Behaviour is in `amberxvid.commands.ts`, reached through `ctxBridge.ts`;
   * the destructive rows summon the surface's OWN confirm rather than carrying
   * one, so there is still exactly one delete path per subject.
   */
  menus: {
    areas: [
      {
        id: "amberxvid.member",
        title: "Member",
        description:
          "A member chip, row or tile — the members list, Profiles, the messenger's buddies, a " +
          "room participant."
      },
      {
        id: "amberxvid.message",
        title: "Message",
        description: "A chat bubble in a DM or a group thread."
      },
      {
        id: "amberxvid.post",
        title: "Wall post",
        description: "A post on a wall or in the merged feed."
      },
      {
        id: "amberxvid.photo",
        title: "Album item",
        description: "A photo in an album's justified grid."
      },
      {
        id: "amberxvid.stream",
        title: "Stream",
        description: "A live stream's card in the stream hub."
      },
      {
        id: "amberxvid.room",
        title: "Group room",
        description: "A room's card in the list, or the live room's participant grid."
      },
      {
        id: "amberxvid.history",
        title: "History row",
        description: "A call or room entry in the history surface."
      },
      {
        id: "amberxvid.recording",
        title: "Library item",
        description: "A capture in the recordings library, in either view."
      },
      {
        id: "amberxvid.surface",
        title: "AmberX Vid",
        description: "Anywhere on the suite — the module's own right-click surface."
      }
    ],
    items: {
      "amberxvid.member": [
        { id: "profile", label: "View profile", command: "amberxvid.member.profile", order: 10 },
        {
          id: "message",
          label: "Message",
          command: "amberxvid.member.message",
          when: "amberxvid.member.other",
          order: 20
        },
        /**
         * The one `enabledWhen` on this area, and the exception the header
         * describes: a call you may place and simply cannot place right now.
         * The predicate answers with WHY ("they are not in the suite"), which
         * is the sentence the surfaces already say by hand.
         */
        {
          id: "call",
          label: "Video call",
          command: "amberxvid.member.call",
          when: "amberxvid.member.other",
          enabledWhen: "amberxvid.member.online",
          order: 30
        },
        {
          id: "invite",
          label: "Invite to my room",
          command: "amberxvid.member.invite",
          when: "amberxvid.member.ringable",
          order: 40
        },
        { id: "sep-social", label: "", role: "separator", order: 50 },
        {
          id: "add-buddy",
          label: "Add buddy",
          command: "amberxvid.member.add-buddy",
          when: "amberxvid.member.addable",
          order: 60
        },
        {
          id: "block",
          label: "Block",
          command: "amberxvid.member.block",
          when: "amberxvid.member.blockable",
          role: "danger",
          order: 70
        }
      ],
      /**
       * **Two rows, and the missing third is deliberate.**
       *
       * P15's row list asked for *Delete own* here, with a moderator delete
       * behind a predicate. Neither is declared, because **nothing in either
       * package can delete one message**: the accounts messaging store offers
       * `deleteThread`, `deleteUserThreads` and `pruneMessages` and no
       * per-message operation at all (`modules/accounts/lib/messages.ts`), and
       * `POST /api/accounts/messages` has no action for one either.
       *
       * Building it here was refused on ownership, not on effort. The messaging
       * store is the accounts module's contract, and this project consumes that
       * contract rather than extending it — the same line P0 drew when it
       * stopped rather than writing `accounts/lib/storage.ts` on another
       * project's behalf. A row wired to a delete this module invented would
       * also be a second delete path for a store whose only other one is
       * thread-scoped.
       *
       * So the rows are absent rather than present-and-dead. When accounts
       * grows `deleteMessage(actor, threadId, messageId)` and a route action,
       * this is a four-line addition here plus `remove()` in the chat window —
       * `MessageActions.remove` already exists in `ctxBridge.ts`, unused, for
       * exactly that.
       */
      "amberxvid.message": [
        { id: "reply", label: "Reply", command: "amberxvid.message.reply", order: 10 },
        { id: "copy", label: "Copy text", command: "amberxvid.message.copy", order: 20 }
      ],
      "amberxvid.post": [
        { id: "react", label: "Like / unlike", command: "amberxvid.post.react", order: 10 },
        { id: "comment", label: "Comment…", command: "amberxvid.post.comment", order: 20 },
        /**
         * *Copy TEXT*, and P15's row list asked for *Copy link*.
         *
         * There is no address for a post. Albums have one — `ALBUM_LINK_PARAM`,
         * `albumItemUrl`, `parseAlbumLink` and an arrival effect in the shell,
         * four pieces working together — and posts have none of it, so a *Copy
         * link* row today would hand somebody a URL that opens the suite and
         * not the post. A row that quietly produces the wrong thing is worse
         * than a row that produces a smaller right thing, and the smaller right
         * thing serves the same want: getting this post out of the app.
         *
         * When posts get the album's four pieces, this becomes *Copy link* and
         * `PostActions.copyLink` changes what it copies. Nothing else moves.
         */
        { id: "copy-link", label: "Copy post text", command: "amberxvid.post.copy-link", order: 30 },
        { id: "sep", label: "", role: "separator", order: 40 },
        {
          id: "edit",
          label: "Edit post",
          command: "amberxvid.post.edit",
          when: "amberxvid.post.mine",
          order: 50
        },
        {
          id: "delete",
          label: "Delete post",
          command: "amberxvid.post.delete",
          when: "amberxvid.post.deletable",
          role: "danger",
          order: 60
        },
        {
          id: "report",
          label: "Report to moderators",
          command: "amberxvid.post.report",
          when: "amberxvid.post.reportable",
          order: 70
        }
      ],
      "amberxvid.photo": [
        { id: "open", label: "Open", command: "amberxvid.photo.open", order: 10 },
        { id: "share", label: "Share to a message", command: "amberxvid.photo.share", order: 20 },
        { id: "sep", label: "", role: "separator", order: 30 },
        {
          id: "caption",
          label: "Caption…",
          command: "amberxvid.photo.caption",
          when: "amberxvid.photo.editable",
          order: 40
        },
        {
          id: "set-cover",
          label: "Set as album cover",
          command: "amberxvid.photo.set-cover",
          when: "amberxvid.photo.editable",
          order: 50
        },
        {
          id: "delete",
          label: "Delete photo",
          command: "amberxvid.photo.delete",
          when: "amberxvid.photo.editable",
          role: "danger",
          order: 60
        }
      ],
      "amberxvid.stream": [
        { id: "join", label: "Join stream", command: "amberxvid.stream.join", order: 10 },
        /**
         * A toggle rather than two rows that swap: the state IS the answer to
         * "am I following this host", and a `checkedWhen` draws it instead of
         * asserting it in a label the menu would have to keep in step.
         */
        {
          id: "follow",
          label: "Follow the host",
          command: "amberxvid.stream.follow",
          role: "toggle",
          checkedWhen: "amberxvid.stream.following",
          when: "amberxvid.stream.other",
          order: 20
        },
        { id: "copy-link", label: "Copy invite link", command: "amberxvid.stream.copy-link", order: 30 },
        { id: "sep", label: "", role: "separator", order: 40 },
        {
          id: "record",
          label: "Record this broadcast",
          command: "amberxvid.stream.record",
          role: "toggle",
          checkedWhen: "amberxvid.stream.recording",
          when: "amberxvid.stream.mine",
          order: 50
        },
        {
          id: "end",
          label: "End stream",
          command: "amberxvid.stream.end",
          when: "amberxvid.stream.mine",
          role: "danger",
          order: 60
        }
      ],
      /**
       * Two rows, and *Copy invite link* is not one of them.
       *
       * The invitation system is real and this module uses it — but
       * `InviteTargetKind` is `"none" | "stream" | "chat" | "call"` and a group
       * ROOM is none of those (`lib/inviteContract.ts`). A room's chat thread
       * is a `chat` target, and an invitation to it lands the redeemer in the
       * conversation and NOT in the room, which is a different place with the
       * same name on it. So the row is absent rather than plausibly wrong.
       *
       * The way in for somebody who is not here is the member menu's *Invite to
       * my room*, which rings them — that works today and is what P13 built it
       * for. A link would need a fifth `InviteTargetKind` threaded through
       * `createInvite`, `targetPhrase`, `encodeArrival`, `decodeArrival`,
       * `describeInvite` and the shell's arrival effect: six edits to P7's
       * contract, which is a feature and not a menu row.
       */
      "amberxvid.room": [
        { id: "join", label: "Join room", command: "amberxvid.room.join", order: 10 },
        { id: "sep", label: "", role: "separator", order: 20 },
        /**
         * The one row on this map that needed a server capability built for it
         * (`POST /api/amberxvid/rooms { action: "remove" }`). That was in scope
         * where the message deletes were not, and the line between them is
         * ownership: the rooms route is this module's, and the accounts
         * messaging store is another module's contract.
         */
        {
          id: "remove",
          label: "Remove from room",
          command: "amberxvid.room.remove",
          when: "amberxvid.room.removable",
          role: "danger",
          order: 30
        }
      ],
      /**
       * ONE area over two histories — the call log and the broadcast log — and
       * every row is gated so that none of them is dead on either.
       *
       * They share an area because they answer the same question: *something
       * happened, what can I do about it now.* What differs is what the entry
       * left behind, and that is exactly what the two predicates read. A call
       * has a person on the other end and no recording; a broadcast has a
       * recording and nobody to ring. So the call log draws the first two rows
       * and the stream history draws the third, from one declaration, with no
       * row rendering into a surface that cannot honour it.
       *
       * The alternative — two areas with three rows between them — would have
       * put *Open the recording* in both or in neither, which is how the same
       * act ends up with two names.
       */
      "amberxvid.history": [
        {
          id: "call-back",
          label: "Call back",
          command: "amberxvid.history.call-back",
          when: "amberxvid.history.callable",
          order: 10
        },
        {
          id: "thread",
          label: "Open the conversation",
          command: "amberxvid.history.thread",
          when: "amberxvid.history.callable",
          order: 20
        },
        {
          id: "recording",
          label: "Open the recording",
          command: "amberxvid.history.recording",
          when: "amberxvid.history.recorded",
          order: 30
        }
      ],
      "amberxvid.recording": [
        { id: "play", label: "Play", command: "amberxvid.recording.play", order: 10 },
        {
          id: "show-in-profile",
          label: "Show on my profile",
          command: "amberxvid.recording.show-in-profile",
          when: "amberxvid.recording.mine",
          order: 20
        },
        { id: "sep", label: "", role: "separator", order: 30 },
        {
          id: "rename",
          label: "Rename…",
          command: "amberxvid.recording.rename",
          when: "amberxvid.recording.mine",
          order: 40
        },
        {
          id: "delete",
          label: "Delete recording",
          command: "amberxvid.recording.delete",
          when: "amberxvid.recording.deletable",
          role: "danger",
          order: 50
        }
      ],
      "amberxvid.surface": [
        /**
         * The ellipsis on two of these three is load-bearing, not decoration:
         * *Go live* opens a dialog, while *New group room* and *New wall post*
         * open the SURFACE that owns the composer. Neither grows a parallel
         * dialog of its own — a second room-naming field is a second place for
         * the title limit to drift, and a second composer is a second place for
         * the visibility picker to go missing.
         */
        { id: "new-room", label: "New group room…", command: "amberxvid.surface.new-room", order: 10 },
        { id: "go-live", label: "Go live…", command: "amberxvid.surface.go-live", order: 20 },
        { id: "new-post", label: "New wall post…", command: "amberxvid.surface.new-post", order: 30 },
        { id: "sep", label: "", role: "separator", order: 40 },
        { id: "settings", label: "Camera & microphone…", command: "amberxvid.surface.settings", order: 50 },
        {
          id: "copy-selection",
          label: "Copy from AmberX Vid",
          command: "ctx.copy",
          order: 60
        }
      ]
    }
  },
  /**
   * **THE SETTINGS TREE** (P16) — the module's per-member preferences, declared
   * as data so the shell's gear and its dialog render them with no per-module
   * dialog file.
   *
   * ## Per accounts user, and that is the transport's doing rather than a
   * ## promise this file makes
   *
   * A decl's rows persist through core's kv transport (`persist/client` →
   * `/api/axf/kv/<ns>`), and the studio host resolves the kv user from the
   * verified `axs_session` cookie (`src/server/axfKv.ts`, `kvUser`). So a
   * signed-in member's document is `data/axf/kv/<username>/amberxvid-settings.json`
   * and a signed-out one lands under `local/`. Nothing in this module had to be
   * built for that: the accounts spine already owned it, which is exactly why
   * the tree rides it instead of growing a per-user store of its own.
   *
   * ## Two groups of the tree are deliberately NOT here
   *
   * **DND** (the switch and the quiet-hours window) and the MESSENGER document's
   * own fields (chime, timestamps, popup) are per-member documents already, on
   * disk, and the code that ENFORCES them reads them there:
   * `lib/availability.ts` answers every ring through `lib/dnd.ts`, and
   * `lib/messengerSettings.ts` answers `mayInterrupt`. Copying either into a kv
   * row would produce a control that edits one copy while the server obeys the
   * other — the false-green shape `lib/vault.ts`'s header warns about. They are
   * rendered in the tree (`Settings.tsx`, groups DND and MESSENGER) against
   * their own documents, and this decl stays the kv half only.
   *
   * ## Devices, and why two of them are `text`
   *
   * `cameraId` / `micId` hold a `MediaDeviceInfo.deviceId` or the literal
   * `"default"`. A `select` cannot declare their options — the list only exists
   * after `enumerateDevices()` resolves in a browser — so the framework dialog
   * shows the raw value and the tree's DEVICES group shows the real picker,
   * with the live preview and the level meter, over the same two keys. A member
   * who never opens the tree still has a working default.
   *
   * The honest consequence of putting them per-USER rather than per-BROWSER:
   * a deviceId is a machine's, so signing in on a second machine yields an id
   * that resolves to nothing there. `getUserMedia` is asked with a non-`exact`
   * fallback for precisely that case (`VideoChat.tsx`), so the wrong id costs a
   * default camera, never a failed call.
   */
  settings: {
    ns: "amberxvid-settings",
    rows: [
      /* ── NOTIFICATIONS ─────────────────────────────────────────────────── */
      {
        key: "ringAlerts",
        label: "Ring out loud",
        hint: "Play the ring chime when a call or a room invite arrives.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "ringVolume",
        label: "Ring volume",
        hint: "How loud that ring is, 0–100 — separate from the switch so silencing one evening does not forget the level.",
        kind: "number",
        defaultValue: 70,
        min: 0,
        max: 100,
        step: 5
      },
      {
        key: "trayAlerts",
        label: "Tray alerts",
        hint: "Raise a Windows tray balloon for a ring that arrives while this tab is in the background.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "followedLiveAlerts",
        label: "Alert me when somebody I follow goes live",
        hint: "Fan the go-live alert to me; off, streams still appear in the hub, they just do not interrupt.",
        kind: "switch",
        defaultValue: true
      },

      /* ── PRIVACY DEFAULTS ──────────────────────────────────────────────── */
      {
        key: "defaultPostVisibility",
        label: "Default post visibility",
        hint: "What a new wall post is set to before you change it.",
        kind: "select",
        defaultValue: "public",
        options: [
          { value: "public", label: "Public" },
          { value: "buddies", label: "Buddies only" },
          { value: "private", label: "Only me" }
        ]
      },
      {
        key: "defaultAlbumVisibility",
        label: "Default album visibility",
        hint: "What a new photo album is set to before you change it.",
        kind: "select",
        defaultValue: "public",
        options: [
          { value: "public", label: "Public" },
          { value: "buddies", label: "Buddies only" },
          { value: "private", label: "Only me" }
        ]
      },
      {
        key: "whoMayCall",
        label: "Who may call me",
        hint: "Refuse rings from anybody who is not a buddy — enforced at the ring door, not in the UI.",
        kind: "select",
        defaultValue: "everyone",
        options: [
          { value: "everyone", label: "Everyone" },
          { value: "buddies", label: "Buddies only" }
        ]
      },
      {
        key: "whoMayInvite",
        label: "Who may invite me",
        hint: "Refuse room and stream invitations from anybody who is not a buddy.",
        kind: "select",
        defaultValue: "everyone",
        options: [
          { value: "everyone", label: "Everyone" },
          { value: "buddies", label: "Buddies only" }
        ]
      },

      /* ── DEVICES ───────────────────────────────────────────────────────── */
      {
        key: "cameraId",
        label: "Camera",
        hint: "Which camera joins a call — pick it in the Settings stage, where the preview is.",
        kind: "text",
        defaultValue: "default"
      },
      {
        key: "micId",
        label: "Microphone",
        hint: "Which microphone joins a call — pick it in the Settings stage, where the level meter is.",
        kind: "text",
        defaultValue: "default"
      },
      {
        key: "callResolution",
        label: "Call resolution",
        hint: "Capture size requested from the camera when a call starts.",
        kind: "select",
        defaultValue: "1280x720",
        options: [
          { value: "640x480", label: "640 × 480" },
          { value: "1280x720", label: "1280 × 720" },
          { value: "1920x1080", label: "1920 × 1080" }
        ]
      },
      {
        key: "uplinkCapKbps",
        label: "Uplink cap",
        hint: "Ceiling in kbps on the video you send, across every simulcast layer — 0 is uncapped, and anything else is kindness to a slow connection.",
        kind: "number",
        defaultValue: 0,
        min: 0,
        max: 5000,
        step: 250
      },

      /* ── MESSENGER (the kv half — see the header for the document half) ── */
      {
        key: "messengerEnterToSend",
        label: "Enter sends the message",
        hint: "On, Enter sends and Shift+Enter breaks the line; off, the reverse.",
        kind: "switch",
        defaultValue: true
      },

      /* ── PLAYBACK ──────────────────────────────────────────────────────── */
      {
        key: "autoplayPreviews",
        label: "Autoplay stream previews",
        hint: "Start each live tile's 15-second preview on arrival instead of on hover — off by default, because a busy hub would open one media leg per tile.",
        kind: "switch",
        defaultValue: false
      },
      {
        key: "viewerRecordFormat",
        label: "Viewer recording format",
        hint: "Container a stream you record as a viewer is written in — Automatic picks the best one this browser supports.",
        kind: "select",
        defaultValue: "auto",
        options: [
          { value: "auto", label: "Automatic" },
          { value: "video/webm", label: "WebM" },
          { value: "video/mp4", label: "MP4" }
        ]
      },

      /* ── RECORDER + MODULE-WIDE (pre-P16 rows, unchanged) ──────────────── */
      {
        key: "recorderResolution",
        label: "Recorder resolution",
        hint: "What a fresh capture starts as. The toolbar quick actions cycle this live.",
        kind: "select",
        defaultValue: "1280x720",
        options: [
          { value: "640x480", label: "640 × 480" },
          { value: "1280x720", label: "1280 × 720" },
          { value: "1920x1080", label: "1920 × 1080" }
        ]
      },
      {
        key: "recorderQuality",
        label: "Recorder quality",
        hint: "Bitrate tier for new captures — higher is bigger files.",
        kind: "select",
        defaultValue: "high",
        options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "max", label: "Max" }
        ]
      },
      {
        key: "animationIntensity",
        label: "Animation intensity",
        hint: "One knob, module-wide — splash, toolbar, messenger and call animations all scale to it. Reduced-motion always wins.",
        kind: "select",
        defaultValue: "full",
        options: [
          { value: "off", label: "Off" },
          { value: "subtle", label: "Subtle" },
          { value: "full", label: "Full" },
          { value: "maximum", label: "Maximum" }
        ]
      },
      {
        key: "backgroundArmed",
        label: "Arm background recording",
        hint: "On, the record quick action hands the capture to the Windows tray service instead of the browser engine.",
        kind: "switch",
        defaultValue: false
      }
    ]
  },
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * **THE PLATFORM'S EXTENSION POINTS** — P18 declared the first; **P19
   * (2026-08-15) declared the other seven**, which is the moment this module
   * stopped being a suite and started being something other people can grow.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * ## The owner's standing model, applied
   *
   * *One default agent ships; others install as plugins.* The same is true of
   * surfaces, and that sentence is the whole design brief for this array: the
   * platform ships **one** of each kind of thing — one follow control, one host
   * badge, one credits card, one copy action — and every other one arrives as a
   * plugin. So the built-ins go through the same door a plugin's would rather
   * than being wired in behind it. Five of the eight points below are rendered
   * through by a contribution the MODULE makes to its own point, and that is not
   * ceremony: a point nobody has rendered through is a guess about a shape, and
   * the guesses are the ones that turn out to be missing a field the first time
   * somebody real uses them.
   *
   * ## What is declared for plugins with no in-tree consumer, and why
   *
   * Three points are declared and rendered but not contributed to from here:
   * `amberxvid.profile-rail`, `amberxvid.wall-composer-action` and
   * `amberxvid.admin-tool`. Each says so on its own declaration, with the reason
   * — the general one being that the module had nothing to MOVE onto them, and
   * inventing a feature to justify a point is how a point ends up shaped around
   * a thing nobody wanted. Their slots are rendered, so a contribution appears
   * the moment one exists; they render nothing today.
   *
   * ## Two kinds of payload, and the rule for choosing
   *
   *   - A point whose contribution is a **panel** carries a `load` THUNK, never
   *     a component (`amberart.tool`'s rule, learned the hard way): a field
   *     holding a component drags a `.tsx` into a data import, and Node's type
   *     stripping does not transform JSX — so a plugin declaring one becomes
   *     unresolvable and the suite gate goes red.
   *   - A point whose contribution is a **decision** — a badge that either
   *     applies to this tile or does not, an action that either offers itself on
   *     this message or does not — carries plain functions and no component at
   *     all. That is not a smaller version of the first kind: the room grid
   *     redraws 49 tiles at speaking-detection rate, and a `React.lazy` boundary
   *     per tile per badge would put a Suspense fence inside the hot path of a
   *     live call. The HOST draws these; the contribution only answers.
   *
   * ## `requires` is the gate, on every one of them
   *
   * Every field a host dereferences without checking is named in `requires`, so
   * a malformed contribution is refused BY NAME at registration rather than
   * rendering as a blank pane or throwing inside a video grid. The host reader,
   * the payload types and the render slots are in `points.ts` / `PointSlots.tsx`
   * — split from this file for the reason at the top of it.
   *
   * ── **`amberxvid.credits-meter`** (P18, 2026-08-15) — the first one ─────────
   *
   * Credits are platform currency: the LEDGER is the accounts module's, because
   * a balance belongs to a person, and the SPENDING is this module's, because a
   * price belongs to a feature. A meter is the join — an id, a title and what
   * one unit costs.
   *
   * It is a point rather than a `switch` in a route because the set of things
   * that cost credits is the set of things that do AI work, and that set is not
   * knowable from here: a plugin arrives later with a feature nobody planned,
   * and under a switch it could not charge for it without an edit to this
   * module. That is the fork-the-host shape declared points exist to have ended.
   *
   * `requires` makes a malformed meter a refusal BY NAME at registration rather
   * than a charge of `NaN` — the one failure mode a currency must not have.
   *
   * Contributors also register their meter server-side
   * (`registerCreditsMeter`, `./lib/creditsMeters`): the registry is a
   * client-graph singleton and a charge happens in a route, so the registry is
   * what makes "what plugs in here" answerable while the module table is the
   * pricing authority. That file's docblock carries the full reasoning.
   */
  points: [
    {
      id: "amberxvid.credits-meter",
      title: "AmberX Vid credit meter",
      description:
        "A feature that costs AI credits. The contribution is pure DATA — `id`, `title`, an " +
        "optional `hint` and pack `glyph`, and `cost` in credits per unit (0 is legal and means " +
        "declared-but-free). No thunk and no component: a meter is a price, not a surface. The " +
        "charge itself goes through `chargeMeter()`, which resolves the price, refuses an " +
        "unknown id rather than defaulting one, and answers 402 (cannot afford) rather than 403 " +
        "(not allowed) so the two conversations stay apart.",
      // `value`, core's own word for "a value the host reads (a default, a
      // limit, a label)" — which a price is. Not `ui-surface`: a meter renders
      // nothing, and typing it as one would promise a panel that never arrives.
      kind: "value",
      cardinality: "many",
      ordering: "priority",
      requires: ["id", "title", "cost"]
    },

    /* ── the social face ──────────────────────────────────────────────────── */

    {
      id: AMBERXVID_PROFILE_RAIL_POINT,
      title: "Profile shelf",
      description:
        "A pane in the Shelves column of a member's profile page, under the albums and media " +
        "shelves. The contribution supplies `id`, `title`, an optional pack `glyph` and a `load` " +
        "thunk importing a component that is handed a ProfileRailHost — `user` (whose profile), " +
        "`screenname`, `me` and `mine`, and nothing else. Whose profile it is and whether it is " +
        "the viewer's own are the two facts every shelf on that column already branches on; a " +
        "pane wanting more should make the case for a wider host, not be handed the page.",
      kind: "ui-surface",
      cardinality: "many",
      ordering: "priority",
      requires: ["id", "title", "load"]
      /**
       * **Declared for plugins; no in-tree consumer.**
       *
       * The two shelves already on that column — `AlbumsStrip` and `MediaStrip`
       * — were considered and NOT moved. Both take callbacks the page owns
       * (`onOpenAlbums`, `onJoinStream`, `onOpenRecording`) which are the
       * SHELL's stage-changing verbs, not facts about a profile. Widening
       * `ProfileRailHost` to carry them would have made the first contribution's
       * needs the contract for every later one, and a navigation callback is
       * exactly the kind of handle `claude-workspace/points.ts` refuses to hand
       * out: it is a lifetime the contribution does not own.
       *
       * So the slot renders — a contribution appears the moment one exists —
       * and the built-in shelves stay inline until there is a second real pane
       * to shape the host against. That is the honest state, and it is written
       * here rather than left for the next session to rediscover.
       */
    },
    {
      id: AMBERXVID_WALL_COMPOSER_ACTION_POINT,
      title: "Wall composer action",
      description:
        "An action in the wall composer's button row, beside Photos and the visibility picker. " +
        "The contribution is a COMMAND, not a panel: `id`, `label`, a pack `glyph` and " +
        "`run(host)`, where host carries `owner` (whose wall this post lands on), `me`, the " +
        "current `draft` and `notify`. A returned string is appended to the draft; returning " +
        "nothing means the action did its work elsewhere. It cannot reach the composer's " +
        "attachments or its submit — a contribution that could post on the member's behalf is a " +
        "different and much larger permission than one that can offer them a sentence.",
      kind: "command",
      cardinality: "many",
      ordering: "priority",
      requires: ["id", "label", "run"]
      /**
       * **Declared for plugins; no in-tree consumer.**
       *
       * P19's step suggested moving "the report action" here, and it does not
       * belong: reporting is an act against an EXISTING post — it is declared on
       * the `amberxvid.post` context area, it names a post id, and `lib/reports`
       * files it against that subject. The composer is where a post does not
       * exist yet, so a Report button in it would have no subject. It would also
       * be the module's second reporting path, against a queue whose whole value
       * is that there is one.
       *
       * The other candidate was the **Photos** button. It stayed inline because
       * uploading is not what this point does: `uploadWallMedia`, the per-post
       * attachment cap and the per-file rejection lines all live in the composer,
       * and moving the button here would have meant widening `run` into an
       * attachment API — a much larger contract, invented for a contribution
       * that is already in the box. A plugin that genuinely needs to attach
       * should ask for that point by name.
       */
    },
    {
      id: AMBERXVID_MESSENGER_ACTION_POINT,
      title: "Message action",
      description:
        "An action offered on one message in a conversation, drawn as an icon button that appears " +
        "on the bubble under the pointer. The contribution supplies `id`, `label`, a pack " +
        "`glyph`, an optional `appliesTo(message)` predicate and `run(message, host)`; the " +
        "message facts are id, thread, author, text, timestamp and whether it is the viewer's " +
        "own, and the host offers `notify` and `compose` (put text in the draft). Plain " +
        "functions and no component, so a bubble costs no lazy boundary.",
      kind: "command",
      cardinality: "many",
      ordering: "priority",
      requires: ["id", "label", "run"]
      /**
       * **Consumer: the module's own *Copy text*** — and the move was a repair
       * rather than a refactor.
       *
       * That action already existed in `Messenger.tsx` as an inline
       * `openCtx(e, …, [{ label: "Copy text", … }])` on every bubble. `openCtx`
       * is the PORT'S STUB (`kit/ax.tsx` — an explicit no-op), so the row had
       * been dead since the import: right-clicking a message ran the declared
       * `amberxvid.message` map, and this second, invisible menu was never
       * reachable by anybody. Moving it onto the point deleted the dead call
       * site and turned the action into a live affordance in one edit.
       *
       * ## Why this is not a second context menu
       *
       * The obvious objection is that `ctx.item` already lets a plugin put a row
       * on the `amberxvid.message` area, so a second action point is a second
       * way to do one thing. It is not, and the difference is the surface: a
       * context menu is a right-click a member has to know is there, and this is
       * a visible control on the bubble they are already pointing at. The two
       * audiences are "somebody looking for more" and "somebody who has not
       * thought about it". Rows that suit a menu should still go through
       * `ctx.item`; this is for the one or two actions worth the pixels.
       */
    },

    /* ── the live rooms ───────────────────────────────────────────────────── */

    {
      id: AMBERXVID_STREAM_TOOL_POINT,
      title: "Stream room control",
      description:
        "A control in the stream room's control bar, beside the recording toggles and Leave / End " +
        "stream. The contribution supplies `id`, `title`, a pack `glyph`, an `audience` of " +
        "`host` | `viewer` | `both` (default `both`) and a `load` thunk importing a component " +
        "handed a StreamToolHost: the stream's id, host, title, the viewer's own name, whether " +
        "they are the one broadcasting, the live follow state, `setFollow` and `notify`. " +
        "`audience` is declared rather than left to the component because a control that renders " +
        "and then decides it does not apply has already taken the space.",
      kind: "ui-surface",
      cardinality: "many",
      ordering: "priority",
      requires: ["id", "title", "glyph", "load"]
      /**
       * **Consumer: the module's own *Follow* control** (`FollowTool.tsx`),
       * moved off the identity row.
       *
       * It is the right piece to move because it is the one control on that page
       * that is genuinely OPTIONAL to the act of watching — a stream plays
       * whether or not anybody can follow the host, and every other button in
       * the bar is either the recording or the door. It also exercises the whole
       * payload: it is `audience: "viewer"`, it is a toggle over live state, and
       * it needs `setFollow`, so a host that failed to carry any one of those
       * fields would be caught by the first contribution rather than the first
       * plugin.
       *
       * Moving it also fixed a small honesty problem: the identity row is the
       * page's SUBJECT (the person broadcasting), and a control mixed into it
       * read as part of the subject rather than as something the viewer does.
       * The follower count stays on the identity row, where it is a fact about
       * the host; the button is now in the bar with the other things the viewer
       * can press.
       */
    },
    {
      id: AMBERXVID_ROOM_TILE_BADGE_POINT,
      title: "Room tile badge",
      description:
        "An overlay badge on a participant tile in the group room's grid, drawn in the tile's " +
        "name strip. The contribution is pure DATA — `id`, a pack `glyph`, an optional `tone` " +
        "(accent | ok | warn | err | dim) and `appliesTo(tile)` returning the badge's label for " +
        "THIS participant or null for 'not on this one'. The host draws it; the contribution " +
        "never returns a component and never returns an element. Tile facts are the roster's: " +
        "user, display name, role, whether it is you, speaking, mic muted, camera off.",
      kind: "value",
      cardinality: "many",
      ordering: "priority",
      requires: ["id", "glyph", "appliesTo"]
      /**
       * **Consumer: the module's own *host* badge**, moved off the name strip.
       *
       * It used to be the string `" · host"` concatenated onto the screenname
       * (and dropped entirely in compact mode, where five or more columns thin
       * the badges to icons). As a contribution it is a real badge with the
       * pack's `icon-bolt`, it survives compact mode as the icon alone, and the
       * name is once again just the name.
       *
       * ## Why this point is `value` and carries no component
       *
       * This is the one point in the array where the payload shape is a
       * performance decision, and `RoomGrid.tsx`'s own header says why: the grid
       * redraws 49 memoised tiles on every roster read, every speaking-level
       * tick and every media snapshot, and its tiles are memoised specifically
       * because a `<video>` whose element identity churns re-attaches its
       * `srcObject` — a visible black flash on a live call. A `ui-surface` point
       * here would put a `React.lazy` + `Suspense` boundary inside that path,
       * once per badge per tile, and hand arbitrary DOM to a plugin inside a
       * live video grid. `appliesTo` returns a string or null; the host draws a
       * `Glyph` and a `Typography` and nothing a contribution wrote.
       */
    },

    /* ── the module's own chrome ──────────────────────────────────────────── */

    {
      id: AMBERXVID_SETTINGS_SECTION_POINT,
      title: "Settings section",
      description:
        "A card at the foot of the module's settings stage, after the preference groups. The " +
        "contribution supplies `id`, `title`, an optional `summary` and pack `glyph`, and a " +
        "`load` thunk importing a component handed `{ notify }`. This is for a section that owns " +
        "its OWN document — a balance, a device, a licence — not for adding rows to the module's " +
        "preferences: those are declared on `settings.rows` above, where the framework dialog " +
        "and the kv store can both see them.",
      kind: "ui-surface",
      cardinality: "many",
      ordering: "priority",
      requires: ["id", "title", "load"]
      /**
       * **Consumer: the module's own *AI credits* card** (`CreditsPane`), moved
       * out of `SettingsSurface.tsx`'s hard-coded tail.
       *
       * The pane's own docblock had already argued itself onto this point
       * without the point existing: it is deliberately NOT a `PREF_GROUP`,
       * because those are keys in one of the three settings stores and a balance
       * is a fact about the account rather than a preference. That is exactly
       * the description above, and it was being expressed as a single hard-coded
       * `<CreditsPane />` after the group loop — one line of "and also this",
       * which is the shape a point replaces.
       *
       * It is `priority: 10` and therefore first among sections, and it still
       * renders last on the stage, after every preference group — read far more
       * often than it is changed, exactly as before.
       */
    },
    {
      id: AMBERXVID_ADMIN_TOOL_POINT,
      title: "Moderation tool",
      description:
        "A card in the AmberX Vid moderation wing inside the accounts admin suite, under a Tools " +
        "tab that appears only when something is contributed. The contribution supplies `id`, " +
        "`title`, an optional `summary` and pack `glyph`, and a `load` thunk importing a " +
        "component handed an AdminToolHost with `notify` and `reload` (re-read the wing's " +
        "snapshot after an act). A tool acts through the module's own API and writes the " +
        "accounts audit log like every other act in the wing — the host does not hand it the " +
        "snapshot, because a tool that could act on a state it was given cannot be sure that " +
        "state is still true.",
      kind: "ui-surface",
      cardinality: "many",
      ordering: "priority",
      requires: ["id", "title", "load"]
      /**
       * **Declared for plugins; no in-tree consumer.**
       *
       * The wing's five tabs — Reports, Live, Recordings, Content, Maintenance —
       * were considered and none moved. Every one of them reads a slice of the
       * ONE snapshot the wing fetches and hands acts back to the ONE
       * `ReasonDialog` that makes a moderator type a reason before anything is
       * written to the audit log. Moving a tab onto this point would mean either
       * handing contributions that dialog (so a plugin decides what a reason is)
       * or letting them act without it (so a plugin can moderate without one).
       * Neither is a trade worth making to demonstrate a point renders.
       *
       * So the Tools tab renders from the registry and is absent when the
       * registry is empty, which is today. A moderation tool arriving as a
       * plugin gets a first-class home; the wing's own five stay where a
       * moderator already knows to find them.
       */
    }
  ]
};
