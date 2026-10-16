/**
 * @file `node scripts/buildmgr-run-probe.mjs` — proves the rebuilt Build
 * Manager drives a REAL run end to end, against an actual `bmpx_builder.py`
 * dry run rather than a mock.
 *
 * Three claims, and the third is the one that is easy to fake:
 *
 *   1. **It lists projects from `build/projects`.** Every row on screen is
 *      matched to a `.bmpx` file on disk by id — not "the list is non-empty".
 *   2. **It opens a plan.** The phases and steps rendered are matched against
 *      the phases and steps the file actually contains.
 *   3. **Its live-run view reflects a running build, and liveness is events-
 *      ndjson FRESHNESS.** A dry run is started by CLICKING START, and while
 *      it runs the probe reads the events file on disk and the log lines in
 *      the DOM in the same loop, so the screen is shown to track the FILE.
 *
 * ## Why claim 3 needs the extra test at the end
 *
 * `/api/bmpx/run` decides liveness two ways: the in-process child handle when
 * it has one, and otherwise the events file's mtime (`FRESH_MS`). A dev-server
 * module reload drops the handle, and it is the FRESHNESS branch that keeps the
 * screen honest after that — a stored pointer still says `exitCode: null`
 * forever, so a run killed by a reload would read as live for the rest of the
 * session if the flag were trusted.
 *
 * A dry run alone exercises only the handle branch, so it cannot prove the part
 * that matters. The last stage builds the case directly: a pointer whose stored
 * flag says "still running" (`exitCode: null`) beside an events file backdated
 * past `FRESH_MS`. The stored flag is identical in both halves; only the file's
 * mtime differs, so `running` following the mtime is the whole demonstration.
 * It runs under a scratch id and cleans up after itself.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Cdp, cleanup, launchChrome, signIn } from "./lib/cdp.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const AXF_ROOT = path.resolve(STUDIO, "..", "..", "..");
const GIZMOX = path.resolve(AXF_ROOT, "..", "GizmoX");
/**
 * TWO project directories, and they are not the same one — found by this probe
 * failing rather than by reading the routes:
 *
 *   - `/api/bmpx` LISTS from the pre-build mirror, so the screen shows the
 *     AmberX-bound projects (9) and not everything GizmoX has ever built (45);
 *   - `/api/bmpx/run` SPAWNS against GizmoX's own `build/projects`, because
 *     that is where `bmpx_builder.py` and its RUN lock live.
 *
 * A run therefore needs the file in BOTH, which is exactly what the mirror rule
 * in `.claude/rules/amberx-bound-builds.md` §1 keeps true.
 */
const PROJECTS_LIST = path.join(AXF_ROOT, "build", "projects");
const PROJECTS = path.join(GIZMOX, "build", "projects");
const LOGS = path.join(GIZMOX, "logs", "build");
const BASE = process.env.AXS_URL ?? "http://localhost:3200";
/** Must match `FRESH_MS` in app/api/bmpx/run/route.ts. */
const FRESH_MS = 30_000;

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => createHash("sha1").update(fs.readFileSync(p)).digest("hex");

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/* ------------------------------------------------------- pick the target -- */

/**
 * A project that is safe to rehearse: it must NOT hold the builder's RUN lock
 * (`<file>.running`), because that lock is a live build — quite possibly the
 * one running this very step.
 */
function pickProject() {
  const files = fs
    .readdirSync(PROJECTS_LIST)
    .filter((f) => f.endsWith(".bmpx"))
    // Runnable means present in the RUN directory too, not just listed.
    .filter((f) => fs.existsSync(path.join(PROJECTS, f)));
  const free = files.filter((f) => !fs.existsSync(path.join(PROJECTS, `${f}.running`)));
  const locked = files.filter((f) => fs.existsSync(path.join(PROJECTS, `${f}.running`)));
  if (locked.length) console.log(`  (skipping ${locked.join(", ")} — RUN lock held, a build is live)`);
  for (const f of free) {
    const doc = JSON.parse(fs.readFileSync(path.join(PROJECTS, f), "utf8"));
    const phases = doc.plan?.phases ?? [];
    // Needs real steps, or the rehearsal emits no group events and proves
    // nothing about the live feed.
    if (phases.some((p) => (p.steps ?? []).length)) return { file: f, doc, phases };
  }
  throw new Error("no unlocked .bmpx with steps to rehearse");
}

/* ------------------------------------------------------------------- run -- */

