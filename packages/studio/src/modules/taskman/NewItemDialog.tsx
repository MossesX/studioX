/**
 * @file The ADD-ITEM dialog — GizmoX's note-capture prompt, ported.
 *
 * Owner, 2026-08-13: *"import the add new tasklist item dialog from gizmox if
 * its not already and anytime i type in claude .newtask. open the dialog with
 * text follows already entered in"*.
 *
 * GizmoX's original is `src/modules/tasks/NoteCaptureOverlay.tsx`, and what
 * made it worth importing rather than re-inventing is the thing most capture
 * prompts get wrong: it does not ask for "a note title" and file the rest
 * blindly. It renders **TaskFlow's own `ItemFields`** — type, action, category,
 * priority, colour, due, notes — so the capture is a fully-formed item, and the
 * prompt cannot drift from the detail pane it mirrors. That property survives
 * the port because AmberX already has `ItemFields` from the same source.
 *
 * The list picker came with it, and it is the second reason: a capture that
 * always lands in one place is a capture you then have to go and move. Three
 * choices, in the order the original had them — the default list (created if it
 * is not there yet), a brand-new list you name, or any list you already keep.
 *
 * ── what is NOT here ─────────────────────────────────────────────────────────
 *
 * The desktop inbox drain, the settings-driven list names, the toast and the
 * `openAfterSave` router push. `capture.ts` records why for the first two. The
 * toast is `workspaceUi`'s in this app and belongs to the Claude workspace, not
 * to a dialog that can be opened from anywhere; the dialog closes on save,
 * which is the acknowledgement.
 *
 * ── mounting ────────────────────────────────────────────────────────────────
 *
 * Mounted ONCE by `StudioShell`, beside `BmpxSync`, and renders `null` until
 * the event fires — the same overlay contract the GizmoX original observes.
 * That is what makes `.newtask.` work from the Claude workspace: the trigger is
 * on a route that has nothing to do with the Task Manager, and the dialog is
 * already there.
 */
"use client";

import * as React from "react";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import ItemFields, { type ItemFieldsValue } from "./ItemFields";
import {
  DEFAULT_LIST_NAMES,
  LIST_NAME_MAX,
  NEW_ITEM_EVENT,
  asListKind,
  captureListKind,
  cleanListName,
  cleanTitle,
  defaultTitle,
  listRef,
  pickCaptureList,
  type CaptureListKind,
  type NewItemDetail
} from "./capture";
import { insertItem, newItem, newList, TYPE_ICONS } from "./taskOps";
import { taskStore, useTaskState } from "./store";
import type { TaskItem, TaskList } from "./types";

/**
 * "No list matched — make the default one on save", as a real value rather
 * than `""`: MUI renders an empty Select value as a zero-width space, so the
 * create-it row was invisible exactly when it was the one that applied. That
 * bug was found and fixed in GizmoX; the constant is what carries the fix.
 */
const CREATE_DEFAULT = "__create__";
/** "Make a list I am about to name" — distinct from {@link CREATE_DEFAULT}. */
const NEW_LIST = "__new__";

/** A fresh draft wearing the captured text. */
function draftFrom(text: string): ItemFieldsValue {
  return {
    title: defaultTitle(text),
    // The capture is the BODY as well as the title: a one-line capture reads
    // as a title with the same line beneath it, which is redundant but honest,
    // and a pasted paragraph keeps every word it arrived with.
    notes: text,
    type: "task",
    action: "none",
    category: "",
    color: "orange",
    icon: TYPE_ICONS.task,
    priority: 0,
    done: false
  };
}

