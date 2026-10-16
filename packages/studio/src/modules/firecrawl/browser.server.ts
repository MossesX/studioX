/**
 * @file The live browser — **Node-only**, Playwright underneath.
 *
 * This is the half of the firecrawl module that OWNS a real Chromium: the
 * crawler's watchable steps (`links` / `paginate` / `foreach` / `record`) and
 * the Recorder tab both drive pages through here. The design is a remote
 * desktop, not an iframe: the server holds the page, streams JPEG frames out
 * as `BrowserEvent`s, and the client posts actions back in. That shape is
 * what makes recording trivial — every user gesture already passes through
 * `act()`, so recording is just keeping the list.
 *
 * ## Sessions
 *
 * One shared Chromium process, one BrowserContext+Page per session. Sessions
 * live in a `globalThis` registry so Next's dev-mode HMR does not strand a
 * running browser behind a re-evaluated module. Idle sessions are closed
 * after `IDLE_MS`; a closed session's viewers get a `closed` event.
 *
 * ## Frames
 *
 * A pump per session screenshots at ~`fps` while at least one viewer is
 * attached (nobody watching = no CPU spent). Frames are JPEG q55 — a 1280×800
 * page is ~40 KB, fine for the localhost NDJSON stream this rides.
 *
 * ## Clicks record BOTH a selector and coordinates
 *
 * Before a click lands, the element under the point is resolved to a CSS
 * selector + human label in-page. Replay prefers the selector (survives
 * layout shift) and falls back to the coordinates (survives selector rot).
 *
 * ## Run control
 *
 * The pause/resume/speed/stop registry for live runs also lives here (same
 * globalThis rule). The engine calls `gate()` between actions; the control
 * route flips the flags. Stop aborts the control's own AbortController, which
 * the run route has merged into the engine's signal.
 */
import type { Browser, BrowserContext, Locator, Page } from "playwright";

import type { BrowserAction, BrowserEvent, FireDoc, PaginateStep } from "./types";

/* ── the registries (HMR-proof) ──────────────────────────────────────────── */

export interface BrowserSession {
  readonly id: string;
  context: BrowserContext;
  page: Page;
  viewers: Set<(event: BrowserEvent) => void>;
  /** Action log while recording; null = not recording. */
  recording: BrowserAction[] | null;
  recordingPaused: boolean;
  recordingStartedAt: number;
  recordingStartUrl: string;
  pump: ReturnType<typeof setInterval> | null;
  capturing: boolean;
  fps: number;
  closed: boolean;
  lastUsed: number;
}

export interface RunControl {
  paused: boolean;
  delayMs: number;
  readonly controller: AbortController;
  createdAt: number;
}

interface Registry {
  browser: Promise<Browser> | null;
  sessions: Map<string, BrowserSession>;
  /** Sessions mid-creation — the single-flight lock. The viewer's GET and
   *  the engine's POST open the same id near-simultaneously; without this,
   *  both create a page and the pump streams the loser. */
  opening: Map<string, Promise<BrowserSession>>;
  controls: Map<string, RunControl>;
  janitor: ReturnType<typeof setInterval> | null;
}

const g = globalThis as typeof globalThis & { __axfFirecrawlBrowser?: Registry };
const REG: Registry = (g.__axfFirecrawlBrowser ??= {
  browser: null,
  sessions: new Map(),
  opening: new Map(),
  controls: new Map(),
  janitor: null
});
// A registry stashed by an older module evaluation may predate `opening`.
REG.opening ??= new Map();

const IDLE_MS = 10 * 60 * 1000;
const VIEWPORT = { width: 1280, height: 800 };
const MAX_LINKS = 2000;

function ensureJanitor(): void {
  if (REG.janitor) return;
  REG.janitor = setInterval(() => {
    const now = Date.now();
    for (const session of REG.sessions.values()) {
      if (session.viewers.size === 0 && now - session.lastUsed > IDLE_MS) {
        void closeSession(session.id);
      }
    }
    for (const [runId, control] of REG.controls) {
      if (now - control.createdAt > 6 * 60 * 60 * 1000) REG.controls.delete(runId);
    }
  }, 60 * 1000);
  // Never keep the process alive just to sweep.
  REG.janitor.unref?.();
}

async function getBrowser(): Promise<Browser> {
  if (!REG.browser) {
    REG.browser = (async () => {
      // Dynamic import so the module (and every route importing it) loads
      // even before `npm install playwright` has run — the failure is a
      // readable error on first use, not a broken build.
      const { chromium } = await import("playwright");
      return chromium.launch({ headless: true });
    })();
    REG.browser.catch(() => {
      REG.browser = null;
    });
  }
  return REG.browser;
}

