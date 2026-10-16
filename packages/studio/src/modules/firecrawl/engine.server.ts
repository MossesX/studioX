/**
 * @file The workflow engine — **Node-only**, imported by `/api/firecrawl/run`.
 *
 * Executes a workflow's steps in order, streaming `RunEvent`s to the caller:
 * Firecrawl for the web half (search / scrape / map), the assistant's
 * provider layer for the AI half (analyze) — the SAME layer the module
 * assistant's chat rides, so whatever provider and auth the owner configured
 * there is what Fireball Freddy answers with here. No second provider stack,
 * no second key store.
 *
 * ## Who answers an analyze step
 *
 * The roster is scanned once per run and the agent resolved in this order:
 * the module's own bundle (`firecrawl-agent`, written by `npm run agent
 * firecrawl`), a `.claude/agents` persona named `fireball-freddy`, then the
 * built-in default. So the same Freddy who answers the assistant window on
 * /firecrawl narrates the pipeline — one persona, two seams.
 *
 * ## The API key
 *
 * `FIRECRAWL_API_KEY` from the server's environment wins; otherwise the kv
 * doc at ns `firecrawl-config` (written by `/api/firecrawl/config`, never
 * sent to a client unmasked). The key never appears in an event, an error
 * message or a log line — failures quote Firecrawl's status and body text,
 * which do not carry it.
 *
 * ## Bounds
 *
 * Every fan-out is bounded (search limit, scrape maxUrls, loop limit) and
 * scrapes run sequentially — the team's parallel-scrape limit is 2 and a
 * workflow sharing it with the CLI would flake, so the engine stays under it
 * by not racing itself. Analyze inputs are truncated to the caller's budget;
 * the event says so when it happens rather than silently reading less.
 */
import { runProvider, ProviderError } from "../../plugins/module-assistant/providers.server";
import { composeAgentSystem, scanAgents } from "../../plugins/module-assistant/agents.server";
import {
  ASSISTANT_CONFIG_NS,
  DEFAULT_AGENT,
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  PROVIDERS,
  parseAgentDirs
} from "../../plugins/module-assistant/types";
import type {
  AssistantAgent,
  AssistantConfig,
  ProviderId
} from "../../plugins/module-assistant/types";
import { axfKv } from "../../server/axfKv";
import {
  checkCondition,
  closeSession,
  extractLinks,
  findNextControl,
  getRunControl,
  getSession,
  gotoUrl,
  highlightLocator,
  openSession,
  pushFrame,
  replayActions,
  sleep,
  snapshotPage
} from "./browser.server";
import type { BrowserSession } from "./browser.server";
import { linksOf } from "./types";
import type {
  AnalyzeStep,
  FireDoc,
  ForeachStep,
  LinkList,
  LinksStep,
  LoopStep,
  MapStep,
  PaginateStep,
  RecordStep,
  Recording,
  RunEvent,
  ScrapeStep,
  SearchStep,
  StepOutput,
  Workflow,
  WorkflowStep
} from "./types";

const FIRECRAWL_ORIGIN = "https://api.firecrawl.dev/v2";

/** kv namespace for the stored key — one field, `{ apiKey }`. */
export const FIRECRAWL_CONFIG_NS = "firecrawl-config";

export interface EngineOptions {
  readonly user: string;
  readonly signal: AbortSignal;
  readonly emit: (event: RunEvent) => void;
  /** Characters of serialized input an analyze step may feed the model. */
  readonly analyzeBudget: number;
  /** Client-chosen run id — the pause/resume/speed control's address. */
  readonly runId?: string;
  /** Skip the steps before this index (Run from here). */
  readonly startAt?: number;
  /** Live browser session to drive for the watchable steps. */
  readonly sessionId?: string;
  /** Stored link lists riding with the request — `foreach` reads them by name. */
  readonly lists?: readonly LinkList[];
  /** Saved recordings riding with the request — `record` replays them by id. */
  readonly recordings?: readonly Recording[];
}

