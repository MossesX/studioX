/**
 * @file The Firecrawl module's vocabulary — isomorphic, data-only.
 *
 * Imported by the client store, the screens, the commands AND the server
 * engine (`engine.server.ts`) and its routes, so the same rule as every
 * shared vocabulary file in this tree: types and constants only, no React,
 * no Node.
 *
 * ## The pipeline model
 *
 * A workflow is an ordered list of steps. Each step consumes the OUTPUT of
 * the step before it (`StepOutput`, one of four shapes) and produces its own.
 * That single seam is what makes the builder composable: "search, then
 * analyze what came back, then loop over the links the analysis chose,
 * scraping and analyzing each" is just four cards in a row, and every card
 * only has to know the shape it eats and the shape it emits.
 *
 * `loop` is the one recursive step: it takes the links (or JSON items) out of
 * the previous output and runs its OWN small pipeline once per item, bounded
 * by `limit`. One level deep, deliberately — a loop inside a loop is a crawl,
 * and Firecrawl's /crawl endpoint is the honest tool for that job.
 */

/** One clean document out of Firecrawl — the atom every view renders. */
export interface FireDoc {
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  /** Clean markdown when the step asked for content. */
  readonly markdown?: string;
  /** Absolute links found on the page when the step asked for them. */
  readonly links?: readonly string[];
}

/** What flows between steps. Exactly one payload field is set per kind. */
export interface StepOutput {
  readonly kind: "documents" | "text" | "json" | "links";
  readonly documents?: readonly FireDoc[];
  readonly text?: string;
  readonly json?: unknown;
  readonly links?: readonly string[];
}

/** Discover pages by query — the pipeline's usual first card. */
export interface SearchStep {
  readonly id: string;
  readonly kind: "search";
  readonly query: string;
  readonly limit: number;
  /** Also pull each result's page content (costs a scrape per result). */
  readonly withContent: boolean;
}

/** Extract clean markdown + links from known URLs. */
export interface ScrapeStep {
  readonly id: string;
  readonly kind: "scrape";
  /**
   * Literal URLs, one per line. When empty the step scrapes the LINKS of the
   * previous output instead — which is what makes "map, then scrape" and
   * "analyze → links, then scrape" both work without a special connector.
   */
  readonly urls: string;
  /** Upper bound on how many previous-output links get scraped. */
  readonly maxUrls: number;
}

/** Discover a site's URLs, optionally filtered — no content, just the map. */
export interface MapStep {
  readonly id: string;
  readonly kind: "map";
  readonly url: string;
  readonly search: string;
  readonly limit: number;
}

/**
 * The AI card: Fireball Freddy reads the previous output and answers a
 * plain-english prompt over it. `output` declares the shape the NEXT card
 * gets — prose, structured JSON, or a plain list of links to follow.
 */
export interface AnalyzeStep {
  readonly id: string;
  readonly kind: "analyze";
  readonly prompt: string;
  readonly output: "text" | "json" | "links";
}

/**
 * Open a page in the LIVE browser (Playwright, streamed to the viewer pane),
 * harvest every link on it — highlighted one by one as the engine passes over
 * them — and optionally save the result as a named, persistent link list.
 */
export interface LinksStep {
  readonly id: string;
  readonly kind: "links";
  /** Page to open. Empty → the first link of the previous output. */
  readonly url: string;
  /** CSS selector scoping which anchors count (empty = every `a[href]`). */
  readonly selector: string;
  /** Substring or /regex/ the href must match (empty = keep all). */
  readonly filter: string;
  /** Link-list name to save into ("" = don't save, just pass downstream). */
  readonly saveAs: string;
  /** When the named list already exists: overwrite it or add to it. */
  readonly listMode: "replace" | "append";
}

/**
 * Walk an entire pagination group in the live browser: either keep clicking a
 * "next" control until it disappears, or visit `pattern` with {n} counting up.
 * Collects links (or page snapshots) from every page as it goes.
 */
