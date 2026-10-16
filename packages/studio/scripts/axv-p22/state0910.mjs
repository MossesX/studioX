/**
 * States 9 and 10 — MODERATION and CREDITS.
 *
 * 9: a member reports a post, an administrator actions it in the amberxvid
 *    wing inside the accounts admin suite, the accounts audit log carries the
 *    line, and a live stream is force-ended by a moderator.
 * 10: credits granted, spent through the assistant's meter, and the ledger
 *    showing the fold.
 *
 * The reports and moderation VERBS are driven through the doors the wing's own
 * buttons call, in each person's real browser session; the wing itself is
 * screenshotted so the rows are visible where an administrator would see them.
 */
import fs from "node:fs";
import path from "node:path";
import { launch, person, signIn, openSuite, shot, text, note, writeRecord, api } from "./driver.mjs";

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

/* ================================ state 9 =================================== */

const brett = await open("brett", "profile");
const jenny = await open("jenny", "feed");
const admin = await open("admin", "profiles");

// Something to report: a public post, so the reporter can genuinely see it.
await brett.page.locator('[data-el-id="amberxvid:wall:composer-text"] textarea').first()
  .fill("A post that somebody is about to take exception to.");
await brett.page.locator('[data-el-id="amberxvid:wall:composer-post"]').click();
await brett.page.waitForTimeout(3500);
const wall = await api(brett.ctx, "/api/amberxvid/wall?owner=brett");
const post = wall.json?.posts?.[0];
note(`post to report: ${post?.id}`);
await shot(brett.page, "09a-post-to-report");

const filed = await api(jenny.ctx, "/api/amberxvid/reports", {
  method: "POST",
  data: {
    subject: { kind: "post", owner: "brett", id: post.id, excerpt: post.text?.slice(0, 80) },
    reason: "This is the P22 walk filing a real report against a real post.",
  },
});
note(`report filed: ${filed.status} ${JSON.stringify(filed.json?.report ?? filed.json).slice(0, 220)}`);
record.report = filed.json?.report ?? filed.json;

// The wing, where an administrator meets it.
await admin.page.goto("/accounts", { waitUntil: "domcontentloaded" });
await admin.page.waitForTimeout(2500);
// The wing is a TAB the amberxvid module contributes to the accounts admin
// suite, so it is reached from the Admin rail first.
await admin.page.getByRole("tab", { name: /Admin/i }).click().catch(() => {});
await admin.page.waitForTimeout(2000);
await admin.page.getByRole("tab", { name: /AmberX Vid/i }).click().catch(() => {});
await admin.page.waitForTimeout(3500);
await shot(admin.page, "09b-moderation-wing-queue");
note(`wing: ${(await text(admin.page)).replace(/\s+/g, " ").slice(-700)}`);

const acted = await api(admin.ctx, "/api/amberxvid/moderation", {
  method: "POST",
  data: {
    action: "act-report",
    id: record.report?.id,
    state: "actioned",
    reason: "Actioned by the P22 walk — the row and its reason belong in the audit.",
  },
});
note(`actioned: ${acted.status} ${JSON.stringify(acted.json?.report ?? acted.json).slice(0, 260)}`);
record.actioned = acted.json?.report ?? acted.json;
await admin.page.reload({ waitUntil: "domcontentloaded" });
await admin.page.waitForTimeout(3000);
await admin.page.getByRole("tab", { name: /AmberX Vid/i }).click().catch(() => {});
await admin.page.waitForTimeout(2500);
await shot(admin.page, "09c-report-actioned");

// The audit line, in the accounts journal the act writes to.
// The audit is the accounts JOURNAL on disk — the file the act writes to,
// read rather than inferred from an API that does not carry it.
const journal = path.join(
  process.env.ACCOUNTS_DATA_DIR ??
    "C:/Home/Projects/amberx-ai-studio/logs/build/axf-amberxvid-social/p22/data/accounts",
  "journal.json",
);
const auditText = fs.existsSync(journal) ? fs.readFileSync(journal, "utf8") : "";
record.auditMentionsAct = auditText.includes("P22 walk");
record.auditTail = auditText.trim().split(/\r?\n/).slice(-6).join("\n").slice(-900);
note(`accounts audit carries the act: ${record.auditMentionsAct}`);
await shot(admin.page, "09d-audit-entry");

/* A live stream, force-ended by a moderator. */
const host = await open("jenny", "streams");
await host.page.locator('[data-el-id="amberxvid:streams:go-live"]').click();
const title = host.page.getByLabel("Stream title");
if (await title.count()) {
  await title.fill("About to be ended by a moderator");
  await host.page.getByRole("button", { name: /^Go live$/ }).last().click();
}
await host.page.waitForTimeout(7000);
await shot(host.page, "09e-stream-before-force-end");
const live = await api(admin.ctx, "/api/amberxvid/streams");
const streamId = (live.json?.streams ?? []).find((s) => s.host === "jenny")?.id ?? null;
note(`stream to end: ${streamId}`);
const ended = await api(admin.ctx, "/api/amberxvid/moderation", {
  method: "POST",
  data: { action: "end-stream", streamId, reason: "Force-ended by the P22 walk." },
});
note(`force-end: ${ended.status} ${JSON.stringify(ended.json).slice(0, 200)}`);
record.forceEnd = ended.json;
await host.page.waitForTimeout(6000);
await shot(host.page, "09f-stream-force-ended");
note(`host's screen after: ${(await text(host.page)).replace(/\s+/g, " ").slice(-300)}`);

/* ================================ state 10 ================================== */

const before = await api(brett.ctx, "/api/amberxvid/credits");
note(`balance before: ${JSON.stringify(before.json?.balance ?? before.json).slice(0, 200)}`);

const granted = await api(admin.ctx, "/api/accounts/credits", {
  method: "POST",
  data: { action: "grant", username: "brett", delta: 500, reason: "P22 walk grant" },
});
note(`grant: ${granted.status} ${JSON.stringify(granted.json).slice(0, 240)}`);
record.grant = granted.json;
await shot(admin.page, "10a-credits-granted");

const spent = await api(brett.ctx, "/api/amberxvid/credits", {
  method: "POST",
  data: { meter: "amberxvid.assistant-turn", units: 1, detail: "P22 walk — one assistant turn" },
});
note(`spend through the meter: ${spent.status} ${JSON.stringify(spent.json).slice(0, 260)}`);
record.spend = spent.json;

const after = await api(brett.ctx, "/api/amberxvid/credits");
record.ledger = after.json;
note(`ledger after: ${JSON.stringify(after.json).slice(0, 400)}`);

await brett.page.getByRole("button", { name: "Settings", exact: true }).click().catch(() => {});
await brett.page.waitForTimeout(3000);
await shot(brett.page, "10b-credits-ledger");

writeRecord("0910-moderation-credits.json", record);
await browser.close();
