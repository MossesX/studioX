/**
 * State 1 — ADMIN LANDING.
 *
 * Sign in as an administrator, land on the admin dashboard, drag a card and
 * watch the live draft (the ghost) follow, drop it, reload and find the
 * arrangement still there, then press Reset layout and watch it come back.
 *
 * The orientation flip is captured on the SAME canvas but through the resize
 * grip rather than the move grip, and that is not a shortcut — it is what the
 * engine actually does here. A card's composition is `orientationOfSlot()`,
 * which calls core's `decide()` on the slot's own rectangle
 * (`adminCanvas.ts:119`), so the shape of the slot is the whole input. A MOVE
 * translates a slot and cannot change its shape; a RESIZE changes it, and the
 * flip falls out of `decide()` exactly as it does for a panel dragged into an
 * edge's snap range. The edge-snap spelling of the same engine is state 6.
 */
import {
  ADMIN,
  api,
  closeAssistant,
  drag,
  launch,
  note,
  person,
  shot,
  signIn,
  writeRecord,
} from "./driver.mjs";

const browser = await launch();
const ctx = await person(browser);
const page = await ctx.newPage();
const record = { state: 1, shots: [], facts: {} };

/* ── sign in, and land ────────────────────────────────────────────────────── */

const me = await signIn(page, ADMIN);
await page.waitForTimeout(2500);
record.facts.landedOn = page.url();
record.facts.signedInAs = { username: me.username, role: me.role };
note(`landing after sign-in: ${record.facts.landedOn}`);

await page.waitForSelector('[data-axs-admin-canvas]', { timeout: 45_000 });
await closeAssistant(page);

/**
 * The canvas is a per-administrator kv document, so a previous run of this walk
 * is still in it. Reset FIRST, through the app's own button, so "the shipped
 * arrangement" at the end of this state means the same thing it did at the
 * start — I-27's non-idempotence, not repeated.
 */
await resetLayoutButton(page).click();
await page.waitForTimeout(1200);
record.shots.push(await shot(page, "p12-01a-admin-landing"));

const readCards = () =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-axs-admin-card]")].map((e) => {
        const r = e.getBoundingClientRect();
        return [
          e.getAttribute("data-axs-admin-card"),
          {
            orientation: e.getAttribute("data-axf-dock-orientation"),
            col: getComputedStyle(e).gridColumn,
            row: getComputedStyle(e).gridRow,
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          },
        ];
      }),
    ),
  );

record.facts.cardsAtLanding = await readCards();

/* ── the drag: a card moves, and the draft is painted while the pointer is down ─ */

const gripOf = async (id) => {
  const el = page.locator(`[data-axs-admin-card="${id}"]`);
  const box = await el.boundingBox();
  // The header row is the move grip — 18px down from the card's top edge.
  return { x: box.x + box.width / 2, y: box.y + 14, box };
};

const before = record.facts.cardsAtLanding;
const from = await gripOf("sessions");
// One cell is (canvas width + gap)/columns; measured rather than assumed.
const cell = await page.evaluate(() => {
  const el = document.querySelector("[data-axs-admin-canvas]");
  const w = el.getBoundingClientRect().width;
  return { cellW: (w + 12) / 6, cellH: 132 + 12 };
});
record.facts.cellMetrics = cell;

// sessions (1×2, bottom right of the second band) onto online's slot (1×2, top
// left). Same shape, so the canvas swaps them rather than refusing.
const target = { x: from.x - 5 * cell.cellW, y: from.y - 2 * cell.cellH };

