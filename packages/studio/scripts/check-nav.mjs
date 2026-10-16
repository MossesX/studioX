/**
 * `npm run check:nav` — every live route has a nav row, and every nav row has a
 * live route. Both registered `nav-menu` assets, both directions.
 *
 * ## Why this exists
 *
 * Both nav files state the rule in prose: *"a row that navigates nowhere is not
 * a row, and a live route with no row is a surface the rail pretends does not
 * exist."* Prose does not fail a build. Measured on 2026-08-13, with both
 * assets carrying that sentence in their headers:
 *
 *   - `/diff` had been live since P5 restored the difference browser and had NO
 *     row in either menu — reachable only by typing the path;
 *   - `/docs` had a row in `studio-nav` and none in `console-nav`, so switching
 *     the theme's `navMenu` dial silently dropped two destinations.
 *
 * Neither was caught by anything, because nothing was looking. The first half
 * of the rule (dead rows) at least breaks visibly when clicked; the second half
 * fails SILENTLY, and a surface nobody can reach is indistinguishable from a
 * surface that was never built.
 *
 * ## What it compares
 *
 * Live routes are `app/**\/page.tsx`, which is Next's own definition of a page
 * and therefore not a second opinion about what exists. Route groups (`(x)`)
 * contribute no segment, `api/` and `_`-prefixed directories are not pages.
 *
 * Nav rows are read as TEXT rather than imported. The assets are flat data
 * literals, and importing them means loading `@axf/core`'s barrel — React and
 * all — into a check that needs fifteen strings. `check-glyph-ids.mjs` reads
 * the same files the same way for the same reason.
 *
 * ## The self-test at the foot
 *
 * A gate that reports "all clear" is worth exactly as much as the proof that it
 * can report anything else. So the comparison is a pure function, and after the
 * real run it is driven once with a row removed and once with a row invented,
 * and this script FAILS if either mutation still comes back clean. Watching the
 * guard go red on every run is the only thing that stops it decaying into a
 * green light nobody has tested.
 *
 * Zero dependencies, `node:fs` only — framework tooling per INITIATION §0.1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.resolve(here, "..");
const APP = path.join(STUDIO, "app");
const NAV = path.join(STUDIO, "src", "nav");

/** Every `page.tsx` under `app/`, as the route it serves. */
function routes(dir, prefix = "") {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // `api/` serves handlers, not pages; `_x` is Next's private-folder
    // convention; `[x]` is a dynamic segment, which has no single route to
    // compare and is not something a static nav row can name anyway.
    if (e.name === "api" || e.name.startsWith("_") || e.name.startsWith("[")) continue;
    const sub = path.join(dir, e.name);
    // A route GROUP contributes no path segment — `app/(marketing)/about` is
    // `/about`. Missing this reads every grouped page as an orphan.
    const seg = e.name.startsWith("(") ? prefix : `${prefix}/${e.name}`;
    if (fs.existsSync(path.join(sub, "page.tsx"))) out.push(seg || "/");
    out.push(...routes(sub, seg));
  }
  return out;
}

/**
 * Every MODULE's declared route, from `src/modules/<id>/<id>.decl.ts`.
 *
 * The third direction, added 2026-08-13 after the second half of the rule
 * failed AGAIN within a day of being fixed. `/amberxvid` and `/plugins` were
 * live with no row in `console-nav`, and `firecrawl` was a fully built module —
 * decl, screen, engine, store — with no `page.tsx` at all, so it was invisible
 * to BOTH halves above: routes are read from `app/`, and a module nobody routed
 * has no route to be missing from a menu.
 *
 * That is the hole this closes. A module declares where it lives; if nothing
 * serves that path the module is unreachable, and if no menu links it the rail
 * pretends it does not exist. Read as TEXT for the same reason the rows are —
 * a decl is a flat data literal and importing one drags `@axf/core` in.
 *
 * **The match is anchored to the module's own `id:`** (2026-08-15). It used to
 * take the first `route:` anywhere in the file, which is only the module's
 * route while nothing else in the decl declares one. A decl that declares its
 * nav menu as a sibling const above the module — which is what
 * `ModuleDecl.nav` invites, since the decl must reference the value — puts a
 * LINK's route first, and the check then measures the wrong string. AmberX Vid
 * hit it loudly (a `?view=` link reported as the module's route), but the
 * dangerous version is quiet: a nav whose first link happens to be the
 * module's own route passes while the real declaration goes unchecked.
 */
function moduleRoutes() {
  const root = path.join(STUDIO, "src", "modules");
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const decl = path.join(root, d.name, `${d.name}.decl.ts`);
    if (!fs.existsSync(decl)) continue;
    const src = fs.readFileSync(decl, "utf8");
    // Anchor on `id: "<dir>"` — the module's own identity line — and read the
    // first `route:` after it. A nav menu asset's id never equals the module
    // directory (`defineNavMenu` ids are menu names like `amberxvid-nav`), so
    // this lands inside the module literal and nowhere else.
    const anchor = new RegExp(`\\bid:\\s*"${d.name}"`).exec(src);
    const scope = anchor ? src.slice(anchor.index) : src;
    const m = /\broute:\s*"([^"]+)"/.exec(scope);
    if (m) out.push({ id: d.name, route: m[1] });
  }
  return out;
}

