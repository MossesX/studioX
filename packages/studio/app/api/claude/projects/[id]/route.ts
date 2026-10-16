/**
 * @file `/api/claude/projects/<id>` — one project, whole.
 *
 *   GET             → { project, knowledge: KnowledgeStatus[] }
 *   PATCH           → the updated ProjectRecord   (body: ProjectPatch)
 *   DELETE          → { deleted: boolean }
 *   DELETE ?detach=1 → the same, having unfiled its conversations first
 *
 * ── GET answers TWO things, and that is deliberate ───────────────────────────
 *
 * The record is stored state; the knowledge resolution is what those paths mean
 * on disk *right now*, which is not stored anywhere and cannot be. Returning
 * them as one object rather than two round trips is not a convenience: the
 * editor's whole job is to let somebody see that `docs/SPEC.md` is `SPEC.mdx`
 * BEFORE spending a turn finding out, and an editor that had to ask twice would
 * eventually be written to ask once.
 *
 * They stay separate KEYS rather than being merged onto the record, because a
 * resolution is not a field of a project — folding it in would produce a shape
 * that cannot be PATCHed back, which is the trap every "enriched record"
 * endpoint sets.
 *
 * ── `?detach=1` ──────────────────────────────────────────────────────────────
 *
 * A query flag rather than a body, because DELETE bodies are not reliably
 * transmitted and this is a modifier on the delete rather than a payload. The
 * service refuses a delete that would orphan conversations and says how many;
 * `detach` is the caller stating out loud that it wants them unfiled and kept.
 * There is no third option that silently orphans them — see `removeProject`.
 */
import { claudeServiceFor } from "../../../../../src/claude/service";
import { coerceKnowledge } from "../../../../../src/claude/types";

export const dynamic = "force-dynamic";

/** The same three-way split the conversation route makes, for the same reason:
 *  "you asked wrong", "it is not here" and "not while that is true" are
 *  different answers and a client acts differently on each. */
function refusal(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  if (/is not a project id/.test(message)) {
    return Response.json({ error: message }, { status: 400 });
  }
  if (/does not exist/.test(message)) return Response.json({ error: message }, { status: 404 });
  if (/still holds/.test(message)) return Response.json({ error: message }, { status: 409 });
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const service = claudeServiceFor(request);
    const project = await service.getProject(id);
    if (!project) return Response.json({ error: `no project "${id}"` }, { status: 404 });
    return Response.json({ project, knowledge: await service.projectKnowledge(id) });
  } catch (err) {
    return refusal(err);
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Named fields only, and an unnamed one is ignored rather than rejected — the
  // conversation route's argument, unchanged: a client that PATCHes back the
  // whole record it just read (the obvious thing to do) must not be able to
  // rewrite `id`, `format` or `createdAt` through the editor's affordance.
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const patch = {
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
    ...(typeof body.instructions === "string" ? { instructions: body.instructions } : {}),
    ...(body.knowledge !== undefined ? { knowledge: coerceKnowledge(body.knowledge) } : {}),
    ...(str(body.model) !== undefined ? { model: str(body.model) } : {}),
    ...(str(body.effort) !== undefined ? { effort: str(body.effort) } : {}),
    ...(str(body.permissionMode) !== undefined
      ? { permissionMode: str(body.permissionMode) }
      : {})
  };

  try {
    return Response.json(await claudeServiceFor(request).updateProject(id, patch));
  } catch (err) {
    return refusal(err);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const detach = new URL(request.url).searchParams.get("detach") === "1";
  try {
    return Response.json({ deleted: await claudeServiceFor(request).removeProject(id, { detach }) });
  } catch (err) {
    return refusal(err);
  }
}
