/**
 * @file **The admin suite's five new layers, locked** — P11 of
 * `axf-accounts-admin-suite`.
 *
 * Staged the way `test/axf-kv.test.ts` stages the kv store, and for its reason:
 * real files under a throwaway root, the thing under test never mocked. The
 * accounts store reads `ACCOUNTS_DATA_DIR` per call and never latches it at
 * import (`lib/paths.ts`), which is what lets every test below open with
 * `freshStore()` and start from an empty disk with no module-cache games.
 *
 * Five layers, and each one is here because its failure mode is SILENT:
 *
 * - **STORAGE.** `charge` is advisory and `rescan` is authoritative, so drift
 *   is designed in — the only thing that makes that safe is the reconciler
 *   actually reconciling. A rescan that quietly kept a charged number would
 *   look identical to one that measured, forever. So the index is deliberately
 *   drifted with a wrong charge and the rescan is asserted to REPLACE it, not
 *   to adjust it. The closed `StorageVerdict` union is exercised through all
 *   three arms, because `no-index` is an answer a consumer must handle and not
 *   an error it may ignore.
 * - **POLICY.** The whole cascade turns on absent-vs-pinned, and the two are
 *   byte-identical the day they are written — they diverge only when the tier
 *   above MOVES. A test that set a value and read it back would pass against a
 *   cascade that had silently pinned everything, so the site tier is moved
 *   underneath both an absent field and a pinned one and the two are asserted
 *   to answer differently.
 * - **ADMIN ROUTES.** Six route modules, thirteen handlers, one gate. The claim
 *   in `lib/http.ts` is that they refuse IDENTICALLY because they share
 *   `requireLiveAdmin` rather than because six files were written with the same
 *   intention; that claim is only worth anything if something compares the six
 *   refusals byte for byte.
 * - **THE FILES ROUTE'S ORDERING.** "Audited before the bytes move" is not
 *   provable by finding a record afterwards — a route that logged after
 *   responding would leave exactly the same record. So the ordering is observed
 *   from INSIDE the read: a registered root whose `owns` predicate (called by
 *   `browse.ts` on the way to the bytes, strictly before `readFile`) snapshots
 *   the audit trail at that instant. The record has to already be there. The
 *   other half is the refusal — with an unwritable trail the handler must 500
 *   and the predicate must never fire at all.
 * - **DOCK GEOMETRY and THEME LOOKUP.** Both are pure functions whose wrong
 *   answers look like working software: a flip that decides the other
 *   orientation still renders a panel, and a reverse lookup that names the
 *   wrong dial still scrolls to a row and glows it.
 *
 * `@axf/core` is imported as the bare specifier only — `check:imports` forbids
 * this tree a core deep path, so the dock model is reached through the barrel
 * exactly as app code reaches it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { NextRequest } from "next/server";

import {
  DOCK_DEFAULT_FLOAT_SIZE,
  DOCK_GHOST_PX,
  DOCK_SNAP_RANGE_PX,
  decide,
  defaultValues,
  orientationFor,
  parseDockState,
  resolveDockDefault,
} from "@axf/core";
import type { DockState } from "@axf/core";

import { addUser, changePassword } from "@axs/modules/accounts/lib/accounts";
import { queryAudit } from "@axs/modules/accounts/lib/audit";
import { normalizeRel, resolveInRoot } from "@axs/modules/accounts/lib/browse";
import {
  auditLogFile,
  dataRoot,
  SITE_POLICY_SUBJECT,
} from "@axs/modules/accounts/lib/paths";
import {
  clearPolicyValue,
  effectivePolicy,
  forgetRateWindows,
  loginGate,
  policyDetail,
  setPolicyValue,
  assertMessageRate,
} from "@axs/modules/accounts/lib/policy";
import { issueAxsSession } from "@axs/modules/accounts/lib/session";
import {
  charge,
  checkQuota,
  readUsage,
  registerUserDataRoot,
  rescan,
  USER_DATA_ROOTS,
} from "@axs/modules/accounts/lib/storage";

import {
  buildTokenIndex,
  describeMatches,
  matchTokens,
  COLOR_TOLERANCE,
} from "../src/plugins/theme-manager/locate";

import * as adminRoute from "../app/api/accounts/admin/route";
import * as auditRoute from "../app/api/accounts/admin/audit/route";
import * as dashboardRoute from "../app/api/accounts/admin/dashboard/route";
import * as filesRoute from "../app/api/accounts/admin/files/route";
import * as policyRoute from "../app/api/accounts/admin/policy/route";
import * as usersRoute from "../app/api/accounts/admin/users/route";
import * as storageRoute from "../app/api/accounts/storage/route";

/* ================================== staging =================================== */

const roots: string[] = [];

/** A per-test scratch directory the probe roots below resolve into. Reassigned
 *  by `freshStore()`, so a registered root written once still points at the
 *  current test's disk — a root registry is process-wide and the store is not. */
let scratch = "";