export interface PaginateStep {
  readonly id: string;
  readonly kind: "paginate";
  /** First page. Empty → the first link of the previous output. */
  readonly url: string;
  readonly strategy: "next" | "pattern";
  /**
   * The next-page control to click (strategy "next"). The value is interpreted
   * per `nextMatch`: a CSS selector, the control's visible TEXT ("Next", "›"),
   * its tag/`name`, a class, or an id — so a non-technical user can just type
   * "Older posts" instead of hunting a selector.
   */
  readonly nextSelector: string;
  /** How to read `nextSelector`. "auto" tries CSS, then text, then id/class/tag. */
  readonly nextMatch: "auto" | "text" | "tag" | "class" | "id" | "css";
  /** URL template with `{n}` (strategy "pattern"), e.g. `https://x.com/blog/page/{n}`. */
  readonly pattern: string;
  /** First value of {n}. */
  readonly from: number;
  readonly maxPages: number;
  /** What every page contributes: its links, or a snapshot of the page. */
  readonly collect: "links" | "pages";
  /** Anchor scope when collecting links (empty = every `a[href]`). */
  readonly selector: string;
  /** Substring or /regex/ filter on collected hrefs. */
  readonly filter: string;
  /** Link-list name for everything collected ("" = just pass downstream). */
  readonly saveAs: string;
}

/**
 * Loop over a STORED link list (or the previous output's links): visit each
 * link in the live browser, optionally harvest the links on it, test a
 * condition against the opened page, and keep the item only when it passes.
 */
export interface ForeachStep {
  readonly id: string;
  readonly kind: "foreach";
  /** Stored list to walk. Empty → the previous output's links. */
  readonly listName: string;
  readonly limit: number;
  /** Also harvest each visited page's links (highlighted in the viewer). */
  readonly extractLinks: boolean;
  /** The keep/drop test, evaluated on the page after it opens. */
  readonly condType: "always" | "selector" | "text" | "regex" | "url";
  readonly condValue: string;
  /** Invert the test — keep the pages that do NOT match. */
  readonly condNegate: boolean;
  /** What a kept item contributes: its URL, its harvested links, or a page snapshot. */
  readonly store: "url" | "links" | "page";
  /** Link-list name for kept URLs/links ("" = just pass downstream). */
  readonly saveAs: string;
}

/** Replay a saved browser recording (from the Recorder tab) as a pipeline step. */
export interface RecordStep {
  readonly id: string;
  readonly kind: "record";
  /** Which saved recording to replay. */
  readonly recordingId: string;
  /** Optional override of the recording's start URL. */
  readonly url: string;
}

/** The steps a loop may run per item — everything but another loop. */
export type LoopInnerStep = ScrapeStep | AnalyzeStep;

/**
 * Iterate the previous output's links (or JSON array items), running the
 * inner pipeline once per item. Each iteration starts from that one item:
 * links arrive as a one-link `links` output, items as a `json` output.
 */
export interface LoopStep {
  readonly id: string;
  readonly kind: "loop";
  readonly limit: number;
  readonly steps: readonly LoopInnerStep[];
}

export type WorkflowStep =
  | SearchStep
  | ScrapeStep
  | MapStep
  | AnalyzeStep
  | LoopStep
  | LinksStep
  | PaginateStep
  | ForeachStep
  | RecordStep;
export type StepKind = WorkflowStep["kind"];

/** The step kinds that run in the live Playwright browser (watchable). */
export const BROWSER_KINDS: readonly StepKind[] = ["links", "paginate", "foreach", "record"];

