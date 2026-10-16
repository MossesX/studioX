/**
 * @file The behaviour behind Firecrawl's context-menu rows.
 *
 * The menu is DATA on `firecrawl.decl.ts`; these are the named functions its
 * rows resolve to, meeting only through the command registry — taskman's
 * arrangement, including the idempotent registration guard (a dev-server
 * remount must not throw on re-registering).
 *
 * Handlers read the click through `activeContext()`: the screens mark
 * `data-axf-workflow` / `data-axf-step` / `data-axf-dataset` on their rows
 * and the area walk harvests them into `MenuContext.data`.
 *
 * Two verbs ("run", "view") cross into React state and go through `ui.ts`'s
 * window events; everything else is a plain mutation of the module store or
 * a download through the export suite — the same functions the Data panel's
 * buttons call.
 */
import { activeContext, commands } from "@axf/core";

import {
  datasetToCsv,
  datasetToJson,
  datasetToMarkdown,
  download,
  fileStem
} from "./exporters";
import { uid } from "./id";
import {
  deleteDataset,
  deleteWorkflow,
  duplicateWorkflow,
  firecrawlStore,
  newWorkflow,
  setSteps
} from "./store";
import { requestRun, requestViewDataset } from "./ui";
import type { Dataset, Workflow, WorkflowStep } from "./types";

function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

function targetWorkflow(): Workflow | null {
  const id = ctxData().workflow ?? null;
  return firecrawlStore.getState().workflows.find((wf) => wf.id === id) ?? null;
}

function targetDataset(): Dataset | null {
  const id = ctxData().dataset ?? null;
  return firecrawlStore.getState().datasets.find((ds) => ds.id === id) ?? null;
}

/** Confirmed in the browser; a headless call (palette, test) proceeds. */
function confirmed(question: string): boolean {
  return typeof window === "undefined" || window.confirm(question);
}

let registered = false;

