/** Is the app healthy enough to walk? Signs one member in and opens the suite. */
import { launch, person, signIn, openSuite } from "./driver.mjs";
const browser = await launch();
try {
  const ctx = await person(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  await signIn(page, "brett");
  await openSuite(page);
  console.log(errors.length ? `UNHEALTHY: ${errors[0]}` : "HEALTHY");
  process.exitCode = errors.length ? 1 : 0;
} catch (err) {
  console.log(`UNHEALTHY: ${String(err.message).slice(0, 120)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
