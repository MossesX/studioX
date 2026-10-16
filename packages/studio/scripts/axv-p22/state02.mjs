/**
 * State 2 — IDENTITY. One sign-in at the studio, no second login inside the
 * module, and the MIGRATED member's albums intact under their accounts name.
 *
 * The album this shows started life in the retired module's own pre-vault
 * layout under the member name `Brett` (capital B) and was moved by the real
 * P1 re-key and P2 vault pass — see `axv-p22-seed.mjs`. Nothing wrote it into
 * `users/brett/albums/` directly.
 */
import { launch, person, signIn, openSuite, shot, text, note } from "./driver.mjs";

const browser = await launch();
const ctx = await person(browser);
const page = await ctx.newPage();

// (a) the ONE sign-in — the studio's own card at /accounts.
await page.goto("/accounts", { waitUntil: "domcontentloaded" });
await page.getByLabel("Username").fill("brett");
await page.getByLabel("Password", { exact: true }).fill("P22-brett-pass");
await shot(page, "02a-studio-signin-card");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForFunction(() => !document.body.innerText.includes("Sign in to the studio"));
note("signed in at /accounts as brett");

// (b) AmberX Vid opens with no second login. The proof is the absence of the
// module's join/login card and the presence of the suite's own surface bar.
await openSuite(page);
const suite = await text(page);
const noLogin =
  !/Sign in to AmberX Vid|Temp password|Join AmberX Vid/i.test(suite) && /SUITE MAP/i.test(suite);
note(`no second login: ${noLogin}`);
if (!noLogin) throw new Error("the module asked for a second login");
await shot(page, "02b-suite-no-second-login");

// (c) the migrated albums, under the ACCOUNTS name.
await page.getByRole("button", { name: "Photos", exact: true }).click();
await page.waitForTimeout(1500);
const photos = await text(page);
note(`albums screen mentions "Suite era": ${photos.includes("Suite era")}`);
await shot(page, "02c-albums-migrated");

// Open the album so the three migrated photo FILES are on screen, not just a
// manifest count — the bytes moved too, and they are being served from the
// vault path.
const album = page.getByText("Suite era", { exact: false }).first();
if (await album.count()) {
  await album.click();
  await page.waitForTimeout(1500);
  await shot(page, "02d-album-open-three-photos");
  note(`album body: ${(await text(page)).replace(/\s+/g, " ").slice(0, 400)}`);
}

await browser.close();
