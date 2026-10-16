/**
 * @file `/api/firecrawl/config` — the API key's home, presence-only outward.
 *
 *   GET  → FirecrawlConfigInfo ({ hasKey, source: env|stored|none })
 *   POST → { ok }; body { apiKey: "fc-..." } to store, { apiKey: "" } to clear
 *
 * The key itself NEVER rides a response — the assistant config route's rule,
 * held here for the same reason. An env `FIRECRAWL_API_KEY` outranks the
 * stored one (the engine reads them in that order), so GET reports which one
 * a run would actually use.
 */
import { axfKv, kvUser } from "@axs/server/axfKv";
import { FIRECRAWL_CONFIG_NS, resolveApiKey } from "@axs/modules/firecrawl/engine.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { key, source } = await resolveApiKey(kvUser(request));
  return Response.json({ hasKey: key !== null, source });
}

export async function POST(request: Request): Promise<Response> {
  let body: { apiKey?: unknown };
  try {
    body = (await request.json()) as { apiKey?: unknown };
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  if (typeof body.apiKey !== "string") {
    return Response.json({ error: "body.apiKey must be a string (empty clears it)" }, { status: 400 });
  }
  const apiKey = body.apiKey.trim();
  const user = kvUser(request);
  if (!apiKey) {
    await axfKv.write(user, FIRECRAWL_CONFIG_NS, {});
    return Response.json({ ok: true, hasKey: Boolean(process.env.FIRECRAWL_API_KEY?.trim()) });
  }
  if (!/^fc-[A-Za-z0-9-]{8,}$/.test(apiKey)) {
    return Response.json({ error: "that does not look like a Firecrawl key (fc-…)" }, { status: 400 });
  }
  await axfKv.write(user, FIRECRAWL_CONFIG_NS, { apiKey });
  return Response.json({ ok: true, hasKey: true });
}