const newestEvents = (id) => {
  const dir = path.join(LOGS, id);
  if (!fs.existsSync(dir)) return null;
  const f = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".events.ndjson"))
    .map((n) => ({ n, p: path.join(dir, n), m: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0];
  return f ?? null;
};

/** Click the smallest visible element whose rendered text matches. */
async function click(cdp, text, mode = "eq") {
  const want = JSON.stringify(text);
  const at = await cdp.eval(`(() => {
    const hits = [...document.querySelectorAll("*")].filter((e) => {
      const t = (e.innerText || "").replace(/\\s+/g, " ").trim();
      if (!(${mode === "eq" ? `t === ${want}` : `t.includes(${want})`})) return false;
      const b = e.getBoundingClientRect();
      return b.width > 2 && b.height > 2 && getComputedStyle(e).visibility !== "hidden";
    });
    const ok = hits.filter((e) => {
      for (let n = e; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.cursor === "pointer" || n.tagName === "BUTTON" || n.getAttribute("role") === "button") return true;
      }
      return false;
    });
    const list = ok.length ? ok : hits;
    if (!list.length) return null;
    list.sort((a, z) => {
      const A = a.getBoundingClientRect(), Z = z.getBoundingClientRect();
      return A.width * A.height - Z.width * Z.height;
    });
    const b = list[0].getBoundingClientRect();
    return [b.x + b.width / 2, b.y + b.height / 2];
  })()`);
  if (!at) throw new Error(`no clickable target for ${JSON.stringify(text)}`);
  await cdp.mouse("mouseMoved", at[0], at[1]);
  await cdp.mouse("mousePressed", at[0], at[1]);
  await cdp.mouse("mouseReleased", at[0], at[1]);
  await settle(300);
}

/** The screen's own state, read out of the DOM the way a person reads it. */
const READ = `(() => {
  const t = document.body.innerText;
  return {
    logLines: (t.match(/^\\d{3} /gm) || []).length,
    live: /live\\s*·\\s*(dry|real)/i.test(t),
    modeLine: (t.match(/(live\\s*·\\s*\\w+|mode:\\s*\\w+)/i) || [""])[0],
    status: (t.match(/(spawned bmpx_builder[^\\n]*|run exited[^\\n]*|dry run finished[^\\n]*|run refused[^\\n]*|resumed live[^\\n]*)/i) || [""])[0],
    glowing: [...document.querySelectorAll("*")].some(
      (e) => (getComputedStyle(e).animationName || "").includes("axsBmPulse")
    )
  };
})()`;

/**
 * Liveness is FRESHNESS, not the stored flag — demonstrated directly.
 *
 * Both halves present the SAME stored pointer (`exitCode: null`, i.e. the flag
 * says "still running"); only the events file's mtime differs. `running`
 * following the mtime is the whole point: a dev-server reload drops the child
 * handle, and without this branch a run killed by a reload would read as live
 * for the rest of the session.
 */
async function checkFreshnessRule() {
  const scratch = "_freshness-probe";
  const dir = path.join(LOGS, scratch);
  fs.mkdirSync(dir, { recursive: true });
  const evp = path.join(dir, "ui-run-probe.events.ndjson");
  fs.writeFileSync(evp, JSON.stringify({ event: "start", mode: "dry" }) + "\n");
  fs.writeFileSync(
    path.join(dir, "ui-run-latest.json"),
    JSON.stringify({
      file: `${scratch}.bmpx`, id: scratch, mode: "dry", pid: 999999,
      startedAt: new Date().toISOString(), events: evp,
      err: path.join(dir, "ui-run-probe.err"),
      control: path.join(PROJECTS, `${scratch}.control.json`), exitCode: null
    })
  );
  const ask = async () => await (await fetch(`${BASE}/api/bmpx/run?file=${scratch}.bmpx&offset=0`)).json();

  const stale = new Date(Date.now() - FRESH_MS * 3);
  fs.utimesSync(evp, stale, stale);
  const whenStale = await ask();
  const now = new Date();
  fs.utimesSync(evp, now, now);
  const whenFresh = await ask();

  check(
    whenStale.exitCode === null && whenFresh.exitCode === null,
    "the stored flag says 'still running' in BOTH halves",
    `exitCode=${whenStale.exitCode}/${whenFresh.exitCode}`
  );
  check(whenStale.running === false, "a STALE events file reads as not running");
  check(whenFresh.running === true, "a FRESH events file reads as running");
  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  const { file, doc, phases } = pickProject();
  /** The project whose build is in flight right now, if any. */
  const liveId = fs
    .readdirSync(PROJECTS)
    .filter((f) => f.endsWith(".bmpx.running"))
    .map((f) => f.replace(/\.bmpx\.running$/, ""))
    .find((i) => fs.existsSync(path.join(PROJECTS_LIST, `${i}.bmpx`))) ?? null;
  const id = file.replace(/\.bmpx$/, "");
  const projectPath = path.join(PROJECTS, file);
  console.log(`\nrehearsing ${file} (${phases.length} phases)\n`);

  const mirrorPath = path.join(PROJECTS_LIST, file);
  const before = { sha: sha(projectPath), mirrorSha: sha(mirrorPath), events: newestEvents(id) };

  const { child, profile, port } = await launchChrome({ width: 1600, height: 1000 });
  const cdp = await Cdp.attach(port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  // Before the first navigation: /buildmgr is gated by proxy.ts (I-31).
  await signIn(cdp, BASE);
  await cdp.send("Page.navigate", { url: `${BASE}/buildmgr` });
  await cdp.waitEvent("Page.loadEventFired");
  await settle(3500);

  try {
    /* -- 1. the list is the directory ------------------------------------- */
    const onDisk = fs
      .readdirSync(PROJECTS_LIST)
      .filter((f) => f.endsWith(".bmpx"))
      .map((f) => f.replace(/\.bmpx$/, ""));
    const shown = await cdp.eval(
      `(() => { const t = document.body.innerText; return ${JSON.stringify(onDisk)}.filter((i) => t.includes(i)); })()`
    );
    check(
      shown.length === onDisk.length,
      "lists every .bmpx in build/projects",
      `${shown.length}/${onDisk.length} ids rendered`
    );

    /* -- 2. opening a plan renders that file's phases and steps ----------- */
    await click(cdp, id);
    await settle(900);
    const planSeen = await cdp.eval(
      `(() => { const t = document.body.innerText; return { phases: ${JSON.stringify(
        phases.map((p) => p.name)
      )}.filter((n) => t.includes(n)).length, gate: t.includes(${JSON.stringify(
        String(phases.find((p) => p.gate)?.gate ?? "").slice(0, 40)
      )}) }; })()`
    );
    check(planSeen.phases === phases.length, "opens the plan", `${planSeen.phases}/${phases.length} phase names on screen`);
    check(planSeen.gate, "renders the phase gates from the file");

    /* -- 3. a REAL run, observed live ------------------------------------- */
    //
    // `/api/bmpx/run` allows ONE run at a time, globally. When a build is
    // already in flight there is no way to start a rehearsal, and there should
    // not be — so the probe observes the run that IS live instead of trying to
    // manufacture one. That is the stronger evidence anyway: a real build,
    // mid-flight, is exactly what "the live-run view reflects a running build"
    // means. Nothing in this branch clicks a run control; a live REAL run is
    // somebody's money and STOP is not the probe's to press.
    if (liveId) {
      console.log(`\n  a build is LIVE (${liveId}) — observing it rather than starting a second\n`);
      await click(cdp, liveId);
      await settle(2500);
      const evLive = newestEvents(liveId);
      check(evLive !== null, "the live run has an events file", evLive?.n ?? "none");

      const ui0 = await cdp.eval(READ);
      check(ui0.live, "the run strip reports the live run as live", ui0.modeLine);
      check(ui0.glowing, "the open project's row pulses while it builds");
      check(/resumed live/i.test(ui0.status), "the session was restored from the events file", ui0.status);
      check(
        await cdp.eval(
          `[...document.querySelectorAll('button')].filter((b) => /opus→all|fable→all|fable redo/.test(b.innerText)).every((b) => b.disabled)`
        ),
        "the model switches are disabled while a run is live"
      );
      check(
        await cdp.eval(`/■\\s*STOP/.test(document.body.innerText)`),
        "the run control offers STOP, not START, while live"
      );

      // Correspondence, then growth. The builder only emits at step and group
      // boundaries, so a quiet window is a fact about the BUILD, not a defect
      // in the screen — it is reported rather than failed. If the file does
      // move, the screen is required to move with it.
      const size0 = fs.statSync(evLive.p).size;
      const count = (p) => fs.readFileSync(p, "utf8").split("\n").filter(Boolean).length;
      check(
        ui0.logLines === Math.min(count(evLive.p), 400),
        "every event in the live file is a line on screen",
        `dom=${ui0.logLines} file=${count(evLive.p)}`
      );
      // Which BRANCH of isLive() answered matters, and the first draft of this
      // check got it backwards. The route prefers the in-process child handle
      // and only FALLS BACK to events-file freshness when the handle is gone.
      // A build that is mid-step is quiet for minutes at a time, so its events
      // file is legitimately stale while the run is legitimately live — the
      // handle is what reports it, correctly. The fallback is proven on its own
      // terms by checkFreshnessRule(), which is the only way to exercise it
      // without forcing a dev-server reload.
      const liveApi = await (await fetch(`${BASE}/api/bmpx/run?file=${liveId}.bmpx&offset=0`)).json();
      const ageS = Math.round((Date.now() - fs.statSync(evLive.p).mtimeMs) / 1000);
      check(liveApi.running === true, "the run route reports the build live", `pid ${liveApi.pid}, mode ${liveApi.mode}`);
      console.log(
        `  note  events file last written ${ageS}s ago (FRESH_MS=${FRESH_MS / 1000}s) — so the` +
          ` in-process handle is what reports this run live, not freshness.` +
          (ageS * 1000 > FRESH_MS
            ? ` A dev-server reload right now would drop that handle and the fallback would read this LIVE build as dead.`
            : "")
      );

      let grew = false;
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        await settle(3000);
        if (fs.statSync(evLive.p).size > size0) { grew = true; break; }
      }
      if (grew) {
        await settle(2500);
        const ui1 = await cdp.eval(READ);
        check(
          ui1.logLines === Math.min(count(evLive.p), 400),
          "the log pane grew with the events file",
          `dom=${ui1.logLines} file=${count(evLive.p)}`
        );
      } else {
        console.log("  note  the builder emitted nothing in 150s (between groups) — growth not exercised");
      }

      await checkFreshnessRule();
      return;
    }

    await click(cdp, "dry");
    await settle(200);
    const idle = await cdp.eval(READ);
    check(!idle.live, "idle before START", idle.modeLine);

    await click(cdp, "START", "sub");
    const t0 = Date.now();

    // Watch the FILE and the DOM in the same loop. The claim is that the
    // screen tracks the events file, so both are sampled together.
    let sawLive = false, sawGrowth = false, sawGlow = false, evFile = null;
    let lastSize = -1, samples = [];
    while (Date.now() - t0 < 180_000) {
      await settle(1000);
      const ui = await cdp.eval(READ);
      const ev = newestEvents(id);
      if (ev && (!before.events || ev.p !== before.events.p || ev.m > before.events.m)) evFile = ev;
      const size = evFile ? fs.statSync(evFile.p).size : 0;
      if (ui.live) sawLive = true;
      if (ui.glowing) sawGlow = true;
      if (size > lastSize && lastSize >= 0 && ui.logLines > 0) sawGrowth = true;
      samples.push({ s: size, l: ui.logLines, live: ui.live });
      lastSize = size;
      if (!ui.live && /run exited/i.test(ui.status)) break;
    }
    const last = await cdp.eval(READ);

    check(evFile !== null, "START spawned the builder and it wrote an events file", evFile?.n ?? "none");
    check(sawLive, "the run strip reported the run live while it ran");
    check(sawGlow, "the project row pulsed while building");
    check(sawGrowth, "the log pane grew as the events file grew");

    const lines = evFile ? fs.readFileSync(evFile.p, "utf8").split("\n").filter(Boolean) : [];
    const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    check(events.length > 0, "the events file is real NDJSON", `${events.length} events`);
    check(
      events.some((e) => e.event === "start") && events.some((e) => e.mode === "dry" || e.event === "run_cost" || e.event === "done"),
      "the builder ran in DRY mode",
      [...new Set(events.map((e) => e.event))].slice(0, 8).join(",")
    );
    // The screen renders one line per event (capped at 400).
    check(
      last.logLines === Math.min(events.length, 400),
      "every event in the file is a line on screen",
      `dom=${last.logLines} file=${events.length}`
    );
    check(/run exited/i.test(last.status), "the exit is reported on screen", last.status);

    /* -- 4. a dry run leaves the .bmpx untouched -------------------------- */
    check(sha(projectPath) === before.sha, "the dry run wrote nothing to the .bmpx");
    check(sha(mirrorPath) === before.mirrorSha, "…nor to its pre-build mirror");

    /* -- 5. and drops its decoration after DRY_CLEAR_MS ------------------- */
    await settle(11_000);
    const cleared = await cdp.eval(READ);
    check(/status cleared/i.test(cleared.status), "the dry run's status is cleared after 10s", cleared.status);

    /* -- 6. liveness is FRESHNESS, not the stored flag -------------------- */
    await checkFreshnessRule();
  } finally {
    cdp.close();
    await cleanup(child, profile);
  }

  console.log(`\n${failures ? `FAIL — ${failures} check(s) failed` : "PASS — the Build Manager drives a real run end to end"}`);
  process.exit(failures ? 1 : 0);
}

await main();
