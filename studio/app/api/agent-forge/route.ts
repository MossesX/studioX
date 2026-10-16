/**
 * @file `/api/agent-forge` — the roster the panel draws, and one persona's
 * compiled context.
 *
 *   GET ?cwd=<dir>                → { repo, personas, skills }
 *   GET ?cwd=<dir>&persona=<id>   → { repo, context } | 404
 *
 * The panel reaches `forge.ts` through here and NEVER by import: that file
 * reads the filesystem, and a client component importing it would drag
 * `node:fs` into the browser bundle with tsc saying nothing. One route, two
 * questions, because they share a scan and splitting them would run it twice.
 *
 * `cwd` is the CONVERSATION'S working directory, passed by the caller. It is
 * not validated against an allowlist and deliberately so — the tree a
 * conversation runs in is chosen by the person starting it, the CLI already
 * reads `.claude/` from exactly there, and a route that refused a directory the
 * CLI will happily load would be a second, disagreeing, notion of scope. What
 * it does refuse is a missing one, rather than defaulting to the server's cwd
 * and quietly listing the studio's own personas as if they were the
 * conversation's.
 *
 * ── `tree=studio`, and why it is a SEPARATE question ────────────────────────
 *
 * The `/forge` module has no conversation, so it has no `cwd` to send. What it
 * wants is this install's own tree, which is exactly the default the paragraph
 * above refuses to have. It is offered here as a distinct, named request rather
 * than as a fallback for a missing `cwd`, because the two differ in what the
 * answer MEANS: one is "the personas your session will get", the other is "the
 * personas this install ships and carries". A typo'd `cwd` silently becoming
 * the second while reading as the first is the confusion the refusal exists to
 * prevent, and a default would reintroduce it under a different name.
 */
import path from "node:path";

import { personaContext, scanRoster } from "../../../src/plugins/agent-forge/roster";

export const dynamic = "force-dynamic";

/** The repo this studio lives in. `process.cwd()` is `packages/studio` under
 *  `next dev` and `next start` alike — the same assumption `KV_ROOT` and
 *  `STUDIO_FORGE_ROOT` already make. */
const REPO = path.resolve(process.cwd(), "..", "..");

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cwd = url.searchParams.get("cwd") ?? (url.searchParams.get("tree") === "studio" ? REPO : null);
  if (!cwd) {
    return Response.json(
      {
        error:
          "cwd is required — the roster is the conversation's tree, not the server's. " +
          "For this install's own tree, ask for it by name: tree=studio"
      },
      { status: 400 }
    );
  }

  const persona = url.searchParams.get("persona");
  if (persona) {
    const context = personaContext(cwd, persona);
    if (context === null) {
      return Response.json(
        { error: `no enabled persona "${persona}" under ${cwd}` },
        { status: 404 }
      );
    }
    return Response.json({ repo: cwd, context });
  }

  const roster = scanRoster(cwd);
  return Response.json(roster);
}
