/**
 * State 7 — THE MESSENGER. A three-member group chat, an offline member whose
 * `deliveredAt` is stamped when they come back, the unread badges, and a
 * missed-call DM note written by a ring that landed inside do-not-disturb
 * hours.
 */
import fs from "node:fs";
import path from "node:path";
import { launch, person, signIn, openSuite, shot, text, note, writeRecord, api } from "./driver.mjs";

const browser = await launch();

const open = async (user) => {
  const ctx = await person(browser, { width: 1440, height: 900 });
  const page = await ctx.newPage();
  await signIn(page, user);
  await openSuite(page, "messenger");
  await page.locator('[data-el-id="amberxvid:stream-room:close"]').click({ timeout: 2500 }).catch(() => {});
  await page.locator('[data-el-id="amberxvid:room:close"]').click({ timeout: 2500 }).catch(() => {});
  return { user, ctx, page };
};

const brett = await open("brett");
const jenny = await open("jenny");

// Dana is a BUDDY but her browser is not open — that is the whole point of the
// offline half. The buddy edges are setup, through the real verbs.
const danaSetup = await person(browser);
const danaPage = await danaSetup.newPage();
await signIn(danaPage, "dana");
await api(brett.ctx, "/api/accounts/relations", { method: "POST", data: { action: "request", user: "dana" } });
await api(danaSetup, "/api/accounts/relations", { method: "POST", data: { action: "accept", user: "brett" } });
await api(jenny.ctx, "/api/accounts/relations", { method: "POST", data: { action: "request", user: "dana" } });
await api(danaSetup, "/api/accounts/relations", { method: "POST", data: { action: "accept", user: "jenny" } });
await danaSetup.close(); // dana's browser is gone
// ...and a closed browser is not yet an OFFLINE member: presence has a
// heartbeat and lingers. Waiting for the roster to stop naming her is what
// makes the queued-delivery half of this state real rather than lucky — the
// first run of this walk stamped `deliveredAt` immediately because dana was
// still counted as present.
const liveDir = path.join(
  process.env.AMBERXVID_DATA_DIR ??
    "C:/Home/Projects/amberx-ai-studio/logs/build/axf-amberxvid-social/p22/data/amberxvid",
  "presence",
  "live",
);
const stillHere = () => {
  try {
    return fs
      .readdirSync(liveDir)
      .some((f) => fs.readFileSync(path.join(liveDir, f), "utf8").toLowerCase().includes('"dana"'));
  } catch {
    return false;
  }
};
for (let i = 0; i < 24 && stillHere(); i += 1) await brett.page.waitForTimeout(5000);
note("dana is a buddy of both, and is now offline to the presence roster");

/* ----------------------------- the group chat ------------------------------- */

// The messenger is a DRAWER over the stage, so a reload closes it — re-open it
// from the nav rather than reloading into a view parameter that only decides
// which stage is behind it.
await brett.page.locator('[data-el-id="amberxvid:nav:messenger"]').click().catch(() => {});
await brett.page.waitForTimeout(2000);
await brett.page.locator('[data-el-id="amberxvid:messenger:new-group"]').click();
await brett.page.waitForTimeout(1000);
await brett.page.locator('[data-el-id="amberxvid:messenger:group:title"] input').fill("Build night");
for (const who of ["jenny", "dana"]) {
  await brett.page.locator(`[data-el-id="amberxvid:messenger:group:pick:${who}"]`).click();
}
await shot(brett.page, "07a-new-group-picker");
await brett.page.locator('[data-el-id="amberxvid:messenger:group:go"]').click();
await brett.page.waitForTimeout(3000);

await brett.page.locator('[data-el-id="amberxvid:messenger:chat:input"] textarea').first()
  .fill("standup in ten — dana, you around?");
await brett.page.locator('[data-el-id="amberxvid:messenger:chat:send"]').click();
await brett.page.waitForTimeout(2500);
await shot(brett.page, "07b-group-chat-three-members");

const threads = await api(brett.ctx, "/api/accounts/messages");
const group = (threads.json?.threads ?? []).find((t) => t.title === "Build night" || t.members?.length === 3);
note(`thread ${group?.id} members ${JSON.stringify(group?.members)}`);

/* --------------------- delivery: one member is not there -------------------- */

const before = await api(brett.ctx, `/api/accounts/messages?thread=${group.id}`);
const lastBefore = (before.json?.thread?.messages ?? before.json?.messages ?? []).at(-1);
note(`deliveredAt with dana away: ${JSON.stringify(lastBefore?.deliveredAt ?? null)}`);
await shot(jenny.page, "07c-unread-badge-on-jenny");

// Dana comes back. Reading is a delivery, and the AGGREGATE waits for the last
// member — so this is the moment `deliveredAt` may be stamped, and not before.
const dana = await open("dana");
await dana.page.waitForTimeout(4000);
await shot(dana.page, "07d-dana-returns");
// Both remaining members have to actually RECEIVE it: reading is the
// delivery, and `deliveredAt` is the aggregate — it waits for the last one.
await jenny.page.locator(`[data-el-id="amberxvid:messenger:group:${group.id}"]`).click({ timeout: 8000 }).catch(() => {});
await jenny.page.waitForTimeout(2000);
await dana.page.locator('[data-el-id="amberxvid:nav:messenger"]').click({ timeout: 8000 }).catch(() => {});
await dana.page.waitForTimeout(1500);
await dana.page.locator(`[data-el-id="amberxvid:messenger:group:${group.id}"]`).click({ timeout: 15_000 });
await dana.page.waitForTimeout(3500);
await shot(dana.page, "07e-dana-reads-the-backlog");

const after = await api(brett.ctx, `/api/accounts/messages?thread=${group.id}`);
const lastAfter = (after.json?.thread?.messages ?? after.json?.messages ?? []).at(-1);
note(`deliveredAt after dana returned: ${JSON.stringify(lastAfter?.deliveredAt ?? null)}`);
await brett.page.waitForTimeout(2500);
await shot(brett.page, "07f-delivered-stamp");

/* ------------------- the missed call, from inside DND hours ----------------- */

// Dana's own quiet hours, set through her own availability document — the
// module's DND, not a global switch.
const dnd = await api(dana.ctx, "/api/amberxvid/availability", {
  method: "POST",
  data: { dnd: true },
});
note(`dana's availability: ${JSON.stringify(dnd.json).slice(0, 200)}`);
await shot(dana.page, "07g-dana-dnd");

const ring = await api(brett.ctx, "/api/amberxvid/calls", { method: "POST", data: { action: "invite", to: "dana" } });
note(`brett rings dana in DND: ${ring.status} ${JSON.stringify(ring.json).slice(0, 220)}`);

await dana.page.waitForTimeout(3000);
const dm = await api(dana.ctx, "/api/accounts/messages?with=brett");
const calls = await api(dana.ctx, "/api/amberxvid/calls/history");
note(`the DM thread after the silenced ring: ${JSON.stringify(dm.json?.messages?.slice(-2) ?? dm.json).slice(0, 400)}`);
note(`dana’s call history: ${JSON.stringify(calls.json).slice(0, 400)}`);
await shot(dana.page, "07h-missed-call-note");

writeRecord("07-messenger.json", {
  thread: group ? { id: group.id, members: group.members, title: group.title } : null,
  deliveredBefore: lastBefore?.deliveredAt ?? null,
  deliveredAfter: lastAfter?.deliveredAt ?? null,
  ring: ring.json,
  dmTail: (dm.json?.thread?.messages ?? dm.json?.messages)?.slice(-2) ?? null,
  callHistory: calls.json ?? null,
});
await browser.close();
