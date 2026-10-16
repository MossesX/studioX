/**
 * `npm run check:designer` — the two properties the dial designer rests on,
 * measured in a real browser because neither is visible from the source.
 *
 * `publish-diff-probe.mjs` already holds the third (one dial move writes one
 * dial and its declared cascade). These two are the ones the .bmpx's trap list
 * names, and until now neither had a guard — which is the same as not having
 * the property, since both fail SILENTLY and both look correct in a screenshot
 * taken at the wrong moment.
 *
 * ## Guard A — the control READS the store; it does not snapshot it
 *
 * `ThemeStore.serverState()` returns the SHIPPED DEFAULT during the server
 * render and during the hydrating client render, on purpose (it is the fix for
 * an app-wide hydration mismatch — see its docblock). So a control that copies
 * `values[dial.id]` into `useState` at mount captures the default and then
 * shows it forever, over the theme the person actually has. GizmoX paid for
 * this twice: its settings hooks hand back spec defaults on render one, and its
 * 181-token theme-editor grid had to learn "rehydrate or it breaks".
 *
 * A snapshotting control is invisible to typecheck, to the unit tests and to a
 * screenshot — right up until someone reloads the page. So the probe reloads
 * the page, and then changes the store from OUTSIDE the control (the header's
 * "Clear overrides") and requires the control to follow:
 *
 *   A1  a slider commit moves the value and creates an override;
 *   A2  after a RELOAD the control shows the persisted value, not the default
 *       — the render-one trap, exactly;
 *   A3  clearing overrides from the header moves the control back, with no
 *       remount — the "rehydrate or it breaks" half.
 *
 * A2 and A3 are both needed. A2 alone passes for a control that snapshots on
 * every mount of a persisted value; A3 alone passes for a control that
 * subscribes but was seeded wrong at hydration.
 *
 * ## Guard B — the preview is a SCOPE, never a second root publisher
 *
 * `AxfStyleRoot` owns `:root` and there is exactly one of it, deliberately: two
 * writers of one custom property is a race this engine already had and fixed.
 * The preview must therefore be a `ThemeScope` subtree, and the failure mode of
 * getting that wrong is spectacular and quiet at once — the comparison panel
 * renders the BASE theme, so a preview publishing to `:root` repaints the whole
 * app in the theme the person edited away from, and every value it wrote is a
 * plausible one.
 *
 *   B1  each specimen's variables live on an element inside the panel, not on
 *       `document.documentElement`;
 *   B2  mounting the comparison preview writes NOTHING to `:root` — toggling a
 *       switch changes no theme value, so any root write is a leak;
 *   B3  the root still holds the LIVE value of the edited dial while the
 *       comparison specimen holds the BASE value. Two themes on screen, one
 *       root, and the root belongs to the live one.
 *
 * Zero dependencies, throwaway Chrome profile, no source touched — safe against
 * the shared :3200 dev server, which it must assume it is attached to
 * (`.claude/rules/concurrent-builds.md`: attach, never restart).
 *
 * Exit 1 on any failed check.
 */
import { Cdp, cleanup, launchChrome, signIn } from "./lib/cdp.mjs";

const BASE = process.env.AXF_BASE ?? "http://localhost:3200";
const ROUTE = process.argv[2] ?? "/theme-designer";

/**
 * The dial driven, and why this one.
 *
 * A NUMBER dial, so a rail press is a commit; and one the ACTIVE PACK does not
 * publish, because `resolve.ts` gives a style package precedence and a
 * pack-decided dial correctly changes the theme without changing a pixel —
 * measuring one would report a working designer as broken. `scaleRatio` is
 * neither pack-supplied nor set by the console wrapper's three mount-time
 * overrides (`src/dashboards/amberx-console.tsx` sets navPlacement/navStyle/
 * navSize), so nothing else in the app writes it while this runs.
 */
const DIAL = process.argv[3] ?? "scaleRatio";
const DIAL_VAR = "--axf-scale-ratio";

/* --------------------------------------------------------------- in-page --- */

