/**
 * `node scripts/geometry-probe.mjs [route ...]` — the pane renderer's gate:
 * "a split pane renders at correct sizes on first paint, proven by the probe,
 * not by eye" (axf-claude P2).
 *
 * Descended from GizmoX's `build/verify/layout-driven/geometry-probe.mjs`, but
 * it CHECKS rather than prints, because the failure it exists to catch —
 * GizmoX's LayoutRenderer prorating weights against an unmeasured (zero)
 * extent and latching every split at its minimum — looked deliberate on
 * screen. Five assertions per route, exit 1 on any miss:
 *
 *   1. **Rendered CSS matches the model.** For every `[data-axf-split]`, each
 *      child's measured share of the children's total extent is within
 *      tolerance of its stamped `data-axf-fraction`.
 *   2. **The model matches the declaration.** On the `?fresh` pass (no
 *      storageKey, so no latch can apply) every stamped fraction equals its
 *      `data-axf-declared` — a renderer silently latching minimums cannot
 *      pass this while weights are unequal.
 *   3. **Rendering does not latch.** The default route is loaded twice and
 *      must measure identically — a renderer that persists from mount writes
 *      on pass one and betrays itself on pass two. `data-axf-measured` must
 *      also be "1" everywhere: the observer really ran, this is not a
 *      zero-sized fake.
 *   4. **A measured interaction DOES latch, server-side, and survives a
 *      reload.** Assertions 1-3 are all about what must NOT happen, and a
 *      renderer with persistence entirely unwired passes every one of them —
 *      which is exactly what this file used to permit: on 2026-08-13 the gate
 *      was green while no `panes.<key>.json` had ever been written under any
 *      user directory of `data/axf/kv`, so the whole PaneLayout → httpKv →
 *      /api/axf/kv → KvStore → disk chain the P3 workspace depends on was
 *      entirely unproven. So the probe now
 *      drives a REAL drag over CDP (a trusted pointer sequence, which is what
 *      the renderer's "pixels enter only at an interaction that measures
 *      itself" rule requires), then checks that the split moved, that the
 *      latch landed as a FILE on the server rather than in the browser, and
 *      that a reload comes back to the dragged geometry. It restores the
 *      namespace afterwards — captured before, PUT back after, DELETEd when
 *      there was nothing there — because a probe that permanently retunes its
 *      own fixture is measuring its own exhaust on the next run.
 *   5. **The children FILL their split.** Sum of child extents plus gutters
 *      equals the split's own extent, within 2px. Assertions 1-4 all compare
 *      shares WITHIN a split, and that is not the same as filling it: a
 *      subtree that collapses uniformly keeps its ratio and sails through
 *      every one of them. Found by mutation on 2026-08-13 — GizmoX's bug was
 *      re-injected on purpose (prorate against an extent read during render,
 *      clamp at the minimum) and the gate stayed GREEN with `tools`/`library`
 *      filling 240px of a 668px container at a tidy 50/50. A pane latched at
 *      its minimum is the one failure this file was built to catch, so the
 *      slack it leaves is measured directly rather than inferred from ratios.
 *
 * Every assertion here has been watched to fail on a deliberate mutation
 * (2026-08-13, `axf-claude` P2): persistence unwired → 4 red; the LayoutRenderer
 * bug re-injected → 5 red. A guard nobody has watched fail is a guard nobody
 * has tested, and this file has been on both sides of that.
 *
 * Zero dependencies: Chrome is driven over raw CDP with Node ≥22's global
 * `WebSocket` and `fetch` — no playwright, per the no-new-deps rule. Chrome
 * path from `AXF_CHROME` or the standard install. Touches no source files and
 * uses a throwaway profile; safe against a shared dev server.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The ONLY thing borrowed from the shared helper — see `lib/cdp.mjs`. This
// probe keeps its own CDP class; the session token has exactly one spelling.
import { signIn } from "./lib/cdp.mjs";

const BASE = process.env.AXF_BASE ?? "http://localhost:3200";
const CHROME = process.env.AXF_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TOLERANCE = 0.02; // measured-vs-model share, absolute
/** How far the drag pass pushes the first gutter. Large enough that no
 *  tolerance can hide it, small enough to stay clear of every declared
 *  minSize on the fixture — a drag clamped at a floor proves nothing. */
