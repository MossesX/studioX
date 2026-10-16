/**
 * `node scripts/mui-probe.mjs` — P1's gate: the MUI theme bridge is LIVE.
 *
 * The requirement it stands for (axf-mui.bmpx P1): *"mount an MUI Button,
 * TextField and Paper, roll the theme, and confirm their COMPUTED colours
 * change with no reload and no re-mount. Rebuilding a surface before this is
 * green means rebuilding it twice."*
 *
 * It CHECKS rather than prints, for the same reason `geometry-probe.mjs` does.
 * The failure this exists to catch already happened once, on the day the bridge
 * was written, and it is invisible from the code: core's `<ThemeProvider>` and
 * studio's components resolved two different copies of `@mui/material`, so the
 * provider wrote a context nothing read. `createTheme` produced a perfect theme
 * (`primary.main #ff7a1a`, verified) and every component rendered MUI's stock
 * light palette. Nothing threw, nothing warned. Only a computed-style read off
 * the real DOM could tell the difference — a theme-object assertion would have
 * been green throughout.
 *
 * Five checks, exit 1 on any miss:
 *
 *   1. **Themed at rest.** The Button, TextField and Paper resolve the engine's
 *      palette, not MUI's defaults. `#1976d2` or `rgb(255, 255, 255)` on the
 *      Paper is the two-copies signature and is named as such.
 *   2. **A roll MOVES them — the THEME-FOLLOWS check.** Computed colours differ
 *      after rolling. This is the whole claim, and since 2026-08-11 (P6) it is
 *      a DIFFERENTIAL rather than a single reading, so its red says which of
 *      the two renderings stopped.
 *
 *      `AxfStyleRoot` and `AxfMuiRoot` are two renderings of one truth: the
 *      first publishes the theme as `--axf-*` custom properties, the second as
 *      an MUI `Theme`. Both are read here, before and after the roll, and the
 *      four combinations are four different findings:
 *
 *        | `--axf-*` | MUI | what it means                                   |
 *        |-----------|-----|-------------------------------------------------|
 *        | moved     | yes | green — one truth, both renderings following    |
 *        | moved     | NO  | **the MUI bridge stopped following the theme**  |
 *        | still     | yes | `AxfStyleRoot` stopped, or MUI is re-randomising|
 *        | still     | NO  | the ROLL never happened — not a bridge failure  |
 *
 *      The bottom row is why this is not just "did anything change". A dead
 *      roll button, a locked theme or a store that silently refused all produce
 *      an unmoved MUI colour, and reporting those as a broken bridge sends the
 *      next reader to rewrite a file that is correct. The second row is the
 *      failure P6 mutation-tested: unsubscribe `AxfMuiRoot` from the theme
 *      store and the custom properties still track the roll while every MUI
 *      surface freezes — silently, with a perfectly correct theme object.
 *
 *      Its Node-side sibling is `test/theme-follows.test.ts`, which holds the
 *      three properties this subscription rests on (the memo key, the
 *      notification, and the two renderings agreeing) and says plainly which
 *      half it cannot reach.
 *   3. **No reload.** The document is the same one: a sentinel planted on
 *      `window` before the roll is still there after it.
 *   4. **No re-mount.** A sentinel planted on the Button's DOM NODE survives
 *      too, so the element was restyled rather than replaced. A bridge that
 *      re-created the tree on every roll would pass check 2 and still be wrong.
 *   5. **No new hydration warning.** Console is captured from before navigation
 *      and any React hydration error fails the run — the layout's four
 *      incident fixes (the `:root` floor, the blocking boot script, the
 *      one-element-deep `suppressHydrationWarning`, the transition-free body)
 *      each exist because of a specific bug, and MUI arriving must not have
 *      cost one of them.
 *
 * Zero dependencies: Chrome over raw CDP with Node's global `WebSocket` and
 * `fetch`, exactly as `geometry-probe.mjs` does it. Throwaway profile, no
 * source touched — safe against a shared dev server, which on :3200 it must
 * assume it is (`.claude/rules/concurrent-builds.md`: attach, never restart).
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
const ROUTE = process.argv[2] ?? "/mui-probe";

/* ----------------------------- CDP plumbing ------------------------------- */

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "axf-mui-probe-"));
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
  return { child, profile, port: Number(fs.readFileSync(portFile, "utf8").split("\n")[0]) };
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
      cdp.#ws.addEventListener("error", () => reject(new Error(`cannot connect ${url}`)), {
        once: true
      });
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

  consoleText() {
    return this.#events
      .filter((e) => e.method === "Runtime.consoleAPICalled" || e.method === "Log.entryAdded")
      .flatMap((e) =>
        e.method === "Log.entryAdded"
          ? [e.params.entry.text ?? ""]
          : (e.params.args ?? []).map((a) => String(a.value ?? a.description ?? ""))
      );
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text + " " + (result?.description ?? ""));
    return result.value;
  }

  close() {
    this.#ws.close();
  }
}