/** Point the whole accounts layout, and both probe roots, at an empty disk. */
function freshStore(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axs-admin-suite-"));
  roots.push(root);
  process.env.ACCOUNTS_DATA_DIR = root;
  scratch = path.join(root, "scratch");
  fs.mkdirSync(scratch, { recursive: true });
  return root;
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** The member every case below is about. A name nothing else on this machine
 *  can already own, so the built-in roots (`kv`, `expenses`, the claude stores)
 *  resolve to directories that genuinely do not exist and genuinely contribute
 *  zero — which is what makes the exact byte assertions below meaningful. */
const SUBJECT = "p11probe";

/**
 * A per-user tree root, registered once. The registry is a plain map keyed by
 * id (`registerUserDataRoot` REPLACES), so re-registering per test would be
 * legal — it is done once instead, and `scratch` moves underneath it, to prove
 * the registry holds a resolver rather than a resolved path.
 */
registerUserDataRoot({
  id: "p11-tree",
  title: "P11 probe tree",
  resolve: (username) => path.join(scratch, "tree", username),
});

/** The seeded administrator, through the entry flow so the admin gates open. */
async function signedInAdmin(): Promise<string> {
  const changed = await changePassword("admin", "amberx", "gatekeeper-p11");
  assert.equal(changed.ok, true, "the seeded temp password must open the entry flow");
  return "admin";
}

/** An admin-created member. Left mid-entry on purpose where the test does not
 *  need them signed in — none of the policy reads below depend on it. */
async function member(username = SUBJECT): Promise<string> {
  const added = await addUser("admin", username, "temp-pass-p11", "member");
  assert.equal(added.ok, true, `adding ${username}`);
  return username;
}

const rowOf = (index: Awaited<ReturnType<typeof readUsage>>, rootId: string): number =>
  index?.roots.find((r) => r.rootId === rootId)?.bytes ?? -1;

/** Write `bytes` bytes into the probe tree and answer how many were written. */
function writeTree(username: string, files: Record<string, number>): number {
  const dir = path.join(scratch, "tree", username);
  fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const [name, size] of Object.entries(files)) {
    const abs = path.join(dir, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "x".repeat(size));
    total += size;
  }
  return total;
}

/* ============================== STORAGE — the ledger =========================== */

test("charge accumulates against a scanned index, and refuses to invent one", async () => {
  freshStore();

  // The contract's first clause: a charge against a member who has never been
  // scanned is DROPPED and says so. Seeding an index from one delta would
  // report a member with a large vault as using 40 KB — a number that looks
  // measured, is wrong, and no surface can tell from a real one.
  assert.deepEqual(await charge(SUBJECT, "p11-tree", 4_096), {
    applied: false,
    reason: "no-index",
  });
  assert.equal(await readUsage(SUBJECT), null, "a dropped charge writes no document");

  const scanned = await rescan(SUBJECT);
  assert.equal(scanned?.totalBytes, 0, "an empty tree measures zero, not nothing");

  const first = await charge(SUBJECT, "p11-tree", 1_000);
  assert.equal(first.applied, true);
  assert.equal(first.applied && first.index.totalBytes, 1_000);

  const second = await charge(SUBJECT, "p11-tree", 500, 2);
  assert.equal(second.applied, true);
  assert.equal(second.applied && second.index.totalBytes, 1_500, "deltas accumulate");
  assert.equal(second.applied && rowOf(second.index, "p11-tree"), 1_500);

  // A delete's negative delta lands, and over-charging clamps at zero rather
  // than producing a negative total every surface would have to defend against.
  const third = await charge(SUBJECT, "p11-tree", -9_999);
  assert.equal(third.applied && third.index.totalBytes, 0);

  const read = await readUsage(SUBJECT);
  assert.equal(read?.totalBytes, 0, "readUsage is a READ of what charge wrote — never a walk");
});

test("rescan reconciles a deliberately drifted index — it replaces, never adjusts", async () => {
  freshStore();

  const real = writeTree(SUBJECT, { "a.json": 2_048, "nested/b.json": 1_024 });
  const scanned = await rescan(SUBJECT);
  assert.equal(scanned?.totalBytes, real, "the first scan measures what is on disk");
  assert.equal(rowOf(scanned, "p11-tree"), real);

  // Drift it on purpose, in both directions: a charge nobody balanced, then a
  // file written on disk by something that charged nothing at all.
  const drifted = await charge(SUBJECT, "p11-tree", 500_000);
  assert.equal(drifted.applied && drifted.index.totalBytes, real + 500_000);
  const realNow = real + writeTree(SUBJECT, { "c.json": 512 });

  const reconciled = await rescan(SUBJECT);
  assert.equal(
    reconciled?.totalBytes,
    realNow,
    "the reconciler's answer REPLACES the accumulated charges — an adjustment would have kept the 500 KB",
  );
  assert.equal(rowOf(reconciled, "p11-tree"), realNow);
  assert.equal(reconciled?.roots.find((r) => r.rootId === "p11-tree")?.files, 3);
  assert.ok(
    Date.parse(reconciled?.scannedAt ?? "") >= Date.parse(scanned?.scannedAt ?? ""),
    "an authoritative rebuild moves scannedAt — the distance from updatedAt is the unreconciled drift",
  );
});