const DRAG_PX = 120;
/** Where the host's kv driver puts its files. The drag pass reads this
 *  directly: "server-side, not localStorage" is a P2 requirement, and the only
 *  way to prove a browser did not keep the value to itself is to find the
 *  bytes outside the browser. */
const KV_ROOT = path.join(process.cwd(), "data", "axf", "kv");
const routes = process.argv.slice(2);
if (routes.length === 0) routes.push("/sandbox/panes");

/* ----------------------------- CDP plumbing ------------------------------- */

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "axf-probe-"));
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--window-size=1600,1000",
      "about:blank"
    ],
    { stdio: "ignore" }
  );
  const portFile = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 30_000;
  while (!fs.existsSync(portFile) || fs.readFileSync(portFile, "utf8").split("\n")[0] === "") {
    if (Date.now() > deadline) throw new Error("Chrome never wrote DevToolsActivePort");
    await new Promise((r) => setTimeout(r, 100));
  }
  const port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]);
  return { child, profile, port };
}

class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();
  #events = [];

  static async connect(url) {
    const cdp = new Cdp();
    cdp.#ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener("open", resolve, { once: true });
      cdp.#ws.addEventListener("error", () => reject(new Error(`cannot connect ${url}`)), { once: true });
    });
    cdp.#ws.addEventListener("message", (e) => {
      const msg = JSON.parse(typeof e.data === "string" ? e.data : e.data.toString());
      if (msg.id && cdp.#pending.has(msg.id)) {
        const { resolve, reject } = cdp.#pending.get(msg.id);
        cdp.#pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        cdp.#events.push(msg);
      }
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  async waitEvent(method, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.#events.findIndex((e) => e.method === method);
      if (i >= 0) return this.#events.splice(i, 1)[0];
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${method}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  close() {
    this.#ws.close();
  }
}

/* ------------------------------ measurement ------------------------------- */

/** Runs in the page: every split with its children's boxes and stamps. */
const MEASURE_JS = `(() => {
  const roots = [...document.querySelectorAll("[data-axf-panes]")].map((el) => ({
    key: el.getAttribute("data-axf-panes"),
    measured: el.getAttribute("data-axf-measured")
  }));
  const splits = [...document.querySelectorAll("[data-axf-split]")].map((el) => {
    const row = el.getAttribute("data-axf-direction") === "row";
    const own = el.getBoundingClientRect();
    const gutters = [...el.children]
      .filter((c) => c.hasAttribute("data-axf-gutter"))
      .reduce((sum, c) => {
        const r = c.getBoundingClientRect();
        return sum + (row ? r.width : r.height);
      }, 0);
    const children = [...el.children]
      .filter((c) => c.hasAttribute("data-axf-fraction"))
      .map((c) => {
        const r = c.getBoundingClientRect();
        const pane = c.querySelector("[data-axf-pane]");
        return {
          px: row ? r.width : r.height,
          fraction: Number(c.getAttribute("data-axf-fraction")),
          declared: Number(c.getAttribute("data-axf-declared")),
          pane: pane ? pane.getAttribute("data-axf-pane") : null,
          min: pane ? Number(pane.getAttribute("data-axf-min")) : null
        };
      });
    return {
      path: el.getAttribute("data-axf-split"),
      row,
      extent: row ? own.width : own.height,
      gutters,
      children
    };
  });
  return JSON.stringify({ roots, splits });
})()`;

/** Evaluate in the page, awaiting a promise when the expression is one. */
async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? "page evaluation threw");
  return result.value;
}

/** Measure the page as it stands — no navigation, so the drag pass can look
 *  at the same document it just interacted with. */
async function snapshot(cdp) {
  return JSON.parse(await evaluate(cdp, MEASURE_JS));
}

async function measure(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await cdp.waitEvent("Page.loadEventFired");
  await new Promise((r) => setTimeout(r, 1200)); // hydration + observer settle
  return snapshot(cdp);
}

/* -------------------------------- checks ---------------------------------- */

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};

