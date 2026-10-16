/**
 * @file The seam between plain-function commands and the React screen.
 *
 * A context-menu command is a plain function (`core/commands.ts`) — it can
 * mutate the store directly, but "run this workflow" and "show me this
 * dataset" need the SCREEN: a run holds a live stream and a selection is
 * component state. Window events are the established shape for that seam in
 * this tree (taskman's `TASKMAN_REFRESH_EVENT`); the module screen listens
 * while mounted, and a command fired with no screen is a no-op rather than a
 * crash — right for a palette invocation on another route.
 */
"use client";

export const RUN_WORKFLOW_EVENT = "axs:firecrawl-run-workflow";
export const VIEW_DATASET_EVENT = "axs:firecrawl-view-dataset";

export function requestRun(workflowId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RUN_WORKFLOW_EVENT, { detail: { workflowId } }));
}

export function requestViewDataset(datasetId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VIEW_DATASET_EVENT, { detail: { datasetId } }));
}
