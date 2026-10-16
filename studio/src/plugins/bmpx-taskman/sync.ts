/**
 * @file Build Manager → Task Manager, the PURE half: turning `.bmpx` projects
 * into managed task lists, and deciding what is being built right now.
 *
 * No React, no fetch, no store — everything here is a function of its inputs,
 * which is what lets the ownership rules below be reasoned about and tested
 * rather than observed after the fact.
 *
 * ── the ownership rules, which are the whole design ──────────────────────────
 *
 * This engine and the person edit the SAME lists, so every field has exactly
 * one owner and the merge never guesses:
 *
 * | field                          | owner   | on every pass |
 * |--------------------------------|---------|---------------|
 * | phase / step `done`            | DISK    | rewritten — the builder is the single writer of done-flags |
 * | phase / step `title`           | DISK    | rewritten |
 * | checklist item `done`          | PERSON  | preserved |
 * | `collapsed`, `priority`, `due`, `category`, `notes`, `color` | PERSON | preserved |
 * | items the person added         | PERSON  | preserved, and ride at the end |
 * | a list whose project vanished  | PERSON  | left alone entirely |
 *
 * Ticking a build step by hand is therefore undone on the next pass, on
 * purpose: the step's truth is on disk, and a checkbox that disagrees with the
 * builder is a checkbox that lies. Checklist lines are the opposite — nothing
 * on disk tracks whether you did them — so those are yours and stay.
 *
 * ── identity ─────────────────────────────────────────────────────────────────
 *
 * Every managed row is prefixed `bmpx:` and carries `source: { module: "bmpx" }`.
 * That prefix is the ONLY thing separating "mine to rewrite" from "the person's
 * to leave alone", so it is computed in one place here and nowhere else.
 *
 * ── idempotence ──────────────────────────────────────────────────────────────
 *
 * {@link mergeProjects} returns the SAME array instance when nothing moved.
 * The store writes to localStorage on every accepted mutation, and this runs on
 * a timer — so a merge that allocated a fresh array each pass would rewrite the
 * whole document every few seconds forever, and every other reader would
 * re-render with it.
 */
import { GROUP_BUILD } from "../../modules/taskman/groups";
import { newItem, newList } from "../../modules/taskman/taskOps";
import type { TaskItem, TaskList } from "../../modules/taskman/types";

/** The shape `/api/bmpx` returns, narrowed to what this file reads. */
export interface BmpxStep {
  text: string;
  done: boolean;
  model: string;
  tok: number;
}
export interface BmpxPhase {
  n: number;
  name: string;
  status: string;
  steps: BmpxStep[];
}
export interface BmpxProject {
  file: string;
  id: string;
  name: string;
  status: string;
  amberxBound: boolean;
  modified: number;
  checklist: string[];
  phases: BmpxPhase[];
}

export const BMPX_PREFIX = "bmpx:";
export const BMPX_SOURCE = "bmpx";

export const listIdFor = (projectId: string): string => `${BMPX_PREFIX}${projectId}`;
const itemIdFor = (projectId: string, suffix: string): string =>
  `${BMPX_PREFIX}${projectId}#${suffix}`;

/** A list this engine manages — never one the person made. */
export const isManagedList = (list: TaskList): boolean => list.id.startsWith(BMPX_PREFIX);
const isManagedItem = (item: TaskItem): boolean => item.id.startsWith(BMPX_PREFIX);

/** Status → palette key. Colour carries the state at a glance in the rail. */
const STATUS_COLOR: Record<string, string> = {
  built: "green",
  done: "green",
  planned: "blue",
  queued: "amber",
  superseded: "slate",
  unreadable: "red"
};

/**
 * Rebuild one managed item from disk while keeping the person's fields.
 *
 * `prev` is whatever was in the store under this id last pass — `undefined` the
 * first time. Everything the person owns is copied off it; everything disk owns
 * is taken from `next`.
 */
function reconcile(
  prev: TaskItem | undefined,
  next: { id: string; title: string; done: boolean; type: TaskItem["type"]; color: string },
  children: TaskItem[]
): TaskItem {
  const base = prev ?? newItem({ id: next.id } as Partial<TaskItem>);
  return {
    ...base,
    id: next.id,
    title: next.title,
    done: next.done,
    type: next.type,
    color: next.color,
    children,
    // The person's, every one of them:
    collapsed: prev?.collapsed,
    priority: prev?.priority ?? 0,
    due: prev?.due,
    category: prev?.category ?? "",
    notes: prev?.notes ?? "",
    createdAt: prev?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    source: { module: BMPX_SOURCE, ref: next.id }
  };
}

/**
 * A phase's row title.
 *
 * Most real plans already NAME their phases "P0 Port the transport", so
 * prefixing the index unconditionally produced "P1 · P0 Port the transport" —
 * two different numbering schemes on one row, neither of them wrong, which is
 * worse than either alone. When the name carries its own phase number it is
 * used as written; only an unnumbered name gets the index.
 */
function phaseTitle(phase: BmpxPhase): string {
  const name = phase.name.trim();
  return /^P\d/i.test(name) ? name : `P${phase.n} · ${name}`;
}

/** Index every managed item of a list by id, at any depth. */
function indexById(items: readonly TaskItem[], into = new Map<string, TaskItem>()): Map<string, TaskItem> {
  for (const it of items) {
    into.set(it.id, it);
    indexById(it.children, into);
  }
  return into;
}

