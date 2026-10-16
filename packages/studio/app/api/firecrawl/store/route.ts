/**
 * @file `/api/firecrawl/store` — workflows + datasets, server-backed.
 *
 *   GET  → FirecrawlDoc ({ v: 1, workflows, datasets })
 *   POST → { ok: true }; body is the whole doc (the client store owns merge)
 *
 * The store is the studio's kv primitive (`data/axf/kv/local/firecrawl.json`),
 * the expenses route's exact shape. **Node-only.** The cap is bigger than the
 * ledger's because a dataset carries scraped markdown — bounded all the same,
 * because a kv doc is a preferences store with generous margins, not a blob
 * store; a corpus that outgrows this belongs in files.
 */
import { axfKv, kvUser } from "@axs/server/axfKv";
import type { FirecrawlDoc } from "@axs/modules/firecrawl/types";

export const dynamic = "force-dynamic";

const NS = "firecrawl";

const MAX_BODY_BYTES = 16 * 1024 * 1024;

export async function GET(request: Request): Promise<Response> {
  const doc = (await axfKv.read(kvUser(request), NS)) as Partial<FirecrawlDoc> | null;
  // A v1 doc (no lists/recordings) reads as v2 with empty arrays — the
  // client never sees the migration.
  return Response.json({
    v: 2,
    workflows: Array.isArray(doc?.workflows) ? doc.workflows : [],
    datasets: Array.isArray(doc?.datasets) ? doc.datasets : [],
    lists: Array.isArray(doc?.lists) ? doc.lists : [],
    recordings: Array.isArray(doc?.recordings) ? doc.recordings : []
  });
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "document too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  const { workflows, datasets, lists, recordings } = body as Partial<FirecrawlDoc>;
  if (!Array.isArray(workflows) || !Array.isArray(datasets)) {
    return Response.json(
      { error: "body must carry workflows[] and datasets[]" },
      { status: 400 }
    );
  }
  await axfKv.write(kvUser(request), NS, {
    v: 2,
    workflows,
    datasets,
    lists: Array.isArray(lists) ? lists : [],
    recordings: Array.isArray(recordings) ? recordings : []
  });
  return Response.json({ ok: true });
}
