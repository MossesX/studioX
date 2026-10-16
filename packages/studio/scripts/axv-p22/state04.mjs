/**
 * State 4 — THE GROUP ROOM. Six real browser contexts, six real cameras, one
 * room; the dev overlay's `video ≤ visible` assertion read off the screen; and
 * one camera paused, which must drop that tile to its avatar for everybody
 * else rather than freezing on the last frame.
 *
 * HONESTY, stated here as well as in the report: six peers is ONE page. The
 * 49-tile page boundary cannot be crossed with real browsers on one machine —
 * fifty Chromium contexts each encoding VP8 is not a thing this laptop does —
 * so the pagination ARITHMETIC is pinned by `lib/roomGrid.ts`'s tests
 * (`a page never holds more than 49 tiles, at any roster size`), and what is
 * proved here is the live grid, the consumer bound and the pause.
 */
import { launch, person, signIn, openSuite, shot, text, note, writeRecord, api } from "./driver.mjs";

const CAST = ["brett", "jenny", "dana", "evan", "finn", "admin"];
const browser = await launch();

const seats = [];
for (const user of CAST) {
  const ctx = await person(browser, { width: 1280, height: 820 });
  const page = await ctx.newPage();
  await signIn(page, user);
  await openSuite(page, "rooms");
  // A member who is still hosting a broadcast has that window open over the
  // suite (jenny is, from state 1). Closing the WINDOW leaves the stream live
  // and is what the toolbar's "re-open my room" exists for.
  await page.locator('[data-el-id="amberxvid:stream-room:close"]').click({ timeout: 3000 }).catch(() => {});
  seats.push({ user, ctx, page });
  note(`${user}: in the suite`);
}

/* The host opens the room through the UI; everybody else joins the row they
 * can see in the room list, which is how a person would do it. */
const host = seats[0];
await host.page.locator('[data-el-id="amberxvid:rooms:title"]').fill("Friday standup");
await host.page.locator('[data-el-id="amberxvid:rooms:open"]').click();
await host.page.waitForTimeout(8000);
note(`host screen: ${(await text(host.page)).replace(/\s+/g, " ").slice(0, 400)}`);
await shot(host.page, "04a-room-opened");

const rooms = await api(host.ctx, "/api/amberxvid/rooms");
const room = rooms.json?.rooms?.find((r) => r.host === "brett") ?? rooms.json?.rooms?.[0];
note(`room ${room?.id} "${room?.title}"`);

for (const seat of seats.slice(1)) {
  await seat.page.locator('[data-el-id="amberxvid:rooms:refresh"]').click({ timeout: 3000 }).catch(() => {});
  await seat.page.waitForTimeout(1500);
  await seat.page.locator(`[data-el-id="amberxvid:rooms:join:${room.id}"]`).click();
  await seat.page.waitForTimeout(7000);
  note(`${seat.user}: joined`);
}

// Let every peer's producers appear and every consumer settle.
await host.page.waitForTimeout(12_000);
await shot(host.page, "04b-six-tiles-live");
for (const seat of seats.slice(1, 3)) await shot(seat.page, `04c-room-from-${seat.user}`);

/* The dev overlay — read as text, so the assertion is quoted rather than
 * merely photographed. */
const stats = await host.page.locator('[data-el-id="amberxvid:room:stats"]').innerText().catch(() => null);
note(`dev overlay: ${stats?.replace(/\s+/g, " ") ?? "not on screen"}`);
const roster = await api(host.ctx, "/api/amberxvid/rooms");
writeRecord("04-room.json", {
  overlay: stats,
  room: roster.json?.rooms?.find((r) => r.id === room?.id) ?? null,
});
await host.page.locator('[data-el-id="amberxvid:room:stats"]').scrollIntoViewIfNeeded().catch(() => {});
await shot(host.page, "04d-dev-overlay");

/* One camera off — the tile must become the member's avatar everywhere. */
const paused = seats[1];
await paused.page.locator('[data-el-id="amberxvid:room:cam"]').first().click().catch(async () => {
  await paused.page.getByRole("button", { name: /camera/i }).first().click();
});
await paused.page.waitForTimeout(6000);
await shot(paused.page, "04e-paused-self");
await shot(host.page, "04f-paused-seen-by-host");
note(`host sees: ${(await text(host.page)).replace(/\s+/g, " ").slice(0, 300)}`);

await browser.close();
