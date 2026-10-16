/**
 * @file Runs a `.bmpx` project through the REAL builder — `bmpx_builder.py`
 * spawned from the GizmoX venv, exactly as a terminal run would.
 *
 * This replaces the Build Manager's labelled simulation. The contract:
 *
 *   - ONE run at a time BY DEFAULT, tracked in-module AND in a
 *     `ui-run-latest.json` pointer under `logs/build/<id>/`, so a dev-server
 *     module reload cannot orphan a run invisibly — liveness falls back to
 *     events-file FRESHNESS (the BMPX Sync lesson: a live run IS a fresh
 *     events file).
 *   - `concurrent: true` OVERRIDES the one-at-a-time gate (the Build
 *     Manager's switch), and the override is CHECKED, not waved through:
 *     the candidate plan's step texts and notes are compared against every
 *     live run's for file-path mentions. A meaningful overlap (a shared
 *     directory three or more segments deep) is a HARD conflict — 409, the
 *     paths named, no force-through, because two agents writing one path is
 *     the exact failure the lock existed to prevent. Shared-tree RISKS that
 *     are not path collisions (both plans run whole-tree gate sweeps, which
 *     produce phantom failures side by side; both append PLANNING-STATE.md)
 *     come back as 428 warnings and start only when the caller re-sends with
 *     `acknowledgeWarnings: true` — the double-check, made explicit.
 *     Same-project stays absolute: the per-project locks below never soften.
 *   - the ONLY writer-exclusion this route can see is path MENTIONS in the
 *     plans. A plan that edits files its prose never names slips this net —
 *     which is why the analysis refuses rather than reassures when it finds
 *     anything at all.
 *   - stdout is the builder's NDJSON event stream, teed to
 *     `logs/build/<id>/ui-run-<stamp>.events.ndjson` (raw exhaust, where run
 *     records belong); stderr to a sibling `.err`. The GET endpoint serves
 *     the file incrementally by byte offset — the UI polls, it never holds a
 *     socket open across dev-server reloads.
 *   - stop is COOPERATIVE: `{"action":"stop"}` into the project's control
 *     file (`build/projects/<id>.control.json` — every run gets one, per the
 *     standing --control-file rule); the builder settles finished groups and
 *     exits 3. `force: true` kills the process — the escalation, not the
 *     default.
 *   - dry runs pass `--no-archive` (a rehearsal should not mint archive
 *     assets); real runs archive, snapshot, and WRITE THE .bmpx themselves —
 *     the builder is the single writer of done-flags and the cost ledger, so
 *     this route never touches `/api/bmpx/update`.
 *   - the sentinel stays armed (no `--no-sentinel`), and real requires the
 *     builder's own `--confirm-real`.
 *   - at process exit the run's records are mirrored to `pre-build/` per
 *     `.claude/rules/amberx-bound-builds.md` §1: the `.bmpx` (+ control
 *     file), `logs/build/<id>/`, and — for archived real runs — the archive
 *     dir and zip named by the builder's `archived` event.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import { AXF_ROOT } from "../../../../src/server/paths";
import { liveRunLock } from "../../../../src/server/bmpxLocks";

export const dynamic = "force-dynamic";

const GIZMOX = path.join(AXF_ROOT, "..", "GizmoX");
const PY = path.join(GIZMOX, ".venv", "Scripts", "python.exe");
const BUILDER = path.join(GIZMOX, "build", "tools", "bmpx_builder.py");
const PROJECTS = path.join(GIZMOX, "build", "projects");
const PREBUILD = AXF_ROOT;
/** A run whose events file went quiet this long is presumed dead (module
 *  reload lost the child handle and the exit hook with it). */
const FRESH_MS = 30_000;

interface RunPointer {
  file: string;
  id: string;
  mode: "dry" | "real";
  pid: number;
  startedAt: string;
  events: string;
  err: string;
  control: string;
  exitCode: number | null;
}

/* Module-level handles for in-process children, one per project id. Survive
 * requests, not dev reloads — which is why the pointer files exist. With the
 * concurrent switch there can be several; every read goes through runOf(). */
