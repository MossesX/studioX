/**
 * `node scripts/shell-chrome-probe.mjs` — P3's gate for the shell chrome.
 *
 * The requirement it stands for (axf-mui.bmpx P3): *"Keep the command bar's
 * known fix: the search control is a BUTTON STYLED AS A FIELD, because a
 * read-only InputBase with onFocus re-opens the palette forever — MUI restores
 * focus on dialog close. That was paid for once already and MUI is still the
 * reason."*
 *
 * A comment saying "do not make this an input" is not a fix, it is a hope. The
 * trap is invisible in the source of the file that suffers from it — the
 * palette closes correctly in `CommandBarChrome`, and the loop happens because
 * `Dialog` hands focus back to whatever opened it, in the OTHER file, in core.
 * So it is checked where it is observable: on screen, by closing the palette and
 * looking again a beat later.
 *
 * Four checks, exit 1 on any miss:
 *
 *   1. **The palette opens from the bar.** Clicking the field-shaped control
 *      fires `search.open` and a dialog appears.
 *   2. **THE FOCUS LOOP.** Escape closes it, and it is STILL closed 800ms
 *      later. That delay is the check: MUI restores focus during the close
 *      transition, so a re-opening palette is briefly closed first and a
 *      same-tick assertion passes while the surface is unusable.
 *   3. **The bar's control is a real `<button>`** and carries no focus handler
 *      — the structural half of the same fact. Check 2 catches the loop; this
 *      catches the change that would cause it, before it costs a second
 *      afternoon.
 *   4. **The Modules menu opens and closes**, so the other overlay the rebuild
 *      touched is exercised rather than assumed.
 *
 * Zero dependencies: Chrome over raw CDP, as `mui-probe.mjs` does it. Throwaway
 * profile, no source touched — safe against a shared dev server, which on :3200
 * it must assume it is (`.claude/rules/concurrent-builds.md`: attach, never
 * restart).
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
const ROUTE = process.argv[2] ?? "/status";

/* ----------------------------- CDP plumbing ------------------------------- */

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "axf-shell-probe-"));
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

  /**
   * A REAL key event, through the browser's input pipeline.
   *
   * `dispatchEvent(new KeyboardEvent(...))` would be handled by React's own
   * listener but is `isTrusted: false`, and MUI's `Modal` closes on the
   * browser's keydown — so a synthetic event tests the wrong path and can pass
   * while the surface is stuck. This is the same lesson the CDP portal-click
   * trap taught: drive the input pipeline, not the framework.
   */
  async key(code, key) {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await this.send("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: 27 });
    }
  }

  /**
   * A REAL mouse click at the element's centre, through the input pipeline.
   *
   * `element.click()` is not a substitute HERE OF ALL PLACES: a programmatic
   * click does not FOCUS the element, and focus is the entire subject of this
   * probe. Measured, 2026-08-10 — with a focus-opens-the-palette handler
   * deliberately planted on the trigger, an `element.click()` run stayed green
   * because `document.activeElement` never left `<body>`, so MUI had nothing to
   * restore focus to and the loop could not occur. The probe was testing a path
   * the user never takes.
   */
  async click(selector) {
    const box = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) return false;
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", {
        type,
        x: box.x,
        y: box.y,
        button: "left",
        clickCount: 1
      });
    }
    return true;
  }

  close() {
    this.#ws.close();
  }
}

/* -------------------------------- checks ---------------------------------- */

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

/** The bar's search control, as the asset declares it (`kind: "field"`). */
const FIELD = `[data-axf-toolbar] button[aria-label="Search everything…"]`;
const MENU_BUTTON = `[data-axf-toolbar] button[aria-haspopup="menu"]`;

const dialogOpen = `Boolean(document.querySelector('.MuiDialog-root [role="dialog"]'))`;
const menuOpen = `Boolean(document.querySelector('.MuiMenu-root [role="menu"]'))`;

