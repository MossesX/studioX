/**
 * @file `npm run check:buildmgr` — the Build Manager's FAITHFULNESS gate.
 *
 * The owner's instruction for the MUI rebuild was not "improve it": *"exactly
 * the way the new one looks now it works great i just need mui"*. So the
 * rebuild needed an acceptance target that exists outside the reviewer's
 * memory, captured BEFORE the first edit and compared against AFTER — and a
 * difference has to read as a defect, not as an improvement somebody talked
 * themselves into.
 *
 * ## Why the projections, and not a pixel diff
 *
 * A screenshot diff between a hand-rolled DOM and an MUI one is noise: MUI
 * inserts wrapper elements, so anything keyed on DOM structure or child index
 * shifts by a wrapper and reports a hundred false differences. Screenshots are
 * still captured (a human looks at those), but the GATE runs on three
 * projections that are implementation-agnostic — each answers one half of
 * "same look, same controls, same places":
 *
 *   1. **text** — every text-bearing LEAF: its string, its box, and the type
 *      that paints it. A leaf's text does not care how many `<span>`s MUI
 *      wrapped it in, so this survives the rewrite while still catching a
 *      moved, resized, recoloured or re-faced label.
 *   2. **boxes** — every element that PAINTS: background, border, radius,
 *      shadow. This is the chrome. Deduped by geometry+paint, because an MUI
 *      wrapper that paints identically to its child is not a second box on
 *      screen, it is the same box described twice.
 *   3. **controls** — everything a person can operate, by ROLE rather than by
 *      tag (`<button>` and MUI's `ListItemButton` are both controls; a
 *      `<div onClick>` is a control that was not reachable, which is a fact
 *      worth recording rather than hiding).
 *
 * ## Volatility
 *
 * Some text legitimately differs between two runs minutes apart and must not
 * fail the gate: the shell clock, `ago()` row ages, dollar readouts, pids,
 * byte offsets. `normalise()` masks those — narrowly, by shape, and each
 * pattern is listed with what it is. Masking anything broader would let a real
 * regression through, which is the failure mode a faithfulness gate cannot
 * have.
 *
 * ## Usage
 *
 *   node scripts/buildmgr-probe.mjs capture --label before
 *   node scripts/buildmgr-probe.mjs compare before after
 *
 * `capture` drives the live dev server on :3200 — it never starts one
 * (`concurrent-builds.md`: attach, never restart). Exit 1 on any difference.
 *
 * ## Re-baselining
 *
 * A capture is a whole-viewport reading, so it includes the SHELL — the banner,
 * the nav rail, the status strip. That is deliberate (a rebuild that shoved the
 * nav sideways should fail), but it means a legitimate change to shell chrome
 * invalidates `before` and must be re-baselined deliberately, by re-capturing
 * BOTH labels against the unmodified screen. Do not silently re-capture `after`
 * alone to make a red gate green — that is the gate deleting itself.
 *
 * The `before`/`after` pair in `captures/` was taken either side of the P5 MUI
 * rebuild and before the nav gained its "Suite" section, so both halves share
 * one shell and the comparison is valid.
 */
import fs from "node:fs";
import path from "node:path";

import { Cdp, cleanup, launchChrome, signIn } from "./lib/cdp.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const OUT = path.join(STUDIO, "captures", "buildmgr");
const BASE = process.env.AXS_URL ?? "http://localhost:3200";
const VIEWPORT = { width: 1600, height: 1000 };

/* ------------------------------------------------------------ extraction -- */

/**
 * The in-page collector. Serialised into the browser as a string, so it may
 * not close over anything from this module.
 *
 * `round` quantises geometry to whole pixels: sub-pixel layout differs between
 * a `padding: "3px 8px"` shorthand and MUI's resolved longhands by fractions
 * that no eye can see, and a gate that fails on 0.4px is a gate people delete.
 */
