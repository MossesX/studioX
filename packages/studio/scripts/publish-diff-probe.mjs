/**
 * `node scripts/publish-diff-probe.mjs` — does the publisher's diffing survive
 * contact with a slider?
 *
 * The requirement (axf-theme-designer.bmpx P1): *"Drag one slider and report
 * written/removed/unchanged: written must be 1 (plus any genuine derived
 * dependents), not 42. If it is 42, the designer is republishing the whole set
 * and the engine's central optimisation has been undone by its own UI."*
 *
 * ## Why this taps the DOM instead of reading the designer's own meter
 *
 * The designer renders a publish meter, and that meter is computed by the same
 * component being vouched for: it calls `resolveVariables` itself and diffs the
 * result. If the designer republished everything, that readout could still say
 * "2" — it measures the intent, not the writes.
 *
 * So this wraps `CSSStyleDeclaration.prototype.setProperty` and
 * `.removeProperty` and counts only calls landing on
 * `document.documentElement.style` with a `--` name. That is precisely what
 * `applyVariables` does to `:root`, tapped one layer below the engine, in the
 * real browser, while a real pointer drags a real slider. Nothing the designer
 * believes about itself can influence the number.
 *
 * ## What it checks
 *
 *   1. **The route renders dials.** A `[data-dial]` slider exists — otherwise
 *      the run measured an empty page and every other check is vacuously green.
 *   2. **One commit writes a handful, not the set.** Pressing the rail commits
 *      one value; the properties written must include the dial's own variable
 *      and be far below the total the theme publishes.
 *   3. **The declared cascade is what actually moved.** `radius` must bring
 *      `--axf-radius-tight` with it (derived.ts declares it), and nothing else.
 *   4. **A DRAG stays diffed.** Many commits across a real drag, and the writes
 *      per commit must stay at the same handful — a designer that republished
 *      on every frame would show the total per commit here.
 *   5. **No property is written with an unchanged value.** The diff exists to
 *      skip those; one appearing means `applyVariables` was bypassed.
 *
 * Exit 1 on any failure, so it is usable as a gate.
 */
import { Cdp, cleanup, launchChrome, signIn } from "./lib/cdp.mjs";

const BASE = process.env.AXF_BASE ?? "http://localhost:3200";
const ROUTE = process.argv[2] ?? "/theme-designer";

/**
 * The dial driven, and why this one.
 *
 * It must be a NUMBER dial (so a pointer drag produces many commits) whose
 * variable the theme actually publishes. The first run of this probe used
 * `radius` and measured zero writes — correctly, as it turned out: the app's
 * active style package supplies `--axf-radius`, and `resolve.ts` gives a
 * complete identity precedence over the theme. Twelve of the forty-two dials
 * are pack-decided in the default app, and the designer marks every one of them
 * "pack wins" for exactly that reason.
 *
 * `scaleRatio` is the default because it exercises BOTH halves of the claim:
 * neither it nor `--axf-size-hero` is pack-supplied, so a commit writes the
 * dial's own variable AND a genuine derived dependent — "1 plus its cascade",
 * which is the number the requirement asks for. Its other three dependents
 * (`--axf-size-micro/label/title`) ARE pack-supplied, so the same run also shows
 * a recomputed token being correctly reported as overruled rather than moved.
 *
 * `elevation` is the other useful target (`node scripts/publish-diff-probe.mjs
 * /theme-designer elevation`): one dial, one dependent, and the dependent
 * overruled — the case that caught the cascade reporting a move it never
 * published.
 */
const DIAL = process.argv[3] ?? "scaleRatio";

/* --------------------------------------------------------------- in-page --- */

/**
 * Wrap the two DOM methods the publisher writes through. Values are recorded
 * alongside what the property held immediately BEFORE the call, so a write that
 * changed nothing is detectable — that is check 5, and it is the one thing a
 * call count alone cannot tell you.
 */
const TAP = `(() => {
  if (window.__axfTap) return "already";
  const rootStyle = document.documentElement.style;
  const proto = CSSStyleDeclaration.prototype;
  const setProperty = proto.setProperty;
  const removeProperty = proto.removeProperty;
  const tap = (window.__axfTap = { writes: [], removes: [] });
  proto.setProperty = function (name, value, priority) {
    if (this === rootStyle && String(name).startsWith("--")) {
      tap.writes.push({ name, value: String(value), was: this.getPropertyValue(name) });
    }
    return setProperty.call(this, name, value, priority);
  };
  proto.removeProperty = function (name) {
    if (this === rootStyle && String(name).startsWith("--")) tap.removes.push({ name });
    return removeProperty.call(this, name);
  };
  return "tapped";
})()`;

const RESET = `(() => {
  window.__axfTap.writes.length = 0;
  window.__axfTap.removes.length = 0;
  return true;
})()`;

const READ = `(() => ({
  writes: window.__axfTap.writes,
  removes: window.__axfTap.removes,
  published: document.documentElement.style.length
}))()`;

