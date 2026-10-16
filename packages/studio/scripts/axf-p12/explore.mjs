/**
 * axf-p12/explore.mjs — not evidence. A scratch pass that signs the admin in
 * and prints what is actually on screen, so the state scripts are written
 * against the real DOM rather than against a guess at it.
 */
import { ADMIN, BASE, launch, note, person, signIn, text, whoAmI } from "./driver.mjs";

const browser = await launch();
const ctx = await person(browser);
const page = await ctx.newPage();

page.on("console", (m) => {
  if (m.type() === "error") note(`console.error: ${m.text().slice(0, 200)}`);
});

await page.goto("/login", { waitUntil: "domcontentloaded" });
note(`landed: ${page.url()}`);
console.log("--- LOGIN SCREEN TEXT ---");
console.log((await text(page)).slice(0, 1200));

const me = await signIn(page, ADMIN);
await page.waitForTimeout(2000);
note(`after sign-in the browser is at ${page.url()}`);
console.log("--- LANDING TEXT ---");
console.log((await text(page)).slice(0, 2500));

console.log("--- SESSION ---");
console.log(JSON.stringify(await whoAmI(ctx), null, 1).slice(0, 900));

console.log("--- AREAS ON PAGE ---");
console.log(
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll("[data-axf-area]")].map((e) => e.getAttribute("data-axf-area")),
    ),
  ),
);

console.log("--- ADMIN CARDS ---");
console.log(
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll("[data-axs-admin-card]")].map((e) => ({
        id: e.getAttribute("data-axs-admin-card"),
        o: e.getAttribute("data-axf-dock-orientation"),
        r: e.getBoundingClientRect().toJSON(),
      })),
    ),
    null,
    1,
  ),
);

console.log("--- DOCK PANELS ---");
console.log(
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll("[data-axf-dock]")].map((e) => ({
        id: e.getAttribute("data-axf-dock"),
        mode: e.getAttribute("data-axf-dock-mode"),
        zone: e.getAttribute("data-axf-dock-zone"),
        o: e.getAttribute("data-axf-dock-orientation"),
      })),
    ),
  ),
);

console.log(`--- base ${BASE} ---`);
await browser.close();
