"use client";

/**
 * @file The PROJECT store — `axf-claude` P4's client half.
 *
 * A store rather than component state, for the three reasons every store in
 * this module is one, plus one that is specific to projects:
 *
 *   1. more than one surface reads it (the library's filter, the start dialog's
 *      selector, the header's project tag, the editor itself);
 *   2. a context-menu command is a plain function with no hooks available to
 *      it, and `claude-workspace.commands.ts` drives half of these;
 *   3. **the filter is a selection, and a selection is not a fetch.** Which
 *      project the library is filtered to has to survive the library refetching,
 *      a conversation being renamed, and the editor being opened and closed —
 *      none of which are events a component holding it in `useState` would see
 *      coming.
 *
 * ── the filter selects the DEFAULT, and that is on purpose ───────────────────
 *
 * `selectedId` does two jobs: it narrows the library, and it is what a new
 * conversation starts under. One control rather than two, because the two would
 * disagree — the state where you are looking at project A's conversations and
 * the New button quietly starts one in B is a bug you only find out about after
 * a turn has run in the wrong tree, which is the exact failure the bound
 * directory exists to end.
 *
 * It is a SESSION-scoped selection and is deliberately not persisted. A
 * remembered filter is a library that opens showing a fraction of itself with
 * no visible reason, and the reason is a control three panes away that was set
 * a week ago.
 */
import * as React from "react";

import type { KnowledgeStatus, ProjectRecord } from "../../claude/types";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  patchProject,
  type ProjectRequest
} from "./client";

export interface ProjectsState {
  readonly projects: readonly ProjectRecord[];
  /** The project the library is filtered to, and that a new conversation
   *  starts under. Null is "all conversations, no project". */
  readonly selectedId: string | null;
  /** Knowledge resolution for whichever project the editor last opened, keyed
   *  by id — so re-opening one does not flash an empty list while it refetches. */
  readonly knowledge: Readonly<Record<string, readonly KnowledgeStatus[]>>;
  readonly loading: boolean;
  readonly error: string | null;
  /** True once the first list has landed: "no projects yet" and "not loaded
   *  yet" look identical and read very differently. */
  readonly ready: boolean;
}

const EMPTY: ProjectsState = {
  projects: [],
  selectedId: null,
  knowledge: {},
  loading: false,
  error: null,
  ready: false
};

type Listener = () => void;

class ProjectsStore {
  #state: ProjectsState = EMPTY;
  #listeners = new Set<Listener>();

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): ProjectsState => this.#state;
  getServerState = (): ProjectsState => EMPTY;

  #set(patch: Partial<ProjectsState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }

  /** The selected project's record, or null. */
  selected(): ProjectRecord | null {
    const { selectedId, projects } = this.#state;
    return selectedId ? (projects.find((p) => p.id === selectedId) ?? null) : null;
  }

  byId(id: string | null | undefined): ProjectRecord | null {
    if (!id) return null;
    return this.#state.projects.find((p) => p.id === id) ?? null;
  }

  /* -------------------------------- listing --------------------------------- */

  async refresh(): Promise<void> {
    this.#set({ loading: true, error: null });
    try {
      const projects = await listProjects();
      // A selection whose project has been deleted elsewhere falls back to
      // "all" rather than silently filtering the library to nothing — an empty
      // library with no visible reason is the worst of the available states.
      const selectedId =
        this.#state.selectedId && projects.some((p) => p.id === this.#state.selectedId)
          ? this.#state.selectedId
          : null;
      this.#set({ projects, selectedId, loading: false, ready: true });
    } catch (err) {
      this.#set({
        loading: false,
        ready: true,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  select(id: string | null): void {
    if (this.#state.selectedId === id) return;
    this.#set({ selectedId: id });
  }

  /** Fold a changed record into the list without refetching — the library's
   *  `#adopt`, and the same argument: a refetch makes the row you just edited
   *  disappear and return, and hides a save that succeeded behind a fetch that
   *  did not. */
  #adopt(record: ProjectRecord): void {
    const projects = [...this.#state.projects.filter((p) => p.id !== record.id), record].sort(
      (a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt)
    );
    this.#set({ projects });
  }

  /* ------------------------------- the verbs -------------------------------- */

  async create(request: ProjectRequest): Promise<ProjectRecord> {
    const record = await createProject(request);
    this.#adopt(record);
    // A project you just created is the one you are about to work in.
    this.#set({ selectedId: record.id });
    await this.loadKnowledge(record.id);
    return record;
  }

  async save(id: string, patch: ProjectRequest): Promise<ProjectRecord> {
    const record = await patchProject(id, patch);
    this.#adopt(record);
    // The paths may have changed; the resolution readout must not go stale
    // silently, because a stale green tick is worse than no tick.
    await this.loadKnowledge(id);
    return record;
  }

  /**
   * Delete. Without `detach` the service refuses while conversations belong to
   * the project — the error carries the count, and the caller shows it.
   */
  async remove(id: string, opts: { detach?: boolean } = {}): Promise<boolean> {
    const deleted = await deleteProject(id, opts);
    if (!deleted) return false;
    const { [id]: _dropped, ...knowledge } = this.#state.knowledge;
    this.#set({
      projects: this.#state.projects.filter((p) => p.id !== id),
      selectedId: this.#state.selectedId === id ? null : this.#state.selectedId,
      knowledge
    });
    return true;
  }

  /** What this project's knowledge paths resolve to right now. Failures are
   *  kept out of `error`: a resolution readout that could not be fetched must
   *  not paint the whole editor red. */
  async loadKnowledge(id: string): Promise<void> {
    try {
      const { project, knowledge } = await getProject(id);
      this.#adopt(project);
      this.#set({ knowledge: { ...this.#state.knowledge, [id]: knowledge } });
    } catch {
      /* the editor shows the paths regardless; the ticks are the extra */
    }
  }

  knowledgeFor(id: string | null): readonly KnowledgeStatus[] {
    return (id && this.#state.knowledge[id]) || [];
  }
}

export const projects = new ProjectsStore();

export function useProjects(): ProjectsState {
  return React.useSyncExternalStore(projects.subscribe, projects.getState, projects.getServerState);
}