/* ── session lifecycle ───────────────────────────────────────────────────── */

export async function openSession(id: string): Promise<BrowserSession> {
  const existing = REG.sessions.get(id);
  if (existing && !existing.closed) {
    existing.lastUsed = Date.now();
    return existing;
  }
  const pending = REG.opening.get(id);
  if (pending) return pending;
  const creating = createSession(id).finally(() => {
    REG.opening.delete(id);
  });
  REG.opening.set(id, creating);
  return creating;
}

async function createSession(id: string): Promise<BrowserSession> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    // A believable UA keeps the sites the owner automates from serving the
    // "unsupported browser" page to the recorder.
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/131.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();
  const session: BrowserSession = {
    id,
    context,
    page,
    viewers: new Set(),
    recording: null,
    recordingPaused: false,
    recordingStartedAt: 0,
    recordingStartUrl: "",
    pump: null,
    capturing: false,
    fps: 2,
    closed: false,
    lastUsed: Date.now()
  };
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    void page
      .title()
      .catch(() => "")
      .then((title) => broadcast(session, { type: "nav", url: frame.url(), title }));
  });
  page.on("close", () => {
    if (!session.closed) void closeSession(session.id);
  });
  REG.sessions.set(id, session);
  ensureJanitor();
  return session;
}

export function getSession(id: string): BrowserSession | null {
  const session = REG.sessions.get(id);
  return session && !session.closed ? session : null;
}

export async function closeSession(id: string): Promise<void> {
  const session = REG.sessions.get(id);
  if (!session) return;
  session.closed = true;
  if (session.pump) clearInterval(session.pump);
  session.pump = null;
  broadcast(session, { type: "closed" });
  session.viewers.clear();
  REG.sessions.delete(id);
  await session.context.close().catch(() => {});
}

function broadcast(session: BrowserSession, event: BrowserEvent): void {
  for (const emit of session.viewers) {
    try {
      emit(event);
    } catch {
      // A viewer whose stream already closed drops off on its own.
    }
  }
}

/* ── frames ──────────────────────────────────────────────────────────────── */

async function captureFrame(session: BrowserSession): Promise<void> {
  if (session.capturing || session.closed || session.viewers.size === 0) return;
  session.capturing = true;
  try {
    const [buffer, title] = await Promise.all([
      session.page.screenshot({ type: "jpeg", quality: 55, timeout: 4000 }),
      session.page.title().catch(() => "")
    ]);
    broadcast(session, {
      type: "frame",
      data: buffer.toString("base64"),
      url: session.page.url(),
      title,
      w: VIEWPORT.width,
      h: VIEWPORT.height
    });
  } catch {
    // Mid-navigation screenshots fail routinely; the next tick catches up.
  } finally {
    session.capturing = false;
  }
}

function ensurePump(session: BrowserSession): void {
  if (session.pump || session.closed) return;
  session.pump = setInterval(() => void captureFrame(session), Math.round(1000 / session.fps));
  session.pump.unref?.();
}

/** Attach a viewer — returns the detach function. */
export function attachViewer(session: BrowserSession, emit: (event: BrowserEvent) => void): () => void {
  session.viewers.add(emit);
  session.lastUsed = Date.now();
  emit({
    type: "hello",
    sessionId: session.id,
    url: session.page.url(),
    title: "",
    recording: session.recording !== null && !session.recordingPaused,
    actionCount: session.recording?.length ?? 0
  });
  ensurePump(session);
  void captureFrame(session);
  return () => {
    session.viewers.delete(emit);
    session.lastUsed = Date.now();
    if (session.viewers.size === 0 && session.pump) {
      clearInterval(session.pump);
      session.pump = null;
    }
  };
}

/** One immediate frame — the engine calls this after slow-mo actions so the
 *  viewer sees the state the step just produced, whatever the fps. */
export async function pushFrame(session: BrowserSession): Promise<void> {
  await captureFrame(session);
}

/* ── in-page helpers ─────────────────────────────────────────────────────── */

/**
 * The in-page halves — REAL functions, serialized by Playwright and invoked
 * with their argument in the page. (String scripts were tried first and
 * evaluated as expressions, which silently drops the argument — real
 * functions are the shape `evaluate` guarantees to call.)
 */

