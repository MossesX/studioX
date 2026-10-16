/**
 * Headless Chrome over raw CDP — the plumbing every probe in this package needs.
 *
 * `mui-probe.mjs` and `geometry-probe.mjs` each carry their own copy of this,
 * written before there was a third caller. It is extracted here rather than
 * copied a third time; those two are deliberately left alone (they are live
 * gates, and rewiring a working gate to prove a point about duplication is how
 * a green check becomes an unverified one).
 *
 * Zero dependencies: Node's global `WebSocket` and `fetch`, a throwaway profile,
 * and no source touched — which is what makes it safe against a dev server on
 * :3200 that another session owns (`concurrent-builds.md`: attach, never
 * restart).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { probeSessionCookie } from "./probe-session.mjs";

export const CHROME = process.env.AXF_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

/* --------------------------------- the session ----------------------------- */

/**
 * Sign the page in before its FIRST navigation (I-31).
 *
 * `proxy.ts` gates every route on `axs_session` and answers a signed-out
 * request `307 → /login?next=…`, so without this every probe in this package
 * reads the login screen and reports the surface it was aiming at as broken.
 * Call it once, straight after `Cdp.attach`, and pass whatever base the probe
 * navigates to.
 *
 * Takes any object with `.send()`, so the four probes that predate this helper
 * and still carry their own CDP class (`mui-probe`, `geometry-probe`,
 * `brand-recolour-probe`, `shell-chrome-probe`) can use it unchanged.
 *
 * Returns the account it signed in as, so a probe can say whose view it
 * measured — an administrator and a member do not see the same nav.
 */
export async function signIn(cdp, base) {
  const cookie = await probeSessionCookie();

  /*
   * Preflight, in Node, before Chrome is involved at all.
   *
   * This is the "fail differently" half of I-31. A token can be well-formed and
   * still not be the one in force — signed under a different
   * `ACCOUNTS_DATA_DIR`'s secret, or naming an account that has since been
   * disabled. Asking the server once turns every such case into one sentence
   * naming the SESSION, instead of ten assertions naming surfaces.
   *
   * TWO signals, because a redirect alone misses the worse case. Where the
   * machine has development auto-login configured (`lib/devAuth.ts`), a token
   * the gate rejects does NOT produce a redirect: proxy.ts falls through and
   * mints a session for its OWN account instead. The probe would then sail on,
   * measuring a different member's kv bucket — different saved theme, layout
   * and nav — and every disagreement with the developer's screen would be
   * unattributable. A minted-for-us response carries no `set-cookie`, so the
   * presence of one is exactly the tell.
   */
  const res = await fetch(base, { headers: { cookie: `${cookie.name}=${cookie.value}` }, redirect: "manual" });
  const bounced = res.status >= 300 && res.status < 400 && /\/login/.test(res.headers.get("location") ?? "");
  const reissued = (res.headers.getSetCookie?.() ?? []).some((c) => c.startsWith(`${cookie.name}=`));
  if (bounced || reissued) {
    throw new Error(
      `the session gate did not accept a freshly minted ${cookie.name} for "${cookie.username}" — ` +
        (bounced
          ? `${base} redirected to ${res.headers.get("location")}.`
          : `${base} answered ${res.status} but re-issued the cookie, so the page was served to ` +
            "somebody else (development auto-login stood in) and nothing measured would be this " +
            "account's view.") +
        " The token verifies only against the secret in the store it was signed from: check that " +
        "this probe and the dev server resolve the same ACCOUNTS_DATA_DIR, and that the account " +
        "is still enabled."
    );
  }

  await cdp.send("Network.enable");
  const { success } = await cdp.send("Network.setCookie", {
    name: cookie.name,
    value: cookie.value,
    url: base,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  });
  if (!success) throw new Error(`Chrome refused the ${cookie.name} cookie for ${base}`);
  return { username: cookie.username, role: cookie.role };
}

/**
 * Fail with the CAUSE rather than with a symptom.
 *
 * The cost of I-31 was never the redirect — it was that ten gates reported
 * "`[data-axf-pack]` never appeared on /brand", so the first move was always to
 * investigate a screen that was fine. Call this right after a navigation and a
 * lost session says so in one sentence, before any selector is asserted.
 */
export async function assertSignedIn(cdp, wantPath) {
  const href = await cdp.eval("location.href");
  const { pathname, searchParams } = new URL(href);
  const bounced = searchParams.has("next") || /^\/login(-landing)?(\/|$)/.test(pathname);
  if (bounced) {
    throw new Error(
      `not signed in — asked for ${wantPath}, landed on ${pathname}. The page gate in ` +
        "proxy.ts redirected before the route rendered, so nothing about the surface has " +
        "been measured. Call signIn(cdp, base) before the first navigation."
    );
  }
}

export async function launchChrome({ width = 1600, height = 1000 } = {}) {
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
      `--window-size=${width},${height}`,
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

/**
 * Best effort, and deliberately unable to fail a run: Chrome does not release
 * its profile directory the instant it is killed, and on Windows a cleanup
 * EPERM after a set of green checks would report a PASSING probe as a failure.
 */
export async function cleanup(child, profile) {
  child?.kill();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

export class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();
  #events = [];

  static async attach(port) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("no page target in Chrome");
    return Cdp.connect(page.webSocketDebuggerUrl);
  }

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

  /** A real pointer press/move/release — trusted events, exactly like a hand. */
  async mouse(type, x, y, button = "left") {
    await this.send("Input.dispatchMouseEvent", {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: type === "mouseMoved" ? "left" : button,
      buttons: 1,
      clickCount: type === "mouseMoved" ? 0 : 1
    });
  }

  close() {
    this.#ws.close();
  }
}
