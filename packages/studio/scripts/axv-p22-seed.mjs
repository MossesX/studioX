/**
 * axv-p22-seed.mjs — the CAST and the pre-migration world the P22 walk needs.
 *
 * Setup runs through the module's OWN engines against the scratch roots (same
 * code, same disk, no HTTP guessing); the PROOF then runs entirely in real
 * browsers against those same roots through `axv-p22-proof-server.mjs`. Nothing
 * here fakes a state the product cannot reach — every account is born through
 * `addUser`, every password is set through `changePassword`, and the migrated
 * member's albums are moved by the REAL P1/P2 migrations, not written into
 * place.
 *
 *   ACCOUNTS_DATA_DIR=… AMBERXVID_DATA_DIR=… ACCOUNTS_AUTH_SECRET=… \
 *     node --import ./test/alias-hook.mjs scripts/axv-p22-seed.mjs
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const need = (k) => {
  const v = process.env[k]?.trim();
  if (!v) {
    console.error(`[p22-seed] ${k} is unset — refusing to seed anywhere near the real store.`);
    process.exit(2);
  }
  return v;
};
const AXV = need("AMBERXVID_DATA_DIR");
const ACC = need("ACCOUNTS_DATA_DIR");

const { addUser, changePassword, setScreenname, verifyLogin, listAccounts } = await import(
  "@axs/modules/accounts/lib/accounts"
);

/** The cast, and what each one is FOR in the walk. */
export const CAST = [
  { user: "brett", name: "Brett", why: "the protagonist — the migrated member" },
  { user: "jenny", name: "Jenny", why: "buddy: reacts, comments, group chat, group room" },
  { user: "carl", name: "Carl", why: "the blocked party — state 3's four refusals" },
  { user: "dana", name: "Dana", why: "the offline group-chat member (deliveredAt on return)" },
  { user: "evan", name: "Evan", why: "group room + stream viewer" },
  { user: "finn", name: "Finn", why: "group room + stream viewer" },
];
export const PASSWORD = (u) => `P22-${u}-pass`;
export const ADMIN_PASSWORD = "P22-admin-pass";

/* ---------------------------- 1. the administrator --------------------------- */

// The store seeds `admin` with the temp credential `amberx` on first read and
// forces a change. Doing that here rather than in the browser means the walk's
// first screenshot can be the REAL gate (state 1) rather than a setup chore.
const first = await verifyLogin("admin", "amberx");
if (first.ok) {
  const changed = await changePassword("admin", "amberx", ADMIN_PASSWORD);
  if (!changed.ok) throw new Error(`admin password change refused: ${changed.error}`);
  console.log("[p22-seed] admin: seeded, entry flow completed");
} else {
  const already = await verifyLogin("admin", ADMIN_PASSWORD);
  if (!already.ok) throw new Error(`admin is neither seeded nor already set up: ${first.error}`);
  console.log("[p22-seed] admin: already set up");
}

/* ------------------------------- 2. the members ------------------------------ */

for (const member of CAST) {
  const existing = await verifyLogin(member.user, PASSWORD(member.user));
  if (existing.ok) {
    console.log(`[p22-seed] ${member.user}: already set up`);
    continue;
  }
  const temp = `Temp-${member.user}-22`;
  const added = await addUser("admin", member.user, temp, "member");
  if (!added.ok && added.status !== 409) throw new Error(`addUser ${member.user}: ${added.error}`);
  const changed = await changePassword(member.user, temp, PASSWORD(member.user));
  if (!changed.ok) throw new Error(`changePassword ${member.user}: ${changed.error}`);
  const named = await setScreenname(member.user, member.name);
  if (!named.ok) throw new Error(`setScreenname ${member.user}: ${named.error}`);
  console.log(`[p22-seed] ${member.user}: created + entry flow completed — ${member.why}`);
}

/* --------------------- 3. the pre-migration world (state 2) ------------------- */

/*
 * State 2 asks for "the migrated member's albums intact under their accounts
 * name". So the album has to START in the retired module's own pre-vault
 * layout, keyed by the MODULE's member name — `Brett`, capitalised, as the old
 * store had it — and be moved by the real P1 re-key and the real P2 vault pass.
 * Writing it straight into `users/brett/albums/` would prove nothing at all.
 */
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

/** A real PNG, built here rather than shipped: a deterministic 480×320 gradient
 *  so `imageSize`'s header sniff has genuine bytes to read. */
function png(width, height, seed) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < width; x += 1) {
      raw[o] = (x * 255) / width;
      raw[o + 1] = (y * 255) / height;
      raw[o + 2] = (seed * 60 + ((x + y) % 96)) % 256;
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
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const legacyStore = path.join(AXV, "accounts.json");
const retired = path.join(AXV, "accounts.json.retired");
if (!fs.existsSync(legacyStore) && !fs.existsSync(retired)) {
  writeJson(legacyStore, {
    version: 1,
    accounts: [
      { username: "Brett", role: "member", screenname: "Brett" },
      { username: "jenny", role: "member", screenname: "Jenny" },
    ],
  });
  writeJson(path.join(AXV, "profiles", "Brett.json"), {
    username: "Brett",
    bio: "Recording since the suite days.",
  });

  const albumId = "alb-20260610-101500-a1b2c3";
  const photos = [
    { id: "ph-20260610-101501-000a01", file: "ph-20260610-101501-000a01.png", caption: "Studio window, June" },
    { id: "ph-20260610-101502-000a02", file: "ph-20260610-101502-000a02.png", caption: "The old rig" },
    { id: "ph-20260610-101503-000a03", file: "ph-20260610-101503-000a03.png", caption: "Last suite build" },
  ];
  const dir = path.join(AXV, "albums", "Brett", albumId);
  fs.mkdirSync(dir, { recursive: true });
  photos.forEach((p, i) => fs.writeFileSync(path.join(dir, p.file), png(480, 320, i + 1)));
  writeJson(path.join(dir, "album.json"), {
    version: 1,
    id: albumId,
    owner: "Brett",
    title: "Suite era",
    coverPhotoId: photos[0].id,
    photos: photos.map((p) => ({ ...p, uploadedAt: "2026-06-10T10:15:00.000Z" })),
    createdAt: "2026-06-10T10:15:00.000Z",
    updatedAt: "2026-06-10T10:15:00.000Z",
  });
  console.log(`[p22-seed] legacy world: member "Brett" with album "Suite era" (${photos.length} photos)`);
} else {
  console.log("[p22-seed] legacy world: already present or already migrated");
}

/* ------------------------------ 4. the migrations ---------------------------- */

if (fs.existsSync(legacyStore)) {
  const { migrateMembers } = await import("@axs/modules/amberxvid/lib/migrate-members");
  const report = await migrateMembers(ACC, { policy: "match" });
  console.log(
    `[p22-seed] P1: ${report.members?.map((m) => `${m.from}→${m.to} (${m.how})`).join(", ") ?? report.status}`,
  );
}
{
  const { migrateVaults } = await import("@axs/modules/amberxvid/lib/migrate-vaults");
  const report = await migrateVaults();
  console.log(`[p22-seed] P2: ${report.status ?? "moved"} — ${report.moves?.length ?? 0} move(s)`);
}

const roster = await listAccounts();
console.log(
  `[p22-seed] roster (${roster.length}): ${roster.map((a) => `${a.username}/${a.role}`).join(", ")}`,
);
console.log(`[p22-seed] accounts root ${ACC}`);
console.log(`[p22-seed] amberxvid root ${AXV}`);
