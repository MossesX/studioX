/**
 * @file P17 — the moderation queue, the wing's verbs, and the vault integrity
 * scan. Real code over throwaway roots, both stores re-pointed per test, driven
 * in the order the app drives it (`test/axv-wall.test.ts`'s staging).
 *
 * ## The properties worth the most, in order
 *
 * 1. **Every act lands in the ACCOUNTS audit log, with actor, subject and
 *    reason.** That is the entire argument for putting the wing inside the
 *    admin suite instead of beside it — moderation history needs no viewer of
 *    its own because the suite already has one — and it is the one thing that
 *    is invisible on screen and therefore has to be asserted. The journal is
 *    NOT silenced in this file for exactly that reason.
 *
 * 2. **A duplicate report is not a second row, but a second reporter is.** One
 *    annoyed member must not be able to bury a queue; two independent people
 *    complaining about the same post is signal a queue exists to surface.
 *
 * 3. **Removing the subject closes the reports about it.** Otherwise a removed
 *    post leaves rows saying "open" about something that no longer exists, and
 *    the count stops meaning "things to look at".
 *
 * 4. **The scan finds what the read path hides.** A post whose attachment bytes
 *    are gone renders broken; an unclaimed file is charged to a quota forever
 *    and shown to nobody. Both are staged by breaking the store on disk
 *    underneath the code, which is how they happen in life.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { addUser, changePassword, setScreenname } from "@axs/modules/accounts/lib/accounts";
import { setAmberxvidPolicySource } from "@axs/modules/amberxvid/lib/policy";
import { createPost, uploadWallMedia, wallIndex } from "@axs/modules/amberxvid/lib/wall";
import {
  fileReport,
  listReports,
  reportCounts,
  resolveReport,
} from "@axs/modules/amberxvid/lib/reports";
import { actOnReport, removePost } from "@axs/modules/amberxvid/lib/moderation";
import { repairVaults, scanVaults } from "@axs/modules/amberxvid/lib/maintenance";
import type { ReportSubject, VaultFinding } from "@axs/modules/amberxvid/lib/types";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];
let accountsRoot = "";
let moduleRoot = "";

function freshStores(): void {
  accountsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axv-mod-acc-"));
  moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axv-mod-mod-"));
  roots.push(accountsRoot, moduleRoot);
  process.env.ACCOUNTS_DATA_DIR = accountsRoot;
  process.env.AMBERXVID_DATA_DIR = moduleRoot;
  // The module's own journal is silenced (it is bookkeeping); the ACCOUNTS one
  // is deliberately NOT, because it is the thing under test.
  process.env.AMBERXVID_SILENT_JOURNAL = "1";
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  delete process.env.AMBERXVID_DATA_DIR;
  delete process.env.AMBERXVID_SILENT_JOURNAL;
  setAmberxvidPolicySource(null);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function ok<T extends { ok: boolean }>(result: T | { ok: false; error: string }, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${(result as { error: string }).error}`);
  return result as T;
}

async function member(username: string, screenname: string): Promise<string> {
  ok(await addUser("admin", username, "temp-pass", "member"), `adding ${username}`);
  ok(await changePassword(username, "temp-pass", `${username}-real-pw`), `${username}'s password`);
  ok(await setScreenname(username, screenname), `${username}'s screenname`);
  return username;
}

/** The seeded admin through their own forced entry, so `addUser` opens — and
 *  they are the moderator every act below is performed by. */
async function studio(): Promise<void> {
  freshStores();
  ok(await changePassword("admin", "amberx", "admin-real-pw"), "the admin clearing the seed password");
  ok(await setScreenname("admin", "Administrator"), "the admin's screenname");
}

/** Every line the ACCOUNTS journal holds — the audit trail the suite shows. */
function auditLines(): string[] {
  const file = path.join(accountsRoot, "journal.json");
  if (!fs.existsSync(file)) return [];
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as {
    entries?: { summary?: string; path?: string }[];
  };
  return (doc.entries ?? []).map((e) => `${e.path ?? ""} :: ${e.summary ?? ""}`);
}

const subjectOf = (owner: string, postId: string, excerpt: string): ReportSubject => ({
  kind: "post",
  owner,
  id: postId,
  excerpt,
});

/* ================================ the queue =================================== */

test("the queue: one row per reporter per subject, and a close that keeps the row", async () => {
  await studio();
  const alice = await member("alice", "Alice");
  const bob = await member("bob", "Bob");
  const carol = await member("carol", "Carol");

  const post = ok(
    await createPost(alice, alice, { text: "something objectionable", visibility: "public" }),
    "alice posting",
  ).post;
  const subject = subjectOf(alice, post.id, "something objectionable");

  const first = ok(await fileReport(bob, { subject, reason: "harassment" }), "bob reporting");
  // Property 2, first half: the same reporter twice is the SAME row.
  const again = ok(await fileReport(bob, { subject, reason: "harassment, again" }), "bob again");
  assert.equal(again.report.id, first.report.id, "a duplicate report must not open a second row");
  assert.equal(again.report.reason, "harassment", "the first reason is the one that is kept");

  // Property 2, second half: a DIFFERENT reporter is a second row.
  ok(await fileReport(carol, { subject, reason: "same post, my own complaint" }), "carol reporting");
  assert.equal(reportCounts().open, 2, "two reporters, two rows");

  // The two refusals a member-facing store owes.
  const mine = await fileReport(alice, { subject, reason: "reporting myself" });
  assert.equal(mine.ok, false, "your own material is not reportable");
  const blank = await fileReport(bob, { subject: subjectOf(alice, post.id, ""), reason: "   " });
  assert.equal(blank.ok, false, "a report needs a reason");

  // Closing keeps the row, stamps the moderator, and cannot be done twice.
  const closed = ok(
    await resolveReport("admin", first.report.id, "dismissed", "not against the rules"),
    "dismissing",
  ).report;
  assert.equal(closed.state, "dismissed");
  assert.equal(closed.resolvedBy, "admin");
  assert.equal(closed.resolution, "not against the rules");
  assert.ok(closed.resolvedAt, "a closed report is stamped");
  assert.equal(listReports().length, 2, "a closed report is kept, never deleted");

  const twice = await resolveReport("admin", first.report.id, "actioned", "changed my mind");
  assert.equal(twice.ok, false, "a closed report cannot be closed again");
});