test("checkQuota answers every arm of the closed StorageVerdict union", async () => {
  freshStore();

  // 1. no-index — a real answer, not an error. Nothing can honestly say whether
  //    an unmeasured member is over.
  const unmeasured = await checkQuota(SUBJECT, 100, 1_000);
  assert.equal(unmeasured.kind, "no-index");
  assert.equal(unmeasured.wantBytes, 100);

  writeTree(SUBJECT, { "a.json": 1_000 });
  await rescan(SUBJECT);

  // 2. ok, with a limit — the remaining allowance is arithmetic the caller does
  //    not repeat.
  const fits = await checkQuota(SUBJECT, 200, 2_000);
  assert.equal(fits.kind, "ok");
  assert.equal(fits.kind === "ok" && fits.usedBytes, 1_000);
  assert.equal(fits.kind === "ok" && fits.remainingBytes, 800);

  // 2b. ok, unlimited — an ABSENT policy must never read as a zero-byte quota.
  const unlimited = await checkQuota(SUBJECT, 10_000_000, null);
  assert.equal(unlimited.kind, "ok");
  assert.equal(unlimited.kind === "ok" && unlimited.limitBytes, null);
  assert.equal(unlimited.kind === "ok" && unlimited.remainingBytes, null);

  // 3. over-quota — the overage is named, because "you are over" without the
  //    numbers is a message a member cannot act on.
  const over = await checkQuota(SUBJECT, 1_500, 2_000);
  assert.equal(over.kind, "over-quota");
  assert.equal(over.kind === "over-quota" && over.overBy, 500);
  assert.equal(over.kind === "over-quota" && over.limitBytes, 2_000);
});

test("an unregistered root contributes nothing — to the walk or to a charge", async () => {
  freshStore();

  const counted = writeTree(SUBJECT, { "a.json": 4_000 });
  // Bytes on disk, under the same store, in a directory NO registered root
  // resolves to. The registry is the whole definition of what is counted.
  const stranger = path.join(scratch, "not-a-registered-root", SUBJECT);
  fs.mkdirSync(stranger, { recursive: true });
  fs.writeFileSync(path.join(stranger, "huge.bin"), "y".repeat(250_000));

  const index = await rescan(SUBJECT);
  assert.equal(index?.totalBytes, counted, "only registered roots are walked");
  assert.equal(
    index?.roots.some((r) => r.rootId === "not-a-registered-root"),
    false,
    "and no row appears for a directory nobody registered",
  );

  // The same rule from the other direction: a charge naming an unknown id is
  // refused rather than creating a row the reconciler would then delete.
  assert.deepEqual(await charge(SUBJECT, "not-a-registered-root", 250_000), {
    applied: false,
    reason: "unknown-root",
  });
  assert.equal((await readUsage(SUBJECT))?.totalBytes, counted);
  assert.equal(USER_DATA_ROOTS.get("not-a-registered-root"), undefined);
});

/* ============================== POLICY — the cascade =========================== */

test("the cascade: an ABSENT field follows a moving default, a PRESENT one stays pinned", async () => {
  freshStore();
  const admin = await signedInAdmin();
  await member();

  // Tier 0 — the shipped posture.
  assert.equal((await effectivePolicy(SUBJECT)).storageQuotaMB, 0);
  assert.equal((await policyDetail(SUBJECT)).tiers.storageQuotaMB, "default");

  // Tier 1 — the site posture. The member's field is ABSENT, so they follow it.
  assert.equal((await setPolicyValue(admin, SITE_POLICY_SUBJECT, "storageQuotaMB", 500)).ok, true);
  assert.equal((await effectivePolicy(SUBJECT)).storageQuotaMB, 500);
  assert.equal((await policyDetail(SUBJECT)).tiers.storageQuotaMB, "site");

  // ...and they keep following it as it MOVES. This is the assertion the whole
  // sparse-document design exists for: a cascade that stored the resolved value
  // would have pinned them at 500 here and nothing would have looked wrong.
  assert.equal((await setPolicyValue(admin, SITE_POLICY_SUBJECT, "storageQuotaMB", 900)).ok, true);
  assert.equal((await effectivePolicy(SUBJECT)).storageQuotaMB, 900);

  // Tier 2 — pinned. Now the site tier moves and the member does not.
  assert.equal((await setPolicyValue(admin, SUBJECT, "storageQuotaMB", 250)).ok, true);
  assert.equal((await policyDetail(SUBJECT)).tiers.storageQuotaMB, "user");
  assert.equal((await setPolicyValue(admin, SITE_POLICY_SUBJECT, "storageQuotaMB", 1_200)).ok, true);
  assert.equal(
    (await effectivePolicy(SUBJECT)).storageQuotaMB,
    250,
    "a pinned field is where an administrator put it, whatever the tier above does",
  );

  // Un-pinning is a distinct gesture from setting the default's current value —
  // the two produce identical documents today and diverge the next time the
  // default moves, which is exactly what is asserted here.
  assert.equal((await clearPolicyValue(admin, SUBJECT, "storageQuotaMB")).ok, true);
  assert.equal((await effectivePolicy(SUBJECT)).storageQuotaMB, 1_200);
  assert.equal((await policyDetail(SUBJECT)).tiers.storageQuotaMB, "site");
});

