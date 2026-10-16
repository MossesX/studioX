/**
 * @file The HTTP face of core's kv primitive — what `httpKv()` (the client
 * transport in `@axf/core`) speaks to.
 *
 *   GET    /api/axf/kv/<ns>   → { doc } | 404 when the user has no document
 *   PUT    /api/axf/kv/<ns>   → { ok: true }; body { doc: <JSON object> }
 *   DELETE /api/axf/kv/<ns>   → { ok: true }; forgetting is idempotent
 *
 * DELETE arrived with the geometry probe's drag pass (2026-08-13, `axf-claude`
 * P2): a probe that drags a split writes a real latch, and a probe that cannot
 * take its own writes back is one that permanently retunes the fixture it
 * measures. `KvStore.remove` already existed in core and simply had no HTTP
 * face — "there is no document" and "there is a document that happens to equal
 * the default" are different states, and a store that can only reach the second
 * makes every consumer's empty case untestable.
 *
 * Thin translation onto the singleton store, exactly like the claude routes
 * over `claudeService()`. The USER is resolved server-side (`kvUser`) — a
 * client never names one, which is what keeps per-user scoping a fact rather
 * than a suggestion. The namespace guard runs in the store; here it becomes a
 * 400 instead of a 500.
 */
import { isKvName } from "@axf/core";

import { axfKv, kvUser } from "../../../../../src/server/axfKv";

export const dynamic = "force-dynamic";

/** A preferences/latch store, not a blob store. */
const MAX_BODY_BYTES = 256 * 1024;

type RouteCtx = { params: Promise<{ ns: string }> };

export async function GET(request: Request, ctx: RouteCtx): Promise<Response> {
  const { ns } = await ctx.params;
  if (!isKvName(ns)) {
    return Response.json({ error: `"${ns}" is not a valid namespace` }, { status: 400 });
  }
  const doc = await axfKv.read(kvUser(request), ns);
  if (doc === null) return Response.json({ error: "no document" }, { status: 404 });
  return Response.json({ doc });
}

export async function PUT(request: Request, ctx: RouteCtx): Promise<Response> {
  const { ns } = await ctx.params;
  if (!isKvName(ns)) {
    return Response.json({ error: `"${ns}" is not a valid namespace` }, { status: 400 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "document too large" }, { status: 413 });
  }
  let doc: unknown;
  try {
    doc = (JSON.parse(raw) as { doc?: unknown }).doc;
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return Response.json({ error: "body.doc must be a JSON object" }, { status: 400 });
  }
  await axfKv.write(kvUser(request), ns, doc as Record<string, unknown>);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, ctx: RouteCtx): Promise<Response> {
  const { ns } = await ctx.params;
  if (!isKvName(ns)) {
    return Response.json({ error: `"${ns}" is not a valid namespace` }, { status: 400 });
  }
  // Deleting what is not there answers ok, not 404: the store's own `remove`
  // treats a missing file as success, and a caller forgetting a preference
  // wants it gone, not a report on whether it was there to begin with.
  await axfKv.remove(kvUser(request), ns);
  return Response.json({ ok: true });
}
