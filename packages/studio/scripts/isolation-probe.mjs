/**
 * `node scripts/isolation-probe.mjs` — the crash-isolation gate, by MUTATION.
 *
 * The claim `shell/Boundary.tsx` makes is that three tiers are told apart:
 * a contribution that throws reads **"plugin failed"**, a module screen that
 * throws reads **"module failed"**, and whatever escapes both reads
 * **"application failed"** instead of a white screen. None of that is provable
 * by reading the source — the constraint it exists for is precisely the one
 * that looks fine in source and is wrong at runtime:
 *
 *   `<Boundary>{render(payload)}</Boundary>` evaluates `render()` during the
 *   PARENT's render, above a boundary that has not mounted, so a plugin
 *   failure escapes one tier up and the panel blames the module.
 *
 * So each tier is broken ON PURPOSE, in a real file, against the real dev
 * server, and the rendered panel is read back out of the DOM.
 *
 * Written for axf-mui P2 (2026-08-10), which rebuilt `AppShell`, `ModuleHost`,
 * `PaneLayout`, `ContextMenu` and `Glyph` on MUI and left `Boundary`'s
 * `CrashPanel` deliberately off the kit. Mutation 3 is what makes that
 * exception evidence rather than an opinion: it breaks `AxfMuiRoot` — the MUI
 * provider itself — and asserts the app-tier panel still renders. A fallback
 * built from MUI could not answer that case, and `theme/mui.ts` records it as
 * reachable ("createTheme throws on an unparseable colour … the alternative is
 * a white screen").
 *
 * Safety, because this edits real source:
 *   - every file is read first, restored in a `finally`, and the restore is
 *     VERIFIED byte-for-byte before the next mutation starts;
 *   - a mutation that does not change the file is a hard error rather than a
 *     silent pass, which is how a "green" run can mean the marker never landed;
 *   - it never restarts the dev server (`concurrent-builds.md`: :3200 may
 *     belong to another session — attach, never kill).
 *
 * Zero dependencies: the shared CDP driver, a throwaway Chrome profile.
 */
import fs from "node:fs";
import path from "node:path";

import { Cdp, cleanup, launchChrome, signIn } from "./lib/cdp.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const CORE = path.resolve(STUDIO, "..", "core");
const BASE = process.env.AXF_BASE ?? "http://localhost:3200";

const DEMO_SCREEN = path.join(STUDIO, "src", "modules", "demo", "DemoModule.tsx");
const MUI_BRIDGE = path.join(CORE, "src", "theme", "MuiBridge.tsx");

/** How long to give turbopack to notice an edit and re-serve the route. */
const RECOMPILE_MS = 12_000;