async function main() {
  const health = await fetch(BASE).catch(() => null);
  if (!health || !health.ok) {
    console.error(
      `shell-chrome-probe FAILED — no dev server on ${BASE}.\n` +
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
    await new Promise((r) => setTimeout(r, 2500));

    /* 3 — the structural half, read off the real DOM */
    const control = await cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(FIELD)});
      if (!el) return null;
      return {
        tag: el.tagName,
        type: el.getAttribute("type"),
        readOnly: el.hasAttribute("readonly"),
        // React attaches at the root, so an onFocus prop leaves no attribute.
        // What CAN be read is the shape: an <input> here at all is the mistake,
        // because the trap needs an element focus can land on that also opens
        // the dialog. A <button> opened by click cannot loop.
        isInput: el.tagName === "INPUT"
      };
    })()`);
    if (!control) {
      fail(`the bar has no search control matching ${FIELD} — is the command bar registered?`);
    } else if (control.isInput) {
      fail(
        "the bar's search control is an <input>. It must be a BUTTON styled as a field: MUI " +
          "restores focus to the trigger when the palette closes, and an input with an onFocus " +
          "that opens the palette re-opens it forever. That was paid for once already."
      );
    } else {
      pass(`the bar's search control is a <${control.tag.toLowerCase()}>, not an input`);
    }

    /* VERIFIED RED BY MUTATION, 2026-08-10. A focus listener that re-fires the
     * palette signal was planted on the trigger here:
     *
     *   el.addEventListener("focus", () => window.dispatchEvent(
     *     new CustomEvent("axs:shell", { detail: { kind: "palette" } })));
     *
     * and check 2 went red naming the loop. It was planted on the LIVE PAGE
     * rather than in core's `Toolbar` because the dev server on :3200 is shared
     * and serves a partially stale graph after a core edit (P2's note) — the
     * source mutation was tried first and never reached the browser, which
     * would have read as a passing guard. Two lessons kept in the file: a
     * mutation you cannot see land proves nothing, and `element.click()` is not
     * a click here — it does not focus, so the first mutation run stayed green
     * against a trigger that never held focus at all. */

    /* 1 — it opens */
    if (!(await cdp.click(FIELD))) {
      fail("the bar's search control could not be clicked");
    }
    await new Promise((r) => setTimeout(r, 600));
    if (!(await cdp.eval(dialogOpen))) {
      fail("clicking the bar's search control did not open the palette");
    } else {
      pass("clicking the bar's search control opens the palette");
    }

    /* 2 — THE FOCUS LOOP.
     *
     * SAMPLED, not read twice. "Closed?" at one instant cannot tell "Escape did
     * nothing" from "it closed and came straight back", and those two have
     * completely different causes. Polling across the close transition
     * distinguishes them, and it is the transition the loop hides inside: MUI
     * restores focus while the dialog is animating out, so a looping palette is
     * genuinely closed for a moment first. */
    await cdp.key("Escape", "Escape");
    let everClosed = false;
    let open = true;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 60));
      open = await cdp.eval(dialogOpen);
      if (!open) everClosed = true;
    }
    // Whether MUI restores focus to the trigger at all — the mechanism the trap
    // rides on. Reported either way: if this ever stops being true, check 2 is
    // still green but has stopped testing anything.
    const restored = await cdp.eval(
      `document.activeElement === document.querySelector(${JSON.stringify(FIELD)})`
    );
    if (open) {
      // Both shapes are the same defect and the same fix, so they are one
      // failure with one message. Which shape appears depends only on timing:
      // MUI restores focus SYNCHRONOUSLY as the dialog closes, so a focus-opens
      // handler re-opens it inside the same frame and the palette never samples
      // as closed at all — which is exactly what the deliberate mutation of
      // 2026-08-10 produced. A slower reopen shows the closed moment instead.
      fail(
        `the palette is still open 1.2s after Escape (it ${
          everClosed ? "closed and CAME BACK" : "never sampled as closed"
        }). The documented cause is the focus loop: MUI restores focus to the trigger on close, ` +
          "so a trigger that opens the palette ON FOCUS re-opens it forever and the surface " +
          "cannot be escaped. The bar's search control must be a BUTTON with a click handler " +
          "and NO focus handler — see CommandBarChrome's docblock and core's `field` item kind."
      );
    } else {
      pass(
        "Escape closes the palette and it stays closed — no focus loop " +
          `(focus ${restored ? "WAS" : "was not"} restored to the trigger, so the trap is ` +
          `${restored ? "live and shut" : "not reproducible on this run"})`
      );
    }

    /* 4 — the other overlay.
     *
     * Clicked if the active bar declares a menu affordance, and otherwise
     * summoned by the command — because on the banner actually in force
     * (`console-bar`, activated by the dashboard wrapper) there IS no menu
     * item, and `modules.open` is reachable only by command. Testing only the
     * affordance would have skipped the path that was broken: the first MUI
     * rewrite anchored the menu to that button and made the command dead when
     * it was absent, which is what this check caught on its first run. */
    const affordance = await cdp.eval(`Boolean(document.querySelector(${JSON.stringify(MENU_BUTTON)}))`);
    console.log(
      `  (active banner ${affordance ? "declares" : "declares NO"} menu affordance — summoning ` +
        `the menu by ${affordance ? "click" : "command"})`
    );
    await cdp.eval(
      affordance
        ? `document.querySelector(${JSON.stringify(MENU_BUTTON)}).click()`
        : `window.dispatchEvent(new CustomEvent("axs:shell", { detail: { kind: "menu" } }))`
    );
    await new Promise((r) => setTimeout(r, 600));
    const opened = await cdp.eval(menuOpen);
    await cdp.key("Escape", "Escape");
    await new Promise((r) => setTimeout(r, 800));
    const menuClosed = !(await cdp.eval(menuOpen));
    if (!opened) {
      fail("clicking the bar's Modules affordance did not open the menu");
    } else if (!menuClosed) {
      fail("the Modules menu did not close on Escape, or re-opened after closing");
    } else {
      pass("the Modules menu opens from the bar and closes on Escape");
    }

    const hydration = cdp
      .consoleText()
      .filter((t) => /hydrat|did not match|server rendered HTML/i.test(t));
    if (hydration.length) {
      fail(`React reported ${hydration.length} hydration problem(s):\n        ${hydration.join("\n        ")}`);
    } else {
      pass("no hydration warning while driving the shell chrome");
    }
  } finally {
    cdp?.close();
    child.kill();
    // Best effort, and deliberately unable to fail the run — see mui-probe.mjs.
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
    console.error(`\nshell-chrome-probe FAILED — ${failures.length} check(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nshell-chrome-probe OK — the palette and the menu work, and the focus loop is shut");
}

await main();