/* ============================== the audit trail =============================== */

test("every act writes the accounts audit log with actor, subject and reason", async () => {
  await studio();
  const alice = await member("alice", "Alice");
  const bob = await member("bob", "Bob");

  const post = ok(
    await createPost(alice, alice, { text: "the reported post", visibility: "public" }),
    "alice posting",
  ).post;
  const subject = subjectOf(alice, post.id, "the reported post");
  const report = ok(await fileReport(bob, { subject, reason: "abuse" }), "bob reporting").report;

  const before = auditLines().length;
  // Property 3: removing the subject closes the reports about it, in one act.
  ok(await removePost("admin", alice, post.id, "breaks the rules"), "the admin removing the post");

  const lines = auditLines();
  assert.ok(lines.length > before, "the removal wrote to the accounts journal");

  const removal = lines.find((l) => l.includes("post-removed"));
  assert.ok(removal, `no post-removed line in the audit log:\n${lines.join("\n")}`);
  assert.match(removal, /by admin/, "the audit line names the actor");
  assert.match(removal, new RegExp(`post/${alice}/${post.id}`), "and the subject");
  assert.match(removal, /reason: breaks the rules/, "and the reason");

  const closed = listReports().find((r) => r.id === report.id);
  assert.equal(closed?.state, "actioned", "the open report about it was closed by the removal");
  assert.equal(reportCounts().open, 0);

  // The post is gone from the wall as well as from the queue.
  assert.equal(wallIndex(alice).posts.length, 0, "the removal went through the store's own verb");

  // A close through the wing writes its own line, dismissals included: "we
  // looked and decided no" is the decision the next complaint needs to find.
  const second = ok(
    await fileReport(bob, { subject: { kind: "profile", owner: alice, id: "" }, reason: "the bio" }),
    "bob reporting a profile",
  ).report;
  ok(await actOnReport("admin", second.id, "dismissed", "the bio is fine"), "dismissing");
  const dismissal = auditLines().find((l) => l.includes("report-dismissed"));
  assert.ok(dismissal, "a dismissal is audited too");
  assert.match(dismissal, /reason: the bio is fine/);
});

/* ============================== DB maintenance ================================ */

const kinds = (findings: VaultFinding[], owner: string): string[] =>
  findings.filter((f) => f.owner === owner).map((f) => f.kind).sort();

test("the vault scan finds what the read path hides, and the fix pass repairs it", async () => {
  await studio();
  const alice = await member("alice", "Alice");

  // A real post with a real attachment, through the real upload path.
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 7),
  ]);
  const media = ok(await uploadWallMedia(alice, alice, png), "uploading an attachment");
  const post = ok(
    await createPost(alice, alice, { text: "with a picture", media: [media.media.id], visibility: "public" }),
    "alice posting with media",
  ).post;

  // Break the store underneath it, the two ways it breaks in life: the bytes of
  // a claimed attachment vanish, and an unclaimed file is left behind by an
  // abandoned upload (backdated past the sweeper's 24 h grace, which exists so
  // an open composer is never swept).
  const mediaDir = path.join(moduleRoot, "users", alice, "files", "wall");
  const claimed = fs.readdirSync(mediaDir).find((n) => n.startsWith(media.media.id));
  assert.ok(claimed, "the attachment landed where the store says it does");
  fs.rmSync(path.join(mediaDir, claimed), { force: true });

  const orphan = path.join(mediaDir, "wm-20260101-010101-abcdef.png");
  fs.writeFileSync(orphan, png);
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  fs.utimesSync(orphan, old, old);

  const scan = await scanVaults();
  assert.ok(scan.vaults >= 1, "the scan walked at least alice's vault");
  assert.deepEqual(
    kinds(scan.findings, alice),
    ["dangling-media", "orphan-file"],
    `unexpected findings: ${JSON.stringify(scan.findings, null, 2)}`,
  );
  assert.equal(scan.repaired, false, "a scan writes nothing");

  const fixed = await repairVaults("admin");
  assert.equal(fixed.repaired, true);
  assert.ok(!fs.existsSync(orphan), "the orphan file was swept");

  // The dangling reference is gone from the post document, so it renders whole.
  const doc = JSON.parse(
    fs.readFileSync(path.join(moduleRoot, "users", alice, "wall", `${post.id}.json`), "utf8"),
  ) as { media: unknown[] };
  assert.equal(doc.media.length, 0, "the reference with no bytes was dropped");

  // And the second scan is clean, which is the only honest proof a fix worked.
  const after = await scanVaults();
  assert.deepEqual(kinds(after.findings, alice), [], "the store agrees with itself again");

  const line = auditLines().find((l) => l.includes("vault-repaired"));
  assert.ok(line, "the fix pass is audited like every other act");
});