export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly steps: readonly WorkflowStep[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A saved result — JSON or markdown, named, exportable, viewable. */
export interface Dataset {
  readonly id: string;
  readonly name: string;
  readonly kind: "json" | "markdown";
  readonly content: string;
  readonly createdAt: number;
  /** Provenance, when the dataset came out of a run. */
  readonly workflowId?: string;
  readonly workflowName?: string;
}

/** A named, persistent list of URLs — what `links`/`paginate`/`foreach` save. */
export interface LinkList {
  readonly id: string;
  readonly name: string;
  readonly urls: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Provenance — which workflow/step or recorder action produced it. */
  readonly source?: string;
}

/**
 * One recorded (or replayed) browser action. Clicks carry BOTH a resolved CSS
 * selector and the raw coordinates: replay tries the selector first (survives
 * layout shifts) and falls back to the coordinates (survives selector rot).
 */
export interface BrowserAction {
  readonly kind:
    | "goto"
    | "click"
    | "dblclick"
    | "type"
    | "press"
    | "scroll"
    | "back"
    | "forward"
    | "reload"
    | "wait";
  readonly url?: string;
  readonly x?: number;
  readonly y?: number;
  /** Resolved CSS selector of the click target, when one could be computed. */
  readonly selector?: string;
  readonly text?: string;
  readonly key?: string;
  readonly dx?: number;
  readonly dy?: number;
  readonly ms?: number;
  /** Human description for the action log ("click 'Sign in'"). */
  readonly label?: string;
  /** Milliseconds since the recording started. */
  readonly at?: number;
}

/** A saved chain of browser actions — the Recorder tab's product. */
export interface Recording {
  readonly id: string;
  readonly name: string;
  readonly startUrl: string;
  readonly actions: readonly BrowserAction[];
  readonly createdAt: number;
}

/** The persisted document at kv ns `firecrawl` — one doc, like expenses. */
export interface FirecrawlDoc {
  readonly v: 2;
  readonly workflows: readonly Workflow[];
  readonly datasets: readonly Dataset[];
  readonly lists: readonly LinkList[];
  readonly recordings: readonly Recording[];
}

/**
 * The run wire — `/api/firecrawl/run` streams these as NDJSON, one per line.
 * `path` is the step's position ("2" for the third step, "2.1.0" for the
 * first inner step of iteration 1 of a loop at index 2) so the client can
 * file events under the right card without holding engine state.
 */
export type RunEvent =
  | { type: "run-start"; runId: string }
  | { type: "step-start"; path: string; stepId: string; label: string }
  | { type: "delta"; path: string; text: string }
  | { type: "loop-item"; path: string; index: number; total: number; label: string }
  | { type: "step-done"; path: string; output: StepOutput; summary: string }
  | { type: "step-error"; path: string; message: string }
  /** The live browser navigated — the run log's breadcrumb trail. */
  | { type: "page"; path: string; url: string; title: string }
  /** A link was highlighted/harvested in the viewer (progress ticker). */
  | { type: "highlight"; path: string; count: number; href: string }
  /**
   * The engine produced a link list. The CLIENT owns the kv store doc, so the
   * list rides the stream and the client files + persists it — the engine
   * never writes the store doc and can never clobber an unsaved edit.
   */
  | { type: "list"; name: string; urls: readonly string[]; listMode: "replace" | "append"; source: string }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "done"; output: StepOutput | null }
  | { type: "error"; message: string };

/** POST body for `/api/firecrawl/run` — the workflow rides whole, so an
 *  unsaved edit in the builder runs exactly as drafted. */
export interface RunRequest {
  readonly workflow: Workflow;
  /** Client-chosen run id, so pause/resume/speed can target the run from the
   *  first event — the control route needs it before the stream answers. */
  readonly runId?: string;
  /** Skip the steps before this index (Run from here). */
  readonly startAt?: number;
  /** Initial slow-motion delay between engine actions, in ms. */
  readonly stepDelayMs?: number;
  /** Live browser session the run's browser steps should drive (watchable). */
  readonly sessionId?: string;
  /** Stored link lists, riding with the run — `foreach` reads them by name. */
  readonly lists?: readonly LinkList[];
  /** Saved recordings, riding with the run — `record` replays them by id. */
  readonly recordings?: readonly Recording[];
}

/** POST body for `/api/firecrawl/control` — steer a live run. */
export interface RunControlRequest {
  readonly runId: string;
  readonly op: "pause" | "resume" | "stop" | "speed";
  /** New delay in ms, for op "speed". */
  readonly value?: number;
}

/**
 * The browser-session wire — `/api/firecrawl/browser` GET streams these as
 * NDJSON while a viewer pane is attached. Frames are JPEG, base64.
 */