const RECT = `(() => {
  const el = document.querySelector('[data-dial="${DIAL}"]');
  if (!el) return null;
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
})()`;

const VALUE = `(() => {
  const el = document.querySelector('[data-dial="${DIAL}"] input');
  return el ? el.value : null;
})()`;

/**
 * What the designer's cascade panel CLAIMS this dial publishes into — its own
 * variable plus the derived tokens `dependentsOf()` reports.
 *
 * Read from the page rather than hardcoded here, and that is the point: the
 * expected set then comes from the engine's declarations, so a dependent added
 * to `derived.ts` is accounted for with no edit to this probe. It also turns
 * the check into a cross-examination — the panel states the cascade, the tap
 * observes the writes, and neither is allowed to vouch for itself.
 */
const CLAIMED = `(() => {
  const own = document.querySelector("[data-cascade-var]");
  return {
    dialVar: own ? own.getAttribute("data-cascade-var") : null,
    dependents: [...document.querySelectorAll("[data-cascade-token]")].map((el) => ({
      name: el.getAttribute("data-cascade-token"),
      moved: el.getAttribute("data-cascade-moved") === "yes"
    }))
  };
})()`;

const PACK_WINS = `(() => {
  const row = document.querySelector('[data-dial-row="${DIAL}"]');
  return row ? row.textContent.includes("pack wins") : null;
})()`;

/* ---------------------------------------------------------------- report --- */

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

/** Group a flat write log into commits — one per write of the driven dial's var. */
function commitsOf(writes, dialVar) {
  const commits = [];
  let current = null;
  for (const write of writes) {
    if (write.name === dialVar) {
      current = [write];
      commits.push(current);
    } else if (current) {
      current.push(write);
    } else {
      commits.push([write]);
      current = commits[commits.length - 1];
    }
  }
  return commits;
}

