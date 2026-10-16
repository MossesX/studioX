/**
 * @file PLAN EDITS — the review screen's write path, and the only route that
 * may change what a step will DO.
 *
 * The owner's standing pre-build rule is that a plan's step list is reviewed
 * before any build runs. Until now that review happened in chat and any change
 * it produced was applied by hand-editing the `.bmpx`. This route is the review
 * screen's other half: the edits it accepts are exactly the ones a reviewer
 * makes — the model a step runs on, its reason tag, and its token estimate.
 *
 * ── the write discipline, unchanged from its two siblings ────────────────────
 *
 * `/api/bmpx/update` (run results) and `/api/bmpx/switches` (model switches)
 * established it and this route follows it exactly, because a third posture is
 * a third thing to audit:
 *
 *   - bare filename only, never a path — no traversal surface;
 *   - the RUN lock is checked FIRST. While a build is live the builder is the
 *     single writer of that file, and a plan edit landing mid-run would either
 *     be clobbered by the next group-end write or clobber it. 409, named;
 *   - the whole read-modify-write happens inside the file's WRITE lock;
 *   - a backup lands beside the file BEFORE the first byte changes —
 *     `.planbak`, its own suffix. `.runbak` belongs to run results and `.swbak`
 *     to switches; a shared name means one kind of mistake silently destroys
 *     the recovery point for another;
 *   - BOTH trees are written at the same moment, per the standing mirror rule.
 *
 * ── the two refusals that are the point of the route ─────────────────────────
 *
 * 1. **An unknown model is refused, by name.** `bmpx_builder.py` resolves a
 *    step's model through `MODEL_CLI_IDS.get(self.model, MODEL_CLI_IDS[DEFAULT_TIER])`,
 *    so a typo does not fail a run — it silently runs the step on sonnet-5 and
 *    prices it at a rate belonging to no model. The catalog is the check the
 *    builder does not do, and this is the chokepoint where it can still be
 *    acted on: a model that cannot run is never written to disk in the first
 *    place. Doing this in the UI alone would make the defect visible without
 *    making it impossible.
 *
 * 2. **A DONE step is refused.** Its work is already in the tree. Re-pointing a
 *    finished step at another model changes the record of what built the thing
 *    without rebuilding it — the plan would then describe a history that never
 *    happened. Resetting the flag is a separate, deliberate act.
 *
 * A phase's `est_tok` is adjusted by the DELTA of its steps' estimates rather
 * than recomputed as their sum. Some authored phases carry an `est_tok` that is
 * deliberately not the sum (a gate's own cost, a buffer); recomputing would
 * quietly delete that intent, while a delta preserves it.
 *
 * `est_usd` is left alone and goes stale on purpose. It is the plan's own
 * pricing block, computed per-project, and the review screen deliberately does
 * NOT price from it any more — costs come from the model catalog, which is the
 * builder's arithmetic. Writing a number here that nothing reads would be
 * inventing agreement rather than having it.
 */
import { copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { isKnownModel } from "../../../../src/modules/buildmgr/models";
import { AXF_ROOT } from "../../../../src/server/paths";
import { atomicWrite, bmpxDateStamp, liveRunLock, withBmpxWriteLock } from "../../../../src/server/bmpxLocks";

export const dynamic = "force-dynamic";

const TREES = [
  // GizmoX first: it is the record of truth pre-port. Absent post-port.
  path.join(AXF_ROOT, "..", "GizmoX", "build", "projects"),
  path.join(AXF_ROOT, "build", "projects")
];

/** One reviewer edit. `phaseN` is the phase's own `n`, not its array index —
 *  the fable-redo switch inserts and removes a generated phase, so indices
 *  move between the read and the write while `n` does not. */
interface StepEdit {
  phaseN: number;
  stepIndex: number;
  model?: string;
  reasonTag?: string;
  tok?: number;
}

interface BmpxStep {
  text?: string;
  tok?: number;
  done?: boolean;
  model?: string;
  reasonTag?: string;
  [k: string]: unknown;
}
interface BmpxPhase {
  n?: number;
  steps?: BmpxStep[];
  est_tok?: number;
  [k: string]: unknown;
}
interface BmpxDoc {
  manifest?: { revised?: string; [k: string]: unknown };
  plan?: { phases?: BmpxPhase[]; [k: string]: unknown };
  [k: string]: unknown;
}

/** POST { file, edits[] } — omitted fields on an edit keep their stored value.
 *  Returns the number of fields actually changed, per tree. */
export async function POST(req: Request) {
  let body: { file?: string; edits?: StepEdit[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const file = String(body.file ?? "");
  const edits = Array.isArray(body.edits) ? body.edits : [];
  if (!file.endsWith(".bmpx") || file !== path.basename(file)) {
    return Response.json({ error: "file must be a bare .bmpx filename" }, { status: 400 });
  }
  if (edits.length === 0) {
    return Response.json({ error: "nothing to change" }, { status: 400 });
  }

  // Refuse the whole batch before touching disk. A partially-applied review is
  // worse than a refused one: the reviewer would have to work out which half
  // landed from a screen that has already re-read the file.
  for (const e of edits) {
    if (e.model !== undefined && !isKnownModel(e.model)) {
      return Response.json(
        {
          error:
            `"${e.model}" is not a model the builder can run (P${e.phaseN} step ${e.stepIndex + 1}). ` +
            `bmpx_builder.py would silently fall back to sonnet-5 and price it at a rate no model has.`
        },
        { status: 400 }
      );
    }
    if (e.tok !== undefined && (!Number.isFinite(e.tok) || e.tok < 0)) {
      return Response.json(
        { error: `token estimate must be a non-negative number (P${e.phaseN} step ${e.stepIndex + 1})` },
        { status: 400 }
      );
    }
  }

  const holder = liveRunLock(path.join(TREES[0], file));
  if (holder) {
    return Response.json(
      {
        error:
          `${file} is being built right now (pid ${holder.pid}, ${holder.mode ?? "?"}, started ${holder.started ?? "?"}) — ` +
          `the plan is locked until the run stops`
      },
      { status: 409 }
    );
  }

  const updated: string[] = [];
  let changed = 0;
  /** Trees that HAVE the file, as distinct from trees that were written. A
   *  file present in both and already matching writes nothing and is a
   *  success; a file present in neither is a 404, and conflating the two
   *  reports "nothing to do" for a name that does not exist. */
  let found = 0;

  for (const dir of TREES) {
    const full = path.join(dir, file);
    if (!existsSync(full)) continue;
    found += 1;
    try {
      await withBmpxWriteLock(full, async () => {
        const doc = JSON.parse(await readFile(full, "utf8")) as BmpxDoc;
        const phases = doc.plan?.phases;
        if (!Array.isArray(phases)) throw new Error("no plan.phases");

        let touched = 0;
        for (const e of edits) {
          const ph = phases.find((p) => Number(p.n) === e.phaseN);
          const step = ph?.steps?.[e.stepIndex];
          if (!ph || !step) {
            throw new Error(`P${e.phaseN} step ${e.stepIndex + 1} does not exist in this file`);
          }
          if (step.done) {
            throw new Error(
              `P${e.phaseN} step ${e.stepIndex + 1} is already done — its work is in the tree, ` +
                `so re-pointing it would describe a build that never happened`
            );
          }
          if (e.model !== undefined && e.model !== step.model) {
            step.model = e.model;
            touched += 1;
          }
          if (e.reasonTag !== undefined && e.reasonTag !== step.reasonTag) {
            step.reasonTag = e.reasonTag;
            touched += 1;
          }
          if (e.tok !== undefined && e.tok !== Number(step.tok ?? 0)) {
            // Delta, not recompute — an authored est_tok that is deliberately
            // not the sum of its steps keeps its offset.
            ph.est_tok = Number(ph.est_tok ?? 0) + (e.tok - Number(step.tok ?? 0));
            step.tok = e.tok;
            touched += 1;
          }
        }

        if (!touched) return; // this tree already matched — next tree
        if (doc.manifest) doc.manifest.revised = bmpxDateStamp();
        await copyFile(full, full + ".planbak");
        atomicWrite(full, JSON.stringify(doc, null, 1));
        updated.push(full);
        changed = touched;
      });
    } catch (e) {
      // Name the TREE, not the directory: both are called `projects`, so
      // `path.basename(dir)` reported "projects/…" for either and told the
      // reader nothing about which one refused.
      const tree = dir.includes("GizmoX") ? "GizmoX" : "AmberX";
      return Response.json({ error: `${tree} ${file}: ${String(e)}`, updated }, { status: 400 });
    }
  }

  if (found === 0) {
    return Response.json({ error: `"${file}" not found in any tree` }, { status: 404 });
  }
  if (updated.length === 0) {
    return Response.json(
      { ok: true, changed: 0, updated, mirrored: false, note: "no field differed — nothing written" },
      { status: 200 }
    );
  }
  return Response.json({ ok: true, changed, updated, mirrored: updated.length > 1 });
}
