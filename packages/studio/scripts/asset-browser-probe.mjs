/**
 * `npm run check:asset-browser` — the Asset Browser, walked in a real browser.
 *
 * Every other gate this module passes is static. `tsc` proves it compiles,
 * `check:nav` proves the row exists, `suite --check` proves the slot is
 * claimed, `ctx-conformance` proves the areas are marked and the commands are
 * registered — and all of them would stay green on a screen that mounts and
 * renders nothing. "The typecheck passes" is not proof that a feature works,
 * so this drives the actual page and reads the actual DOM.
 *
 * What it asserts, in the order a person would look:
 *
 *   1. `/asset-browser` renders THIS module (not the login screen, not a crash
 *      boundary) — signed in through the shared probe session, because
 *      `proxy.ts` gates every route and a probe without a cookie measures
 *      `/login` and blames the surface (I-31).
 *   2. The three regions are on screen, and each is a `data-axf-area` the decl
 *      declares — the marker and the menu are one thing.
 *   3. The rail lists the three LIFECYCLE groups and the seven kinds.
 *   4. The grid holds one card per asset the catalog found, and those cards
 *      name the ids the API reports — the client and server halves agree.
 *   5. Every card is DRAWN by the kind's real renderer — `LogoKitLogo`'s svg,
 *      core `Toolbar`'s own `data-axf-toolbar`, core `NavMenuSurface`'s
 *      `data-axf-nav` — or carries a stated reason instead, and the chrome
 *      previews drew the asset they NAME rather than the surface's active one.
 *   6. Clicking a card fills the detail pane with THAT asset.
 *   7. Filtering to a kind narrows the grid, and clearing it restores.
 *   8. `/login-landing/gallery`, which this screen supersedes, is a 404 with no
 *      nav row left pointing at it.
 *   9. No console error, and no crash-boundary text anywhere.
 *
 * ## It has been watched going red
 *
 * Not by a planted mutation — by two real measurement faults on its first run
 * against a working screen, which is the more useful evidence: it reported the
 * detail-pane heading missing (the heading is CSS-uppercased, so `innerText`
 * returns it uppercased and a case-sensitive `includes` misses it) and the
 * filter failing to restore (an unscoped card count includes the detail pane's
 * own marker). Both were the PROBE's fault and both are fixed here with the
 * reason written beside them. A gate that has never disagreed with anything is
 * a gate nobody has tested.
 *
 * Zero dependencies: the shared CDP driver, a throwaway Chrome profile.
 */
import { Cdp, assertSignedIn, cleanup, launchChrome, signIn } from "./lib/cdp.mjs";

const BASE = process.env.AXF_BASE ?? "http://localhost:3200";
const ROUTE = "/asset-browser";

const failures = [];
const notes = [];