async function main() {
  const health = await fetch(BASE).catch(() => null);
  if (!health || !health.ok) {
    console.error(
      `publish-diff-probe FAILED — no dev server on ${BASE}.\n` +
        "  Start it with: npm --prefix packages/studio run dev\n" +
        "  If the port is in use it is already running and owned by another session —\n" +
        "  attach to it, never restart it (concurrent-builds rule)."
    );
    process.exit(1);
  }

  const { child, profile, port } = await launchChrome();
  let cdp;
  try {
    cdp = await Cdp.attach(port);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    // Before the first navigation: the designer route is gated by proxy.ts (I-31).
    await signIn(cdp, BASE);
    await cdp.send("Page.navigate", { url: `${BASE}${ROUTE}` });
    await cdp.waitEvent("Page.loadEventFired");
    // Hydration, Emotion's client insert, and the style root's layout effect.
    await new Promise((r) => setTimeout(r, 2500));

    // 1 — the route rendered dials
    const rect = await cdp.eval(RECT);
    if (!rect || rect.width < 20) {
      fail(`no [data-dial="${DIAL}"] slider on ${ROUTE} — nothing to measure`);
      throw new Error("nothing to measure");
    }
    pass(`the designer rendered a slider for "${DIAL}" (${Math.round(rect.width)}px wide)`);

    /* A pack-decided dial publishes nothing when it moves — correctly — so
       measuring one would report "the designer is not reaching the store" for a
       designer that is working exactly as `resolve.ts` says it should. Named
       here rather than left to be rediscovered, because it already cost one
       confusing run. */
    if (await cdp.eval(PACK_WINS)) {
      fail(
        `"${DIAL}" is marked "pack wins" — the active pack supplies its variable, so turning it ` +
          "changes the theme and not the published value. Drive a dial the theme owns."
      );
      throw new Error("dial is pack-decided");
    }

    await cdp.eval(TAP);

    /* ---------------------------------------------------- one commit ------ */
    await cdp.eval(RESET);
    const y = rect.y + rect.height / 2;
    await cdp.mouse("mousePressed", rect.x + rect.width * 0.3, y);
    await cdp.mouse("mouseReleased", rect.x + rect.width * 0.3, y);
    await new Promise((r) => setTimeout(r, 500));
    const single = await cdp.eval(READ);

    const names = single.writes.map((w) => w.name);
    console.log(
      `\n  one commit — ${names.length} propert${names.length === 1 ? "y" : "ies"} written of ` +
        `${single.published} published:\n    ${names.join("\n    ") || "(none)"}`
    );

    if (names.length === 0) {
      fail("pressing the slider wrote nothing — the control is not reaching the store");
    } else if (names.length >= single.published) {
      fail(
        `every published property (${names.length}/${single.published}) was rewritten for one ` +
          "commit — the designer is republishing the whole set and applyVariables' diff has " +
          "been undone by its own UI"
      );
    } else if (names.length > 6) {
      fail(
        `${names.length} properties for one dial step is not a diff — expected the dial's own ` +
          "variable plus its declared derived dependents"
      );
    } else {
      pass(
        `one commit wrote ${names.length} of ${single.published} published properties ` +
          `(${((names.length / single.published) * 100).toFixed(1)}%)`
      );
    }

    /* 3 — the cascade the designer CLAIMS, cross-examined against the writes
       the tap OBSERVED. The claim comes from `dependentsOf()` through the DOM,
       so this needs no hand-kept list and cannot go stale. */
    const claimed = await cdp.eval(CLAIMED);
    const dialVar = claimed.dialVar;
    if (!dialVar) {
      fail("the cascade panel named no variable for the moved dial — it did not react to the edit");
      throw new Error("no cascade");
    }
    const movedClaims = claimed.dependents.filter((d) => d.moved).map((d) => d.name);
    console.log(
      `  the designer claims: ${dialVar} + ${claimed.dependents.length} declared dependent(s), ` +
        `${movedClaims.length} of which moved${movedClaims.length ? ` (${movedClaims.join(", ")})` : ""}`
    );

    const expected = new Set([dialVar, ...movedClaims]);
    const missing = [...expected].filter((n) => !names.includes(n));
    const extra = names.filter((n) => !expected.has(n));
    if (missing.length) {
      fail(
        `${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} claimed to have moved and ` +
          "never reached :root — the designer is reporting a cascade it did not publish"
      );
    } else {
      pass(`every property the cascade claimed was written: ${[...expected].join(", ")}`);
    }
    if (extra.length) {
      fail(
        `${extra.join(", ")} reached :root without appearing in the declared cascade — ` +
          "derived.ts's `from` list is incomplete, or the designer is publishing extra"
      );
    } else {
      pass("nothing was written that the declared cascade did not account for");
    }

    // 5 — no write with an unchanged value
    const noop = single.writes.filter((w) => w.was === w.value);
    if (noop.length) {
      fail(
        `${noop.length} propert${noop.length === 1 ? "y was" : "ies were"} written with the value ` +
          `${noop.length === 1 ? "it" : "they"} already had (${noop.map((w) => w.name).join(", ")}) ` +
          "— applyVariables' diff was bypassed"
      );
    } else {
      pass("no property was rewritten with a value it already had");
    }

    /* -------------------------------------------------------- a drag ------ */
    // Re-measured: the readouts populate on the first edit, and a control that
    // has moved between the press and the drag is a control the pointer leaves.
    const dragRect = await cdp.eval(RECT);
    await cdp.eval(RESET);
    const dragY = dragRect.y + dragRect.height / 2;
    const startX = dragRect.x + dragRect.width * 0.15;
    await cdp.mouse("mousePressed", startX, dragY);
    for (let i = 1; i <= 24; i++) {
      await cdp.mouse("mouseMoved", startX + (dragRect.width * 0.7 * i) / 24, dragY);
      await new Promise((r) => setTimeout(r, 25));
    }
    await cdp.mouse("mouseReleased", dragRect.x + dragRect.width * 0.85, dragY);
    await new Promise((r) => setTimeout(r, 600));
    const dragged = await cdp.eval(READ);
    const finalValue = await cdp.eval(VALUE);

    const commits = commitsOf(dragged.writes, dialVar);
    const perCommit = commits.map((c) => c.length);
    const worst = Math.max(0, ...perCommit);
    console.log(
      `\n  drag — ${dragged.writes.length} writes across ${commits.length} commit(s); ` +
        `per commit: ${perCommit.join(", ") || "(none)"}; ${DIAL} ended at ${finalValue}`
    );

    if (commits.length < 2) {
      fail(
        `the drag produced ${commits.length} commit(s) — the slider is not committing while ` +
          "dragged, so this measured a click and not a drag"
      );
    } else if (worst > 6) {
      fail(
        `one commit during the drag wrote ${worst} properties — the diff is not holding under ` +
          "a live drag"
      );
    } else {
      pass(
        `${commits.length} commits during the drag, at most ${worst} propert${worst === 1 ? "y" : "ies"} ` +
          `each (of ${dragged.published} published)`
      );
    }

    const dragNoop = dragged.writes.filter((w) => w.was === w.value);
    if (dragNoop.length) {
      fail(`${dragNoop.length} no-op write(s) during the drag`);
    } else {
      pass("no no-op writes during the drag either");
    }

    if (dragged.removes.length) {
      console.log(`  note  ${dragged.removes.length} propert(ies) removed during the drag`);
    }

    const hydration = cdp
      .consoleText()
      .filter((t) => /hydrat|did not match|server rendered HTML/i.test(t));
    if (hydration.length) {
      fail(`React reported ${hydration.length} hydration problem(s):\n        ${hydration.join("\n        ")}`);
    } else {
      pass("no hydration warning in the console");
    }
  } finally {
    cdp?.close();
    await cleanup(child, profile);
  }

  if (failures.length) {
    console.error(`\npublish-diff-probe FAILED — ${failures.length} check(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\npublish-diff-probe OK — one dial move writes one dial and its declared cascade");
}

await main();
