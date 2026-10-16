/**
 * State 1 — THE REAL GATE. An invitation to a LIVE stream room, opened in a
 * private window by somebody with no account, who signs up on the landing and
 * lands in the stream — while the administrator watches an accounts user be
 * born and its matrix grant appear.
 *
 * Three separate browser contexts, three separate cookie jars: the host
 * (jenny), the stranger (nova, no cookies at all), and the administrator.
 */
import { launch, person, signIn, openSuite, shot, text, note, writeRecord } from "./driver.mjs";

/** The newcomer. Overridable so the whole gate can be walked again from
 *  scratch — a username is spent once an account owns it. */
const NEWCOMER = process.env.AXV_P22_NEWCOMER ?? "nova";

const browser = await launch();

/* ------------------------- the host goes live first ------------------------- */

const hostCtx = await person(browser);
const host = await hostCtx.newPage();
await signIn(host, "jenny");
await openSuite(host, "streams");
note(`streams screen: ${(await text(host)).replace(/\s+/g, " ").slice(0, 600)}`);
await host.getByRole("button", { name: /Go live/i }).first().click();
await host.getByLabel("Stream title").fill("Friday build night");
await host.getByRole("button", { name: /^Go live$/ }).last().click();
await host.waitForTimeout(6000);
note(`after Go live: ${(await text(host)).replace(/\s+/g, " ").slice(0, 500)}`);
await shot(host, "01a-host-live");

/* --------------------------- the invitation is made ------------------------- */

// The stream room window is modal over the suite, so close the WINDOW (not the
// stream — `:close` leaves the broadcast running, which is what the toolbar's
// "re-open my room when already hosting" is for) to reach the invite button.
await host.locator('[data-el-id="amberxvid:stream-room:close"]').click();
await host.waitForTimeout(1200);
await host.getByRole("button", { name: /Invite somebody/i }).click();
await host.waitForTimeout(1200);
await shot(host, "01b-invite-dialog");

// "Land them in" → the live stream. This option only exists because the host
// is actually broadcasting; that is the whole point of the state.
const landIn = host.getByLabel("Land them in");
await landIn.click();
await host.waitForTimeout(400);
const options = await host.evaluate(() =>
  [...document.querySelectorAll('[role="option"]')].map((n) => n.textContent?.trim()),
);
note(`land-them-in options: ${options.join(" | ")}`);
const streamOption = host.getByRole("option", { name: /My live stream/ });
if (!(await streamOption.count())) throw new Error("no live-stream destination offered");
await streamOption.click();
await host.waitForTimeout(300);

await host.getByRole("button", { name: /Create the invitation|Create|Compose/i }).first().click();
await host.waitForTimeout(2000);
const dialog = await text(host);
// Read the link off its OWN element rather than out of the body text: the
// token wraps across lines and carries percent-encoded ':' separators, so
// stripping whitespace from the whole dialog glues the next paragraph onto it
// (both mistakes were made here, and the landing honestly reported the dead
// link each time).
const url = await host.evaluate(() => {
  const nodes = [...document.querySelectorAll("p,span,div,code,a")];
  for (const n of nodes) {
    if (n.children.length) continue;
    const t = (n.textContent ?? "").replace(/\s+/g, "");
    if (/^https?:\/\/\S+\/amberxvid\/invite\/\S+$/.test(t)) return t;
  }
  return null;
});
note(`invitation url: ${url ?? "NOT ON SCREEN"}`);
await shot(host, "01c-invitation-created");
if (!url) {
  writeRecord("01-invite-dialog-dump.txt", dialog);
  throw new Error("the invitation link was not on screen");
}

/* ------------------- the stranger: private window, no cookies ---------------- */

const strangerCtx = await person(browser);
const stranger = await strangerCtx.newPage();
await stranger.goto(url, { waitUntil: "domcontentloaded" });
await stranger.waitForTimeout(2500);
note(`landing: ${(await text(stranger)).replace(/\s+/g, " ").slice(0, 600)}`);
await shot(stranger, "01d-landing-signed-out");

await stranger.getByLabel("Username").fill(NEWCOMER);
await stranger.getByLabel("Password", { exact: true }).fill(`P22-${NEWCOMER}-pass`);
await stranger.getByLabel("Password again").fill(`P22-${NEWCOMER}-pass`);
await stranger.getByLabel("Screenname").fill(NEWCOMER[0].toUpperCase() + NEWCOMER.slice(1));
await shot(stranger, "01e-signup-filled");
await stranger.getByRole("button", { name: /Join and go in/i }).click();
await stranger.waitForTimeout(20_000);
note(`after signup: ${(await text(stranger)).replace(/\s+/g, " ").slice(0, 700)}`);
await shot(stranger, "01f-landed-in-stream");

/* --------------------- the administrator sees the account ------------------- */

const adminCtx = await person(browser);
const admin = await adminCtx.newPage();
await signIn(admin, "admin");
await admin.getByRole("tab", { name: /Admin/i }).click();
await admin.waitForTimeout(2000);
await shot(admin, "01g-admin-roster-nova");
const adminText = await text(admin);
note(`roster names ${NEWCOMER}: ${adminText.includes(NEWCOMER)}`);
writeRecord("01-admin-suite.txt", adminText);

// The matrix grant itself — the row the invitation created, in the one place
// an administrator would look for it.
await admin.getByText("Permission matrix").scrollIntoViewIfNeeded();
await admin.waitForTimeout(600);
// The newcomer's own row, not just the table: "<user> · member" appears only
// in the matrix, so it is the row rather than the roster entry above it.
await admin.locator(`text=${NEWCOMER} · member`).last().scrollIntoViewIfNeeded();
await admin.waitForTimeout(600);
await shot(admin, `01h-matrix-grant-${NEWCOMER}`);

await browser.close();