const failures = [];
const note = (ok, label, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

/**
 * Apply `edit` to `file`, run `body`, and put the file back whatever happens.
 *
 * The restore is verified rather than assumed: this script's whole job is to
 * damage a working tree on purpose, and "it probably wrote it back" is not a
 * thing to be probably about.
 */
async function withMutation(file, edit, body) {
  const original = fs.readFileSync(file, "utf8");
  const mutated = edit(original);
  if (mutated === original) {
    throw new Error(`mutation of ${path.relative(STUDIO, file)} changed nothing — its anchor moved`);
  }
  try {
    fs.writeFileSync(file, mutated);
    return await body();
  } finally {
    fs.writeFileSync(file, original);
    const back = fs.readFileSync(file, "utf8");
    if (back !== original) throw new Error(`FAILED TO RESTORE ${file} — fix by hand before continuing`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Load a route and return the visible crash panels, by tier and source. */
async function readPanels(cdp, route) {
  await cdp.send("Page.navigate", { url: BASE + route });
  await cdp.waitEvent("Page.loadEventFired", 60_000);
  // The module and app tiers are CLIENT boundaries (a class component catches
  // only on the client), so the panel appears after hydration, not in the
  // server HTML. Poll rather than sleep once: a cold turbopack compile of a
  // just-edited route is much slower than a warm one.
  for (let i = 0; i < 40; i++) {
    const panels = await cdp.eval(`
      JSON.stringify([...document.querySelectorAll("[data-axf-crash]")].map((el) => ({
        tier: el.getAttribute("data-axf-crash"),
        text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160)
      })))
    `);
    const parsed = JSON.parse(panels);
    if (parsed.length) return parsed;
    await sleep(500);
  }
  return [];
}

/* ------------------------------------------------------------------- run -- */

const { child, profile, port } = await launchChrome();
let cdp;
try {
  cdp = await Cdp.attach(port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  // Before the first navigation: /demo is gated by proxy.ts (I-31). Note this
  // one matters twice over — the control below asserts that /demo renders with
  // NO crash panel, and /login renders no crash panel either, so a signed-out
  // control would pass and license all three mutations beneath it.
  await signIn(cdp, BASE);

  /* 0 — the control. Without this every assertion below is a green lie: a
     panel that is always present would satisfy all three mutations. */
  console.log("\ncontrol — /demo renders with NO crash panel");
  {
    await cdp.send("Page.navigate", { url: `${BASE}/demo` });
    await cdp.waitEvent("Page.loadEventFired", 60_000);
    await sleep(2500);
    const panels = JSON.parse(
      await cdp.eval(
        `JSON.stringify([...document.querySelectorAll("[data-axf-crash]")].map(e => e.getAttribute("data-axf-crash")))`
      )
    );
    note(panels.length === 0, "clean /demo has no crash panel", `found ${JSON.stringify(panels)}`);
    const badge = await cdp.eval(
      `document.body.innerText.includes("plugin reached the screen")`
    );
    note(badge === true, "clean /demo renders the demo-badge contribution");
  }

  /* 1 — CONTRIBUTION tier. The plugin's render callback throws.
     This is the tier the eager-children bug misattributes: if `render()` were
     invoked in the HOST's render phase, this would come back as "module
     failed", which is the whole reason the mutation is worth running. */
  console.log("\nmutation 1 — the demo-badge contribution's render throws");
  await withMutation(
    DEMO_SCREEN,
    (src) =>
      src.replace(
        "          render={(payload: BadgePayload, from) => (",
        "          render={(payload: BadgePayload, from) => (\n            (() => { throw new Error(\"AXF_PROBE contribution boom\"); })(),"
      ),
    async () => {
      await sleep(RECOMPILE_MS);
      const panels = await readPanels(cdp, "/demo");
      const tiers = panels.map((p) => p.tier);
      note(
        tiers.includes("contribution"),
        'a throwing contribution reads "plugin failed" (tier=contribution)',
        JSON.stringify(panels)
      );
      note(
        !tiers.includes("module") && !tiers.includes("app"),
        "…and does NOT escape to the module or app tier",
        JSON.stringify(tiers)
      );
      note(
        panels.some((p) => /plugin failed/.test(p.text) && /demo-badge/.test(p.text)),
        "the panel names the tier AND the plugin",
        JSON.stringify(panels.map((p) => p.text))
      );
      // The screen's own root marker plus a card that is NOT the badge.
      //
      // Deliberately not an `innerText` match on a card title: those are
      // uppercased by `text-transform`, and `innerText` reports the RENDERED
      // text, so a case-sensitive search for "Kernel" fails against a screen
      // that is perfectly alive. That is a probe reporting its own bug as the
      // subject's, which is the one result worse than no probe.
      const alive = await cdp.eval(`
        JSON.stringify({
          screen: !!document.querySelector("[data-axf-area='demo.inspector']"),
          host: !!document.querySelector("[data-axf-module='demo']"),
          cards: document.querySelectorAll("[data-axf-area='demo.inspector'] .MuiPaper-root").length
        })
      `);
      const { screen, host, cards } = JSON.parse(alive);
      note(
        screen && host && cards > 1,
        "the rest of the module screen survived the plugin's crash",
        alive
      );
    }
  );

  /* 2 — MODULE tier. The screen itself throws. The banner and the nav sit
     OUTSIDE this boundary and must still be there. */
  console.log("\nmutation 2 — the demo module's screen throws");
  await withMutation(
    DEMO_SCREEN,
    (src) =>
      src.replace(
        "export default function DemoModule() {",
        'export default function DemoModule() {\n  throw new Error("AXF_PROBE module boom");'
      ),
    async () => {
      await sleep(RECOMPILE_MS);
      const panels = await readPanels(cdp, "/demo");
      const tiers = panels.map((p) => p.tier);
      note(tiers.includes("module"), 'a throwing module reads "module failed"', JSON.stringify(panels));
      note(
        panels.some((p) => /module failed/.test(p.text) && /demo/.test(p.text)),
        "the panel names the tier AND the module"
      );
      const chrome = await cdp.eval(
        `JSON.stringify({
           banner: !!document.querySelector("[data-axf-toolbar-role='banner']"),
           nav: !!document.querySelector("[data-axf-nav]")
         })`
      );
      const { banner, nav } = JSON.parse(chrome);
      note(banner && nav, "the banner and nav survived — they are outside the module tier", chrome);
    }
  );

  /* 3 — APP tier, and the reason `CrashPanel` is not MUI.
     `AxfMuiRoot` IS the MUI provider. Breaking it is the case a fallback built
     from MUI could not report, because it would be reaching for the kit whose
     provider just failed, from inside the boundary's own render — and for the
     app tier there is no next boundary to catch that. */
  console.log("\nmutation 3 — AxfMuiRoot (the MUI provider) throws");
  await withMutation(
    MUI_BRIDGE,
    (src) =>
      src.replace(
        "export function AxfMuiRoot({ children }: { children: ReactNode }) {",
        'export function AxfMuiRoot({ children }: { children: ReactNode }) {\n  throw new Error("AXF_PROBE mui provider boom");'
      ),
    async () => {
      await sleep(RECOMPILE_MS);
      const panels = await readPanels(cdp, "/demo");
      const tiers = panels.map((p) => p.tier);
      note(
        tiers.includes("app"),
        'a throwing MUI provider reads "application failed" rather than white-screening',
        JSON.stringify(panels)
      );
      const painted = await cdp.eval(`
        (() => {
          const el = document.querySelector("[data-axf-crash='app']");
          if (!el) return "no panel";
          const cs = getComputedStyle(el);
          return JSON.stringify({
            color: cs.color,
            borderColor: cs.borderTopColor,
            background: cs.backgroundColor,
            err: getComputedStyle(document.documentElement).getPropertyValue("--axf-err").trim()
          });
        })()
      `);
      note(
        painted !== "no panel" && !/rgba\\(0, 0, 0, 0\\)/.test(JSON.parse(painted || "{}").color ?? ""),
        "the panel is PAINTED from --axf-* with no MUI provider above it",
        painted
      );
    }
  );
} finally {
  if (cdp) await cdp.send("Browser.close").catch(() => {});
  await cleanup(child, profile);
}

/* ------------------------------------------------------------- verdict ---- */

// The restores are inside `withMutation`'s finally, but a crashed run is
// exactly when a stale marker survives — so say so out loud rather than
// leaving it to be discovered by a confusing test failure tomorrow.
for (const file of [DEMO_SCREEN, MUI_BRIDGE]) {
  const src = fs.readFileSync(file, "utf8");
  if (src.includes("AXF_PROBE")) {
    console.error(`\nLEFTOVER MUTATION in ${path.relative(STUDIO, file)} — remove it by hand.`);
    failures.push("leftover mutation");
  }
}

if (failures.length) {
  console.error(`\nisolation-probe: ${failures.length} failure(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nisolation-probe: all three tiers isolated and named (mutations watched, then reverted)");
