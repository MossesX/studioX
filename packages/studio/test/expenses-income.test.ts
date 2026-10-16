/**
 * @file The income/expense flag and payday income, held to their contract
 * (owner, 2026-09-15: *"add an income/expense flag + payday income"*).
 *
 * Everything here is the PURE half — `math.ts` and `payday.ts`. The grid chip,
 * the dialog and the tiles are React over these functions, and every claim
 * they make ("income never lands in a category share", "the balance is net",
 * "filling twice adds nothing") is a claim about these functions.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  buildStatement,
  byCategory,
  effectiveTotal,
  flow,
  net,
  periodOf,
  runningBalance,
  statementMarkdown,
  sumIncome,
  sumSpent,
  variance
} from "../src/modules/expenses/math.ts";
import {
  missingPaydays,
  nextPayday,
  paydayDates,
  paydayEntry,
  paydayId,
  scheduleReady,
  type PaySchedule
} from "../src/modules/expenses/payday.ts";
import { INCOME_CATEGORY, isIncome, type Expense } from "../src/modules/expenses/types.ts";

/* ------------------------------------------------------------------ helpers */

let n = 0;
const entry = (over: Partial<Expense> & { date: string; amount: number }): Expense => {
  const { amount, ...rest } = over;
  n += 1;
  return {
    id: `e${n}`,
    merchant: "Shop",
    category: "groceries",
    currency: "USD",
    items: [{ id: `li${n}`, description: "Item", unit: amount, qty: 1 }],
    tax: 0,
    tip: 0,
    statedTotal: null,
    source: "manual",
    createdAt: n,
    updatedAt: n,
    ...rest
  };
};
const income = (date: string, amount: number, over: Partial<Expense> = {}): Expense =>
  entry({ date, amount, kind: "income", category: INCOME_CATEGORY, merchant: "Employer", ...over });

/* ================================================================ the flag */

describe("the kind flag", () => {
  test("an absent kind is an expense — every pre-existing record reads as spending", () => {
    assert.equal(isIncome(entry({ date: "2026-09-01", amount: 100 })), false);
    assert.equal(isIncome({ kind: "expense" }), false);
    assert.equal(isIncome({ kind: "income" }), true);
  });

  test("effectiveTotal stays a magnitude; flow carries the sign", () => {
    const out = entry({ date: "2026-09-01", amount: 1250 });
    const inn = income("2026-09-01", 100000);
    assert.equal(effectiveTotal(out), 1250);
    assert.equal(effectiveTotal(inn), 100000);
    assert.equal(flow(out), -1250);
    assert.equal(flow(inn), 100000);
  });

  test("a disputed income, like a disputed expense, is zero everywhere", () => {
    const inn = income("2026-09-01", 100000, { disputed: true });
    assert.equal(effectiveTotal(inn), 0);
    assert.equal(flow(inn), 0);
  });

  test("spent, income and net split the ledger and add back up", () => {
    const list = [
      entry({ date: "2026-09-01", amount: 3000 }),
      entry({ date: "2026-09-02", amount: 2000 }),
      income("2026-09-05", 10000)
    ];
    assert.equal(sumSpent(list), 5000);
    assert.equal(sumIncome(list), 10000);
    assert.equal(net(list), 5000);
    assert.equal(net(list), sumIncome(list) - sumSpent(list));
  });
});

/* ============================================================== the balance */

describe("the running balance is net", () => {
  test("a payday adds, an expense subtracts, in date order", () => {
    const rows = runningBalance([
      entry({ date: "2026-09-03", amount: 4000 }),
      income("2026-09-01", 10000),
      entry({ date: "2026-09-02", amount: 2500 })
    ]);
    assert.deepEqual(
      rows.map((r) => [r.expense.date, r.delta, r.balance]),
      [
        ["2026-09-01", 10000, 10000],
        ["2026-09-02", -2500, 7500],
        ["2026-09-03", -4000, 3500]
      ]
    );
  });

  test("a ledger with no income runs negative — a spending subtotal is not a balance", () => {
    const rows = runningBalance([entry({ date: "2026-09-01", amount: 100 }), entry({ date: "2026-09-02", amount: 50 })]);
    assert.equal(rows[rows.length - 1].balance, -150);
  });
});

/* ============================================================ the rollups */