test("suspension refuses the login door with its reason and its date on the refusal", async () => {
  freshStore();
  const admin = await signedInAdmin();
  await member();

  assert.deepEqual(await loginGate(SUBJECT), { verdict: "allow" });

  const until = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString().slice(0, 10);
  assert.equal((await setPolicyValue(admin, SUBJECT, "suspended", true)).ok, true);
  assert.equal(
    (await setPolicyValue(admin, SUBJECT, "suspendedReason", "spamming the directory")).ok,
    true,
  );
  assert.equal((await setPolicyValue(admin, SUBJECT, "suspendedUntil", until)).ok, true);

  const refused = await loginGate(SUBJECT);
  assert.equal(refused.verdict, "refuse");
  assert.equal(refused.verdict === "refuse" && refused.row, "suspended");
  assert.equal(refused.verdict === "refuse" && refused.status, 403);
  assert.equal(
    refused.verdict === "refuse" && refused.until,
    until,
    "the date is a FIELD, not only a phrase inside the sentence",
  );
  assert.match(
    refused.verdict === "refuse" ? refused.error : "",
    /spamming the directory/,
    "a refusal with no reason becomes a support ticket the same day",
  );
  assert.match(refused.verdict === "refuse" ? refused.error : "", new RegExp(until));

  // A date already past means the suspension lapsed on its own — a timed
  // suspension nobody has to remember to lift is the only kind that gets used.
  assert.equal((await setPolicyValue(admin, SUBJECT, "suspendedUntil", "2020-01-01")).ok, true);
  assert.deepEqual(await loginGate(SUBJECT), { verdict: "allow" });

  // And the third outcome: forced change LETS THEM IN. Refusing would leave
  // them with no session to change the password with.
  assert.equal((await setPolicyValue(admin, SUBJECT, "forcePasswordReset", true)).ok, true);
  assert.equal((await loginGate(SUBJECT)).verdict, "force-password-change");
});

test("the rate-limit window lets the limit through, refuses past it, and does not charge the retry", async () => {
  freshStore();
  const admin = await signedInAdmin();
  await member();
  forgetRateWindows(SUBJECT);

  // 0 is this catalog's spelling of "no cap", and it must not read as "no sends".
  assert.deepEqual(await assertMessageRate(SUBJECT), { ok: true });

  assert.equal((await setPolicyValue(admin, SUBJECT, "messagesPerMinute", 2)).ok, true);
  forgetRateWindows(SUBJECT);

  assert.deepEqual(await assertMessageRate(SUBJECT), { ok: true }, "1 of 2");
  assert.deepEqual(await assertMessageRate(SUBJECT), { ok: true }, "2 of 2");

  const refused = await assertMessageRate(SUBJECT);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 429);
  assert.equal(!refused.ok && refused.row, "messagesPerMinute");
  assert.equal(!refused.ok && refused.value, 2);
  assert.match(!refused.ok ? refused.error : "", /Try again in \d+s/);

  // The refused attempt was not counted. A limiter that charged the retry would
  // let a client that keeps trying extend its own lock-out indefinitely, so the
  // window is still holding exactly the two ALLOWED sends — which is what makes
  // the second refusal's wait no LONGER than the first's.
  const firstWait = Number(/Try again in (\d+)s/.exec(!refused.ok ? refused.error : "")?.[1]);
  const again = await assertMessageRate(SUBJECT);
  assert.equal(again.ok, false);
  const secondWait = Number(/Try again in (\d+)s/.exec(!again.ok ? again.error : "")?.[1]);
  assert.ok(
    secondWait <= firstWait,
    `a retry must not extend its own lock-out (${firstWait}s → ${secondWait}s)`,
  );

  forgetRateWindows(SUBJECT);
  assert.deepEqual(await assertMessageRate(SUBJECT), { ok: true }, "forgetting the window reopens it");
});

test("every policy write lands in the audit log, with old → new, and a no-op does not", async () => {
  freshStore();
  const admin = await signedInAdmin();
  await member();

  assert.equal((await setPolicyValue(admin, SUBJECT, "maxSessions", 3)).ok, true);
  assert.equal((await setPolicyValue(admin, SUBJECT, "maxSessions", 5)).ok, true);

  const set = await queryAudit({ subject: SUBJECT, verbs: ["policy-set"] });
  assert.equal(set.total, 2, "one record per real change");
  // Newest first.
  assert.equal(set.entries[0].actor, "admin");
  assert.equal(set.entries[0].field, "maxSessions");
  assert.equal(set.entries[0].from, "3");
  assert.equal(set.entries[0].to, "5");
  assert.equal(
    set.entries[1].from,
    "(following the default)",
    "an ABSENT old value must not render as a value — that is the pin the record is about",
  );

  // A no-op is a clean success and is NOT audited: a trail padded with lines
  // where nothing moved is one nobody reads.
  assert.equal((await setPolicyValue(admin, SUBJECT, "maxSessions", 5)).ok, true);
  assert.equal((await queryAudit({ subject: SUBJECT, verbs: ["policy-set"] })).total, 2);

  // Un-pinning is its OWN verb — "went back to following" and "was pinned to the
  // default's current value" are the distinction the cascade is built around.
  assert.equal((await clearPolicyValue(admin, SUBJECT, "maxSessions")).ok, true);
  const cleared = await queryAudit({ subject: SUBJECT, verbs: ["policy-clear"] });
  assert.equal(cleared.total, 1);
  assert.equal(cleared.entries[0].from, "5");
  assert.equal(cleared.entries[0].to, "(following the default)");

  // The site tier is audited under its own pseudo-subject, so an administrator
  // reading one member's trail is not shown site-wide moves as if they were
  // that member's.
  assert.equal((await setPolicyValue(admin, SITE_POLICY_SUBJECT, "canSeeDirectory", false)).ok, true);
  assert.equal((await queryAudit({ subject: SITE_POLICY_SUBJECT })).total, 1);
  assert.equal((await queryAudit({ subject: SUBJECT, verbs: ["policy-set"] })).total, 2);
});