function check(ok, label, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    console.log(`  RED ${label}`);
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Poll until `expr` is truthy, so an assertion never races the first paint. */
async function until(cdp, expr, ms = 15_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await cdp.eval(expr)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function goto(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await cdp.waitEvent("Page.loadEventFired");
}

/**
 * Cards, scoped to the GRID pane.
 *
 * The detail pane marks `asset-browser.asset` too, and correctly so — a
 * right-click in there is a right-click on that asset, and the menu rows must
 * resolve. But it means an unscoped count is one too high the moment anything
 * is selected, which is what the first run of this probe measured and reported
 * as the screen losing a card. `PaneLayout` marks every leaf with
 * `data-axf-pane`, so the scope is already there to be used.
 */
const GRID = `[data-axf-pane="grid"] [data-axf-area="asset-browser.asset"]`;
const DETAIL = `[data-axf-pane="detail"]`;
const RAIL = `[data-axf-pane="kinds"]`;

const { child, profile, port } = await launchChrome();
let cdp;
try {
  cdp = await Cdp.attach(port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");

  const who = await signIn(cdp, BASE);
  console.log(`check:asset-browser — ${BASE}${ROUTE} as ${who.username} (${who.role})\n`);

  /* ---- the server half, first, so a disagreement below has a reference ---- */

  const api = await (await fetch(`${BASE}/api/asset-browser`)).json();
  check(Array.isArray(api.assets), "GET /api/asset-browser answers with an asset list");
  const diskIds = (api.assets ?? []).map((a) => a.id);
  console.log(`      the route reports ${diskIds.length} on-disk asset(s): ${diskIds.join(", ") || "none"}`);

  /* ---------------------------------------------------------- the screen -- */

  await goto(cdp, `${BASE}${ROUTE}`);
  await assertSignedIn(cdp, ROUTE);

  const mounted = await until(cdp, `!!document.querySelector('[data-axf-area="asset-browser.surface"]')`);
  check(mounted, "the module mounts — its surface area is in the DOM");
  if (!mounted) throw new Error("nothing to measure: the screen never rendered");

  // A crash boundary renders instead of the screen and would otherwise let
  // every count below read as "zero assets" rather than as "it fell over".
  const crashed = await cdp.eval(
    `/something went wrong|crashed|Boundary/i.test(document.body.innerText) &&
     !document.querySelector('${GRID}')`
  );
  check(!crashed, "no crash boundary stood in for the screen");

  /* ------------------------------------------------------------ regions -- */

  const rail = await cdp.eval(
    `document.querySelectorAll('${RAIL} [data-axf-area="asset-browser.kind"]').length`
  );
  check(rail >= 7, `the rail lists every kind (${rail} rows)`, `expected 7, saw ${rail}`);

  const groups = await cdp.eval(
    `[...document.querySelectorAll('li')].map(e=>e.textContent.trim())
       .filter(t=>['Generated assets','Code packs','Chrome'].includes(t)).length`
  );
  check(groups === 3, `the rail groups by lifecycle (${groups} of 3 headings)`);

  await until(cdp, `document.querySelectorAll('${GRID}').length > 0`);
  const cards = await cdp.eval(`document.querySelectorAll('${GRID}').length`);
  check(cards > 0, `the grid drew ${cards} card(s)`);

  // The client composes packs and chrome from the live registries, so the grid
  // must hold MORE than the disk half — and every disk id must be among them.
  const onScreen = await cdp.eval(
    `JSON.stringify([...document.querySelectorAll('${GRID}')].map(e=>e.getAttribute('data-axf-asset')))`
  );
  const keys = JSON.parse(onScreen);
  const missing = diskIds.filter((id) => !keys.some((k) => k.endsWith(`:${id}`)));
  check(missing.length === 0, "every asset the route reported has a card", `missing ${missing.join(", ")}`);
  check(
    cards > diskIds.length,
    `the in-memory kinds are on screen too (${cards} cards over ${diskIds.length} on disk)`,
    "packs and chrome assets never reached the grid"
  );

  /* ----------------------------------------------------- the live previews */

  /*
   * The claim P5 makes is not "a preview element exists" — it is that each kind
   * is drawn BY ITS REAL RENDERER. So every assertion here looks for something
   * only the real renderer emits: `LogoKitLogo`'s `<svg>` inside the tile, core
   * `Toolbar`'s own `data-axf-toolbar={asset.id}`, core `NavMenuSurface`'s
   * `data-axf-nav={asset.id}`. A hand-drawn approximation would satisfy none of
   * them, which is the point — a preview that merely LOOKS right is exactly
   * what a second renderer looks like until the day it drifts.
   */

  const previewless = await cdp.eval(
    `[...document.querySelectorAll('${GRID}')]
       .filter(c => !c.querySelector('[data-axf-preview]'))
       .map(c => c.getAttribute('data-axf-asset')).length`
  );
  check(previewless === 0, "every card carries a preview or a stated reason", `${previewless} card(s) had neither`);

  // `[data-axf-preview]` with no value is a live frame; ="metadata" is the
  // honest card. Both are legitimate; a card with a frame and nothing drawn in
  // it is not, and that is what the SVG counts below rule out.
  const drawn = await cdp.eval(
    `JSON.stringify({
       frames: document.querySelectorAll('${GRID} [data-axf-preview=""]').length,
       stated: document.querySelectorAll('${GRID} [data-axf-preview="metadata"]').length,
       logos:  document.querySelectorAll('${GRID} [data-axf-preview-logo] svg').length,
       glyphs: document.querySelectorAll('${GRID} [data-axf-preview-glyph] svg').length,
       bars:   document.querySelectorAll('${GRID} [data-axf-toolbar]').length,
       navs:   document.querySelectorAll('${GRID} [data-axf-nav]').length
     })`
  );
  const d = JSON.parse(drawn);
  console.log(
    `      previews — ${d.frames} live frame(s), ${d.stated} stated reason(s), ` +
      `${d.logos} logo svg, ${d.glyphs} glyph svg, ${d.bars} bar(s), ${d.navs} menu(s)`
  );

  check(d.logos > 0, `logo kits drew through LogoKitLogo (${d.logos} logo svg in the grid)`);
  check(d.glyphs > 0, `packs drew their variants through Glyph (${d.glyphs} drawing svg)`);
  check(d.bars > 0, `toolbars drew through core's own Toolbar (${d.bars} bar(s))`);
  check(d.navs > 0, `nav menus drew through core's NavMenuSurface (${d.navs} menu(s))`);

  // A bar or a menu previewed by ID must be THAT asset, not the surface's
  // active one — the whole point of the `asset` prop. Core resolves an unknown
  // id by falling through to the live asset, so a wrong id would look fine and
  // draw the wrong thing; this is the assertion that would catch it.
  const identity = await cdp.eval(
    `(()=>{
       const wrong = [];
       for (const c of document.querySelectorAll('${GRID}')) {
         const key = c.getAttribute('data-axf-asset') || '';
         const id = key.slice(key.indexOf(':') + 1);
         const kind = c.getAttribute('data-axf-kind');
         const el = kind === 'toolbar' ? c.querySelector('[data-axf-toolbar]')
                  : kind === 'nav-menu' ? c.querySelector('[data-axf-nav]')
                  : null;
         if (!el) continue;
         const drew = el.getAttribute(kind === 'toolbar' ? 'data-axf-toolbar' : 'data-axf-nav');
         if (drew !== id) wrong.push(id + ' drew ' + drew);
       }
       return JSON.stringify(wrong);
     })()`
  );
  const wrongAsset = JSON.parse(identity);
  check(
    wrongAsset.length === 0,
    "each chrome card drew the asset it names, not the surface's active one",
    wrongAsset.join(" | ")
  );

  // A preview mounts foreign code inside a Boundary. The chip is the correct
  // behaviour when something throws — and it is still a failure of this gate,
  // because it means a renderer went down.
  const crashChips = await cdp.eval(`document.querySelectorAll('[data-axf-crash]').length`);
  check(crashChips === 0, "no preview fell into its crash boundary", `${crashChips} chip(s)`);

  /* ------------------------------------------------------- the detail pane */

  const before = await cdp.eval(`document.body.innerText.includes('Pick an asset')`);
  check(before, "the detail pane says what to do before anything is picked");

  await cdp.eval(`document.querySelector('${GRID} button, ${GRID} [role="button"]').click()`);
  const filled = await until(cdp, `!document.body.innerText.includes('Pick an asset')`);
  check(filled, "clicking a card fills the detail pane");

  const tuple = await cdp.eval(
    `(()=>{const t=document.querySelector('${DETAIL}').innerText;
       return /how it is authored/i.test(t) &&
         ['Source','Generator','Renderer','Chokepoint','Schema'].every(k=>t.includes(k));})()`
  );
  check(tuple, "the pane shows the four-part tuple — the point of the screen");

  const picked = await cdp.eval(`document.querySelector('${GRID}').getAttribute('data-axf-asset')`);
  const paneId = picked ? picked.slice(picked.indexOf(":") + 1) : "";
  const paneShowsIt = await cdp.eval(
    `document.querySelector('${DETAIL}').innerText.includes(${JSON.stringify(paneId)})`
  );
  check(paneShowsIt, `the pane is showing the card that was clicked (${paneId})`);

  /* ------------------------------------------------------------ filtering */

  await cdp.eval(
    `document.querySelector('${RAIL} [data-axf-area="asset-browser.kind"][data-axf-kind="logo_kit"]').click()`
  );
  const narrowed = await until(
    cdp,
    `(()=>{const c=[...document.querySelectorAll('${GRID}')];
       return c.length>0 && c.every(e=>e.getAttribute('data-axf-kind')==='logo_kit');})()`
  );
  const kitCount = await cdp.eval(`document.querySelectorAll('${GRID}').length`);
  check(narrowed && kitCount > 0, `filtering to a kind narrows the grid (${kitCount} logo kit(s))`);

  // The row's textContent is "Every kind" plus its count chip, so this matches
  // the PREFIX. An exact match found nothing and read as a broken filter.
  await cdp.eval(
    `[...document.querySelectorAll('${RAIL} [role="button"]')]
       .find(e=>e.textContent.trim().startsWith('Every kind'))?.click()`
  );
  const restored = await until(cdp, `document.querySelectorAll('${GRID}').length === ${cards}`);
  check(restored, `clearing the filter restores all ${cards} cards`);

  /* --------------------------------------------- the superseded gallery -- */

  /*
   * `/login-landing/gallery` drew every logo of every kit through
   * `LogoKitLogo` and called itself "the stopgap until the graphical asset
   * browser ships". It has shipped, above, so the gallery is retired here —
   * and the retirement is asserted rather than assumed, because a deleted
   * route that Next is still serving from a warm cache is exactly the kind of
   * thing a session declares done and nobody checks.
   *
   * The route is PUBLIC (`/login-landing/*` is a prefix on the allow-list), so
   * a 404 here is the route being gone and not the gate turning it away.
   */
  const gallery = await fetch(`${BASE}/login-landing/gallery`, { redirect: "manual" });
  check(
    gallery.status === 404,
    `the superseded /login-landing/gallery is gone (HTTP ${gallery.status})`,
    "the route still answers — this screen and it can now disagree about what a kit holds"
  );

  const galleryRows = await cdp.eval(
    `document.querySelectorAll('a[href*="login-landing/gallery"], [data-axf-nav] [title="Logo kits"]').length`
  );
  check(galleryRows === 0, "no nav row still points at the gallery", `${galleryRows} row(s) remain`);

  /* -------------------------------------------------------------- console */

  const errors = cdp
    .consoleText()
    .filter((t) => /error|warning: |cannot|undefined is not/i.test(t))
    // Next's dev overlay and React's own dev notices are not this screen's.
    .filter((t) => !/DevTools|Download the React|Fast Refresh|hydrat/i.test(t));
  check(errors.length === 0, "the console is clean", errors.slice(0, 3).join(" | "));
} catch (e) {
  failures.push(`the walk could not finish: ${e.message}`);
} finally {
  cdp?.close();
  await cleanup(child, profile);
}

for (const n of notes) console.log(`      ${n}`);
if (failures.length > 0) {
  console.error(`\ncheck:asset-browser FAILED — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log("\ncheck:asset-browser — all green, walked live");