const runs = new Map<string, { child: ChildProcess | null; pointer: RunPointer }>();

function runOf(id: string): { child: ChildProcess | null; pointer: RunPointer } | null {
  const held = runs.get(id);
  if (held) return held;
  const p = readPointer(id);
  return p ? { child: null, pointer: p } : null;
}

const logsDir = (id: string) => path.join(GIZMOX, "logs", "build", id);
const pointerPath = (id: string) => path.join(logsDir(id), "ui-run-latest.json");

function readPointer(id: string): RunPointer | null {
  try {
    return JSON.parse(readFileSync(pointerPath(id), "utf8")) as RunPointer;
  } catch {
    return null;
  }
}

function isLive(p: RunPointer | null): boolean {
  if (!p) return false;
  const held = runs.get(p.id);
  if (held?.child) return held.child.exitCode === null && !held.child.killed;
  if (p.exitCode !== null) return false;
  // No in-memory handle (reload) — a live run keeps its events file fresh.
  try {
    return Date.now() - statSync(p.events).mtimeMs < FRESH_MS;
  } catch {
    return false;
  }
}

/**
 * Every project with a LIVE run right now, from the authoritative source: the
 * builder's own `.bmpx.running` locks (PID-checked by `liveRunLock`). Catches
 * runs this server never started — a terminal launch, another session. The
 * in-process map alone was the old global gate's blind spot.
 */
function liveRunIds(): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(PROJECTS).filter((n) => n.endsWith(".bmpx.running"));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    const bmpx = path.join(PROJECTS, n.replace(/\.running$/, ""));
    if (liveRunLock(bmpx)) out.push(path.basename(bmpx).replace(/\.bmpx$/, ""));
  }
  return out;
}

/* ------------------------------------------------- toe-stepping analysis */

/** Path-like mentions in a plan's prose — step texts, notes, gates. The only
 *  writer-exclusion signal a plan carries. Longest-first so prefix overlap
 *  tests see the deepest form of each mention. */