/* ============================ ADMIN ROUTES — the gate ========================== */

type Handler = (req: NextRequest) => Promise<Response> | Response;

/** Every admin-gated handler in the suite, by the URL it answers on. */
const ADMIN_HANDLERS: Array<{ name: string; fn: Handler; method: string; url: string }> = [
  { name: "admin GET", fn: adminRoute.GET, method: "GET", url: "http://x/api/accounts/admin" },
  { name: "admin POST", fn: adminRoute.POST, method: "POST", url: "http://x/api/accounts/admin" },
  { name: "users GET", fn: usersRoute.GET, method: "GET", url: "http://x/api/accounts/admin/users" },
  { name: "users POST", fn: usersRoute.POST, method: "POST", url: "http://x/api/accounts/admin/users" },
  { name: "policy GET", fn: policyRoute.GET, method: "GET", url: `http://x/api/accounts/admin/policy?user=${SUBJECT}` },
  { name: "policy PUT", fn: policyRoute.PUT, method: "PUT", url: "http://x/api/accounts/admin/policy" },
  { name: "policy DELETE", fn: policyRoute.DELETE, method: "DELETE", url: "http://x/api/accounts/admin/policy" },
  { name: "files GET", fn: filesRoute.GET, method: "GET", url: `http://x/api/accounts/admin/files?user=${SUBJECT}` },
  { name: "audit GET", fn: auditRoute.GET, method: "GET", url: "http://x/api/accounts/admin/audit" },
  { name: "dashboard GET", fn: dashboardRoute.GET, method: "GET", url: "http://x/api/accounts/admin/dashboard" },
  { name: "storage POST", fn: storageRoute.POST, method: "POST", url: "http://x/api/accounts/storage" },
];

/** A request carrying (or not carrying) a signed `axs_session` cookie. */
function request(url: string, method: string, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.cookie = `axs_session=${token}`;
  return new NextRequest(url, {
    method,
    headers,
    ...(method === "GET" ? {} : { body: JSON.stringify({}) }),
  });
}

test("every admin handler refuses a non-admin session IDENTICALLY", async () => {
  freshStore();
  await signedInAdmin();
  await member();

  const memberToken = issueAxsSession({ username: SUBJECT, role: "member" });
  const seen = new Set<string>();

  for (const h of ADMIN_HANDLERS) {
    const res = await h.fn(request(h.url, h.method, memberToken));
    const body = (await res.json()) as { ok: boolean; error: string };
    assert.equal(res.status, 403, `${h.name} must refuse a member with 403`);
    assert.equal(body.ok, false, `${h.name}`);
    seen.add(`${res.status} ${body.error}`);
  }
  assert.deepEqual(
    [...seen],
    ["403 administrator access required"],
    "one gate, one refusal — six route files spelling the same intention would drift; sharing requireLiveAdmin cannot",
  );

  // And the tier below it: no cookie at all is 401, equally uniformly. A member
  // token signed for THIS store is the interesting case above; this is the one
  // an unauthenticated caller gets.
  const anonymous = new Set<string>();
  for (const h of ADMIN_HANDLERS) {
    const res = await h.fn(request(h.url, h.method));
    const body = (await res.json()) as { error: string };
    anonymous.add(`${res.status} ${body.error}`);
  }
  assert.deepEqual([...anonymous], ["401 sign in first"]);
});

test("a member's ROLE is re-read live — a session minted as administrator does not open the gate", async () => {
  freshStore();
  await signedInAdmin();
  await member();

  // The token is genuinely signed by this store's secret and claims the
  // administrator role. `requireLiveAdmin` re-reads the account anyway, which is
  // what makes a demotion bind on the next request rather than at the cookie's
  // 24-hour expiry.
  const forgedRole = issueAxsSession({ username: SUBJECT, role: "administrator" });
  const res = await adminRoute.GET(request("http://x/api/accounts/admin", "GET", forgedRole));
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: string }).error, "administrator access required");
});

/* ------------------- the files route: the record goes FIRST -------------------- */

/**
 * What the ownership predicate saw at the moment `browse.ts` was on its way to
 * the bytes. `resolveFile` re-asks `owns` BEFORE `readFile`, so anything read
 * here happened strictly before a single byte moved.
 */
let atByteRead: { calls: number; trail: Array<{ verb: string; path?: string }> } | null = null;

/** The audit trail as it sits on disk RIGHT NOW, read synchronously so the
 *  snapshot cannot drift while it is being taken. */
