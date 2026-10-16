/**
 * @file The CAPTURE contract — how a new task item is asked for, from anywhere
 * in the app.
 *
 * Ported from GizmoX's `src/modules/tasks/noteCapture.ts` (owner, 2026-08-13:
 * *"import the add new tasklist item dialog from gizmox if its not already"*).
 * The parts that came over are the ones that are ABOUT the capture rather than
 * about GizmoX: the title derivation, the list-name cleaning, and — the real
 * substance — `pickCaptureList`, the single rule for where a capture lands.
 *
 * The parts deliberately left behind, so the next reader does not go looking:
 *
 *   - **the PyQt6 desktop prompt**. GizmoX's inbox exists because a Windows
 *     hotkey service captures a selection with no browser on screen. AmberX has
 *     no such service — but it turned out to have the same SHAPE of caller, so
 *     the inbox itself came over a few hours later (`app/api/tasks/inbox`, and
 *     the drain in `NewItemDialog`): the agent you are talking to in Claude
 *     Code cannot write a browser's localStorage either. Same problem, same
 *     answer, different capturer;
 *   - **the settings-driven list names** (`taskflow.noteList` / `taskflow.
 *     taskList` through the cui cascade). The Task Manager's sui is four
 *     booleans by standing directive and none of that machinery exists here, so
 *     the two names are the constants below. Making them settings is a
 *     one-field change if it is ever asked for;
 *   - **the chord itself**. GizmoX's capture is Ctrl+Alt+Shift+N. Here the
 *     trigger is typing `.newtask.` — in the app's Claude composer, or to the
 *     agent in Claude Code, which posts to the inbox. Every one of them is just
 *     a caller of {@link openNewTaskItem} or of the route that feeds it.
 *
 * PURE — no React, no store, and the only DOM it touches is `window` inside
 * {@link openNewTaskItem}, guarded. That is what lets the dialog, the composer
 * and the tests all agree on one definition of a capture.
 */
import type { ListKind, TaskList } from "./types";

/** The window event {@link openNewTaskItem} dispatches. */
export const NEW_ITEM_EVENT = "axs:taskman-new-item";

/**
 * What a composer — and the agent bridge — watches for. Owner, 2026-08-13:
 * *"anytime i type in claude .tasker. open the dialog with text follows already
 * entered in"*, respelled to `.newtask.` by the owner the same day.
 *
 * Dotted on BOTH sides on purpose — it is the owner's spelling, and it is also
 * what keeps the trigger from firing on ordinary prose: a sentence can end in
 * "…newtask." but one does not begin with it.
 *
 * ONE definition, and {@link captureFromDraft} builds its pattern from it. The
 * first cut hardcoded the spelling in the regex as well, which meant renaming
 * the trigger left a matcher answering to the old one — the composer's hint
 * would have named `.newtask.` while only `.tasker.` fired.
 */
export const CAPTURE_TRIGGER = ".newtask.";

/** Longest title derived from a capture. */
export const TITLE_MAX = 60;
/** Longest list name the dialog accepts. */
export const LIST_NAME_MAX = 60;

/** The two lists a capture can land in when it has to make one. */
export type CaptureListKind = "notes" | "tasks";

/** Default names for those two, since this app has no setting for them. */
export const DEFAULT_LIST_NAMES: Readonly<Record<CaptureListKind, string>> = {
  notes: "Notes",
  tasks: "Tasks"
};

/** A note goes to a notes list; everything else is a task. */
export function captureListKind(type: string): CaptureListKind {
  return type === "note" ? "notes" : "tasks";
}

/** The icon a list created by a capture gets. Both are contract glyph names
 *  as far as the tree is concerned — item/list icons are this module's own
 *  vocabulary, not the branding pack's. */
export function captureListIcon(kind: CaptureListKind): string {
  return kind === "notes" ? "doc" : "folder";
}

/** Trim a list name; "" when nothing usable is left. */
export function cleanListName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIST_NAME_MAX);
}

/**
 * A sensible pre-filled title for captured text: its first non-empty line,
 * collapsed and trimmed. Empty input gives "Task" so the dialog never opens
 * with a blank required field.
 */
export function defaultTitle(text: string): string {
  const first = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find(Boolean);
  if (!first) return "Task";
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trimEnd()}…` : first;
}

/** Trim a typed title, falling back rather than saving "". */
export function cleanTitle(title: string, text = ""): string {
  return String(title ?? "").trim() || defaultTitle(text);
}

/** Just enough of a `TaskList` to route a capture into it. */
export interface CaptureListRef {
  id: string;
  name: string;
  kind: string;
}

/** Land in a list that exists, or make this one. */
export type CaptureListChoice =
  | { existing: string }
  | { create: { name: string; kind: CaptureListKind; icon: string } };

/**
 * Where a capture lands — the ONE rule, shared by the dialog's save and by
 * anything else that files an item, so two callers cannot disagree about it.
 *
 * `exact` is the difference between a name the user CHOSE and a name that came
 * from a default. A chosen name that matches nothing makes that list; a default
 * name that matches nothing falls back to any list of the right kind first,
 * because silently minting a second "Tasks" beside the one you already keep
 * tasks in is the worse surprise.
 *
 * Ported verbatim in behaviour from GizmoX's `pickCaptureList`, including that
 * distinction, which is the part of it that took two attempts to get right
 * there.
 */
export function pickCaptureList(
  lists: readonly CaptureListRef[],
  wanted: string,
  kind: CaptureListKind,
  options: { exact?: boolean } = {}
): CaptureListChoice {
  const name = cleanListName(wanted);
  const target = name.toLowerCase();
  const byName = name
    ? lists.find((list) => cleanListName(list.name).toLowerCase() === target)
    : undefined;
  if (byName) return { existing: byName.id };
  if (!options.exact) {
    const byKind = lists.find((list) => list.kind === kind);
    if (byKind) return { existing: byKind.id };
  }
  return {
    create: { name: name || DEFAULT_LIST_NAMES[kind], kind, icon: captureListIcon(kind) }
  };
}

/** A capture list kind is a `ListKind` — stated once, here, rather than cast
 *  at each of the three call sites that need the widening. */
export const asListKind = (kind: CaptureListKind): ListKind => kind as ListKind;

/** Narrow a real list to what the router needs. */
export const listRef = (list: TaskList): CaptureListRef => ({
  id: list.id,
  name: list.name,
  kind: list.kind
});

/**
 * Ask for a new task item, with `text` already filled in.
 *
 * The one entry point. A caller does not need the store, the dialog or React —
 * it dispatches, and whichever surface is mounted answers. That is what lets
 * the Claude composer open the Task Manager's dialog without importing a line
 * of the Task Manager's UI.
 */
export function openNewTaskItem(text = ""): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NEW_ITEM_EVENT, { detail: { text } }));
}

/** `detail` of {@link NEW_ITEM_EVENT}. */
export interface NewItemDetail {
  text?: string;
}

/**
 * Does this draft fire the capture, and what text does it carry?
 *
 * Pure so the composer's behaviour is testable without a keyboard: the trigger
 * must be at the START of the draft (leading whitespace tolerated), and
 * everything after it — on any line — is the capture.
 *
 * Returns null when the draft is not a capture, which is every draft that does
 * not begin with the trigger.
 */
export function captureFromDraft(draft: string): string | null {
  const match = TRIGGER_RE.exec(draft);
  return match ? match[1]! : null;
}

/** Built from {@link CAPTURE_TRIGGER} so the spelling lives in one place. */
const TRIGGER_RE = new RegExp(
  `^\\s*${CAPTURE_TRIGGER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([\\s\\S]*)$`
);