const COLLECT = /* js */ `(() => {
  const round = (n) => Math.round(n);
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return null;
    return { r, cs };
  };
  const box = (r) => ({ x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) });

  /* ---- 1. text leaves ---------------------------------------------------- */
  // A leaf is an element whose own child NODES include text. Walking nodes
  // rather than elements is what makes this survive MUI's extra wrappers:
  // the wrapper has no text child, the thing painting the glyphs does.
  const text = [];
  for (const el of document.querySelectorAll("*")) {
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join("")
      .replace(/\\s+/g, " ")
      .trim();
    if (!own) continue;
    const v = vis(el);
    if (!v) continue;
    text.push({
      t: own,
      ...box(v.r),
      font: v.cs.fontSize + "/" + v.cs.fontWeight + " " + v.cs.fontFamily.split(",")[0].replace(/["']/g, ""),
      color: v.cs.color,
      deco: v.cs.textDecorationLine === "none" ? "" : v.cs.textDecorationLine + " " + v.cs.textDecorationColor,
      ls: v.cs.letterSpacing,
      tt: v.cs.textTransform
    });
  }

  /* ---- 2. painted boxes -------------------------------------------------- */
  const seen = new Set();
  const boxes = [];
  for (const el of document.querySelectorAll("*")) {
    const v = vis(el);
    if (!v) continue;
    const { cs } = v;
    const bg = cs.backgroundColor;
    const paintsBg = bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth];
    const paintsBorder = bw.some((w) => parseFloat(w) > 0);
    const paintsShadow = cs.boxShadow !== "none";
    if (!paintsBg && !paintsBorder && !paintsShadow) continue;
    const rec = {
      ...box(v.r),
      bg: paintsBg ? bg : "",
      border: paintsBorder
        ? bw.map((w) => round(parseFloat(w))).join("/") + " " +
          [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor]
            .map((c) => (parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth) ? c : c))
            .join("/")
        : "",
      radius: cs.borderRadius === "0px" ? "" : cs.borderRadius,
      shadow: paintsShadow ? cs.boxShadow : ""
    };
    // An MUI wrapper painting exactly what its child paints is ONE box on
    // screen. Dedupe on the full record, never on geometry alone — two
    // stacked boxes of different colour are two real boxes.
    const key = JSON.stringify(rec);
    if (seen.has(key)) continue;
    seen.add(key);
    boxes.push(rec);
  }

  /* ---- 3. controls ------------------------------------------------------- */
  // By ROLE, so the same affordance is found whichever element implements it.
  const controls = [];
  const CTRL = 'button, [role="button"], input, select, textarea, a[href], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"]';
  for (const el of document.querySelectorAll(CTRL)) {
    const v = vis(el);
    if (!v) continue;
    controls.push({
      role: el.getAttribute("role") || el.tagName.toLowerCase(),
      t: (el.innerText || el.value || "").replace(/\\s+/g, " ").trim().slice(0, 120),
      title: (el.getAttribute("title") || el.getAttribute("aria-label") || "").slice(0, 400),
      disabled: Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true",
      kbd: el.tabIndex >= 0,
      ...box(v.r)
    });
  }

  /* ---- 4. unreachable click handlers ------------------------------------- */
  // React attaches at the root, so there is no onclick attribute to find. What
  // IS findable is the shape the old screen used: a non-control element with
  // the pointer cursor. Recorded rather than asserted — it is context for the
  // reviewer, and the count moving is itself a difference worth seeing.
  let pointerNonControls = 0;
  for (const el of document.querySelectorAll("div, span, section, li, tr")) {
    const v = vis(el);
    if (!v) continue;
    if (v.cs.cursor === "pointer" && !el.closest(CTRL)) pointerNonControls++;
  }

  return {
    text, boxes, controls, pointerNonControls,
    scroll: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }
  };
})()`;

/* ------------------------------------------------------------ normalising -- */

/**
 * Mask text that legitimately changes between two captures minutes apart.
 * Narrow, by shape, each with the thing it is.
 */
function normalise(s) {
  return s
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "<clock>") //            shell clock
    .replace(/\$-?\d[\d,]*\.?\d*/g, "<usd>") //                      cost readouts
    .replace(/\bpid \d+/g, "pid <n>") //                             spawned pid
    .replace(/\b\d+(\.\d+)?(ms|s)\b/g, "<dur>") //                   durations
    .replace(/(^|\s)\d+[mhd](\s|$)/g, "$1<age>$2") //                ago() row ages
    .replace(/\b20\d\d-\d\d-\d\d[\dT:\-.]*/g, "<stamp>"); //         iso stamps
}

const keyText = (e) => `${normalise(e.t)}|${e.x},${e.y},${e.w},${e.h}`;
const keyBox = (e) => `${e.x},${e.y},${e.w},${e.h}`;
const keyCtrl = (e) => `${normalise(e.t)}|${e.x},${e.y}`;

/* -------------------------------------------------------------- capturing -- */