const TAP = `(() => {
  if (window.__axfTap) return "already";
  const rootStyle = document.documentElement.style;
  const proto = CSSStyleDeclaration.prototype;
  const setProperty = proto.setProperty;
  const removeProperty = proto.removeProperty;
  const tap = (window.__axfTap = { writes: [], removes: [] });
  proto.setProperty = function (name, value, priority) {
    if (this === rootStyle && String(name).startsWith("--")) {
      tap.writes.push({ name, value: String(value) });
    }
    return setProperty.call(this, name, value, priority);
  };
  proto.removeProperty = function (name) {
    if (this === rootStyle && String(name).startsWith("--")) tap.removes.push({ name });
    return removeProperty.call(this, name);
  };
  return "tapped";
})()`;

const RESET = `(() => { window.__axfTap.writes.length = 0; window.__axfTap.removes.length = 0; return true; })()`;
const READ_TAP = `(() => ({ writes: window.__axfTap.writes, removes: window.__axfTap.removes }))()`;

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

const OVERRIDE_COUNT = `(() => {
  const chip = [...document.querySelectorAll(".MuiChip-label")]
    .map((el) => el.textContent || "")
    .find((t) => /overrides?$/.test(t.trim()));
  return chip ? Number(chip.trim().split(" ")[0]) : null;
})()`;

/** Click a button by its visible text — the header's own affordance, not an api. */
const clickButton = (text) => `(() => {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === ${JSON.stringify(text)}
  );
  if (!btn) return "not-found";
  if (btn.disabled) return "disabled";
  btn.click();
  return "clicked";
})()`;

/** Toggle the comparison switch by its label — likewise a real affordance. */
const TOGGLE_COMPARE = `(() => {
  const label = [...document.querySelectorAll("label")].find((l) =>
    (l.textContent || "").includes("Compare with base")
  );
  if (!label) return "not-found";
  const input = label.querySelector('input[type="checkbox"]');
  if (!input) return "no-input";
  input.click();
  return input.checked ? "on" : "off";
})()`;

/**
 * Where each specimen's variables actually live.
 *
 * Walks UP from every `[data-specimen]` to the nearest ancestor carrying an
 * INLINE `--axf-page` — which is what `ThemeScope` writes onto its own element
 * — and reports whether that ancestor is the document element. Walking rather
 * than checking a fixed node is deliberate: `ThemeScope` renders its own `div`
 * around the specimen box today, and a probe pinned to one of them would go red
 * on a harmless refactor instead of on the failure it is meant to catch.
 */
const SPECIMENS = `(() => {
  const rootStyle = document.documentElement.style;
  return [...document.querySelectorAll("[data-specimen]")].map((el) => {
    let node = el;
    let holder = null;
    while (node && node !== document.documentElement) {
      if (node.style && node.style.getPropertyValue("--axf-page")) { holder = node; break; }
      node = node.parentElement;
    }
    const names = holder ? [...holder.style].filter((n) => n.startsWith("--axf-")) : [];
    return {
      title: el.getAttribute("data-specimen"),
      onRoot: holder === null || holder === document.documentElement,
      varCount: names.length,
      dialValue: holder ? holder.style.getPropertyValue("${DIAL_VAR}") : null
    };
  });
})()`;

const ROOT_DIAL = `document.documentElement.style.getPropertyValue("${DIAL_VAR}")`;

/* ---------------------------------------------------------------- report --- */

/**
 * A check that makes every later check vacuous stops the run — but it must not
 * stop it with a stack trace. An uncaught throw exits non-zero and so still
 * fails the gate, which is why it is easy to leave; it also buries the one line
 * that says what went wrong under a Node trace, and a guard whose red output is
 * hard to read is a guard whose red output gets skimmed.
 */
