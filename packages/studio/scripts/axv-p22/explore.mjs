/** axv-p22/explore.mjs — learn the live surfaces before asserting anything. */
import { launch, person, signIn, openSuite, shot, text, note, BASE } from "./driver.mjs";

const browser = await launch();
const ctx = await person(browser);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") note(`console.error ${m.text().slice(0, 160)}`); });

note(`base ${BASE}`);
await signIn(page, "brett");
await shot(page, "explore-accounts");
note(`accounts screen:\n${(await text(page)).slice(0, 900)}`);

await openSuite(page);
await shot(page, "explore-suite");
note(`suite screen:\n${(await text(page)).slice(0, 2500)}`);

const areas = await page.evaluate(() =>
  [...document.querySelectorAll("[data-axf-area]")].map((n) => n.getAttribute("data-axf-area")),
);
note(`areas: ${[...new Set(areas)].join(", ")}`);

const buttons = await page.evaluate(() =>
  [...document.querySelectorAll("button,[role=button],[role=tab]")]
    .map((n) => (n.getAttribute("aria-label") || n.innerText || "").trim().replace(/\s+/g, " "))
    .filter(Boolean),
);
note(`controls: ${[...new Set(buttons)].slice(0, 80).join(" | ")}`);

await browser.close();