function trailNow(): Array<{ verb: string; path?: string }> {
  let text = "";
  try {
    text = fs.readFileSync(auditLogFile(), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { verb: string; path?: string });
}

/** A FLAT, shared-shaped root — `owns` is what makes it flat, and `owns` is the
 *  hook the ordering proof needs. */
registerUserDataRoot({
  id: "p11-flat",
  title: "P11 ordering probe",
  resolve: () => path.join(scratch, "flat"),
  owns: () => {
    if (atByteRead) {
      atByteRead.calls += 1;
      atByteRead.trail.push(...trailNow());
    }
    return true;
  },
});

test("the files route records the read BEFORE the bytes move — asserted on ordering", async () => {
  freshStore();
  await signedInAdmin();
  await member();
  const adminToken = issueAxsSession({ username: "admin", role: "administrator" });

  fs.mkdirSync(path.join(scratch, "flat"), { recursive: true });
  fs.writeFileSync(path.join(scratch, "flat", "secret.json"), JSON.stringify({ a: 1 }));

  atByteRead = { calls: 0, trail: [] };
  const res = await filesRoute.GET(
    request(
      `http://x/api/accounts/admin/files?user=${SUBJECT}&root=p11-flat&path=secret.json&view=download`,
      "GET",
      adminToken,
    ),
  );
  const observed = atByteRead;
  atByteRead = null;

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="secret.json"');
  assert.equal(await res.text(), JSON.stringify({ a: 1 }), "the bytes really did go out");

  assert.equal(observed.calls, 1, "the ownership predicate must have run on the way to the bytes");
  assert.ok(
    observed.trail.some((e) => e.verb === "file-download" && e.path === "secret.json"),
    "THE ORDERING: the download was already in the trail at the instant browse.ts was resolving the " +
      `file, but the trail held ${JSON.stringify(observed.trail)}. A route that recorded after ` +
      "responding would leave an identical record on disk afterwards — this is what tells the two apart.",
  );

  // The record is a precondition, not a receipt: with an unwritable trail the
  // handler refuses and the read never happens at all.
  freshStore();
  await signedInAdmin();
  await member();
  fs.mkdirSync(path.join(scratch, "flat"), { recursive: true });
  fs.writeFileSync(path.join(scratch, "flat", "secret.json"), JSON.stringify({ a: 1 }));
  fs.mkdirSync(dataRoot(), { recursive: true });
  fs.mkdirSync(auditLogFile(), { recursive: true }); // appendFile → EISDIR

  atByteRead = { calls: 0, trail: [] };
  const refused = await filesRoute.GET(
    request(
      `http://x/api/accounts/admin/files?user=${SUBJECT}&root=p11-flat&path=secret.json&view=download`,
      "GET",
      issueAxsSession({ username: "admin", role: "administrator" }),
    ),
  );
  const afterRefusal = atByteRead;
  atByteRead = null;

  assert.equal(refused.status, 500);
  assert.match(
    ((await refused.json()) as { error: string }).error,
    /recorded act, always/,
    "the refusal says why, so nobody reads it as a broken route",
  );
  assert.equal(
    afterRefusal.calls,
    0,
    "an unrecordable read must not reach the file at all — the predicate must never have fired",
  );
});

/* ------------------------------ the prefix fence -------------------------------- */

test("the prefix fence refuses every traversal spelling, at the store and through the route", async () => {
  freshStore();
  await signedInAdmin();
  await member();
  const adminToken = issueAxsSession({ username: "admin", role: "administrator" });

  const base = path.join(scratch, "tree", SUBJECT);
  fs.mkdirSync(path.join(base, "nested"), { recursive: true });
  fs.writeFileSync(path.join(base, "nested", "ok.json"), "{}");
  // The thing on the other side of the fence, so a hole would have something to
  // find rather than merely a 404 for a file that does not exist.
  fs.writeFileSync(path.join(scratch, "outside.json"), '{"secret":true}');

  // The fence holds a legitimate nested path, or the refusals below would prove
  // nothing but that the root is broken.
  const legit = await resolveInRoot("p11-tree", SUBJECT, "nested/ok.json");
  assert.equal(legit.ok, true);
  assert.equal(legit.ok && path.basename(legit.value.abs), "ok.json");

  const hostile: Array<[string, string]> = [
    ["..\\outside.json", "a Windows-spelled climb"],
    ["../outside.json", "a POSIX-spelled climb"],
    ["nested/../../outside.json", "a climb hidden mid-path"],
    ["C:\\Windows\\win.ini", "a drive-letter absolute path"],
    ["nested/ok\0.json", "a NUL"],
  ];
  // Asserted on the OUTCOME rather than on which layer produced it, and that is
  // deliberate: the fence is two checks deep (the `..` segment scan, then
  // resolve-and-verify-prefix, then both again through `realpath`), so removing
  // either one must still leave every spelling refused. A test that pinned the
  // sentence would go red on a defence-in-depth change that broke nothing.
  for (const [spelling, why] of hostile) {
    const result = await resolveInRoot("p11-tree", SUBJECT, spelling);
    assert.equal(result.ok, false, `${why} (${JSON.stringify(spelling)}) must be refused`);
    assert.equal(!result.ok && result.status, 400, why);
  }

  // A POSIX absolute path is normalised to a relative one (`normalizeRel` strips
  // leading separators) rather than refused by name, so the claim worth pinning
  // is the fence's real one: whatever it resolves to is INSIDE the root.
  const posixAbsolute = await resolveInRoot("p11-tree", SUBJECT, "/nested/ok.json");
  assert.equal(posixAbsolute.ok, true);
  assert.ok(
    posixAbsolute.ok && posixAbsolute.value.abs.toLowerCase().startsWith(fs.realpathSync(base).toLowerCase()),
    "a leading slash is stripped, never followed to the filesystem root",
  );

  // Through the route, where the encoded spelling is the one a browser sends:
  // `%2F` decodes in the query string before the handler ever sees it.
  const encoded = await filesRoute.GET(
    request(
      `http://x/api/accounts/admin/files?user=${SUBJECT}&root=p11-tree&path=nested%2F..%2F..%2Foutside.json`,
      "GET",
      adminToken,
    ),
  );
  assert.equal(encoded.status, 400);
  const encodedBody = (await encoded.json()) as { ok: boolean; error: string; listing?: unknown };
  assert.equal(encodedBody.ok, false);
  assert.equal(encodedBody.listing, undefined, "nothing outside the root came back");
  assert.match(encodedBody.error, /climb out of the root|outside the root/);

  assert.equal(normalizeRel("\\a\\b\\"), "a/b", "one spelling per act, or the audit trail records three");
});

/* ============================== DOCK — the geometry ============================= */

/** A 1000×600 container at a non-zero origin, so a test cannot accidentally
 *  pass by treating client space as container space. */
const BOX = { x: 100, y: 50, width: 1000, height: 600 };

test("each edge's snap range yields that zone, and the orientation is the flip", () => {
  const cases: Array<[string, { x: number; y: number }, "top" | "bottom" | "left" | "right", "horizontal" | "vertical"]> = [
    ["top", { x: 600, y: 50 + 10 }, "top", "horizontal"],
    ["bottom", { x: 600, y: 50 + 600 - 10 }, "bottom", "horizontal"],
    ["left", { x: 100 + 10, y: 350 }, "left", "vertical"],
    ["right", { x: 100 + 1000 - 10, y: 350 }, "right", "vertical"],
  ];
  for (const [name, point, zone, orientation] of cases) {
    const d = decide(point, BOX);
    assert.equal(d.zone, zone, name);
    assert.equal(d.orientation, orientation, `${name} flips to ${orientation}`);
    assert.equal(d.orientation, orientationFor(zone), "the flip is the same total function everywhere");
    assert.ok(d.ghostRect, `${name} previews a ghost`);
  }

  // The ghost is the zone's strip, in the caller's own coordinate space — a
  // preview drawn at the origin instead would look right in a container that
  // happened to start there and wrong everywhere else.
  const top = decide({ x: 600, y: 60 }, BOX);
  assert.deepEqual(top.ghostRect, { x: 100, y: 50, width: 1000, height: DOCK_GHOST_PX });
  const right = decide({ x: 1090, y: 350 }, BOX);
  assert.deepEqual(right.ghostRect, {
    x: 100 + 1000 - DOCK_GHOST_PX,
    y: 50,
    width: DOCK_GHOST_PX,
    height: 600,
  });

  // The boundary of the range itself: at exactly the snap distance it still
  // snaps, one pixel past it does not.
  assert.equal(decide({ x: 600, y: 50 + DOCK_SNAP_RANGE_PX }, BOX).zone, "top");
  assert.equal(decide({ x: 600, y: 50 + DOCK_SNAP_RANGE_PX + 1 }, BOX).zone, null);
});

test("corners resolve deterministically, and outside every range answers null", () => {
  // The exact corner is equidistant from two edges. Evaluation order
  // top → bottom → left → right with a strict less-than keeps the first, so the
  // answer is a fact a test can pin rather than whichever edge was checked last.
  assert.equal(decide({ x: 100, y: 50 }, BOX).zone, "top", "top-left → top");
  assert.equal(decide({ x: 1100, y: 50 }, BOX).zone, "top", "top-right → top");
  assert.equal(decide({ x: 100, y: 650 }, BOX).zone, "bottom", "bottom-left → bottom");
  assert.equal(decide({ x: 1100, y: 650 }, BOX).zone, "bottom", "bottom-right → bottom");
  // Off the diagonal the nearer edge still wins — the tie-break is a tie-break,
  // not a preference.
  assert.equal(decide({ x: 105, y: 90 }, BOX).zone, "left");

  const middle = decide({ x: 600, y: 350 }, BOX);
  assert.deepEqual(middle, { zone: null, orientation: "horizontal", ghostRect: null });

  // Outside the container entirely — this is "undock by dragging out" falling
  // out of the geometry rather than being a second rule somewhere else.
  assert.equal(decide({ x: 600, y: 40 }, BOX).zone, null);
  assert.equal(decide({ x: 2_000, y: 350 }, BOX).zone, null);
  // A degenerate container answers null rather than doing maths against nothing.
  assert.equal(decide({ x: 0, y: 0 }, { x: 0, y: 0, width: 0, height: 0 }).zone, null);
});

test("the persistence adapter round-trips a DockState, and junk reads as the defaults path", async () => {
  // The adapter is the CALLER's by contract (core stays storage-agnostic), so
  // the round-trip under test is the caller's serialisation against core's
  // `parseDockState` — which is the only half core owns and the only half that
  // can be wrong.
  const docs = new Map<string, string>();
  const adapter = {
    load: (id: string): unknown => {
      const raw = docs.get(id);
      return raw === undefined ? null : JSON.parse(raw);
    },
    save: (id: string, state: DockState | null): void => {
      if (state) docs.set(id, JSON.stringify(state));
      else docs.delete(id);
    },
  };

  const floating: DockState = {
    mode: "floating",
    orientation: "horizontal",
    position: { x: 240, y: 96 },
    size: { width: 420, height: 260 },
    z: 7,
  };
  adapter.save("bar", floating);
  assert.deepEqual(parseDockState(adapter.load("bar")), floating, "a float survives the trip whole");

  const docked: DockState = { mode: "docked", zone: "left", orientation: "vertical", z: 3 };
  adapter.save("rail", docked);
  const back = parseDockState(adapter.load("rail"));
  assert.equal(back?.mode, "docked");
  assert.equal(back?.zone, "left");
  assert.equal(back?.orientation, "vertical", "orientation is RECOMPUTED from the zone on the way back in");
  assert.equal(back?.z, 3);

  // A stored document is the one input the engine does not control. Junk reads
  // as "nobody decided", which is the defaults path — never a throw.
  assert.equal(parseDockState(adapter.load("never-saved")), null);
  assert.equal(parseDockState({ mode: "sideways" }), null);
  assert.equal(parseDockState({ mode: "docked", zone: "diagonal" }), null);
  assert.equal(parseDockState("not an object"), null);
  // ...and a stored doc that LIES about the flip is repaired rather than rejected.
  assert.equal(parseDockState({ mode: "docked", zone: "right", orientation: "horizontal", z: 1 })?.orientation, "vertical");
  // A float with no geometry gets the defaults, so there is always something to draw at.
  assert.deepEqual(parseDockState({ mode: "floating" })?.size, DOCK_DEFAULT_FLOAT_SIZE);

  // `save(id, null)` IS the reset — no third verb an adapter can implement wrongly.
  adapter.save("bar", null);
  assert.equal(parseDockState(adapter.load("bar")), null);
  assert.equal(resolveDockDefault().mode, "docked", "and null reads back as the defaults path");
});

/* ============================ THEME — the reverse map ========================== */

test("the value→token map resolves an exact colour, a near one, and refuses a stranger", () => {
  const index = buildTokenIndex(defaultValues());
  assert.ok(index.length > 0, "the index is built from the published bag, not a hand-list");

  const accent = index.find((e) => e.cssVar === "--axf-accent");
  assert.ok(accent, "the accent dial publishes a variable");
  const accentRgb = accent.rgb;
  assert.ok(accentRgb, "the accent is a colour the index can compare against");
  const [r, g, b] = accentRgb;

  // EXACT — the value the theme published, handed back verbatim.
  const exact = matchTokens({ backgroundColor: accent.value }, index);
  const exactHit = exact.find((m) => m.cssVar === "--axf-accent" || m.dialId === accent.dialId);
  assert.ok(exactHit, "a token's own value must resolve to that token");
  assert.equal(exactHit.exact, true);
  assert.equal(exactHit.distance, 0);

  // NEAREST — the case the tolerance exists for: a composited or anti-aliased
  // surface drifts a few units and shares no digits with the value that was
  // asked for. It must still resolve, and must say it is not exact.
  const nudged = `rgb(${Math.min(255, r + 6)}, ${Math.max(0, g - 6)}, ${Math.min(255, b + 6)})`;
  const near = matchTokens({ backgroundColor: nudged }, index);
  const nearHit = near.find((m) => m.dialId === accent.dialId);
  assert.ok(nearHit, "a colour inside the tolerance resolves to the dial that paints it");
  assert.equal(nearHit.exact, false, "and says so — 'this is the accent' and 'close to it' are different claims");
  assert.ok(nearHit.distance > 0 && nearHit.distance <= COLOR_TOLERANCE);

  // NOTHING — a colour no token produces. Found by search rather than guessed,
  // so this cannot silently stop being a stranger when the palette moves.
  let stranger: string | null = null;
  outer: for (let cr = 0; cr <= 255 && !stranger; cr += 51) {
    for (let cg = 0; cg <= 255; cg += 51) {
      for (let cb = 0; cb <= 255; cb += 51) {
        const far = index.every(
          (e) => !e.rgb || Math.hypot(e.rgb[0] - cr, e.rgb[1] - cg, e.rgb[2] - cb) > COLOR_TOLERANCE,
        );
        if (far) {
          stranger = `rgb(${cr}, ${cg}, ${cb})`;
          break outer;
        }
      }
    }
  }
  assert.ok(stranger, "the palette does not cover the whole cube — a stranger must exist");
  const none = matchTokens({ backgroundColor: stranger }, index);
  assert.deepEqual(none, [], "beyond the tolerance the honest answer is nothing, not the closest of forty");
  assert.match(
    describeMatches(none),
    /Nothing there resolves/,
    "and the footer says so rather than the surface doing nothing",
  );

  // A fully transparent sample carries no colour information at all — matching
  // it would make every dark theme resolve to `page`.
  assert.deepEqual(matchTokens({ backgroundColor: "rgba(0, 0, 0, 0)" }, index), []);
});
