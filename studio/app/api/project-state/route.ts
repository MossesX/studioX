/**
 * @file The HTTP face of the project-state generator.
 *
 *   POST /api/project-state → regenerate PROJECT-STATE.md/.json at the AmberX
 *                             root; answers { generatedAt, sessionsDigested,
 *                             fromCache, mdPath }.
 *   GET  /api/project-state → the latest PROJECT-STATE.json summary (snapshot,
 *                             sources, session count) + the resume prompt;
 *                             honest 404 when never generated.
 *
 * Thin translation onto `generateProjectState()`, error posture per the kv
 * route: bad state is a named JSON error with the right status, never a bare
 * 500 page. GET returns a SUMMARY — the full sessions array lives in the file
 * itself, and a client that wants it reads PROJECT-STATE.json.
 */
import fsp from "node:fs/promises";

import {
  generateProjectState,
  JSON_PATH,
  type ProjectStateJson,
} from "../../../src/plugins/project-state/generate.server";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const result = await generateProjectState();
    return Response.json({
      generatedAt: result.generatedAt,
      sessionsDigested: result.sessionsDigested,
      fromCache: result.fromCache,
      mdPath: result.mdPath,
    });
  } catch (err) {
    return Response.json(
      { error: `generation failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<Response> {
  let raw: string;
  try {
    raw = await fsp.readFile(JSON_PATH, "utf8");
  } catch {
    return Response.json(
      { error: "never generated — POST /api/project-state to create it" },
      { status: 404 }
    );
  }
  let state: ProjectStateJson;
  try {
    state = JSON.parse(raw) as ProjectStateJson;
  } catch {
    return Response.json(
      { error: `PROJECT-STATE.json exists but is not parseable JSON (${JSON_PATH})` },
      { status: 500 }
    );
  }
  if (typeof state?.generatedAt !== "string" || typeof state?.resumePrompt !== "string") {
    return Response.json(
      { error: `PROJECT-STATE.json is missing generatedAt/resumePrompt (${JSON_PATH})` },
      { status: 500 }
    );
  }
  return Response.json({
    generatedAt: state.generatedAt,
    generatorVersion: state.generatorVersion,
    resumePrompt: state.resumePrompt,
    snapshot: state.snapshot,
    sources: state.sources,
    sessionCount: Array.isArray(state.sessions) ? state.sessions.length : 0,
  });
}
