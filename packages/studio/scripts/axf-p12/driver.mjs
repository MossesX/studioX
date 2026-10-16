/**
 * axf-p12/driver.mjs — the shared browser rig for the P12 walk of
 * `axf-accounts-admin-suite`.
 *
 * Same posture as `axv-p22/driver.mjs`, with the two things I-27 filed against
 * that walk fixed here rather than repeated:
 *
 *  1. **Idempotent.** Every state re-runs from a cold browser. Accounts are
 *     created only when absent, the quota fixture is truncated rather than
 *     appended, and nothing assumes a previous state left the app on a
 *     particular screen.
 *  2. **No silent evidence overwrite.** `shot()` refuses to clobber a file
 *     written by an EARLIER run: `prepareShots()` moves a pre-existing proof
 *     directory aside to `_superseded-<stamp>/` once, at the start of a run,
 *     and records where it went. Within one run a state may rewrite its own
 *     shots (that is a retry, not a loss).
 *
 * It attaches to whatever is already serving :3200 (`concurrent-builds.md`:
 * attach, never restart) and drives real Chromium through Playwright, which is
 * already a dependency of this package.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

export const BASE = process.env.AXF_P12_BASE ?? "http://localhost:3200";
export const SHOTS =
  process.env.AXF_P12_SHOTS ?? "C:/Home/Projects/GizmoX/build/projects/axf-accounts-admin-suite-proof";

/** The three accounts this walk uses. The admin is the SEEDED one — Brett and
 *  GizmoX are the owner's own logins and this walk does not touch them. */
export const ADMIN = { user: "admin", temp: "P12-admin-temp1", pass: "P12-admin-pass1" };
export const WALK = { user: "p12walk", temp: "P12-walk-temp1", pass: "P12-walk-pass1" };
export const OTHER = { user: "p12other", temp: "P12-other-temp1", pass: "P12-other-pass1" };

const RUN_MARK = path.join(SHOTS, ".p12-run");

/**
 * Called once per RUN (by `run.mjs`), never by a state. Moves a proof directory
 * left by an earlier run aside instead of writing over it.
 */
export function prepareShots({ stamp }) {
  if (fs.existsSync(SHOTS) && fs.readdirSync(SHOTS).length > 0) {
    const prevStamp = fs.existsSync(RUN_MARK) ? fs.readFileSync(RUN_MARK, "utf8").trim() : "unstamped";
    const aside = path.join(SHOTS, `_superseded-${prevStamp}`);
    fs.mkdirSync(aside, { recursive: true });
    for (const name of fs.readdirSync(SHOTS)) {
      if (name.startsWith("_superseded-") || name === ".p12-run") continue;
      fs.renameSync(path.join(SHOTS, name), path.join(aside, name));
    }
    console.log(`[p12] previous evidence moved to ${aside}`);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(RUN_MARK, `${stamp}\n`, "utf8");
  return SHOTS;
}

fs.mkdirSync(SHOTS, { recursive: true });

const notes = [];
export function note(line) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[p12 ${stamp}] ${line}`);
  notes.push(line);
}
export function notesSoFar() {
  return notes.slice();
}

export async function launch() {
  return chromium.launch({
    headless: process.env.AXF_P12_HEADED === "1" ? false : true,
    args: ["--disable-dev-shm-usage"],
  });
}

/** One browser context = one person: its own cookie jar, so "as that user" is
 *  a real second session rather than a claim. */
export async function person(browser, { width = 1920, height = 1200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, baseURL: BASE });
  ctx.setDefaultTimeout(45_000);
  ctx.on("page", (p) => p.on("dialog", (d) => void d.accept().catch(() => {})));
  return ctx;
}

/**
 * Sign in through the studio's OWN card at `/login`, never by planting a
 * cookie — a walk that plants its session has not proved the gate.
 *
 * Handles the forced change-password step, which every account here arrives on
 * (the seeded admin and both created users all hold a temp credential). Returns
 * the password that is in force afterwards.
 */
export async function signIn(page, who) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Username").waitFor({ state: "visible" });
    await page.getByLabel("Username").fill(who.user);
    await page.getByLabel("Password", { exact: true }).fill(who.pass);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForTimeout(1500);

    let session = await whoAmI(page.context());
    if (!session?.signedIn) {
      // The change-password step, or a stale temp credential.
      await page.goto("/login", { waitUntil: "domcontentloaded" });
      await page.getByLabel("Username").fill(who.user);
      await page.getByLabel("Password", { exact: true }).fill(who.temp);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForTimeout(1500);
      session = await whoAmI(page.context());
    }
    if (session?.signedIn && session.me?.mustChangePassword) {
      await changePassword(page, who);
      session = await whoAmI(page.context());
    }
    if (session?.signedIn && String(session.me?.username).toLowerCase() === who.user.toLowerCase()) {
      note(`signed in as ${session.me.username} (${session.me.role})`);
      return session.me;
    }
    note(`sign-in attempt ${attempt} for ${who.user} did not hold — retrying`);
    await page.waitForTimeout(1500);
  }
  throw new Error(`could not sign ${who.user} in`);
}

/** The forced change-password form — it is a SESSION state, so the person is
 *  already signed in and every other surface is behind the flag. */
async function changePassword(page, who) {
  const temp = page.getByLabel("Temp password");
  await temp.waitFor({ state: "visible", timeout: 20_000 });
  await temp.fill(who.temp);
  await page.getByLabel("New password", { exact: true }).fill(who.pass);
  await page.getByLabel("New password again").fill(who.pass);
  await page.getByRole("button", { name: "Change password" }).click();
  await page.waitForTimeout(2000);
  note(`${who.user}: forced change-password completed`);
}

/**
 * The module assistant's window opens itself over the right of the screen and
 * covers whatever is under it. It is a real feature and not in this walk's way
 * by accident — it is simply not what is being proved, and a card that cannot
 * be grabbed because a panel is over it is a walk measuring the wrong thing.
 * Closed once per page, tolerantly: absent is fine.
 */
export async function closeAssistant(page) {
  const btn = page.getByRole("button", { name: "Close assistant" });
  if (await btn.count().catch(() => 0)) {
    await btn.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    note("assistant window closed");
  }
}

export async function whoAmI(context) {
  const res = await context.request.get(`${BASE}/api/accounts/session`).catch(() => null);
  if (!res || !res.ok()) return null;
  return res.json().catch(() => null);
}

/** Open the admin suite on a named tab, without a reload once it is mounted. */
export async function openSuite(page, tab = "dashboard") {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(`/accounts?surface=admin&tab=${tab}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-axf-area="accounts.suite"]', { timeout: 45_000 });
      await page.waitForTimeout(700);
      return page;
    } catch (err) {
      note(`openSuite(${tab}) attempt ${attempt} stalled — retrying`);
      if (attempt === 3) throw err;
      await page.waitForTimeout(3000);
    }
  }
}

/** Click a tab in the admin suite's strip by its visible title. */
export async function suiteTab(page, title) {
  await page.getByRole("tab", { name: new RegExp(`^${title}$`, "i") }).click();
  await page.waitForTimeout(900);
}

export async function shot(page, name, { full = false } = {}) {
  const file = path.join(SHOTS, `${name}.png`);
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

/** A real drag: press, several moves (so a live gesture sees motion), release.
 *  `onMove` runs after each step, which is how a mid-drag screenshot is taken
 *  while the pointer is still down. */
export async function drag(page, from, to, { steps = 12, onMove = null, settle = 60 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await page.mouse.move(x, y);
    await page.waitForTimeout(settle);
    if (onMove) await onMove(i, { x, y });
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
}

export function centreOf(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
