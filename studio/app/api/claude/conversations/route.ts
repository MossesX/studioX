/**
 * @file `/api/claude/conversations` — the service API over HTTP.
 *
 *   GET        → { conversations: ConversationMeta[] }
 *   GET ?q=…   → { query, hits: SearchHit[] }        (the LIBRARY, P3)
 *   POST       → the created ConversationRecord      (body: StartOptions)
 *
 * POST's body is `StartOptions` WHOLE, and keeping it whole is load-bearing
 * rather than tidy: `projectId` was added to the service and to the browser
 * client in P4 and this route quietly did not forward it, so every conversation
 * started from the UI came back filed under no project — with a correct record,
 * a 201, and no error anywhere. Nothing that calls `start()` directly could see
 * it. A field added to `StartOptions` is a field to add here in the same edit.
 *
 * This exists because "a service API other assets call" has to survive a
 * process boundary: an in-process consumer imports `src/claude/service`, and
 * everything else — a browser, a plugin's client half, a probe — arrives here.
 * Both reach exactly the same verbs; this file adds a wire and no behaviour.
 *
 * Validation is deliberately NOT duplicated here. The service refuses an
 * unknown model, a non-existent cwd and a bad effort/permission mode by name,
 * so this route's job is to turn a refusal into a 400 rather than to re-state
 * the rules — two validators is how one of them ends up out of date.
 *
 * ── search is a QUERY PARAM, not a route (P3, 2026-08-13) ────────────────────
 *
 * `?q=` on the collection rather than `/conversations/search`, for one reason
 * that is not style: `search` as a path segment sits in the same position as
 * `<id>`, and Next resolves the static segment first — so the day someone mints
 * a conversation literally called `search` it would work, and the day the id
 * grammar widens it would stop. A filter on a collection is also what this is:
 * the response is the same list, narrowed, and a caller that drops the param
 * gets the whole list back with no second endpoint to learn.
 *
 * The two answers are deliberately DIFFERENT shapes (`conversations` vs
 * `hits`), because a hit is a meta plus its matched excerpts, and flattening
 * them into one shape would mean either inventing empty match arrays for the
 * unfiltered list or throwing the excerpts away — the excerpts being the whole
 * value of having searched.
 */
import { claudeServiceFor } from "../../../../src/claude/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q");
  // A `q` that is present but blank is treated as absent, not as a search that
  // matched nothing: a search box the user has just cleared should show the
  // library again rather than an empty state.
  if (query !== null && query.trim()) {
    return Response.json({ query, hits: await claudeServiceFor(request).search(query) });
  }
  return Response.json({ conversations: await claudeServiceFor(request).list() });
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
      await claudeServiceFor(request).start({
        title: str(body.title),
        model: str(body.model),
        effort: str(body.effort),
        permissionMode: str(body.permissionMode),
        system: str(body.system),
        cwd: str(body.cwd),
        // P4. Forwarded like everything else and validated nowhere here: the
        // service refuses an unknown project, and refuses a `cwd` that
        // disagrees with the project's bound directory, both by name.
        projectId: str(body.projectId)
      }),
      { status: 201 }
    );
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