/* ------------------------------ measurement ------------------------------- */

/**
 * Runs in the page. Reads COMPUTED style off the real nodes — the only reading
 * that can tell a live provider from a dead one — and plants/reads the two
 * sentinels checks 3 and 4 depend on.
 */
const MEASURE = `(() => {
  const pick = (probe) => document.querySelector('[data-probe="' + probe + '"]');
  const read = (probe, props) => {
    const el = pick(probe);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = cs.getPropertyValue(p).trim();
    return out;
  };
  const btn = pick("probe-button");
  // The OTHER rendering of the same truth — what AxfStyleRoot publishes onto
  // documentElement. Check 2 is a differential against these, so that "MUI did
  // not move" can be told apart from "nothing moved because the roll never
  // happened". Read off the root element, not off a probe node, because that is
  // where AxfStyleRoot writes and a probe node would only report inheritance.
  const rootStyle = getComputedStyle(document.documentElement);
  const vars = {};
  for (const name of ["--axf-accent", "--axf-accent2", "--axf-page", "--axf-panel", "--axf-ink", "--axf-edge"]) {
    vars[name] = rootStyle.getPropertyValue(name).trim();
  }
  // The same values as the browser would COMPUTE them, so a "#161514" from the
  // custom property and an "rgb(22, 21, 20)" off a Paper can be compared
  // without this script re-implementing CSS colour parsing.
  const swatch = document.createElement("span");
  swatch.style.display = "none";
  document.body.appendChild(swatch);
  const rgb = {};
  for (const [name, value] of Object.entries(vars)) {
    swatch.style.color = "";
    swatch.style.color = value;
    rgb[name] = value ? getComputedStyle(swatch).color : "";
  }
  swatch.remove();
  return {
    vars,
    rgb,
    secondary: read("probe-secondary", ["background-color"]),
    button: read("probe-button", ["background-color", "border-radius", "font-family"]),
    outlined: read("probe-outlined", ["color", "border-top-color"]),
    paper: read("probe-paper", ["background-color", "color", "border-radius", "box-shadow"]),
    field: read("probe-field", ["color", "font-family", "font-size"]),
    windowSentinel: window.__axfProbeSentinel ?? null,
    nodeSentinel: btn ? (btn.__axfProbeSentinel ?? null) : null
  };
})()`;

const PLANT = `(() => {
  window.__axfProbeSentinel = "planted";
  const btn = document.querySelector('[data-probe="probe-button"]');
  if (btn) btn.__axfProbeSentinel = "planted";
  return Boolean(btn);
})()`;

const CLICK_ROLL = `(() => {
  const btn = document.querySelector('[data-probe="probe-button"]');
  if (!btn) return "no button";
  btn.click();
  return "clicked";
})()`;

/* -------------------------------- checks ---------------------------------- */

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

/** MUI's stock palette, i.e. what a DEAD provider renders. */
const MUI_DEFAULTS = {
  "primary.main": ["rgb(25, 118, 210)", "#1976d2"],
  "paper.bg": ["rgb(255, 255, 255)", "#fff"],
  "text.primary": ["rgba(0, 0, 0, 0.87)"]
};
const looksDefault = (value, key) =>
  MUI_DEFAULTS[key].some((d) => value.toLowerCase() === d.toLowerCase());

function show(label, before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    const b = before?.[k] ?? "—";
    const a = after?.[k] ?? "—";
    const moved = b !== a ? "  <-- MOVED" : "";
    console.log(`    ${label}.${k.padEnd(17)} ${b}   ->   ${a}${moved}`);
  }
}