function pathMentions(doc: unknown): string[] {
  const texts: string[] = [];
  const d = doc as {
    manifest?: { notes?: unknown[] };
    plan?: { phases?: { gate?: unknown; steps?: { text?: unknown }[] }[] };
  };
  for (const n of d.manifest?.notes ?? []) if (typeof n === "string") texts.push(n);
  for (const ph of d.plan?.phases ?? []) {
    if (typeof ph.gate === "string") texts.push(ph.gate);
    for (const s of ph.steps ?? []) if (typeof s.text === "string") texts.push(s.text);
  }
  const seen = new Set<string>();
  const re = /(?:packages|src|app|assets|data|bare-core|peeled)\/[A-Za-z0-9_\-./]+/g;
  /** A path a plan DISCLAIMS is the opposite of a collision signal. The
   *  axf-default-state plan was refused against the amberxvid stream for the
   *  sentence "Do not touch src/modules/amberxvid/**" — a mention-extractor
   *  cannot read intent, but it can read an explicit disclaimer right before
   *  the mention. */
  const DISCLAIMED = /(?:do not touch|never touch|not touched|untouched|off-limits|belongs? to (?:another|that|the \w+) stream|leave(?:s)? .{0,20}alone)[^.]{0,60}$/i;
  for (const t of texts) {
    for (const m of t.matchAll(re)) {
      if (DISCLAIMED.test(t.slice(Math.max(0, (m.index ?? 0) - 90), m.index ?? 0))) continue;
      // Trim sentence punctuation and the odd trailing slash or wildcard,
      // then NORMALIZE: a plan says "src/modules/x" and "packages/studio/
      // src/modules/x" interchangeably, and the comparison must not care.
      const cleaned = m[0].replace(/[*.,;:)'"`]+$/, "").replace(/\/+$/, "");
      if (!cleaned.includes("/")) continue;
      const normalized = cleaned
        .toLowerCase()
        .replace(/^packages\/studio\//, "")
        .replace(/^packages\/core\//, "core/");
      seen.add(normalized);
    }
  }
  return [...seen].sort((a, b) => b.length - a.length);
}

/** Ancestors every plan legitimately names — never a collision by themselves.
 *  Post-normalization forms (studio-relative; core under `core/`). */
const COMMON_ANCESTORS = new Set([
  "src",
  "app",
  "test",
  "data",
  "assets",
  "src/modules",
  "src/plugins",
  "src/nav",
  "src/server",
  "app/api",
  "core",
  "core/src",
  // Bare tree roots — every plan's target-tree note names these without a
  // deeper path, and a bare mention survives normalization unchanged.
  "packages/studio",
  "packages/core"
]);

/**
 * Overlap = a DEEP COMMON ANCESTOR between any two mentions, not a prefix
 * relation. The prefix version shipped first and let two sibling files in one
 * module directory through — `amberxvid/Messenger.tsx` vs `StreamHub.tsx` —
 * which is precisely the two-agents-in-one-module collision this check
 * exists to catch. Returns the common ancestors found, deepest first, capped.
 */
function pathOverlaps(a: string[], b: string[]): string[] {
  const hits = new Set<string>();
  for (const x of a) {
    const xs = x.split("/");
    for (const y of b) {
      const ys = y.split("/");
      const common: string[] = [];
      for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
        if (xs[i] !== ys[i]) break;
        common.push(xs[i]!);
      }
      if (common.length < 2) continue;
      const ancestor = common.join("/");
      if (COMMON_ANCESTORS.has(ancestor)) continue;
      hits.add(ancestor);
    }
  }
  return [...hits].sort((x, y) => y.length - x.length).slice(0, 12);
}

const GATE_SWEEP_RE = /tsc --noEmit|npm (?:run )?test|--test-concurrency|check:(?:suite|imports|ui|glyphs|toolbar|coverage|css|nav)/;

/** Shared-tree risks that are not path collisions: named, so acknowledging
 *  them is a statement about something specific rather than a reflex. */
function softWarnings(candidate: unknown, liveDocs: { id: string; doc: unknown }[]): string[] {
  const warnings: string[] = [];
  const text = (doc: unknown) => JSON.stringify(doc);
  const candText = text(candidate);
  for (const { id, doc } of liveDocs) {
    const liveText = text(doc);
    if (GATE_SWEEP_RE.test(candText) && GATE_SWEEP_RE.test(liveText)) {
      warnings.push(
        `both this plan and live run "${id}" run whole-tree gates (tsc / npm test / check:*) — side-by-side sweeps in one working tree produce phantom failures; expect a red gate to need a solo re-run before it is believed`
      );
    }
    if (candText.includes("PLANNING-STATE.md") && liveText.includes("PLANNING-STATE.md")) {
      warnings.push(
        `both this plan and live run "${id}" append to PLANNING-STATE.md — last writer wins on a same-moment append; the records may interleave`
      );
    }
  }
  return warnings;
}

/** Mirror the run's records to pre-build per the standing rule §1. */
function mirrorRun(p: RunPointer) {
  const out: string[] = [];
  const cp = (src: string, dst: string) => {
    try {
      if (!existsSync(src)) return;
      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      out.push(dst);
    } catch {
      /* a failed mirror copy must not mask the run result */
    }
  };
  // build/projects records: the .bmpx, its control file, and any backups the
  // run left beside it — each at the same relative path.
  const sidecars = [p.file, `${p.id}.control.json`, `${p.file}.runbak`, `${p.file}.swbak`, `${p.file}.bak`];
  for (const name of sidecars) {
    cp(path.join(PROJECTS, name), path.join(PREBUILD, "build", "projects", name));
  }
  // logs/build/<id>: the run exhaust.
  for (const f of [p.events, p.err, pointerPath(p.id)]) {
    cp(f, path.join(PREBUILD, "logs", "build", p.id, path.basename(f)));
  }
  // Archived real run: the builder's `archived` event names repo-relative paths.
  try {
    const lines = readFileSync(p.events, "utf8").split("\n");
    for (const line of lines) {
      if (!line.includes('"archived"')) continue;
      const ev = JSON.parse(line) as { event: string; raw?: string; zip?: string };
      if (ev.event !== "archived") continue;
      if (ev.raw) {
        try {
          cpSync(path.join(GIZMOX, ev.raw), path.join(PREBUILD, ev.raw), { recursive: true });
          out.push(ev.raw);
        } catch { /* see above */ }
      }
      if (ev.zip) cp(path.join(GIZMOX, ev.zip), path.join(PREBUILD, ev.zip));
    }
  } catch {
    /* no events file — nothing to mirror */
  }
  return out;
}

/** POST { file, mode?, concurrent?, acknowledgeWarnings? } starts a run ·
 *  { file, stop: true, force? } stops one. */
export async function POST(req: Request) {
  let body: {
    file?: string;
    mode?: string;
    stop?: boolean;
    force?: boolean;
    concurrent?: boolean;
    acknowledgeWarnings?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const file = String(body.file ?? "");
  if (!file.endsWith(".bmpx") || file !== path.basename(file)) {
    return Response.json({ error: "file must be a bare .bmpx filename" }, { status: 400 });
  }
  const id = file.replace(/\.bmpx$/, "");
  const projectPath = path.join(PROJECTS, file);
  if (!existsSync(projectPath)) {
    return Response.json({ error: `${file} not found in build/projects` }, { status: 404 });
  }

  /* ------------------------------------------------------------- stop */
  if (body.stop) {
    const held = runOf(id);
    const control = held?.pointer.control ?? path.join(PROJECTS, `${id}.control.json`);
    writeFileSync(control, JSON.stringify({ action: "stop" }), "utf8");
    if (body.force && held?.child && held.child.exitCode === null) {
      held.child.kill();
    }
    return Response.json({ ok: true, stopped: "requested", control, forced: Boolean(body.force) });
  }

  /* ------------------------------------------------------------ start */
  const mode = body.mode === "real" ? "real" : "dry";

  // Per-project gates first — these NEVER soften, concurrent or not. Two runs
  // of one project is two writers of one .bmpx, no analysis needed.
  const prior = readPointer(id);
  if (isLive(prior)) {
    return Response.json(
      { error: `${id} already has a live run (pid ${prior!.pid}, events fresh) — stop it first` },
      { status: 409 }
    );
  }
  // The authoritative check: the builder's own RUN lock. Catches runs this
  // server never started — a terminal launch, another session, anything.
  const holder = liveRunLock(projectPath);
  if (holder) {
    return Response.json(
      {
        error: `${id} is already being built by pid ${holder.pid} (${holder.mode ?? "?"}, started ${holder.started ?? "?"}) — one run per project`
      },
      { status: 409 }
    );
  }

  // The GLOBAL gate, and the switch that overrides it.
  const others = liveRunIds().filter((x) => x !== id);
  if (others.length > 0) {
    if (!body.concurrent) {
      return Response.json(
        {
          error:
            `a run is already live (${others.join(", ")}) — one at a time. ` +
            `The Build Manager's concurrent switch overrides this after a toe-stepping check.`
        },
        { status: 409 }
      );
    }

    // Override requested — check, then double-check.
    let candidateDoc: unknown;
    const liveDocs: { id: string; doc: unknown }[] = [];
    try {
      candidateDoc = JSON.parse(readFileSync(projectPath, "utf8"));
      for (const other of others) {
        liveDocs.push({
          id: other,
          doc: JSON.parse(readFileSync(path.join(PROJECTS, `${other}.bmpx`), "utf8"))
        });
      }
    } catch (e) {
      // If the plans cannot be read, the overlap cannot be ruled out — refuse
      // rather than run blind. The lock exists for exactly this uncertainty.
      return Response.json(
        { error: `concurrent start refused — could not read a plan to check overlap: ${String(e)}` },
        { status: 409 }
      );
    }

    const candPaths = pathMentions(candidateDoc);
    const conflicts: { with: string; paths: string[] }[] = [];
    for (const { id: otherId, doc } of liveDocs) {
      const overlap = pathOverlaps(candPaths, pathMentions(doc));
      if (overlap.length > 0) conflicts.push({ with: otherId, paths: overlap });
    }
    if (conflicts.length > 0) {
      // HARD refusal, no force-through: two plans naming one path is two
      // agents writing one path. Edit a plan, or wait the other run out.
      return Response.json(
        {
          error:
            "concurrent start refused — the plans name overlapping paths, and two agents " +
            "writing one path is the failure the lock exists to prevent",
          conflicts
        },
        { status: 409 }
      );
    }

    const warnings = softWarnings(candidateDoc, liveDocs);
    if (warnings.length > 0 && !body.acknowledgeWarnings) {
      // The double-check: shared-tree risks that are real but survivable are
      // shown once, and the caller states it read them.
      return Response.json({ ok: false, needsAcknowledge: true, warnings, liveRuns: others }, { status: 428 });
    }
  }

  if (!existsSync(PY) || !existsSync(BUILDER)) {
    return Response.json({ error: "GizmoX venv or bmpx_builder.py not found" }, { status: 500 });
  }

  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  mkdirSync(logsDir(id), { recursive: true });
  const events = path.join(logsDir(id), `ui-run-${stamp}.events.ndjson`);
  const err = path.join(logsDir(id), `ui-run-${stamp}.err`);
  const control = path.join(PROJECTS, `${id}.control.json`);
  writeFileSync(control, JSON.stringify({ action: "run" }), "utf8");

  const args = [BUILDER, "--project", projectPath, "--run", mode, "--control-file", control];
  if (mode === "real") args.push("--confirm-real");
  else args.push("--no-archive");

  const proc = spawn(PY, args, { cwd: GIZMOX, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  proc.stdout!.pipe(createWriteStream(events, { flags: "a" }));
  proc.stderr!.pipe(createWriteStream(err, { flags: "a" }));

  const p: RunPointer = {
    file,
    id,
    mode,
    pid: proc.pid ?? -1,
    startedAt: new Date().toISOString(),
    events,
    err,
    control,
    exitCode: null
  };
  runs.set(id, { child: proc, pointer: p });
  writeFileSync(pointerPath(id), JSON.stringify(p, null, 1), "utf8");

  proc.on("exit", (code) => {
    p.exitCode = code ?? -1;
    try {
      writeFileSync(pointerPath(id), JSON.stringify(p, null, 1), "utf8");
    } catch { /* pointer update is best-effort */ }
    mirrorRun(p);
  });

  return Response.json({ ok: true, pid: p.pid, mode, events: p.events, control });
}

/** GET ?file=<x>.bmpx&offset=<n> → incremental event lines from the latest
 *  run's NDJSON file, plus liveness and exit code. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const file = String(url.searchParams.get("file") ?? "");
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  if (!file.endsWith(".bmpx") || file !== path.basename(file)) {
    return Response.json({ error: "file must be a bare .bmpx filename" }, { status: 400 });
  }
  const id = file.replace(/\.bmpx$/, "");
  const p = runOf(id)?.pointer ?? null;
  if (!p) {
    return Response.json({ running: false, exitCode: null, lines: [], offset: 0, mode: null });
  }

  let lines: string[] = [];
  let nextOffset = offset;
  try {
    const size = statSync(p.events).size;
    if (size > offset) {
      const fh = await open(p.events, "r");
      try {
        const buf = Buffer.alloc(size - offset);
        await fh.read(buf, 0, buf.length, offset);
        const text = buf.toString("utf8");
        // Only complete lines advance the offset — a partial trailing line
        // stays buffered for the next poll instead of parsing as garbage.
        const lastNl = text.lastIndexOf("\n");
        if (lastNl >= 0) {
          lines = text.slice(0, lastNl).split("\n").filter(Boolean);
          nextOffset = offset + Buffer.byteLength(text.slice(0, lastNl + 1), "utf8");
        }
      } finally {
        await fh.close();
      }
    }
  } catch {
    /* events file not created yet — report empty, keep offset */
  }

  return Response.json({
    running: isLive(p),
    exitCode: p.exitCode,
    pid: p.pid,
    mode: p.mode,
    startedAt: p.startedAt,
    offset: nextOffset,
    lines
  });
}