describe("income stays out of the spending rollups", () => {
  const list = [
    entry({ date: "2026-09-01", amount: 6000, category: "groceries" }),
    entry({ date: "2026-09-02", amount: 4000, category: "fuel" }),
    income("2026-09-05", 100000)
  ];

  test("category shares sum over spending only", () => {
    const s = buildStatement(list, periodOf("month", "2026-09-10"));
    assert.deepEqual(
      s.categories.map((c) => [c.key, c.total, c.share]),
      [
        ["groceries", 6000, 60],
        ["fuel", 4000, 40]
      ]
    );
    assert.equal(s.categories.some((c) => c.key === INCOME_CATEGORY), false);
  });

  test("byCategory over a list that still holds income counts it — the caller filters", () => {
    // Pinned so the statement's `spending()` step is visibly load-bearing.
    assert.equal(byCategory(list).some((c) => c.key === INCOME_CATEGORY), true);
  });

  test("variance never offers an Income row", () => {
    const v = variance(list.filter((e) => !isIncome(e)));
    assert.equal(v.some((r) => r.categoryId === INCOME_CATEGORY), false);
  });

  test("the statement carries spent, income and net, and closing = opening + net", () => {
    const earlier = [income("2026-08-05", 100000), entry({ date: "2026-08-20", amount: 30000 })];
    const s = buildStatement([...earlier, ...list], periodOf("month", "2026-09-10"));
    assert.equal(s.opening, 70000);
    assert.equal(s.total, 10000);
    assert.equal(s.income, 100000);
    assert.equal(s.net, 90000);
    assert.equal(s.closing, 160000);
    assert.equal(s.closing, s.opening + s.net);
    // The change line compares SPENDING, so a bigger payday never reads as a spend increase.
    assert.equal(s.previousTotal, 30000);
  });

  test("the markdown lists income with its sign and names the net", () => {
    const md = statementMarkdown(buildStatement(list, periodOf("month", "2026-09-10")));
    assert.match(md, /\| Income \| \$1,000\.00 \|/);
    assert.match(md, /\| \*\*Net\*\* \| \*\*\+\$900\.00\*\* \|/);
    assert.match(md, /Employer \| Income \| income \| \+\$1,000\.00 \|/);
  });
});

/* ============================================================== paydays */

describe("the payday calendar", () => {
  const base: PaySchedule = { amount: 185000, every: "biweekly", anchor: "2026-01-09", payer: "Acme" };

  test("a schedule needs a positive amount and a real first payday", () => {
    assert.equal(scheduleReady(base), true);
    assert.equal(scheduleReady({ ...base, amount: 0 }), false);
    assert.equal(scheduleReady({ ...base, anchor: "" }), false);
    assert.equal(scheduleReady({ ...base, anchor: "2026-02-30" }), false);
    assert.equal(scheduleReady({ ...base, anchor: "09/01/2026" }), false);
  });

  test("weekly and biweekly step by days from the anchor, inclusive of both ends", () => {
    assert.deepEqual(paydayDates({ ...base, every: "weekly" }, "2026-01-30"), [
      "2026-01-09",
      "2026-01-16",
      "2026-01-23",
      "2026-01-30"
    ]);
    assert.deepEqual(paydayDates(base, "2026-02-20"), ["2026-01-09", "2026-01-23", "2026-02-06", "2026-02-20"]);
  });

  test("semimonthly is the 1st and 15th from the anchor onward, anchor included", () => {
    assert.deepEqual(paydayDates({ ...base, every: "semimonthly", anchor: "2026-01-09" }, "2026-03-01"), [
      "2026-01-09",
      "2026-01-15",
      "2026-02-01",
      "2026-02-15",
      "2026-03-01"
    ]);
  });

  test("monthly keeps the anchor's day and clamps to short months", () => {
    assert.deepEqual(paydayDates({ ...base, every: "monthly", anchor: "2026-01-31" }, "2026-05-31"), [
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31"
    ]);
  });

  test("an anchor after `until`, or a schedule that is not ready, yields nothing", () => {
    assert.deepEqual(paydayDates(base, "2025-12-31"), []);
    assert.deepEqual(paydayDates({ ...base, amount: 0 }, "2026-12-31"), []);
  });

  test("the next payday is the first strictly after a date", () => {
    assert.equal(nextPayday(base, "2026-01-09"), "2026-01-23");
    assert.equal(nextPayday(base, "2026-01-22"), "2026-01-23");
    assert.equal(nextPayday(base, "2025-06-01"), "2026-01-09");
    assert.equal(nextPayday({ ...base, every: "monthly", anchor: "2026-01-31" }, "2026-02-01"), "2026-02-28");
    assert.equal(nextPayday({ ...base, amount: 0 }, "2026-01-01"), null);
  });
});

describe("payday entries", () => {
  const s: PaySchedule = { amount: 185000, every: "biweekly", anchor: "2026-01-09", payer: "Acme" };

  test("an entry is income, filed under Income, sourced 'payday', with a date-keyed id", () => {
    const e = paydayEntry(s, "2026-01-23", 5);
    assert.equal(e.id, paydayId("2026-01-23"));
    assert.equal(e.id, "inc_payday_20260123");
    assert.equal(e.kind, "income");
    assert.equal(e.category, INCOME_CATEGORY);
    assert.equal(e.source, "payday");
    assert.equal(e.merchant, "Acme");
    assert.equal(e.date, "2026-01-23");
    assert.equal(effectiveTotal(e), 185000);
    assert.equal(flow(e), 185000);
    assert.equal(e.createdAt, 5);
  });

  test("a blank payer falls back to 'Payday'", () => {
    assert.equal(paydayEntry({ ...s, payer: "  " }, "2026-01-09").merchant, "Payday");
  });

  test("missing paydays are the calendar minus what the ledger already holds, by id", () => {
    const have = [
      paydayEntry(s, "2026-01-09"),
      // Hand-edited amount on a real payday still counts as present.
      { ...paydayEntry(s, "2026-01-23"), statedTotal: 90000 }
    ];
    assert.deepEqual(missingPaydays(have, s, "2026-02-20"), ["2026-02-06", "2026-02-20"]);
  });

  test("filling is idempotent: once every date is present there is nothing to add", () => {
    const all = paydayDates(s, "2026-03-06").map((d) => paydayEntry(s, d));
    assert.deepEqual(missingPaydays(all, s, "2026-03-06"), []);
  });
});