export function registerFirecrawlCommands(): void {
  if (registered) return;
  registered = true;

  /* ── workflow ─────────────────────────────────────────────────────── */

  commands.register({
    id: "firecrawl.workflow.run",
    title: "Run workflow",
    run: () => {
      const wf = targetWorkflow();
      if (wf) requestRun(wf.id);
    }
  });

  commands.register({
    id: "firecrawl.workflow.duplicate",
    title: "Duplicate workflow",
    run: () => {
      const wf = targetWorkflow();
      if (wf) duplicateWorkflow(wf.id);
    }
  });

  commands.register({
    id: "firecrawl.workflow.export",
    title: "Export workflow as JSON",
    run: () => {
      const wf = targetWorkflow();
      if (wf) download(`${fileStem(wf.name)}.workflow.json`, JSON.stringify(wf, null, 2), "application/json");
    }
  });

  commands.register({
    id: "firecrawl.workflow.delete",
    title: "Delete workflow",
    run: () => {
      const wf = targetWorkflow();
      if (wf && confirmed(`Delete the workflow "${wf.name}"? Its saved datasets stay.`)) {
        deleteWorkflow(wf.id);
      }
    }
  });

  /* ── step ─────────────────────────────────────────────────────────── */

  const moveStep = (delta: -1 | 1) => {
    const { workflow, step } = ctxData();
    if (!workflow || !step) return;
    setSteps(workflow, (prev) => {
      const i = prev.findIndex((s) => s.id === step);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  commands.register({
    id: "firecrawl.step.move-up",
    title: "Move step up",
    run: () => moveStep(-1)
  });

  commands.register({
    id: "firecrawl.step.move-down",
    title: "Move step down",
    run: () => moveStep(1)
  });

  commands.register({
    id: "firecrawl.step.duplicate",
    title: "Duplicate step",
    run: () => {
      const { workflow, step } = ctxData();
      if (!workflow || !step) return;
      setSteps(workflow, (prev) => {
        const i = prev.findIndex((s) => s.id === step);
        if (i < 0) return prev;
        const source = prev[i];
        const copy: WorkflowStep =
          source.kind === "loop"
            ? { ...source, id: uid("step"), steps: source.steps.map((s) => ({ ...s, id: uid("step") })) }
            : { ...source, id: uid("step") };
        return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
      });
    }
  });

  commands.register({
    id: "firecrawl.step.delete",
    title: "Delete step",
    run: () => {
      const { workflow, step } = ctxData();
      if (!workflow || !step) return;
      setSteps(workflow, (prev) => prev.filter((s) => s.id !== step));
    }
  });

  /* ── dataset ──────────────────────────────────────────────────────── */

  commands.register({
    id: "firecrawl.dataset.view",
    title: "Open dataset in Data view",
    run: () => {
      const ds = targetDataset();
      if (ds) requestViewDataset(ds.id);
    }
  });

  commands.register({
    id: "firecrawl.dataset.export-json",
    title: "Export dataset as JSON",
    run: () => {
      const ds = targetDataset();
      if (ds) download(`${fileStem(ds.name)}.json`, datasetToJson(ds), "application/json");
    }
  });

  commands.register({
    id: "firecrawl.dataset.export-md",
    title: "Export dataset as Markdown",
    run: () => {
      const ds = targetDataset();
      if (ds) download(`${fileStem(ds.name)}.md`, datasetToMarkdown(ds), "text/markdown");
    }
  });

  commands.register({
    id: "firecrawl.dataset.export-csv",
    title: "Export dataset as CSV",
    run: () => {
      const ds = targetDataset();
      if (!ds) return;
      const csv = datasetToCsv(ds);
      // No tabular shape → no download; the Data panel's CSV button says why
      // out loud, and the menu path degrades to the same honest nothing.
      if (csv !== null) download(`${fileStem(ds.name)}.csv`, csv, "text/csv");
    }
  });

  commands.register({
    id: "firecrawl.dataset.copy",
    title: "Copy dataset contents",
    run: () => {
      const ds = targetDataset();
      if (ds && typeof navigator !== "undefined") void navigator.clipboard.writeText(ds.content);
    }
  });

  commands.register({
    id: "firecrawl.dataset.delete",
    title: "Delete dataset",
    run: () => {
      const ds = targetDataset();
      if (ds && confirmed(`Delete the dataset "${ds.name}"? There is no undo.`)) {
        deleteDataset(ds.id);
      }
    }
  });

  /* ── surface ──────────────────────────────────────────────────────── */

  commands.register({
    id: "firecrawl.new-workflow",
    title: "New workflow",
    run: () => {
      newWorkflow();
    }
  });

  commands.register({
    id: "firecrawl.example",
    title: "Add example workflow",
    run: () => {
      const wf = newWorkflow("Research brief (example)");
      setSteps(wf.id, () => exampleSteps());
    }
  });

  commands.register({
    id: "firecrawl.refresh",
    title: "Refresh from disk",
    run: () => {
      void firecrawlStore.reload();
    }
  });
}

/**
 * The example pipeline — search, pick links with an analysis, loop-scrape
 * each pick, close with a synthesis. Exists so the empty screen teaches the
 * shape of the thing in one right-click; the topic is a placeholder the
 * owner edits first.
 */
function exampleSteps(): WorkflowStep[] {
  return [
    {
      id: uid("step"),
      kind: "search",
      query: "latest developments in <your topic>",
      limit: 8,
      withContent: false
    },
    {
      id: uid("step"),
      kind: "analyze",
      prompt:
        "From these search results, pick the 4 most substantive, primary-source pages. " +
        "Skip aggregators and thin listicles.",
      output: "links"
    },
    {
      id: uid("step"),
      kind: "loop",
      limit: 4,
      steps: [
        { id: uid("step"), kind: "scrape", urls: "", maxUrls: 1 },
        {
          id: uid("step"),
          kind: "analyze",
          prompt: "Summarize this page's key claims in 5 bullets, each pinned to a quote.",
          output: "text"
        }
      ]
    },
    {
      id: uid("step"),
      kind: "analyze",
      prompt:
        "Synthesize the per-page summaries into one brief: what is agreed, what is contested, " +
        "what changed recently. Cite the source URL per claim.",
      output: "text"
    }
  ];
}
