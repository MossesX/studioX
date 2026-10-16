"use client";

/**
 * @file The seam between AmberX Vid's DECLARED context menus and the surfaces
 * that actually do the work (P15).
 *
 * The AmberX menu contract is *"behaviour lives in `<id>.commands.ts` behind
 * command NAMES … no inline closures in a menu item, ever"*. A command is
 * therefore a plain function: no props, no hooks, no refs, no way to open the
 * album's caption dialog or run the wall card's own delete. This file is how it
 * reaches them, and it has exactly two halves because the module has exactly
 * two kinds of subject.
 *
 * ## 1. Per-instance subjects — the REGISTRY
 *
 * A wall post, an album photo, a chat bubble, a stream card, a library row: the
 * behaviour for these already exists, inside the component that draws them,
 * *behind the confirms and dialogs that component owns*. The menu's job is to
 * summon that, never to reimplement it — a second delete path is a second place
 * for the confirm to be forgotten.
 *
 * So each surface registers its actions under the subject's id
 * ({@link useAxvSubject}), marks the same id in the DOM (`data-axf-photo="…"`),
 * and the command looks the pair up. The component keeps the confirm; the decl
 * keeps the row; the command name is the whole of the coupling.
 *
 * ## 2. Shell-owned subjects — the PLATFORM
 *
 * A member chip has no component of its own worth speaking of, and what its
 * rows do — open a chat, place a call, ring somebody into the room you are
 * sitting in — needs the messenger, the video engine and the room engine, all
 * of which live in the module shell. Threading a factory through six screens is
 * what `userMenu.tsx` already does, and doing it a second time for the declared
 * map would double the wiring rather than replace it. The shell publishes one
 * factory here instead ({@link publishAxvPlatform}); every member surface only
 * has to mark the DOM.
 *
 * ## The FACTS store, and why it is not the DOM
 *
 * Predicates are synchronous and take a `MenuContext`, so anything they judge
 * has to be readable at click time. Two sources, and the split is deliberate:
 *
 *  - **the DOM**, for what the surface drawing the row already knows — whose
 *    post this is, whether this stream is being recorded. Marked as
 *    `data-axf-*`, harvested up the chain by the engine, innermost winning.
 *  - **this store**, for what a surface does NOT know — the members list has no
 *    idea who your buddies are, and making it fetch them so a menu row could
 *    render is how a menu starts costing a request.
 *
 * Nothing here is a permission. Every one of these rows lands on an API that
 * re-decides server-side (`lib/policy.ts`, `lib/social.ts`, `lib/membership.ts`);
 * hiding a row the viewer cannot use is courtesy, exactly as hiding a nav row
 * is. See `.claude/rules/asset-types.md` on that distinction.
 */

import * as React from "react";

import type { ReportSubject } from "./lib/types";

/* ================================================================== the facts */

/**
 * What a predicate may ask about the VIEWER, published by the module shell.
 *
 * Deliberately small. Every field here is one a marking surface cannot answer
 * for itself; anything a surface does know goes on the element as `data-axf-*`,
 * where it is current by construction and cannot go stale behind a publish.
 */
export interface AxvFacts {
  /** The signed-in member's username, lowercased. `""` before entry. */
  readonly me: string;
  /** An amberxvid administrator — the moderator rows' gate. */
  readonly moderator: boolean;
  /** Accepted buddies, lowercased. */
  readonly buddies: readonly string[];
  /** Blocked members, lowercased. They are never told, and the row that made
   *  it that way must not offer to do it twice. */
  readonly blocked: readonly string[];
  /** Members currently in the suite — a call and a room ring both need them. */
  readonly online: readonly string[];
  /** The group room the viewer is sitting in, or null. */
  readonly room: { readonly id: string; readonly title: string; readonly hosting: boolean } | null;
}

const NO_FACTS: AxvFacts = {
  me: "",
  moderator: false,
  buddies: [],
  blocked: [],
  online: [],
  room: null
};

let facts: AxvFacts = NO_FACTS;

/** The viewer facts, for a predicate. Never null — an unpublished store simply
 *  knows nothing, and a predicate reading it says so rather than throwing. */
export const axvFacts = (): AxvFacts => facts;

/** The shell publishes on every change it makes to any of these. Cheap: the
 *  fields are compared, not the object, so a new roster array with the same
 *  names does not churn. */