function report(info) {
  for (const split of info.splits) {
    const total = split.children.reduce((a, c) => a + c.px, 0);
    console.log(`  split ${split.path} (${split.row ? "row" : "column"})  ${Math.round(total)}px`);
    for (const c of split.children) {
      const share = total > 0 ? c.px / total : 0;
      console.log(
        `    ${(c.pane ?? "(split)").padEnd(12)} ${String(Math.round(c.px)).padStart(5)}px` +
          `  share ${(share * 100).toFixed(1)}%  model ${(c.fraction * 100).toFixed(1)}%` +
          `  declared ${(c.declared * 100).toFixed(1)}%`
      );
    }
  }
}

function checkRenderedMatchesModel(info, label) {
  if (info.splits.length === 0) fail(`${label}: no [data-axf-split] on the page`);
  for (const root of info.roots) {
    if (root.measured !== "1") fail(`${label}: root "${root.key}" never measured a real extent`);
  }
  for (const split of info.splits) {
    const total = split.children.reduce((a, c) => a + c.px, 0);
    if (!(total > 0)) {
      fail(`${label}: split ${split.path} has zero extent`);
      continue;
    }
    // Assertion 5 — the children must FILL the split. Everything above this
    // line compares shares WITHIN a split, and a subtree that collapses
    // uniformly keeps its ratio: on 2026-08-13 a deliberate re-injection of
    // GizmoX's bug (prorate against an extent read during render, clamp at the
    // minimum) left `tools`/`library` filling 240px of a 668px container,
    // still 50/50, and every assertion passed. A pane latched at its minimum
    // is the exact failure this file exists to catch, so the slack it leaves
    // is now the thing that is measured.
    const filled = total + split.gutters;
    if (Math.abs(filled - split.extent) > 2) {
      fail(
        `${label}: split ${split.path} is ${Math.round(split.extent)}px but its children + gutters` +
          ` cover ${Math.round(filled)}px — ${filled < split.extent ? "something is latched below its share" : "the children overflow their split"}`
      );
    }
    for (const c of split.children) {
      const share = c.px / total;
      if (Math.abs(share - c.fraction) > TOLERANCE) {
        fail(
          `${label}: split ${split.path} child ${c.pane ?? "(split)"} renders ${(share * 100).toFixed(1)}%` +
            ` but the model says ${(c.fraction * 100).toFixed(1)}% — rendered CSS disagrees with the model`
        );
      }
    }
  }
}

function checkModelMatchesDeclared(info, label) {
  for (const split of info.splits) {
    for (const c of split.children) {
      if (Math.abs(c.fraction - c.declared) > 0.0001) {
        fail(
          `${label}: split ${split.path} child ${c.pane ?? "(split)"} model ${(c.fraction * 100).toFixed(1)}%` +
            ` ≠ declared ${(c.declared * 100).toFixed(1)}% on a FRESH surface — something latched without an interaction`
        );
      }
    }
  }
}

/* ------------------------------ the drag pass ----------------------------- */

/** The first gutter on the page, with the split it divides and where to grab
 *  it. Everything is read off the renderer's own stamps, so this works for any
 *  fixture the probe is pointed at rather than only the sandbox tree. */
const GUTTER_JS = `(() => {
  const root = document.querySelector("[data-axf-panes]");
  const gutter = document.querySelector("[data-axf-gutter]");
  if (!root || !gutter) return "null";
  const split = gutter.closest("[data-axf-split]");
  const box = gutter.getBoundingClientRect();
  return JSON.stringify({
    storageKey: root.getAttribute("data-axf-panes"),
    path: split.getAttribute("data-axf-split"),
    index: Number(gutter.getAttribute("data-axf-gutter").split(".").pop()),
    row: split.getAttribute("data-axf-direction") === "row",
    x: box.left + box.width / 2,
    y: box.top + box.height / 2
  });
})()`;

/** A trusted press-move-release over CDP. Trusted is the point: the renderer
 *  measures itself inside the pointer handler, so a synthesised
 *  `dispatchEvent` would prove nothing about the path a user takes. The moves
 *  are stepped because a single jump can outrun `setPointerCapture`. */
