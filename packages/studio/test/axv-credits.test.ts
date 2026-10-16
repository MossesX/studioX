/**
 * @file P18 — the AI credit ledger, the meter, and the honest buy stub.
 *
 * Staged like every other accounts store test: the real store over a throwaway
 * root, `ACCOUNTS_DATA_DIR` re-pointed per test so nothing leaks between them.
 *
 * The claims worth the most, in order — and the first two exist because the
 * failure modes they cover are SILENT, which is the whole reason a currency
 * needs a test at all:
 *
 * 1. **There is no stored balance anywhere.** The ledger file is asserted to
 *    contain `entries` and nothing that looks like a total. A cached number
 *    that a crash could desynchronise from the entries is the one bug where the
 *    system keeps working and is simply wrong, forever, and nobody finds out.
 *    The cache is proven to be a read-path convenience by mutating a ledger
 *    behind its back and watching the append re-fold from disk.
 *
 * 2. **Concurrent spends do not overspend.** Ten simultaneous charges against a
 *    balance of five must leave exactly five spends and a balance of zero. Under
 *    last-writer-wins this test fails by charging ten and reporting zero, which
 *    is free work given away with no error anywhere.
 *
 * 3. **Every refusal carries the number that caused it.** Asserted on the
 *    `balance` field rather than by matching prose, for the reason
 *    `axv-policy.test.ts` states about rows and values: the sentence is for the
 *    member, the fields are for whoever gets asked about it.
 *
 * 4. **The guards go red on purpose.** Metering off is watched to be a no-op AND
 *    metering on is watched to charge; the buy stub is watched to refuse with
 *    both of its two distinct reasons. A guard nobody has seen fail is a guard
 *    nobody has tested.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  creditBalance,
  creditStatement,
  forgetCredits,
  grantCredits,
  invalidateCreditBalance,
  recordPurchase,
  refundCredits,
  spendCredits,
} from "@axs/modules/accounts/lib/credits";
import { creditsFile } from "@axs/modules/accounts/lib/paths";
import type { CreditEntry } from "@axs/modules/accounts/lib/types";

import {
  chargeAssistantTurn,
  chargeMeter,
  completeCheckout,
  creditsEnabled,
  creditsStatus,
  purchaseAvailability,
  refundCharge,
  startCheckout,
} from "@axs/modules/amberxvid/lib/credits";
import {
  ASSISTANT_TURN_METER,
  creditsMeter,
  creditsMeters,
  registerCreditsMeter,
  resetCreditsMeters,
} from "@axs/modules/amberxvid/lib/creditsMeters";
import { setAmberxvidPolicySource } from "@axs/modules/amberxvid/lib/policy";

/* --------------------------------- staging ---------------------------------- */

const roots: string[] = [];

function freshStore(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "axs-credits-"));
  roots.push(root);
  process.env.ACCOUNTS_DATA_DIR = root;
  // The ledger caches its fold in module scope, so a new root MUST drop it or
  // the next test reads the previous one's balance. (This is itself the
  // property test 1 relies on being explicit about.)
  invalidateCreditBalance();
  return root;
}

/** Metering on for the body, and reliably off again afterwards. */
async function metered<T>(fn: () => Promise<T>): Promise<T> {
  process.env.AMBERXVID_CREDITS = "1";
  try {
    return await fn();
  } finally {
    delete process.env.AMBERXVID_CREDITS;
  }
}

after(() => {
  delete process.env.ACCOUNTS_DATA_DIR;
  delete process.env.AMBERXVID_CREDITS;
  delete process.env.AMBERXVID_PAYMENTS_URL;
  setAmberxvidPolicySource(null);
  resetCreditsMeters();
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const readLedgerFile = (user: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(creditsFile(user), "utf8")) as Record<string, unknown>;

/* ============================== the fold ==================================== */

test("a balance is a fold over the entries — nothing stores a total", async () => {
  freshStore();

  assert.equal(await creditBalance("nova"), 0, "a member who has never touched credits holds none");

  await grantCredits("admin", "nova", 100, "welcome");
  await spendCredits("nova", 30, "amberxvid.assistant-turn");
  await refundCredits("nova", 10, "amberxvid.assistant-turn · refund: provider failed");

  assert.equal(await creditBalance("nova"), 80);

  const doc = readLedgerFile("nova");
  assert.deepEqual(Object.keys(doc), ["entries"], "the ledger document holds entries and NOTHING else");
  const entries = doc.entries as CreditEntry[];
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.delta]),
    [
      ["grant", 100],
      ["spend", -30],
      ["refund", 10],
    ],
    "append-only and in order — a refund is a NEW entry, not a deleted spend",
  );
  assert.equal(
    entries.reduce((n, e) => n + e.delta, 0),
    80,
    "the fold over the file IS the balance",
  );

  // Every entry can be traced to somebody. An entry with no actor is an entry
  // nobody can be asked about.
  for (const e of entries) {
    assert.ok(e.actor && e.id && e.at && e.ref, `entry ${e.id} is fully attributed`);
  }
});