/**
 * The views, built from the REAL project list rather than hardcoded.
 *
 * Every step is "click the thing that says X", and every view carries a
 * `verify` that must hold afterwards. The verify is the load-bearing half: an
 * early draft targeted the projects pane by `x < 10`, which silently matched
 * nothing once the console nav rail took the left 212px — and a probe that
 * clicks nothing still captures a screenshot and reports success. A view that
 * cannot prove it reached its state is not a captured view.
 */
function buildViews(projects) {
  const open = projects.find((p) => p.phases.length) ?? projects[0];
  const other = projects.find((p) => p.id !== open.id) ?? open;
  const phase = open.phases[Math.min(2, open.phases.length - 1)];
  return [
    { id: "01-default", steps: [], verify: `document.body.innerText.includes(${JSON.stringify(open.id)})` },
    {
      id: "02-phase-3",
      steps: [{ text: phase.name }],
      verify: `/inspector\\s*·\\s*${phase.name.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&")}/i.test(document.body.innerText)`
    },
    {
      id: "03-project-2",
      steps: [{ text: other.id }],
      // The top strip shows the OPEN project's id in bold beside its version.
      verify: `/${other.id.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&")}\\s*\\n?\\s*v/i.test(document.body.innerText)`
    },
    {
      id: "04-real-armed",
      steps: [{ text: "real" }, { text: "START", match: "includes" }],
      verify: `/CONFIRM REAL/i.test(document.body.innerText)`
    }
  ];
}

