/**
 * @file `/api/amberxvid/calls/history` — the member's own call history (P13).
 *
 * Nested under `calls/` deliberately: it is the residue of the ceremony the
 * parent route runs, and a reader who wants to know who writes these rows is
 * one directory away from the answer.
 *
 * **A member reads their OWN history and nobody else's.** There is no `user`
 * parameter and no admin variant here — who rang whom is exactly the kind of
 * thing the moderation wing audits through its own audited surfaces, not
 * through a member-facing route with a query string on it.
 *
 * GET  → `{ history, missed }` — newest first, already capped by the store.
 * POST `{ action: "clear" }`          → forget the whole list.
 * POST `{ action: "delete", id }`     → forget one row.
 *
 * Deleting only ever touches the caller's own document; the other party's row
 * is their record of their own call and is not the caller's to erase.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import {
  callHistoryFor,
  clearCallHistory,
  deleteCallRow,
  missedCountFor,
} from "@axs/modules/amberxvid/lib/callHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();
  return NextResponse.json({
    ok: true,
    history: callHistoryFor(me),
    missed: missedCountFor(me),
  });
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

  const action = typeof body.action === "string" ? body.action : "";

  if (action === "clear") {
    clearCallHistory(me);
    return NextResponse.json({ ok: true, history: [], missed: 0 });
  }

  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ ok: false, error: "which row?" }, { status: 400 });
    // A row that was already gone is a success: the caller asked for it to not
    // be there, and it is not there.
    deleteCallRow(me, id);
    return NextResponse.json({ ok: true, history: callHistoryFor(me), missed: missedCountFor(me) });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