/* ── key resolution ──────────────────────────────────────────────────────── */

export async function resolveApiKey(user: string): Promise<{ key: string | null; source: "env" | "stored" | "none" }> {
  const env = process.env.FIRECRAWL_API_KEY?.trim();
  if (env) return { key: env, source: "env" };
  const doc = (await axfKv.read(user, FIRECRAWL_CONFIG_NS)) as { apiKey?: unknown } | null;
  const stored = typeof doc?.apiKey === "string" ? doc.apiKey.trim() : "";
  return stored ? { key: stored, source: "stored" } : { key: null, source: "none" };
}

/* ── Firecrawl calls ─────────────────────────────────────────────────────── */

class FirecrawlError extends Error {}

async function fire(
  path: string,
  body: Record<string, unknown>,
  key: string,
  signal: AbortSignal
): Promise<unknown> {
  const res = await fetch(`${FIRECRAWL_ORIGIN}${path}`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    // The body text is Firecrawl's own error prose — safe to relay, never
    // carries the key. 402/429 get a plainer sentence because they are the
    // two a user can act on.
    const hint =
      res.status === 402
        ? "Firecrawl says the team is out of credits."
        : res.status === 429
          ? "Firecrawl rate limit hit — wait a moment and rerun."
          : `Firecrawl answered HTTP ${res.status}.`;
    throw new FirecrawlError(`${hint} ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FirecrawlError(`Firecrawl answered non-JSON (HTTP ${res.status}).`);
  }
}

/** Tolerant readers over Firecrawl's response envelopes — the wire has moved
 *  before (v1 → v2) and a missing field should degrade, not throw. */
function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function docFromScrape(url: string, data: unknown): FireDoc {
  const d = asRecord(data);
  const meta = asRecord(d.metadata);
  const links = Array.isArray(d.links)
    ? d.links.filter((l): l is string => typeof l === "string")
    : undefined;
  return {
    url: typeof meta.sourceURL === "string" ? meta.sourceURL : url,
    title: typeof meta.title === "string" ? meta.title : undefined,
    description: typeof meta.description === "string" ? meta.description : undefined,
    markdown: typeof d.markdown === "string" ? d.markdown : undefined,
    ...(links ? { links } : {})
  };
}

async function runSearch(step: SearchStep, key: string, signal: AbortSignal): Promise<StepOutput> {
  const body: Record<string, unknown> = { query: step.query, limit: clamp(step.limit, 1, 20) };
  if (step.withContent) body.scrapeOptions = { formats: ["markdown", "links"] };
  const res = asRecord(await fire("/search", body, key, signal));
  const data = asRecord(res.data);
  // v2 groups results by source (`web`, `news`, …); older shapes were a flat
  // array. Read both.
  const rows: unknown[] = Array.isArray(data.web)
    ? data.web
    : Array.isArray(res.data)
      ? (res.data as unknown[])
      : [];
  const documents: FireDoc[] = rows.map((row) => {
    const r = asRecord(row);
    const doc = docFromScrape(typeof r.url === "string" ? r.url : "", r);
    return {
      ...doc,
      title: doc.title ?? (typeof r.title === "string" ? r.title : undefined),
      description: doc.description ?? (typeof r.description === "string" ? r.description : undefined)
    };
  });
  return { kind: "documents", documents };
}

async function runScrapeOne(url: string, key: string, signal: AbortSignal): Promise<FireDoc> {
  const res = asRecord(await fire("/scrape", { url, formats: ["markdown", "links"] }, key, signal));
  return docFromScrape(url, res.data);
}

async function runMap(step: MapStep, key: string, signal: AbortSignal): Promise<StepOutput> {
  const body: Record<string, unknown> = { url: step.url, limit: clamp(step.limit, 1, 500) };
  if (step.search.trim()) body.search = step.search.trim();
  const res = asRecord(await fire("/map", body, key, signal));
  const data = res.data;
  const rows: unknown[] = Array.isArray(asRecord(data).links)
    ? (asRecord(data).links as unknown[])
    : Array.isArray(data)
      ? (data as unknown[])
      : [];
  const links = rows
    .map((row) => (typeof row === "string" ? row : (asRecord(row).url as string | undefined)))
    .filter((u): u is string => typeof u === "string");
  return { kind: "links", links };
}

/* ── the AI half ─────────────────────────────────────────────────────────── */

interface Assistant {
  readonly agent: AssistantAgent;
  readonly provider: ProviderId;
  readonly model: string;
  readonly config: AssistantConfig;
}

const PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));

async function resolveAssistant(user: string): Promise<Assistant> {
  const stored = ((await axfKv.read(user, ASSISTANT_CONFIG_NS)) ?? DEFAULT_CONFIG) as AssistantConfig;
  const roster = scanAgents(parseAgentDirs(stored.agentDirs));
  const agent =
    roster.find((a) => a.id === "firecrawl-agent") ??
    roster.find((a) => a.id === "fireball-freddy") ??
    DEFAULT_AGENT;
  const provider: ProviderId =
    agent.provider ?? (PROVIDER_IDS.has(stored.provider) ? stored.provider : DEFAULT_CONFIG.provider);
  const model =
    agent.model ?? (provider === stored.provider && stored.model ? stored.model : DEFAULT_MODELS[provider]);
  return { agent, provider, model, config: stored };
}

/** Serialize a step output for the model, bounded by the budget. */
function serializeForModel(output: StepOutput | null, budget: number): { text: string; truncated: boolean } {
  if (!output) return { text: "(no previous step output)", truncated: false };
  let text: string;
  switch (output.kind) {
    case "text":
      text = output.text ?? "";
      break;
    case "links":
      text = (output.links ?? []).join("\n");
      break;
    case "json":
      text = JSON.stringify(output.json ?? null, null, 2);
      break;
    case "documents": {
      // Split the budget across documents so one long page cannot starve the
      // rest out of the window entirely.
      const docs = output.documents ?? [];
      const per = docs.length ? Math.max(500, Math.floor(budget / docs.length)) : budget;
      text = docs
        .map((d) => {
          const head = `### ${d.title ?? d.url}\nURL: ${d.url}`;
          const body = d.markdown ? `\n${d.markdown.slice(0, per)}` : "";
          const links = d.links?.length ? `\nLinks on page:\n${d.links.slice(0, 100).join("\n")}` : "";
          return `${head}${body}${links}`;
        })
        .join("\n\n---\n\n");
      break;
    }
  }
  if (text.length <= budget) return { text, truncated: false };
  return { text: text.slice(0, budget), truncated: true };
}