test("the cached fold is never what a write is authorised against", async () => {
  freshStore();
  await grantCredits("admin", "nova", 10, "seed");
  assert.equal(await creditBalance("nova"), 10, "cached");

  // Rewrite the ledger behind the cache's back — the shape a restore or a
  // hand-edit takes. The cache still says 10.
  fs.writeFileSync(creditsFile("nova"), JSON.stringify({ entries: [] }), "utf8");

  const spend = await spendCredits("nova", 5, "test");
  assert.equal(spend.ok, false, "the append re-folds from DISK inside the lock, so it refuses");
  assert.equal(spend.ok ? -1 : spend.balance, 0, "and it reports the real balance, not the cached one");
});

test("concurrent spends cannot overspend", async () => {
  freshStore();
  await grantCredits("admin", "nova", 5, "seed");

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => spendCredits("nova", 1, `race-${i}`)),
  );
  const accepted = results.filter((r) => r.ok).length;

  assert.equal(accepted, 5, "exactly five of ten one-credit spends fit in a balance of five");
  assert.equal(await creditBalance("nova"), 0);
  const entries = readLedgerFile("nova").entries as CreditEntry[];
  assert.equal(entries.length, 6, "the grant plus five spends — no charge was lost to a race");
});

/* ============================== the refusals ================================= */

test("a spend refuses below zero, with the balance in the refusal", async () => {
  freshStore();
  await grantCredits("admin", "nova", 3, "seed");

  const spend = await spendCredits("nova", 10, "too-much");
  assert.equal(spend.ok, false);
  assert.equal(spend.ok ? -1 : spend.balance, 3, "the number is a FIELD, not only a sentence");
  assert.match(spend.ok ? "" : spend.error, /10/, "and the sentence says what was asked for");
  assert.equal(await creditBalance("nova"), 3, "a refused spend moves nothing");

  const zero = await spendCredits("nova", 0, "nothing");
  assert.equal(zero.ok, false, "a spend is a POSITIVE number of credits");
  const negative = await spendCredits("nova", -50, "sneaky");
  assert.equal(negative.ok, false, "a negative spend is a refund and must say so");
  assert.equal(await creditBalance("nova"), 3);
});

test("a revoke clamps to the balance rather than going negative", async () => {
  freshStore();
  await grantCredits("admin", "nova", 20, "seed");

  const revoked = await grantCredits("admin", "nova", -100, "clawback");
  assert.equal(revoked.ok, true, "an over-revoke is not refused — an admin would have to do arithmetic");
  assert.equal(revoked.ok ? revoked.balance : -1, 0, "it stops at zero");
  assert.equal(revoked.ok ? revoked.entry.delta : 0, -20, "and the entry records what ACTUALLY moved");

  const again = await grantCredits("admin", "nova", -5, "clawback");
  assert.equal(again.ok, false, "revoking from an empty ledger says so instead of writing a zero entry");
  assert.equal(await creditBalance("nova"), 0);

  // A member who is later granted credits can spend them — no hidden debt.
  await grantCredits("admin", "nova", 7, "second chance");
  const spend = await spendCredits("nova", 7, "works");
  assert.equal(spend.ok, true, "no invisible debt survived the over-revoke");
});

/* =============================== the meter =================================== */

test("with metering off, nothing charges and the status says so", async () => {
  freshStore();
  await grantCredits("admin", "nova", 50, "seed");

  assert.equal(creditsEnabled(), false, "off unless AMBERXVID_CREDITS is set");
  const status = creditsStatus();
  assert.equal(status.enabled, false);
  assert.ok(status.why && status.why.includes("AMBERXVID_CREDITS"), "the absence is a stated fact");
  assert.ok(
    status.meters.some((m) => m.id === ASSISTANT_TURN_METER.id),
    "and the meters are still declared, with their prices",
  );

  const charge = await chargeMeter("nova", ASSISTANT_TURN_METER.id, 1);
  assert.equal(charge.ok && charge.charged, false, "a charge is a no-op");
  assert.equal(await creditBalance("nova"), 50, "the balance is untouched");

  assert.equal(
    await chargeAssistantTurn("amberxvid", "nova"),
    null,
    "and the assistant turn is not charged either",
  );
});

