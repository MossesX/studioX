/**
 * @file Reads the real `.bmpx` projects for the Build Manager UI preview.
 *
 * Real files, not a fixture. A layout reviewed against invented content lies
 * about the two things that actually decide whether it works: how long the step
 * prose really is, and how many phases a real project really has.
 *
 * Read-only. The preview is for judging layout, and a mockup that can write to
 * build projects is a mockup that can damage them.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { AXF_ROOT } from "../../../src/server/paths";

export const dynamic = "force-dynamic";

const PROJECTS_DIR = path.join(AXF_ROOT, "build", "projects");

export async function GET() {
  let names: string[] = [];
  try {
    names = (await readdir(PROJECTS_DIR)).filter((f) => f.endsWith(".bmpx")).sort();
  } catch {
    return Response.json({ dir: PROJECTS_DIR, projects: [], error: "no projects directory" });
  }

  const projects = [];
  for (const name of names) {
    const full = path.join(PROJECTS_DIR, name);
    try {
      const [raw, info] = await Promise.all([readFile(full, "utf8"), stat(full)]);
      const doc = JSON.parse(raw) as {
        manifest?: Record<string, unknown>;
        plan?: Record<string, unknown>;
      };
      const m = (doc.manifest ?? {}) as Record<string, unknown>;
      const p = (doc.plan ?? {}) as Record<string, unknown>;
      const phases = Array.isArray(p.phases) ? (p.phases as Record<string, unknown>[]) : [];
      projects.push({
        file: name,
        id: String(m.id ?? name),
        name: String(m.name ?? m.id ?? name),
        status: String(m.status ?? "unknown"),
        amberxBound: Boolean(m.amberx_bound),
        supersededBy: m.superseded_by ? String(m.superseded_by) : null,
        modified: info.mtimeMs,
        notes: Array.isArray(m.notes) ? (m.notes as string[]) : [],
        checklist: Array.isArray(p.checklist) ? (p.checklist as string[]) : [],
        produces: (m.produces ?? null) as Record<string, unknown> | null,
        version: String(m.version ?? ""),
        created: String(m.created ?? ""),
        bytes: info.size,
        rates: (p.rates ?? null) as Record<string, number> | null,
        // The two model switches (persisted plan data — see /api/bmpx/switches)
        modelSwitches: (p.model_switches ?? null) as {
          opus_everywhere?: boolean;
          fable_everywhere?: boolean;
          fable_redo?: boolean;
        } | null,
        phases: phases.map((ph) => ({
          n: Number(ph.n ?? 0),
          name: String(ph.name ?? ""),
          status: String(ph.status ?? "todo"),
          gate: String(ph.gate ?? ""),
          generatedBy: String(ph.generated_by ?? ""),
          estTok: Number(ph.est_tok ?? 0),
          steps: (Array.isArray(ph.steps) ? (ph.steps as Record<string, unknown>[]) : []).map(
            (s) => ({
              text: String(s.text ?? ""),
              tok: Number(s.tok ?? 0),
              done: Boolean(s.done),
              model: String(s.model ?? ""),
              reasonTag: String(s.reasonTag ?? "")
            })
          )
        }))
      });
    } catch {
      projects.push({
        file: name,
        id: name,
        name: name,
        status: "unreadable",
        amberxBound: false,
        supersededBy: null,
        modified: 0,
        notes: [],
        checklist: [],
        produces: null,
        version: "",
        created: "",
        bytes: 0,
        rates: null,
        modelSwitches: null,
        phases: []
      });
    }
  }

  return Response.json({ dir: PROJECTS_DIR, projects });
}
