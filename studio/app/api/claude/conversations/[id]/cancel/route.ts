/**
 * @file `/api/claude/conversations/<id>/cancel` — stop the running turn.
 *
 *   POST → { cancelled: boolean }
 *
 * `cancelled: false` means there was nothing running, which is a legitimate
 * answer and not an error — a stop button pressed twice must not produce a
 * failure.
 *
 * This KILLS the CLI child. It is a separate act from closing a stream, and
 * deliberately so: the project's own warning is that *"a CLI left running
 * after the user hits stop is a cost leak with no UI"*, and the inverse — a
 * turn killed because a tab closed — throws away work that was already paid
 * for. One intention per route.
 */
import { claudeServiceFor } from "../../../../../../src/claude/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return Response.json({ cancelled: claudeServiceFor(request).cancel(id) });
}