test("with metering on, the meter charges — and prices come from the table", async () => {
  freshStore();
  await grantCredits("admin", "nova", 10, "seed");

  await metered(async () => {
    assert.equal(creditsStatus().enabled, true);

    const one = await chargeMeter("nova", ASSISTANT_TURN_METER.id, 1, "sonnet-5");
    assert.equal(one.ok && one.charged, true);
    assert.equal(one.ok && one.charged ? one.cost : -1, ASSISTANT_TURN_METER.cost);
    assert.equal(one.ok && one.charged ? one.balance : -1, 10 - ASSISTANT_TURN_METER.cost);
    assert.match(
      one.ok && one.charged ? one.ref : "",
      /sonnet-5/,
      "the detail rides on the ref, which is the only field that says why",
    );

    // Units multiply and round UP — a fractional unit is still work that was
    // done, and rounding it down is how a meter quietly becomes free.
    registerCreditsMeter({ id: "test.fractional", title: "Fractional", cost: 2 });
    const half = await chargeMeter("nova", "test.fractional", 0.25);
    assert.equal(half.ok && half.charged ? half.cost : -1, 1, "0.25 × 2 = 0.5, charged as 1");

    // Zero-cost is legal and is NOT the same as unmetered — it is declared.
    registerCreditsMeter({ id: "test.free", title: "Free", cost: 0 });
    const free = await chargeMeter("nova", "test.free", 3);
    assert.equal(free.ok && free.charged, false, "a declared-free meter charges nothing");
    assert.ok(free.ok && !free.charged && free.why.includes("free"), "and says which reason applied");
  });

  resetCreditsMeters();
});

test("an unknown meter is refused, never defaulted", async () => {
  freshStore();
  await grantCredits("admin", "nova", 10, "seed");

  await metered(async () => {
    const charge = await chargeMeter("nova", "nobody.declared-this", 1);
    assert.equal(charge.ok, false);
    assert.equal(charge.ok ? 0 : charge.status, 400);
    assert.match(charge.ok ? "" : charge.error, /nobody\.declared-this/, "and it names the id");
  });
  assert.equal(await creditBalance("nova"), 10, "a typo in a meter id charges nothing");

  assert.equal(creditsMeter("nobody.declared-this"), null);
  assert.throws(
    () => registerCreditsMeter({ id: "bad", title: "Bad", cost: Number.NaN }),
    /cost/,
    "a malformed meter is refused BY NAME rather than becoming a charge of NaN",
  );
  assert.throws(() => registerCreditsMeter({ id: "", title: "x", cost: 1 }), /id/);
});

test("a member out of credits is refused 402, not 403", async () => {
  freshStore();
  await grantCredits("admin", "nova", 1, "seed");

  await metered(async () => {
    const first = await chargeMeter("nova", ASSISTANT_TURN_METER.id, 1);
    assert.equal(first.ok && first.charged, true);

    const second = await chargeMeter("nova", ASSISTANT_TURN_METER.id, 1);
    assert.equal(second.ok, false);
    assert.equal(
      second.ok ? 0 : second.status,
      402,
      "402 is 'cannot afford'; 403 would send them to an administrator about permissions they already have",
    );
    assert.equal(second.ok ? -1 : second.balance, 0);
    assert.match(second.ok ? "" : second.error, /Assistant turn/, "the refusal names the meter");
  });
});

/* ======================== the assistant, the one consumer ==================== */

test("the assistant turn charges for amberxvid and for nothing else", async () => {
  freshStore();
  await grantCredits("admin", "nova", 5, "seed");

  await metered(async () => {
    assert.equal(await chargeAssistantTurn("taskman", "nova"), null, "another module is not this meter's");
    assert.equal(await chargeAssistantTurn(undefined, "nova"), null, "and neither is no module at all");
    assert.equal(
      await chargeAssistantTurn("amberxvid", null),
      null,
      "an anonymous turn has no ledger to charge — reachability is not this file's question",
    );
    assert.equal(await creditBalance("nova"), 5, "none of those moved anything");

    const charged = await chargeAssistantTurn("amberxvid", "nova", "opus-5");
    assert.ok(charged && charged.ok && charged.charged, "the module's own turn IS charged");
    assert.equal(await creditBalance("nova"), 4);

    // The provider failed after the charge — the credit goes back as a new
    // entry, so the history shows both halves.
    await refundCharge("nova", charged!, "the provider did not answer");
    assert.equal(await creditBalance("nova"), 5);
    const kinds = (readLedgerFile("nova").entries as CreditEntry[]).map((e) => e.kind);
    assert.deepEqual(kinds, ["grant", "spend", "refund"], "the charge is corrected, never erased");
  });
});