const OUTPUT_CONTRACT: Record<AnalyzeStep["output"], string> = {
  text: "Answer in plain markdown prose.",
  json:
    "Answer with ONE fenced ```json code block containing valid JSON and nothing outside it. " +
    "Prefer an array of flat objects when the data is tabular.",
  links:
    "Answer with ONE fenced ```json code block containing a JSON array of absolute URLs " +
    "(strings only) and nothing outside it. Only include URLs that appear in the input."
};

/** Fenced-JSON extraction, tolerant of prose around the fence. */
function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text);
  const candidates = fence ? [fence[1]] : [];
  const first = text.search(/[[{]/);
  if (first >= 0) candidates.push(text.slice(first));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim()) as unknown;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function runAnalyze(
  step: AnalyzeStep,
  input: StepOutput | null,
  assistant: Assistant,
  opts: EngineOptions,
  path: string
): Promise<StepOutput> {
  const { text: serialized, truncated } = serializeForModel(input, opts.analyzeBudget);
  const prompt = [
    "You are analyzing data collected by a Firecrawl workflow step.",
    truncated ? "(The input below was truncated to fit the analysis budget.)" : "",
    OUTPUT_CONTRACT[step.output],
    "",
    "## Task",
    step.prompt,
    "",
    "## Input data",
    serialized
  ]
    .filter(Boolean)
    .join("\n");

  let reply = "";
  await runProvider({
    provider: assistant.provider,
    model: assistant.model,
    system: composeAgentSystem(assistant.agent),
    messages: [{ role: "user", content: prompt }],
    settings: assistant.config.providers?.[assistant.provider] ?? {},
    allowedTools: assistant.agent.tools,
    signal: opts.signal,
    emit: (text) => {
      reply += text;
      opts.emit({ type: "delta", path, text });
    }
  });

  if (step.output === "text") return { kind: "text", text: reply.trim() };
  const json = extractJson(reply);
  if (step.output === "links") {
    const links = Array.isArray(json)
      ? json.filter((l): l is string => typeof l === "string" && /^https?:\/\//i.test(l))
      : [];
    if (!links.length) {
      throw new ProviderError(
        "The analysis returned no usable links — expected a JSON array of absolute URLs."
      );
    }
    return { kind: "links", links };
  }
  if (json === null) {
    throw new ProviderError("The analysis returned no parsable JSON — try a more specific prompt.");
  }
  return { kind: "json", json };
}

/* ── the walk ────────────────────────────────────────────────────────────── */

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(n) ? n : lo)));
}