export default function NewItemDialog() {
  const { lists } = useTaskState();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ItemFieldsValue>(() => draftFrom(""));
  const [listId, setListId] = React.useState<string>(CREATE_DEFAULT);
  const [newListName, setNewListName] = React.useState("");
  /** Cleared the moment the reader picks a list themselves, so changing the
   *  type stops re-routing the capture out from under them. */
  const [listPinned, setListPinned] = React.useState(false);

  /** `open` as a ref, for the drain: its effect runs once and must not be torn
   *  down and rebuilt every time the dialog opens or closes. */
  const openRef = React.useRef(open);
  openRef.current = open;

  // The listener must not be rebuilt on every keystroke and must not read a
  // stale list set when it fires — the same ref dance the original does.
  const listsRef = React.useRef<TaskList[]>(lists);
  listsRef.current = lists;

  const nameFor = (type: string): string => DEFAULT_LIST_NAMES[captureListKind(type)];

  const routeFor = React.useCallback((all: TaskList[], type: string): string => {
    const kind = captureListKind(type);
    const choice = pickCaptureList(all.map(listRef), DEFAULT_LIST_NAMES[kind], kind);
    return "existing" in choice ? choice.existing : CREATE_DEFAULT;
  }, []);

  /** Open the dialog on a capture, wherever it came from. */
  const show = React.useCallback(
    (text: string, title?: string) => {
      const next = draftFrom(text);
      setDraft(title?.trim() ? { ...next, title: title.trim() } : next);
      setListPinned(false);
      setNewListName("");
      setListId(routeFor(listsRef.current, next.type));
      setOpen(true);
    },
    [routeFor]
  );
  const showRef = React.useRef(show);
  showRef.current = show;

  React.useEffect(() => {
    const onCapture = (event: Event) => {
      const detail = (event as CustomEvent<NewItemDetail>).detail;
      showRef.current(detail?.text ?? "");
    };
    window.addEventListener(NEW_ITEM_EVENT, onCapture);
    return () => window.removeEventListener(NEW_ITEM_EVENT, onCapture);
  }, []);

  /* ------------------------------- the inbox ------------------------------ */

  /**
   * Drain captures parked by something with no browser — today, the agent in
   * Claude Code answering `.newtask.` (see `app/api/tasks/inbox`).
   *
   * On mount, on focus, and when the tab is looked at again. Two listeners
   * rather than one behind a `visibilityState` test, and that is deliberate:
   * a window can hold focus while the browser still reports it hidden (a
   * background pane, an embedded host), and that guard then swallows the one
   * event that means "the user is looking at this". `visibilitychange` is the
   * only one that has to check, because it fires on the way out as well.
   *
   * The dialog shows ONE capture — the newest. Opening four dialogs in a row
   * for four queued captures is not a queue being drained, it is an app taking
   * the screen hostage; the older ones are dropped by the GET that took them,
   * which is the honest cost of "a capture is delivered once".
   */
  React.useEffect(() => {
    let alive = true;
    const drain = async () => {
      try {
        const res = await fetch("/api/tasks/inbox", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const body = (await res.json()) as {
          captures?: { text?: string; title?: string }[];
        };
        const newest = body.captures?.at(-1);
        // `!newest`, never `!newest.text`: an EMPTY capture is a real one — a
        // bare `.newtask.` means "open the dialog, I will type in it", exactly
        // as it does in the composer. Testing the text instead of the capture
        // silently dropped that case.
        //
        // Never over an open dialog either: the reader is mid-capture, and
        // replacing what they are typing with something that arrived from
        // elsewhere is the worst thing this drain could do. Nothing is lost by
        // waiting — the read is idempotent, so the capture is still queued and
        // the next focus after this dialog closes will show it.
        if (!newest || openRef.current) return;
        showRef.current(newest.text ?? "", newest.title);
        // ACKNOWLEDGE only now, with the text on screen. Before this the queue
        // was cleared by the read itself, and a StrictMode remount threw the
        // dialog's state away between the two — the capture was consumed and
        // never shown. See the route's docblock.
        void fetch("/api/tasks/inbox", { method: "DELETE" }).catch(() => {});
      } catch {
        /* the app serves this route — a miss means the next look picks it up */
      }
    };

    void drain();
    const onFocus = () => void drain();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void drain();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /** Field edits. Retyping re-routes the capture unless a list was chosen. */
  const patch = React.useCallback(
    (p: Partial<TaskItem>) => {
      setDraft((d) => ({ ...d, ...p }) as ItemFieldsValue);
      if (p.type && !listPinned) setListId(routeFor(listsRef.current, p.type));
    },
    [listPinned, routeFor]
  );

  const save = React.useCallback(() => {
    const title = cleanTitle(draft.title, draft.notes);
    const kind: CaptureListKind = captureListKind(draft.type);
    // A name typed into "New list…" is EXACT — it makes that list rather than
    // falling into whatever list of the same kind happens to exist. Blank there
    // just means the default name.
    const naming = listId === NEW_LIST;
    const wanted = (naming && cleanListName(newListName)) || DEFAULT_LIST_NAMES[kind];

    taskStore.setLists((all) => {
      let next = all;
      let target = !naming && all.some((l) => l.id === listId) ? listId : "";
      if (!target) {
        const choice = pickCaptureList(next.map(listRef), wanted, kind, { exact: naming });
        if ("existing" in choice) {
          target = choice.existing;
        } else {
          const created = newList({ ...choice.create, kind: asListKind(choice.create.kind) });
          next = [...next, created];
          target = created.id;
        }
      }
      return insertItem(
        next,
        newItem({ ...draft, title, source: { module: "taskman", ref: "capture" } }),
        { listId: target, parentId: null, index: -1 }
      );
    });
    setOpen(false);
  }, [draft, listId, newListName]);

  if (!open) return null; // overlay contract: nothing on screen while idle

  const wantedName = nameFor(draft.type);
  const duplicate =
    cleanListName(newListName) &&
    lists.some(
      (l) => cleanListName(l.name).toLowerCase() === cleanListName(newListName).toLowerCase()
    );

  return (
    <Dialog open onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          fontFamily: token("mono"),
          fontSize: 12,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: token("dim"),
          pb: 1
        }}
      >
        New task item
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.4} sx={{ pt: 0.5 }}>
          <ItemFields
            value={draft}
            onChange={patch}
            heading="Capture"
            autoFocusTitle
            onSubmit={save}
            notesRows={6}
          />
          <TextField
            select
            label="List"
            size="small"
            fullWidth
            value={listId}
            onChange={(e) => {
              setListId(e.target.value);
              setListPinned(true);
            }}
            helperText="Enter in the title saves."
          >
            <MenuItem value={CREATE_DEFAULT}>{wantedName} — create it</MenuItem>
            <MenuItem value={NEW_LIST} sx={{ color: token("accent") }}>
              ＋ New list…
            </MenuItem>
            {lists.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </TextField>
          {listId === NEW_LIST ? (
            <TextField
              label="New list name"
              size="small"
              fullWidth
              autoFocus
              value={newListName}
              onChange={(e) => setNewListName(e.target.value.slice(0, LIST_NAME_MAX))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder={wantedName}
              helperText={
                // Never silently mints a second list of the same name — the
                // same rule `pickCaptureList` applies, said out loud.
                duplicate
                  ? "That list already exists — the item goes into it."
                  : `Created as a ${captureListKind(draft.type)} list. Blank uses "${wantedName}".`
              }
            />
          ) : null}
          <Typography sx={{ fontFamily: token("mono"), fontSize: 10, color: token("dim") }}>
            CAPTURED · {draft.notes.length} CHARS
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => setOpen(false)} sx={{ color: token("dim") }}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save}>
          Save {draft.type}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