/** Resolve the element at a point to `{ selector, label }` — runs in-page. */
function pageResolveAtPoint(point: { x: number; y: number }): { selector: string; label: string } | null {
  const el = document.elementFromPoint(point.x, point.y);
  if (!el) return null;
  const labelOf = (node: Element): string => {
    const text =
      node.getAttribute("aria-label") ||
      node.getAttribute("title") ||
      node.getAttribute("alt") ||
      node.getAttribute("placeholder") ||
      ((node as HTMLElement).innerText || (node as HTMLInputElement).value || "").trim();
    return String(text || node.tagName || "").replace(/\s+/g, " ").slice(0, 60);
  };
  const cssEscape = (s: string): string =>
    window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  const segment = (node: Element): string => {
    if (node.id) return "#" + cssEscape(node.id);
    let seg = node.tagName.toLowerCase();
    if (node.parentElement) {
      const same = Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName);
      if (same.length > 1) seg += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
    }
    return seg;
  };
  const path: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && node.tagName !== "HTML" && depth < 6; depth += 1) {
    const seg = segment(node);
    path.unshift(seg);
    if (seg.startsWith("#")) break;
    node = node.parentElement;
  }
  return { selector: path.join(" > "), label: labelOf(el) };
}

/** Tag + collect anchors in scope; injects the highlight style — runs in-page. */
function pageCollectLinks(opts: { selector: string; max: number }): string[] {
  if (!document.getElementById("__axf-hl-style")) {
    const style = document.createElement("style");
    style.id = "__axf-hl-style";
    style.textContent =
      ".__axf-hl { outline: 3px solid #ff7a1a !important; outline-offset: 2px; " +
      "background: rgba(255,122,26,.18) !important; transition: outline-color .15s; } " +
      ".__axf-hl-done { outline: 2px solid rgba(255,122,26,.45) !important; outline-offset: 2px; }";
    document.documentElement.appendChild(style);
  }
  const scope: ArrayLike<ParentNode> = opts.selector
    ? document.querySelectorAll(opts.selector)
    : [document];
  const seen = new Set<string>();
  const out: string[] = [];
  let index = 0;
  for (const root of Array.from(scope)) {
    const anchors = Array.from(root.querySelectorAll("a[href]"));
    for (const a of anchors) {
      let href = "";
      try {
        href = new URL(a.getAttribute("href") ?? "", location.href).toString();
      } catch {
        continue;
      }
      if (!/^https?:/i.test(href) || seen.has(href)) continue;
      seen.add(href);
      a.setAttribute("data-axf-link", String(index));
      out.push(href);
      index += 1;
      if (out.length >= opts.max) return out;
    }
  }
  return out;
}

/** Sweep the highlight onto the i-th tagged anchor — runs in-page. */
function pageHighlightNth(i: number): void {
  const el = document.querySelector('[data-axf-link="' + i + '"]');
  if (!el) return;
  for (const prev of Array.from(document.querySelectorAll(".__axf-hl"))) {
    prev.classList.remove("__axf-hl");
    prev.classList.add("__axf-hl-done");
  }
  el.classList.add("__axf-hl");
  (el as HTMLElement).scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
}

function toRegex(filter: string): RegExp | null {
  const trimmed = filter.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) {
    const end = trimmed.lastIndexOf("/");
    try {
      return new RegExp(trimmed.slice(1, end), trimmed.slice(end + 1));
    } catch {
      // Fall through to substring.
    }
  }
  return new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

export interface ExtractOptions {
  readonly selector: string;
  readonly filter: string;
  /** Per-link highlight dwell, ms. 0 = flash through without sleeping. */
  readonly delayMs: number;
  readonly highlight: boolean;
  readonly onLink?: (href: string, index: number, total: number) => void | Promise<void>;
  readonly signal?: AbortSignal;
  /** Awaited per link when given — the engine threads its pause/slow-mo gate
   *  through here, so Pause takes hold MID-sweep and the speed slider acts
   *  live. Supersedes `delayMs`. */
  readonly gate?: () => Promise<void>;
}

/**
 * Harvest the links on the CURRENT page, optionally sweeping the highlight
 * over each one so the viewer can watch the pass. Returns filtered hrefs.
 */
