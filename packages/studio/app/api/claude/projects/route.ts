/**
 * @file `/api/claude/projects` — the project half of the service API over HTTP.
 *
 *   GET  → { projects: ProjectRecord[] }
 *   POST → the created ProjectRecord   (body: ProjectOptions)
 *
 * Thin, exactly as the conversations collection is thin. Every rule about what
 * a project may be — a name that is not empty, a bound directory that exists, a
 * model in the catalog, a knowledge list under the cap — lives on the service,
 * because the workspace module is not the only caller and a rule enforced at
 * one door is a rule the other door does not have.
 *
 * ── whole records, not metas ─────────────────────────────────────────────────
 *
 * The conversations route answers with `ConversationMeta[]` because a
 * conversation is a transcript and a lobby of two hundred would be the corpus.
 * A project is a path, some instructions and a list of filenames — kilobytes —
 * and the manager screen needs all of it to edit anything. A second reduced
 * shape here would be one more thing to keep in step for no saved bytes.
 */
import { claudeServiceFor } from "../../../../src/claude/service";
import { coerceKnowledge } from "../../../../src/claude/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json({ projects: await claudeServiceFor(request).listProjects() });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  try {
    return Response.json(
      await claudeServiceFor(request).createProject({
        name: str(body.name) ?? "",
        cwd: str(body.cwd) ?? "",
        instructions: str(body.instructions),
        knowledge: coerceKnowledge(body.knowledge),
        model: str(body.model),
        effort: str(body.effort),
        permissionMode: str(body.permissionMode)
      }),
      { status: 201 }
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