async function dragBy(cdp, gutter, deltaPx) {
  const axis = gutter.row ? "x" : "y";
  const at = (offset) => ({
    x: Math.round(gutter.x + (axis === "x" ? offset : 0)),
    y: Math.round(gutter.y + (axis === "y" ? offset : 0))
  });
  const press = { button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" };
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at(0), ...press });
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...at(deltaPx * step),
      button: "left",
      buttons: 1,
      pointerType: "mouse"
    });
    await new Promise((r) => setTimeout(r, 30));
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...at(deltaPx),
    ...press,
    buttons: 0
  });
  await new Promise((r) => setTimeout(r, 600)); // the latch write is async
}

/** Read/write/forget a kv namespace from inside the page, so the request
 *  carries whatever identity the browser has and the host resolves the user
 *  exactly as it does for the renderer itself. */
async function kvRead(cdp, ns) {
  const raw = await evaluate(
    cdp,
    `fetch("/api/axf/kv/${ns}", { cache: "no-store" }).then((r) => (r.status === 404 ? "null" : r.text()))`,
    { awaitPromise: true }
  );
  const body = JSON.parse(raw);
  return body === null ? null : (body.doc ?? null);
}

async function kvRestore(cdp, ns, doc) {
  const expression =
    doc === null
      ? `fetch("/api/axf/kv/${ns}", { method: "DELETE" }).then((r) => r.status)`
      : `fetch("/api/axf/kv/${ns}", { method: "PUT", headers: { "content-type": "application/json" },` +
        ` body: ${JSON.stringify(JSON.stringify({ doc }))} }).then((r) => r.status)`;
  const status = await evaluate(cdp, expression, { awaitPromise: true });
  if (status !== 200) fail(`could not restore kv namespace ${ns} — HTTP ${status}`);
}

/** The namespace's files on the SERVER's disk, across every user directory. */
function kvFilesOnDisk(ns) {
  if (!fs.existsSync(KV_ROOT)) return [];
  return fs
    .readdirSync(KV_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(KV_ROOT, e.name, `${ns}.json`))
    .filter((f) => fs.existsSync(f));
}

const splitAt = (info, pathId) => info.splits.find((s) => s.path === pathId);

/**
 * Assertion 4, in four parts: the drag moved the split, the latch reached the
 * server as a file, the file agrees with the screen, and a reload comes back
 * to the dragged geometry rather than to the declared weights.
 */
function checkDragLatched({ before, after, reloaded, doc, files, gutter, ns, label }) {
  const a = splitAt(before, gutter.path);
  const b = splitAt(after, gutter.path);
  const c = splitAt(reloaded, gutter.path);
  if (!a || !b || !c) {
    fail(`${label}: split ${gutter.path} vanished between passes`);
    return;
  }
  const moved = Math.abs(b.children[gutter.index].fraction - a.children[gutter.index].fraction);
  if (!(moved > 0.01)) {
    fail(
      `${label}: dragging the gutter ${DRAG_PX}px moved split ${gutter.path} by ${(moved * 100).toFixed(2)}%` +
        ` — the interaction never reached the renderer, so nothing below this proves anything`
    );
    return;
  }
  if (doc === null) {
    fail(`${label}: the drag latched nothing — GET /api/axf/kv/${ns} still answers "no document"`);
  } else {
    if (doc.format !== "axf-panes/1") fail(`${label}: latch document has format "${doc.format}"`);
    const latched = doc.fractions?.[gutter.path];
    if (!Array.isArray(latched)) {
      fail(`${label}: latch document carries no fractions for split ${gutter.path}`);
    } else if (Math.abs(latched[gutter.index] - b.children[gutter.index].fraction) > 0.0001) {
      fail(
        `${label}: latch says ${(latched[gutter.index] * 100).toFixed(1)}% but the screen says` +
          ` ${(b.children[gutter.index].fraction * 100).toFixed(1)}% — what persisted is not what was measured`
      );
    }
  }
  if (files.length === 0) {
    fail(
      `${label}: no ${ns}.json under ${KV_ROOT} — the latch never left the browser, and "server-side,` +
        ` per-user, not localStorage" is the requirement the primitive exists to meet`
    );
  }
  const back = c.children[gutter.index].fraction;
  if (Math.abs(back - b.children[gutter.index].fraction) > 0.0001) {
    fail(
      `${label}: after a reload split ${gutter.path} came back at ${(back * 100).toFixed(1)}%,` +
        ` not the dragged ${(b.children[gutter.index].fraction * 100).toFixed(1)}% — the latch did not survive`
    );
  }
}