async function capture(label) {
  const dir = path.join(OUT, label);
  fs.mkdirSync(dir, { recursive: true });
  const { projects } = await (await fetch(`${BASE}/api/bmpx`)).json();
  if (!projects?.length) throw new Error("/api/bmpx returned no projects");
  const VIEWS = buildViews(projects);
  const { child, profile, port } = await launchChrome(VIEWPORT);
  const cdp = await Cdp.attach(port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  // Before the first navigation: /buildmgr is gated by proxy.ts (I-31).
  await signIn(cdp, BASE);

  const views = {};
  try {
    for (const view of VIEWS) {
      await cdp.send("Page.navigate", { url: `${BASE}/buildmgr` });
      await cdp.waitEvent("Page.loadEventFired");
      await waitForProjects(cdp);
      for (const s of view.steps) await drive(cdp, s);
      await settle(400);
      if (!(await cdp.eval(view.verify))) {
        throw new Error(`${view.id}: steps ran but the view never reached its state (${view.verify})`);
      }

      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(dir, `${view.id}.png`), Buffer.from(shot.data, "base64"));
      views[view.id] = await cdp.eval(COLLECT);
      console.log(
        `  ${view.id}: ${views[view.id].text.length} text · ${views[view.id].boxes.length} boxes · ` +
          `${views[view.id].controls.length} controls · ${views[view.id].pointerNonControls} pointer-non-controls`
      );
    }
    const errors = cdp.consoleText().filter((t) => /error|warning/i.test(t));
    fs.writeFileSync(
      path.join(dir, "inventory.json"),
      JSON.stringify({ label, base: BASE, viewport: VIEWPORT, views, consoleErrors: errors }, null, 1)
    );
    if (errors.length) console.log(`  console: ${errors.length} error/warning line(s)`);
  } finally {
    cdp.close();
    await cleanup(child, profile);
  }
  console.log(`captured → ${path.relative(STUDIO, dir)}`);
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the real `/api/bmpx` data to land — a screenshot of the empty
 *  pre-fetch frame would compare two loading spinners and call it a match. */
async function waitForProjects(cdp) {
  for (let i = 0; i < 120; i++) {
    // The pane title is `projects · N`, painted through `text-transform:
    // uppercase` — and innerText reports the RENDERED text, so it arrives as
    // "PROJECTS · 9". Matching case-sensitively waited forever against a page
    // that had loaded fine.
    const n = await cdp.eval(
      `document.body.innerText.split("\\n").map((l) => /^projects\\s*·\\s*(\\d+)/i.exec(l.trim())).filter(Boolean).map((m) => Number(m[1]))[0] || 0`
    );
    if (n > 0) {
      await settle(300);
      return n;
    }
    await settle(150);
  }
  throw new Error("projects never loaded — is the dev server serving real .bmpx files?");
}

/**
 * Drive one step by hitting the thing a HAND would hit: a real trusted click
 * at the element's centre, found by its on-screen text or its position in a
 * pane. Never by test id — the point is that the rebuilt screen offers the
 * same affordances in the same places, and a test id would be a private door
 * both versions were handed.
 */
async function drive(cdp, step) {
  const want = JSON.stringify(step.text);
  const test = step.match === "includes" ? `t.includes(${want})` : `t === ${want}`;
  // Find the SMALLEST visible element whose rendered text matches, and click
  // its centre. Smallest = the leaf actually painting the words, so the click
  // lands on the label a person would aim at and bubbles to whatever handler
  // owns it — which is the same gesture whether that handler sits on a
  // `<div onClick>` or on an MUI `ListItemButton`.
  const expr = `(() => {
    // Clickable = it, or an ancestor, presents as operable. Needed because a
    // phase NAME appears twice on this screen: once in the plan pane, where
    // the row selects the phase, and once in the run strip's phase list, which
    // is a readout. Both match the text; only one does anything. Without this
    // the probe clicked the readout and the view never changed.
    const clickable = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.cursor === "pointer" || n.tagName === "BUTTON" || n.getAttribute("role") === "button") return true;
      }
      return false;
    };
    const all = [...document.querySelectorAll("*")].filter((e) => {
      const t = (e.innerText || "").replace(/\\s+/g, " ").trim();
      if (!(${test})) return false;
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return b.width > 2 && b.height > 2 && cs.visibility !== "hidden" && cs.display !== "none";
    });
    const hits = all.filter(clickable).length ? all.filter(clickable) : all;
    if (!hits.length) return null;
    hits.sort((a, z) => {
      const A = a.getBoundingClientRect(), Z = z.getBoundingClientRect();
      return A.width * A.height - Z.width * Z.height;
    });
    const b = hits[0].getBoundingClientRect();
    return [b.x + b.width / 2, b.y + b.height / 2];
  })()`;
  const at = await cdp.eval(expr);
  if (!at) throw new Error(`could not find target for step ${JSON.stringify(step)}`);
  await cdp.mouse("mouseMoved", at[0], at[1]);
  await cdp.mouse("mousePressed", at[0], at[1]);
  await cdp.mouse("mouseReleased", at[0], at[1]);
  await settle(350);
}

/* -------------------------------------------------------------- comparing -- */

/**
 * The two deltas the P5 rebuild is ALLOWED to have, each with the finding that
 * justifies it. This is not an allowlist of "things that differ" — both rules
 * are shaped so that a real regression still fails:
 *
 *  1. **`deco-colour`** — a `line-through` whose COLOUR changed. The old screen
 *     painted its green cross-off grey whenever the state flipped after the
 *     first paint, and that was a browser-level defect in the old code rather
 *     than a design choice: React updates only the props that changed, so a
 *     later `style.textDecoration = "line-through"` assignment re-expands the
 *     shorthand and wipes `text-decoration-color` back to `currentColor`.
 *     Verified directly, not assumed — set the longhand, re-assign the
 *     shorthand, and the computed colour drops from the token to the text
 *     colour. Emotion emits a complete rule per state, so it cannot happen.
 *     The file's own comment ("The green cross-off: struck through in ok") says
 *     which of the two is intended. A change to the decoration LINE itself
 *     (appearing, disappearing, becoming underline) is NOT accepted.
 *
 *  2. **`row-promoted`** — a control that appeared where a clickable
 *     non-control used to be. The project rows were `<div onClick>` and are
 *     `ButtonBase` now, so the control deciding what the whole screen shows is
 *     reachable from a keyboard. Accepted only when the count of clickable
 *     non-controls fell by at least as many as the controls that appeared, and
 *     only when the new control's text was already on screen — so a genuinely
 *     NEW control, or a control appearing with nothing given up, still fails.
 */
function classify(diffs, before, after) {
  const promoted = before.pointerNonControls - after.pointerNonControls;
  const beforeText = new Set(before.text.map((e) => normalise(e.t)));
  let promotionsLeft = promoted;
  const accepted = [];
  const real = [];
  for (const d of diffs) {
    if (d.kind === "control-added" && promotionsLeft > 0) {
      // Every word of the new control was already painted at this spot, so
      // nothing was added to the screen — something became reachable.
      const words = normalise(d.entry.t).split(" ").filter(Boolean);
      if (words.length && words.every((w) => [...beforeText].some((t) => t.includes(w)))) {
        promotionsLeft--;
        accepted.push(`row-promoted: ${d.entry.t}`);
        continue;
      }
    }
    if (d.kind === "text-field" && d.field === "deco") {
      const line = (s) => String(s).split(" ")[0];
      if (line(d.from) === line(d.to) && d.from !== d.to) {
        accepted.push(`deco-colour: ${d.key} · ${d.from} → ${d.to}`);
        continue;
      }
    }
    real.push(d);
  }
  return { accepted, real };
}

/** Structured diffs — `classify` needs the parts, not a sentence. */
function diffList(before, after, key, label, fields) {
  const bi = new Map(before.map((e) => [key(e), e]));
  const ai = new Map(after.map((e) => [key(e), e]));
  const out = [];
  for (const [k, b] of bi) {
    const a = ai.get(k);
    if (!a) {
      out.push({ kind: `${label}-missing`, label, key: k, entry: b, text: `MISSING ${label}: ${JSON.stringify(b)}` });
      continue;
    }
    for (const f of fields) {
      if (String(b[f] ?? "") !== String(a[f] ?? "")) {
        out.push({
          kind: `${label}-field`,
          label,
          key: k,
          field: f,
          from: b[f],
          to: a[f],
          text: `CHANGED ${label} ${k} · ${f}: ${JSON.stringify(b[f])} → ${JSON.stringify(a[f])}`
        });
      }
    }
  }
  for (const [k, a] of ai) {
    if (!bi.has(k)) {
      out.push({ kind: `${label}-added`, label, key: k, entry: a, text: `ADDED ${label}: ${JSON.stringify(a)}` });
    }
  }
  return out;
}

function compare(beforeLabel, afterLabel) {
  const rd = (l) => JSON.parse(fs.readFileSync(path.join(OUT, l, "inventory.json"), "utf8"));
  const B = rd(beforeLabel);
  const A = rd(afterLabel);
  let total = 0;
  for (const id of Object.keys(B.views)) {
    const b = B.views[id];
    const a = A.views[id];
    if (!a) {
      console.log(`\n${id}: MISSING from ${afterLabel}`);
      total++;
      continue;
    }
    const raw = [
      ...diffList(b.text, a.text, keyText, "text", ["font", "color", "deco", "ls", "tt"]),
      ...diffList(b.boxes, a.boxes, keyBox, "box", ["bg", "border", "radius", "shadow"]),
      ...diffList(b.controls, a.controls, keyCtrl, "control", ["role", "title", "disabled", "w", "h"])
    ];
    if (b.scroll.w !== a.scroll.w || b.scroll.h !== a.scroll.h) {
      raw.push({
        kind: "scroll",
        text: `CHANGED scroll extent: ${JSON.stringify(b.scroll)} → ${JSON.stringify(a.scroll)}`
      });
    }
    const { accepted, real } = classify(raw, b, a);
    console.log(
      `\n${id}: ${real.length ? `${real.length} DIFFERENCE(S)` : "faithful"}` +
        (accepted.length ? ` · ${accepted.length} accepted delta(s)` : "")
    );
    for (const d of real.slice(0, 60)) console.log(`  ${d.text}`);
    if (real.length > 60) console.log(`  … ${real.length - 60} more`);
    // Accepted deltas are PRINTED, never silently swallowed — an allowance
    // nobody sees is an allowance nobody re-examines.
    for (const line of accepted.slice(0, 4)) console.log(`  ok · ${line}`);
    if (accepted.length > 4) console.log(`  ok · … ${accepted.length - 4} more accepted`);
    if (b.pointerNonControls !== a.pointerNonControls) {
      console.log(
        `  ok · pointer-non-controls ${b.pointerNonControls} → ${a.pointerNonControls} ` +
          `(clickable elements not reachable by role — down is a fix)`
      );
    }
    total += real.length;
  }
  console.log(
    `\n${total ? `FAIL — ${total} unaccepted difference(s)` : "PASS — faithful to the acceptance target"}`
  );
  return total;
}

/* ------------------------------------------------------------------- main -- */

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "capture") {
  const i = rest.indexOf("--label");
  const label = i >= 0 ? rest[i + 1] : "capture";
  console.log(`capturing ${BASE}/buildmgr as "${label}"`);
  await capture(label);
} else if (cmd === "compare") {
  const n = compare(rest[0] ?? "before", rest[1] ?? "after");
  process.exit(n ? 1 : 0);
} else {
  console.log("usage: buildmgr-probe.mjs capture --label <name> | compare <before> <after>");
  process.exit(2);
}
