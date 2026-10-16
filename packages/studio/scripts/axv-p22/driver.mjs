/**
 * axv-p22/driver.mjs — the shared browser rig for the P22 walk.
 *
 * Every state of the walk drives a REAL Chromium against the P22 proof
 * topology (`axv-p22-proof-server.mjs` on :3220 → the real UI from :3200, the
 * real API over the scratch roots, the real media server on :3215). Nothing
 * here stubs a surface: a "user" is a browser context with its own cookie jar,
 * signed in through the studio's own sign-in card.
 *
 * Cameras are Chromium's fake device (`--use-fake-device-for-media-stream`), a
 * real getUserMedia track carrying a moving pattern — the media plane is
 * genuinely encoding and relaying it, which is the only way the 49-tile grid
 * and the recorder can be proved at all on one machine.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

export const BASE = process.env.AXV_P22_BASE ?? "http://localhost:3220";
export const SHOTS = process.env.AXV_P22_SHOTS ??
  "C:/Home/Projects/GizmoX/build/projects/axf-amberxvid-social-proof";
export const PASSWORD = (u) => (u === "admin" ? "P22-admin-pass" : `P22-${u}-pass`);

fs.mkdirSync(SHOTS, { recursive: true });

const notes = [];
export function note(line) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[p22 ${stamp}] ${line}`);
  notes.push(line);
}
export function notesSoFar() {
  return notes.slice();
}

export async function launch() {
  return chromium.launch({
    headless: process.env.AXV_P22_HEADED === "1" ? false : true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-dev-shm-usage",
    ],
  });
}

/** One browser context = one person. Separate cookie jars are what make the
 *  private-window case in state 1 real rather than asserted. */
export async function person(browser, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    permissions: ["camera", "microphone"],
    baseURL: BASE,
  });
  ctx.setDefaultTimeout(45_000);
  // Playwright DISMISSES a native dialog by default, and the module's block
  // action is deliberately behind a `window.confirm` (a block is silent and
  // one-sided, so there is no moment afterwards in which a mistake announces
  // itself). Auto-dismissing it silently cancelled the block and made the walk
  // look like a missing guard — the person driving this browser means yes.
  ctx.on("page", (p) => p.on("dialog", (d) => void d.accept().catch(() => {})));
  return ctx;
}

/** Sign in through the studio's OWN card at /accounts — never by planting a
 *  cookie. State 2's claim ("one sign-in, no second login") only means
 *  something if the sign-in was the product's. */
export async function signIn(page, user) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // `/login` is the studio's front door as of 2026-08-15 (another session
    // added the gate while this walk was running); `/accounts` bounces here
    // when signed out, so going straight there is the same journey with one
    // fewer redirect to race.
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Username").waitFor({ state: "visible" });
    await page.getByLabel("Username").fill(user);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD(user));
    await page.getByRole("button", { name: "Sign in" }).click();
    await page
      .waitForFunction(() => !document.body.innerText.includes("Sign in to the studio"), undefined, {
        timeout: 30_000,
      })
      .catch(() => {});
    // Leaving the card is not the same as HOLDING a session: assert the cookie
    // the whole walk rides on, or the next step lands on /login with a timeout
    // that says nothing about why. Asked through the CONTEXT's request API
    // rather than `page.evaluate`, because a successful sign-in navigates and
    // an in-page fetch dies with "execution context was destroyed".
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    const res = await page.context().request.get(`${BASE}/api/accounts/session`);
    const who = res.ok() ? await res.json().catch(() => null) : null;
    if (who?.signedIn && String(who.me?.username).toLowerCase() === user.toLowerCase()) return page;
    note(`sign-in attempt ${attempt} for ${user} did not hold a session — retrying`);
    await page.waitForTimeout(1500);
  }
  throw new Error(`could not sign ${user} in`);
}

/** The suite's splash always plays its full random 7–12s on every load, by
 *  design. Waiting for the surface bar is the honest way past it. */
export async function openSuite(page, view) {
  const url = view ? `/amberxvid?view=${view}` : "/amberxvid";
  // Retried, because :3200 is a SHARED dev server: another session editing the
  // studio recompiles under us, and a page caught mid-recompile is a stall
  // rather than a defect. Three attempts, then it is real.
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-axf-area="amberxvid.surface"]', { timeout: 45_000 });
      await page.waitForTimeout(600);
      return page;
    } catch (err) {
      last = err;
      note(`openSuite attempt ${attempt} stalled — retrying`);
      await page.waitForTimeout(3000);
    }
  }
  throw last;
}

/** Switch stage without a reload — the suite is ONE mounted screen. */
export async function gotoView(page, view) {
  await page.evaluate((v) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", v);
    window.history.replaceState({}, "", url.toString());
  }, view);
  await page.getByRole("button", { name: new RegExp(`^${view}$`, "i") }).click().catch(() => {});
  await page.waitForTimeout(500);
}

export async function shot(page, name, { full = false } = {}) {
  const file = path.join(SHOTS, `${name}.png`);
  // Chromium refuses a capture while the compositor is mid-frame — which on
  // this app is often, because the suite animates constantly. Retrying is the
  // fix; failing the walk over a frame boundary is not.
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.screenshot({ path: file, fullPage: full, animations: "disabled", timeout: 20_000 });
      note(`shot ${path.basename(file)}`);
      return file;
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(800);
    }
  }
  throw lastErr;
}

/** Read the page as a person would — used for the honest "what is on screen"
 *  lines in the report, and to assert refusals by their real wording. */
export async function text(page) {
  return page.evaluate(() => document.body.innerText);
}

export async function api(context, url, init) {
  const res = await context.request.fetch(`${BASE}${url}`, init);
  const body = await res.text();
  try {
    return { status: res.status(), json: JSON.parse(body) };
  } catch {
    return { status: res.status(), json: null, body };
  }
}

export function writeRecord(name, value) {
  const file = path.join(SHOTS, name);
  fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  note(`record ${path.basename(file)}`);
  return file;
}
