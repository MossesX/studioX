/**
 * State 5 — STREAMING, both directions of the recorder.
 *
 * A host broadcasts; two viewers watch, chat and are counted. The HOST records
 * on the server (the media server writes the room), a VIEWER records what is
 * coming down to them in their own browser, both files land in their own
 * libraries and play, and when the broadcast ends it is in the stream history
 * with its numbers.
 */
import { launch, person, signIn, openSuite, shot, text, note, writeRecord, api } from "./driver.mjs";

const browser = await launch();

const make = async (user, view) => {
  const ctx = await person(browser, { width: 1360, height: 860 });
  const page = await ctx.newPage();
  await signIn(page, user);
  await openSuite(page, view);
  await page.locator('[data-el-id="amberxvid:stream-room:close"]').click({ timeout: 3000 }).catch(() => {});
  await page.locator('[data-el-id="amberxvid:room:close"]').click({ timeout: 3000 }).catch(() => {});
  return { user, ctx, page };
};

const host = await make("brett", "streams");
// Any stream left live from an earlier state belongs to somebody else; end
// only OUR OWN, so the walk is repeatable without touching another host.
await host.page.locator('[data-el-id="amberxvid:streams:go-live"]').click();
const title = host.page.getByLabel("Stream title");
if (await title.count()) {
  await title.fill("Saturday session");
  await host.page.getByRole("button", { name: /^Go live$/ }).last().click();
}
await host.page.waitForTimeout(8000);
await shot(host.page, "05a-host-live");
note(`host: ${(await text(host.page)).replace(/\s+/g, " ").slice(0, 300)}`);

/* ------------------------------- the viewers -------------------------------- */

const viewers = [];
for (const user of ["jenny", "evan"]) {
  const v = await make(user, "streams");
  await v.page.waitForTimeout(1500);
  // The thumbnail IS the way in — the card's title is a label, not a button.
  await v.page.locator('[data-el-id^="amberxvid:streams:thumb:"]').first().click();
  await v.page.waitForTimeout(9000);
  note(`${user}: watching`);
  viewers.push(v);
}
await shot(viewers[0].page, "05b-viewer-watching");

// Chat is the room's own rail, and the viewer count is the host's readout.
for (const v of viewers) {
  await v.page.locator('[data-el-id="amberxvid:stream-room:composer"]').fill(`${v.user} says hello`);
  await v.page.keyboard.press("Enter");
  await v.page.waitForTimeout(1500);
}
await host.page.waitForTimeout(3000);
await shot(host.page, "05c-host-chat-and-viewer-count");
const count = await host.page
  .locator('[data-el-id="amberxvid:stream-room:viewer-count"]')
  .innerText()
  .catch(() => null);
note(`viewer count on the host's screen: ${count?.replace(/\s+/g, " ") ?? "not found"}`);

/* --------------------------- both recorders, at once ------------------------ */

await host.page.locator('[data-el-id="amberxvid:stream-room:record"]').click();
await host.page.waitForTimeout(2000);
await shot(host.page, "05d-host-server-recording");

await viewers[0].page.locator('[data-el-id="amberxvid:stream-room:record-incoming"]').click();
await viewers[0].page.waitForTimeout(2000);
await shot(viewers[0].page, "05e-viewer-client-recording");

// Let both recorders actually capture something worth playing back.
await host.page.waitForTimeout(15_000);

await viewers[0].page.locator('[data-el-id="amberxvid:stream-room:record-incoming"]').click();
await viewers[0].page.waitForTimeout(4000);
await host.page.locator('[data-el-id="amberxvid:stream-room:record"]').click();
await host.page.waitForTimeout(4000);

/* ------------------------------- end and check ------------------------------ */

await host.page.locator('[data-el-id="amberxvid:stream-room:end"]').click();
await host.page.waitForTimeout(6000);
await shot(host.page, "05f-stream-ended");

const libraries = {};
for (const who of [host, viewers[0]]) {
  const recs = await api(who.ctx, "/api/amberxvid/recordings");
  libraries[who.user] = recs.json?.recordings?.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind ?? r.source ?? null,
    bytes: r.sizeBytes ?? r.bytes ?? null,
    at: r.createdAt ?? r.startedAt ?? null,
  }));
  note(`${who.user}'s library: ${JSON.stringify(libraries[who.user])}`);

  await who.page.getByRole("button", { name: "Library", exact: true }).click();
  await who.page.waitForTimeout(2500);
  await shot(who.page, `05g-library-${who.user}`);
  // Play the top entry — a file in a list is not a file that plays.
  const card = who.page.locator('[data-el-id^="amberxvid:library:card:"]').first();
  if (await card.count()) await card.click();
  await who.page.waitForTimeout(2500);
  await who.page.locator('[data-el-id="amberxvid:library:player-play"]').click({ timeout: 5000 }).catch(() => {});
  await who.page.waitForTimeout(5000);
  const playing = await who.page.evaluate(() => {
    const v = document.querySelector('[data-el-id="amberxvid:library:player-video"]') ?? document.querySelector("video");
    return v ? { currentTime: v.currentTime, duration: v.duration, paused: v.paused, src: (v.currentSrc || "").slice(-60) } : null;
  });
  note(`${who.user} playback: ${JSON.stringify(playing)}`);
  libraries[`${who.user}:playback`] = playing;
  await shot(who.page, `05h-playing-${who.user}`);
}

await host.page.locator('[data-el-id="amberxvid:streams:history"]').click({ timeout: 8000 }).catch(async () => {
  await host.page.getByRole("button", { name: "History", exact: true }).click();
});
await host.page.waitForTimeout(3000);
await shot(host.page, "05i-stream-history");
note(`history: ${(await text(host.page)).replace(/\s+/g, " ").slice(0, 400)}`);

writeRecord("05-streaming.json", { viewerCount: count, libraries });
await browser.close();