/** The `route:` of every link row, in file order. */
function rows(file) {
  const src = fs.readFileSync(file, "utf8");
  // From `items:` only — the header comments name routes too, and a comment
  // that mentions `/diff` is not a row that links to it.
  const items = src.slice(src.indexOf("items: ["));
  return [...items.matchAll(/route:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** The pure half: what disagrees between one menu and the live route set. */
function compare(live, linked) {
  return {
    unreachable: live.filter((r) => !linked.includes(r)),
    dead: linked.filter((r) => !live.includes(r))
  };
}

/**
 * The pure half of the module direction: a declared module whose route no page
 * serves (`unrouted`), and one no menu links (`unlinked`).
 *
 * `linkedEverywhere` is the intersection across menus, not the union — a module
 * linked by one menu and not the other is exactly the drift that loses
 * destinations when the `navMenu` dial is switched, and a union would call it
 * clean.
 */
function compareModules(modules, live, menus) {
  const linkedEverywhere = menus.length
    ? menus.map((m) => m.linked).reduce((a, b) => a.filter((r) => b.includes(r)))
    : [];
  return {
    unrouted: modules.filter((m) => !live.includes(m.route)),
    unlinked: modules.filter((m) => live.includes(m.route) && !linkedEverywhere.includes(m.route))
  };
}

/**
 * Routes that are live on purpose and belong in no menu.
 *
 * `/login` is the studio's gate (`proxy.ts`): it is reached by being redirected
 * there, never by choosing it, and a signed-in person — the only person a nav
 * menu is ever drawn for — has nothing to do on it. Listing it in the rail
 * would advertise a screen that immediately bounces back.
 *
 * `/login-landing` is the `xl001` x_landing asset — a signed-out front door, on
 * the `publicPaths` allow-list for exactly that reason. It clears the same bar
 * `/login` does: the only person a nav menu is drawn for is signed in already,
 * and a sign-in page is precisely what they have no use for. It used to have a
 * `/gallery` child that did NOT clear that bar and was linked in both menus;
 * the route was deleted on 2026-08-16 and the asset browser's live previews
 * supersede it, so there is nothing under this prefix to link any more.
 *
 * The bar for adding to this list is that the route has NO navigable existence
 * for a signed-in user. "Not in the menu yet" is not that; it is the
 * disagreement this checker exists to report.
 */
const UNLISTED_ROUTES = ["/login", "/login-landing"];

const live = routes(APP).filter((r) => !UNLISTED_ROUTES.includes(r));
if (fs.existsSync(path.join(APP, "page.tsx"))) live.push("/");
if (live.length === 0) {
  console.error("check:nav FAILED — no page routes found under app/, so there is nothing to check.");
  console.error("  A checker that finds nothing must refuse rather than answer emptily.");
  process.exit(1);
}

const menus = fs
  .readdirSync(NAV)
  .filter((f) => f.endsWith("-nav.ts"))
  .map((f) => ({ id: f.replace(/\.ts$/, ""), linked: rows(path.join(NAV, f)) }));

if (menus.length === 0) {
  console.error(`check:nav FAILED — no *-nav.ts assets under ${path.relative(STUDIO, NAV)}.`);
  process.exit(1);
}

let bad = 0;
for (const { id, linked } of menus) {
  const { unreachable, dead } = compare(live, linked);
  bad += unreachable.length + dead.length;
  console.log(`check:nav  ${id} — ${linked.length} row(s) over ${live.length} live route(s)`);
  for (const r of unreachable) console.error(`  NO ROW    ${r} is live and this menu does not link it`);
  for (const r of dead) console.error(`  NO ROUTE  ${r} is linked and no page.tsx serves it`);
}

/* ------------------------------------------------- the module direction */

const modules = moduleRoutes();
if (modules.length === 0) {
  console.error("check:nav FAILED — no module decls found, so the module direction cannot answer.");
  process.exit(1);
}
const { unrouted, unlinked } = compareModules(modules, live, menus);
bad += unrouted.length + unlinked.length;
console.log(`check:nav  modules — ${modules.length} declared`);
for (const m of unrouted) {
  console.error(`  NO ROUTE  module "${m.id}" declares ${m.route} and no page.tsx serves it`);
}
for (const m of unlinked) {
  console.error(`  NO ROW    module "${m.id}" (${m.route}) is not linked by every menu`);
}

/* --------------------------------------------------------------- self-test */

const sample = menus[0].linked;
const dropped = compare(live, sample.slice(1));
const invented = compare(live, [...sample, "/definitely-not-a-route"]);
if (dropped.unreachable.length === 0 || invented.dead.length === 0) {
  console.error("check:nav FAILED — the comparison cannot detect a fault, so its OK means nothing.");
  console.error(`  removing a row reported ${dropped.unreachable.length} unreachable route(s);`);
  console.error(`  inventing one reported ${invented.dead.length} dead row(s). Both must be > 0.`);
  process.exit(1);
}

// The module direction gets the same treatment, and for a sharper reason: it
// was added BECAUSE a real module sat unrouted for hours without anything going
// red. A guard that could not have caught the fault it was written for is worse
// than none, so it is driven with an unrouted module and with a routed one no
// menu links, and both mutations must come back dirty.
const ghost = compareModules([{ id: "ghost", route: "/definitely-not-a-route" }], live, menus);
const orphan = compareModules(modules, live, [...menus, { id: "empty", linked: [] }]);
if (ghost.unrouted.length === 0 || orphan.unlinked.length === 0) {
  console.error("check:nav FAILED — the module comparison cannot detect a fault.");
  console.error(`  an unrouted module reported ${ghost.unrouted.length};`);
  console.error(`  a menu linking nothing reported ${orphan.unlinked.length}. Both must be > 0.`);
  process.exit(1);
}

if (bad > 0) {
  console.error(`\ncheck:nav FAILED — ${bad} disagreement(s) between the menus and the routes.`);
  console.error("  A nav asset owns destinations. Add the row, or delete the route.");
  process.exit(1);
}

console.log(`check:nav OK — ${menus.length} menu(s) link all ${live.length} live route(s), none dead`);
