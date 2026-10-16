/**
 * @file The HTTP face of the Task Manager's archive.
 *
 *   GET    /api/taskman/archive          → { entries } — metadata only
 *   GET    /api/taskman/archive?id=<id>  → { entry }   — the list itself, for a restore
 *   POST   /api/taskman/archive          → { ok, archived, total, trimmed }; body { lists, reason }
 *   DELETE /api/taskman/archive?id=<id>  → { ok, removed }
 *   DELETE /api/taskman/archive?all=1    → { ok, removed } — empty the archive
 *
 * The USER is resolved server-side (`kvUser`), never named by the client — the
 * same rule `/api/axf/kv/<ns>` states and for the same reason: a client that
 * could name a user would make per-user scoping a suggestion. That is what
 * satisfies the owner's *"each individual user has their own lists"*.
 *
 * ── why the list GET is metadata only ───────────────────────────────────────
 *
 * The dialog draws a row per archived list: a name, a date, a count. Shipping
 * every item tree to draw that is megabytes to render a table, and the archive
 * is read on every open. The full list travels only when one is actually being
 * restored, which is `?id=`.
 */
import {
  appendArchive,
  countTree,
  purgeArchive,
  readArchive,
  type ArchiveEntry
} from "../../../../src/server/taskmanArchive";
import { kvUser } from "../../../../src/server/axfKv";

export const dynamic = "force-dynamic";

/**
 * Generous next to kv's 256KB, because this really is a blob route: a build
 * project list is a ninety-item tree and a delete-all posts every list at once.
 * Still bounded — an unbounded body is a denial-of-service with a JSON parser.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** The shape a client posts. Narrowed to what this route reads. */
interface PostedList {
  id?: unknown;
  name?: unknown;
  items?: unknown;
}

/** Everything but the list body — what the dialog renders. */
function toMeta(entry: ArchiveEntry): Omit<ArchiveEntry, "list"> {
  const { list: _list, ...meta } = entry;
  return meta;
}

export async function GET(request: Request): Promise<Response> {
  const user = kvUser(request);
  const id = new URL(request.url).searchParams.get("id");
  const entries = await readArchive(user);
  if (id) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return Response.json({ error: "no such archived list" }, { status: 404 });
    return Response.json({ entry });
  }
  return Response.json({ entries: entries.map(toMeta) });
}

export async function POST(request: Request): Promise<Response> {
  const user = kvUser(request);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "archive payload too large" }, { status: 413 });
  }
  let body: { lists?: unknown; reason?: unknown };
  try {
    body = JSON.parse(raw) as { lists?: unknown; reason?: unknown };
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  const lists = body.lists;
  if (!Array.isArray(lists) || lists.length === 0) {
    return Response.json({ error: "body.lists must be a non-empty array" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 40) : "list";
  const now = Date.now();

  const additions: ArchiveEntry[] = [];
  for (const [i, value] of lists.entries()) {
    const list = value as PostedList;
    if (typeof list?.id !== "string" || typeof list?.name !== "string") {
      // Refuse the whole batch rather than archiving part of it: the client
      // deletes only after this answers ok, and a partial success would delete
      // lists that were never written down.
      return Response.json({ error: `lists[${i}] is not a task list` }, { status: 400 });
    }
    additions.push({
      // Unique per ARCHIVING, not per list — the same list can be restored and
      // deleted again, and both events are things you may want back.
      id: `arch_${now.toString(36)}_${i.toString(36)}`,
      listId: list.id,
      name: list.name,
      archivedAt: now,
      reason,
      itemCount: countTree(list.items),
      list: value
    });
  }

  const { total, trimmed } = await appendArchive(user, additions);
  return Response.json({ ok: true, archived: additions.length, total, trimmed });
}

export async function DELETE(request: Request): Promise<Response> {
  const user = kvUser(request);
  const params = new URL(request.url).searchParams;
  const all = params.get("all") === "1";
  const id = params.get("id");
  if (!all && !id) {
    // No blanket delete by accident: emptying the archive is the one
    // irreversible operation this module has, so it has to be asked for.
    return Response.json({ error: "name an id, or pass all=1" }, { status: 400 });
  }
  const removed = await purgeArchive(user, all ? null : [id as string]);
  return Response.json({ ok: true, removed });
}
