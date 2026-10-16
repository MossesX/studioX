/**
 * State 11 — THE PEEL. The P20 smoke re-run against the peeled app (22/22, see
 * `11-peel-smoke.txt`), plus the peeled product's OWN screenshots: this is a
 * different app on :3270, with its own store, its own vendored framework and
 * the accounts engine, media server, plugin engine and assistant carried
 * inside it.
 */
import { launch, person, shot, text, note, writeRecord } from "./driver.mjs";

const PEEL = process.env.AXV_P22_PEEL ?? "http://localhost:3270";
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: PEEL });
ctx.setDefaultTimeout(45_000);
const page = await ctx.newPage();

const health = await (await ctx.request.get(`${PEEL}/api/health`)).json();
note(`peel health: ${JSON.stringify(health).slice(0, 300)}`);

for (const [name, route] of [
  ["11a-peel-entry", "/"],
  ["11b-peel-amberxvid", "/amberxvid"],
  ["11c-peel-accounts", "/accounts"],
]) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  await shot(page, name);
  note(`${route}: ${(await text(page)).replace(/\s+/g, " ").slice(0, 220)}`);
}

writeRecord("11-peel.json", { base: PEEL, health });
await browser.close();
