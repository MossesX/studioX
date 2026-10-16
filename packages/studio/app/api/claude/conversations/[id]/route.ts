/**
 * @file `/api/claude/conversations/<id>` — one conversation, whole.
 *
 *   GET    → the ConversationRecord, or 404
 *   PATCH  → { title?, pinned? }  the updated record  (the LIBRARY, P3)
 *   DELETE → { deleted: boolean }                     (the LIBRARY, P3)
 *
 * GET is `resume()` over HTTP, and the name is worth keeping straight: after
 * a server restart, reading the record IS the resumption. The record carries
 * `cliSessionId`, and the next `send()` puts `--resume <id>` on the command
 * line from it — no in-memory state is involved anywhere in that path, which
 * is why the restart survives it.
 *
 * ── PATCH and DELETE (2026-08-13, P3) ────────────────────────────────────────
 *
 * This file's previous header said *"PATCH (rename, pin) and DELETE are the
 * LIBRARY (P3) and are not here"*. P3 is what is running, so they are here now
 * — and they are thin, exactly as POST on the collection route is thin. Every
 * rule about what a title may be and when a conversation may be deleted lives
 * on the service, because the workspace module is not the only caller and a
 * rule enforced at one door is a rule the other door does not have.
 *
 * PATCH is a partial update over TWO named fields and refuses anything else by
 * ignoring it — not by erroring, and the distinction is deliberate: a client
 * that sends back a whole record it just read (the obvious thing to do) must
 * not be able to rewrite `messages`, `cwd` or `cliSessionId` through the
 * library's affordance. Those are the transport's to own.
 *
 * DELETE answers 409 when a turn is live rather than killing it. "Stop
 * spending money" is `POST .../cancel`, and one intention per route is the
 * same rule that keeps a closed stream from cancelling a turn.
 */
import { claudeServiceFor } from "../../../../../src/claude/service";

export const dynamic = "force-dynamic";

/** A store traversal refusal is a 400 ("you asked wrong"), a missing record is
 *  a 404 ("it is not here") — different answers, told apart by the message the
 *  store's fence throws. */
function refusal(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  if (/is not a conversation id/.test(message)) {
    return Response.json({ error: message }, { status: 400 });
  }
  if (/does not exist/.test(message)) return Response.json({ error: message }, { status: 404 });
  if (/has a turn running/.test(message)) return Response.json({ error: message }, { status: 409 });
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const record = await claudeServiceFor(request).get(id);
    if (!record) return Response.json({ error: `no conversation "${id}"` }, { status: 404 });
    return Response.json(record);
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

  const wantsTitle = typeof body.title === "string";
  const wantsPin = typeof body.pinned === "boolean";
  if (!wantsTitle && !wantsPin) {
    return Response.json(
      { error: "PATCH accepts `title` (string) and `pinned` (boolean); neither was supplied" },
      { status: 400 }
    );
  }

  try {
    const service = claudeServiceFor(request);
    // Applied in a fixed order, each through the store's own read-modify-write
    // chain, so a PATCH carrying both cannot lose one to the other.
    let record = wantsTitle ? await service.rename(id, body.title as string) : null;
    if (wantsPin) record = await service.setPinned(id, body.pinned as boolean);
    return Response.json(record);
  } catch (err) {
    return refusal(err);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return Response.json({ deleted: await claudeServiceFor(request).remove(id) });
  } catch (err) {
    return refusal(err);
  }
}
