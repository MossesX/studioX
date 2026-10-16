/**
 * `node scripts/brand-recolour-probe.mjs` — P3's gate for the brand gallery.
 *
 * The requirement it stands for (axf-mui.bmpx P3): *"Rebuild the brand-gallery
 * plugin on MUI. It renders the branding pack, so it is the surface where a
 * wrong icon or colour decision from P2 shows up first — check the pack's
 * entries actually recolour with a theme roll rather than painting shipped
 * hexes."*
 *
 * ## The step says "with a theme roll" and the framework says otherwise
 *
 * MEASURED FIRST, 2026-08-10, before this probe was written — and the answer
 * changed what it checks. `core/src/theme/resolve.ts` states a PRECEDENCE, and
 * it is deliberate:
 *
 *   - **Identity roles** (`accent`, `accent2`, `accent3`, `ok`, `warn`, `err`)
 *     ARE the brand. The branding pack owns them — it is a FIXED app setting
 *     since 2026-08-12 — and a theme roll must NOT move them: the brand does
 *     not roll.
 *   - **Surface-relative roles** (`ink`, `dim`, `edge`, `page`) only mean
 *     anything against the surface a drawing sits on, so they are republished
 *     FROM the theme and a roll MUST move them — that is what keeps a mark
 *     legible on whatever surface was just rolled.
 *
 *  (Style packages — a third tier that once owned everything and made a roll
 *  move NOTHING — were deleted outright on 2026-08-12.)
 *
 * What the probe asks — is the drawing following a published role, or painting
 * a shipped hex? — is answered by moving the roles the way the framework says
 * they move:
 *
 *   1. **A pack swap moves the identity roles, and the drawings follow.** This
 *      is the shipped-hex test: a drawing painting `#ff7a1a` literally is
 *      indistinguishable from a correct one until the role under it changes.
 *   2. **Every registered branding pack is cycled**, and no measured element is
 *      inert across all of them. One that never moves is a shipped hex, named.
 *   3. **A theme roll leaves the identity roles alone and carries the surface
 *      roles with it** — the 2026-08-12 split, both halves, live.
 *   4. The roll is proved to have HAPPENED by watching non-brand dials move, so
 *      check 3 cannot pass by nothing having occurred.
 *
 * The pack swap is driven by CLICKING the gallery's own card, not by calling
 * `packs.activate()` — the claim is "clicking this repaints the app", and
 * reaching into the registry would prove a different one. The theme roll is
 * driven by clicking `/mui-probe`'s roll button, the fixture P1 left behind for
 * exactly this, so no roll affordance has to be added to a surface that should
 * not have one.
 *
 * Zero dependencies: Chrome over raw CDP with Node's global `WebSocket` and
 * `fetch`, exactly as `mui-probe.mjs` and `geometry-probe.mjs` do it. Throwaway
 * profile, no source touched — safe against a shared dev server, which on :3200
 * it must assume it is (`.claude/rules/concurrent-builds.md`: attach, never
 * restart).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The ONLY thing borrowed from the shared helper. This probe's own CDP class
// stays (rewiring a live gate to prove a point about duplication is how a green
// check becomes an unverified one) — but the session token must have exactly one
// spelling, so signing in is not duplicated here.
import { assertSignedIn, signIn } from "./lib/cdp.mjs";

const BASE = process.env.AXF_BASE ?? "http://localhost:3200";
const CHROME = process.env.AXF_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

/* ----------------------------- CDP plumbing ------------------------------- */

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "axf-brand-probe-"));
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--window-size=1600,1000",
      "about:blank"
    ],
    { stdio: "ignore" }
  );
  const portFile = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 30_000;
  while (!fs.existsSync(portFile) || fs.readFileSync(portFile, "utf8").split("\n")[0] === "") {
    if (Date.now() > deadline) throw new Error("Chrome never wrote DevToolsActivePort");
    await new Promise((r) => setTimeout(r, 100));
  }
  return { child, profile, port: Number(fs.readFileSync(portFile, "utf8").split("\n")[0]) };
}