/** True when two item trees are equal in every field this engine writes. */
function itemsEqual(a: readonly TaskItem[], b: readonly TaskItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.id === y.id &&
      x.title === y.title &&
      x.done === y.done &&
      x.type === y.type &&
      x.color === y.color &&
      x.collapsed === y.collapsed &&
      x.priority === y.priority &&
      x.category === y.category &&
      x.notes === y.notes &&
      x.due === y.due &&
      itemsEqual(x.children, y.children)
    );
  });
}

/** The managed item tree for one project. */
function itemsForProject(project: BmpxProject, prevIndex: Map<string, TaskItem>): TaskItem[] {
  const color = STATUS_COLOR[project.status] ?? "orange";
  const out: TaskItem[] = [];

  for (const phase of project.phases) {
    const phaseId = itemIdFor(project.id, `p${phase.n}`);
    const steps = phase.steps.map((step, i) =>
      reconcile(
        prevIndex.get(itemIdFor(project.id, `p${phase.n}s${i}`)),
        {
          id: itemIdFor(project.id, `p${phase.n}s${i}`),
          title: step.text,
          done: step.done,
          type: "task",
          color
        },
        []
      )
    );
    // A phase is done when its steps are — derived, not read, because a phase
    // status that disagreed with its own steps would show a ticked parent over
    // unticked children.
    const phaseDone = steps.length > 0 && steps.every((s) => s.done);
    out.push(
      reconcile(
        prevIndex.get(phaseId),
        {
          id: phaseId,
          title: phaseTitle(phase),
          done: phaseDone,
          type: "milestone",
          color
        },
        steps
      )
    );
  }

  if (project.checklist.length) {
    const groupId = itemIdFor(project.id, "checklist");
    const lines = project.checklist.map((line, i) => {
      const id = itemIdFor(project.id, `c${i}`);
      const prev = prevIndex.get(id);
      return reconcile(
        prev,
        // `done` is the PERSON's here — read back off the previous pass, never
        // from disk, because nothing on disk tracks it.
        { id, title: line, done: prev?.done ?? false, type: "todo", color: "cyan" },
        []
      );
    });
    out.push(
      reconcile(
        prevIndex.get(groupId),
        {
          id: groupId,
          title: "Checklist",
          done: lines.length > 0 && lines.every((l) => l.done),
          type: "todo",
          color: "cyan"
        },
        lines
      )
    );
  }

  return out;
}

/**
 * Merge every project into `lists`.
 *
 * Returns `lists` itself when nothing changed — see the idempotence note above.
 */
export function mergeProjects(lists: TaskList[], projects: readonly BmpxProject[]): TaskList[] {
  let changed = false;
  const byId = new Map(lists.map((l) => [l.id, l]));
  const out: TaskList[] = [...lists];

  for (const project of projects) {
    const id = listIdFor(project.id);
    const prev = byId.get(id);
    const prevManaged = prev ? prev.items.filter(isManagedItem) : [];
    // Items the person added to a managed list are kept, and ride at the end.
    const theirs = prev ? prev.items.filter((it) => !isManagedItem(it)) : [];
    const managed = itemsForProject(project, indexById(prevManaged));

    const name = `BMPX · ${project.name}`;
    const color = STATUS_COLOR[project.status] ?? "orange";

    if (!prev) {
      out.push({
        ...newList({ name, kind: "project", color, icon: "rocket" }),
        id,
        // The rail's Build Manager band (2026-08-14). Owned by this engine, so
        // it is rewritten every pass alongside the name and the colour — a
        // project list dragged out of its own group would be put back, which is
        // what `TaskGroup.managedBy` warns the group menu about.
        groupId: GROUP_BUILD,
        items: managed
      });
      changed = true;
      continue;
    }
    if (
      prev.name === name &&
      prev.color === color &&
      prev.groupId === GROUP_BUILD &&
      itemsEqual(prevManaged, managed)
    ) {
      continue; // nothing moved for this project
    }
    out[out.indexOf(prev)] = {
      ...prev,
      name,
      color,
      groupId: GROUP_BUILD,
      items: [...managed, ...theirs]
    };
    changed = true;
  }

  // A project that vanished from disk leaves its list ALONE — deleting it would
  // destroy whatever the person added to it, and a missing file is more often a
  // renamed one than a deleted project.
  return changed ? out : lists;
}

/**
 * What the pulsing glow points at: the first not-done step of the first
 * not-done phase — which is the step the builder runs next, and therefore the
 * one it is running now while a run is live.
 *
 * Returns null when the project has nothing left to build, so a finished run
 * stops glowing rather than pointing at its last step forever.
 */
export function buildingItemId(project: BmpxProject): string | null {
  for (const phase of project.phases) {
    for (let i = 0; i < phase.steps.length; i++) {
      if (!phase.steps[i].done) return itemIdFor(project.id, `p${phase.n}s${i}`);
    }
  }
  return null;
}

/**
 * The project most likely to be the one running, by most-recently-written with
 * work outstanding. The caller confirms with `/api/bmpx/run` — this only picks
 * WHICH project is worth asking about, so the poll stays one request per tick
 * instead of one per project.
 */
export function likeliestRunning(projects: readonly BmpxProject[]): BmpxProject | null {
  const candidates = projects
    .filter((p) => buildingItemId(p) !== null && p.status !== "superseded")
    .sort((a, b) => b.modified - a.modified);
  return candidates[0] ?? null;
}
