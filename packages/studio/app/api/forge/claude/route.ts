/**
 * @file `/api/forge/claude` — the Claude CLI's agents and skills, readable
 * and now WRITABLE (the half `agent-forge` never had).
 *
 * GET             → the roster (both scopes) + the full text of one entry
 *                   when `?kind=&scope=&slug=` is given.
 * POST            → write a file whole: { kind, scope, slug, text }.
 * PATCH           → flip the off switch: { kind, scope, slug, disabled }.
 * DELETE ?…       → remove the entry (a skill is its whole directory).
 */
import {
  claudeRoster,
  deleteClaudeEntry,
  readClaudeFile,
  setClaudeDisabled,
  writeClaudeFile
} from "@axs/modules/forge/forge.server";
import type { ForgeScope } from "@axs/plugins/agent-forge/forge";

function params(url: string): { kind: "agent" | "skill"; scope: ForgeScope; slug: string } | null {
  const u = new URL(url);
  const kind = u.searchParams.get("kind");
  const scope = u.searchParams.get("scope");
  const slug = u.searchParams.get("slug");
  if (
    (kind !== "agent" && kind !== "skill") ||
    (scope !== "project" && scope !== "user" && scope !== "studio") ||
    !slug
  ) {
    return null;
  }
  // `studio` is readable here; the writers refuse it server-side (the house
  // set is source — packages/studio/forge/ — and is edited as source).
  return { kind, scope, slug };
}

export async function GET(request: Request) {
  const p = params(request.url);
  if (p) {
    try {
      return Response.json({ text: readClaudeFile(p.scope, p.kind, p.slug) });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
    }
  }
  return Response.json(claudeRoster());
}

export async function POST(request: Request) {
  let body: { kind?: string; scope?: string; slug?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  if (
    (body.kind !== "agent" && body.kind !== "skill") ||
    (body.scope !== "project" && body.scope !== "user")
  ) {
    return Response.json({ error: "kind must be agent|skill and scope project|user" }, { status: 400 });
  }
  try {
    writeClaudeFile(body.scope, body.kind, String(body.slug ?? ""), String(body.text ?? ""));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  let body: { kind?: string; scope?: string; slug?: string; disabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  if (
    (body.kind !== "agent" && body.kind !== "skill") ||
    (body.scope !== "project" && body.scope !== "user") ||
    typeof body.disabled !== "boolean"
  ) {
    return Response.json(
      { error: "kind agent|skill, scope project|user and a boolean `disabled` are required" },
      { status: 400 }
    );
  }
  try {
    setClaudeDisabled(body.scope, body.kind, String(body.slug ?? ""), body.disabled);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const p = params(request.url);
  if (!p) {
    return Response.json({ error: "kind, scope and slug query params are required" }, { status: 400 });
  }
  try {
    deleteClaudeEntry(p.scope, p.kind, p.slug);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