function checkDeterministic(a, b, label) {
  const key = (info) =>
    info.splits
      .map((s) => `${s.path}:${s.children.map((c) => `${c.fraction.toFixed(4)}@${Math.round(c.px)}`).join("|")}`)
      .join(";");
  if (key(a) !== key(b)) {
    fail(`${label}: two identical loads measured differently — rendering itself latched or drifted`);
  }
}

/* --------------------------------- main ----------------------------------- */

const { child, profile, port } = await launchChrome();
try {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  // Before the first navigation: every route is gated by proxy.ts (I-31).
  // This probe keeps its own CDP class, so it borrows only the session helper.
  await signIn(cdp, BASE);

  for (const route of routes) {
    console.log(`\n${route}  (fresh — declared weights must stand)`);
    const fresh = await measure(cdp, `${BASE}${route}?fresh=1`);
    report(fresh);
    checkRenderedMatchesModel(fresh, `${route}?fresh`);
    checkModelMatchesDeclared(fresh, `${route}?fresh`);

    console.log(`\n${route}  (persisted pass 1)`);
    const first = await measure(cdp, `${BASE}${route}`);
    report(first);
    checkRenderedMatchesModel(first, route);

    console.log(`\n${route}  (persisted pass 2 — must equal pass 1)`);
    const second = await measure(cdp, `${BASE}${route}`);
    checkRenderedMatchesModel(second, `${route} (reload)`);
    checkDeterministic(first, second, route);

    console.log(`\n${route}  (drag — a measured interaction must latch, server-side, and survive)`);
    const gutter = JSON.parse(await evaluate(cdp, GUTTER_JS));
    if (gutter === null || !gutter.storageKey || gutter.storageKey === "ephemeral") {
      fail(`${route}: no persisting [data-axf-panes] with a gutter — the latch path cannot be exercised`);
      continue;
    }
    const ns = `panes.${gutter.storageKey}`;
    const original = await kvRead(cdp, ns);
    try {
      // Away from the first child, so the drag is never sitting on a floor:
      // a clamped drag latches nothing and would read as a broken renderer.
      await dragBy(cdp, gutter, gutter.index === 0 ? -DRAG_PX : DRAG_PX);
      const after = await snapshot(cdp);
      report(after);
      checkRenderedMatchesModel(after, `${route} (dragged)`);
      const doc = await kvRead(cdp, ns);
      const files = kvFilesOnDisk(ns);
      console.log(`  latch on disk: ${files.length > 0 ? files.join(", ") : "(none)"}`);
      const reloaded = await measure(cdp, `${BASE}${route}`);
      checkRenderedMatchesModel(reloaded, `${route} (after reload)`);
      checkDragLatched({
        before: second,
        after,
        reloaded,
        doc,
        files,
        gutter,
        ns,
        label: `${route} (drag)`
      });
    } finally {
      // Always — an assertion that fails must not also leave the fixture
      // retuned for every later run.
      await kvRestore(cdp, ns, original);
      // And prove the restore, on disk: a DELETE that quietly did nothing
      // would leave the next run measuring this run's drag and calling it the
      // declared layout.
      const left = kvFilesOnDisk(ns);
      if (original === null && left.length > 0) {
        fail(`${route}: the drag pass left ${left.join(", ")} behind — its own latch is now the fixture`);
      }
      if (original !== null && left.length === 0) {
        fail(`${route}: restoring the pre-existing latch for ${ns} wrote no file`);
      }
    }
  }

  cdp.close();
} finally {
  child.kill();
  // Give Chrome a beat to release the profile before deleting it.
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(profile, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\ngeometry-probe: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\ngeometry-probe: all assertions passed");