test("refunding a charge that never happened is a no-op", async () => {
  freshStore();
  await grantCredits("admin", "nova", 5, "seed");
  const nothing = await chargeMeter("nova", ASSISTANT_TURN_METER.id, 1); // metering off
  await refundCharge("nova", nothing, "safe in a finally");
  assert.equal(await creditBalance("nova"), 5);
  assert.equal((readLedgerFile("nova").entries as CreditEntry[]).length, 1);
});

/* ================================ buying ===================================== */

test("with no processor there is nothing to click, and both refusals are distinct", async () => {
  freshStore();
  delete process.env.AMBERXVID_PAYMENTS_URL;

  const none = await purchaseAvailability("nova");
  assert.equal(none.available, false);
  assert.equal(none.available ? "" : none.reason, "no-processor");
  assert.ok(
    !none.available && none.why.includes("AMBERXVID_PAYMENTS_URL"),
    "the sentence names what is missing rather than saying 'unavailable'",
  );

  const start = await startCheckout("nova", 100);
  assert.equal(start.ok, false);
  assert.equal(start.ok ? 0 : start.status, 501, "not implemented, because it genuinely is not");

  const complete = await completeCheckout("nova", 100, "forged");
  assert.equal(complete.ok, false, "and no path credits a ledger without a processor configured");
  assert.equal(await creditBalance("nova"), 0);

  // The OTHER reason: a processor exists, and this member's policy row is off.
  process.env.AMBERXVID_PAYMENTS_URL = "https://pay.example/checkout";
  try {
    setAmberxvidPolicySource(() => ({ canBuyCredits: false }));
    const denied = await purchaseAvailability("nova");
    assert.equal(denied.available, false);
    assert.equal(denied.available ? "" : denied.reason, "not-permitted", "a MEMBER fact, not a deployment one");
    const blocked = await startCheckout("nova", 100);
    assert.equal(blocked.ok ? 0 : blocked.status, 403, "403 here — they are not allowed, not short of money");

    setAmberxvidPolicySource(() => ({ canBuyCredits: true }));
    const ok = await startCheckout("nova", 250);
    assert.equal(ok.ok, true);
    assert.ok(ok.ok && ok.url.includes("ref="), "the hand-off carries the reference");
    assert.ok(ok.ok && ok.url.includes("credits=250"));
    assert.equal(await creditBalance("nova"), 0, "starting a checkout credits NOTHING");

    // Only the return leg credits, and it carries the reference the checkout
    // minted — the first thing anybody asks for when a payment is disputed.
    const done = await completeCheckout("nova", 250, ok.ok ? ok.ref : "");
    assert.equal(done.ok, true);
    assert.equal(await creditBalance("nova"), 250);
    const purchase = (readLedgerFile("nova").entries as CreditEntry[]).at(-1)!;
    assert.equal(purchase.kind, "purchase");
    assert.match(purchase.ref, /^checkout:nova:/);

    const absurd = await startCheckout("nova", 10_000_000);
    assert.equal(absurd.ok, false, "an unbounded number on the one path that touches money is a typo amplifier");
  } finally {
    delete process.env.AMBERXVID_PAYMENTS_URL;
    setAmberxvidPolicySource(null);
  }
});

/* ============================== housekeeping ================================= */

test("a statement is newest-first and says when it is truncated", async () => {
  freshStore();
  await grantCredits("admin", "nova", 100, "seed");
  for (let i = 0; i < 5; i += 1) await spendCredits("nova", 1, `turn-${i}`);

  const full = await creditStatement("nova");
  assert.equal(full.total, 6);
  assert.equal(full.entries.length, 6);
  assert.equal(full.entries[0]!.ref, "turn-4", "newest first — the order the question is asked in");
  assert.equal(full.balance, 95);

  const short = await creditStatement("nova", 2);
  assert.equal(short.entries.length, 2);
  assert.equal(short.total, 6, "a truncated list SAYS the history is longer");
});

test("purchases are positive and a ledger can be deliberately cleared", async () => {
  freshStore();
  assert.equal((await recordPurchase("nova", -5, "refund-shaped")).ok, false);
  await recordPurchase("nova", 25, "checkout:test");
  assert.equal(await creditBalance("nova"), 25);

  assert.equal(await forgetCredits("nova"), true);
  assert.equal(await creditBalance("nova"), 0, "and the cached fold went with it");
  assert.equal(await forgetCredits("nova"), false, "clearing an empty ledger reports nothing removed");
});

test("every declared meter is registered, and the built-in is among them", () => {
  resetCreditsMeters();
  const ids = creditsMeters().map((m) => m.id);
  assert.ok(ids.includes(ASSISTANT_TURN_METER.id), "the module's own meter is chargeable");
  assert.ok(ASSISTANT_TURN_METER.cost > 0, "and it is not accidentally free");
});