export async function extractLinks(session: BrowserSession, opts: ExtractOptions): Promise<string[]> {
  session.lastUsed = Date.now();
  const all = (await session.page.evaluate(pageCollectLinks, {
    selector: opts.selector.trim(),
    max: MAX_LINKS
  })) as string[];
  const regex = toRegex(opts.filter);
  const kept: string[] = [];
  for (let i = 0; i < all.length; i += 1) {
    if (opts.signal?.aborted) break;
    const href = all[i];
    const matches = regex ? regex.test(href) : true;
    if (opts.highlight && (matches || opts.delayMs > 0)) {
      await session.page.evaluate(pageHighlightNth, i).catch(() => {});
    }
    if (matches) {
      kept.push(href);
      await opts.onLink?.(href, i, all.length);
    }
    if (opts.gate) await opts.gate();
    else if (opts.delayMs > 0) await sleep(Math.min(opts.delayMs, 3000));
  }
  return kept;
}

/** Snapshot the current page as a FireDoc (title, text, links). */
export async function snapshotPage(session: BrowserSession): Promise<FireDoc> {
  session.lastUsed = Date.now();
  const page = session.page;
  const [title, text, links] = await Promise.all([
    page.title().catch(() => ""),
    page
      .evaluate("document.body ? document.body.innerText : \"\"")
      .then((t) => String(t ?? ""))
      .catch(() => ""),
    page
      .evaluate(pageCollectLinks, { selector: "", max: 500 })
      .then((l) => l as string[])
      .catch(() => [] as string[])
  ]);
  return {
    url: page.url(),
    title: title || undefined,
    markdown: text.replace(/\n{3,}/g, "\n\n").slice(0, 20000),
    links
  };
}

/* ── resolving a control from a plain entry ──────────────────────────────── */

export type NextMatch = PaginateStep["nextMatch"];

/** Escape a value for use inside a double-quoted CSS attribute selector. */
function attrEsc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** The first VISIBLE match of a locator (capped scan), or null. A locator
 *  whose selector is invalid for this strategy (a stray char read as CSS)
 *  rejects on count() and is treated as "no match", not an error. */
async function firstVisible(loc: Locator): Promise<Locator | null> {
  try {
    const n = await loc.count();
    for (let i = 0; i < Math.min(n, 8); i += 1) {
      const one = loc.nth(i);
      if (await one.isVisible().catch(() => false)) return one;
    }
  } catch {
    // Not a valid selector under this interpretation — skip it.
  }
  return null;
}

/**
 * Resolve the pagination "next" control from a plain entry a user typed —
 * its visible TEXT ("Next", "Older posts", "›"), an id, a class, a tag/`name`,
 * or a CSS selector — to a clickable Locator, or null when nothing on the page
 * matches (which the walk reads as "the pagination group ended"). "auto" tries
 * the interpretations in the order a person most likely meant them: a real CSS
 * selector first, then the visible text, then id / class / tag.
 */
export async function findNextControl(
  session: BrowserSession,
  entry: string,
  match: NextMatch
): Promise<Locator | null> {
  session.lastUsed = Date.now();
  const page = session.page;
  const value = entry.trim();
  if (!value) return null;

  const byText = (): Locator[] => [
    page.getByRole("link", { name: value, exact: false }),
    page.getByRole("button", { name: value, exact: false }),
    page.locator(`a:has-text("${attrEsc(value)}"), button:has-text("${attrEsc(value)}")`),
    page.getByText(value, { exact: false })
  ];
  const byId = (): Locator[] => [page.locator(`[id="${attrEsc(value)}"]`)];
  const byClass = (): Locator[] => [page.locator(`[class~="${attrEsc(value)}"]`)];
  const byTag = (): Locator[] => [page.locator(value), page.locator(`[name="${attrEsc(value)}"]`)];
  const byCss = (): Locator[] => [page.locator(value)];

  const plan: Record<NextMatch, () => Locator[]> = {
    text: byText,
    id: byId,
    class: byClass,
    tag: byTag,
    css: byCss,
    auto: () => [...byCss(), ...byText(), ...byId(), ...byClass()]
  };

  for (const loc of plan[match]()) {
    const hit = await firstVisible(loc);
    if (hit) return hit;
  }
  return null;
}

/** Outline an element in the live view (best-effort) so a watcher sees what
 *  the walk is about to click. Reuses the link-sweep highlight style. */
