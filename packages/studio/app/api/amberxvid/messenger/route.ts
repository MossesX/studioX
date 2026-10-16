/**
 * @file `/api/amberxvid/messenger` — the messenger's SKIN, and nothing else.
 *
 * P6 (2026-08-15) split the old `/api/amberxvid/messages` in two and retired
 * the bigger half. Messages, threads, groups, unread and live delivery are
 * `/api/accounts/*` now — there is no module-side message API any more, and a
 * client that reaches for one is reaching for a store that does not exist.
 * What is left is what only this module has an opinion about: which of the
 * twenty chat themes a member picked, whether it chimes, and what their away
 * message says.
 *
 * Same gate as the rest of the module: a signed-in studio session holding the
 * amberxvid grant.
 *
 * GET  → `{ settings }`
 * POST `{ ...patch }` → `{ settings }` — merged over what is stored; unknown
 *   keys and junk values drop out in the store rather than here, so the route
 *   has no second idea of what a valid setting is.
 *
 * There is deliberately no `action` field. The old route needed one because it
 * multiplexed send / read / settings down one door; this one does a single
 * thing, and a verb naming the only verb is noise.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import {
  getMessengerSettings,
  saveMessengerSettings,
} from "@axs/modules/amberxvid/lib/messengerSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();
  return NextResponse.json({ ok: true, settings: getMessengerSettings(me) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, settings: await saveMessengerSettings(me, body) });
}