async function main() {
  const health = await fetch(BASE).catch(() => null);
  if (!health || !health.ok) {
    console.error(
      `mui-probe FAILED — no dev server on ${BASE}.\n` +
        `  Start it with: npm --prefix packages/studio run dev\n` +
        `  If it says the port is in use, it is already running and owned by another\n` +
        `  session — attach to it, never restart it (concurrent-builds rule).`
    );
    process.exit(1);
  }

  const { child, profile, port } = await launchChrome();
  let cdp;
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    // Before the first navigation: every route is gated by proxy.ts (I-31).
    // This probe keeps its own CDP class, so it borrows only the session helper.
    await signIn(cdp, BASE);

    await cdp.send("Page.navigate", { url: `${BASE}${ROUTE}` });
    await cdp.waitEvent("Page.loadEventFired");
    // Hydration, Emotion's client insert, and the probe's own rAF measurement.
    await new Promise((r) => setTimeout(r, 2000));

    if (!(await cdp.eval(PLANT))) {
      fail(`the probe page rendered no [data-probe="probe-button"] — is ${ROUTE} the right route?`);
      throw new Error("nothing to measure");
    }
    const before = await cdp.eval(MEASURE);

    // 1 — themed at rest
    if (!before.button || !before.paper) {
      fail("Button or Paper missing from the page");
    } else {
      const twoCopies = [];
      if (looksDefault(before.button["background-color"], "primary.main")) {
        twoCopies.push("Button background is MUI's default blue");
      }
      if (looksDefault(before.paper["background-color"], "paper.bg")) {
        twoCopies.push("Paper background is MUI's default white");
      }
      if (looksDefault(before.paper.color, "text.primary")) {
        twoCopies.push("Paper text is MUI's default near-black");
      }
      if (twoCopies.length) {
        fail(
          `components are rendering MUI's DEFAULT theme (${twoCopies.join("; ")}).\n` +
            `        The provider is not reaching them. Two causes produce exactly this, and\n` +
            `        both are silent — check them in this order:\n` +
            `          1. TWO COPIES of @mui/material. core's <ThemeProvider> writes core's\n` +
            `             context; studio's components read studio's. Run \`npm run link:kit\`\n` +
            `             and \`npm test\` (test/mui-singleton.test.ts holds this).\n` +
            `          2. NO PROVIDER. core's AppShell no longer mounts <AxfMuiRoot>, or a\n` +
            `             surface renders outside AppShell.\n` +
            `        The theme OBJECT being correct rules out neither — it was correct\n` +
            `        (primary.main #ff7a1a) throughout the 2026-08-09 incident.`
        );
      } else {
        pass("Button, Paper and TextField resolve the engine's palette, not MUI's defaults");
      }
    }

    // roll
    await cdp.eval(CLICK_ROLL);
    // Long enough for the slowest theme MUI can roll to finish transitioning.
    // `getComputedStyle` DURING a transition returns the interpolated value, so
    // a short wait reports the colour a Button is leaving — the 2026-08-10
    // reading that made a working bridge look broken (see the note in
    // `app/mui-probe/page.tsx`). The `motionMs` dial tops out well under this.
    await new Promise((r) => setTimeout(r, 1500));
    const after = await cdp.eval(MEASURE);

    console.log("\n  computed values, before -> after the roll:");
    show("button", before.button, after.button);
    show("secondary", before.secondary, after.secondary);
    show("outlined", before.outlined, after.outlined);
    show("paper", before.paper, after.paper);
    show("field", before.field, after.field);
    show("--axf", before.vars, after.vars);
    console.log("");

    // 2 — a roll moves them: THE THEME-FOLLOWS CHECK, as a differential
    //
    // Both renderings of the one truth are compared, so the red names the half
    // that stopped. See the table in the file docblock — the four combinations
    // are four different findings, and three of them used to print the same
    // sentence.
    //
    // TRACKED is the pairing that makes it a differential rather than a vibe:
    // each MUI computed value beside the custom property it is supposed to BE.
    // `probe-secondary` is here because the other four rows cannot move — see
    // the comment in `app/mui-probe/page.tsx`: the app's default identity is a
    // style package, a style package supplies `accent`/`page`/`panel`/`ink`
    // outright, and a theme roll cannot reach a role a pack has claimed. On
    // 2026-08-11 that read as "the bridge is dead" for exactly as long as it
    // took to look at localStorage.
    const TRACKED = [
      { label: "Button (primary) background", mui: after.button?.["background-color"], was: before.button?.["background-color"], variable: "--axf-accent" },
      { label: "Button (secondary) background", mui: after.secondary?.["background-color"], was: before.secondary?.["background-color"], variable: "--axf-accent2" },
      { label: "Paper background", mui: after.paper?.["background-color"], was: before.paper?.["background-color"], variable: "--axf-panel" },
      { label: "Paper text", mui: after.paper?.color, was: before.paper?.color, variable: "--axf-ink" }
    ];

    // AGREEMENT — the strongest form of "MUI follows the theme", and the one
    // that does not depend on anything having moved: for every tracked pair,
    // the value MUI resolved must BE the value the custom property carries. A
    // frozen bridge that happens to be frozen on the current theme is caught by
    // the movement checks below; a bridge reading a DIFFERENT theme is caught
    // here even at rest.
    const disagreements = TRACKED.filter(
      (t) => t.mui && after.rgb?.[t.variable] && t.mui !== after.rgb[t.variable]
    );
    if (disagreements.length) {
      fail(
        "MUI and the --axf-* custom properties DISAGREE — the two renderings of one truth have\n" +
          "        come apart, so an MUI surface and a token() surface on the same screen are\n" +
          "        showing different themes:\n" +
          disagreements
            .map(
              (d) =>
                `          ${d.label}: MUI resolved ${d.mui}, ${d.variable} is ` +
                `${after.vars[d.variable]} (${after.rgb[d.variable]})`
            )
            .join("\n") +
          "\n        Both come from ONE store through resolveVariables/muiThemeFrom. If they\n" +
          "        differ, one of them is reading a stale or unmerged input — most likely the\n" +
          "        style-package layer, which is composed into each renderer separately."
      );
    } else {
      pass("every tracked MUI value equals the --axf-* custom property it is derived from");
    }

    const muiMoved = TRACKED.filter((t) => t.mui !== t.was).length;
    const varsMovedNames = Object.keys(after.vars ?? {}).filter(
      (name) => (before.vars ?? {})[name] !== (after.vars ?? {})[name]
    );
    const varsSummary = Object.keys(after.vars ?? {})
      .map((n) => `${n}: ${before.vars?.[n] || "—"} -> ${after.vars?.[n] || "—"}`)
      .join("\n          ");

    if (muiMoved > 0 && varsMovedNames.length > 0) {
      pass(
        `${muiMoved} of ${TRACKED.length} MUI colours and ${varsMovedNames.length} custom ` +
          `properties moved with the roll — both renderings followed`
      );
    } else if (varsMovedNames.length > 0 && muiMoved === 0) {
      fail(
        "THE MUI BRIDGE STOPPED FOLLOWING THE THEME.\n" +
          `        The roll DID happen — ${varsMovedNames.length} custom properties moved ` +
          `(${varsMovedNames.join(", ")}), so the store changed and AxfStyleRoot followed it:\n` +
          `          ${varsSummary}\n` +
          "        …and not one MUI computed colour moved. So the theme object is almost\n" +
          "        certainly perfect and simply built from values nothing is updating.\n" +
          "        Look at core/src/theme/MuiBridge.tsx, in this order:\n" +
          "          1. Is AxfMuiRoot still SUBSCRIBED? `useTheme()` and `useResolvedStyle()`\n" +
          "             are the two channels; a constant substituted for either one freezes\n" +
          "             that half with nothing thrown and nothing warned.\n" +
          "          2. Is the layout effect still adopting LIVE state, and are `values` and\n" +
          "             `style` both still in its dependency list? Drop one and the effect\n" +
          "             runs on mount only.\n" +
          "          3. Is the useMemo key still the adopted OBJECT? Memoising on a field\n" +
          "             that is deep-equal across rolls freezes the theme the same way.\n" +
          "        test/theme-follows.test.ts holds the store-side half of this contract; if\n" +
          "        it is green while this is red, the store is fine and the bridge is not."
      );
    } else if (muiMoved > 0 && varsMovedNames.length === 0) {
      fail(
        `${muiMoved} MUI colour(s) moved while NO --axf-* custom property did. The two\n` +
          "        renderings of one truth have come apart in the other direction: either\n" +
          "        AxfStyleRoot stopped publishing, or MUI is re-deriving from something\n" +
          "        other than the store. An MUI surface and a token() surface on the same\n" +
          "        screen are now showing different themes.\n" +
          `          ${varsSummary}`
      );
    } else {
      fail(
        "NOTHING moved — neither the MUI colours nor the --axf-* custom properties.\n" +
          "        This is NOT evidence against the bridge: the roll itself did not happen.\n" +
          "        Check the theme store before touching MuiBridge.tsx — a locked theme\n" +
          "        (ThemeStore refuses silently, by design), a roll button that no longer\n" +
          "        calls themeStore.roll(), or a probe route that failed to hydrate all\n" +
          "        produce exactly this reading.\n" +
          `          ${varsSummary}`
      );
    }

    // 3 — no reload
    if (after.windowSentinel !== "planted") {
      fail("the window sentinel is gone — the page RELOADED across the roll");
    } else {
      pass("no reload (window sentinel survived)");
    }

    // 4 — no re-mount
    if (after.nodeSentinel !== "planted") {
      fail(
        "the Button's node sentinel is gone — the element was REPLACED, not restyled. " +
          "A theme change must not re-create the tree."
      );
    } else {
      pass("no re-mount (the Button is the same DOM node, restyled in place)");
    }

    // 5 — no hydration warning
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
    child.kill();
    // Best effort, and deliberately unable to fail the run. Chrome does not
    // release its profile directory the instant it is killed, so on Windows
    // this throws EPERM often enough to matter — and a cleanup error crashing
    // the process after five green checks reports a PASSING probe as a failure,
    // which is the wrong answer in the most misleading direction.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  if (failures.length) {
    console.error(`\nmui-probe FAILED — ${failures.length} check(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nmui-probe OK — the theme engine drives MUI, live, with no reload and no re-mount");
}

await main();
