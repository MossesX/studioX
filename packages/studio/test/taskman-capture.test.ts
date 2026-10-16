/**
 * @file The capture contract — the `.newtask.` trigger and where a capture lands.
 *
 * Both halves are PURE by design (`modules/taskman/capture.ts`), and this is the
 * file that makes that pay: the trigger can be checked without a keyboard, and
 * the list router without a store, a dialog or a browser.
 *
 * The routing rules are the ones ported from GizmoX, and the `exact` half is
 * the one worth pinning: a name the person TYPED makes that list, a name that
 * merely came from a default falls into any list of the right kind first. That
 * distinction took two attempts to get right in the original, and a port that
 * quietly dropped it would file every capture into a second "Tasks" list
 * beside the one the reader already keeps tasks in.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_TRIGGER,
  captureFromDraft,
  captureListKind,
  cleanListName,
  cleanTitle,
  defaultTitle,
  pickCaptureList
} from "@axs/modules/taskman/capture";

/* ------------------------------------------------------------- the trigger */

test("the trigger fires only at the start of a draft, and carries what follows", () => {
  assert.equal(captureFromDraft(".newtask. ring the bank"), "ring the bank");
  // Leading whitespace is tolerated — a draft that begins with a stray space is
  // still a draft that begins with the trigger.
  assert.equal(captureFromDraft("   .newtask.buy milk"), "buy milk");
  // Nothing after it is the LIVE case: you type the trigger and keep going in
  // the dialog. It must open with an empty capture, not refuse to open.
  assert.equal(captureFromDraft(".newtask."), "");
  // Multiline survives — a pasted block is the whole capture, newlines and all.
  assert.equal(captureFromDraft(".newtask. one\ntwo"), "one\ntwo");
});

test("an ordinary prompt is never a capture", () => {
  assert.equal(captureFromDraft("what does .newtask. do?"), null);
  assert.equal(captureFromDraft("read src/tasker.ts"), null);
  assert.equal(captureFromDraft(""), null);
  // The exported constant and the matcher must agree, or the composer's hint
  // would name a trigger that does not fire.
  assert.equal(captureFromDraft(`${CAPTURE_TRIGGER}x`), "x");
});

/* --------------------------------------------------------------- the title */

test("a title is derived from the first non-empty line, and never blank", () => {
  assert.equal(defaultTitle("\n\n  fix the rail  \nmore"), "fix the rail");
  assert.equal(defaultTitle(""), "Task");
  assert.equal(defaultTitle("   "), "Task");
  const long = "x".repeat(200);
  assert.equal(defaultTitle(long).length, 60);
  assert.ok(defaultTitle(long).endsWith("…"));
  // A typed title wins; a blank one falls back rather than saving "".
  assert.equal(cleanTitle("  mine  ", "body"), "mine");
  assert.equal(cleanTitle("   ", "body text"), "body text");
});

/* ------------------------------------------------------------ the routing */

const LISTS = [
  { id: "l1", name: "Tasks", kind: "tasks" },
  { id: "l2", name: "Notes", kind: "notes" },
  { id: "l3", name: "Roadmap", kind: "project" }
];

test("a note goes to a notes list and everything else to a task list", () => {
  assert.equal(captureListKind("note"), "notes");
  for (const type of ["task", "todo", "bug", "idea", "milestone", "question", "link"]) {
    assert.equal(captureListKind(type), "tasks");
  }
});

test("a name that matches an existing list lands in it, whatever its kind", () => {
  assert.deepEqual(pickCaptureList(LISTS, "Roadmap", "tasks"), { existing: "l3" });
  // Case and spacing are not a different list.
  assert.deepEqual(pickCaptureList(LISTS, "  tasks ", "tasks"), { existing: "l1" });
});

test("a DEFAULT name that matches nothing falls back to any list of the kind", () => {
  const lists = [{ id: "only", name: "Inbox", kind: "tasks" }];
  assert.deepEqual(pickCaptureList(lists, "Tasks", "tasks"), { existing: "only" });
});

test("a CHOSEN name that matches nothing makes that list, and only then", () => {
  const lists = [{ id: "only", name: "Inbox", kind: "tasks" }];
  const chosen = pickCaptureList(lists, "Groceries", "tasks", { exact: true });
  assert.deepEqual(chosen, {
    create: { name: "Groceries", kind: "tasks", icon: "folder" }
  });
  // The same call WITHOUT `exact` is the fallback above — this is the
  // difference the port had to preserve.
  assert.deepEqual(pickCaptureList(lists, "Groceries", "tasks"), { existing: "only" });
});

test("with nothing to land in, the default name is minted for the kind", () => {
  assert.deepEqual(pickCaptureList([], "", "notes"), {
    create: { name: "Notes", kind: "notes", icon: "doc" }
  });
  assert.deepEqual(pickCaptureList([], "", "tasks"), {
    create: { name: "Tasks", kind: "tasks", icon: "folder" }
  });
});

test("list names are trimmed and capped, and unusable ones read as empty", () => {
  assert.equal(cleanListName("  a   b  "), "a b");
  assert.equal(cleanListName(null), "");
  assert.equal(cleanListName("y".repeat(200)).length, 60);
});
