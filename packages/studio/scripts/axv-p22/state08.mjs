/**
 * State 8 — QUOTA AND POLICY, at their real enforcement points.
 *
 * WHAT THIS STATE CAN AND CANNOT SHOW, said before the screenshots rather than
 * after: the thirteen amberxvid policy rows resolve through a cascade that the
 * accounts module has NEVER INSTALLED — `amberxvidPolicyStatus()` says so
 * itself, naming `axf-accounts-admin-suite` as the unrun project that owns the
 * catalog. So there is no administrator screen anywhere in the studio today
 * that can move `storageQuotaMB` or turn `canHostStreams` off, and the step's
 * "both visible in the admin suite" is not walkable.
 *
 * What IS walkable, and is what this state does: install a cascade at the
 * module's own documented seam (the proof server does it from a JSON file) and
 * then drive the product's real refusals in a real browser — the album upload
 * refusing by quota with the number in the sentence, and Go Live refusing with
 * the row named.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { launch, person, signIn, openSuite, shot, text, note, writeRecord, api } from "./driver.mjs";

/* A photo big enough to exceed a 1 MB quota on its own. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axv-p22-quota-"));
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
const noisyPng = (w, h) => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 16) & 0xff;
  for (let y = 0; y < h; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < w; x += 1) {
      raw[o] = rnd();
      raw[o + 1] = rnd();
      raw[o + 2] = rnd();
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
    chunk("IDAT", zlib.deflateSync(raw, { level: 0 })), // incompressible noise, stored
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
const big = path.join(tmp, "big.png");
fs.writeFileSync(big, noisyPng(900, 700));
note(`upload payload: ${(fs.statSync(big).size / 1024 / 1024).toFixed(2)} MB`);

const browser = await launch();
const record = {};

const open = async (user, view) => {
  const ctx = await person(browser, { width: 1440, height: 900 });
  const page = await ctx.newPage();
  await signIn(page, user);
  await openSuite(page, view);
  await page.locator('[data-el-id="amberxvid:stream-room:close"]').click({ timeout: 2500 }).catch(() => {});
  await page.locator('[data-el-id="amberxvid:room:close"]').click({ timeout: 2500 }).catch(() => {});
  return { user, ctx, page };
};

/* --------------------------- the quota, by its number ----------------------- */

const evan = await open("evan", "albums");
record.policy = (await api(evan.ctx, "/api/amberxvid/admin")).json?.policy ?? null;

await evan.page.locator('[data-el-id="amberxvid:albums:new"]').click();
await evan.page.waitForTimeout(800);
await evan.page.locator('[data-el-id="amberxvid:albums:new-title"] input').fill("Over the line");
await evan.page.locator('[data-el-id="amberxvid:albums:new-create"]').click();
await evan.page.waitForTimeout(2500);
// Creating an album opens it, so there is no card to click — only click one
// when we are still looking at the grid.
if (!(await evan.page.locator('[data-el-id="amberxvid:albums:upload"]').count())) {
  await evan.page.locator('[data-el-id^="amberxvid:albums:album:"]').first().click();
  await evan.page.waitForTimeout(1500);
}
await evan.page.locator('[data-el-id="amberxvid:albums:upload"] input[type=file]').setInputFiles([big])
  .catch(async () => {
    await evan.page.locator("input[type=file]").first().setInputFiles([big]);
  });
await evan.page.waitForTimeout(1800);
await shot(evan.page, "08a0-quota-refusal-moment");
const quotaScreen = await text(evan.page);
const refusal = quotaScreen.split("\n").find((l) => /quota|MB|storage/i.test(l)) ?? null;
note(`quota refusal on screen: ${refusal}`);
record.quotaRefusal = refusal;
await evan.page.waitForTimeout(3000);
await shot(evan.page, "08a-quota-refused-by-name");

// The sentence itself, from the door the screen was calling — a refusal a
// member can only infer from a photo that never appears is a refusal that has
// not been shown to them, and that difference belongs in the record.
const albums = await api(evan.ctx, "/api/amberxvid/albums?owner=evan");
const albumId = albums.json?.albums?.[0]?.id ?? null;
const upload = await api(evan.ctx, "/api/amberxvid/albums", {
  method: "POST",
  multipart: {
    action: "upload",
    albumId: albumId ?? "",
    photos: { name: "big.png", mimeType: "image/png", buffer: fs.readFileSync(big) },
  },
});
note(`upload door: ${upload.status} ${JSON.stringify(upload.json ?? upload.body?.slice(0, 300))}`);
record.quotaDoor = upload.json ?? upload.body ?? null;

/* -------------------- canHostStreams, with the row named -------------------- */

await evan.page.getByRole("button", { name: "Streams", exact: true }).click();
await evan.page.waitForTimeout(2000);
await evan.page.locator('[data-el-id="amberxvid:streams:go-live"]').click();
await evan.page.waitForTimeout(1200);
const t = evan.page.getByLabel("Stream title");
if (await t.count()) {
  await t.fill("Should not happen");
  await evan.page.getByRole("button", { name: /^Go live$/ }).last().click();
}
await evan.page.waitForTimeout(4000);
const liveScreen = await text(evan.page);
const liveRefusal = liveScreen.split("\n").find((l) => /canHostStreams|cannot go live|policy/i.test(l)) ?? null;
note(`go-live refusal on screen: ${liveRefusal}`);
record.goLiveRefusal = liveRefusal;
await shot(evan.page, "08b-go-live-refused-row-named");

// And the same refusal at the door itself, so the sentence is quoted rather
// than only photographed.
const doorway = await api(evan.ctx, "/api/amberxvid/streams", { method: "POST", data: { action: "open", title: "Should not happen" } });
note(`streams door: ${doorway.status} ${JSON.stringify(doorway.json)}`);
record.goLiveDoor = doorway.json;

/* ------------------------ what the admin suite can show --------------------- */

const admin = await open("admin", "profiles");
await admin.page.goto("/accounts", { waitUntil: "domcontentloaded" });
await admin.page.waitForTimeout(3000);
await admin.page.getByRole("tab", { name: /AmberX Vid/i }).click().catch(() => {});
await admin.page.waitForTimeout(3000);
await shot(admin.page, "08c-admin-suite-amberxvid-wing");
const wing = await text(admin.page);
record.adminWing = wing.replace(/\s+/g, " ").slice(0, 1200);
note(`admin wing: ${record.adminWing.slice(0, 400)}`);

const status = await api(admin.ctx, "/api/amberxvid/admin");
record.adminPayload = status.json;
note(`policy status as the module states it: ${JSON.stringify(status.json?.policyStatus ?? null)}`);

writeRecord("08-quota-policy.json", record);
await browser.close();