export function publishAxvFacts(next: AxvFacts): void {
  if (
    next.me === facts.me &&
    next.moderator === facts.moderator &&
    next.room?.id === facts.room?.id &&
    next.room?.hosting === facts.room?.hosting &&
    same(next.buddies, facts.buddies) &&
    same(next.blocked, facts.blocked) &&
    same(next.online, facts.online)
  ) {
    return;
  }
  facts = next;
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Sign-out, or a module unmount: a stale viewer must not decide the NEXT
 *  person's rows. Same duty `resetAmberXVidViewer` has for the chrome. */
export function resetAxvFacts(): void {
  facts = NO_FACTS;
}

export const lower = (u: string): string => u.trim().toLowerCase();

/* =============================================================== the platform */

/** The rows a member chip offers, wherever it is drawn. */
export interface MemberActions {
  viewProfile(): void;
  message(): void;
  call(): void;
  /** Ring them into the room the viewer is in — only offered while there is
   *  one, which is also the only case the server accepts (`lib/groupRooms`). */
  inviteToRoom(): void;
  /** Send a buddy REQUEST. Its own surface owns whatever it says afterwards. */
  addBuddy(): void;
  /** Block, behind the shell's confirm — a block is silent and one-sided, so
   *  it is the one member action nobody should be able to do by accident. */
  block(): void;
}

/** The suite's own rows, from anywhere on the screen. */
export interface SurfaceActions {
  newRoom(): void;
  goLive(): void;
  newPost(): void;
  /**
   * The viewer's own profile — the surface whose strip lists their captures.
   *
   * It is what a library item's *Show it on my profile* row does. That row
   * REVEALS and never publishes: a member's recordings are private to them
   * (the recordings route decides that, not this menu), and there is no
   * per-recording visibility flag to flip, so a row that promised to publish
   * one would be promising something nothing implements.
   */
  openMyProfile(): void;
  /** The module's DEVICE settings (camera, microphone, ring) — not the sui,
   *  which core's universal band already offers as *Module settings*. */
  openVideoSettings(): void;
}

export interface AxvPlatform {
  /** The member menu's behaviour, for any username. */
  member(user: string): MemberActions;
  surface: SurfaceActions;
  /**
   * Open the report composer for one subject — what every *Report* row does.
   *
   * **It files into the moderation QUEUE as of P17** (`lib/reports.ts`), read
   * by the wing inside the accounts admin suite. Until then it was a DM to
   * every administrator, for the honest reason that a report filing into a
   * table nobody had built would report into nothing; the table exists, so the
   * DM path is gone rather than kept alongside — two places a report can land
   * is one place a moderator does not look.
   *
   * The caller supplies the REFERENCE (kind, owner, id, parent) and the
   * `excerpt` of what is on screen; the reason is the reporter's and is typed
   * into the composer this opens. A report with a reason the client wrote would
   * be a report nobody actually made.
   */
  report(subject: ReportSubject): void;
  /** Copy text and say so, in the module's own toast. */
  copy(text: string, said: string): void;
  /**
   * What a *Share to a message* row does: copy the thing and open the
   * messenger to paste it into.
   *
   * Not "send it" — the composer is the only place this module sends text
   * from, and a share row that sent would be a second one, with its own idea
   * of the length limit and no way to add a word before it goes.
   */
  share(text: string, said: string): void;
  /** Say something, when a command has nowhere else to land. */
  notify(message: string, detail?: string): void;
}

let platform: AxvPlatform | null = null;

/** The shell publishes once, on mount. Null before entry — every command that
 *  needs it checks, because a right-click on the splash is a real thing to do. */
export function publishAxvPlatform(next: AxvPlatform | null): void {
  platform = next;
}

export const axvPlatform = (): AxvPlatform | null => platform;

/* ================================================================ the registry */

export interface MessageActions {
  /** Quote it into the composer — the chat window owns the caret. */
  reply(): void;
  copy(): void;
  /**
   * Optional, and NOTHING implements it today — see the decl's comment above
   * `"amberxvid.message"`. The accounts messaging store has no per-message
   * delete and extending another module's contract was refused on ownership,
   * so the two rows that would call this are not declared. It is declared here
   * so that when accounts grows the operation, the seam is already the right
   * shape rather than being invented under time pressure.
   */
  remove?(): void;
}

export interface PostActions {
  react(): void;
  comment(): void;
  copyLink(): void;
  edit(): void;
  remove(): void;
  /** Composes the report text; the platform sends it. */
  report(): void;
}

export interface PhotoActions {
  open(): void;
  caption(): void;
  setCover(): void;
  /** Share the album link into a DM. */
  share(): void;
  remove(): void;
}

export interface StreamActions {
  join(): void;
  toggleFollow(): void;
  copyLink(): void;
  end(): void;
  toggleRecording(): void;
}

export interface RoomActions {
  join(): void;
  /**
   * Optional, and the row's predicate checks for it (`amberxvid.room.removable`).
   *
   * A room CARD in the list has no participants to remove and no engine to
   * remove them with; the live room's grid has both. Making the capability
   * optional and testing for it is what keeps *Remove participant* off the card
   * without a second area declaring one row.
   */
  removeParticipant?(user: string): void;
}

export interface HistoryActions {
  /** Call back, or rejoin the room the entry names. */
  callBack(): void;
  openThread(): void;
  openRecording(): void;
}

export interface RecordingActions {
  play(): void;
  rename(): void;
  remove(): void;
  /** Open it where the profile shows it — the profile strip's own door. */
  showInProfile(): void;
}

/** Every kind of subject a marked element can BE, and what it can do. */
export interface AxvSubjects {
  message: MessageActions;
  post: PostActions;
  photo: PhotoActions;
  stream: StreamActions;
  room: RoomActions;
  history: HistoryActions;
  recording: RecordingActions;
}

export type AxvSubjectKind = keyof AxvSubjects;

/**
 * The live registrations.
 *
 * A getter rather than the object, so a command always calls the CURRENT
 * closure. Registering the object itself would freeze the actions at their
 * first render, and every one of them closes over state that moves — the post's
 * text, the stream's follow state, the room's roster.
 */
type Entry = { get: () => unknown };
const registry = new Map<AxvSubjectKind, Map<string, Entry>>();

function bucket(kind: AxvSubjectKind): Map<string, Entry> {
  let map = registry.get(kind);
  if (!map) {
    map = new Map();
    registry.set(kind, map);
  }
  return map;
}

/**
 * The second way in, and the one most of this module uses.
 *
 * A hook cannot be called inside a `.map()`, and nearly every subject here is
 * drawn by one: the photos in an album's justified grid, the cards in the
 * stream hub, the rows of the library and the history, the bubbles in a
 * conversation. Wrapping each row in a registrar component to get a hook back
 * would put a component between every row and its layout — in the justified
 * grid and the paginated room that is a real cost, and in all of them it is a
 * lot of machinery to hold one closure.
 *
 * So a surface that draws MANY subjects registers one resolver for the kind
 * instead: given an id, hand back the actions or null. It reads the list it is
 * already rendering, so what it answers is current by construction.
 *
 * The direct registry above stays for the case it is right for — a component
 * that IS a single subject (`PostCard`). Asked in that order, most specific
 * first.
 */
type Resolver = { get: () => (id: string) => unknown };
const resolvers = new Map<AxvSubjectKind, Set<Resolver>>();

function resolverSet(kind: AxvSubjectKind): Set<Resolver> {
  let set = resolvers.get(kind);
  if (!set) {
    set = new Set();
    resolvers.set(kind, set);
  }
  return set;
}

/** What is registered for this subject, or null when nothing answers for it. */
export function axvSubject<K extends AxvSubjectKind>(kind: K, id: string): AxvSubjects[K] | null {
  if (!id) return null;
  const entry = registry.get(kind)?.get(id);
  if (entry) return entry.get() as AxvSubjects[K];
  for (const resolver of resolvers.get(kind) ?? []) {
    const found = resolver.get()(id);
    if (found) return found as AxvSubjects[K];
  }
  return null;
}

/**
 * Register a subject's actions for as long as this component is mounted.
 *
 * `id` may be null — a card with no subject yet registers nothing rather than
 * claiming the empty key. Two mounted components sharing one id (a photo in the
 * grid and the same photo in the lightbox) is legal and the later mount wins;
 * they are the same subject with the same actions, so which one answers does
 * not change what happens.
 */
export function useAxvSubject<K extends AxvSubjectKind>(
  kind: K,
  id: string | null,
  actions: AxvSubjects[K]
): void {
  const ref = React.useRef(actions);
  // After every render, never during one: a ref written in render is a write
  // during the render phase, and this one has no reason to be.
  React.useEffect(() => {
    ref.current = actions;
  });

  React.useEffect(() => {
    if (!id) return;
    const map = bucket(kind);
    const entry: Entry = { get: () => ref.current };
    map.set(id, entry);
    return () => {
      // Only if it is still OURS. An unmount racing a remount of the same id
      // would otherwise delete the new registration on the way out.
      if (map.get(id) === entry) map.delete(id);
    };
  }, [kind, id]);
}

/**
 * Answer for MANY subjects of one kind, for as long as this surface is mounted.
 *
 * `resolve` is called with a subject id and returns its actions, or null when
 * this surface does not draw that one — two lists of the same kind may be
 * mounted at once (an album's grid and its lightbox; the room list and the live
 * room), and each answers only for what it has.
 *
 * Same ref discipline as {@link useAxvSubject}: the resolver a command calls is
 * always the CURRENT closure, so it reads the list as it is now rather than as
 * it was on the render that registered it.
 */
export function useAxvSubjectResolver<K extends AxvSubjectKind>(
  kind: K,
  resolve: (id: string) => AxvSubjects[K] | null
): void {
  const ref = React.useRef(resolve);
  React.useEffect(() => {
    ref.current = resolve;
  });

  React.useEffect(() => {
    const set = resolverSet(kind);
    const entry: Resolver = { get: () => ref.current as (id: string) => unknown };
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }, [kind]);
}
