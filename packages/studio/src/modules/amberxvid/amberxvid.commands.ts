/**
 * @file The behaviour behind AmberX Vid's context-menu rows (P15).
 *
 * The menus are DATA on `amberxvid.decl.ts`; this is the acting half, and the
 * two meet only through a command NAME. Neither file imports the other.
 *
 * ## Where the work actually happens
 *
 * Almost nothing here does anything itself, and that is the design. Every one
 * of these subjects already had working behaviour before this phase — the wall
 * card's delete, the album's caption dialog, the library's rename, the room
 * engine's leave — behind the confirms and dialogs those components own. A
 * command that reimplemented any of it would be a second path to the same act,
 * and a second place for the confirm to go missing. So a command resolves the
 * clicked subject through `ctxBridge.ts` and calls what the surface registered.
 * The map summons; it does not substitute.
 *
 * Two resolutions, for the two kinds of subject (see `ctxBridge.ts`):
 *
 *  - **per-instance** — `axvSubject("post", id)` finds what the mounted
 *    `PostCard` registered for that post;
 *  - **shell-owned** — `axvPlatform()` is the module shell's own factory, which
 *    is where a member row's Message / Call / Ring live because those need the
 *    messenger, the video engine and the room engine at once.
 *
 * ## How a command knows WHICH thing was right-clicked
 *
 * A `CommandHandler` takes no arguments on purpose (core `ctx/commands.ts`) — a
 * handler that took the click would be a handler only a menu could call. The
 * engine parks the resolved click in `activeContext()` and `MenuContext.data`
 * carries every `data-axf-*` harvested up the chain, innermost winning. The
 * screens mark `data-axf-post="…"`, `data-axf-member="…"` and friends; these
 * read them back.
 *
 * A command must also work when it is fired WITHOUT a click — from a palette or
 * a hotkey. Every one below therefore resolves to null and does nothing rather
 * than guessing a subject: acting on the first post on screen because nobody
 * pointed at one is worse than not acting.
 *
 * ## Predicates: presence over greying
 *
 * Most gates here are `when` (the row is absent), not `enabledWhen` (greyed
 * with a reason). The decl's header says why: a greyed *Delete post* on
 * somebody else's post tells a reader they were refused something that was
 * never theirs. The exception is `amberxvid.member.online`, where the row IS
 * yours and just cannot run now — that one greys and says so.
 *
 * A predicate returns `true`, or the REASON it does not hold — there is no
 * bare `false` in this engine (core `ctx/predicates.ts`). For a `when` the
 * string is never drawn, but it is the honest answer an inspector can ask for.
 *
 * ## Two shapes that are load-bearing and look like boilerplate
 *
 * Every `commands.register` and `predicates.register` below is written out with
 * an INLINE string id, and none of them is built by a helper. That is not
 * style: `test/ctx-conformance.test.ts` reads those literals out of this file's
 * SOURCE to learn which names a menu may legally reference. A helper that
 * assembled `{ id, title, run }` from variables would make every command in
 * this module invisible to the gate, and the gate would then certify the decl
 * against an empty set — a green check that is wrong.
 *
 * ## Ordering
 *
 * Registration is idempotent and must run BEFORE
 * `registerModuleMenus(AMBERXVID_DECL)` — the map's gate refuses an item naming
 * an unregistered command or predicate, which is what makes a typo in the decl
 * a loud boot failure rather than a dead row.
 * `test/ctx-conformance.test.ts` asserts that ordering by source index.
 */
import { activeContext, commands, predicates } from "@axf/core";
import type { MenuContext } from "@axf/core";

import {
  axvFacts,
  axvPlatform,
  axvSubject,
  lower,
  type MemberActions,
  type SurfaceActions
} from "./ctxBridge";

/* ------------------------------------------------------------------ reading */

/** The click's harvested data — `{}` when the command came from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

/** One harvested value from a predicate's own context, lowercased. */
const at = (ctx: MenuContext, key: string): string => lower(ctx.data[key] ?? "");

/** A `data-axf-*` flag, which the surfaces mark `"1"` or `"0"` and never omit. */
const flag = (ctx: MenuContext, key: string): boolean => ctx.data[key] === "1";

/** The right-clicked member's actions, from the shell's factory. */
function member(): MemberActions | null {
  const user = ctxData().member;
  const platform = axvPlatform();
  return user && platform ? platform.member(lower(user)) : null;
}

