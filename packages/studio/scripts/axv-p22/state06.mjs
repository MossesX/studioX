/**
 * State 6 — THE WALL AND THE ALBUMS. A post with two photos, a buddy reacting
 * and commenting on it, the blocked account seeing nothing at all, and the
 * album lightbox carrying the same social rail as the wall (one comment
 * system, two subjects).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { launch, person, signIn, openSuite, shot, text, note, writeRecord, api } from "./driver.mjs";

/* Two real images, made here — a wall attachment is sniffed from its bytes. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axv-p22-"));
let CRC = null;
const crc32 = (buf) => {
  if (!CRC) {
    CRC = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
};
const png = (w, h, seed) => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < w; x += 1) {
      raw[o] = (x * 255) / w;
      raw[o + 1] = (seed * 90 + y) % 256;
      raw[o + 2] = (y * 255) / h;
      o += 3;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
const shots = [1, 2].map((i) => {
  const f = path.join(tmp, `photo-${i}.png`);
  fs.writeFileSync(f, png(640, 420, i));
  return f;
});

const browser = await launch();

const open = async (user, view) => {
  const ctx = await person(browser, { width: 1440, height: 900 });
  const page = await ctx.newPage();
  await signIn(page, user);
  await openSuite(page, view);
  await page.locator('[data-el-id="amberxvid:stream-room:close"]').click({ timeout: 2500 }).catch(() => {});
  await page.locator('[data-el-id="amberxvid:room:close"]').click({ timeout: 2500 }).catch(() => {});
  return { user, ctx, page };
};

const brett = await open("brett", "profile");
const jenny = await open("jenny", "profile");

/* Buddies is SETUP — both halves through the real relations verbs, because a
 * post with `buddies` visibility needs the edge to mean something. */
await api(brett.ctx, "/api/accounts/relations", { method: "POST", data: { action: "request", user: "jenny" } });
await api(jenny.ctx, "/api/accounts/relations", { method: "POST", data: { action: "accept", user: "brett" } });
note("brett + jenny are buddies");

/* Clear anything a previous walk left on the wall, so the "blocked sees
 * nothing" screenshot is unambiguous rather than showing an old PUBLIC post
 * that a stranger is entitled to see anyway. */
{
  const existing = await api(brett.ctx, "/api/amberxvid/wall?owner=brett");
  for (const p of existing.json?.posts ?? []) {
    await api(brett.ctx, "/api/amberxvid/wall", { method: "POST", data: { action: "delete", postId: p.id } });
  }
  note(`cleared ${existing.json?.posts?.length ?? 0} earlier post(s)`);
}

/* ------------------------------ the post itself ----------------------------- */

await brett.page.reload({ waitUntil: "domcontentloaded" });
await brett.page.waitForSelector('[data-axf-area="amberxvid.surface"]', { timeout: 60_000 });
await brett.page.locator('[data-el-id="amberxvid:wall:composer-text"] textarea').first().fill(
  "Two frames from the build night — the rig and the window.",
);
await brett.page.locator('[data-el-id="amberxvid:wall:composer-media"] input[type=file]').setInputFiles(shots)
  .catch(async () => {
    await brett.page.locator('input[type=file]').first().setInputFiles(shots);
  });
// BUDDIES-only, deliberately. A public post is visible to a stranger, and a
// blocked viewer is byte-identical to a stranger BY DESIGN — so posting
// publicly and then claiming "the blocked account sees nothing" would be
// testing the wrong thing and would fail honestly (it did, the first time).
await brett.page.locator('[data-el-id="amberxvid:wall:visibility"]').click();
await brett.page.waitForTimeout(500);
await brett.page.getByRole("option", { name: /Buddies/i }).click();
await brett.page.waitForTimeout(2500);
await shot(brett.page, "06a-composer-two-photos");
await brett.page.locator('[data-el-id="amberxvid:wall:composer-post"]').click();
await brett.page.waitForTimeout(4000);
await shot(brett.page, "06b-post-published");

const wall = await api(brett.ctx, "/api/amberxvid/wall?owner=brett");
const post = wall.json?.posts?.[0];
note(`post ${post?.id} · visibility ${post?.visibility} · ${post?.media?.length ?? 0} photo(s)`);

/* ------------------------- the buddy reacts and comments -------------------- */

await jenny.page.getByRole("button", { name: "Feed", exact: true }).click();
await jenny.page.waitForTimeout(3500);
await shot(jenny.page, "06c-buddy-sees-post-in-feed");
await jenny.page.locator(`[data-el-id="amberxvid:wall:like:${post.id}"]`).click();
await jenny.page.waitForTimeout(1200);
await jenny.page.locator(`[data-el-id="amberxvid:wall:comments:${post.id}"]`).click();
await jenny.page.waitForTimeout(800);
const box = jenny.page.locator(`[data-el-id="amberxvid:wall:comment-box:${post.id}"]`);
await (await box.locator("textarea, input").count()
  ? box.locator("textarea, input").first()
  : box
).fill("that rig is a museum piece");
await jenny.page.keyboard.press("Enter");
await jenny.page.waitForTimeout(2500);
await shot(jenny.page, "06d-buddy-reacted-and-commented");

await brett.page.reload({ waitUntil: "domcontentloaded" });
await brett.page.waitForSelector('[data-axf-area="amberxvid.surface"]', { timeout: 60_000 });
await brett.page.waitForTimeout(2500);
await shot(brett.page, "06e-author-sees-reaction");

/* --------------------------- the blocked account sees nothing --------------- */

const carl = await open("carl", "profiles");
const carlWall = await api(carl.ctx, "/api/amberxvid/wall?owner=brett");
const ghostWall = await api(carl.ctx, "/api/amberxvid/wall?owner=nobodyatall");
const carlSees = (carlWall.json?.posts ?? []).map((p) => p.id);
note(`carl reading brett's wall: ${JSON.stringify(carlWall.json).slice(0, 220)}`);
note(`carl can see the buddies-only post: ${carlSees.includes(post.id)}`);
note(`carl reading a wall that never existed: ${JSON.stringify(ghostWall.json).slice(0, 200)}`);
await carl.page.getByRole("button", { name: "Feed", exact: true }).click();
await carl.page.waitForTimeout(3000);
await shot(carl.page, "06f-blocked-sees-nothing");

/* ------------------------------ the lightbox -------------------------------- */

await brett.page.getByRole("button", { name: "Photos", exact: true }).click();
await brett.page.waitForTimeout(2000);
await brett.page.locator('[data-el-id^="amberxvid:albums:album:"]').first().click();
await brett.page.waitForTimeout(2000);
await brett.page.locator('[data-el-id^="amberxvid:albums:photo:"]').first().click();
await brett.page.waitForTimeout(2500);
await shot(brett.page, "06g-album-lightbox-social-rail");
const rail = await brett.page
  .locator('[data-el-id^="amberxvid:albums:lightbox:"]')
  .innerText()
  .catch(() => null);
note(`lightbox: ${rail?.replace(/\s+/g, " ").slice(0, 300) ?? "not open"}`);

writeRecord("06-wall.json", {
  post: post ? { id: post.id, media: post.media?.length ?? 0, visibility: post.visibility } : null,
  blockedRead: carlWall.json,
  absentRead: ghostWall.json,
  lightbox: rail?.replace(/\s+/g, " ") ?? null,
});
await browser.close();
