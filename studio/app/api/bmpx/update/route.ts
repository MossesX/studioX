/**
 * @file Writes run results back into a `.bmpx` — the ONE write the Build
 * Manager makes, at the ONE moment it makes it.
 *
 * Owner directive, 2026-08-08: statuses are READ from the todo file; while a
 * run is live the UI hot-renders its progress in memory, and only when the
 * process STOPS does the accumulated result land back in the file. This route
 * is that landing. It supersedes the GET route's original read-only posture,
 * deliberately and narrowly:
 *
 *   - it accepts a bare filename (no path separators) and only marks steps
 *     DONE — it cannot rewrite prose, phases, or manifests;
 *   - before the first byte changes, the current file is copied to
 *     `<file>.runbak` beside it (a fresh backup per run — deliberately NOT
 *     `.bak`, which the bmpx pipeline already uses for version backups);
 *   - it writes BOTH trees at the same moment (GizmoX `build/projects/` — the
 *     record of truth while it exists pre-port — and the `pre-build/` mirror),
 *     per the standing mirror rule.
 *
 * A phase whose steps are all done gets `status: "done"`; a partially-run
 * phase keeps its stored status, because a stopped run is not a finished one.
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

interface Completion {
  phaseN: number;
  stepIndex: number;
}

export async function POST(req: Request) {
  let body: { file?: string; completed?: Completion[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const file = String(body.file ?? "");
  const completed = Array.isArray(body.completed) ? body.completed : [];
  if (!file.endsWith(".bmpx") || file !== path.basename(file)) {
    return Response.json({ error: "file must be a bare .bmpx filename" }, { status: 400 });
  }
  if (completed.length === 0) {
    return Response.json({ error: "nothing to write" }, { status: 400 });
  }

  // The builder is the single writer while a run is live (it holds the RUN
  // lock) — this route must never race it.
  const holder = liveRunLock(path.join(TREES[0], file));
  if (holder) {
    return Response.json(
      { error: `${file} is being built right now (pid ${holder.pid}) — run results are the builder's to write` },
      { status: 409 }
    );
  }

  const updated: string[] = [];
  for (const dir of TREES) {
    const full = path.join(dir, file);
    if (!existsSync(full)) continue;
    try {
      await withBmpxWriteLock(full, async () => {
      const raw = await readFile(full, "utf8");
      const doc = JSON.parse(raw) as {
        plan?: { phases?: { n?: number; status?: string; steps?: { done?: boolean; phase_status?: string }[] }[] };
        manifest?: { revised?: string };
      };
      const phases = doc.plan?.phases ?? [];
      let touched = 0;
      for (const { phaseN, stepIndex } of completed) {
        const ph = phases.find((x) => x.n === phaseN);
        const step = ph?.steps?.[stepIndex];
        if (!ph || !step) continue;
        if (!step.done) {
          step.done = true;
          touched += 1;
        }
        if (ph.steps!.every((s) => s.done)) {
          ph.status = "done";
          for (const s of ph.steps!) if ("phase_status" in s) s.phase_status = "done";
        }
      }
      if (!touched) return; // nothing differed in this tree — lock releases, next tree
      if (doc.manifest) doc.manifest.revised = bmpxDateStamp();
      await copyFile(full, full + ".runbak");
      atomicWrite(full, JSON.stringify(doc, null, 1));
      updated.push(full);
      });
    } catch (e) {
      return Response.json({ error: `${full}: ${String(e)}`, updated }, { status: 500 });
    }
  }

  if (updated.length === 0) {
    return Response.json({ error: `"${file}" not found in any tree` }, { status: 404 });
  }
  return Response.json({ ok: true, steps: completed.length, updated, mirrored: updated.length > 1 });
}
