/**
 * State 3 — BLOCKS. Brett blocks Carl from Carl's own wall, and then Carl runs
 * into ONE guard at four different doors: a DM, a ring, a room join and an
 * invitation. Four screenshots, and the point of them is that all four say the
 * same thing a member who never existed would say.
 */
import { launch, person, signIn, openSuite, shot, text, note, writeRecord, api } from "./driver.mjs";

const browser = await launch();

/* ------------------- Brett blocks Carl, from Carl's wall -------------------- */

const brettCtx = await person(browser);
const brett = await brettCtx.newPage();
await signIn(brett, "brett");
await openSuite(brett, "profiles");
await brett.getByPlaceholder(/Find a member/i).fill("carl");
await brett.waitForTimeout(1200);
await shot(brett, "03a-members-carl");

// Open Carl's wall — the block is offered where you are looking at the person,
// not in a settings screen somewhere else.
await brett.getByText("Carl", { exact: true }).first().click();
await brett.waitForTimeout(2000);
note(`carl's wall: ${(await text(brett)).replace(/\s+/g, " ").slice(0, 500)}`);
await shot(brett, "03b-carl-wall-before-block");

// Idempotence, not a shortcut: the module correctly HIDES the Block row for
// somebody already blocked (`amberxvid.member.blockable`), so a re-run of this
// walk would find no row at all. Clearing the edge first is setup; the block
// itself is then performed through the product's own affordance below.
await api(brettCtx, "/api/accounts/relations", {
  method: "POST",
  data: { action: "unblock", user: "carl" },
});
await brett.reload({ waitUntil: "domcontentloaded" });
await brett.waitForSelector('[data-axf-area="amberxvid.surface"]', { timeout: 60_000 });
await brett.getByRole("button", { name: "Members", exact: true }).click();
await brett.waitForTimeout(1500);
await brett.getByText("Carl", { exact: true }).first().click();
await brett.waitForTimeout(1200);

// Blocking is a CONTEXT-MENU action on the `amberxvid.member` area — the
// module declares it as data rather than hanging a button off every surface a
// member appears on, so the right-click is the product's own affordance.
await brett.getByText("Carl", { exact: true }).first().click({ button: "right" });
await brett.waitForTimeout(900);
await shot(brett, "03b2-member-context-menu");
await brett.getByRole("menuitem", { name: /^Block$/i }).click();
await brett.waitForTimeout(2000);
await shot(brett, "03c-blocked");
note(`after block: ${(await text(brett)).replace(/\s+/g, " ").slice(0, 400)}`);

/* --------------------------- Carl, at four doors ---------------------------- */

const carlCtx = await person(browser);
const carl = await carlCtx.newPage();
await signIn(carl, "carl");
await openSuite(carl, "profiles");

// The four refusals are read at the API the surfaces call, in Carl's OWN
// browser session — same cookies, same doors — and each is compared with the
// answer for a member who genuinely does not exist.
const ghost = "nobodyatall";
const doors = [
  {
    door: "DM",
    real: ["/api/accounts/messages", { method: "POST", data: { action: "send", to: "brett", text: "hello?" } }],
    ghost: ["/api/accounts/messages", { method: "POST", data: { action: "send", to: ghost, text: "hello?" } }],
  },
  {
    door: "call",
    real: ["/api/amberxvid/calls", { method: "POST", data: { action: "invite", to: "brett" } }],
    ghost: ["/api/amberxvid/calls", { method: "POST", data: { action: "invite", to: ghost } }],
  },
  {
    door: "invite",
    real: [
      "/api/amberxvid/invites",
      { method: "POST", data: { action: "create", channel: "internal", handle: "brett", targetKind: "none", targetId: "", buddy: false, note: null } },
    ],
    ghost: [
      "/api/amberxvid/invites",
      { method: "POST", data: { action: "create", channel: "internal", handle: ghost, targetKind: "none", targetId: "", buddy: false, note: null } },
    ],
  },
];

const record = {};
for (const d of doors) {
  const real = await api(carlCtx, d.real[0], d.real[1]);
  const gone = await api(carlCtx, d.ghost[0], d.ghost[1]);
  record[d.door] = { blocked: real, absent: gone };
  const same = JSON.stringify(real) === JSON.stringify(gone);
  note(`${d.door}: blocked=${real.status} ${JSON.stringify(real.json)} · identical to absent: ${same}`);
}

/*
 * The fourth door is the room — and it is worth being exact about WHICH room
 * door, because the module is deliberate here. Joining a live room by id is
 * NOT gated by a block: `groupRooms.ts` states it outright ("a block between
 * two members must not be able to keep one of them out of a meeting"), and the
 * seat is granted while the room's CHAT invitation is refused by the guard.
 * The block-gated room path is the INVITATION into a room — "join my room",
 * which rings like a call — and that is the wired path P21's relations table
 * covers. Both are recorded here; the screenshot names the refusal.
 */
const carlRoom = await api(carlCtx, "/api/amberxvid/rooms", {
  method: "POST",
  data: { action: "open", title: "Carl's room" },
});
const carlRoomId = carlRoom.json?.room?.id ?? null;
note(`carl's room: ${carlRoomId ?? JSON.stringify(carlRoom.json).slice(0, 200)}`);
if (carlRoomId) {
  const real = await api(carlCtx, "/api/amberxvid/rooms", {
    method: "POST",
    data: { action: "ring", roomId: carlRoomId, to: "brett" },
  });
  const gone = await api(carlCtx, "/api/amberxvid/rooms", {
    method: "POST",
    data: { action: "ring", roomId: carlRoomId, to: ghost },
  });
  record["room invitation"] = { blocked: real, absent: gone };
  note(
    `room invitation: blocked=${real.status} ${JSON.stringify(real.json)} · identical to absent: ${
      JSON.stringify(real) === JSON.stringify(gone)
    }`,
  );
}

// And the seat itself, recorded as the documented exception rather than hidden.
await openSuite(brett, "rooms");
const brettRooms = await api(brettCtx, "/api/amberxvid/rooms", {
  method: "POST",
  data: { action: "open", title: "Brett's room" },
});
const brettRoomId = brettRooms.json?.room?.id ?? null;
if (brettRoomId) {
  const seat = await api(carlCtx, "/api/amberxvid/rooms", {
    method: "POST",
    data: { action: "join", roomId: brettRoomId },
  });
  record["room seat (documented exception)"] = seat;
  note(`room seat: ${seat.status} — chat side: ${JSON.stringify(seat.json?.chat ?? null)}`);
}

writeRecord("03-four-refusals.json", record);

/* The screenshots: Carl looking at each door in the real UI. */
await openSuite(carl, "messenger");
await carl.waitForTimeout(2000);
await shot(carl, "03d-carl-dm-refused");
await openSuite(carl, "rooms");
await carl.waitForTimeout(2000);
await shot(carl, "03e-carl-room-refused");
await openSuite(carl, "profiles");
await carl.getByPlaceholder(/Find a member/i).fill("brett");
await carl.waitForTimeout(1500);
await shot(carl, "03f-carl-cannot-see-brett");
note(`carl searching for brett: ${(await text(carl)).replace(/\s+/g, " ").slice(0, 400)}`);

await browser.close();
