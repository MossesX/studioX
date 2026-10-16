/**
 * @file P7 — invitations, and **the phase gate walked end to end**: an invite
 * link opens a landing that creates an ACCOUNTS user, grants the module
 * through the matrix, and lands the newcomer in the exact room they were
 * invited to.
 *
 * Staged the way `test/accounts-relations.test.ts` stages the accounts stores
 * — the real code over throwaway roots, driven in the order the app drives it
 * — with BOTH roots re-pointed per test, because an invitation is the one
 * feature that writes to the accounts store and the amberxvid store in the
 * same motion.
 *
 * ## The properties worth the most, in order
 *
 * 1. **The gate walk is one test, not four.** Signup, grant, buddy and arrival
 *    are checked as a single call's outcome, because the thing that breaks in
 *    practice is not any one of them — it is the third one failing and the
 *    other three reporting success anyway. `the whole gate walk` asserts the
 *    account exists, the grant is recorded in `permissions.json`, the buddy
 *    edge is mutual, the arrival names the live room, and the accounts audit
 *    says it was an invitation.
 *
 * 2. **Every dead invitation is byte-identical.** Forged, expired, spent,
 *    revoked and BLOCKED. This is the same property `accounts-relations`
 *    exists for, one layer up: a landing that let a blocked person tell
 *    "blocked" from "used" would hand them the confirmation the silence is
 *    built to withhold, and nothing would look wrong on screen. So the
 *    refusals are compared FIELD BY FIELD against each other rather than
 *    pattern-matched, and a future wording change moves them together or goes
 *    red.
 *
 * 3. **Single use is the STORE's job and is proved by racing it.** The HMAC is
 *    valid until it expires however many times it is presented; two concurrent
 *    redemptions must produce one account and one refusal.
 *
 * 4. **A dead target never fails the redemption.** The stream ending between
 *    the invitation and the click is the ordinary case, not an error — the
 *    account and the membership are real and the newcomer lands in the suite
 *    with a sentence saying why.
 *
 * 5. **An administrator still wins.** An invitation cannot overturn an
 *    explicit revocation in the matrix, and it cannot mint an administrator.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  addUser,
  changePassword,
  createAccountByInvitation,
  findAccount,
  setScreenname,
} from "@axs/modules/accounts/lib/accounts";
import { grantsFor, setModuleGrant } from "@axs/modules/accounts/lib/permissions";
import { blockUser, relationsFor } from "@axs/modules/accounts/lib/relations";
import { createGroup, getThreadById } from "@axs/modules/accounts/lib/messages";
import { journalFile } from "@axs/modules/accounts/lib/paths";

import {
  createInvite,
  describeInvite,
  handleKind,
  inviteDeliveryStatus,
  listInvites,
  readToken,
  redeemInvite,
  revokeInvite,
} from "@axs/modules/amberxvid/lib/invites";
import {
  ARRIVAL_PARAM,
  INVITE_DEAD,
  INVITE_LIMITS,
  composeInvite,
  decodeArrival,
  encodeArrival,
  inviteUrl,
  mailtoUri,
} from "@axs/modules/amberxvid/lib/inviteContract";
import { setAmberxvidPolicySource } from "@axs/modules/amberxvid/lib/policy";
import { closeStream, openStream } from "@axs/modules/amberxvid/lib/streams";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];
const ORIGIN = "http://localhost:3200";

/** Both stores, fresh. An invitation straddles them, so neither may leak. */
function freshStores(): void {
  const accounts = fs.mkdtempSync(path.join(os.tmpdir(), "axv-inv-acc-"));
  const module = fs.mkdtempSync(path.join(os.tmpdir(), "axv-inv-mod-"));
  roots.push(accounts, module);
  process.env.ACCOUNTS_DATA_DIR = accounts;
  process.env.AMBERXVID_DATA_DIR = module;
  // The module secret is derived from this; a fixed one keeps a token minted
  // in one test from ever verifying in another's store.
  process.env.AMBERXVID_AUTH_SECRET = `invite-test-secret-${roots.length}`;
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  delete process.env.AMBERXVID_DATA_DIR;
  delete process.env.AMBERXVID_AUTH_SECRET;
  delete process.env.AMBERXVID_SMTP_URL;
  setAmberxvidPolicySource(null);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** The seeded admin through their own forced entry flow, so `addUser` opens. */
async function admin(): Promise<void> {
  const changed = await changePassword("admin", "amberx", "admin-real-pw");
  assert.equal(changed.ok, true, "admin clearing the seed temp password");
}

/** A member, through the whole entry flow, ready to be talked to. */
async function member(username: string, screenname: string): Promise<string> {
  const added = await addUser("admin", username, "temp-pass", "member");
  assert.equal(added.ok, true, `adding ${username}`);
  const changed = await changePassword(username, "temp-pass", `${username}-real-pw`);
  assert.equal(changed.ok, true, `${username} clearing their temp password`);
  const named = await setScreenname(username, screenname);
  assert.equal(named.ok, true, `${username} choosing a screenname`);
  return username;
}

/** A studio with an admin and Brett in it — the shape every test starts from. */
async function studio(): Promise<string> {
  freshStores();
  await admin();
  return member("brett", "Brett");
}

/** The accounts audit, as SUMMARIES rather than as raw bytes: the file is
 *  JSON, so a quoted module id is escaped in it and a naive regex over the
 *  text silently never matches. */
function auditLines(): string[] {
  try {
    const doc = JSON.parse(fs.readFileSync(journalFile(), "utf8")) as {
      entries?: { summary?: string }[];
    };
    return (doc.entries ?? []).map((e) => e.summary ?? "");
  } catch {
    return [];
  }
}

/** Narrow an engine answer to its success shape, with the error in the message
 *  when it is not — a bare `assert(result.ok)` throws away the reason. */
function ok<T extends { ok: boolean }>(result: T | { ok: false; error: string }, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${(result as { error: string }).error}`);
  return result as T;
}

/* ============================= THE GATE WALK ================================ */

test("the whole gate walk: link → account → matrix grant → buddy → the exact room", async () => {
  const brett = await studio();

  const live = ok(await openStream(brett, "Friday night"), "opening the stream");
  const streamId = live.value.id;

  const made = ok(
    await createInvite(brett, ORIGIN, {
      channel: "link",
      targetKind: "stream",
      targetId: streamId,
      buddy: true,
      note: "come watch",
    }),
    "creating the invitation",
  );
  assert.equal(made.url, inviteUrl(ORIGIN, made.invite.token));
  assert.equal(made.invite.state, "open");

  /* The landing's first call: who invited, and to what. */
  const described = ok(await describeInvite(made.invite.token), "describing the invitation");
  assert.equal(described.invite.inviter, "Brett", "the landing shows the screenname, not the username");
  assert.deepEqual(described.invite.target, { kind: "stream", id: streamId, label: "Friday night" });
  assert.equal(described.invite.buddy, true);
  assert.equal(described.invite.note, "come watch");

  /* The redemption — all four things, one call. */
  const redeemed = ok(
    await redeemInvite({
      token: made.invite.token,
      mode: "signup",
      username: "newcomer",
      password: "newcomer-pw",
    }),
    "redeeming the invitation",
  );
  assert.equal(redeemed.created, true);
  assert.equal(redeemed.username, "newcomer");

  // 1. the ACCOUNTS user exists, is a member, and is not an administrator
  const account = await findAccount("newcomer");
  assert.ok(account, "the accounts user was created");
  assert.equal(account.role, "member", "an invitation can never mint an administrator");
  assert.equal(account.createdBy, "brett", "the roster records who let them in");
  assert.equal(
    account.mustChangePassword,
    false,
    "they chose their own password on the landing — there is no temp one to force away from",
  );

  // 2. the grant went through the MATRIX and is recorded there
  assert.equal(
    grantsFor("newcomer").modules.amberxvid,
    true,
    "the module grant is in permissions.json, where the admin suite can see and revoke it",
  );
  const audit = auditLines();
  assert.ok(
    audit.includes('accounts: "newcomer" joined the module "amberxvid" (an invitation from brett)'),
    `the accounts audit records the GRANT as invite-sourced — got:\n${audit.join("\n")}`,
  );
  assert.ok(
    audit.some((line) => /"newcomer" joined by INVITATION from brett/.test(line)),
    "and records the ACCOUNT as invite-sourced too — two separate facts, two lines",
  );

  // 3. the pre-approved buddy request was honoured, mutually
  assert.deepEqual(relationsFor("brett").buddies, ["newcomer"]);
  assert.deepEqual(relationsFor("newcomer").buddies, ["brett"]);

  // 4. arrival names the exact room, and the module's URL carries it
  assert.deepEqual(redeemed.arrival, { kind: "stream", id: streamId });
  assert.equal(encodeArrival(redeemed.arrival), `stream:${streamId}`);
  assert.deepEqual(decodeArrival(encodeArrival(redeemed.arrival)), redeemed.arrival);
});

test("an existing member redeems into the same room without a second account", async () => {
  const brett = await studio();
  await member("dana", "Dana");
  const live = ok(await openStream(brett, "Friday night"), "opening the stream");

  const made = ok(
    await createInvite(brett, ORIGIN, {
      channel: "internal",
      handle: "dana",
      targetKind: "stream",
      targetId: live.value.id,
      buddy: false,
    }),
    "creating the invitation",
  );
  assert.deepEqual(made.delivery, { kind: "dm", to: "dana" }, "an internal invite goes as an accounts DM");

  const redeemed = ok(
    await redeemInvite({ token: made.invite.token, mode: "signin", username: "dana", password: "dana-real-pw" }),
    "redeeming as an existing member",
  );
  assert.equal(redeemed.created, false, "no second account");
  assert.deepEqual(redeemed.arrival, { kind: "stream", id: live.value.id });
});

test("signin proves the password IN THE ENGINE, and a wrong one does not spend the link", async () => {
  const brett = await studio();
  await member("dana", "Dana");
  const made = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");

  const wrong = await redeemInvite({
    token: made.invite.token,
    mode: "signin",
    username: "dana",
    password: "not-dana-password",
  });
  assert.equal(wrong.ok, false, "the engine, not the route, is what refuses this");
  assert.equal((wrong as { status: number }).status, 401);
  assert.equal(
    listInvites(brett)[0].state,
    "open",
    "a wrong password must cost nobody their invitation — the proof runs BEFORE consumption",
  );

  const missing = await redeemInvite({ token: made.invite.token, mode: "signin", username: "dana" });
  assert.equal(missing.ok, false, "and an omitted password is not an authenticated caller");

  ok(
    await redeemInvite({ token: made.invite.token, mode: "signin", username: "dana", password: "dana-real-pw" }),
    "the right password still works",
  );
});

test("a group-chat invitation actually puts the newcomer in the thread", async () => {
  const brett = await studio();
  await member("dana", "Dana");
  const group = ok(await createGroup(brett, "Film club", ["dana"]), "opening the group");

  const made = ok(
    await createInvite(brett, ORIGIN, { channel: "link", targetKind: "chat", targetId: group.thread.id }),
    "creating the invitation",
  );
  assert.deepEqual(made.invite.target, { kind: "chat", id: group.thread.id, label: "Film club" });

  const redeemed = ok(
    await redeemInvite({ token: made.invite.token, mode: "signup", username: "newcomer", password: "newcomer-pw" }),
    "redeeming",
  );
  assert.deepEqual(redeemed.arrival, { kind: "chat", id: group.thread.id });

  const read = ok(await getThreadById("newcomer", group.thread.id), "the newcomer reading the thread");
  assert.ok(
    read.thread.participants.includes("newcomer"),
    "arrival is not a redirect — the newcomer is really a member of the thread",
  );
});

test("a call invitation arrives as a ring aimed at the inviter", async () => {
  const brett = await studio();
  const made = ok(await createInvite(brett, ORIGIN, { channel: "link", targetKind: "call" }), "creating");
  const redeemed = ok(
    await redeemInvite({ token: made.invite.token, mode: "signup", username: "newcomer", password: "newcomer-pw" }),
    "redeeming",
  );
  assert.deepEqual(redeemed.arrival, { kind: "call", with: "brett" });
});

/* ========================= single use, and the race ========================== */

test("an invitation is single-use — the second presentation is refused", async () => {
  const brett = await studio();
  const made = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");

  ok(
    await redeemInvite({ token: made.invite.token, mode: "signup", username: "first", password: "first-pw" }),
    "the first redemption",
  );
  const second = await redeemInvite({
    token: made.invite.token,
    mode: "signup",
    username: "second",
    password: "second-pw",
  });
  assert.equal(second.ok, false);
  assert.equal((second as { error: string }).error, INVITE_DEAD);
  assert.equal(await findAccount("second"), null, "no account was created by the refused redemption");
});

test("two browsers racing the same link make ONE account and one refusal", async () => {
  const brett = await studio();
  const made = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");

  const [a, b] = await Promise.all([
    redeemInvite({ token: made.invite.token, mode: "signup", username: "racer-a", password: "racer-a-pw" }),
    redeemInvite({ token: made.invite.token, mode: "signup", username: "racer-b", password: "racer-b-pw" }),
  ]);
  const winners = [a, b].filter((r) => r.ok);
  assert.equal(winners.length, 1, "exactly one redemption may win");
  const losers = [a, b].filter((r) => !r.ok) as { error: string }[];
  assert.equal(losers[0].error, INVITE_DEAD);

  const accounts = [await findAccount("racer-a"), await findAccount("racer-b")].filter(Boolean);
  assert.equal(accounts.length, 1, "single use means one account, not two");
});

test("a username already taken un-spends the invitation instead of eating it", async () => {
  const brett = await studio();
  await member("dana", "Dana");
  const made = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");

  const clash = await redeemInvite({
    token: made.invite.token,
    mode: "signup",
    username: "dana",
    password: "another-pw",
  });
  assert.equal(clash.ok, false);
  assert.match((clash as { error: string }).error, /already has an account/);
  assert.equal(
    listInvites(brett)[0].state,
    "open",
    "a refused signup must leave the link usable — the person just picks another name",
  );

  ok(
    await redeemInvite({ token: made.invite.token, mode: "signup", username: "dana2", password: "another-pw" }),
    "retrying with a free name",
  );
});

/* ====================== every dead invitation, one sentence ================== */

test("forged, expired, spent, revoked and BLOCKED are byte-identical refusals", async () => {
  const brett = await studio();
  await member("carol", "Carol");

  /* forged */
  const forged = await describeInvite("1893456000:deadbeef:brett.notasignature");
  assert.equal(forged.ok, false);

  /* spent */
  const spentInvite = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");
  ok(
    await redeemInvite({ token: spentInvite.invite.token, mode: "signup", username: "used", password: "used-pw" }),
    "spending it",
  );
  const spent = await describeInvite(spentInvite.invite.token);

  /* revoked */
  const revokedInvite = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");
  ok(revokeInvite(brett, revokedInvite.invite.id), "revoking");
  const revoked = await describeInvite(revokedInvite.invite.token);

  /* blocked at redemption — a bare link Carol opens after blocking Brett */
  const openInvite = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");
  ok(await blockUser("carol", brett), "carol blocking brett");
  const blocked = await redeemInvite({ token: openInvite.invite.token, mode: "signin", username: "carol", password: "carol-real-pw" });

  // FIELD BY FIELD, never a pattern: a wording that drifts apart is exactly
  // the failure this asserts against, and a regex would not see it.
  for (const [name, refusal] of [
    ["spent", spent],
    ["revoked", revoked],
    ["blocked", blocked],
  ] as const) {
    assert.deepEqual(
      { ok: refusal.ok, error: (refusal as { error: string }).error, status: (refusal as { status: number }).status },
      { ok: forged.ok, error: (forged as { error: string }).error, status: (forged as { status: number }).status },
      `a ${name} invitation must be indistinguishable from a forged one`,
    );
  }
  assert.equal((forged as { error: string }).error, INVITE_DEAD);
});

test("a tampered or expired token never verifies", async () => {
  const brett = await studio();
  const made = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");
  const token = made.invite.token;

  assert.ok(readToken(token), "the real token verifies");
  assert.equal(readToken(`${token}x`), null, "a mangled signature");
  assert.equal(readToken(token.replace(/^\d+/, "9999999999")), null, "an expiry moved forward under the signature");
  assert.equal(
    readToken(token, Math.floor(Date.now() / 1000) + INVITE_LIMITS.ttlHours * 3600 + 60),
    null,
    "past its expiry, the signature is still good and the token is still dead",
  );
  assert.equal(readToken(""), null);
  assert.equal(readToken(42), null);
});

/* ============================ blocks at creation ============================= */

test("an invite to a member who blocked you is refused exactly like an unknown name", async () => {
  const brett = await studio();
  await member("carol", "Carol");
  ok(await blockUser("carol", brett), "carol blocking brett");

  const toBlocker = await createInvite(brett, ORIGIN, { channel: "internal", handle: "carol" });
  const toNobody = await createInvite(brett, ORIGIN, { channel: "internal", handle: "ghostwriter" });

  assert.equal(toBlocker.ok, false);
  assert.deepEqual(
    toBlocker,
    toNobody,
    "blocked and never-existed must be one answer — otherwise the invite form is a block detector",
  );
  assert.equal((toBlocker as { status: number }).status, 404);
  assert.equal(listInvites(brett).length, 0, "and nothing was written");
});

test("an email handle is not resolved against the roster — there is no email column to resolve it with", async () => {
  const brett = await studio();
  assert.equal(handleKind("someone@example.com"), "email");
  assert.equal(handleKind("+1 555 010 2020"), "phone");
  assert.equal(handleKind("carol"), "username");

  const made = ok(
    await createInvite(brett, ORIGIN, { channel: "email", handle: "someone@example.com" }),
    "an invitation to somebody outside the studio",
  );
  assert.equal(made.invite.handle, "someone@example.com");
});

/* ============================== the matrix wins ============================== */

test("an invitation cannot overturn an administrator's explicit revocation", async () => {
  const brett = await studio();
  await member("dana", "Dana");
  ok(await setModuleGrant("admin", "dana", "amberxvid", false), "the administrator revoking amberxvid");

  const made = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");
  const refused = await redeemInvite({ token: made.invite.token, mode: "signin", username: "dana", password: "dana-real-pw" });
  assert.equal(refused.ok, false);
  assert.match(
    (refused as { error: string }).error,
    /administrator has revoked/,
    "the matrix's own refusal, named — not swallowed into INVITE_DEAD, because this one the member CAN act on",
  );
  assert.equal(grantsFor("dana").modules.amberxvid, false, "and the revocation stands");
});

test("an invitation from an account that has lost the module is dead", async () => {
  const brett = await studio();
  const made = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");
  ok(await setModuleGrant("admin", brett, "amberxvid", false), "revoking the INVITER's module");

  const described = await describeInvite(made.invite.token);
  assert.equal(described.ok, false);
  assert.equal((described as { error: string }).error, INVITE_DEAD);
});

/* ============================== a dead target ================================ */

test("a stream that ended does not fail the redemption — the newcomer lands in the suite", async () => {
  const brett = await studio();
  const live = ok(await openStream(brett, "Friday night"), "opening the stream");
  const made = ok(
    await createInvite(brett, ORIGIN, { channel: "link", targetKind: "stream", targetId: live.value.id }),
    "creating",
  );
  ok(closeStream(brett, live.value.id, false), "the host ending the stream");

  const redeemed = ok(
    await redeemInvite({ token: made.invite.token, mode: "signup", username: "latecomer", password: "latecomer-pw" }),
    "redeeming into an ended stream",
  );
  assert.deepEqual(redeemed.arrival, { kind: "suite" }, "they land, rather than being turned away");
  assert.ok(
    redeemed.notes.some((n) => /has ended/.test(n)),
    "and they are told why they are not in the room",
  );
  assert.ok(await findAccount("latecomer"), "the account is real whatever happened to the room");
  assert.equal(grantsFor("latecomer").modules.amberxvid, true, "and so is the membership");
});

test("you cannot invite people into somebody else's broadcast", async () => {
  const brett = await studio();
  await member("dana", "Dana");
  const live = ok(await openStream(brett, "Friday night"), "brett going live");

  const refused = await createInvite("dana", ORIGIN, {
    channel: "link",
    targetKind: "stream",
    targetId: live.value.id,
  });
  assert.equal(refused.ok, false);
  assert.equal((refused as { status: number }).status, 403);
});

/* ================================ revoke ===================================== */

test("revoking is idempotent, and a spent invitation cannot be revoked", async () => {
  const brett = await studio();
  const made = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating");

  ok(revokeInvite(brett, made.invite.id), "revoking");
  ok(revokeInvite(brett, made.invite.id), "revoking again");
  assert.equal(listInvites(brett)[0].state, "revoked");

  const spent = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "creating another");
  ok(
    await redeemInvite({ token: spent.invite.token, mode: "signup", username: "used", password: "used-pw" }),
    "spending it",
  );
  const refused = revokeInvite(brett, spent.invite.id);
  assert.equal(refused.ok, false);
  assert.match((refused as { error: string }).error, /already been used/);
});

test("a member only ever sees and revokes their own invitations", async () => {
  const brett = await studio();
  await member("dana", "Dana");
  const mine = ok(await createInvite(brett, ORIGIN, { channel: "link" }), "brett creating");

  assert.equal(listInvites("dana").length, 0, "dana's list is dana's");
  const stolen = revokeInvite("dana", mine.invite.id);
  assert.equal(stolen.ok, false, "and she cannot revoke his");
  assert.equal(listInvites(brett)[0].state, "open");
});

/* ================================ the caps =================================== */

test("the rate cap bites, and says so with a number", async () => {
  const brett = await studio();
  for (let i = 0; i < INVITE_LIMITS.perWindow; i++) {
    ok(await createInvite(brett, ORIGIN, { channel: "link" }), `invitation ${i + 1}`);
  }
  const capped = await createInvite(brett, ORIGIN, { channel: "link" });
  assert.equal(capped.ok, false);
  assert.equal((capped as { status: number }).status, 429);
  assert.match((capped as { error: string }).error, new RegExp(String(INVITE_LIMITS.perWindow)));
});

test("the policy row refuses invitations by name, and goes red when it is off", async () => {
  const brett = await studio();
  setAmberxvidPolicySource(() => ({ canSendInvites: false }));
  try {
    const refused = await createInvite(brett, ORIGIN, { channel: "link" });
    assert.equal(refused.ok, false);
    assert.equal((refused as { status: number }).status, 403);
    assert.match(
      (refused as { error: string }).error,
      /canSendInvites/,
      "the refusal names the catalog row, so an administrator knows which dial to move",
    );
  } finally {
    setAmberxvidPolicySource(null);
  }
  ok(await createInvite(brett, ORIGIN, { channel: "link" }), "and it works again with the row back on");
});

/* =============================== delivery ==================================== */

test("with no mail server, email is HANDED OVER and says so — never reported as sent", async () => {
  const brett = await studio();
  delete process.env.AMBERXVID_SMTP_URL;
  assert.equal(inviteDeliveryStatus().smtp, false);

  const made = ok(
    await createInvite(brett, ORIGIN, { channel: "email", handle: "someone@example.com", note: "hello" }),
    "creating",
  );
  assert.equal(made.delivery.kind, "handed-over", "a compose is never reported as a send");
  const handed = made.delivery as { kind: "handed-over"; uri: string; why: string };
  assert.ok(handed.uri.startsWith("mailto:someone%40example.com?"), handed.uri);
  assert.match(handed.why, /AMBERXVID_SMTP_URL/, "and the reason names the variable that would change it");

  // The composed message carries the working link, which is the whole payload.
  const composed = composeInvite({
    inviter: brett,
    target: made.invite.target,
    note: "hello",
    url: made.url,
  });
  assert.ok(composed.body.includes(made.url));
  assert.ok(mailtoUri("someone@example.com", composed.subject, composed.body).includes(encodeURIComponent(made.url)));
});

test("a text invitation is always composed — no SMS gateway is pretended into existence", async () => {
  const brett = await studio();
  const made = ok(
    await createInvite(brett, ORIGIN, { channel: "sms", handle: "+15550102020" }),
    "creating",
  );
  assert.equal(made.delivery.kind, "handed-over");
  assert.ok((made.delivery as { uri: string }).uri.startsWith("sms:"));
});

/* ============================== the arrival wire ============================= */

test("arrival round-trips, and junk in the address bar lands in the suite", () => {
  assert.equal(ARRIVAL_PARAM, "axv-arrive");
  for (const arrival of [
    { kind: "stream", id: "r-123" },
    { kind: "chat", id: "g-abc" },
    { kind: "call", with: "brett" },
  ] as const) {
    assert.deepEqual(decodeArrival(encodeArrival(arrival)), arrival);
  }
  assert.equal(encodeArrival({ kind: "suite" }), null);
  for (const junk of [null, "", "stream:", "nonsense", "call", "::"]) {
    assert.equal(decodeArrival(junk), null, `"${junk}" must not throw or route anywhere`);
  }
});

/* ========================= the sponsored accounts door ======================= */

test("createAccountByInvitation refuses a sponsor who is gone, disabled or unfinished", async () => {
  freshStores();
  await admin();

  const orphan = await createAccountByInvitation("nobody", "newcomer", "newcomer-pw");
  assert.equal(orphan.ok, false);
  assert.equal((orphan as { status: number }).status, 404);

  // A sponsor still inside their own forced entry flow cannot vouch for anybody.
  const added = await addUser("admin", "halfway", "temp-pass", "member");
  assert.equal(added.ok, true);
  const unfinished = await createAccountByInvitation("halfway", "newcomer", "newcomer-pw");
  assert.equal(unfinished.ok, false);
  assert.equal((unfinished as { status: number }).status, 409);

  assert.equal(await findAccount("newcomer"), null, "and neither refusal created anything");
});