class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();
  #events = [];

  static async connect(url) {
    const cdp = new Cdp();
    cdp.#ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener("open", resolve, { once: true });
      cdp.#ws.addEventListener("error", () => reject(new Error(`cannot connect ${url}`)), {
        once: true
      });
    });
    cdp.#ws.addEventListener("message", (e) => {
      const msg = JSON.parse(typeof e.data === "string" ? e.data : e.data.toString());
      if (msg.id && cdp.#pending.has(msg.id)) {
        const { resolve, reject } = cdp.#pending.get(msg.id);
        cdp.#pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        cdp.#events.push(msg);
      }
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  async waitEvent(method, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.#events.findIndex((e) => e.method === method);
      if (i >= 0) return this.#events.splice(i, 1)[0];
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${method}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  consoleText() {
    return this.#events
      .filter((e) => e.method === "Runtime.consoleAPICalled" || e.method === "Log.entryAdded")
      .flatMap((e) =>
        e.method === "Log.entryAdded"
          ? [e.params.entry.text ?? ""]
          : (e.params.args ?? []).map((a) => String(a.value ?? a.description ?? ""))
      );
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text + " " + (result?.description ?? ""));
    return result.value;
  }

  close() {
    this.#ws.close();
  }
}

async function goto(cdp, route, settleFor = null) {
  await cdp.send("Page.navigate", { url: `${BASE}${route}` });
  await cdp.waitEvent("Page.loadEventFired");
  // A bounce to /login would otherwise be reported as "[data-axf-pack] never
  // appeared on /brand" — the exact sentence that sent a session investigating
  // a gallery that was fine (I-31).
  await assertSignedIn(cdp, route);
  // Hydration, Emotion's client insert, and the packs' own restore pass.
  await new Promise((r) => setTimeout(r, 2200));
  if (!settleFor) return;
  // POLL, do not sleep longer. The gallery's pack cards come from an effect
  // (`setCatalog(packs.packs())`) that commits AFTER hydration, behind a render
  // of ~500 drawings — and a fixed 2.2s wait measured an empty page on this
  // route while a 6s one found six cards. A probe whose result depends on how
  // busy the machine is proves nothing either way.
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (await cdp.eval(`document.querySelectorAll(${JSON.stringify(settleFor)}).length > 0`)) return;
    if (Date.now() > deadline) {
      throw new Error(`"${settleFor}" never appeared on ${route} within 20s`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/* ------------------------------ measurement ------------------------------- */

/**
 * Runs in the page. Reads the published role variables off `:root` and the
 * COMPUTED fill of every painted element inside every `<Glyph>` on screen.
 *
 * COMPUTED, not the `fill` attribute: the attribute says `var(--gxb-accent,
 * #ff7a1a)` whether or not anything publishes that variable, so reading it
 * would go green for a pack whose roles nobody publishes — the exact GizmoX
 * failure this bridge exists to have ended (453 role-coloured SVGs that were
 * capable of recolouring and never did).
 *
 * Keyed by the glyph's ORDINAL, which is only stable while the drawings on the
 * page are. That is fine for the role-override sweep, where the DOM is held
 * still by construction, and is why the sweep is a role override rather than a
 * pack swap: swapping packs replaces the drawings AND the roles at once, so
 * only the ~120 ids common to two identities can be compared at all, and a fill
 * that changed might simply be a different drawing. Measured, not assumed — the
 * first version of this probe did compare across swaps and reported 1065 false
 * shipped hexes, every one of them an index that had shifted under it.
 */
const MEASURE = `(() => {
  const root = getComputedStyle(document.documentElement);
  const vars = {};
  for (const role of ["accent","accent2","accent3","ink","dim","edge","page","ok","warn","err"]) {
    vars["--gxb-" + role] = root.getPropertyValue("--gxb-" + role).trim();
  }
  // Non-brand dials, read to prove a roll HAPPENED. The pack supplies drawings
  // the palette and nothing else, so these follow the theme under any identity.
  const dials = {};
  for (const d of ["--axf-radius","--axf-motion","--axf-sans","--axf-size-body","--axf-elevation"]) {
    dials[d] = root.getPropertyValue(d).trim();
  }

  const fills = {};
  const labels = {};
  const paintServer = {};
  // A pack drawing is injected as the DIRECT child of the <Glyph> wrapper, and
  // carries its own role="img" — so the descendant form matches twice and the
  // wrapper's aria-label is not on the node found. Hence "> svg", and the label
  // read from the wrapper.
  const glyphs = [...document.querySelectorAll('[role="img"] > svg')];
  glyphs.forEach((svg, g) => {
    const label = svg.parentElement.getAttribute("aria-label") || "glyph";
    let taken = 0;
    for (const el of svg.querySelectorAll("path,circle,rect,polygon,ellipse,line")) {
      const cs = getComputedStyle(el);
      const fill = cs.fill;
      const stroke = cs.stroke;
      // An element that paints nothing carries no information, and counting it
      // would dilute "did anything move" into meaninglessness. Most pack
      // drawings open with fill="none" scaffolding, so this SKIPS rather than
      // caps at the first three elements — capping is what made the first run
      // of this probe measure three inert nodes out of several thousand.
      if ((fill === "none" || !fill) && (stroke === "none" || !stroke)) continue;
      const key = "g" + g + "#" + taken;
      fills[key] = fill + " / " + stroke;
      labels[key] = label;
      // A paint-server reference resolves to url("#id") whatever the gradient's
      // stops are, so a role change inside the gradient is INVISIBLE here. Those
      // are counted and reported, never failed on — a check that cannot see a
      // thing must not claim a verdict about it.
      if (fill.startsWith("url(") || stroke.startsWith("url(")) paintServer[key] = true;
      if (++taken >= 3) break;
    }
  });
  return {
    vars,
    dials,
    fills,
    labels,
    paintServer,
    glyphCount: glyphs.length,
    sampleCount: Object.keys(fills).length
  };
})()`;

/**
 * Override every brand role on `:root`, and put them back.
 *
 * This is the shipped-hex instrument, and it is deliberately blunt: the DOM
 * does not change, the drawings do not change, ONE input changes. A drawing
 * painting `var(--gxb-accent, #ff7a1a)` moves; one painting `#ff7a1a` does not.
 * Nothing else can tell those two apart, because they render identically until
 * the role under them moves.
 *
 * `AxfStyleRoot` publishes onto `documentElement.style` too, so setting the same
 * properties inline replaces its values and restoring writes them back — no
 * stylesheet is touched and no reload is needed. The values are absurd on
 * purpose: a probe colour that collided with a real one would read as "did not
 * move".
 */
const OVERRIDE = `(() => {
  const roles = ["accent","accent2","accent3","ink","dim","edge","page","ok","warn","err"];
  const probe = ["#010203","#040506","#070809","#0a0b0c","#0d0e0f",
                 "#101112","#131415","#161718","#191a1b","#1c1d1e"];
  const saved = {};
  roles.forEach((role, i) => {
    for (const prefix of ["--gxb-", "--axf-brand-"]) {
      saved[prefix + role] = document.documentElement.style.getPropertyValue(prefix + role);
      document.documentElement.style.setProperty(prefix + role, probe[i]);
    }
  });
  window.__axfSavedRoles = saved;
  return Object.keys(saved).length;
})()`;

const RESTORE = `(() => {
  const saved = window.__axfSavedRoles || {};
  for (const [name, value] of Object.entries(saved)) {
    if (value) document.documentElement.style.setProperty(name, value);
    else document.documentElement.style.removeProperty(name);
  }
  delete window.__axfSavedRoles;
  return true;
})()`;

/** Every branding pack the gallery is showing, in card order. */
const PACK_IDS = `[...document.querySelectorAll("[data-axf-pack]")].map((c) => c.getAttribute("data-axf-pack"))`;

/** Activate one pack through the gallery's own card. */
const activatePack = (id) => `(() => {
  const card = document.querySelector('[data-axf-pack="${id}"]');
  if (!card) return { ok: false, why: 'no card for ${id}' };
  card.click();
  return { ok: true };
})()`;

const ROLL = `(() => {
  const btn = document.querySelector('[data-probe="probe-button"]');
  if (!btn) return "no roll button on /mui-probe";
  btn.click();
  return "rolled";
})()`;

/* -------------------------------- checks ---------------------------------- */

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

const IDENTITY = ["--gxb-accent", "--gxb-accent2", "--gxb-accent3", "--gxb-ok", "--gxb-warn", "--gxb-err"];
const SURFACE = ["--gxb-ink", "--gxb-dim", "--gxb-edge", "--gxb-page"];

const movedVars = (before, after, names) =>
  names.filter((n) => (before.vars[n] ?? "") !== (after.vars[n] ?? ""));

/** Sample keys present in BOTH measurements whose computed paint changed. */
function movedFills(before, after) {
  const shared = Object.keys(before.fills).filter((k) => k in after.fills);
  return {
    shared,
    moved: shared.filter((k) => before.fills[k] !== after.fills[k])
  };
}

function showVars(label, before, after, names) {
  for (const n of names) {
    const b = before.vars[n] || "—";
    const a = after.vars[n] || "—";
    console.log(`    ${label} ${n.padEnd(15)} ${b.padEnd(9)} ->  ${a}${b !== a ? "   <-- MOVED" : ""}`);
  }
}

async function main() {
  const health = await fetch(BASE).catch(() => null);
  if (!health || !health.ok) {
    console.error(
      `brand-recolour-probe FAILED — no dev server on ${BASE}.\n` +
        `  Start it with: npm --prefix packages/studio run dev\n` +
        `  If it says the port is in use, it is already running and owned by another\n` +
        `  session — attach to it, never restart it (concurrent-builds rule).`
    );
    process.exit(1);
  }

  const { child, profile, port } = await launchChrome();
  let cdp;
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    // Before the first navigation: /brand is gated by proxy.ts (I-31). Without
    // this the probe reads the chromeless /login screen and reports that the
    // brand gallery never rendered `[data-axf-pack]` — which is the sentence
    // that sent a session investigating a surface that was fine.
    await signIn(cdp, BASE);

    await goto(cdp, "/brand", "[data-axf-pack]");
    const base = await cdp.eval(MEASURE);
    if (base.sampleCount === 0) {
      fail(
        `the gallery rendered ${base.glyphCount} glyph(s) and NOT ONE painted element — ` +
          "either /brand is empty or <Glyph> stopped injecting pack markup"
      );
      throw new Error("nothing to measure");
    }
    console.log(
      `  measuring ${base.sampleCount} painted element(s) across ${base.glyphCount} drawing(s)\n`
    );

    /* --------------------------------- 1 + 2: cycle every branding pack */
    const packIds = await cdp.eval(PACK_IDS);
    if (!packIds.length) {
      fail("the gallery rendered no [data-axf-pack] card — nothing to activate");
      throw new Error("no packs on the page");
    }

    let previous = base;
    let livePacks = 0;
    console.log(`  cycling ${packIds.length} branding pack(s) through the gallery's own cards:\n`);

    for (const id of packIds) {
      const clicked = await cdp.eval(activatePack(id));
      if (!clicked.ok) {
        fail(`could not activate "${id}": ${clicked.why}`);
        continue;
      }
      await new Promise((r) => setTimeout(r, 700));
      const now = await cdp.eval(MEASURE);
      const identityMoved = movedVars(previous, now, IDENTITY);
      const surfaceMoved = movedVars(previous, now, SURFACE);
      const { shared, moved } = movedFills(previous, now);
      const rolesMoved = identityMoved.length + surfaceMoved.length;
      // `shared` is only the ids BOTH identities draw — a pack swap replaces
      // the drawing set as well as the palette, so this is a comparison across
      // the overlap and is reported as such rather than as a total.
      console.log(
        `    ${id.padEnd(20)} ${String(rolesMoved).padStart(2)} role(s) moved, ` +
          `${String(moved.length).padStart(4)} of ${shared.length} shared drawing(s) followed` +
          (rolesMoved === 0 ? "   (already in force — nothing to move)" : "")
      );

      if (rolesMoved > 0) {
        livePacks++;
        if (moved.length === 0) {
          fail(
            `activating "${id}" moved ${rolesMoved} role variable(s) on :root and NOT ONE ` +
              "drawing followed. That is the shipped-hex signature: the roles are published " +
              "and the SVGs are not reading them."
          );
        }
      }
      previous = now;
    }
    console.log("");

    // 1 — at least one swap actually changed the identity, and drawings moved
    if (livePacks === 0) {
      fail(
        "no pack activation moved a single role variable — either every registered package " +
          "declares the same palette, or clicking a card does not reach the registry"
      );
    } else {
      pass(
        `${livePacks} of ${packIds.length} pack activation(s) changed the published roles, and ` +
          "the drawings followed every one"
      );
    }

    /* ---------------- 2: the sweep, with the drawings held still ------- */
    const settled = previous;
    // VERIFIED RED BY MUTATION, 2026-08-10: three painted elements were given a
    // literal `fill="#ff7a1a"` here before the override, and this check failed
    // naming all three ("Lockup · Horizontal [g0#0..2] rgb(255, 122, 26)"). The
    // mutation was then removed. A guard nobody has watched fail is a guard
    // nobody has tested — and this one guards a property that is invisible on
    // screen until the day someone rolls a theme and half the marks stay put.
    const overridden = await cdp.eval(OVERRIDE);
    await new Promise((r) => setTimeout(r, 400));
    const swept = await cdp.eval(MEASURE);
    await cdp.eval(RESTORE);

    const tracked = Object.keys(settled.fills).filter((k) => k in swept.fills);
    const viaPaintServer = tracked.filter((k) => settled.paintServer[k]);
    const observable = tracked.filter((k) => !settled.paintServer[k]);
    const inert = observable.filter((k) => settled.fills[k] === swept.fills[k]);
    console.log(
      `  role override: ${overridden} custom propert(ies) replaced on :root, ` +
        `${observable.length} directly observable element(s) ` +
        `(${viaPaintServer.length} paint through a gradient and cannot be read this way)\n`
    );

    if (inert.length) {
      fail(
        `${inert.length} of ${observable.length} painted element(s) did not move when EVERY ` +
          "brand role was overridden on :root. The drawings did not change and the DOM did not " +
          "change, so each of these is painting a literal colour:\n        " +
          inert
            .slice(0, 12)
            .map((k) => `${settled.labels[k]} [${k}]  ${settled.fills[k]}`)
            .join("\n        ") +
          (inert.length > 12 ? `\n        …and ${inert.length - 12} more` : "")
      );
    } else {
      pass(
        `all ${observable.length} directly observable element(s) followed a role override — ` +
          "every drawing on this surface paints through a published role, none through a " +
          "shipped hex"
      );
    }

    /* ------------------------- 3 + 4: the precedence a roll must respect */
    const beforeRoll = await cdp.eval(MEASURE);
    await goto(cdp, "/mui-probe", '[data-probe="probe-button"]');
    const rolled = await cdp.eval(ROLL);
    if (rolled !== "rolled") fail(`could not roll the theme: ${rolled}`);
    await new Promise((r) => setTimeout(r, 900));
    await goto(cdp, "/brand", "[data-axf-pack]");
    const afterRoll = await cdp.eval(MEASURE);

    const dialsMoved = Object.keys(beforeRoll.dials).filter(
      (d) => beforeRoll.dials[d] !== afterRoll.dials[d]
    );
    const rollIdentity = movedVars(beforeRoll, afterRoll, IDENTITY);
    const rollSurface = movedVars(beforeRoll, afterRoll, SURFACE);
    console.log("  brand roles, before -> after a THEME ROLL (the pack is a fixed setting):");
    showVars("roll", beforeRoll, afterRoll, [...IDENTITY, ...SURFACE]);
    console.log(`\n    non-brand dials that moved: ${dialsMoved.join(", ") || "(none)"}\n`);

    // 4 first: check 3 must not be able to pass by nothing having happened.
    if (dialsMoved.length === 0) {
      fail(
        "the roll moved no non-brand dial either, so it did not happen — check 3 below cannot " +
          "be trusted. Is /mui-probe's roll button still wired?"
      );
    } else {
      pass(`the roll landed — ${dialsMoved.length} non-brand dial(s) moved`);
    }

    // 3 — the 2026-08-12 split, both halves. The pack's IDENTITY roles are the
    // brand's own fixed colours and a roll must not touch them; the SURFACE
    // roles are republished FROM the theme so the drawings stay legible on
    // whatever surface was just rolled, which means a roll MUST move them
    // (page/ink/edge always move on a real roll; dim is clamped and can
    // coincide, so the assertion is "any moved", not "all moved").
    if (rollIdentity.length) {
      fail(
        `the roll moved ${rollIdentity.join(", ")} — the pack's own brand colours followed the ` +
          "theme. Branding is a FIXED app setting: a roll restyles the app, never the brand."
      );
    } else {
      pass("the roll left every identity role to the branding pack — the brand does not roll");
    }
    if (rollSurface.length === 0) {
      fail(
        "the roll moved page/ink/edge on the theme and NOT ONE --gxb surface role followed — " +
          "drawings are sitting on a surface they were not republished against, which is how a " +
          "dark-pack mark goes illegible on a light roll."
      );
    } else {
      pass(
        `${rollSurface.length} surface role(s) followed the roll — drawings sit on the theme's ` +
          "actual surface"
      );
    }

    // A rebuilt surface must not have cost a hydration warning, for the same
    // reason mui-probe checks it: the layout's four incident fixes are load
    // bearing and their loss is silent.
    const hydration = cdp
      .consoleText()
      .filter((t) => /hydrat|did not match|server rendered HTML/i.test(t));
    if (hydration.length) {
      fail(
        `React reported ${hydration.length} hydration problem(s):\n        ${hydration.join("\n        ")}`
      );
    } else {
      pass("no hydration warning across the four navigations");
    }
  } finally {
    cdp?.close();
    child.kill();
    // Best effort, and deliberately unable to fail the run — see mui-probe.mjs.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  if (failures.length) {
    console.error(`\nbrand-recolour-probe FAILED — ${failures.length} check(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    "\nbrand-recolour-probe OK — the gallery's drawings follow the published roles on both " +
      "channels, and the pack still owns its identity across a roll"
  );
}

await main();