/** The suite's own actions — published by the shell once it is up. */
function suite(): SurfaceActions | null {
  return axvPlatform()?.surface ?? null;
}

let registered = false;

/** Register every AmberX Vid command and predicate. Idempotent — the taskman
 *  precedent: `CommandRegistry.register` throws on a duplicate, which is right
 *  for a real conflict and fatal under a dev-server remount. */
export function registerAmberXVidCommands(): void {
  if (registered) return;
  registered = true;

  /* ============================================================= predicates */

  /* --------------------------------- member ------------------------------- */

  if (!predicates.has("amberxvid.member.other")) {
    predicates.register({
      id: "amberxvid.member.other",
      title: "The chip is somebody else",
      test: (ctx: MenuContext) => {
        const user = at(ctx, "member");
        if (!user) return "no member was clicked";
        return user === axvFacts().me ? "that is you" : true;
      }
    });
  }

  // Availability, not presence — see the file header. The wording is the one
  // the surfaces already say by hand, so the menu and the toast agree.
  if (!predicates.has("amberxvid.member.online")) {
    predicates.register({
      id: "amberxvid.member.online",
      title: "They are in the suite",
      test: (ctx: MenuContext) => {
        const user = at(ctx, "member");
        if (!user) return "no member was clicked";
        return axvFacts().online.includes(user)
          ? true
          : "they are not in AmberX Vid — a call needs both sides here";
      }
    });
  }

  if (!predicates.has("amberxvid.member.ringable")) {
    predicates.register({
      id: "amberxvid.member.ringable",
      title: "You are in a room to ring them into",
      test: (ctx: MenuContext) => {
        const user = at(ctx, "member");
        if (!user) return "no member was clicked";
        if (user === axvFacts().me) return "that is you";
        // The server enforces "join the room before inviting anyone into it"
        // (`lib/groupRooms`); this simply does not offer what would be refused.
        return axvFacts().room ? true : "you are not in a group room";
      }
    });
  }

  if (!predicates.has("amberxvid.member.addable")) {
    predicates.register({
      id: "amberxvid.member.addable",
      title: "They are not already a buddy",
      test: (ctx: MenuContext) => {
        const user = at(ctx, "member");
        if (!user) return "no member was clicked";
        const facts = axvFacts();
        if (user === facts.me) return "that is you";
        if (facts.buddies.includes(user)) return "already a buddy";
        // Offering to befriend somebody you have blocked is offering to undo a
        // decision by a route that never mentions it.
        return facts.blocked.includes(user) ? "you have blocked them" : true;
      }
    });
  }

  if (!predicates.has("amberxvid.member.blockable")) {
    predicates.register({
      id: "amberxvid.member.blockable",
      title: "They are not already blocked",
      test: (ctx: MenuContext) => {
        const user = at(ctx, "member");
        if (!user) return "no member was clicked";
        const facts = axvFacts();
        if (user === facts.me) return "that is you";
        return facts.blocked.includes(user) ? "already blocked" : true;
      }
    });
  }

  /* ---------------------------------- post --------------------------------
   *
   * (No message predicates: the delete rows they would have gated are not
   * declared, because nothing can delete one message — see the decl's comment
   * above `"amberxvid.message"`.)
   */

  if (!predicates.has("amberxvid.post.mine")) {
    predicates.register({
      id: "amberxvid.post.mine",
      title: "You wrote the post",
      test: (ctx: MenuContext) => {
        const author = at(ctx, "postAuthor");
        if (!author) return "no post was clicked";
        return author === axvFacts().me ? true : "somebody else wrote it";
      }
    });
  }

  if (!predicates.has("amberxvid.post.deletable")) {
    predicates.register({
      id: "amberxvid.post.deletable",
      title: "Yours, or you moderate",
      test: (ctx: MenuContext) => {
        const author = at(ctx, "postAuthor");
        if (!author) return "no post was clicked";
        if (author === axvFacts().me) return true;
        // `lib/wall.ts` decides the same thing server-side, for the same
        // people. This row exists so a moderator is not made to guess.
        return axvFacts().moderator ? true : "only the author or a moderator may delete a post";
      }
    });
  }

  if (!predicates.has("amberxvid.post.reportable")) {
    predicates.register({
      id: "amberxvid.post.reportable",
      title: "Not your own post",
      test: (ctx: MenuContext) => {
        const author = at(ctx, "postAuthor");
        if (!author) return "no post was clicked";
        return author === axvFacts().me ? "it is your own post" : true;
      }
    });
  }

  /* --------------------------------- photo -------------------------------- */

  /**
   * The ALBUM's owner, not the uploader: an album is one person's, and
   * `lib/albums.ts` gives its owner the caption, the cover and the delete.
   *
   * Or a moderator — and getting that second half right matters more than it
   * looks. `Albums.tsx`'s own `mayEditAlbum` is `owner || isAdmin` and so is
   * the server's rule, so a predicate that asked only about ownership would
   * take three rows away from an administrator who has them on the same screen
   * today. A menu that is STRICTER than the surface it sits on is as wrong as
   * one that is looser; it just fails quietly instead of loudly.
   */
  if (!predicates.has("amberxvid.photo.editable")) {
    predicates.register({
      id: "amberxvid.photo.editable",
      title: "Your album, or you moderate",
      test: (ctx: MenuContext) => {
        const owner = at(ctx, "photoOwner");
        if (!owner) return "no photo was clicked";
        if (owner === axvFacts().me) return true;
        return axvFacts().moderator ? true : "it is somebody else's album";
      }
    });
  }

  /* -------------------------------- stream -------------------------------- */

  if (!predicates.has("amberxvid.stream.mine")) {
    predicates.register({
      id: "amberxvid.stream.mine",
      title: "You are the host",
      test: (ctx: MenuContext) => {
        const host = at(ctx, "streamHost");
        if (!host) return "no stream was clicked";
        return host === axvFacts().me ? true : "somebody else is hosting";
      }
    });
  }

  if (!predicates.has("amberxvid.stream.other")) {
    predicates.register({
      id: "amberxvid.stream.other",
      title: "Somebody else is hosting",
      test: (ctx: MenuContext) => {
        const host = at(ctx, "streamHost");
        if (!host) return "no stream was clicked";
        return host === axvFacts().me ? "it is your own broadcast" : true;
      }
    });
  }

  // Both of these are DOM facts: the card that draws the stream already knows
  // them, so marking them is current by construction and costs no store.
  if (!predicates.has("amberxvid.stream.following")) {
    predicates.register({
      id: "amberxvid.stream.following",
      title: "You follow the host",
      test: (ctx: MenuContext) =>
        flag(ctx, "streamFollowing") ? true : "you do not follow them"
    });
  }

  if (!predicates.has("amberxvid.stream.recording")) {
    predicates.register({
      id: "amberxvid.stream.recording",
      title: "The broadcast is being recorded",
      test: (ctx: MenuContext) =>
        flag(ctx, "streamRecording") ? true : "this broadcast is not being recorded"
    });
  }

  /* --------------------------------- room --------------------------------- */

  /**
   * Four conditions, and the last is the interesting one.
   *
   * A room CARD in the list has no participant under the pointer and no engine
   * to remove one with; the live room's grid has both. Asking the registered
   * subject whether it offers the capability is what keeps this row off the
   * card without declaring a second area for one row.
   */
  if (!predicates.has("amberxvid.room.removable")) {
    predicates.register({
      id: "amberxvid.room.removable",
      title: "You host, and a participant is under the pointer",
      test: (ctx: MenuContext) => {
        const room = ctx.data.room;
        const user = at(ctx, "roomUser");
        if (!room) return "no room was clicked";
        if (!user) return "no participant was clicked";
        if (user === axvFacts().me) return "that is you — leave the room instead";
        if (at(ctx, "roomHost") !== axvFacts().me) return "only the room's host may remove somebody";
        return axvSubject("room", room)?.removeParticipant
          ? true
          : "this surface cannot remove anybody";
      }
    });
  }

  /* -------------------------------- history ------------------------------- */

  // There is a person on the other end of it — true of a call, false of a
  // broadcast, which is what keeps the two ringing rows off the stream history.
  if (!predicates.has("amberxvid.history.callable")) {
    predicates.register({
      id: "amberxvid.history.callable",
      title: "The entry has somebody to call",
      test: (ctx: MenuContext) =>
        at(ctx, "callPeer") ? true : "that entry has nobody on the other end of it"
    });
  }

  if (!predicates.has("amberxvid.history.recorded")) {
    predicates.register({
      id: "amberxvid.history.recorded",
      title: "The entry has a recording",
      test: (ctx: MenuContext) => (flag(ctx, "callRecording") ? true : "nothing was recorded")
    });
  }

  /* ------------------------------- recording ------------------------------ */

  // Rename and *Show it on my profile* are the OWNER's — the library offers
  // rename to nobody else, and somebody else's capture is not on your profile.
  if (!predicates.has("amberxvid.recording.mine")) {
    predicates.register({
      id: "amberxvid.recording.mine",
      title: "It is your capture",
      test: (ctx: MenuContext) => {
        const owner = at(ctx, "recordingOwner");
        if (!owner) return "no recording was clicked";
        return owner === axvFacts().me ? true : "somebody else captured it";
      }
    });
  }

  // Delete is wider, and separately declared for that reason: `Library.tsx`'s
  // `canDelete` is `isMine || isAdmin` while its `isMine` gates rename alone.
  // One predicate over both rows would have to pick one of those two answers
  // and be wrong about the other.
  if (!predicates.has("amberxvid.recording.deletable")) {
    predicates.register({
      id: "amberxvid.recording.deletable",
      title: "Yours, or you moderate",
      test: (ctx: MenuContext) => {
        const owner = at(ctx, "recordingOwner");
        if (!owner) return "no recording was clicked";
        if (owner === axvFacts().me) return true;
        return axvFacts().moderator ? true : "somebody else captured it";
      }
    });
  }

  /* =============================================================== commands */

  /* --------------------------------- member ------------------------------- */

  commands.register({
    id: "amberxvid.member.profile",
    title: "View profile",
    run: () => member()?.viewProfile()
  });

  commands.register({
    id: "amberxvid.member.message",
    title: "Message member",
    run: () => member()?.message()
  });

  commands.register({
    id: "amberxvid.member.call",
    title: "Video call member",
    run: () => member()?.call()
  });

  commands.register({
    id: "amberxvid.member.invite",
    title: "Invite member to my room",
    run: () => member()?.inviteToRoom()
  });

  commands.register({
    id: "amberxvid.member.add-buddy",
    title: "Add buddy",
    run: () => member()?.addBuddy()
  });

  // The confirm lives in the shell's own action, with the sentence that
  // explains a block is silent and one-sided. This row summons it.
  commands.register({
    id: "amberxvid.member.block",
    title: "Block member",
    run: () => member()?.block()
  });

  /* -------------------------------- message ------------------------------- */

  commands.register({
    id: "amberxvid.message.reply",
    title: "Reply to message",
    run: () => axvSubject("message", ctxData().message ?? "")?.reply()
  });

  commands.register({
    id: "amberxvid.message.copy",
    title: "Copy message text",
    run: () => axvSubject("message", ctxData().message ?? "")?.copy()
  });

  /* ---------------------------------- post -------------------------------- */

  commands.register({
    id: "amberxvid.post.react",
    title: "Like or unlike the post",
    run: () => axvSubject("post", ctxData().post ?? "")?.react()
  });

  commands.register({
    id: "amberxvid.post.comment",
    title: "Comment on the post",
    run: () => axvSubject("post", ctxData().post ?? "")?.comment()
  });

  commands.register({
    id: "amberxvid.post.copy-link",
    title: "Copy a link to the post",
    run: () => axvSubject("post", ctxData().post ?? "")?.copyLink()
  });

  commands.register({
    id: "amberxvid.post.edit",
    title: "Edit the post",
    run: () => axvSubject("post", ctxData().post ?? "")?.edit()
  });

  commands.register({
    id: "amberxvid.post.delete",
    title: "Delete the post",
    run: () => axvSubject("post", ctxData().post ?? "")?.remove()
  });

  commands.register({
    id: "amberxvid.post.report",
    title: "Report the post to moderators",
    run: () => axvSubject("post", ctxData().post ?? "")?.report()
  });

  /* --------------------------------- photo -------------------------------- */

  commands.register({
    id: "amberxvid.photo.open",
    title: "Open the photo",
    run: () => axvSubject("photo", ctxData().photo ?? "")?.open()
  });

  commands.register({
    id: "amberxvid.photo.share",
    title: "Share the photo to a message",
    run: () => axvSubject("photo", ctxData().photo ?? "")?.share()
  });

  commands.register({
    id: "amberxvid.photo.caption",
    title: "Caption the photo",
    run: () => axvSubject("photo", ctxData().photo ?? "")?.caption()
  });

  commands.register({
    id: "amberxvid.photo.set-cover",
    title: "Set the photo as the album cover",
    run: () => axvSubject("photo", ctxData().photo ?? "")?.setCover()
  });

  commands.register({
    id: "amberxvid.photo.delete",
    title: "Delete the photo",
    run: () => axvSubject("photo", ctxData().photo ?? "")?.remove()
  });

  /* -------------------------------- stream -------------------------------- */

  commands.register({
    id: "amberxvid.stream.join",
    title: "Join the stream",
    run: () => axvSubject("stream", ctxData().stream ?? "")?.join()
  });

  commands.register({
    id: "amberxvid.stream.follow",
    title: "Follow or unfollow the host",
    run: () => axvSubject("stream", ctxData().stream ?? "")?.toggleFollow()
  });

  commands.register({
    id: "amberxvid.stream.copy-link",
    title: "Copy the stream's invite link",
    run: () => axvSubject("stream", ctxData().stream ?? "")?.copyLink()
  });

  commands.register({
    id: "amberxvid.stream.record",
    title: "Record the broadcast",
    run: () => axvSubject("stream", ctxData().stream ?? "")?.toggleRecording()
  });

  commands.register({
    id: "amberxvid.stream.end",
    title: "End the stream",
    run: () => axvSubject("stream", ctxData().stream ?? "")?.end()
  });

  /* --------------------------------- room --------------------------------- */

  commands.register({
    id: "amberxvid.room.join",
    title: "Join the room",
    run: () => axvSubject("room", ctxData().room ?? "")?.join()
  });

  commands.register({
    id: "amberxvid.room.remove",
    title: "Remove from the room",
    run: () => {
      const data = ctxData();
      const room = data.room;
      const user = data.roomUser;
      if (!room || !user) return;
      // The predicate already proved the capability exists; asking again costs
      // nothing and keeps the command safe when fired from a palette, where no
      // predicate ran at all.
      axvSubject("room", room)?.removeParticipant?.(user);
    }
  });

  /* -------------------------------- history ------------------------------- */

  commands.register({
    id: "amberxvid.history.call-back",
    title: "Call back",
    run: () => axvSubject("history", ctxData().call ?? "")?.callBack()
  });

  commands.register({
    id: "amberxvid.history.thread",
    title: "Open the conversation",
    run: () => axvSubject("history", ctxData().call ?? "")?.openThread()
  });

  commands.register({
    id: "amberxvid.history.recording",
    title: "Open the call's recording",
    run: () => axvSubject("history", ctxData().call ?? "")?.openRecording()
  });

  /* ------------------------------- recording ------------------------------ */

  commands.register({
    id: "amberxvid.recording.play",
    title: "Play the recording",
    run: () => axvSubject("recording", ctxData().recording ?? "")?.play()
  });

  commands.register({
    id: "amberxvid.recording.show-in-profile",
    title: "Show the recording on my profile",
    run: () => axvSubject("recording", ctxData().recording ?? "")?.showInProfile()
  });

  commands.register({
    id: "amberxvid.recording.rename",
    title: "Rename the recording",
    run: () => axvSubject("recording", ctxData().recording ?? "")?.rename()
  });

  commands.register({
    id: "amberxvid.recording.delete",
    title: "Delete the recording",
    run: () => axvSubject("recording", ctxData().recording ?? "")?.remove()
  });

  /* -------------------------------- surface ------------------------------- */

  commands.register({
    id: "amberxvid.surface.new-room",
    title: "New group room",
    run: () => suite()?.newRoom()
  });

  commands.register({
    id: "amberxvid.surface.go-live",
    title: "Go live",
    run: () => suite()?.goLive()
  });

  commands.register({
    id: "amberxvid.surface.new-post",
    title: "New wall post",
    run: () => suite()?.newPost()
  });

  commands.register({
    id: "amberxvid.surface.settings",
    title: "Camera & microphone settings",
    run: () => suite()?.openVideoSettings()
  });
}
