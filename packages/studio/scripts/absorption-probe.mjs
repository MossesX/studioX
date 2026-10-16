/**
 * `node scripts/absorption-probe.mjs` — `npm run check:absorption`.
 *
 * The LIVE half of `axf-claude` P5. Its gate is *"at least two absorbed assets
 * render through declared points with no host import"*, and neither half of
 * that is provable from source: `test/registry-scoping.test.ts` proves the
 * registry files contributions under the right points, but a contribution that
 * lands in a registry and never reaches a screen is exactly the failure the
 * point mechanism exists to prevent. So this drives the real app.
 *
 * It also re-earns the three rows `axf-diff-browser.bmpx` marks
 * **"NOT RE-VERIFIED IN ANY RECORD — check before calling the checklist fully
 * green"**: collapse at depth (that file's worry was the 8-column case; the
 * history is 14 columns now), F3 wrap-around observed rather than assumed, and
 * the main toolbar's global operations exercised one by one. A checklist row
 * with no recorded proof is the thing this project keeps writing down as the
 * expensive kind of green.
 *
 * READ-ONLY against the app: no source is touched and the dev server is never
 * restarted (`concurrent-builds.md` — :3200 may belong to another session;
 * attach, never kill). It DOES click, type and press keys, which is the point.
 *
 * Zero dependencies: the shared CDP driver and a throwaway Chrome profile.
 */
import path from "node:path";

import { Cdp, assertSignedIn, cleanup, launchChrome, signIn } from "./lib/cdp.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const BASE = process.env.AXF_BASE ?? "http://localhost:3200";

const failures = [];
const note = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(what);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll an expression until it is truthy, so a slow first compile is waited
 *  out rather than reported as a missing feature. */
async function until(cdp, expression, { timeoutMs = 90_000, every = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await cdp.eval(expression).catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(every);
  }
}

async function goto(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await cdp.waitEvent("Page.loadEventFired", 120_000).catch(() => {});
  // Every navigation, not just the first: a bounce to /login renders a
  // chromeless page on which essentially every assertion below fails at once,
  // and the resulting report blames ten surfaces instead of one session (I-31).
  await assertSignedIn(cdp, url);
}

const { child, profile, port } = await launchChrome({ width: 1800, height: 1100 });
const cdp = await Cdp.attach(port);