class Abort extends Error {}

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const health = await fetch(BASE).catch(() => null);
  if (!health || !health.ok) {
    console.error(
      `designer-probe FAILED — no dev server on ${BASE}.\n` +
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
    await wait(2500);

    /* ============================================ A — the control follows === */
    console.log(`\nA — the control reads the store (dial "${DIAL}")`);

    const rect = await cdp.eval(RECT);
    if (!rect || rect.width < 20) {
      fail(`no [data-dial="${DIAL}"] control on ${ROUTE} — nothing to measure`);
      throw new Abort("nothing to measure");
    }
    const before = await cdp.eval(VALUE);

    // A1 — a commit through the control moves the value and records an override.
    const y = rect.y + rect.height / 2;
    const x = rect.x + rect.width * 0.78;
    await cdp.mouse("mousePressed", x, y);
    await cdp.mouse("mouseReleased", x, y);
    await wait(400);
    const edited = await cdp.eval(VALUE);
    const overrides = await cdp.eval(OVERRIDE_COUNT);

    if (edited === before) {
      fail(
        `pressing the rail left "${DIAL}" at ${before}. Either the control is not committing to ` +
          "the store, or it is not reading the store back — a control that snapshots its value " +
          "into useState at mount does exactly this, because the commit lands and the display " +
          `cannot follow it. ${overrides ?? 0} override(s) are recorded, which tells the two ` +
          "apart: a recorded override with an unmoved control is the snapshot."
      );
      throw new Abort("no commit");
    }
    pass(`a rail press moved ${DIAL} ${before} → ${edited} (${overrides} override(s) recorded)`);

    /* ================================================ B — preview scoping === */
    // Run before the overrides are cleared, so the comparison panel genuinely
    // renders a DIFFERENT theme: with no override, base and live are identical
    // and B3 would pass on a preview that had leaked onto :root.
    console.log("\nB — the preview publishes into its own scope");

    await cdp.eval(TAP);
    await cdp.eval(RESET);
    const toggled = await cdp.eval(TOGGLE_COMPARE);
    if (toggled !== "on") {
      fail(`could not switch the comparison preview on (got "${toggled}")`);
    } else {
      await wait(900);
      const tap = await cdp.eval(READ_TAP);
      const specimens = await cdp.eval(SPECIMENS);
      const rootValue = String(await cdp.eval(ROOT_DIAL)).trim();

      console.log(
        `  specimens on screen: ${specimens
          .map((s) => `${s.title} (${s.varCount} vars${s.onRoot ? ", ON ROOT" : ""})`)
          .join(" | ")}`
      );

      // B1 — the variables are on an element inside the panel.
      if (specimens.length < 2) {
        fail(
          `${specimens.length} specimen(s) rendered with the comparison open — expected the live ` +
            "one and the base one, so the two-themes-one-root claim is untested"
        );
      } else {
        const leaked = specimens.filter((s) => s.onRoot);
        if (leaked.length) {
          fail(
            `${leaked.map((s) => `"${s.title}"`).join(", ")} carries no scoped variables — its ` +
              "theme is being published onto :root instead of onto its ThemeScope element, which " +
              "is the two-writers race AxfStyleRoot exists to be the only one of"
          );
        } else {
          pass(
            `both specimens publish onto their own element (${specimens
              .map((s) => s.varCount)
              .join(" and ")} variables, none on :root)`
          );
        }
      }

      // B2 — mounting a preview writes nothing to the root.
      if (tap.writes.length || tap.removes.length) {
        fail(
          `opening the comparison preview wrote ${tap.writes.length} and removed ` +
            `${tap.removes.length} propert(ies) on :root ` +
            `(${[...tap.writes.map((w) => `${w.name}=${w.value}`), ...tap.removes.map((r) => `-${r.name}`)]
              .slice(0, 6)
              .join(", ")}) — a preview is a subtree, and toggling a switch changes no theme value`
        );
      } else {
        pass("opening the comparison preview touched :root not at all");
      }

      // B3 — the root belongs to the live theme, the specimen to the base one.
      const baseSpec = specimens.find((s) => /base/i.test(s.title ?? ""));
      const baseValue = baseSpec ? String(baseSpec.dialValue).trim() : null;
      console.log(`  ${DIAL_VAR} — :root ${rootValue || "(unset)"} · base specimen ${baseValue || "(unset)"}`);
      if (!baseSpec) {
        fail('no specimen titled "Base …" — the comparison panel did not render');
      } else if (baseValue === rootValue) {
        fail(
          `the base preview and :root both hold ${DIAL_VAR}=${rootValue}. The dial was edited, so ` +
            "these must differ; equal means the preview published its theme over the live one"
        );
      } else if (rootValue && Math.abs(Number(rootValue) - Number(edited)) > 1e-9) {
        fail(
          `:root holds ${DIAL_VAR}=${rootValue} but the live control reads ${edited} — the root ` +
            "is showing something other than the theme in force"
        );
      } else {
        pass(
          `:root holds the live value (${rootValue}) while the base specimen holds ${baseValue} — ` +
            "two themes on screen, one root, and it belongs to the live one"
        );
      }

      await cdp.eval(TOGGLE_COMPARE);
      await wait(300);
    }

    /* ==================================== A2 — the value survives a reload === */
    console.log("\nA2 — an APPLIED value survives a reload (and an unapplied one must not)");
    /*
     * The 2026-08-12 preview contract: a dial edit repaints the whole app and
     * persists NOTHING until "Apply to app" commits it. So the probe applies
     * first — reloading straight after the edit and expecting it to survive
     * would be demanding the designer break its own contract (that unapplied
     * edits die on reload IS the feature).
     */
    const applied = await cdp.eval(clickButton("Apply to app"));
    if (applied !== "clicked") {
      fail(`could not press "Apply to app" (${applied}) — A2 is untested`);
    }
    await wait(400);
    await cdp.send("Page.navigate", { url: `${BASE}${ROUTE}` });
    await cdp.waitEvent("Page.loadEventFired");
    await wait(2500);
    const afterReload = await cdp.eval(VALUE);
    if (afterReload === null) {
      fail(`the dial control did not render after the reload`);
    } else if (Math.abs(Number(afterReload) - Number(edited)) > 1e-9) {
      fail(
        `after applying and reloading, "${DIAL}" reads ${afterReload} but the store persisted ` +
          `${edited}. Either Apply stopped persisting (commitPreview → localStorage + cookie), or ` +
          "the control snapshots the shipped default into useState at mount — the failure " +
          "GizmoX's settings hooks and its 181-token editor grid each paid for once."
      );
    } else {
      pass(`the control shows the applied ${afterReload} after a reload, not the shipped default`);
    }

    /* ============ A3 — a change made OUTSIDE the control reaches it =========== */
    console.log("\nA3 — a store change made outside the control reaches it");
    const cleared = await cdp.eval(clickButton("Clear overrides"));
    if (cleared !== "clicked") {
      fail(`could not press "Clear overrides" (${cleared}) — A3 is untested`);
    } else {
      await wait(600);
      const afterClear = await cdp.eval(VALUE);
      const remaining = await cdp.eval(OVERRIDE_COUNT);
      if (afterClear === null) {
        fail("the dial control disappeared when the overrides were cleared");
      } else if (Math.abs(Number(afterClear) - Number(edited)) < 1e-9) {
        fail(
          `the overrides were cleared (${remaining} left) but "${DIAL}" still reads ${afterClear}. ` +
            "The control is holding its own copy of the value instead of reading the store — " +
            "rehydrate or it breaks."
        );
      } else {
        pass(
          `clearing overrides moved the control ${edited} → ${afterClear} with no remount ` +
            `(${remaining} override(s) left)`
        );
      }
    }

    const hydration = cdp
      .consoleText()
      .filter((t) => /hydrat|did not match|server rendered HTML/i.test(t));
    console.log("");
    if (hydration.length) {
      fail(`React reported ${hydration.length} hydration problem(s):\n        ${hydration.join("\n        ")}`);
    } else {
      pass("no hydration warning in the console");
    }
  } catch (err) {
    if (!(err instanceof Abort)) throw err;
    console.log(`
  (run stopped early: ${err.message} — the checks below would be vacuous)`);
  } finally {
    cdp?.close();
    await cleanup(child, profile);
  }

  if (failures.length) {
    console.error(`\ndesigner-probe FAILED — ${failures.length} check(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\ndesigner-probe OK — the controls read the store, and the preview stays in its scope");
}

await main();