export async function highlightLocator(loc: Locator): Promise<void> {
  try {
    await loc.evaluate((el) => {
      if (!document.getElementById("__axf-hl-style")) {
        const style = document.createElement("style");
        style.id = "__axf-hl-style";
        style.textContent =
          ".__axf-hl{outline:3px solid #ff7a1a!important;outline-offset:2px;" +
          "background:rgba(255,122,26,.18)!important;}";
        document.documentElement.appendChild(style);
      }
      for (const prev of Array.from(document.querySelectorAll(".__axf-hl"))) {
        prev.classList.remove("__axf-hl");
      }
      (el as HTMLElement).classList.add("__axf-hl");
      (el as HTMLElement).scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    });
  } catch {
    // Purely a visual aid — never let it break the walk.
  }
}

export type ConditionType = "always" | "selector" | "text" | "regex" | "url";

/** Evaluate a keep/drop condition against the current page. */
export async function checkCondition(
  session: BrowserSession,
  type: ConditionType,
  value: string,
  negate: boolean
): Promise<boolean> {
  let hit = true;
  const v = value.trim();
  switch (type) {
    case "always":
      hit = true;
      break;
    case "selector":
      hit = v ? (await session.page.$(v).catch(() => null)) !== null : true;
      break;
    case "text": {
      const text = String(
        await session.page.evaluate("document.body ? document.body.innerText : \"\"").catch(() => "")
      );
      hit = v ? text.toLowerCase().includes(v.toLowerCase()) : true;
      break;
    }
    case "regex": {
      const regex = toRegex(v.startsWith("/") ? v : `/${v}/i`);
      const text = String(
        await session.page.evaluate("document.body ? document.body.innerText : \"\"").catch(() => "")
      );
      hit = regex ? regex.test(text) : true;
      break;
    }
    case "url": {
      const regex = toRegex(v);
      hit = regex ? regex.test(session.page.url()) : true;
      break;
    }
  }
  return negate ? !hit : hit;
}

/* ── actions ─────────────────────────────────────────────────────────────── */

export async function gotoUrl(session: BrowserSession, url: string): Promise<void> {
  session.lastUsed = Date.now();
  await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await session.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
}

/**
 * Execute one browser action. Returns the action ENRICHED (clicks gain the
 * resolved selector + label) — that enriched form is what gets recorded and
 * what the action log shows.
 */