function summaryOf(output: StepOutput): string {
  switch (output.kind) {
    case "documents":
      return `${output.documents?.length ?? 0} document${(output.documents?.length ?? 0) === 1 ? "" : "s"}`;
    case "links":
      return `${output.links?.length ?? 0} link${(output.links?.length ?? 0) === 1 ? "" : "s"}`;
    case "json":
      return Array.isArray(output.json) ? `JSON array of ${output.json.length}` : "JSON object";
    case "text":
      return `${output.text?.length ?? 0} characters of prose`;
  }
}

async function runScrapeStep(
  step: ScrapeStep,
  input: StepOutput | null,
  key: string,
  opts: EngineOptions,
  path: string
): Promise<StepOutput> {
  const literal = step.urls
    .split("\n")
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
  const urls = literal.length ? literal : linksOf(input).slice(0, clamp(step.maxUrls, 1, 50));
  if (!urls.length) {
    throw new FirecrawlError(
      "Nothing to scrape — no URLs on the step and no links in the previous output."
    );
  }
  const documents: FireDoc[] = [];
  let index = 0;
  for (const url of urls) {
    if (opts.signal.aborted) break;
    opts.emit({ type: "loop-item", path, index, total: urls.length, label: url });
    try {
      documents.push(await runScrapeOne(url, key, opts.signal));
    } catch (err) {
      // One dead page does not kill a batch scrape; the doc records the miss
      // so the count downstream still says what happened.
      if (opts.signal.aborted) break;
      documents.push({ url, description: `SCRAPE FAILED: ${messageOf(err)}` });
    }
    index += 1;
  }
  return { kind: "documents", documents };
}

