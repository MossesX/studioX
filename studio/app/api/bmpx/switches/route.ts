/**
 * @file The Build Manager's two MODEL SWITCHES, persisted in the `.bmpx` itself.
 *
 * Owner directive, 2026-08-08. Two per-project toggles, stored under
 * `plan.model_switches` so they are DATA that ports with the project and any
 * runner can honour them — a switch held only in React state would show one
 * thing on screen while `bmpx_builder.py` ran another, which is the exact
 * false-state trap the step-models write path was built to close:
 *
 *   - `opus_everywhere` — every step whose stored model is not `fable-5` RUNS
 *     on `opus-5` (the flagship at Opus pricing, per the MODEL RULES imported
 *     into the plans). The stored per-step models are NOT rewritten — the
 *     switch is a mode over them, and turning it off restores the curated
 *     assignment untouched.
 *   - `fable_everywhere` — every step RUNS on `fable-5`, full stop. Mutually
 *     exclusive with `opus_everywhere` (turning either on turns the other
 *     off — "all opus" and "all fable" cannot both be true). While it is on,
 *     no step runs on opus, so an active `fable_redo` generates no group —
 *     redoing opus work on fable is meaningless when everything already runs
 *     fable. Same non-destructive rule: stored models are never rewritten.
 *   - `fable_redo` — appends one generated group at the END of the plan that
 *     redoes every step that would RUN on opus (the stored opus steps, plus —
 *     while `opus_everywhere` is on — everything the first switch promotes)
 *     on `fable-5`, each redo step carrying the full original instruction so
 *     a builder can execute it standalone. Toggling off removes exactly the
 *     generated group (`generated_by: "fable-redo-switch"`), never an
 *     authored phase.
 *
 * Same write discipline as `/api/bmpx/update`: bare filename only, backup
 * beside the file before the first byte changes (`.swbak` — `.runbak` belongs
 * to run results and must not be clobbered by a toggle), and BOTH trees
 * written at the same moment per the standing mirror rule.
 */
import { copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { AXF_ROOT } from "../../../../src/server/paths";
import { atomicWrite, bmpxDateStamp, liveRunLock, withBmpxWriteLock } from "../../../../src/server/bmpxLocks";

export const dynamic = "force-dynamic";

const TREES = [
  // GizmoX first: it is the record of truth pre-port. Absent post-port.
  path.join(AXF_ROOT, "..", "GizmoX", "build", "projects"),
  path.join(AXF_ROOT, "build", "projects")
];

const GENERATED_BY = "fable-redo-switch";

interface BmpxStep {
  text?: string;
  tok?: number;
  done?: boolean;
  model?: string;
  reasonTag?: string;
  redo_of?: { phaseN: number; stepIndex: number };
  [k: string]: unknown;
}
interface BmpxPhase {
  n?: number;
  name?: string;
  status?: string;
  steps?: BmpxStep[];
  est_tok?: number;
  est_usd?: number;
  gate?: string;
  generated_by?: string;
  [k: string]: unknown;
}
interface Switches {
  opus_everywhere: boolean;
  fable_everywhere: boolean;
  fable_redo: boolean;
}
interface BmpxDoc {
  manifest?: { revised?: string; [k: string]: unknown };
  plan?: {
    phases?: BmpxPhase[];
    model_switches?: Partial<Switches>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** The model a step RUNS on under the switches. Generated redo steps are
 *  already fable-5 and pass through unchanged. */
function effectiveModel(stored: string, sw: Switches): string {
  if (sw.fable_everywhere) return "fable-5";
  if (stored === "fable-5") return "fable-5";
  return sw.opus_everywhere ? "opus-5" : stored;
}

/** Build the redo group from the AUTHORED phases (generated ones excluded —
 *  a redo of a redo is how a plan grows without bound). */
function buildRedoGroup(phases: BmpxPhase[], sw: Switches): BmpxPhase | null {
  const authored = phases.filter((p) => p.generated_by !== GENERATED_BY);
  const steps: BmpxStep[] = [];
  for (const ph of authored) {
    (ph.steps ?? []).forEach((s, si) => {
      const stored = String(s.model ?? "");
      const eff = effectiveModel(stored, sw);
      if (!eff.startsWith("opus")) return;
      steps.push({
        text:
          `REDO ON FABLE-5 (P${ph.n} step ${si + 1}, runs on ${eff}` +
          (eff !== stored ? ` via the opus-everywhere switch, stored ${stored}` : "") +
          `): re-execute this step's work at fable-5 depth, treating the opus output ` +
          `already in the tree as a draft to verify, correct and improve — never a ` +
          `blank-tree restart, and never a rubber stamp: re-run the step's own gate and ` +
          `fix what it finds. Original step: ${String(s.text ?? "")}`,
        tok: Number(s.tok ?? 0),
        done: false,
        model: "fable-5",
        reasonTag: `fable-redo-p${ph.n}s${si + 1}`,
        redo_of: { phaseN: Number(ph.n ?? 0), stepIndex: si }
      });
    });
  }
  if (steps.length === 0) return null;
  const maxN = Math.max(0, ...authored.map((p) => Number(p.n ?? 0)));
  return {
    n: maxN + 1,
    name: `R Fable redo — re-run the ${steps.length} opus step(s) on fable-5 (generated by switch; toggle off to remove)`,
    status: "todo",
    generated_by: GENERATED_BY,
    steps,
    est_tok: steps.reduce((n, s) => n + Number(s.tok ?? 0), 0),
    est_usd: 0,
    gate:
      "every redone step's ORIGINAL gate re-run and observed green on the fable-5 " +
      "output; anything the redo changed is named in the run record rather than " +
      "silently overwriting the opus result"
  };
}

/** POST { file, opusEverywhere?, fableRedo? } — omitted flags keep their
 *  stored value. Returns the switch state and whether the redo group exists. */
export async function POST(req: Request) {
  let body: {
    file?: string;
    opusEverywhere?: boolean;
    fableEverywhere?: boolean;
    fableRedo?: boolean;
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
  if (
    typeof body.opusEverywhere !== "boolean" &&
    typeof body.fableEverywhere !== "boolean" &&
    typeof body.fableRedo !== "boolean"
  ) {
    return Response.json({ error: "nothing to change" }, { status: 400 });
  }

  // A live run makes the builder the single writer of this file — a switch
  // written now would be clobbered by (or clobber) its next group-end write.
  const holder = liveRunLock(path.join(TREES[0], file));
  if (holder) {
    return Response.json(
      {
        error: `${file} is being built right now (pid ${holder.pid}, ${holder.mode ?? "?"}, started ${holder.started ?? "?"}) — switches are locked until the run stops`
      },
      { status: 409 }
    );
  }

  const updated: string[] = [];
  let finalSwitches: Switches | null = null;
  let redoSteps = 0;

  for (const dir of TREES) {
    const full = path.join(dir, file);
    if (!existsSync(full)) continue;
    try {
      await withBmpxWriteLock(full, async () => {
      const doc = JSON.parse(await readFile(full, "utf8")) as BmpxDoc;
      if (!doc.plan || !Array.isArray(doc.plan.phases)) {
        throw new Error("no plan.phases");
      }
      const prev = doc.plan.model_switches ?? {};
      const next: Switches = {
        opus_everywhere:
          typeof body.opusEverywhere === "boolean" ? body.opusEverywhere : Boolean(prev.opus_everywhere),
        fable_everywhere:
          typeof body.fableEverywhere === "boolean" ? body.fableEverywhere : Boolean(prev.fable_everywhere),
        fable_redo: typeof body.fableRedo === "boolean" ? body.fableRedo : Boolean(prev.fable_redo)
      };
      // Mutual exclusivity: "all opus" and "all fable" cannot both be true.
      // The one being turned ON in this request wins; the other drops.
      if (body.fableEverywhere === true) next.opus_everywhere = false;
      else if (body.opusEverywhere === true) next.fable_everywhere = false;
      doc.plan.model_switches = next;

      // Drop any existing generated group, then regenerate if the switch is on
      // — regeneration (not preservation) is what keeps the group honest when
      // opus_everywhere changes the set of steps that run on opus.
      doc.plan.phases = doc.plan.phases.filter((p) => p.generated_by !== GENERATED_BY);
      if (next.fable_redo) {
        const group = buildRedoGroup(doc.plan.phases, next);
        if (group) {
          doc.plan.phases.push(group);
          redoSteps = group.steps?.length ?? 0;
        }
      }

      if (doc.manifest) doc.manifest.revised = bmpxDateStamp();
      await copyFile(full, full + ".swbak");
      atomicWrite(full, JSON.stringify(doc, null, 1));
      updated.push(full);
      finalSwitches = next;
      });
    } catch (e) {
      return Response.json({ error: `${full}: ${String(e)}`, updated }, { status: 500 });
    }
  }

  if (updated.length === 0) {
    return Response.json({ error: `"${file}" not found in any tree` }, { status: 404 });
  }
  return Response.json({
    ok: true,
    switches: finalSwitches,
    redoSteps,
    updated,
    mirrored: updated.length > 1
  });
}