export async function act(session: BrowserSession, action: BrowserAction): Promise<BrowserAction> {
  session.lastUsed = Date.now();
  const page = session.page;
  let enriched: BrowserAction = action;
  switch (action.kind) {
    case "goto":
      if (action.url) await gotoUrl(session, normalizeUrl(action.url));
      enriched = { ...action, url: normalizeUrl(action.url ?? ""), label: `go to ${action.url}` };
      break;
    case "click":
    case "dblclick": {
      let resolved: { selector: string; label: string } | null = null;
      if (typeof action.x === "number" && typeof action.y === "number") {
        resolved = (await page
          .evaluate(pageResolveAtPoint, { x: action.x, y: action.y })
          .catch(() => null)) as { selector: string; label: string } | null;
        await page.mouse.click(action.x, action.y, {
          clickCount: action.kind === "dblclick" ? 2 : 1
        });
      } else if (action.selector) {
        await page.click(action.selector, { timeout: 5000 });
      }
      enriched = {
        ...action,
        selector: action.selector ?? resolved?.selector,
        label: `${action.kind} ${resolved?.label ? `'${resolved.label}'` : action.selector ?? `(${action.x}, ${action.y})`}`
      };
      break;
    }
    case "type":
      if (action.text) await page.keyboard.type(action.text, { delay: 20 });
      enriched = { ...action, label: `type "${(action.text ?? "").slice(0, 40)}"` };
      break;
    case "press":
      if (action.key) await page.keyboard.press(action.key);
      enriched = { ...action, label: `press ${action.key}` };
      break;
    case "scroll":
      await page.mouse.wheel(action.dx ?? 0, action.dy ?? 0);
      enriched = { ...action, label: `scroll ${Math.round(action.dy ?? 0)}` };
      break;
    case "back":
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      enriched = { ...action, label: "back" };
      break;
    case "forward":
      await page.goForward({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      enriched = { ...action, label: "forward" };
      break;
    case "reload":
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      enriched = { ...action, label: "reload" };
      break;
    case "wait":
      await sleep(Math.min(action.ms ?? 500, 15000));
      enriched = { ...action, label: `wait ${action.ms ?? 500}ms` };
      break;
  }
  if (session.recording && !session.recordingPaused) {
    const at = Date.now() - session.recordingStartedAt;
    session.recording.push({ ...enriched, at });
    broadcast(session, { type: "recording", on: true, count: session.recording.length });
  }
  broadcast(session, { type: "action", action: enriched });
  await pushFrame(session);
  return enriched;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/* ── recording ───────────────────────────────────────────────────────────── */

export function startRecording(session: BrowserSession): void {
  session.recording = [];
  session.recordingPaused = false;
  session.recordingStartedAt = Date.now();
  session.recordingStartUrl = session.page.url();
  broadcast(session, { type: "recording", on: true, count: 0 });
}

export function pauseRecording(session: BrowserSession, paused: boolean): void {
  if (!session.recording) return;
  session.recordingPaused = paused;
  broadcast(session, { type: "recording", on: !paused, count: session.recording.length });
}

/** Stop and hand back what was captured — the CLIENT saves it to the store. */
export function stopRecording(session: BrowserSession): { startUrl: string; actions: BrowserAction[] } {
  const actions = session.recording ?? [];
  const startUrl = session.recordingStartUrl;
  session.recording = null;
  session.recordingPaused = false;
  broadcast(session, { type: "recording", on: false, count: actions.length });
  return { startUrl, actions };
}

export interface ReplayOptions {
  /** Pacing between actions, ms; falls back to the recorded rhythm capped at 2s. */
  readonly delayMs: number | null;
  readonly signal?: AbortSignal;
  readonly onAction?: (action: BrowserAction, index: number, total: number) => void | Promise<void>;
  /** Await between actions — the engine threads its pause/speed gate through. */
  readonly gate?: () => Promise<void>;
}

/** Replay a recorded action chain on the session's page. */
export async function replayActions(
  session: BrowserSession,
  startUrl: string,
  actions: readonly BrowserAction[],
  opts: ReplayOptions
): Promise<void> {
  if (startUrl) await gotoUrl(session, startUrl);
  await pushFrame(session);
  let prevAt = 0;
  for (let i = 0; i < actions.length; i += 1) {
    if (opts.signal?.aborted) return;
    await opts.gate?.();
    const action = actions[i];
    const pace =
      opts.delayMs !== null
        ? opts.delayMs
        : Math.min(Math.max((action.at ?? 0) - prevAt, 120), 2000);
    prevAt = action.at ?? prevAt;
    if (pace > 0) await sleep(pace);
    await opts.onAction?.(action, i, actions.length);
    try {
      await replayOne(session, action);
    } catch {
      // Selector rot or a dead control — try the coordinate fallback once,
      // then keep walking; a recording is a script, not a transaction.
      if (
        (action.kind === "click" || action.kind === "dblclick") &&
        typeof action.x === "number" &&
        typeof action.y === "number"
      ) {
        await session.page.mouse
          .click(action.x, action.y, { clickCount: action.kind === "dblclick" ? 2 : 1 })
          .catch(() => {});
      }
    }
    await pushFrame(session);
  }
}

async function replayOne(session: BrowserSession, action: BrowserAction): Promise<void> {
  const page = session.page;
  switch (action.kind) {
    case "click":
    case "dblclick":
      if (action.selector) {
        await page.click(action.selector, {
          timeout: 5000,
          clickCount: action.kind === "dblclick" ? 2 : 1
        });
      } else if (typeof action.x === "number" && typeof action.y === "number") {
        await page.mouse.click(action.x, action.y, {
          clickCount: action.kind === "dblclick" ? 2 : 1
        });
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      break;
    default:
      await act(session, action);
      return;
  }
  await pushFrame(session);
}

/* ── run control ─────────────────────────────────────────────────────────── */

export function registerRun(runId: string, delayMs: number): RunControl {
  const control: RunControl = {
    paused: false,
    delayMs: Math.max(0, Math.min(delayMs, 10000)),
    controller: new AbortController(),
    createdAt: Date.now()
  };
  REG.controls.set(runId, control);
  return control;
}

export function getRunControl(runId: string): RunControl | null {
  return REG.controls.get(runId) ?? null;
}

export function unregisterRun(runId: string): void {
  REG.controls.delete(runId);
}

export function controlRun(runId: string, op: "pause" | "resume" | "stop" | "speed", value?: number): boolean {
  const control = REG.controls.get(runId);
  if (!control) return false;
  switch (op) {
    case "pause":
      control.paused = true;
      break;
    case "resume":
      control.paused = false;
      break;
    case "stop":
      control.controller.abort();
      break;
    case "speed":
      control.delayMs = Math.max(0, Math.min(typeof value === "number" ? value : 0, 10000));
      break;
  }
  return true;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