try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  // Before the first navigation: every route below is gated by proxy.ts (I-31).
  await signIn(cdp, BASE);

  /* ============================================================ the browser */
  console.log("\n/diff — the difference browser, absorbed but still full-width");

  await goto(cdp, `${BASE}/diff`);

  const columnCount = `document.querySelectorAll('[data-rowkey]').length && (() => {
    const bodies = [...document.querySelectorAll('div')].filter(d => d.querySelector(':scope > [data-rowkey]'));
    return bodies.length;
  })()`;

  const columns = await until(cdp, columnCount);
  note(
    typeof columns === "number" && columns >= 8,
    "the grid renders one column per revision, past the 8-column case nobody had recorded",
    `${columns} columns`
  );

  const stats = await cdp.eval(`document.body.innerText.match(/(\\d+) revisions/)?.[1] ?? "none"`);
  note(stats !== "none" && Number(stats) >= 8, "the toolbar counts the revisions", `${stats}`);

  /* -- the reveal rule: filter 2 does not exist until filter 1 is on -------- */
  const btn = (label) =>
    `[...document.querySelectorAll('button[aria-label]')].find(b => b.getAttribute('aria-label').startsWith(${JSON.stringify(
      label
    )}))`;

  const compareBefore = await cdp.eval(`Boolean(${btn("Comparing against")})`);
  note(!compareBefore, "the comparison-base toggle is ABSENT before the changes-only filter is on");

  const rowsBefore = await cdp.eval(`document.querySelectorAll('[data-rowkey]').length`);
  await cdp.eval(`${btn("Hide unchanged lines in every column")}.click()`);
  await sleep(900);
  const rowsAfter = await cdp.eval(`document.querySelectorAll('[data-rowkey]').length`);
  note(
    rowsAfter > 0 && rowsAfter < rowsBefore,
    "changes-only reduces the grid",
    `${rowsBefore} → ${rowsAfter} rendered rows`
  );

  const compareAfter = await cdp.eval(`Boolean(${btn("Comparing against")})`);
  note(compareAfter, "and the comparison-base toggle appears only once it is");

  const baseLabelBefore = await cdp.eval(`${btn("Comparing against")}.getAttribute('aria-label')`);
  await cdp.eval(`${btn("Comparing against")}.click()`);
  await sleep(700);
  const baseLabelAfter = await cdp.eval(`${btn("Comparing against")}.getAttribute('aria-label')`);
  note(
    /previous revision/.test(baseLabelBefore) && /ALL earlier/.test(baseLabelAfter),
    "and it really switches the comparison base",
    `${baseLabelBefore.slice(0, 34)}… → ${baseLabelAfter.slice(0, 34)}…`
  );

  await cdp.eval(`${btn("Turn off every filter")}.click()`);
  await sleep(900);
  const rowsCleared = await cdp.eval(`document.querySelectorAll('[data-rowkey]').length`);
  note(rowsCleared === rowsBefore, "clear-all-filters puts every row back", `${rowsCleared} rows`);

  /* -- collapse / expand, at depth ----------------------------------------- */
  //
  // POLLED, not slept. The first draft of this probe slept 700ms and reported
  // zero rails: with the filters cleared the grid is 14 columns × ~2700 rows
  // and React's re-render is measured in seconds, not milliseconds. A fixed
  // sleep turns "slow" into "broken", which is the most expensive kind of red.
  const widthsBefore = await cdp.eval(
    `document.querySelectorAll('button[aria-label^="Fold this revision"]').length`
  );
  //
  // The rail is found through its VERTICAL LABEL rather than by hunting for a
  // 44px box. That was the second thing the first draft got wrong: it measured
  // every `div` for an exact width and found none, because the element carrying
  // `width: 44` is the Tooltip-wrapped Stack and the flex child that actually
  // occupies the column is its own. Measuring from the thing only a COLLAPSED
  // column has — a label rotated to vertical-rl — asks the question the check
  // is about and cannot be fooled by which element the width sits on.
  await cdp.eval(`${btn("Collapse every revision except")}.click()`);
  const rails = await until(
    cdp,
    `(() => {
      const v = [...document.querySelectorAll('*')]
        .filter(e => getComputedStyle(e).writingMode === 'vertical-rl');
      if (v.length < 8) return null;
      const cols = new Set(v.map(e => e.parentElement));
      const widths = [...cols].map(c => Math.round(c.getBoundingClientRect().width));
      return JSON.stringify({ labels: v.length, rails: cols.size, widths: [...new Set(widths)] });
    })()`,
    { timeoutMs: 45_000 }
  );
  const rail = rails ? JSON.parse(rails) : { rails: 0, widths: [], labels: 0 };
  note(
    rail.rails >= 8 && rail.widths.every((w) => w <= 60),
    "collapse folds every older revision to a narrow rail",
    `${rail.rails} rails at ${rail.widths.join("/")}px (from ${widthsBefore} expanded)`
  );
  note(
    rail.labels >= rail.rails * 2,
    "the toolbar folds INTO the rail — the stamp AND the change count survive the collapse",
    `${rail.labels} vertical labels across ${rail.rails} rails`
  );

  await cdp.eval(`${btn("Expand every collapsed column")}.click()`);
  const expanded = await until(
    cdp,
    `(() => { const n = document.querySelectorAll('button[aria-label^="Fold this revision"]').length;
              return n >= 8 ? n : null; })()`,
    { timeoutMs: 30_000 }
  );
  note(Number(expanded) >= 8, "and expand-all brings them all back", `${expanded ?? 0} expanded`);

  /* -- find: counts, stepping, and the WRAP nobody had watched ------------- */
  await cdp.eval(`(() => {
    const input = document.querySelector('input[placeholder="find in this column"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'the');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  })()`);
  await sleep(900);

  const counter = `(() => {
    const el = [...document.querySelectorAll('p')].find(p => /^\\d+\\/\\d+$/.test(p.textContent.trim()));
    return el ? el.textContent.trim() : null;
  })()`;
  const first = await until(cdp, counter);
  note(Boolean(first) && !/^0\//.test(first), "find reports a hit count for its own column", first);

  const total = Number(String(first).split("/")[1]);
  await cdp.eval(`${btn("Jump to the next match")}.click()`);
  await sleep(300);
  const second = await cdp.eval(counter);
  note(second === `2/${total}`, "the next arrow steps forward", `${first} → ${second}`);

  // Wrap-around: step back from hit 1 and land on the LAST one. This is the
  // row `axf-diff-browser.bmpx` says "the code and labels say wrap; nobody
  // recorded watching it wrap".
  await cdp.eval(`${btn("Jump to the previous match")}.click()`);
  await sleep(250);
  await cdp.eval(`${btn("Jump to the previous match")}.click()`);
  await sleep(350);
  const wrapped = await cdp.eval(counter);
  note(wrapped === `${total}/${total}`, "and stepping back past the first WRAPS to the last", wrapped);

  // F3, surface-wide, which is a different code path from the arrows.
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "F3", code: "F3", windowsVirtualKeyCode: 114 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "F3", code: "F3", windowsVirtualKeyCode: 114 });
  await sleep(400);
  const afterF3 = await cdp.eval(counter);
  note(afterF3 === `1/${total}`, "F3 steps too, and wraps from the last back to the first", afterF3);

  /* -- global find: one query, every column, the rest greyed --------------- */
  await cdp.eval(`${btn("Search every column with this query")}.click()`);
  await sleep(1200);
  const global = await cdp.eval(`(() => {
    const counters = [...document.querySelectorAll('p')]
      .filter(p => /^\\d+\\/\\d+$/.test(p.textContent.trim()))
      .map(p => p.textContent.trim());
    const disabled = document.querySelectorAll('input[placeholder="— global find —"]').length;
    return JSON.stringify({ counters: counters.length, disabled });
  })()`);
  const { counters, disabled } = JSON.parse(global);
  note(counters >= 8, "global find gives every column its own count against one query", `${counters} counters`);
  note(disabled >= 8, "and greys every other field, so exactly one query is in play", `${disabled} greyed`);

  const totalFind = await cdp.eval(`document.body.innerText.match(/find (\\d+)/)?.[1] ?? "none"`);
  note(totalFind !== "none", "the main toolbar reports the global total", totalFind);

  /* -- the tracked-file selector, which is what the discovery bought ------- */
  //
  // A REAL pointer press, not `element.click()`. MUI's Select opens on
  // mousedown and its menu is a portal; a synthetic click is the trap this
  // project has already written up once (`cdp-portal-click-trap`) — the first
  // draft of this probe fell straight into it and reported the selector
  // missing when it was working.
  const box = await cdp.eval(`(() => {
    const combo = document.querySelector('[role="combobox"]');
    if (!combo) return null;
    const r = combo.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);
  note(Boolean(box), "the tracked-file selector is on the toolbar");
  if (box) {
    const { x, y } = JSON.parse(box);
    await cdp.mouse("mouseMoved", x, y);
    await cdp.mouse("mousePressed", x, y);
    await cdp.mouse("mouseReleased", x, y);
    const listed = await until(
      cdp,
      `(() => {
        const o = [...document.querySelectorAll('[role="option"]')]
          .map(e => e.textContent.trim().split(' ·')[0]);
        return o.length >= 2 ? o.join(', ') : null;
      })()`,
      { timeoutMs: 15_000 }
    );
    note(
      Boolean(listed),
      "every history folder is reachable, not just the one the old literal named",
      listed ?? "only one option"
    );
  }
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(300);

  /* ========================================================== the workspace */
  console.log("\n/claude — the two absorbed assets, reaching the screen through declared points");

  await goto(cdp, `${BASE}/claude`);

  const panels = await until(
    cdp,
    `(() => {
      const titles = [...document.querySelectorAll('p')].map(p => p.textContent.trim());
      const found = ['Agent Forge', 'History'].filter(t => titles.includes(t));
      return found.length === 2 ? JSON.stringify(found) : null;
    })()`
  );
  note(Boolean(panels), "both contributed PANELS render in the panels column", panels ?? "not found");

  const attributed = await cdp.eval(`(() => {
    const text = document.body.innerText;
    return JSON.stringify(['agent-forge', 'diff-browser'].filter(id => text.includes(id)));
  })()`);
  note(
    JSON.parse(attributed).length === 2,
    "each pane names its contributor, so a misbehaving panel is attributable",
    attributed
  );

  const actions = await cdp.eval(`(() => {
    const labels = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
    return JSON.stringify(
      ['Insert the persona brief', 'Quote the newest change'].filter(l => labels.includes(l))
    );
  })()`);
  note(
    JSON.parse(actions).length === 2,
    "both contributed COMPOSER ACTIONS render beside the composer",
    actions
  );

  const empty = await cdp.eval(`document.body.innerText.includes('Nothing is contributing')`);
  note(!empty, "and the point's empty state is NOT showing — the contributions arrived");

  const crashed = await cdp.eval(
    `document.body.innerText.includes('plugin failed') || document.body.innerText.includes('module failed')`
  );
  note(!crashed, "no boundary tripped: neither panel threw inside its own Boundary");

  /* -- the composer action really runs and really returns text ------------- */
  await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Quote the newest change');
    btn.click();
  })()`);
  await sleep(2500);
  const said = await cdp.eval(`(() => {
    const draft = document.querySelector('textarea');
    const toast = document.body.innerText;
    return JSON.stringify({
      inserted: draft ? draft.value.slice(0, 60) : "",
      toast: /nothing|fewer than two|Could not read/.test(toast)
    });
  })()`);
  const { inserted, toast } = JSON.parse(said);
  note(
    inserted.startsWith("Lines introduced by") || toast,
    "the action ran end to end: it either inserted its quote or SAID why not",
    inserted ? inserted.replace(/\n/g, " ") : "said why not"
  );

  const errors = cdp
    .consoleText()
    .filter((t) => /Hydration|did not match|Warning: Each child|Cannot read/.test(t));
  note(errors.length === 0, "no hydration or React warnings on either surface", errors.slice(0, 2).join(" | "));
} finally {
  if (cdp) await cdp.send("Browser.close").catch(() => {});
  await cleanup(child, profile);
}

if (failures.length) {
  console.error(`\nabsorption-probe: ${failures.length} failure(s): ${failures.join("; ")}`);
  process.exit(1);
}
console.log(
  `\nabsorption-probe: green — both absorbed assets render through their declared points, and the ` +
    `browser's three unrecorded checklist rows (deep collapse, F3 wrap, the global toolbar) are now recorded.`
);
console.log(`  probed ${BASE}, source untouched, dev server not restarted (${path.basename(STUDIO)})`);