async function runLoop(
  step: LoopStep,
  input: StepOutput | null,
  key: string,
  assistant: Assistant,
  opts: EngineOptions,
  path: string
): Promise<StepOutput> {
  const items: { label: string; start: StepOutput }[] = [];
  const links = linksOf(input);
  if (links.length) {
    for (const link of links) items.push({ label: link, start: { kind: "links", links: [link] } });
  } else if (input?.kind === "json" && Array.isArray(input.json)) {
    input.json.forEach((item, i) =>
      items.push({ label: `item ${i + 1}`, start: { kind: "json", json: item } })
    );
  }
  if (!items.length) {
    throw new FirecrawlError("Nothing to loop over — the previous output has no links or array items.");
  }

  const bounded = items.slice(0, clamp(step.limit, 1, 100));
  const results: unknown[] = [];
  for (let i = 0; i < bounded.length; i++) {
    if (opts.signal.aborted) break;
    const item = bounded[i];
    opts.emit({ type: "loop-item", path, index: i, total: bounded.length, label: item.label });
    let current: StepOutput | null = item.start;
    try {
      for (let j = 0; j < step.steps.length; j++) {
        const inner = step.steps[j];
        const innerPath = `${path}.${i}.${j}`;
        opts.emit({ type: "step-start", path: innerPath, stepId: inner.id, label: item.label });
        current =
          inner.kind === "scrape"
            ? await runScrapeStep(inner, current, key, opts, innerPath)
            : await runAnalyze(inner, current, assistant, opts, innerPath);
        opts.emit({ type: "step-done", path: innerPath, output: current, summary: summaryOf(current) });
      }
      results.push({
        item: item.label,
        result:
          current?.kind === "text"
            ? current.text
            : current?.kind === "json"
              ? current.json
              : current?.kind === "links"
                ? current.links
                : current?.documents
      });
    } catch (err) {
      if (opts.signal.aborted) break;
      // A failed iteration is a row in the results, not the end of the loop —
      // the whole point of looping the web is that some of it is down.
      opts.emit({ type: "step-error", path: `${path}.${i}`, message: messageOf(err) });
      results.push({ item: item.label, error: messageOf(err) });
    }
  }
  return { kind: "json", json: results };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ── the live-browser half ───────────────────────────────────────────────── */

/**
 * The engine's slow-motion / pause gate — awaited between visible actions.
 * Speed and pause flags live in the run-control registry (`browser.server`),
 * flipped by `/api/firecrawl/control`; the gate observes transitions and
 * tells the stream, so the run log shows "paused" the moment it takes hold.
 */
class Gate {
  #wasPaused = false;
  constructor(
    private readonly runId: string | undefined,
    private readonly opts: EngineOptions
  ) {}

  async wait(): Promise<void> {
    const control = this.runId ? getRunControl(this.runId) : null;
    if (!control) return;
    if (control.paused && !this.#wasPaused) {
      this.#wasPaused = true;
      this.opts.emit({ type: "paused" });
    }
    while (control.paused && !this.opts.signal.aborted) await sleep(150);
    if (this.#wasPaused && !control.paused) {
      this.#wasPaused = false;
      this.opts.emit({ type: "resumed" });
    }
    if (control.delayMs > 0 && !this.opts.signal.aborted) await sleep(control.delayMs);
  }

  /** Current per-link dwell for highlight sweeps — live, not a snapshot. */
  delayMs(): number {
    return this.runId ? (getRunControl(this.runId)?.delayMs ?? 0) : 0;
  }
}

/** A browser session for this run: the client's (watchable) or an ephemeral
 *  one that the run closes behind itself. */
async function acquireBrowser(
  opts: EngineOptions
): Promise<{ session: BrowserSession; ephemeral: boolean }> {
  if (opts.sessionId) {
    const session = getSession(opts.sessionId) ?? (await openSession(opts.sessionId));
    return { session, ephemeral: false };
  }
  const session = await openSession(`run-${opts.runId ?? Date.now().toString(36)}`);
  return { session, ephemeral: true };
}

function startUrlOf(explicit: string, input: StepOutput | null): string {
  const url = explicit.trim();
  if (url) return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const first = linksOf(input)[0];
  if (!first) {
    throw new FirecrawlError(
      "No page to open — the step has no URL and the previous output has no links."
    );
  }
  return first;
}

async function runLinksStep(
  step: LinksStep,
  input: StepOutput | null,
  session: BrowserSession,
  gate: Gate,
  opts: EngineOptions,
  path: string
): Promise<StepOutput> {
  const url = startUrlOf(step.url, input);
  await gate.wait();
  await gotoUrl(session, url);
  opts.emit({ type: "page", path, url, title: await session.page.title().catch(() => "") });
  await pushFrame(session);
  const links = await extractLinks(session, {
    selector: step.selector,
    filter: step.filter,
    delayMs: 0,
    highlight: true,
    signal: opts.signal,
    gate: () => gate.wait(),
    onLink: (href, index, total) =>
      opts.emit({ type: "highlight", path, count: index + 1, href: `${href} (${index + 1}/${total})` })
  });
  if (step.saveAs.trim()) {
    opts.emit({
      type: "list",
      name: step.saveAs.trim(),
      urls: links,
      listMode: step.listMode,
      source: `links · ${url}`
    });
  }
  return { kind: "links", links };
}

async function runPaginateStep(
  step: PaginateStep,
  input: StepOutput | null,
  session: BrowserSession,
  gate: Gate,
  opts: EngineOptions,
  path: string
): Promise<StepOutput> {
  const maxPages = clamp(step.maxPages, 1, 200);
  const allLinks: string[] = [];
  const documents: FireDoc[] = [];
  let visited = 0;

  const collectHere = async (): Promise<void> => {
    opts.emit({
      type: "page",
      path,
      url: session.page.url(),
      title: await session.page.title().catch(() => "")
    });
    if (step.collect === "pages") {
      documents.push(await snapshotPage(session));
      return;
    }
    const links = await extractLinks(session, {
      selector: step.selector,
      filter: step.filter,
      delayMs: 0,
      highlight: true,
      signal: opts.signal,
      gate: () => gate.wait(),
      onLink: (href) => opts.emit({ type: "highlight", path, count: allLinks.length + 1, href })
    });
    for (const link of links) if (!allLinks.includes(link)) allLinks.push(link);
  };

  if (step.strategy === "pattern") {
    if (!step.pattern.includes("{n}")) {
      throw new FirecrawlError("The URL pattern must contain {n} — e.g. https://site.com/page/{n}");
    }
    const from = Number.isFinite(step.from) ? Math.floor(step.from) : 1;
    for (let n = from; n < from + maxPages; n += 1) {
      if (opts.signal.aborted) break;
      await gate.wait();
      const url = step.pattern.replaceAll("{n}", String(n));
      opts.emit({ type: "loop-item", path, index: visited, total: maxPages, label: url });
      try {
        await gotoUrl(session, url);
      } catch {
        break; // A page that will not load ends the walk — the group ran out.
      }
      visited += 1;
      await collectHere();
    }
  } else {
    await gate.wait();
    await gotoUrl(session, startUrlOf(step.url, input));
    visited = 1;
    opts.emit({ type: "loop-item", path, index: 0, total: maxPages, label: session.page.url() });
    await collectHere();
    while (visited < maxPages && !opts.signal.aborted) {
      if (!step.nextSelector.trim()) break;
      // Resolve the "next" control from whatever the user typed — visible text,
      // an id, a class, a tag/name, or a CSS selector — not just a selector.
      const control = await findNextControl(session, step.nextSelector, step.nextMatch ?? "auto");
      if (!control) break; // No next control on the page — the group ended.
      await gate.wait();
      await highlightLocator(control);
      await pushFrame(session);
      const before = session.page.url();
      try {
        await control.click({ timeout: 5000 });
        await session.page.waitForLoadState("domcontentloaded", { timeout: 15000 });
        await session.page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      } catch {
        break;
      }
      if (session.page.url() === before) {
        // Same-URL paginations (SPA) still count, but a next control that
        // changes nothing twice in a row would spin forever — give it a beat
        // to render, then trust the collect to dedupe.
        await sleep(600);
      }
      visited += 1;
      opts.emit({ type: "loop-item", path, index: visited - 1, total: maxPages, label: session.page.url() });
      await collectHere();
    }
  }

  if (step.saveAs.trim() && step.collect === "links") {
    opts.emit({
      type: "list",
      name: step.saveAs.trim(),
      urls: allLinks,
      listMode: "replace",
      source: `paginate · ${visited} page${visited === 1 ? "" : "s"}`
    });
  }
  return step.collect === "pages"
    ? { kind: "documents", documents }
    : { kind: "links", links: allLinks };
}

async function runForeachStep(
  step: ForeachStep,
  input: StepOutput | null,
  session: BrowserSession,
  gate: Gate,
  opts: EngineOptions,
  path: string
): Promise<StepOutput> {
  const listName = step.listName.trim();
  const stored = listName
    ? (opts.lists ?? []).find((l) => l.name === listName)
    : null;
  if (listName && !stored) {
    throw new FirecrawlError(
      `No stored link list named "${listName}" — save one first with a Harvest links or Walk pagination step.`
    );
  }
  const urls = (stored ? [...stored.urls] : linksOf(input)).slice(0, clamp(step.limit, 1, 500));
  if (!urls.length) {
    throw new FirecrawlError("Nothing to visit — the list (or previous output) has no links.");
  }

  const keptUrls: string[] = [];
  const keptLinks: string[] = [];
  const documents: FireDoc[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    if (opts.signal.aborted) break;
    const url = urls[i];
    await gate.wait();
    opts.emit({ type: "loop-item", path, index: i, total: urls.length, label: url });
    try {
      await gotoUrl(session, url);
    } catch (err) {
      opts.emit({ type: "step-error", path: `${path}.${i}`, message: `${url} — ${messageOf(err)}` });
      continue;
    }
    opts.emit({ type: "page", path, url, title: await session.page.title().catch(() => "") });
    await pushFrame(session);
    let pageLinks: string[] = [];
    if (step.extractLinks || step.store === "links") {
      pageLinks = await extractLinks(session, {
        selector: "",
        filter: "",
        delayMs: 0,
        highlight: true,
        signal: opts.signal,
        gate: () => gate.wait(),
        onLink: (href, index) => opts.emit({ type: "highlight", path, count: index + 1, href })
      });
    }
    const keep = await checkCondition(session, step.condType, step.condValue, step.condNegate);
    if (!keep) continue;
    keptUrls.push(url);
    if (step.store === "links") for (const l of pageLinks) if (!keptLinks.includes(l)) keptLinks.push(l);
    if (step.store === "page") documents.push(await snapshotPage(session));
  }

  const outLinks = step.store === "links" ? keptLinks : keptUrls;
  if (step.saveAs.trim() && step.store !== "page") {
    opts.emit({
      type: "list",
      name: step.saveAs.trim(),
      urls: outLinks,
      listMode: "replace",
      source: `foreach · kept ${outLinks.length} of ${urls.length}`
    });
  }
  return step.store === "page"
    ? { kind: "documents", documents }
    : { kind: "links", links: outLinks };
}

async function runRecordStep(
  step: RecordStep,
  session: BrowserSession,
  gate: Gate,
  opts: EngineOptions,
  path: string
): Promise<StepOutput> {
  const recording = (opts.recordings ?? []).find((r) => r.id === step.recordingId);
  if (!recording) {
    throw new FirecrawlError(
      "No recording picked (or it no longer exists) — record one in the Recorder tab first."
    );
  }
  const startUrl = step.url.trim() || recording.startUrl;
  await replayActions(session, startUrl, recording.actions, {
    delayMs: null,
    signal: opts.signal,
    gate: () => gate.wait(),
    onAction: (action, index, total) =>
      opts.emit({
        type: "loop-item",
        path,
        index,
        total,
        label: action.label ?? action.kind
      })
  });
  opts.emit({
    type: "page",
    path,
    url: session.page.url(),
    title: await session.page.title().catch(() => "")
  });
  const doc = await snapshotPage(session);
  return { kind: "documents", documents: [doc] };
}

/**
 * Run a workflow end to end, emitting events as it goes. Resolves when the
 * run finishes, errors, or the signal aborts — never rejects; failures are
 * `error` events, because by the time one happens the stream is the only
 * channel left.
 */
export async function runWorkflow(workflow: Workflow, opts: EngineOptions): Promise<void> {
  const runId = opts.runId ?? `run_${Date.now().toString(36)}`;
  opts.emit({ type: "run-start", runId });
  const gate = new Gate(opts.runId, opts);
  let browser: { session: BrowserSession; ephemeral: boolean } | null = null;
  try {
    const { key } = await resolveApiKey(opts.user);
    const needsFirecrawl = hasWebStep(workflow.steps);
    if (needsFirecrawl && !key) {
      opts.emit({
        type: "error",
        message:
          "No Firecrawl API key — set FIRECRAWL_API_KEY in the server environment, or save a key " +
          "in the module's Connection panel."
      });
      return;
    }
    const needsAssistant = hasAnalyzeStep(workflow.steps);
    const assistant = needsAssistant ? await resolveAssistant(opts.user) : null;
    const ensureBrowser = async (): Promise<BrowserSession> => {
      if (!browser) browser = await acquireBrowser(opts);
      return browser.session;
    };

    // Run-from-here skips the earlier steps: the started step opens with no
    // previous output, exactly like being the first card.
    const startAt = clamp(opts.startAt ?? 0, 0, Math.max(workflow.steps.length - 1, 0));
    let current: StepOutput | null = null;
    for (let i = startAt; i < workflow.steps.length; i++) {
      if (opts.signal.aborted) return;
      await gate.wait();
      if (opts.signal.aborted) return;
      const step = workflow.steps[i];
      const path = String(i);
      opts.emit({ type: "step-start", path, stepId: step.id, label: step.kind });
      switch (step.kind) {
        case "search":
          current = await runSearch(step, key as string, opts.signal);
          break;
        case "scrape":
          current = await runScrapeStep(step, current, key as string, opts, path);
          break;
        case "map":
          current = await runMap(step, key as string, opts.signal);
          break;
        case "analyze":
          current = await runAnalyze(step, current, assistant as Assistant, opts, path);
          break;
        case "loop":
          current = await runLoop(step, current, key as string, assistant as Assistant, opts, path);
          break;
        case "links":
          current = await runLinksStep(step, current, await ensureBrowser(), gate, opts, path);
          break;
        case "paginate":
          current = await runPaginateStep(step, current, await ensureBrowser(), gate, opts, path);
          break;
        case "foreach":
          current = await runForeachStep(step, current, await ensureBrowser(), gate, opts, path);
          break;
        case "record":
          current = await runRecordStep(step, await ensureBrowser(), gate, opts, path);
          break;
      }
      opts.emit({ type: "step-done", path, output: current, summary: summaryOf(current) });
    }
    opts.emit({ type: "done", output: current });
  } catch (err) {
    if (!opts.signal.aborted) opts.emit({ type: "error", message: messageOf(err) });
  } finally {
    // An ephemeral (unwatched) browser dies with its run; a client session
    // stays — the viewer pane is still looking at it.
    if (browser !== null && (browser as { ephemeral: boolean }).ephemeral) {
      await closeSession((browser as { session: BrowserSession }).session.id).catch(() => {});
    }
  }
}

function hasWebStep(steps: readonly WorkflowStep[]): boolean {
  return steps.some(
    (s) =>
      s.kind === "search" ||
      s.kind === "scrape" ||
      s.kind === "map" ||
      (s.kind === "loop" && s.steps.some((inner) => inner.kind === "scrape"))
  );
}

function hasAnalyzeStep(steps: readonly WorkflowStep[]): boolean {
  return steps.some(
    (s) => s.kind === "analyze" || (s.kind === "loop" && s.steps.some((inner) => inner.kind === "analyze"))
  );
}
