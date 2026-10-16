/**
 * @file The Firecrawl module's DECLARATION — data only, importable by plain Node.
 *
 * Same hard rule as every other decl: **nothing but `import type`**.
 * `scripts/peel.mjs` and the suite resolver import this under Node's native
 * type stripping; one runtime import breaks the peel for every module at once.
 *
 * ## Why a MODULE and not a plugin (§4.6)
 *
 * It passes the first clause outright: it owns a workflow nothing else in the
 * suite owns — authoring and running multi-step web-data pipelines (search →
 * scrape → AI analysis → loop over discovered links), and the datasets those
 * runs produce. It fails the plugin test the way `forge` does: no existing
 * module declares a point that could host a pipeline builder, a run engine
 * and a dataset manager; and it coheres as a peeled standalone app — a
 * Firecrawl client is a product in its own right.
 */
import type { ModuleDecl } from "@axf/core";

export const FIRECRAWL_DECL: ModuleDecl = {
  id: "firecrawl",
  title: "Firecrawl",
  summary:
    "Web-data workbench over the Firecrawl API: multi-step workflows that search, scrape and " +
    "map the live web, hand results to Fireball Freddy for plain-english AI analysis, loop " +
    "over the links he picks, and land everything in exportable JSON/markdown datasets.",
  route: "/firecrawl",
  glyph: "icon-globe",
  /**
   * Context menus as decl data, taskman's pattern exactly: the screen marks
   * `data-axf-area` (+ `data-axf-workflow` / `data-axf-step` /
   * `data-axf-dataset` for the handlers), the rows live HERE, and the two
   * meet only through command names registered in `firecrawl.commands.ts` —
   * which must run before the menus loop reads this decl.
   */
  menus: {
    areas: [
      {
        id: "firecrawl.workflow",
        title: "Workflow",
        description: "A workflow row in the rail — the pipeline the pointer is over."
      },
      {
        id: "firecrawl.step",
        title: "Workflow step",
        description: "A step card in the builder."
      },
      {
        id: "firecrawl.dataset",
        title: "Dataset",
        description: "A saved dataset row in the rail."
      },
      {
        id: "firecrawl.surface",
        title: "Firecrawl surface",
        description: "Anywhere on the screen, including empty space."
      }
    ],
    items: {
      "firecrawl.workflow": [
        { id: "run", label: "Run workflow", command: "firecrawl.workflow.run", order: 10 },
        { id: "duplicate", label: "Duplicate", command: "firecrawl.workflow.duplicate", order: 20 },
        { id: "export", label: "Export as JSON", command: "firecrawl.workflow.export", order: 30 },
        { id: "sep", label: "", role: "separator", order: 40 },
        {
          id: "delete",
          label: "Delete workflow",
          command: "firecrawl.workflow.delete",
          role: "danger",
          order: 50
        }
      ],
      "firecrawl.step": [
        { id: "move-up", label: "Move up", command: "firecrawl.step.move-up", order: 10 },
        { id: "move-down", label: "Move down", command: "firecrawl.step.move-down", order: 20 },
        { id: "duplicate", label: "Duplicate step", command: "firecrawl.step.duplicate", order: 30 },
        { id: "sep", label: "", role: "separator", order: 40 },
        {
          id: "delete",
          label: "Delete step",
          command: "firecrawl.step.delete",
          role: "danger",
          order: 50
        }
      ],
      "firecrawl.dataset": [
        { id: "view", label: "Open in Data view", command: "firecrawl.dataset.view", order: 10 },
        { id: "sep-1", label: "", role: "separator", order: 15 },
        { id: "export-json", label: "Export as JSON", command: "firecrawl.dataset.export-json", order: 20 },
        { id: "export-md", label: "Export as Markdown", command: "firecrawl.dataset.export-md", order: 30 },
        { id: "export-csv", label: "Export as CSV", command: "firecrawl.dataset.export-csv", order: 40 },
        { id: "copy", label: "Copy contents", command: "firecrawl.dataset.copy", order: 50 },
        { id: "sep-2", label: "", role: "separator", order: 60 },
        {
          id: "delete",
          label: "Delete dataset",
          command: "firecrawl.dataset.delete",
          role: "danger",
          order: 70
        }
      ],
      "firecrawl.surface": [
        { id: "new-workflow", label: "New workflow", command: "firecrawl.new-workflow", order: 10 },
        { id: "example", label: "Add example workflow", command: "firecrawl.example", order: 20 },
        { id: "refresh", label: "Refresh from disk", command: "firecrawl.refresh", order: 30 }
      ]
    }
  },
  /**
   * Settings as decl data (core 0.0.20), all four earning their row: each one
   * changes what a RUN does or costs, which is a real difference in how the
   * module is safe to use — not chrome preference.
   */
  settings: {
    ns: "firecrawl-settings",
    rows: [
      {
        key: "autosaveDatasets",
        label: "Auto-save run results",
        hint: "Save every finished run's final output as a dataset automatically.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "analyzeBudget",
        label: "Analysis input budget (characters)",
        hint:
          "How much scraped text an Analyze step feeds the model. Bigger reads more of each " +
          "page; smaller is faster and cheaper.",
        kind: "number",
        defaultValue: 24000,
        min: 2000,
        max: 120000,
        step: 1000
      },
      {
        key: "loopLimit",
        label: "Default loop limit",
        hint: "How many links a new Loop step follows before stopping. Each iteration costs scrapes and analysis.",
        kind: "number",
        defaultValue: 10,
        min: 1,
        max: 100,
        step: 1
      },
      {
        key: "stepDelayMs",
        label: "Live-step slow motion (ms)",
        hint:
          "Delay between live browser actions so a run can be watched — 0 runs flat out. The " +
          "Run tab's slider changes it mid-run; this is where new runs start.",
        kind: "number",
        defaultValue: 500,
        min: 0,
        max: 5000,
        step: 100
      },
      {
        key: "defaultView",
        label: "Default data view",
        hint: "The format the Data panel opens a dataset in.",
        kind: "select",
        defaultValue: "auto",
        options: [
          { value: "auto", label: "Auto (by dataset kind)" },
          { value: "json", label: "JSON tree" },
          { value: "markdown", label: "Markdown" },
          { value: "table", label: "Table" },
          { value: "raw", label: "Raw" }
        ]
      }
    ]
  },
  points: []
};