let ghostShot = null;
await drag(page, from, target, {
  steps: 14,
  onMove: async (i) => {
    if (i === 10 && !ghostShot) {
      const live = await page.evaluate(() => {
        const el = document.querySelector('[data-axs-admin-card="sessions"]');
        return {
          dragging: el?.getAttribute("data-dragging"),
          col: getComputedStyle(el).gridColumn,
          row: getComputedStyle(el).gridRow,
          border: getComputedStyle(el).borderColor,
        };
      });
      record.facts.midDrag = live;
      ghostShot = await shot(page, "p12-01b-drag-ghost");
    }
  },
});
record.shots.push(ghostShot);
await page.waitForTimeout(900);
record.facts.cardsAfterDrop = await readCards();
record.shots.push(await shot(page, "p12-01c-dropped"));
note(
  `sessions: ${before.sessions.col}/${before.sessions.row} → ${record.facts.cardsAfterDrop.sessions.col}/${record.facts.cardsAfterDrop.sessions.row}`,
);

/* ── the flip: the same decide(), asked about a slot whose shape changed ───── */

const flipTarget = "health";
const healthBefore = (await readCards())[flipTarget];
const healthEl = page.locator(`[data-axs-admin-card="${flipTarget}"]`);
const hbox = await healthEl.boundingBox();
// The east grip: the 4px strip on the card's right edge.
const eGrip = { x: hbox.x + hbox.width - 2, y: hbox.y + hbox.height / 2 };
let flipShot = null;
await drag(page, eGrip, { x: eGrip.x - cell.cellW, y: eGrip.y }, {
  steps: 10,
  onMove: async (i) => {
    if (i === 9 && !flipShot) {
      record.facts.midFlip = await page.evaluate((id) => {
        const el = document.querySelector(`[data-axs-admin-card="${id}"]`);
        return {
          orientation: el.getAttribute("data-axf-dock-orientation"),
          col: getComputedStyle(el).gridColumn,
          w: Math.round(el.getBoundingClientRect().width),
        };
      }, flipTarget);
      flipShot = await shot(page, "p12-01d-flip-middrag");
    }
  },
});
record.shots.push(flipShot);
await page.waitForTimeout(900);
const healthAfter = (await readCards())[flipTarget];
record.facts.flip = {
  card: flipTarget,
  before: healthBefore,
  after: healthAfter,
  flipped: healthBefore.orientation !== healthAfter.orientation,
};
note(
  `${flipTarget}: ${healthBefore.orientation} (${healthBefore.w}px) → ${healthAfter.orientation} (${healthAfter.w}px)`,
);

/* ── the reload: the arrangement is a kv document, so it survives ──────────── */

const kv = await api(ctx, "/api/axf/kv/admin-dashboard");
record.facts.kvAfterDrag = { status: kv.status, doc: kv.json };

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-axs-admin-canvas]", { timeout: 45_000 });
await closeAssistant(page);
await page.waitForTimeout(1800);
record.facts.cardsAfterReload = await readCards();
record.shots.push(await shot(page, "p12-01e-after-reload"));
record.facts.survivedReload =
  JSON.stringify(record.facts.cardsAfterReload.sessions.col) ===
    JSON.stringify(record.facts.cardsAfterDrop.sessions.col) &&
  record.facts.cardsAfterReload[flipTarget].orientation === healthAfter.orientation;
note(`survived reload: ${record.facts.survivedReload}`);

/* ── reset ────────────────────────────────────────────────────────────────── */

await resetLayoutButton(page).click();
await page.waitForTimeout(1500);
record.facts.cardsAfterReset = await readCards();
record.shots.push(await shot(page, "p12-01f-after-reset"));
record.facts.resetRestoredShippedPlaces =
  JSON.stringify(record.facts.cardsAfterReset) === JSON.stringify(record.facts.cardsAtLanding);
note(`reset restored the shipped arrangement: ${record.facts.resetRestoredShippedPlaces}`);

writeRecord("state01.json", record);
await browser.close();

const ok =
  record.facts.landedOn.includes("surface=admin") &&
  record.facts.flip.flipped &&
  record.facts.survivedReload &&
  record.facts.resetRestoredShippedPlaces;
console.log(ok ? "STATE 1 OK" : "STATE 1 INCOMPLETE — see state01.json");
process.exit(ok ? 0 : 1);