export type BrowserEvent =
  | { type: "hello"; sessionId: string; url: string; title: string; recording: boolean; actionCount: number }
  | { type: "frame"; data: string; url: string; title: string; w: number; h: number }
  | { type: "nav"; url: string; title: string }
  | { type: "recording"; on: boolean; count: number }
  | { type: "action"; action: BrowserAction }
  | { type: "links"; urls: readonly string[] }
  | { type: "closed" }
  | { type: "error"; message: string };

/** POST body for `/api/firecrawl/browser` — one op per request. */
export interface BrowserOpRequest {
  readonly op:
    | "open"
    | "act"
    | "record-start"
    | "record-pause"
    | "record-resume"
    | "record-stop"
    | "extract-links"
    | "replay"
    | "close";
  readonly sessionId?: string;
  readonly action?: BrowserAction;
  /** extract-links options. */
  readonly selector?: string;
  readonly filter?: string;
  /** replay payload + pacing. */
  readonly actions?: readonly BrowserAction[];
  readonly delayMs?: number;
  readonly url?: string;
}

/** What `/api/firecrawl/config` GET answers — key PRESENCE only, never the
 *  key. `env` means FIRECRAWL_API_KEY was in the server's environment. */
export interface FirecrawlConfigInfo {
  readonly hasKey: boolean;
  readonly source: "env" | "stored" | "none";
}

/** Step factories — the builder's "add card" menu calls these. */
export const STEP_LABELS: Record<StepKind, string> = {
  search: "Search the web",
  scrape: "Scrape URLs",
  map: "Map a site",
  analyze: "Analyze (Freddy)",
  loop: "Loop over links",
  links: "Harvest links (live)",
  paginate: "Walk pagination (live)",
  foreach: "For each in list (live)",
  record: "Replay recording (live)"
};

/** One-line human summary of a step, for cards and run headers. */
export function stepSummary(step: WorkflowStep): string {
  switch (step.kind) {
    case "search":
      return step.query ? `"${step.query}" (top ${step.limit})` : "(no query yet)";
    case "scrape": {
      const literal = step.urls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean);
      return literal.length
        ? `${literal.length} URL${literal.length === 1 ? "" : "s"}`
        : `links from the previous step (max ${step.maxUrls})`;
    }
    case "map":
      return step.url ? `${step.url}${step.search ? ` · "${step.search}"` : ""}` : "(no site yet)";
    case "analyze":
      return step.prompt ? `${step.prompt.slice(0, 80)}${step.prompt.length > 80 ? "…" : ""}` : "(no prompt yet)";
    case "loop":
      return `${step.steps.length} inner step${step.steps.length === 1 ? "" : "s"}, up to ${step.limit} items`;
    case "links":
      return `${step.url || "(previous output)"}${step.saveAs ? ` → list "${step.saveAs}"` : ""}`;
    case "paginate":
      return step.strategy === "pattern"
        ? `${step.pattern || "(no pattern yet)"} · up to ${step.maxPages} pages`
        : `${step.url || "(previous output)"} · next: ${step.nextSelector || "(no selector yet)"} · up to ${step.maxPages} pages`;
    case "foreach":
      return `${step.listName ? `list "${step.listName}"` : "(previous output)"} · keep when ${
        step.condType === "always" ? "always" : `${step.condNegate ? "NOT " : ""}${step.condType} ${step.condValue || "…"}`
      }${step.saveAs ? ` → "${step.saveAs}"` : ""}`;
    case "record":
      return step.recordingId ? `recording ${step.recordingId}` : "(no recording picked yet)";
  }
}

/** The links a step output offers to whatever follows it. */
export function linksOf(output: StepOutput | null): string[] {
  if (!output) return [];
  if (output.kind === "links") return [...(output.links ?? [])];
  if (output.kind === "documents") {
    const all: string[] = [];
    for (const doc of output.documents ?? []) {
      for (const link of doc.links ?? []) all.push(link);
      if (!doc.links?.length && doc.url) all.push(doc.url);
    }
    return [...new Set(all)];
  }
  if (output.kind === "json" && Array.isArray(output.json)) {
    return output.json
      .map((item) =>
        typeof item === "string"
          ? item
          : typeof (item as { url?: unknown })?.url === "string"
            ? (item as { url: string }).url
            : null
      )
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
  }
  return [];
}
