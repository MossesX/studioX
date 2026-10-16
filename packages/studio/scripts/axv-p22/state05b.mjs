/** State 5, tail — the stream in HISTORY after it ended, from both sides. */
import { launch, person, signIn, openSuite, shot, text, note, writeRecord } from "./driver.mjs";

const browser = await launch();
const out = {};
for (const user of ["brett", "jenny"]) {
  const ctx = await person(browser, { width: 1360, height: 860 });
  const page = await ctx.newPage();
  await signIn(page, user);
  await openSuite(page, "streams");
  await page.locator('[data-el-id="amberxvid:stream-room:close"]').click({ timeout: 3000 }).catch(() => {});
  await page.locator('[data-el-id="amberxvid:streams:history"]').click();
  await page.waitForTimeout(2500);
  await shot(page, `05i-stream-history-${user}`);
  const hosted = await page.locator('[data-el-id="amberxvid:streams:history-hosted"]').innerText().catch(() => null);
  const watched = await page.locator('[data-el-id="amberxvid:streams:history-watched"]').innerText().catch(() => null);
  out[user] = { hosted: hosted?.replace(/\s+/g, " ") ?? null, watched: watched?.replace(/\s+/g, " ") ?? null };
  note(`${user} hosted: ${out[user].hosted}`);
  note(`${user} watched: ${out[user].watched}`);
}
writeRecord("05-stream-history.json", out);
await browser.close();
